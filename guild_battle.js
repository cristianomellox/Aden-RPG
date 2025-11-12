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
let heartbeatInterval = null; // NOVO: Substitui o pollInterval
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

// NOVO: Definição dos Itens
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
    resultsRewardMessage: $('resultsRewardMessage'),
    // Os divs de recompensa são criados dinamicamente
    
    // NOVO: Loja da Batalha
    battleShop: $('battleShopModal'),
    battleShopClose: $('battleShopModalClose'),
    battleShopMessage: $('battleShopMessage'),
    shopBtnPack1: $('buyPack1Btn'),
    shopBtnPack2: $('buyPack2Btn')
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
// NOVO: Loja
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
 * NOVO: Atualiza a interface do usuário com os recursos do jogador (e.g., cristais)
 * @param {object} playerStats - O objeto de estatísticas do jogador
 */
const updatePlayerResourcesUI = (playerStats) => {
    if (!playerStats) return;
    
    // ATUALIZA VARIÁVEL GLOBAL (Importante para o restante do JS)
    userPlayerStats = playerStats; 

    // ATUALIZA CRISTAIS (ou outro recurso principal da UI, se houver um elemento dedicado)
    if (playerStats.crystals !== undefined) {
        // Encontre o elemento que exibe os cristais (Adapte o ID 'playerCrystals' se necessário)
        // Por exemplo, se você tem um elemento na UI geral com o ID 'playerCrystalsAmount':
        const crystalsElement = document.getElementById('playerCrystalsAmount'); 
        if(crystalsElement) {
            // Formate o número para exibição, se necessário
            crystalsElement.textContent = Number(playerStats.crystals).toLocaleString('pt-BR'); 
        }
    }
    
    // TODO: Adicione aqui a lógica para atualizar outros recursos
    // como Ouro, Prata, Itens de Inventário, etc., se eles estiverem inclusos no retorno do get_player_battle_stats
};


/**
 * Renderiza a tela de seleção de cidade
 */
function renderCitySelectionScreen(playerRank) {
    const cityGrid = $('cityGrid');
    cityGrid.innerHTML = '';

    const now = new Date();
    const minutes = now.getMinutes();

    const isLeader = playerRank === 'leader' || playerRank === 'co-leader';
    // CORREÇÃO: Altera a lógica de registro para abrir a cada 15 minutos (duração de 5 minutos)
    let registrationOpen = (minutes % 15) < 5;

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
    // CORREÇÃO: Altera a lógica de registro para abrir a cada 15 minutos (duração de 5 minutos)
    let registrationOpen = (minutes % 15) < 5;

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
        battle.map.style.backgroundImage = `url(${city.map_image_url || 'https://aden-rpg.pages.dev/assets/guild_battle.webp'})`;
    }

    // O timer de 1s (startGlobalUITimer) vai atualizar o 'battleTimer'

    // Renderiza os componentes
    renderAllObjectives(state.objectives);
    renderPlayerFooter(state.player_state, state.player_garrison);
    // REQ 1: Popula o modal de ranking em segundo plano
    renderRankingModal(state.instance.registered_guilds, state.player_damage_ranking);
    
    // Atualiza recursos (cristais, etc.) - Embora geralmente redundante no 'active', é seguro
    updatePlayerResourcesUI(state.player_stats);

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

        // NOVO: Na lógica do heartbeat, o obj pode ter 'id' mas não 'base_hp'
        // Devemos usar o dado do 'currentBattleState' que é mais completo
        const fullObj = currentBattleState.objectives.find(o => o.id === obj.id);
        if (!fullObj) return; // Não deveria acontecer se o merge foi feito
        
        // Usa o 'obj' (vindo do heartbeat ou full load) para HP atual
        // e 'fullObj' (do load inicial) para o HP base
        const totalHp = (fullObj.base_hp || 0) + (obj.garrison_hp || 0);
        const currentTotalHp = (obj.current_hp || 0) + (obj.garrison_hp || 0);
        const percent = totalHp > 0 ? (currentTotalHp / totalHp) * 100 : 0;

        const fillEl = $(`obj-hp-fill-${fullObj.objective_index}`);
        const textEl = $(`obj-hp-text-${fullObj.objective_index}`);
        if (fillEl) fillEl.style.width = `${percent}%`;
        if (textEl) textEl.textContent = `${kFormatter(currentTotalHp)} / ${kFormatter(totalHp)}`;

        const garrisonEl = $(`obj-garrison-${fullObj.objective_index}`);

        if (obj.garrison_hp > 0) {
           if (garrisonEl) garrisonEl.textContent = `+${kFormatter(obj.garrison_hp)} HP Guarnição`;
        } else {
           if (garrisonEl) garrisonEl.textContent = '';
        }

        // REQUISIÇÃO 4: Define o nome e a cor do dono
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

/**
 * Renderiza o rodapé de status do jogador
 * *** CORRIGIDO PARA O BUG DA LOJA ***
 */
function renderPlayerFooter(playerState, playerGarrison) {
    if (!playerState) return; 

    const now = new Date();
    const naturalCap = 3; // O limite de regeneração natural é sempre 3
    
    let currentAttacks = playerState.attacks_left;
    let cooldownText = "";

    // 1. Lógica de Cooldown e Regeneração
    // A regeneração SÓ acontece se o total de ações for MENOR que 3.
    if (currentAttacks < naturalCap) {
        if (playerState.last_attack_at) {
            const lastAttack = new Date(playerState.last_attack_at);
            const elapsed = Math.floor((now - lastAttack) / 1000);
            const recovered = Math.floor(elapsed / 60);

            // Calcula o total que o jogador teria com a regeneração
            const recoveredAttacks = Math.min(naturalCap, playerState.attacks_left + recovered);

            if (recoveredAttacks > currentAttacks) {
                // Se a regeneração fez ele ganhar ações, atualiza o display
                // (Não atualizamos o playerState, pois o servidor é a fonte da verdade)
                currentAttacks = recoveredAttacks;
            }

            // Se, mesmo após a regeneração, ele ainda está abaixo do cap, mostra o timer
            if (currentAttacks < naturalCap) {
                const timeToNext = 60 - (elapsed % 60);
                cooldownText = `+1 em ${formatTime(timeToNext)}`;
            }
        } else {
            // Tem menos de 3 ações, mas nenhum registro de ataque (estranho, mas seguro)
            cooldownText = `+1 em 01:00`;
        }
    }
    // Se currentAttacks >= 3, o cooldownText permanece "" (vazio), o que está correto.

    // 2. Renderiza o total de Ações
    // O denominador (limite) é sempre 3 para fins de regeneração.
    battle.playerAttacks.textContent = `Ações: ${currentAttacks} / ${naturalCap}`;
    battle.playerCooldown.textContent = cooldownText;

    // 3. Status de Guarnição (lógica inalterada)
    if (playerGarrison) {
        const objectives = (currentBattleState && currentBattleState.objectives) ? currentBattleState.objectives : null;
        const objective = objectives ? objectives.find(o => o.id === playerGarrison.objective_id) : null;

        let objName = '...';
        if (objective) {
            objName = objective.objective_type === 'nexus' ? 'Nexus' : `Ponto ${objective.objective_index}`;
        } else {
            // NOVO: Se o objetivo não for encontrado (ex: estado de heartbeat incompleto),
            // chama o poll completo para re-sincronizar.
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
 * NOVO: Helper para criar HTML de item de recompensa
 */
function createRewardItemHTML(item, quantity) {
    return `
        <div class="reward-item">
            <img src="${item.img}" alt="${item.name}">
            <span>x${quantity}</span>
        </div>
    `;
}

/**
 * Renderiza a tela de resultados (REQ 5) - MODIFICADA
 */
function renderResultsScreen(instance, playerDamageRanking) {
    // Tenta distribuir recompensas (seguro, pois a função tem trava)
    // ESTA CHAMADA JÁ NÃO É MAIS NECESSÁRIA, POIS O SERVER SIDE FAZ ISSO.
    // MANTIDA COMO FALLBACK, MAS O PAGAMENTO VEM NA RESPOSTA DO get_guild_battle_state.
    supabase.rpc('distribute_battle_rewards', { p_battle_instance_id: instance.id })
        .then(({data, error}) => {
            if (error) {
                console.warn("Erro ao tentar distribuir recompensas:", error.message);
                modals.resultsRewardMessage.textContent = `Falha ao processar recompensas: ${error.message}`;
                modals.resultsRewardMessage.style.color = '#dc3545';
            } else {
                console.log("Distribuição de recompensas verificada:", data.message);
                // A mensagem de sucesso/falha será definida abaixo
            }
        });

    modals.resultCityName.textContent = CITIES.find(c => c.id === instance.city_id)?.name || 'Desconhecida';

    // --- Rankings de Honra e Dano (sem alteração) ---
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
            li.innerHTML = `
                <span>#${index + 1} ${p.name} ${guildName}</span>
                <span>${kFormatter(p.total_damage_dealt)}</span>
            `;
            modals.resultsRankingDamage.appendChild(li);
        });
    }

    // --- NOVO: Lógica de Exibição de Recompensas ---

    // 1. Cria os containers dinamicamente se não existirem
    let guildRewardsEl = $('resultsGuildRewards');
    if (!guildRewardsEl) {
        guildRewardsEl = document.createElement('div');
        guildRewardsEl.id = 'resultsGuildRewards';
        guildRewardsEl.className = 'results-rewards-section';
        modals.resultsRewardMessage.after(guildRewardsEl);
    }
    guildRewardsEl.innerHTML = ''; // Limpa
    guildRewardsEl.style.display = 'block'; // Garante que esteja visível

    let playerRewardsEl = $('resultsPlayerRewards');
    if (!playerRewardsEl) {
        playerRewardsEl = document.createElement('div');
        playerRewardsEl.id = 'resultsPlayerRewards';
        playerRewardsEl.className = 'results-rewards-section';
        guildRewardsEl.after(playerRewardsEl);
    }
    playerRewardsEl.innerHTML = ''; // Limpa
    playerRewardsEl.style.display = 'block'; // Garante que esteja visível

    // 2. Descobre o rank da guilda do jogador
    let myGuildRank = -1;
    let myGuildResult = null;
    if (sortedGuilds.length > 0) {
        myGuildResult = sortedGuilds.find(g => g.guild_id === userGuildId);
        if (myGuildResult) {
            myGuildRank = sortedGuilds.indexOf(myGuildResult) + 1;
        }
    }
    
    // 3. Descobre o rank de dano do jogador
    let myPlayerDamageRank = -1;
    if (playerDamageRanking && playerDamageRanking.length > 0) {
        const myDamageData = playerDamageRanking.find(p => p.player_id === userId);
        if (myDamageData) {
            myPlayerDamageRank = playerDamageRanking.indexOf(myDamageData) + 1;
        }
    }

    // 4. Constrói HTML das Recompensas da Guilda
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
        modals.resultsRewardMessage.style.color = '#00bcd4'; // Ciano para 2º lugar

        guildRewardsHTML += '<div class="results-reward-list">';
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CRYSTALS, 1000);
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.CARD_COMMON, 6); // MODIFICADO
        guildRewardsHTML += createRewardItemHTML(REWARD_ITEMS.REFORGE_STONE, 20); // MODIFICADO
        guildRewardsHTML += '</div>';
        hasGuildRewards = true;

    } else if (myGuildRank === 3 && myGuildResult.honor_points > 0) { // NOVO RANK 3
        modals.resultsRewardMessage.textContent = "Sua guilda ficou em 3º lugar! Recompensas enviadas.";
        modals.resultsRewardMessage.style.color = '#cd7f32'; // Bronze para 3º lugar

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
    if (!hasGuildRewards && myGuildRank > 0) guildRewardsEl.style.display = 'none'; // Oculta se não houver

    // 5. Constrói HTML das Recompensas Individuais (Bônus)
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
        playerRewardsEl.style.display = 'none'; // Oculta se não for Top 1 ou 2
    }
    
    // 6. Exibe a tela
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
            pollBattleState(); // Recarrega o estado (chamada única)
        }, 2000);
    }
}

/**
 * Chamada quando o jogador clica em um objetivo
 */
function handleObjectiveClick(objective) {
    // NOVO: O 'objective' pode ser do heartbeat (leve)
    // Precisamos do objeto completo do 'currentBattleState'
    const fullObjective = currentBattleState.objectives.find(o => o.id === objective.id);
    if (!fullObjective) return; // Não achou o objeto completo
    
    selectedObjective = fullObjective; // Armazena o objeto COMPLETO

    modals.objectiveTitle.textContent = fullObjective.objective_type === 'nexus' ? 'Nexus Central' : `Ponto de Controle ${fullObjective.objective_index}`;

    const isOwned = fullObjective.owner_guild_id === userGuildId;
    // CORREÇÃO 3: Desabilita ataque se for o dono
    modals.objectiveAttackBtn.disabled = isOwned;
    modals.objectiveAttackBtn.style.filter = isOwned ? 'grayscale(1)' : '';
    modals.objectiveAttackBtn.style.opacity = isOwned ? '0.6' : '1';

    modals.objectiveGarrisonBtn.style.display = isOwned ? 'inline-block' : 'none';

    // REQ 3: Modificado para aviso de *qualquer* ação
    const isGarrisonedElsewhere = currentBattleState.player_garrison && 
                                  (!isOwned || currentBattleState.player_garrison.objective_id !== fullObjective.id);
                                  
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
            pollBattleState(); // Força poll completo para re-sincronizar
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

        // *** INÍCIO DA CORREÇÃO (ATAQUE) - Consumo de Ação Otimista ***
        // A ação deve ser consumida IMEDIATAMENTE após o sucesso do RPC,
        // independentemente de o objetivo ter sido destruído ou não.
        if(currentBattleState.player_state) {
             currentBattleState.player_state.attacks_left -= 1;
             currentBattleState.player_state.last_attack_at = new Date().toISOString();
             
             // Se o ataque também removeu o jogador da guarnição
             if(data.garrison_left) { 
                 currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                 currentBattleState.player_garrison = null;
             }
             // Renderiza o rodapé IMEDIATAMENTE com a ação consumida
             renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
        } else {
            pollBattleState(); // Fallback para poll completo se o estado do player estiver incompleto
        }
        // *** FIM DA CORREÇÃO ***
        
        // Atualização otimista (parcial) do objetivo
        const obj = currentBattleState && currentBattleState.objectives ? currentBattleState.objectives.find(o => o.id === selectedObjective.id) : null;
        if (obj) {
            if (data.objective_destroyed) {
                // Se destruiu, o heartbeat poll vai pegar a mudança, mas podemos forçar
                pollHeartbeatState();
            } else {
                // REQUISIÇÃO 2: Atualiza HP localmente
                obj.current_hp = data.objective_new_hp;
                obj.garrison_hp = data.objective_new_garrison_hp; // <<< FIX
                renderAllObjectives(currentBattleState.objectives);
                
                // O rodapé (ações) JÁ FOI ATUALIZADO acima.
            }
        } else {
            pollBattleState(); // Fallback para poll completo
        }
    });
};

/**
 * Jogador clica em "Guarnecer" no modal
 */
modals.objectiveGarrisonBtn.onclick = async () => {
    if (!selectedObjective) return;
    
    // *** CORREÇÃO (REQ 2 da task anterior) ***
    // Verificação robusta de cooldown no frontend, lendo o estado
    if (currentBattleState && currentBattleState.player_state && currentBattleState.player_state.last_garrison_leave_at) {
        const lastLeave = new Date(currentBattleState.player_state.last_garrison_leave_at);
        const timeSinceLeave = Math.floor((new Date() - lastLeave) / 1000);
        
        if (timeSinceLeave < 30) {
            const timeLeft = 30 - timeSinceLeave;
            showAlert(`Aguarde 30 segundos para guarnecer novamente. (Faltam ${timeLeft}s)`);
            return; // Impede a ação
        }
    }
    
    // Verificação antiga (mantida como fallback, caso a UI demore a atualizar)
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
                    // *** CORREÇÃO: Define o tempo de saída AQUI para a UI ***
                    currentBattleState.player_state.last_garrison_leave_at = new Date().toISOString();
                }
                
                // *** INÍCIO DA CORREÇÃO (GUARNIÇÃO) - Consumo de Ação Otimista ***
                // Consome a ação otimistamente AQUI
                currentBattleState.player_state.attacks_left -= 1;
                // Inicia o timer de recarga se estava no máximo (ou null)
                if (currentBattleState.player_state.last_attack_at === null || currentBattleState.player_state.attacks_left === 2) {
                    currentBattleState.player_state.last_attack_at = new Date().toISOString();
                }
                // *** FIM DA CORREÇÃO ***
                
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
                    setTimeout(pollBattleState, 500); // Poll completo
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
                // Sincroniza o estado (leve) do servidor após curto intervalo
                setTimeout(pollHeartbeatState, 1500);
            });
    });
};


// NOVO: Abre a loja da Batalha
function openBattleShop() {
    if (!currentBattleState || !currentBattleState.player_state) {
        showAlert("Não foi possível carregar o estado do jogador.");
        return;
    }

    const playerState = currentBattleState.player_state;
    modals.battleShopMessage.textContent = "";

    // Verifica o Pacote 1 (3 Ações)
    if (playerState.bought_action_pack_1) {
        modals.shopBtnPack1.disabled = true;
        modals.shopBtnPack1.textContent = "Comprado";
    } else {
        modals.shopBtnPack1.disabled = false;
        modals.shopBtnPack1.textContent = "Comprar";
    }

    // Verifica o Pacote 2 (5 Ações)
    if (playerState.bought_action_pack_2) {
        modals.shopBtnPack2.disabled = true;
        modals.shopBtnPack2.textContent = "Comprado";
    } else {
        modals.shopBtnPack2.disabled = false;
        modals.shopBtnPack2.textContent = "Comprar";
    }
    
    modals.battleShop.style.display = 'flex';
}

// NOVO: Lida com a compra de ações
// *** CORRIGIDO PARA O BUG DA LOJA ***
async function handleBuyBattleActions(packId, cost, actions, btnEl) {
    btnEl.disabled = true;
    modals.battleShopMessage.textContent = "Processando...";

    const { data, error } = await supabase.rpc('buy_battle_actions', { p_pack_id: packId });

    if (error || !data.success) {
        modals.battleShopMessage.textContent = `Erro: ${error ? error.message : data.message}`;
        modals.battleShopMessage.style.color = '#dc3545';
        // Não re-habilita se a mensagem for "já comprado"
        if (!data.message.includes("já comprou")) {
             btnEl.disabled = false;
        }
        return;
    }

    modals.battleShopMessage.textContent = data.message;
    modals.battleShopMessage.style.color = '#28a745';
    btnEl.textContent = "Comprado";

    // *** CORREÇÃO: Remove a atualização otimista ***
    // Em vez disso, força uma nova busca ao servidor para
    // obter o valor 100% correto e evitar race conditions.
    pollBattleState(); // Poll completo para re-sincronizar o player_state

    // Fecha o modal após o sucesso
    setTimeout(() => {
        modals.battleShop.style.display = 'none';
    }, 1500);
}


// --- Lógica de Polling e Estado ---

/**
 * Função principal de polling, busca o estado no servidor
 * ESTA FUNÇÃO É CHAMADA APENAS EM TRANSIÇÕES DE ESTADO
 */
async function pollBattleState() {
    // Se o poll já estiver agendado, não execute de novo
    // (Isso é um 'debounce' simples para evitar chamadas múltiplas)
    // *** MODIFICADO: Não limpa mais o heartbeat, pois são diferentes ***
    
    const { data, error } = await supabase.rpc('get_guild_battle_state');

    if (error) {
        console.error("Erro ao buscar estado da batalha:", error);
        showAlert("Erro de conexão. Tentando novamente...");
        // Tenta novamente em 5s
        setTimeout(pollBattleState, 5000);
        return;
    }

    // Armazena o estado global
    currentBattleState = data;

    // Atualiza dados globais
    if (data.player_stats) {
        userGuildId = data.player_stats.guild_id;
        userPlayerStats = data.player_stats;
    }
    userRank = data.player_rank;
    
    // CORREÇÃO ESSENCIAL: Atualiza os recursos do jogador APÓS o poll,
    // garantindo que as recompensas pagas no server sejam refletidas na UI
    if (data.player_stats) {
        updatePlayerResourcesUI(data.player_stats);
    }


    // Roteia para a tela correta
    switch(data.status) {
        case 'active':
            // Valida que o payload esteja completo o suficiente para renderizar
            if (!data || !data.instance || !data.objectives) {
                console.warn("Estado da batalha incompleto, aguardando próxima atualização...");
                setTimeout(pollBattleState, 1000); // Tenta de novo
                return;
            }

            // Para o heartbeat poll (caso esteja rodando) antes de carregar
            stopHeartbeatPolling(); 

            if (screens.battle.style.display === 'none' || screens.loading.style.display === 'flex') {
                showScreen('loading');
                setTimeout(() => {
                    try {
                        renderBattleScreen(data); // Carga INICIAL com dados completos
                    } catch (e) {
                        console.error("Erro ao renderizar tela de batalha:", e);
                        setTimeout(pollBattleState, 1000); // Tenta de novo se falhar
                        return;
                    }
                    startHeartbeatPolling(); // Inicia o poll LEVE
                }, 500);
            } else {
                // Já está na batalha: isso é uma re-sincronização completa
                renderBattleScreen(data);
                startHeartbeatPolling(); // Reinicia o poll LEVE
            }
            break;
            
        case 'registering':
            stopHeartbeatPolling(); // Garante que o poll leve pare
            renderWaitingScreen(data.instance);
            // NÃO inicia poll, conforme solicitado. O timer de 1s da UI
            // (startGlobalUITimer) vai chamar o pollBattleState() quando o tempo zerar.
            break;
            
        case 'finished':
            stopHeartbeatPolling(); // Para o poll leve
            renderResultsScreen(data.instance, data.player_damage_ranking);
            
            // *** CORREÇÃO APLICADA AQUI ***
            // Agenda uma verificação (poll lento) para o próximo ciclo de registro.
            // Isso garante que a tela de resultados saia
            // quando a tela 'no_battle' (registro) ficar disponível.
            setTimeout(pollBattleState, 7000); // Verifica a cada 15 segundos
            break;
            
        case 'no_guild':
            stopHeartbeatPolling(); // Para tudo
            showScreen('loading');
            $('loadingScreen').innerHTML = '<h2>Você não está em uma guilda.</h2><p>Junte-se a uma guilda para participar.</p>';
            break;
            
        case 'no_battle':
            stopHeartbeatPolling(); // Para tudo
            renderCitySelectionScreen(data.player_rank);
            // NÃO inicia poll, pois o timer de 1s da UI
            // é suficiente para a tela de registro.
            break;
            
        default:
            stopHeartbeatPolling(); // Para tudo
            showScreen('loading');
            $('loadingScreen').innerHTML = `<h2>Erro</h2><p>${data.message || 'Estado desconhecido.'}</p>`;
    }
}

/**
 * NOVO: Processa o payload leve do heartbeat
 */
function processHeartbeat(data) {
    if (!data) return; // Falha no RPC

    switch(data.status) {
        case 'active':
            // A batalha está ativa, mescla os dados leves
            if (!currentBattleState || !currentBattleState.objectives || !currentBattleState.instance) {
                // O estado completo ainda não carregou, aguarde.
                // Isso pode acontecer se o heartbeat voltar antes do pollBattleState inicial.
                return; 
            }

            // 1. Mescla Objetivos
            data.objectives.forEach(heartbeatObj => {
                const fullObj = currentBattleState.objectives.find(o => o.id === heartbeatObj.id);
                if (fullObj) {
                    // Atualiza apenas os dados dinâmicos
                    fullObj.current_hp = heartbeatObj.current_hp;
                    fullObj.garrison_hp = heartbeatObj.garrison_hp;
                    fullObj.owner_guild_id = heartbeatObj.owner_guild_id;
                }
            });

            // 2. Mescla Pontos de Honra
            data.guild_honor.forEach(heartbeatGuild => {
                const fullGuild = currentBattleState.instance.registered_guilds.find(g => g.guild_id === heartbeatGuild.guild_id);
                if (fullGuild) {
                    fullGuild.honor_points = heartbeatGuild.honor_points;
                }
            });
            
            // 3. Re-renderiza os componentes afetados
            renderAllObjectives(currentBattleState.objectives);
            // O ranking é atualizado em segundo plano, não é crítico
            renderRankingModal(currentBattleState.instance.registered_guilds, currentBattleState.player_damage_ranking);
            break;

        case 'finished':
        case 'no_battle':
        case 'no_guild':
            // A batalha acabou ou deu erro!
            // Para o heartbeat
            stopHeartbeatPolling();
            // Chama o poll COMPLETO para transicionar a tela
            pollBattleState(); 
            break;
    }
}

/**
 * NOVO: Função de polling LEVE
 */
async function pollHeartbeatState() {
    const { data, error } = await supabase.rpc('get_battle_heartbeat');
    
    if (error) {
        console.error("Erro no heartbeat da batalha:", error.message);
        // Não mostra alerta, apenas tenta de novo.
        // O poll completo será chamado se a batalha terminar.
        return;
    }
    
    processHeartbeat(data);
}


function startHeartbeatPolling() {
    stopHeartbeatPolling(); // Limpa qualquer poll anterior
    // Poll a cada 10 segundos
    heartbeatInterval = setInterval(pollHeartbeatState, 10000);
}

function stopHeartbeatPolling() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = null;
}

/**
 * Timer global de UI (Lógica de transição de estado movida para cá)
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
            
            const cycleMin = 15;
            const durationMin = 5;
            
            const minutesInCycle = minutes % cycleMin;
            
            // Verifica se o registro está aberto (minutos 0-4, 15-19, 30-34, 45-49)
            if (minutesInCycle < durationMin) {
                // Período de registro aberto
                const secondsInCycle = minutesInCycle * 60 + seconds;
                const durationSeconds = durationMin * 60;
                const timeLeft = Math.max(0, durationSeconds - secondsInCycle);
                
                registrationTimer.textContent = `Registro fecha em: ${formatTime(timeLeft)}`;

            } else {
                // Período de registro fechado
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
                // TEMPO DE ESPERA ACABOU!
                // Chama o poll completo UMA VEZ para ir para a tela 'active'
                pollBattleState(); 
            }
        }

        // 3. Timer da Tela de Batalha
        if (screens.battle.style.display === 'flex' && currentBattleState && currentBattleState.status === 'active') {
            // Atualiza timer da batalha
            const battleEnd = new Date(currentBattleState.instance.end_time);
            const timeLeft = Math.max(0, Math.floor((battleEnd - now) / 1000));
            battle.timer.textContent = formatTime(timeLeft);

            // Atualiza o rodapé do jogador (cooldown)
            if (currentBattleState.player_state) {
                 renderPlayerFooter(currentBattleState.player_state, currentBattleState.player_garrison);
            }

            if (timeLeft <= 0) {
                // BATALHA ACABOU!
                // Para o heartbeat
                stopHeartbeatPolling();
                // Chama o poll completo UMA VEZ para ir para a tela 'finished'
                pollBattleState(); 
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
    userId = session.user.id; // Define o userId global

    // Adiciona listeners aos objetivos do mapa
    document.querySelectorAll('.battle-objective').forEach(el => {
        el.addEventListener('click', () => {
            if (!currentBattleState || currentBattleState.status !== 'active') return;
            const index = parseInt(el.dataset.index, 10);
            // Proteção: currentBattleState.objectives pode estar ausente momentaneamente
            if (!currentBattleState.objectives) return;
            
            // NOVO: Acha pelo index, pois o 'objective' no array pode ser leve
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
            const targetPaneId = tabId === 'guilds' ? 'rankingTabGuilds' : 'rankingTabDamage';

            document.querySelectorAll('#battleRankingModal .tab-pane').forEach(pane => {
                const isActive = pane.id === targetPaneId;
                
                // Garante visibilidade
                pane.style.display = isActive ? 'block' : 'none';
                pane.classList.toggle('active', isActive);
            });
        });
    });

    // NOVO: Listeners da Loja
    $('showShopBtn').onclick = () => openBattleShop();
    modals.shopBtnPack1.onclick = () => handleBuyBattleActions(1, 30, 3, modals.shopBtnPack1);
    modals.shopBtnPack2.onclick = () => handleBuyBattleActions(2, 75, 5, modals.shopBtnPack2);


    // Inicia o primeiro poll (completo)
    pollBattleState();

    // Inicia o timer global da UI
    startGlobalUITimer();
}

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', init);