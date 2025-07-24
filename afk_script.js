// afk_script.js - Este script lida com toda a lógica e UI do AFK

// Elementos da UI AFK (Certifique-se de que estes IDs existam no index.html)
const afkStageSpan = document.getElementById('afkStage');
const afkTimeSpan = document.getElementById('afkTime');
const afkXPGainSpan = document.getElementById('afkXPGain');
const afkGoldGainSpan = document.getElementById('afkGoldGain');
const collectAfkRewardsBtn = document.getElementById('collectAfkRewardsBtn');
const startAdventureBtn = document.getElementById('startAdventureBtn');
const afkMessage = document.getElementById('afkMessage');

// Variável para armazenar os dados do jogador mais recentes para o AFK
let currentPlayerData = null;

// Função chamada pelo script principal (script.js) quando os dados do jogador são carregados
window.onPlayerInfoLoadedForAfk = (player) => {
    currentPlayerData = player;
    // Se o container AFK já estiver visível, atualiza as recompensas
    if (afkContainer.style.display === 'block') {
        calculateAndDisplayAfkRewards();
    }
};

// Função chamada pelo script principal (script.js) quando o menu AFK é exibido
window.initAfkDisplay = () => {
    afkMessage.textContent = ''; // Limpa mensagens antigas
    if (currentPlayerData) {
        calculateAndDisplayAfkRewards();
    } else {
        afkMessage.textContent = 'Carregando dados do jogador para AFK...';
        // Caso os dados ainda não estejam disponíveis, fetchAndDisplayPlayerInfo será chamado pelo script principal.
        // onPlayerInfoLoadedForAfk será então acionado.
    }
};


async function calculateAndDisplayAfkRewards() {
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

    // Limita o tempo AFK máximo para evitar recompensas exageradas (ex: 8 horas = 480 minutos)
    const maxAfkMinutes = 8 * 60;
    const effectiveAfkMinutes = Math.min(afkDurationMinutes, maxAfkMinutes);

    // Formatação do tempo AFK
    const hours = Math.floor(effectiveAfkMinutes / 60);
    const minutes = effectiveAfkMinutes % 60;
    const seconds = afkDurationSeconds % 60; // Mantém segundos exatos para exibição

    let timeString = '';
    if (hours > 0) timeString += `${hours}h `;
    if (minutes > 0) timeString += `${minutes}m `;
    timeString += `${seconds}s`; // Sempre mostra segundos para feedback imediato

    afkTimeSpan.textContent = timeString.trim();

    // Lógica de cálculo de recompensa (exemplo simplificado e ajustável)
    const xpPerMinutePerStage = 1; // 1 XP por minuto por estágio
    const goldPerMinutePerStage = 0.5; // 0.5 Ouro por minuto por estágio

    const estimatedXPGain = Math.floor(xpPerMinutePerStage * effectiveAfkMinutes * currentPlayerData.current_afk_stage);
    const estimatedGoldGain = Math.floor(goldPerMinutePerStage * effectiveAfkMinutes * currentPlayerData.current_afk_stage);

    afkStageSpan.textContent = currentPlayerData.current_afk_stage;
    afkXPGainSpan.textContent = estimatedXPGain;
    afkGoldGainSpan.textContent = estimatedGoldGain;
    afkMessage.textContent = ''; // Limpa mensagem de cálculo

    collectAfkRewardsBtn.disabled = (estimatedXPGain === 0 && estimatedGoldGain === 0); // Habilita/desabilita
    // Armazena os ganhos estimados para a coleta
    collectAfkRewardsBtn.dataset.xp = estimatedXPGain;
    collectAfkRewardsBtn.dataset.gold = estimatedGoldGain;
}

async function collectAfkRewards() {
    afkMessage.textContent = 'Coletando recompensas...';
    collectAfkRewardsBtn.disabled = true; // Desabilita para evitar cliques múltiplos

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

    // Busca o jogador novamente para obter os valores atuais de XP/Ouro e nivel
    const { data: player, error: fetchError } = await supabaseClient
        .from('players')
        .select('xp, gold, level, health, mana, attack, defense, combat_power, current_afk_stage') // Inclui current_afk_stage
        .eq('id', user.id)
        .single();

    if (fetchError) {
        console.error('Erro ao buscar jogador para coletar recompensas AFK:', fetchError);
        afkMessage.textContent = `Erro ao coletar: ${fetchError.message}`;
        collectAfkRewardsBtn.disabled = false;
        return;
    }

    let newXP = player.xp + xpToGain;
    let newGold = player.gold + goldToGain;
    let currentLevel = player.level;
    let newHealth = player.health;
    let newMana = player.mana;
    let newAttack = player.attack;
    let newDefense = player.defense;
    let newCombatPower = player.combat_power;
    let leveledUpMessage = '';

    // Lógica de level up integrada
    const xpNeededForNextLevel = currentLevel * 100;
    if (newXP >= xpNeededForNextLevel) {
        currentLevel++;
        newXP -= xpNeededForNextLevel; // XP restante após o level up
        newHealth += 10;
        newMana += 5;
        newAttack += 2;
        newDefense += 1;
        newCombatPower = Math.floor((newHealth + newMana + newAttack + newDefense) * currentLevel / 10);
        leveledUpMessage = ` Você alcançou o Nível ${currentLevel} e seus atributos aumentaram!`;
    }

    // Atualiza XP, Ouro e o last_afk_start_time para o momento da coleta
    const { error: updateError } = await supabaseClient
        .from('players')
        .update({
            xp: newXP,
            gold: newGold,
            level: currentLevel, // Atualiza o nível
            health: newHealth,
            mana: newMana,
            attack: newAttack,
            defense: newDefense,
            combat_power: newCombatPower,
            last_afk_start_time: new Date().toISOString() // Reseta o tempo AFK
        })
        .eq('id', user.id);

    if (updateError) {
        console.error('Erro ao atualizar recompensas AFK:', updateError);
        afkMessage.textContent = `Erro ao coletar recompensas: ${updateError.message}`;
    } else {
        afkMessage.textContent = `Você coletou ${xpToGain} XP e ${goldToGain} Ouro!${leveledUpMessage}`;
        // Atualiza a exibição de informações do jogador no script principal
        if (typeof window.fetchAndDisplayPlayerInfo === 'function') {
            window.fetchAndDisplayPlayerInfo();
        }
        // Recalcula recompensas para mostrar que foi resetado
        // Usa os dados do jogador atualizados após a coleta
        currentPlayerData.xp = newXP;
        currentPlayerData.gold = newGold;
        currentPlayerData.level = currentLevel;
        currentPlayerData.health = newHealth;
        currentPlayerData.mana = newMana;
        currentPlayerData.attack = newAttack;
        currentPlayerData.defense = newDefense;
        currentPlayerData.combat_power = newCombatPower;
        currentPlayerData.last_afk_start_time = new Date().toISOString(); // Reseta o tempo AFK no objeto
        calculateAndDisplayAfkRewards();
    }
    collectAfkRewardsBtn.disabled = false;
}

async function startAdventure() {
    afkMessage.textContent = "Aventura iniciada! Você está agora em um novo estágio AFK.";
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        afkMessage.textContent = "Erro: Usuário não logado.";
        return;
    }

    // Aumenta o estágio AFK (exemplo: +1 por aventura iniciada)
    // Em um jogo real, isso pode depender de completar missões ou pagar ouro/cristais.
    const { data: player, error: fetchError } = await supabaseClient
        .from('players')
        .select('current_afk_stage')
        .eq('id', user.id)
        .single();

    if (fetchError) {
        console.error('Erro ao buscar estágio AFK atual:', fetchError);
        afkMessage.textContent = `Erro ao iniciar aventura: ${fetchError.message}`;
        return;
    }

    const newStage = player.current_afk_stage + 1;
    const { error: updateError } = await supabaseClient
        .from('players')
        .update({
            current_afk_stage: newStage,
            last_afk_start_time: new Date().toISOString() // Reseta o tempo AFK ao iniciar nova aventura
        })
        .eq('id', user.id);

    if (updateError) {
        console.error('Erro ao atualizar estágio AFK:', updateError);
        afkMessage.textContent = `Erro ao iniciar aventura: ${updateError.message}`;
    } else {
        afkMessage.textContent = `Aventura iniciada! Seu estágio AFK agora é ${newStage}.`;
        // Atualiza os dados locais e recalcula
        currentPlayerData.current_afk_stage = newStage;
        currentPlayerData.last_afk_start_time = new Date().toISOString();
        calculateAndDisplayAfkRewards();
        // Atualiza a exibição de informações do jogador no script principal (se necessário)
        if (typeof window.fetchAndDisplayPlayerInfo === 'function') {
            window.fetchAndDisplayPlayerInfo();
        }
    }
    setTimeout(() => { afkMessage.textContent = ''; }, 5000);
}


// Listeners de Eventos para afk_script.js
document.addEventListener('DOMContentLoaded', () => {
    if (collectAfkRewardsBtn) collectAfkRewardsBtn.addEventListener('click', collectAfkRewards);
    if (startAdventureBtn) startAdventureBtn.addEventListener('click', startAdventure);
});
