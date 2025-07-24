// afk_script.js - Este script lida com toda a lógica e UI do AFK

// Elementos da UI AFK
const afkStageSpan = document.getElementById('afkStage');
const afkTimeSpan = document.getElementById('afkTime');
const afkXPGainSpan = document.getElementById('afkXPGain');
const afkGoldGainSpan = document.getElementById('afkGoldGain');
const collectAfkRewardsBtn = document.getElementById('collectAfkRewardsBtn');
const startAdventureBtn = document.getElementById('startAdventureBtn');
const afkMessage = document.getElementById('afkMessage'); // Específico para mensagens AFK
const combatLogDiv = document.getElementById('combatLog'); // Será oculto por padrão agora

// NOVOS: Elementos das barras de HP
const playerHpBarContainer = document.getElementById('playerHpBarContainer');
const playerHpBarFill = document.getElementById('playerHpBarFill');
const playerHpBarValue = document.getElementById('playerHpBarValue');
const monsterHpBarContainer = document.getElementById('monsterHpBarContainer');
const monsterHpBarLabel = document.getElementById('monsterHpBarLabel');
const monsterHpBarFill = document.getElementById('monsterHpBarFill');
const monsterHpBarValue = document.getElementById('monsterHpBarValue');


// Variável para armazenar os dados do jogador mais recentes para o AFK
let currentPlayerData = null;

// Dados dos Monstros por Estágio
const monstersByStage = {
    1: { name: "Slime Iniciante", hp: 50, attack: 5, defense: 2, xpReward: 20, goldReward: 10, fragmentChance: 0.1 },
    2: { name: "Goblin Furioso", hp: 70, attack: 8, defense: 3, xpReward: 30, goldReward: 15, fragmentChance: 0.12 },
    3: { name: "Orc Bruto", hp: 100, attack: 12, defense: 5, xpReward: 50, goldReward: 25, fragmentChance: 0.15 },
    4: { name: "Esqueleto Guerreiro", hp: 120, attack: 15, defense: 7, xpReward: 70, goldReward: 35, fragmentChance: 0.18 },
    5: { name: "Aranha Gigante", hp: 150, attack: 18, defense: 8, xpReward: 90, goldReward: 45, fragmentChance: 0.2 },
    6: { name: "Lobo Alfa", hp: 180, attack: 20, defense: 10, xpReward: 110, goldReward: 55, fragmentChance: 0.22 },
    7: { name: "Gólem de Pedra", hp: 250, attack: 15, defense: 15, xpReward: 130, goldReward: 65, fragmentChance: 0.25 },
    8: { name: "Feiticeiro Negro", hp: 160, attack: 25, defense: 9, xpReward: 150, goldReward: 75, fragmentChance: 0.28 },
    9: { name: "Dragão Filhote", hp: 300, attack: 22, defense: 12, xpReward: 200, goldReward: 100, fragmentChance: 0.3 },
    10: { name: "Cavaleiro Amaldiçoado", hp: 280, attack: 28, defense: 14, xpReward: 250, goldReward: 120, fragmentChance: 0.35 },
    // Adicione mais monstros aqui para estágios mais avançados conforme necessário
};

// Função de atraso para simular turnos
const delay = ms => new Promise(res => setTimeout(res, ms));

// Funções Auxiliares de Log de Combate (mantidas para console.log)
function logCombat(message) {
    // console.log(message); // Descomente para ver o log no console
    // combatLogDiv.appendChild(document.createElement('p')).textContent = message; // Descomente se quiser o log na tela
    // combatLogDiv.scrollTop = combatLogDiv.scrollHeight;
}

function clearCombatLog() {
    combatLogDiv.innerHTML = '';
    combatLogDiv.style.display = 'none'; // Garante que o log esteja oculto
}

// NOVO: Função para atualizar as barras de HP
function updateHpBars(playerCurrent, playerMax, monsterName, monsterCurrent, monsterMax) {
    // Exibe os containers das barras
    playerHpBarContainer.style.display = 'flex';
    monsterHpBarContainer.style.display = 'flex';

    // Atualiza a barra do jogador
    let playerPercent = (playerCurrent / playerMax) * 100;
    playerHpBarFill.style.width = `${Math.max(0, playerPercent)}%`; // Garante que não vá abaixo de 0
    playerHpBarValue.textContent = `${Math.max(0, playerCurrent)} / ${playerMax}`;

    // Atualiza a barra do monstro
    monsterHpBarLabel.textContent = `${monsterName} HP`;
    let monsterPercent = (monsterCurrent / monsterMax) * 100;
    monsterHpBarFill.style.width = `${Math.max(0, monsterPercent)}%`; // Garante que não vá abaixo de 0
    monsterHpBarValue.textContent = `${Math.max(0, monsterCurrent)} / ${monsterMax}`;
}

// NOVO: Função para esconder as barras de HP
function hideHpBars() {
    playerHpBarContainer.style.display = 'none';
    monsterHpBarContainer.style.display = 'none';
}


// Função chamada pelo script principal (script.js) quando os dados do jogador são carregados
window.onPlayerInfoLoadedForAfk = (player) => {
    console.log("AFK Script: onPlayerInfoLoadedForAfk chamado.", player);
    currentPlayerData = player;
    const afkContainer = document.getElementById('afkContainer');
    if (afkContainer && afkContainer.style.display === 'block') {
        calculateAndDisplayAfkRewards();
    }
};

// Função chamada pelo script principal (script.js) quando o menu AFK é exibido
window.initAfkDisplay = () => {
    console.log("AFK Script: initAfkDisplay chamado.");
    afkMessage.textContent = '';
    clearCombatLog();
    hideHpBars(); // Esconde as barras de HP ao entrar na tela AFK
    if (currentPlayerData) {
        calculateAndDisplayAfkRewards();
    } else {
        afkMessage.textContent = 'Carregando dados do jogador para AFK...';
    }
};


async function calculateAndDisplayAfkRewards() {
    console.log("AFK Script: Calculando e exibindo recompensas AFK.");
    afkMessage.textContent = 'Calculando recompensas AFK...';
    if (!currentPlayerData || !currentPlayerData.last_afk_start_time) {
        afkTimeSpan.textContent = 'N/A';
        afkXPGainSpan.textContent = '0';
        afkGoldGainSpan.textContent = '0';
        afkMessage.textContent = 'Nenhum tempo AFK registrado ou dados do jogador insuficientes para cálculo.';
        collectAfkRewardsBtn.disabled = true;
        return;
    }

    const lastAfkStartTime = new Date(currentPlayerData.last_afk_start_time).getTime();
    const currentTime = new Date().getTime();
    const afkDurationMs = currentTime - lastAfkStartTime;

    const afkDurationSeconds = Math.floor(afkDurationMs / 1000);
    const afkDurationMinutes = Math.floor(afkDurationSeconds / 60);

    const maxAfkMinutes = 4 * 60; // 4 horas * 60 minutos/hora = 240 minutos
    const effectiveAfkMinutes = Math.min(afkDurationMinutes, maxAfkMinutes);

    const hours = Math.floor(afkDurationMinutes / 60);
    const minutes = afkDurationMinutes % 60;
    const seconds = afkDurationSeconds % 60;

    let timeString = '';
    if (hours > 0) timeString += `${hours}h `;
    if (minutes > 0) timeString += `${minutes}m `;
    timeString += `${seconds}s`;

    afkTimeSpan.textContent = timeString.trim();

    const currentStageData = monstersByStage[currentPlayerData.current_afk_stage];
    
    let estimatedXPGain = 0;
    let estimatedGoldGain = 0;

    if (currentStageData) {
        const xpPerMinuteBase = currentStageData.xpReward / 5;
        const goldPerMinuteBase = currentStageData.goldReward / 5;

        estimatedXPGain = Math.floor(xpPerMinuteBase * effectiveAfkMinutes);
        estimatedGoldGain = Math.floor(goldPerMinuteBase * effectiveAfkMinutes);
    } else {
        console.warn(`AFK Script: Monstro para o estágio ${currentPlayerData.current_afk_stage} não definido. Recompensas AFK serão 0.`);
    }

    afkStageSpan.textContent = currentPlayerData.current_afk_stage;
    afkXPGainSpan.textContent = estimatedXPGain;
    afkGoldGainSpan.textContent = estimatedGoldGain;

    if (afkDurationMinutes >= maxAfkMinutes) {
        afkMessage.textContent = `Você atingiu o limite de ${maxAfkMinutes / 60} horas de coleta AFK! Colete suas recompensas.`;
    } else {
        afkMessage.textContent = '';
    }

    collectAfkRewardsBtn.disabled = (estimatedXPGain === 0 && estimatedGoldGain === 0);
    collectAfkRewardsBtn.dataset.xp = estimatedXPGain;
    collectAfkRewardsBtn.dataset.gold = estimatedGoldGain;
}

async function collectAfkRewards() {
    console.log("AFK Script: Coletando recompensas AFK.");
    afkMessage.textContent = 'Coletando recompensas...';
    collectAfkRewardsBtn.disabled = true;
    clearCombatLog();
    hideHpBars(); // Esconde as barras de HP ao coletar

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        afkMessage.textContent = "Erro: Usuário não logado.";
        collectAfkRewardsBtn.disabled = false;
        return;
    }

    const xpToGain = parseInt(collectAfkRewardsBtn.dataset.xp || '0', 10);
    const goldToGain = parseInt(collectAfkRewardsBtn.dataset.gold || '0', 10);

    if (xpToGain === 0 && goldToGain === 0) {
        afkMessage.textContent = "Nenhuma recompensa AFK para coletar.";
        collectAfkRewardsBtn.disabled = false;
        return;
    }

    const xpResult = await window.gainXP(user.id, xpToGain);
    const goldResult = await window.gainGold(user.id, goldToGain);

    if (!xpResult.success || !goldResult.success) {
        afkMessage.textContent = `Erro ao coletar recompensas: ${xpResult.message || goldResult.message}`;
        console.error("AFK Script: Erro ao coletar XP/Ouro.", xpResult, goldResult);
    } else {
        let message = `Você coletou ${xpToGain} XP e ${goldToGain} Ouro!`;
        if (xpResult.leveledUp) {
            message += ` Você alcançou o Nível ${xpResult.newLevel} e seus atributos aumentaram!`;
        }
        afkMessage.textContent = message;
        console.log("AFK Script: Recompensas coletadas com sucesso.", message);

        const { error: updateTimeError } = await supabaseClient
            .from('players')
            .update({ last_afk_start_time: new Date().toISOString() })
            .eq('id', user.id);

        if (updateTimeError) {
            console.error('AFK Script: Erro ao resetar last_afk_start_time:', updateTimeError);
            afkMessage.textContent += ` Erro ao resetar tempo AFK: ${updateTimeError.message}`;
        } else {
            console.log("AFK Script: last_afk_start_time resetado.");
            if (typeof window.fetchAndDisplayPlayerInfo === 'function') {
                await window.fetchAndDisplayPlayerInfo();
            }
            currentPlayerData.last_afk_start_time = new Date().toISOString();
            calculateAndDisplayAfkRewards();
        }
    }
    collectAfkRewardsBtn.disabled = false;
}

async function startAdventure() {
    console.log("AFK Script: Iniciar Combate PvE clicado.");
    afkMessage.textContent = "Iniciando Combate PvE...";
    clearCombatLog();
    startAdventureBtn.disabled = true; // Desabilita o botão para evitar cliques múltiplos

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        afkMessage.textContent = "Erro: Usuário não logado.";
        startAdventureBtn.disabled = false;
        console.error("AFK Script: Combate não pode iniciar, usuário não logado.");
        return;
    }
    console.log("AFK Script: Usuário logado, ID:", user.id);

    const { data: player, error: fetchError } = await supabaseClient
        .from('players')
        .select('id, name, level, health, mana, attack, defense, current_afk_stage')
        .eq('id', user.id)
        .single();

    if (fetchError) {
        console.error('AFK Script: Erro ao buscar jogador para combate:', fetchError);
        afkMessage.textContent = `Erro ao iniciar combate: ${fetchError.message}`;
        startAdventureBtn.disabled = false;
        return;
    }
    console.log("AFK Script: Dados do jogador para combate:", player);

    let currentStage = player.current_afk_stage;
    let monster = monstersByStage[currentStage];

    if (!monster) {
        const availableStages = Object.keys(monstersByStage).map(Number).sort((a, b) => a - b);
        if (availableStages.length > 0) {
            monster = monstersByStage[availableStages[availableStages.length - 1]]; // Usa o monstro do último estágio
            afkMessage.textContent = `Você já derrotou todos os monstros conhecidos! Enfrentando o último monstro no estágio ${currentStage}.`;
            logCombat(`Monstro para o estágio ${currentStage} não definido, usando ${monster.name} do estágio ${availableStages[availableStages.length - 1]}.`);
        } else {
            afkMessage.textContent = "Nenhum monstro definido para combate. Por favor, configure mais monstros.";
            console.error("AFK Script: Nenhum monstro definido em monstersByStage.");
            startAdventureBtn.disabled = false;
            return;
        }
    } else {
        console.log(`AFK Script: Monstro para o estágio ${currentStage} encontrado:`, monster.name);
    }

    logCombat(`--- INICIANDO COMBATE: ${player.name} vs. ${monster.name} (Estágio ${currentStage}) ---`);
    logCombat(`Seus atributos: HP ${player.health}, ATK ${player.attack}, DEF ${player.defense}`);
    logCombat(`Atributos do Monstro: HP ${monster.hp}, ATK ${monster.attack}, DEF ${monster.defense}`);

    let playerCurrentHP = player.health;
    const playerMaxHP = player.health; // Para a barra de HP
    let monsterCurrentHP = monster.hp;
    const monsterMaxHP = monster.hp; // Para a barra de HP
    let turn = 0;
    const maxTurns = 50; // Limite para evitar loops infinitos
    const criticalChance = 0.2; // 20% de chance de crítico
    const criticalMultiplier = 1.5; // 50% mais de dano no crítico
    const turnDelay = 1500; // 1.5 segundos entre cada ação de ataque/dano

    afkMessage.textContent = `Combate contra ${monster.name} no estágio ${currentStage} em andamento...`;

    // Inicializa as barras de HP
    updateHpBars(playerCurrentHP, playerMaxHP, monster.name, monsterCurrentHP, monsterMaxHP);

    while (playerCurrentHP > 0 && monsterCurrentHP > 0 && turn < maxTurns) {
        turn++;
        logCombat(`\n--- Turno ${turn} ---`);

        // Ataque do Jogador
        let isPlayerCritical = Math.random() < criticalChance;
        let playerDamage = Math.max(1, player.attack - monster.defense);
        if (isPlayerCritical) {
            playerDamage = Math.floor(playerDamage * criticalMultiplier);
            logCombat(`CRÍTICO! ${player.name} ataca ${monster.name}!`);
        } else {
            logCombat(`${player.name} ataca ${monster.name}!`);
        }
        window.showDamagePopup(player.name, playerDamage, isPlayerCritical); // Mostra popup de dano
        monsterCurrentHP -= playerDamage;
        updateHpBars(playerCurrentHP, playerMaxHP, monster.name, monsterCurrentHP, monsterMaxHP); // Atualiza HP do monstro
        logCombat(`- ${player.name} causa ${playerDamage} de dano a ${monster.name}. HP restante: ${Math.max(0, monsterCurrentHP)}`);
        
        await delay(turnDelay); // Espera para o popup e a barra serem visíveis

        if (monsterCurrentHP <= 0) {
            logCombat(`${monster.name} foi derrotado!`);
            break;
        }

        // Ataque do Monstro
        let isMonsterCritical = Math.random() < criticalChance;
        let monsterDamage = Math.max(1, monster.attack - player.defense);
        if (isMonsterCritical) {
            monsterDamage = Math.floor(monsterDamage * criticalMultiplier);
            logCombat(`CRÍTICO! ${monster.name} ataca ${player.name}!`);
        } else {
            logCombat(`${monster.name} ataca ${player.name}!`);
        }
        window.showDamagePopup(monster.name, monsterDamage, isMonsterCritical); // Mostra popup de dano
        playerCurrentHP -= monsterDamage;
        updateHpBars(playerCurrentHP, playerMaxHP, monster.name, monsterCurrentHP, monsterMaxHP); // Atualiza HP do jogador
        logCombat(`- ${monster.name} causa ${monsterDamage} de dano a ${player.name}. HP restante: ${Math.max(0, playerCurrentHP)}`);

        await delay(turnDelay); // Espera para o popup e a barra serem visíveis

        if (playerCurrentHP <= 0) {
            logCombat(`${player.name} foi derrotado...`);
            break;
        }
    }

    // Limpa a mensagem AFK e o log de combate visível
    afkMessage.textContent = '';
    clearCombatLog();
    hideHpBars(); // Esconde as barras de HP ao final do combate

    let resultTitle = "";
    let resultMessage = "";
    let isVictory = false;
    let xpReward = 0;
    let goldReward = 0;
    let fragmentMessage = "";

    if (playerCurrentHP > 0) {
        isVictory = true;
        resultTitle = "VITÓRIA!";
        resultMessage = `Você derrotou ${monster.name} no Estágio ${currentStage}!`;
        
        xpReward = monster.xpReward;
        goldReward = monster.goldReward;

        const dropChance = Math.random();
        if (dropChance < monster.fragmentChance) {
            fragmentMessage = `<br>🎉 Você encontrou um Fragmento de Equipamento R!`;
        }
        resultMessage += `<br>Recompensas: ${xpReward} XP, ${goldReward} Ouro.${fragmentMessage}`;

    } else {
        resultTitle = "DERROTA!";
        resultMessage = `Você foi derrotado por ${monster.name} no Estágio ${currentStage}.<br>Tente novamente após ficar mais forte!`;
    }

    // Exibe o modal de resultado de combate
    window.showCombatResultModal(resultTitle, resultMessage, async () => {
        // Callback executado quando o jogador clica em "Confirmar"
        if (isVictory) {
            const { error: updateError } = await supabaseClient
                .from('players')
                .update({
                    current_afk_stage: currentStage + 1,
                    last_afk_start_time: new Date().toISOString() // Reseta o timer AFK
                })
                .eq('id', user.id);

            if (updateError) {
                console.error('AFK Script: Erro ao atualizar estágio e tempo AFK após vitória:', updateError);
                afkMessage.textContent = `Vitória, mas houve um erro ao atualizar seu estágio: ${updateError.message}`;
            } else {
                afkMessage.textContent = `Vitória! Você avançou para o Estágio PvE ${currentStage + 1}!`;
                
                // Ganho de XP e Ouro
                const xpResult = await window.gainXP(user.id, xpReward);
                await window.gainGold(user.id, goldReward); // Não precisamos do resultado de gold aqui, o xpResult já é suficiente para o leveledUp

                if (xpResult.leveledUp) {
                    afkMessage.textContent += ` PARABÉNS! Você alcançou o Nível ${xpResult.newLevel}!`;
                }

                if (fragmentMessage) {
                    afkMessage.textContent += ` ${fragmentMessage}`;
                }

                // Re-fetch e display para garantir que o perfil esteja atualizado
                if (typeof window.fetchAndDisplayPlayerInfo === 'function') {
                    await window.fetchAndDisplayPlayerInfo();
                }
                // Atualiza o objeto local (opcional, mas bom para consistência)
                currentPlayerData.current_afk_stage = currentStage + 1;
                currentPlayerData.last_afk_start_time = new Date().toISOString();
            }
        } else {
            // Em caso de derrota, apenas re-fetch os dados para garantir consistência
            if (typeof window.fetchAndDisplayPlayerInfo === 'function') {
                await window.fetchAndDisplayPlayerInfo();
            }
        }
        // Recalcula as recompensas AFK (deve mostrar 0 ou pouco tempo)
        calculateAndDisplayAfkRewards();
        startAdventureBtn.disabled = false; // Reabilita o botão após a confirmação
        setTimeout(() => { afkMessage.textContent = ''; }, 5000); // Limpa a mensagem após um tempo
    });
}


// Listeners de Eventos para afk_script.js
document.addEventListener('DOMContentLoaded', () => {
    console.log("AFK Script: DOMContentLoaded. Adicionando listeners.");
    if (collectAfkRewardsBtn) collectAfkRewardsBtn.addEventListener('click', collectAfkRewards);
    if (startAdventureBtn) {
        startAdventureBtn.addEventListener('click', startAdventure);
        console.log("AFK Script: Listener para startAdventureBtn adicionado.");
    }
});
