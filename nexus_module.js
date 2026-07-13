import { supabase } from './supabaseClient.js';

// ══════════════════════════════════════════════════════════════════════
// NEXUS — área PvP/PvE dentro da Batalha de Guildas
//
// MODELO DE EGRESS (v2):
//  - Movimento, mira (alvo mais próximo) e ritmo de ataque são decididos
//    100% no cliente, no mesmo ritmo visual da página de caça.
//  - Ataques contra MOBS não geram round-trip individual: são enfileirados
//    localmente e enviados em LOTE numa chamada adaptativa (nexus_sync),
//    junto com um hash (sync_seed + intervalo de sequência + texto do lote)
//    que o servidor confere antes de aplicar qualquer efeito. O RESULTADO
//    de cada ataque (morte do mob, chance de ação extra) é sorteado pelo
//    SERVIDOR, nunca aceito do cliente — o hash só impede que o payload
//    seja adulterado a caminho do servidor.
//  - Ataques contra JOGADORES (PvP) continuam imediatos (nexus_pvp_attack),
//    pois afetam outro jogador e precisam ser autoritativos — mas são raros
//    (só quando há um inimigo por perto), então não pesam no egress total.
// ══════════════════════════════════════════════════════════════════════

const NEXUS_MAP_SIZE = 2121; // dobro da ÁREA do mapa de caça (1500x1500 -> *sqrt(2))
const NEXUS_IMG_URL  = 'https://aden-rpg.pages.dev/assets/b_nexus.webp';
const AVATAR_W = 70, AVATAR_H = 90;
const ATTACK_MIN_MS = 2500, ATTACK_MAX_MS = 3800; // ritmo local de ataque, igual à caça
const MOVE_MS = 3000;
const REST_MIN_MS = 8000, REST_MAX_MS = 13000;
const COMBAT_RANGE = 150; // px — alcance de ataque (mob ou jogador)

// Sincronização adaptativa (mesma filosofia do POLL_BASE da caça):
// intervalo curto enquanto há atividade (ações pendentes), maior quando
// só está andando à toa, com backoff progressivo até um teto.
const SYNC_BASE_ACTIVE = 9_000;   // há ações pendentes / alvo em alcance recentemente
const SYNC_BASE_IDLE   = 45_000;  // sem nada por perto
const SYNC_STEP        = 15_000;
const SYNC_MAX         = 120_000;

const DEFAULT_AVATAR = 'https://aden-rpg.pages.dev/assets/default_avatar.webp';

// ── MOBS: mesmas imagens/sons já usados nas 3 páginas de caça ───────
const MOB_TYPES = [
    // Floresta Mística
    { key: 'unicornio',      img: 'https://aden-rpg.pages.dev/assets/unicornio.webp',      sound: 'https://aden-rpg.pages.dev/assets/unicornio.mp3' },
    { key: 'satiro',         img: 'https://aden-rpg.pages.dev/assets/satiro.webp',          sound: 'https://aden-rpg.pages.dev/assets/satiro.mp3' },
    { key: 'fenix',          img: 'https://aden-rpg.pages.dev/assets/fenix.webp',           sound: 'https://aden-rpg.pages.dev/assets/fenix.mp3' },
    { key: 'tigrenix',       img: 'https://aden-rpg.pages.dev/assets/tigre_nix.webp',       sound: 'https://aden-rpg.pages.dev/assets/tigre.mp3' },
    // Queda Fontana
    { key: 'harpia',         img: 'https://aden-rpg.pages.dev/assets/harpia.webp',          sound: 'https://aden-rpg.pages.dev/assets/fenix.mp3' },
    { key: 'naga',           img: 'https://aden-rpg.pages.dev/assets/naga.webp',            sound: 'https://aden-rpg.pages.dev/assets/zumbi.mp3' },
    { key: 'orium',          img: 'https://aden-rpg.pages.dev/assets/orium.webp',           sound: 'https://aden-rpg.pages.dev/assets/duende.mp3' },
    { key: 'lider_porifero', img: 'https://aden-rpg.pages.dev/assets/lider_porifero.webp',  sound: 'https://aden-rpg.pages.dev/assets/quar.mp3' },
    // Vale Arcano
    { key: 'quar',           img: 'https://aden-rpg.pages.dev/assets/quar.webp',            sound: 'https://aden-rpg.pages.dev/assets/quar.mp3' },
    { key: 'duende',         img: 'https://aden-rpg.pages.dev/assets/duende.webp',          sound: 'https://aden-rpg.pages.dev/assets/duende.mp3' },
    { key: 'limut',          img: 'https://aden-rpg.pages.dev/assets/limut.webp',           sound: 'https://aden-rpg.pages.dev/assets/limut.mp3' },
    { key: 'pixie',          img: 'https://aden-rpg.pages.dev/assets/pixie.webp',           sound: 'https://aden-rpg.pages.dev/assets/pixie.mp3' },
];

// ── ÁUDIO (mesmos arquivos/volumes da página de caça) ────────────────
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
// Mesma técnica de GainNode da caça (volume controlável por chamada)
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
// Volume base idêntico ao da caça: normal/evade = 1.0, critical = 0.07
function baseVolume(name) { return name === 'critical' ? 0.07 : 1; }

// Mesma fórmula de atenuação por distância da caça: 100% no centro,
// decaimento exponencial, piso de 8%.
function _getViewportCenterOnMap() {
    const map = document.getElementById('nexusMap');
    const cont = document.getElementById('nexusMapContainer');
    if (!map || !cont) return null;
    const t = map.style.transform || '';
    const tm = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
    const sm = t.match(/scale\(([^)]+)\)/);
    const tx = tm ? parseFloat(tm[1]) : 0;
    const ty = tm ? parseFloat(tm[2]) : 0;
    const sc = sm ? parseFloat(sm[1]) : 1;
    const cw = cont.clientWidth || window.innerWidth;
    const ch = cont.clientHeight || window.innerHeight;
    return { x: (cw / 2 - tx) / sc, y: (ch / 2 - ty) / sc };
}
function proximityVolume(targetX, targetY) {
    const vc = _getViewportCenterOnMap();
    if (!vc) return 0.8;
    const dist = Math.hypot(vc.x - targetX, vc.y - targetY);
    return Math.max(0.08, Math.exp(-dist / 300));
}
function playProximitySound(name, x, y) {
    playSoundAt(name, baseVolume(name) * proximityVolume(x, y));
}

function rand(min, max) { return min + Math.random() * (max - min); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ══════════════════════════════════════════════════════════════════════
// MOLDURAS DE AVATAR (idêntico ao padrão de floresta_mistica.js)
// ══════════════════════════════════════════════════════════════════════
function _nxAddFrame(parentEl, frameW) {
    parentEl.querySelectorAll('.nx-frame-ol,.nx-frame-sh').forEach(e => e.remove());
    const fr = document.createElement('div');
    fr.className = 'nx-frame-ol';
    fr.style.cssText = `position:absolute;left:50%;transform:translateX(-50%);width:${frameW}px;height:${frameW}px;pointer-events:none;z-index:20;background-size:contain;background-repeat:no-repeat;background-position:center;display:none;top:0;`;
    const sh = document.createElement('div');
    sh.className = 'nx-frame-sh';
    sh.style.cssText = `position:absolute;left:50%;transform:translateX(-50%);width:${frameW}px;height:${frameW}px;pointer-events:none;z-index:21;display:none;top:0;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;overflow:hidden;`;
    parentEl.appendChild(fr);
    parentEl.appendChild(sh);
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
        fr.style.backgroundImage = `url('${frameUrl}')`;
        fr.style.display = 'block';
        if (avatarEl) avatarEl.style.border = 'none';
        sh.style.webkitMaskImage = `url('${frameUrl}')`;
        sh.style.maskImage = `url('${frameUrl}')`;
        sh.style.display = 'block';
    } else {
        fr.style.backgroundImage = ''; fr.style.display = 'none';
        sh.style.display = 'none';
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

// ══════════════════════════════════════════════════════════════════════
// MODAL DE CONFIRMAÇÃO DE ENTRADA
// ══════════════════════════════════════════════════════════════════════
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
        const ok = await onConfirm();
        document.getElementById('nexusConfirmYesBtn').disabled = false;
        if (ok) modal.style.display = 'none';
        else msg.textContent = 'Não foi possível entrar no Nexus agora.';
    };
}

// ══════════════════════════════════════════════════════════════════════
// ENTRAR / SAIR
// ══════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════
// ESTADO DO MÓDULO
// ══════════════════════════════════════════════════════════════════════
let ctx = null;                 // { instanceId, playerId, guildId }
let ownPos = { x: 0, y: 0 };
let ownWanderTimer = null;
let localAttackTimeout = null;
let syncTimeout = null;
let running = false;
let isDeadLocal = false;
let deadOverlayInterval = null;
let onForceExitCb = null;
let onBannerEventCb = null;
let otherPlayersCache = new Map();
let mobsCache = new Map();       // mob_index -> { el, type }
let lastEventTs = '1970-01-01T00:00:00+00:00';

// Modelo de lote/hash
let syncSeed = null;
let localSeq = 0;         // próximo seq a usar localmente
let sentSeqBase = 0;      // seq confirmado pelo servidor (next_seq)
let pendingActions = [];  // [{seq, ts, mob_index}] ainda não confirmados
let syncInFlight = false;
let hadRecentActivity = false; // alvo em alcance recentemente -> sync mais rápido

function rangeSq(a, b) { return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2); }

// ══════════════════════════════════════════════════════════════════════
// DOM
// ══════════════════════════════════════════════════════════════════════
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
            <div id="nexusActions">Ações: -- / 5</div>
        </div>
        <div id="nexusMapContainer">
            <div id="nexusMap"></div>
        </div>
        <div id="nexusDeadOverlay">
            <img id="nexusDeadAvatar" src="${DEFAULT_AVATAR}">
            <p>Você foi derrotado!</p>
            <div id="nexusDeadTimer">05:00</div>
        </div>
    `;
    document.body.appendChild(screen);
}

function pickMobType(mobIndex) {
    // Sorteio determinístico por mob_index (mesmo tipo em toda a sessão,
    // mas variando entre os 12 tipos disponíveis nas 3 páginas de caça)
    let seed = 0;
    const str = 'nexus-mob-' + mobIndex;
    for (let i = 0; i < str.length; i++) seed = (seed * 31 + str.charCodeAt(i)) >>> 0;
    return MOB_TYPES[seed % MOB_TYPES.length];
}

function rebuildMobsDOM(mobs) {
    const map = document.getElementById('nexusMap');
    mobsCache.forEach(entry => entry.el.remove());
    mobsCache.clear();
    (mobs || []).forEach(m => {
        const type = pickMobType(m.mob_index);
        const el = document.createElement('div');
        el.className = 'nexus-mob-wrapper';
        el.dataset.mobIndex = m.mob_index;
        el.style.left = m.pos_x + 'px';
        el.style.top = m.pos_y + 'px';
        const av = document.createElement('img');
        av.className = 'nexus-mob-avatar';
        av.src = type.img;
        av.onerror = () => { av.src = DEFAULT_AVATAR; };
        el.appendChild(av);
        if (!m.is_alive) el.classList.add('dead');
        map.appendChild(el);
        mobsCache.set(m.mob_index, { el, type });
    });
}

function updateMobsDOM(mobs) {
    (mobs || []).forEach(m => {
        let entry = mobsCache.get(m.mob_index);
        if (!entry) { rebuildMobsDOM(mobs); return; }
        entry.el.classList.toggle('dead', !m.is_alive);
        entry.el.style.left = m.pos_x + 'px';
        entry.el.style.top = m.pos_y + 'px';
    });
}

function buildOwnPlayerDOM(playerId, avatarUrl) {
    const map = document.getElementById('nexusMap');
    const wrap = document.createElement('div');
    wrap.id = 'nexusOwnPlayer';
    wrap.className = 'nexus-player-wrapper own';
    wrap.style.left = ownPos.x + 'px';
    wrap.style.top = ownPos.y + 'px';
    const avWrap = document.createElement('div');
    avWrap.className = 'avatar-frame-wrap';
    const av = document.createElement('img');
    av.className = 'nexus-player-avatar';
    av.src = avatarUrl || DEFAULT_AVATAR;
    av.onerror = () => { av.src = DEFAULT_AVATAR; };
    avWrap.appendChild(av);
    wrap.appendChild(avWrap);
    map.appendChild(wrap);
    const { fr, sh } = _nxAddFrame(avWrap, 117);
    requestAnimationFrame(() => _nxPositionFrameOffset(fr, sh, av, 117, 60));
    _nxFetchFrame(playerId, fr, sh, av, '3px solid #fc0');
}

function upsertOtherPlayerDOM(p) {
    const map = document.getElementById('nexusMap');
    let entry = otherPlayersCache.get(p.id);
    if (!entry) {
        const wrap = document.createElement('div');
        wrap.className = 'nexus-player-wrapper enemy';
        wrap.dataset.playerId = p.id;
        wrap.style.left = p.pos_x + 'px';
        wrap.style.top = p.pos_y + 'px';

        const nm = document.createElement('div');
        nm.className = 'nexus-player-name';
        nm.textContent = esc(p.name);
        wrap.appendChild(nm);

        const avWrap = document.createElement('div');
        avWrap.className = 'avatar-frame-wrap';
        const av = document.createElement('img');
        av.className = 'nexus-player-avatar';
        av.src = p.avatar_url || DEFAULT_AVATAR;
        av.onerror = () => { av.src = DEFAULT_AVATAR; };
        avWrap.appendChild(av);
        wrap.appendChild(avWrap);

        const lbl = document.createElement('div');
        lbl.className = 'nexus-dead-label';
        lbl.textContent = '💀 Derrotado';
        wrap.appendChild(lbl);

        map.appendChild(wrap);
        const { fr, sh } = _nxAddFrame(avWrap, 117);
        requestAnimationFrame(() => _nxPositionFrameOffset(fr, sh, av, 117, 60));
        _nxFetchFrame(p.id, fr, sh, av, '3px solid #48f');

        entry = { wrap, av, lbl, pos: { x: p.pos_x, y: p.pos_y }, guildId: p.guild_id, name: p.name };
        otherPlayersCache.set(p.id, entry);
    }
    entry.wrap.style.transition = `left 1.2s ease-in-out, top 1.2s ease-in-out`;
    entry.wrap.style.left = p.pos_x + 'px';
    entry.wrap.style.top = p.pos_y + 'px';
    entry.pos = { x: p.pos_x, y: p.pos_y };
    entry.guildId = p.guild_id;
    entry.name = p.name;
    entry.wrap.classList.toggle('is-dead', !!p.is_dead);
    entry.av.classList.toggle('eliminated', !!p.is_dead);
    entry.isDead = !!p.is_dead;
}

function pruneMissingPlayers(currentIds) {
    otherPlayersCache.forEach((entry, id) => {
        if (!currentIds.has(id)) {
            entry.wrap.remove();
            otherPlayersCache.delete(id);
        }
    });
}

// ══════════════════════════════════════════════════════════════════════
// DRAG / PINCH-ZOOM DO MAPA
// ══════════════════════════════════════════════════════════════════════
function enableNexusMapInteraction() {
    const cont = document.getElementById('nexusMapContainer');
    const map = document.getElementById('nexusMap');
    if (!map || !cont) return;
    if (map._interactionEnabled) return;
    map._interactionEnabled = true;

    const SIZE = NEXUS_MAP_SIZE;
    let cx = 0, cy = 0, currentScale = 1;
    let MIN_SCALE = 0.5;
    const MAX_SCALE = 3.0;
    let vx = 0, vy = 0, lt = 0, aId = null;
    const FRICTION = 0.94;
    let drag = false, sx = 0, sy = 0;
    let isPinching = false, pinchStartDist = 0, pinchStartScale = 1;
    let pinchFocalX = 0, pinchFocalY = 0, pinchStartTx = 0, pinchStartTy = 0;
    let minX = 0, maxX = 0, minY = 0, maxY = 0;

    function recalcLimits() {
        const cr = cont.getBoundingClientRect();
        MIN_SCALE = Math.max(cr.width / SIZE, cr.height / SIZE);
        if (currentScale < MIN_SCALE) {
            currentScale = MIN_SCALE;
            map.style.transform = `translate(${cx}px,${cy}px) scale(${currentScale})`;
        }
        minX = Math.min(0, cr.width - SIZE * currentScale);
        minY = Math.min(0, cr.height - SIZE * currentScale);
        maxX = 0; maxY = 0;
    }
    recalcLimits();
    window.addEventListener('resize', recalcLimits);
    map.style.touchAction = 'none';
    map.style.userSelect = 'none';

    function applyTransform(x, y, s) {
        s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
        const cr = cont.getBoundingClientRect();
        const sw = SIZE * s, sh = SIZE * s;
        x = Math.max(Math.min(0, cr.width - sw), Math.min(0, x));
        y = Math.max(Math.min(0, cr.height - sh), Math.min(0, y));
        cx = x; cy = y; currentScale = s;
        map.style.transform = `translate(${x}px,${y}px) scale(${s})`;
        recalcLimits();
    }
    function setPos(x, y) {
        cx = Math.max(minX, Math.min(maxX, x));
        cy = Math.max(minY, Math.min(maxY, y));
        map.style.transform = `translate(${cx}px,${cy}px) scale(${currentScale})`;
    }
    function inertia() {
        cancelAnimationFrame(aId);
        if (drag) return;
        vx *= FRICTION; vy *= FRICTION;
        setPos(cx + vx, cy + vy);
        if (Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4) aId = requestAnimationFrame(inertia);
    }
    function touchDist(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    function touchMid(e) {
        return { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    }
    function startDrag(e) {
        drag = true;
        map.style.cursor = 'grabbing';
        sx = e.clientX ?? e.touches[0].clientX;
        sy = e.clientY ?? e.touches[0].clientY;
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
        setPos(cx + (nx - sx), cy + (ny - sy));
        sx = nx; sy = ny; lt = performance.now();
    }
    function endDrag() {
        drag = false;
        map.style.cursor = 'grab';
        if (Math.abs(vx) > 0.2 || Math.abs(vy) > 0.2) { vx *= 10; vy *= 10; inertia(); }
    }
    function onTouchStart(e) {
        if (e.touches.length >= 2) {
            isPinching = true; drag = false; cancelAnimationFrame(aId);
            pinchStartDist = touchDist(e); pinchStartScale = currentScale;
            const mid = touchMid(e); const cr = cont.getBoundingClientRect();
            pinchFocalX = mid.x - cr.left; pinchFocalY = mid.y - cr.top;
            pinchStartTx = cx; pinchStartTy = cy;
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
        if (isPinching && e.touches.length < 2) { isPinching = false; vx = vy = 0; recalcLimits(); }
        if (e.touches.length === 0) endDrag();
    }
    map.addEventListener('mousedown', startDrag, { passive: true });
    window.addEventListener('mousemove', onDrag, { passive: false });
    window.addEventListener('mouseup', endDrag, { passive: true });
    map.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    map.style.cursor = 'grab';
}

// ══════════════════════════════════════════════════════════════════════
// WANDER DO PRÓPRIO JOGADOR
// ══════════════════════════════════════════════════════════════════════
function scheduleOwnWander() {
    clearTimeout(ownWanderTimer);
    if (!running || isDeadLocal) return;
    const move = () => {
        if (!running || isDeadLocal) return;
        const el = document.getElementById('nexusOwnPlayer');
        const nx = Math.max(0, Math.random() * (NEXUS_MAP_SIZE - AVATAR_W));
        const ny = Math.max(0, Math.random() * (NEXUS_MAP_SIZE - AVATAR_H));
        ownPos = { x: nx, y: ny };
        if (el) {
            el.style.transition = `left ${MOVE_MS}ms ease-in-out, top ${MOVE_MS}ms ease-in-out`;
            el.style.left = nx + 'px';
            el.style.top = ny + 'px';
        }
        ownWanderTimer = setTimeout(pause, MOVE_MS + 100);
    };
    const pause = () => { ownWanderTimer = setTimeout(move, rand(REST_MIN_MS, REST_MAX_MS)); };
    ownWanderTimer = setTimeout(move, rand(0, 2000));
}

// ══════════════════════════════════════════════════════════════════════
// BANNER
// ══════════════════════════════════════════════════════════════════════
function pushNexusBannerEvent(ev) {
    if (typeof onBannerEventCb !== 'function') return;
    if (ev.attacker_won) {
        onBannerEventCb(`<span style="color:#ff8">${esc(ev.attacker_name)}</span> eliminou <span style="color:#f88">${esc(ev.defender_name)}</span> no Nexus!`);
    } else {
        onBannerEventCb(`<span style="color:#f88">${esc(ev.attacker_name)}</span> tentou eliminar <span style="color:#ff8">${esc(ev.defender_name)}</span> no Nexus e perdeu.`);
    }
}

// ══════════════════════════════════════════════════════════════════════
// MORTE / REVIVE
// ══════════════════════════════════════════════════════════════════════
function showDeadOverlay(deadUntilIso, avatarUrl) {
    isDeadLocal = true;
    clearTimeout(ownWanderTimer);
    clearTimeout(localAttackTimeout);
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
        if (remaining <= 0) { clearInterval(deadOverlayInterval); deadOverlayInterval = null; hideDeadOverlay(); }
    };
    tick();
    deadOverlayInterval = setInterval(tick, 1000);
}
function hideDeadOverlay() {
    isDeadLocal = false;
    const overlay = document.getElementById('nexusDeadOverlay');
    if (overlay) overlay.classList.remove('active');
    clearInterval(deadOverlayInterval); deadOverlayInterval = null;
    scheduleOwnWander();
    scheduleLocalAttackLoop();
}

// ══════════════════════════════════════════════════════════════════════
// LOOP LOCAL DE COMBATE (decide alvo/ritmo; não resolve resultado sozinho)
// ══════════════════════════════════════════════════════════════════════
let lastKnownMobs = [];     // [{mob_index,pos_x,pos_y,is_alive}]
let lastKnownPlayers = [];  // via otherPlayersCache

function scheduleLocalAttackLoop() {
    clearTimeout(localAttackTimeout);
    if (!running || isDeadLocal) return;
    localAttackTimeout = setTimeout(doLocalAttackTick, rand(ATTACK_MIN_MS, ATTACK_MAX_MS));
}

async function doLocalAttackTick() {
    if (!running || isDeadLocal) { return; }

    // Mob vivo mais próximo
    let nearestMob = null, nearestMobDist = Infinity;
    lastKnownMobs.forEach(m => {
        if (!m.is_alive) return;
        const d = rangeSq(ownPos, { x: m.pos_x, y: m.pos_y });
        if (d < nearestMobDist) { nearestMobDist = d; nearestMob = m; }
    });

    // Jogador inimigo vivo mais próximo
    let nearestPlayer = null, nearestPlayerDist = Infinity, nearestPlayerId = null;
    otherPlayersCache.forEach((entry, id) => {
        if (entry.isDead) return;
        if (ctx && entry.guildId === ctx.guildId) return;
        const d = rangeSq(ownPos, entry.pos);
        if (d < nearestPlayerDist) { nearestPlayerDist = d; nearestPlayer = entry; nearestPlayerId = id; }
    });

    const range2 = COMBAT_RANGE * COMBAT_RANGE;
    const mobInRange = nearestMob && nearestMobDist <= range2;
    const playerInRange = nearestPlayer && nearestPlayerDist <= range2;

    if (playerInRange && (!mobInRange || nearestPlayerDist <= nearestMobDist)) {
        // PvP: chamada imediata (rara, autoritativa)
        hadRecentActivity = true;
        const { data, error } = await supabase.rpc('nexus_pvp_attack', {
            p_battle_instance_id: ctx.instanceId,
            p_defender_id: nearestPlayerId,
            p_pos_x: ownPos.x,
            p_pos_y: ownPos.y
        });
        if (!error && data) {
            if (data.status === 'force_exit') { handleForceExit(data.reason); return; }
            if (data.success) {
                playProximitySound(data.combat?.some_critical ? 'critical' : 'normal', nearestPlayer.pos.x, nearestPlayer.pos.y);
                pushNexusBannerEvent({ attacker_name: data.attacker_name, defender_name: data.defender_name, attacker_won: data.attacker_won });
                if (!data.attacker_won) {
                    // eu perdi -> minha morte será refletida no próximo sync (own_state)
                }
            }
        }
        maybeSyncSoon();
    } else if (mobInRange) {
        hadRecentActivity = true;
        const seq = localSeq++;
        pendingActions.push({ seq, ts: Date.now(), mob_index: nearestMob.mob_index });

        // Feedback visual/sonoro imediato e otimista (o resultado real vem no próximo sync)
        const mobEntry = mobsCache.get(nearestMob.mob_index);
        const isCrit = Math.random() < 0.15;
        playProximitySound(isCrit ? 'critical' : 'normal', nearestMob.pos_x, nearestMob.pos_y);
        if (mobEntry) playProximitySound('mob_' + mobEntry.type.key, nearestMob.pos_x, nearestMob.pos_y);

        maybeSyncSoon();
    } else {
        hadRecentActivity = false;
    }

    scheduleLocalAttackLoop();
}

// ══════════════════════════════════════════════════════════════════════
// SINCRONIZAÇÃO ADAPTATIVA (lote + hash)
// ══════════════════════════════════════════════════════════════════════
let currentSyncMs = SYNC_BASE_IDLE;

function scheduleSync(delay) {
    clearTimeout(syncTimeout);
    if (!running) return;
    if (document.visibilityState === 'hidden') return;
    syncTimeout = setTimeout(doSync, delay);
}

// Chama antes do próximo ciclo se houver ações pendentes (não espera o backoff todo)
function maybeSyncSoon() {
    if (pendingActions.length >= 5) { doSync(); return; }
    if (!syncInFlight) {
        clearTimeout(syncTimeout);
        syncTimeout = setTimeout(doSync, 2500);
    }
}

async function doSync() {
    if (!running || !ctx || syncInFlight) return;
    syncInFlight = true;
    try {
        const batch = pendingActions.slice();
        let payload = {
            p_battle_instance_id: ctx.instanceId,
            p_pos_x: ownPos.x,
            p_pos_y: ownPos.y,
            p_last_event_timestamp: lastEventTs
        };

        if (batch.length > 0) {
            const seqStart = batch[0].seq;
            const seqEnd = batch[batch.length - 1].seq;
            const actionsJson = JSON.stringify(batch);
            const hash = await sha256Hex(`${syncSeed}:${seqStart}:${seqEnd}:${actionsJson}`);
            payload.p_seq_start = seqStart;
            payload.p_seq_end = seqEnd;
            payload.p_actions_json = actionsJson;
            payload.p_batch_hash = hash;
        }

        const { data, error } = await supabase.rpc('nexus_sync', payload);

        if (error || !data) { scheduleSync(SYNC_BASE_IDLE); syncInFlight = false; return; }

        if (data.status === 'force_exit') { syncInFlight = false; handleForceExit(data.reason); return; }
        if (data.status !== 'active') { scheduleSync(SYNC_BASE_IDLE); syncInFlight = false; return; }

        if (batch.length > 0) {
            if (data.batch_accepted) {
                // Remove do buffer local só o que foi de fato confirmado
                pendingActions = pendingActions.filter(a => a.seq > (data.next_seq - 1));
            } else if (typeof data.next_seq === 'number') {
                // Ressincroniza a sequência local com a do servidor (evita loop de rejeição)
                localSeq = data.next_seq;
                pendingActions = [];
                console.warn('[nexus] lote rejeitado:', data.batch_reject_reason);
            }
        }

        applyState(data);

        currentSyncMs = hadRecentActivity
            ? SYNC_BASE_ACTIVE
            : Math.min(currentSyncMs + SYNC_STEP, SYNC_MAX);
        if (hadRecentActivity) currentSyncMs = SYNC_BASE_ACTIVE;

        scheduleSync(pendingActions.length > 0 ? 4000 : currentSyncMs);
    } catch (e) {
        console.warn('[nexus] sync error', e);
        scheduleSync(SYNC_BASE_IDLE);
    } finally {
        syncInFlight = false;
    }
}

function handleForceExit(reason) {
    stopNexusLoop();
    if (typeof onForceExitCb === 'function') onForceExitCb(reason);
}

function applyState(data) {
    const st = data.own_state;
    if (st) {
        const actionsEl = document.getElementById('nexusActions');
        if (actionsEl) actionsEl.textContent = `Ações: ${st.attacks_left} / 5`;
        const timerEl = document.getElementById('nexusTimer');
        if (timerEl) {
            const s = Math.max(0, st.time_left_seconds | 0);
            const m = Math.floor(s / 60), sec = s % 60;
            timerEl.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        }
        if (st.is_dead && !isDeadLocal) {
            showDeadOverlay(st.dead_until, document.querySelector('#nexusOwnPlayer .nexus-player-avatar')?.src);
        } else if (!st.is_dead && isDeadLocal) {
            hideDeadOverlay();
        }
    }

    if (data.mobs) { lastKnownMobs = data.mobs; updateMobsDOM(data.mobs); }

    if (data.other_players) {
        const ids = new Set();
        data.other_players.forEach(p => { ids.add(p.id); upsertOtherPlayerDOM(p); });
        pruneMissingPlayers(ids);
    }

    if (data.new_events && data.new_events.length) {
        data.new_events.forEach(ev => {
            lastEventTs = ev.timestamp > lastEventTs ? ev.timestamp : lastEventTs;
            pushNexusBannerEvent(ev);
        });
    }
}

// ══════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ══════════════════════════════════════════════════════════════════════
export { ensureNexusDOM };

export function startNexusScreen(options) {
    ensureSoundsPreloaded();
    ctx = { instanceId: options.instanceId, playerId: options.playerId, guildId: options.guildId };
    onForceExitCb = options.onForceExit || null;
    onBannerEventCb = options.onBannerEvent || null;
    lastEventTs = '1970-01-01T00:00:00+00:00';
    isDeadLocal = false;
    syncSeed = options.syncSeed;
    localSeq = options.nextSeq || 0;
    sentSeqBase = localSeq;
    pendingActions = [];
    currentSyncMs = SYNC_BASE_IDLE;
    ownPos = {
        x: options.entryPosX ?? (NEXUS_MAP_SIZE / 2),
        y: options.entryPosY ?? (NEXUS_MAP_SIZE / 2)
    };

    ensureNexusDOM();
    document.querySelectorAll('#nexusOwnPlayer').forEach(e => e.remove());
    otherPlayersCache.forEach(entry => entry.wrap.remove());
    otherPlayersCache.clear();
    document.getElementById('nexusMap').innerHTML = '';
    mobsCache.clear();

    document.getElementById('nexusMap').style.width = NEXUS_MAP_SIZE + 'px';
    document.getElementById('nexusMap').style.height = NEXUS_MAP_SIZE + 'px';

    buildOwnPlayerDOM(options.playerId, options.avatarUrl);
    enableNexusMapInteraction();

    document.getElementById('nexusBackBtn').onclick = () => {
        if (typeof options.onBack === 'function') options.onBack();
    };

    running = true;
    scheduleOwnWander();
    scheduleLocalAttackLoop();
    doSync();
}

export function stopNexusLoop() {
    running = false;
    clearTimeout(syncTimeout); syncTimeout = null;
    clearTimeout(localAttackTimeout); localAttackTimeout = null;
    clearTimeout(ownWanderTimer); ownWanderTimer = null;
    clearInterval(deadOverlayInterval); deadOverlayInterval = null;
}

// Pausa: ainda tenta mandar o que estiver pendente antes de silenciar
export function pauseNexusPolling() {
    clearTimeout(syncTimeout);
    clearTimeout(localAttackTimeout);
    if (running && ctx && pendingActions.length > 0 && !syncInFlight) {
        doSync();
    }
}
export function resumeNexusPolling() {
    if (!running || !ctx) return;
    scheduleLocalAttackLoop();
    doSync();
}

export function isNexusScreenActive() { return running; }
export function getNexusMapSize() { return NEXUS_MAP_SIZE; }
export const NEXUS_IMAGE_URL = NEXUS_IMG_URL;
