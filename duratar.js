import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { initPostFX } from './postfx.js';

// ════════════════════════════════════════════════════════════════════════════
// DURATAR — SKYBOX 360° (Three.js)
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
// precisar de ajuste depois que a imagem 360 de Duratar for
// publicada em assets/duratar.png. Para calibrar: abra a página com
// ?debugSpots=1 na URL (exatamente como no Vale Arcano/Capital):
// aparecem os contornos tracejados de cada hotspot, e clicando em
// qualquer ponto do céu a tela mostra o yaw/pitch daquele ponto. Copie
// os números para cá.
// ════════════════════════════════════════════════════════════════════════════

const MAP_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/duratar.png'; // mesmo nome de arquivo — só troque o PNG no repositório

let camYaw = 0, camPitch = -6, camFov = 110;
const INITIAL_YAW = 0, INITIAL_PITCH = -6, INITIAL_FOV = 75;
const FOV_MIN = 75, FOV_MAX = 110;   // limites de zoom normal (arrastar/pinch)
const PITCH_LIMIT = 89;
const SPOT_SPHERE_RADIUS = 400;

// yaw/pitch estimados a partir da posição de cada prédio no mapa antigo —
// AJUSTE com ?debugSpots=1 (ver comentário acima).
const CITY_SPOTS = [
    { id: 'btnMercador', yaw: -2, pitch: -10, width: 460, height: 300 },
    { id: 'btnOficina', yaw: 156, pitch: -32, width: 420, height: 440 },
    { id: 'btnPotionMaster', yaw: -33, pitch: -50, width: 260, height: 420 },
    { id: 'btnChancelaria', yaw: 21, pitch: 25, width: 170, height: 150 },
    { id: 'cityGuildHotspot', yaw: -125, pitch: 22, width: 140, height: 150 },
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
        (err) => console.error('[Duratar] Falha ao carregar a imagem 360 do mapa:', err)
    );

    _sky = { scene, camera, renderer, canvas, cont };

    // Pós-processamento (bloom, iluminação ambiente/contraste/saturação,
    // motion blur) — mesmo efeito usado na área de caça (covil_de_kelts.js).
    // Em try/catch: se falhar, o jogo continua com renderização padrão.
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
const CLOSE_TRIGGER_IDS = new Set(['closeMercadorBtn', 'closeOficinaBtn', 'closePmSceneBtn', 'chancBackBtn']);

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
// ao vivo de #guild_name_duratar/#guild_flag_duratar (já preenchidos por
// fetchAndDisplayCityOwner, em duratar.html). Se não houver guilda regente
// no momento (dataset.cityHidden === '1'), o clique não faz nada.
// ════════════════════════════════════════════════════════════════════════════

const GUILD_ID_SUFFIX = 'duratar';

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

// ═══════════════════════════════════════════════════════════════════════
// MESTRE DE POÇÕES — CENÁRIO 3D (skybox próprio + NPC clicável)
// -----------------------------------------------------------------------
// Antes, clicar no hotspot "Mestre de Poções" da cidade abria direto a
// loja (grid de poções). Agora ele abre primeiro este "cômodo" 360°
// (mesma imagem que já era o background do modal da loja) com um NPC
// dentro do próprio mundo 3D — não um <img> do DOM projetado por cima.
// O NPC é um "sprite" do Three.js: uma imagem plana que o motor gráfico
// SEMPRE desenha de frente pra câmera (billboard), então ele nunca
// entorta/deforma ao girar, não importa o ângulo — e continua fixo na
// posição dele dentro do cenário (se você olhar pra outro lado, ele
// some de vista, exatamente como um objeto real na sala). Só ao clicar
// NELE é que a loja (#potionMasterModal) abre de verdade — como antes.
// O X da loja volta para este cenário; o ícone de saída no canto do
// cenário é que volta pra cidade (mesmo efeito de fade dos outros
// modais).
//
// CALIBRAÇÃO DO NPC: abra a página com ?debugSpots=1, entre no cenário
// do Mestre de Poções e clique perto de onde ele deveria ficar —
// aparece um tooltip com yaw/pitch daquele ponto. Copie para
// PM_NPC_SPOT.yaw/pitch logo abaixo. PM_NPC_SPOT.heightFrac controla o
// tamanho dele (fração da altura da tela, no zoom de referência
// PM_INITIAL_FOV); PM_NPC_SPOT.distance é o quão "longe" ele está.
// ═══════════════════════════════════════════════════════════════════════

const PM_SCENE_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/mdp_duratar.png'; // mesma imagem do antigo background do modal da loja
const PM_NPC_IMAGE_URL   = 'https://aden-rpg.pages.dev/assets/mdp_seller_duratar.webp';
const PM_TUTORIAL_KEY    = 'mdpTutorialSeen_duratar'; // localStorage — tutorial não repete depois da 1ª vez
const PM_NPC_PROXY_ID    = 'mdpNpcSpot'; // elemento DOM invisível — só recebe .click() sintético quando o raycaster acerta o sprite

// Onde o vendedor fica DENTRO do cenário 360° (mundo 3D, não a tela).
const PM_NPC_SPOT = {
    yaw: 0, pitch: -54,   // direção dele dentro do cenário — ajuste com ?debugSpots=1
    distance: 250,       // distância dele até a câmera (unidades do mundo 3D)
    heightFrac: 0.35,    // fração da altura da tela que ele ocupa, calibrada no FOV de referência (PM_INITIAL_FOV)
};

const PM_INITIAL_YAW = 0, PM_INITIAL_PITCH = -6, PM_INITIAL_FOV = 110; // referência de câmera/escala ao (re)entrar no cenário
const PM_FOV_MIN = 75, PM_FOV_MAX = 110; // limites de zoom (arrastar/pinch) — mesmos da cidade
const PM_START_FOV = PM_FOV_MAX;         // sempre entra no zoom mínimo (bem aberto), igual à cidade
const PM_PITCH_LIMIT = 89;

let pmYaw = PM_INITIAL_YAW, pmPitch = PM_INITIAL_PITCH, pmFov = PM_START_FOV;

let _pmSky = null;
let _pmNpcSprite = null, _pmNpcMaterial = null;
let _pmNpcBaseScale = { x: 1, y: 1 };
let _pmNpcShadowSprite = null;

// Sombra de contato do NPC — mesmo visual do .mob-shadow da área de caça
// (covil_de_kelts.html): elipse radial escura, borda suave, mix-blend
// "multiply". Como o NPC aqui é um sprite 3D (não um <img> do DOM), a
// sombra também precisa ser um sprite — geramos a textura num <canvas>
// reproduzindo os mesmos stops do gradiente CSS.
function createPmShadowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    // Preto com alpha de verdade (blend alfa padrão, não multiply) — assim
    // a sombra escurece de forma confiável e previsível, sem depender da
    // cor do que está por baixo (multiply ficava imperceptível em pisos
    // já escuros, como percebemos ao testar).
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.00, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.32, 'rgba(0,0,0,0.6)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    grad.addColorStop(0.78, 'rgba(0,0,0,0)');
    grad.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

function pmYawPitchToVector(yawDeg, pitchDeg, radius = 1) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    return new THREE.Vector3(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(yaw) * Math.cos(pitch)
    );
}

function updatePmCameraLook() {
    if (!_pmSky) return;
    pmPitch = Math.max(-PM_PITCH_LIMIT, Math.min(PM_PITCH_LIMIT, pmPitch));
    pmFov   = Math.max(PM_FOV_MIN, Math.min(PM_FOV_MAX, pmFov));
    _pmSky.camera.fov = pmFov;
    _pmSky.camera.updateProjectionMatrix();
    const dir = pmYawPitchToVector(pmYaw, pmPitch, 1);
    _pmSky.camera.lookAt(dir.x, dir.y, dir.z);
}

function initPmSkybox() {
    const cont   = document.getElementById('pmSceneContainer');
    const canvas = document.getElementById('pmSceneCanvas');
    const map    = document.getElementById('pmSceneMap');
    if (!cont || !canvas || !map || _pmSky) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(pmFov, cont.clientWidth / cont.clientHeight, 0.1, 1000);
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
        PM_SCENE_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            material.map = tex;
            material.color.set(0xffffff);
            material.needsUpdate = true;
        },
        undefined,
        (err) => console.error('[MestreDePoções] Falha ao carregar o skybox do cenário:', err)
    );

    _pmSky = { scene, camera, renderer, canvas, cont };

    // Mesmo pós-processamento do mapa da cidade/área de caça — passa
    // mapEl explicitamente porque esta página já tem outro skybox (o da
    // cidade, com #map) rodando ao mesmo tempo; sem isso os dois
    // disputariam o mesmo elemento #map (ver comentário em postfx.js).
    try {
        _pmSky.pfx = initPostFX({ scene, camera, renderer, cont, mapEl: map });
    } catch (e) {
        console.error('[PostFX] Falha ao iniciar pós-processamento no cenário do Mestre de Poções:', e);
        _pmSky.pfx = null;
    }

    updatePmCameraLook();

    window.addEventListener('resize', () => {
        if (!_pmSky || !cont.offsetParent) return;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (_pmSky.pfx) {
            try { _pmSky.pfx.resize(w, h); } catch (e) { console.error('[PostFX] Erro no resize:', e); }
        }
    });

    (function loop() {
        requestAnimationFrame(loop);
        if (!cont.offsetParent) return; // cenário fechado (loja aberta por cima, ou modal escondido) — não desperdiça frame
        if (_pmSky.pfx) {
            try {
                _pmSky.pfx.render(scene, camera);
            } catch (e) {
                console.error('[PostFX] Erro ao renderizar o cenário do Mestre de Poções, desativando efeitos:', e);
                _pmSky.pfx = null;
                renderer.render(scene, camera);
            }
        } else {
            renderer.render(scene, camera);
        }
        updatePmTutorialSpotlight(); // só faz algo enquanto o tutorial está ativo
    })();

    initPmNpcSprite();
    enablePmMapInteraction();
    initPmNpcClickHandler();
}

// ── NPC como sprite 3D — sempre de frente pra câmera (billboard), então  ──
// NUNCA entorta/deforma ao girar. sprite.center = (0.5, 0) ancora o pivô
// nos "pés": a respiração (ver initPmNpcBreathing) cresce pra cima a
// partir do chão, igual transform-origin:bottom center no monstro das
// minas — só que aqui é de verdade no espaço 3D, então nunca "descola".
function initPmNpcSprite() {
    if (!_pmSky || _pmNpcSprite) return;
    new THREE.TextureLoader().load(
        PM_NPC_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            _pmNpcMaterial = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
            const sprite = new THREE.Sprite(_pmNpcMaterial);
            sprite.center.set(0.5, 0);

            const aspect = tex.image.width / tex.image.height;
            const fovRad = THREE.MathUtils.degToRad(PM_INITIAL_FOV);
            const worldHeight = 2 * PM_NPC_SPOT.distance * Math.tan(fovRad / 2) * PM_NPC_SPOT.heightFrac;
            const worldWidth = worldHeight * aspect;
            sprite.scale.set(worldWidth, worldHeight, 1);
            _pmNpcBaseScale = { x: worldWidth, y: worldHeight };

            sprite.position.copy(pmYawPitchToVector(PM_NPC_SPOT.yaw, PM_NPC_SPOT.pitch, PM_NPC_SPOT.distance));
            sprite.renderOrder = 999;

            _pmSky.scene.add(sprite);
            _pmNpcSprite = sprite;

            // Sombra — mesma proporção do .mob-shadow em relação ao
            // .mob-avatar na área de caça (86/125 de largura, 26/160 de
            // altura), ancorada no mesmo ponto (os "pés" do NPC).
            const shadowMaterial = new THREE.SpriteMaterial({
                map: createPmShadowTexture(),
                transparent: true,
                depthWrite: false,
                depthTest: false,
                // Blend alfa padrão (NormalBlending, sem "blending:" custom) —
                // já usa o alpha da textura corretamente, sem o problema do
                // multiply (que ignora alpha e ficava imperceptível/errado).
            });
            const shadowSprite = new THREE.Sprite(shadowMaterial);
            shadowSprite.center.set(0.5, 0.5);
            shadowSprite.scale.set(worldWidth * (86 / 125), worldHeight * (26 / 160), 1);
            shadowSprite.position.copy(sprite.position);
            shadowSprite.renderOrder = 998; // sempre atrás do NPC
            _pmSky.scene.add(shadowSprite);
            _pmNpcShadowSprite = shadowSprite;

            initPmNpcBreathing();
        },
        undefined,
        (err) => console.error('[MestreDePoções] Falha ao carregar o NPC:', err)
    );
}

// ── Clique no NPC (raycast) — abre a loja; fora dele, com ?debugSpots=1, ──
// mostra o yaw/pitch do clique pra calibrar PM_NPC_SPOT.
function initPmNpcClickHandler() {
    const canvas = document.getElementById('pmSceneCanvas');
    if (!canvas || canvas._pmClickBound) return;
    canvas._pmClickBound = true;

    let debugOn = false;
    try { debugOn = new URLSearchParams(location.search).get('debugSpots') === '1'; } catch {}

    const raycaster = new THREE.Raycaster();
    let downX = 0, downY = 0, moved = false;

    canvas.addEventListener('pointerdown', (e) => {
        downX = e.clientX; downY = e.clientY; moved = false;
    });
    canvas.addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) moved = true;
    });
    canvas.addEventListener('pointerup', (e) => {
        if (moved || !_pmSky) return; // foi um arrasto de câmera, não um clique
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -(((e.clientY - rect.top) / rect.height) * 2 - 1)
        );
        raycaster.setFromCamera(ndc, _pmSky.camera);

        if (_pmNpcSprite) {
            const hit = raycaster.intersectObject(_pmNpcSprite)[0];
            if (hit) {
                const proxy = document.getElementById(PM_NPC_PROXY_ID);
                if (proxy) proxy.click(); // dispara a mesma lógica de sempre (abre a loja) — ver #mdpNpcSpot no HTML
                return;
            }
        }

        if (debugOn) {
            const dir = raycaster.ray.direction.clone().normalize();
            const yaw   = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
            const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
            const txt = `yaw: ${yaw.toFixed(1)}, pitch: ${pitch.toFixed(1)}`;
            console.log('[debugSpots][MestreDePoções]', txt);

            const tip = document.createElement('div');
            tip.textContent = txt;
            tip.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;transform:translate(-50%,-130%);
                background:rgba(0,0,0,.85);color:#7f7;font:bold 12px monospace;padding:4px 8px;border:1px solid #0f0;
                border-radius:4px;z-index:99999;pointer-events:none;white-space:nowrap;`;
            document.body.appendChild(tip);
            setTimeout(() => tip.remove(), 2500);
        }
    });
}

// ── Vinheta do tutorial — segue a projeção do NPC na tela a cada frame ───
// (ele está de volta ao mundo 3D, então sua posição na tela muda com a
// câmera; a vinheta acompanha isso normalmente).
function updatePmTutorialSpotlight() {
    const overlay = document.getElementById('pmSceneTutorialOverlay');
    if (!overlay || !overlay.classList.contains('active') || !_pmSky || !_pmNpcSprite) return;
    const { camera, cont } = _pmSky;
    const cw = cont.clientWidth, ch = cont.clientHeight;
    if (!cw || !ch) return;

    const worldPoint = _pmNpcSprite.position.clone();
    worldPoint.y += _pmNpcBaseScale.y * 0.55; // um pouco acima da base — mira no "peito"
    const proj = worldPoint.project(camera);
    if (proj.z > 1) return; // atrás da câmera — não desenha

    const sx = (proj.x * 0.5 + 0.5) * cw;
    const sy = (1 - (proj.y * 0.5 + 0.5)) * ch;
    overlay.style.setProperty('--pm-spot-x', ((sx / cw) * 100).toFixed(1) + '%');
    overlay.style.setProperty('--pm-spot-y', ((sy / ch) * 100).toFixed(1) + '%');
    overlay.style.setProperty('--pm-spot-r', '16%');
}

// ── DRAG / PINCH / WHEEL do cenário — livre nos dois eixos. O sprite do ──
// NPC sempre olha pra câmera (billboard nativo do Three.js), então olhar
// pra cima/baixo/lados nunca o deforma.
function enablePmMapInteraction() {
    const cont   = document.getElementById('pmSceneContainer');
    const canvas = document.getElementById('pmSceneCanvas');
    if (!canvas || !cont || cont._interactionEnabled) return;
    cont._interactionEnabled = true;

    let vx = 0, vy = 0, lt = 0, aId = null;
    const FRICTION = 0.94;
    const DRAG_SENS = 1.0;

    let drag = false, sx = 0, sy = 0;
    let isPinching = false;
    let pinchStartDist = 0, pinchStartFov = pmFov;

    canvas.style.touchAction = 'none';
    canvas.style.userSelect  = 'none';

    function degPerPx() { return pmFov / (cont.clientHeight || window.innerHeight); }

    function applyDelta(dx, dy) {
        const dpp = degPerPx();
        pmYaw   += dx * dpp * DRAG_SENS;
        pmPitch += dy * dpp * DRAG_SENS;
        updatePmCameraLook();
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
            pinchStartFov  = pmFov;
        } else if (e.touches.length === 1 && !isPinching) {
            startDrag(e);
        }
    }

    function onTouchMove(e) {
        if (e.touches.length >= 2 && isPinching) {
            e.preventDefault();
            const ratio = touchDist(e) / pinchStartDist;
            pmFov = pinchStartFov / ratio;
            updatePmCameraLook();
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
        pmFov += e.deltaY * 0.05;
        updatePmCameraLook();
    }

    cont.addEventListener('mousedown', startDrag, { passive: true });
    window.addEventListener('mousemove', onDrag,    { passive: false });
    window.addEventListener('mouseup',   endDrag,   { passive: true });
    cont.addEventListener('wheel', onWheel, { passive: false });

    cont.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend',  onTouchEnd,  { passive: true });
}

// ── Respiração orgânica do NPC — mesma lógica usada no monstro das minas ─
// (ver initMonsterBreathing em mines.js): velocidade/profundidade do
// fôlego derivam lentamente, curva assimétrica de inspirar/expirar, e
// "suspiros" ocasionais mais fundos, além de um leve balanço de peso.
// Aqui aplicada ao sprite 3D: escala (scale) faz o peito crescer a
// partir dos pés (sprite.center=(0.5,0)); rotation do material faz o
// pequeno balanço, girando em torno do mesmo pivô nos pés.
function initPmNpcBreathing() {
    if (!_pmNpcSprite || _pmNpcSprite._pmBreathingStarted) return;
    _pmNpcSprite._pmBreathingStarted = true;

    let breathPhase = Math.random() * Math.PI * 2;
    let swayPhase = Math.random() * Math.PI * 2;

    let breathSpeed = 1, breathDepth = 1, swaySpeed = 0.35;
    let targetBreathSpeed = breathSpeed, targetBreathDepth = breathDepth, targetSwaySpeed = swaySpeed;
    let nextDriftChange = 0;

    let nextDeepBreath = 4000 + Math.random() * 5000;
    let deepBreathBoost = 0, deepBreathTarget = 0, deepBreathHold = 0;

    let lastTime = performance.now();

    function pickNewDriftTargets() {
        targetBreathSpeed = 0.82 + Math.random() * 0.4;
        targetBreathDepth = 0.75 + Math.random() * 0.55;
        targetSwaySpeed = 0.25 + Math.random() * 0.25;
        nextDriftChange = 3000 + Math.random() * 5000;
    }
    pickNewDriftTargets();

    function tick(now) {
        const dt = Math.min(now - lastTime, 100);
        lastTime = now;

        if (document.hidden || !_pmSky || !_pmSky.cont.offsetParent) {
            requestAnimationFrame(tick);
            return;
        }

        nextDriftChange -= dt;
        if (nextDriftChange <= 0) pickNewDriftTargets();

        breathSpeed += (targetBreathSpeed - breathSpeed) * 0.0015 * dt;
        breathDepth += (targetBreathDepth - breathDepth) * 0.0015 * dt;
        swaySpeed += (targetSwaySpeed - swaySpeed) * 0.0015 * dt;

        nextDeepBreath -= dt;
        if (nextDeepBreath <= 0) {
            deepBreathTarget = 1;
            deepBreathHold = 900;
            nextDeepBreath = 7000 + Math.random() * 8000;
        }
        if (deepBreathTarget > 0) {
            deepBreathHold -= dt;
            if (deepBreathHold <= 0) deepBreathTarget = 0;
        }
        deepBreathBoost += (deepBreathTarget - deepBreathBoost) * 0.005 * dt;

        breathPhase += (dt / 1000) * breathSpeed * ((Math.PI * 2) / 4.2);
        swayPhase += (dt / 1000) * swaySpeed * (Math.PI * 2);

        const raw = Math.sin(breathPhase);
        const asym = raw >= 0 ? Math.pow(raw, 0.7) : -Math.pow(-raw, 1.4);

        const breathAmount = asym * 0.012 * breathDepth * (1 + deepBreathBoost * 0.9);
        const scaleY = 1 + breathAmount;
        const scaleX = 1 + breathAmount * 0.43;

        const sway = Math.sin(swayPhase) * 0.6 + Math.sin(swayPhase * 0.47 + 1.3) * 0.3;
        const rotateDeg = sway * 0.12;

        if (_pmNpcSprite) {
            _pmNpcSprite.scale.set(_pmNpcBaseScale.x * scaleX, _pmNpcBaseScale.y * scaleY, 1);
        }
        if (_pmNpcMaterial) {
            _pmNpcMaterial.rotation = THREE.MathUtils.degToRad(rotateDeg);
        }

        // Sombra reage à respiração — mesma fórmula/coeficientes da área de
        // caça (só sem os termos de passo/andar, que não existem aqui: o
        // vendedor fica parado no lugar). Agora com blend alfa padrão,
        // "opacity" funciona normalmente de novo.
        if (_pmNpcShadowSprite) {
            const shadowScale = 1 + Math.max(0, breathAmount) * 0.12;
            const shadowOpacity = 0.82 - Math.max(0, breathAmount) * 0.08;
            _pmNpcShadowSprite.scale.set(
                _pmNpcBaseScale.x * (86 / 125) * shadowScale,
                _pmNpcBaseScale.y * (26 / 160) * shadowScale,
                1
            );
            _pmNpcShadowSprite.material.opacity = Math.min(1, Math.max(0.35, shadowOpacity));
        }

        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

// ── Tutorial "clique no vendedor" — só na 1ª vez, nunca mais repete ──────
function pmShouldShowTutorial() {
    try { return localStorage.getItem(PM_TUTORIAL_KEY) !== '1'; } catch { return true; }
}
function pmMarkTutorialSeen() {
    try { localStorage.setItem(PM_TUTORIAL_KEY, '1'); } catch {}
}
function showPmTutorial() {
    const overlay = document.getElementById('pmSceneTutorialOverlay');
    const text = document.getElementById('pmSceneTutorialText');
    const cont = document.getElementById('pmSceneContainer');
    if (!overlay || !text || !cont) return;
    overlay.classList.add('active');
    text.classList.add('active');

    function dismiss() {
        overlay.classList.remove('active');
        text.classList.remove('active');
        pmMarkTutorialSeen();
    }
    // Qualquer clique na tela (no NPC ou fora dele) esconde o tutorial —
    // captura ANTES do próprio clique do NPC abrir a loja, sem impedir
    // que ela abra (não chama stopPropagation/preventDefault).
    cont.addEventListener('click', dismiss, { capture: true, once: true });
}

// ── Abrir / fechar o cenário 3D do Mestre de Poções ──────────────────────
function openPmScene() {
    const modal = document.getElementById('potionMasterSceneModal');
    if (!modal) return;
    modal.style.display = 'block';
    if (!_pmSky) {
        initPmSkybox();
    } else {
        pmYaw = PM_INITIAL_YAW; pmPitch = PM_INITIAL_PITCH; pmFov = PM_START_FOV;
        updatePmCameraLook();
        const { camera, renderer, cont } = _pmSky;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    if (pmShouldShowTutorial()) showPmTutorial();
}

function closePmScene() {
    const modal = document.getElementById('potionMasterSceneModal');
    if (modal) modal.style.display = 'none';
}

function initPmScene() {
    const openHotspot = document.getElementById('btnPotionMaster');
    const exitBtn = document.getElementById('closePmSceneBtn');
    if (openHotspot) openHotspot.addEventListener('click', openPmScene);
    if (exitBtn) exitBtn.addEventListener('click', closePmScene);
}

document.addEventListener('DOMContentLoaded', initPmScene);
