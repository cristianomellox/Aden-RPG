import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ═══════════════════════════════════════════════════════════════════════
// DIÁRIAS — CLIMA GELADO (mesmos shaders de neve, névoa e geada do solaris.js)
// Camada transparente própria sobre o skybox do palco: não depende do renderer do
// diarias_skybox.js. O "pós-processamento" (bloom/color grade) é imitado por camadas CSS
// (#weatherGrade). Uso: window.DiariasWeather.set(true|false). Quando desligado, o loop
// de render é cancelado (custo zero).
// ═══════════════════════════════════════════════════════════════════════
const MIST_COUNT_DESKTOP = 20, MIST_COUNT_LOW = 12;
// ── Ajustes do clima ─────────────────────────────────────────────────────
const IS_LOW_END = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || Math.min(innerWidth, innerHeight) < 600;
const WEATHER_SNOW_ENABLED  = true;
const WEATHER_MIST_ENABLED  = true;
const WEATHER_FROST_ENABLED = true;
const SNOW_DENSITY   = 1.0;                 // multiplica a quantidade de flocos (0.5 = metade, 2 = dobro)
const WIND_BASE      = 2.2;                 // velocidade-base do vento (unidades/s)
const SNOW_COLOR     = new THREE.Color(0.86, 0.93, 1.0); // branco levemente azulado
const MIST_COLOR     = new THREE.Color(0.72, 0.82, 0.95);
const MIST_OPACITY   = 0.16;
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
    cv.id = 'frostOverlay';
    parent.appendChild(cv);
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
        const W = Math.max(320, Math.round(innerWidth  / 1.5));
        const H = Math.max(320, Math.round(innerHeight / 1.5));
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
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 250); });
    return cv;
}

// ═══════════════════════════════════════════════════════════════════════
// CONTROLE
// ═══════════════════════════════════════════════════════════════════════
let W = null, want = false;

function ensureWeather() {
    if (W) return W;
    const host = document.getElementById('viewStage') || document.body;
    const canvas = document.createElement('canvas');
    canvas.id = 'weatherCanvas';
    host.insertBefore(canvas, host.firstChild.nextSibling || null);

    const grade = document.createElement('div');
    grade.id = 'weatherGrade';
    host.appendChild(grade);

    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' }); }
    catch (e) { console.warn('[Weather] WebGL indisponível:', e); canvas.remove(); grade.remove(); W = { dead: true }; return W; }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, IS_LOW_END ? 1.25 : 1.75));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(120, 1, 0.1, 500);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, -0.1, -1);

    const weather = { snow: [], mist: null, windPos: new THREE.Vector2(), last: 0 };
    const q = (IS_LOW_END ? 0.55 : 1.0) * SNOW_DENSITY;
    if (WEATHER_MIST_ENABLED) { weather.mist = makeMist(IS_LOW_END ? MIST_COUNT_LOW : MIST_COUNT_DESKTOP); scene.add(weather.mist.group); }
    if (WEATHER_SNOW_ENABLED) {
        weather.snow.push(
            makeSnowLayer({ count: Math.round(1900 * q), box: [150, 90, 150], speed: [1.5, 2.4], size: [0.34, 0.58], blur: 0.00, opacity: 0.75, sway: 1.2, sparkle: 1.0, renderOrder: 2 }),
            makeSnowLayer({ count: Math.round(1100 * q), box: [ 60, 44,  60], speed: [2.0, 3.2], size: [0.14, 0.26], blur: 0.15, opacity: 0.85, sway: 0.9, sparkle: 0.7, renderOrder: 3 }),
            makeSnowLayer({ count: Math.round( 320 * q), box: [ 18, 16,  18], speed: [2.6, 4.0], size: [0.20, 0.36], blur: 0.45, opacity: 0.80, sway: 0.5, sparkle: 0.0, renderOrder: 4 }),
        );
        weather.snow.forEach((s) => scene.add(s));
    }
    const frost = WEATHER_FROST_ENABLED ? createFrostOverlay(host) : null;

    const resize = () => {
        const w = Math.max(2, host.clientWidth || innerWidth), h = Math.max(2, host.clientHeight || innerHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize); resize();

    W = { renderer, scene, camera, weather, canvas, grade, frost, raf: 0, running: false, resize, t0: performance.now() };
    return W;
}

function update(t) {
    const w = W.weather, dt = Math.min(0.1, w.last ? Math.max(0, t - w.last) : 0.016);
    w.last = t;
    const gust = THREE.MathUtils.clamp(0.75 + 0.45 * Math.sin(t * 0.23) + 0.30 * Math.sin(t * 0.71 + 1.3) + 0.15 * Math.sin(t * 1.9), 0.25, 1.8);
    w.windPos.x += WIND_BASE * gust * dt;
    w.windPos.y += WIND_BASE * 0.35 * gust * dt;
    const pxScale = W.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(W.camera.fov / 2)));
    for (const s of w.snow) {
        const u = s.material.uniforms;
        u.uTime.value = t; u.uWindPos.value.copy(w.windPos); u.uPxScale.value = pxScale;
    }
    if (w.mist) for (const m of w.mist.items) {
        m.theta += m.speed * dt * (0.6 + 0.8 * gust);
        m.mesh.position.set(Math.sin(m.theta) * m.radius, m.y, Math.cos(m.theta) * m.radius);
        m.mat.uniforms.uTime.value = t;
    }
}

function loop() {
    if (!W || !W.running) return;
    const t = (performance.now() - W.t0) / 1000;
    try { update(t); W.renderer.render(W.scene, W.camera); }
    catch (e) { console.error('[Weather] erro de render, desativando:', e); stop(); return; }
    W.raf = requestAnimationFrame(loop);
}
function start() {
    const w = ensureWeather(); if (w.dead || w.running) return;
    w.resize();
    w.running = true; w.canvas.classList.add('on'); w.grade.classList.add('on'); w.frost?.classList.add('on');
    w.raf = requestAnimationFrame(loop);
}
function stop() {
    if (!W || W.dead) return;
    W.running = false; cancelAnimationFrame(W.raf);
    W.canvas.classList.remove('on'); W.grade.classList.remove('on'); W.frost?.classList.remove('on');
}
document.addEventListener('visibilitychange', () => { if (!W || W.dead) return; if (document.hidden) { W.running = false; cancelAnimationFrame(W.raf); } else if (want) start(); });

window.DiariasWeather = { set(on) { want = !!on; want ? start() : stop(); } };
if (window.__weatherWant) window.DiariasWeather.set(true);   // a cena já pediu neve antes do módulo carregar
