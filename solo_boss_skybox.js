import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX 360° DO CHEFE SOLO (Kar-Drakul / Solaris)
// Substitui o antigo <video> de fundo (solaris.mp4) por uma esfera
// panorâmica (/assets/solaris_boss.png), igual à raid de guilda nos
// andares normais: o céu fica PARADO (câmera fixa em SKY_YAW / SKY_PITCH).
//
// Os efeitos são os MESMOS do solaris.html / solaris.js (código copiado
// sem alterações de shader):
//   • Neve em 3 camadas de profundidade (GL_POINTS, 100% na GPU)
//   • Névoa gelada (billboards com ruído fbm)
//   • Geada nas bordas da tela (vinheta + cristais)
//   • Pós-processamento do postfx.js (bloom / color-grade / etc.)
//
// Como o céu não gira, quem dá vida à cena é o clima: neve, rajadas de
// vento, névoa à deriva e geada "respirando".
//
// Carregado via import() dinâmico a partir do solo_boss.js: se algo aqui
// falhar (WebGL, CDN, postfx.js), o combate segue funcionando normalmente.
// Requer o <script type="importmap"> com "three" no solo_boss.html.
//
// Calibração do enquadramento: abra a página com ?debugSoloSky=1 e use
// os sliders (yaw / pitch / fov); copie os valores para SKY_YAW etc.
// ═══════════════════════════════════════════════════════════════════════

const SKY_IMAGE_URL    = '/assets/solaris_boss.png';
const FALLBACK_IMAGE   = '/assets/solaris_boss.png';   // usado como <img> de fundo só se o WebGL falhar

// ── Enquadramento fixo (céu parado) ──────────────────────────────────
let SKY_YAW   = 0;     // graus: pra onde a câmera olha (0..359)
let SKY_PITCH = -6;    // graus: + olha pra cima, - olha pra baixo (mesmo valor do Solaris)
let SKY_FOV   = 120;   // mesmo FOV do Solaris
const PITCH_LIMIT = 89;

// ── Ajustes do clima (idênticos ao solaris.js) ───────────────────────
const IS_LOW_END = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || Math.min(innerWidth, innerHeight) < 600;
const WEATHER_SNOW_ENABLED  = true;
const WEATHER_MIST_ENABLED  = true;
const WEATHER_FROST_ENABLED = true;
const SNOW_DENSITY   = 1.0;                 // multiplica a quantidade de flocos (0.5 = metade, 2 = dobro)
const WIND_BASE      = 2.2;                 // velocidade-base do vento (unidades/s)
const SNOW_COLOR     = new THREE.Color(0.86, 0.93, 1.0); // branco levemente azulado
const MIST_COLOR     = new THREE.Color(0.72, 0.82, 0.95);
const MIST_OPACITY   = 0.16;

function yawPitchToVector(yawDeg, pitchDeg, radius = 1) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    return new THREE.Vector3(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(yaw) * Math.cos(pitch)
    );
}

let S = null;          // estado do módulo (null até initSoloBossSky)
let _failed = false;   // WebGL indisponível: não tenta de novo

// Começa a baixar a textura já no import() — assim ela está pronta quando
// o combate abrir (a intro em vídeo demora vários segundos).
let _texPromise = null;
function loadSkyTexture() {
    if (!_texPromise) {
        _texPromise = new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(SKY_IMAGE_URL, resolve, undefined, reject);
        });
        _texPromise.catch(() => {});   // evita "unhandled rejection"; o erro é tratado em quem usa
    }
    return _texPromise;
}
loadSkyTexture();

// ═══════════════════════════════════════════════════════════════════════
// NEVE — flocos como GL_POINTS animados 100% na GPU (zero custo de CPU).
// Cada camada é uma caixa de partículas centrada na câmera; o shader faz
// a queda, o balanço e o vento com mod() para formar um loop infinito.
// ═══════════════════════════════════════════════════════════════════════
const SNOW_VERT = /* glsl */`
    uniform float uTime;
    uniform vec2  uWindPos;
    uniform vec3  uBox;
    uniform vec2  uSpeed;
    uniform vec2  uSize;
    uniform float uPxScale;
    uniform float uSway;
    uniform float uBlur;
    uniform float uSparkle;
    attribute vec4 aRand;
    varying float vAlpha;
    varying float vBlur;
    varying float vSpark;

    void main() {
        float spd = mix(uSpeed.x, uSpeed.y, aRand.w);
        vec3 p = position * uBox;

        // queda (loop vertical)
        p.y = mod(p.y - uTime * spd, uBox.y);

        // vento acumulado + balanço individual de cada floco
        float ph = aRand.x * 6.2831 + uTime * (0.4 + aRand.y * 0.9);
        float windMul = 0.6 + aRand.z * 0.8;
        p.x += uWindPos.x * windMul + sin(ph) * uSway;
        p.z += uWindPos.y * windMul + cos(ph * 0.83) * uSway;
        p.x = mod(p.x, uBox.x);
        p.z = mod(p.z, uBox.z);

        p -= uBox * 0.5;

        // some suavemente nas bordas da caixa (esconde o "wrap") e muito perto da câmera
        float ey = p.y / uBox.y + 0.5;
        float fadeY = smoothstep(0.0, 0.10, ey) * (1.0 - smoothstep(0.90, 1.0, ey));
        float fadeX = 1.0 - smoothstep(0.38, 0.5, abs(p.x / uBox.x));
        float fadeZ = 1.0 - smoothstep(0.38, 0.5, abs(p.z / uBox.z));
        float dist  = length(p);
        float fadeNear = smoothstep(0.7, 2.4, dist);
        vAlpha = fadeY * fadeX * fadeZ * fadeNear;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = max(-mv.z, 0.1);

        float sz = mix(uSize.x, uSize.y, fract(aRand.x * 7.31 + aRand.y * 3.17));
        gl_PointSize = clamp(sz * uPxScale / depth, 1.4, 46.0);

        // quanto mais perto, mais "fora de foco" (profundidade de campo)
        vBlur = clamp(uBlur + (1.0 - smoothstep(1.5, 7.0, dist)) * 0.55, 0.0, 1.0);

        // alguns flocos cintilam (brilho >1 → pega o bloom do postfx)
        float isSpark = step(0.93, fract(aRand.z * 13.7));
        vSpark = uSparkle * isSpark * (0.5 + 0.5 * sin(uTime * (2.0 + aRand.x * 4.0) + aRand.y * 40.0));

        gl_Position = projectionMatrix * mv;
    }
`;
const SNOW_FRAG = /* glsl */`
    uniform vec3  uColor;
    uniform float uOpacity;
    varying float vAlpha;
    varying float vBlur;
    varying float vSpark;

    void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0 || vAlpha < 0.003) discard;

        float core = 1.0 - smoothstep(0.12, 0.60, r);       // floco nítido
        float soft = pow(1.0 - r, 2.0);                      // floco desfocado
        float a = mix(core * 0.9 + soft * 0.25, soft * 0.5, vBlur);

        // brilho em cruz nos flocos que cintilam
        float crossH = max(0.0, 1.0 - abs(c.y) * 16.0) * max(0.0, 1.0 - abs(c.x) * 2.0);
        float crossV = max(0.0, 1.0 - abs(c.x) * 16.0) * max(0.0, 1.0 - abs(c.y) * 2.0);
        a += vSpark * (crossH + crossV) * 0.9;

        vec3 col = uColor + vSpark * vec3(0.5, 0.8, 1.0) * 1.6;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * vAlpha * uOpacity);
    }
`;

function makeSnowLayer(cfg) {
    const { count, box, speed, size, blur, opacity, sway, sparkle, renderOrder } = cfg;
    const geo = new THREE.BufferGeometry();
    const pos  = new Float32Array(count * 3);
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random();
        rand[i * 4] = Math.random(); rand[i * 4 + 1] = Math.random();
        rand[i * 4 + 2] = Math.random(); rand[i * 4 + 3] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand',    new THREE.BufferAttribute(rand, 4));

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:    { value: 0 },
            uWindPos: { value: new THREE.Vector2() },
            uBox:     { value: new THREE.Vector3(...box) },
            uSpeed:   { value: new THREE.Vector2(...speed) },
            uSize:    { value: new THREE.Vector2(...size) },
            uPxScale: { value: 300 },
            uSway:    { value: sway },
            uBlur:    { value: blur },
            uSparkle: { value: sparkle },
            uColor:   { value: SNOW_COLOR.clone() },
            uOpacity: { value: opacity },
        },
        vertexShader: SNOW_VERT,
        fragmentShader: SNOW_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; // as posições base são 0..1; o shader as move
    pts.renderOrder = renderOrder;
    return pts;
}

// ═══════════════════════════════════════════════════════════════════════
// NÉVOA GELADA — billboards grandes com ruído fbm (não usam GL_POINTS
// porque o tamanho máximo de ponto é limitado em muitas GPUs/celulares).
// ═══════════════════════════════════════════════════════════════════════
const MIST_VERT = /* glsl */`
    uniform vec2 uSize;
    varying vec2 vUv;
    void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * uSize;      // billboard: sempre de frente para a câmera
        gl_Position = projectionMatrix * mv;
    }
`;
const MIST_FRAG = /* glsl */`
    uniform float uTime;
    uniform float uSeed;
    uniform float uOpacity;
    uniform vec3  uColor;
    varying vec2 vUv;

    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x),
                   mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) { v += a * n(p); p = p * 2.03 + 17.0; a *= 0.5; }
        return v;
    }
    void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float body = exp(-r * r * 3.2);                              // borda macia
        vec2 q = vUv * 3.0 + vec2(uSeed * 10.0 + uTime * 0.015, uSeed * 7.0 - uTime * 0.01);
        float wisp = 0.30 + 0.95 * fbm(q);                           // fiapos
        gl_FragColor = vec4(uColor, body * wisp * uOpacity);
    }
`;

function makeMist(count) {
    const group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    const items = [];
    for (let i = 0; i < count; i++) {
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime:    { value: 0 },
                uSeed:    { value: Math.random() },
                uOpacity: { value: MIST_OPACITY * (0.6 + Math.random() * 0.6) },
                uColor:   { value: MIST_COLOR.clone() },
                uSize:    { value: new THREE.Vector2(0, 0) },
            },
            vertexShader: MIST_VERT,
            fragmentShader: MIST_FRAG,
            transparent: true,
            depthWrite: false,
            depthTest: false,
        });
        const size = 70 + Math.random() * 110;
        mat.uniforms.uSize.value.set(size * 1.5, size * 0.7); // mais largas que altas = faixas de névoa
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        group.add(mesh);
        items.push({
            mesh, mat,
            theta: Math.random() * Math.PI * 2,
            radius: 70 + Math.random() * 150,
            y: -28 + Math.random() * 60,
            speed: 0.004 + Math.random() * 0.006,
        });
    }
    return { group, items };
}

// ═══════════════════════════════════════════════════════════════════════
// GEADA NAS BORDAS — vinheta azul-gelo + cristais fractais desenhados em
// um canvas 2D uma única vez (e redesenhados no resize).
// ═══════════════════════════════════════════════════════════════════════
function createFrostOverlay(parent) {
    const cv = document.createElement('canvas');
    cv.id = 'sbFrostOverlay';
    parent.appendChild(cv);   // dentro da camada do céu: fica atrás do boss e da UI
    const ctx = cv.getContext('2d');

    function rnd(a, b) { return a + Math.random() * (b - a); }

    // ruído de valor suave (fbm) para a "névoa" de gelo
    function makeNoise(w, h, scale, seed) {
        const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
        const grid = new Float32Array(gw * gh);
        let r = seed;
        for (let i = 0; i < grid.length; i++) { r = (r * 16807) % 2147483647; grid[i] = r / 2147483647; }
        return (x, y) => {
            const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy);
            let tx = fx - ix, ty = fy - iy;
            tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
            const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1];
            const c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
            return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
        };
    }

    // cristal de gelo com simetria de 6 pontas (dendrito), fino e discreto
    function crystal(cx, cy, R, alpha) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.lineCap = 'round';
        for (let k = 0; k < 6; k++) {
            ctx.save();
            ctx.rotate((Math.PI / 3) * k);
            ctx.strokeStyle = `rgba(225,243,255,${alpha})`;
            ctx.lineWidth = Math.max(0.6, R * 0.035);
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, 0); ctx.stroke();
            for (let j = 1; j <= 3; j++) {            // ramificações simétricas ao longo do braço
                const px = R * (0.25 * j + 0.1), bl = R * (0.34 - j * 0.07);
                ctx.lineWidth = Math.max(0.5, R * 0.022);
                ctx.beginPath();
                ctx.moveTo(px, 0); ctx.lineTo(px + bl * 0.6, bl);
                ctx.moveTo(px, 0); ctx.lineTo(px + bl * 0.6, -bl);
                ctx.stroke();
            }
            ctx.restore();
        }
        ctx.restore();
    }

    function draw() {
        const W = Math.max(320, Math.round((parent.clientWidth  || innerWidth)  / 1.5));
        const H = Math.max(320, Math.round((parent.clientHeight || innerHeight) / 1.5));
        cv.width = W; cv.height = H;
        ctx.clearRect(0, 0, W, H);

        // 1) névoa de gelo nas bordas (ruído fbm × distância da borda), em baixa resolução
        const lw = 200, lh = Math.round(200 * H / W);
        const low = document.createElement('canvas'); low.width = lw; low.height = lh;
        const lctx = low.getContext('2d');
        const img = lctx.createImageData(lw, lh);
        const n1 = makeNoise(lw, lh, 26, 12345), n2 = makeNoise(lw, lh, 11, 777), n3 = makeNoise(lw, lh, 5, 4242);
        for (let y = 0; y < lh; y++) {
            for (let x = 0; x < lw; x++) {
                const ex = Math.min(x, lw - 1 - x) / (lw * 0.5);
                const ey = Math.min(y, lh - 1 - y) / (lh * 0.5);
                const edge = 1 - Math.min(1, Math.min(ex, ey) * 2.6);       // 1 na borda → 0 no miolo
                const nz = n1(x, y) * 0.55 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
                const a = Math.pow(Math.max(0, edge), 1.6) * (0.35 + nz * 0.9);
                const i = (y * lw + x) * 4;
                img.data[i] = 205; img.data[i + 1] = 232; img.data[i + 2] = 255;
                img.data[i + 3] = Math.min(255, a * 150);
            }
        }
        lctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(low, 0, 0, W, H);

        // 2) vinheta azul-gelo suave
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.30, W / 2, H / 2, Math.hypot(W, H) * 0.55);
        g.addColorStop(0.0, 'rgba(150,200,255,0)');
        g.addColorStop(1.0, 'rgba(120,175,240,0.30)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // 3) poucos cristais, concentrados nos cantos
        const corners = [[0, 0], [W, 0], [0, H], [W, H]];
        for (const [cx, cy] of corners) {
            const count = 3 + Math.floor(Math.random() * 2);
            for (let i = 0; i < count; i++) {
                const px = cx + (cx ? -1 : 1) * rnd(0, W * 0.10);
                const py = cy + (cy ? -1 : 1) * rnd(0, H * 0.14);
                crystal(px, py, rnd(14, 38) * Math.min(W, H) / 500, rnd(0.20, 0.42));
            }
        }
    }

    draw();
    // O redesenho no resize é disparado pelo ResizeObserver da camada (ver onResize)
    return { cv, redraw: draw };
}

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX (câmera parada) + clima
// ═══════════════════════════════════════════════════════════════════════
function applyLook() {
    if (!S) return;
    SKY_PITCH = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, SKY_PITCH));
    S.camera.fov = SKY_FOV;
    S.camera.updateProjectionMatrix();
    const dir = yawPitchToVector(SKY_YAW, SKY_PITCH, 1);
    S.camera.lookAt(dir.x, dir.y, dir.z);
}

export function initSoloBossSky() {
    if (S) return true;
    if (_failed) return false;

    const layer  = document.getElementById('sbSkyLayer');
    const canvas = document.getElementById('sbSkyCanvas');
    const map    = document.getElementById('sbSkyMap');
    if (!layer || !canvas || !map) return false;

    const w = layer.clientWidth, h = layer.clientHeight;
    if (w < 2 || h < 2) return false;   // container ainda escondido: tenta de novo no show()

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
        console.error('[SoloBossSky] WebGL indisponível, usando imagem estática:', e);
        _failed = true;
        layer.style.background = `#05070d url('${FALLBACK_IMAGE}') center / cover no-repeat`;
        return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(SKY_FOV, w / h, 0.1, 1000);
    camera.position.set(0, 0, 0);

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // normais invertidas: textura visível de dentro
    const material = new THREE.MeshBasicMaterial({ color: 0x05070d });
    scene.add(new THREE.Mesh(geometry, material));

    S = {
        layer, canvas, map, renderer, scene, camera, material,
        running: false, shouldRun: false, held: false, raf: 0, last: 0, time: 0,
        weather: { snow: [], mist: null, windPos: new THREE.Vector2() },
        frost: null, pfx: null, ro: null, frostTimer: null,
    };

    // ── Clima (mesma montagem do solaris.js) ───────────────────────────
    const q = (IS_LOW_END ? 0.55 : 1.0) * SNOW_DENSITY;
    if (WEATHER_MIST_ENABLED) {
        S.weather.mist = makeMist(IS_LOW_END ? 12 : 20);
        scene.add(S.weather.mist.group);
    }
    if (WEATHER_SNOW_ENABLED) {
        // fundo: pequenos, nítidos, muitos | meio | frente: grandes, desfocados, poucos
        S.weather.snow.push(
            makeSnowLayer({ count: Math.round(1900 * q), box: [150, 90, 150], speed: [1.5, 2.4], size: [0.34, 0.58], blur: 0.00, opacity: 0.75, sway: 1.2, sparkle: 1.0, renderOrder: 2 }),
            makeSnowLayer({ count: Math.round(1100 * q), box: [ 60, 44,  60], speed: [2.0, 3.2], size: [0.14, 0.26], blur: 0.15, opacity: 0.85, sway: 0.9, sparkle: 0.7, renderOrder: 3 }),
            makeSnowLayer({ count: Math.round( 320 * q), box: [ 18, 16,  18], speed: [2.6, 4.0], size: [0.20, 0.36], blur: 0.45, opacity: 0.80, sway: 0.5, sparkle: 0.0, renderOrder: 4 }),
        );
        S.weather.snow.forEach(s => scene.add(s));
    }
    if (WEATHER_FROST_ENABLED) S.frost = createFrostOverlay(layer);

    applyLook();

    // ── Pós-processamento (postfx.js do Solaris/Capital) ───────────────
    // Import dinâmico + try/catch: se o arquivo faltar ou falhar, segue sem ele.
    const pfxPromise = import('./postfx.js')
        .then((m) => {
            if (!S) return;
            S.pfx = m.initPostFX({ scene, camera, renderer, cont: layer, mapEl: map });
            try { S.pfx.resize(layer.clientWidth, layer.clientHeight); } catch (e) {}
        })
        .catch((e) => {
            console.error('[PostFX] Falha ao iniciar pós-processamento, usando renderização padrão:', e);
            if (S) S.pfx = null;
        });

    // ── Textura do céu ────────────────────────────────────────────────
    const texPromise = loadSkyTexture().then((tex) => {
        if (!S) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        material.map = tex;
        material.color.set(0xffffff);
        material.needsUpdate = true;
    }).catch((err) => {
        console.error('[SoloBossSky] Falha ao carregar solaris_boss.png:', err);
    });

    // Só revela o canvas quando textura + pós-processamento estiverem prontos (sem "pop" visual)
    Promise.allSettled([texPromise, pfxPromise]).then(() => {
        if (S) layer.classList.add('is-ready');
    });

    // O container fica display:none no lobby e muda de tamanho no resize
    S.ro = new ResizeObserver(() => onResize());
    S.ro.observe(layer);

    initSkyDebug();
    return true;
}

function onResize() {
    if (!S) return;
    const w = S.layer.clientWidth, h = S.layer.clientHeight;
    if (w < 2 || h < 2) return;
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h, false);
    if (S.pfx) {
        try { S.pfx.resize(w, h); } catch (e) { console.error('[PostFX] Erro no resize:', e); }
    }
    if (S.frost) {
        clearTimeout(S.frostTimer);
        S.frostTimer = setTimeout(() => S.frost && S.frost.redraw(), 250);
    }
}

function updateWeather(t, dt) {
    const w = S.weather;

    // rajadas: soma de senos lentos → vento que "respira" em vez de ser constante
    const gust = THREE.MathUtils.clamp(0.75 + 0.45 * Math.sin(t * 0.23) + 0.30 * Math.sin(t * 0.71 + 1.3) + 0.15 * Math.sin(t * 1.9), 0.25, 1.8);
    w.windPos.x += WIND_BASE * gust * dt;
    w.windPos.y += WIND_BASE * 0.35 * gust * dt;

    // conversão world-units → pixels (para o tamanho dos flocos)
    const pxScale = S.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(S.camera.fov / 2)));

    for (const s of w.snow) {
        const u = s.material.uniforms;
        u.uTime.value = t;
        u.uWindPos.value.copy(w.windPos);
        u.uPxScale.value = pxScale;
    }
    if (w.mist) {
        for (const m of w.mist.items) {
            m.theta += m.speed * dt * (0.6 + 0.8 * gust);
            m.mesh.position.set(Math.sin(m.theta) * m.radius, m.y, Math.cos(m.theta) * m.radius);
            m.mat.uniforms.uTime.value = t;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// LOOP
// ═══════════════════════════════════════════════════════════════════════
function frame(ts) {
    if (!S || !S.running) return;
    // Tempo próprio, acumulado só enquanto renderiza: pausar (vídeo em tela cheia)
    // não faz a neve "pular" ao voltar.
    const dt = Math.min(Math.max((ts - S.last) / 1000, 0), 0.1);
    S.last = ts;
    S.time += dt;

    updateWeather(S.time, dt);

    if (S.pfx) {
        try {
            S.pfx.render(S.scene, S.camera);
        } catch (e) {
            console.error('[PostFX] Erro ao renderizar, desativando pós-processamento:', e);
            S.pfx = null;
            S.renderer.render(S.scene, S.camera);
        }
    } else {
        S.renderer.render(S.scene, S.camera);
    }
    S.raf = requestAnimationFrame(frame);
}

function startLoop() {
    if (!S || S.running || S.held || !S.shouldRun || document.hidden) return;
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

document.addEventListener('visibilitychange', () => {
    if (!S) return;
    if (document.hidden) stopLoop(); else startLoop();
});

// ── API pública ──────────────────────────────────────────────────────
// Mostra/roda o céu. Chame DEPOIS de exibir o #sbContainer (precisa de tamanho).
export function showSoloBossSky() {
    if (!initSoloBossSky()) return;
    S.shouldRun = true;
    onResize();
    startLoop();
}

export function hideSoloBossSky() {
    if (!S) return;
    S.shouldRun = false;
    stopLoop();
}

// Segura a renderização enquanto um vídeo em tela cheia cobre o combate
// (intro / ataques do chefe): o céu está 100% escondido, então renderizar
// só tira GPU do decodificador de vídeo.
export function pauseSoloBossSky() {
    if (!S) return;
    S.held = true;
    stopLoop();
}

export function resumeSoloBossSky() {
    if (!S) return;
    S.held = false;
    startLoop();
}

export function setSkyLook({ yaw, pitch, fov } = {}) {
    if (typeof yaw === 'number')   SKY_YAW = ((yaw % 360) + 360) % 360;
    if (typeof pitch === 'number') SKY_PITCH = pitch;
    if (typeof fov === 'number')   SKY_FOV = fov;
    applyLook();
}

// ── Painel de calibração: abra a página com ?debugSoloSky=1 ───────────
function initSkyDebug() {
    let on = false;
    try { on = new URLSearchParams(location.search).get('debugSoloSky') === '1'; } catch {}
    if (!on || document.getElementById('soloSkyDebug')) return;
    const box = document.createElement('div');
    box.id = 'soloSkyDebug';
    box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:30000;background:rgba(0,0,0,.78);color:#fff;font:11px/1.3 monospace;padding:8px;border-radius:8px;width:210px;';
    const rows = [
        ['yaw',   () => SKY_YAW,   v => setSkyLook({ yaw: v }),   0, 359, 1],
        ['pitch', () => SKY_PITCH, v => setSkyLook({ pitch: v }), -89, 89, 0.5],
        ['fov',   () => SKY_FOV,   v => setSkyLook({ fov: v }),   60, 140, 1],
    ];
    const out = document.createElement('div');
    out.style.cssText = 'margin-top:6px;white-space:pre-wrap;user-select:all;font-size:10px;color:#9f9;';
    const refresh = () => { out.textContent = `SKY_YAW = ${SKY_YAW};\nSKY_PITCH = ${SKY_PITCH};\nSKY_FOV = ${SKY_FOV};`; };
    rows.forEach(([label, get, set, min, max, step]) => {
        const row = document.createElement('div');
        const lab = document.createElement('div');
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = get();
        inp.style.width = '100%';
        const upd = () => { lab.textContent = `${label}: ${(+get()).toFixed(1).replace(/\.0$/, '')}`; };
        inp.addEventListener('input', () => { set(parseFloat(inp.value)); upd(); refresh(); });
        upd();
        row.append(lab, inp);
        box.appendChild(row);
    });
    box.appendChild(out);
    refresh();
    document.body.appendChild(box);
}

window.SoloBossSky = {
    init: initSoloBossSky, show: showSoloBossSky, hide: hideSoloBossSky,
    pause: pauseSoloBossSky, resume: resumeSoloBossSky, setLook: setSkyLook,
};
