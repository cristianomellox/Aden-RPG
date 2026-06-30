
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


    var RAYS = [
        /*  saída p1        saída p2       opBase  glowOp  dur   begin */
        [ [-8, -8],   [-8,  10],   0.15,   0.18,   5.5,  '0s'   ],  /* R1 — topo  */
        [ [-8,  14],  [-8,  26],   0.15,   0.08,   7.0,  '-1.5s'],  /* gap 1      */
        [ [-8,  30],  [-8,  46],   0.15,   0.20,   6.2,  '-3s'  ],  /* R2 — main  */
        [ [-8,  50],  [-8,  62],   0.18,   0.07,   8.0,  '-0.8s'],  /* gap 2      */
        [ [-8,  65],  [-8,  80],   0.15,   0.18,   5.8,  '-4s'  ],  /* R3         */
        [ [-8,  83],  [-8,  95],   0.17,   0.06,   9.0,  '-2s'  ],  /* gap 3      */
        [ [-8,  98],  [-8, 108],   0.15,   0.15,   6.8,  '-5s'  ],  /* R4 — transição */
        [ [-8, 108],  [22, 108],   0.16,   0.10,   7.5,  '-1s'  ],  /* R5 — base  */
        [ [26, 108],  [48, 108],   0.14,   0.17,   5.2,  '-6s'  ],  /* R6 — brilhante */
        [ [52, 108],  [70, 108],   0.15,   0.07,   8.5,  '-3.5s'],  /* gap 4      */
        [ [74, 108],  [92, 108],   0.17,   0.14,   6.5,  '-2.5s'],  /* R7 — final */
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
            #mfx-rays {
                position: absolute;
                inset: 0;
                z-index: 16;
                pointer-events: none;
                /* overflow visível para os raios que nascem fora do mapa */
                overflow: visible;
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

    /* ─── Monta o SVG dos God Rays ──────────────────────────────────── */
    function buildRaysSVG() {
        var ns = 'http://www.w3.org/2000/svg';

        var svg = document.createElementNS(ns, 'svg');
        svg.id = 'mfx-rays';
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;';


        var defs = document.createElementNS(ns, 'defs');

        function makeGrad(id, op0, op1, op2) {
            var g = document.createElementNS(ns, 'linearGradient');
            g.setAttribute('id', id);
            g.setAttribute('gradientUnits', 'userSpaceOnUse');
            
            g.setAttribute('x1', '100'); g.setAttribute('y1', '-50');
            g.setAttribute('x2', '5');   g.setAttribute('y2', '65');

            [ ['0%', op0], ['30%', op1], ['100%', op2] ].forEach(function(s) {
                var stop = document.createElementNS(ns, 'stop');
                stop.setAttribute('offset', s[0]);
                stop.setAttribute('stop-color', 'white');
                stop.setAttribute('stop-opacity', s[1]);
                g.appendChild(stop);
            });
            return g;
        }

        /* Core: brilho intenso perto da fonte, corte em ~70% */
        defs.appendChild(makeGrad('mfx-core', '1',   '0.75', '0'));
        /* Glow: começa mais fraco, some mais cedo — halo suave */
        defs.appendChild(makeGrad('mfx-glow', '0.6', '0.25', '0'));

        svg.appendChild(defs);

        var ORIGIN = '108,-10';

        RAYS.forEach(function (r) {
            var p1  = r[0][0] + ',' + r[0][1];
            var p2  = r[1][0] + ',' + r[1][1];
            var pts = ORIGIN + ' ' + p1 + ' ' + p2;

            /* — Halo (glow): mais largo, posicionado "por baixo" do core — */
            var halo = document.createElementNS(ns, 'polygon');
            halo.setAttribute('points', pts);
            halo.setAttribute('fill', 'url(#mfx-glow)');
            halo.setAttribute('opacity', r[3]); /* glowOp */

            var animHalo = document.createElementNS(ns, 'animate');
            animHalo.setAttribute('attributeName', 'opacity');
            /* pulsa entre 40% e 100% da opacidade base do halo */
            animHalo.setAttribute('values', (r[3]*0.4) + ';' + r[3] + ';' + (r[3]*0.4));
            animHalo.setAttribute('dur', r[4] + 's');
            animHalo.setAttribute('begin', r[5]);
            animHalo.setAttribute('repeatCount', 'indefinite');
            animHalo.setAttribute('calcMode', 'spline');
            animHalo.setAttribute('keySplines', '0.4 0 0.6 1; 0.4 0 0.6 1');
            halo.appendChild(animHalo);
            svg.appendChild(halo);

            /* — Core (feixe principal): linha nítida de luz — */
            var core = document.createElementNS(ns, 'polygon');
            core.setAttribute('points', pts);
            core.setAttribute('fill', 'url(#mfx-core)');
            core.setAttribute('opacity', r[2]); /* opBase */

            var animCore = document.createElementNS(ns, 'animate');
            animCore.setAttribute('attributeName', 'opacity');
            /* pulsa entre 50% e 110% (permite ultrapassar levemente para dar "flash") */
            var lo = (r[2] * 0.5).toFixed(2);
            var hi = Math.min(r[2] * 1.1, 1.0).toFixed(2);
            animCore.setAttribute('values', lo + ';' + hi + ';' + lo);
            animCore.setAttribute('dur', r[4] + 's');
            animCore.setAttribute('begin', r[5]);
            animCore.setAttribute('repeatCount', 'indefinite');
            animCore.setAttribute('calcMode', 'spline');
            animCore.setAttribute('keySplines', '0.4 0 0.6 1; 0.4 0 0.6 1');
            core.appendChild(animCore);
            svg.appendChild(core);
        });

  
        var glowDef = document.createElementNS(ns, 'radialGradient');
        glowDef.setAttribute('id', 'mfx-sun');
        glowDef.setAttribute('gradientUnits', 'userSpaceOnUse');
        glowDef.setAttribute('cx', '108'); glowDef.setAttribute('cy', '-10');
        glowDef.setAttribute('r', '35');

        [ ['0%','1'], ['40%','0.35'], ['100%','0'] ].forEach(function(s) {
            var stop = document.createElementNS(ns, 'stop');
            stop.setAttribute('offset', s[0]);
            stop.setAttribute('stop-color', 'white');
            stop.setAttribute('stop-opacity', s[1]);
            glowDef.appendChild(stop);
        });
        /* precisa estar nos defs — re-abre e insere */
        defs.appendChild(glowDef);

        var sunCircle = document.createElementNS(ns, 'circle');
        sunCircle.setAttribute('cx', '108');
        sunCircle.setAttribute('cy', '-10');
        sunCircle.setAttribute('r', '35');
        sunCircle.setAttribute('fill', 'url(#mfx-sun)');
        sunCircle.setAttribute('opacity', '0.75');

        /* Corona pulsa suavemente */
        var animSun = document.createElementNS(ns, 'animate');
        animSun.setAttribute('attributeName', 'opacity');
        animSun.setAttribute('values', '0.55;0.75;0.55');
        animSun.setAttribute('dur', '8s');
        animSun.setAttribute('repeatCount', 'indefinite');
        animSun.setAttribute('calcMode', 'spline');
        animSun.setAttribute('keySplines', '0.4 0 0.6 1; 0.4 0 0.6 1');
        sunCircle.appendChild(animSun);
        svg.appendChild(sunCircle);

        return svg;
    }

    /* ─── Monta a camada completa ────────────────────────────────────── */
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

        layer.appendChild(buildRaysSVG());
        mapImage.appendChild(layer);
        console.log('[mfx] v4 — god rays com shimmer SVG + corona solar OK');
    }

    /* ─── Init & Hook ────────────────────────────────────────────────── */
    function init() {
        var old = document.getElementById('mfx-layer');
        if (old) old.remove();
        var mapImage = document.getElementById('mapImage');
        if (!mapImage) { setTimeout(init, 300); return; }
        injectCSS();
        buildLayer(mapImage);
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
        var els = document.querySelectorAll('.mfx-cloud, #mfx-rays');
        var st  = document.hidden ? 'paused' : 'running';
        for (var i = 0; i < els.length; i++) els[i].style.animationPlayState = st;
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hookRender);
    } else {
        hookRender();
    }

})();
