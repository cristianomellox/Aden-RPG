import { supabase } from './supabaseClient.js'
import {
    ensureNexusDOM, openNexusConfirmModal, enterNexus, leaveNexus,
    startNexusScreen, stopNexusLoop, pauseNexusPolling, resumeNexusPolling,
    isNexusScreenActive, showCantLeaveModal, showReviveChoiceModal
} from './nexus_module.js'

// --- Configurações & Constantes ---
const NORMAL_REGEN_MS = 3600 * 1000; // 1 Hora (Fase Normal)
const FAST_REGEN_MS = 60 * 1000;     // 1 Minuto (Fase Final - 20 min)
const FINAL_PHASE_SECONDS = 1200;    // 20 Minutos para o fim
const MAX_ACTIONS = 5;

// 🧪 MODO DE TESTE — precisa ficar em sincronia com "v_test_mode" em
// register_for_guild_battle.sql. Com true: libera o registro na tela
// (botões das cidades + contador) a qualquer dia/hora. Mude para false
// junto com o backend para voltar ao normal (só Sábado 00:00–23:30 UTC).
const TEST_MODE_REGISTRATION = true;

// ── INATIVIDADE / VISIBILIDADE (mesmo padrão de floresta_mistica.js) ──
const _INACTIVITY_MS = 3 * 60 * 1000;
const _INACTIVITY_CHECK_MS = 20_000;
let _lastActivityMs = Date.now();
let _inactivityCheckId = null;
let _inactivityPaused = false;
function _resetActivity() { _lastActivityMs = Date.now(); }
['touchstart', 'click', 'mousemove', 'keydown', 'scroll', 'pointerdown'].forEach(ev => {
    document.addEventListener(ev, _resetActivity, { passive: true, capture: true });
});
function _startInactivityGuard() {
    clearInterval(_inactivityCheckId);
    _inactivityCheckId = setInterval(() => {
        if (_inactivityPaused) return;
        if (Date.now() - _lastActivityMs >= _INACTIVITY_MS) _showInactivityModal();
    }, _INACTIVITY_CHECK_MS);
}
function _showInactivityModal() {
    _inactivityPaused = true;
    stopHeartbeatPolling();
    stopDamagePolling();
    pauseNexusPolling();
    let m = $('battleInactivityModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'battleInactivityModal';
        m.className = 'modal';
        m.innerHTML = `<div class="modal-content"><h3>Você ficou inativo</h3><p>Toque para continuar acompanhando a batalha.</p>
            <button id="battleInactivityResumeBtn" class="action-btn">Continuar</button></div>`;
        document.body.appendChild(m);
        document.getElementById('battleInactivityResumeBtn').onclick = () => {
            m.style.display = 'none';
            _inactivityPaused = false;
            _resetActivity();
            _resumeAfterPause();
        };
    }
    m.style.display = 'flex';
}
function _resumeAfterPause() {
    if (isNexusScreenActive()) { resumeNexusPolling(); return; }
    if (!currentBattleState || currentBattleState.status !== 'active') return;
    // Não força heartbeat fora da janela dos 20 minutos finais — o uiTimerInterval
    // já cuida disso (polling "lazy" original). Só garante um refresh pontual.
    pollBattleState();
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        stopHeartbeatPolling();
        stopDamagePolling();
        pauseNexusPolling();
    } else if (!_inactivityPaused) {
        _resetActivity();
        _resumeAfterPause();
    }
});

// --- Variáveis de Estado Global ---
let userId = null;
let userGuildId = null;
let userRank = null;
let userPlayerStats = null;

let currentBattleState = null; 
let heartbeatTimer = null; // Timer para polling adaptativo
let uiTimerInterval = null;
let selectedObjective = null;

// Flag para previnir ações duplicadas (clique frenético)
let isProcessingBattleAction = false;

let damagePollInterval = null;
let playerDamageCache = new Map();
let cityToRegister = null;
let pendingGarrisonLeaveAction = null;
let resultsPollTimeout = null;

let captureNotificationQueue = [];
let isDisplayingCaptureNotification = false;
let processedCaptureTimestamps = new Set();
let lastCaptureTimestamp = '1970-01-01T00:00:00+00:00'; 
let lastNexusEventTimestamp = '1970-01-01T00:00:00+00:00';

const CITIES = [
    { id: 1, name: 'Capital' }
];

const GUILD_COLORS = [
    'var(--guild-color-mine)',
    'var(--guild-color-enemy-1)',
    'var(--guild-color-enemy-2)',
    'var(--guild-color-enemy-3)'
];

const REWARD_ITEMS = {
    CRYSTALS: { name: 'Cristais', img: 'https://aden-rpg.pages.dev/assets/cristais.webp' },
    REFORGE_STONE: { name: 'Pedra de Refundição', img: 'https://aden-rpg.pages.dev/assets/itens/pedra_de_refundicao.webp' },
    CARD_ADVANCED: { name: 'Cartão Avançado', img: 'https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_avancado.webp' },
    CARD_COMMON: { name: 'Cartão Comum', img: 'https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_comum.webp' },
    BATTLE_FRAME: { name: 'Moldura de Batalha', img: 'https://aden-rpg.pages.dev/assets/itens/moldura_batalha_guilda.webp' }
};

// --- Elementos DOM ---
const $ = (selector) => document.getElementById(selector);

let screens = {};
let battle = {};
let modals = {};
let audio = {};

// Áudio Context & Unlock
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let isMediaUnlocked = false;

function unlockBattleAudio() {
    if (isMediaUnlocked) return;
    isMediaUnlocked = true; 

    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(e => console.warn("AudioContext resume falhou", e));
    }

    try {
        const sound = audio.normal || audio.enemy_p1;
        if (sound && sound.paused) {
            sound.volume = 0;
            sound.play()
                .then(() => {
                    sound.pause();
                    if (sound === audio.crit) sound.volume = 0.1;
                    else if (sound === audio.normal) sound.volume = 0.5;
                    else sound.volume = 0.7;
                    console.log("Mídia de batalha desbloqueada.");
                })
                .catch((e) => {
                    console.warn("Desbloqueio de áudio falhou, mas foi registrado.", e.name);
                });
        }
    } catch (e) {
        console.warn("Falha ao desbloquear áudio", e);
    }
}


// --- Funções Auxiliares ---

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.style.display = 'none');
    if (screens[screenName]) {
        screens[screenName].style.display = 'flex';
    }
}

function showAlert(message) {
    modals.alertMessage.textContent = message;
    modals.alert.style.display = 'flex';
}

function closeResultsAndShowCities() {
    if (resultsPollTimeout) clearTimeout(resultsPollTimeout);
    resultsPollTimeout = null;
    modals.results.style.display = 'none';
    renderCitySelectionScreen(userRank || 'member'); 
}

function formatNexusLockCountdown() {
    if (!currentBattleState || !currentBattleState.nexus_opens_at) return '';
    const opensAt = new Date(currentBattleState.nexus_opens_at);
    const secs = Math.max(0, Math.floor((opensAt.getTime() - Date.now()) / 1000));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Falta menos de 1h de batalha: não haverá mais nenhuma janela do Nexus —
// o ícone deve sumir de vez (não só ficar travado/grayscale)
function isNexusPermanentlyClosed() {
    if (!currentBattleState || !currentBattleState.instance || !currentBattleState.instance.end_time) return false;
    const msLeft = new Date(currentBattleState.instance.end_time).getTime() - Date.now();
    return msLeft < 60 * 60 * 1000;
}

function formatTime(totalSeconds) {
    if (totalSeconds < 0) totalSeconds = 0;
    
    const days = Math.floor(totalSeconds / 86400);
    totalSeconds %= 86400;
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(Math.floor(totalSeconds % 60)).padStart(2, '0');
    
    if (days > 0) {
        return `${days}d ${String(hours).padStart(2, '0')}h ${minutes}m`;
    }
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
    }
    return `${minutes}:${seconds}`;
}

function kFormatter(num) {
    if (Math.abs(num) < 1000) {
        return Math.sign(num)*Math.abs(num);
    }
    return Math.sign(num)*((Math.abs(num)/1000).toFixed(1)) + 'k';
}

function playHitSound(isCrit) {
    if(!isMediaUnlocked) return;
    try {
        const s = isCrit ? audio.crit : audio.normal;
        s.currentTime = 0;
        s.play().catch(()=>{});
    } catch(e) { console.warn("playHitSound", e); }
}

function displayFloatingDamage(targetEl, val, isCrit) {
    if (!targetEl) return;
    const el = document.createElement("div");
    el.textContent = isCrit ? `${Number(val).toLocaleString()}!` : String(val);
    el.className = isCrit ? "crit-damage-number" : "damage-number";
    const xOffset = Math.random() * 60 - 30;
    const yOffset = Math.random() * 40 - 20;
    el.style.left = `calc(50% + ${xOffset}px)`;
    el.style.top = `calc(40% + ${yOffset}px)`;
    targetEl.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
}

// =================================================================
// CÁLCULO LOCAL E OTIMISTA (Client-Side Logic)
// =================================================================

/**
 * Determina a velocidade de regeneração atual com base no tempo restante.
 * Retorna milissegundos (3600000 ou 60000).
 */
function getCurrentRegenRate() {
    if (!currentBattleState || !currentBattleState.instance) return NORMAL_REGEN_MS;

    const now = new Date();
    const end = new Date(currentBattleState.instance.end_time);
    const diffSeconds = Math.floor((end - now) / 1000);

    // Se faltar menos que o limite da fase final (20 min), acelera
    if (diffSeconds > 0 && diffSeconds <= FINAL_PHASE_SECONDS) {
        return FAST_REGEN_MS;
    }
    return NORMAL_REGEN_MS;
}

/**
 * Calcula o dano localmente baseado nos stats do jogador.
 * Deve espelhar a lógica do servidor para validação anti-cheat.
 */
function calculateLocalDamage(stats) {
    const min = parseInt(stats.min_attack || 0);
    const max = parseInt(stats.attack || 0);
    const critChance = parseFloat(stats.crit_chance || 0);
    const critDamage = parseFloat(stats.crit_damage || 0);

    let damage = Math.floor(Math.random() * (max - min + 1)) + min;
    const isCrit = (Math.random() * 100) < critChance;

    if (isCrit) {
        damage = Math.floor(damage * (1 + (critDamage / 100)));
    }
    
    return { damage, isCrit };
}

/**
 * Replica a lógica de recuperação de ações.
 * Usa getCurrentRegenRate() para alternar entre 1h e 1min.
 */
function computeShownAttacksAndRemaining() {
    const playerState = (currentBattleState && currentBattleState.player_state) ? currentBattleState.player_state : null;
    const now = new Date();
    
    if (!playerState) {
        return { shownAttacks: 0, secondsToNext: 0 };
    }

    const attacksLeft = playerState.attacks_left || 0;
    const lastAttackAt = playerState.last_attack_at;

    // Ações compradas podem exceder MAX_ACTIONS — mostrar valor real sem tentar regenerar
    if (attacksLeft > MAX_ACTIONS) {
        return { shownAttacks: attacksLeft, secondsToNext: 0 };
    }

    // Se já está exatamente no cap
    if (attacksLeft >= MAX_ACTIONS) {
        return { shownAttacks: MAX_ACTIONS, secondsToNext: 0 };
    }
    
    // Se não tem data de último ataque (mas não está full), assume agora
    if (!lastAttackAt) {
        return { shownAttacks: attacksLeft, secondsToNext: 0 };
    }

    // Pega a taxa atual (1h ou 1min)
    const regenRateMs = getCurrentRegenRate();

    const elapsedMs = now - new Date(lastAttackAt);
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const recovered = Math.floor(elapsedMs / regenRateMs);
    
    let shown = Math.min(MAX_ACTIONS, attacksLeft + recovered);
    let secondsToNext = 0;
    
    if (shown < MAX_ACTIONS) {
        // Tempo restante = Ciclo total - (Tempo passado % Ciclo total)
        const cycleSeconds = regenRateMs / 1000;
        const timeInCurrentCycle = elapsedSeconds % cycleSeconds;
        secondsToNext = cycleSeconds - timeInCurrentCycle;
    }
    
    return { shownAttacks: shown, secondsToNext };
}

// Atualiza o objeto de estado localmente após uma ação (Optimistic Update)
function optimisticUpdatePlayerActions(consumed = 1) {
    if (!currentBattleState || !currentBattleState.player_state) return;

    const ps = currentBattleState.player_state;
    const now = new Date();
    const regenRateMs = getCurrentRegenRate();
    
    // 1. Aplica a regeneração pendente ao estado base
    const { shownAttacks } = computeShownAttacksAndRemaining();
    
    // 2. Consome a ação
    let newAttacks = Math.max(0, shownAttacks - consumed);
    
    // 3. Reseta ou Ajusta o Timer
    if (shownAttacks > (ps.attacks_left || 0)) {
         // Houve regeneração, avançamos o relógio base para não "roubar" tempo do próximo ciclo
         const recoveredCount = shownAttacks - (ps.attacks_left || 0);
         if (ps.last_attack_at) {
             const oldTime = new Date(ps.last_attack_at).getTime();
             const newTime = oldTime + (recoveredCount * regenRateMs);
             ps.last_attack_at = new Date(newTime).toISOString();
         }
    }

    if (newAttacks >= MAX_ACTIONS) {
        ps.last_attack_at = null;
    } else if (newAttacks < MAX_ACTIONS && !ps.last_attack_at) {
        ps.last_attack_at = now.toISOString();
    }
    
    ps.attacks_left = newAttacks;
}


// --- Funções de Notificação ---

function createCaptureNotificationUI() {
    if ($('battleCaptureNotification')) return;
    const banner = document.createElement('div');
    banner.id = 'battleCaptureNotification'; 
    const style = document.createElement('style');
    style.textContent = `
        #battleCaptureNotification {
            position: fixed;
            top: 10px;
            transform: translateX(100%);
            right: 0;
            background-color: rgb(0, 0, 255);
            color: white;
            padding: 10px 20px;
            border-radius: 5px 0 0 5px;
            z-index: 25000;
            font-weight: bold;
            white-space: nowrap;
            text-shadow: 1px 1px 2px #000;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
            opacity: 0;
            transition: opacity 0.3s;
        }
        #battleCaptureNotification.show {
            opacity: 1;
            animation: slideAcrossContinuous 15s linear forwards;
        }
        @keyframes slideAcrossContinuous {
            0% { transform: translateX(100%); }
            100% { transform: translateX(calc(-100% - 1%)); }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(banner);
}

function displayCaptureNotification(data) {
    const banner = $('battleCaptureNotification');
    if (!banner) return;
    banner.innerHTML = data.rawHtml
        ? data.rawHtml
        : `<span style="color: yellow;">${data.playerName}</span> da guilda <span style="color: #00bcd4;">${data.guildName}</span> destruiu o <span style="color: lightgreen;">${data.objectiveName}</span>!`;
    banner.classList.add('show');
    const onAnimationEnd = () => {
        banner.classList.remove('show');
        banner.removeEventListener('animationend', onAnimationEnd);
        isDisplayingCaptureNotification = false;
        setTimeout(() => processCaptureNotificationQueue(), 200);
    };
    banner.addEventListener('animationend', onAnimationEnd, { once: true });
}

function processCaptureNotificationQueue() {
    if (isDisplayingCaptureNotification || captureNotificationQueue.length === 0) {
        return;
    }
    isDisplayingCaptureNotification = true;
    const data = captureNotificationQueue.shift();
    displayCaptureNotification(data);
}

function pushRawBannerNotification(html) {
    captureNotificationQueue.push({ rawHtml: html });
    if (!isDisplayingCaptureNotification) processCaptureNotificationQueue();
}

function playCaptureSound(type, index, isAlly) {
    if (!isMediaUnlocked) return;
    let soundToPlay = null;
    if (type === 'nexus') {
        soundToPlay = isAlly ? audio.ally_nexus : audio.enemy_nexus;
    } else {
        const key = `${isAlly ? 'ally' : 'enemy'}_p${index}`;
        soundToPlay = audio[key];
    }
    if (soundToPlay) {
        soundToPlay.currentTime = 0;
        soundToPlay.play().catch(e => console.warn("Falha ao tocar som de captura:", e));
    }
}


// --- Funções Principais de UI ---

const updatePlayerResourcesUI = (playerStats) => {
    if (!playerStats) return;
    userPlayerStats = playerStats; 
    if (playerStats.crystals !== undefined) {
        const crystalsElement = document.getElementById('playerCrystalsAmount'); 
        if(crystalsElement) {
            crystalsElement.textContent = Number(playerStats.crystals).toLocaleString('pt-BR'); 
        }
    }
};

function renderCitySelectionScreen(playerRank) {
    const cityGrid = $('cityGrid');
    cityGrid.innerHTML = '';
    
    // LÓGICA ATUALIZADA: Sábado (Dia 6)
    const now = new Date();
    const dayUTC = now.getUTCDay(); // 6 = Sábado
    const hoursUTC = now.getUTCHours();
    const isLeader = playerRank === 'leader' || playerRank === 'co-leader';
    let registrationOpen = TEST_MODE_REGISTRATION || (dayUTC === 6 && hoursUTC < 23); // Sábado, antes das 23:30 (margem visual)

    CITIES.forEach(city => {
        const btn = document.createElement('button');
        btn.className = 'city-btn';
        btn.textContent = city.name;
        const shouldBeEnabled = isLeader && registrationOpen;
        if (!shouldBeEnabled) {
            btn.classList.add('disabled');
            btn.disabled = true;
        }
        if (!isLeader || !registrationOpen) {
             btn.style.filter = 'grayscale(1)';
             btn.style.opacity = '0.6';
        }
        btn.onclick = () => handleCityRegistrationPre(city.id, city.name);
        cityGrid.appendChild(btn);
    });
    showScreen('citySelection');
}

function updateCityRegistrationButtons() {
    if (screens.citySelection.style.display !== 'flex') return;
    const isLeader = userRank === 'leader' || userRank === 'co-leader';
    
    // LÓGICA ATUALIZADA: Sábado (Dia 6)
    const now = new Date();
    const dayUTC = now.getUTCDay(); // 6 = Sábado
    const hoursUTC = now.getUTCHours();
    let registrationOpen = TEST_MODE_REGISTRATION || (dayUTC === 6 && hoursUTC < 23); 

    const cityButtons = document.querySelectorAll('#cityGrid .city-btn');

    cityButtons.forEach(btn => {
        const shouldBeEnabled = isLeader && registrationOpen;
        btn.disabled = !shouldBeEnabled;
        if (shouldBeEnabled) {
            btn.classList.remove('disabled');
            btn.style.filter = '';
            btn.style.opacity = '';
        } else {
            btn.classList.add('disabled');
            btn.style.filter = 'grayscale(1)';
            btn.style.opacity = '0.6';
        }
    });
}

function renderWaitingScreen(instance) {
    $('waitCityName').textContent = CITIES.find(c => c.id === instance.city_id)?.name || 'Desconhecida';
    const waitListEl = $('waitGuildList');
    waitListEl.innerHTML = '';
    const registeredGuilds = instance.registered_guilds || [];
    
    if (registeredGuilds.length === 0) {
        waitListEl.innerHTML = '<li>Aguardando guildas...</li>';
    } else {
        const guildColorMap = new Map();
        registeredGuilds.forEach((g, index) => {
            guildColorMap.set(g.guild_id, GUILD_COLORS[index] || 'var(--guild-color-neutral)');
        });
        registeredGuilds.forEach(g => {
            const li = document.createElement('li');
            const color = guildColorMap.get(g.guild_id);
            li.innerHTML = `<strong style="color: ${color};">${g.guild_name}</strong>`;
            waitListEl.appendChild(li);
        });
    }
    showScreen('waiting');
}

function renderBattleScreen(state) {
    currentBattleState = state;
    userPlayerStats = state.player_stats;
    currentBattleState.is_nexus_open = state.is_nexus_open !== false;
    currentBattleState.nexus_opens_at = state.nexus_opens_at || null;
    currentBattleState.nexus_closes_at = state.nexus_closes_at || null;

    const city = CITIES.find(c => c.id === state.instance.city_id);
    if (city) {
        battle.map.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.1)), url(${city.map_image_url || 'https://aden-rpg.pages.dev/assets/guild_battle.webp'})`;
    }

    playerDamageCache.clear();
    (state.player_damage_ranking || []).forEach(p => {
        if (p.player_id && p.name) {
            playerDamageCache.set(p.player_id, p.name);
        }
    });

    renderAllObjectives(state.objectives);
    renderPlayerFooter(state.player_state, state.player_garrison);
    renderRankingModal(state.instance.registered_guilds, state.player_damage_ranking);
    updatePlayerResourcesUI(state.player_stats);
    showScreen('battle');
}

function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function svgPositionBadge(rank) {
    const colors = { 1: '#ffd700', 2: '#c8c8d4', 3: '#cd7f32' };
    const fill = colors[rank] || '#556';
    const textColor = (rank === 1 || rank === 2 || rank === 3) ? '#1a1a1a' : '#fff';
    const label = String(rank);
    const fontSize = label.length > 2 ? 8 : 11;
    return `<svg width="22" height="22" viewBox="0 0 24 24" style="display:block;margin:auto;"><circle cx="12" cy="12" r="11" fill="${fill}" stroke="#000" stroke-opacity="0.35"/><text x="12" y="16" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="${textColor}">${label}</text></svg>`;
}
function svgSkullIcon() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="#eee" style="display:inline-block;vertical-align:middle;"><path d="M12 2C7.6 2 4 5.4 4 9.8c0 2.9 1.5 5 3 6.4V18a1 1 0 0 0 1 1h1v-2.2h1.5V19h1v-2.2h1v2.2h1V19h1a1 1 0 0 0 1-1v-1.8c1.5-1.4 3-3.5 3-6.4C20 5.4 16.4 2 12 2z"/><circle cx="9" cy="9.5" r="1.5" fill="#111"/><circle cx="15" cy="9.5" r="1.5" fill="#111"/></svg>`;
}
function buildRankingTableHtml(list, guildColorMap, guildNameMap, myPlayerId) {
    if (!list || list.length === 0) {
        return `<tr class="ranking-row-empty"><td colspan="5">Nenhum jogador registrado ainda.</td></tr>`;
    }
    const head = `<thead><tr>
        <th class="rk-center">#</th><th>Jogador</th><th>Guilda</th><th style="text-align:right;">Dano</th><th class="rk-center">💀</th>
    </tr></thead>`;
    const rows = list.map((p, i) => {
        const rank = i + 1;
        const posLabel = p._customRank ? p._customRank : (p._outsideTop ? '30+' : rank);
        const name = playerDamageCache.get(p.player_id) || p.name || '???';
        if (p.name && !playerDamageCache.has(p.player_id)) playerDamageCache.set(p.player_id, p.name);
        const guildName = (guildNameMap && guildNameMap.get(p.guild_id)) || '';
        const color = (guildColorMap && guildColorMap.get(p.guild_id)) || 'var(--guild-color-neutral)';
        const isMe = p.player_id === myPlayerId;
        return `<tr class="${isMe ? 'ranking-row-me' : ''}">
            <td class="rk-pos">${svgPositionBadge(posLabel)}</td>
            <td class="rk-name" style="color:${color};">${escHtml(name)}${isMe ? ' <span style="color:#8cf;">(você)</span>' : ''}</td>
            <td class="rk-guild">${escHtml(guildName)}</td>
            <td class="rk-dmg">${kFormatter(p.total_damage_dealt)}</td>
            <td class="rk-kills">${p.total_eliminations || 0}</td>
        </tr>`;
    }).join('');
    return head + '<tbody>' + rows + '</tbody>';
}

function renderRankingModal(registeredGuilds, playerDamageRanking) {
    if (!registeredGuilds) registeredGuilds = [];
    if (!playerDamageRanking) playerDamageRanking = [];

    const guildColorMap = new Map();
    registeredGuilds.forEach((g, index) => {
        guildColorMap.set(g.guild_id, GUILD_COLORS[index] || 'var(--guild-color-neutral)');
    });

    const sortedGuilds = [...registeredGuilds].sort((a, b) => (b.honor_points || 0) - (a.honor_points || 0));
    modals.guildRankingList.innerHTML = '';
    sortedGuilds.forEach((g, index) => {
        const color = guildColorMap.get(g.guild_id);
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${index + 1}. <strong style="color: ${color};">${g.guild_name}</strong></span>
            <span>${g.honor_points || 0} pts</span>
        `;
        modals.guildRankingList.appendChild(li);
    });

    // Garante que "eu" apareça na tabela mesmo se estiver fora do Top 30
    let listForTable = playerDamageRanking;
    const iAmIn = playerDamageRanking.some(p => p.player_id === userId);
    if (!iAmIn && currentBattleState && currentBattleState.player_state) {
        const me = currentBattleState.player_state;
        if ((me.total_damage_dealt || 0) > 0) {
            listForTable = [...playerDamageRanking, {
                player_id: userId,
                total_damage_dealt: me.total_damage_dealt || 0,
                total_eliminations: me.total_eliminations || 0,
                guild_id: userGuildId,
                name: userPlayerStats ? userPlayerStats.name : 'Você',
                _outsideTop: true
            }];
        }
    }
    modals.playerDamageList.innerHTML = buildRankingTableHtml(listForTable, guildColorMap, null, userId);
}

function renderAllObjectives(objectives) {
    if (!objectives || !currentBattleState || !currentBattleState.instance) return;

    const nexusEl = $('obj-nexus');
    if (nexusEl) {
        const permanentlyClosed = isNexusPermanentlyClosed();
        const locked = currentBattleState.is_nexus_open === false;
        let overlay = document.getElementById('nexusLockOverlay');

        if (permanentlyClosed) {
            nexusEl.style.display = 'none';
            nexusEl.classList.remove('nexus-locked');
            if (overlay) overlay.remove();
        } else {
            nexusEl.style.display = '';
            nexusEl.classList.toggle('nexus-locked', locked);
            if (locked) {
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'nexusLockOverlay';
                    overlay.className = 'nexus-lock-overlay';
                    const visual = nexusEl.querySelector('.obj-visual');
                    if (visual) visual.appendChild(overlay);
                }
                overlay.textContent = formatNexusLockCountdown();
            } else if (overlay) {
                overlay.remove();
            }
        }
    }

    if (!currentBattleState.guildColorMap) {
        const guildColorMap = new Map();
        (currentBattleState.instance.registered_guilds || []).forEach((g, index) => {
            guildColorMap.set(g.guild_id, GUILD_COLORS[index] || 'var(--guild-color-neutral)');
        });
        currentBattleState.guildColorMap = guildColorMap;
    }
    
    const registeredGuilds = currentBattleState.instance.registered_guilds || [];

    objectives.forEach(obj => {
        const el = $(`obj-cp-${obj.objective_index}`) || $('obj-nexus');
        if (!el) return;

        const fullObj = currentBattleState.objectives.find(o => o.id === obj.id);
        if (!fullObj) return; 

        // Nexus não tem mais HP/dono — só o ícone permanece
        if (obj.objective_type === 'nexus') return;
        
        const totalHp = (fullObj.base_hp || 0) + (obj.garrison_hp || 0);
        const currentTotalHp = (obj.current_hp || 0) + (obj.garrison_hp || 0);
        const percent = totalHp > 0 ? (currentTotalHp / totalHp) * 100 : 0;

        const fillEl = $(`obj-hp-fill-${fullObj.objective_index}`);
        const textEl = $(`obj-hp-text-${fullObj.objective_index}`);
        if (fillEl) fillEl.style.width = `${percent}%`;
        if (textEl) textEl.textContent = `${kFormatter(currentTotalHp)} / ${kFormatter(totalHp)}`;

        const garrisonEl = $(`obj-garrison-${fullObj.objective_index}`);
        if (garrisonEl) {
           garrisonEl.textContent = (obj.garrison_hp > 0) ? `+${kFormatter(obj.garrison_hp)} HP Guarnição` : '';
        }

        const ownerEl = $(`obj-owner-${fullObj.objective_index}`);
        const imgEl = obj.objective_type === 'nexus' ? $('img-nexus') : $(`img-cp-${obj.objective_index}`);

        if (ownerEl) {
            if (obj.owner_guild_id && currentBattleState.guildColorMap) {
                const guild = registeredGuilds.find(g => g.guild_id === obj.owner_guild_id);
                const color = currentBattleState.guildColorMap.get(obj.owner_guild_id) || 'var(--guild-color-neutral)';
                
                ownerEl.textContent = guild ? guild.guild_name : 'Dominado';
                ownerEl.style.color = color;
                
                if (imgEl) {
                    imgEl.style.filter = `drop-shadow(0px 0px 8px ${color}) drop-shadow(0px 0px 15px ${color})`;
                }
                
            } else {
                ownerEl.textContent = 'Não Dominado';
                ownerEl.style.color = 'var(--guild-color-neutral)';
                
                if (imgEl) {
                    imgEl.style.filter = 'drop-shadow(0px 0px 5px var(--guild-color-neutral))';
                }
            }
        }
    });
}

function renderPlayerFooter(playerState, playerGarrison) {
    if (!playerState) return; 

    // Atualiza estado local globalmente
    if (currentBattleState) {
        currentBattleState.player_state = playerState;
        currentBattleState.player_garrison = playerGarrison;
    }

    const { shownAttacks, secondsToNext } = computeShownAttacksAndRemaining();
    
    battle.playerAttacks.textContent = `Ações: ${Math.max(0, shownAttacks)} / ${MAX_ACTIONS}`;
    battle.playerCooldown.textContent = secondsToNext > 0 ? `+1 em ${formatTime(secondsToNext)}` : "";

    if (playerGarrison) {
        const objectives = (currentBattleState && currentBattleState.objectives) ? currentBattleState.objectives : null;
        const objective = objectives ? objectives.find(o => o.id === playerGarrison.objective_id) : null;
        let objName = '...';
        if (objective) {
            objName = objective.objective_type === 'nexus' ? 'Nexus' : `Ponto ${objective.objective_index}`;
        } else {
            setTimeout(pollBattleState, 1500); 
        }

        // Barra de HP individual da guarnição
        const remainingHp = parseInt(playerGarrison.remaining_hp || playerGarrison.player_hp || 0);
        const maxHp = parseInt(playerGarrison.player_hp || remainingHp);
        const pct = maxHp > 0 ? Math.round((remainingHp / maxHp) * 100) : 0;
        const barColor = pct > 50 ? '#4caf50' : pct > 25 ? '#ff9800' : '#f44336';

        battle.garrisonStatus.innerHTML = `
            <span>Guarnecendo: <strong>${objName}</strong></span>
            <div class="garrison-personal-hp-bar">
                <div class="garrison-personal-hp-fill" style="width:${pct}%;background:${barColor};"></div>
                <span class="garrison-personal-hp-text">${kFormatter(remainingHp)} / ${kFormatter(maxHp)} HP</span>
            </div>
        `;
        battle.garrisonStatus.className = 'garrisoned';
    } else if (playerState.last_garrison_leave_at) {
        const lastLeave = new Date(playerState.last_garrison_leave_at);
        const timeSinceLeave = Math.floor((new Date() - lastLeave) / 1000);
        if (timeSinceLeave < 60) {
            const timeLeft = 60 - timeSinceLeave;
            battle.garrisonStatus.textContent = `Guarnição CD: ${timeLeft}s`;
            battle.garrisonStatus.className = 'cooldown';
        } else {
            battle.garrisonStatus.textContent = `Status: Atacando`;
            battle.garrisonStatus.className = '';
        }
    } else {
        battle.garrisonStatus.textContent = `Status: Atacando`;
        battle.garrisonStatus.className = '';
    }
}

function createRewardItemHTML(item, quantity) {
    return `
        <div class="reward-item">
            <img src="${item.img}" alt="${item.name}">
            <span>x${quantity}</span>
        </div>
    `;
}

let _modalViewportListenerAdded = false;
const _viewportFittedModalIds = new Set();

function fitModalToViewport(modalId) {
    const modal = $(modalId);
    const content = modal ? modal.querySelector('.modal-content') : null;
    if (!modal || !content) return;
    _viewportFittedModalIds.add(modalId);

    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    modal.style.height = vh + 'px';
    modal.style.maxHeight = vh + 'px';
    content.style.height = (vh * 0.90) + 'px';
    content.style.maxHeight = (vh * 0.90) + 'px';

    if (!_modalViewportListenerAdded) {
        _modalViewportListenerAdded = true;
        const relayout = () => _viewportFittedModalIds.forEach(id => fitModalToViewport(id));
        window.addEventListener('resize', relayout);
        window.addEventListener('orientationchange', relayout);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', relayout);
    }
}
function adjustResultsModalViewport() { fitModalToViewport('resultsModal'); }

function renderResultsScreen(instance, playerDamageRanking, personalRanking) {
    adjustResultsModalViewport();
    const titleEl = $('resultCityName');
    titleEl.textContent = CITIES.find(c => c.id === instance.city_id)?.name || 'Desconhecida';
    
    let dateEl = $('resultBattleDate');
    if (!dateEl) {
        dateEl = document.createElement('p');
        dateEl.id = 'resultBattleDate';
        dateEl.style.cssText = 'font-size: 0.9em; color: #ccc; margin-top: 0px; margin-bottom: 0px; text-align: center;';
        titleEl.after(dateEl);
    }
    
    const endDate = new Date(instance.end_time);
    dateEl.textContent = endDate.toLocaleString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    });

    modals.resultsRankingHonor.innerHTML = '';
    const sortedGuilds = [...(instance.registered_guilds || [])].sort((a, b) => b.honor_points - a.honor_points);
    
    if (sortedGuilds.length === 0) {
        modals.resultsRankingHonor.innerHTML = '<li>Nenhum dado de ranking.</li>';
    } else {
        sortedGuilds.forEach((g, index) => {
            const li = document.createElement('li');
            li.textContent = `#${index + 1} ${g.guild_name} - ${g.honor_points} Pontos`;
            modals.resultsRankingHonor.appendChild(li);
        });
    }

    const guildColorMapResults = new Map();
    (instance.registered_guilds || []).forEach((g, index) => {
        guildColorMapResults.set(g.guild_id, GUILD_COLORS[index] || 'var(--guild-color-neutral)');
    });
    const guildNameMap = new Map();
    (instance.registered_guilds || []).forEach(g => guildNameMap.set(g.guild_id, g.guild_name));

    let listForResultsTable = playerDamageRanking || [];
    const iAmInTop5 = listForResultsTable.some(p => p.player_id === userId);
    if (!iAmInTop5 && personalRanking && personalRanking.rank) {
        listForResultsTable = [...listForResultsTable, {
            player_id: userId,
            total_damage_dealt: personalRanking.total_damage_dealt || 0,
            total_eliminations: personalRanking.total_eliminations || 0,
            guild_id: userGuildId,
            name: userPlayerStats ? userPlayerStats.name : 'Você',
            _customRank: personalRanking.rank
        }];
    }
    modals.resultsRankingDamage.innerHTML = buildRankingTableHtml(listForResultsTable, guildColorMapResults, guildNameMap, userId);

    let guildRewardsEl = $('resultsGuildRewards');
    if (!guildRewardsEl) {
        guildRewardsEl = document.createElement('div');
        guildRewardsEl.id = 'resultsGuildRewards';
        guildRewardsEl.className = 'results-rewards-section';
        modals.resultsRewardMessage.after(guildRewardsEl);
    }
    guildRewardsEl.innerHTML = '';
    guildRewardsEl.style.display = 'block';

    let playerRewardsEl = $('resultsPlayerRewards');
    if (!playerRewardsEl) {
        playerRewardsEl = document.createElement('div');
        playerRewardsEl.id = 'resultsPlayerRewards';
        playerRewardsEl.className = 'results-rewards-section';
        guildRewardsEl.after(playerRewardsEl);
    }
    playerRewardsEl.innerHTML = '';
    playerRewardsEl.style.display = 'block';

    let myGuildRank = -1;
    let myGuildResult = null;
    if (sortedGuilds.length > 0) {
        myGuildResult = sortedGuilds.find(g => g.guild_id === userGuildId);
        if (myGuildResult) {
            myGuildRank = sortedGuilds.indexOf(myGuildResult) + 1;
        }
    }
    
    // Rank do jogador no ranking GLOBAL de dano (top 1 e top 2 entre todos os participantes)
    let myPlayerDamageRank = -1;
    if (playerDamageRanking && playerDamageRanking.length > 0) {
        const globalDamageRanking = [...playerDamageRanking]
            .sort((a, b) => b.total_damage_dealt - a.total_damage_dealt);
        const myIndex = globalDamageRanking.findIndex(p => p.player_id === userId);
        if (myIndex !== -1) {
            myPlayerDamageRank = myIndex + 1;
        }
    }

    let guildRewardsHTML = '<h4>Recompensas da Guilda</h4>';
    let hasGuildRewards = false;

    // --- RECOMPENSAS VISUAIS ATUALIZADAS (DOBRADAS) ---
    if (myGuildRank === 1 && myGuildResult.honor_points > 0) {
        modals.resultsRewardMessage.textContent = "Sua guilda venceu! Recompensas enviadas.";
        modals.resultsRewardMessage.style.color = 'gold';
        guildRewardsHTML += '<div class="results-reward-list">';
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, 6000); 
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_ADVANCED, 8); 
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, 100);
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.BATTLE_FRAME, 1);
        guildRewardsHTML += '</div>';
        hasGuildRewards = true;
    } else if (myGuildRank === 2 && myGuildResult.honor_points > 0) {
        modals.resultsRewardMessage.textContent = "Sua guilda ficou em 2º lugar! Recompensas enviadas.";
        modals.resultsRewardMessage.style.color = '#00bcd4';
        guildRewardsHTML += '<div class="results-reward-list">';
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, 2000); 
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_COMMON, 12); 
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, 40); 
        guildRewardsHTML += '</div>';
        hasGuildRewards = true;
    } else if (myGuildRank === 3 && myGuildResult.honor_points > 0) {
        modals.resultsRewardMessage.textContent = "Sua guilda ficou em 3º lugar! Recompensas enviadas.";
        modals.resultsRewardMessage.style.color = '#cd7f32';
        guildRewardsHTML += '<div class="results-reward-list">';
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, 1000); 
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_COMMON, 8); 
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, 20); 
        guildRewardsHTML += '</div>';
        hasGuildRewards = true;
    } else {
        modals.resultsRewardMessage.textContent = "Sem recompensas ou já recebidas!";
        modals.resultsRewardMessage.style.color = '#aaa';
        guildRewardsHTML += '<p>Nenhuma recompensa de guilda nesta batalha.</p>';
    }
    
    guildRewardsEl.innerHTML = guildRewardsHTML;
    if (!hasGuildRewards && myGuildRank > 0) guildRewardsEl.style.display = 'none';

    let playerRewardsHTML = '<h4>Bônus Individual (Top Dano)</h4>';
    let hasPlayerRewards = false;

    // Bônus individuais baseados no rank GLOBAL de dano (top 1 e top 2 entre todos os participantes)
    // Os valores base dependem do rank da guilda; o multiplicador depende do rank global de dano.
    const guildBaseRewards = {
        1: { crystals: 6000, cards: 8,  stones: 100, cardItem: REWARD_ITEMS.CARD_ADVANCED },
        2: { crystals: 2000, cards: 12, stones: 40,  cardItem: REWARD_ITEMS.CARD_COMMON },
        3: { crystals: 1000, cards: 8,  stones: 20,  cardItem: REWARD_ITEMS.CARD_COMMON },
    };

    if (myGuildRank >= 1 && myGuildRank <= 3 && (myPlayerDamageRank === 1 || myPlayerDamageRank === 2)) {
        const base = guildBaseRewards[myGuildRank];
        const multiplier = myPlayerDamageRank === 1 ? 3 : 2;
        const bonusMultiplier = multiplier - 1;
        const rankLabel = myPlayerDamageRank === 1 ? 'Rank 1' : 'Rank 2';

        playerRewardsHTML += `<p>Bônus por <strong>${rankLabel}</strong> em Dano global (Multiplicador ${multiplier}x):</p>`;
        playerRewardsHTML += '<div class="results-reward-list">';
        playerRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, `${base.crystals} (Base) + ${base.crystals * bonusMultiplier} (Bônus)`);
        playerRewardsHTML += createRewardItemHTML(base.cardItem, `${base.cards} (Base) + ${base.cards * bonusMultiplier} (Bônus)`);
        playerRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, `${base.stones} (Base) + ${base.stones * bonusMultiplier} (Bônus)`);
        playerRewardsHTML += '</div>';
        hasPlayerRewards = true;
    }


    
    if (hasPlayerRewards) {
        playerRewardsEl.innerHTML = playerRewardsHTML;
    } else {
        playerRewardsEl.style.display = 'none';
    }
    
    showScreen('results');
}

// --- Lógica de Interação ---

async function handleCityRegistrationPre(cityId, cityName) {
    unlockBattleAudio(); 
    cityToRegister = { id: cityId, name: cityName };
    
    modals.cityRegisterCityName.textContent = cityName;
    modals.cityRegisterMessage.textContent = "Carregando informações...";
    modals.cityRegisterGuildList.innerHTML = '<li style="text-align:center; color:#aaa;">Carregando...</li>';
    modals.cityRegisterConfirmBtn.disabled = true;
    modals.cityRegister.style.display = 'flex';

    const { data, error } = await supabase.rpc('get_city_registrations', { p_city_id: cityId });

    if (error || !data.success) {
        modals.cityRegisterMessage.textContent = `Erro: ${error ? error.message : (data?.message || 'Erro desconhecido')}`;
        modals.cityRegisterMessage.style.color = '#dc3545';
        modals.cityRegisterGuildList.innerHTML = '';
        return;
    }

    const guilds = data.registered_guilds || [];
    const count = data.count || 0;
    const isRevealed = data.is_revealed;
    const isUserRegistered = data.is_user_registered;
    const maxGuilds = 5;

    modals.cityRegisterGuildList.innerHTML = '';

    if (isRevealed) {
        if (guilds.length === 0) {
            modals.cityRegisterGuildList.innerHTML = '<li style="text-align:center; font-style:italic; color:#aaa;">Nenhuma guilda registrada.</li>';
        } else {
            guilds.forEach((g, index) => {
                const li = document.createElement('li');
                li.textContent = `${index + 1}. ${g.guild_name}`;
                
                if (g.guild_id === userGuildId) {
                    li.style.color = 'gold';
                    li.style.fontWeight = 'bold';
                    li.textContent += ' (Sua Guilda)';
                }
                modals.cityRegisterGuildList.appendChild(li);
            });
        }
    } else {
        const li = document.createElement('li');
        li.style.listStyle = 'none';
        li.style.textAlign = 'center';
        li.style.fontSize = '1.1em';
        li.style.padding = '10px 0';
        li.style.color = '#fff';

        if (count === 0) {
            li.textContent = "Nenhuma guilda registrada.";
            li.style.color = '#aaa';
            li.style.fontStyle = 'italic';
        } else {
            li.innerHTML = `<strong style="color: #00bcd4; font-size: 1.3em;">>> ${count}</strong> guilda(s) registrada(s).`;
        }
        modals.cityRegisterGuildList.appendChild(li);
    }

    if (count >= maxGuilds && !isUserRegistered) {
        modals.cityRegisterMessage.textContent = `Esta cidade atingiu o limite de ${maxGuilds} guildas.`;
        modals.cityRegisterMessage.style.color = '#ffc107';
        modals.cityRegisterConfirmBtn.disabled = true;
    } else if (isUserRegistered) {
        modals.cityRegisterMessage.textContent = "Sua guilda já está registrada aqui.";
        modals.cityRegisterMessage.style.color = '#28a745';
        modals.cityRegisterConfirmBtn.disabled = true;
        modals.cityRegisterConfirmBtn.textContent = "Registrado";
    } else {
        modals.cityRegisterMessage.textContent = "";
        modals.cityRegisterConfirmBtn.disabled = false;
        modals.cityRegisterConfirmBtn.textContent = "Registrar";
    }
}

async function handleCityRegistrationConfirm(cityId, cityName) {
    const msgEl = modals.cityRegisterMessage;
    msgEl.textContent = `Registrando em ${cityName}...`;
    modals.cityRegisterConfirmBtn.disabled = true;
    modals.cityRegisterCancelBtn.disabled = true;

    const { data, error } = await supabase.rpc('register_for_guild_battle', { p_city_id: cityId });

    if (error || !data.success) {
        msgEl.textContent = `Erro: ${error ? error.message : data.message}`;
        msgEl.style.color = '#dc3545';
        modals.cityRegisterConfirmBtn.disabled = false;
        modals.cityRegisterCancelBtn.disabled = false;
    } else {
        msgEl.textContent = data.message;
        msgEl.style.color = '#28a745';
        setTimeout(() => {
            modals.cityRegister.style.display = 'none';
            pollBattleState();
        }, 2000);
    }
}

function handleObjectiveClick(objective) {
    unlockBattleAudio();
    if (isProcessingBattleAction) return;

    const fullObjective = currentBattleState.objectives.find(o => o.id === objective.id);
    if (!fullObjective) return;

    if (fullObjective.objective_type === 'nexus') {
        if (currentBattleState.is_nexus_open === false) {
            showAlert(`O Nexus está fechado agora. Reabre em ${formatNexusLockCountdown()}.`);
            return;
        }
        openNexusConfirmModal(async () => {
            const result = await enterNexus(currentBattleState.instance.id);
            if (!result || !result.success) return result;
            enterNexusScreenFlow(result);
            return result;
        });
        return;
    }

    selectedObjective = fullObjective;
    modals.objectiveTitle.textContent = fullObjective.objective_type === 'nexus' ? 'Nexus Central' : `Ponto de Controle ${fullObjective.objective_index}`;
    const isOwned = fullObjective.owner_guild_id === userGuildId;
    
    modals.objectiveAttackBtn.disabled = isOwned;
    modals.objectiveAttackBtn.style.filter = isOwned ? 'grayscale(1)' : '';
    modals.objectiveAttackBtn.style.opacity = isOwned ? '0.6' : '1';
    modals.objectiveGarrisonBtn.style.display = isOwned ? 'inline-block' : 'none';

    // Checa se o jogador JÁ está guarnecendo ESTE objetivo específico
    const isAlreadyGarrisoningThis = currentBattleState.player_garrison && 
                                     currentBattleState.player_garrison.objective_id === fullObjective.id;

    // Checa se o jogador foi EXPULSO deste objetivo (HP zerou)
    const expelledPlayers = fullObjective.expelled_players || [];
    const isExpelled = isOwned && expelledPlayers.includes(userId);

    if (isAlreadyGarrisoningThis) {
        modals.objectiveGarrisonBtn.disabled = true;
        modals.objectiveGarrisonBtn.style.filter = 'grayscale(1)';
        modals.objectiveGarrisonBtn.style.opacity = '0.6';
        modals.objectiveGarrisonBtn.title = 'Você já está guarnecendo este objetivo';
    } else if (isExpelled) {
        modals.objectiveGarrisonBtn.disabled = true;
        modals.objectiveGarrisonBtn.style.filter = 'grayscale(1)';
        modals.objectiveGarrisonBtn.style.opacity = '0.6';
        modals.objectiveGarrisonBtn.title = 'Expulso — aguarde a guilda perder e recuperar este ponto';
    } else {
        modals.objectiveGarrisonBtn.disabled = false;
        modals.objectiveGarrisonBtn.style.filter = '';
        modals.objectiveGarrisonBtn.style.opacity = '1';
        modals.objectiveGarrisonBtn.title = '';
    }

    const isGarrisonedElsewhere = currentBattleState.player_garrison && 
                                  !isAlreadyGarrisoningThis;

    // Mensagens de aviso / regras da guarnição
    let warningMsg = '';
    let warningColor = '#ffc107';
    if (isExpelled) {
        warningMsg = '⛔ Você foi expulso desta guarnição (HP zerou). Só poderá retornar se a guilda perder e reconquistar este objetivo.';
        warningColor = '#f44336';
    } else if (isGarrisonedElsewhere) {
        const hasReducedHp = currentBattleState.player_garrison &&
                             currentBattleState.player_garrison.remaining_hp < currentBattleState.player_garrison.player_hp;
        warningMsg = `⚠️ Você será removido da sua guarnição atual (CD: 60s).`;
        if (hasReducedHp) {
            warningMsg += ` Você re-entrará neste ponto com apenas ${kFormatter(currentBattleState.player_garrison.remaining_hp)} HP restante.`;
        }
    } else if (isOwned && !isAlreadyGarrisoningThis && !isExpelled) {
        warningMsg = `ℹ️ Guarnição consome 1 ação e adiciona seu HP ao ponto. Se seu HP na guarnição zerar, você é expulso e não pode retornar enquanto a guilda dominar.`;
        warningColor = '#aaa';
    }

    modals.objectiveGarrisonWarning.style.display = warningMsg ? 'block' : 'none';
    modals.objectiveGarrisonWarning.textContent = warningMsg;
    modals.objectiveGarrisonWarning.style.color = warningColor;

    modals.objective.style.display = 'flex';
}

// ── FLUXO DO NEXUS ──────────────────────────────────────────────────
function enterNexusScreenFlow(entryData) {
    stopHeartbeatPolling();
    stopDamagePolling();
    showScreen('nexus');

    const myGuildEntry = currentBattleState?.instance?.registered_guilds?.find(g => g.guild_id === userGuildId);

    startNexusScreen({
        instanceId: currentBattleState.instance.id,
        playerId: userId,
        guildId: userGuildId,
        avatarUrl: userPlayerStats ? userPlayerStats.avatar_url : null,
        playerName: userPlayerStats ? userPlayerStats.name : null,
        guildName: myGuildEntry ? myGuildEntry.guild_name : null,
        entryPosX: entryData.pos_x,
        entryPosY: entryData.pos_y,
        currentHp: entryData.current_hp,
        maxHp: entryData.max_hp,
        nexusClosesAt: entryData.nexus_closes_at,
        enteredAt: entryData.entered_at,
        onBack: handleNexusBackClick,
        onForceExit: handleNexusForceExit,
        onBannerEvent: (html) => pushRawBannerNotification(html),
        onDeadTimerEnd: handleNexusDeadTimerEnd
    });
}

async function handleNexusBackClick() {
    if (!currentBattleState || !currentBattleState.instance) return;
    const result = await leaveNexus(currentBattleState.instance.id);
    if (!result || !result.success) {
        if (result && result.nexus_closes_at) {
            showCantLeaveModal(result.nexus_closes_at);
        } else {
            showAlert(result?.message || 'Não foi possível sair do Nexus agora.');
        }
        return;
    }
    stopNexusLoop();
    showScreen('battle');
    pollBattleState();
}

// Item 8: ao terminar o tempo de morte, pergunta se o jogador quer continuar
// no Nexus ou voltar aos objetivos (mesmo dentro da janela de 1h).
function handleNexusDeadTimerEnd() {
    showReviveChoiceModal(
        () => { /* Continuar no Nexus: nada a fazer, o próprio módulo já revive */ },
        async () => {
            if (!currentBattleState || !currentBattleState.instance) return;
            const result = await leaveNexus(currentBattleState.instance.id);
            if (!result || !result.success) {
                showAlert(result?.message || 'Não foi possível sair do Nexus.');
                return;
            }
            stopNexusLoop();
            showScreen('battle');
            pollBattleState();
        }
    );
}

function handleNexusForceExit(reason) {
    stopNexusLoop();
    showScreen('battle');
    if (reason === 'window_closed') {
        showAlert('A janela do Nexus fechou. Você foi trazido de volta aos objetivos — ela reabre em breve.');
    } else if (reason === 'phase2') {
        showAlert('O Nexus fechou — faltam 20 minutos para o fim da batalha. Você foi trazido de volta.');
    }
    pollBattleState();
}

function checkGarrisonLeaveAndExecute(actionCallback) {
    if (!currentBattleState || !currentBattleState.player_garrison || !userPlayerStats) {
        actionCallback();
        return;
    }
    
    const oldObjectiveId = currentBattleState.player_garrison.objective_id;
    const oldObjective = currentBattleState.objectives.find(o => o.id === oldObjectiveId);
    const playerHealth = userPlayerStats.health ? parseInt(userPlayerStats.health, 10) : 0;
    
    if (!oldObjective || playerHealth === 0) {
        actionCallback();
        return;
    }
    
    const currentTotalHp = (oldObjective.current_hp || 0) + (oldObjective.garrison_hp || 0);
    const newTotalHp = currentTotalHp - playerHealth;
    
    if (newTotalHp > 0) {
        actionCallback();
        return;
    }
    
    pendingGarrisonLeaveAction = actionCallback;
    modals.garrisonLeave.style.display = 'flex';
}

function refreshShopButtonsState() {
    const MAX_PACK_PURCHASES = 5;
    const playerState = currentBattleState && currentBattleState.player_state;
    const pack1Count = playerState ? (parseInt(playerState.bought_action_pack_1) || 0) : 0;
    const pack2Count = playerState ? (parseInt(playerState.bought_action_pack_2) || 0) : 0;
    const pack1Remaining = Math.max(0, MAX_PACK_PURCHASES - pack1Count);
    const pack2Remaining = Math.max(0, MAX_PACK_PURCHASES - pack2Count);

    if (modals.shopBtnPack1) {
        modals.shopBtnPack1.disabled = pack1Remaining <= 0;
        const rem1El = document.getElementById('pack1Remaining');
        if (rem1El) {
            rem1El.textContent = pack1Remaining <= 0 ? "Esgotado" : `${pack1Remaining} compra(s) restante(s)`;
            rem1El.style.color = pack1Remaining <= 0 ? '#dc3545' : '#aaa';
        }
    }
    if (modals.shopBtnPack2) {
        modals.shopBtnPack2.disabled = pack2Remaining <= 0;
        const rem2El = document.getElementById('pack2Remaining');
        if (rem2El) {
            rem2El.textContent = pack2Remaining <= 0 ? "Esgotado" : `${pack2Remaining} compra(s) restante(s)`;
            rem2El.style.color = pack2Remaining <= 0 ? '#dc3545' : '#aaa';
        }
    }
}

function openBattleShop() {
    if (modals.battleShopMessage) {
        modals.battleShopMessage.textContent = "";
    }
    if (modals.shopBtnPack1) modals.shopBtnPack1.textContent = "Comprar";
    if (modals.shopBtnPack2) modals.shopBtnPack2.textContent = "Comprar";
    refreshShopButtonsState();
    modals.battleShop.style.display = 'flex';
    modals.battleShop.style.alignItems = 'center';
    modals.battleShop.style.justifyContent = 'center';
    fitModalToViewport('battleShopModal');
}

// Trava as DUAS opções assim que qualquer compra começa, e só libera
// depois que a resposta do servidor chega — evita corrida de clique duplo/cruzado.
let isPurchasingBattleAction = false;

async function handleBuyBattleActions(packId, cost, actions, btnEl) {
    if (isPurchasingBattleAction || (btnEl && btnEl.disabled)) return;
    isPurchasingBattleAction = true;
    if (modals.shopBtnPack1) modals.shopBtnPack1.disabled = true;
    if (modals.shopBtnPack2) modals.shopBtnPack2.disabled = true;
    modals.battleShopMessage.textContent = "Processando...";

    const { data, error } = await supabase.rpc('buy_battle_actions', { p_pack_id: packId });

    if (error || !data.success) {
        modals.battleShopMessage.textContent = `Erro: ${error ? error.message : data.message}`;
        modals.battleShopMessage.style.color = '#dc3545';
        isPurchasingBattleAction = false;
        refreshShopButtonsState();
        return;
    }

    modals.battleShopMessage.textContent = data.message;
    modals.battleShopMessage.style.color = '#28a745';

    // Atualiza o estado local imediatamente com a resposta do servidor
    // (sem precisar de um pollBattleState completo, que poderia resetar o display para 5/5)
    if (data.new_attacks_left !== undefined && currentBattleState && currentBattleState.player_state) {
        currentBattleState.player_state.attacks_left = data.new_attacks_left;
        // Se a quantidade de ações excede o MAX_ACTIONS, garante que não há cooldown ativo
        if (data.new_attacks_left >= MAX_ACTIONS) {
            currentBattleState.player_state.last_attack_at = null;
        }
        renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
    }

    // Incrementa o contador local de compras para atualizar a loja em tempo real
    if (currentBattleState && currentBattleState.player_state) {
        const MAX_PACK_PURCHASES = 5;
        const packCol = packId === 1 ? 'bought_action_pack_1' : 'bought_action_pack_2';
        const oldCount = parseInt(currentBattleState.player_state[packCol]) || 0;
        currentBattleState.player_state[packCol] = Math.min(oldCount + 1, MAX_PACK_PURCHASES);
    }

    setTimeout(() => {
        modals.battleShop.style.display = 'none';
        isPurchasingBattleAction = false;
        refreshShopButtonsState();
    }, 1500);
}

// --- Lógica de Polling e Estado ---

async function pollBattleState() {
    // Para qualquer polling automático anterior
    stopHeartbeatPolling();
    stopDamagePolling();
    
    if (resultsPollTimeout) clearTimeout(resultsPollTimeout);
    resultsPollTimeout = null;
    
    const { data, error } = await supabase.rpc('get_guild_battle_state');

    if (error) {
        console.error("Erro ao buscar estado da batalha:", error);
        showAlert("Erro de conexão. Tentando novamente...");
        setTimeout(pollBattleState, 5000);
        return;
    }

    currentBattleState = data;
    if (data.player_stats) {
        userGuildId = data.player_stats.guild_id;
        userPlayerStats = data.player_stats;
    }
    userRank = data.player_rank;
    if (data.player_stats) {
        updatePlayerResourcesUI(data.player_stats);
    }

    captureNotificationQueue = [];
    isDisplayingCaptureNotification = false;
    const banner = $('battleCaptureNotification');
    if (banner) banner.classList.remove('show');

    switch(data.status) {
        case 'active':
            if (!data || !data.instance || !data.objectives) {
                setTimeout(pollBattleState, 1000); 
                return;
            }

            // Histórico de capturas: marca como processadas mas NÃO toca sons (já ocorreram)
            processedCaptureTimestamps.clear();
            const captures = (data.instance && data.instance.recent_captures) ? data.instance.recent_captures : [];
            if (captures.length > 0) {
                captures.forEach(c => processedCaptureTimestamps.add(c.timestamp));
                lastCaptureTimestamp = captures[captures.length - 1].timestamp; 
                
                // skipSounds = true: eventos históricos, não reproduz áudio
                handleNewCaptures(captures, true);
            } else {
                lastCaptureTimestamp = '1970-01-01T00:00:00+00:00';
            }

            const nexusEvents = (data.instance && data.instance.recent_nexus_events) ? data.instance.recent_nexus_events : [];
            lastNexusEventTimestamp = nexusEvents.length > 0
                ? nexusEvents[nexusEvents.length - 1].timestamp
                : '1970-01-01T00:00:00+00:00';

            if (screens.battle.style.display === 'none' || screens.loading.style.display === 'flex') {
                showScreen('loading');
                setTimeout(async () => {
                    renderBattleScreen(data);
                    if (data.in_nexus) {
                        const entry = await enterNexus(currentBattleState.instance.id);
                        if (entry && entry.success) enterNexusScreenFlow(entry);
                    }
                }, 500);
            } else if (data.in_nexus && !isNexusScreenActive()) {
                renderBattleScreen(data);
                enterNexus(currentBattleState.instance.id).then(entry => {
                    if (entry && entry.success) enterNexusScreenFlow(entry);
                });
            } else if (!isNexusScreenActive()) {
                renderBattleScreen(data);
            }
            break;
            
        case 'registering':
            renderWaitingScreen(data.instance);
            break;
            
        case 'finished':
            if (resultsPollTimeout) clearTimeout(resultsPollTimeout);
            playerDamageCache.clear();
            renderResultsScreen(data.instance, data.player_damage_ranking, data.personal_ranking);
            resultsPollTimeout = setTimeout(pollBattleState, 7000);
            break;
            
        case 'no_guild':
            showScreen('loading');
            $('loadingScreen').innerHTML = '<h2>Você não está em uma guilda.</h2><p>Junte-se a uma guilda para participar.</p>';
            break;
            
        case 'no_battle':
            playerDamageCache.clear();
            renderCitySelectionScreen(data.player_rank);
            break;
            
        default:
            showScreen('loading');
            $('loadingScreen').innerHTML = `<h2>Erro</h2><p>${data.message || 'Estado desconhecido.'}</p>`;
    }
}

// skipSounds = true quando chamado no boot/re-poll para não repetir sons históricos
async function handleNewCaptures(newCaptures, skipSounds = false) {
    if (!newCaptures || newCaptures.length === 0) return;

    const playerIdsToFetch = [...new Set(
        newCaptures
            .map(c => c.player_id)
            .filter(id => id && !playerDamageCache.has(id))
    )];

    if (playerIdsToFetch.length > 0) {
        try {
            const { data: players, error } = await supabase
                .from('players')
                .select('id, name')
                .in('id', playerIdsToFetch);
            
            if (!error && players) {
                players.forEach(p => playerDamageCache.set(p.id, p.name));
            }
        } catch (e) {
            console.warn("Falha ao buscar nomes de jogadores para captura", e);
        }
    }

    newCaptures.forEach(c => {
        const playerName = playerDamageCache.get(c.player_id) || '???';
        const guild = (currentBattleState.instance.registered_guilds || []).find(g => g.guild_id === c.guild_id);
        const guildName = guild ? guild.guild_name : '???';
        const objectiveName = c.objective_name || '???';

        captureNotificationQueue.push({ playerName, guildName, objectiveName });
        
        // Sons são omitidos no boot/re-poll — esses eventos já ocorreram
        if (!skipSounds) {
            const isAlly = c.guild_id === userGuildId;
            playCaptureSound(c.objective_type, c.objective_index, isAlly);
        }
    });

    processCaptureNotificationQueue();
}

async function pollHeartbeatState() {
    const { data, error } = await supabase.rpc('get_battle_heartbeat', { 
        p_last_capture_timestamp: lastCaptureTimestamp,
        p_last_nexus_event_timestamp: lastNexusEventTimestamp
    });
    
    if (error) {
        console.error("Erro no heartbeat:", error.message);
        return;
    }
    
    processHeartbeat(data);
}

function processHeartbeat(data) {
    if (!data) return; 

    switch(data.status) {
        case 'active':
            if (!currentBattleState || !currentBattleState.objectives || !currentBattleState.instance) {
                return; 
            }

            if (data.recent_captures && data.recent_captures.length > 0) {
                const newCaptures = data.recent_captures; 
                
                newCaptures.forEach(c => processedCaptureTimestamps.add(c.timestamp));
                lastCaptureTimestamp = newCaptures[newCaptures.length - 1].timestamp;

                handleNewCaptures(newCaptures);
            }

            data.objectives.forEach(heartbeatObj => {
                const fullObj = currentBattleState.objectives.find(o => o.id === heartbeatObj.id);
                if (fullObj) {
                    fullObj.current_hp = heartbeatObj.current_hp;
                    fullObj.garrison_hp = heartbeatObj.garrison_hp;
                    fullObj.owner_guild_id = heartbeatObj.owner_guild_id;
                    fullObj.expelled_players = heartbeatObj.expelled_players || [];
                }
            });

            // Sincroniza o HP restante da guarnição do jogador no footer
            if (currentBattleState.player_garrison) {
                const garrisonObjId = data.player_garrison_objective_id;
                const garrisonRemainingHp = data.player_garrison_remaining_hp;

                if (garrisonObjId && garrisonObjId === currentBattleState.player_garrison.objective_id
                    && garrisonRemainingHp !== null && garrisonRemainingHp !== undefined) {
                    // Ainda está guarnecendo: atualiza HP restante com valor real do servidor
                    currentBattleState.player_garrison.remaining_hp = parseInt(garrisonRemainingHp, 10);
                } else if (!garrisonObjId) {
                    // Não está mais na tabela de guarnição = foi expulso por dano
                    currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                    currentBattleState.player_garrison = null;
                }
                renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
            }

            if (data.guild_honor) {
                data.guild_honor.forEach(heartbeatGuild => {
                    const fullGuild = currentBattleState.instance.registered_guilds.find(g => g.guild_id === heartbeatGuild.guild_id);
                    if (fullGuild) {
                        fullGuild.honor_points = heartbeatGuild.honor_points;
                    }
                });
            }

            if (typeof data.is_nexus_open === 'boolean') {
                currentBattleState.is_nexus_open = data.is_nexus_open;
                currentBattleState.nexus_opens_at = data.nexus_opens_at || null;
                currentBattleState.nexus_closes_at = data.nexus_closes_at || null;
            }

            if (data.recent_nexus_events && data.recent_nexus_events.length > 0) {
                data.recent_nexus_events.forEach(ev => {
                    lastNexusEventTimestamp = ev.timestamp > lastNexusEventTimestamp ? ev.timestamp : lastNexusEventTimestamp;
                    if (ev.type === 'nexus_pvp') {
                        const html = ev.attacker_won
                            ? `<span style="color:#ff8">${ev.attacker_name}</span> eliminou <span style="color:#f88">${ev.defender_name}</span> no Nexus!`
                            : `<span style="color:#f88">${ev.attacker_name}</span> tentou eliminar <span style="color:#ff8">${ev.defender_name}</span> no Nexus e perdeu.`;
                        pushRawBannerNotification(html);
                    }
                });
            }
            
            renderAllObjectives(currentBattleState.objectives);
            renderRankingModal(currentBattleState.instance.registered_guilds, currentBattleState.player_damage_ranking);
            
            // Re-agenda o próximo heartbeat com base no estado atual
            scheduleNextHeartbeat();
            break;

        case 'finished':
        case 'no_battle':
        case 'no_guild':
            stopHeartbeatPolling();
            stopDamagePolling();
            pollBattleState(); 
            break;
    }
}

async function pollDamageRanking() {
    if (!currentBattleState || !currentBattleState.instance) return;

    const { data, error } = await supabase.rpc('get_battle_damage_ranking', { 
        p_battle_instance_id: currentBattleState.instance.id 
    });
    
    if (error || !data) return;

    const newRanking = data.map(p => ({
        player_id: p.player_id,
        total_damage_dealt: p.total_damage_dealt,
        total_eliminations: p.total_eliminations,
        guild_id: p.guild_id,
        name: playerDamageCache.get(p.player_id) // Puxa do cache
    }));

    currentBattleState.player_damage_ranking = newRanking;
    renderRankingModal(currentBattleState.instance.registered_guilds, currentBattleState.player_damage_ranking);
}

// Lógica de Heartbeat Adaptativo para economizar Egress
function getAdaptivePollingDelay() {
    if (!currentBattleState || !currentBattleState.objectives) return 60000;
    
    // Verifica se algum objetivo tem menos de 30% de HP total
    const isCritical = currentBattleState.objectives.some(obj => {
        const totalHp = (obj.base_hp || 0) + (obj.garrison_hp || 0);
        const currentHp = (obj.current_hp || 0) + (obj.garrison_hp || 0);
        // Evita divisão por zero e checa 30%
        return totalHp > 0 && (currentHp / totalHp) <= 0.30;
    });

    if (isCritical) {
        return 20000; // 20 segundos se crítico
    }
    return 60000; // 60 segundos padrão (economiza egress)
}

function scheduleNextHeartbeat() {
    // Cancela timer anterior se houver
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    
    const delay = getAdaptivePollingDelay();
    console.log(`[Heartbeat] Agendando próximo poll em ${delay/1000}s`);
    
    heartbeatTimer = setTimeout(() => {
        pollHeartbeatState();
    }, delay);
}

function startHeartbeatPolling() {
    stopHeartbeatPolling(); 
    // Inicia o ciclo imediatamente
    pollHeartbeatState();
}

function stopHeartbeatPolling() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
}

function startDamagePolling() {
    stopDamagePolling();
    damagePollInterval = setInterval(pollDamageRanking, 120000);
}

function stopDamagePolling() {
    if (damagePollInterval) clearInterval(damagePollInterval);
    damagePollInterval = null;
}

function startGlobalUITimer() {
    if (uiTimerInterval) clearInterval(uiTimerInterval);

    uiTimerInterval = setInterval(() => {
        const now = new Date();
        
        if (screens.citySelection.style.display === 'flex') {
            // LÓGICA ATUALIZADA: Sábado (Dia 6)
            const registrationTimer = $('registrationTimer');
            const dayUTC = now.getUTCDay(); // 6 = Sábado
            const hoursUTC = now.getUTCHours();
            
            if (TEST_MODE_REGISTRATION) {
                // Espelha o bloco de 5 minutos usado por v_test_mode no backend,
                // só para o contador mostrar um valor coerente durante o teste.
                const bucketMs = 5 * 60 * 1000;
                const bucketStart = Math.floor(now.getTime() / bucketMs) * bucketMs;
                const bucketEnd = bucketStart + bucketMs;
                const timeLeft = Math.max(0, Math.floor((bucketEnd - now.getTime()) / 1000));
                registrationTimer.textContent = `[TESTE] Registro fecha em: ${formatTime(timeLeft)}`;
            } else if (dayUTC === 6 && hoursUTC < 23) {
                // REGISTRO ABERTO Sábado
                const registrationEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 30, 0));
                const timeLeft = Math.max(0, Math.floor((registrationEnd - now) / 1000));
                registrationTimer.textContent = `Registro fecha em: ${formatTime(timeLeft)}`;
            } else {
                // Contagem para o próximo Sábado 00:00 UTC
                const daysToSaturday = (6 - dayUTC + 7) % 7;
                let nextSaturday = new Date(now.getTime());
                nextSaturday.setUTCDate(now.getUTCDate() + daysToSaturday);
                nextSaturday.setUTCHours(0, 0, 0, 0);

                if (dayUTC === 6 && hoursUTC >= 23) { 
                    nextSaturday.setUTCDate(now.getUTCDate() + 7);
                }
                
                const timeToOpen = Math.max(0, Math.floor((nextSaturday - now) / 1000));
                registrationTimer.innerHTML = `Registro abre em: <br><span id="timerreg">${formatTime(timeToOpen)}</span>`;
            }
            updateCityRegistrationButtons();
        }

        if (screens.waiting.style.display === 'flex' && currentBattleState && currentBattleState.status === 'registering') {
            // Contagem para o *início* da batalha (Domingo 00:00 UTC)
            // A batalha começa 30 min após fechar o registro (Sábado 23:30 -> Domingo 00:00)
            const battleStart = new Date(currentBattleState.instance.registration_end_time); 
            battleStart.setMinutes(battleStart.getMinutes() + 30); // Ajuste manual caso o backend não tenha start_time
            
            const timeLeft = Math.max(0, Math.floor((battleStart - now) / 1000));
            $('waitTimer').textContent = formatTime(timeLeft);
            
            if (timeLeft <= 0) {
                pollBattleState(); 
            }
        }

        if (screens.battle.style.display === 'flex' && currentBattleState && currentBattleState.status === 'active') {
            // Contagem para o fim da batalha (Domingo 23:59 UTC)
            const battleEnd = new Date(currentBattleState.instance.end_time);
            const timeLeft = Math.max(0, Math.floor((battleEnd - now) / 1000));

            const overlay = document.getElementById('nexusLockOverlay');
            if (overlay) overlay.textContent = formatNexusLockCountdown();

            const timerEl = battle.timer;
            timerEl.textContent = formatTime(timeLeft);

            // Lazy Polling & Visual Change: Últimos 20 minutos (600s)
            if (timeLeft <= FINAL_PHASE_SECONDS) {
                 
                 // Mudança Visual
                 timerEl.style.background = "linear-gradient(to bottom, white, orange, orange)";
                 timerEl.style.webkitBackgroundClip = "text";
                 timerEl.style.webkitTextFillColor = "transparent";

                 // Ativa Polling se ainda não estiver ativo
                 if (timeLeft > 0 && !heartbeatTimer) {
                     console.log("Fase final da batalha (20min): Iniciando polling adaptativo.");
                     startHeartbeatPolling();
                     startDamagePolling();
                 }
            } else {
                 // Reseta estilo visual caso saia da fase (raro, mas garante consistência)
                 timerEl.style.background = "linear-gradient(to bottom, lightblue 0%, white 50%, blue 100%)";
                 timerEl.style.webkitBackgroundClip = "text";
                 timerEl.style.webkitTextFillColor = "transparent";
            }

            if (currentBattleState.player_state) {
                 renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
            }
            if (timeLeft <= 0) {
                stopHeartbeatPolling();
                stopDamagePolling();
                pollBattleState(); 
            }
        }
    }, 1000);
}

// =================================================================
// FUNÇÃO DE INICIALIZAÇÃO
// =================================================================

function injectGarrisonHpBarStyles() {
    if (document.getElementById('garrisonHpBarStyles')) return;
    const style = document.createElement('style');
    style.id = 'garrisonHpBarStyles';
    style.textContent = `
        #garrison-status.garrisoned {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
        }
        .garrison-personal-hp-bar {
            position: relative;
            width: 160px;
            height: 12px;
            background: #222;
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid #555;
        }
        .garrison-personal-hp-fill {
            height: 100%;
            border-radius: 4px;
            transition: width 0.4s ease, background 0.4s ease;
        }
        .garrison-personal-hp-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 0.65em;
            color: #fff;
            font-weight: bold;
            text-shadow: 1px 1px 2px #000;
            white-space: nowrap;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

function setupDOMElements() {
    ensureNexusDOM();
    screens = {
        loading: $('loadingScreen'),
        citySelection: $('citySelectionScreen'),
        waiting: $('waitingScreen'),
        battle: $('battleActiveScreen'),
        results: $('resultsModal'),
        nexus: $('nexusScreen')
    };

    battle = {
        header: $('battleHeader'),
        timer: $('battleTimer'),
        rankingBtn: $('showRankingBtn'),
        map: $('battleMap'),
        footer: $('battleFooter'),
        playerAttacks: $('player-attacks'),
        playerCooldown: $('player-cooldown'),
        garrisonStatus: $('garrison-status')
    };

    modals = {
        objective: $('objectiveModal'),
        objectiveTitle: $('objectiveModalTitle'),
        objectiveAttackBtn: $('objectiveAttackBtn'),
        objectiveGarrisonBtn: $('objectiveGarrisonBtn'),
        objectiveGarrisonWarning: $('objectiveModalGarrisonWarning'),
        objectiveClose: $('objectiveModalClose'),
        alert: $('alertModal'),
        alertMessage: $('alertModalMessage'),
        alertOk: $('alertModalOk'),
        alertClose: $('alertModalClose'),
        ranking: $('battleRankingModal'),
        rankingClose: $('rankingModalClose'),
        rankingTabGuilds: $('rankingTabGuilds'),
        rankingTabDamage: $('rankingTabDamage'),
        guildRankingList: $('guildRankingList'),
        playerDamageList: $('playerDamageList'),
        cityRegister: $('cityRegisterConfirmModal'),
        cityRegisterClose: $('cityRegisterModalClose'),
        cityRegisterTitle: $('cityRegisterModalTitle'),
        cityRegisterCityName: $('cityRegisterModalCityName'),
        cityRegisterGuildList: $('cityRegisterModalGuildList'),
        cityRegisterMessage: $('cityRegisterModalMessage'),
        cityRegisterCancelBtn: $('cityRegisterModalCancelBtn'),
        cityRegisterConfirmBtn: $('cityRegisterModalConfirmBtn'),
        garrisonLeave: $('garrisonLeaveConfirmModal'),
        garrisonLeaveClose: $('garrisonLeaveModalClose'),
        garrisonLeaveMessage: $('garrisonLeaveModalMessage'),
        garrisonLeaveCancelBtn: $('garrisonLeaveModalCancelBtn'),
        garrisonLeaveConfirmBtn: $('garrisonLeaveConfirmBtn'),
        results: $('resultsModal'),
        resultsClose: $('resultsModalClose'),
        resultCityName: $('resultCityName'),
        resultsRankingHonor: $('resultsRankingHonor'),
        resultsRankingDamage: $('resultsRankingDamage'),
        resultsRewardMessage: $('resultsRewardMessage'),
        resultsModalCloseBtn: $('resultsModalCloseBtn'), 
        battleShop: $('battleShopModal'),
        battleShopClose: $('battleShopModalClose'),
        battleShopMessage: $('battleShopMessage'),
        shopBtnPack1: $('buyPack1Btn'),
        shopBtnPack2: $('buyPack2Btn')
    };

    audio = {
        normal: $('audioNormalHit'),
        crit: $('audioCritHit'),
        enemy_p1: new Audio('https://aden-rpg.pages.dev/assets/ini_ponto1.mp3'),
        enemy_p2: new Audio('https://aden-rpg.pages.dev/assets/ini_ponto2.mp3'),
        enemy_p3: new Audio('https://aden-rpg.pages.dev/assets/ini_ponto3.mp3'),
        enemy_p4: new Audio('https://aden-rpg.pages.dev/assets/ini_ponto4.mp3'),
        enemy_nexus: new Audio('https://aden-rpg.pages.dev/assets/ini_nexus.mp3'),
        ally_p1: new Audio('https://aden-rpg.pages.dev/assets/ally_ponto1.mp3'),
        ally_p2: new Audio('https://aden-rpg.pages.dev/assets/ally_ponto2.mp3'),
        ally_p3: new Audio('https://aden-rpg.pages.dev/assets/ally_ponto3.mp3'),
        ally_p4: new Audio('https://aden-rpg.pages.dev/assets/ally_ponto4.mp3'),
        ally_nexus: new Audio('https://aden-rpg.pages.dev/assets/ally_nexus.mp3')
    };
    
    if(audio.normal) audio.normal.volume = 0.5;
    if(audio.crit) audio.crit.volume = 0.1;
}

async function init() {
    setupDOMElements(); 
    showScreen('loading'); 

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
        window.location.href = 'index.html';
        return;
    }
    userId = session.user.id; 

    createCaptureNotificationUI();
    injectGarrisonHpBarStyles();
    document.body.addEventListener('click', unlockBattleAudio, { once: true });
    _startInactivityGuard();


    // =================================================================
    // ATRIBUIÇÃO DE EVENTOS
    // =================================================================

    // Listeners dos Modais
    if(modals.alertOk) modals.alertOk.onclick = () => modals.alert.style.display = 'none';
    if(modals.alertClose) modals.alertClose.onclick = () => modals.alert.style.display = 'none';
    if(modals.resultsClose) modals.resultsClose.onclick = closeResultsAndShowCities;
    if(modals.resultsModalCloseBtn) modals.resultsModalCloseBtn.onclick = closeResultsAndShowCities;
    if(modals.battleShopClose) modals.battleShopClose.onclick = () => modals.battleShop.style.display = 'none';
    
    if(modals.cityRegisterClose) modals.cityRegisterClose.onclick = () => modals.cityRegister.style.display = 'none';
    if(modals.cityRegisterCancelBtn) modals.cityRegisterCancelBtn.onclick = () => modals.cityRegister.style.display = 'none';
    if(modals.cityRegisterConfirmBtn) modals.cityRegisterConfirmBtn.onclick = () => {
        if (cityToRegister) {
            handleCityRegistrationConfirm(cityToRegister.id, cityToRegister.name);
        }
    };
    
    if(modals.objectiveClose) modals.objectiveClose.onclick = () => modals.objective.style.display = 'none';
    
    if(modals.garrisonLeaveClose) modals.garrisonLeaveClose.onclick = () => {
        pendingGarrisonLeaveAction = null;
        modals.garrisonLeave.style.display = 'none';
    };
    if(modals.garrisonLeaveCancelBtn) modals.garrisonLeaveCancelBtn.onclick = () => {
        pendingGarrisonLeaveAction = null;
        modals.garrisonLeave.style.display = 'none';
    };
    if(modals.garrisonLeaveConfirmBtn) modals.garrisonLeaveConfirmBtn.onclick = () => {
        modals.garrisonLeave.style.display = 'none';
        if (pendingGarrisonLeaveAction) {
            pendingGarrisonLeaveAction();
        }
        pendingGarrisonLeaveAction = null;
    };
    
    // Listeners dos Botões de Ação - ATAQUE (Modo Otimista / Anti-Cheat)
    if (modals.objectiveAttackBtn) {
        modals.objectiveAttackBtn.onclick = async () => {
            unlockBattleAudio(); 
            if (!selectedObjective) return;

            // 1. Verificação Local (Ações)
            const { shownAttacks } = computeShownAttacksAndRemaining();
            if (shownAttacks <= 0) {
                showAlert('Sem ações restantes. Aguarde regenerar.');
                return; 
            }
            
            checkGarrisonLeaveAndExecute(async () => {
                if (isProcessingBattleAction) return;
                isProcessingBattleAction = true;
                
                modals.objectiveAttackBtn.disabled = true;
                modals.objective.style.display = 'none';
                
                // 2. Cálculo Local de Dano (Optimistic UI)
                const { damage, isCrit } = calculateLocalDamage(userPlayerStats);
                
                // 3. Atualização Visual Imediata
                playHitSound(isCrit);
                
                // Atualiza Ações
                optimisticUpdatePlayerActions(1);
                
                // Atualiza HP Visualmente (apenas para feedback, o sync real vem do server se necessário)
                const targetObj = currentBattleState.objectives.find(o => o.id === selectedObjective.id);
                if (targetObj) {
                    const totalHp = (targetObj.current_hp || 0) + (targetObj.garrison_hp || 0);
                    const newHp = Math.max(0, totalHp - damage);
                    const effectiveDmg = totalHp - newHp;
                    
                    // Ajuste simples para UI (Garrison primeiro)
                    if (targetObj.garrison_hp > 0) {
                        if (effectiveDmg >= targetObj.garrison_hp) {
                            const remain = effectiveDmg - targetObj.garrison_hp;
                            targetObj.garrison_hp = 0;
                            targetObj.current_hp = Math.max(0, targetObj.current_hp - remain);
                        } else {
                            targetObj.garrison_hp -= effectiveDmg;
                        }
                    } else {
                        targetObj.current_hp -= effectiveDmg;
                    }
                    
                    const objectiveEl = $(`obj-cp-${selectedObjective.objective_index}`) || $('obj-nexus');
                    displayFloatingDamage(objectiveEl, effectiveDmg, isCrit);
                    if(objectiveEl) {
                        objectiveEl.classList.add('shake-animation');
                        setTimeout(() => objectiveEl.classList.remove('shake-animation'), 900);
                    }
                    
                    // Se o HP cair abaixo de 30% devido a esse ataque local, 
                    // e estivermos na fase final, garante que o próximo polling seja rápido.
                    if (heartbeatTimer) {
                         const maxTotal = (targetObj.base_hp || 0) + (targetObj.garrison_hp || 0); // Aproximação, base_hp é fixo
                         const currentTotal = targetObj.current_hp + targetObj.garrison_hp;
                         if (maxTotal > 0 && (currentTotal / maxTotal) <= 0.30) {
                             scheduleNextHeartbeat(); // Recalcula delay imediatamente
                         }
                    }
                }
                
                // Se saiu da guarnição, atualiza estado
                if(currentBattleState.player_garrison) { 
                    currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                    currentBattleState.player_garrison = null;
                }
                
                renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
                renderAllObjectives(currentBattleState.objectives);

                // 4. Envio Assíncrono (Fire-and-Forget / Validate)
                supabase.rpc('attack_battle_objective', { 
                    p_objective_id: selectedObjective.id,
                    p_claimed_damage: damage,
                    p_is_crit: isCrit
                })
                .then(({ data, error }) => {
                    if (error || !data.success) {
                        console.warn("Sync Error:", error ? error.message : data.message);
                        if (data?.force_sync) pollBattleState(); // Cheat/Desync detectado
                        else showAlert(data.message); // Erro lógico (ex: sem ações reais)
                        return;
                    }
                    
                    // FIX: Atualiza estado de ações imediatamente com resposta do servidor
                    if (data.new_attacks_left !== undefined && currentBattleState && currentBattleState.player_state) {
                        currentBattleState.player_state.attacks_left = data.new_attacks_left;
                        currentBattleState.player_state.last_attack_at = data.new_last_attack_at;
                        renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
                    }

                    // Se o objetivo foi destruído, precisamos sincronizar tudo (vencedor, honra, etc)
                    if (data.objective_destroyed) {
                        pollHeartbeatState(); // Traz o novo dono e toca sons
                    }
                })
                .finally(() => {
                    setTimeout(() => {
                        isProcessingBattleAction = false;
                        if (selectedObjective && currentBattleState) {
                            const latestObjState = currentBattleState.objectives.find(o => o.id === selectedObjective.id);
                            if (latestObjState && latestObjState.owner_guild_id !== userGuildId) {
                                modals.objectiveAttackBtn.disabled = false;
                            }
                        }
                    }, 800); 
                });
            });
        };
    }

    if (modals.objectiveGarrisonBtn) {
        modals.objectiveGarrisonBtn.onclick = async () => {
            unlockBattleAudio(); 
            if (!selectedObjective) return;
            
            if (currentBattleState && currentBattleState.player_state && currentBattleState.player_state.last_garrison_leave_at) {
                const lastLeave = new Date(currentBattleState.player_state.last_garrison_leave_at);
                const timeSinceLeave = Math.floor((new Date() - lastLeave) / 1000);
                
                if (timeSinceLeave < 60) {
                    const timeLeft = 60 - timeSinceLeave;
                    showAlert(`Aguarde 60 segundos para guarnecer novamente. (Faltam ${timeLeft}s)`);
                    return;
                }
            }

            const { shownAttacks } = computeShownAttacksAndRemaining();
            if (shownAttacks <= 0) {
                showAlert('Sem ações restantes.');
                return; 
            }
            
            checkGarrisonLeaveAndExecute(async () => {
                if (isProcessingBattleAction) return;
                isProcessingBattleAction = true;
                modals.objectiveGarrisonBtn.disabled = true;
                modals.objective.style.display = 'none';

                if (currentBattleState) {
                    try {
                        if (!currentBattleState.player_state) currentBattleState.player_state = {};
                        
                        if (currentBattleState.player_garrison && userPlayerStats) {
                            const oldObj = currentBattleState.objectives.find(o => o.id === currentBattleState.player_garrison.objective_id);
                            if (oldObj) {
                                const oldRemaining = currentBattleState.player_garrison.remaining_hp || parseInt(userPlayerStats.health, 10);
                                oldObj.garrison_hp = Math.max(0, (oldObj.garrison_hp || 0) - oldRemaining);
                            }
                            currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                            currentBattleState.player_state.last_garrison_remaining_hp = currentBattleState.player_garrison.remaining_hp;
                            currentBattleState.player_state.last_garrison_objective_id = currentBattleState.player_garrison.objective_id;
                        }
                        
                        optimisticUpdatePlayerActions(1);
                        
                        // Determina HP a adicionar (restante ou cheio)
                        const playerHpFull = parseInt(userPlayerStats.health, 10);
                        const lastRemaining = currentBattleState.player_state.last_garrison_remaining_hp;
                        const lastObjId = currentBattleState.player_state.last_garrison_objective_id;
                        const hpToAdd = (lastObjId === selectedObjective.id && lastRemaining > 0)
                            ? lastRemaining
                            : playerHpFull;

                        currentBattleState.player_garrison = {
                            objective_id: selectedObjective.id,
                            player_hp: playerHpFull,
                            remaining_hp: hpToAdd,
                            started_at: new Date().toISOString()
                        };
                        
                        if (userPlayerStats) {
                            const newObj = currentBattleState.objectives.find(o => o.id === selectedObjective.id);
                            if (newObj) {
                                 newObj.garrison_hp = (newObj.garrison_hp || 0) + hpToAdd;
                            }
                        }
                        
                        renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
                        renderAllObjectives(currentBattleState.objectives);
                        
                    } catch (e) {
                        console.warn("Erro atualização otimista (garrison):", e);
                    }
                }

                supabase.rpc('garrison_battle_objective', { p_objective_id: selectedObjective.id })
                    .then(({ data, error }) => {
                        if (error || !data.success) {
                            showAlert(error ? error.message : data.message);
                            setTimeout(pollBattleState, 500); 
                        }
                    })
                    .finally(() => {
                        setTimeout(() => {
                            isProcessingBattleAction = false;
                            modals.objectiveGarrisonBtn.disabled = false;
                        }, 800); 
                        setTimeout(pollHeartbeatState, 1500); 
                    });
            });
        };
    }
    
    document.querySelectorAll('.battle-objective').forEach(el => {
        el.addEventListener('click', () => {
            unlockBattleAudio(); 
            if (!currentBattleState || currentBattleState.status !== 'active' || !currentBattleState.objectives) return;
            const index = parseInt(el.dataset.index, 10);
            const objective = currentBattleState.objectives.find(o => o.objective_index === index);
            if (objective) {
                handleObjectiveClick(objective);
            }
        });
    });

    if (battle.rankingBtn) {
        battle.rankingBtn.onclick = () => {
            unlockBattleAudio(); 
            
            // Verificação de Fase Final para exibir Ranking
            if (currentBattleState && currentBattleState.instance && currentBattleState.instance.end_time) {
                const now = new Date();
                const end = new Date(currentBattleState.instance.end_time);
                const secondsLeft = Math.floor((end - now) / 1000);

                if (secondsLeft > FINAL_PHASE_SECONDS) {
                    showAlert("⚔️ Nevoeiro de Guerra ⚔️\n\nOs rankings estão ocultos estrategicamente.\nEles serão revelados apenas nos últimos 20 minutos de batalha!");
                    return;
                }
            }

            modals.ranking.style.display = 'flex';
            document.querySelectorAll('.ranking-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            const defaultTabBtn = modals.ranking.querySelector('.tab-btn[data-tab="guilds"]');
            if (defaultTabBtn) defaultTabBtn.classList.add('active');
            document.querySelectorAll('#battleRankingModal .tab-pane').forEach(pane => {
                pane.classList.remove('active');
                pane.style.display = 'none';
            });
            if (modals.rankingTabGuilds) {
                modals.rankingTabGuilds.classList.add('active');
                modals.rankingTabGuilds.style.display = 'block';
            }
        };
    }
    if (modals.rankingClose) {
        modals.rankingClose.onclick = () => modals.ranking.style.display = 'none';
    }

    document.querySelectorAll('.ranking-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            document.querySelectorAll('.ranking-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const targetPaneId = tabId === 'guilds' ? 'rankingTabGuilds' : 'rankingTabDamage';
            document.querySelectorAll('#battleRankingModal .tab-pane').forEach(pane => {
                const isActive = pane.id === targetPaneId;
                pane.style.display = isActive ? 'block' : 'none';
                pane.classList.toggle('active', isActive);
            });
        });
    });

    const showShopBtnEl = $('showShopBtn'); 
    if (showShopBtnEl) {
        showShopBtnEl.onclick = () => {
            unlockBattleAudio(); 
            openBattleShop();
        };
    }
    if (modals.shopBtnPack1) {
        modals.shopBtnPack1.onclick = () => handleBuyBattleActions(1, 30, 3, modals.shopBtnPack1);
    }
    if (modals.shopBtnPack2) {
        modals.shopBtnPack2.onclick = () => handleBuyBattleActions(2, 75, 5, modals.shopBtnPack2);
    }

    pollBattleState();
    startGlobalUITimer();
}

document.addEventListener('DOMContentLoaded', init);