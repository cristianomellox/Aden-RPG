import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
// postfx.js é importado dinamicamente (ver startSkybox), igual ao skybox da guilda:
// se ele falhar em carregar, só o pós-processamento é perdido; cena, câmera e
// arrastar continuam funcionando.

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX 360° DAS DIÁRIAS (Three.js)
// Mesma técnica do skybox da guilda (guild_skybox.js): câmera dentro de uma
// esfera panorâmica, rotação lenta, o jogador arrasta para olhar ao redor e,
// 2 s depois de largar, o pitch volta ao horizonte e a rotação automática
// retoma do yaw atual. Mesmo pós-processamento (postfx.js).
//
// Diferenças em relação à guilda:
//  • a imagem MUDA durante a aventura: window.DiariasSkybox.show(id) troca o
//    panorama com crossfade, sem resetar a posição da câmera;
//  • tela inicial = /assets/diarias.png; cenas = /assets/<id>.png;
//  • se a imagem não existir ou falhar, usa um degradê temático (textura
//    gerada por canvas) — como era antes com o background-image CSS;
//  • se o WebGL não estiver disponível, cai para background CSS (imagem ou degradê).
// ═══════════════════════════════════════════════════════════════════════

const SKY_BASE = '/assets/';                    // mesma origem: WebGL exige CORS em imagens de outro domínio
const LOBBY_KEY = 'diarias';                    // /assets/diarias.png
const DEFAULT_COLORS = ['#2a1f12', '#050403'];  // [centro, bordas] do degradê padrão

// ── Câmera (idêntica à guilda) ────────────────────────────────────────
const CAM_FOV             = 100;
const ROTATE_DEG_PER_SEC  = 360 / 150;          // 1 volta a cada 150 s
const PITCH_LIMIT         = 45;
const CAM_INITIAL_YAW_MIN = 20;
const CAM_INITIAL_YAW_MAX = 60;
const DRAG_SENS           = 1.0;
const IDLE_MS_TO_REALIGN  = 2000;
const PITCH_REALIGN_MS    = 1100;

// ── Troca de cenário e memória ────────────────────────────────────────
const FADE_MS     = 1600;                       // mesma duração do fade CSS antigo (1,6 s)
const MAX_CACHED  = 6;                          // texturas mantidas na GPU (as demais são descartadas)
const MAX_DPR     = 2;

// Elementos em que arrastar NÃO deve girar a câmera (botões, painéis que rolam, modais…)
const NO_DRAG = 'button, a, input, label, select, textarea, .overlay, #leftSideMenu, .menu-overlay, ' +
                '#playerTopBar, .lobby-scroll, .result-scroll, .stage-bottom, .hud-toggle-btn, .toast';

let _sky = null;               // { scene, camera, renderer, canvas, cont, layer, running, raf, pfx, meshA, meshB }
let _flat = false;             // true quando o WebGL não está disponível
let camYaw = 0, camPitch = 0;
let autoRotating = true, dragging = false;
let _lastTs = 0, _idleTimer = null, _pitchTween = null;
let _paused = false;

// troca de cenário
let _cur = null;               // malha visível no momento
let _incoming = null;          // malha que está entrando (fade em andamento)
let _fade = null;              // tween do crossfade
let _wantKey = null;           // última chave pedida
let _reqId = 0;                // descarta respostas de pedidos antigos
let _pending = null;           // show() chamado antes do módulo iniciar
const _cache = new Map();      // key → { promise, tex, colors }
const _flatOk = new Map();     // key → true/false (modo sem WebGL)

const randBetween = (min, max) => min + Math.random() * (max - min);

function yawPitchToVector(yawDeg, pitchDeg, radius = 1) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    return new THREE.Vector3(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(yaw) * Math.cos(pitch)
    );
}

function updateCameraLook() {
    if (!_sky) return;
    camPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, camPitch));
    const dir = yawPitchToVector(camYaw, camPitch, 1);
    _sky.camera.lookAt(dir.x, dir.y, dir.z);
}

// ── DOM ───────────────────────────────────────────────────────────────
function buildDom() {
    let layer = document.getElementById('diariasSkyLayer');
    if (layer) return layer;
    const s = document.createElement('style');
    s.id = 'diariassky-css';
    s.textContent = `
        #diariasSkyLayer { position: fixed; inset: 0; overflow: hidden; z-index: 0; background: #0d0b08 center / cover no-repeat; touch-action: none; }
        #diariasSkyCanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    `;
    document.head.appendChild(s);
    layer = document.createElement('div');
    layer.id = 'diariasSkyLayer';
    const canvas = document.createElement('canvas');
    canvas.id = 'diariasSkyCanvas';
    layer.appendChild(canvas);
    document.body.insertBefore(layer, document.body.firstChild);
    return layer;
}

// ── Texturas ──────────────────────────────────────────────────────────
const urlFor = (key) => SKY_BASE + encodeURIComponent(key) + '.png';

// Degradê temático: faixa clara no horizonte, escura nos polos (equivale ao radial-gradient antigo).
function gradientTexture(colors) {
    const [mid, edge] = colors || DEFAULT_COLORS;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, edge);
    grad.addColorStop(0.5, mid);
    grad.addColorStop(1, edge);
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// Nunca rejeita: se a imagem falhar, resolve com o degradê.
function loadTexture(key, colors) {
    const hit = _cache.get(key);
    if (hit) return hit.promise;
    const entry = { promise: null, tex: null, colors };
    entry.promise = new Promise((resolve) => {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');
        loader.load(
            urlFor(key),
            (tex) => { tex.colorSpace = THREE.SRGBColorSpace; entry.tex = tex; resolve(tex); },
            undefined,
            () => {
                console.warn('[DiariasSkybox] Sem imagem para "' + key + '" — usando degradê.');
                entry.tex = gradientTexture(colors);
                resolve(entry.tex);
            }
        );
    });
    _cache.set(key, entry);
    return entry.promise;
}

// Descarta da GPU as texturas mais antigas que não estão em uso.
function evictOld() {
    if (_cache.size <= MAX_CACHED || !_sky) return;
    const inUse = new Set([_sky.meshA.material.map, _sky.meshB.material.map]);
    for (const [key, entry] of _cache) {
        if (_cache.size <= MAX_CACHED) break;
        if (key === LOBBY_KEY || !entry.tex || inUse.has(entry.tex)) continue;
        entry.tex.dispose();
        _cache.delete(key);
    }
}

// ── Troca de cenário com crossfade ────────────────────────────────────
function finalizeFade() {
    if (_fade) { _fade.stop(); _fade = null; }
    if (!_incoming) return;
    const prev = _cur;
    _incoming.material.opacity = 1;
    _incoming.renderOrder = 1;
    _cur = _incoming;
    _incoming = null;
    if (prev && prev !== _cur) {
        prev.visible = false;
        prev.material.opacity = 0;
        prev.material.map = null;          // libera a textura antiga para o descarte
        prev.material.needsUpdate = true;
    }
    evictOld();
}

function swapTo(tex) {
    finalizeFade();
    const next = (_cur === _sky.meshA) ? _sky.meshB : _sky.meshA;
    next.material.map = tex;
    next.material.needsUpdate = true;
    next.material.opacity = 0;
    next.renderOrder = 2;                  // entra por cima da atual
    next.visible = true;
    if (_cur) _cur.renderOrder = 1;
    _incoming = next;

    const st = { o: 0 };
    _fade = new TWEEN.Tween(st)
        .to({ o: 1 }, FADE_MS)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(() => { next.material.opacity = st.o; })
        .onComplete(() => { _fade = null; finalizeFade(); })
        .start();
}

// Sem WebGL: background CSS na própria camada (imagem se existir, senão degradê).
function showFlat(key, colors) {
    const layer = _sky?.layer || document.getElementById('diariasSkyLayer');
    if (!layer) return;
    const [mid, edge] = colors || DEFAULT_COLORS;
    const grad = `radial-gradient(ellipse at 50% 35%, ${mid}, ${edge})`;
    const apply = (ok) => { layer.style.backgroundImage = ok ? `url("${urlFor(key)}")` : grad; };
    if (_flatOk.has(key)) return apply(_flatOk.get(key));
    const img = new Image();
    img.onload = () => { _flatOk.set(key, true); if (_wantKey === key) apply(true); };
    img.onerror = () => { _flatOk.set(key, false); if (_wantKey === key) apply(false); };
    img.src = urlFor(key);
}

// API: show('floresta', ['#1d3d27', '#07130b']) — id vazio volta à tela inicial.
async function show(key, colors) {
    key = key || LOBBY_KEY;
    if (!_sky) { _pending = [key, colors]; return; }
    if (key === _wantKey) return;          // já é (ou já está a caminho de ser) este cenário
    _wantKey = key;
    if (_flat) { showFlat(key, colors || (key === LOBBY_KEY ? DEFAULT_COLORS : undefined)); return; }
    const id = ++_reqId;
    const tex = await loadTexture(key, colors || (key === LOBBY_KEY ? DEFAULT_COLORS : undefined));
    if (!_sky || id !== _reqId) return;    // um pedido mais novo chegou enquanto carregava
    swapTo(tex);
}

// ── Arrastar (mouse + toque) ──────────────────────────────────────────
function enableDragControl() {
    const THRESH = 6;
    let sx = 0, sy = 0, startX = 0, startY = 0;
    let pending = false, ignoring = false;

    const degPerPx = () => CAM_FOV / (_sky.cont.clientHeight || window.innerHeight);

    function cancelIdleAndTween() {
        if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
        if (_pitchTween) { _pitchTween.stop(); _pitchTween = null; }
    }
    function pointerDown(target, x, y) {
        if (target && target.closest && target.closest(NO_DRAG)) { ignoring = true; return; }
        ignoring = false; pending = true; dragging = false;
        startX = sx = x; startY = sy = y;
    }
    function pointerMove(x, y, preventFn) {
        if (ignoring || (!pending && !dragging)) return;
        if (!dragging) {
            if (Math.hypot(x - startX, y - startY) < THRESH) return;
            dragging = true; autoRotating = false; cancelIdleAndTween();
        }
        if (preventFn) preventFn();
        const dpp = degPerPx();
        camYaw   += (x - sx) * dpp * DRAG_SENS;
        camPitch += (y - sy) * dpp * DRAG_SENS;
        updateCameraLook();
        sx = x; sy = y;
    }
    function pointerUp() {
        const was = dragging;
        pending = false; dragging = false; ignoring = false;
        if (was) scheduleIdleRealign();
    }

    // O conteúdo da página fica por cima da camada, então os eventos vêm da janela;
    // NO_DRAG filtra o que é interface (botões, painéis, modais).
    window.addEventListener('mousedown', (e) => pointerDown(e.target, e.clientX, e.clientY), { passive: true });
    window.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY, () => e.preventDefault()), { passive: false });
    window.addEventListener('mouseup', pointerUp, { passive: true });
    window.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        pointerDown(e.target, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        pointerMove(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault());
    }, { passive: false });
    window.addEventListener('touchend', pointerUp, { passive: true });
    window.addEventListener('touchcancel', pointerUp, { passive: true });
}

// Parado por IDLE_MS_TO_REALIGN: volta o pitch a 0 e retoma a rotação a partir do yaw atual.
function scheduleIdleRealign() {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
        _idleTimer = null;
        if (dragging) return;
        const state = { pitch: camPitch };
        _pitchTween = new TWEEN.Tween(state)
            .to({ pitch: 0 }, PITCH_REALIGN_MS)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(() => { camPitch = state.pitch; updateCameraLook(); })
            .onComplete(() => { _pitchTween = null; autoRotating = true; })
            .start();
    }, IDLE_MS_TO_REALIGN);
}

// ── Ciclo de vida ─────────────────────────────────────────────────────
function loop(ts) {
    if (!_sky || !_sky.running || _paused) return;
    const dt = Math.min(ts - _lastTs, 100);
    _lastTs = ts;

    if (autoRotating && !dragging) {
        camYaw += ROTATE_DEG_PER_SEC * (dt / 1000);
        updateCameraLook();
    }
    TWEEN.update(ts);
    _sky.camera.updateMatrixWorld(true);

    if (_sky.pfx) {
        try {
            _sky.pfx.render(_sky.scene, _sky.camera);
        } catch (e) {
            console.error('[DiariasSkybox] Erro no pós-processamento, desativando:', e);
            _sky.pfx = null;
            _sky.renderer.render(_sky.scene, _sky.camera);
        }
    } else {
        _sky.renderer.render(_sky.scene, _sky.camera);
    }
    _sky.raf = requestAnimationFrame(loop);
}

function startSkybox() {
    if (_sky) return;
    const layer = buildDom();
    const canvas = document.getElementById('diariasSkyCanvas');
    const cont = layer;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
        console.warn('[DiariasSkybox] WebGL indisponível — usando fundo CSS.', e);
        _flat = true;
        canvas.remove();
        _sky = { layer, cont, running: false };
        flushPending();
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(cont.clientWidth, cont.clientHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAM_FOV, cont.clientWidth / Math.max(cont.clientHeight, 1), 0.1, 1000);
    camera.position.set(0, 0, 0);

    // Duas esferas que compartilham a geometria: uma mostra o cenário atual, a outra o que está entrando.
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);
    const mk = () => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
        }));
        mesh.visible = false;
        scene.add(mesh);
        return mesh;
    };
    const meshA = mk(), meshB = mk();

    camYaw = (Math.random() < 0.5 ? 1 : -1) * randBetween(CAM_INITIAL_YAW_MIN, CAM_INITIAL_YAW_MAX);
    camPitch = 0;

    _sky = { scene, camera, renderer, canvas, cont, layer, running: true, raf: 0, pfx: null, meshA, meshB };
    updateCameraLook();
    camera.updateMatrixWorld(true);

    window.addEventListener('resize', () => {
        if (!_sky || _flat) return;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / Math.max(h, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (_sky.pfx) { try { _sky.pfx.resize(w, h); } catch (e) { console.error('[DiariasSkybox] Erro no resize:', e); } }
    });

    enableDragControl();

    document.addEventListener('visibilitychange', () => {
        if (!_sky || _flat) return;
        _sky.running = !document.hidden;
        if (_sky.running && !_paused) { _lastTs = performance.now(); _sky.raf = requestAnimationFrame(loop); }
        else if (_sky.raf) cancelAnimationFrame(_sky.raf);
    });

    _lastTs = performance.now();
    _sky.raf = requestAnimationFrame(loop);
    flushPending();
    console.log('[DiariasSkybox] inicializado — arraste a tela (com a interface recolhida) para girar.');

    // Pós-processamento (mesmo grading do skybox da guilda) — best effort.
    import('./postfx.js').then((mod) => {
        if (!_sky) return;
        mod.POSTFX_CONFIG.bloom.threshold = 0.60;
        mod.POSTFX_CONFIG.bloom.strength  = 0.64;
        mod.POSTFX_CONFIG.bloom.radius    = 0.40;
        _sky.pfx = mod.initPostFX({ scene, camera, renderer, cont });
    }).catch((e) => {
        console.error('[DiariasSkybox] Falha ao carregar postfx.js — seguindo sem pós-processamento:', e);
    });
}

// Tela inicial (ou o que foi pedido antes de o módulo ficar pronto).
function flushPending() {
    const p = _pending || [LOBBY_KEY, DEFAULT_COLORS];
    _pending = null;
    show(p[0], p[1]);
}

function pause() {
    _paused = true;
    if (_sky && _sky.raf) { cancelAnimationFrame(_sky.raf); _sky.raf = 0; }
}
function resume() {
    if (!_paused) return;
    _paused = false;
    if (_sky && _sky.running) {
        _lastTs = performance.now();
        if (_sky.raf) cancelAnimationFrame(_sky.raf);
        _sky.raf = requestAnimationFrame(loop);
    }
}

window.DiariasSkybox = { show, pause, resume, isReady: () => !!_sky, isFlat: () => _flat };

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSkybox);
} else {
    startSkybox();
}
