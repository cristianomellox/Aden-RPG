// Configuração do Supabase
// **ATENÇÃO: Substitua estes valores pelos do seu projeto Supabase!**
const SUPABASE_URL = 'SUA_SUPABASE_PROJECT_URL_AQUI'; // Ex: 'https://abcdefg1234.supabase.co'
const SUPABASE_ANON_KEY = 'SUA_SUPABASE_ANON_KEY_AQUI'; // Ex: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

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

// NOVOS Elementos do menu do rodapé e balão de chat
const footerMenu = document.getElementById('footerMenu');
const guildBtn = document.getElementById('guildBtn');
const pvpBtn = document.getElementById('pvpBtn');
const afkBtn = document.getElementById('afkBtn');
const miningBtn = document.getElementById('miningBtn');
const castlesBtn = document.getElementById('castlesBtn');
const chatBubble = document.getElementById('chatBubble');


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
        // Esconde o container de autenticação imediatamente
        authContainer.style.display = 'none';

        const { data: player, error } = await supabaseClient
            .from('players')
            .select('id, created_at, name, faction, level, xp, gold, health, mana, attack, defense, combat_power, ranking_points, guild_id, crystals, current_afk_stage, last_afk_start_time, rank, is_silenced_until, is_banned, last_active')
            .eq('id', user.id)
            .single();

        // Verifica se houve erro ou se o perfil é novo/padrão
        if (error || (player.rank === 'Aventureiro(a)' && player.name === user.email)) {
            profileEditModal.style.display = 'flex';
            editPlayerNameInput.value = player ? player.name : user.email.split('@')[0];
            editPlayerFactionSelect.value = player ? player.faction : 'Aliança da Floresta';
            updateUIVisibility(false); // Esconde a UI do jogo para garantir que só o modal apareça
            return; // Interrompe a função aqui
        }

        // Se o perfil é válido e não precisa de edição, exibe as informações normais do jogo
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

        // Se tudo está OK, mostra a UI do jogo
        updateUIVisibility(true);
        subscribeToChat(); // Subscreve ao chat apenas quando o jogador está no jogo.

    } else {
        // Se não há usuário logado, garante que apenas a tela de login esteja visível.
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


// --- Funções dos Botões do Menu ---
function showGuildMenu() {
    gameMessage.textContent = "Menu da Guilda (Em desenvolvimento)";
    setTimeout(() => { gameMessage.textContent = ''; }, 3000);
}

function showPvPMenu() {
    gameMessage.textContent = "Menu de PvP (Em desenvolvimento)";
    setTimeout(() => { gameMessage.textContent = ''; }, 3000);
}

function showAfkMenu() {
    gameMessage.textContent = "Menu AFK (Aventura e Idle - Em desenvolvimento)";
    setTimeout(() => { gameMessage.textContent = ''; }, 3000);
}

function showMiningMenu() {
    gameMessage.textContent = "Menu de Mineração (Em desenvolvimento)";
    setTimeout(() => { gameMessage.textContent = ''; }, 3000);
}

function showCastlesMenu() {
    gameMessage.textContent = "Menu de Castelos (Em desenvolvimento)";
    setTimeout(() => { gameMessage.textContent = ''; }, 3000);
}

// --- Funções de Visibilidade da UI ---
// showGameUI: true para mostrar a interface do jogo (com menu), false para mostrar o login.
function updateUIVisibility(showGameUI) {
    if (showGameUI) {
        authContainer.style.display = 'none';
        playerInfoDiv.style.display = 'block';
        gameContainer.style.display = 'block';
        footerMenu.style.display = 'flex'; // Mostra o menu do rodapé
        chatBubble.style.display = 'flex'; // Mostra o balão de chat
    } else {
        authContainer.style.display = 'block'; // Mostra login
        playerInfoDiv.style.display = 'none';
        gameContainer.style.display = 'none';
        footerMenu.style.display = 'none'; // Esconde o menu do rodapé
        chatBubble.style.display = 'none'; // Esconde o balão de chat
        chatContainer.style.display = 'none'; // Garante que o chat esteja fechado
    }
    // O modal de edição de perfil é gerido exclusivamente dentro de fetchAndDisplayPlayerInfo
    profileEditModal.style.display = 'none'; // Garante que o modal esteja oculto por padrão
    authMessage.textContent = ''; // Limpa mensagens de autenticação ao mudar de estado
    gameMessage.textContent = ''; // Limpa mensagens gerais do jogo
}


// Listeners de Eventos
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('signInBtn').addEventListener('click', signIn);
    document.getElementById('signUpBtn').addEventListener('click', signUp);
    document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    if (gainXpBtn) gainXpBtn.addEventListener('click', () => gainXP(100));
    if (gainGoldBtn) gainGoldBtn.addEventListener('click', () => gainGold(50));

    // Listeners para os botões do rodapé (NOVOS)
    if (guildBtn) guildBtn.addEventListener('click', showGuildMenu);
    if (pvpBtn) pvpBtn.addEventListener('click', showPvPMenu);
    if (afkBtn) afkBtn.addEventListener('click', showAfkMenu);
    if (miningBtn) miningBtn.addEventListener('click', showMiningMenu);
    if (castlesBtn) castlesBtn.addEventListener('click', showCastlesMenu);

    // Listener para o balão de chat (NOVO)
    if (chatBubble) chatBubble.addEventListener('click', () => {
        chatContainer.style.display = chatContainer.style.display === 'none' ? 'block' : 'none';
        if (chatContainer.style.display === 'block') {
            loadInitialChatMessages(); // Carrega mensagens ao abrir
            chatInput.focus(); // Foca no input do chat
        }
    });

    // Inicializa a UI com base no estado de autenticação
    // Este listener é o ponto principal de controle da UI após a autenticação.
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            // Se há uma sessão, tenta buscar o perfil do jogador e exibir a UI do jogo/modal
            fetchAndDisplayPlayerInfo();
        } else {
            // Se não há sessão (deslogado), mostra apenas a tela de login
            updateUIVisibility(false);
        }
    });

    // Não precisamos de uma chamada inicial a fetchAndDisplayPlayerInfo() fora do listener,
    // pois onAuthStateChange já será disparado no carregamento da página se houver sessão ativa.
});
