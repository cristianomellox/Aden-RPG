// Configuração do Supabase
// **ATENÇÃO: Substitua estes valores pelos do seu projeto Supabase!**
const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co'; // Ex: 'https://abcdefg1234.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx'; // Ex: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Elementos da UI
const authContainer = document.getElementById('authContainer');
const playerInfoDiv = document.getElementById('playerInfoDiv');
const gameContainer = document.getElementById('gameContainer');
const chatContainer = document.getElementById('chatContainer');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const authMessage = document.getElementById('authMessage');

const profileEditModal = document.getElementById('profileEditModal');
const editPlayerNameInput = document.getElementById('editPlayerName');
const editPlayerFactionSelect = document.getElementById('editPlayerFaction');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileEditMessage = document.getElementById('profileEditMessage');

// Elementos de jogo (para mensagens gerais do jogo, XP/Ouro, e agora chat também)
const gainXpBtn = document.getElementById('gainXpBtn');
const gainGoldBtn = document.getElementById('gainGoldBtn');
const gameMessage = document.getElementById('gameMessage');

// Elementos do menu do rodapé e balão de chat
const footerMenu = document.getElementById('footerMenu');
const guildBtn = document.getElementById('guildBtn');
const pvpBtn = document.getElementById('pvpBtn');
const afkBtn = document.getElementById('afkBtn');
const miningBtn = document.getElementById('miningBtn');
const castlesBtn = document.getElementById('castlesBtn');
const chatBubble = document.getElementById('chatBubble');

// NOVOS Elementos da UI AFK (Adicionados aqui)
const afkContainer = document.getElementById('afkContainer');
const afkStageSpan = document.getElementById('afkStage');
const afkTimeSpan = document.getElementById('afkTime');
const afkXPGainSpan = document.getElementById('afkXPGain');
const afkGoldGainSpan = document.getElementById('afkGoldGain');
const collectAfkRewardsBtn = document.getElementById('collectAfkRewardsBtn');
const startAdventureBtn = document.getElementById('startAdventureBtn');
const afkMessage = document.getElementById('afkMessage');


// Funções de Autenticação
async function signIn() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    authMessage.textContent = 'Tentando fazer login...';
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        authMessage.textContent = `Erro ao fazer login: ${error.message}`;
        console.error('Erro ao fazer login:', error);
    } else {
        authMessage.textContent = ''; // Limpa a mensagem de erro
        // fetchAndDisplayPlayerInfo() e subscribeToChat() serão chamados via onAuthStateChange
    }
}

async function signUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    authMessage.textContent = 'Registrando usuário...';
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
        authMessage.textContent = `Erro ao registrar: ${error.message}`;
        console.error('Erro ao registrar:', error);
    } else {
        authMessage.textContent = 'Registro realizado! Verifique seu email para confirmar a conta.';
    }
}

async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Erro ao sair:', error.message);
    } else {
        // A UI será atualizada via o listener onAuthStateChange
        chatBox.innerHTML = ''; // Limpa o chat
    }
}

// Funções de Perfil do Jogador
async function fetchAndDisplayPlayerInfo() {
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (user) {
        authContainer.style.display = 'none';

        const { data: player, error } = await supabaseClient
            .from('players')
            .select('id, created_at, name, faction, level, xp, gold, health, mana, attack, defense, combat_power, ranking_points, guild_id, crystals, current_afk_stage, last_afk_start_time, rank, is_silenced_until, is_banned, last_active')
            .eq('id', user.id)
            .single();

        if (error || (player.rank === 'Aventureiro(a)' && player.name === user.email)) {
            profileEditModal.style.display = 'flex';
            editPlayerNameInput.value = player ? player.name : user.email.split('@')[0];
            editPlayerFactionSelect.value = player ? player.faction : 'Aliança da Floresta';
            // Quando o modal aparece, escondemos o jogo e o menu
            updateUIVisibility(false); // Esconde a UI do jogo para garantir que só o modal apareça
            footerMenu.style.display = 'none';
            chatBubble.style.display = 'none';
            return;
        }

        playerInfoDiv.innerHTML = `
            <p>Olá, ${player.name}!</p>
            <p>Nível: ${player.level}</p>
            <p>XP: ${player.xp} / ${player.level * 100} (próximo nível)</p>
            <p>Ouro: ${player.gold}</p>
            <p>Facção: ${player.faction}</p>
            <p>Rank: ${player.rank}</p>
            <p>HP: ${player.health} | Mana: ${player.mana}</p>
            <p>Ataque: ${player.attack} | Defesa: ${player.defense}</p>
            <p>Poder de Combate: ${player.combat_power}</p>
            <button id="signOutBtn">Sair</button>
        `;
        document.getElementById('signOutBtn').onclick = signOut;

        // Se tudo está OK, mostra a UI do jogo e o menu/chat bubble
        updateUIVisibility(true, 'gameContainer'); // Mostra o gameContainer por padrão
        subscribeToChat();

        // ** Importante para o AFK **
        updateLastActive(user.id); // Atualiza last_active ao fazer login
        // Se a tela AFK estiver visível, calcula e exibe recompensas
        if (afkContainer.style.display === 'block') {
            calculateAndDisplayAfkRewards(player);
        }

    } else {
        updateUIVisibility(false);
    }
}

// Função para Salvar Perfil
saveProfileBtn.addEventListener('click', async () => {
    const newName = editPlayerNameInput.value.trim();
    const newFaction = editPlayerFactionSelect.value;

    if (!newName) {
        profileEditMessage.textContent = "O nome do jogador não pode ser vazio.";
        return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        profileEditMessage.textContent = "Erro: Usuário não logado.";
        return;
    }

    profileEditMessage.textContent = "Salvando perfil...";

    const { data, error } = await supabaseClient
        .from('players')
        .update({ name: newName, faction: newFaction, rank: 'Aventureiro(a)' })
        .eq('id', user.id);

    if (error) {
        console.error('Erro ao salvar perfil:', error);
        profileEditMessage.textContent = `Erro ao salvar perfil: ${error.message}`;
    } else {
        profileEditMessage.textContent = "Perfil salvo com sucesso!";
        profileEditModal.style.display = 'none'; // Esconde o modal
        fetchAndDisplayPlayerInfo(); // Atualiza as informações exibidas e a UI
    }
});

// FUNÇÕES DE PROGRESSÃO DO JOGADOR
async function gainXP(amount) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        gameMessage.textContent = "Você precisa estar logado para ganhar XP.";
        return;
    }

    const { data: player, error: fetchError } = await supabaseClient
        .from('players')
        .select('xp, level, health, mana, attack, defense, combat_power')
        .eq('id', user.id)
        .single();

    if (fetchError) {
        console.error('Erro ao buscar XP atual:', fetchError);
        gameMessage.textContent = `Erro ao ganhar XP: ${fetchError.message}`;
        return;
    }

    let currentXP = player.xp + amount;
    let currentLevel = player.level;
    let newHealth = player.health;
    let newMana = player.mana;
    let newAttack = player.attack;
    let newDefense = player.defense;
    let newCombatPower = player.combat_power;

    const xpNeededForNextLevel = currentLevel * 100;

    let leveledUp = false;
    if (currentXP >= xpNeededForNextLevel) {
        leveledUp = true;
        currentLevel++;
        currentXP -= xpNeededForNextLevel;

        newHealth += 10;
        newMana += 5;
        newAttack += 2;
        newDefense += 1;
        // Recálculo do Poder de Combate: Pode ser mais complexo no futuro
        newCombatPower = Math.floor((newHealth + newMana + newAttack + newDefense) * currentLevel / 10);
    }

    const { error: updateError } = await supabaseClient
        .from('players')
        .update({
            xp: currentXP,
            level: currentLevel,
            health: newHealth,
            mana: newMana,
            attack: newAttack,
            defense: newDefense,
            combat_power: newCombatPower
        })
        .eq('id', user.id);

    if (updateError) {
        console.error('Erro ao atualizar XP/Nível:', updateError);
        gameMessage.textContent = `Erro ao atualizar XP/Nível: ${updateError.message}`;
    } else {
        if (leveledUp) {
            gameMessage.textContent = `PARABÉNS! Você alcançou o Nível ${currentLevel} e seus atributos aumentaram!`;
        } else {
            gameMessage.textContent = `Você ganhou ${amount} XP!`;
        }
        fetchAndDisplayPlayerInfo(); // Atualiza a exibição de stats
    }
}

async function gainGold(amount) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        gameMessage.textContent = "Você precisa estar logado para ganhar Ouro.";
        return;
    }

    const { data: player, error: fetchError } = await supabaseClient
        .from('players')
        .select('gold')
        .eq('id', user.id)
        .single();

    if (fetchError) {
        console.error('Erro ao buscar Ouro atual:', fetchError);
        gameMessage.textContent = `Erro ao ganhar Ouro: ${fetchError.message}`;
        return;
    }

    const newGold = player.gold + amount;

    const { error: updateError } = await supabaseClient
        .from('players')
        .update({ gold: newGold })
        .eq('id', user.id);

    if (updateError) {
        console.error('Erro ao atualizar Ouro:', updateError);
        gameMessage.textContent = `Erro ao ganhar Ouro: ${updateError.message}`;
    } else {
        gameMessage.textContent = `Você ganhou ${amount} Ouro! Total: ${newGold}`;
        fetchAndDisplayPlayerInfo(); // Atualiza a exibição de stats
    }
}

// Funções de Chat
async function sendMessage() {
    const messageText = chatInput.value.trim();
    if (messageText === '') return;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        console.error('Nenhum usuário logado para enviar mensagem.');
        gameMessage.textContent = 'Você precisa estar logado para enviar mensagens.';
        setTimeout(() => { gameMessage.textContent = ''; }, 3000);
        return;
    }

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('name, rank')
        .eq('id', user.id)
        .single();

    if (playerError) {
        console.error('Erro ao buscar nome/rank do jogador para o chat:', playerError);
        gameMessage.textContent = 'Erro ao verificar seu perfil para o chat.';
        setTimeout(() => { gameMessage.textContent = ''; }, 3000);
        return;
    }

    // Verificação de Rank para chat global
    if (player.rank !== 'Monarca' && player.rank !== 'Nobre') {
        gameMessage.textContent = 'Apenas Monarcas e Nobres podem escrever no chat global.';
        setTimeout(() => { gameMessage.textContent = ''; }, 5000);
        return;
    }

    // Limite de caracteres para mensagens
    if (messageText.length > 200) {
        gameMessage.textContent = 'Mensagem muito longa! Máximo de 200 caracteres.';
        setTimeout(() => { gameMessage.textContent = ''; }, 5000);
        return;
    }

    const playerName = player ? player.name : 'Desconhecido';

    const { error } = await supabaseClient
        .from('chat_messages')
        .insert({ user_id: user.id, username: playerName, message: messageText });

    if (error) {
        console.error('Erro ao enviar mensagem:', error);
        if (error.code === '42501') {
            gameMessage.textContent = 'Permissão negada para enviar mensagem (RLS).';
            setTimeout(() => { gameMessage.textContent = ''; }, 5000);
        } else {
             gameMessage.textContent = `Erro ao enviar mensagem: ${error.message}`;
             setTimeout(() => { gameMessage.textContent = ''; }, 5000);
        }
    } else {
        chatInput.value = '';
    }
}

function displayChatMessage(message) {
    const p = document.createElement('p');
    p.classList.add('chat-message');
    p.innerHTML = `<strong>[${message.username}]</strong>: ${message.message}`;
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function subscribeToChat() {
    // Remove qualquer inscrição anterior para evitar duplicação
    supabaseClient.removeChannel('chat_messages_channel');

    supabaseClient
        .channel('chat_messages_channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
            loadInitialChatMessages();
        })
        .subscribe();

    loadInitialChatMessages(); // Carrega mensagens iniciais ao se inscrever
}

async function loadInitialChatMessages() {
    const { data: messages, error } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Erro ao carregar mensagens iniciais:', error);
        return;
    }
    chatBox.innerHTML = '';
    messages.reverse().forEach(displayChatMessage);
}


// --- Funções AFK (Novas e Modificadas) ---
async function calculateAndDisplayAfkRewards(playerData) {
    afkMessage.textContent = 'Calculando recompensas AFK...';
    if (!playerData || !playerData.last_afk_start_time) {
        afkTimeSpan.textContent = 'N/A';
        afkXPGainSpan.textContent = '0';
        afkGoldGainSpan.textContent = '0';
        afkMessage.textContent = 'Nenhum tempo AFK registrado ou dados do jogador insuficientes para cálculo.';
        collectAfkRewardsBtn.disabled = true; // Desabilita botão se não há o que coletar
        return;
    }

    const lastAfkStartTime = new Date(playerData.last_afk_start_time).getTime();
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

    const estimatedXPGain = Math.floor(xpPerMinutePerStage * effectiveAfkMinutes * playerData.current_afk_stage);
    const estimatedGoldGain = Math.floor(goldPerMinutePerStage * effectiveAfkMinutes * playerData.current_afk_stage);

    afkStageSpan.textContent = playerData.current_afk_stage;
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
        .select('xp, gold, level, health, mana, attack, defense, combat_power')
        .eq('id', user.id)
        .single();

    if (fetchError) {
        console.error('Erro ao buscar jogador para coletar recompensas:', fetchError);
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
        // Atualiza a exibição de informações do jogador
        fetchAndDisplayPlayerInfo();
        // Recalcula recompensas para mostrar que foi resetado
        calculateAndDisplayAfkRewards({ current_afk_stage: player.current_afk_s
