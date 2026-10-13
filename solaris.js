import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { initPostFX } from './postfx.js';

// ═══════════════════════════════════════════════════════════════════════
// SOLARIS — SKYBOX 360° (Three.js) + CLIMA GELADO
// Mesma engine/configuração da Capital: câmera perspectiva dentro de uma
// esfera com a imagem panorâmica (equiretangular). Arrastar gira a câmera
// (yaw/pitch). Pós-processamento (bloom/color-grade/motion blur) vem do
// mesmo postfx.js da Capital.
//
// Sobre o skybox, esta página adiciona uma camada de clima (tudo dentro da
// mesma cena Three.js, então o bloom do postfx pega os brilhos):
//   • Neve em 3 camadas de profundidade (fundo nítido/pequeno → frente
//     grande e desfocada, como profundidade de campo), com balanço
//     individual, rajadas de vento suaves e flocos que "cintilam".
//   • Névoa gelada: sprites grandes, macios e ruidosos (fbm) que derivam
//     lentamente ao redor do horizonte.
//   • Geada nas bordas da tela: vinheta azul-gelo + cristais desenhados
//     proceduralmente, com leve "respiração".
// Tudo é ajustável nas constantes WEATHER_* logo abaixo.
// ═══════════════════════════════════════════════════════════════════════

const MAP_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/solaris.png';

// Mesmas configurações de câmera da Capital
let camYaw = 0, camPitch = -6, camFov = 120;
const FOV_MIN = 120, FOV_MAX = 120;   // limites de zoom normal (arrastar/pinch)
const PITCH_LIMIT = 89;

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

function yawPitchToVector(yawDeg, pitchDeg, radius = 1) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    return new THREE.Vector3(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(yaw) * Math.cos(pitch)
    );
}

let _sky = null;

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
        float fadeY = smoothstep(0.0, 0.10, ey) * smoothstep(1.0, 0.90, ey);
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
        vBlur = clamp(uBlur + smoothstep(7.0, 1.5, dist) * 0.55, 0.0, 1.0);

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
function createFrostOverlay() {
    const cv = document.createElement('canvas');
    cv.id = 'frostOverlay';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');

    function rnd(a, b) { return a + Math.random() * (b - a); }

    function branch(x, y, ang, len, depth, alpha, w) {
        if (depth <= 0 || len < 4) return;
        const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        ctx.strokeStyle = `rgba(215,238,255,${alpha})`;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
        branch(x2, y2, ang + rnd(-0.25, 0.25), len * rnd(0.62, 0.78), depth - 1, alpha * 0.9, w * 0.8);
        if (Math.random() < 0.85) branch(x + (x2 - x) * 0.55, y + (y2 - y) * 0.55, ang + rnd(0.7, 1.15), len * rnd(0.38, 0.55), depth - 1, alpha * 0.8, w * 0.7);
        if (Math.random() < 0.85) branch(x + (x2 - x) * 0.55, y + (y2 - y) * 0.55, ang - rnd(0.7, 1.15), len * rnd(0.38, 0.55), depth - 1, alpha * 0.8, w * 0.7);
    }

    function draw() {
        const W = Math.max(320, Math.round(innerWidth  / 1.5));
        const H = Math.max(320, Math.round(innerHeight / 1.5));
        cv.width = W; cv.height = H;
        ctx.clearRect(0, 0, W, H);

        // vinheta gelada (centro limpo → bordas azuladas)
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.hypot(W, H) * 0.56);
        g.addColorStop(0.0, 'rgba(170,215,255,0)');
        g.addColorStop(0.65, 'rgba(150,200,250,0.10)');
        g.addColorStop(1.0, 'rgba(200,232,255,0.42)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // cristais crescendo das bordas para dentro
        try { ctx.filter = 'blur(0.5px)'; } catch (e) {}
        ctx.lineCap = 'round';
        const n = Math.round((W + H) / 14);
        for (let i = 0; i < n; i++) {
            const side = Math.floor(Math.random() * 4);
            let x, y, ang;
            if (side === 0)      { x = rnd(0, W); y = 0;  ang = Math.PI / 2 + rnd(-0.7, 0.7); }
            else if (side === 1) { x = rnd(0, W); y = H;  ang = -Math.PI / 2 + rnd(-0.7, 0.7); }
            else if (side === 2) { x = 0; y = rnd(0, H);  ang = rnd(-0.7, 0.7); }
            else                 { x = W; y = rnd(0, H);  ang = Math.PI + rnd(-0.7, 0.7); }
            branch(x, y, ang, rnd(26, 70), 4, rnd(0.10, 0.26), rnd(0.7, 1.4));
        }
        try { ctx.filter = 'none'; } catch (e) {}
    }

    draw();
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 250); });
    return cv;
}

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX
// ═══════════════════════════════════════════════════════════════════════
function initSkybox() {
    const cont   = document.getElementById('mapContainer');
    const canvas = document.getElementById('skyboxCanvas');
    const map    = document.getElementById('map');
    if (!cont || !canvas || !map || _sky) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(camFov, cont.clientWidth / cont.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cont.clientWidth, cont.clientHeight);

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // normais invertidas: textura visível de dentro
    const material = new THREE.MeshBasicMaterial({ color: 0x121212 });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    new THREE.TextureLoader().load(
        MAP_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            material.map = tex;
            material.color.set(0xffffff);
            material.needsUpdate = true;
        },
        undefined,
        (err) => console.error('[Solaris] Falha ao carregar a imagem 360 do mapa:', err)
    );

    _sky = { scene, camera, renderer, canvas, cont };

    // ── Clima ──────────────────────────────────────────────────────────
    const weather = { snow: [], mist: null, windPos: new THREE.Vector2(), last: 0 };
    const q = (IS_LOW_END ? 0.55 : 1.0) * SNOW_DENSITY;

    if (WEATHER_MIST_ENABLED) {
        weather.mist = makeMist(IS_LOW_END ? 12 : 20);
        scene.add(weather.mist.group);
    }
    if (WEATHER_SNOW_ENABLED) {
        // fundo: pequenos, nítidos, muitos | meio | frente: grandes, desfocados, poucos
        weather.snow.push(
            makeSnowLayer({ count: Math.round(1500 * q), box: [150, 90, 150], speed: [1.5, 2.4], size: [0.25, 0.45], blur: 0.00, opacity: 0.75, sway: 1.2, sparkle: 1.0, renderOrder: 2 }),
            makeSnowLayer({ count: Math.round( 900 * q), box: [ 60, 44,  60], speed: [2.0, 3.2], size: [0.10, 0.20], blur: 0.15, opacity: 0.85, sway: 0.9, sparkle: 0.7, renderOrder: 3 }),
            makeSnowLayer({ count: Math.round( 240 * q), box: [ 18, 16,  18], speed: [2.6, 4.0], size: [0.16, 0.30], blur: 0.45, opacity: 0.80, sway: 0.5, sparkle: 0.0, renderOrder: 4 }),
        );
        weather.snow.forEach(s => scene.add(s));
    }
    _sky.weather = weather;
    if (WEATHER_FROST_ENABLED) createFrostOverlay();

    // Pós-processamento (bloom, iluminação ambiente/contraste/saturação,
    // motion blur) — mesmo efeito da Capital. Em try/catch: se falhar, a
    // página continua com renderização padrão.
    try {
        _sky.pfx = initPostFX({ scene, camera, renderer, cont, mapEl: map });
    } catch (e) {
        console.error('[PostFX] Falha ao iniciar pós-processamento, usando renderização padrão:', e);
        _sky.pfx = null;
    }

    updateCameraLook();

    function onResize() {
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (_sky.pfx) {
            try { _sky.pfx.resize(w, h); } catch (e) { console.error('[PostFX] Erro no resize:', e); }
        }
    }
    window.addEventListener('resize', onResize);

    (function loop(ts) {
        updateWeather(ts * 0.001);
        if (_sky.pfx) {
            try {
                _sky.pfx.render(scene, camera);
            } catch (e) {
                console.error('[PostFX] Erro ao renderizar, desativando pós-processamento:', e);
                _sky.pfx = null;
                renderer.render(scene, camera);
            }
        } else {
            renderer.render(scene, camera);
        }
        requestAnimationFrame(loop);
    })();
}

function updateWeather(t) {
    if (!_sky || !_sky.weather) return;
    const w = _sky.weather;
    const dt = Math.min(0.1, w.last ? t - w.last : 0.016);
    w.last = t;

    // rajadas: soma de senos lentos → vento que "respira" em vez de ser constante
    const gust = THREE.MathUtils.clamp(0.75 + 0.45 * Math.sin(t * 0.23) + 0.30 * Math.sin(t * 0.71 + 1.3) + 0.15 * Math.sin(t * 1.9), 0.25, 1.8);
    w.windPos.x += WIND_BASE * gust * dt;
    w.windPos.y += WIND_BASE * 0.35 * gust * dt;

    // conversão world-units → pixels (para o tamanho dos flocos)
    const pxScale = (_sky.renderer.domElement.height) / (2 * Math.tan(THREE.MathUtils.degToRad(camFov / 2)));

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

function updateCameraLook() {
    if (!_sky) return;
    camPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, camPitch));
    camFov   = Math.max(FOV_MIN, Math.min(FOV_MAX, camFov));
    _sky.camera.fov = camFov;
    _sky.camera.updateProjectionMatrix();
    const dir = yawPitchToVector(camYaw, camPitch, 1);
    _sky.camera.lookAt(dir.x, dir.y, dir.z);
}

// ── DRAG / PINCH / WHEEL DO MAPA ─────────────────────────────────────
function enableMapInteraction() {
    const cont   = document.getElementById('mapContainer');
    const canvas = document.getElementById('skyboxCanvas');
    if (!canvas || !cont) return;
    if (cont._interactionEnabled) return;
    cont._interactionEnabled = true;

    let vx = 0, vy = 0, lt = 0, aId = null;
    const FRICTION = 0.94;
    const DRAG_SENS = 1.0;

    let drag = false, sx = 0, sy = 0;
    let isPinching = false;
    let pinchStartDist = 0, pinchStartFov = camFov;

    canvas.style.touchAction = 'none';
    canvas.style.userSelect  = 'none';

    function degPerPx() { return camFov / (cont.clientHeight || window.innerHeight); }

    function applyDelta(dx, dy) {
        const dpp = degPerPx();
        camYaw   += dx * dpp * DRAG_SENS;
        camPitch += dy * dpp * DRAG_SENS;
        updateCameraLook();
    }

    function inertia() {
        cancelAnimationFrame(aId);
        if (drag) return;
        vx *= FRICTION; vy *= FRICTION;
        applyDelta(vx, vy);
        if (Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02)
            aId = requestAnimationFrame(inertia);
    }

    function touchDist(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function startDrag(e) {
        drag = true;
        canvas.classList.add('dragging');
        sx = e.clientX ?? e.touches[0].clientX;
        sy = e.clientY ?? e.touches[0].clientY;
        vx = vy = 0;
        lt = performance.now();
        cancelAnimationFrame(aId);
    }

    function onDrag(e) {
        if (!drag) return;
        e.preventDefault();
        const nx = e.clientX ?? e.touches[0].clientX;
        const ny = e.clientY ?? e.touches[0].clientY;
        const dt = performance.now() - lt;
        const dx = nx - sx, dy = ny - sy;
        if (dt > 0) { vx = dx / dt * 16; vy = dy / dt * 16; }
        applyDelta(dx, dy);
        sx = nx; sy = ny;
        lt = performance.now();
    }

    function endDrag() {
        drag = false;
        canvas.classList.remove('dragging');
        if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) inertia();
    }

    function onTouchStart(e) {
        if (e.touches.length >= 2) {
            isPinching = true;
            drag = false;
            cancelAnimationFrame(aId);
            pinchStartDist = touchDist(e);
            pinchStartFov  = camFov;
        } else if (e.touches.length === 1 && !isPinching) {
            startDrag(e);
        }
    }

    function onTouchMove(e) {
        if (e.touches.length >= 2 && isPinching) {
            e.preventDefault();
            const ratio = touchDist(e) / pinchStartDist;
            camFov = pinchStartFov / ratio;
            updateCameraLook();
        } else if (e.touches.length === 1 && !isPinching) {
            onDrag(e);
        }
    }

    function onTouchEnd(e) {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            vx = vy = 0;
        }
        if (e.touches.length === 0) endDrag();
    }

    function onWheel(e) {
        e.preventDefault();
        camFov += e.deltaY * 0.05;
        updateCameraLook();
    }

    cont.addEventListener('mousedown', startDrag, { passive: true });
    window.addEventListener('mousemove', onDrag,    { passive: false });
    window.addEventListener('mouseup',   endDrag,   { passive: true });
    cont.addEventListener('wheel', onWheel, { passive: false });

    cont.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend',  onTouchEnd,  { passive: true });
}

function boot() {
    initSkybox();
    enableMapInteraction();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
