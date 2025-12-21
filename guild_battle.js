import { supabase } from './supabaseClient.js'

// =================================================================
// 0. CONSTANTES E VARIÁVEIS GLOBAIS
// =================================================================

// Cache de Stats (24 Horas - igual ao Mines)
const STATS_CACHE_DURATION = 72 * 60 * 60 * 1000; 

// --- Variáveis de Estado Global ---
let userId = null;
let userGuildId = null;
let userRank = null;
let userPlayerStats = null;
let cachedCombatStats = null; // Variável para armazenar stats em memória

let currentBattleState = null; 
let heartbeatInterval = null;
let uiTimerInterval = null;
let selectedObjective = null;

// REQ 2/3: Flag para previnir ações duplicadas
let isProcessingBattleAction = false;

let damagePollInterval = null;
let playerDamageCache = new Map();
let cityToRegister = null;
let pendingGarrisonLeaveAction = null;
let resultsPollTimeout = null; // NOVO: Para controlar o poll da tela de resultados

let captureNotificationQueue = [];
let isDisplayingCaptureNotification = false;
let processedCaptureTimestamps = new Set();
let lastCaptureTimestamp = '1970-01-01T00:00:00+00:00'; 

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
    CARD_COMMON: { name: 'Cartão Comum', img: 'https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_comum.webp' }
};

// --- Elementos DOM ---
const $ = (selector) => document.getElementById(selector);

// MODIFICAÇÃO: Declarar como 'let' e vazios. Serão populados no init.
let screens = {};
let battle = {};
let modals = {};
let audio = {};

// Áudio
// REQ 1 (Bug Áudio): Desbloqueio de Mídia (Correção)
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let isMediaUnlocked = false;

function unlockBattleAudio() {
    if (isMediaUnlocked) return;
    isMediaUnlocked = true; 

    // 1. Resume o AudioContext
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(e => console.warn("AudioContext resume falhou", e));
    }

    // 2. Toca e pausa um som de forma silenciosa
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

// NOVO: Função para fechar modal de resultados e voltar à tela de cidades
function closeResultsAndShowCities() {
    if (resultsPollTimeout) clearTimeout(resultsPollTimeout);
    resultsPollTimeout = null;
    modals.results.style.display = 'none';
    renderCitySelectionScreen(userRank || 'member'); 
}

function formatTime(totalSeconds) {
    // ATUALIZADO: para lidar com dias, horas, minutos e segundos
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
// 1. SISTEMA DE CACHE DE STATS (OTIMIZAÇÃO)
// =================================================================
async function getOrUpdatePlayerStatsCache(forceUpdate = false) {
    if (!userId) return null;
    const now = Date.now();
    const cacheKey = `player_combat_stats_${userId}`;
    
    // Tenta ler do LocalStorage
    let stored = localStorage.getItem(cacheKey);
    if (stored && !forceUpdate) {
        try {
            const parsed = JSON.parse(stored);
            // Verifica validade (12h/24h conforme config)
            if (now - parsed.timestamp < STATS_CACHE_DURATION) {
                cachedCombatStats = parsed.data;
                return cachedCombatStats;
            }
        } catch(e) { console.warn("Cache stats inválido", e); }
    }

    // Busca do Backend (usa a RPC otimizada que salva na tabela players)
    // Nota: Usamos get_player_combat_stats que é a versão otimizada usada na mina
    const { data, error } = await supabase.rpc('get_player_combat_stats', { p_player_id: userId });
    
    if (error || !data) {
        console.error("Erro ao buscar stats via cache", error);
        return null;
    }

    // Salva no Cache Local
    const cacheObj = { timestamp: now, data: data };
    localStorage.setItem(cacheKey, JSON.stringify(cacheObj));
    cachedCombatStats = data;
    return cachedCombatStats;
}

// =================================================================
// NOVA FUNÇÃO DE CORREÇÃO
// =================================================================
/**
 * Replica a lógica de recuperação e consumo de ações do servidor,
 * para ser usada nas atualizações otimistas do cliente,
 * corrigindo o bug de inconsistência de ações.
 */
function optimisticUpdatePlayerActions() {
    if (!currentBattleState || !currentBattleState.player_state) return;

    const playerState = currentBattleState.player_state;
    const now = new Date();
    const naturalCap = 3; // Limite de ações que recuperam
    
    // Pega o estado atual ANTES de modificar
    let attacksLeft = playerState.attacks_left || 0;
    let lastAttackAt = playerState.last_attack_at ? new Date(playerState.last_attack_at) : null;

    // 1. Replica a lógica de RECUPERAÇÃO do servidor
    // Só recupera se o 'last_attack_at' existir (indicando que o timer está correndo)
    // E se as ações estiverem abaixo do limite natural
    if (lastAttackAt && attacksLeft < naturalCap) {
        const elapsed = Math.floor((now - lastAttackAt) / 1000); // Segundos desde o início do timer
        const recovered = Math.floor(elapsed / 60);             // Ações recuperadas
        
        if (recovered > 0) {
            // Adiciona as ações recuperadas, limitando ao teto
            attacksLeft = Math.min(naturalCap, attacksLeft + recovered);
            
            if (attacksLeft >= naturalCap) {
                // Totalmente recuperado, para o timer
                lastAttackAt = null; 
            } else {
                // Parcialmente recuperado, avança o timer
                // Ex: Tinha 0, timer em T=0. Passou 1.5 min. Recuperou 1.
                // Novo timer base é T=60s.
                lastAttackAt = new Date(lastAttackAt.getTime() + recovered * 60000);
            }
        }
    }

    // 2. Replica o CONSUMO da ação
    attacksLeft = attacksLeft - 1;

    // 3. Replica o INÍCIO do timer
    // Se o timer estava parado (lastAttackAt == null), inicia ele agora.
    if (lastAttackAt === null) {
        lastAttackAt = now;
    }

    // 4. Aplica o novo estado calculado ao objeto local
    currentBattleState.player_state.attacks_left = attacksLeft;
    currentBattleState.player_state.last_attack_at = lastAttackAt ? lastAttackAt.toISOString() : null;
}
// =================================================================
// FIM DA NOVA FUNÇÃO
// =================================================================


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
    banner.innerHTML = `<span style="color: yellow;">${data.playerName}</span> da guilda <span style="color: #00bcd4;">${data.guildName}</span> destruiu o <span style="color: lightgreen;">${data.objectiveName}</span>!`;
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
    // Aqui usamos o objeto userPlayerStats que já deve conter a fusão do cache + dados dinâmicos
    // Porém, para garantir, verificamos se crystals existe
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
    
    // LÓGICA ATUALIZADA: Checa o dia e hora em UTC
    const now = new Date();
    const dayUTC = now.getUTCDay(); // 0 = Domingo
    const hoursUTC = now.getUTCHours();
    const isLeader = playerRank === 'leader' || playerRank === 'co-leader';
    let registrationOpen = (dayUTC === 0 && hoursUTC < 23); // Domingo, antes das 23:00 UTC

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
    
    // LÓGICA ATUALIZADA: Checa o dia e hora em UTC
    const now = new Date();
    const dayUTC = now.getUTCDay(); // 0 = Domingo
    const hoursUTC = now.getUTCHours();
    let registrationOpen = (dayUTC === 0 && hoursUTC < 23); // Domingo, antes das 23:00 UTC

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
    // Otimização: userPlayerStats já foi definido no pollBattleState com a fusão do cache

    const city = CITIES.find(c => c.id === state.instance.city_id);
    if (city) {
        battle.map.style.backgroundImage = `url(${city.map_image_url || 'https://aden-rpg.pages.dev/assets/guild_battle.webp'})`;
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
    updatePlayerResourcesUI(userPlayerStats);
    showScreen('battle');
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

    modals.playerDamageList.innerHTML = '';
    playerDamageRanking.forEach((p, index) => {
        const playerName = playerDamageCache.get(p.player_id) || p.name || '???';
        if (p.name && !playerDamageCache.has(p.player_id)) {
            playerDamageCache.set(p.player_id, p.name);
        }
        const color = guildColorMap.get(p.guild_id) || 'var(--guild-color-neutral)';
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${index + 1}. <strong style="color: ${color};">${playerName}</strong></span>
            <span>${kFormatter(p.total_damage_dealt)}</span>
        `;
        modals.playerDamageList.appendChild(li);
    });
}

function renderAllObjectives(objectives) {
    const container = document.getElementById('battleMapObjectives');
    container.innerHTML = '';

    const sortedObjs = [...objectives].sort((a, b) => a.objective_index - b.objective_index);

    sortedObjs.forEach(obj => {
        const el = document.createElement('div');
        el.className = 'objective-tower'; // Nova classe CSS para formato 9:16
        el.id = `obj-${obj.id}`;
        
        const ownerColor = getGuildColor(obj.owner_guild_id);
        
        // Aplica filtro de cor na "aura" da torre ou borda
        el.style.boxShadow = `0 0 15px ${ownerColor}66`;
        el.style.borderColor = ownerColor;
        const currentTotalHp = obj.current_hp + obj.garrison_hp;
        const hpPercent = Math.max(0, Math.min(100, (currentTotalHp / obj.base_hp) * 100));

        const garrisonIcon = obj.garrison_hp > 0 ? '<span class="garrison-badge">🛡️</span>' : '';

        el.innerHTML = `
            <div class="tower-image"></div>
            <div class="tower-overlay">
                <div class="obj-id">${obj.objective_index}</div>
                ${garrisonIcon}
                <div class="hp-bar-tower"><div style="width: ${hpPercent}%; background: ${ownerColor}"></div></div>
            </div>
        `;

        el.onclick = () => selectObjective(obj);
        container.appendChild(el);
    });
    if (selectedObjective) {
        const updatedSelected = objectives.find(o => o.id === selectedObjective.id);
        if (updatedSelected) renderObjectiveDetails(updatedSelected);
    }
}

function selectObjective(obj) {
    selectedObjective = obj;
    document.querySelectorAll('.objective-tower').forEach(el => el.classList.remove('selected'));
    const el = document.getElementById(`obj-${obj.id}`);
    if (el) el.classList.add('selected');
    renderObjectiveDetails(obj);
}

function renderObjectiveDetails(obj) {
    const panel = document.getElementById('objectiveDetailsPanel');
    panel.style.display = 'block';
    const ownerColor = getGuildColor(obj.owner_guild_id);
    const isMyGuildOwner = obj.owner_guild_id === userGuildId;
    let statusText = isMyGuildOwner ? "Dominado" : "Inimigo";
    if (!obj.owner_guild_id) statusText = "Neutro";

    let actionBtn = '';
    const myGarrison = currentBattleState.player_garrison;
    const playerInThisGarrison = myGarrison && myGarrison.objective_id === obj.id;

    if (isMyGuildOwner) {
        if (playerInThisGarrison) {
             actionBtn = `<button class="btn btn-warning" onclick="handleLeaveGarrison('${obj.id}')">Sair da Guarnição</button>`;
        } else if (!myGarrison) {
             actionBtn = `<button class="btn btn-primary" onclick="handleGarrison('${obj.id}')">Defender</button>`;
        }
    } else {
        actionBtn = `<button class="btn btn-danger" onclick="handleAttack('${obj.id}')">ATACAR</button>`;
    }
    panel.innerHTML = `
        <div class="panel-header" style="background: ${ownerColor}">
            <h3>Torre ${obj.objective_index}</h3>
            <span>${statusText}</span>
        </div>
        <div class="panel-body">
            <div class="stat-row"><span>Estrutura:</span><span>${formatNumber(obj.current_hp)}</span></div>
            <div class="stat-row"><span>Guarnição:</span><span>${formatNumber(obj.garrison_hp)}</span></div>
            <div class="action-area">${actionBtn}</div>
        </div>
    `;
}

function renderPlayerFooter(playerState, playerGarrison) {
    if (!playerState) return; 

    // Atualiza o estado local para o helper
    if (currentBattleState) {
        currentBattleState.player_state = playerState;
        currentBattleState.player_garrison = playerGarrison;
    }

    const { shownAttacks, secondsToNext } = computeShownAttacksAndRemaining();
    const naturalCap = 3;

    battle.playerAttacks.textContent = `Ações: ${Math.max(0, shownAttacks)} / ${naturalCap}`;
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
        battle.garrisonStatus.textContent = `Guarnecendo: ${objName}`;
        battle.garrisonStatus.className = 'garrisoned';
    } else if (playerState.last_garrison_leave_at) {
        const lastLeave = new Date(playerState.last_garrison_leave_at);
        const timeSinceLeave = Math.floor((new Date() - lastLeave) / 1000);
        if (timeSinceLeave < 30) {
            const timeLeft = 30 - timeSinceLeave;
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

function renderResultsScreen(instance, playerDamageRanking) {
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

    modals.resultsRankingDamage.innerHTML = '';
    if (!playerDamageRanking || playerDamageRanking.length === 0) {
        modals.resultsRankingDamage.innerHTML = '<li>Nenhum jogador causou dano.</li>';
    } else {
        const guildNameMap = new Map();
        (instance.registered_guilds || []).forEach(g => guildNameMap.set(g.guild_id, g.guild_name));
        
        playerDamageRanking.forEach((p, index) => {
            const li = document.createElement('li');
            const guildName = guildNameMap.get(p.guild_id) ? `(${guildNameMap.get(p.guild_id)})` : '';
            const playerName = playerDamageCache.get(p.player_id) || p.name || '???';
            li.innerHTML = `
                <span>#${index + 1} ${playerName} ${guildName}</span>
                <span>${kFormatter(p.total_damage_dealt)}</span>
            `;
            modals.resultsRankingDamage.appendChild(li);
        });
    }

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
    
    let myPlayerDamageRank = -1;
    if (playerDamageRanking && playerDamageRanking.length > 0) {
        const myDamageData = playerDamageRanking.find(p => p.player_id === userId);
        if (myDamageData) {
            myPlayerDamageRank = playerDamageRanking.indexOf(myDamageData) + 1;
        }
    }

    let guildRewardsHTML = '<h4>Recompensas da Guilda</h4>';
    let hasGuildRewards = false;

    if (myGuildRank === 1 && myGuildResult.honor_points > 0) {
        modals.resultsRewardMessage.textContent = "Sua guilda venceu! Recompensas enviadas.";
        modals.resultsRewardMessage.style.color = 'gold';
        guildRewardsHTML += '<div class="results-reward-list">';
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, 3000);
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_ADVANCED, 4);
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, 50);
        guildRewardsHTML += '</div>';
        hasGuildRewards = true;
    } else if (myGuildRank === 2 && myGuildResult.honor_points > 0) {
        modals.resultsRewardMessage.textContent = "Sua guilda ficou em 2º lugar! Recompensas enviadas.";
        modals.resultsRewardMessage.style.color = '#00bcd4';
        guildRewardsHTML += '<div class="results-reward-list">';
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, 1000);
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_COMMON, 6);
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, 20);
        guildRewardsHTML += '</div>';
        hasGuildRewards = true;
    } else if (myGuildRank === 3 && myGuildResult.honor_points > 0) {
        modals.resultsRewardMessage.textContent = "Sua guilda ficou em 3º lugar! Recompensas enviadas.";
        modals.resultsRewardMessage.style.color = '#cd7f32';
        guildRewardsHTML += '<div class="results-reward-list">';
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, 500);
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_COMMON, 4);
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, 10);
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

    if (myGuildRank === 1 && myPlayerDamageRank === 1) {
        playerRewardsHTML += '<p>Bônus por <strong>Rank 1</strong> em Dano (Multiplicador 3x):</p>';
        playerRewardsHTML += '<div class="results-reward-list">';
        playerRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, "3000 (Base) + 6000 (Bônus)");
        playerRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_ADVANCED, "4 (Base) + 8 (Bônus)");
        playerRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, "50 (Base) + 100 (Bônus)");
        playerRewardsHTML += '</div>';
        hasPlayerRewards = true;
    } else if (myGuildRank === 1 && myPlayerDamageRank === 2) {
        playerRewardsHTML += '<p>Bônus por <strong>Rank 2</strong> em Dano (Multiplicador 2x):</p>';
        playerRewardsHTML += '<div class="results-reward-list">';
        playerRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, "3000 (Base) + 3000 (Bônus)");
        playerRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_ADVANCED, "4 (Base) + 4 (Bônus)");
        playerRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, "50 (Base) + 50 (Bônus)");
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
    unlockBattleAudio(); // Desbloqueia áudio
    cityToRegister = { id: cityId, name: cityName };
    modals.cityRegisterCityName.textContent = cityName;
    modals.cityRegisterMessage.textContent = "Carregando guildas registradas...";
    modals.cityRegisterGuildList.innerHTML = '';
    modals.cityRegisterConfirmBtn.disabled = true;
    modals.cityRegister.style.display = 'flex';

    const { data, error } = await supabase.rpc('get_city_registrations', { p_city_id: cityId });

    if (error || !data.success) {
        modals.cityRegisterMessage.textContent = `Erro: ${error ? error.message : data.message}`;
        modals.cityRegisterMessage.style.color = '#dc3545';
        return;
    }

    const guilds = data.registered_guilds || [];
    
    // --- LÓGICA DE MASCARAR NOMES (Alteração Solicitada) ---
    const maxGuilds = 4;
    const isFull = guilds.length >= maxGuilds;
    // userGuildId é uma variável global do seu arquivo
    const amIRegistered = guilds.some(g => g.guild_id === userGuildId); 
    
    // Revela se estiver cheio OU se minha guilda já estiver na lista
    const showNames = isFull || amIRegistered; 

    if (guilds.length === 0) {
        modals.cityRegisterGuildList.innerHTML = '<li>1. (Vazio)</li>';
    } else {
        guilds.forEach((g, index) => {
            const li = document.createElement('li');
            
            if (showNames) {
                // Se pode revelar, mostra o nome
                li.textContent = `${index + 1}. ${g.guild_name}`;
                
                // Destaque visual para sua própria guilda
                if (g.guild_id === userGuildId) {
                    li.style.color = 'gold';
                    li.style.fontWeight = 'bold';
                    li.textContent += ' (Sua Guilda)';
                }
            } else {
                // Se não pode revelar, mostra ???
                li.textContent = `${index + 1}. ???`;
            }
            
            modals.cityRegisterGuildList.appendChild(li);
        });
    }
    // -------------------------------------------------------

    if (guilds.length >= 4) {
        modals.cityRegisterMessage.textContent = "Esta cidade já atingiu o limite de 4 guildas.";
        modals.cityRegisterMessage.style.color = '#ffc107';
        modals.cityRegisterConfirmBtn.disabled = true;
    } else if (amIRegistered) {
         // Se eu já estou registrado, aviso e desabilito o botão de registrar de novo
        modals.cityRegisterMessage.textContent = "Sua guilda já está registrada aqui.";
        modals.cityRegisterMessage.style.color = '#28a745';
        modals.cityRegisterConfirmBtn.disabled = true;
    } else {
        modals.cityRegisterMessage.textContent = "";
        modals.cityRegisterConfirmBtn.disabled = false;
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
    unlockBattleAudio(); // Desbloqueia áudio
    if (isProcessingBattleAction) return;

    const fullObjective = currentBattleState.objectives.find(o => o.id === objective.id);
    if (!fullObjective) return; 
    
    selectedObjective = fullObjective; 
    modals.objectiveTitle.textContent = fullObjective.objective_type === 'nexus' ? 'Nexus Central' : `Ponto de Controle ${fullObjective.objective_index}`;
    const isOwned = fullObjective.owner_guild_id === userGuildId;
    
    modals.objectiveAttackBtn.disabled = isOwned;
    modals.objectiveAttackBtn.style.filter = isOwned ? 'grayscale(1)' : '';
    modals.objectiveAttackBtn.style.opacity = isOwned ? '0.6' : '1';
    modals.objectiveGarrisonBtn.style.display = isOwned ? 'inline-block' : 'none';

    const isGarrisonedElsewhere = currentBattleState.player_garrison && 
                                  (!isOwned || currentBattleState.player_garrison.objective_id !== fullObjective.id);
                                  
    modals.objectiveGarrisonWarning.style.display = isGarrisonedElsewhere ? 'block' : 'none';
    modals.objectiveGarrisonWarning.textContent = "Atenção: Esta ação removerá você da sua guarnição atual.";

    modals.objective.style.display = 'flex';
}

function checkGarrisonLeaveAndExecute(actionCallback) {
    if (!currentBattleState || !currentBattleState.player_garrison || !userPlayerStats) {
        actionCallback();
        return;
    }
    
    const oldObjectiveId = currentBattleState.player_garrison.objective_id;
    const oldObjective = currentBattleState.objectives.find(o => o.id === oldObjectiveId);
    // Usa HP do player (agora vindo do cache)
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

// =================================================================
// CORREÇÃO DA LOJA: Função adicionada que estava faltando
// =================================================================
function openBattleShop() {
    // Limpa mensagens anteriores
    if (modals.battleShopMessage) {
        modals.battleShopMessage.textContent = "";
    }
    
    // Reabilita os botões caso tenham ficado travados em loading
    if (modals.shopBtnPack1) {
        modals.shopBtnPack1.disabled = false;
        modals.shopBtnPack1.textContent = "Comprar";
    }
    if (modals.shopBtnPack2) {
        modals.shopBtnPack2.disabled = false;
        modals.shopBtnPack2.textContent = "Comprar";
    }

    // Exibe o modal
    modals.battleShop.style.display = 'flex';
}

async function handleBuyBattleActions(packId, cost, actions, btnEl) {
    btnEl.disabled = true;
    modals.battleShopMessage.textContent = "Processando...";

    const { data, error } = await supabase.rpc('buy_battle_actions', { p_pack_id: packId });

    if (error || !data.success) {
        modals.battleShopMessage.textContent = `Erro: ${error ? error.message : data.message}`;
        modals.battleShopMessage.style.color = '#dc3545';
        if (!data.message.includes("já comprou")) {
             btnEl.disabled = false;
        }
        return;
    }

    modals.battleShopMessage.textContent = data.message;
    modals.battleShopMessage.style.color = '#28a745';
    btnEl.textContent = "Comprado";
    pollBattleState();
    setTimeout(() => {
        modals.battleShop.style.display = 'none';
    }, 1500);
}

// --- Lógica de Polling e Estado ---

async function pollBattleState() {
    stopHeartbeatPolling();
    stopDamagePolling();
    
    // Limpa o timeout de re-poll de resultados se o pollBattleState for chamado
    if (resultsPollTimeout) clearTimeout(resultsPollTimeout);
    resultsPollTimeout = null;
    
    const { data, error } = await supabase.rpc('get_guild_battle_state');

    if (error) {
        console.error("Erro ao buscar estado da batalha:", error);
        showAlert("Erro de conexão. Tentando novamente...");
        setTimeout(pollBattleState, 5000);
        return;
    }

    // --- INTEGRAÇÃO DO CACHE DE STATS ---
    // Busca stats pesados (Attack, Def, HP) do cache local (ou DB se expirado)
    const cachedStats = await getOrUpdatePlayerStatsCache();

    currentBattleState = data;
    
    if (data.player_stats) {
        userGuildId = data.player_stats.guild_id;
        
        // FUSÃO: Dados dinâmicos do servidor (Crystals, etc.) + Dados estáticos do Cache (HP, Atk)
        userPlayerStats = {
            ...data.player_stats, // Preserva crystals, guild_id, etc. vindos do server
            ...(cachedStats || {}) // Sobrescreve health, attack, defense com o cache otimizado
        };

        // Garante que recursos voláteis como crystals venham sempre do servidor
        if (data.player_stats.crystals !== undefined) {
            userPlayerStats.crystals = data.player_stats.crystals;
        }
    }
    
    userRank = data.player_rank;
    if (userPlayerStats) {
        updatePlayerResourcesUI(userPlayerStats);
    }
    // -------------------------------------

    captureNotificationQueue = [];
    isDisplayingCaptureNotification = false;
    const banner = $('battleCaptureNotification');
    if (banner) banner.classList.remove('show');

    switch(data.status) {
        case 'active':
            if (!data || !data.instance || !data.objectives) {
                console.warn("Estado da batalha incompleto, aguardando...");
                setTimeout(pollBattleState, 1000); 
                return;
            }

            // *** CORREÇÃO (REQ 1) ***
            // A lógica de captura no Full Load agora APENAS preenche o histórico
            processedCaptureTimestamps.clear();
            const captures = (data.instance && data.instance.recent_captures) ? data.instance.recent_captures : [];
            if (captures.length > 0) {
                // 1. Preenche o set com TODO o histórico
                captures.forEach(c => processedCaptureTimestamps.add(c.timestamp));
                // 2. Define o timestamp para o próximo heartbeat
                lastCaptureTimestamp = captures[captures.length - 1].timestamp; 
            } else {
                lastCaptureTimestamp = '1970-01-01T00:00:00+00:00';
            }
            // *** FIM DA CORREÇÃO ***

            if (screens.battle.style.display === 'none' || screens.loading.style.display === 'flex') {
                showScreen('loading');
                setTimeout(() => {
                    renderBattleScreen(data);
                    startHeartbeatPolling();
                    startDamagePolling();
                }, 500);
            } else {
                renderBattleScreen(data);
                startHeartbeatPolling();
                startDamagePolling();
            }
            break;
            
        case 'registering':
            renderWaitingScreen(data.instance);
            break;
            
        case 'finished':
            if (resultsPollTimeout) clearTimeout(resultsPollTimeout); // Limpa o timeout anterior
            playerDamageCache.clear();
            renderResultsScreen(data.instance, data.player_damage_ranking);
            // Define um novo timeout para o caso do usuário não fechar o modal
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

async function handleNewCaptures(newCaptures) {
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
        
        const isAlly = c.guild_id === userGuildId;
        playCaptureSound(c.objective_type, c.objective_index, isAlly);
    });

    processCaptureNotificationQueue();
}

async function pollHeartbeatState() {
    const { data, error } = await supabase.rpc('get_battle_heartbeat', { 
        p_last_capture_timestamp: lastCaptureTimestamp 
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
                }
            });

            if (data.guild_honor) {
                data.guild_honor.forEach(heartbeatGuild => {
                    const fullGuild = currentBattleState.instance.registered_guilds.find(g => g.guild_id === heartbeatGuild.guild_id);
                    if (fullGuild) {
                        fullGuild.honor_points = heartbeatGuild.honor_points;
                    }
                });
            }
            
            renderAllObjectives(currentBattleState.objectives);
            renderRankingModal(currentBattleState.instance.registered_guilds, currentBattleState.player_damage_ranking);
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
    
    if (error || !data) {
        console.warn("Erro no poll de dano:", error ? error.message : "Sem dados");
        return;
    }

    const newRanking = data.map(p => ({
        player_id: p.player_id,
        total_damage_dealt: p.total_damage_dealt,
        guild_id: p.guild_id,
        name: playerDamageCache.get(p.player_id) // Puxa do cache
    }));

    currentBattleState.player_damage_ranking = newRanking;
    renderRankingModal(currentBattleState.instance.registered_guilds, currentBattleState.player_damage_ranking);
}


function startHeartbeatPolling() {
    stopHeartbeatPolling(); 
    heartbeatInterval = setInterval(pollHeartbeatState, 10000);
}

function stopHeartbeatPolling() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = null;
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
            // LÓGICA ATUALIZADA: Timer de registro semanal
            const registrationTimer = $('registrationTimer');
            const dayUTC = now.getUTCDay(); // 0 = Domingo
            const hoursUTC = now.getUTCHours();
            
            if (dayUTC === 0 && hoursUTC < 23) {
                // REGISTRO ABERTO: Contagem regressiva para 23:00 UTC de hoje
                const registrationEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 0, 0));
                const timeLeft = Math.max(0, Math.floor((registrationEnd - now) / 1000));
                registrationTimer.textContent = `Registro fecha em: ${formatTime(timeLeft)}`;
            } else {
                // REGISTRO FECHADO: Contagem regressiva para 00:00 UTC do próximo Domingo
                const daysToSunday = (7 - dayUTC) % 7;
                let nextSunday = new Date(now.getTime());
                nextSunday.setUTCDate(now.getUTCDate() + daysToSunday);
                nextSunday.setUTCHours(0, 0, 0, 0);

                if (dayUTC === 0 && hoursUTC >= 23) { // Se for Domingo depois das 23h
                    nextSunday.setUTCDate(now.getUTCDate() + 7);
                }
                
                const timeToOpen = Math.max(0, Math.floor((nextSunday - now) / 1000));
                registrationTimer.innerHTML = `Registro abre em: <br><span id="timerreg">${formatTime(timeToOpen)}</span>`;
            }
            updateCityRegistrationButtons();
        }

        if (screens.waiting.style.display === 'flex' && currentBattleState && currentBattleState.status === 'registering') {
            // LÓGICA ATUALIZADA: Contagem para o *início* da batalha (23:30 UTC)
            // O end_time é Segunda 00:00 UTC. A batalha dura 30 min.
            const battleEnd = new Date(currentBattleState.instance.end_time);
            const battleStart = new Date(battleEnd.getTime() - 30 * 60 * 1000); // 30 mins antes do fim
            
            const timeLeft = Math.max(0, Math.floor((battleStart - now) / 1000));
            $('waitTimer').textContent = formatTime(timeLeft);
            
            if (timeLeft <= 0) {
                pollBattleState(); 
            }
        }

        if (screens.battle.style.display === 'flex' && currentBattleState && currentBattleState.status === 'active') {
            // LÓGICA ATUALIZADA: Contagem para o *fim* da batalha (30 minutos de duração)
            const battleEnd = new Date(currentBattleState.instance.end_time); // Segunda 00:00 UTC
            const timeLeft = Math.max(0, Math.floor((battleEnd - now) / 1000));
            battle.timer.textContent = formatTime(timeLeft);

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

// NOVO: Função para popular os elementos DOM
function setupDOMElements() {
    screens = {
        loading: $('loadingScreen'),
        citySelection: $('citySelectionScreen'),
        waiting: $('waitingScreen'),
        battle: $('battleActiveScreen'),
        results: $('resultsModal')
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
    
    // Ajusta o volume (como era feito antes)
    if(audio.normal) audio.normal.volume = 0.5;
    if(audio.crit) audio.crit.volume = 0.1;
}


async function init() {
    // CHAMA A NOVA FUNÇÃO AQUI
    setupDOMElements(); 
    
    showScreen('loading'); // Agora 'screens.loading' existe

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
        window.location.href = 'index.html';
        return;
    }
    userId = session.user.id; 

    // Pré-carrega os stats do cache assim que loga
    getOrUpdatePlayerStatsCache().then(() => {
        // console.log("Stats de batalha pré-carregados.");
    });

    createCaptureNotificationUI();
    // REQ 1 (Bug Áudio): Listener genérico
    document.body.addEventListener('click', unlockBattleAudio, { once: true });


    // =================================================================
    // ATRIBUIÇÃO DE EVENTOS
    // (Movido para dentro do init e com checagens para segurança)
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
    
    // Listeners dos Botões de Ação
    if (modals.objectiveAttackBtn) {
        modals.objectiveAttackBtn.onclick = async () => {
            unlockBattleAudio(); // Desbloqueia áudio
            if (!selectedObjective) return;

            // *** CORREÇÃO (REQ 2/3) ***
            // Verifica ataques *antes* de executar
            const { shownAttacks } = computeShownAttacksAndRemaining();
            if (shownAttacks <= 0) {
                showAlert('Sem ações restantes.');
                return; 
            }
            
            checkGarrisonLeaveAndExecute(async () => {
                if (isProcessingBattleAction) return;
                isProcessingBattleAction = true;
                
                modals.objectiveAttackBtn.disabled = true;
                modals.objective.style.display = 'none';
                
                supabase.rpc('attack_battle_objective', { p_objective_id: selectedObjective.id })
                    .then(({ data, error }) => {
                        if (error || !data.success) {
                            showAlert(error ? error.message : data.message);
                            pollBattleState(); // Força re-sincronização
                            return;
                        }

                        const objectiveEl = $(`obj-cp-${selectedObjective.objective_index}`) || $('obj-nexus');
                        if (objectiveEl) {
                            playHitSound(data.is_crit);
                            displayFloatingDamage(objectiveEl, data.damage_dealt, data.is_crit);
                            objectiveEl.classList.add('shake-animation');
                            setTimeout(() => objectiveEl.classList.remove('shake-animation'), 900);
                        }

                        // ***** INÍCIO DA MODIFICAÇÃO *****
                        if(currentBattleState.player_state) {
                            
                            // Substitui a lógica de decremento antiga
                            optimisticUpdatePlayerActions();
                            
                            // Mantém a lógica de guarnição que já existia
                            if(data.garrison_left) { 
                                currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                                currentBattleState.player_garrison = null;
                            }
                            renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);

                        } else {
                            pollBattleState(); 
                        }
                        // ***** FIM DA MODIFICAÇÃO *****
                        
                        const obj = currentBattleState && currentBattleState.objectives ? currentBattleState.objectives.find(o => o.id === selectedObjective.id) : null;
                        if (obj) {
                            if (data.objective_destroyed) {
                                pollHeartbeatState();
                            } else {
                                obj.current_hp = data.objective_new_hp;
                                obj.garrison_hp = data.objective_new_garrison_hp;
                                renderAllObjectives(currentBattleState.objectives);
                            }
                        } else {
                            pollBattleState();
                        }

                    })
                    .finally(() => {
                        // *** CORREÇÃO (REQ 3) ***
                        // Adiciona cooldown para previnir spam
                        setTimeout(() => {
                            isProcessingBattleAction = false;
                            if (selectedObjective && currentBattleState) {
                                const latestObjState = currentBattleState.objectives.find(o => o.id === selectedObjective.id);
                                if (latestObjState && latestObjState.owner_guild_id !== userGuildId) {
                                    modals.objectiveAttackBtn.disabled = false;
                                }
                            }
                        }, 800); // Cooldown de 800ms
                    });
            });
        };
    }

    if (modals.objectiveGarrisonBtn) {
        modals.objectiveGarrisonBtn.onclick = async () => {
            unlockBattleAudio(); // Desbloqueia áudio
            if (!selectedObjective) return;
            
            if (currentBattleState && currentBattleState.player_state && currentBattleState.player_state.last_garrison_leave_at) {
                const lastLeave = new Date(currentBattleState.player_state.last_garrison_leave_at);
                const timeSinceLeave = Math.floor((new Date() - lastLeave) / 1000);
                
                if (timeSinceLeave < 30) {
                    const timeLeft = 30 - timeSinceLeave;
                    showAlert(`Aguarde 30 segundos para guarnecer novamente. (Faltam ${timeLeft}s)`);
                    return;
                }
            }

            // *** CORREÇÃO (REQ 2/3) ***
            // Verifica ataques *antes* de executar
            const { shownAttacks } = computeShownAttacksAndRemaining();
            if (shownAttacks <= 0) {
                showAlert('Sem ações restantes.');
                return; // Impede a ação e o bug de remoção otimista
            }
            
            checkGarrisonLeaveAndExecute(async () => {
                if (isProcessingBattleAction) return;
                isProcessingBattleAction = true;
                modals.objectiveGarrisonBtn.disabled = true;
                modals.objective.style.display = 'none';

                // ***** INÍCIO DA MODIFICAÇÃO *****
                if (currentBattleState) {
                    try {
                        if (!currentBattleState.player_state) currentBattleState.player_state = {};
                        
                        // Lógica de sair da guarnição anterior (está OK)
                        if (currentBattleState.player_garrison && userPlayerStats) {
                            const oldObj = currentBattleState.objectives.find(o => o.id === currentBattleState.player_garrison.objective_id);
                            if (oldObj) {
                                oldObj.garrison_hp = Math.max(0, (oldObj.garrison_hp || 0) - parseInt(userPlayerStats.health, 10));
                            }
                            currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                        }
                        
                        // Substitui a lógica de decremento antiga
                        optimisticUpdatePlayerActions();
                        
                        // Lógica de entrar na nova guarnição (está OK)
                        currentBattleState.player_garrison = {
                            objective_id: selectedObjective.id,
                            started_at: new Date().toISOString()
                        };
                        
                        if (userPlayerStats) {
                            const newObj = currentBattleState.objectives.find(o => o.id === selectedObjective.id);
                            if (newObj) {
                                 newObj.garrison_hp = (newObj.garrison_hp || 0) + parseInt(userPlayerStats.health, 10);
                            }
                        }
                        
                        renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
                        renderAllObjectives(currentBattleState.objectives);
                        
                    } catch (e) {
                        console.warn("Erro atualização otimista (garrison):", e);
                    }
                }
                // ***** FIM DA MODIFICAÇÃO *****

                supabase.rpc('garrison_battle_objective', { p_objective_id: selectedObjective.id })
                    .then(({ data, error }) => {
                        if (error || !data.success) {
                            showAlert(error ? error.message : data.message);
                            setTimeout(pollBattleState, 500); 
                        } else if (data.message) {
                            console.log("Guarnição confirmada:", data.message);
                        }
                    })
                    .catch(err => {
                        console.error("Erro RPC guarnição:", err);
                        showAlert("Erro ao guarnecer. Sincronizando...");
                    })
                    .finally(() => {
                        // *** CORREÇÃO (REQ 3) ***
                        // Adiciona cooldown para previnir spam
                        setTimeout(() => {
                            isProcessingBattleAction = false;
                            modals.objectiveGarrisonBtn.disabled = false;
                        }, 800); // Cooldown de 800ms
                        setTimeout(pollHeartbeatState, 1500); // Sincroniza
                    });
            });
        };
    }
    
    // Listeners dos Objetivos do Mapa
    document.querySelectorAll('.battle-objective').forEach(el => {
        el.addEventListener('click', () => {
            unlockBattleAudio(); // Garante o desbloqueio
            if (!currentBattleState || currentBattleState.status !== 'active' || !currentBattleState.objectives) return;
            const index = parseInt(el.dataset.index, 10);
            const objective = currentBattleState.objectives.find(o => o.objective_index === index);
            if (objective) {
                handleObjectiveClick(objective);
            }
        });
    });

    // Listener do Ranking (Ponto do Erro Original)
    if (battle.rankingBtn) {
        battle.rankingBtn.onclick = () => {
            unlockBattleAudio(); // Garante o desbloqueio
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

    // Listener das Abas do Ranking
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

    // Listeners da Loja
    const showShopBtnEl = $('showShopBtn'); // Pega o elemento da loja (ID do HTML)
    if (showShopBtnEl) {
        showShopBtnEl.onclick = () => {
            unlockBattleAudio(); // Garante o desbloqueio
            openBattleShop();
        };
    }
    if (modals.shopBtnPack1) {
        modals.shopBtnPack1.onclick = () => handleBuyBattleActions(1, 30, 3, modals.shopBtnPack1);
    }
    if (modals.shopBtnPack2) {
        modals.shopBtnPack2.onclick = () => handleBuyBattleActions(2, 75, 5, modals.shopBtnPack2);
    }

    // Inicia os loops de polling
    pollBattleState();
    startGlobalUITimer();
}

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', init);