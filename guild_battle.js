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
let pollInterval = null;
let uiTimerInterval = null;
let selectedObjective = null;

// REQ 1: Variáveis para o modal de registro
let cityToRegister = null;

// REQ 3: Variável para o callback de confirmação
let pendingGarrisonLeaveAction = null;

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

// --- Elementos DOM ---
const $ = (selector) => document.getElementById(selector);

const screens = {
    loading: $('loadingScreen'),
    citySelection: $('citySelectionScreen'),
    waiting: $('waitingScreen'),
    battle: $('battleActiveScreen'),
    results: $('resultsModal') // REQ 5: Alterado para o modal
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

    // REQ 1
    ranking: $('battleRankingModal'),
    rankingClose: $('rankingModalClose'),
    rankingTabGuilds: $('rankingTabGuilds'),
    rankingTabDamage: $('rankingTabDamage'),
    guildRankingList: $('guildRankingList'),
    playerDamageList: $('playerDamageList'),

    // REQ 1: Registro
    cityRegister: $('cityRegisterConfirmModal'),
    cityRegisterClose: $('cityRegisterModalClose'),
    cityRegisterTitle: $('cityRegisterModalTitle'),
    cityRegisterCityName: $('cityRegisterModalCityName'),
    cityRegisterGuildList: $('cityRegisterModalGuildList'),
    cityRegisterMessage: $('cityRegisterModalMessage'),
    cityRegisterCancelBtn: $('cityRegisterModalCancelBtn'),
    cityRegisterConfirmBtn: $('cityRegisterModalConfirmBtn'),
    
    // REQ 3: Saída de Guarnição
    garrisonLeave: $('garrisonLeaveConfirmModal'),
    garrisonLeaveClose: $('garrisonLeaveModalClose'),
    garrisonLeaveMessage: $('garrisonLeaveModalMessage'),
    garrisonLeaveCancelBtn: $('garrisonLeaveModalCancelBtn'),
    garrisonLeaveConfirmBtn: $('garrisonLeaveModalConfirmBtn'),
    
    // REQ 5: Resultados
    results: $('resultsModal'),
    resultsClose: $('resultsModalClose'),
    resultCityName: $('resultCityName'),
    resultsRankingHonor: $('resultsRankingHonor'),
    resultsRankingDamage: $('resultsRankingDamage'),
    resultsRewardMessage: $('resultsRewardMessage')
};

// REQ 3: Áudio
const audio = {
    normal: $('audioNormalHit'),
    crit: $('audioCritHit')
};
if(audio.normal) audio.normal.volume = 0.5;
if(audio.crit) audio.crit.volume = 0.1;

// --- Funções Auxiliares ---

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.style.display = 'none');
    if (screens[screenName]) {
        // REQ 5: Telas de "estado" são flex, modal de resultado não é
        if (screenName === 'results') {
             screens[screenName].style.display = 'flex'; // Modais são flex
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
// REQ 5
if(modals.resultsClose) modals.resultsClose.onclick = () => modals.results.style.display = 'none';

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

// REQ 3: Funções de Efeitos Visuais
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

    // Posicionamento aleatório leve
    const xOffset = Math.random() * 60 - 30; // -30px a +30px
    const yOffset = Math.random() * 40 - 20; // -20px a +20px
    el.style.left = `calc(50% + ${xOffset}px)`;
    el.style.top = `calc(40% + ${yOffset}px)`;

    targetEl.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
}

// --- Funções Principais de UI ---

/**
 * Renderiza a tela de seleção de cidade
 */
function renderCitySelectionScreen(playerRank) {
    const cityGrid = $('cityGrid');
    cityGrid.innerHTML = '';

    const now = new Date();
    const minutes = now.getMinutes();

    const isLeader = playerRank === 'leader' || playerRank === 'co-leader';
    let registrationOpen = minutes < 5;

    // O timer de 1s (startGlobalUITimer) vai atualizar o texto

    CITIES.forEach(city => {
        const btn = document.createElement('button');
        btn.className = 'city-btn';
        btn.textContent = city.name;
        
        const shouldBeEnabled = isLeader && registrationOpen;
        
        if (!shouldBeEnabled) {
            btn.classList.add('disabled');
            btn.disabled = true;
        }
        
        // Estilo inicial de desabilitado
        if (!isLeader || !registrationOpen) {
             btn.style.filter = 'grayscale(1)';
             btn.style.opacity = '0.6';
        }

        // REQ 1: Modificado para chamar o *pré-registro*
        btn.onclick = () => handleCityRegistrationPre(city.id, city.name);
        cityGrid.appendChild(btn);
    });

    showScreen('citySelection');
}

/**
 * REQ do Usuário: Habilita/Desabilita botões de registro
 * dependendo se o período de 5 minutos está aberto.
 */
function updateCityRegistrationButtons() {
    // A função é chamada apenas se a tela de seleção estiver ativa
    if (screens.citySelection.style.display !== 'flex') return;
    
    // userRank já deve estar definido em pollBattleState
    const isLeader = userRank === 'leader' || userRank === 'co-leader';
    
    const now = new Date();
    const minutes = now.getMinutes();
    let registrationOpen = minutes < 5;

    // Atualiza todos os botões no grid
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

/**
 * Renderiza a tela de espera
 */
function renderWaitingScreen(instance) {
    $('waitCityName').textContent = CITIES.find(c => c.id === instance.city_id)?.name || 'Desconhecida';
    
    // REQUISIÇÃO 1: Renderiza a lista de guildas
    const waitListEl = $('waitGuildList');
    waitListEl.innerHTML = '';
    const registeredGuilds = instance.registered_guilds || [];
    
    if (registeredGuilds.length === 0) {
        waitListEl.innerHTML = '<li>Aguardando guildas...</li>';
    } else {
        // Mapeia guild_id para cor (necessário aqui também)
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

/**
 * Renderiza a tela de batalha ativa
 */
function renderBattleScreen(state) {
    currentBattleState = state;
    userPlayerStats = state.player_stats; // Armazena stats para Req 3

    // Define o background
    const city = CITIES.find(c => c.id === state.instance.city_id);
    if (city) {
        battle.map.style.backgroundImage = `url(${city.map_image_url || 'https://aden-rpg.pages.dev/assets/capital.webp'})`;
    }

    // O timer de 1s (startGlobalUITimer) vai atualizar o 'battleTimer'

    // Renderiza os componentes
    renderAllObjectives(state.objectives);
    renderPlayerFooter(state.player_state, state.player_garrison);
    // REQ 1: Popula o modal de ranking em segundo plano
    renderRankingModal(state.instance.registered_guilds, state.player_damage_ranking);

    showScreen('battle');
}

/**
 * REQ 1: Renderiza o conteúdo do modal de ranking
 */
function renderRankingModal(registeredGuilds, playerDamageRanking) {
    if (!registeredGuilds) registeredGuilds = [];
    if (!playerDamageRanking) playerDamageRanking = [];

    // Mapeia guild_id para cor (necessário aqui também)
    const guildColorMap = new Map();
    registeredGuilds.forEach((g, index) => {
        guildColorMap.set(g.guild_id, GUILD_COLORS[index] || 'var(--guild-color-neutral)');
    });

    // Aba 1: Pontos de Honra (Guildas)
    const sortedGuilds = [...registeredGuilds].sort((a, b) => b.honor_points - a.honor_points);
    modals.guildRankingList.innerHTML = '';
    sortedGuilds.forEach((g, index) => {
        const color = guildColorMap.get(g.guild_id);
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${index + 1}. <strong style="color: ${color};">${g.guild_name}</strong></span>
            <span>${g.honor_points} pts</span>
        `;
        modals.guildRankingList.appendChild(li);
    });

    // Aba 2: Dano Causado (Jogadores)
    modals.playerDamageList.innerHTML = '';
    playerDamageRanking.forEach((p, index) => {
        const color = guildColorMap.get(p.guild_id) || 'var(--guild-color-neutral)';
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${index + 1}. <strong style="color: ${color};">${p.name}</strong></span>
            <span>${kFormatter(p.total_damage_dealt)}</span>
        `;
        modals.playerDamageList.appendChild(li);
    });
}


/**
 * Renderiza todos os objetivos no mapa
 */
function renderAllObjectives(objectives) {
    if (!objectives || !currentBattleState || !currentBattleState.instance) return;

    // Recria o mapa de cores se ele não existir (ex: vindo de um poll)
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

        const totalHp = (obj.base_hp || 0) + (obj.garrison_hp || 0);
        const currentTotalHp = (obj.current_hp || 0) + (obj.garrison_hp || 0);
        const percent = totalHp > 0 ? (currentTotalHp / totalHp) * 100 : 0;

        const fillEl = $(`obj-hp-fill-${obj.objective_index}`);
        const textEl = $(`obj-hp-text-${obj.objective_index}`);
        if (fillEl) fillEl.style.width = `${percent}%`;
        if (textEl) textEl.textContent = `${kFormatter(currentTotalHp)} / ${kFormatter(totalHp)}`;

        const garrisonEl = $(`obj-garrison-${obj.objective_index}`);

        if (obj.garrison_hp > 0) {
           if (garrisonEl) garrisonEl.textContent = `+${kFormatter(obj.garrison_hp)} HP Guarnição`;
        } else {
           if (garrisonEl) garrisonEl.textContent = '';
        }

        // REQUISIÇÃO 4: Define o nome e a cor do dono
        const ownerEl = $(`obj-owner-${obj.objective_index}`);
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

/**
 * Renderiza o rodapé de status do jogador
 */
function renderPlayerFooter(playerState, playerGarrison) {
    if (!playerState) return; // Proteção caso o estado ainda não exista

    const now = new Date();
    let attacks = playerState.attacks_left;
    let cooldownText = "";

    if (playerState.last_attack_at) {
        const lastAttack = new Date(playerState.last_attack_at);
        const elapsed = Math.floor((now - lastAttack) / 1000);
        const recovered = Math.floor(elapsed / 60);

        attacks = Math.min(3, attacks + recovered);

        if (attacks < 3) {
            const timeToNext = 60 - (elapsed % 60);
            cooldownText = `+1 em ${formatTime(timeToNext)}`;
        }
    }

    battle.playerAttacks.textContent = `Ações: ${attacks} / 3`;
    battle.playerCooldown.textContent = cooldownText;

    // Status de Guarnição
    if (playerGarrison) {
        // Proteção: currentBattleState.objectives pode não existir momentaneamente
        const objectives = (currentBattleState && currentBattleState.objectives) ? currentBattleState.objectives : null;
        const objective = objectives ? objectives.find(o => o.id === playerGarrison.objective_id) : null;

        let objName = '...';
        if (objective) {
            // Só acessa objective_type se objective existir
            objName = objective.objective_type === 'nexus' ? 'Nexus' : `Ponto ${objective.objective_index}`;
        } else {
            // Se não achar o objetivo localmente, tenta sincronizar rapidamente
            // (não bloqueante, apenas tenta melhorar a consistência da UI)
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

/**
 * Renderiza a tela de resultados (REQ 5)
 */
function renderResultsScreen(instance, playerDamageRanking) {
    // Tenta distribuir recompensas (seguro, pois a função tem trava)
    supabase.rpc('distribute_battle_rewards', { p_battle_instance_id: instance.id })
        .then(({data, error}) => {
            if (error) {
                console.warn("Erro ao tentar distribuir recompensas:", error.message);
                // Mostra erro na UI de resultados
                modals.resultsRewardMessage.textContent = `Falha ao processar recompensas: ${error.message}`;
                modals.resultsRewardMessage.style.color = '#dc3545';
            } else {
                console.log("Distribuição de recompensas verificada:", data.message);
                // Mostra a mensagem do backend (ex: "Recompensas distribuídas" ou "Já distribuídas")
                // A lógica de quem ganhou está abaixo
            }
        });

    modals.resultCityName.textContent = CITIES.find(c => c.id === instance.city_id)?.name || 'Desconhecida';

    // --- Ranking de Honra ---
    modals.resultsRankingHonor.innerHTML = '';
    if (!instance.registered_guilds || instance.registered_guilds.length === 0) {
        modals.resultsRankingHonor.innerHTML = '<li>Nenhum dado de ranking.</li>';
    } else {
        const sortedGuilds = [...instance.registered_guilds].sort((a, b) => b.honor_points - a.honor_points);
        sortedGuilds.forEach((g, index) => {
            const li = document.createElement('li');
            li.textContent = `#${index + 1} ${g.guild_name} - ${g.honor_points} Pontos`;
            modals.resultsRankingHonor.appendChild(li);
        });

        // --- Mensagem de Recompensa ---
        const myGuildResult = sortedGuilds.find(g => g.guild_id === userGuildId);
        if (myGuildResult && myGuildResult.honor_points === sortedGuilds[0].honor_points && sortedGuilds[0].honor_points > 0) {
            modals.resultsRewardMessage.textContent = "Sua guilda venceu! As recompensas (Cristais, Pedras, Baús) foram enviadas aos participantes com dano. Bônus para Top 1 e 2 de dano!";
            modals.resultsRewardMessage.style.color = 'gold';
        } else {
            modals.resultsRewardMessage.textContent = "Sua guilda não venceu desta vez. Mais sorte na próxima!";
            modals.resultsRewardMessage.style.color = '#aaa';
        }
    }

    // --- Ranking de Dano (Top 5) ---
    modals.resultsRankingDamage.innerHTML = '';
    if (!playerDamageRanking || playerDamageRanking.length === 0) {
        modals.resultsRankingDamage.innerHTML = '<li>Nenhum jogador causou dano.</li>';
    } else {
        // Mapeia guild_id para nome para o ranking de dano
        const guildNameMap = new Map();
        (instance.registered_guilds || []).forEach(g => guildNameMap.set(g.guild_id, g.guild_name));
        
        playerDamageRanking.forEach((p, index) => {
            const li = document.createElement('li');
            const guildName = guildNameMap.get(p.guild_id) ? `(${guildNameMap.get(p.guild_id)})` : '';
            li.innerHTML = `
                <span>#${index + 1} ${p.name} ${guildName}</span>
                <span>${kFormatter(p.total_damage_dealt)}</span>
            `;
            modals.resultsRankingDamage.appendChild(li);
        });
    }

    showScreen('results');
}

// --- Lógica de Interação ---

/**
 * REQ 1: Chamada quando o líder clica para registrar (Passo 1: Abrir Modal)
 */
async function handleCityRegistrationPre(cityId, cityName) {
    cityToRegister = { id: cityId, name: cityName }; // Armazena dados
    
    modals.cityRegisterCityName.textContent = cityName;
    modals.cityRegisterMessage.textContent = "Carregando guildas registradas...";
    modals.cityRegisterGuildList.innerHTML = '';
    modals.cityRegisterConfirmBtn.disabled = true;

    modals.cityRegister.style.display = 'flex';

    // Busca a lista de guildas
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

// REQ 1: Listeners do modal de registro
modals.cityRegisterClose.onclick = () => modals.cityRegister.style.display = 'none';
modals.cityRegisterCancelBtn.onclick = () => modals.cityRegister.style.display = 'none';
modals.cityRegisterConfirmBtn.onclick = () => {
    if (cityToRegister) {
        handleCityRegistrationConfirm(cityToRegister.id, cityToRegister.name);
    }
};

/**
 * REQ 1: Chamada quando o líder clica em "Confirmar" no modal
 */
async function handleCityRegistrationConfirm(cityId, cityName) {
    const msgEl = modals.cityRegisterMessage;
    msgEl.textContent = `Registrando em ${cityName}...`;
    modals.cityRegisterConfirmBtn.disabled = true;
    modals.cityRegisterCancelBtn.disabled = true;

    const { data, error } = await supabase.rpc('register_for_guild_battle', { p_city_id: cityId });

    if (error || !data.success) {
        msgEl.textContent = `Erro: ${error ? error.message : data.message}`;
        msgEl.style.color = '#dc3545';
        modals.cityRegisterConfirmBtn.disabled = false; // Permite tentar de novo
        modals.cityRegisterCancelBtn.disabled = false;
    } else {
        msgEl.textContent = data.message;
        msgEl.style.color = '#28a745';
        setTimeout(() => {
            modals.cityRegister.style.display = 'none'; // Fecha o modal
            pollBattleState(); // Recarrega o estado
        }, 2000);
    }
}

/**
 * Chamada quando o jogador clica em um objetivo
 */
function handleObjectiveClick(objective) {
    selectedObjective = objective;

    modals.objectiveTitle.textContent = objective.objective_type === 'nexus' ? 'Nexus Central' : `Ponto de Controle ${objective.objective_index}`;

    const isOwned = objective.owner_guild_id === userGuildId;
    // CORREÇÃO 3: Desabilita ataque se for o dono
    modals.objectiveAttackBtn.disabled = isOwned;
    modals.objectiveAttackBtn.style.filter = isOwned ? 'grayscale(1)' : '';
    modals.objectiveAttackBtn.style.opacity = isOwned ? '0.6' : '1';

    modals.objectiveGarrisonBtn.style.display = isOwned ? 'inline-block' : 'none';

    // REQ 3: Modificado para aviso de *qualquer* ação
    const isGarrisonedElsewhere = currentBattleState.player_garrison && 
                                  (!isOwned || currentBattleState.player_garrison.objective_id !== objective.id);
                                  
    modals.objectiveGarrisonWarning.style.display = isGarrisonedElsewhere ? 'block' : 'none';
    modals.objectiveGarrisonWarning.textContent = "Atenção: Esta ação removerá você da sua guarnição atual.";

    modals.objective.style.display = 'flex';
}

modals.objectiveClose.onclick = () => modals.objective.style.display = 'none';

/**
 * REQ 3: Wrapper de Ação para checar saída de guarnição
 * @param {function} actionCallback - A função a ser executada (atacar ou guarnecer)
 */
function checkGarrisonLeaveAndExecute(actionCallback) {
    // 1. Verifica se o jogador está guarnecendo
    if (!currentBattleState || !currentBattleState.player_garrison || !userPlayerStats) {
        actionCallback(); // Não está guarnecendo, executa direto
        return;
    }
    
    // 2. Encontra o objetivo onde ele está
    const oldObjectiveId = currentBattleState.player_garrison.objective_id;
    const oldObjective = currentBattleState.objectives.find(o => o.id === oldObjectiveId);
    const playerHealth = userPlayerStats.health ? parseInt(userPlayerStats.health, 10) : 0;
    
    if (!oldObjective || playerHealth === 0) {
        actionCallback(); // Não achou o objetivo antigo ou player não tem HP, executa direto
        return;
    }
    
    // 3. Calcula HP
    const currentTotalHp = (oldObjective.current_hp || 0) + (oldObjective.garrison_hp || 0);
    const newTotalHp = currentTotalHp - playerHealth;
    
    // 4. Verifica se o HP ficará negativo
    if (newTotalHp > 0) {
        actionCallback(); // HP ficará positivo, executa direto
        return;
    }
    
    // 5. HP ficará <= 0, mostra modal de confirmação
    pendingGarrisonLeaveAction = actionCallback; // Armazena a ação pendente
    modals.garrisonLeave.style.display = 'flex';
}

// REQ 3: Listeners do modal de saída de guarnição
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
        pendingGarrisonLeaveAction(); // Executa a ação pendente
    }
    pendingGarrisonLeaveAction = null;
};

/**
 * Jogador clica em "Atacar" no modal
 */
modals.objectiveAttackBtn.onclick = async () => {
    if (!selectedObjective) return;
    
    // REQ 3: Envolve a ação no wrapper de verificação
    checkGarrisonLeaveAndExecute(async () => {
        modals.objective.style.display = 'none';
        
        const { data, error } = await supabase.rpc('attack_battle_objective', { p_objective_id: selectedObjective.id });

        if (error || !data.success) {
            showAlert(error ? error.message : data.message);
            pollBattleState(); // Força poll para re-sincronizar
            return;
        }

        // REQUISIÇÃO 3: Efeitos Visuais
        const objectiveEl = $(`obj-cp-${selectedObjective.objective_index}`) || $('obj-nexus');
        if (objectiveEl) {
            playHitSound(data.is_crit);
            displayFloatingDamage(objectiveEl, data.damage_dealt, data.is_crit);
            objectiveEl.classList.add('shake-animation');
            setTimeout(() => objectiveEl.classList.remove('shake-animation'), 900);
        }

        // Atualização otimista (parcial)
        const obj = currentBattleState && currentBattleState.objectives ? currentBattleState.objectives.find(o => o.id === selectedObjective.id) : null;
        if (obj) {
            if (data.objective_destroyed) {
                // Se destruiu, precisamos do estado completo
                pollBattleState();
            } else {
                // REQUISIÇÃO 2: Atualiza HP localmente
                obj.current_hp = data.objective_new_hp;
                obj.garrison_hp = data.objective_new_garrison_hp; // <<< FIX
                renderAllObjectives(currentBattleState.objectives);

                // Atualiza estado do jogador localmente
                if(currentBattleState.player_state) {
                     currentBattleState.player_state.attacks_left -= 1;
                     currentBattleState.player_state.last_attack_at = new Date().toISOString();
                     if(data.garrison_left) {
                         currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                         currentBattleState.player_garrison = null;
                     }
                     renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
                } else {
                    pollBattleState(); // Fallback
                }
            }
        } else {
            pollBattleState(); // Fallback
        }
    });
};

/**
 * Jogador clica em "Guarnecer" no modal
 */
modals.objectiveGarrisonBtn.onclick = async () => {
    if (!selectedObjective) return;
    
    // REQUISIÇÃO 2 (FIX): Checa o cooldown no frontend ANTES da lógica otimista
    if (battle.garrisonStatus.textContent.includes('Guarnição CD:')) {
        showAlert('Aguarde o cooldown de 30 segundos para guarnecer novamente.');
        return;
    }

    // REQ 3: Envolve a ação no wrapper de verificação
    checkGarrisonLeaveAndExecute(async () => {
        modals.objective.style.display = 'none';

        // --- Atualização otimista imediata ---
        if (currentBattleState) {
            try {
                if (!currentBattleState.player_state) currentBattleState.player_state = {};
                
                // REQ 3: Se estava em outra guarnição, remove o HP antigo otimistamente
                if (currentBattleState.player_garrison && userPlayerStats) {
                    const oldObj = currentBattleState.objectives.find(o => o.id === currentBattleState.player_garrison.objective_id);
                    if (oldObj) {
                        oldObj.garrison_hp = Math.max(0, (oldObj.garrison_hp || 0) - parseInt(userPlayerStats.health, 10));
                    }
                }
                
                // Marca player_garrison localmente
                currentBattleState.player_garrison = {
                    objective_id: selectedObjective.id,
                    started_at: new Date().toISOString()
                };
                
                // Adiciona HP novo otimistamente
                if (userPlayerStats) {
                    const newObj = currentBattleState.objectives.find(o => o.id === selectedObjective.id);
                    if (newObj) {
                         newObj.garrison_hp = (newObj.garrison_hp || 0) + parseInt(userPlayerStats.health, 10);
                    }
                }
                
                // Reset de possível cooldown de saída
                currentBattleState.player_state.last_garrison_leave_at = null;
                // Atualiza rodapé e objetivos imediatamente
                renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
                renderAllObjectives(currentBattleState.objectives);
                
            } catch (e) {
                console.warn("Erro durante atualização otimista de guarnição:", e);
            }
        }

        // --- Executa RPC em segundo plano ---
        supabase.rpc('garrison_battle_objective', { p_objective_id: selectedObjective.id })
            .then(({ data, error }) => {
                if (error || !data.success) {
                    // Se backend falhou, mostra alerta e força re-sync
                    showAlert(error ? error.message : data.message);
                    setTimeout(pollBattleState, 500);
                } else if (data.message) {
                    // RPC retornou OK — log para inspeção, não sobrescreve a UI otimista
                    console.log("Guarnição confirmada pelo servidor:", data.message);
                }
            })
            .catch(err => {
                console.error("Erro RPC guarnição:", err);
                showAlert("Erro ao guarnecer. Tentando sincronizar...");
            })
            .finally(() => {
                // Sincroniza o estado real do servidor após curto intervalo
                setTimeout(pollBattleState, 1500);
            });
    });
};

// --- Lógica de Polling e Estado ---

/**
 * Função principal de polling, busca o estado no servidor
 */
async function pollBattleState() {
    const { data, error } = await supabase.rpc('get_guild_battle_state');

    if (error) {
        console.error("Erro ao buscar estado da batalha:", error);
        showAlert("Erro de conexão. Tentando novamente...");
        return;
    }

    // Armazena o estado global
    currentBattleState = data;

    // Atualiza dados globais
    if (data.player_stats) {
        userGuildId = data.player_stats.guild_id;
        userPlayerStats = data.player_stats; // REQ 3: Garante que temos stats
    }
    userRank = data.player_rank;

    // Roteia para a tela correta
    switch(data.status) {
        case 'active':
            // Pausa o polling durante a transição para evitar race conditions
            stopPolling();

            // Valida que o payload esteja completo o suficiente para renderizar
            if (!data || !data.instance || !data.objectives) {
                console.warn("Estado da batalha incompleto, aguardando próxima atualização...");
                // Tenta novamente em alguns instantes sem reiniciar o pollInterval duplicado
                setTimeout(pollBattleState, 3000);
                return;
            }

            if (screens.battle.style.display === 'none' || screens.loading.style.display === 'flex') {
                showScreen('loading');
                // Renderiza a batalha após breve atraso; só reinicia o polling depois que a UI foi atualizada
                setTimeout(() => {
                    try {
                        renderBattleScreen(data);
                    } catch (e) {
                        console.error("Erro ao renderizar tela de batalha:", e);
                        // Se ocorrer erro, força um novo poll para tentar recuperar
                        setTimeout(pollBattleState, 2000);
                        return;
                    }
                    startPolling();
                }, 500);
            } else {
                // Já está na batalha: apenas atualiza
                renderAllObjectives(data.objectives);
                renderPlayerFooter(data.player_state, data.player_garrison);
                // REQ 1: Atualiza o ranking em background
                renderRankingModal(data.instance.registered_guilds, data.player_damage_ranking);
                showScreen('battle');
                startPolling();
            }
            break;
        case 'registering':
            renderWaitingScreen(data.instance);
            startPolling(); // Continua poll para checar início
            break;
        case 'finished':
            stopPolling();
            // REQ 5: Passa o ranking de dano para a tela de resultados
            renderResultsScreen(data.instance, data.player_damage_ranking);
            break;
        case 'no_guild':
            stopPolling();
            showScreen('loading');
            $('loadingScreen').innerHTML = '<h2>Você não está em uma guilda.</h2><p>Junte-se a uma guilda para participar.</p>';
            break;
        case 'no_battle':
            stopPolling();
            renderCitySelectionScreen(data.player_rank);
            break;
        default:
            stopPolling();
            showScreen('loading');
            $('loadingScreen').innerHTML = `<h2>Erro</h2><p>${data.message || 'Estado desconhecido.'}</p>`;
    }
}

function startPolling() {
    stopPolling(); // Limpa qualquer poll anterior
    // Poll a cada 10 segundos
    pollInterval = setInterval(pollBattleState, 10000);
}

function stopPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
}

/**
 * Timer global de UI
 */
function startGlobalUITimer() {
    if (uiTimerInterval) clearInterval(uiTimerInterval);

    uiTimerInterval = setInterval(() => {
        const now = new Date();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();

        // 1. Timer da Tela de Seleção de Cidade
        if (screens.citySelection.style.display === 'flex') {
            const registrationTimer = $('registrationTimer');
            if (minutes < 5) {
                // Período de registro aberto
                const timeLeft = (4 * 60 + 59) - (minutes * 60 + seconds);
                registrationTimer.textContent = `Registro fecha em: ${formatTime(timeLeft)}`;
            } else {
                // Período de registro fechado
                const timeToOpen = (59 * 60 + 59) - (minutes * 60 + seconds);
                registrationTimer.textContent = `Registro abre em: ${formatTime(timeToOpen)}`;
            }
            
            // CORREÇÃO: Habilita/Desabilita botões de registro dinamicamente
            updateCityRegistrationButtons();
        }

        // 2. Timer da Tela de Espera
        if (screens.waiting.style.display === 'flex' && currentBattleState && currentBattleState.status === 'registering') {
            const regEnd = new Date(currentBattleState.instance.registration_end_time);
            const timeLeft = Math.max(0, Math.floor((regEnd - now) / 1000));
            $('waitTimer').textContent = formatTime(timeLeft);

            if (timeLeft <= 0) {
                pollBattleState(); // Força o poll quando o timer acabar
            }
        }

        // 3. Timer da Tela de Batalha
        if (screens.battle.style.display === 'flex' && currentBattleState && currentBattleState.status === 'active') {
            // Atualiza timer da batalha
            const battleEnd = new Date(currentBattleState.instance.end_time);
            const timeLeft = Math.max(0, Math.floor((battleEnd - now) / 1000));
            battle.timer.textContent = formatTime(timeLeft);

            // CORREÇÃO 2: Atualiza o rodapé do jogador (cooldown)
            renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);

            if (timeLeft <= 0) {
                pollBattleState(); // Força o poll
            }
        }

    }, 1000); // Roda a cada 1 segundo
}


/**
 * Função de inicialização
 */
async function init() {
    showScreen('loading');

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
        window.location.href = 'index.html';
        return;
    }
    userId = session.user.id;

    // Adiciona listeners aos objetivos do mapa
    document.querySelectorAll('.battle-objective').forEach(el => {
        el.addEventListener('click', () => {
            if (!currentBattleState || currentBattleState.status !== 'active') return;
            const index = parseInt(el.dataset.index, 10);
            // Proteção: currentBattleState.objectives pode estar ausente momentaneamente
            if (!currentBattleState.objectives) return;
            const objective = currentBattleState.objectives.find(o => o.objective_index === index);
            if (objective) {
                handleObjectiveClick(objective);
            }
        });
    });

    // REQ 1: Listeners do Modal de Ranking
    battle.rankingBtn.onclick = () => {
        modals.ranking.style.display = 'flex';
        
        // ** MELHORIA: Garante o estado inicial ao abrir o modal **
        // Ativa o botão e painel padrão ('guilds' / Pontos de Honra)
        document.querySelectorAll('.ranking-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const defaultTabBtn = modals.ranking.querySelector('.tab-btn[data-tab="guilds"]');
        if (defaultTabBtn) defaultTabBtn.classList.add('active');
        
        document.querySelectorAll('#battleRankingModal .tab-pane').forEach(pane => {
            pane.classList.remove('active');
            pane.style.display = 'none'; // Oculta todos por padrão
        });

        // Exibe o painel de Guildas (Pontos de Honra)
        if (modals.rankingTabGuilds) {
            modals.rankingTabGuilds.classList.add('active');
            modals.rankingTabGuilds.style.display = 'block';
        }
    };
    modals.rankingClose.onclick = () => modals.ranking.style.display = 'none';

    document.querySelectorAll('.ranking-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab; // 'guilds' ou 'damage'
            
            // Alternância de Botões
            document.querySelectorAll('.ranking-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Alternância de Conteúdo (Panes)
            // *** CORREÇÃO CHAVE: Ajusta o case para corresponder aos IDs dos painéis ***
            // const targetIdSuffix = tabId.charAt(0).toUpperCase() + tabId.slice(1);
            // const targetPaneId = `rankingTab${targetIdSuffix}`;
            
            // Simplificado para usar os IDs reais
            const targetPaneId = tabId === 'guilds' ? 'rankingTabGuilds' : 'rankingTabDamage';

            document.querySelectorAll('#battleRankingModal .tab-pane').forEach(pane => {
                const isActive = pane.id === targetPaneId;
                
                // Garante visibilidade
                pane.style.display = isActive ? 'block' : 'none';
                pane.classList.toggle('active', isActive);
            });
        });
    });


    // Inicia o primeiro poll
    pollBattleState();

    // Inicia o timer global da UI
    startGlobalUITimer();
}

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', init);