(function () {
    'use strict';

    /* ─── RAIOS ──────────────────────────────────────────────────────── */
    var RAYS = [
        /*  saída p1        saída p2       opBase  glowOp  dur   begin */
        [ [-8, -8],   [-8,  10],   0.25,   0.18,   5.5,  '0s'   ],  /* R1 — topo  */
        [ [-8,  14],  [-8,  26],   0.25,   0.08,   7.0,  '-1.5s'],  /* gap 1      */
        [ [-8,  30],  [-8,  46],   0.25,   0.20,   6.2,  '-3s'  ],  /* R2 — main  */
        [ [-8,  50],  [-8,  62],   0.28,   0.07,   8.0,  '-0.8s'],  /* gap 2      */
        [ [-8,  65],  [-8,  80],   0.15,   0.18,   5.8,  '-4s'  ],  /* R3         */
        [ [-8,  83],  [-8,  95],   0.27,   0.06,   9.0,  '-2s'  ],  /* gap 3      */
        [ [-8,  98],  [-8, 108],   0.15,   0.15,   6.8,  '-5s'  ],  /* R4 — transição */
        [ [-8, 108],  [22, 108],   0.16,   0.10,   7.5,  '-1s'  ],  /* R5 — base  */
        [ [26, 108],  [48, 108],   0.14,   0.17,   5.2,  '-6s'  ],  /* R6 — brilhante */
        [ [52, 108],  [70, 108],   0.15,   0.07,   8.5,  '-3.5s'],  /* gap 4      */
        [ [74, 108],  [92, 108],   0.17,   0.14,   6.5,  '-2.5s'],  /* R7 — final */
    ];

    /* ─── CSS ─────────────────────────────────────────────────────────── */
    function injectCSS() {
        if (document.getElementById('dfx-css')) return;
        var css = `
            #dfx-rays {
                position: absolute;
                inset: 0;
                z-index: 16;
                pointer-events: none;
                overflow: visible;
            }
        `;
        var s = document.createElement('style');
        s.id = 'dfx-css';
        s.textContent = css;
        document.head.appendChild(s);
    }

    /* ─── Monta o SVG dos God Rays ──────────────────────────────────── */
    function buildRaysSVG() {
        var ns = 'http://www.w3.org/2000/svg';

        var svg = document.createElementNS(ns, 'svg');
        svg.id = 'dfx-rays';
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
        defs.appendChild(makeGrad('dfx-core', '1',   '0.75', '0'));
        /* Glow: halo suave */
        defs.appendChild(makeGrad('dfx-glow', '0.6', '0.25', '0'));

        /* Corona solar */
        var glowDef = document.createElementNS(ns, 'radialGradient');
        glowDef.setAttribute('id', 'dfx-sun');
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
        defs.appendChild(glowDef);

        svg.appendChild(defs);

        var ORIGIN = '108,-10';

        RAYS.forEach(function (r) {
            var p1  = r[0][0] + ',' + r[0][1];
            var p2  = r[1][0] + ',' + r[1][1];
            var pts = ORIGIN + ' ' + p1 + ' ' + p2;

            /* Halo */
            var halo = document.createElementNS(ns, 'polygon');
            halo.setAttribute('points', pts);
            halo.setAttribute('fill', 'url(#dfx-glow)');
            halo.setAttribute('opacity', r[3]);

            var animHalo = document.createElementNS(ns, 'animate');
            animHalo.setAttribute('attributeName', 'opacity');
            animHalo.setAttribute('values', (r[3]*0.4) + ';' + r[3] + ';' + (r[3]*0.4));
            animHalo.setAttribute('dur', r[4] + 's');
            animHalo.setAttribute('begin', r[5]);
            animHalo.setAttribute('repeatCount', 'indefinite');
            animHalo.setAttribute('calcMode', 'spline');
            animHalo.setAttribute('keySplines', '0.4 0 0.6 1; 0.4 0 0.6 1');
            halo.appendChild(animHalo);
            svg.appendChild(halo);

            /* Core */
            var core = document.createElementNS(ns, 'polygon');
            core.setAttribute('points', pts);
            core.setAttribute('fill', 'url(#dfx-core)');
            core.setAttribute('opacity', r[2]);

            var animCore = document.createElementNS(ns, 'animate');
            animCore.setAttribute('attributeName', 'opacity');
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

        /* Corona */
        var sunCircle = document.createElementNS(ns, 'circle');
        sunCircle.setAttribute('cx', '108');
        sunCircle.setAttribute('cy', '-10');
        sunCircle.setAttribute('r', '35');
        sunCircle.setAttribute('fill', 'url(#dfx-sun)');
        sunCircle.setAttribute('opacity', '0.75');

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

    /* ─── Init ───────────────────────────────────────────────────────── */
    function init() {
        /* Remove instância anterior se existir */
        var old = document.getElementById('dfx-rays');
        if (old) old.remove();

        var map = document.getElementById('map');
        if (!map) { setTimeout(init, 300); return; }

        injectCSS();
        map.appendChild(buildRaysSVG());
        console.log('[dfx] god rays desfiladeiro OK');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
