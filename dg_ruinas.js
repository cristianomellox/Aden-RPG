import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { initPostFX } from './postfx.js';

// ═══════════════════════════════════════════════════════════════════════
// RUÍNAS ANCESTRAIS — SKYBOX 360° (Three.js)
// Mesma engine/configuração da Capital: uma câmera perspectiva dentro de uma
// esfera com a imagem panorâmica (equiretangular) projetada por dentro.
// Arrastar gira a câmera (yaw/pitch); "zoom" estreita/alarga o FOV. Os
// .city-hotspot são elementos DOM comuns (nome + feixe de luz) — a cada
// frame, left/top/scale de cada um são recalculados projetando sua
// coordenada esférica (yaw/pitch) para pixels de tela.
//
// CALIBRAÇÃO DOS SPOTS:
// As coordenadas yaw/pitch em RUINS_SPOTS são posições INICIAIS (apenas
// espalhadas pelo panorama). Para posicionar de verdade, abra a página com
// ?debugSpots=1 na URL: aparecem os contornos tracejados de cada hotspot e,
// clicando em qualquer ponto do cenário, a tela mostra o yaw/pitch daquele
// ponto. Copie os números para cá.
// ═══════════════════════════════════════════════════════════════════════

const MAP_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/dgs.png';

// Mesmas configurações de câmera da Capital
let camYaw = 0, camPitch = -6, camFov = 120;
const INITIAL_YAW = 0, INITIAL_PITCH = -6, INITIAL_FOV = 75;
const FOV_MIN = 120, FOV_MAX = 120;   // limites de zoom normal (arrastar/pinch)
const PITCH_LIMIT = 89;
const SPOT_SPHERE_RADIUS = 400;

// AJUSTE com ?debugSpots=1 (ver comentário acima).
const RUINS_SPOTS = [
    { id: 'btnRuinsEntrance', yaw:  34,  pitch: -5, width: 380, height: 580 },
    { id: 'btnSoonDungeon1',  yaw: -90, pitch: 2, width: 380, height: 580 },
    { id: 'btnSoonDungeon2',  yaw:  146, pitch: -6, width: 380, height: 580 },
];

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
        (err) => console.error('[Ruínas] Falha ao carregar a imagem 360 do mapa:', err)
    );

    _sky = { scene, camera, renderer, canvas, cont };

    // Pós-processamento (bloom, iluminação ambiente/contraste/saturação,
    // motion blur) — mesmo efeito usado na Capital (postfx.js).
    // Em try/catch: se falhar, a página continua com renderização padrão.
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

    (function loop() {
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
        updateAllSpotProjections();
        requestAnimationFrame(loop);
    })();

    registerAllSpots();
    initSpotDebugTool();
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

// ── Projeção dos hotspots (yaw/pitch → posição/escala na tela) ──────────
const registeredSpots = [];

function registerAllSpots() {
    const map = document.getElementById('map');
    if (!map) return;
    for (const spot of RUINS_SPOTS) {
        const el = document.getElementById(spot.id);
        if (!el) continue;
        el.style.width  = spot.width  + 'px';
        el.style.height = spot.height + 'px';
        el.style.position = 'absolute';
        const dirVec  = yawPitchToVector(spot.yaw, spot.pitch, SPOT_SPHERE_RADIUS);
        const unitDir = dirVec.clone().normalize();
        registeredSpots.push({ spot, el, dirVec, unitDir });
    }
    updateAllSpotProjections();
}

function updateAllSpotProjections() {
    if (!_sky || !registeredSpots.length) return;
    const { camera, cont } = _sky;
    const cw = cont.clientWidth, ch = cont.clientHeight;
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const baseK  = Math.tan(THREE.MathUtils.degToRad(INITIAL_FOV / 2));
    const curK   = Math.tan(THREE.MathUtils.degToRad(camFov / 2));
    const zoomScale = baseK / curK;

    for (const rs of registeredSpots) {
        const dot = camDir.dot(rs.unitDir);
        if (dot <= 0.05) { rs.el.style.display = 'none'; continue; }
        rs.el.style.display = 'flex';
        const proj = rs.dirVec.clone().project(camera);
        const sx = (proj.x * 0.5 + 0.5) * cw;
        const sy = (1 - (proj.y * 0.5 + 0.5)) * ch;
        rs.el.style.left = sx + 'px';
        rs.el.style.top  = sy + 'px';
        rs.el.style.transform = `translate(-50%, -50%) scale(${zoomScale.toFixed(3)})`;
    }
}

// ── Ferramenta de calibração (?debugSpots=1) ─────────────────────────────
// Mostra contorno tracejado nos hotspots e, ao clicar em qualquer ponto do
// cenário, mostra o yaw/pitch daquele ponto — cole os números em RUINS_SPOTS.
function initSpotDebugTool() {
    let enabled = false;
    try { enabled = new URLSearchParams(location.search).get('debugSpots') === '1'; } catch {}
    if (!enabled) return;
    document.body.classList.add('debug-align');
    const map = document.getElementById('map');
    if (map) map.classList.add('debug-hotspots');

    const raycaster = new THREE.Raycaster();
    document.getElementById('mapContainer').addEventListener('click', (e) => {
        if (!_sky || e.target.closest('.city-hotspot')) return;
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
        console.log('[debugSpots]', txt);

        const tip = document.createElement('div');
        tip.textContent = txt;
        tip.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;transform:translate(-50%,-130%);
            background:rgba(0,0,0,.85);color:#7f7;font:bold 12px monospace;padding:4px 8px;border:1px solid #0f0;
            border-radius:4px;z-index:99999;pointer-events:none;white-space:nowrap;`;
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 2500);
    });
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
