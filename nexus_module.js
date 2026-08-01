import { supabase } from './supabaseClient.js';

// ══════════════════════════════════════════════════════════════════════
// NEXUS — área PvP/PvE dentro da Batalha de Guildas (v4)
//
// O combate NÃO depende mais de posição/distância no cliente. O servidor
// (nexus_sync) avança um "relógio de combate" por jogador baseado em
// tempo real decorrido — por isso todo mundo continua lutando mobs e
// duelando mesmo com a aba fechada, e não existe mais "errou o alcance".
// O cliente só: (1) anima o andar (decorativo), (2) mostra os resultados
// que o servidor devolve a cada sync, (3) toca a animação REAL do duelo
// (battle_log) quando o próprio jogador participa de um PvP.
// ══════════════════════════════════════════════════════════════════════

const NEXUS_MAP_SIZE = 2121;
const NEXUS_IMG_URL  = 'https://aden-rpg.pages.dev/assets/b_nexus.png';
const AVATAR_W = 70, AVATAR_H = 90;
const ATTACK_MIN_MS = 8000, ATTACK_MAX_MS = 8000; // ataca, espera 8s, ataca de novo
const APPROACH_MS = 750; // duração da "caminhada" até o alvo antes do golpe
const APPROACH_OFFSET = 45; // distância visual entre os dois avatares durante o golpe

// Item 1: proteção de 30s ao entrar (espelha a mesma janela aplicada no
// servidor em _nexus_tick_player) — puramente informativo aqui, o combate
// real já não acontece no servidor durante essa janela.
const ENTRY_PROTECTION_MS = 30000;

const CYCLE_SEC = 11;
const MOVE_SEC  = 3.2;
const MOB_WOBBLE_RADIUS = 45;

const SYNC_BASE_ACTIVE = 60_000;   // teve combate recente: consulta mais rápido
const SYNC_BASE_IDLE   = 70_000;
const SYNC_STEP        = 10_000;
const SYNC_MAX         = 180_000;

// Fallback que NUNCA falha (SVG embutido, sem depender de rede)
const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><rect width="60" height="60" fill="#333"/><circle cx="30" cy="22" r="12" fill="#888"/><path d="M10 54c0-12 9-18 20-18s20 6 20 18" fill="#888"/></svg>`
);

const MOB_TYPES = [
    { key: 'unicornio',      img: 'https://aden-rpg.pages.dev/assets/unicornio.webp',      sound: 'https://aden-rpg.pages.dev/assets/unicornio.mp3' },
    { key: 'satiro',         img: 'https://aden-rpg.pages.dev/assets/satiro.webp',          sound: 'https://aden-rpg.pages.dev/assets/satiro.mp3' },
    { key: 'fenix',          img: 'https://aden-rpg.pages.dev/assets/fenix.webp',           sound: 'https://aden-rpg.pages.dev/assets/fenix.mp3' },
    { key: 'tigrenix',       img: 'https://aden-rpg.pages.dev/assets/tigre_nix.webp',       sound: 'https://aden-rpg.pages.dev/assets/tigre.mp3' },
    { key: 'harpia',         img: 'https://aden-rpg.pages.dev/assets/harpia.webp',          sound: 'https://aden-rpg.pages.dev/assets/fenix.mp3' },
    { key: 'naga',           img: 'https://aden-rpg.pages.dev/assets/naga.webp',            sound: 'https://aden-rpg.pages.dev/assets/zumbi.mp3' },
    { key: 'orium',          img: 'https://aden-rpg.pages.dev/assets/orium.webp',           sound: 'https://aden-rpg.pages.dev/assets/duende.mp3' },
    { key: 'lider_porifero', img: 'https://aden-rpg.pages.dev/assets/lider_porifero.webp',  sound: 'https://aden-rpg.pages.dev/assets/quar.mp3' },
    { key: 'quar',           img: 'https://aden-rpg.pages.dev/assets/quar.webp',            sound: 'https://aden-rpg.pages.dev/assets/quar.mp3' },
    { key: 'duende',         img: 'https://aden-rpg.pages.dev/assets/duende.webp',          sound: 'https://aden-rpg.pages.dev/assets/duende.mp3' },
    { key: 'limut',          img: 'https://aden-rpg.pages.dev/assets/limut.webp',           sound: 'https://aden-rpg.pages.dev/assets/limut.mp3' },
    { key: 'pixie',          img: 'https://aden-rpg.pages.dev/assets/pixie.webp',           sound: 'https://aden-rpg.pages.dev/assets/pixie.mp3' },
    // Item 3: extraídos da caça do Pântano de Molinar
    { key: 'homem_lagarto',  img: 'https://aden-rpg.pages.dev/assets/homem_lagarto.webp',    sound: 'https://aden-rpg.pages.dev/assets/caveira.mp3' },
    { key: 'gorgomo',        img: 'https://aden-rpg.pages.dev/assets/gorgomo.webp',          sound: 'https://aden-rpg.pages.dev/assets/duende.mp3' },
    { key: 'javali',         img: 'https://aden-rpg.pages.dev/assets/javali.webp',           sound: 'https://aden-rpg.pages.dev/assets/fenix.mp3' },
    { key: 'monticulo',      img: 'https://aden-rpg.pages.dev/assets/monticulo_errante.webp', sound: 'https://aden-rpg.pages.dev/assets/quar.mp3' },
    // Item 3: extraídos da caça de Razar
    { key: 'golem_de_gelo',    img: 'https://aden-rpg.pages.dev/assets/golem_de_gelo.webp',     sound: 'https://aden-rpg.pages.dev/assets/quar.mp3' },
    { key: 'aranha_artica',    img: 'https://aden-rpg.pages.dev/assets/aranha_artica.webp',     sound: 'https://aden-rpg.pages.dev/assets/morcego.mp3' },
    { key: 'yeti',             img: 'https://aden-rpg.pages.dev/assets/yeti.webp',              sound: 'https://aden-rpg.pages.dev/assets/limut.mp3' },
    { key: 'fenrir_montanhes', img: 'https://aden-rpg.pages.dev/assets/fenrir_montanhes.webp',  sound: 'https://aden-rpg.pages.dev/assets/tigre.mp3' },
];

// ── ÁUDIO ──────────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioBufs = {};
const SRC = {
    normal:   'https://aden-rpg.pages.dev/assets/normal_hit.mp3',
    critical: 'https://aden-rpg.pages.dev/assets/critical_hit.mp3',
    evade:    'https://aden-rpg.pages.dev/assets/evade.mp3'
};
async function preloadUrl(name, url) {
    try {
        const r = await fetch(url, { cache: 'force-cache' });
        if (!r.ok) return;
        const ab = await r.arrayBuffer();
        audioBufs[name] = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej));
    } catch {}
}
let _soundsPreloaded = false;
function ensureSoundsPreloaded() {
    if (_soundsPreloaded) return;
    _soundsPreloaded = true;
    Object.entries(SRC).forEach(([n, url]) => preloadUrl(n, url));
    MOB_TYPES.forEach(m => preloadUrl('mob_' + m.key, m.sound));
}
function playSoundAt(name, volume) {
    try { if (audioCtx.state === 'suspended') audioCtx.resume(); } catch {}
    const buf = audioBufs[name];
    if (!buf) return;
    try {
        const gain = audioCtx.createGain();
        gain.gain.value = volume;
        gain.connect(audioCtx.destination);
        const s = audioCtx.createBufferSource();
        s.buffer = buf;
        s.connect(gain);
        s.start(0);
        s.onended = () => { try { s.disconnect(); gain.disconnect(); } catch {} };
    } catch {}
}
function baseVolume(name) { return name === 'critical' ? 0.07 : 1; }
function _getViewportCenterOnMap() {
    const cont = document.getElementById('nexusMapContainer');
    if (!cont) return null;
    const cw = cont.clientWidth || window.innerWidth;
    const ch = cont.clientHeight || window.innerHeight;
    return { x: (cw / 2 - panState.x) / panState.scale, y: (ch / 2 - panState.y) / panState.scale };
}
function proximityVolume(targetX, targetY) {
    const vc = _getViewportCenterOnMap();
    if (!vc) return 0.8;
    const dist = Math.hypot(vc.x - targetX, vc.y - targetY);
    return Math.max(0.08, Math.exp(-dist / 300));
}
function playProximitySound(name, x, y) { playSoundAt(name, baseVolume(name) * proximityVolume(x, y)); }

function rand(min, max) { return min + Math.random() * (max - min); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ── MOTOR DE MOVIMENTO DETERMINÍSTICO (só cosmético) ─────────────────
function seedFromId(id) {
    let h = 2166136261 >>> 0;
    const str = String(id);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
}
function hash2(seed, n) {
    let h = (seed ^ Math.imul(n, 0x9E3779B1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
}
function computeWaypoint(seed, cycleIndex, w, h, marginW, marginH) {
    const h1 = hash2(seed, cycleIndex * 2 + 1);
    const h2 = hash2(seed, cycleIndex * 2 + 2);
    return {
        x: marginW + (h1 / 4294967295) * Math.max(1, w - marginW * 2),
        y: marginH + (h2 / 4294967295) * Math.max(1, h - marginH * 2)
    };
}
const wanderState = new Map();
function getCurrentComputedPos(el) {
    const cs = getComputedStyle(el);
    return { x: parseFloat(cs.left) || 0, y: parseFloat(cs.top) || 0 };
}
function scheduleWander(key, el, seed, enteredAtMs, mapSize, marginW, marginH, onMove) {
    let state = wanderState.get(key);
    if (!state) { state = {}; wanderState.set(key, state); }
    clearTimeout(state.timer);
    state.seed = seed; state.enteredAtMs = enteredAtMs;
    state.mapSize = mapSize; state.marginW = marginW; state.marginH = marginH;
    state.el = el;
    const tick = () => {
        if (!el.isConnected) return;
        if (state.pausedUntil && state.pausedUntil > Date.now()) {
            state.timer = setTimeout(tick, state.pausedUntil - Date.now() + 20);
            return;
        }
        const elapsedSec = (Date.now() - state.enteredAtMs) / 1000;
        const cycleIndex = Math.floor(elapsedSec / CYCLE_SEC);
        const cyclePos = elapsedSec - cycleIndex * CYCLE_SEC;
        const wp = computeWaypoint(state.seed, cycleIndex, state.mapSize, state.mapSize, state.marginW, state.marginH);
        if (cyclePos < MOVE_SEC) {
            const remainingMs = (MOVE_SEC - cyclePos) * 1000;
            el.style.transition = `left ${remainingMs}ms linear, top ${remainingMs}ms linear`;
            el.style.left = wp.x + 'px'; el.style.top = wp.y + 'px';
            state.lastX = wp.x; state.lastY = wp.y;
            if (typeof onMove === 'function') onMove(wp.x, wp.y, remainingMs);
            state.timer = setTimeout(tick, remainingMs + 30);
        } else {
            el.style.transition = 'none';
            el.style.left = wp.x + 'px'; el.style.top = wp.y + 'px';
            state.lastX = wp.x; state.lastY = wp.y;
            if (typeof onMove === 'function') onMove(wp.x, wp.y, 0);
            state.timer = setTimeout(tick, (CYCLE_SEC - cyclePos) * 1000 + 30);
        }
    };
    tick();
}
function pauseWander(key, ms) {
    const state = wanderState.get(key);
    if (!state || !state.el) return;
    const pos = getCurrentComputedPos(state.el);
    state.el.style.transition = 'none';
    state.el.style.left = pos.x + 'px'; state.el.style.top = pos.y + 'px';
    state.lastX = pos.x; state.lastY = pos.y;
    state.pausedUntil = Date.now() + ms;
}
function stopWander(key) {
    const state = wanderState.get(key);
    if (state) { clearTimeout(state.timer); wanderState.delete(key); }
}
function getEntityPos(key) {
    const state = wanderState.get(key);
    if (!state || state.lastX === undefined) return null;
    return { x: state.lastX, y: state.lastY };
}

function rangeSq(a, b) { return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2); }

// ══════════════════════════════════════════════════════════════════════
// LOOP VISUAL LOCAL DE COMBATE — 100% cosmético (o resultado mecânico real
// sempre vem do servidor via my_pve_ticks/my_combats). Dá a sensação de
// "aproximar, golpear uma vez, voltar a andar" igual à página de caça,
// mesmo que o alvo/servidor não tenham nenhuma noção de posição.
// ══════════════════════════════════════════════════════════════════════
let localCombatTimeout = null;
let localCombatPaused = false;

function scheduleLocalCombatLoop() {
    clearTimeout(localCombatTimeout);
    if (!running || isDeadLocal || localCombatPaused) return;
    if (isEntryProtected()) {
        // Item 1: nada de combate (nem cosmético) enquanto protegido —
        // só reagenda para o instante em que a proteção acaba.
        localCombatTimeout = setTimeout(scheduleLocalCombatLoop, (ownEnteredAtMs + ENTRY_PROTECTION_MS - Date.now()) + 50);
        return;
    }
    localCombatTimeout = setTimeout(doLocalCombatTick, rand(ATTACK_MIN_MS, ATTACK_MAX_MS));
}
function pauseLocalCombatLoop() {
    localCombatPaused = true;
    clearTimeout(localCombatTimeout);
}
function resumeLocalCombatLoop() {
    localCombatPaused = false;
    scheduleLocalCombatLoop();
}

async function doLocalCombatTick() {
    if (!running || isDeadLocal || localCombatPaused) return;

    const ownPos = getEntityPos('own');
    const ownEl = document.getElementById('nexusOwnPlayer');
    if (!ownPos || !ownEl) { scheduleLocalCombatLoop(); return; }

    // Mob VIVO mais próximo (revalida no instante do golpe também — item 3:
    // nunca ataca mob morto/inexistente, mesmo em cooldown de respawn)
    let nearestMobPos = null, nearestMobDist = Infinity, nearestMobIdx = null;
    mobsCache.forEach((entry, idx) => {
        if (entry.el.classList.contains('dead') || entry.el.classList.contains('nx-mob-dying')) return;
        const pos = getEntityPos('mob:' + idx) || entry.basePos;
        const d = rangeSq(ownPos, pos);
        if (d < nearestMobDist) { nearestMobDist = d; nearestMobPos = pos; nearestMobIdx = idx; }
    });

    // Jogador inimigo vivo mais próximo — NUNCA da própria guilda (item 3)
    let nearestPlayerPos = null, nearestPlayerDist = Infinity, nearestPlayerId = null;
    otherPlayersCache.forEach((entry, id) => {
        if (entry.isDead) return;
        if (ctx && entry.guildId != null && entry.guildId === ctx.guildId) return;
        const pos = getEntityPos('player:' + id);
        if (!pos) return;
        const d = rangeSq(ownPos, pos);
        if (d < nearestPlayerDist) { nearestPlayerDist = d; nearestPlayerId = id; nearestPlayerPos = pos; }
    });

    const targetIsMob = nearestMobPos && (!nearestPlayerPos || nearestMobDist <= nearestPlayerDist);
    const targetPos = targetIsMob ? nearestMobPos : nearestPlayerPos;

    if (!targetPos) { scheduleLocalCombatLoop(); return; } // nada por perto: só continua andando

    // ── Aproximação: caminha até ficar ao lado do alvo antes de golpear ──
    stopWander('own');
    const angle = Math.random() * Math.PI * 2;
    const approachX = Math.max(0, Math.min(NEXUS_MAP_SIZE - AVATAR_W, targetPos.x + Math.cos(angle) * APPROACH_OFFSET));
    const approachY = Math.max(0, Math.min(NEXUS_MAP_SIZE - AVATAR_H, targetPos.y + Math.sin(angle) * APPROACH_OFFSET));
    wanderState.set('own', { el: ownEl, lastX: approachX, lastY: approachY });
    ownEl.style.transition = `left ${APPROACH_MS}ms linear, top ${APPROACH_MS}ms linear`;
    ownEl.style.left = approachX + 'px';
    ownEl.style.top = approachY + 'px';
    if (cameraFollow) centerCameraOn(approachX + AVATAR_W / 2, approachY + AVATAR_H / 2, true, APPROACH_MS);
    else updateFogPosition();

    await new Promise(r => setTimeout(r, APPROACH_MS + 60));
    if (!running || isDeadLocal || localCombatPaused) return;

    // ── Golpe único (item 2: nunca mais de um por alvo) ──
    if (targetIsMob) {
        const entry = mobsCache.get(nearestMobIdx);
        if (entry && !entry.el.classList.contains('dead') && !entry.el.classList.contains('nx-mob-dying')) {
            const isCrit = Math.random() < 0.15;
            flashHit(ownEl);
            flashHit(entry.el);
            // Item 1: som do golpe toca no MESMO instante do flash; o som do
            // próprio mob (rugido/grito) só 300ms depois, igual à caça.
            playProximitySound(isCrit ? 'critical' : 'normal', targetPos.x, targetPos.y);
            setTimeout(() => playProximitySound('mob_' + entry.type.key, targetPos.x, targetPos.y), 300);
        }
    } else if (nearestPlayerId) {
        const entry = otherPlayersCache.get(nearestPlayerId);
        if (entry && !entry.isDead) {
            // Encontro casual — sem resultado aqui. Se o servidor confirmar um
            // duelo de verdade depois, o duelo animado real toca via my_combats.
            flashHit(ownEl);
            flashHit(entry.wrap);
            playProximitySound('normal', targetPos.x, targetPos.y);
        }
    }

    await new Promise(r => setTimeout(r, 350));

    // ── Volta a andar até o próximo alvo ──
    if (running && !isDeadLocal && !localCombatPaused) {
        resumeWanderSmoothlyAfterCombat();
    }
    scheduleLocalCombatLoop();
}

// Aproximação do ATACANTE quando EU sou o alvo (fui desafiado) — puramente
// visual, encena o "encontro" antes do duelo de verdade tocar.
function ensureChallengeOverlay() {
    if (document.getElementById('nexusChallengeOverlay')) return;
    const el = document.createElement('div');
    el.id = 'nexusChallengeOverlay';
    el.innerHTML = `
        <div id="nexusChallengeGlow"></div>
        <p id="nexusChallengeText">Um duelo está prestes a começar</p>
        <h2 id="nexusChallengeTimer">5</h2>
    `;
    document.body.appendChild(el);
}
function showChallengeOverlay(seconds) {
    return new Promise(resolve => {
        ensureChallengeOverlay();
        const el = document.getElementById('nexusChallengeOverlay');
        const timerEl = document.getElementById('nexusChallengeTimer');
        let remaining = seconds;
        timerEl.textContent = String(remaining);
        el.classList.add('active');
        playSoundAt('critical', 0.5);
        const interval = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(interval);
                el.classList.remove('active');
                resolve();
                return;
            }
            timerEl.textContent = String(remaining);
        }, 1000);
    });
}
async function playApproachAnimation(opponentId, opponentName, iAmDefender) {
    const ownPos = getEntityPos('own');
    if (!ownPos) { await new Promise(r => setTimeout(r, 300)); return; }

    const oppEntry = otherPlayersCache.get(opponentId);
    const angle = Math.random() * Math.PI * 2;

    if (iAmDefender) {
        // O outro jogador vem até mim
        pauseWander('own', 3000);
        if (oppEntry && oppEntry.wrap) {
            pauseWander('player:' + opponentId, 3000);
            const nearX = Math.max(0, Math.min(NEXUS_MAP_SIZE - AVATAR_W, ownPos.x + Math.cos(angle) * APPROACH_OFFSET));
            const nearY = Math.max(0, Math.min(NEXUS_MAP_SIZE - AVATAR_H, ownPos.y + Math.sin(angle) * APPROACH_OFFSET));
            oppEntry.wrap.style.transition = `left ${APPROACH_MS}ms ease-in-out, top ${APPROACH_MS}ms ease-in-out`;
            oppEntry.wrap.style.left = nearX + 'px';
            oppEntry.wrap.style.top = nearY + 'px';
            const oState = wanderState.get('player:' + opponentId);
            if (oState) { oState.lastX = nearX; oState.lastY = nearY; }
            await new Promise(r => setTimeout(r, APPROACH_MS + 100));
        } else {
            await new Promise(r => setTimeout(r, 400));
        }
    } else {
        // Eu vou até o outro jogador
        pauseLocalCombatLoop();
        const ownEl = document.getElementById('nexusOwnPlayer');
        if (oppEntry && oppEntry.wrap && ownEl) {
            pauseWander('player:' + opponentId, 3000);
            const oppPos = getEntityPos('player:' + opponentId) || ownPos;
            const nearX = Math.max(0, Math.min(NEXUS_MAP_SIZE - AVATAR_W, oppPos.x + Math.cos(angle) * APPROACH_OFFSET));
            const nearY = Math.max(0, Math.min(NEXUS_MAP_SIZE - AVATAR_H, oppPos.y + Math.sin(angle) * APPROACH_OFFSET));
            stopWander('own');
            wanderState.set('own', { el: ownEl, lastX: nearX, lastY: nearY });
            ownEl.style.transition = `left ${APPROACH_MS}ms linear, top ${APPROACH_MS}ms linear`;
            ownEl.style.left = nearX + 'px';
            ownEl.style.top = nearY + 'px';
            if (cameraFollow) centerCameraOn(nearX + AVATAR_W / 2, nearY + AVATAR_H / 2, true, APPROACH_MS);
            else updateFogPosition();
            await new Promise(r => setTimeout(r, APPROACH_MS + 100));
        } else {
            await new Promise(r => setTimeout(r, 400));
        }
    }
}

// ── MOLDURAS DE AVATAR ───────────────────────────────────────────────
function _nxAddFrame(parentEl, frameW) {
    parentEl.querySelectorAll('.nx-frame-ol,.nx-frame-sh').forEach(e => e.remove());
    const fr = document.createElement('div');
    fr.className = 'nx-frame-ol';
    fr.style.cssText = `position:absolute;left:50%;transform:translateX(-50%);width:${frameW}px;height:${frameW}px;pointer-events:none;z-index:20;background-size:contain;background-repeat:no-repeat;background-position:center;display:none;top:0;`;
    const sh = document.createElement('div');
    sh.className = 'nx-frame-sh';
    sh.style.cssText = `position:absolute;left:50%;transform:translateX(-50%);width:${frameW}px;height:${frameW}px;pointer-events:none;z-index:21;display:none;top:0;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;overflow:hidden;`;
    parentEl.appendChild(fr); parentEl.appendChild(sh);
    return { fr, sh };
}
function _nxPositionFrameOffset(fr, sh, avatarEl, frameW, avatarPx) {
    if (!fr || !sh || !avatarEl || !fr.isConnected) return;
    const t = avatarEl.offsetTop - Math.round((frameW - avatarPx) / 2) - 3;
    fr.style.top = t + 'px'; sh.style.top = t + 'px';
}
function _nxApplyFrame(fr, sh, frameUrl, avatarEl, defaultBorder) {
    if (!fr || !sh) return;
    if (frameUrl) {
        fr.style.backgroundImage = `url('${frameUrl}')`; fr.style.display = 'block';
        if (avatarEl) avatarEl.style.border = 'none';
        sh.style.webkitMaskImage = `url('${frameUrl}')`; sh.style.maskImage = `url('${frameUrl}')`; sh.style.display = 'block';
    } else {
        fr.style.backgroundImage = ''; fr.style.display = 'none'; sh.style.display = 'none';
        if (avatarEl && defaultBorder) avatarEl.style.border = defaultBorder;
    }
}
async function _nxFetchFrame(pid, fr, sh, avatarEl, defaultBorder) {
    if (!pid) return;
    try {
        const { data, error } = await supabase.rpc('get_player_skin_urls', { p_player_id: pid });
        if (error) { _nxApplyFrame(fr, sh, null, avatarEl, defaultBorder); return; }
        _nxApplyFrame(fr, sh, data?.frame_url || null, avatarEl, defaultBorder);
    } catch (e) { _nxApplyFrame(fr, sh, null, avatarEl, defaultBorder); }
}

// ── MODAIS ────────────────────────────────────────────────────────────
function ensureConfirmModal() {
    if (document.getElementById('nexusConfirmModal')) return;
    const modal = document.createElement('div');
    modal.id = 'nexusConfirmModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="modal-close" id="nexusConfirmClose">&times;</span>
            <h3>Nexus</h3>
            <p>Essa é uma área com PvP e PvE, com chances de obter ações extras. Deseja entrar?</p>
            <div style="text-align:center; margin-top:16px; display:flex; gap:10px; justify-content:center;">
                <button id="nexusConfirmCancelBtn" class="action-btn" style="background-color:#555;">Cancelar</button>
                <button id="nexusConfirmYesBtn" class="action-btn">Entrar</button>
            </div>
            <p id="nexusConfirmMessage" style="color:#ffc107; text-align:center; margin-top:10px;"></p>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('nexusConfirmClose').onclick = () => modal.style.display = 'none';
    document.getElementById('nexusConfirmCancelBtn').onclick = () => modal.style.display = 'none';
}
export function openNexusConfirmModal(onConfirm) {
    ensureConfirmModal();
    const modal = document.getElementById('nexusConfirmModal');
    const msg = document.getElementById('nexusConfirmMessage');
    msg.textContent = '';
    modal.style.display = 'flex';
    document.getElementById('nexusConfirmYesBtn').onclick = async () => {
        document.getElementById('nexusConfirmYesBtn').disabled = true;
        const result = await onConfirm();
        document.getElementById('nexusConfirmYesBtn').disabled = false;
        if (result === true || (result && result.success)) modal.style.display = 'none';
        else msg.textContent = (result && result.message) ? result.message : 'Não foi possível entrar no Nexus agora.';
    };
}

function ensureCantLeaveModal() {
    if (document.getElementById('nexusCantLeaveModal')) return;
    const modal = document.createElement('div');
    modal.id = 'nexusCantLeaveModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="modal-close" id="nexusCantLeaveClose">&times;</span>
            <h3>Você não pode sair agora</h3>
            <p id="nexusCantLeaveText" style="color:#ffc107; font-weight:bold; text-align:center; font-size:1.15em;"></p>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('nexusCantLeaveClose').onclick = () => { modal.style.display = 'none'; clearInterval(modal._interval); };
}
function showCantLeaveModal(closesAtIso) {
    ensureCantLeaveModal();
    const modal = document.getElementById('nexusCantLeaveModal');
    const textEl = document.getElementById('nexusCantLeaveText');
    const until = new Date(closesAtIso).getTime();
    clearInterval(modal._interval);
    const tick = () => {
        const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        textEl.textContent = `Você só poderá sair do Nexus em ${t} ou caso seja eliminado.`;
        if (s <= 0) clearInterval(modal._interval);
    };
    tick();
    modal._interval = setInterval(tick, 1000);
    modal.style.display = 'flex';
}

function ensureReviveChoiceModal() {
    if (document.getElementById('nexusReviveModal')) return;
    const modal = document.createElement('div');
    modal.id = 'nexusReviveModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Você reviveu!</h3>
            <p>Deseja continuar na zona do Nexus ou voltar para a tela de objetivos?</p>
            <div style="text-align:center; margin-top:16px; display:flex; gap:10px; justify-content:center;">
                <button id="nexusReviveLeaveBtn" class="action-btn" style="background-color:#555;">Voltar aos objetivos</button>
                <button id="nexusReviveStayBtn" class="action-btn">Continuar no Nexus</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}
function showReviveChoiceModal(onStay, onLeave) {
    ensureReviveChoiceModal();
    const modal = document.getElementById('nexusReviveModal');
    modal.style.display = 'flex';
    document.getElementById('nexusReviveStayBtn').onclick = () => { modal.style.display = 'none'; onStay(); };
    document.getElementById('nexusReviveLeaveBtn').onclick = () => { modal.style.display = 'none'; onLeave(); };
}

// ── DUELO ANIMADO (dados REAIS do simulate_pvp_battle, mesmo do que a caça usa) ──
function ensureDuelModal() {
    if (document.getElementById('nexusDuelModal')) return;
    const modal = document.createElement('div');
    modal.id = 'nexusDuelModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:520px;">
            <h3 id="nexusDuelTitle">Duelo!</h3>
            <div style="display:flex; justify-content:space-between; gap:14px; margin-top:10px;">
                <div style="flex:1; text-align:center;">
                    <img id="nexusDuelAtkAvatar" src="${DEFAULT_AVATAR}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #48f;">
                    <div id="nexusDuelAtkName" style="font-weight:bold; font-size:.85em; margin-top:4px;"></div>
                    <div class="nexus-hp-bar" style="width:100%; margin:4px auto;"><div id="nexusDuelAtkHp" class="nexus-hp-bar-fill"></div></div>
                    <div id="nexusDuelAtkHpText" style="font-size:.7em; color:#ccc;"></div>
                </div>
                <div style="align-self:center; font-weight:bold; color:#f88;">VS</div>
                <div style="flex:1; text-align:center;">
                    <img id="nexusDuelDefAvatar" src="${DEFAULT_AVATAR}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #f44;">
                    <div id="nexusDuelDefName" style="font-weight:bold; font-size:.85em; margin-top:4px;"></div>
                    <div class="nexus-hp-bar" style="width:100%; margin:4px auto;"><div id="nexusDuelDefHp" class="nexus-hp-bar-fill"></div></div>
                    <div id="nexusDuelDefHpText" style="font-size:.7em; color:#ccc;"></div>
                </div>
            </div>
            <p id="nexusDuelResult" style="text-align:center; font-weight:bold; margin-top:14px; min-height:1.4em;"></p>
        </div>`;
    document.body.appendChild(modal);
}
async function playRealDuelAnimation(entry) {
    ensureDuelModal();
    const combat = entry.combat || {};
    const log = combat.battle_log || [];
    const atkId = combat.attacker_id;
    const modal = document.getElementById('nexusDuelModal');

    document.getElementById('nexusDuelTitle').textContent = 'Duelo no Nexus!';
    document.getElementById('nexusDuelAtkName').textContent = entry.attacker_name || 'Atacante';
    document.getElementById('nexusDuelDefName').textContent = entry.defender_name || 'Defensor';
    document.getElementById('nexusDuelResult').textContent = '';

    const atkAv = document.getElementById('nexusDuelAtkAvatar');
    const defAv = document.getElementById('nexusDuelDefAvatar');
    atkAv.src = ownAvatarUrl || DEFAULT_AVATAR;
    const oppEntry = otherPlayersCache.get(entry.attacker_id === ctx.playerId ? entry.defender_id : entry.attacker_id);
    defAv.src = (oppEntry && oppEntry.av && oppEntry.av.src) || DEFAULT_AVATAR;
    if (entry.attacker_id !== ctx.playerId) { atkAv.src = (oppEntry && oppEntry.av && oppEntry.av.src) || DEFAULT_AVATAR; defAv.src = ownAvatarUrl || DEFAULT_AVATAR; }

    const atkFill = document.getElementById('nexusDuelAtkHp');
    const defFill = document.getElementById('nexusDuelDefHp');
    const atkTxt = document.getElementById('nexusDuelAtkHpText');
    const defTxt = document.getElementById('nexusDuelDefHpText');

    const dmgToDef = log.filter(t => t.attacker_id === atkId).reduce((s, t) => s + (t.damage || 0), 0);
    const dmgToAtk = log.filter(t => t.attacker_id !== atkId).reduce((s, t) => s + (t.damage || 0), 0);
    const defMaxHp = Math.max(1, (combat.defender_health_left || 0) + dmgToDef);
    const atkMaxHp = Math.max(1, (combat.attacker_health_left || 0) + dmgToAtk);
    let curAtk = atkMaxHp, curDef = defMaxHp;

    function upd() {
        setHpBar(atkFill, Math.max(0, (curAtk / atkMaxHp) * 100));
        setHpBar(defFill, Math.max(0, (curDef / defMaxHp) * 100));
        atkTxt.textContent = Math.max(0, curAtk) + ' / ' + atkMaxHp;
        defTxt.textContent = Math.max(0, curDef) + ' / ' + defMaxHp;
    }
    upd();
    modal.style.display = 'flex';

    for (const turn of log) {
        await new Promise(r => setTimeout(r, 500));
        const isAtk = turn.attacker_id === atkId;
        if (isAtk) curDef = Math.max(0, curDef - (turn.damage || 0));
        else curAtk = Math.max(0, curAtk - (turn.damage || 0));

        const targetAv = isAtk ? defAv : atkAv;
        if (turn.evaded) {
            playSoundAt('evade', baseVolume('evade'));
        } else {
            targetAv.classList.remove('nx-hit-shake', 'nx-hit-flash');
            void targetAv.offsetWidth;
            targetAv.classList.add('nx-hit-shake', 'nx-hit-flash');
            setTimeout(() => targetAv.classList.remove('nx-hit-shake', 'nx-hit-flash'), 450);
            playSoundAt(turn.critical ? 'critical' : 'normal', baseVolume(turn.critical ? 'critical' : 'normal'));
        }
        upd();
    }

    await new Promise(r => setTimeout(r, 300));
    document.getElementById('nexusDuelResult').textContent = entry.attacker_won
        ? `${entry.attacker_name} venceu o duelo!`
        : `${entry.defender_name} venceu o duelo!`;

    await new Promise(r => setTimeout(r, 1600));
    modal.style.display = 'none';
}

// ── ENTRAR / SAIR ─────────────────────────────────────────────────────
export async function enterNexus(instanceId) {
    const { data, error } = await supabase.rpc('enter_nexus', { p_battle_instance_id: instanceId });
    if (error || !data || !data.success) return { success: false, message: error?.message || data?.message };
    return data;
}
export async function leaveNexus(instanceId) {
    const { data, error } = await supabase.rpc('leave_nexus', { p_battle_instance_id: instanceId });
    if (error) return { success: false, message: error.message };
    return data;
}

// ── ESTADO DO MÓDULO ─────────────────────────────────────────────────
let ctx = null;
let ownEnteredAtMs = 0;
let ownSeed = 0;
let ownAvatarUrl = null;
let syncTimeout = null;
let running = false;
let isDeadLocal = false;
let deadOverlayInterval = null;
let protectionInterval = null;
let onForceExitCb = null;
let onBannerEventCb = null;
let onDeadTimerEndCb = null;
let otherPlayersCache = new Map();
let mobsCache = new Map();
let lastEventTs = '1970-01-01T00:00:00+00:00';
let syncInFlight = false;
let hadRecentActivity = false;
let cameraFollow = true;
let ownHpFill = null;
let lastKnownOwnHp = null;
let mapControls = null;
let currentSyncMs = SYNC_BASE_IDLE;
// Item 3: contador de falhas consecutivas de sync. Sem isso, se o
// dispositivo dorme por horas (token de auth expira, rede cai, etc.), ao
// acordar o doSync() ficava tentando de novo pra sempre em loop de retry
// SILENCIOSO (só um debug-line discreto), com o jogador "preso" olhando a
// última tela conhecida do Nexus mesmo depois da janela já ter fechado
// várias vezes — sem nunca desistir e voltar pra tela principal.
let consecutiveSyncFailures = 0;
const MAX_CONSECUTIVE_SYNC_FAILURES = 4;
let lastVisibleAtMs = Date.now();
let timerBaseSeconds = 0;
let timerBaseAtMs = 0;
let timerInterval = null;

const panState = { x: 0, y: 0, scale: 1, minScale: 0.5 };

// ── DOM ───────────────────────────────────────────────────────────────
function ensureNexusDOM() {
    if (document.getElementById('nexusScreen')) return;
    const screen = document.createElement('div');
    screen.id = 'nexusScreen';
    screen.style.display = 'none';
    screen.innerHTML = `
        <div id="nexusHeader">
            <button id="nexusBackBtn" title="Voltar">
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <div id="nexusTimer">--:--</div>
            <button id="nexusCameraBtn" class="active" title="Câmera segue o jogador">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
                    <line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/>
                </svg>
                <span>Câmera</span>
            </button>
            <div id="nexusActions">Ações: -- / 5</div>
        </div>
        <div id="nexusMapContainer"><div id="nexusMap"></div></div>
        <div id="nexusDeadOverlay">
            <img id="nexusDeadAvatar" src="${DEFAULT_AVATAR}">
            <p>Você foi derrotado!</p>
            <div id="nexusDeadTimer">05:00</div>
        </div>
    `;
    document.body.appendChild(screen);
}
export { ensureNexusDOM };

// ── PROTEÇÃO DE ENTRADA (item 1) ──────────────────────────────────────
function isEntryProtected() {
    return (Date.now() - ownEnteredAtMs) < ENTRY_PROTECTION_MS;
}
function ensureProtectionBadge() {
    if (document.getElementById('nexusProtectionBadge')) return;
    const el = document.createElement('div');
    el.id = 'nexusProtectionBadge';
    el.style.cssText = 'position:absolute; top:58px; left:50%; transform:translateX(-50%); z-index:40; background:rgba(20,140,80,0.92); color:#fff; font-size:12px; font-weight:bold; padding:5px 12px; border-radius:14px; box-shadow:0 2px 8px rgba(0,0,0,.4); pointer-events:none; display:flex; align-items:center; gap:6px; white-space:nowrap;';
    el.innerHTML = `🛡️ <span id="nexusProtectionText">Protegido</span>`;
    const screen = document.getElementById('nexusScreen');
    if (screen) screen.appendChild(el);
}
function showProtectionBadgeIfNeeded() {
    if (!isEntryProtected()) return;
    ensureProtectionBadge();
    const el = document.getElementById('nexusProtectionBadge');
    const txt = document.getElementById('nexusProtectionText');
    if (!el || !txt) return;
    el.style.display = 'flex';
    clearInterval(protectionInterval);
    const tick = () => {
        const remaining = Math.max(0, Math.ceil((ownEnteredAtMs + ENTRY_PROTECTION_MS - Date.now()) / 1000));
        txt.textContent = `Protegido: ${remaining}s`;
        if (remaining <= 0) {
            clearInterval(protectionInterval); protectionInterval = null;
            el.style.display = 'none';
        }
    };
    tick();
    protectionInterval = setInterval(tick, 1000);
}

function pickMobType(mobIndex) {
    let seed = 0;
    const str = 'nexus-mob-' + mobIndex;
    for (let i = 0; i < str.length; i++) seed = (seed * 31 + str.charCodeAt(i)) >>> 0;
    return MOB_TYPES[seed % MOB_TYPES.length];
}
function buildHpBar() {
    const bar = document.createElement('div');
    bar.className = 'nexus-hp-bar';
    const fill = document.createElement('div');
    fill.className = 'nexus-hp-bar-fill';
    bar.appendChild(fill);
    return { bar, fill };
}
function setHpBar(fillEl, pct) {
    pct = Math.max(0, Math.min(100, pct));
    fillEl.style.width = pct + '%';
    fillEl.classList.toggle('low', pct <= 30);
}
function flashHit(wrapEl) {
    const av = wrapEl.querySelector('.nexus-player-avatar, .nexus-mob-avatar');
    if (!av) return;
    av.classList.remove('nx-hit-shake', 'nx-hit-flash');
    void av.offsetWidth;
    av.classList.add('nx-hit-shake', 'nx-hit-flash');
    setTimeout(() => av.classList.remove('nx-hit-shake', 'nx-hit-flash'), 450);
}

// ── ANIMAÇÃO DE MORTE/RESPAWN DOS MOBS (item 4) ───────────────────────
// Mesma técnica usada na página de caça (mob-dying/mob-respawning): o mob
// encolhe, esmaece e "afunda" em vez de simplesmente sumir. Injetada via
// <style> própria do módulo (não depende do conteúdo de nexus.css).
const MOB_DEATH_ANIM_MS = 850;
const MOB_RESPAWN_ANIM_MS = 700;
let _mobDeathStylesInjected = false;
function ensureMobDeathStyles() {
    if (_mobDeathStylesInjected) return;
    _mobDeathStylesInjected = true;
    const style = document.createElement('style');
    style.id = 'nexusMobDeathStyles';
    style.textContent = `
@keyframes nxMobDeathFade{0%{opacity:1;transform:scale(1) translateY(0);}60%{opacity:.3;transform:scale(0.7) translateY(8px);}100%{opacity:0;transform:scale(0.4) translateY(18px);}}
@keyframes nxMobRespawn{0%{opacity:0;transform:scale(0.3) translateY(-14px);}60%{opacity:.9;transform:scale(1.12) translateY(-3px);}100%{opacity:1;transform:scale(1) translateY(0);}}
.nexus-mob-wrapper.nx-mob-dying .nexus-mob-avatar{animation:nxMobDeathFade ${MOB_DEATH_ANIM_MS}ms ease-out forwards!important;}
.nexus-mob-wrapper.nx-mob-respawning .nexus-mob-avatar{animation:nxMobRespawn ${MOB_RESPAWN_ANIM_MS}ms cubic-bezier(.22,1,.36,1) forwards!important;}
.nexus-mob-wrapper.dead{pointer-events:none;}
`;
    document.head.appendChild(style);
}
// Toca a animação de morte de um mob: flash de impacto imediato, seguido
// (com um pequeno atraso, igual à caça) do som do próprio mob, e só depois
// de a animação de "afundar" terminar é que ele fica realmente marcado
// como morto (evita ser escolhido como alvo nesse meio-tempo).
function triggerMobDeathAnim(entry) {
    ensureMobDeathStyles();
    flashHit(entry.el);
    // Item 2 (egress): posição não vem mais no payload de sync — usa a
    // âncora em cache (basePos), que já foi recebida uma vez em
    // enter_nexus e nunca muda. Suficiente pro cálculo de volume por
    // proximidade, já que o mob só balança um pouco em torno dela.
    playProximitySound(Math.random() < 0.15 ? 'critical' : 'normal', entry.basePos.x, entry.basePos.y);
    // Som do próprio mob toca alguns ms DEPOIS do golpe, igual à página de caça
    setTimeout(() => playProximitySound('mob_' + entry.type.key, entry.basePos.x, entry.basePos.y), 300);

    entry.el.classList.remove('nx-mob-respawning');
    entry.el.classList.add('nx-mob-dying');
    entry.deathTimer = setTimeout(() => {
        entry.el.classList.remove('nx-mob-dying');
        entry.el.classList.add('dead');
        entry.deathTimer = null;
    }, MOB_DEATH_ANIM_MS);
}
function triggerMobRespawnAnim(entry) {
    ensureMobDeathStyles();
    if (entry.deathTimer) { clearTimeout(entry.deathTimer); entry.deathTimer = null; }
    entry.el.classList.remove('dead', 'nx-mob-dying');
    entry.el.classList.add('nx-mob-respawning');
    setTimeout(() => entry.el.classList.remove('nx-mob-respawning'), MOB_RESPAWN_ANIM_MS);
}

// m aqui SEMPRE tem pos_x/pos_y — só é chamada com os dados de âncora
// vindos de enter_nexus (uma vez, no início da sessão no Nexus).
function createMobDOM(m) {
    const map = document.getElementById('nexusMap');
    const type = pickMobType(m.mob_index);
    const el = document.createElement('div');
    el.className = 'nexus-mob-wrapper';
    el.dataset.mobIndex = m.mob_index;
    el.style.left = m.pos_x + 'px'; el.style.top = m.pos_y + 'px';
    const av = document.createElement('img');
    av.className = 'nexus-mob-avatar';
    av.src = type.img;
    av.onerror = () => { av.onerror = null; av.src = DEFAULT_AVATAR; };
    el.appendChild(av);
    if (!m.is_alive) el.classList.add('dead');
    map.appendChild(el);
    const entry = { el, type, basePos: { x: m.pos_x, y: m.pos_y } };
    mobsCache.set(m.mob_index, entry);
    wanderState.set('mob:' + m.mob_index, { seed: seedFromId('mob-' + m.mob_index + '-' + (ctx ? ctx.instanceId : '')), el });
    return entry;
}
// Item 2 (egress): chamada UMA VEZ, com os dados completos (âncora +
// estado inicial) que vêm de enter_nexus — não mais a cada sync.
function rebuildMobsDOM(mobs) {
    mobsCache.forEach((entry, idx) => { entry.el.remove(); stopWander('mob:' + idx); });
    mobsCache.clear();
    (mobs || []).forEach(m => createMobDOM(m));
    repositionMobWobble();
}
function scheduleMobWander(idx, entry) {
    const key = 'mob:' + idx;
    let state = wanderState.get(key);
    if (!state) return;
    clearTimeout(state.timer);
    const tick = () => {
        if (!entry.el.isConnected) return;
        const elapsedSec = (Date.now() - ownEnteredAtMs) / 1000;
        const cycleIndex = Math.floor(elapsedSec / CYCLE_SEC);
        const cyclePos = elapsedSec - cycleIndex * CYCLE_SEC;
        const wp = computeWaypoint(state.seed, cycleIndex, MOB_WOBBLE_RADIUS * 2, MOB_WOBBLE_RADIUS * 2, 0, 0);
        const targetX = entry.basePos.x - MOB_WOBBLE_RADIUS + wp.x;
        const targetY = entry.basePos.y - MOB_WOBBLE_RADIUS + wp.y;
        if (cyclePos < MOVE_SEC) {
            const remainingMs = (MOVE_SEC - cyclePos) * 1000;
            entry.el.style.transition = `left ${remainingMs}ms ease-in-out, top ${remainingMs}ms ease-in-out`;
            entry.el.style.left = targetX + 'px'; entry.el.style.top = targetY + 'px';
            state.timer = setTimeout(tick, remainingMs + 30);
        } else {
            entry.el.style.transition = 'none';
            entry.el.style.left = targetX + 'px'; entry.el.style.top = targetY + 'px';
            state.timer = setTimeout(tick, (CYCLE_SEC - cyclePos) * 1000 + 30);
        }
    };
    tick();
}
function repositionMobWobble() {
    mobsCache.forEach((entry, idx) => scheduleMobWander(idx, entry));
}
// Item 2 (egress): a cada sync o servidor manda o estado vivo/morto de
// TODOS os 30 mobs, sem posição nenhuma (a âncora já está em cache desde
// o rebuildMobsDOM inicial) — então aqui é só um "diff" de estado, nunca
// cria/remove elemento nenhum.
function updateMobsDOM(mobs) {
    if (mobsCache.size === 0) return; // ainda não seedado (não deveria acontecer)
    (mobs || []).forEach(m => {
        const entry = mobsCache.get(m.mob_index);
        if (!entry) return; // mob desconhecido — não deveria acontecer, os 30 já vêm de enter_nexus
        const wasAlive = !entry.el.classList.contains('dead') && !entry.el.classList.contains('nx-mob-dying');
        if (wasAlive && !m.is_alive) {
            triggerMobDeathAnim(entry);
        } else if (!wasAlive && m.is_alive && (entry.el.classList.contains('dead') || entry.el.classList.contains('nx-mob-dying'))) {
            triggerMobRespawnAnim(entry);
        }
    });
}

function buildOwnPlayerDOM(playerId, avatarUrl, name, guildName) {
    ownAvatarUrl = avatarUrl || DEFAULT_AVATAR;
    const map = document.getElementById('nexusMap');
    const wrap = document.createElement('div');
    wrap.id = 'nexusOwnPlayer';
    wrap.className = 'nexus-player-wrapper own';

    const nm = document.createElement('div');
    nm.className = 'nexus-player-name';
    nm.textContent = esc(name || 'Você');
    wrap.appendChild(nm);

    const gd = document.createElement('div');
    gd.className = 'nexus-player-guild';
    gd.textContent = esc(guildName || '');
    wrap.appendChild(gd);

    const avWrap = document.createElement('div');
    avWrap.className = 'avatar-frame-wrap';
    const av = document.createElement('img');
    av.className = 'nexus-player-avatar';
    av.src = ownAvatarUrl;
    av.onerror = () => { av.onerror = null; av.src = DEFAULT_AVATAR; };
    avWrap.appendChild(av);
    wrap.appendChild(avWrap);

    const { bar, fill } = buildHpBar();
    wrap.appendChild(bar);

    map.appendChild(wrap);
    const { fr, sh } = _nxAddFrame(avWrap, 117);
    requestAnimationFrame(() => _nxPositionFrameOffset(fr, sh, av, 117, 60));
    _nxFetchFrame(playerId, fr, sh, av, '3px solid #fc0');

    ownHpFill = fill;
}

// Item 2 (egress): só é chamada quando o servidor manda dados completos
// de um jogador em new_players_info — ou seja, uma vez por jogador
// "descoberto" (não muda de novo enquanto ele continuar no Nexus).
function createOtherPlayerDOM(info) {
    if (otherPlayersCache.has(info.id)) return otherPlayersCache.get(info.id);
    const map = document.getElementById('nexusMap');
    const wrap = document.createElement('div');
    wrap.className = 'nexus-player-wrapper enemy';
    wrap.dataset.playerId = info.id;

        const nm = document.createElement('div');
        nm.className = 'nexus-player-name';
        nm.textContent = esc(info.name);
        wrap.appendChild(nm);

        const gd = document.createElement('div');
        gd.className = 'nexus-player-guild';
        gd.textContent = esc(info.guild_name || '');
        wrap.appendChild(gd);

        const avWrap = document.createElement('div');
        avWrap.className = 'avatar-frame-wrap';
        const av = document.createElement('img');
        av.className = 'nexus-player-avatar';
        av.src = info.avatar_url || DEFAULT_AVATAR;
        av.onerror = () => { av.onerror = null; av.src = DEFAULT_AVATAR; };
        avWrap.appendChild(av);
        wrap.appendChild(avWrap);

        const { bar, fill } = buildHpBar();
        wrap.appendChild(bar);

        const lbl = document.createElement('div');
        lbl.className = 'nexus-dead-label';
        lbl.textContent = '💀 Derrotado';
        wrap.appendChild(lbl);

        map.appendChild(wrap);
        const { fr, sh } = _nxAddFrame(avWrap, 117);
        requestAnimationFrame(() => _nxPositionFrameOffset(fr, sh, av, 117, 60));
        _nxFetchFrame(info.id, fr, sh, av, '3px solid #48f');

        // Item 2 (egress): entered_at só é mandado UMA VEZ, aqui na
        // descoberta do jogador — guardado no entry pra reusar depois (ex:
        // reagendar o wander num revive) sem precisar receber de novo.
        const enteredAtMs = info.entered_at ? new Date(info.entered_at).getTime() : Date.now();
        const entry = {
            wrap, av, lbl, hpFill: fill, guildId: info.guild_id, name: info.name,
            isDead: false, lastKnownHp: null, enteredAtMs
        };
        otherPlayersCache.set(info.id, entry);

        const seed = seedFromId(info.id);
        scheduleWander('player:' + info.id, wrap, seed, enteredAtMs, NEXUS_MAP_SIZE, AVATAR_W, AVATAR_H);
        return entry;
}
// Item 2 (egress): chamada a cada sync pra TODOS os jogadores da
// instância (não só os próximos) — mas só com {id, hp, is_dead}, nunca
// nome/avatar/posição, que já foram tratados uma vez em
// createOtherPlayerDOM. Se o jogador ainda não está em cache aqui, é
// porque o servidor não o considerou "conhecido" (não deveria acontecer,
// já que new_players_info roda antes no mesmo applyState).
function updateOtherPlayerState(p) {
    const entry = otherPlayersCache.get(p.id);
    if (!entry) return;

    const maxHp = p.max_hp || 1;
    const curHp = p.current_hp ?? maxHp;

    // Se o HP baixou desde a última vez que vi esse jogador, ele levou um
    // golpe de ALGUÉM (não necessariamente eu) — toca o som/flash mesmo
    // assim, igual acontece na página de caça com outros jogadores.
    if (entry.lastKnownHp !== null && curHp < entry.lastKnownHp && !entry.isDead) {
        flashHit(entry.wrap);
        const pos = getEntityPos('player:' + p.id);
        playProximitySound(Math.random() < 0.2 ? 'critical' : 'normal', pos?.x || 0, pos?.y || 0);
    }
    entry.lastKnownHp = curHp;

    setHpBar(entry.hpFill, (curHp / maxHp) * 100);

    const wasDead = entry.isDead;
    entry.isDead = !!p.is_dead;
    entry.wrap.classList.toggle('is-dead', entry.isDead);
    entry.av.classList.toggle('eliminated', entry.isDead);
    if (!wasDead && entry.isDead) {
        stopWander('player:' + p.id);
    } else if (wasDead && !entry.isDead) {
        const seed = seedFromId(p.id);
        scheduleWander('player:' + p.id, entry.wrap, seed, entry.enteredAtMs, NEXUS_MAP_SIZE, AVATAR_W, AVATAR_H);
    }
}
function pruneMissingPlayers(currentIds) {
    otherPlayersCache.forEach((entry, id) => {
        if (!currentIds.has(id)) { entry.wrap.remove(); stopWander('player:' + id); otherPlayersCache.delete(id); }
    });
}

// ── DRAG / PINCH-ZOOM DO MAPA (+ câmera programável) ─────────────────
function enableNexusMapInteraction() {
    const cont = document.getElementById('nexusMapContainer');
    const map = document.getElementById('nexusMap');
    if (!map || !cont) return;
    if (map._interactionEnabled) return;
    map._interactionEnabled = true;

    const SIZE = NEXUS_MAP_SIZE;
    let vx = 0, vy = 0, lt = 0, aId = null;
    const FRICTION = 0.94;
    let drag = false, sx = 0, sy = 0;
    let isPinching = false, pinchStartDist = 0, pinchStartScale = 1;
    let pinchFocalX = 0, pinchFocalY = 0, pinchStartTx = 0, pinchStartTy = 0;
    let minX = 0, maxX = 0, minY = 0, maxY = 0;

    function recalcLimits(reclamp) {
        const cr = cont.getBoundingClientRect();
        panState.minScale = Math.max(cr.width / SIZE, cr.height / SIZE);
        if (panState.scale < panState.minScale) panState.scale = panState.minScale;
        minX = Math.min(0, cr.width - SIZE * panState.scale - 1);
        minY = Math.min(0, cr.height - SIZE * panState.scale - 1);
        maxX = 0; maxY = 0;
        if (reclamp !== false) {
            panState.x = Math.max(minX, Math.min(maxX, panState.x));
            panState.y = Math.max(minY, Math.min(maxY, panState.y));
        }
        map.style.transform = `translate(${panState.x}px,${panState.y}px) scale(${panState.scale})`;
    }
    recalcLimits();
    window.addEventListener('resize', () => recalcLimits(true));
    map.style.touchAction = 'none';
    map.style.userSelect = 'none';

    function applyTransform(x, y, s) {
        s = Math.max(panState.minScale, Math.min(3.0, s));
        const cr = cont.getBoundingClientRect();
        const sw = SIZE * s, sh = SIZE * s;
        x = Math.max(Math.min(0, cr.width - sw - 1), Math.min(0, x));
        y = Math.max(Math.min(0, cr.height - sh - 1), Math.min(0, y));
        panState.x = x; panState.y = y; panState.scale = s;
        map.style.transform = `translate(${x}px,${y}px) scale(${s})`;
        recalcLimits(true);
        updateFogPosition();
    }
    function setPos(x, y) {
        panState.x = Math.max(minX, Math.min(maxX, x));
        panState.y = Math.max(minY, Math.min(maxY, y));
        map.style.transform = `translate(${panState.x}px,${panState.y}px) scale(${panState.scale})`;
        updateFogPosition();
    }
    function inertia() {
        cancelAnimationFrame(aId);
        if (drag) return;
        vx *= FRICTION; vy *= FRICTION;
        setPos(panState.x + vx, panState.y + vy);
        if (Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4) aId = requestAnimationFrame(inertia);
    }
    function touchDist(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    function touchMid(e) { return { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 }; }
    function disableFollow() { setCameraFollow(false); }
    function startDrag(e) {
        drag = true; disableFollow();
        map.style.cursor = 'grabbing';
        sx = e.clientX ?? e.touches[0].clientX; sy = e.clientY ?? e.touches[0].clientY;
        vx = vy = 0; lt = performance.now();
        cancelAnimationFrame(aId);
    }
    function onDrag(e) {
        if (!drag) return;
        e.preventDefault();
        const nx = e.clientX ?? e.touches[0].clientX;
        const ny = e.clientY ?? e.touches[0].clientY;
        const dt = performance.now() - lt;
        if (dt > 0) { vx = (nx - sx) / dt; vy = (ny - sy) / dt; }
        setPos(panState.x + (nx - sx), panState.y + (ny - sy));
        sx = nx; sy = ny; lt = performance.now();
    }
    function endDrag() {
        drag = false; map.style.cursor = 'grab';
        if (Math.abs(vx) > 0.2 || Math.abs(vy) > 0.2) { vx *= 10; vy *= 10; inertia(); }
    }
    function onTouchStart(e) {
        if (e.touches.length >= 2) {
            isPinching = true; drag = false; cancelAnimationFrame(aId);
            disableFollow();
            pinchStartDist = touchDist(e); pinchStartScale = panState.scale;
            const mid = touchMid(e); const cr = cont.getBoundingClientRect();
            pinchFocalX = mid.x - cr.left; pinchFocalY = mid.y - cr.top;
            pinchStartTx = panState.x; pinchStartTy = panState.y;
        } else if (e.touches.length === 1 && !isPinching) { startDrag(e); }
    }
    function onTouchMove(e) {
        if (e.touches.length >= 2 && isPinching) {
            e.preventDefault();
            const newScale = pinchStartScale * (touchDist(e) / pinchStartDist);
            const mapPointX = (pinchFocalX - pinchStartTx) / pinchStartScale;
            const mapPointY = (pinchFocalY - pinchStartTy) / pinchStartScale;
            applyTransform(pinchFocalX - mapPointX * newScale, pinchFocalY - mapPointY * newScale, newScale);
        } else if (e.touches.length === 1 && !isPinching) { onDrag(e); }
    }
    function onTouchEnd(e) {
        if (isPinching && e.touches.length < 2) { isPinching = false; vx = vy = 0; recalcLimits(true); }
        if (e.touches.length === 0) endDrag();
    }
    map.addEventListener('mousedown', startDrag, { passive: true });
    window.addEventListener('mousemove', onDrag, { passive: false });
    window.addEventListener('mouseup', endDrag, { passive: true });
    map.addEventListener('wheel', (e) => {
        e.preventDefault();
        disableFollow();
        const cr = cont.getBoundingClientRect();
        const fx = e.clientX - cr.left, fy = e.clientY - cr.top;
        const mapPointX = (fx - panState.x) / panState.scale;
        const mapPointY = (fy - panState.y) / panState.scale;
        const newScale = panState.scale * (e.deltaY < 0 ? 1.1 : 0.9);
        applyTransform(fx - mapPointX * newScale, fy - mapPointY * newScale, newScale);
    }, { passive: false });
    map.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    map.style.cursor = 'grab';

    mapControls = { recalcLimits, applyTransform, setPos };
}
function centerCameraOn(x, y, animate, durationMs) {
    const cont = document.getElementById('nexusMapContainer');
    const map = document.getElementById('nexusMap');
    if (!cont || !map || !mapControls) return;
    const cr = cont.getBoundingClientRect();
    const targetX = cr.width / 2 - x * panState.scale;
    const targetY = cr.height / 2 - y * panState.scale;
    const ms = durationMs || 600;
    map.style.transition = animate ? `transform ${ms}ms linear` : 'none';
    mapControls.setPos(targetX, targetY);
    if (animate) setTimeout(() => { map.style.transition = 'none'; }, ms + 50);
    updateFogPosition();
}
function setCameraFollow(on) {
    cameraFollow = on;
    const btn = document.getElementById('nexusCameraBtn');
    if (btn) btn.classList.toggle('active', on);
}

// ── BANNER ────────────────────────────────────────────────────────────
function pushNexusBannerEvent(ev) {
    if (typeof onBannerEventCb !== 'function') return;
    if (ev.attacker_won) {
        onBannerEventCb(`<span style="color:#ff8">${esc(ev.attacker_name)}</span> eliminou <span style="color:#f88">${esc(ev.defender_name)}</span> no Nexus!`);
    } else {
        onBannerEventCb(`<span style="color:#f88">${esc(ev.attacker_name)}</span> tentou eliminar <span style="color:#ff8">${esc(ev.defender_name)}</span> no Nexus e perdeu.`);
    }
}

// ── MORTE / REVIVE (própria) ─────────────────────────────────────────
function showDeadOverlay(deadUntilIso, avatarUrl) {
    isDeadLocal = true;
    stopWander('own');
    pauseLocalCombatLoop();
    setCameraFollow(false);
    const overlay = document.getElementById('nexusDeadOverlay');
    const avImg = document.getElementById('nexusDeadAvatar');
    if (avImg) avImg.src = avatarUrl || DEFAULT_AVATAR;
    overlay.classList.add('active');
    const timerEl = document.getElementById('nexusDeadTimer');
    clearInterval(deadOverlayInterval);
    const until = new Date(deadUntilIso).getTime();
    const tick = () => {
        const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        const m = Math.floor(remaining / 60), s = remaining % 60;
        if (timerEl) timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        if (remaining <= 0) {
            clearInterval(deadOverlayInterval); deadOverlayInterval = null;
            overlay.classList.remove('active');
            // Item 3: revive otimisticamente no cliente assim que o timer local
            // zera (HP volta, volta a andar), sem esperar o próximo sync
            // periódico (que pode demorar até alguns minutos) — e força uma
            // sincronização imediata pra confirmar/corrigir com o servidor
            // o quanto antes, em vez de deixar a barra de HP vazia parada.
            reviveOwnLocally();
            scheduleSync(0);
            if (typeof onDeadTimerEndCb === 'function') onDeadTimerEndCb();
        }
    };
    tick();
    deadOverlayInterval = setInterval(tick, 1000);
}
function reviveOwnLocally() {
    isDeadLocal = false;
    if (ownHpFill) setHpBar(ownHpFill, 100);
    scheduleOwnWander();
    resumeLocalCombatLoop();
    setCameraFollow(true);
}
// Depois de atacar, retoma o wander SEM resetar o relógio (ownEnteredAtMs
// nunca muda) — calcula onde a fórmula diz que o avatar "deveria" estar
// agora e caminha suavemente até lá (sempre com transição, nunca instantâneo,
// mesmo que a fórmula original mandasse "descansar" nesse instante).
function resumeWanderSmoothlyAfterCombat() {
    const el = document.getElementById('nexusOwnPlayer');
    if (!el) return;
    const elapsedSec = (Date.now() - ownEnteredAtMs) / 1000;
    const cycleIndex = Math.floor(elapsedSec / CYCLE_SEC);
    const wp = computeWaypoint(ownSeed, cycleIndex, NEXUS_MAP_SIZE, NEXUS_MAP_SIZE, AVATAR_W, AVATAR_H);
    const walkMs = 900;

    wanderState.set('own', { el, lastX: wp.x, lastY: wp.y });
    el.style.transition = `left ${walkMs}ms linear, top ${walkMs}ms linear`;
    el.style.left = wp.x + 'px';
    el.style.top = wp.y + 'px';
    if (cameraFollow) centerCameraOn(wp.x + AVATAR_W / 2, wp.y + AVATAR_H / 2, true, walkMs);
    else updateFogPosition();

    setTimeout(() => {
        if (running && !isDeadLocal && !localCombatPaused) scheduleOwnWander();
    }, walkMs + 60);
}

function scheduleOwnWander() {
    const el = document.getElementById('nexusOwnPlayer');
    if (!el) return;
    scheduleWander('own', el, ownSeed, ownEnteredAtMs, NEXUS_MAP_SIZE, AVATAR_W, AVATAR_H,
        (x, y, durationMs) => {
            if (cameraFollow) centerCameraOn(x + AVATAR_W / 2, y + AVATAR_H / 2, durationMs > 0, durationMs);
            updateFogPosition();
        });
}

// ══════════════════════════════════════════════════════════════════════
// NEVOEIRO DE GUERRA — degradê suave centrado no próprio avatar (raio
// ~260 em espaço do mapa). Mobs e jogadores inimigos fora do raio somem.
// Item 2: recalculado em loop contínuo (não só nos "saltos" de waypoint
// do wander, que podiam levar até 11s) e usando a posição REAL interpolada
// do avatar (não o próximo destino) — sem isso, um mob só ficava visível
// no instante exato do ataque, quando o jogador já estava colado nele.
// ══════════════════════════════════════════════════════════════════════
const FOG_VISIBLE_RADIUS = 360; // totalmente visível
const FOG_FADE_RADIUS = 520;    // opaco a partir daqui
const FOG_LOOP_MS = 250;
let fogVisibilityInterval = null;

function ensureFogOverlay() {
    const cont = document.getElementById('nexusMapContainer');
    if (!cont || document.getElementById('nexusFogOverlay')) return;
    const fog = document.createElement('div');
    fog.id = 'nexusFogOverlay';
    cont.appendChild(fog);
}

// Posição real (interpolada) do próprio avatar, lida direto do DOM — ao
// contrário de getEntityPos('own'), que só sabe o próximo destino do
// wander, isso reflete onde o avatar VISUALMENTE está no meio da transição.
function getOwnLivePos() {
    const el = document.getElementById('nexusOwnPlayer');
    if (el) return getCurrentComputedPos(el);
    return getEntityPos('own');
}

function startFogVisibilityLoop() {
    clearInterval(fogVisibilityInterval);
    updateFogPosition();
    fogVisibilityInterval = setInterval(updateFogPosition, FOG_LOOP_MS);
}
function stopFogVisibilityLoop() {
    clearInterval(fogVisibilityInterval);
    fogVisibilityInterval = null;
}

function updateFogPosition() {
    const fog = document.getElementById('nexusFogOverlay');
    const cont = document.getElementById('nexusMapContainer');
    if (!fog || !cont) return;
    const ownPos = getOwnLivePos();
    if (!ownPos) return;

    let screenX, screenY;
    if (cameraFollow) {
        // Item 2: com a câmera travada no jogador, o avatar está SEMPRE
        // exatamente no centro da viewport por definição — usar isso
        // direto em vez de recalcular a partir de panState. panState.x/y
        // já salta pro valor FINAL assim que a transição do pan começa
        // (só a CSS anima visualmente até lá), enquanto ownPos é a posição
        // REAL interpolada do avatar — misturar os dois fazia o círculo
        // "correr atrás" do avatar até a transição terminar.
        const cr = cont.getBoundingClientRect();
        screenX = cr.width / 2;
        screenY = cr.height / 2;
    } else {
        screenX = ownPos.x * panState.scale + panState.x + (AVATAR_W / 2) * panState.scale;
        screenY = ownPos.y * panState.scale + panState.y + (AVATAR_H / 2) * panState.scale;
    }
    fog.style.setProperty('--fog-cx', screenX + 'px');
    fog.style.setProperty('--fog-cy', screenY + 'px');
    fog.style.setProperty('--fog-r1', (FOG_VISIBLE_RADIUS * panState.scale) + 'px');
    fog.style.setProperty('--fog-r2', (FOG_FADE_RADIUS * panState.scale) + 'px');

    // Esconde mobs/jogadores inimigos fora do raio visível (espaço do mapa,
    // consistente em qualquer zoom)
    mobsCache.forEach((entry, idx) => {
        const pos = getEntityPos('mob:' + idx) || entry.basePos;
        const visible = rangeSq(ownPos, pos) <= FOG_VISIBLE_RADIUS * FOG_VISIBLE_RADIUS;
        entry.el.style.visibility = visible ? 'visible' : 'hidden';
    });
    otherPlayersCache.forEach((entry, id) => {
        const pos = getEntityPos('player:' + id);
        const visible = pos && rangeSq(ownPos, pos) <= FOG_VISIBLE_RADIUS * FOG_VISIBLE_RADIUS;
        entry.wrap.style.visibility = visible ? 'visible' : 'hidden';
    });
}

// ── SINCRONIZAÇÃO ADAPTATIVA (o servidor decide TUDO do combate) ────
function showSyncDebugLine(text) {
    let el = document.getElementById('nexusSyncDebug');
    if (!el) {
        el = document.createElement('div');
        el.id = 'nexusSyncDebug';
        el.style.cssText = 'position:fixed; left:0; right:0; bottom:0; z-index:9999; background:rgba(180,0,0,0.9); color:#fff; font-size:11px; padding:6px 10px; word-break:break-word; font-family:monospace;';
        document.body.appendChild(el);
    }
    el.textContent = '[Nexus] ' + text;
    el.style.display = 'block';
}
function clearSyncDebugLine() {
    const el = document.getElementById('nexusSyncDebug');
    if (el) el.style.display = 'none';
}

function scheduleSync(delay) {
    clearTimeout(syncTimeout);
    if (!running) return;
    if (document.visibilityState === 'hidden') return;
    syncTimeout = setTimeout(doSync, delay);
}
async function doSync() {
    if (!running || !ctx || syncInFlight) return;
    syncInFlight = true;
    try {
        const { data, error } = await supabase.rpc('nexus_sync', {
            p_battle_instance_id: ctx.instanceId,
            p_known_player_ids: Array.from(otherPlayersCache.keys()),
            p_last_event_timestamp: lastEventTs
        });

        if (error) {
            showSyncDebugLine('Erro de rede: ' + (error.message || JSON.stringify(error)));
            syncInFlight = false;
            handleSyncFailure();
            return;
        }
        if (!data) {
            showSyncDebugLine('nexus_sync não retornou dados.');
            syncInFlight = false; handleSyncFailure(); return;
        }
        if (data.status === 'force_exit') { clearSyncDebugLine(); syncInFlight = false; consecutiveSyncFailures = 0; handleForceExit(data.reason); return; }
        if (data.status === 'error') {
            showSyncDebugLine('Erro no banco: ' + (data.message || 'desconhecido'));
            syncInFlight = false;
            handleSyncFailure();
            return;
        }
        if (data.status !== 'active') {
            showSyncDebugLine('Status inesperado: ' + JSON.stringify(data.status));
            syncInFlight = false; handleSyncFailure(); return;
        }

        clearSyncDebugLine();
        consecutiveSyncFailures = 0;
        await applyState(data);

        hadRecentActivity = (data.my_pve_ticks > 0) || (data.my_combats && data.my_combats.length > 0);
        currentSyncMs = hadRecentActivity ? SYNC_BASE_ACTIVE : Math.min(currentSyncMs + SYNC_STEP, SYNC_MAX);
        scheduleSync(currentSyncMs);
    } catch (e) {
        showSyncDebugLine('Exceção no cliente: ' + (e?.message || String(e)));
        handleSyncFailure();
    } finally {
        syncInFlight = false;
    }
}
function handleForceExit(reason) {
    stopNexusLoop();
    if (typeof onForceExitCb === 'function') onForceExitCb(reason);
}
// Item 3: chamado em qualquer falha de sync (rede, erro de banco, resposta
// inesperada). Continua tentando com o backoff normal até um limite — mas
// depois de várias falhas seguidas (ex: token de auth expirado após o
// dispositivo dormir por horas), desiste de tentar silenciosamente pra
// sempre e força a saída do Nexus localmente, deixando a tela principal
// (que já faz um refresh completo) resolver o estado real com o servidor.
function handleSyncFailure() {
    consecutiveSyncFailures++;
    if (consecutiveSyncFailures >= MAX_CONSECUTIVE_SYNC_FAILURES) {
        clearSyncDebugLine();
        consecutiveSyncFailures = 0;
        handleForceExit('sync_lost');
        return;
    }
    scheduleSync(SYNC_BASE_IDLE);
}
function startLocalTimerTick() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const el = document.getElementById('nexusTimer');
        if (!el) return;
        const elapsed = (Date.now() - timerBaseAtMs) / 1000;
        const s = Math.max(0, Math.round(timerBaseSeconds - elapsed));
        const m = Math.floor(s / 60), sec = s % 60;
        el.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }, 1000);
}

async function applyState(data) {
    const shownDuelTimestamps = new Set();
    const st = data.own_state;
    const hadShownCombat = !!(data.my_combats && data.my_combats.length);

    // Ações/timer podem ser atualizados de imediato, são só texto.
    if (st) {
        const actionsEl = document.getElementById('nexusActions');
        if (actionsEl) actionsEl.textContent = `Ações: ${st.attacks_left} / 5`;
        timerBaseSeconds = Math.max(0, st.time_left_seconds | 0);
        timerBaseAtMs = Date.now();
    }

    if (data.mobs) updateMobsDOM(data.mobs);

    // Item 2 (egress): primeiro cria o DOM de quem é novo pra mim (dados
    // completos, mandados só uma vez), DEPOIS aplica HP/vivo-morto em
    // TODOS (novos e já conhecidos) — nessa ordem, um jogador que acabou
    // de aparecer já entra com a barra de HP certa no mesmo ciclo.
    if (data.new_players_info) {
        data.new_players_info.forEach(info => createOtherPlayerDOM(info));
    }
    if (data.other_players) {
        const ids = new Set();
        data.other_players.forEach(p => { ids.add(p.id); updateOtherPlayerState(p); });
        pruneMissingPlayers(ids);
    }

    // Duelo(s) reais em que participei desde o último sync — se eu fui o
    // ALVO (não quem iniciou), mostra o oponente se aproximando antes,
    // pra dar a sensação de "encontro", igual pedido. Isso é tocado ANTES
    // de aplicar o HP/estado final abaixo — o backend já devolve o
    // resultado desse combate resolvido no MESMO `own_state`, então sem
    // essa ordem o overlay de derrota apareceria antes do duelo animado.
    if (hadShownCombat) {
        pauseLocalCombatLoop();
        for (const entry of data.my_combats) {
            const iAmDefender = entry.defender_id === ctx.playerId;
            const opponentId = iAmDefender ? entry.attacker_id : entry.defender_id;
            const opponentName = iAmDefender ? entry.attacker_name : entry.defender_name;

            await playApproachAnimation(opponentId, opponentName, iAmDefender);
            await showChallengeOverlay(5);
            await playRealDuelAnimation(entry);
            pushNexusBannerEvent(entry);
            if (entry.timestamp) shownDuelTimestamps.add(entry.timestamp);
        }
        resumeLocalCombatLoop();
    }

    // Item 2: aplica o HP/estado (já correto e atual, resolvido pelo backend
    // na mesma chamada) só agora — depois do duelo animado, se houve algum.
    // Isso garante que a morte/dano aparece de imediato, sem esperar o
    // próximo tick/sync, e sem "pular" o overlay de derrota antes do duelo.
    if (st) {
        if (ownHpFill && st.max_hp) {
            const curOwnHp = st.current_hp ?? st.max_hp;
            // Só flasheia/toca som "genérico" de dano se NENHUM duelo animado
            // já tiver sido mostrado agora — senão duplicaria o feedback.
            if (!hadShownCombat && lastKnownOwnHp !== null && curOwnHp < lastKnownOwnHp && !isDeadLocal) {
                const ownEl = document.getElementById('nexusOwnPlayer');
                if (ownEl) flashHit(ownEl);
                const ownPos = getEntityPos('own');
                playProximitySound(Math.random() < 0.2 ? 'critical' : 'normal', ownPos?.x || 0, ownPos?.y || 0);
            }
            lastKnownOwnHp = curOwnHp;
            setHpBar(ownHpFill, (curOwnHp / st.max_hp) * 100);
        }

        if (st.is_dead && !isDeadLocal) {
            showDeadOverlay(st.dead_until, ownAvatarUrl);
        } else if (!st.is_dead && isDeadLocal) {
            reviveOwnLocally();
        }
    }

    if (data.new_events && data.new_events.length) {
        data.new_events.forEach(ev => {
            lastEventTs = ev.timestamp > lastEventTs ? ev.timestamp : lastEventTs;
            // Já mostrado pela animação real do duelo (acima) — evita banner duplicado
            if (ev.timestamp && shownDuelTimestamps.has(ev.timestamp)) return;
            pushNexusBannerEvent(ev);
        });
    }

    if (cameraFollow) {
        const ownPos = getEntityPos('own');
        if (ownPos) centerCameraOn(ownPos.x + AVATAR_W / 2, ownPos.y + AVATAR_H / 2, false);
    } else {
        updateFogPosition();
    }
}

// ── TOPBAR DO JOGO (esconder na tela do Nexus) ───────────────────────
function setGlobalTopBarVisible(visible) {
    const tb = document.getElementById('playerTopBar');
    if (tb) tb.style.display = visible ? '' : 'none';
}

// ── API PÚBLICA ───────────────────────────────────────────────────────
export function startNexusScreen(options) {
    ensureSoundsPreloaded();
    ctx = { instanceId: options.instanceId, playerId: options.playerId, guildId: options.guildId };
    onForceExitCb = options.onForceExit || null;
    onBannerEventCb = options.onBannerEvent || null;
    onDeadTimerEndCb = options.onDeadTimerEnd || null;
    lastEventTs = '1970-01-01T00:00:00+00:00';
    isDeadLocal = false;
    currentSyncMs = SYNC_BASE_IDLE;
    consecutiveSyncFailures = 0;
    cameraFollow = true;
    lastKnownOwnHp = options.currentHp ?? options.maxHp ?? null;

    ownEnteredAtMs = options.enteredAt ? new Date(options.enteredAt).getTime() : Date.now();
    ownSeed = seedFromId(options.playerId);

    if (options.nexusClosesAt) {
        timerBaseSeconds = Math.max(0, Math.round((new Date(options.nexusClosesAt).getTime() - Date.now()) / 1000));
        timerBaseAtMs = Date.now();
    }

    ensureNexusDOM();
    setGlobalTopBarVisible(false);
    document.querySelectorAll('#nexusOwnPlayer').forEach(e => e.remove());
    stopWander('own');
    otherPlayersCache.forEach((entry, id) => { entry.wrap.remove(); stopWander('player:' + id); });
    otherPlayersCache.clear();
    mobsCache.forEach((entry, idx) => stopWander('mob:' + idx));
    document.getElementById('nexusMap').innerHTML = '';
    mobsCache.clear();

    document.getElementById('nexusMap').style.width = NEXUS_MAP_SIZE + 'px';
    document.getElementById('nexusMap').style.height = NEXUS_MAP_SIZE + 'px';

    // Item 2 (egress): as âncoras dos 30 mobs vêm UMA VEZ aqui, na entrada
    // — nunca mais são retransmitidas pelo nexus_sync.
    rebuildMobsDOM(options.mobs || []);

    buildOwnPlayerDOM(options.playerId, options.avatarUrl, options.playerName, options.guildName);

    const ownEl = document.getElementById('nexusOwnPlayer');
    // Posição inicial é só um placeholder — scheduleOwnWander() (mais
    // abaixo) já calcula e sobrescreve com a posição real antes de
    // qualquer paint, então não depende mais de nada vindo do servidor.
    const entryX = NEXUS_MAP_SIZE / 2;
    const entryY = NEXUS_MAP_SIZE / 2;
    if (ownEl) { ownEl.style.left = entryX + 'px'; ownEl.style.top = entryY + 'px'; }
    if (ownHpFill && options.maxHp) setHpBar(ownHpFill, ((options.currentHp ?? options.maxHp) / options.maxHp) * 100);

    enableNexusMapInteraction();
    ensureFogOverlay();

    requestAnimationFrame(() => {
        setCameraFollow(true);
        const ownPos = getEntityPos('own') || { x: entryX, y: entryY };
        centerCameraOn(ownPos.x + AVATAR_W / 2, ownPos.y + AVATAR_H / 2, false);
    });

    document.getElementById('nexusBackBtn').onclick = () => {
        if (typeof options.onBack === 'function') options.onBack();
    };
    document.getElementById('nexusCameraBtn').onclick = () => {
        setCameraFollow(!cameraFollow);
        if (cameraFollow) {
            const ownPos = getEntityPos('own');
            if (ownPos) centerCameraOn(ownPos.x + AVATAR_W / 2, ownPos.y + AVATAR_H / 2, true);
        }
    };

    running = true;
    localCombatPaused = false;
    scheduleOwnWander();
    scheduleLocalCombatLoop();
    startLocalTimerTick();
    startFogVisibilityLoop();
    showProtectionBadgeIfNeeded();
    doSync();
}

export function stopNexusLoop() {
    running = false;
    clearTimeout(syncTimeout); syncTimeout = null;
    clearTimeout(localCombatTimeout); localCombatTimeout = null;
    clearInterval(deadOverlayInterval); deadOverlayInterval = null;
    clearInterval(protectionInterval); protectionInterval = null;
    stopFogVisibilityLoop();
    const badge = document.getElementById('nexusProtectionBadge');
    if (badge) badge.style.display = 'none';
    clearInterval(timerInterval); timerInterval = null;
    setGlobalTopBarVisible(true);
    clearSyncDebugLine();
    stopWander('own');
    otherPlayersCache.forEach((entry, id) => stopWander('player:' + id));
    mobsCache.forEach((entry, idx) => stopWander('mob:' + idx));
}
export function pauseNexusPolling() { clearTimeout(syncTimeout); }
export function resumeNexusPolling() { if (!running || !ctx) return; doSync(); }

export function isNexusScreenActive() { return running; }
export function getNexusMapSize() { return NEXUS_MAP_SIZE; }
export const NEXUS_IMAGE_URL = NEXUS_IMG_URL;
export { showCantLeaveModal, showReviveChoiceModal };
