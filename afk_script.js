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
// Removida a referência direta a attackButton e alterada para attackArea
const attackArea = document.getElementById('attackArea'); // NOVA REFERÊNCIA
const attackButton = document.getElementById('attackButton'); // Mantido para o listener, mas o display será via attackArea
const attackCountDisplay = document.getElementById('attackCountDisplay');
const remainingAttacksSpan = document.getElementById('remainingAttacks');
const combatLog = document.getElementById('combatLog');
const dailyAttemptsLeftSpan = document.getElementById('dailyAttemptsLeft'); // Novo elemento para exibir tentativas restantes


// Função para calcular recompensas AFK e atualizar UI
async function calculateAndDisplayAfkRewards() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        console.log("Usuário não logado, não é possível calcular recompensas AFK.");
        return;
    }
    currentPlayerId = user.id; // Garante que o ID do jogador esteja atualizado

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('last_afk_start_time, current_afk_stage, xp, gold, daily_attempts_left, last_attempt_reset, health, combat_power')
        .eq('id', currentPlayerId)
        .single();

    if (playerError) {
        console.error('Erro ao buscar dados do jogador para AFK:', playerError.message);
        return;
    }

    currentDailyAttemptsLeft = player.daily_attempts_left;
    dailyAttemptsLeftSpan.textContent = currentDailyAttemptsLeft;
    currentAfkStage = player.current_afk_stage;
    afkStageSpan.textContent = currentAfkStage;
    playerAttackPower = player.combat_power; // Atualiza o poder de ataque do jogador
    playerMaxHealth = player.health; // Atualiza a vida máxima do jogador

    // Reseta tentativas diárias se um novo dia começou
    const lastResetDate = new Date(player.last_attempt_reset);
    const now = new Date();
    if (now.getDate() !== lastResetDate.getDate() ||
        now.getMonth() !== lastResetDate.getMonth() ||
        now.getFullYear() !== lastResetDate.getFullYear()) {
        const { error: resetError } = await supabaseClient
            .from('players')
            .update({ daily_attempts_left: 5, last_attempt_reset: now.toISOString() })
            .eq('id', currentPlayerId);
        if (resetError) {
            console.error('Erro ao resetar tentativas diárias:', resetError.message);
        } else {
            currentDailyAttemptsLeft = 5;
            dailyAttemptsLeftSpan.textContent = 5;
            console.log('Tentativas diárias resetadas.');
        }
    }


    if (player.last_afk_start_time) {
        const lastAfkTime = new Date(player.last_afk_start_time);
        const now = new Date();
        let afkDurationSeconds = Math.floor((now - lastAfkTime) / 1000);

        // Limita o tempo AFK máximo para evitar cálculos excessivos e abusos
        const MAX_AFK_HOURS = 24; // Ex: limite de 24 horas de AFK
        const MAX_AFK_SECONDS = MAX_AFK_HOURS * 3600;
        afkDurationSeconds = Math.min(afkDurationSeconds, MAX_AFK_SECONDS);

        afkTimeSpan.textContent = `${afkDurationSeconds} segundos`;

        // Lógica de recompensa baseada no tempo AFK e estágio
        const xpPerSecondPerStage = 0.1; // Ajuste conforme a economia do jogo
        const goldPerSecondPerStage = 0.05; // Ajuste conforme a economia do jogo

        const estimatedXPGain = Math.floor(afkDurationSeconds * xpPerSecondPerStage * currentAfkStage);
        const estimatedGoldGain = Math.floor(afkDurationSeconds * goldPerSecondPerStage * currentAfkStage);

        afkXPGainSpan.textContent = estimatedXPGain;
        afkGoldGainSpan.textContent = estimatedGoldGain;

        collectAfkRewardsBtn.disabled = afkDurationSeconds === 0;
    } else {
        afkTimeSpan.textContent = '0 segundos';
        afkXPGainSpan.textContent = '0';
        afkGoldGainSpan.textContent = '0';
        collectAfkRewardsBtn.disabled = true;
    }

    // Habilita/desabilita o botão de iniciar aventura se houver tentativas
    if (currentDailyAttemptsLeft > 0 && currentAfkStage < MAX_AFK_STAGE) {
        startAdventureBtn.disabled = false;
    } else {
        startAdventureBtn.disabled = true; // Mantém desabilitado se não houver tentativas
    }
}

async function collectAfkRewards() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('xp, gold, last_afk_start_time, current_afk_stage')
        .eq('id', user.id)
        .single();

    if (playerError) {
        console.error('Erro ao buscar dados do jogador para coletar recompensas:', playerError.message);
        afkMessage.textContent = 'Erro ao coletar recompensas.';
        setTimeout(() => { afkMessage.textContent = ''; }, 3000);
        return;
    }

    if (!player.last_afk_start_time) {
        afkMessage.textContent = 'Nenhuma recompensa AFK para coletar.';
        setTimeout(() => { afkMessage.textContent = ''; }, 3000);
        return;
    }

    const lastAfkTime = new Date(player.last_afk_start_time);
    const now = new Date();
    let afkDurationSeconds = Math.floor((now - lastAfkTime) / 1000);

    const MAX_AFK_HOURS = 24;
    const MAX_AFK_SECONDS = MAX_AFK_HOURS * 3600;
    afkDurationSeconds = Math.min(afkDurationSeconds, MAX_AFK_SECONDS);

    const xpPerSecondPerStage = 0.1;
    const goldPerSecondPerStage = 0.05;

    const xpGained = Math.floor(afkDurationSeconds * xpPerSecondPerStage * player.current_afk_stage);
    const goldGained = Math.floor(afkDurationSeconds * goldPerSecondPerStage * player.current_afk_stage);

    // Atualizar XP e Gold do jogador
    const { error: updateError } = await supabaseClient
        .from('players')
        .update({
            xp: player.xp + xpGained,
            gold: player.gold + goldGained,
            last_afk_start_time: null // Reseta o contador AFK
        })
        .eq('id', user.id);

    if (updateError) {
        console.error('Erro ao atualizar XP e Gold:', updateError.message);
        afkMessage.textContent = 'Erro ao coletar recompensas.';
    } else {
        afkMessage.textContent = `Recompensas coletadas! +${xpGained} XP, +${goldGained} Ouro.`;
        showFloatingMessage(`+${xpGained} XP, +${goldGained} Ouro`);
        await window.fetchAndDisplayPlayerInfo(); // Atualiza as informações do jogador na UI
        afkXPGainSpan.textContent = '0';
        afkGoldGainSpan.textContent = '0';
        afkTimeSpan.textContent = '0 segundos';
        collectAfkRewardsBtn.disabled = true;
    }
    setTimeout(() => { afkMessage.textContent = ''; }, 5000);
}


const MONSTERS = {
    1: { name: "Slime Pequeno", health: 100, xp: 10, gold: 5, combat_power_required: 10 },
    2: { name: "Goblin Jovem", health: 150, xp: 15, gold: 8, combat_power_required: 15 },
    3: { name: "Lobo Faminto", health: 200, xp: 20, gold: 10, combat_power_required: 20 },
    4: { name: "Ogro Forte", health: 300, xp: 30, gold: 15, combat_power_required: 30 },
    5: { name: "Dragão Adormecido", health: 500, xp: 50, gold: 25, combat_power_required: 50 },
    // Adicione mais estágios e monstros aqui
};

const MAX_AFK_STAGE = Object.keys(MONSTERS).length; // Define o estágio máximo com base na quantidade de monstros


async function startAdventure() {
    console.log("startAdventure chamado!");
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        afkMessage.textContent = 'Você precisa estar logado para iniciar uma aventura.';
        setTimeout(() => { afkMessage.textContent = ''; }, 3000);
        return;
    }

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('daily_attempts_left, current_afk_stage, combat_power, health')
        .eq('id', user.id)
        .single();

    if (playerError) {
        console.error('Erro ao buscar dados do jogador para aventura:', playerError.message);
        afkMessage.textContent = 'Erro ao iniciar aventura.';
        setTimeout(() => { afkMessage.textContent = ''; }, 3000);
        return;
    }

    if (player.daily_attempts_left <= 0) {
        afkMessage.textContent = 'Você não tem mais tentativas de aventura hoje. Volte amanhã!';
        startAdventureBtn.disabled = true;
        setTimeout(() => { afkMessage.textContent = ''; }, 5000);
        return;
    }

    if (player.current_afk_stage > MAX_AFK_STAGE) {
        afkMessage.textContent = 'Você já conquistou todos os estágios PvE disponíveis! Aguarde novas atualizações.';
        startAdventureBtn.disabled = true;
        setTimeout(() => { afkMessage.textContent = ''; }, 5000);
        return;
    }

    // Verifica se o poder de combate do jogador é suficiente para o estágio atual
    const currentMonster = MONSTERS[player.current_afk_stage];
    if (player.combat_power < currentMonster.combat_power_required) {
        afkMessage.textContent = `Seu poder de combate (${player.combat_power}) é muito baixo para o estágio ${player.current_afk_stage} (Requerido: ${currentMonster.combat_power_required}). Treine mais!`;
        startAdventureBtn.disabled = true; // Desabilita o botão se o poder for muito baixo
        setTimeout(() => { afkMessage.textContent = ''; }, 7000);
        return;
    }

    // Inicia o combate
    currentMonsterHealth = currentMonster.health;
    remainingAttacks = MAX_ATTACKS;
    combatLog.innerHTML = ''; // Limpa o log de combate
    playerAttackPower = player.combat_power; // Assegura que o poder de ataque está atualizado
    playerMaxHealth = player.health; // Assegura que a vida máxima está atualizada

    // Exibe a UI de combate
    attackArea.style.display = 'flex'; // AGORA: Exibe a nova área de ataque
    monsterHealthPercentageSpan.style.display = 'block';
    attackCountDisplay.style.display = 'block';
    combatLog.style.display = 'block';
    startAdventureBtn.style.display = 'none'; // Esconde o botão de iniciar aventura
    collectAfkRewardsBtn.style.display = 'none'; // Esconde o botão de coletar

    updateMonsterHealthDisplay();
    updateRemainingAttacksDisplay();
    addCombatLogMessage(`Um ${currentMonster.name} apareceu!`);

    afkMessage.textContent = 'Em combate...';
    // O botão Atacar é gerenciado pelo listener de click abaixo
}


function updateMonsterHealthDisplay() {
    const currentMonster = MONSTERS[currentAfkStage];
    const percentage = (currentMonsterHealth / currentMonster.health) * 100;
    monsterCurrentHealthDisplay.textContent = `${Math.max(0, percentage).toFixed(0)}%`;
}

function updateRemainingAttacksDisplay() {
    remainingAttacksSpan.textContent = remainingAttacks;
}

function addCombatLogMessage(message) {
    const p = document.createElement('p');
    p.textContent = message;
    combatLog.appendChild(p);
    combatLog.scrollTop = combatLog.scrollHeight; // Rola para o final
}

// Nova função para exibir o popup de dano
function showDamagePopup(damage, targetElement) {
    const popup = document.getElementById('combatDamagePopup');
    const popupAmount = document.getElementById('popupDamageAmount');

    popupAmount.textContent = damage;
    popup.style.opacity = 1;
    popup.style.transform = 'translate(-50%, 0)'; // Posição inicial

    // Obtém a posição do elemento alvo (monstro ou jogador)
    const rect = targetElement.getBoundingClientRect();
    popup.style.left = `${rect.left + rect.width / 2}px`;
    popup.style.top = `${rect.top - 30}px`; // Acima do elemento

    setTimeout(() => {
        popup.style.opacity = 0;
        popup.style.transform = 'translate(-50%, -20px)'; // Move para cima enquanto desaparece
    }, 800); // Duração do popup
}


attackButton.addEventListener('click', async () => {
    if (remainingAttacks <= 0) {
        addCombatLogMessage('Você não tem mais ataques nesta tentativa.');
        return;
    }

    const currentMonster = MONSTERS[currentAfkStage];
    const damageDealt = Math.max(1, Math.floor(playerAttackPower * (0.8 + Math.random() * 0.4))); // Variação de 80% a 120% do ataque

    currentMonsterHealth -= damageDealt;
    remainingAttacks--;

    addCombatLogMessage(`Você atacou o ${currentMonster.name} e causou ${damageDealt} de dano!`);
    showDamagePopup(damageDealt, attackButton); // Exibe popup de dano no botão (simulando no monstro)

    updateMonsterHealthDisplay();
    updateRemainingAttacksDisplay();

    if (currentMonsterHealth <= 0) {
        addCombatLogMessage(`Você derrotou o ${currentMonster.name}!`);
        await handleCombatEnd(true); // Vitória
    } else if (remainingAttacks === 0) {
        addCombatLogMessage(`Você ficou sem ataques. O ${currentMonster.name} escapou!`);
        await handleCombatEnd(false); // Derrota
    }
});

async function handleCombatEnd(isWin) {
    // Oculta a UI de combate
    attackArea.style.display = 'none'; // AGORA: Oculta a nova área de ataque
    monsterHealthPercentageSpan.style.display = 'none';
    attackCountDisplay.style.display = 'none';
    combatLog.style.display = 'none';

    // Garante que os botões de controle AFK apareçam
    startAdventureBtn.style.display = 'inline-block';
    collectAfkRewardsBtn.style.display = 'inline-block';

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return; // Deveria estar logado neste ponto

    let title = '';
    let message = '';
    let onConfirm = async () => { }; // Função a ser executada ao confirmar o modal

    if (isWin) {
        const currentMonster = MONSTERS[currentAfkStage];
        const xpGained = currentMonster.xp;
        const goldGained = currentMonster.gold;
        const newAfkStage = currentAfkStage + 1;

        title = 'Vitória!';
        message = `Você avançou para o Estágio ${newAfkStage}! Ganhou ${xpGained} XP e ${goldGained} Ouro.`;

        onConfirm = async () => {
            const { error: updateError } = await supabaseClient
                .from('players')
                .update({
                    xp: currentPlayerData.xp + xpGained,
                    gold: currentPlayerData.gold + goldGained,
                    current_afk_stage: newAfkStage,
                    daily_attempts_left: currentDailyAttemptsLeft - 1, // Decrementa uma tentativa
                    last_afk_start_time: new Date().toISOString() // Inicia um novo ciclo AFK
                })
                .eq('id', user.id);

            if (updateError) {
                console.error('Erro ao atualizar jogador após vitória:', updateError.message);
                afkMessage.textContent = 'Erro ao processar vitória.';
            } else {
                await window.fetchAndDisplayPlayerInfo(); // Atualiza infos do jogador
                afkStageSpan.textContent = newAfkStage;
                dailyAttemptsLeftSpan.textContent = currentDailyAttemptsLeft - 1; // Atualiza display
                showFloatingMessage(`Vitória! +${xpGained} XP, +${goldGained} Ouro.`);
                afkMessage.textContent = 'Pronto para a próxima aventura!';
            }
            // Habilita o botão de iniciar aventura se houver tentativas
            if (currentDailyAttemptsLeft - 1 > 0 && newAfkStage <= MAX_AFK_STAGE) {
                startAdventureBtn.disabled = false;
            } else {
                startAdventureBtn.disabled = true; // Mantém desabilitado se não houver tentativas ou se atingiu o estágio máximo
            }
            setTimeout(() => { afkMessage.textContent = ''; }, 5000);
            window.updateUIVisibility(true, 'afkContainer'); // Garante que a tela AFK esteja visível
        };
    } else { // Derrota
        title = 'Derrota!';
        message = 'Você não conseguiu derrotar o monstro. Volte quando estiver mais forte!';

        onConfirm = async () => {
            // Se perder, ainda decrementa uma tentativa e cura o jogador
            const { error: updateError } = await supabaseClient
                .from('players')
                .update({
                    daily_attempts_left: currentDailyAttemptsLeft - 1, // Decrementa uma tentativa
                    health: playerMaxHealth, // Cura o jogador
                    last_afk_start_time: new Date().toISOString() // Inicia um novo ciclo AFK
                })
                .eq('id', user.id);

            if (updateError) {
                console.error('Erro ao atualizar jogador após derrota:', updateError.message);
                afkMessage.textContent = 'Erro ao processar derrota.';
            } else {
                await window.fetchAndDisplayPlayerInfo(); // Atualiza infos do jogador
                dailyAttemptsLeftSpan.textContent = currentDailyAttemptsLeft - 1; // Atualiza display
                showFloatingMessage('Derrota! Tente novamente.');
                afkMessage.textContent = 'Derrotado. Tente novamente quando estiver pronto.';
            }
            // Habilita o botão de iniciar aventura se houver tentativas
            if (currentDailyAttemptsLeft - 1 > 0 && currentAfkStage <= MAX_AFK_STAGE) {
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
    if (collectAfkRewardsBtn) collectAfkRewardsBtn.addEventListener('click', collectAfkRewards);
    if (startAdventureBtn) {
        startAdventureBtn.addEventListener('click', startAdventure);
        console.log("AFK Script: Listener para startAdventureBtn adicionado.");
    }
    // NOVO: Chama calculateAndDisplayAfkRewards a cada segundo para o contador de tempo
    setInterval(calculateAndDisplayAfkRewards, 1000);
    // Adiciona o listener para o attackButton
    if (attackButton) {
        // O listener já está acima, mas garante que esteja anexado após o DOM
    }
});

// Inicialização do AFK
// Esta função será chamada após o carregamento do DOM e o login do usuário
window.initAfk = async () => {
    // A função onPlayerInfoLoadedForAfk já é chamada pelo script.js
    // garantindo que os dados do jogador estejam disponíveis.
    // Não precisamos buscar o usuário novamente aqui.
};
