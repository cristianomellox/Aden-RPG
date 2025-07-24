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

// NOVO: Botão de ataque e contador de ataques
const attackButton = document.getElementById('attackButton');
const attackCountDisplay = document.getElementById('attackCountDisplay');
const remainingAttacksSpan = document.getElementById('remainingAttacks');

// Variáveis de estado do AFK
let currentAfkPlayerId = null;
let currentAfkStage = 1;
let lastAfkStartTime = null;
let afkTimerInterval = null;

// NOVOS: Variáveis de HP para combate
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

// NOVO: Variáveis para o sistema de ataque limitado
let attackCount = 0;
const MAX_ATTACKS = 10;

// NOVO: Referências aos elementos de exibição de HP do afkContainer
const playerHealthDisplay = document.getElementById('playerHealthDisplay');
const monsterHealthDisplay = document.getElementById('monsterHealthDisplay');


// Função para inicializar a exibição AFK
window.initAfkDisplay = async () => {
    console.log("Inicializando exibição AFK...");
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        afkMessage.textContent = "Você precisa estar logado para iniciar uma aventura AFK.";
        return;
    }
    currentAfkPlayerId = user.id;

    // Tentar buscar as informações do jogador novamente para ter certeza que estão atualizadas
    const { data: player, error } = await supabaseClient
        .from('players')
        .select('current_afk_stage, last_afk_start_time, name, health, attack, defense, combat_power')
        .eq('id', user.id)
        .single();

    if (error || !player) {
        console.error('Erro ao buscar informações do jogador para AFK:', error);
        afkMessage.textContent = "Erro ao carregar informações da aventura.";
        return;
    }

    // Armazena as informações do jogador
    playerName = player.name;
    playerMaxHealth = player.health;
    playerCurrentHealth = player.health; // O HP do jogador não muda no combate PvE
    playerAttack = player.attack;
    playerDefense = player.defense;
    playerCombatPower = player.combat_power;
    currentAfkStage = player.current_afk_stage; // Garante que o estágio AFK esteja atualizado

    afkStageSpan.textContent = currentAfkStage;
    lastAfkStartTime = player.last_afk_start_time ? new Date(player.last_afk_start_time) : null;
    startAfkTimer(); // Inicia o timer de cálculo de recompensas AFK

    // Exibe ou esconde os botões e mensagens dependendo do estado inicial
    startAdventureBtn.style.display = 'inline-block';
    collectAfkRewardsBtn.style.display = 'inline-block';
    afkTimeSpan.parentElement.style.display = 'block';
    afkXPGainSpan.parentElement.style.display = 'block';
    afkGoldGainSpan.parentElement.style.display = 'block';

    // Garante que elementos de combate estejam ocultos inicialmente
    attackButton.style.display = 'none';
    attackCountDisplay.style.display = 'none';
    playerHealthDisplay.style.display = 'none';
    monsterHealthDisplay.style.display = 'none';
    combatLogDiv.style.display = 'none';

};

// Função chamada pelo script.js quando as informações do jogador são carregadas
window.onPlayerInfoLoadedForAfk = (player) => {
    currentAfkPlayerId = player.id;
    playerName = player.name;
    playerMaxHealth = player.health;
    playerCurrentHealth = player.health; // O HP do jogador não muda no combate PvE
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
    const elapsedTime = Math.floor((now.getTime() - lastAfkStartTime.getTime()) / 1000); // Segundos

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

    // Resetar o tempo AFK imediatamente
    lastAfkStartTime = new Date();
    await supabaseClient
        .from('players')
        .update({ last_afk_start_time: lastAfkStartTime.toISOString() })
        .eq('id', currentAfkPlayerId);
    updateAfkTimeAndRewards(); // Atualiza a exibição para 0

    const xpResult = await window.gainXP(currentAfkPlayerId, totalXPGain);
    const goldResult = await window.gainGold(currentAfkPlayerId, totalGoldGain);

    if (xpResult.success && goldResult.success) {
        let message = `Recompensas coletadas: ${totalXPGain} XP, ${totalGoldGain} Ouro.`;
        if (xpResult.leveledUp) {
            message += ` Você subiu para o nível ${xpResult.newLevel}!`;
        }
        afkMessage.textContent = message;
        // Atualizar informações do jogador na UI principal (opcional, dependendo do design)
        // window.fetchAndDisplayPlayerInfo(); // Isso recarregaria tudo
    } else {
        afkMessage.textContent = `Erro ao coletar recompensas: ${xpResult.message || ''} ${goldResult.message || ''}`;
    }
});


startAdventureBtn.addEventListener('click', async () => {
    afkMessage.textContent = "Iniciando combate PvE...";
    combatLogDiv.innerHTML = ''; // Limpa o log de combate
    combatLogDiv.style.display = 'block'; // Mostra o log de combate

    // Esconde os elementos de recompensa AFK e o botão "Iniciar Combate"
    afkTimeSpan.parentElement.style.display = 'none';
    afkXPGainSpan.parentElement.style.display = 'none';
    afkGoldGainSpan.parentElement.style.display = 'none';
    collectAfkRewardsBtn.style.display = 'none';
    startAdventureBtn.style.display = 'none';

    // Busca informações mais recentes do jogador para combate (apenas se não estiverem já carregadas/atualizadas)
    if (!playerName || playerAttack === 0) { // Uma checagem simples para ver se o jogador está "pronto"
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            afkMessage.textContent = "Erro: Usuário não logado para iniciar combate.";
            return;
        }
        const { data: player, error: playerError } = await supabaseClient
            .from('players')
            .select('name, health, attack, defense, combat_power')
            .eq('id', user.id)
            .single();

        if (playerError || !player) {
            console.error('Erro ao buscar informações do jogador para combate:', playerError);
            afkMessage.textContent = "Erro ao carregar seu perfil para o combate.";
            return;
        }
        playerName = player.name;
        playerMaxHealth = player.health;
        playerCurrentHealth = player.health;
        playerAttack = player.attack;
        playerDefense = player.defense;
        playerCombatPower = player.combat_power;
    }


    // Simulação de monstro (poderia vir de um banco de dados)
    monsterName = `Goblin do Estágio ${currentAfkStage}`;
    monsterMaxHealth = 50 + (currentAfkStage * 10);
    monsterCurrentHealth = monsterMaxHealth;
    monsterDefense = currentAfkStage; // Monstro também tem defesa

    logCombatMessage(`Um ${monsterName} apareceu!`, 'system');

    // Exibe as barras de HP e o botão de ataque
    playerHealthDisplay.style.display = 'flex';
    monsterHealthDisplay.style.display = 'flex';
    attackButton.style.display = 'flex'; // Usar flex para centralizar o texto no botão
    attackCountDisplay.style.display = 'block';

    console.log("HP bars and Attack Button display set to flex/block."); // DEBUG LOG

    window.updateHealthBar('playerHealthBar', playerCurrentHealth, playerMaxHealth);
    window.updateHealthBar('monsterHealthBar', monsterCurrentHealth, monsterMaxHealth);

    // Reinicia o contador de ataques
    attackCount = 0;
    remainingAttacksSpan.textContent = MAX_ATTACKS;

    afkMessage.textContent = "Derrote o monstro em 10 ataques!";
});

// NOVO: Event Listener para o botão de ataque
attackButton.addEventListener('click', () => {
    if (attackCount >= MAX_ATTACKS || monsterCurrentHealth <= 0) {
        // Combate já terminou ou ataques esgotados
        return;
    }

    attackCount++;
    remainingAttacksSpan.textContent = MAX_ATTACKS - attackCount;

    // Ataque do jogador
    let playerDamage = Math.max(1, playerAttack - monsterDefense); // Dano mínimo de 1
    let playerIsCritical = Math.random() < 0.2; // 20% de chance de crítico
    if (playerIsCritical) {
        playerDamage = Math.floor(playerDamage * 2); // Dano dobrado no crítico, arredondado
    }
    monsterCurrentHealth -= playerDamage;
    // Garante que o HP do monstro não seja negativo
    if (monsterCurrentHealth < 0) {
        monsterCurrentHealth = 0;
    }

    logCombatMessage(`${playerName} ataca o ${monsterName} causando ${playerDamage} de dano${playerIsCritical ? ' (CRÍTICO!)' : ''}.`, 'player');
    window.showDamagePopup(playerDamage, playerIsCritical); // Chama showDamagePopup com apenas dano e crítico
    window.updateHealthBar('monsterHealthBar', monsterCurrentHealth, monsterMaxHealth);

    // Verifica as condições de fim de combate
    if (monsterCurrentHealth <= 0) {
        // Vitória!
        endCombat(true, playerName, playerCombatPower, monsterName);
        attackButton.style.display = 'none'; // Esconde o botão de ataque
        attackCountDisplay.style.display = 'none';
    } else if (attackCount >= MAX_ATTACKS) {
        // Derrota! (Ataques esgotados e monstro ainda tem HP)
        endCombat(false, playerName, playerCombatPower, monsterName);
        attackButton.style.display = 'none'; // Esconde o botão de ataque
        attackCountDisplay.style.display = 'none';
    }
});


function logCombatMessage(message, type = 'normal') {
    const p = document.createElement('p');
    p.textContent = message;
    p.style.marginBottom = '5px';
    p.style.fontSize = '0.85em';
    if (type === 'player') {
        p.style.color = '#0056b3'; // Azul para ações do jogador
    } else if (type === 'monster') { // Tipo 'monster' não será usado para ataques, mas pode ser para mensagens gerais
        p.style.color = '#a00'; // Vermelho para ações do monstro
    } else if (type === 'system') {
        p.style.color = '#555'; // Cinza para mensagens do sistema
        p.style.fontWeight = 'bold';
    }
    combatLogDiv.prepend(p); // Adiciona as mensagens mais recentes no topo
}


async function endCombat(playerWon, playerName, playerCombatPower, monsterName) {
    // Esconde as barras de HP
    playerHealthDisplay.style.display = 'none';
    monsterHealthDisplay.style.display = 'none';
    console.log("HP bars display set to none."); // DEBUG LOG
    combatLogDiv.style.display = 'none'; // Esconde o log de combate

    // Reexibe os elementos de recompensa AFK e o botão "Iniciar Combate"
    afkTimeSpan.parentElement.style.display = 'block';
    afkXPGainSpan.parentElement.style.display = 'block';
    afkGoldGainSpan.parentElement.style.display = 'block';
    collectAfkRewardsBtn.style.display = 'inline-block';
    startAdventureBtn.style.display = 'inline-block'; // Reexibe o botão de iniciar aventura

    let title = "";
    let message = "";
    let onConfirm = null;

    if (playerWon) {
        title = "Vitória!";
        const xpGain = 50 + (currentAfkStage * 10);
        const goldGain = 20 + (currentAfakStage * 5); // Use currentAfkStage aqui também
        message = `Você derrotou o ${monsterName}!<br>Ganhou ${xpGain} XP e ${goldGain} Ouro.`;

        // Lógica para avançar estágio e dar recompensas
        onConfirm = async () => {
            afkMessage.textContent = "Aplicando recompensas e avançando estágio...";
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user) {
                // Atualizar estágio e last_afk_start_time para começar o próximo ciclo de AFK do ponto de vitória
                currentAfkStage++;
                lastAfkStartTime = new Date(); // Resetar o tempo AFK
                await supabaseClient
                    .from('players')
                    .update({
                        current_afk_stage: currentAfkStage,
                        last_afk_start_time: lastAfkStartTime.toISOString(),
                        health: playerMaxHealth // Curar jogador ao final do combate
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
                window.fetchAndDisplayPlayerInfo(); // Recarrega informações do jogador para atualizar o HP na tela principal
            }
        };

    } else {
        title = "Derrota!";
        message = `Você não conseguiu derrotar o ${monsterName} em ${MAX_ATTACKS} ataques.<br>Tente novamente!`;

        onConfirm = async () => {
            // Ao perder, não avança estágio e não reseta last_afk_start_time (continua acumulando afk do estágio atual)
            // Apenas cura o jogador para a próxima tentativa
            afkMessage.textContent = "Retornando à base para se curar...";
            const { data: { user } = { user: null } } = await supabaseClient.auth.getUser(); // Safe destructuring
            if (user) {
                await supabaseClient
                    .from('players')
                    .update({ health: playerMaxHealth }) // Curar jogador
                    .eq('id', user.id);
            }
            afkMessage.textContent = "Pronto para outra tentativa.";
            window.fetchAndDisplayPlayerInfo(); // Recarrega informações do jogador para atualizar o HP na tela principal
        };
    }

    // Exibe o modal de resultado de combate
    window.showCombatResultModal(title, message, onConfirm);
}

// Garante que o timer AFK seja reiniciado se o usuário já estiver logado ao carregar o script
document.addEventListener('DOMContentLoaded', () => {
    supabaseClient.auth.getUser().then(({ data: { user } }) => {
        if (user) {
            window.initAfkDisplay();
        }
    });
});
