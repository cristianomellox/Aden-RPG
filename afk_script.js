// afk_script.js

// Variáveis globais para o AFK
let currentMonsterHealth;
let playerAttackPower;
let playerMaxHealth; // Adicionado para cura pós-derrota
let currentPlayerId; // Para armazenar o ID do jogador logado
let currentDailyAttemptsLeft; // Para controlar as tentativas diárias
let currentAfkStage; // Para acompanhar o estágio atual do AFK

const MAX_ATTACKS = 10; // Número de ataques por tentativa de combate
let remainingAttacks = MAX_ATTACKS;

// Elementos da UI AFK
const afkStageSpan = document.getElementById('afkStage');
const afkTimeSpan = document.getElementById('afkTime');
const afkXPGainSpan = document.getElementById('afkXPGain');
const afkGoldGainSpan = document.getElementById('afkGoldGain');
const collectAfkRewardsBtn = document.getElementById('collectAfkRewardsBtn');
const startAdventureBtn = document.getElementById('startAdventureBtn');
const afkMessage = document.getElementById('afkMessage');
const monsterHealthPercentageSpan = document.getElementById('monsterHealthPercentage');
const monsterCurrentHealthDisplay = document.getElementById('monsterCurrentHealthDisplay');
const attackButton = document.getElementById('attackButton');
const attackCountDisplay = document.getElementById('attackCountDisplay');
const remainingAttacksSpan = document.getElementById('remainingAttacks');
const combatLog = document.getElementById('combatLog');
const dailyAttemptsLeftSpan = document.getElementById('dailyAttemptsLeft'); // Novo elemento para exibir tentativas restantes
const monsterImage = document.getElementById('monsterImage'); // Referência à imagem do monstro
const afkContainer = document.getElementById('afkContainer'); // Adicionado para controlar a visibilidade do container AFK

// Objeto para armazenar dados do jogador carregados
let currentPlayerData = null;

// Constante para o limite máximo de estágios
const MAX_AFK_STAGE = 100; // Limite de estágios da aventura PvE

// Constante para o limite de tempo de acúmulo AFK (em segundos)
const MAX_AFK_ACCUMULATION_TIME_SECONDS = 4 * 60 * 60; // 4 horas * 60 minutos * 60 segundos

// Taxas base de XP e Ouro por segundo para o modo idle
const BASE_GOLD_PER_SECOND = 1 / 900; // 900 segundos = 15 minutos (1 ouro a cada 15 min)
const BASE_XP_PER_SECOND = 1 / 600; // 600 segundos = 10 minutos (1 XP a cada 10 min)


// Função chamada pelo script.js quando o jogador faz login ou o perfil é atualizado
window.onPlayerInfoLoadedForAfk = (player) => {
    console.log("AFK Script: Player info loaded.", player);
    currentPlayerData = player; // Armazena todos os dados do jogador
    currentPlayerId = player.id;
    playerAttackPower = player.attack;
    playerMaxHealth = player.health; // Assumindo que a saúde inicial é a máxima
    currentAfkStage = player.current_afk_stage;
    currentDailyAttemptsLeft = player.daily_attempts_left; // Carrega as tentativas diárias

    afkStageSpan.textContent = currentAfkStage;
    dailyAttemptsLeftSpan.textContent = currentDailyAttemptsLeft; // Atualiza o display das tentativas

    // Habilita/desabilita o botão de iniciar aventura com base nas tentativas restantes
    if (currentDailyAttemptsLeft <= 0 || currentAfkStage >= MAX_AFK_STAGE) { // Adicionado verificação de estágio máximo
        startAdventureBtn.disabled = true;
        afkMessage.textContent = "Você não tem mais tentativas diárias de aventura ou já conquistou todos os estágios!";
    } else {
        afkMessage.textContent = ""; // Limpa a mensagem se houver tentativas
        startAdventureBtn.disabled = false; // Garante que o botão esteja habilitado se houver tentativas
    }

    calculateAndDisplayAfkRewards(); // Chama para exibir o estado inicial do contador e recompensas
    checkAndResetDailyAttempts(); // Verifica e reseta as tentativas se necessário
};

// Função para verificar e resetar tentativas diárias
async function checkAndResetDailyAttempts() {
    console.log("Verificando e resetando tentativas diárias...");
    if (!currentPlayerId) {
        console.warn("currentPlayerId não definido. Não é possível verificar tentativas.");
        return;
    }

    const { data: player, error } = await supabaseClient
        .from('players')
        .select('daily_attempts_left, last_attempt_reset')
        .eq('id', currentPlayerId)
        .single();

    if (error) {
        console.error('Erro ao buscar tentativas diárias:', error.message);
        return;
    }

    const now = new Date();
    const lastReset = new Date(player.last_attempt_reset);

    // Considera resetar se a última reinicialização foi em um dia diferente (GMT para evitar problemas de fuso horário)
    if (now.getUTCDate() !== lastReset.getUTCDate() || now.getUTCMonth() !== lastReset.getUTCMonth() || now.getUTCFullYear() !== lastReset.getUTCFullYear()) {
        console.log("Resetando tentativas diárias...");
        const { error: updateError } = await supabaseClient
            .from('players')
            .update({
                daily_attempts_left: 5, // Reseta para 5 tentativas
                last_attempt_reset: now.toISOString() // Atualiza o tempo do reset
            })
            .eq('id', currentPlayerId);

        if (updateError) {
            console.error('Erro ao resetar tentativas diárias:', updateError.message);
        } else {
            console.log("Tentativas diárias resetadas com sucesso!");
            currentDailyAttemptsLeft = 5; // Atualiza a variável local
            dailyAttemptsLeftSpan.textContent = currentDailyAttemptsLeft; // Atualiza o display
            afkMessage.textContent = "Suas tentativas diárias de aventura foram resetadas!";
            // Atualiza player data localmente
            if(currentPlayerData) {
                currentPlayerData.daily_attempts_left = 5;
                currentPlayerData.last_attempt_reset = now.toISOString();
            }
        }
    } else {
        console.log("As tentativas diárias já foram verificadas hoje. Tentativas restantes:", currentDailyAttemptsLeft);
    }

    // Garante que o botão esteja desabilitado se as tentativas acabaram após a verificação
    if (currentDailyAttemptsLeft <= 0 || currentAfkStage >= MAX_AFK_STAGE) {
        startAdventureBtn.disabled = true;
        afkMessage.textContent = "Você não tem mais tentativas diárias de aventura ou já conquistou todos os estágios!";
    } else {
        startAdventureBtn.disabled = false;
    }
}


// Função para calcular e exibir as recompensas AFK e o cronômetro decrescente
function calculateAndDisplayAfkRewards() {
    if (!currentPlayerData || !currentPlayerData.last_afk_start_time) {
        afkTimeSpan.textContent = formatTime(MAX_AFK_ACCUMULATION_TIME_SECONDS); // Exibe 4 horas completas
        afkXPGainSpan.textContent = '0';
        afkGoldGainSpan.textContent = '0';
        collectAfkRewardsBtn.disabled = true;
        return;
    }

    const lastAfkTime = new Date(currentPlayerData.last_afk_start_time).getTime();
    const currentTime = Date.now();
    let timeElapsedSeconds = Math.floor((currentTime - lastAfkTime) / 1000);

    // Limita o tempo de acúmulo ao máximo definido (4 horas)
    const cappedTimeElapsed = Math.min(timeElapsedSeconds, MAX_AFK_ACCUMULATION_TIME_SECONDS);

    // Calcula o tempo restante para o cronômetro decrescente
    const timeLeftForDisplay = Math.max(0, MAX_AFK_ACCUMULATION_TIME_SECONDS - timeElapsedSeconds);
    afkTimeSpan.textContent = formatTime(timeLeftForDisplay); // Exibe o tempo restante

    // Calcula o ganho de XP e Ouro baseado no tempo *acumulado* (cappedTimeElapsed) e no estágio atual
    const xpPerSecond = BASE_XP_PER_SECOND * currentAfkStage;
    const goldPerSecond = BASE_GOLD_PER_SECOND * currentAfkStage;

    const estimatedXP = Math.floor(cappedTimeElapsed * xpPerSecond);
    const estimatedGold = Math.floor(cappedTimeElapsed * goldPerSecond);

    afkXPGainSpan.textContent = estimatedXP;
    afkGoldGainSpan.textContent = estimatedGold;

    // Desabilita o botão se não houver recompensas ou se o tempo esgotou e já foi coletado
    collectAfkRewardsBtn.disabled = (estimatedXP === 0 && estimatedGold === 0);
}

// Função para formatar o tempo (hh:mm:ss)
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}


// Função para coletar recompensas AFK
async function collectAfkRewards() {
    if (!currentPlayerId) return;

    const lastAfkTime = new Date(currentPlayerData.last_afk_start_time).getTime();
    const currentTime = Date.now();
    let timeElapsedSeconds = Math.floor((currentTime - lastAfkTime) / 1000);

    // Limita o tempo de acúmulo ao máximo definido (4 horas) antes de coletar
    const cappedTimeElapsed = Math.min(timeElapsedSeconds, MAX_AFK_ACCUMULATION_TIME_SECONDS);

    const xpPerSecond = BASE_XP_PER_SECOND * currentAfkStage;
    const goldPerSecond = BASE_GOLD_PER_SECOND * currentAfkStage;

    const xpToGain = Math.floor(cappedTimeElapsed * xpPerSecond);
    const goldToGain = Math.floor(cappedTimeElapsed * goldPerSecond);

    if (xpToGain === 0 && goldToGain === 0) {
        afkMessage.textContent = "Nenhuma recompensa para coletar ainda.";
        setTimeout(() => { afkMessage.textContent = ''; }, 3000);
        return;
    }

    afkMessage.textContent = "Coletando recompensas...";
    collectAfkRewardsBtn.disabled = true; // Desabilita para evitar cliques múltiplos

    const xpResult = await window.gainXP(currentPlayerId, xpToGain);
    const goldResult = await window.gainGold(currentPlayerId, goldToGain);

    if (xpResult.success && goldResult.success) {
        afkMessage.textContent = `Recompensas coletadas! XP: ${xpToGain}, Ouro: ${goldToGain}.`;
        if (xpResult.leveledUp) {
            afkMessage.textContent += ` Você subiu para o nível ${xpResult.newLevel}!`;
        }
        // Atualiza o last_afk_start_time no banco de dados para o tempo ATUAL
        const { error: updateTimeError } = await supabaseClient
            .from('players')
            .update({ last_afk_start_time: new Date().toISOString() })
            .eq('id', currentPlayerId);
        if (updateTimeError) {
            console.error('Erro ao atualizar last_afk_start_time:', updateTimeError.message);
        } else {
            // MUITO IMPORTANTE: Atualiza o last_afk_start_time LOCALMENTE para o tempo atual
            // Isso fará com que o contador decrescente reinicie para 4 horas
            currentPlayerData.last_afk_start_time = new Date().toISOString();
            calculateAndDisplayAfkRewards(); // Recalcula imediatamente para mostrar o cronômetro reiniciado e 0 em recompensas
            window.fetchAndDisplayPlayerInfo(true); // Atualiza as info do jogador na tela principal
        }
    } else {
        afkMessage.textContent = `Erro ao coletar recompensas: ${xpResult.message || goldResult.message}`;
    }
    setTimeout(() => { afkMessage.textContent = ''; }, 5000);
}

// Função para iniciar a aventura de combate PvE
async function startAdventure() {
    if (!currentPlayerId) {
        afkMessage.textContent = "Erro: Informações do jogador não carregadas.";
        return;
    }

    // Verifica se o estágio atual é o máximo
    if (currentAfkStage >= MAX_AFK_STAGE) {
        afkMessage.textContent = `Você já conquistou todos os ${MAX_AFK_STAGE} estágios de aventura!`;
        startAdventureBtn.disabled = true;
        return;
    }

    // Verifica as tentativas diárias
    if (currentDailyAttemptsLeft <= 0) {
        afkMessage.textContent = "Você não tem mais tentativas diárias de aventura. Volte amanhã!";
        startAdventureBtn.disabled = true;
        return;
    }

    // Decrementa a tentativa diária antes de iniciar o combate
    const { error: decrementError } = await supabaseClient
        .from('players')
        .update({ daily_attempts_left: currentDailyAttemptsLeft - 1 })
        .eq('id', currentPlayerId);

    if (decrementError) {
        console.error('Erro ao decrementar tentativas diárias:', decrementError.message);
        afkMessage.textContent = `Erro ao iniciar aventura: ${decrementError.message}`;
        return;
    } else {
        currentDailyAttemptsLeft--; // Atualiza localmente
        dailyAttemptsLeftSpan.textContent = currentDailyAttemptsLeft; // Atualiza o display
        afkMessage.textContent = `Tentativas restantes: ${currentDailyAttemptsLeft}`;
        if (currentDailyAttemptsLeft <= 0) {
            startAdventureBtn.disabled = true;
        }
    }

    afkMessage.textContent = "Iniciando aventura...";
    startAdventureBtn.disabled = true; // Desabilita o botão para evitar cliques múltiplos durante o combate

    // Oculta o container principal da aventura AFK para remover todos os seus elementos
    afkContainer.style.display = 'none';
    
    // Garante que os elementos de combate são mostrados (assumindo que estão fora do #afkContainer ou em outro container)
    monsterHealthPercentageSpan.style.display = 'block';
    attackButton.style.display = 'block';
    monsterImage.style.display = 'block';
    attackCountDisplay.style.display = 'block';
    combatLog.style.display = 'block';

    combatLog.innerHTML = ''; // Limpa log anterior

    // Definições do monstro (escalada para 100 estágios)
    const monsterBaseHealth = 100 + (currentAfkStage - 1) * 50;
    const monsterBaseDefense = 5 + (currentAfkStage - 1) * 1;
    const monsterName = `Monstro do Estágio ${currentAfkStage}`;

    currentMonsterHealth = monsterBaseHealth;
    remainingAttacks = MAX_ATTACKS;
    remainingAttacksSpan.textContent = remainingAttacks;
    updateMonsterHealthDisplay();

    // Remove qualquer filtro de matiz ou tremor se existia antes (garante estado anterior)
    monsterImage.style.filter = '';
    monsterImage.classList.remove('shake-animation'); // Apenas para garantir

    appendCombatLog(`Um ${monsterName} apareceu! Prepare-se para o combate!`);
}

function updateMonsterHealthDisplay() {
    monsterCurrentHealthDisplay.textContent = `${Math.max(0, currentMonsterHealth)} / ${currentMonsterHealth}`;
}

function appendCombatLog(message) {
    const p = document.createElement('p');
    p.textContent = message;
    combatLog.appendChild(p);
    combatLog.scrollTop = combatLog.scrollHeight;
}

// Função de ataque do jogador
async function playerAttack() {
    if (remainingAttacks <= 0 || currentMonsterHealth <= 0) {
        console.log("Combate finalizado ou sem ataques restantes.");
        return;
    }

    remainingAttacks--;
    remainingAttacksSpan.textContent = remainingAttacks;

    // Calcular dano do jogador (exemplo simples)
    let damageDealt = Math.max(1, playerAttackPower - Math.floor(currentAfkStage * 0.5));
    const isCritical = Math.random() < 0.2; // 20% de chance de crítico
    if (isCritical) {
        damageDealt *= 2; // Dano crítico dobra
    }
    damageDealt = Math.floor(damageDealt); // Garante que o dano seja um número inteiro

    currentMonsterHealth -= damageDealt;

    window.showDamagePopup(damageDealt, isCritical); // Exibe o popup de dano

    appendCombatLog(`Você atacou o monstro! Causou ${damageDealt} de dano.`);
    updateMonsterHealthDisplay();

    if (currentMonsterHealth <= 0) {
        endCombat(true); // Vitória
    } else if (remainingAttacks <= 0) {
        endCombat(false); // Derrota por falta de ataques
    }
}


// Função para finalizar o combate
async function endCombat(isVictory) {
    // Esconde elementos de combate
    attackButton.style.display = 'none';
    monsterImage.style.display = 'none';
    attackCountDisplay.style.display = 'none';
    monsterHealthPercentageSpan.style.display = 'none';
    combatLog.style.display = 'none';

    // Reexibir o container principal da aventura AFK
    afkContainer.style.display = 'block';

    let title, message, onConfirm;

    if (isVictory) {
        title = "Vitória!";
        message = `Você derrotou o monstro do Estágio ${currentAfkStage}!<br>Confirmar para avançar ao próximo estágio.`;

        onConfirm = async () => {
            afkMessage.textContent = "Avançando para o próximo estágio...";
            const newStage = Math.min(currentAfkStage + 1, MAX_AFK_STAGE); // Garante que não exceda o estágio máximo
            const { error: updateStageError } = await supabaseClient
                .from('players')
                .update({ current_afk_stage: newStage, last_afk_start_time: new Date().toISOString() })
                .eq('id', currentPlayerId);
            if (updateStageError) {
                console.error('Erro ao avançar estágio:', updateStageError.message);
                afkMessage.textContent = `Erro ao avançar estágio: ${updateStageError.message}`;
            } else {
                currentAfkStage = newStage; // Atualiza localmente
                afkStageSpan.textContent = currentAfkStage; // Atualiza o display do estágio

                // Recompensas de XP por vitória no estágio
                const xpForVictory = Math.floor(currentAfkStage * 50); // XP maior por vitória
                const xpResult = await window.gainXP(currentPlayerId, xpForVictory);
                let finalMsg = `Vitória! Ganhou ${xpForVictory} XP no Estágio ${currentAfkStage}.`;
                if (xpResult.leveledUp) {
                    finalMsg += ` Você subiu para o nível ${xpResult.newLevel}!`;
                }
                afkMessage.textContent = finalMsg;
                // Re-fetch e display para garantir que o perfil esteja atualizado
                await window.fetchAndDisplayPlayerInfo(true); // Mantém o container ativo (AFK)
                // Atualiza o objeto local (opcional, mas bom para consistência)
                currentPlayerData.current_afk_stage = newStage;
                currentPlayerData.last_afk_start_time = new Date().toISOString();
            }
            calculateAndDisplayAfkRewards(); // Recalcula para exibir o tempo de acúmulo correto
            // Reabilita o botão de iniciar aventura se houver tentativas e não atingiu o estágio máximo
            if (currentDailyAttemptsLeft > 0 && currentAfkStage < MAX_AFK_STAGE) {
                startAdventureBtn.disabled = false;
            } else {
                startAdventureBtn.disabled = true; // Mantém desabilitado se não houver tentativas ou atingiu o limite
            }
            setTimeout(() => { afkMessage.textContent = ''; }, 5000);
            window.updateUIVisibility(true, 'afkContainer'); // Garante que a tela AFK esteja visível
        };

    } else { // Derrota
        title = "Derrota!";
        message = `Você não conseguiu derrotar o monstro em ${MAX_ATTACKS} ataques.<br>Tente novamente!`;

        onConfirm = async () => {
            afkMessage.textContent = "Retornando à base para se curar...";
            const { data: { user } = { user: null } } = await supabaseClient.auth.getUser();
            if (user) {
                await supabaseClient
                    .from('players')
                    .update({ health: playerMaxHealth }) // Cura total
                    .eq('id', user.id);
            }
            afkMessage.textContent = "Pronto para outra tentativa.";
            // Re-fetch e display para garantir que o perfil esteja atualizado
            await window.fetchAndDisplayPlayerInfo(true); // Mantém o container ativo (AFK)
            calculateAndDisplayAfkRewards(); // Recalcula para exibir o tempo de acúmulo correto
            // Reabilita o botão de iniciar aventura se houver tentativas
            if (currentDailyAttemptsLeft > 0 && currentAfkStage < MAX_AFK_STAGE) {
                startAdventureBtn.disabled = false;
            } else {
                startAdventureBtn.disabled = true; // Mantém desabilitado se não houver tentativas
            }
            setTimeout(() => { afkMessage.textContent = ''; }, 5000);
            window.updateUIVisibility(true, 'afkContainer'); // Garante que a tela AFK esteja visível
        };
    }

    window.showCombatResultModal(title, message, onConfirm);
}


// Listeners de Eventos para afk_script.js
document.addEventListener('DOMContentLoaded', () => {
    console.log("AFK Script: DOMContentLoaded. Adicionando listeners.");
    // Verifica se os elementos existem antes de adicionar os listeners
    if (collectAfkRewardsBtn) {
        collectAfkRewardsBtn.addEventListener('click', collectAfkRewards);
        console.log("AFK Script: Listener para collectAfkRewardsBtn adicionado.");
    }
    if (startAdventureBtn) {
        startAdventureBtn.addEventListener('click', startAdventure);
        console.log("AFK Script: Listener para startAdventureBtn adicionado.");
    }
    if (attackButton) { // Adicionado para garantir que o botão de ataque também tenha seu listener
        attackButton.addEventListener('click', playerAttack);
        console.log("AFK Script: Listener para attackButton adicionado.");
    }

    // Chama calculateAndDisplayAfkRewards a cada segundo para atualizar o contador
    setInterval(calculateAndDisplayAfkRewards, 1000);
});

// Inicialização do AFK
window.initAfk = async () => {
    // onPlayerInfoLoadedForAfk é chamada pelo script.js principal após o login,
    // garantindo que os dados do jogador estejam disponíveis para iniciar o AFK.
};
