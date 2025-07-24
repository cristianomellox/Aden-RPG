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

// Variáveis de estado do AFK
let currentAfkPlayerId = null;
let currentAfkStage = 1;
let lastAfkStartTime = null;
let afkTimerInterval = null;
let combatInterval = null;

// NOVOS: Variáveis de HP para combate
let playerMaxHealth = 0;
let playerCurrentHealth = 0;
let monsterMaxHealth = 0;
let monsterCurrentHealth = 0;
let monsterName = "Monstro Selvagem"; // Nome padrão para o monstro

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

    // Inicializa HP do jogador para combate
    playerMaxHealth = player.health;
    playerCurrentHealth = player.health;
    // Não atualiza a barra de HP aqui, pois só é relevante durante o combate
    // Isso será feito quando o combate iniciar
    // As barras de HP serão configuradas para 'display: none' por updateUIVisibility
};

// Função chamada pelo script.js quando as informações do jogador são carregadas
window.onPlayerInfoLoadedForAfk = (player) => {
    currentAfkPlayerId = player.id;
    playerMaxHealth = player.health;
    playerCurrentHealth = player.health;
    // Não atualiza a barra de HP aqui, pois só é relevante durante o combate
    // Isso será feito quando o combate iniciar
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
    if (combatInterval) {
        afkMessage.textContent = "Combate já está em andamento!";
        return;
    }

    afkMessage.textContent = "Iniciando combate PvE...";
    combatLogDiv.innerHTML = ''; // Limpa o log de combate
    combatLogDiv.style.display = 'block'; // Mostra o log de combate

    // Esconde os elementos de recompensa AFK enquanto o combate está ativo
    afkTimeSpan.parentElement.style.display = 'none';
    afkXPGainSpan.parentElement.style.display = 'none';
    afkGoldGainSpan.parentElement.style.display = 'none';
    collectAfkRewardsBtn.style.display = 'none';

    // Busca informações mais recentes do jogador para combate
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

    playerMaxHealth = player.health;
    playerCurrentHealth = player.health;
    const playerAttack = player.attack;
    const playerName = player.name;
    const playerCombatPower = player.combat_power;

    // Simulação de monstro (poderia vir de um banco de dados)
    monsterName = `Goblin do Estágio ${currentAfkStage}`;
    monsterMaxHealth = 50 + (currentAfkStage * 10);
    monsterCurrentHealth = monsterMaxHealth;
    const monsterAttack = 5 + (currentAfkStage * 2);
    const monsterDefense = currentAfkStage; // Monstro também tem defesa

    logCombatMessage(`Um ${monsterName} apareceu!`, 'system');

    // Exibe as barras de HP
    playerHealthDisplay.style.display = 'flex';
    monsterHealthDisplay.style.display = 'flex';
    console.log("HP bars display set to flex."); // DEBUG LOG
    window.updateHealthBar('playerHealthBar', playerCurrentHealth, playerMaxHealth);
    window.updateHealthBar('monsterHealthBar', monsterCurrentHealth, monsterMaxHealth);

    combatInterval = setInterval(() => {
        // Ataque do jogador
        let playerDamage = Math.max(0, playerAttack - monsterDefense); // Dano mínimo de 0
        let playerIsCritical = Math.random() < 0.2; // 20% de chance de crítico
        if (playerIsCritical) {
            playerDamage = Math.floor(playerDamage * 2); // Dano dobrado no crítico, arredondado para evitar floats
        }
        monsterCurrentHealth -= playerDamage;
        logCombatMessage(`${playerName} ataca o ${monsterName} causando ${playerDamage} de dano${playerIsCritical ? ' (CRÍTICO!)' : ''}.`, 'player');
        window.showDamagePopup(playerName, playerDamage, playerIsCritical);
        window.updateHealthBar('monsterHealthBar', monsterCurrentHealth, monsterMaxHealth);


        if (monsterCurrentHealth <= 0) {
            clearInterval(combatInterval);
            combatInterval = null;
            logCombatMessage(`${monsterName} foi derrotado!`, 'system');
            endCombat(true, playerName, playerCombatPower, monsterName);
            return;
        }

        // Ataque do monstro
        let monsterDamage = Math.max(0, monsterAttack - player.defense); // Dano mínimo de 0
        let monsterIsCritical = Math.random() < 0.1; // 10% de chance de crítico para o monstro
        if (monsterIsCritical) {
            monsterDamage = Math.floor(monsterDamage * 1.5); // Monstro causa 1.5x dano crítico, arredondado
        }
        playerCurrentHealth -= monsterDamage;
        logCombatMessage(`${monsterName} ataca ${playerName} causando ${monsterDamage} de dano${monsterIsCritical ? ' (CRÍTICO!)' : ''}.`, 'monster');
        window.showDamagePopup(monsterName, monsterDamage, monsterIsCritical);
        window.updateHealthBar('playerHealthBar', playerCurrentHealth, playerMaxHealth);

        if (playerCurrentHealth <= 0) {
            clearInterval(combatInterval);
            combatInterval = null;
            logCombatMessage(`${playerName} foi derrotado por ${monsterName}.`, 'system');
            endCombat(false, playerName, playerCombatPower, monsterName);
            return;
        }

    }, 1500); // A cada 1.5 segundos
});

function logCombatMessage(message, type = 'normal') {
    const p = document.createElement('p');
    p.textContent = message;
    p.style.marginBottom = '5px';
    p.style.fontSize = '0.85em';
    if (type === 'player') {
        p.style.color = '#0056b3'; // Azul para ações do jogador
    } else if (type === 'monster') {
        p.style.color = '#a00'; // Vermelho para ações do monstro
    } else if (type === 'system') {
        p.style.color = '#555'; // Cinza para mensagens do sistema
        p.style.fontWeight = 'bold';
    }
    combatLogDiv.prepend(p); // Adiciona as mensagens mais recentes no topo
    // Manter o scroll no fundo (opcional, já que está pré-prependendo)
    // combatLogDiv.scrollTop = combatLogDiv.scrollHeight;
}


async function endCombat(playerWon, playerName, playerCombatPower, monsterName) {
    // Esconde as barras de HP
    playerHealthDisplay.style.display = 'none';
    monsterHealthDisplay.style.display = 'none';
    console.log("HP bars display set to none."); // DEBUG LOG
    combatLogDiv.style.display = 'none'; // Esconde o log de combate

    // Reexibe os elementos de recompensa AFK
    afkTimeSpan.parentElement.style.display = 'block';
    afkXPGainSpan.parentElement.style.display = 'block';
    afkGoldGainSpan.parentElement.style.display = 'block';
    collectAfkRewardsBtn.style.display = 'inline-block'; // Ou 'block' dependendo do seu layout


    let title = "";
    let message = "";
    let onConfirm = null;

    if (playerWon) {
        title = "Vitória!";
        const xpGain = 50 + (currentAfkStage * 10);
        const goldGain = 20 + (currentAfkStage * 5);
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
            }
        };

    } else {
        title = "Derrota!";
        message = `Você foi derrotado pelo ${monsterName}.<br>Tente novamente!`;

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
