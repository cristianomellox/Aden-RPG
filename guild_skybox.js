import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { initPostFX, POSTFX_CONFIG } from './postfx.js';

// ═══════════════════════════════════════════════════════════════════════
// SKYBOX 360° DA PÁGINA DA GUILDA (Three.js) ──────────────────────────────
// Substitui o antigo background-image estático (guildhall.webp) do <body>
// por uma esfera panorâmica (guildhall.png), na mesma técnica do skybox da
// tela de login (ver auth_skybox.js) — câmera dentro da esfera, mesmo
// pós-processamento (bloom/grading, via postfx.js).
//
// Diferença em relação ao da tela de login: aqui o jogador PODE arrastar a
// tela pra olhar ao redor (yaw + pitch, sem zoom). Assim que ele solta e
// fica 2s sem mexer, a câmera realinha o pitch pra 0 (horizonte) sozinha e
// a rotação automática (só no eixo horizontal) volta a partir do yaw atual
// — nunca reseta a posição horizontal.
//
// Também expõe uma pequena API (window.GuildSkybox) usada por
// guild_members_wander.js para "colar" os avatares dos membros da guilda
// na esfera (mesma técnica de projeção yaw/pitch → tela usada pelos spots
// de caça do Vale Arcano).
// ═══════════════════════════════════════════════════════════════════════

const SKY_IMAGE_URL = '/assets/guildhall.png';

// ── Câmera ────────────────────────────────────────────────────────────
const CAM_FOV             = 100;
const ROTATE_DEG_PER_SEC  = 360 / 150;   // mesma velocidade suave do login — 1 volta a cada 150s
const PITCH_LIMIT         = 45;          // até onde o jogador pode inclinar pra cima/baixo arrastando
const CAM_INITIAL_YAW_MIN = 20;
const CAM_INITIAL_YAW_MAX = 60;

// ── Drag / interação ─────────────────────────────────────────────────
const DRAG_SENS           = 1.0;
const IDLE_MS_TO_REALIGN  = 2000;  // "depois de parar de interagir por 2s..."
const PITCH_REALIGN_MS    = 1100;  // duração do tween que volta o pitch pra 0

const ORBIT_RADIUS_DEFAULT = 380;

let _sky = null;        // { scene, camera, renderer, canvas, cont, layer, orbitLayer, running, raf, pfx, _onResize }
let camYaw = 0, camPitch = 0;
let autoRotating = true;
let dragging = false;
let _lastTs = 0;
let _idleTimer = null;
let _pitchTween = null;

function randBetween(min, max) { return min + Math.random() * (max - min); }

// Converte yaw/pitch (graus) num vetor direção unitário (ou escalado por radius).
// Mesma convenção usada em todo o resto do jogo (auth_skybox.js, vale_arcano.js).
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
function injectCSS() {
    if (document.getElementById('guildsky-css')) return;
    const css = `
        #guildSkyboxLayer {
            position: fixed;
            inset: 0;
            overflow: hidden;
            z-index: -1;
            pointer-events: auto;
            background: #0d0b08;
            touch-action: none;
        }
        #guildSkyboxCanvas {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: block;
        }
        #guildOrbitLayer {
            position: absolute;
            inset: 0;
            pointer-events: none; /* os filhos (avatares) reativam individualmente */
        }
    `;
    const s = document.createElement('style');
    s.id = 'guildsky-css';
    s.textContent = css;
    document.head.appendChild(s);
}

function buildDom() {
    let layer = document.getElementById('guildSkyboxLayer');
    if (layer) return layer;
    injectCSS();
    layer = document.createElement('div');
    layer.id = 'guildSkyboxLayer';
    const canvas = document.createElement('canvas');
    canvas.id = 'guildSkyboxCanvas';
    layer.appendChild(canvas);
    const orbitLayer = document.createElement('div');
    orbitLayer.id = 'guildOrbitLayer';
    layer.appendChild(orbitLayer);
    document.body.insertBefore(layer, document.body.firstChild);
    return layer;
}

// ═══════════════════════════════════════════════════════════════════════
// ORBITADORES — API usada por guild_members_wander.js para projetar os
// avatares dos membros (que ficam "passeando" pela esfera) em pixels de
// tela. Cada orbitador lê seu yaw/pitch de um objeto mutável (`state`) —
// quem controla o movimento (tween/wander) é o módulo externo; aqui só
// projetamos o valor atual, quadro a quadro.
// ═══════════════════════════════════════════════════════════════════════
const _orbiters = [];
const _orbCamDir = new THREE.Vector3();

function registerOrbiter(el, state, radius = ORBIT_RADIUS_DEFAULT) {
    const entry = { el, state, radius };
    _orbiters.push(entry);
    if (_sky) _sky.orbitLayer.appendChild(el);
    return entry;
}

function unregisterOrbiter(entry) {
    if (!entry) return;
    const i = _orbiters.indexOf(entry);
    if (i >= 0) _orbiters.splice(i, 1);
    if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
}

function updateOrbiters() {
    if (!_sky || !_orbiters.length) return;
    const { camera, cont } = _sky;
    const cw = cont.clientWidth, ch = cont.clientHeight;
    camera.getWorldDirection(_orbCamDir);

    for (const o of _orbiters) {
        const dirVec = yawPitchToVector(o.state.yaw, o.state.pitch, o.radius);
        const unitDir = dirVec.clone().normalize();
        const dot = _orbCamDir.dot(unitDir);
        if (dot <= 0.08) { o.el.style.display = 'none'; continue; }
        o.el.style.display = '';
        const proj = dirVec.clone().project(camera);
        const sx = (proj.x * 0.5 + 0.5) * cw;
        const sy = (1 - (proj.y * 0.5 + 0.5)) * ch;
        const scale = Math.max(0.55, Math.min(1.15, 0.65 + dot * 0.55));
        o.el.style.left = sx + 'px';
        o.el.style.top = sy + 'px';
        o.el.style.transform = `translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// DRAG (mouse + touch) — gira yaw/pitch. Sem pinch/zoom (não pedido aqui).
// Ao começar a arrastar: para a rotação automática e cancela qualquer
// realinhamento pendente. Ao soltar: agenda o realinhamento (ver
// scheduleIdleRealign).
// ═══════════════════════════════════════════════════════════════════════
function enableDragControl() {
    const cont = _sky.cont;
    let sx = 0, sy = 0;

    function degPerPx() { return CAM_FOV / (cont.clientHeight || window.innerHeight); }

    function applyDelta(dx, dy) {
        const dpp = degPerPx();
        camYaw   += dx * dpp * DRAG_SENS;
        camPitch += dy * dpp * DRAG_SENS;
        updateCameraLook();
    }

    function cancelIdleAndTween() {
        if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
        if (_pitchTween) { _pitchTween.stop(); _pitchTween = null; }
    }

    function startDrag(x, y) {
        dragging = true;
        autoRotating = false;
        cancelIdleAndTween();
        sx = x; sy = y;
    }

    function moveDrag(x, y) {
        if (!dragging) return;
        applyDelta(x - sx, y - sy);
        sx = x; sy = y;
    }

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        scheduleIdleRealign();
    }

    // Mouse
    cont.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY), { passive: true });
    window.addEventListener('mousemove', (e) => { if (dragging) { e.preventDefault(); moveDrag(e.clientX, e.clientY); } }, { passive: false });
    window.addEventListener('mouseup', endDrag, { passive: true });

    // Touch
    cont.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (!dragging || e.touches.length !== 1) return;
        e.preventDefault();
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    window.addEventListener('touchend', () => endDrag(), { passive: true });
    window.addEventListener('touchcancel', () => endDrag(), { passive: true });
}

// ── Ferramenta de calibração (?debugGuildSky=1) ──────────────────────────
// Clique em qualquer ponto do skybox: loga (e mostra na tela) o yaw/pitch
// daquele ponto — útil pra calibrar a faixa de "chão" dos membros
// passeando (ver MEMBER_PITCH_MIN/MAX em guild_members_wander.js).
function initSkyDebugTool() {
    let enabled = false;
    try { enabled = new URLSearchParams(location.search).get('debugGuildSky') === '1'; } catch {}
    if (!enabled) return;

    const raycaster = new THREE.Raycaster();
    _sky.cont.addEventListener('click', (e) => {
        if (dragging) return;
        const rect = _sky.cont.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -(((e.clientY - rect.top) / rect.height) * 2 - 1)
        );
        raycaster.setFromCamera(ndc, _sky.camera);
        const dir = raycaster.ray.direction.clone().normalize();
        const yaw   = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
        const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
        const txt = `yaw: ${yaw.toFixed(1)}, pitch: ${pitch.toFixed(1)}`;
        console.log('[debugGuildSky]', txt);

        const tip = document.createElement('div');
        tip.textContent = txt;
        tip.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;transform:translate(-50%,-130%);
            background:rgba(0,0,0,.85);color:#7f7;font:bold 12px monospace;padding:4px 8px;border:1px solid #0f0;
            border-radius:4px;z-index:99999;pointer-events:none;white-space:nowrap;`;
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 2500);
    });
}

// Depois de IDLE_MS_TO_REALIGN parado, volta o pitch pra 0 suavemente e,
// ao terminar, retoma a rotação automática (a partir do yaw atual — nunca
// pula/reseta horizontalmente).
function scheduleIdleRealign() {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
        _idleTimer = null;
        if (dragging) return; // o jogador já voltou a arrastar antes do timer disparar
        const state = { pitch: camPitch };
        _pitchTween = new TWEEN.Tween(state)
            .to({ pitch: 0 }, PITCH_REALIGN_MS)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(() => { camPitch = state.pitch; updateCameraLook(); })
            .onComplete(() => { _pitchTween = null; autoRotating = true; })
            .start();
    }, IDLE_MS_TO_REALIGN);
}

// ═══════════════════════════════════════════════════════════════════════
// CICLO DE VIDA
// ═══════════════════════════════════════════════════════════════════════
function loop(ts) {
    if (!_sky || !_sky.running) return;
    const dt = Math.min(ts - _lastTs, 100);
    _lastTs = ts;

    if (autoRotating && !dragging) {
        camYaw += ROTATE_DEG_PER_SEC * (dt / 1000);
        updateCameraLook();
    }

    TWEEN.update(ts);
    _sky.camera.updateMatrixWorld(true);
    updateOrbiters();

    if (_sky.pfx) {
        try {
            _sky.pfx.render(_sky.scene, _sky.camera);
        } catch (e) {
            console.error('[GuildSkybox] Erro ao renderizar com pós-processamento, desativando:', e);
            _sky.pfx = null;
            _sky.renderer.render(_sky.scene, _sky.camera);
        }
    } else {
        _sky.renderer.render(_sky.scene, _sky.camera);
    }

    _sky.raf = requestAnimationFrame(loop);
}

function startGuildSkybox() {
    if (_sky) return;
    const layer = buildDom();
    const canvas = document.getElementById('guildSkyboxCanvas');
    const orbitLayer = document.getElementById('guildOrbitLayer');
    const cont = layer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAM_FOV, cont.clientWidth / Math.max(cont.clientHeight, 1), 0.1, 1000);
    camera.position.set(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cont.clientWidth, cont.clientHeight);

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x0d0b08 });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    new THREE.TextureLoader().load(
        SKY_IMAGE_URL,
        (tex) => {
            if (!_sky) return;
            tex.colorSpace = THREE.SRGBColorSpace;
            material.map = tex;
            material.color.set(0xffffff);
            material.needsUpdate = true;
            window.dispatchEvent(new CustomEvent('guildsky:ready'));
        },
        undefined,
        (err) => console.error('[GuildSkybox] Falha ao carregar guildhall.png:', err)
    );

    camYaw = (Math.random() < 0.5 ? 1 : -1) * randBetween(CAM_INITIAL_YAW_MIN, CAM_INITIAL_YAW_MAX);
    camPitch = 0;

    _sky = { scene, camera, renderer, canvas, cont, layer, orbitLayer, running: true, raf: 0, pfx: null, _onResize: null };

    // Mesmo grading "AAA" (bloom/contraste/saturação) usado no skybox da
    // tela de login — só nesta instância do módulo (cada página carrega
    // sua própria cópia do postfx.js, não afeta nenhuma outra tela).
    POSTFX_CONFIG.bloom.threshold = 0.60;
    POSTFX_CONFIG.bloom.strength  = 0.64;
    POSTFX_CONFIG.bloom.radius    = 0.40;

    try {
        _sky.pfx = initPostFX({ scene, camera, renderer, cont });
    } catch (e) {
        console.error('[GuildSkybox] Falha ao iniciar pós-processamento, usando renderização padrão:', e);
        _sky.pfx = null;
    }

    updateCameraLook();
    camera.updateMatrixWorld(true);

    function onResize() {
        if (!_sky) return;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / Math.max(h, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (_sky.pfx) { try { _sky.pfx.resize(w, h); } catch (e) { console.error('[GuildSkybox] Erro no resize:', e); } }
    }
    _sky._onResize = onResize;
    window.addEventListener('resize', onResize);

    enableDragControl();
    initSkyDebugTool();

    document.addEventListener('visibilitychange', () => {
        if (!_sky) return;
        _sky.running = !document.hidden;
        if (_sky.running) { _lastTs = performance.now(); _sky.raf = requestAnimationFrame(loop); }
        else if (_sky.raf) cancelAnimationFrame(_sky.raf);
    });

    _lastTs = performance.now();
    _sky.raf = requestAnimationFrame(loop);
}

// ── API pública ──────────────────────────────────────────────────────
window.GuildSkybox = {
    registerOrbiter,
    unregisterOrbiter,
    yawPitchToVector,
    // "Pronto" aqui significa "câmera/cena existem e dá pra registrar
    // orbitadores" — não depende da textura do skybox já ter carregado
    // (registerOrbiter não usa a textura, só camera/cont).
    isReady: () => !!_sky,
    onReady: (cb) => {
        if (window.GuildSkybox.isReady()) { cb(); return; }
        window.addEventListener('guildsky:ready', cb, { once: true });
    },
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startGuildSkybox);
} else {
    startGuildSkybox();
}
