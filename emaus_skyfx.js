// ═══════════════════════════════════════════════════════════════════════
// EMAÚS — HALO CELESTIAL DA LOGO (three.js + tween.js)
// Só o halo da logo (raios, anel e cometa de luz), tirado do skyfx das cifras. Sem holofotes, poeira,
// véu ou estrelas: o céu fica apenas com o pós-processamento do postfx.js.
// Desenhado POR CIMA do panorama, no mesmo renderer do skybox (sem contexto WebGL próprio).
// Intensidade: CFG.logoHalo (cifras = 1.1; aqui 1.32, um pouco mais forte).
// ═══════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';

const CFG = { logoHalo: 1.32 };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const HALO_FS = `
#define TAU 6.28318530718
uniform float uT, uIn, uA, uVis, uK; uniform vec2 uLog; varying vec2 vUv;
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
    vec2 p = (vUv - .5) * 2.; p.x *= uA;
    vec2 q = p / uLog;                       // 1.0 = borda da elipse da logo
    float e = length(q), a = atan(q.y, q.x);
    float edge = 1. - smoothstep(.70, 1., max(abs(p.x) / uA, abs(p.y)));
    vec3 gold = vec3(1., .80, .40), white = vec3(1., .96, .86), blue = vec3(.55, .72, 1.);
    float glow = exp(-e * e * .55) * .20 + exp(-e * .9) * .16;
    float rays = pow(.5 + .5 * sin(a * 13. + uT * .10 + sin(a * 3. - uT * .07) * 2.), 5.) * .55 + pow(.5 + .5 * sin(a * 29. - uT * .06), 8.) * .25;
    rays *= smoothstep(.55, 1.15, e) * exp(-max(e - 1., 0.) * .85) * .34;
    float ringR = 1.5;
    float ring = exp(-pow((e - ringR) * 9., 2.)) * (.20 + .15 * sin(a * 4. - uT * .5));
    float ph = uT * .45;
    float da = mod(ph - a, TAU);
    float tail = exp(-da * 2.2) * exp(-pow((e - ringR) * 11., 2.));
    vec2 cp = vec2(cos(ph), sin(ph)) * ringR;
    float comet = exp(-dot(q - cp, q - cp) * 160.) * 1.6;
    vec2 P = p * 7.; vec2 id = floor(P); vec2 f = fract(P) - .5; float h = hash21(id);
    vec2 off = (vec2(hash21(id + 7.3), hash21(id + 3.1)) - .5) * .7; vec2 d = f - off;
    float tw = pow(.5 + .5 * sin(uT * (.8 + h * 1.8) + h * 60.), 7.);
    float st = step(.78, h) * tw * (exp(-dot(d, d) * 260.) + (exp(-abs(d.x) * 60.) * exp(-abs(d.y) * 7.) + exp(-abs(d.y) * 60.) * exp(-abs(d.x) * 7.)) * .5);
    st *= smoothstep(.95, 1.35, e);
    vec3 col = gold * glow * .9 + white * glow * .3 + mix(gold, white, .5) * rays + blue * ring * .8 + white * (tail * .5 + comet) + white * st * .9;
    col *= edge * uIn * uVis;
    col = min(col * uK, vec3(1.));
    gl_FragColor = vec4(col * .6, 1.);      // aditivo
}`;

function additive(extra) {
    return Object.assign({
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
    }, extra);
}

export function initSkyFX({ scene, camera, renderer }) {
    // 5) Halo celestial da logo (tela inicial) — desenhado POR CIMA do panorama, no mesmo renderer.
    // Fica atrás de todo o HTML (logo 3D, cards), sem canvas nem contexto WebGL próprios.
    const logoImg = document.querySelector('#home .logo');
    let halo = null;
    if (CFG.logoHalo > 0 && logoImg) {
        const hu = {
            uT: { value: 0 }, uIn: { value: 0 }, uVis: { value: 0 }, uA: { value: 1 }, uK: { value: CFG.logoHalo },
            uLog: { value: new THREE.Vector2(1, 0.4) },
        };
        const hm = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial(additive({
            uniforms: hu,
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: HALO_FS,
        })));
        hm.frustumCulled = false;
        const hs = new THREE.Scene(); hs.add(hm);
        const hc = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
        halo = { u: hu, mesh: hm, scene: hs, cam: hc, vw: 0, vh: 0, vis: 0, was: false, tw: null };
    }
    const haloWanted = () => {
        const c = document.body.classList;
        return c.contains('onhome') && !c.contains('hud-hidden') && !c.contains('needinstall') && !c.contains('needlogin');
    };
    let haloLastT = 0;
    function haloUpdate(t, dt) {
        if (!halo) return;
        if (t - haloLastT > 0.5) { halo.was = false; halo.vis = 0; }     // ficou pausado (outra tela): reacende na volta
        haloLastT = t;
        const want = haloWanted();
        halo.vis += ((want ? 1 : 0) - halo.vis) * Math.min(1, dt * 5);
        if (want && !halo.was) {                               // (re)entrou na tela inicial: "acende" de novo
            if (halo.tw) halo.tw.stop();
            halo.u.uIn.value = 0;
            halo.tw = new TWEEN.Tween(halo.u.uIn).to({ value: 1 }, 2600).easing(TWEEN.Easing.Cubic.Out).start();
        }
        halo.was = want;
        halo.u.uT.value = REDUCED ? 3 : t;
        halo.u.uVis.value = halo.vis;
    }
    function afterRender(r) {
        if (!halo || halo.vis < 0.01) return;
        const b = logoImg.getBoundingClientRect();
        if (!b.width || !b.height) return;
        const el = r.domElement, vw = el.clientWidth || innerWidth, vh = el.clientHeight || innerHeight;
        if (vw !== halo.vw || vh !== halo.vh) {
            halo.vw = vw; halo.vh = vh;
            halo.cam.right = vw; halo.cam.top = vh; halo.cam.updateProjectionMatrix();
        }
        const W = b.width * 1.9, H = b.height * 2.7;
        halo.mesh.scale.set(W, H, 1);
        halo.mesh.position.set(b.left + b.width / 2, vh - (b.top + b.height / 2), 0);
        halo.u.uA.value = W / H;
        halo.u.uLog.value.set(b.width / H, b.height / H);
        const ac = r.autoClear;
        r.setRenderTarget(null);
        r.autoClear = false;
        r.render(halo.scene, halo.cam);
        r.autoClear = ac;
    }
    function update(t, dt) { haloUpdate(t, dt); }
    return {
        update,
        afterRender,
        setVisible(v) { if (halo) halo.vis = v ? halo.vis : 0; },
    };
}
