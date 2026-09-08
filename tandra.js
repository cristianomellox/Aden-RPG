import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ════════════════════════════════════════════════════════════════════════════
// TANDRA — SKYBOX 360° (Three.js)
// Mesma engine da Capital / Vale Arcano: uma câmera perspectiva dentro de
// uma esfera com a imagem panorâmica (equiretangular) projetada por
// dentro. Arrastar gira a câmera (yaw/pitch); "zoom" estreita/alarga o
// FOV. Os .city-hotspot continuam sendo elementos DOM comuns (mesmo
// HTML/CSS de antes — nome + feixe de luz) — a única coisa nova é que
// left/top/scale de cada um são recalculados a cada frame, projetando
// sua coordenada esférica (yaw/pitch) para pixels de tela. NENHUMA
// lógica de loja (mercador.js/oficina.js/chancelaria.js/mestre de
// poções) foi tocada.
//
// IMPORTANTE — CALIBRAÇÃO DOS SPOTS:
// As coordenadas yaw/pitch abaixo em CITY_SPOTS são estimativas
// calculadas a partir da posição do hotspot no ANTIGO mapa top-down
// (não-360) — servem só de ponto de partida e quase certamente vão
// precisar de ajuste depois que a imagem 360 de Tandra for
// publicada em assets/tandra.png. Para calibrar: abra a página com
// ?debugSpots=1 na URL (exatamente como no Vale Arcano/Capital):
// aparecem os contornos tracejados de cada hotspot, e clicando em
// qualquer ponto do céu a tela mostra o yaw/pitch daquele ponto. Copie
// os números para cá.
// ════════════════════════════════════════════════════════════════════════════

const MAP_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/tandra.png'; // mesmo nome de arquivo — só troque o PNG no repositório

let camYaw = 0, camPitch = -6, camFov = 110;
const INITIAL_YAW = 0, INITIAL_PITCH = -6, INITIAL_FOV = 75;
const FOV_MIN = 75, FOV_MAX = 110;   // limites de zoom normal (arrastar/pinch)
const PITCH_LIMIT = 89;
const SPOT_SPHERE_RADIUS = 400;

// yaw/pitch estimados a partir da posição de cada prédio no mapa antigo —
// AJUSTE com ?debugSpots=1 (ver comentário acima).
const CITY_SPOTS = [
    { id: 'btnMercador', yaw: 19, pitch: -9, width: 330, height: 250 },
    { id: 'btnOficina', yaw: -178, pitch: -42, width: 270, height: 350 },
    { id: 'btnPotionMaster', yaw: -3, pitch: -44, width: 160, height: 290 },
    { id: 'btnChancelaria', yaw: -143, pitch: 6, width: 420, height: 320 },
    { id: 'cityGuildHotspot', yaw: -120, pitch: 50, width: 140, height: 150 },
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
    const material = new THREE.MeshBasicMaterial({ color: 0x0d1a0d });
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
        (err) => console.error('[Tandra] Falha ao carregar a imagem 360 do mapa:', err)
    );

    _sky = { scene, camera, renderer, canvas, cont };
    updateCameraLook();

    function onResize() {
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    (function loop() {
        renderer.render(scene, camera);
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

// ── Projeção dos hotspots (yaw/pitch → posição/escala na tela) ─────────
const registeredSpots = [];

function registerAllSpots() {
    const map = document.getElementById('map');
    if (!map) return;
    for (const spot of CITY_SPOTS) {
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
        // Respeita o estado "sem guilda regente" (fetchAndDisplayCityOwner
        // usa dataset.cityHidden em vez de style.display diretamente, já
        // que este loop reescreve display a cada frame).
        if (rs.el.dataset.cityHidden === '1') { rs.el.style.display = 'none'; continue; }

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

// ── Ferramenta de calibração (?debugSpots=1) ─────────────────────
// Idêntica à da Capital/Vale Arcano: mostra contorno tracejado nos hotspots
// e, ao clicar em qualquer ponto do céu, mostra o yaw/pitch daquele ponto
// — cole os números em CITY_SPOTS lá em cima.
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

// ── DRAG / PINCH / WHEEL DO MAPA ─────────────────────────────
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

// ════════════════════════════════════════════════════════════════════════════
// EFEITO "ENTRAR NA ESTRUTURA" — aproximação + fade para preto ao clicar
// num spot de loja (Mercador / Ferreiro / Mestre de Poções / Chancelaria).
// A abertura real de cada modal continua 100% a cargo de mercador.js /
// oficina.js / chancelaria.js / do handler inline do Mestre de Poções —
// este bloco só intercepta o clique, toca a animação, e então deixa o
// clique original prosseguir normalmente (via bypass) já com a tela preta
// cobrindo a troca de cena.
// ════════════════════════════════════════════════════════════════════════════

const SHOP_HOTSPOT_IDS = new Set(['btnMercador', 'btnOficina', 'btnPotionMaster', 'btnChancelaria']);
const CLOSE_TRIGGER_IDS = new Set(['closeMercadorBtn', 'closeOficinaBtn', 'closePotionMasterBtn', 'chancBackBtn']);

let bypassId = null;
let transitioning = false;

function getFade() { return document.getElementById('screenFade'); }

function findSpotConfig(id) { return CITY_SPOTS.find(s => s.id === id); }

// Menor caminho angular entre dois ângulos (evita girar "pelo lado errado").
function shortestAngleDelta(from, to) {
    let d = (to - from) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function playApproachTransition(el) {
    if (transitioning || !_sky) { el.click(); return; }
    const spot = findSpotConfig(el.id);
    const fade = getFade();
    if (!spot || !fade) { el.click(); return; }

    transitioning = true;
    const DURATION = 620; // ms — tempo total da aproximação
    const startYaw = camYaw, startPitch = camPitch, startFov = camFov;
    const dYaw = shortestAngleDelta(startYaw, spot.yaw);
    const targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, spot.pitch));
    const dPitch = targetPitch - startPitch;
    const targetFov = 26; // "dolly in" dramático — bem mais perto que o zoom normal permite
    const t0 = performance.now();

    fade.style.transition = 'opacity .45s ease';

    function step(now) {
        const t = Math.min(1, (now - t0) / DURATION);
        const e = easeInOutQuad(t);
        camYaw   = startYaw + dYaw * e;
        camPitch = startPitch + dPitch * e;
        camFov   = startFov + (targetFov - startFov) * e;
        // Aplica direto (sem o clamp de FOV_MIN normal — aqui queremos ir
        // além do zoom "de passeio" para simular entrar no prédio).
        if (_sky) {
            _sky.camera.fov = camFov;
            _sky.camera.updateProjectionMatrix();
            const dir = yawPitchToVector(camYaw, camPitch, 1);
            _sky.camera.lookAt(dir.x, dir.y, dir.z);
        }
        if (t > 0.45 && !fade.classList.contains('active')) fade.classList.add('active');
        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            // Tela totalmente preta — dispara o clique real (bypass) para
            // abrir o modal correspondente, e só então some com o overlay.
            bypassId = el.id;
            el.click();
            setTimeout(() => {
                camYaw = INITIAL_YAW; camPitch = INITIAL_PITCH; camFov = INITIAL_FOV;
                updateCameraLook();
                fade.classList.remove('active');
                transitioning = false;
            }, 180);
        }
    }
    requestAnimationFrame(step);
}

function instantFadeThenReveal() {
    const fade = getFade();
    if (!fade) return;
    fade.style.transition = 'none';
    fade.classList.add('active');
    camYaw = INITIAL_YAW; camPitch = INITIAL_PITCH; camFov = INITIAL_FOV;
    updateCameraLook();
    requestAnimationFrame(() => {
        fade.style.transition = 'opacity .45s ease';
        requestAnimationFrame(() => fade.classList.remove('active'));
    });
}

function initShopTransitions() {
    const mapContainer = document.getElementById('mapContainer');
    if (!mapContainer) return;

    // Captura o clique ANTES que ele chegue ao próprio hotspot (onde
    // mercador.js/oficina.js/chancelaria.js/o handler do Mestre de Poções
    // estão escutando em fase de bubble) — assim dá pra tocar a animação
    // primeiro e só depois deixar o clique original acontecer.
    mapContainer.addEventListener('click', (e) => {
        const el = e.target.closest('.city-hotspot');
        if (!el || !SHOP_HOTSPOT_IDS.has(el.id)) return;
        if (el.id === bypassId) { bypassId = null; return; } // clique re-disparado pelo próprio efeito — deixa passar
        e.stopPropagation();
        e.preventDefault();
        playApproachTransition(el);
    }, true);

    // Fade simétrico ao sair de qualquer loja (fecha o modal).
    document.addEventListener('click', (e) => {
        const t = e.target.closest('[id]');
        if (t && CLOSE_TRIGGER_IDS.has(t.id)) instantFadeThenReveal();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const chanc = document.getElementById('chancelariaModal');
        if (chanc && chanc.style.display !== 'none') instantFadeThenReveal();
    }, true);
}

// ════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    initSkybox();
    enableMapInteraction();
    initShopTransitions();
    initGuildVictoryModal();
});

// ════════════════════════════════════════════════════════════════════════════
// MODAL ÉPICO: GUILDA REGENTE — abre ao clicar no spot da bandeira/nome
// da guilda regente (#cityGuildHotspot). O nome e a bandeira são lidos
// ao vivo de #guild_name_tandra/#guild_flag_tandra (já preenchidos por
// fetchAndDisplayCityOwner, em tandra.html). Se não houver guilda regente
// no momento (dataset.cityHidden === '1'), o clique não faz nada.
// ════════════════════════════════════════════════════════════════════════════

const GUILD_ID_SUFFIX = 'tandra';

function initGuildVictoryModal() {
    const hotspot = document.getElementById('cityGuildHotspot');
    const modal   = document.getElementById('guildVictoryModal');
    const closeBtn = document.getElementById('closeGuildVictoryBtn');
    if (!hotspot || !modal) return;

    function openModal() {
        if (hotspot.dataset.cityHidden === '1') return; // sem guilda regente agora

        const flagEl = document.getElementById('guild_flag_' + GUILD_ID_SUFFIX);
        const nameEl = document.getElementById('guild_name_' + GUILD_ID_SUFFIX);
        const guildName = (nameEl?.textContent || '').trim() || 'Desconhecida';
        const flagSrc = flagEl?.getAttribute('src') || '';
        const cityDisplayName = window.MERCHANT_CITY || document.title || '';

        const vFlag = document.getElementById('guildVictoryFlag');
        const vName = document.getElementById('guildVictoryName');
        const vMsg  = document.getElementById('guildVictoryMessage');
        if (vFlag) vFlag.setAttribute('src', flagSrc);
        if (vName) vName.textContent = guildName;
        if (vMsg) {
            vMsg.innerHTML = `A guilda <strong style="color:#ffd77a;">${guildName}</strong> venceu a última batalha de guilda em <strong style="color:#ffd77a;">${cityDisplayName}</strong> e se tornou a Guilda Regente!`;
        }

        // Reinicia a animação de entrada mesmo se o modal for aberto de novo.
        const content = modal.querySelector('.gv-content');
        if (content) {
            const POP_ANIM = "gv-pop-in .55s cubic-bezier(.2,1.4,.4,1) both";
            content.style.animation = 'none';
            void content.offsetWidth; // força reflow
            content.style.animation = POP_ANIM;
        }

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }

    hotspot.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display !== 'none') closeModal();
    });
}
