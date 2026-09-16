(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // MAPA DE ADEN — PLANE 3D (Three.js) NO LUGAR DO background-image ───────
    //
    // Hoje o #mapImage é um <div> comum, com uma imagem de fundo em CSS,
    // arrastado/zoomado via `enableMapInteraction()` (script.js) escrevendo
    // `map.style.transform = translate(x,y) scale(s)` a cada frame. Esse
    // módulo NÃO toca em nada disso — ele só "espelha" esses mesmos x/y/s,
    // lidos diretamente da própria style string do elemento, num plane 3D
    // renderizado por baixo (canvas Three.js), que aí sim passa pelo mesmo
    // EffectComposer (bloom + color grade) do postfx.js usado no skybox da
    // tela de login.
    //
    // COMO FICA A PILHA VISUAL (de baixo pra cima, dentro de #mapContainer):
    //   1) #mapSkyboxLayer  → canvas Three.js com o plane (a arte do mapa)
    //   2) #mapImage        → continua exatamente igual, MAS com o
    //                         background-image escondido (ver classe
    //                         .mapsky-hide-bg) — ele so passa a servir de
    //                         camada de INTERAÇÃO/HOTSPOTS: os <a class=
    //                         "map-hotspot"> (map_hotspots.js), as nuvens
    //                         (#mfx-layer, map_effects.js) e o badge de GPS
    //                         continuam filhos dele, então continuam
    //                         arrastando/zoomando junto (é assim que o CSS
    //                         transform sempre funcionou) e continuam 100%
    //                         clicáveis, porque são os MESMOS elementos.
    //
    // O QUE ESSE ARQUIVO **NÃO** FAZ:
    //   - Não mexe em enableMapInteraction() nem em nenhuma outra função do
    //     script.js (drag, pinch, inércia, limites de pan) — só LÊ o
    //     resultado final (map.style.transform) a cada frame.
    //   - Não mexe em map_hotspots.js nem no posicionamento dos hotspots.
    //   - Não some com o mapa se a textura falhar ao carregar: nesse caso a
    //     classe que esconde o background NUNCA é aplicada, e o <div>
    //     continua mostrando a imagem exatamente como antes.
    //
    // LIMITE DE ZOOM (pixelização): o teto de zoom continua sendo o
    // `MAX_SCALE` de dentro de `enableMapInteraction()`, em script.js — esse
    // arquivo não o duplica nem o sobrescreve. Pra ajustar, procure em
    // script.js por:
    //     const MAX_SCALE = 2.0;  // limite máximo de zoom-in
    // e diminua esse número (ex.: 1.3) até a nitidez ficar do seu agrado.
    // ═══════════════════════════════════════════════════════════════════════

    // ── AJUSTE AQUI — bloom/grading específicos do mapa (não afeta a tela
    // de login nem outras telas: cada uma sobrescreve seu próprio conjunto
    // de números bem antes de chamar initPostFX, sempre por cima do que
    // ficou de uma tela anterior na mesma sessão — mesmo padrão já usado em
    // auth_skybox.js e map_effects.js). Valores iniciais deliberadamente
    // discretos (o mapa é visto de longe/de cima, não precisa de um bloom
    // forte tipo o sol da tela de login). ──────────────────────────────────
    const MAP_BLOOM_STRENGTH  = 0.65;
    const MAP_BLOOM_RADIUS    = 0.20;
    const MAP_BLOOM_THRESHOLD = 0.85;

    // Mesmos números que map_effects.js já usa pro grading da camada DOM
    // (hotspots/nuvens/badge) — repetidos aqui pra a ARTE do mapa (que agora
    // vive no canvas) ficar visualmente consistente com eles. Se você mudar
    // um lado, mude o outro também (ver applyShaderGrading em
    // map_effects.js).
    const MAP_CONTRAST   = 1.03;
    const MAP_SATURATION = 1.03;

    // Tamanho "natural" do mapa (mesmo valor de #mapImage no style.css e do
    // fallback usado em enableMapInteraction/recalcLimits). Se um dia mudar
    // lá, mude aqui também.
    const MAP_NATURAL_W = 1500;
    const MAP_NATURAL_H = 1600;

    let _map3d = null; // { scene, camera, renderer, canvas, cont, mapEl, pfx, running, raf, _onResize }

    // ── CSS ──────────────────────────────────────────────────────────────
    function injectCSS() {
        if (document.getElementById('mapsky-css')) return;
        const css = `
            #mapSkyboxLayer {
                position: absolute;
                inset: 0;
                z-index: 0;
                overflow: hidden;
                pointer-events: none;
                background: #000;
            }
            #mapSkyboxCanvas {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                display: block;
            }
            /* Aplicada só depois que a textura do plane 3D carrega com
               sucesso — se der erro, o #mapImage nunca ganha essa classe e
               continua mostrando a imagem de fundo dele mesmo, como antes. */
            #mapImage.mapsky-hide-bg {
                background-image: none !important;
            }
        `;
        const s = document.createElement('style');
        s.id = 'mapsky-css';
        s.textContent = css;
        document.head.appendChild(s);
    }

    // ── Descobre a URL da imagem atual do mapa sem precisar saber o nome
    // da variável CSS (--bg-mapa-aden ou outra) nem duplicar caminho algum:
    // lê exatamente o que o navegador já resolveu pro background-image. ───
    function getMapImageUrl(mapEl) {
        const bg = window.getComputedStyle(mapEl).backgroundImage;
        const m = /url\(["']?(.*?)["']?\)/.exec(bg || '');
        return m ? m[1] : null;
    }

    // ── Lê o transform já escrito por enableMapInteraction() e devolve
    // {x, y, s} — não assume nenhuma ordem específica de translate/scale
    // (o CSS inicial só tem `scale(1)`, sem translate). ───────────────────
    function parseMapTransform(str) {
        let x = 0, y = 0, s = 1;
        const t = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(str || '');
        if (t) { x = parseFloat(t[1]); y = parseFloat(t[2]); }
        const sc = /scale\(\s*(-?[\d.]+)\s*\)/.exec(str || '');
        if (sc) { s = parseFloat(sc[1]); }
        return { x, y, s };
    }

    function buildDom(mapContainer) {
        const old = document.getElementById('mapSkyboxLayer');
        if (old) old.remove();
        injectCSS();
        const layer = document.createElement('div');
        layer.id = 'mapSkyboxLayer';
        const canvas = document.createElement('canvas');
        canvas.id = 'mapSkyboxCanvas';
        layer.appendChild(canvas);
        // Sempre como PRIMEIRO filho — fica atrás do #mapImage (que continua
        // logo em seguida, na mesma ordem de sempre) sem precisar de
        // z-index disputando com hotspot/nuvens/badge, que já têm o deles.
        mapContainer.insertBefore(layer, mapContainer.firstChild);
        return canvas;
    }

    function isMapScreenVisible(cont) {
        return !!cont && cont.offsetParent !== null && !document.hidden;
    }

    function loop(ts) {
        if (!_map3d || !_map3d.running) return;
        const { scene, camera, mapEl, cont } = _map3d;

        if (isMapScreenVisible(cont)) {
            const { x, y, s } = parseMapTransform(mapEl.style.transform);
            _map3d.plane.position.set(x, y, 0);
            _map3d.plane.scale.set(s, s, 1);

            if (_map3d.pfx) {
                try {
                    _map3d.pfx.render(scene, camera);
                } catch (e) {
                    console.error('[MapSkybox] Erro ao renderizar com pós-processamento, desativando:', e);
                    _map3d.pfx = null;
                    _map3d.renderer.render(scene, camera);
                }
            } else {
                _map3d.renderer.render(scene, camera);
            }
        }

        _map3d.raf = requestAnimationFrame(loop);
    }

    function applyCameraFrustum(camera, w, h) {
        // Trecho que faz o world-space bater 1:1 com pixels CSS do
        // #mapContainer, com origem no canto SUPERIOR ESQUERDO e eixo Y
        // crescendo pra baixo — exatamente a mesma convenção do
        // transform-origin:top-left usado em #mapImage. `top`/`bottom`
        // invertidos (0, h) é de propósito: é isso que espelha o eixo Y.
        camera.left = 0;
        camera.right = w;
        camera.top = 0;
        camera.bottom = h;
        camera.near = -1000;
        camera.far = 1000;
        camera.updateProjectionMatrix();
    }

    async function startMapSkybox() {
        if (_map3d) return; // já rodando

        const mapContainer = document.getElementById('mapContainer');
        const mapEl = document.getElementById('mapImage');
        if (!mapContainer || !mapEl) return;

        let THREE, postfx;
        try {
            [THREE, postfx] = await Promise.all([
                import('three'),
                import('./postfx.js'),
            ]);
        } catch (e) {
            console.error('[MapSkybox] Falha ao carregar three/postfx.js — mapa continua com o background CSS normal:', e);
            return;
        }

        // Pode ter mudado de tela enquanto os módulos carregavam.
        if (document.getElementById('mapImage') !== mapEl) return;

        const canvas = buildDom(mapContainer);
        const w = mapContainer.clientWidth, h = Math.max(mapContainer.clientHeight, 1);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(0, w, 0, h, -1000, 1000);
        camera.position.z = 10;

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h);

        // Plane com origem (0,0,0) recolocada no canto SUPERIOR ESQUERDO —
        // ver applyCameraFrustum sobre a convenção de eixos usada aqui.
        const geometry = new THREE.PlaneGeometry(MAP_NATURAL_W, MAP_NATURAL_H);
        geometry.translate(MAP_NATURAL_W / 2, MAP_NATURAL_H / 2, 0);
        // side: THREE.DoubleSide — necessário por causa do frustum com
        // top/bottom invertidos em applyCameraFrustum (Y crescendo pra
        // baixo): isso inverte a "handedness" da projeção e faz a face
        // frontal do plane ser tratada como back-face pelo culling padrão
        // (FrontSide), sumindo o plano (canvas fica preto). DoubleSide
        // resolve sem precisar desfazer o flip de eixo usado no resto do
        // arquivo (hotspots/transform já dependem dessa convenção).
        const material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
        const plane = new THREE.Mesh(geometry, material);
        scene.add(plane);

        _map3d = { scene, camera, renderer, canvas, cont: mapContainer, mapEl, plane, pfx: null, running: true, raf: 0, _onResize: null };

        const imgUrl = getMapImageUrl(mapEl);
        if (imgUrl) {
            new THREE.TextureLoader().load(
                imgUrl,
                (tex) => {
                    if (!_map3d || _map3d.mapEl !== mapEl) return; // tela trocada antes de a imagem terminar de carregar
                    // flipY = false: compensa o flip de eixo Y da câmera
                    // (applyCameraFrustum usa top=0/bottom=h de propósito,
                    // pra bater com o Y "pra baixo" do CSS). Sem isso, o
                    // flipY=true padrão do Three.js some com o flip da
                    // câmera e a imagem aparece de cabeça pra baixo.
                    tex.flipY = false;
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    material.map = tex;
                    material.color.set(0xffffff);
                    material.needsUpdate = true;
                    // Só esconde o background CSS depois que a textura do
                    // plane 3D está garantidamente pronta pra substitui-lo.
                    mapEl.classList.add('mapsky-hide-bg');
                },
                undefined,
                (err) => console.error('[MapSkybox] Falha ao carregar a imagem do mapa (mantendo o background CSS original):', err)
            );
        } else {
            console.warn('[MapSkybox] Não encontrei background-image em #mapImage — mantendo o mapa como estava (sem o plane 3D).');
        }

        // ── Pós-processamento SÓ PARA O MAPA ─────────────────────────────
        // domLayer e motionBlur ficam DESLIGADOS aqui de propósito:
        // map_effects.js já aplica o grading (contrast/saturate) e a
        // vinheta na camada DOM (#mapImage e seus filhos) chamando
        // applyDomLayer diretamente — deixar ligado aqui também duplicaria
        // a vinheta (duas divs .pfx-vignette empilhadas) e entraria em
        // disputa por cima de quem escreve mapEl.style.filter a cada frame.
        // O bloom/colorGrade abaixo afeta só a ARTE do mapa (o canvas), via
        // shader — a camada DOM continua sendo responsabilidade exclusiva
        // do map_effects.js, sem mudar nada lá.
        postfx.POSTFX_CONFIG.bloom.strength = MAP_BLOOM_STRENGTH;
        postfx.POSTFX_CONFIG.bloom.radius = MAP_BLOOM_RADIUS;
        postfx.POSTFX_CONFIG.bloom.threshold = MAP_BLOOM_THRESHOLD;
        postfx.POSTFX_CONFIG.colorGrade.contrast = MAP_CONTRAST;
        postfx.POSTFX_CONFIG.colorGrade.saturation = MAP_SATURATION;
        postfx.POSTFX_CONFIG.domLayer.enabled = false;
        postfx.POSTFX_CONFIG.motionBlur.enabled = false;

        try {
            _map3d.pfx = postfx.initPostFX({ scene, camera, renderer, cont: mapContainer });
        } catch (e) {
            console.error('[MapSkybox] Falha ao iniciar pós-processamento, usando renderização padrão:', e);
            _map3d.pfx = null;
        }

        applyCameraFrustum(camera, w, h);

        function onResize() {
            if (!_map3d) return;
            const nw = mapContainer.clientWidth, nh = Math.max(mapContainer.clientHeight, 1);
            applyCameraFrustum(_map3d.camera, nw, nh);
            _map3d.renderer.setSize(nw, nh);
            if (_map3d.pfx) {
                try { _map3d.pfx.resize(nw, nh); } catch (e) { console.error('[MapSkybox] Erro no resize:', e); }
            }
        }
        _map3d._onResize = onResize;
        window.addEventListener('resize', onResize);

        _map3d.raf = requestAnimationFrame(loop);
    }

    function stopMapSkybox() {
        if (!_map3d) return;
        _map3d.running = false;
        if (_map3d.raf) cancelAnimationFrame(_map3d.raf);
        if (_map3d._onResize) window.removeEventListener('resize', _map3d._onResize);

        try {
            _map3d.scene.traverse((obj) => {
                if (obj.material) {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                }
                if (obj.geometry) obj.geometry.dispose();
            });
            _map3d.renderer.dispose();
        } catch (e) {
            console.error('[MapSkybox] Erro ao liberar recursos do mapa 3D:', e);
        }

        const layer = document.getElementById('mapSkyboxLayer');
        if (layer) layer.remove();

        _map3d = null;
    }

    // ── Hook: mesma técnica de map_effects.js/map_hotspots.js — o mapa
    // inteiro (#mapContainer/#mapImage) é reconstruído do zero a cada
    // renderPlayerUI(), então a gente também refaz o plane 3D nesse
    // momento. O atraso (350ms) é de propósito MAIOR que o do
    // map_effects.js (200ms), pra rodar depois dele — assim o grading que
    // a gente copia (MAP_CONTRAST/MAP_SATURATION) sempre bate com o que ele
    // acabou de aplicar na camada DOM, mesmo eles compartilhando o mesmo
    // POSTFX_CONFIG (ver comentário grande no topo do arquivo). ──────────
    function hookRender() {
        if (typeof window.renderPlayerUI !== 'function') {
            setTimeout(hookRender, 100);
            return;
        }
        const orig = window.renderPlayerUI;
        window.renderPlayerUI = function (player, preserve) {
            orig.call(this, player, preserve);
            setTimeout(() => {
                stopMapSkybox();
                startMapSkybox();
            }, 350);
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hookRender);
    } else {
        hookRender();
    }

})();
