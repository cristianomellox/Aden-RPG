(function () {
    'use strict';

    /* ─── ASSETS ─────────────────────────────────────────────────────── */
    var CLOUD_1 = 'https://aden-rpg.pages.dev/assets/cloud1.webp';
    var CLOUD_2 = 'https://aden-rpg.pages.dev/assets/ncloud2.webp';
    var CLOUD_3 = 'https://aden-rpg.pages.dev/assets/cloud3.webp';

    /* ─── NUVENS ─────────────────────────────────────────────────────── */
    var CLOUDS = [
        { src: CLOUD_1, top: '2%',  size: '800px', dur: 155, delay:   0, op: 0.35 },
        { src: CLOUD_2, top: '18%', size: '880px', dur: 180, delay: -20, op: 0.35 },
        { src: CLOUD_3, top: '42%', size: '800px', dur: 145, delay: -40, op: 0.35 },
        { src: CLOUD_1, top: '65%', size: '720px', dur: 195, delay: -10, op: 0.35 },
       
    ];

    /* ─── CSS ─────────────────────────────────────────────────────────── */
    function injectCSS() {
        if (document.getElementById('mfx-css')) return;
        var css = `
            #mfx-layer {
                position: absolute;
                inset: 0;
                pointer-events: none;
                overflow: hidden;
                z-index: 15;
                contain: layout paint style;
            }
            .mfx-cloud {
                position: absolute;
                left: -750px;
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                will-change: transform;
                z-index: 2;
            }
            @keyframes mfx-float-cloud {
                from { transform: translateX(0); }
                to   { transform: translateX(2700px); }
            }
        `;
        var s = document.createElement('style');
        s.id = 'mfx-css';
        s.textContent = css;
        document.head.appendChild(s);
    }

    /* ─── Monta a camada de nuvens (o antigo efeito de sol/raios foi ────
       removido daqui — não ficou bom. No lugar, o mapa agora recebe o
       mesmo pós-processamento (bloom/grading/vinheta) usado no skybox da
       tela de login, aplicado via postfx.js — ver applyShaderGrading). ── */
    function buildLayer(mapImage) {
        var layer = document.createElement('div');
        layer.id = 'mfx-layer';

        CLOUDS.forEach(function (c) {
            var el = document.createElement('div');
            el.className = 'mfx-cloud';
            el.style.backgroundImage = 'url("' + c.src + '")';
            el.style.top     = c.top;
            el.style.width   = c.size;
            el.style.height  = c.size;
            el.style.opacity = c.op;
            el.style.animation =
                'mfx-float-cloud ' + c.dur + 's linear infinite ' + c.delay + 's';
            layer.appendChild(el);
        });

        mapImage.appendChild(layer);
        console.log('[mfx] v5 — sol/raios removidos, grading via postfx.js');
    }

    /* ─── Grading "AAA" (bloom/contraste/saturação/vinheta) ──────────────
       Reaproveita a MESMA camada de pós-processamento usada no skybox da
       tela de login (ver auth_skybox.js): postfx.js expõe applyDomLayer,
       feita justamente pra "espelhar" esse grading em cima de uma camada
       2D comum (sem precisar de uma cena WebGL própria pro mapa, que
       continua sendo um <div> com background-image, arrastável/zoomável
       como sempre foi).
       Import dinâmico porque este arquivo é um script clássico (não
       type="module") — o import() funciona normalmente mesmo assim,
       e resolve "three" através do mesmo <script type="importmap"> já
       presente na página (necessário pro auth_skybox.js). */
    function applyShaderGrading(mapContainer, mapImage) {
        import('./postfx.js').then(function (mod) {
            // Ajuste SÓ PARA ESTA PÁGINA (mesma lógica do auth_skybox.js):
            // o postfx.js continua intocado no arquivo — cada página carrega
            // sua própria cópia do módulo, então subir um pouco o contraste
            // e a saturação aqui não afeta a Floresta Mística nem nenhuma
            // outra tela. Isso realça tanto o sol (tons quentes) quanto o
            // temporal ao fundo (tons azuis) do mapa, sem precisar de bloom
            // real (o mapa é uma imagem 2D comum, sem cena WebGL própria).
            mod.POSTFX_CONFIG.colorGrade.contrast = 1.12;
            mod.POSTFX_CONFIG.colorGrade.saturation = 1.35;
            mod.applyDomLayer(mapContainer, mapImage);
        }).catch(function (e) {
            console.error('[mfx] Falha ao carregar postfx.js para o grading do mapa:', e);
        });
    }

    /* ─── Init & Hook ────────────────────────────────────────────────── */
    function init() {
        var old = document.getElementById('mfx-layer');
        if (old) old.remove();
        var mapContainer = document.getElementById('mapContainer');
        var mapImage = document.getElementById('mapImage');
        if (!mapContainer || !mapImage) { setTimeout(init, 300); return; }
        injectCSS();
        buildLayer(mapImage);
        applyShaderGrading(mapContainer, mapImage);
    }

    function hookRender() {
        if (typeof window.renderPlayerUI !== 'function') {
            setTimeout(hookRender, 100);
            return;
        }
        var orig = window.renderPlayerUI;
        window.renderPlayerUI = function (player, preserve) {
            orig.call(this, player, preserve);
            setTimeout(init, 200);
        };
        setTimeout(init, 200);
    }

    document.addEventListener('visibilitychange', function () {
        var els = document.querySelectorAll('.mfx-cloud');
        var st  = document.hidden ? 'paused' : 'running';
        for (var i = 0; i < els.length; i++) els[i].style.animationPlayState = st;
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hookRender);
    } else {
        hookRender();
    }

})();
