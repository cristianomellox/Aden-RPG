import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX 360° DA RAID DE GUILDA (Torre da Desolação) ───────────────────
// Substitui o antigo background-image estático (tdd_andar.webp) do
// #raidCombatModal por uma esfera panorâmica (tdd_andar.png) que gira
// bem lentamente (só yaw, pitch fixo no horizonte) — mesma técnica do
// skybox do lobby (guild_skybox.js), mas SEM drag: aqui o jogador está
// em combate e o toque é dos botões de ataque.
//
// Pós-processamento próprio (three/addons, sem depender do postfx.js):
//   RenderPass → UnrealBloom → Grade (shader custom) → OutputPass
//
// Grade (todos os andares): aberração cromática radial sutil, vinheta,
//   leve escurecimento vertical (legibilidade do HUD) e grão de filme.
//
// ANDAR DO CHEFE (múltiplo de 5): a atmosfera vira "penumbra roxa" —
//   • color grading split-tone (sombras violeta, realces magenta)
//   • vinheta violeta mais pesada, respirando num pulso lento
//   • névoa volumétrica procedural (fbm 3D com domain-warp) presa ao
//     mundo, então acompanha a rotação do céu
//   • brilho ominoso vindo de baixo
//   • motes/brasas roxas subindo (partículas aditivas)
//   • relâmpagos violeta raros e discretos
//   • bloom mais intenso e FOV levemente fechado (sensação de "peso")
// A transição normal ↔ chefe é suave (lerp), nunca um corte seco.
//
// Carregado via import() dinâmico a partir do guild_raid.js (o importmap
// do guild.html vem depois do <script> da raid — um import estático
// não resolveria o 'three').
// ═══════════════════════════════════════════════════════════════════════

const SKY_IMAGE_URL = '/assets/tdd_andar.png';
const FALLBACK_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/tdd_andar.webp'; // só se WebGL falhar

// ── Câmera ────────────────────────────────────────────────────────────
const CAM_FOV             = 100;
const CAM_FOV_BOSS        = 93;
const ROTATE_DEG_PER_SEC  = 360 / 150;  // mesma rotação lenta do lobby: 1 volta a cada 150s
const BOSS_BLEND_SPEED    = 1.6;        // maior = transição normal↔chefe mais rápida

// ── Bloom (normal → chefe) ───────────────────────────────────────────
const BLOOM_NORMAL = { strength: 0.34, radius: 0.45, threshold: 0.78 };
const BLOOM_BOSS   = { strength: 0.85, radius: 0.70, threshold: 0.52 };

const PARTICLE_COUNT = 260;

let S = null; // estado do módulo (null até initRaidSkybox)

// Uniforms compartilhados entre grade, névoa e partículas.
const U = {
    uTime:  { value: 0 },
    uBoss:  { value: 0 },   // 0 = andar normal, 1 = andar de chefe
    uPulse: { value: 0 },   // 0..1, respiração lenta
    uFlash: { value: 0 },   // relâmpago violeta
    uPR:    { value: 1 },   // pixel ratio (tamanho das partículas)
};

// ═══════════════════════════════════════════════════════════════════════
// SHADERS
// ═══════════════════════════════════════════════════════════════════════

const GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: U.uTime, uBoss: U.uBoss, uPulse: U.uPulse, uFlash: U.uFlash,
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

            // Aberração cromática radial: centro limpo, bordas levemente separadas
            float k = 0.012 + 0.018 * uBoss;
            vec2 off = c * dot(c, c) * k * 4.0;
            vec3 col;
            col.r = texture2D(tDiffuse, uv + off).r;
            col.g = texture2D(tDiffuse, uv).g;
            col.b = texture2D(tDiffuse, uv - off).b;

            float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));

            // ── Grade do chefe: penumbra + split-tone roxo ──
            vec3 g = col;
            g = max((g - 0.18) * (1.0 + 0.20 * uBoss) + 0.18, 0.0);          // contraste ao redor do cinza médio
            float sh = 1.0 - smoothstep(0.0, 0.5, lum);
            g += vec3(0.30, 0.06, 0.55) * 0.12 * sh * uBoss;                  // sombras → violeta
            g *= mix(vec3(1.0), vec3(1.10, 0.80, 1.25), 0.40 * uBoss * smoothstep(0.2, 1.0, lum)); // realces → magenta
            float l2 = dot(g, vec3(0.2126, 0.7152, 0.0722));
            g = mix(vec3(l2), g, 1.0 - 0.28 * uBoss);                         // dessatura um pouco...
            g = mix(g, g * vec3(0.78, 0.52, 1.18), 0.60 * uBoss);             // ...e tinge de violeta
            g *= mix(1.0, 0.70 + 0.07 * uPulse, uBoss);                       // penumbra que respira

            // Brilho ominoso vindo de baixo
            float under = pow(clamp(1.0 - uv.y, 0.0, 1.0), 3.0);
            g += vec3(0.30, 0.07, 0.55) * uBoss * (0.10 + 0.05 * uPulse) * under;

            // Relâmpago violeta (discreto)
            g += vec3(0.34, 0.10, 0.60) * uFlash * uBoss * (1.0 - 0.55 * d);

            // Escurecimento vertical p/ legibilidade do HUD (topo mais, base menos)
            float a = mix(0.08, 0.34, uv.y);
            g *= pow(1.0 - a, 2.2);

            // Vinheta (violeta escuro no chefe, quase preta nos andares normais)
            float vig = smoothstep(0.38, 1.05, d);
            float vs  = mix(0.38, 0.80, uBoss) + 0.06 * uPulse * uBoss;
            vec3 edge = mix(vec3(0.004, 0.003, 0.006), vec3(0.030, 0.005, 0.070), uBoss);
            g = mix(g, edge, clamp(vig * vs, 0.0, 1.0));

            // Grão de filme (quebra o banding dos gradientes escuros)
            float n = hash12(uv * 1200.0 + fract(uTime) * 91.7) - 0.5;
            g += n * 0.014;

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
        float mask = smoothstep(0.80, -0.30, d.y);
        float dens = smoothstep(0.36, 0.86, n) * mask;

        vec3 calm = vec3(0.10, 0.12, 0.18);                   // andares normais: bruma fria quase imperceptível
        vec3 deep = vec3(0.20, 0.035, 0.40);
        vec3 glow = vec3(0.62, 0.24, 0.95);
        vec3 boss = mix(deep, glow, smoothstep(0.50, 0.95, n));
        vec3 col  = mix(calm, boss, uBoss);
        col += vec3(0.25, 0.08, 0.45) * uFlash * uBoss;

        float alpha = dens * (0.10 + 0.50 * uBoss);
        gl_FragColor = vec4(col, alpha);   // AdditiveBlending → col * alpha
    }
`;

const PARTICLE_VERT = /* glsl */`
    attribute float aSeed;
    attribute float aSize;
    uniform float uTime;
    uniform float uPR;
    varying float vAlpha;
    void main() {
        vec3 p = position;
        float life = fract(uTime * 0.018 * (0.5 + aSeed) + aSeed * 7.0);   // 0→1, sobe e recomeça
        p.y += (life - 0.5) * 140.0;
        p.x += sin(uTime * 0.30 + aSeed * 30.0) * 7.0;
        p.z += cos(uTime * 0.27 + aSeed * 21.0) * 7.0;
        vAlpha = sin(life * 3.14159) * (0.65 + 0.35 * sin(uTime * 1.8 + aSeed * 40.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(aSize * uPR * (260.0 / -mv.z), 1.0, 40.0);
        gl_Position = projectionMatrix * mv;
    }
`;
const PARTICLE_FRAG = /* glsl */`
    uniform float uBoss;
    varying float vAlpha;
    void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r);
        a *= a;
        vec3 dust = vec3(0.85, 0.80, 0.70);
        vec3 mote = vec3(0.78, 0.38, 1.00);
        vec3 col  = mix(dust, mote, uBoss);
        gl_FragColor = vec4(col, a * vAlpha * (0.22 + 0.55 * uBoss));
    }
`;

// ═══════════════════════════════════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════════════════════════════════
function injectCSS() {
    if (document.getElementById('raidsky-css')) return;
    const s = document.createElement('style');
    s.id = 'raidsky-css';
    // z-index:-1 dentro do stacking context do #raidCombatModal (position:fixed + z-index):
    // fica acima do fundo do modal e abaixo de TODO o conteúdo (.modal-content etc.).
    s.textContent = `
        #raidSkyboxLayer {
            position: absolute;
            inset: 0;
            z-index: -1;
            overflow: hidden;
            pointer-events: none;
            background: #07050c;
        }
        #raidSkyboxCanvas {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: block;
            opacity: 0;
            transition: opacity 0.9s ease;
        }
        #raidSkyboxLayer.is-ready #raidSkyboxCanvas { opacity: 1; }
    `;
    document.head.appendChild(s);
}

function buildDom() {
    const modal = document.getElementById('raidCombatModal');
    if (!modal) return null;
    let layer = document.getElementById('raidSkyboxLayer');
    if (layer) return layer;
    injectCSS();
    layer = document.createElement('div');
    layer.id = 'raidSkyboxLayer';
    const canvas = document.createElement('canvas');
    canvas.id = 'raidSkyboxCanvas';
    layer.appendChild(canvas);
    modal.insertBefore(layer, modal.firstChild);
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
        // direção uniforme na esfera, raio 90..320
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
        uniforms: { uTime: U.uTime, uBoss: U.uBoss, uPR: U.uPR },
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

export function initRaidSkybox({ getFloor } = {}) {
    if (S) return;
    const layer = buildDom();
    if (!layer) return;
    const canvas = layer.querySelector('canvas');

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    } catch (e) {
        console.error('[RaidSkybox] WebGL indisponível, usando imagem estática:', e);
        layer.style.background = `#07050c url('${FALLBACK_IMAGE_URL}') center / cover no-repeat`;
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

    // Esfera do céu
    const skyGeo = new THREE.SphereGeometry(500, 60, 40);
    skyGeo.scale(-1, 1, 1);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x0a0710 });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = 0;
    scene.add(sky);

    // Esfera de névoa (render por dentro, aditiva)
    const fogMat = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uBoss: U.uBoss, uFlash: U.uFlash },
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
        yaw: Math.random() * 360, boss: 0, bossTarget: 0,
        nextFlash: 8, flashQueue: 0,
        getFloor: typeof getFloor === 'function' ? getFloor : () => 1,
        ro: null,
    };

    // Pós-processamento (best-effort: se falhar, segue só com céu + névoa + partículas)
    try {
        const composer = new EffectComposer(renderer);
        composer.setPixelRatio(pr);
        composer.setSize(w, h);
        composer.addPass(new RenderPass(scene, camera));
        const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM_NORMAL.strength, BLOOM_NORMAL.radius, BLOOM_NORMAL.threshold);
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
        console.error('[RaidSkybox] Falha no pós-processamento, seguindo sem ele:', e);
        S.composer = null;
        S.bloom = null;
    }

    // Textura do céu
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
            console.log('[RaidSkybox] pronto.');
        },
        undefined,
        (err) => {
            console.error('[RaidSkybox] Falha ao carregar tdd_andar.png — usando imagem estática:', err);
            layer.style.background = `#07050c url('${FALLBACK_IMAGE_URL}') center / cover no-repeat`;
        }
    );

    // O modal fica display:none quando fechado (tamanho 0) e muda de tamanho
    // ao entrar/sair do fullscreen — ResizeObserver cobre os dois casos.
    S.ro = new ResizeObserver(() => resize());
    S.ro.observe(layer);

    document.addEventListener('visibilitychange', () => {
        if (!S || !S.shouldRun) return;
        if (document.hidden) stopLoop(); else startLoop();
    });
}

function resize() {
    if (!S) return;
    const w = S.layer.clientWidth, h = S.layer.clientHeight;
    if (w < 2 || h < 2) return;
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h, false);
    if (S.composer) S.composer.setSize(w, h);
}

// ═══════════════════════════════════════════════════════════════════════
// LOOP
// ═══════════════════════════════════════════════════════════════════════
function lookAtYaw() {
    const yaw = THREE.MathUtils.degToRad(S.yaw);
    S.camera.lookAt(Math.sin(yaw), 0, Math.cos(yaw));   // pitch fixo em 0: centralizado verticalmente
}

function frame(ts) {
    if (!S || !S.running) return;
    const dt = Math.min((ts - S.last) / 1000, 0.1);
    S.last = ts;
    S.time += dt;

    // Rotação automática lenta
    S.yaw += ROTATE_DEG_PER_SEC * dt;
    lookAtYaw();

    // Normal ↔ chefe (suave)
    const f = S.getFloor();
    S.bossTarget = (f > 0 && f % 5 === 0) ? 1 : 0;
    S.boss += (S.bossTarget - S.boss) * (1 - Math.exp(-dt * BOSS_BLEND_SPEED));
    if (Math.abs(S.bossTarget - S.boss) < 0.002) S.boss = S.bossTarget;

    const b = S.boss;
    U.uTime.value = S.time;
    U.uBoss.value = b;
    U.uPulse.value = 0.5 + 0.5 * Math.sin(S.time * 1.1);

    // Relâmpago violeta: raro, curto, com um "retorno" mais fraco logo depois
    if (b > 0.6 && S.time >= S.nextFlash) {
        U.uFlash.value = 1;
        S.flashQueue = S.time + 0.16;
        S.nextFlash = S.time + 7 + Math.random() * 9;
    }
    if (S.flashQueue && S.time >= S.flashQueue) {
        U.uFlash.value = Math.max(U.uFlash.value, 0.6);
        S.flashQueue = 0;
    }
    U.uFlash.value *= Math.exp(-dt * 6);
    if (U.uFlash.value < 0.002) U.uFlash.value = 0;

    // FOV levemente fechado no chefe + bloom mais forte
    const fov = CAM_FOV + (CAM_FOV_BOSS - CAM_FOV) * b;
    if (Math.abs(S.camera.fov - fov) > 0.01) { S.camera.fov = fov; S.camera.updateProjectionMatrix(); }
    if (S.bloom) {
        S.bloom.strength  = BLOOM_NORMAL.strength  + (BLOOM_BOSS.strength  - BLOOM_NORMAL.strength)  * b;
        S.bloom.radius    = BLOOM_NORMAL.radius    + (BLOOM_BOSS.radius    - BLOOM_NORMAL.radius)    * b;
        S.bloom.threshold = BLOOM_NORMAL.threshold + (BLOOM_BOSS.threshold - BLOOM_NORMAL.threshold) * b;
    }

    S.camera.updateMatrixWorld(true);

    if (S.composer) {
        try {
            S.composer.render(dt);
        } catch (e) {
            console.error('[RaidSkybox] Erro no pós-processamento, desativando:', e);
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
export function showRaidSkybox() {
    if (!S) return;
    S.shouldRun = true;
    resize();
    // Ao abrir a raid, já nasce no estado certo do andar (sem "transição" visível)
    const f = S.getFloor();
    S.boss = S.bossTarget = (f > 0 && f % 5 === 0) ? 1 : 0;
    U.uFlash.value = 0;
    S.nextFlash = S.time + 6 + Math.random() * 6;
    if (!document.hidden) startLoop();
}

export function hideRaidSkybox() {
    if (!S) return;
    S.shouldRun = false;
    stopLoop();
}

window.RaidSkybox = { init: initRaidSkybox, show: showRaidSkybox, hide: hideRaidSkybox };
