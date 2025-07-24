// Configuração do Supabase (AQUI!)
// **ATENÇÃO: Substitua estes valores pelos do seu projeto Supabase!**
const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co'; // Ex: 'https://abcdefg1234.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx'; // Ex: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

// Define supabaseClient globalmente para ser acessível em outros scripts
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Elementos da UI
const authContainer = document.getElementById('authContainer');
const playerInfoDiv = document.getElementById('playerInfoDiv');
// Removido gameContainer
const chatContainer = document.getElementById('chatContainer');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const authMessage = document.getElementById('authMessage');

const profileEditModal = document.getElementById('profileEditModal');
const editPlayerNameInput = document.getElementById('editPlayerName');
const editPlayerFactionSelect = document.getElementById('editPlayerFaction');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileEditMessage = document.getElementById('profileEditMessage');

// Removido gainXpBtn, gainGoldBtn, gameMessage
// Elementos de jogo (para mensagens gerais do jogo, agora usaremos afkMessage para fins de teste)
const afkMessage = document.getElementById('afkMessage'); // Reutilizando para mensagens gerais temporariamente

// Elementos do menu do rodapé e balão de chat
const footerMenu = document.getElementById('footerMenu');
const guildBtn = document.getElementById('guildBtn');
const pvpBtn = document.getElementById('pvpBtn');
const afkBtn = document.getElementById('afkBtn');
const miningBtn = document.getElementById('miningBtn');
const castlesBtn = document.getElementById('castlesBtn');
const chatBubble = document.getElementById('chatBubble');

// Referência ao container AFK
const afkContainer = document.getElementById('afkContainer');


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
// Agora, fetchAndDisplayPlayerInfo pode receber um callback para o AFK script
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

        updateUIVisibility(true, 'playerInfoDiv'); // Mostra o playerInfoDiv por padrão
        subscribeToChat();
        updateLastActive(user.id); // Atualiza last_active ao fazer login

        // ** Novo: Chama uma função no script AFK se ele existir e for relevante **
        // Verificamos se `window.onPlayerInfoLoadedForAfk` existe
        if (typeof window.onPlayerInfoLoadedForAfk === 'function') {
            window.onPlayerInfoLoadedForAfk(player);
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

// FUNÇÕES DE PROGRESSÃO DO JOGADOR (ainda necessárias para as recompensas AFK)
// Estas funções agora são chamadas internamente pelo afk_script.js
async function gainXP(userId, amount) {
    const { data: player, error: fetchError } = await supabaseClient
        .from('players')
        .select('xp, level, health, mana, attack, defense, combat_power')
        .eq('id', userId)
        .single();

    if (fetchError) {
        console.error('Erro ao buscar XP atual:', fetchError);
        // Não exibe mensagem na UI aqui, pois a chamada virá do AFK script
        return { success: false, message: `Erro ao buscar XP: ${fetchError.message}` };
    }

    let currentXP = player.xp + amount;
    let currentLevel = player.level;
    let newHealth = player.health;
    let newMana = player.mana;
    let newAttack = player.attack;
    let newDefense = player.defense;
    let newCombatPower = player.combat_power;
    let leveledUp = false;

    const xpNeededForNextLevel = currentLevel * 100;

    if (currentXP >= xpNeededForNextLevel) {
        leveledUp = true;
        currentLevel++;
        currentXP -= xpNeededForNextLevel;

        newHealth += 10;
        newMana += 5;
        newAttack += 2;
        newDefense += 1;
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
        .eq('id', userId);

    if (updateError) {
        console.error('Erro ao atualizar XP/Nível:', updateError);
        return { success: false, message: `Erro ao atualizar XP/Nível: ${updateError.message}` };
    } else {
        return { success: true, leveledUp: leveledUp, newLevel: currentLevel, message: `Ganhou ${amount} XP.` };
    }
}

async function gainGold(userId, amount) {
    const { data: player, error: fetchError } = await supabaseClient
        .from('players')
        .select('gold')
        .eq('id', userId)
        .single();

    if (fetchError) {
        console.error('Erro ao buscar Ouro atual:', fetchError);
        return { success: false, message: `Erro ao buscar Ouro: ${fetchError.message}` };
    }

    const newGold = player.gold + amount;

    const { error: updateError } = await supabaseClient
        .from('players')
        .update({ gold: newGold })
        .eq('id', userId);

    if (updateError) {
        console.error('Erro ao atualizar Ouro:', updateError);
        return { success: false, message: `Erro ao atualizar Ouro: ${updateError.message}` };
    } else {
        return { success: true, message: `Ganhou ${amount} Ouro.` };
    }
}

// EXPOR FUNÇÕES DE PROGRESSÃO GLOBALMENTE PARA USO PELO AFK SCRIPT
window.gainXP = gainXP;
window.gainGold = gainGold;


// Funções de Chat
async function sendMessage() {
    const messageText = chatInput.value.trim();
    if (messageText === '') return;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        console.error('Nenhum usuário logado para enviar mensagem.');
        afkMessage.textContent = 'Você precisa estar logado para enviar mensagens.'; // Usando afkMessage temporariamente
        setTimeout(() => { afkMessage.textContent = ''; }, 3000);
        return;
    }

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('name, rank')
        .eq('id', user.id)
        .single();

    if (playerError) {
        console.error('Erro ao buscar nome/rank do jogador para o chat:', playerError);
        afkMessage.textContent = 'Erro ao verificar seu perfil para o chat.';
        setTimeout(() => { afkMessage.textContent = ''; }, 3000);
        return;
    }

    // Verificação de Rank para chat global
    if (player.rank !== 'Monarca' && player.rank !== 'Nobre') {
        afkMessage.textContent = 'Apenas Monarcas e Nobres podem escrever no chat global.';
        setTimeout(() => { afkMessage.textContent = ''; }, 5000);
        return;
    }

    // Limite de caracteres para mensagens
    if (messageText.length > 200) {
        afkMessage.textContent = 'Mensagem muito longa! Máximo de 200 caracteres.';
        setTimeout(() => { afkMessage.textContent = ''; }, 5000);
        return;
    }

    const playerName = player ? player.name : 'Desconhecido';

    const { error } = await supabaseClient
        .from('chat_messages')
        .insert({ user_id: user.id, username: playerName, message: messageText });

    if (error) {
        console.error('Erro ao enviar mensagem:', error);
        if (error.code === '42501') {
            afkMessage.textContent = 'Permissão negada para enviar mensagem (RLS).';
            setTimeout(() => { afkMessage.textContent = ''; }, 5000);
        } else {
             afkMessage.textContent = `Erro ao enviar mensagem: ${error.message}`;
             setTimeout(() => { afkMessage.textContent = ''; }, 5000);
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


// Função para atualizar last_active do jogador
async function updateLastActive(userId) {
    const { error } = await supabaseClient
        .from('players')
        .update({ last_active: new Date().toISOString() })
        .eq('id', userId);

    if (error) {
        console.error('Erro ao atualizar last_active:', error);
    }
}


// --- Funções de Visibilidade da UI (Refatorada) ---
// showGameUI: true para mostrar a interface do jogo (com menu), false para mostrar o login.
// activeContainerId: o ID do container (ex: 'playerInfoDiv', 'chatContainer', 'afkContainer') a ser exibido.
function updateUIVisibility(showGameUI, activeContainerId = 'playerInfoDiv') {
    // Primeiro, ocultamos todos os containers de jogo
    playerInfoDiv.style.display = 'none';
    chatContainer.style.display = 'none';
    afkContainer.style.display = 'none';
    profileEditModal.style.display = 'none'; // Garante que o modal esteja oculto por padrão

    if (showGameUI) {
        authContainer.style.display = 'none';
        footerMenu.style.display = 'flex'; // Mostra o menu do rodapé
        chatBubble.style.display = 'flex'; // Mostra o balão de chat

        // Em seguida, mostramos o container ativo
        const activeDiv = document.getElementById(activeContainerId);
        if (activeDiv) {
            activeDiv.style.display = 'block';
        } else {
            // Fallback: se o ID for inválido, mostra o playerInfoDiv por segurança
            playerInfoDiv.style.display = 'block';
        }
    } else {
        // Se não estamos no jogo (tela de login)
        authContainer.style.display = 'block'; // Mostra login
        playerInfoDiv.style.display = 'none';
        footerMenu.style.display = 'none'; // Esconde o menu do rodapé
        chatBubble.style.display = 'none'; // Esconde o balão de chat
    }
    authMessage.textContent = ''; // Limpa mensagens de autenticação ao mudar de estado
    afkMessage.textContent = ''; // Limpa mensagens AFK/gerais
}


// --- Funções dos Botões do Menu (Agora usam updateUIVisibility) ---
function showGuildMenu() {
    updateUIVisibility(true, 'playerInfoDiv'); // Volta para playerInfoDiv por enquanto
    afkMessage.textContent = "Menu da Guilda (Em desenvolvimento)";
    setTimeout(() => { afkMessage.textContent = ''; }, 3000);
    // Futuramente: updateUIVisibility(true, 'guildContainer');
}

function showPvPMenu() {
    updateUIVisibility(true, 'playerInfoDiv'); // Volta para playerInfoDiv por enquanto
    afkMessage.textContent = "Menu de PvP (Em desenvolvimento)";
    setTimeout(() => { afkMessage.textContent = ''; }, 3000);
    // Futuramente: updateUIVisibility(true, 'pvpContainer');
}

function showAfkMenu() {
    updateUIVisibility(true, 'afkContainer'); // Mostra o container AFK
    // Chama a função no script AFK para iniciar o cálculo
    if (typeof window.initAfkDisplay === 'function') {
        window.initAfkDisplay();
    }
}

function showMiningMenu() {
    updateUIVisibility(true, 'playerInfoDiv'); // Volta para playerInfoDiv por enquanto
    afkMessage.textContent = "Menu de Mineração (Em desenvolvimento)";
    setTimeout(() => { afkMessage.textContent = ''; }, 3000);
    // Futuramente: updateUIVisibility(true, 'miningContainer');
}

function showCastlesMenu() {
    updateUIVisibility(true, 'playerInfoDiv'); // Volta para playerInfoDiv por enquanto
    afkMessage.textContent = "Menu de Castelos (Em desenvolvimento)";
    setTimeout(() => { afkMessage.textContent = ''; }, 3000);
    // Futuramente: updateUIVisibility(true, 'castlesContainer');
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

    // Removido listeners para gainXpBtn e gainGoldBtn

    // Listeners para os botões do rodapé
    if (guildBtn) guildBtn.addEventListener('click', showGuildMenu);
    if (pvpBtn) pvpBtn.addEventListener('click', showPvPMenu);
    if (afkBtn) afkBtn.addEventListener('click', showAfkMenu);
    if (miningBtn) miningBtn.addEventListener('click', showMiningMenu);
    if (castlesBtn) castlesBtn.addEventListener('click', showCastlesMenu);

    // Listener para o balão de chat
    if (chatBubble) chatBubble.addEventListener('click', () => {
        // Se o chat está oculto e será mostrado
        if (chatContainer.style.display === 'none') {
            updateUIVisibility(true, 'chatContainer'); // Mostra apenas o chat container
            loadInitialChatMessages();
            chatInput.focus();
        } else {
            // Se o chat está visível e será ocultado, retorna para o playerInfoDiv padrão
            updateUIVisibility(true, 'playerInfoDiv');
        }
    });

    // Inicializa a UI com base no estado de autenticação
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            fetchAndDisplayPlayerInfo();
        } else {
            updateUIVisibility(false); // Garante que a tela de login esteja visível
        }
    });

});
