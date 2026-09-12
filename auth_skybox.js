import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { initPostFX } from './postfx.js';

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX 360° DA TELA DE LOGIN (Three.js) ────────────────────────────────
// Substitui o antigo background-image estático do #authContainer por uma
// esfera panorâmica com uma câmera girando sozinha, bem devagar, só no
// eixo horizontal (yaw) — SEM pitch, SEM drag, SEM zoom. O jogador nunca
// controla a câmera aqui; é 100% decorativo.
//
// Reaproveita a MESMA técnica da Floresta Mística:
//   - esfera com normais invertidas (scale.x = -1) servindo de skybox;
//   - postfx.js (bloom + color grade + vinheta) pro visual "AAA";
//   - um sprite billboard (o dragão) com espelhamento via TEXTURA
//     (não via scale, que o THREE.Sprite ignora — ver nota mais abaixo);
//   - tween.js pra animar o voo do dragão suavemente.
//
// DIFERENÇA-CHAVE em relação aos mobs da Floresta: lá, o mob vive preso a
// um ponto FIXO do mundo 3D (gira junto com a câmera). Aqui, queremos que
// o dragão sempre atravesse a TELA da direita pra esquerda, mesmo com a
// câmera girando sozinha por trás. Por isso a posição do dragão a cada
// frame é calculada por "unproject" a partir de uma coordenada de TELA
// (NDC -1..1) usando a câmera atual — ou seja, o caminho do dragão é
// definido em espaço de TELA, não em yaw/pitch do mundo, garantindo que
// ele sempre entra pela direita e sai pela esquerda, não importa em que
// ângulo a câmera esteja no momento.
//
// PERFORMANCE: tudo isso (WebGL, render loop, tween) só existe enquanto a
// tela de login (#authContainer) está de fato visível. Ao logar/sair da
// tela, os recursos são destruídos por completo (renderer.dispose(),
// texturas, geometrias) — nada fica rodando em segundo plano no jogo.
// ═══════════════════════════════════════════════════════════════════════

const SKY_IMAGE_URL    = '/assets/aden_ini_sb.png';
const DRAGON_IMAGE_URL = '/assets/mon_dg_auth.png';

// ── Câmera (gira sozinha, devagar, só no eixo horizontal) ───────────────
const CAM_FOV               = 88;
const CAM_PITCH_DEG         = -3;               // fixo — nunca muda (sem movimento vertical)
const ROTATE_DEG_PER_SEC    = 360 / 150;        // 1 volta completa a cada 150s — bem suave

// ── Dragão (billboard planando pelo céu, sempre da direita pra esquerda) ─
const DRAGON_DISTANCE       = 320;              // distância fixa da câmera (dentro da esfera de raio 500)
const DRAGON_HEIGHT_FRAC    = 0.13;             // fração da altura da tela ocupada pelo dragão
const DRAGON_BASE_NDC_Y     = 0.22;             // um pouco acima do centro da tela (região do céu)
const DRAGON_BOB_AMPL       = 0.018;            // leve ondulação vertical (efeito de planar)
const DRAGON_BOB_FREQ_HZ    = 0.22;
const DRAGON_TILT_AMPL_RAD  = 0.035;            // leve inclinação, como se o vento balançasse o voo
const DRAGON_START_NDC_X    = 1.35;             // nasce fora da tela, à direita
const DRAGON_END_NDC_X      = -1.35;            // morre fora da tela, à esquerda
const DRAGON_FLIGHT_MS      = 16000;            // ~16s pra atravessar a tela inteira, bem devagar
const DRAGON_FIRST_DELAY_MS = 2500;             // primeira aparição, pouco depois do skybox carregar
const DRAGON_PAUSE_MS       = 8000;             // pausa entre um voo e o próximo

let _sky = null;      // { scene, camera, renderer, canvas, cont, renderer, pfx, running, raf, _onResize }
let _dragon = null;   // { sprite, material, ndcX, flightStartTs, tween, pauseTimeout }
let _camYaw = 0;
let _lastTs = 0;

const _dragonTexCache = { base: null, flipped: null };

// Converte yaw/pitch (graus) num vetor direção unitário — mesma convenção
// usada na Floresta Mística (yaw=0,pitch=0 aponta pra +Z).
function yawPitchToVector(yawDeg, pitchDeg, radius = 1) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    return new THREE.Vector3(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(yaw) * Math.cos(pitch)
    );
}

function updateCameraLook() {
    if (!_sky) return;
    const dir = yawPitchToVector(_camYaw, CAM_PITCH_DEG, 1);
    _sky.camera.lookAt(dir.x, dir.y, dir.z);
}

// ── DOM: cria a camada do skybox como PRIMEIRO filho de #authContainer ──
// z-index -1 garante que ela fica ATRÁS de todo o conteúdo de login
// (botões, textos, rodapé) sem precisar mexer no z-index de mais nada —
// um elemento posicionado com z-index negativo sempre renderiza atrás do
// conteúdo "normal" do seu contexto de empilhamento, mas na FRENTE do
// próprio background-image do #authContainer (que fica como fallback
// visível só até a textura do skybox terminar de carregar).
function injectCSS() {
    if (document.getElementById('authsky-css')) return;
    const css = `
        #authSkyboxLayer {
            position: absolute;
            inset: 0;
            overflow: hidden;
            z-index: -1;
            pointer-events: none;
            background: #0d1a0d;
        }
        #authSkyboxCanvas {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: block;
        }
    `;
    const s = document.createElement('style');
    s.id = 'authsky-css';
    s.textContent = css;
    document.head.appendChild(s);
}

function buildDom() {
    let layer = document.getElementById('authSkyboxLayer');
    if (layer) return layer;
    const authContainer = document.getElementById('authContainer');
    if (!authContainer) return null;
    injectCSS();
    layer = document.createElement('div');
    layer.id = 'authSkyboxLayer';
    const canvas = document.createElement('canvas');
    canvas.id = 'authSkyboxCanvas';
    layer.appendChild(canvas);
    authContainer.insertBefore(layer, authContainer.firstChild);
    return layer;
}

// ═══════════════════════════════════════════════════════════════════════
// DRAGÃO — sprite billboard com espelhamento por textura
// ═══════════════════════════════════════════════════════════════════════
// IMPORTANTE (mesma observação da Floresta Mística): THREE.Sprite ignora
// o SINAL da escala (sprite.scale.x = -1 não espelha nada). O espelhamento
// precisa ser feito trocando a textura por uma cópia com repeat.x = -1.
// Aqui o dragão SEMPRE voa da direita pra esquerda, então a lógica geral é:
// voando para a DIREITA → textura original; voando para a ESQUERDA →
// textura espelhada. Como só existe o voo pra esquerda, usamos sempre a
// versão espelhada — mas a função abaixo fica genérica de propósito, caso
// no futuro se queira alternar a direção do voo.
function getDragonTexture(flip) {
    if (flip) return _dragonTexCache.flipped;
    return _dragonTexCache.base;
}

function loadDragonTextures(onReady) {
    if (_dragonTexCache.base) { onReady(); return; }
    new THREE.TextureLoader().load(
        DRAGON_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            _dragonTexCache.base = tex;

            const flipped = tex.clone();
            flipped.wrapS = THREE.RepeatWrapping;
            flipped.repeat.x = -1;
            flipped.offset.x = 1;
            flipped.needsUpdate = true;
            _dragonTexCache.flipped = flipped;

            onReady();
        },
        undefined,
        (err) => console.error('[AuthSkybox] Falha ao carregar a textura do dragão:', err)
    );
}

function createDragon() {
    loadDragonTextures(() => {
        if (!_sky) return; // a tela de login já foi fechada antes da imagem terminar de carregar
        const tex = _dragonTexCache.base;
        const aspect = tex.image.width / tex.image.height;
        const fovRad = THREE.MathUtils.degToRad(CAM_FOV);
        const worldHeight = 2 * DRAGON_DISTANCE * Math.tan(fovRad / 2) * DRAGON_HEIGHT_FRAC;
        const worldWidth = worldHeight * aspect;

        const material = new THREE.SpriteMaterial({
            map: getDragonTexture(true), // voando pra esquerda → sempre espelhado (ver nota acima)
            transparent: true,
            depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(worldWidth, worldHeight, 1);
        sprite.renderOrder = 5;
        sprite.visible = false;
        _sky.scene.add(sprite);

        _dragon = {
            sprite,
            material,
            ndcX: DRAGON_START_NDC_X,
            flightStartTs: 0,
            tween: null,
            pauseTimeout: null,
        };

        scheduleDragonFlight(DRAGON_FIRST_DELAY_MS);
    });
}

function scheduleDragonFlight(delayMs) {
    if (!_dragon) return;
    _dragon.pauseTimeout = setTimeout(startDragonFlight, delayMs);
}

function startDragonFlight() {
    if (!_sky || !_sky.running || !_dragon) return;
    _dragon.sprite.visible = true;
    _dragon.ndcX = DRAGON_START_NDC_X;
    _dragon.flightStartTs = performance.now();

    const state = { x: DRAGON_START_NDC_X };
    _dragon.tween = new TWEEN.Tween(state)
        .to({ x: DRAGON_END_NDC_X }, DRAGON_FLIGHT_MS)
        // Sinusoidal.InOut: entra e sai de tela suavemente, com um leve
        // "pico" de velocidade no meio do trajeto — planar, não deslizar.
        .easing(TWEEN.Easing.Sinusoidal.InOut)
        .onUpdate(() => { if (_dragon) _dragon.ndcX = state.x; })
        .onComplete(() => {
            if (!_dragon) return;
            _dragon.sprite.visible = false;
            scheduleDragonFlight(DRAGON_PAUSE_MS);
        })
        .start();
}

// Recalcula a posição do dragão a cada frame projetando uma coordenada de
// TELA (NDC) de volta pro mundo 3D através da câmera ATUAL — por isso o
// caminho fica sempre "colado" na tela (direita → esquerda), mesmo com a
// câmera girando sozinha por trás.
const _ndcScratch = new THREE.Vector3();
function updateDragonVisual(ts) {
    if (!_dragon || !_dragon.sprite.visible) return;
    const elapsedSec = (ts - _dragon.flightStartTs) / 1000;
    const bob = Math.sin(elapsedSec * DRAGON_BOB_FREQ_HZ * Math.PI * 2) * DRAGON_BOB_AMPL;

    _ndcScratch.set(_dragon.ndcX, DRAGON_BASE_NDC_Y + bob, 0.5);
    _ndcScratch.unproject(_sky.camera);
    const dir = _ndcScratch.sub(_sky.camera.position).normalize();
    const worldPos = _sky.camera.position.clone().addScaledVector(dir, DRAGON_DISTANCE);

    _dragon.sprite.position.copy(worldPos);
    _dragon.material.rotation = Math.sin(elapsedSec * 2.1) * DRAGON_TILT_AMPL_RAD;
}

// ═══════════════════════════════════════════════════════════════════════
// CICLO DE VIDA — só existe enquanto a tela de login estiver visível
// ═══════════════════════════════════════════════════════════════════════
function loop(ts) {
    if (!_sky || !_sky.running) return;
    const dt = Math.min(ts - _lastTs, 100);
    _lastTs = ts;

    _camYaw += ROTATE_DEG_PER_SEC * (dt / 1000);
    updateCameraLook();
    _sky.camera.updateMatrixWorld(true); // necessário ANTES do unproject do dragão, ver abaixo

    TWEEN.update(ts);
    updateDragonVisual(ts);

    if (_sky.pfx) {
        try {
            _sky.pfx.render(_sky.scene, _sky.camera);
        } catch (e) {
            console.error('[AuthSkybox] Erro ao renderizar com pós-processamento, desativando:', e);
            _sky.pfx = null;
            _sky.renderer.render(_sky.scene, _sky.camera);
        }
    } else {
        _sky.renderer.render(_sky.scene, _sky.camera);
    }

    _sky.raf = requestAnimationFrame(loop);
}

function startAuthSkybox() {
    if (_sky) return; // já rodando
    const cont = buildDom();
    if (!cont) return;
    const canvas = document.getElementById('authSkyboxCanvas');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAM_FOV, cont.clientWidth / Math.max(cont.clientHeight, 1), 0.1, 1000);
    camera.position.set(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cont.clientWidth, cont.clientHeight);

    // Esfera "por dentro" — igual à Floresta Mística.
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x0d1a0d });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    new THREE.TextureLoader().load(
        SKY_IMAGE_URL,
        (tex) => {
            if (!_sky) return; // tela fechada antes de a imagem carregar
            tex.colorSpace = THREE.SRGBColorSpace;
            material.map = tex;
            material.color.set(0xffffff);
            material.needsUpdate = true;
        },
        undefined,
        (err) => console.error('[AuthSkybox] Falha ao carregar a imagem do skybox:', err)
    );

    _camYaw = 0; // sempre reinicia o giro do zero a cada vez que a tela de login aparece
    _sky = { scene, camera, renderer, canvas, cont, running: true, raf: 0, pfx: null, _onResize: null };

    // Pós-processamento (bloom + grading + vinheta) — os mesmos "shaders e
    // etc" já usados na Floresta Mística. Em try/catch: se falhar por
    // qualquer motivo, a tela de login continua funcionando normalmente,
    // só sem o efeito extra.
    try {
        _sky.pfx = initPostFX({ scene, camera, renderer, cont });
    } catch (e) {
        console.error('[AuthSkybox] Falha ao iniciar pós-processamento, usando renderização padrão:', e);
        _sky.pfx = null;
    }

    updateCameraLook();
    camera.updateMatrixWorld(true);

    function onResize() {
        if (!_sky) return;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / Math.max(h, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (_sky.pfx) {
            try { _sky.pfx.resize(w, h); } catch (e) { console.error('[AuthSkybox] Erro no resize:', e); }
        }
    }
    _sky._onResize = onResize;
    window.addEventListener('resize', onResize);

    createDragon();

    _lastTs = performance.now();
    _sky.raf = requestAnimationFrame(loop);
}

function stopAuthSkybox() {
    if (!_sky) return;
    _sky.running = false;
    if (_sky.raf) cancelAnimationFrame(_sky.raf);
    if (_sky._onResize) window.removeEventListener('resize', _sky._onResize);

    if (_dragon) {
        if (_dragon.pauseTimeout) clearTimeout(_dragon.pauseTimeout);
        if (_dragon.tween) _dragon.tween.stop();
    }

    try {
        _sky.scene.traverse((obj) => {
            if (obj.material) {
                if (obj.material.map) obj.material.map.dispose();
                obj.material.dispose();
            }
            if (obj.geometry) obj.geometry.dispose();
        });
        _sky.renderer.dispose();
    } catch (e) {
        console.error('[AuthSkybox] Erro ao liberar recursos do skybox:', e);
    }

    const layer = document.getElementById('authSkyboxLayer');
    if (layer) layer.remove();

    _dragonTexCache.base = null;
    _dragonTexCache.flipped = null;
    _dragon = null;
    _sky = null;
}

// ── Controle de visibilidade: só roda com a tela de login visível ───────
// Dois gatilhos combinados, pra nunca pesar no dispositivo do jogador:
//   1) #authContainer sai/entra de "display:none" (login concluído/aberto);
//   2) a ABA/JANELA fica oculta (visibilitychange do navegador).
function isAuthScreenVisible() {
    const el = document.getElementById('authContainer');
    return !!el && window.getComputedStyle(el).display !== 'none';
}

function evaluateVisibility() {
    const shouldRun = isAuthScreenVisible() && !document.hidden;
    if (shouldRun && !_sky) startAuthSkybox();
    else if (!shouldRun && _sky) stopAuthSkybox();
}

function attachVisibilityWatcher() {
    const el = document.getElementById('authContainer');
    if (!el) { setTimeout(attachVisibilityWatcher, 300); return; }
    const observer = new MutationObserver(evaluateVisibility);
    observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    document.addEventListener('visibilitychange', evaluateVisibility);
    evaluateVisibility();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachVisibilityWatcher);
} else {
    attachVisibilityWatcher();
}
