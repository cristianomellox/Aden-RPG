// --- Configuração do Supabase ---
const SUPABASE_URL = "https://lqzlblvmkuwedcofmgfb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Variáveis de Estado Global ---
let userId = null;
let userGuildId = null;
let userRank = null;
let userPlayerStats = null;

let currentBattleState = null; // Armazena o estado vindo do RPC
let heartbeatInterval = null;
let uiTimerInterval = null;
let selectedObjective = null;

// REQ 1/2: Flag para previnir ações duplicadas
let isProcessingBattleAction = false;

// REQ 3: Polling de Dano
let damagePollInterval = null;
let playerDamageCache = new Map();

// REQ 1: Variáveis para o modal de registro
let cityToRegister = null;

// REQ 3: Variável para o callback de confirmação
let pendingGarrisonLeaveAction = null;

// REQ 6: Notificações de Captura
let captureNotificationQueue = [];
let isDisplayingCaptureNotification = false;
let previousObjectiveState = new Map();

const CITIES = [
    { id: 1, name: 'Capital' }, { id: 2, name: 'Zion' },
    { id: 3, name: 'Elendor' }, { id: 4, name: 'Mitrar' },
    { id: 5, name: 'Tandra' }, { id: 6, name: 'Astrax' },
    { id: 7, name: 'Duratar' }
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

const screens = {
    loading: $('loadingScreen'),
    citySelection: $('citySelectionScreen'),
    waiting: $('waitingScreen'),
    battle: $('battleActiveScreen'),
    results: $('resultsModal')
};

const battle = {
    header: $('battleHeader'),
    timer: $('battleTimer'),
    rankingBtn: $('showRankingBtn'),
    map: $('battleMap'),
    footer: $('battleFooter'),
    playerAttacks: $('player-attacks'),
    playerCooldown: $('player-cooldown'),
    garrisonStatus: $('garrison-status')
};

const modals = {
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
    garrisonLeaveConfirmBtn: $('garrisonLeaveModalConfirmBtn'),
    results: $('resultsModal'),
    resultsClose: $('resultsModalClose'),
    resultCityName: $('resultCityName'),
    resultsRankingHonor: $('resultsRankingHonor'),
    resultsRankingDamage: $('resultsRankingDamage'),
    resultsRewardMessage: $('resultsRewardMessage'),
    battleShop: $('battleShopModal'),
    battleShopClose: $('battleShopModalClose'),
    battleShopMessage: $('battleShopMessage'),
    shopBtnPack1: $('buyPack1Btn'),
    shopBtnPack2: $('buyPack2Btn')
};

// REQ 3 & 6: Áudio
const audio = {
    normal: $('audioNormalHit'),
    crit: $('audioCritHit'),
    // REQ 6: Sons de Captura
    enemy_p1: new Audio('https://aden-rpg.pages.dev/ini_ponto1.mp3'),
    enemy_p2: new Audio('https://aden-rpg.pages.dev/ini_ponto2.mp3'),
    enemy_p3: new Audio('https://aden-rpg.pages.dev/ini_ponto3.mp3'),
    enemy_p4: new Audio('https://aden-rpg.pages.dev/ini_ponto4.mp3'),
    enemy_nexus: new Audio('https://aden-rpg.pages.dev/ini_nexus.mp3'),
    ally_p1: new Audio('https://aden-rpg.pages.dev/ally_ponto1.mp3'),
    ally_p2: new Audio('https://aden-rpg.pages.dev/ally_ponto2.mp3'),
    ally_p3: new Audio('https://aden-rpg.pages.dev/ally_ponto3.mp3'),
    ally_p4: new Audio('https://aden-rpg.pages.dev/ally_ponto4.mp3'),
    ally_nexus: new Audio('https://aden-rpg.pages.dev/ally_nexus.mp3')
};
if(audio.normal) audio.normal.volume = 0.5;
if(audio.crit) audio.crit.volume = 0.1;

// REQ 6: Desbloqueio de Mídia
let isMediaUnlocked = false;
function unlockBattleAudio() {
    if (isMediaUnlocked) return;
    try {
        Object.values(audio).forEach(aud => {
            if (aud && aud.play) {
                aud.volume = 0; // Muta temporariamente
                aud.play().then(() => {
                    aud.pause();
                    // Restaura volumes padrão
                    if (aud === audio.crit) aud.volume = 0.1;
                    else if (aud === audio.normal) aud.volume = 0.5;
                    else aud.volume = 0.7; // Volume padrão para sons de captura
                }).catch(()=>{});
            }
        });
        isMediaUnlocked = true;
    } catch(e) { console.warn("Falha ao desbloquear áudio", e); }
}


// --- Funções Auxiliares ---

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.style.display = 'none');
    if (screens[screenName]) {
        if (screenName === 'results') {
             screens[screenName].style.display = 'flex';
        } else {
             screens[screenName].style.display = 'flex';
        }
    }
}

function showAlert(message) {
    modals.alertMessage.textContent = message;
    modals.alert.style.display = 'flex';
}

modals.alertOk.onclick = () => modals.alert.style.display = 'none';
modals.alertClose.onclick = () => modals.alert.style.display = 'none';
if(modals.resultsClose) modals.resultsClose.onclick = () => modals.results.style.display = 'none';
if(modals.battleShopClose) modals.battleShopClose.onclick = () => modals.battleShop.style.display = 'none';


function formatTime(totalSeconds) {
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(Math.floor(totalSeconds % 60)).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function kFormatter(num) {
    if (Math.abs(num) < 1000) {
        return Math.sign(num)*Math.abs(num);
    }
    return Math.sign(num)*((Math.abs(num)/1000).toFixed(1)) + 'k';
}

function playHitSound(isCrit) {
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

// --- Funções de Notificação (REQ 6) ---

function createCaptureNotificationUI() {
    if ($('battleCaptureNotification')) return;

    const banner = document.createElement('div');
    banner.id = 'battleCaptureNotification'; // ID ÚNICO

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
        /* Keyframes já devem existir do guild_raid.js, mas garantimos aqui */
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

    banner.innerHTML = `<span style="color: yellow;">${data.guildName}</span> acaba de capturar o <span style="color: lightgreen;">${data.objectiveName}</span>!`;
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
    const now = new Date();
    const minutes = now.getMinutes();
    const isLeader = playerRank === 'leader' || playerRank === 'co-leader';
    let registrationOpen = (minutes % 15) < 5;

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
    const now = new Date();
    const minutes = now.getMinutes();
    let registrationOpen = (minutes % 15) < 5;
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

    const city = CITIES.find(c => c.id === state.instance.city_id);
    if (city) {
        battle.map.style.backgroundImage = `url(${city.map_image_url || 'https://aden-rpg.pages.dev/assets/guild_battle.webp'})`;
    }

    // REQ 3: Popula o cache de nomes
    playerDamageCache.clear();
    (state.player_damage_ranking || []).forEach(p => {
        if (p.player_id && p.name) {
            playerDamageCache.set(p.player_id, p.name);
        }
    });

    // REQ 6: Inicializa o estado dos objetivos
    previousObjectiveState.clear();
    (state.objectives || []).forEach(obj => {
        previousObjectiveState.set(obj.id, obj.owner_guild_id);
    });

    renderAllObjectives(state.objectives);
    renderPlayerFooter(state.player_state, state.player_garrison);
    renderRankingModal(state.instance.registered_guilds, state.player_damage_ranking);
    updatePlayerResourcesUI(state.player_stats);
    showScreen('battle');
}

/**
 * REQ 3: Modificado para usar o cache de nomes
 */
function renderRankingModal(registeredGuilds, playerDamageRanking) {
    if (!registeredGuilds) registeredGuilds = [];
    if (!playerDamageRanking) playerDamageRanking = [];

    const guildColorMap = new Map();
    registeredGuilds.forEach((g, index) => {
        guildColorMap.set(g.guild_id, GUILD_COLORS[index] || 'var(--guild-color-neutral)');
    });

    // Aba 1: Pontos de Honra (Guildas)
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

    // Aba 2: Dano Causado (Jogadores)
    modals.playerDamageList.innerHTML = '';
    playerDamageRanking.forEach((p, index) => {
        // Tenta obter o nome do cache
        const playerName = playerDamageCache.get(p.player_id) || p.name || '???';
        // Atualiza o cache se o nome veio no payload (ex: full poll)
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
    if (!objectives || !currentBattleState || !currentBattleState.instance) return;

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
        if (ownerEl) {
            if (obj.owner_guild_id && currentBattleState.guildColorMap) {
                const guild = registeredGuilds.find(g => g.guild_id === obj.owner_guild_id);
                const color = currentBattleState.guildColorMap.get(obj.owner_guild_id) || 'var(--guild-color-neutral)';
                
                ownerEl.textContent = guild ? guild.guild_name : 'Dominado';
                ownerEl.style.color = color;
                el.style.borderColor = color;
                
            } else {
                ownerEl.textContent = 'Não Dominado';
                ownerEl.style.color = 'var(--guild-color-neutral)';
                el.style.borderColor = 'var(--guild-color-neutral)';
            }
        }
    });
}

function renderPlayerFooter(playerState, playerGarrison) {
    if (!playerState) return; 

    const now = new Date();
    const naturalCap = 3;
    let currentAttacks = playerState.attacks_left;
    let cooldownText = "";

    if (currentAttacks < naturalCap) {
        if (playerState.last_attack_at) {
            const lastAttack = new Date(playerState.last_attack_at);
            const elapsed = Math.floor((now - lastAttack) / 1000);
            const recovered = Math.floor(elapsed / 60);
            const recoveredAttacks = Math.min(naturalCap, playerState.attacks_left + recovered);

            if (recoveredAttacks > currentAttacks) {
                currentAttacks = recoveredAttacks;
            }
            if (currentAttacks < naturalCap) {
                const timeToNext = 60 - (elapsed % 60);
                cooldownText = `+1 em ${formatTime(timeToNext)}`;
            }
        } else {
            cooldownText = `+1 em 01:00`;
        }
    }
    
    // REQ 1: Garante que o número nunca seja negativo na UI
    battle.playerAttacks.textContent = `Ações: ${Math.max(0, currentAttacks)} / ${naturalCap}`;
    battle.playerCooldown.textContent = cooldownText;

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
        const timeSinceLeave = Math.floor((now - lastLeave) / 1000);
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
    // REQ 5: Adiciona data
    const titleEl = $('resultCityName');
    titleEl.textContent = CITIES.find(c => c.id === instance.city_id)?.name || 'Desconhecida';
    
    // Verifica se o elemento de data já existe
    let dateEl = $('resultBattleDate');
    if (!dateEl) {
        dateEl = document.createElement('p');
        dateEl.id = 'resultBattleDate';
        dateEl.style.cssText = 'font-size: 0.9em; color: #ccc; margin-top: -10px; margin-bottom: 15px; text-align: center;';
        titleEl.after(dateEl); // Insere logo após o título
    }
    
    // Formata e define a data de término
    const endDate = new Date(instance.end_time);
    dateEl.textContent = endDate.toLocaleString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    // --- Fim REQ 5 ---

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
            // REQ 3: Usa o cache
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
    if (guilds.length === 0) {
        modals.cityRegisterGuildList.innerHTML = '<li>Nenhuma guilda registrada.</li>';
    } else {
        guilds.forEach(g => {
            const li = document.createElement('li');
            li.textContent = g.guild_name || 'Guilda Desconhecida';
            modals.cityRegisterGuildList.appendChild(li);
        });
    }

    if (guilds.length >= 4) {
        modals.cityRegisterMessage.textContent = "Esta cidade já atingiu o limite de 4 guildas.";
        modals.cityRegisterMessage.style.color = '#ffc107';
        modals.cityRegisterConfirmBtn.disabled = true;
    } else {
        modals.cityRegisterMessage.textContent = "";
        modals.cityRegisterConfirmBtn.disabled = false;
    }
}

modals.cityRegisterClose.onclick = () => modals.cityRegister.style.display = 'none';
modals.cityRegisterCancelBtn.onclick = () => modals.cityRegister.style.display = 'none';
modals.cityRegisterConfirmBtn.onclick = () => {
    if (cityToRegister) {
        handleCityRegistrationConfirm(cityToRegister.id, cityToRegister.name);
    }
};

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
    // REQ 1/2: Impede abertura do modal se uma ação estiver em progresso
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

modals.objectiveClose.onclick = () => modals.objective.style.display = 'none';

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

modals.garrisonLeaveClose.onclick = () => {
    pendingGarrisonLeaveAction = null;
    modals.garrisonLeave.style.display = 'none';
};
modals.garrisonLeaveCancelBtn.onclick = () => {
    pendingGarrisonLeaveAction = null;
    modals.garrisonLeave.style.display = 'none';
};
modals.garrisonLeaveConfirmBtn.onclick = () => {
    modals.garrisonLeave.style.display = 'none';
    if (pendingGarrisonLeaveAction) {
        pendingGarrisonLeaveAction();
    }
    pendingGarrisonLeaveAction = null;
};

modals.objectiveAttackBtn.onclick = async () => {
    if (!selectedObjective) return;
    
    checkGarrisonLeaveAndExecute(async () => {
        // REQ 1/2: Trava de Ação
        if (isProcessingBattleAction) return;
        isProcessingBattleAction = true;
        
        modals.objectiveAttackBtn.disabled = true; // Desabilita botão
        modals.objective.style.display = 'none';
        
        supabase.rpc('attack_battle_objective', { p_objective_id: selectedObjective.id })
            .then(({ data, error }) => {
                if (error || !data.success) {
                    showAlert(error ? error.message : data.message);
                    pollBattleState(); // Força poll completo
                    return;
                }

                const objectiveEl = $(`obj-cp-${selectedObjective.objective_index}`) || $('obj-nexus');
                if (objectiveEl) {
                    playHitSound(data.is_crit);
                    displayFloatingDamage(objectiveEl, data.damage_dealt, data.is_crit);
                    objectiveEl.classList.add('shake-animation');
                    setTimeout(() => objectiveEl.classList.remove('shake-animation'), 900);
                }

                // REQ 1: Consumo de Ação Otimista
                if(currentBattleState.player_state) {
                    currentBattleState.player_state.attacks_left = Math.max(0, (currentBattleState.player_state.attacks_left || 0) - 1); // Garante > 0
                    currentBattleState.player_state.last_attack_at = new Date().toISOString();
                    
                    if(data.garrison_left) { 
                        currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                        currentBattleState.player_garrison = null;
                    }
                    renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
                } else {
                    pollBattleState(); 
                }
                
                const obj = currentBattleState && currentBattleState.objectives ? currentBattleState.objectives.find(o => o.id === selectedObjective.id) : null;
                if (obj) {
                    if (data.objective_destroyed) {
                        pollHeartbeatState(); // Puxa o estado leve
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
                // REQ 1/2: Libera a trava
                isProcessingBattleAction = false;
                // Re-habilita o botão APENAS se o objetivo não for da guilda
                if (selectedObjective && currentBattleState) {
                    const latestObjState = currentBattleState.objectives.find(o => o.id === selectedObjective.id);
                    if (latestObjState && latestObjState.owner_guild_id !== userGuildId) {
                         modals.objectiveAttackBtn.disabled = false;
                    }
                }
            });
    });
};

modals.objectiveGarrisonBtn.onclick = async () => {
    if (!selectedObjective) return;
    
    // REQ 2: Verificação robusta de cooldown
    if (currentBattleState && currentBattleState.player_state && currentBattleState.player_state.last_garrison_leave_at) {
        const lastLeave = new Date(currentBattleState.player_state.last_garrison_leave_at);
        const timeSinceLeave = Math.floor((new Date() - lastLeave) / 1000);
        
        if (timeSinceLeave < 30) {
            const timeLeft = 30 - timeSinceLeave;
            showAlert(`Aguarde 30 segundos para guarnecer novamente. (Faltam ${timeLeft}s)`);
            return;
        }
    }
    
    checkGarrisonLeaveAndExecute(async () => {
        // REQ 1/2: Trava de Ação
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
                        oldObj.garrison_hp = Math.max(0, (oldObj.garrison_hp || 0) - parseInt(userPlayerStats.health, 10));
                    }
                    currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                }
                
                // REQ 1: Consumo de Ação Otimista
                currentBattleState.player_state.attacks_left = Math.max(0, (currentBattleState.player_state.attacks_left || 0) - 1); // Garante > 0
                if (currentBattleState.player_state.last_attack_at === null || currentBattleState.player_state.attacks_left === 2) {
                    currentBattleState.player_state.last_attack_at = new Date().toISOString();
                }
                
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
                // REQ 1/2: Libera a trava
                isProcessingBattleAction = false;
                modals.objectiveGarrisonBtn.disabled = false;
                setTimeout(pollHeartbeatState, 1500);
            });
    });
};

function openBattleShop() {
    if (!currentBattleState || !currentBattleState.player_state) {
        showAlert("Não foi possível carregar o estado do jogador.");
        return;
    }
    const playerState = currentBattleState.player_state;
    modals.battleShopMessage.textContent = "";

    if (playerState.bought_action_pack_1) {
        modals.shopBtnPack1.disabled = true;
        modals.shopBtnPack1.textContent = "Comprado";
    } else {
        modals.shopBtnPack1.disabled = false;
        modals.shopBtnPack1.textContent = "Comprar";
    }
    if (playerState.bought_action_pack_2) {
        modals.shopBtnPack2.disabled = true;
        modals.shopBtnPack2.textContent = "Comprado";
    } else {
        modals.shopBtnPack2.disabled = false;
        modals.shopBtnPack2.textContent = "Comprar";
    }
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
    pollBattleState(); // Força poll completo
    setTimeout(() => {
        modals.battleShop.style.display = 'none';
    }, 1500);
}

// --- Lógica de Polling e Estado ---

async function pollBattleState() {
    stopHeartbeatPolling(); // REQ 3: Para polls leves
    stopDamagePolling(); // REQ 3: Para polls de dano
    
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

    // REQ 6: Limpa fila de notificação
    captureNotificationQueue = [];
    isDisplayingCaptureNotification = false;
    const banner = $('battleCaptureNotification');
    if (banner) banner.classList.remove('show');

    // Roteia para a tela correta
    switch(data.status) {
        case 'active':
            if (!data || !data.instance || !data.objectives) {
                console.warn("Estado da batalha incompleto, aguardando...");
                setTimeout(pollBattleState, 1000); 
                return;
            }

            if (screens.battle.style.display === 'none' || screens.loading.style.display === 'flex') {
                showScreen('loading');
                setTimeout(() => {
                    try {
                        renderBattleScreen(data);
                    } catch (e) {
                        console.error("Erro ao renderizar tela de batalha:", e);
                        setTimeout(pollBattleState, 1000);
                        return;
                    }
                    startHeartbeatPolling();
                    startDamagePolling(); // REQ 3: Inicia poll de dano
                }, 500);
            } else {
                renderBattleScreen(data);
                startHeartbeatPolling();
                startDamagePolling(); // REQ 3: Reinicia poll de dano
            }
            break;
            
        case 'registering':
            renderWaitingScreen(data.instance);
            break;
            
        case 'finished':
            // REQ 3: Limpa cache de nomes
            playerDamageCache.clear();
            renderResultsScreen(data.instance, data.player_damage_ranking);
            setTimeout(pollBattleState, 7000);
            break;
            
        case 'no_guild':
            showScreen('loading');
            $('loadingScreen').innerHTML = '<h2>Você não está em uma guilda.</h2><p>Junte-se a uma guilda para participar.</p>';
            break;
            
        case 'no_battle':
            // REQ 3: Limpa cache de nomes
            playerDamageCache.clear();
            renderCitySelectionScreen(data.player_rank);
            break;
            
        default:
            showScreen('loading');
            $('loadingScreen').innerHTML = `<h2>Erro</h2><p>${data.message || 'Estado desconhecido.'}</p>`;
    }
}

/**
 * REQ 6: Lógica de captura movida para cá
 */
function processHeartbeat(data) {
    if (!data) return; 

    switch(data.status) {
        case 'active':
            if (!currentBattleState || !currentBattleState.objectives || !currentBattleState.instance) {
                return; 
            }

            // 1. Mescla Objetivos e checa Capturas (REQ 6)
            data.objectives.forEach(heartbeatObj => {
                const fullObj = currentBattleState.objectives.find(o => o.id === heartbeatObj.id);
                if (fullObj) {
                    const oldOwner = previousObjectiveState.get(heartbeatObj.id);
                    const newOwner = heartbeatObj.owner_guild_id;

                    if (oldOwner !== newOwner && newOwner !== null) {
                        // CAPTURA DETECTADA
                        playCaptureSound(fullObj.objective_type, fullObj.objective_index, newOwner === userGuildId);
                        
                        const newGuild = currentBattleState.instance.registered_guilds.find(g => g.guild_id === newOwner);
                        const guildName = newGuild ? newGuild.guild_name : 'Uma guilda';
                        const objectiveName = (fullObj.objective_type === 'nexus') ? 'Nexus' : `Ponto ${fullObj.objective_index}`;
                        
                        captureNotificationQueue.push({ guildName, objectiveName });
                        processCaptureNotificationQueue();
                    }
                    // Atualiza o estado anterior
                    previousObjectiveState.set(heartbeatObj.id, newOwner);

                    // Atualiza dados dinâmicos
                    fullObj.current_hp = heartbeatObj.current_hp;
                    fullObj.garrison_hp = heartbeatObj.garrison_hp;
                    fullObj.owner_guild_id = heartbeatObj.owner_guild_id;
                }
            });

            // 2. Mescla Pontos de Honra
            if (data.guild_honor) {
                data.guild_honor.forEach(heartbeatGuild => {
                    const fullGuild = currentBattleState.instance.registered_guilds.find(g => g.guild_id === heartbeatGuild.guild_id);
                    if (fullGuild) {
                        fullGuild.honor_points = heartbeatGuild.honor_points;
                    }
                });
            }
            
            // 3. Re-renderiza componentes
            renderAllObjectives(currentBattleState.objectives);
            renderRankingModal(currentBattleState.instance.registered_guilds, currentBattleState.player_damage_ranking);
            break;

        case 'finished':
        case 'no_battle':
        case 'no_guild':
            stopHeartbeatPolling();
            stopDamagePolling(); // REQ 3
            pollBattleState(); 
            break;
    }
}

async function pollHeartbeatState() {
    const { data, error } = await supabase.rpc('get_battle_heartbeat');
    if (error) {
        console.error("Erro no heartbeat:", error.message);
        return;
    }
    processHeartbeat(data);
}

// REQ 3: Nova função de polling de dano
async function pollDamageRanking() {
    if (!currentBattleState || !currentBattleState.instance) return;

    const { data, error } = await supabase.rpc('get_battle_damage_ranking', { 
        p_battle_instance_id: currentBattleState.instance.id 
    });
    
    if (error || !data) {
        console.warn("Erro no poll de dano:", error ? error.message : "Sem dados");
        return;
    }

    // Mapeia o novo ranking leve usando o cache de nomes
    const newRanking = data.map(p => ({
        player_id: p.player_id,
        total_damage_dealt: p.total_damage_dealt,
        guild_id: p.guild_id,
        name: playerDamageCache.get(p.player_id) || '???' // Puxa do cache
    }));

    currentBattleState.player_damage_ranking = newRanking;
    
    // Atualiza apenas o modal de ranking
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

// REQ 3: Funções de controle do poll de dano
function startDamagePolling() {
    stopDamagePolling();
    // Poll a cada 2 minutos (120000 ms)
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
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();

        // 1. Timer da Tela de Seleção de Cidade
        if (screens.citySelection.style.display === 'flex') {
            const registrationTimer = $('registrationTimer');
            const cycleMin = 15;
            const durationMin = 5;
            const minutesInCycle = minutes % cycleMin;
            
            if (minutesInCycle < durationMin) {
                const secondsInCycle = minutesInCycle * 60 + seconds;
                const durationSeconds = durationMin * 60;
                const timeLeft = Math.max(0, durationSeconds - secondsInCycle);
                registrationTimer.textContent = `Registro fecha em: ${formatTime(timeLeft)}`;
            } else {
                const cycleStartSeconds = (minutesInCycle * 60) + seconds;
                const nextCycleStartSeconds = cycleMin * 60;
                const timeToOpen = Math.max(0, nextCycleStartSeconds - cycleStartSeconds);
                registrationTimer.textContent = `Registro abre em: ${formatTime(timeToOpen)}`;
            }
            updateCityRegistrationButtons();
        }

        // 2. Timer da Tela de Espera
        if (screens.waiting.style.display === 'flex' && currentBattleState && currentBattleState.status === 'registering') {
            const regEnd = new Date(currentBattleState.instance.registration_end_time);
            const timeLeft = Math.max(0, Math.floor((regEnd - now) / 1000));
            $('waitTimer').textContent = formatTime(timeLeft);
            if (timeLeft <= 0) {
                pollBattleState(); 
            }
        }

        // 3. Timer da Tela de Batalha
        if (screens.battle.style.display === 'flex' && currentBattleState && currentBattleState.status === 'active') {
            const battleEnd = new Date(currentBattleState.instance.end_time);
            const timeLeft = Math.max(0, Math.floor((battleEnd - now) / 1000));
            battle.timer.textContent = formatTime(timeLeft);

            if (currentBattleState.player_state) {
                 renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
            }
            if (timeLeft <= 0) {
                stopHeartbeatPolling();
                stopDamagePolling(); // REQ 3
                pollBattleState(); 
            }
        }
    }, 1000);
}

async function init() {
    showScreen('loading');

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
        window.location.href = 'index.html';
        return;
    }
    userId = session.user.id; 

    // REQ 6: Cria UI do banner e adiciona listener de áudio
    createCaptureNotificationUI();
    document.addEventListener('click', unlockBattleAudio, { once: true });

    document.querySelectorAll('.battle-objective').forEach(el => {
        el.addEventListener('click', () => {
            if (!currentBattleState || currentBattleState.status !== 'active' || !currentBattleState.objectives) return;
            const index = parseInt(el.dataset.index, 10);
            const objective = currentBattleState.objectives.find(o => o.objective_index === index);
            if (objective) {
                handleObjectiveClick(objective);
            }
        });
    });

    battle.rankingBtn.onclick = () => {
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
    modals.rankingClose.onclick = () => modals.ranking.style.display = 'none';

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

    $('showShopBtn').onclick = () => openBattleShop();
    modals.shopBtnPack1.onclick = () => handleBuyBattleActions(1, 30, 3, modals.shopBtnPack1);
    modals.shopBtnPack2.onclick = () => handleBuyBattleActions(2, 75, 5, modals.shopBtnPack2);

    pollBattleState();
    startGlobalUITimer();
}

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', init);