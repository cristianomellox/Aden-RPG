// afk_script.js - Este script lida com toda a lógica e UI do AFK

// Elementos da UI AFK
const afkStageSpan = document.getElementById('afkStage');
const afkTimeSpan = document.getElementById('afkTime');
const afkXPGainSpan = document.getElementById('afkXPGain');
const afkGoldGainSpan = document.getElementById('afkGoldGain');
const collectAfkRewardsBtn = document.getElementById('collectAfkRewardsBtn');
const startAdventureBtn = document.getElementById('startAdventureBtn');
const afkMessage = document.getElementById('afkMessage'); // Específico para mensagens AFK
const combatLogDiv = document.getElementById('combatLog');


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

// Funções Auxiliares de Log de Combate
function logCombat(message) {
    const p = document.createElement('p');
    p.textContent = message;
    combatLogDiv.appendChild(p);
    combatLogDiv.scrollTop = combatLogDiv.scrollHeight; // Auto-scroll
    combatLogDiv.style.display = 'block'; // Garante que o log esteja visível durante o combate
}

function clearCombatLog() {
    combatLogDiv.innerHTML = '';
    combatLogDiv.style.display = 'none';
}


// Função chamada pelo script principal (script.js) quando os dados do jogador são carregados
window.onPlayerInfoLoadedForAfk = (player) => {
    console.log("AFK Script: onPlayerInfoLoadedForAfk chamado.", player);
    currentPlayerData = player;
    // Se o container AFK já estiver visível, atualiza as recompensas
    const afkContainer = document.getElementById('afkContainer');
    if (afkContainer && afkContainer.style.display === 'block') {
        calculateAndDisplayAfkRewards();
    }
};

// Função chamada pelo script principal (script.js) quando o menu AFK é exibido
window.initAfkDisplay = () => {
    console.log("AFK Script: initAfkDisplay chamado.");
    afkMessage.textContent = ''; // Limpa mensagens antigas
    clearCombatLog(); // Limpa o log de combate ao entrar na tela AFK
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
        collectAfkRewardsBtn.disabled = true; // Desabilita botão se não há o que coletar
        return;
    }

    const lastAfkStartTime = new Date(currentPlayerData.last_afk_start_time).getTime();
    const currentTime = new Date().getTime();
    const afkDurationMs = currentTime - lastAfkStartTime;

    const afkDurationSeconds = Math.floor(afkDurationMs / 1000);
    const afkDurationMinutes = Math.floor(afkDurationSeconds / 60);

    const maxAfkMinutes = 4 * 60; // 4 horas * 60 minutos/hora = 240 minutos
    const effectiveAfkMinutes = Math.min(afkDurationMinutes, maxAfkMinutes);

    // Formatação do tempo AFK para exibição
    const hours = Math.floor(afkDurationMinutes / 60);
    const minutes = afkDurationMinutes % 60;
    const seconds = afkDurationSeconds % 60;

    let timeString = '';
    if (hours > 0) timeString += `${hours}h `;
    if (minutes > 0) timeString += `${minutes}m `;
    timeString += `${seconds}s`;

    afkTimeSpan.textContent = timeString.trim();

    // Lógica de cálculo de recompensa (multiplica pelo estágio atual)
    const currentStageData = monstersByStage[currentPlayerData.current_afk_stage];
    
    let estimatedXPGain = 0;
    let estimatedGoldGain = 0;

    if (currentStageData) {
        const xpPerMinuteBase = currentStageData.xpReward / 5; // Ex: um monstro dá 20XP, então 4XP/min
        const goldPerMinuteBase = currentStageData.goldReward / 5; // Ex: um monstro dá 10 Ouro, então 2 Ouro/min

        estimatedXPGain = Math.floor(xpPerMinuteBase * effectiveAfkMinutes);
        estimatedGoldGain = Math.floor(goldPerMinuteBase * effectiveAfkMinutes);
    } else {
        // Fallback se o estágio atual do jogador não tiver um monstro definido
        console.warn(`AFK Script: Monstro para o estágio ${currentPlayerData.current_afk_stage} não definido. Recompensas AFK serão 0.`);
    }

    afkStageSpan.textContent = currentPlayerData.current_afk_stage;
    afkXPGainSpan.textContent = estimatedXPGain;
    afkGoldGainSpan.textContent = estimatedGoldGain;

    if (afkDurationMinutes >= maxAfkMinutes) {
        afkMessage.textContent = `Você atingiu o limite de ${maxAfkMinutes / 60} horas de coleta AFK! Colete suas recompensas.`;
    } else {
        afkMessage.textContent = ''; // Limpa mensagem de cálculo
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
            // Atualiza o objeto local para refletir o tempo resetado
            currentPlayerData.last_afk_start_time = new Date().toISOString(); 
            calculateAndDisplayAfkRewards(); // Recalcula para mostrar 0 recompensas
        }
    }
    collectAfkRewardsBtn.disabled = false;
}

async function startAdventure() {
    console.log("AFK Script: Iniciar Combate PvE clicado.");
    afkMessage.textContent = "Iniciando Combate PvE...";
    clearCombatLog();
    startAdventureBtn.disabled = true;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        afkMessage.textContent = "Erro: Usuário não logado.";
        startAdventureBtn.disabled = false;
        console.error("AFK Script: Combate não pode iniciar, usuário não logado.");
        return;
    }
    console.log("AFK Script: Usuário logado, ID:", user.id);

    // Busca dados do jogador atualizados para o combate
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
        if (currentStage > availableStages[availableStages.length - 1]) {
            monster = monstersByStage[availableStages[availableStages.length - 1]];
            afkMessage.textContent = `Você já derrotou todos os monstros conhecidos! Enfrentando o último monstro no estágio ${currentStage}.`;
            logCombat(`Monstro para o estágio ${currentStage} não definido, usando ${monster.name} do estágio ${availableStages[availableStages.length - 1]}.`);
        } else {
            monster = monstersByStage[1]; // Fallback para o primeiro estágio
            afkMessage.textContent = `Monstro para o estágio ${currentStage} não encontrado, enfrentando Slime Iniciante.`;
            logCombat(`Monstro para o estágio ${currentStage} não definido, usando ${monster.name} do estágio 1.`);
        }
        console.warn(`AFK Script: Monstro para o estágio ${currentStage} não definido. Usando:`, monster.name);
    } else {
        console.log(`AFK Script: Monstro para o estágio ${currentStage} encontrado:`, monster.name);
    }

    logCombat(`--- INICIANDO COMBATE: ${player.name} vs. ${monster.name} (Estágio ${currentStage}) ---`);
    logCombat(`Seus atributos: HP ${player.health}, ATK ${player.attack}, DEF ${player.defense}`);
    logCombat(`Atributos do Monstro: HP ${monster.hp}, ATK ${monster.attack}, DEF ${monster.defense}`);

    let playerCurrentHP = player.health;
    let monsterCurrentHP = monster.hp;
    let turn = 0;

    // Simulação de combate turn-based
    const maxTurns = 50; // Limite de 50 turnos para evitar loop infinito
    while (playerCurrentHP > 0 && monsterCurrentHP > 0 && turn < maxTurns) {
        turn++;
        logCombat(`\n--- Turno ${turn} ---`);

        // Ataque do Jogador
        let playerDamage = Math.max(1, player.attack - monster.defense);
        monsterCurrentHP -= playerDamage;
        logCombat(`${player.name} ataca ${monster.name} e causa ${playerDamage} de dano! (${monster.name} HP: ${Math.max(0, monsterCurrentHP)})`);

        if (monsterCurrentHP <= 0) {
            logCombat(`${monster.name} foi derrotado!`);
            break;
        }

        // Ataque do Monstro
        let monsterDamage = Math.max(1, monster.attack - player.defense);
        playerCurrentHP -= monsterDamage;
        logCombat(`${monster.name} ataca ${player.name} e causa ${monsterDamage} de dano! (${player.name} HP: ${Math.max(0, playerCurrentHP)})`);

        if (playerCurrentHP <= 0) {
            logCombat(`${player.name} foi derrotado...`);
            break;
        }
    }

    // Resultado do Combate
    if (playerCurrentHP > 0) {
        logCombat(`\nVITÓRIA! Você derrotou ${monster.name}!`);
        console.log("AFK Script: Jogador venceu o combate.");

        // Recompensas
        const xpReward = monster.xpReward;
        const goldReward = monster.goldReward;
        
        // Atualiza last_afk_start_time para agora (resetando o timer AFK para novas coletas)
        // e incrementa o estágio
        const { error: updateError } = await supabaseClient
            .from('players')
            .update({
                current_afk_stage: currentStage + 1,
                last_afk_start_time: new Date().toISOString()
            })
            .eq('id', user.id);

        if (updateError) {
            console.error('AFK Script: Erro ao atualizar estágio e tempo AFK após vitória:', updateError);
            afkMessage.textContent = `Vitória, mas houve um erro ao atualizar seu estágio: ${updateError.message}`;
        } else {
            afkMessage.textContent = `Vitória! Você avançou para o Estágio PvE ${currentStage + 1}!`;
            console.log(`AFK Script: Estágio avançado para ${currentStage + 1}.`);

            // Ganho de XP e Ouro (chamando as funções globais)
            const xpResult = await window.gainXP(user.id, xpReward);
            const goldResult = await window.gainGold(user.id, goldReward);
            
            logCombat(`Você ganhou ${xpReward} XP e ${goldReward} Ouro.`);
            if (xpResult.leveledUp) {
                logCombat(`PARABÉNS! Você alcançou o Nível ${xpResult.newLevel}!`);
            }

            // Chance de Fragmento de Equipamento R
            const dropChance = Math.random();
            if (dropChance < monster.fragmentChance) {
                logCombat(`🎉 Você encontrou um Fragmento de Equipamento R!`);
                console.log("AFK Script: Fragmento R dropado!");
                // Futuramente: Adicionar lógica para adicionar fragmento ao inventário
            } else {
                logCombat(`Sem fragmentos desta vez.`);
            }

            // Atualiza os dados locais e recalcula recompensas AFK (que agora serão 0)
            if (typeof window.fetchAndDisplayPlayerInfo === 'function') {
                await window.fetchAndDisplayPlayerInfo();
            }
            currentPlayerData.current_afk_stage = currentStage + 1;
            currentPlayerData.last_afk_start_time = new Date().toISOString();
            calculateAndDisplayAfkRewards();
        }
    } else {
        logCombat(`\nDERROTA! Você foi derrotado por ${monster.name}.`);
        afkMessage.textContent = `Derrota! Você precisa ficar mais forte para passar do Estágio ${currentStage}.`;
        console.log("AFK Script: Jogador perdeu o combate.");
        // Não reseta last_afk_start_time nem incrementa estágio em caso de derrota
    }

    startAdventureBtn.disabled = false; // Reabilita o botão
    setTimeout(() => { afkMessage.textContent = '', clearCombatLog(); }, 5000); // Limpa mensagem e log após 5s
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
