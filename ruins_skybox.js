import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX 360° DAS RUÍNAS ANCESTRAIS ────────────────────────────────────
// Esfera panorâmica (ruinas_anc.png) em TELA CHEIA atrás de toda a UI da
// partida (#gameScreen): HUD, sala/combate e botões ficam por cima.
//
// ANTES DO COLAPSO: céu PARADO num yaw fixo (FROZEN_YAW_DEG). Névoa,
//   partículas, bloom, aberração, vinheta e grão continuam rodando.
//
// COLAPSO (getCollapse() → true): o céu passa a GIRAR e a atmosfera vira
//   "destruição iminente", com os mesmos efeitos do andar de chefe da raid,
//   mas em VERMELHO/BRASA em vez de roxo:
//   • color grading split-tone (sombras vermelho-sangue, realces brasa)
//   • vinheta vermelha pesada + BATIMENTO de perigo (substitui o antigo
//     #collapseOverlay/redPulse do CSS)
//   • névoa volumétrica de fogo/fumaça presa ao mundo
//   • brasas subindo, clarões vermelhos raros e tremor de câmera
//   • bloom mais intenso e FOV levemente fechado
// A transição é suave (lerp), nunca um corte seco.
//
// Carregado via import() dinâmico a partir do ruins.js (o importmap do
// 'three' fica no <head> do ruins.html). Calibração: ?debugRuinsSky=1
// ═══════════════════════════════════════════════════════════════════════

const SKY_IMAGE_URL = '/assets/ruinas_anc.png';

// ── Câmera ────────────────────────────────────────────────────────────
const CAM_FOV              = 100;
const CAM_FOV_COLLAPSE     = 93;
const ROTATE_DEG_PER_SEC   = 360 / 100;   // giro durante o colapso (1 volta a cada 100s)
const COLLAPSE_BLEND_SPEED = 1.6;         // maior = transição calmo↔colapso mais rápida

// Céu parado antes do colapso: direção (graus) pra onde a câmera olha.
// Ajuste com ?debugRuinsSky=1 (slider "Céu parado") e copie o valor aqui.
let FROZEN_YAW_DEG = 0;
const FROZEN_EASE_SPEED  = 2.0;
const FROZEN_MAX_DEG_SEC = 70;
const ROTATE_RAMP_SPEED  = 1.5;   // aceleração do giro ao começar o colapso

// Tremor de câmera durante o colapso (graus). TREMOR = constante; RUMBLE = a cada clarão.
const COLLAPSE_TREMOR_DEG = 0.06;
const COLLAPSE_RUMBLE_DEG = 0.55;

// ── Bloom ─────────────────────────────────────────────────────────────
const BLOOM_CALM     = { strength: 0.58, radius: 0.55, threshold: 0.66 };
const BLOOM_COLLAPSE = { strength: 0.90, radius: 0.72, threshold: 0.50 };

const PARTICLE_COUNT = 260;

let S = null; // estado do módulo (null até initRuinsSkybox)

// Uniforms compartilhados entre grade, névoa e partículas.
// (uBoss = intensidade do COLAPSO, mantido com esse nome pelos shaders.)
const U = {
    uTime:  { value: 0 },
    uBoss:  { value: 0 },   // 0 = calmo, 1 = colapso
    uBoost: { value: 1 },   // efeitos "vivos" antes do colapso (esmaece sozinho no colapso)
    uPulse: { value: 0 },   // 0..1: respiração lenta (calmo) → batimento de perigo (colapso)
    uFlash: { value: 0 },   // clarão vermelho
    uPR:    { value: 1 },
};

// ═══════════════════════════════════════════════════════════════════════
// SHADERS
// ═══════════════════════════════════════════════════════════════════════

const GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: U.uTime, uBoss: U.uBoss, uPulse: U.uPulse, uFlash: U.uFlash, uBoost: U.uBoost,
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uBoss;
        uniform float uPulse;
        uniform float uFlash;
        uniform float uBoost;
        varying vec2 vUv;

        float hash12(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
            vec2 uv = vUv;
            vec2 c  = uv - 0.5;
            float d = length(c) * 1.4142;          // 0 no centro, ~1 nos cantos
            float cb = uBoost * (1.0 - uBoss);     // intensidade extra (só andar normal em combate)

            // Aberração cromática radial: centro limpo, bordas levemente separadas
            float k = 0.012 + 0.018 * uBoss + 0.011 * cb;
            vec2 off = c * dot(c, c) * k * 4.0;
            vec3 col;
            col.r = texture2D(tDiffuse, uv + off).r;
            col.g = texture2D(tDiffuse, uv).g;
            col.b = texture2D(tDiffuse, uv - off).b;

            float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));

            // ── Grade do chefe: penumbra + split-tone roxo ──
            vec3 g = col;
            g = max((g - 0.18) * (1.0 + 0.20 * uBoss + 0.14 * cb) + 0.18, 0.0);          // contraste ao redor do cinza médio
            float sh = 1.0 - smoothstep(0.0, 0.5, lum);
            g += vec3(0.55, 0.06, 0.03) * 0.13 * sh * uBoss;                  // sombras → vermelho-sangue
            g *= mix(vec3(1.0), vec3(1.28, 0.82, 0.62), 0.42 * uBoss * smoothstep(0.2, 1.0, lum)); // realces → laranja-brasa
            float l2 = dot(g, vec3(0.2126, 0.7152, 0.0722));
            g = mix(vec3(l2), g, 1.0 - 0.28 * uBoss);                         // dessatura um pouco...
            g = mix(g, g * vec3(1.22, 0.60, 0.48), 0.60 * uBoss);             // ...e tinge de vermelho
            g *= mix(1.0, 0.72 + 0.16 * uPulse, uBoss);                       // batimento de perigo (substitui o antigo redPulse)
            g += vec3(0.60, 0.05, 0.02) * uPulse * uBoss * 0.14 * (0.35 + d);   // pulso vermelho, mais forte nas bordas

            // Combate em andar normal: sombras azul-violeta + realces frios + leve pulso
            g += vec3(0.10, 0.12, 0.26) * 0.14 * sh * cb;
            g *= mix(vec3(1.0), vec3(0.93, 0.98, 1.14), 0.40 * cb * smoothstep(0.2, 1.0, lum));
            g *= 1.0 + 0.05 * uPulse * cb;

            // Brilho ominoso vindo de baixo
            float under = pow(clamp(1.0 - uv.y, 0.0, 1.0), 3.0);
            g += vec3(0.65, 0.11, 0.03) * uBoss * (0.12 + 0.08 * uPulse) * under;   // fogo/brasa vindo de baixo

            // Relâmpago violeta (discreto)
            g += vec3(0.70, 0.14, 0.05) * uFlash * uBoss * (1.0 - 0.55 * d);

            // Escurecimento vertical p/ legibilidade do HUD (topo mais, base menos)
            float a = mix(0.08, 0.34, uv.y);
            g *= pow(1.0 - a, 2.2);

            // Vinheta (vermelho escuro no colapso, quase preta antes dele)
            float vig = smoothstep(0.38, 1.05, d);
            float vs  = mix(0.38, 0.80, uBoss) + 0.14 * uPulse * uBoss + 0.14 * cb;
            vec3 edge = mix(vec3(0.004, 0.003, 0.006), vec3(0.075, 0.006, 0.004), uBoss);
            g = mix(g, edge, clamp(vig * vs, 0.0, 1.0));

            // Grão de filme (quebra o banding dos gradientes escuros)
            float n = hash12(uv * 1200.0 + fract(uTime) * 91.7) - 0.5;
            g += n * (0.014 + 0.008 * cb);

            gl_FragColor = vec4(max(g, 0.0), 1.0);
        }
    `,
};

// Névoa volumétrica procedural, presa ao mundo (acompanha o giro do céu).
const FOG_VERT = /* glsl */`
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const FOG_FRAG = /* glsl */`
    uniform float uTime;
    uniform float uBoss;
    uniform float uFlash;
    uniform float uBoost;
    varying vec3 vDir;

    float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
    }
    float vnoise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash13(i),                  hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
            mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
            f.z);
    }
    float fbm(vec3 p) {
        float a = 0.5;
        float s = 0.0;
        for (int i = 0; i < 4; i++) {
            s += a * vnoise(p);
            p = p * 2.03 + vec3(1.7, 9.2, 3.1);
            a *= 0.5;
        }
        return s;
    }

    void main() {
        vec3 d = normalize(vDir);
        vec3 p = d * 2.4 + vec3(0.0, -uTime * 0.035, uTime * 0.02);  // deriva lenta, subindo

        float w = fbm(p * 0.9 + uTime * 0.015);   // domain warp: dá o aspecto "fumaça", não nuvem
        float n = fbm(p * 1.6 + w * 1.5);

        // Mais densa perto do horizonte e abaixo; rarefeita no alto
        float cb = uBoost * (1.0 - uBoss);
        float mask = smoothstep(0.80 + 0.30 * cb, -0.30, d.y);
        float dens = smoothstep(0.36 - 0.07 * cb, 0.86, n) * mask;

        vec3 calm = mix(vec3(0.10, 0.12, 0.18), vec3(0.26, 0.31, 0.52), cb);   // bruma fria (mais viva em combate)
        vec3 deep = vec3(0.46, 0.04, 0.02);
        vec3 glow = vec3(1.00, 0.36, 0.08);
        vec3 boss = mix(deep, glow, smoothstep(0.50, 0.95, n));
        vec3 col  = mix(calm, boss, uBoss);
        col += vec3(0.55, 0.12, 0.04) * uFlash * uBoss;

        float alpha = dens * (0.10 + 0.50 * uBoss + 0.36 * cb);
        gl_FragColor = vec4(col, alpha);   // AdditiveBlending → col * alpha
    }
`;

const PARTICLE_VERT = /* glsl */`
    attribute float aSeed;
    attribute float aSize;
    uniform float uTime;
    uniform float uPR;
    uniform float uBoost;
    uniform float uBoss;
    varying float vAlpha;
    void main() {
        vec3 p = position;
        float life = fract(uTime * 0.018 * (0.5 + aSeed) + aSeed * 7.0);   // 0→1, sobe e recomeça
        p.y += (life - 0.5) * 140.0;
        p.x += sin(uTime * 0.30 + aSeed * 30.0) * 7.0;
        p.z += cos(uTime * 0.27 + aSeed * 21.0) * 7.0;
        vAlpha = sin(life * 3.14159) * (0.65 + 0.35 * sin(uTime * 1.8 + aSeed * 40.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float cb = uBoost * (1.0 - uBoss);
        gl_PointSize = clamp(aSize * (1.0 + 0.45 * cb) * uPR * (260.0 / -mv.z), 1.0, 44.0);
        gl_Position = projectionMatrix * mv;
    }
`;
const PARTICLE_FRAG = /* glsl */`
    uniform float uBoss;
    uniform float uBoost;
    varying float vAlpha;
    void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r);
        a *= a;
        vec3 dust = vec3(0.85, 0.80, 0.70);
        vec3 mote = vec3(1.00, 0.46, 0.12);   // brasas/fagulhas
        vec3 col  = mix(dust, mote, uBoss);
        gl_FragColor = vec4(col, a * vAlpha * (0.22 + 0.55 * uBoss + 0.38 * uBoost * (1.0 - uBoss)));
    }
`;

// ═══════════════════════════════════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════════════════════════════════
function injectCSS() {
    if (document.getElementById('ruinssky-css')) return;
    const s = document.createElement('style');
    s.id = 'ruinssky-css';
    // z-index:-1 dentro do stacking context do #gameScreen (position:absolute + z-index):
    // fica acima do fundo do gameScreen e abaixo de TODO o conteúdo (HUD, sala, botões).
    s.textContent = `
        #ruinsSkyboxLayer {
            position: absolute;
            inset: 0;
            z-index: -1;
            overflow: hidden;
            pointer-events: none;
            background: #07050a;
        }
        #ruinsSkyboxCanvas {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: block;
            opacity: 0;
            transition: opacity 0.9s ease;
        }
        #ruinsSkyboxLayer.is-ready #ruinsSkyboxCanvas { opacity: 1; }
    `;
    document.head.appendChild(s);
}

function buildDom() {
    const host = document.getElementById('gameScreen');
    if (!host) return null;
    let layer = document.getElementById('ruinsSkyboxLayer');
    if (layer) return layer;
    injectCSS();
    layer = document.createElement('div');
    layer.id = 'ruinsSkyboxLayer';
    const canvas = document.createElement('canvas');
    canvas.id = 'ruinsSkyboxCanvas';
    layer.appendChild(canvas);
    host.insertBefore(layer, host.firstChild);
    return layer;
}

// ═══════════════════════════════════════════════════════════════════════
// CENA
// ═══════════════════════════════════════════════════════════════════════
function makeParticles() {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const seed = new Float32Array(PARTICLE_COUNT);
    const size = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const u = Math.random() * 2 - 1;
        const t = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const r = 90 + Math.random() * 230;
        pos[i * 3]     = Math.cos(t) * s * r;
        pos[i * 3 + 1] = u * r * 0.7;
        pos[i * 3 + 2] = Math.sin(t) * s * r;
        seed[i] = Math.random();
        size[i] = 2.0 + Math.random() * 4.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uBoss: U.uBoss, uPR: U.uPR, uBoost: U.uBoost },
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    return pts;
}

export function initRuinsSkybox({ getCollapse } = {}) {
    if (S) return;
    const layer = buildDom();
    if (!layer) return;
    const canvas = layer.querySelector('canvas');

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    } catch (e) {
        console.error('[RuinsSkybox] WebGL indisponível, usando imagem estática:', e);
        layer.style.background = `#07050a url('${SKY_IMAGE_URL}') center / cover no-repeat`;
        return;
    }
    const pr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pr);
    renderer.toneMapping = THREE.NoToneMapping;   // preserva as cores originais da arte
    U.uPR.value = pr;

    const w = Math.max(layer.clientWidth, 1), h = Math.max(layer.clientHeight, 1);
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAM_FOV, w / h, 0.1, 1000);
    camera.position.set(0, 0, 0);

    const skyGeo = new THREE.SphereGeometry(500, 60, 40);
    skyGeo.scale(-1, 1, 1);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x0a0710 });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = 0;
    scene.add(sky);

    const fogMat = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uBoss: U.uBoss, uFlash: U.uFlash, uBoost: U.uBoost },
        vertexShader: FOG_VERT,
        fragmentShader: FOG_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
    });
    const fog = new THREE.Mesh(new THREE.SphereGeometry(480, 48, 32), fogMat);
    fog.renderOrder = 1;
    fog.frustumCulled = false;
    scene.add(fog);

    scene.add(makeParticles());

    S = {
        layer, canvas, renderer, scene, camera, skyMat, fogMat,
        composer: null, bloom: null,
        running: false, raf: 0, last: 0, time: 0,
        yaw: FROZEN_YAW_DEG, rotMul: 0, boss: 0, bossTarget: 0,
        nextFlash: 4, flashQueue: 0, shake: 0,
        simulate: false,   // só o painel de debug usa
        getCollapse: typeof getCollapse === 'function' ? getCollapse : () => false,
        shouldRun: false, ro: null,
    };

    try {
        const composer = new EffectComposer(renderer);
        composer.setPixelRatio(pr);
        composer.setSize(w, h);
        composer.addPass(new RenderPass(scene, camera));
        const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM_CALM.strength, BLOOM_CALM.radius, BLOOM_CALM.threshold);
        composer.addPass(bloom);
        composer.addPass(new ShaderPass(new THREE.ShaderMaterial({
            uniforms: GRADE_SHADER.uniforms,
            vertexShader: GRADE_SHADER.vertexShader,
            fragmentShader: GRADE_SHADER.fragmentShader,
        })));
        composer.addPass(new OutputPass());
        S.composer = composer;
        S.bloom = bloom;
    } catch (e) {
        console.error('[RuinsSkybox] Falha no pós-processamento, seguindo sem ele:', e);
        S.composer = null;
        S.bloom = null;
    }

    new THREE.TextureLoader().load(
        SKY_IMAGE_URL,
        (tex) => {
            if (!S) return;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            skyMat.map = tex;
            skyMat.color.set(0xffffff);
            skyMat.needsUpdate = true;
            layer.classList.add('is-ready');
            console.log('[RuinsSkybox] pronto.');
        },
        undefined,
        (err) => {
            console.error('[RuinsSkybox] Falha ao carregar ruinas_anc.png — usando imagem estática:', err);
            layer.style.background = `#07050a url('${SKY_IMAGE_URL}') center / cover no-repeat`;
        }
    );

    // #gameScreen fica display:none no lobby (tamanho 0): o ResizeObserver
    // liga/desliga o loop sozinho, sem precisar de hook de mostrar/esconder.
    S.ro = new ResizeObserver(() => resize());
    S.ro.observe(layer);

    document.addEventListener('visibilitychange', () => {
        if (!S || !S.shouldRun) return;
        if (document.hidden) stopLoop(); else startLoop();
    });

    initDebug();
}

function resize() {
    if (!S) return;
    const w = S.layer.clientWidth, h = S.layer.clientHeight;
    if (w < 2 || h < 2) { stopLoop(); return; }
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h, false);
    if (S.composer) S.composer.setSize(w, h);
    if (S.shouldRun && !document.hidden) startLoop();
}

// ═══════════════════════════════════════════════════════════════════════
// LOOP
// ═══════════════════════════════════════════════════════════════════════
function lookAt(yawDeg, pitchDeg) {
    const y = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(pitchDeg);
    S.camera.lookAt(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
}

function angDiff(a, b) {   // menor diferença angular b - a, em (-180, 180]
    return ((b - a + 540) % 360) - 180;
}

function frame(ts) {
    if (!S || !S.running) return;
    const dt = Math.min((ts - S.last) / 1000, 0.1);
    S.last = ts;
    S.time += dt;

    const collapsing = S.simulate || !!S.getCollapse();

    // Rotação: gira (com rampa) no colapso; senão assenta suavemente no yaw fixo
    const rotTarget = collapsing ? 1 : 0;
    S.rotMul += (rotTarget - S.rotMul) * (1 - Math.exp(-dt * ROTATE_RAMP_SPEED));
    if (Math.abs(rotTarget - S.rotMul) < 0.002) S.rotMul = rotTarget;
    S.yaw += ROTATE_DEG_PER_SEC * S.rotMul * dt;
    if (S.rotMul < 1) {
        const diff = angDiff(S.yaw, FROZEN_YAW_DEG);
        let step = diff * (1 - Math.exp(-dt * FROZEN_EASE_SPEED));
        const lim = FROZEN_MAX_DEG_SEC * dt;
        step = Math.max(-lim, Math.min(lim, step)) * (1 - S.rotMul);
        S.yaw += step;
    }
    S.yaw = ((S.yaw % 360) + 360) % 360;

    // Calmo ↔ colapso (suave)
    S.bossTarget = collapsing ? 1 : 0;
    S.boss += (S.bossTarget - S.boss) * (1 - Math.exp(-dt * COLLAPSE_BLEND_SPEED));
    if (Math.abs(S.bossTarget - S.boss) < 0.002) S.boss = S.bossTarget;
    const b = S.boss;

    U.uTime.value = S.time;
    U.uBoss.value = b;

    // Pulso: respiração lenta (calmo) → BATIMENTO duplo de perigo (colapso).
    // Substitui o antigo redPulse do CSS.
    const calmPulse = 0.5 + 0.5 * Math.sin(S.time * 1.1);
    const ph = S.time * 2.6;
    const beat = Math.min(1, Math.pow(Math.max(0, Math.sin(ph)), 8) + 0.6 * Math.pow(Math.max(0, Math.sin(ph - 0.9)), 8));
    U.uPulse.value = calmPulse + (beat - calmPulse) * b;

    // Clarão vermelho: raro, curto, com um "retorno" mais fraco — acompanha um estrondo (tremor)
    if (b > 0.6 && S.time >= S.nextFlash) {
        U.uFlash.value = 1;
        S.flashQueue = S.time + 0.16;
        S.nextFlash = S.time + 3.5 + Math.random() * 5.5;
        S.shake = 1;
    }
    if (S.flashQueue && S.time >= S.flashQueue) {
        U.uFlash.value = Math.max(U.uFlash.value, 0.6);
        S.flashQueue = 0;
    }
    U.uFlash.value *= Math.exp(-dt * 6);
    if (U.uFlash.value < 0.002) U.uFlash.value = 0;

    // Tremor de câmera (constante e leve + estrondos nos clarões)
    S.shake *= Math.exp(-dt * 3.5);
    if (S.shake < 0.002) S.shake = 0;
    const amp = COLLAPSE_TREMOR_DEG * b + COLLAPSE_RUMBLE_DEG * S.shake;
    lookAt(S.yaw + Math.sin(S.time * 47) * amp, Math.cos(S.time * 53) * amp);

    // FOV levemente fechado + bloom mais forte
    const fov = CAM_FOV + (CAM_FOV_COLLAPSE - CAM_FOV) * b;
    if (Math.abs(S.camera.fov - fov) > 0.01) { S.camera.fov = fov; S.camera.updateProjectionMatrix(); }
    if (S.bloom) {
        S.bloom.strength  = BLOOM_CALM.strength  + (BLOOM_COLLAPSE.strength  - BLOOM_CALM.strength)  * b;
        S.bloom.radius    = BLOOM_CALM.radius    + (BLOOM_COLLAPSE.radius    - BLOOM_CALM.radius)    * b;
        S.bloom.threshold = BLOOM_CALM.threshold + (BLOOM_COLLAPSE.threshold - BLOOM_CALM.threshold) * b;
    }

    S.camera.updateMatrixWorld(true);

    if (S.composer) {
        try {
            S.composer.render(dt);
        } catch (e) {
            console.error('[RuinsSkybox] Erro no pós-processamento, desativando:', e);
            S.composer = null;
            S.renderer.render(S.scene, S.camera);
        }
    } else {
        S.renderer.render(S.scene, S.camera);
    }

    S.raf = requestAnimationFrame(frame);
}

function startLoop() {
    if (!S || S.running) return;
    if (S.layer.clientWidth < 2) return;   // tela de jogo ainda escondida
    S.running = true;
    S.last = performance.now();
    S.raf = requestAnimationFrame(frame);
}

function stopLoop() {
    if (!S) return;
    S.running = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
}

// ── API pública ──────────────────────────────────────────────────────
export function showRuinsSkybox() {
    if (!S) return;
    const first = !S.shouldRun;
    S.shouldRun = true;
    resize();
    if (first) {
        // nasce direto no estado certo (ex.: entrou na partida já em colapso)
        const collapsing = S.simulate || !!S.getCollapse();
        S.boss = S.bossTarget = collapsing ? 1 : 0;
        S.rotMul = collapsing ? 1 : 0;
        if (!collapsing) S.yaw = FROZEN_YAW_DEG;
        U.uFlash.value = 0;
        S.nextFlash = S.time + 3 + Math.random() * 4;
    }
    if (!document.hidden) startLoop();
}

export function hideRuinsSkybox() {
    if (!S) return;
    S.shouldRun = false;
    stopLoop();
}

export function setFrozenYaw(deg) {
    FROZEN_YAW_DEG = ((Number(deg) % 360) + 360) % 360;
}

// ── Painel de calibração: abra a página com ?debugRuinsSky=1 ──────────
function initDebug() {
    let on = false;
    try { on = new URLSearchParams(location.search).get('debugRuinsSky') === '1'; } catch {}
    if (!on || document.getElementById('ruinsSkyDebug')) return;
    const box = document.createElement('div');
    box.id = 'ruinsSkyDebug';
    box.style.cssText = 'position:fixed;left:6px;top:60px;z-index:30000;background:rgba(0,0,0,.78);color:#fff;font:11px/1.3 monospace;padding:8px;border-radius:8px;width:200px;';
    const lab = document.createElement('div');
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = 0; inp.max = 359; inp.step = 1; inp.value = FROZEN_YAW_DEG;
    inp.style.width = '100%';
    const out = document.createElement('div');
    out.style.cssText = 'margin-top:4px;color:#9f9;user-select:all;';
    const upd = () => { lab.textContent = `Céu parado: ${FROZEN_YAW_DEG}°`; out.textContent = `let FROZEN_YAW_DEG = ${FROZEN_YAW_DEG};`; };
    inp.addEventListener('input', () => { setFrozenYaw(parseFloat(inp.value)); upd(); });
    const row = document.createElement('label');
    row.style.cssText = 'display:block;margin-top:6px;';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.addEventListener('change', () => { if (S) S.simulate = chk.checked; });
    row.append(chk, ' simular colapso');
    upd();
    box.append(lab, inp, out, row);
    document.body.appendChild(box);
}

window.RuinsSkybox = { init: initRuinsSkybox, show: showRuinsSkybox, hide: hideRuinsSkybox, setFrozenYaw };
