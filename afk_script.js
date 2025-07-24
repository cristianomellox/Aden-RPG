// afk_script.js - Este script lida com toda a lógica e UI do AFK
// Elementos da UI AFK
const afkStageSpan = document.getElementById('afkStage');
const afkTimeSpan = document.getElementById('afkTime');
const afkXPGainSpan = document.getElementById('afkXPGain');
const afkGoldGainSpan = document.getElementById('afkGoldGain');
const collectAfkRewardsBtn = document.getElementById('collectAfkRewardsBtn');
const startAdventureBtn = document.getElementById('startAdventureBtn');
const afkMessage = document.getElementById('afkMessage');
const combatLogDiv = document.getElementById('combatLog');

// Botão de ataque e contador de ataques
const attackButton = document.getElementById('attackButton');
const attackCountDisplay = document.getElementById('attackCountDisplay');
const remainingAttacksSpan = document.getElementById('remainingAttacks');

// NOVO: Elemento para exibir a porcentagem de HP do monstro
const monsterHealthPercentageSpan = document.getElementById('monsterCurrentHealthDisplay');
const monsterHealthPercentageDiv = document.getElementById('monsterHealthPercentage'); // O div pai


// Variáveis de estado do AFK
let currentAfkPlayerId = null;
let currentAfkStage = 1;
let lastAfkStartTime = null;
let afkTimerInterval = null;

// Variáveis de HP para combate
let playerMaxHealth = 0;
let playerCurrentHealth = 0; // O HP do jogador não será alterado no combate
let playerAttack = 0; // Guardar o ataque do jogador
let playerDefense = 0; // Guardar a defesa do jogador
let playerName = "Aventureiro"; // Guardar o nome do jogador
let playerCombatPower = 0; // Guardar o poder de combate do jogador

let monsterName = "Monstro Selvagem"; // Nome padrão para o monstro
let monsterMaxHealth = 0;
let monsterCurrentHealth = 0;
let monsterDefense = 0; // Defesa do monstro

// Variáveis para o sistema de ataque limitado
let attackCount = 0;
const MAX_ATTACKS = 10;


// Função para inicializar a exibição AFK
window.initAfkDisplay = async () => {
    console.log("AFK: Inicializando exibição AFK...");
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        afkMessage.textContent = "Você precisa estar logado para iniciar uma aventura AFK.";
        console.log("AFK: Usuário não logado.");
        return;
    }
    currentAfkPlayerId = user.id;

    const { data: player, error } = await supabaseClient
        .from('players')
        .select('current_afk_stage, last_afk_start_time, name, health, attack, defense, combat_power')
        .eq('id', user.id)
        .single();

    if (error || !player) {
        console.error('AFK: Erro ao buscar informações do jogador para AFK:', error);
        afkMessage.textContent = "Erro ao carregar informações da aventura.";
        return;
    }

    playerName = player.name;
    playerMaxHealth = player.health;
    playerCurrentHealth = player.health;
    playerAttack = player.attack;
    playerDefense = player.defense;
    playerCombatPower = player.combat_power;
    currentAfkStage = player.current_afk_stage;

    afkStageSpan.textContent = currentAfkStage;
    lastAfkStartTime = player.last_afk_start_time ? new Date(player.last_afk_start_time) : null;
    startAfkTimer();

    startAdventureBtn.style.display = 'inline-block';
    collectAfkRewardsBtn.style.display = 'inline-block';
    afkTimeSpan.parentElement.style.display = 'block';
    afkXPGainSpan.parentElement.style.display = 'block';
    afkGoldGainSpan.parentElement.style.display = 'block';

    // Garante que elementos de combate estejam ocultos inicialmente
    attackButton.style.display = 'none';
    attackCountDisplay.style.display = 'none';
    monsterHealthPercentageDiv.style.display = 'none'; // Esconde a porcentagem de HP do monstro
    combatLogDiv.style.display = 'none';
    console.log("AFK: Display inicial dos elementos de combate configurado para 'none'.");

};

// Função chamada pelo script.js quando as informações do jogador são carregadas
window.onPlayerInfoLoadedForAfk = (player) => {
    console.log("AFK: onPlayerInfoLoadedForAfk chamado.");
    currentAfkPlayerId = player.id;
    playerName = player.name;
    playerMaxHealth = player.health;
    playerCurrentHealth = player.health;
    playerAttack = player.attack;
    playerDefense = player.defense;
    playerCombatPower = player.combat_power;
    currentAfkStage = player.current_afk_stage;

    afkStageSpan.textContent = currentAfkStage;
    lastAfkStartTime = player.last_afk_start_time ? new Date(player.last_afk_start_time) : null;
    startAfkTimer();
};


function updateAfkTimeAndRewards() {
    if (!lastAfkStartTime) {
        afkTimeSpan.textContent = "0 segundos";
        afkXPGainSpan.textContent = "0";
        afkGoldGainSpan.textContent = "0";
        return;
    }

    const now = new Date();
    const elapsedTime = Math.floor((now.getTime() - lastAfkStartTime.getTime()) / 1000);

    const xpPerSecond = 10 * currentAfkStage;
    const goldPerSecond = 5 * currentAfkStage;

    afkTimeSpan.textContent = `${elapsedTime} segundos`;
    afkXPGainSpan.textContent = (xpPerSecond * elapsedTime).toFixed(0);
    afkGoldGainSpan.textContent = (goldPerSecond * elapsedTime).toFixed(0);
}

function startAfkTimer() {
    if (afkTimerInterval) {
        clearInterval(afkTimerInterval);
    }
    afkTimerInterval = setInterval(updateAfkTimeAndRewards, 1000);
}

// Event Listeners
collectAfkRewardsBtn.addEventListener('click', async () => {
    console.log("AFK: Botão Coletar Recompensas clicado.");
    if (!currentAfkPlayerId || !lastAfkStartTime) {
        afkMessage.textContent = "Nenhuma recompensa AFK para coletar.";
        return;
    }

    const now = new Date();
    const elapsedTime = Math.floor((now.getTime() - lastAfkStartTime.getTime()) / 1000);

    const xpPerSecond = 10 * currentAfkStage;
    const goldPerSecond = 5 * currentAfkStage;

    const totalXPGain = Math.floor(xpPerSecond * elapsedTime);
    const totalGoldGain = Math.floor(goldPerSecond * elapsedTime);

    afkMessage.textContent = `Coletando ${totalXPGain} XP e ${totalGoldGain} Ouro...`;

    lastAfkStartTime = new Date();
    await supabaseClient
        .from('players')
        .update({ last_afk_start_time: lastAfkStartTime.toISOString() })
        .eq('id', currentAfkPlayerId);
    updateAfkTimeAndRewards();

    const xpResult = await window.gainXP(currentAfkPlayerId, totalXPGain);
    const goldResult = await window.gainGold(currentAfkPlayerId, totalGoldGain);

    if (xpResult.success && goldResult.success) {
        let message = `Recompensas coletadas: ${totalXPGain} XP, ${totalGoldGain} Ouro.`;
        if (xpResult.leveledUp) {
            message += ` Você subiu para o nível ${xpResult.newLevel}!`;
        }
        afkMessage.textContent = message;
    } else {
        afkMessage.textContent = `Erro ao coletar recompensas: ${xpResult.message || ''} ${goldResult.message || ''}`;
    }
});

// Listener do botão Iniciar Combate PvE
startAdventureBtn.addEventListener('click', startAdventure);

async function startAdventure() {
    console.log("AFK: Função startAdventure iniciada.");
    afkMessage.textContent = "Iniciando combate PvE...";
    combatLogDiv.innerHTML = '';
    combatLogDiv.style.display = 'block';

    // Esconde os elementos de recompensa AFK e o botão "Iniciar Combate"
    afkTimeSpan.parentElement.style.display = 'none';
    afkXPGainSpan.parentElement.style.display = 'none';
    afkGoldGainSpan.parentElement.style.display = 'none';
    collectAfkRewardsBtn.style.display = 'none';
    startAdventureBtn.style.display = 'none';
    console.log("AFK: Elementos AFK ocultados.");

    // Busca informações mais recentes do jogador para combate
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        afkMessage.textContent = "Erro: Usuário não logado para iniciar combate.";
        console.error("AFK: Usuário não logado ao tentar iniciar combate.");
        return;
    }
    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('name, health, attack, defense, combat_power')
        .eq('id', user.id)
        .single();

    if (playerError || !player) {
        console.error('AFK: Erro ao buscar informações do jogador para combate:', playerError);
        afkMessage.textContent = "Erro ao carregar seu perfil para o combate.";
        return;
    }
    playerName = player.name;
    playerMaxHealth = player.health;
    playerCurrentHealth = player.health;
    playerAttack = player.attack;
    playerDefense = player.defense;
    playerCombatPower = player.combat_power;
    console.log("AFK: Dados do jogador carregados para combate.");

    monsterName = `Goblin do Estágio ${currentAfkStage}`;
    monsterMaxHealth = 50 + (currentAfkStage * 10);
    monsterCurrentHealth = monsterMaxHealth;
    monsterDefense = currentAfkStage;
    console.log(`AFK: Monstro gerado: ${monsterName} com ${monsterMaxHealth} HP.`);

    logCombatMessage(`Um ${monsterName} apareceu!`, 'system');

    // Exibe a porcentagem de HP do monstro e o botão de ataque
    if (monsterHealthPercentageDiv) {
        monsterHealthPercentageDiv.style.display = 'block'; // Mostra o div pai
        console.log("AFK: monsterHealthPercentageDiv definido como 'block'.");
    } else {
        console.error("AFK: monsterHealthPercentageDiv não encontrado!");
    }

    if (attackButton) {
        attackButton.style.display = 'flex'; // Certifica que o botão de ataque aparece
        console.log("AFK: attackButton definido como 'flex'.");
    } else {
        console.error("AFK: attackButton não encontrado!");
    }

    if (attackCountDisplay) {
        attackCountDisplay.style.display = 'block';
        console.log("AFK: attackCountDisplay definido como 'block'.");
    } else {
        console.error("AFK: attackCountDisplay não encontrado!");
    }


    updateMonsterHealthDisplay(); // Atualiza a porcentagem inicial

    attackCount = 0;
    remainingAttacksSpan.textContent = MAX_ATTACKS;

    afkMessage.textContent = "Derrote o monstro em 10 ataques!";
}

attackButton.addEventListener('click', () => {
    console.log("AFK: Botão Atacar clicado.");
    if (attackCount >= MAX_ATTACKS || monsterCurrentHealth <= 0) {
        console.log("AFK: Combate já terminou ou ataques esgotados. Ignorando clique.");
        return;
    }

    attackCount++;
    remainingAttacksSpan.textContent = MAX_ATTACKS - attackCount;

    let playerDamage = Math.max(1, playerAttack - monsterDefense);
    let playerIsCritical = Math.random() < 0.2;
    if (playerIsCritical) {
        playerDamage = Math.floor(playerDamage * 2);
    }
    monsterCurrentHealth -= playerDamage;
    if (monsterCurrentHealth < 0) {
        monsterCurrentHealth = 0;
    }

    logCombatMessage(`${playerName} ataca o ${monsterName} causando ${playerDamage} de dano${playerIsCritical ? ' (CRÍTICO!)' : ''}.`, 'player');
    window.showDamagePopup(playerDamage, playerIsCritical);
    updateMonsterHealthDisplay(); // Atualiza a porcentagem de HP do monstro

    if (monsterCurrentHealth <= 0) {
        console.log("AFK: Monstro derrotado! Fim do combate.");
        endCombat(true, playerName, playerCombatPower, monsterName);
        attackButton.style.display = 'none';
        attackCountDisplay.style.display = 'none';
    } else if (attackCount >= MAX_ATTACKS) {
        console.log("AFK: Ataques esgotados. Fim do combate.");
        endCombat(false, playerName, playerCombatPower, monsterName);
        attackButton.style.display = 'none';
        attackCountDisplay.style.display = 'none';
    }
});

// Função para atualizar a exibição da porcentagem de HP do monstro
function updateMonsterHealthDisplay() {
    if (monsterHealthPercentageSpan && monsterMaxHealth > 0) {
        const percentage = ((monsterCurrentHealth / monsterMaxHealth) * 100).toFixed(0);
        monsterHealthPercentageSpan.textContent = `${percentage}%`;
        console.log(`AFK: HP do Monstro atualizado para ${percentage}%.`);
    } else {
        console.error("AFK: Não foi possível atualizar a porcentagem de HP do monstro. Elemento ou MaxHealth inválido.");
    }
}


function logCombatMessage(message, type = 'normal') {
    const p = document.createElement('p');
    p.textContent = message;
    p.style.marginBottom = '5px';
    p.style.fontSize = '0.85em';
    if (type === 'player') {
        p.style.color = '#0056b3';
    } else if (type === 'monster') {
        p.style.color = '#a00';
    } else if (type === 'system') {
        p.style.color = '#555';
        p.style.fontWeight = 'bold';
    }
    combatLogDiv.prepend(p);
}


async function endCombat(playerWon, playerName, playerCombatPower, monsterName) {
    console.log("AFK: Função endCombat iniciada.");
    if (monsterHealthPercentageDiv) monsterHealthPercentageDiv.style.display = 'none';
    combatLogDiv.style.display = 'none';

    afkTimeSpan.parentElement.style.display = 'block';
    afkXPGainSpan.parentElement.style.display = 'block';
    afkGoldGainSpan.parentElement.style.display = 'block';
    collectAfkRewardsBtn.style.display = 'inline-block';
    startAdventureBtn.style.display = 'inline-block';

    let title = "";
    let message = "";
    let onConfirm = null;

    if (playerWon) {
        title = "Vitória!";
        const xpGain = 50 + (currentAfkStage * 10);
        const goldGain = 20 + (currentAfkStage * 5);
        message = `Você derrotou o ${monsterName}!<br>Ganhou ${xpGain} XP e ${goldGain} Ouro.`;

        onConfirm = async () => {
            afkMessage.textContent = "Aplicando recompensas e avançando estágio...";
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user) {
                currentAfkStage++;
                lastAfkStartTime = new Date();
                await supabaseClient
                    .from('players')
                    .update({
                        current_afk_stage: currentAfkStage,
                        last_afk_start_time: lastAfkStartTime.toISOString(),
                        health: playerMaxHealth
                    })
                    .eq('id', user.id);

                afkStageSpan.textContent = currentAfkStage;
                updateAfkTimeAndRewards();

                const xpResult = await window.gainXP(user.id, xpGain);
                const goldResult = await window.gainGold(user.id, goldGain);

                let finalMsg = `Recompensas aplicadas. Você está agora no Estágio ${currentAfkStage}.`;
                if (xpResult.leveledUp) {
                    finalMsg += ` Você subiu para o nível ${xpResult.newLevel}!`;
                }
                afkMessage.textContent = finalMsg;
                window.fetchAndDisplayPlayerInfo();
            }
        };

    } else {
        title = "Derrota!";
        message = `Você não conseguiu derrotar o ${monsterName} em ${MAX_ATTACKS} ataques.<br>Tente novamente!`;

        onConfirm = async () => {
            afkMessage.textContent = "Retornando à base para se curar...";
            const { data: { user } = { user: null } } = await supabaseClient.auth.getUser();
            if (user) {
                await supabaseClient
                    .from('players')
                    .update({ health: playerMaxHealth })
                    .eq('id', user.id);
            }
            afkMessage.textContent = "Pronto para outra tentativa.";
            window.fetchAndDisplayPlayerInfo();
        };
    }

    window.showCombatResultModal(title, message, onConfirm);
}

document.addEventListener('DOMContentLoaded', () => {
    supabaseClient.auth.getUser().then(({ data: { user } }) => {
        if (user) {
            window.initAfkDisplay();
        }
    });
});
