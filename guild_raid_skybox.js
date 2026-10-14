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
// MODOS (getMode → 'prep' | 'combat'):
//   • prep   (contagem regressiva): céu gira sozinho, sem mob, visual de sempre.
//   • combat, andar normal: céu PARADO num yaw fixo (FROZEN_YAW_DEG); névoa,
//     partículas, bloom, vinheta etc. continuam rodando, porém mais intensos
//     (uBoost) — antes ficavam imperceptíveis.
//   • combat, andar de CHEFE: céu volta a girar + atmosfera roxa (como antes).
//
// MOB / CHEFE como SPRITE 3D (billboard), igual ao Mestre de Poções da capital:
//   fica DENTRO do mundo 3D (leva grade de cor, bloom, vinheta), com sombra no
//   chão, respiração orgânica, flash de dano e tremida. Posição/profundidade em
//   MOB_SPOT (ou ?debugRaidMob=1 pra calibrar com sliders). Nos andares de chefe
//   o céu gira, então o sprite acompanha a câmera (fica sempre no mesmo ponto
//   da tela) enquanto o cenário desliza atrás.
//
// Carregado via import() dinâmico a partir do guild_raid.js (o importmap
// do guild.html vem depois do <script> da raid — um import estático
// não resolveria o 'three').
// ═══════════════════════════════════════════════════════════════════════

const SKY_IMAGE_URL = '/assets/tdd_andar.png';
const FALLBACK_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/tdd_andar.webp'; // só se WebGL falhar

// ── Câmera ────────────────────────────────────────────────────────────
const CAM_FOV             = 120;
const CAM_FOV_BOSS        = 110;
const ROTATE_DEG_PER_SEC  = 360 / 170;  // mesma rotação lenta do lobby: 1 volta a cada 150s
const BOSS_BLEND_SPEED    = 1.6;        // maior = transição normal↔chefe mais rápida

// ── Bloom (normal → chefe) ───────────────────────────────────────────
const BLOOM_NORMAL = { strength: 0.34, radius: 0.45, threshold: 0.78 };
const BLOOM_BOSS   = { strength: 0.85, radius: 0.70, threshold: 0.52 };

// Bloom nos andares normais DURANTE A RAID (mais perceptível que o de preparação)
const BLOOM_COMBAT = { strength: 0.58, radius: 0.55, threshold: 0.66 };

const PARTICLE_COUNT = 250;

// ── Céu parado nos andares normais ───────────────────────────────────
// Direção (graus) pra onde a câmera olha quando o céu está parado. Ajuste
// com ?debugRaidMob=1 (slider "Céu parado") e copie o valor aqui.
let FROZEN_YAW_DEG = 0;
const FROZEN_EASE_SPEED   = 2.0;   // quão rápido o céu "assenta" no yaw fixo
const FROZEN_MAX_DEG_SEC  = 70;    // limite de velocidade desse assentamento
const ROTATE_RAMP_SPEED   = 1.5;   // aceleração ao voltar a girar (andar de chefe)
const BOOST_BLEND_SPEED   = 1.6;   // transição da intensidade extra dos efeitos

// ── MOB / CHEFE (sprite 3D no chão) ──────────────────────────────────
// yaw      : graus em relação ao CENTRO da tela (+ = direita, - = esquerda)
// pitch    : altura dos PÉS na tela (0 = horizonte; negativo = mais pra baixo)
// distance : PROFUNDIDADE. Maior = mais longe = menor (perspectiva real)
// heightFrac: altura do sprite como fração da altura da tela, medida na
//             distância de referência MOB_REF_DIST com FOV CAM_FOV
const MOB_SPOT = { yaw: 0, pitch: -60, distance: 400, heightFrac: 0.38 };
const MOB_REF_DIST    = 250;
const MOB_BOSS_SCALE  = 1.2;    // multiplicador extra no tamanho do chefe
const MOB_SHADOW_W    = 0.80;   // largura da sombra (fração da largura do sprite)
const MOB_SHADOW_H    = 0.24;   // achatamento da sombra (fração da largura dela)
const MOB_SHADOW_OPA  = 0.60;
const MOB_FADE_SPEED  = 6;      // fade-in/out ao trocar de monstro

let S = null; // estado do módulo (null até initRaidSkybox)

// Uniforms compartilhados entre grade, névoa e partículas.
const U = {
    uTime:  { value: 0 },
    uBoss:  { value: 0 },   // 0 = andar normal, 1 = andar de chefe
    uBoost: { value: 0 },   // 0..1, efeitos extras nos andares normais DURANTE a raid
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
            g += vec3(0.30, 0.06, 0.55) * 0.12 * sh * uBoss;                  // sombras → violeta
            g *= mix(vec3(1.0), vec3(1.10, 0.80, 1.25), 0.40 * uBoss * smoothstep(0.2, 1.0, lum)); // realces → magenta
            float l2 = dot(g, vec3(0.2126, 0.7152, 0.0722));
            g = mix(vec3(l2), g, 1.0 - 0.28 * uBoss);                         // dessatura um pouco...
            g = mix(g, g * vec3(0.78, 0.52, 1.18), 0.60 * uBoss);             // ...e tinge de violeta
            g *= mix(1.0, 0.70 + 0.07 * uPulse, uBoss);                       // penumbra que respira

            // Combate em andar normal: sombras azul-violeta + realces frios + leve pulso
            g += vec3(0.10, 0.12, 0.26) * 0.14 * sh * cb;
            g *= mix(vec3(1.0), vec3(0.93, 0.98, 1.14), 0.40 * cb * smoothstep(0.2, 1.0, lum));
            g *= 1.0 + 0.05 * uPulse * cb;

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
            float vs  = mix(0.38, 0.80, uBoss) + 0.06 * uPulse * uBoss + 0.14 * cb;
            vec3 edge = mix(vec3(0.004, 0.003, 0.006), vec3(0.030, 0.005, 0.070), uBoss);
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
        vec3 deep = vec3(0.20, 0.035, 0.40);
        vec3 glow = vec3(0.62, 0.24, 0.95);
        vec3 boss = mix(deep, glow, smoothstep(0.50, 0.95, n));
        vec3 col  = mix(calm, boss, uBoss);
        col += vec3(0.25, 0.08, 0.45) * uFlash * uBoss;

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
        vec3 mote = vec3(0.78, 0.38, 1.00);
        vec3 col  = mix(dust, mote, uBoss);
        gl_FragColor = vec4(col, a * vAlpha * (0.22 + 0.55 * uBoss + 0.38 * uBoost * (1.0 - uBoss)));
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

export function initRaidSkybox({ getFloor, getMode } = {}) {
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
        setMobFallback(true);   // sem WebGL: o <img> do monstro (DOM) assume
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
        yaw: Math.random() * 360, boss: 0, bossTarget: 0,
        nextFlash: 8, flashQueue: 0,
        getFloor: typeof getFloor === 'function' ? getFloor : () => 1,
        getMode: typeof getMode === 'function' ? getMode : () => 'combat',
        boost: 0, rotMul: 1, mob: null,
        ro: null,
    };
    S.mob = createMob(scene);

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

    if (pendingMobUrl) applyMob(pendingMobUrl);
    initMobDebug();

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

function angDiff(a, b) {   // menor diferença angular b - a, em (-180, 180]
    return ((b - a + 540) % 360) - 180;
}

function frame(ts) {
    if (!S || !S.running) return;
    const dt = Math.min((ts - S.last) / 1000, 0.1);
    S.last = ts;
    S.time += dt;

    // Estado do momento
    const f = S.getFloor();
    const mode = S.getMode();
    const inCombat = mode === 'combat';
    const isBossFloor = f > 0 && f % 5 === 0;
    const bossNow = inCombat && isBossFloor;
    const rotating = !inCombat || isBossFloor;       // preparação e chefe giram; mob normal fica parado

    // Rotação: gira (com rampa) ou assenta suavemente no yaw fixo
    S.rotMul += ((rotating ? 1 : 0) - S.rotMul) * (1 - Math.exp(-dt * ROTATE_RAMP_SPEED));
    if (Math.abs((rotating ? 1 : 0) - S.rotMul) < 0.002) S.rotMul = rotating ? 1 : 0;
    S.yaw += ROTATE_DEG_PER_SEC * S.rotMul * dt;
    if (S.rotMul < 1) {
        const diff = angDiff(S.yaw, FROZEN_YAW_DEG);
        let step = diff * (1 - Math.exp(-dt * FROZEN_EASE_SPEED));
        const lim = FROZEN_MAX_DEG_SEC * dt;
        step = Math.max(-lim, Math.min(lim, step)) * (1 - S.rotMul);
        S.yaw += step;
    }
    S.yaw = ((S.yaw % 360) + 360) % 360;
    lookAtYaw();

    // Normal ↔ chefe (suave)
    S.bossTarget = bossNow ? 1 : 0;
    S.boss += (S.bossTarget - S.boss) * (1 - Math.exp(-dt * BOSS_BLEND_SPEED));
    if (Math.abs(S.bossTarget - S.boss) < 0.002) S.boss = S.bossTarget;

    // Efeitos mais intensos: só durante a raid em andar normal
    const boostTarget = (inCombat && !isBossFloor) ? 1 : 0;
    S.boost += (boostTarget - S.boost) * (1 - Math.exp(-dt * BOOST_BLEND_SPEED));
    if (Math.abs(boostTarget - S.boost) < 0.002) S.boost = boostTarget;

    const b = S.boss;
    U.uTime.value = S.time;
    U.uBoss.value = b;
    U.uBoost.value = S.boost;
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
        const k = S.boost;
        const bs = BLOOM_NORMAL.strength  + (BLOOM_COMBAT.strength  - BLOOM_NORMAL.strength)  * k;
        const br = BLOOM_NORMAL.radius    + (BLOOM_COMBAT.radius    - BLOOM_NORMAL.radius)    * k;
        const bt = BLOOM_NORMAL.threshold + (BLOOM_COMBAT.threshold - BLOOM_NORMAL.threshold) * k;
        S.bloom.strength  = bs + (BLOOM_BOSS.strength  - bs) * b;
        S.bloom.radius    = br + (BLOOM_BOSS.radius    - br) * b;
        S.bloom.threshold = bt + (BLOOM_BOSS.threshold - bt) * b;
    }

    S.camera.updateMatrixWorld(true);
    updateMob(dt, inCombat, isBossFloor);

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
    if (!S || S.running || S.held) return;
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
// Segura a renderização enquanto um vídeo em tela cheia cobre a raid (intro/ataques
// do chefe): o céu fica 100% escondido, então renderizar só tira GPU do decodificador
// de vídeo. `held` é independente de show/hide.
export function pauseRaidSkybox() {
    if (!S) return;
    S.held = true;
    stopLoop();
}

export function resumeRaidSkybox() {
    if (!S) return;
    S.held = false;
    if (S.shouldRun && !document.hidden) startLoop();
}

export function showRaidSkybox() {
    if (!S) return;
    const firstShow = !S.shouldRun;
    S.shouldRun = true;
    resize();
    // Ao abrir a raid, já nasce no estado certo do andar (sem "transição" visível)
    const f = S.getFloor();
    const inCombat = S.getMode() === 'combat';
    const isBossFloor = f > 0 && f % 5 === 0;
    S.boss = S.bossTarget = (inCombat && isBossFloor) ? 1 : 0;
    S.boost = (inCombat && !isBossFloor) ? 1 : 0;
    if (firstShow) {
        // nasce direto no yaw parado (sem varredura) quando o céu não vai girar
        S.rotMul = (!inCombat || isBossFloor) ? 1 : 0;
        if (S.rotMul === 0) S.yaw = FROZEN_YAW_DEG;
        if (S.mob) S.mob.alpha = 0;
    }
    U.uFlash.value = 0;
    S.nextFlash = S.time + 6 + Math.random() * 6;
    if (!document.hidden) startLoop();
}

export function hideRaidSkybox() {
    if (!S) return;
    S.shouldRun = false;
    stopLoop();
}


// ═══════════════════════════════════════════════════════════════════════
// MOB / CHEFE — sprite 3D billboard
// ═══════════════════════════════════════════════════════════════════════
let pendingMobUrl = null;
const mobTexCache = new Map();   // url → THREE.Texture (LRU simples)
const MOB_TEX_CACHE_MAX = 6;

const rad = (d) => THREE.MathUtils.degToRad(d);

function setMobFallback(on) {
    const m = document.getElementById('raidCombatModal');
    if (m) m.classList.toggle('raid-mob-fallback', !!on);
}

function makeShadowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0.0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function createMob(scene) {
    // Sombra no chão (elipse achatada, pivô quase na base)
    const shadowMat = new THREE.SpriteMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false, opacity: 0 });
    const shadow = new THREE.Sprite(shadowMat);
    shadow.center.set(0.5, 0.72);
    shadow.renderOrder = 1.2;
    shadow.frustumCulled = false;
    shadow.visible = false;

    // Corpo: pivô nos PÉS (0.5, 0) — a respiração cresce a partir do chão
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 1.5;
    sprite.frustumCulled = false;
    sprite.visible = false;

    // Overlay aditivo (mesma silhueta) pro flash de dano / crítico / cura
    const flashMat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, color: 0xffffff });
    const flash = new THREE.Sprite(flashMat);
    flash.center.set(0.5, 0);
    flash.renderOrder = 1.6;
    flash.frustumCulled = false;
    flash.visible = false;

    scene.add(shadow, sprite, flash);

    return {
        sprite, mat, flash, flashMat, shadow, shadowMat,
        url: null, wanted: null, ready: false, aspect: 1, alpha: 0,
        flashAmt: 0, flashDecay: 7, flashRGB: [1, 1, 1],
        shakeT: 0,
        basePos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0),
        breath: initBreathState(),
    };
}

function initBreathState() {
    const st = {
        breathPhase: Math.random() * Math.PI * 2, swayPhase: Math.random() * Math.PI * 2,
        breathSpeed: 1, breathDepth: 1, swaySpeed: 0.35,
        tBreathSpeed: 1, tBreathDepth: 1, tSwaySpeed: 0.35,
        nextDrift: 0, nextDeep: 4000 + Math.random() * 5000,
        deepBoost: 0, deepTarget: 0, deepHold: 0,
    };
    pickDrift(st);
    return st;
}
function pickDrift(st) {
    st.tBreathSpeed = 0.82 + Math.random() * 0.4;
    st.tBreathDepth = 0.75 + Math.random() * 0.55;
    st.tSwaySpeed   = 0.25 + Math.random() * 0.25;
    st.nextDrift    = 3000 + Math.random() * 5000;
}

// Mesma respiração orgânica do DOM antigo (initOrganicBreathing), agora em 3D.
function stepBreath(st, dtMs) {
    st.nextDrift -= dtMs;
    if (st.nextDrift <= 0) pickDrift(st);
    st.breathSpeed += (st.tBreathSpeed - st.breathSpeed) * 0.0015 * dtMs;
    st.breathDepth += (st.tBreathDepth - st.breathDepth) * 0.0015 * dtMs;
    st.swaySpeed   += (st.tSwaySpeed   - st.swaySpeed)   * 0.0015 * dtMs;

    st.nextDeep -= dtMs;
    if (st.nextDeep <= 0) { st.deepTarget = 1; st.deepHold = 900; st.nextDeep = 7000 + Math.random() * 8000; }
    if (st.deepTarget > 0) { st.deepHold -= dtMs; if (st.deepHold <= 0) st.deepTarget = 0; }
    st.deepBoost += (st.deepTarget - st.deepBoost) * 0.005 * dtMs;

    st.breathPhase += (dtMs / 1000) * st.breathSpeed * ((Math.PI * 2) / 4.2);
    st.swayPhase   += (dtMs / 1000) * st.swaySpeed * (Math.PI * 2);

    const raw = Math.sin(st.breathPhase);
    const asym = raw >= 0 ? Math.pow(raw, 0.7) : -Math.pow(-raw, 1.4);
    const amount = asym * 0.012 * st.breathDepth * (1 + st.deepBoost * 0.9);
    const sway = Math.sin(st.swayPhase) * 0.6 + Math.sin(st.swayPhase * 0.47 + 1.3) * 0.3;
    return { amount, scaleY: 1 + amount, scaleX: 1 + amount * 0.43, rotDeg: sway * 0.12 };
}

function setMobTexture(M, tex) {
    M.mat.map = tex;      M.mat.needsUpdate = true;
    M.flashMat.map = tex; M.flashMat.needsUpdate = true;
    M.aspect = (tex.image && tex.image.width && tex.image.height) ? tex.image.width / tex.image.height : 1;
    M.ready = true;
}

function cacheMobTexture(url, tex) {
    mobTexCache.set(url, tex);
    if (mobTexCache.size > MOB_TEX_CACHE_MAX) {
        for (const [k, t] of mobTexCache) {
            if (k !== url && !(S && S.mob && S.mob.url === k)) { t.dispose(); mobTexCache.delete(k); break; }
        }
    }
}

function applyMob(url) {
    if (!S || !S.mob || !url) return;
    const M = S.mob;
    if (M.url === url && M.ready) return;
    M.wanted = url;
    const cached = mobTexCache.get(url);
    if (cached) { M.url = url; setMobTexture(M, cached); setMobFallback(false); return; }
    // Some o monstro anterior enquanto o novo carrega (evita mostrar o sprite errado)
    M.ready = false; M.alpha = 0; M.url = null;
    new THREE.TextureLoader().load(
        url,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = Math.min(4, S ? S.renderer.capabilities.getMaxAnisotropy() : 1);
            cacheMobTexture(url, tex);
            if (!S || S.mob.wanted !== url) return;   // já pediram outro monstro
            S.mob.url = url;
            setMobTexture(S.mob, tex);
            setMobFallback(false);
        },
        undefined,
        (err) => {
            console.error('[RaidSkybox] Falha ao carregar sprite do monstro — usando <img> do DOM:', err);
            setMobFallback(true);
        }
    );
}

function updateMob(dt, inCombat, isBossFloor) {
    const M = S.mob;
    if (!M) return;
    const want = inCombat && M.ready;
    M.alpha += ((want ? 1 : 0) - M.alpha) * (1 - Math.exp(-dt * MOB_FADE_SPEED));
    if (!want && M.alpha < 0.01) M.alpha = 0;
    const show = M.alpha > 0.003;
    M.sprite.visible = M.flash.visible = M.shadow.visible = show;
    if (!show) return;

    // Tamanho (mundo) — constante; a perspectiva (distância/FOV) decide o tamanho na tela
    const refH = 2 * MOB_REF_DIST * Math.tan(rad(CAM_FOV / 2)) * MOB_SPOT.heightFrac * (isBossFloor ? MOB_BOSS_SCALE : 1);
    const baseH = refH, baseW = refH * M.aspect;

    // Posição: relativa à câmera (o céu pode girar; o mob fica no mesmo ponto da tela)
    const yawDeg = S.yaw - MOB_SPOT.yaw;
    const p = rad(MOB_SPOT.pitch), y = rad(yawDeg);
    M.basePos.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(MOB_SPOT.distance);
    const e = S.camera.matrixWorld.elements;
    M.right.set(e[0], e[1], e[2]);
    M.up.set(e[4], e[5], e[6]);

    // Respiração + balanço (pivô nos pés)
    const br = stepBreath(M.breath, dt * 1000);

    // Tremida (crítico)
    let sx = 0, sy = 0, sr = 0;
    if (M.shakeT > 0) {
        const DUR = 0.75;
        M.shakeT = Math.max(0, M.shakeT - dt);
        const k = M.shakeT / DUR, t = DUR - M.shakeT;
        const w = Math.sin(t * 55);
        sx = w * k * 0.045 * baseH;
        sy = Math.cos(t * 43) * k * 0.02 * baseH;
        sr = w * k * 0.045;
    }

    M.sprite.position.copy(M.basePos).addScaledVector(M.right, sx).addScaledVector(M.up, sy);
    M.sprite.scale.set(baseW * br.scaleX, baseH * br.scaleY, 1);
    M.mat.rotation = rad(br.rotDeg) + sr;
    M.mat.opacity = M.alpha;

    M.flash.position.copy(M.sprite.position);
    M.flash.scale.copy(M.sprite.scale);
    M.flashMat.rotation = M.mat.rotation;

    // Flash aditivo
    if (M.flashAmt > 0.002) {
        M.flashAmt *= Math.exp(-dt * M.flashDecay);
        const a = Math.min(1, M.flashAmt);
        M.flashMat.opacity = a * M.alpha;
        M.flashMat.color.setRGB(M.flashRGB[0], M.flashRGB[1], M.flashRGB[2]);
    } else {
        M.flashAmt = 0;
        M.flashMat.opacity = 0;
    }

    // Sombra no chão
    const pulse = 1 + Math.max(0, br.amount) * 0.12;
    const sw = baseW * MOB_SHADOW_W * pulse;
    M.shadow.position.copy(M.basePos).addScaledVector(M.right, sx);
    M.shadow.scale.set(sw, sw * MOB_SHADOW_H, 1);
    M.shadowMat.opacity = MOB_SHADOW_OPA * M.alpha;
}

// ── API do mob ───────────────────────────────────────────────────────
export function setMobImage(url) {
    pendingMobUrl = url;
    if (S) applyMob(url);
}

// kind: 'hit' | 'crit' | 'heal'
export function mobHit(kind = 'hit') {
    if (!S || !S.mob) return;
    const M = S.mob;
    if (kind === 'crit')      { M.flashAmt = 1; M.flashDecay = 4.2; M.flashRGB = [2.6, 1.9, 0.6]; }
    else if (kind === 'heal') { M.flashAmt = 1; M.flashDecay = 3.2; M.flashRGB = [1.5, 0.6, 2.4]; }
    else                      { M.flashAmt = 1; M.flashDecay = 7.0; M.flashRGB = [2.0, 2.0, 2.0]; }
}

export function mobShake() {
    if (S && S.mob) S.mob.shakeT = 0.75;
}

// Retângulo do mob na tela (px de CLIENTE) — usado pra ancorar anéis/números de dano.
export function getMobScreenRect() {
    if (!S || !S.mob || !S.mob.sprite.visible || S.mob.alpha < 0.05) return null;
    const M = S.mob;
    const r = S.canvas.getBoundingClientRect();
    if (r.width < 2) return null;
    const feet = M.basePos.clone().project(S.camera);
    const head = M.basePos.clone().addScaledVector(M.up, M.sprite.scale.y).project(S.camera);
    const px = (v) => ({ x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height });
    const f = px(feet), h = px(head);
    return { cx: f.x, feetY: f.y, topY: h.y, height: f.y - h.y };
}

export function setMobSpot(partial = {}) {
    Object.assign(MOB_SPOT, partial);
}
export function setFrozenYaw(deg) {
    FROZEN_YAW_DEG = ((Number(deg) % 360) + 360) % 360;
}

// ── Painel de calibração: abra a página com ?debugRaidMob=1 ───────────
function initMobDebug() {
    let on = false;
    try { on = new URLSearchParams(location.search).get('debugRaidMob') === '1'; } catch {}
    if (!on || document.getElementById('raidMobDebug')) return;
    const box = document.createElement('div');
    box.id = 'raidMobDebug';
    box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:30000;background:rgba(0,0,0,.78);color:#fff;font:11px/1.3 monospace;padding:8px;border-radius:8px;width:210px;';
    const rows = [
        ['yaw',        () => MOB_SPOT.yaw,        v => MOB_SPOT.yaw = v,        -60, 60, 0.5],
        ['pitch',      () => MOB_SPOT.pitch,      v => MOB_SPOT.pitch = v,      -70, 0, 0.5],
        ['distance',   () => MOB_SPOT.distance,   v => MOB_SPOT.distance = v,   100, 500, 1],
        ['heightFrac', () => MOB_SPOT.heightFrac, v => MOB_SPOT.heightFrac = v, 0.1, 0.9, 0.005],
        ['céu parado', () => FROZEN_YAW_DEG,      v => FROZEN_YAW_DEG = v,      0, 359, 1],
    ];
    const out = document.createElement('div');
    const refresh = () => {
        out.textContent = `MOB_SPOT = { yaw: ${MOB_SPOT.yaw}, pitch: ${MOB_SPOT.pitch}, distance: ${MOB_SPOT.distance}, heightFrac: ${(+MOB_SPOT.heightFrac).toFixed(3)} };\nFROZEN_YAW_DEG = ${FROZEN_YAW_DEG};`;
    };
    rows.forEach(([label, get, set, min, max, step]) => {
        const row = document.createElement('div');
        const lab = document.createElement('div');
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = get();
        inp.style.width = '100%';
        const upd = () => { lab.textContent = `${label}: ${(+get()).toFixed(3).replace(/\.?0+$/, '')}`; };
        inp.addEventListener('input', () => { set(parseFloat(inp.value)); upd(); refresh(); });
        upd();
        row.append(lab, inp);
        box.appendChild(row);
    });
    out.style.cssText = 'margin-top:6px;white-space:pre-wrap;user-select:all;font-size:10px;color:#9f9;';
    box.appendChild(out);
    refresh();
    document.body.appendChild(box);
}

window.RaidSkybox = {
    init: initRaidSkybox, show: showRaidSkybox, hide: hideRaidSkybox, pause: pauseRaidSkybox, resume: resumeRaidSkybox,
    setMobImage, mobHit, mobShake, getMobScreenRect, setMobSpot, setFrozenYaw,
};
