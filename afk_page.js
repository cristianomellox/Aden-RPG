import { supabase } from './supabaseClient.js'

// =======================================================================
// ADEN GLOBAL DB
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 6;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(PLAYER_STORE)) db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(AUTH_STORE, 'readonly');
                const req = tx.objectStore(AUTH_STORE).get('current_session');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    getPlayer: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(PLAYER_STORE, 'readonly');
                const req = tx.objectStore(PLAYER_STORE).get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    setPlayer: async function(playerData) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            tx.objectStore(PLAYER_STORE).put({ key: 'player_data', value: playerData });
        } catch(e) { console.warn("Erro ao salvar Player no DB Global", e); }
    },
    updatePlayerPartial: async function(changes) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            const store = tx.objectStore(PLAYER_STORE);
            const currentData = await new Promise(resolve => {
                const req = store.get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
            if (currentData) store.put({ key: 'player_data', value: { ...currentData, ...changes } });
        } catch(e) { console.warn("Erro update parcial", e); }
    }
};

// =======================================================================
// HELPER: MAPPER PROTOCOLO COMPACTO
// =======================================================================
function mapLoadData(arr, uid) {
    if (!arr || !Array.isArray(arr) || arr[0] !== 1) return null;
    return {
        id: uid,
        xp: arr[1],
        gold: arr[2],
        current_afk_stage: arr[3],
        daily_attempts_left: arr[4],
        current_monster_health: arr[5],
        remaining_attacks_in_combat: arr[6],
        last_afk_start_time: arr[7] ? new Date(arr[7] * 1000).toISOString() : new Date().toISOString(),
        level: arr[8],
        daily_rewards_log: arr[9]
    };
}

// =======================================================================
// MAP LAYOUT CONSTANTS
// =======================================================================
const STAGES_PER_ROW  = 20;
const MAP_LEFT_X      = 50;
const MAP_RIGHT_X     = 1450;
const MAP_ROW_START_Y = 120;
const MAP_ROW_STEP_Y  = 100;
const MAX_STAGES      = 100; // 5 rows × 20
const NODE_RADIUS     = 26;

function getStagePos(stageNum) {
    const rowIndex  = Math.floor((stageNum - 1) / STAGES_PER_ROW);
    const posInRow  = (stageNum - 1) % STAGES_PER_ROW;
    const xStep     = (MAP_RIGHT_X - MAP_LEFT_X) / (STAGES_PER_ROW - 1);
    const y         = MAP_ROW_START_Y + rowIndex * MAP_ROW_STEP_Y;
    const x         = (rowIndex % 2 === 0)
        ? MAP_LEFT_X  + posInRow * xStep
        : MAP_RIGHT_X - posInRow * xStep;
    return { x, y };
}

// =======================================================================
// EPIC COMBAT EFFECTS
// =======================================================================
function _injectAfkEpicStyles() {
    if (document.getElementById('afk-epic-styles')) return;
    const css = `
    @keyframes afk-monster-flash     { 0%{filter:brightness(1) drop-shadow(0 0 12px #f80);} 40%{filter:brightness(3.5) drop-shadow(0 0 24px #fff);} 100%{filter:brightness(1) drop-shadow(0 0 6px rgba(255,60,0,.5));} }
    @keyframes afk-monster-crit      { 0%{filter:sepia(1) saturate(4) brightness(1) drop-shadow(0 0 12px #fa0);} 40%{filter:sepia(1) saturate(6) brightness(3) drop-shadow(0 0 30px #ffd700);} 100%{filter:brightness(1) drop-shadow(0 0 6px rgba(255,60,0,.5));} }
    @keyframes afk-shake-monster     { 0%{transform:translate(0,0) rotate(0deg);} 10%{transform:translate(-4px,-3px) rotate(-1.5deg);} 20%{transform:translate(5px,2px) rotate(1deg);} 30%{transform:translate(-5px,3px) rotate(-1deg);} 40%{transform:translate(4px,-2px) rotate(1.5deg);} 50%{transform:translate(-3px,4px) rotate(-0.5deg);} 60%{transform:translate(5px,-3px) rotate(1deg);} 70%{transform:translate(-4px,2px) rotate(-1deg);} 80%{transform:translate(3px,-4px) rotate(0.5deg);} 90%{transform:translate(-2px,3px) rotate(-1deg);} 100%{transform:translate(0,0) rotate(0deg);} }
    @keyframes afk-ring              { 0%{transform:translate(-50%,-50%) scale(0.2);opacity:.9;} 100%{transform:translate(-50%,-50%) scale(2.8);opacity:0;} }
    @keyframes afk-spark             { 0%{transform:translate(-50%,-50%) rotate(var(--a)) translateX(0);opacity:1;} 100%{transform:translate(-50%,-50%) rotate(var(--a)) translateX(var(--d));opacity:0;} }
    @keyframes afk-edge-flash        { 0%,100%{opacity:0;} 30%{opacity:1;} }
    @keyframes afk-floatY            { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-16px);} }
    @keyframes afk-crit-label        { 0%{opacity:0;transform:translateX(-50%) scale(0.5);} 20%{opacity:1;transform:translateX(-50%) scale(1.1);} 80%{opacity:1;} 100%{opacity:0;transform:translateX(-50%) translateY(-18px);} }
    .afk-epic-ring { position:absolute; border-radius:50%; pointer-events:none; z-index:12;
        transform:translate(-50%,-50%); animation:afk-ring 0.6s ease-out forwards; }
    .afk-epic-ring2 { position:absolute; border-radius:50%; pointer-events:none; z-index:12;
        transform:translate(-50%,-50%); animation:afk-ring 0.75s ease-out 0.08s forwards; }
    .afk-epic-spark { position:absolute; border-radius:50%; pointer-events:none; z-index:13;
        transform:translate(-50%,-50%); animation:afk-spark 0.5s ease-out forwards; }
    .afk-crit-label { font-family:'Cinzel',Georgia,serif; font-size:.85em; font-weight:bold;
        color:#ffd700; text-shadow:0 0 8px #ff8800,1px 1px 2px #000;
        position:absolute; left:50%; transform:translateX(-50%); z-index:16;
        pointer-events:none; white-space:nowrap; animation:afk-crit-label 3s ease-out forwards; }
    `;
    const s = document.createElement('style');
    s.id = 'afk-epic-styles';
    s.textContent = css;
    document.head.appendChild(s);
}

function _epicAfkAttack(targetEl, dmg, isCrit) {
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const cx   = rect.left + rect.width / 2;
    const cy   = rect.top  + rect.height / 2;

    // Monster flash
    targetEl.style.animation = 'none';
    void targetEl.offsetWidth;
    targetEl.style.animation = isCrit ? 'afk-monster-crit 0.55s ease-out forwards, afk-floatY 3s ease-in-out infinite 0.56s'
                                      : 'afk-monster-flash 0.4s ease-out forwards, afk-floatY 3s ease-in-out infinite 0.41s';

    // Monster shake on crit
    if (isCrit) {
        const container = document.getElementById('combat-screen');
        if (container) {
            container.style.animation = 'none';
            void container.offsetWidth;
            container.style.animation = 'afk-shake-monster 0.75s cubic-bezier(.36,.07,.19,.97) both';
            setTimeout(() => { container.style.animation = ''; }, 760);
        }
    }

    // Screen edge flash
    const flash = document.getElementById('afk-screen-flash');
    if (flash) {
        flash.style.background = isCrit
            ? 'radial-gradient(ellipse at center, transparent 45%, rgba(255,180,0,.25) 100%)'
            : 'radial-gradient(ellipse at center, transparent 55%, rgba(255,100,0,.15) 100%)';
        flash.style.animation = 'none';
        void flash.offsetWidth;
        flash.style.animation = 'afk-edge-flash 0.45s ease-out forwards';
    }

    // Spawn sparks + rings on combat-screen (relative container)
    const cs = document.getElementById('combat-screen');
    if (!cs) return;
    const csRect = cs.getBoundingClientRect();
    const lx = cx - csRect.left;
    const ly = cy - csRect.top;

    // Shockwave rings
    const ringCount = isCrit ? 2 : 1;
    for (let r = 0; r < ringCount; r++) {
        const ring = document.createElement('div');
        ring.className = r === 0 ? 'afk-epic-ring' : 'afk-epic-ring2';
        const sz = isCrit ? 70 : 55;
        ring.style.cssText = `left:${lx}px;top:${ly}px;width:${sz}px;height:${sz}px;`
            + (isCrit ? 'border:3px solid rgba(255,215,0,.9);' : 'border:2px solid rgba(255,120,0,.8);')
            + `box-shadow:0 0 ${isCrit?14:8}px ${isCrit?'rgba(255,215,0,.6)':'rgba(255,100,0,.4)'};`;
        cs.appendChild(ring);
        ring.addEventListener('animationend', () => ring.remove());
    }

    // Radial sparks
    const nSparks = isCrit ? 14 : 8;
    for (let i = 0; i < nSparks; i++) {
        const spark = document.createElement('div');
        spark.className = 'afk-epic-spark';
        const angle = (360 / nSparks) * i + (Math.random() - 0.5) * 20;
        const dist  = 50 + Math.random() * 55;
        const sz    = isCrit ? (4 + Math.random() * 5) : (3 + Math.random() * 4);
        spark.style.cssText = `left:${lx}px;top:${ly}px;width:${sz}px;height:${sz}px;`
            + `background:${isCrit?'#ffd700':'#ff8c00'};--a:${angle}deg;--d:${dist}px;`
            + `animation-delay:${Math.random() * 0.08}s;`
            + `box-shadow:0 0 4px ${isCrit?'#ffa000':'#ff6000'};`;
        cs.appendChild(spark);
        spark.addEventListener('animationend', () => spark.remove());
    }

    // Crit label
    if (isCrit) {
        const label = document.createElement('div');
        label.className = 'afk-crit-label';
        label.style.cssText = `left:${lx}px;top:${ly - 55}px;`;
        label.textContent = '✦ CRÍTICO! ✦';
        cs.appendChild(label);
        label.addEventListener('animationend', () => label.remove());
    }
}

// =======================================================================
// MAIN
// =======================================================================
document.addEventListener("DOMContentLoaded", async () => {
    console.log("[AFK] DOM carregado — iniciando afk_page.js");

    // Inject epic styles once
    _injectAfkEpicStyles();

    // ── Sons e músicas ──────────────────────────────────────────────
    const normalHitSound   = new Audio("https://aden-rpg.pages.dev/assets/normal_hit.mp3");
    const criticalHitSound = new Audio("https://aden-rpg.pages.dev/assets/critical_hit.mp3");
    const idleMusic        = new Audio("https://aden-rpg.pages.dev/assets/idlesong.mp3");
    const combatMusic      = new Audio("https://aden-rpg.pages.dev/assets/combat_afk_bg.mp3");
    normalHitSound.volume = 0.5;
    criticalHitSound.volume = 0.1;
    idleMusic.volume = 0.2;
    combatMusic.volume = 0.4;
    idleMusic.loop = true;
    combatMusic.loop = true;

    // ── Config ─────────────────────────────────────────────────────
    const XP_RATE_PER_SEC      = 1.0 / 1800;
    const GOLD_RATE_PER_SEC    = 0 / 3600;
    const MAX_AFK_SECONDS      = 4 * 60 * 60;
    const MIN_COLLECT_SECONDS  = 3600;
    const CACHE_EXPIRATION_MS  = 24 * 60 * 60 * 1000;
    const STATS_CACHE_DURATION = 48 * 60 * 60 * 1000;

    // ── UI ELEMENTS ────────────────────────────────────────────────
    const afkXpSpan            = document.getElementById("afk-xp");
    const afkGoldSpan          = document.getElementById("afk-gold");
    const afkTimerSpan         = document.getElementById("afk-timer");
    const afkStageSpan         = document.getElementById("afk-stage");
    const collectBtn           = document.getElementById("hud-collect-btn");
    // Legacy ID kept for compatibility (aliased to hud-collect-btn):
    const collectBtnLegacy     = document.getElementById("collect-rewards-idle"); // null — we alias
    const watchAdAttemptBtn    = document.getElementById("watch-ad-attempt-btn");
    const triggerAdLink        = document.getElementById("trigger-afk_attempt-ad");
    const dailyAttemptsLeftSpan= document.getElementById("daily-attempts-left");
    const playerTotalXpSpan    = document.getElementById("player-total-xp");
    const playerTotalGoldSpan  = document.getElementById("player-total-gold");

    // Combat UI
    const combatScreen         = document.getElementById("combat-screen");
    const monsterNameSpan      = document.getElementById("monster-name");
    const monsterImage         = document.getElementById("monsterImage");
    const monsterHpFill        = document.getElementById("monster-hp-fill");
    const monsterHpBar         = document.getElementById("monster-hp-bar");
    const monsterHpValueSpan   = document.getElementById("monster-hp-value");
    const battleCountdownDisplay = document.getElementById("battle-countdown");
    const attacksLeftSpan      = document.getElementById("time-left");

    // Map + HUD
    const mapContainer         = document.getElementById("mapContainer");
    const mapEl                = document.getElementById("map");
    const stageSvg             = document.getElementById("stageSvg");
    const playerTopBar         = document.getElementById("playerTopBar");
    const afkBottomHud         = document.getElementById("afkBottomHud");
    const hudToggleBtn         = document.getElementById("hudToggleBtn");
    const hudContent           = document.getElementById("hudContent");

    // Modals
    const resultModal          = document.getElementById("result-modal");
    const resultText           = document.getElementById("result-text");
    const confirmBtn           = document.getElementById("confirm-btn");
    const tutorialModal        = document.getElementById("tutorial-modal");
    const closeTutorialBtn     = document.getElementById("close-tutorial-btn");
    const musicPermissionModal = document.getElementById("music-permission-modal");
    const musicPermissionBtn   = document.getElementById("music-permission-btn");
    const adventureOptionsModal= document.getElementById("adventure-options-modal");
    const btnFarmPrevious      = document.getElementById("btn-farm-previous");
    const btnChallengeCurrent  = document.getElementById("btn-challenge-current");
    const closeAdventureOptionsBtn = document.getElementById("close-adventure-options");
    const farmStageNumberSpan  = document.getElementById("farm-stage-number");
    const challengeStageNumberSpan = document.getElementById("challenge-stage-number");
    const adventureModalTitle  = document.getElementById("adventure-modal-title");
    const adventureModalDesc   = document.getElementById("adventure-modal-desc");
    const dailyAttemptsDisplay = document.getElementById("daily-attempts-display");
    const saibaMaisBtn         = document.getElementById("saiba-mais");

    // ── STATE ──────────────────────────────────────────────────────
    let playerAfkData    = {};
    let afkStartTime     = null;
    let timerInterval;
    let localSimulationInterval;
    let cachedCombatStats = null;
    let userId           = null;
    let _hudExpanded     = true;

    // ── CHEVRON SVGs ───────────────────────────────────────────────
    const CHEVRON_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    const CHEVRON_UP   = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;

    function setHudToggle(expanded) {
        _hudExpanded = expanded;
        if (hudToggleBtn) hudToggleBtn.innerHTML = expanded ? CHEVRON_DOWN : CHEVRON_UP;
        if (hudContent)   hudContent.classList.toggle('collapsed', !expanded);
    }
    setHudToggle(true);
    if (hudToggleBtn) hudToggleBtn.addEventListener('click', () => setHudToggle(!_hudExpanded));

    // ── WING AFK INFO (reads aden_inventory_db, zero egress) ──────
    async function loadWingAfkInfo() {
        const wingImgEl   = document.getElementById('hud-wing-img');
        const wingLabelEl = document.getElementById('hud-wing-label');
        if (!wingImgEl || !wingLabelEl) return;

        try {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('aden_inventory_db');
                req.onsuccess = () => resolve(req.result);
                req.onerror   = () => reject(req.error);
            });

            const items = await new Promise((resolve, reject) => {
                const tx  = db.transaction('inventory_store', 'readonly');
                const req = tx.objectStore('inventory_store').getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror   = () => reject(req.error);
            });

            // Find equipped wing with afk_xp_bonus
            const wing = items.find(i =>
                i.equipped_slot === 'wing' &&
                (i.afk_xp_bonus > 0 || (i.items && i.items.afk_xp > 0))
            );

            if (wing) {
                // Build image URL (same formula as inventory.js)
                const def        = wing.items || {};
                const name       = def.name || 'unknown';
                const baseStars  = def.stars || 1;
                const refine     = wing.refine_level || 0;
                const totalStars = baseStars + refine;
                const rarity     = (def.rarity || 'R').toUpperCase();
                const imgUrl     = `https://aden-rpg.pages.dev/assets/itens/${name}_${totalStars}estrelas.webp`;
                wingImgEl.src            = imgUrl;
                wingImgEl.style.display  = 'block';
                wingLabelEl.textContent  = `Bônus de Asa ${rarity}`;
                wingLabelEl.style.color  = rarity === 'SR' ? '#8b5cf6' : '#2d7a2d';

                // Container styling
                const container = document.getElementById('hud-wing-info');
                if (container) {
                    container.style.background   = rarity === 'SR'
                        ? 'rgba(40,10,70,.7)' : 'rgba(10,40,10,.7)';
                    container.style.borderColor  = rarity === 'SR' ? '#8b5cf6' : '#2d7a2d';
                }
            } else {
                // Try fallback: fetch from backend only if IDB had no items at all
                if (items.length === 0 && userId) {
                    // Check GlobalDB player data for wing hint
                    const gData = await GlobalDB.getPlayer();
                    // No easy wing data in GlobalDB — just show no bonus
                }
                wingImgEl.style.display = 'none';
                wingLabelEl.textContent = 'Sem bônus de Asa';
                wingLabelEl.style.color = '#888';
            }
        } catch(e) {
            console.warn('[AFK] Wing info IDB error:', e);
            const wingLabelEl2 = document.getElementById('hud-wing-label');
            if (wingLabelEl2) { wingLabelEl2.textContent = 'Sem bônus de Asa'; wingLabelEl2.style.color = '#888'; }
        }
    }



    // ── AUTH ───────────────────────────────────────────────────────
    async function getLocalUserId() {
        const globalAuth = await GlobalDB.getAuth();
        if (globalAuth?.value?.user) return globalAuth.value.user.id;
        try {
            const cached = localStorage.getItem('player_data_cache');
            if (cached) {
                const p = JSON.parse(cached);
                if (p?.data?.id) return p.data.id;
                if (p?.id) return p.id;
            }
        } catch(e) {}
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                    const s = JSON.parse(localStorage.getItem(k));
                    if (s?.user?.id) return s.user.id;
                }
            }
        } catch(e) {}
        return null;
    }

    // ── FORMATTING ─────────────────────────────────────────────────
    function formatNumberCompact(num) {
        return new Intl.NumberFormat('en-US').format(num);
    }

    // ── LOCAL SIMULATION ───────────────────────────────────────────
    function updateLocalSimulation() {
        if (!afkStartTime || !playerAfkData) return;
        const now = Date.now();
        let secondsElapsed = Math.floor((now - afkStartTime) / 1000);
        const displaySeconds = Math.min(secondsElapsed, MAX_AFK_SECONDS);
        const remainingSeconds = Math.max(0, MAX_AFK_SECONDS - displaySeconds);
        const h = Math.floor(remainingSeconds / 3600);
        const m = Math.floor((remainingSeconds % 3600) / 60);
        const s = remainingSeconds % 60;
        if (afkTimerSpan) afkTimerSpan.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

        const cappedSeconds = Math.min(secondsElapsed, MAX_AFK_SECONDS);
        const stage    = playerAfkData.current_afk_stage || 1;
        const xpEarned = Math.floor(cappedSeconds * XP_RATE_PER_SEC * stage);
        const goldEarned = Math.floor(cappedSeconds * GOLD_RATE_PER_SEC);

        if (afkXpSpan)   afkXpSpan.textContent   = formatNumberCompact(xpEarned);
        if (afkGoldSpan) afkGoldSpan.textContent  = formatNumberCompact(goldEarned);

        const isCollectable = (xpEarned > 0 || goldEarned > 0) && (secondsElapsed >= MIN_COLLECT_SECONDS);
        if (collectBtn) {
            collectBtn.disabled = !isCollectable;
            collectBtn.style.opacity = isCollectable ? '1' : '0.45';
        }
    }

    // ── COMBAT STATS CACHE ─────────────────────────────────────────
    async function getOrUpdatePlayerStatsCache(forceUpdate = false) {
        if (!userId) return null;
        const now = Date.now();
        const cacheKey = `player_combat_stats_${userId}`;
        let stored = localStorage.getItem(cacheKey);
        if (stored && !forceUpdate) {
            try {
                const parsed = JSON.parse(stored);
                if (now - parsed.timestamp < STATS_CACHE_DURATION) {
                    cachedCombatStats = parsed.data;
                    return cachedCombatStats;
                }
            } catch(e) {}
        }
        return null;
    }

    // ── RENDER PLAYER DATA ─────────────────────────────────────────
    function renderPlayerData() {
        if (!playerAfkData) return;
        if (playerAfkData.last_afk_start_time) {
            afkStartTime = new Date(playerAfkData.last_afk_start_time).getTime();
        } else {
            afkStartTime = Date.now();
        }
        if (playerTotalXpSpan)   playerTotalXpSpan.textContent   = formatNumberCompact(playerAfkData.xp || 0);
        if (playerTotalGoldSpan) playerTotalGoldSpan.textContent = formatNumberCompact(playerAfkData.gold || 0);
        if (afkStageSpan)        afkStageSpan.textContent        = playerAfkData.current_afk_stage ?? 1;
        if (dailyAttemptsLeftSpan) dailyAttemptsLeftSpan.textContent = playerAfkData.daily_attempts_left ?? 0;
        if (dailyAttemptsDisplay)  dailyAttemptsDisplay.textContent  = playerAfkData.daily_attempts_left ?? 0;
        updateLocalSimulation();

        // Re-render map if visible
        if (mapContainer && mapContainer.style.display !== 'none') {
            renderStageMap(playerAfkData.current_afk_stage || 1);
        }
    }

    // ── CACHE ──────────────────────────────────────────────────────
    async function saveToCache(data) {
        if (!userId) return;
        await GlobalDB.setPlayer(data);
        localStorage.setItem(`playerAfkData_${userId}`, JSON.stringify({ data, timestamp: Date.now() }));
    }

    // ── INIT ───────────────────────────────────────────────────────
    async function initializePlayerData() {
        userId = await getLocalUserId();
        if (!userId) {
            const { data: sessionData } = await supabase.auth.getSession({ cache: 'memory-only' });
            if (sessionData?.session) {
                userId = sessionData.session.user.id;
            } else {
                window.location.href = "index.html";
                return;
            }
        }

        await getOrUpdatePlayerStatsCache();
        let shouldUseCache = false;

        const globalData = await GlobalDB.getPlayer();
        if (globalData) {
            if (globalData.id === userId && globalData.last_afk_start_time) {
                playerAfkData = globalData;
                shouldUseCache = true;
            }
        }

        if (!shouldUseCache) {
            const cacheKey = `playerAfkData_${userId}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const { data, timestamp } = JSON.parse(cached);
                    if (Date.now() - timestamp < CACHE_EXPIRATION_MS) {
                        playerAfkData = data;
                        shouldUseCache = true;
                    }
                } catch(e) {}
            }
        }

        if (shouldUseCache) {
            const lastResetDate = new Date(playerAfkData.last_attempt_reset || 0);
            const now = new Date();
            const isNewDay = now.getUTCDate() !== lastResetDate.getUTCDate() ||
                             now.getUTCMonth() !== lastResetDate.getUTCMonth() ||
                             now.getUTCFullYear() !== lastResetDate.getUTCFullYear();
            if (isNewDay) {
                const { data: resetData, error: resetError } = await supabase.rpc('check_daily_reset', { p_player_id: userId });
                if (!resetError && resetData) {
                    playerAfkData.daily_attempts_left = resetData.daily_attempts_left;
                    if (resetData.reset_performed) playerAfkData.last_attempt_reset = new Date().toISOString();
                    saveToCache(playerAfkData);
                }
            }
        }

        if (!shouldUseCache) {
            let { data, error } = await supabase.rpc('get_player_afk_data', { uid: userId });
            if (error || (data && data.error)) {
                const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
                if (!refreshError && refreshData.session) {
                    userId = refreshData.session.user.id;
                    const retry = await supabase.rpc('get_player_afk_data', { uid: userId });
                    data = retry.data; error = retry.error;
                } else {
                    window.location.href = "index.html";
                    return;
                }
            }
            if (data && Array.isArray(data) && data[0] === 1) {
                playerAfkData = mapLoadData(data, userId);
                saveToCache(playerAfkData);
            }
        }

        renderPlayerData();
        if (localSimulationInterval) clearInterval(localSimulationInterval);
        localSimulationInterval = setInterval(updateLocalSimulation, 1000);
    }

    // ── MAP RENDERING ──────────────────────────────────────────────
    function renderStageMap(currentStage) {
        if (!mapEl || !stageSvg) return;

        // Clear previous nodes (keep SVG)
        mapEl.querySelectorAll('.stage-node').forEach(el => el.remove());

        // Clear SVG
        while (stageSvg.firstChild) stageSvg.removeChild(stageSvg.firstChild);

        const showUpTo = MAX_STAGES; // always render all stages up to max

        // ── Draw connecting lines ──────────────────────────────────
        for (let s = 1; s < showUpTo; s++) {
            const from = getStagePos(s);
            const to   = getStagePos(s + 1);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
            line.setAttribute('x2', to.x);   line.setAttribute('y2', to.y);

            const bothComplete  = (s + 1) < currentStage;
            const touchesCurrent = (s === currentStage - 1) || (s + 1 === currentStage);

            if (bothComplete) {
                line.setAttribute('stroke', '#3a7a3a');
                line.setAttribute('stroke-width', '5');
                line.setAttribute('opacity', '0.85');
            } else if (touchesCurrent) {
                line.setAttribute('stroke', '#c87000');
                line.setAttribute('stroke-width', '4');
                line.setAttribute('opacity', '0.9');
            } else {
                line.setAttribute('stroke', '#2a2a3a');
                line.setAttribute('stroke-width', '2');
                line.setAttribute('stroke-dasharray', '8,6');
                line.setAttribute('opacity', '0.5');
            }
            stageSvg.appendChild(line);
        }

        // ── Draw row-bend connectors (arc hint at ends of rows) ────
        for (let row = 0; row < Math.floor(showUpTo / STAGES_PER_ROW); row++) {
            const lastInRow  = (row + 1) * STAGES_PER_ROW;
            const firstNext  = lastInRow + 1;
            if (firstNext > showUpTo) break;
            const from = getStagePos(lastInRow);
            const to   = getStagePos(firstNext);
            const bend = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const midY = (from.y + to.y) / 2;
            // Gentle curve between rows
            bend.setAttribute('d', `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`);
            const complete = lastInRow < currentStage;
            bend.setAttribute('stroke', complete ? '#3a7a3a' : '#2a2a3a');
            bend.setAttribute('stroke-width', complete ? '5' : '2');
            bend.setAttribute('stroke-dasharray', complete ? 'none' : '8,6');
            bend.setAttribute('fill', 'none');
            bend.setAttribute('opacity', complete ? '0.85' : '0.5');
            stageSvg.appendChild(bend);
        }

        // ── Draw stage nodes ───────────────────────────────────────
        for (let s = 1; s <= showUpTo; s++) {
            const pos  = getStagePos(s);
            const node = document.createElement('div');
            node.className = 'stage-node';
            node.style.left = pos.x + 'px';
            node.style.top  = pos.y + 'px';

            if (s > currentStage) {
                node.classList.add('locked');
            } else if (s === currentStage) {
                node.classList.add('current');
            } else if (s === currentStage - 1) {
                node.classList.add('farmable');
            } else {
                node.classList.add('completed');
            }

            node.textContent = s;
            node.addEventListener('click', () => handleStageClick(s));
            mapEl.appendChild(node);
        }
    }

    function centerMapOnStage(stageNum) {
        if (!mapEl || !mapContainer) return;
        const pos  = getStagePos(stageNum);
        const scale = 1.1;
        const cw   = mapContainer.clientWidth  || window.innerWidth;
        const ch   = mapContainer.clientHeight || window.innerHeight;
        // Translate so the stage center is in the viewport center
        let tx = cw / 2 - pos.x * scale;
        let ty = ch / 2 - pos.y * scale;
        // Clamp
        const minX = Math.min(0, cw - 1500 * scale);
        const minY = Math.min(0, ch - 1500 * scale);
        tx = Math.max(minX, Math.min(tx, 0));
        ty = Math.max(minY, Math.min(ty, 0));
        mapEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    }

    // ── DRAGGABLE MAP (same as floresta) ───────────────────────────
    function enableMapInteraction() {
        if (!mapEl || !mapContainer) return;
        let drag = false, sx, sy, cx = 0, cy = 0, vx = 0, vy = 0, lt = 0, aId = null;
        const scale = 1.1;

        const limits = () => {
            const cr = mapContainer.getBoundingClientRect();
            return {
                minX: Math.min(0, cr.width  - 1500 * scale), maxX: 0,
                minY: Math.min(0, cr.height - 1500 * scale), maxY: 0
            };
        };
        const setPos = (x, y) => {
            const L = limits();
            cx = Math.max(L.minX, Math.min(x, L.maxX));
            cy = Math.max(L.minY, Math.min(y, L.maxY));
            mapEl.style.transform = `translate(${cx}px,${cy}px) scale(${scale})`;
        };
        const inertia = () => {
            cancelAnimationFrame(aId);
            if (drag) return;
            vx *= 0.93; vy *= 0.93;
            setPos(cx + vx, cy + vy);
            if (Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4) aId = requestAnimationFrame(inertia);
        };
        const startDrag = e => {
            if (e.touches?.length > 1) return;
            drag = true;
            mapEl.style.cursor = 'grabbing';
            sx = e.clientX ?? e.touches[0].clientX;
            sy = e.clientY ?? e.touches[0].clientY;
            vx = vy = 0; lt = performance.now();
            cancelAnimationFrame(aId);
        };
        const onDrag = e => {
            if (!drag) return;
            e.preventDefault();
            const nx = e.clientX ?? e.touches[0].clientX;
            const ny = e.clientY ?? e.touches[0].clientY;
            const dt = performance.now() - lt;
            if (dt > 0) { vx = (nx - sx) / dt; vy = (ny - sy) / dt; }
            setPos(cx + (nx - sx), cy + (ny - sy));
            sx = nx; sy = ny; lt = performance.now();
        };
        const endDrag = () => {
            drag = false;
            mapEl.style.cursor = 'grab';
            if (Math.abs(vx) > 0.2 || Math.abs(vy) > 0.2) { vx *= 10; vy *= 10; inertia(); }
        };

        mapEl.addEventListener('mousedown',  startDrag, { passive: true });
        window.addEventListener('mousemove', onDrag,    { passive: false });
        window.addEventListener('mouseup',   endDrag,   { passive: true });
        mapEl.addEventListener('touchstart', startDrag, { passive: true });
        window.addEventListener('touchmove', onDrag,    { passive: false });
        window.addEventListener('touchend',  endDrag,   { passive: true });
        mapEl.style.cursor = 'grab';
    }

    // ── HANDLE STAGE CLICK ─────────────────────────────────────────
    function handleStageClick(stageNum) {
        const currentStage = playerAfkData.current_afk_stage || 1;
        const attempts     = playerAfkData.daily_attempts_left ?? 0;

        if (stageNum > currentStage) return; // locked

        // Update tag
        if (dailyAttemptsDisplay) dailyAttemptsDisplay.textContent = attempts;

        // Show correct button layout
        if (btnFarmPrevious)      btnFarmPrevious.style.display      = 'none';
        if (btnChallengeCurrent)  btnChallengeCurrent.style.display  = 'none';
        if (watchAdAttemptBtn)    watchAdAttemptBtn.style.display    = 'none';

        if (attempts <= 0) {
            // Check video limit
            let videoLimitReached = false;
            if (playerAfkData.daily_rewards_log?.counts) {
                if ((playerAfkData.daily_rewards_log.counts['afk_attempt'] || 0) >= 5) videoLimitReached = true;
            }
            if (adventureModalTitle) adventureModalTitle.textContent = 'Tentativas Esgotadas';
            if (adventureModalDesc)  adventureModalDesc.textContent  =
                videoLimitReached
                ? 'Você atingiu o limite diário de tentativas e anúncios. Volte amanhã!'
                : 'Você não tem mais tentativas diárias.\nAssista um anúncio para ganhar +1 tentativa?';
            if (!videoLimitReached && watchAdAttemptBtn) watchAdAttemptBtn.style.display = 'block';

        } else if (stageNum === currentStage) {
            // Challenge
            if (challengeStageNumberSpan) challengeStageNumberSpan.textContent = stageNum;
            if (adventureModalTitle) adventureModalTitle.textContent = `Desafiar Estágio ${stageNum}`;
            if (adventureModalDesc)  adventureModalDesc.textContent  =
                `Use 1 tentativa para combater o monstro do Estágio ${stageNum}.\nSe vencer, você avança de estágio e aumenta sua coleta AFK!`;
            if (btnChallengeCurrent) btnChallengeCurrent.style.display = 'block';

        } else {
            // Farm
            if (farmStageNumberSpan) farmStageNumberSpan.textContent = stageNum;
            if (adventureModalTitle) adventureModalTitle.textContent = `Farmar Estágio ${stageNum}`;
            if (adventureModalDesc)  adventureModalDesc.textContent  =
                `Use 1 tentativa para coletar recompensas do Estágio ${stageNum} sem risco de retroceder.`;
            if (btnFarmPrevious) btnFarmPrevious.style.display = 'block';
        }

        if (adventureOptionsModal) adventureOptionsModal.style.display = 'flex';
    }

    // ── SCREENS ────────────────────────────────────────────────────
    function showMapScreen() {
        if (mapContainer)  { mapContainer.style.display  = 'block'; }
        if (playerTopBar)  { playerTopBar.style.display  = 'flex'; }
        if (afkBottomHud)  { afkBottomHud.style.display  = 'flex'; }
        if (combatScreen)  { combatScreen.style.display  = 'none'; }
        combatMusic.pause();
        idleMusic.play().catch(() => {});
        renderPlayerData();
        renderStageMap(playerAfkData.current_afk_stage || 1);
        loadWingAfkInfo();
        // Center map on current stage after a tick
        setTimeout(() => centerMapOnStage(playerAfkData.current_afk_stage || 1), 50);
    }

    // Legacy alias (used by event listeners below)
    const showIdleScreen = showMapScreen;

    function showCombatScreen() {
        if (mapContainer)  { mapContainer.style.display  = 'none'; }
        if (playerTopBar)  { playerTopBar.style.display  = 'none'; }
        if (afkBottomHud)  { afkBottomHud.style.display  = 'none'; }
        if (combatScreen)  { combatScreen.style.display  = 'flex'; }
        idleMusic.pause();
        combatMusic.play().catch(() => {});
    }

    // ── HP BAR COLOR ───────────────────────────────────────────────
    function updateHpBarColor(pct) {
        if (!monsterHpFill) return;
        if (pct > 50) {
            monsterHpFill.style.background = `linear-gradient(90deg, #28a028, #40c040)`;
        } else if (pct > 25) {
            monsterHpFill.style.background = `linear-gradient(90deg, #c08000, #e0a000)`;
        } else {
            monsterHpFill.style.background = `linear-gradient(90deg, #c02020, #e03030)`;
        }
    }


    // ── STYLED REWARD MESSAGE HELPER ──────────────────────────────
    function styledRewardMsg(parts) {
        // parts: array of {text, xp, gold, bonus_xp}
        // Builds HTML with gradient spans for XP and gold values
        return parts.map(p => {
            if (p.type === 'xp') {
                return `<span class="reward-xp-val">${p.val} XP</span>`;
            } else if (p.type === 'gold') {
                return `<span class="reward-gold-val">${p.val} Ouro</span>`;
            } else {
                return p.val;
            }
        }).join('');
    }

    // ── COLLECT REWARDS ────────────────────────────────────────────
    if (collectBtn) {
        collectBtn.addEventListener("click", async () => {
            if (!userId || collectBtn.disabled) return;
            collectBtn.disabled = true;

            const { data, error } = await supabase.rpc('collect_afk_rewards', { uid: userId });
            if (error) { console.error("Erro ao coletar:", error); collectBtn.disabled = false; return; }

            if (data && Array.isArray(data) && data[0] === 1) {
                const xpGained   = data[1];
                const goldGained = data[2];
                const newLevel   = data[3];
                const isLevelUp  = data[4] === 1;
                const bonusXp    = data[5] || 0;

                if (xpGained || bonusXp) playerAfkData.xp = (playerAfkData.xp || 0) + xpGained + bonusXp;
                if (goldGained) playerAfkData.gold = (playerAfkData.gold || 0) + goldGained;
                playerAfkData.last_afk_start_time = new Date().toISOString();
                if (isLevelUp) { playerAfkData.level = newLevel; showLevelUpBalloon(newLevel); }

                await saveToCache(playerAfkData);
                renderPlayerData();
                localStorage.removeItem('aden_player_last_fetch_ts');

                let msgParts = [
                    { type: 'text', val: 'Você coletou ' },
                    { type: 'xp', val: formatNumberCompact(xpGained) },
                    { type: 'text', val: ' e ' },
                    { type: 'gold', val: formatNumberCompact(goldGained) },
                    { type: 'text', val: '!' },
                ];
                if (bonusXp > 0) {
                    msgParts.push({ type: 'text', val: '<br>✨ Bônus da Asa: ' });
                    msgParts.push({ type: 'xp', val: '+' + formatNumberCompact(bonusXp) });
                }
                resultText.innerHTML = styledRewardMsg(msgParts);
                resultModal.style.display = "flex";
            } else {
                collectBtn.disabled = false;
            }
        });
    }

    // ── TRIGGER ADVENTURE ─────────────────────────────────────────
    async function triggerAdventure(isFarming) {
        if (adventureOptionsModal) adventureOptionsModal.style.display = "none";

        const { data, error } = await supabase.rpc('start_afk_adventure', {
            p_player_id: userId, p_farm_mode: isFarming
        });

        if (error || !data || !Array.isArray(data) || data[0] !== 1) {
            const msg = (data && data[1] === 'NO_ATTEMPTS') ? "Sem tentativas diárias!" : "Erro na aventura.";
            resultText.textContent = msg;
            resultModal.style.display = "flex";
            return;
        }

        const didWin     = data[1] === 1;
        const xpGained   = data[2];
        const goldGained = data[3];
        const newLevel   = data[4];
        const hpLeft     = data[5];
        const attackLog  = data[6];
        const targetStage= data[7];

        playerAfkData.daily_attempts_left = Math.max(0, playerAfkData.daily_attempts_left - 1);
        if (didWin) {
            playerAfkData.xp   = (playerAfkData.xp   || 0) + xpGained;
            playerAfkData.gold = (playerAfkData.gold  || 0) + goldGained;
            if (!isFarming) playerAfkData.current_afk_stage = (playerAfkData.current_afk_stage || 1) + 1;
        }

        const leveledUp = String(playerAfkData.level) !== String(newLevel);
        if (leveledUp) playerAfkData.level = newLevel;

        await saveToCache(playerAfkData);
        renderPlayerData();
        localStorage.removeItem('aden_player_last_fetch_ts');

        const combatData = {
            venceu: didWin, xp_ganho: xpGained, gold_ganho: goldGained,
            leveled_up: leveledUp, new_level: newLevel,
            monster_hp_inicial: hpLeft + calculateTotalDamage(attackLog),
            monstro_hp_restante: hpLeft, attacks: attackLog, target_stage: targetStage
        };

        if (isFarming) {
            resultText.innerHTML = styledRewardMsg([
                { type: 'text', val: 'FARM CONCLUÍDO! Ganhou ' },
                { type: 'xp', val: formatNumberCompact(xpGained) },
                { type: 'text', val: ' e ' },
                { type: 'gold', val: formatNumberCompact(goldGained) },
                { type: 'text', val: ' (Estágio mantido)' },
            ]);
            resultModal.style.display = "flex";
            if (leveledUp) showLevelUpBalloon(newLevel);
        } else {
            runCombatAnimation(combatData);
        }
    }

    function calculateTotalDamage(logs) {
        if (!logs || !Array.isArray(logs)) return 0;
        return logs.reduce((acc, curr) => {
            const dmg = Array.isArray(curr) ? curr[0] : (curr.damage || 0);
            return acc + dmg;
        }, 0);
    }

    // ── COMBAT ANIMATION (EPIC) ────────────────────────────────────
    function runCombatAnimation(data) {
        showCombatScreen();
        const targetStage = data.target_stage;
        if (monsterNameSpan) monsterNameSpan.textContent = `Monstro do Estágio ${targetStage}`;
        if (monsterImage) {
            const imgs = window.monsterStageImages;
            monsterImage.src = imgs?.[(targetStage - 1) % imgs.length] || '';
        }

        if (monsterHpBar)          monsterHpBar.style.display          = 'none';
        if (attacksLeftSpan)       attacksLeftSpan.style.display       = 'none';
        if (battleCountdownDisplay){ battleCountdownDisplay.style.display = 'block'; battleCountdownDisplay.textContent = 'Batalha em: 3'; }

        let countdown = 3;
        const countdownId = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                battleCountdownDisplay.textContent = `Batalha em: ${countdown}`;
            } else {
                clearInterval(countdownId);
                battleCountdownDisplay.style.display = 'none';
                if (monsterHpBar)    monsterHpBar.style.display    = 'block';
                if (attacksLeftSpan) attacksLeftSpan.style.display = 'block';

                const monsterMaxHp = data.monster_hp_inicial;
                let currentHp = monsterMaxHp;

                if (monsterHpValueSpan) monsterHpValueSpan.textContent = `${formatNumberCompact(currentHp)} / ${formatNumberCompact(monsterMaxHp)}`;
                if (monsterHpFill) monsterHpFill.style.width = '100%';
                updateHpBarColor(100);

                const attackLog = data.attacks || [];
                if (attacksLeftSpan) attacksLeftSpan.textContent = attackLog.length;

                let idx = 0;
                const animateAttack = () => {
                    if (idx < attackLog.length) {
                        const attackData = attackLog[idx];
                        const damage = Array.isArray(attackData) ? attackData[0] : attackData.damage;
                        const isCrit = Array.isArray(attackData) ? attackData[1] === 1 : attackData.is_crit;

                        // EPIC effect
                        _epicAfkAttack(monsterImage, damage, isCrit);
                        displayDamageNumber(damage, isCrit);

                        // Sound
                        if (isCrit) { criticalHitSound.currentTime = 0; criticalHitSound.play().catch(()=>{}); }
                        else        { normalHitSound.currentTime   = 0; normalHitSound.play().catch(()=>{});   }

                        currentHp = Math.max(0, currentHp - damage);
                        const pct = (currentHp / monsterMaxHp) * 100;
                        if (monsterHpFill) monsterHpFill.style.width = `${pct}%`;
                        updateHpBarColor(pct);
                        if (monsterHpValueSpan) monsterHpValueSpan.textContent = `${formatNumberCompact(currentHp)} / ${formatNumberCompact(monsterMaxHp)}`;
                        idx++;
                        if (attacksLeftSpan) attacksLeftSpan.textContent = attackLog.length - idx;

                        setTimeout(animateAttack, 900);
                    } else {
                        // End of combat
                        if (data.venceu) {
                            resultText.innerHTML = styledRewardMsg([
                                { type: 'text', val: '⚔ VITÓRIA! Ganhou ' },
                                { type: 'xp', val: formatNumberCompact(data.xp_ganho) },
                                { type: 'text', val: ', ' },
                                { type: 'gold', val: formatNumberCompact(data.gold_ganho) },
                                { type: 'text', val: ' e AVANÇOU de estágio!' },
                            ]);
                        } else {
                            resultText.innerHTML = '💀 Você não derrotou o monstro. Melhore seus equipamentos e tente novamente!';
                        }
                        if (resultModal) resultModal.style.display = "flex";
                        if (data.leveled_up) showLevelUpBalloon(data.new_level);
                    }
                };
                animateAttack();
            }
        }, 1000);
    }

    // ── EPIC FLOATING DAMAGE ───────────────────────────────────────
    function displayDamageNumber(damage, isCrit) {
        const container = combatScreen;
        if (!container) return;
        const el = document.createElement("div");
        el.textContent = formatNumberCompact(damage);
        el.className = isCrit ? "crit-damage-number" : "normal-damage-number";
        el.style.cssText = `position:absolute;left:50%;top:35%;transform:translate(-50%,-50%);animation:floatAndFade 1.4s forwards;pointer-events:none;`;
        if (isCrit) el.textContent = `⚡ ${formatNumberCompact(damage)} ⚡`;
        container.appendChild(el);
        el.addEventListener("animationend", () => el.remove());
    }

    // ── LEVEL UP ───────────────────────────────────────────────────
    function showLevelUpBalloon(newLevel) {
        const balloon = document.getElementById("levelUpBalloon");
        const text    = document.getElementById("levelUpBalloonText");
        if (balloon && text) {
            text.innerText = newLevel;
            balloon.style.display = "flex";
            setTimeout(() => { balloon.style.display = "none"; }, 5500);
        }
    }

    // ── EVENT LISTENERS ────────────────────────────────────────────

    // Music permission → show map
    if (musicPermissionBtn) {
        musicPermissionBtn.addEventListener("click", () => {
            musicPermissionModal.style.display = "none";
            [combatMusic, normalHitSound, criticalHitSound].forEach(audio => {
                audio.play().then(() => { audio.pause(); audio.currentTime = 0; }).catch(()=>{});
            });
            showMapScreen();
        });
    }

    // Stage farm / challenge
    if (btnFarmPrevious)    btnFarmPrevious.addEventListener("click",    () => triggerAdventure(true));
    if (btnChallengeCurrent) btnChallengeCurrent.addEventListener("click", () => triggerAdventure(false));
    if (closeAdventureOptionsBtn) closeAdventureOptionsBtn.addEventListener("click", () => {
        if (adventureOptionsModal) adventureOptionsModal.style.display = "none";
    });

    // Watch ad button
    if (watchAdAttemptBtn) {
        watchAdAttemptBtn.addEventListener("click", async () => {
            watchAdAttemptBtn.disabled = true;
            watchAdAttemptBtn.textContent = "Carregando...";
            try {
                const { data: token, error: rpcError } = await supabase.rpc('generate_reward_token', { p_reward_type: 'afk_attempt' });
                if (rpcError) {
                    resultText.textContent = rpcError.message.toLowerCase().includes('limite')
                        ? "Limite diário de anúncios atingido!"
                        : rpcError.message;
                    if (adventureOptionsModal) adventureOptionsModal.style.display = "none";
                    resultModal.style.display = "flex";
                    if (rpcError.message.toLowerCase().includes('limite') && watchAdAttemptBtn) {
                        watchAdAttemptBtn.style.display = 'none';
                    }
                    watchAdAttemptBtn.disabled = false;
                    watchAdAttemptBtn.textContent = "📺 Assistir Anúncio (+1 tentativa)";
                    return;
                }
                localStorage.setItem('pending_reward_token', token);
                if (triggerAdLink) triggerAdLink.click();
            } catch(e) {
                resultText.textContent = "Erro ao conectar com o servidor.";
                resultModal.style.display = "flex";
                watchAdAttemptBtn.disabled = false;
                watchAdAttemptBtn.textContent = "📺 Assistir Anúncio (+1 tentativa)";
            }
        });
    }

    // Confirm result modal → back to map
    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            if (resultModal) resultModal.style.display = "none";
            showMapScreen();
        });
    }

    // Tutorial
    if (saibaMaisBtn) saibaMaisBtn.addEventListener("click", () => {
        if (tutorialModal) tutorialModal.style.display = "flex";
    });
    if (closeTutorialBtn) closeTutorialBtn.addEventListener("click", () => {
        if (tutorialModal) tutorialModal.style.display = "none";
    });

    // ── INIT ───────────────────────────────────────────────────────
    enableMapInteraction();
    initializePlayerData();
});
