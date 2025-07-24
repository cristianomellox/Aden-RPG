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

// Novos elementos de jogo
const gainXpBtn = document.getElementById('gainXpBtn');
const gainGoldBtn = document.getElementById('gainGoldBtn');
const gameMessage = document.getElementById('gameMessage');

// Novos elementos do menu do rodapé
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
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        authMessage.textContent = `Erro ao fazer login: ${error.message}`;
        console.error('Erro ao fazer login:', error);
    } else {
        authMessage.textContent = ''; // Limpa a mensagem de erro
        fetchAndDisplayPlayerInfo();
        subscribeToChat();
        updateUIVisibility(true); // Mostra o menu e o balão de chat
    }
}

async function signUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
        authMessage.textContent = `Erro ao registrar: ${error.message}`;
        console.error('Erro ao registrar:', error);
    } else {
        authMessage.textContent = 'Registro realizado! Verifique seu email para confirmar a conta.';
        // Não redirecionamos para fetchAndDisplayPlayerInfo() aqui,
        // pois a conta precisa ser confirmada primeiro.
    }
}

async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Erro ao sair:', error.message);
    } else {
        updateUIVisibility(false); // Esconde tudo
        chatBox.innerHTML = ''; // Limpa o chat
        // Opcional: recarrega a página para limpar o estado
        // window.location.reload();
    }
}

// Funções de Perfil do Jogador
async function fetchAndDisplayPlayerInfo() {
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (user) {
        authContainer.style.display = 'none'; // Esconde autenticação

        const { data: player, error } = await supabaseClient
            .from('players')
            .select('id, created_at, name, faction, level, xp, gold, health, mana, attack, defense, combat_power, ranking_points, guild_id, crystals, current_afk_stage, last_afk_start_time, rank, is_silenced_until, is_banned, last_active')
            .eq('id', user.id)
            .single();

        if (error) {
            console.error('Erro ao buscar informações do jogador:', error);
            // Se o jogador não tem perfil, ou é novo, mostra o modal
            profileEditModal.style.display = 'flex';
            editPlayerNameInput.value = user.email.split('@')[0]; // Sugere nome baseado no email
            editPlayerFactionSelect.value = 'Aliança da Floresta'; // Facção padrão no modal
            updateUIVisibility(false); // Garante que o menu esteja oculto enquanto o modal está aberto
            return;
        }

        // Se o rank for 'Aventureiro(a)' E o nome ainda for o email (indicando perfil padrão recém-criado)
        if (player.rank === 'Aventureiro(a)' && player.name === user.email) {
            profileEditModal.style.display = 'flex';
            editPlayerNameInput.value = player.name; // Preenche com o nome atual (que é o email)
            editPlayerFactionSelect.value = player.faction; // Preenche com a facção atual ('Nenhuma')
            updateUIVisibility(false); // Garante que o menu esteja oculto enquanto o modal está aberto
            return;
        }

        // Se não é um perfil novo ou já foi editado, exibe as informações normais e o jogo
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
        updateUIVisibility(true); // Mostra o menu e o balão de chat
        document.getElementById('signOutBtn').onclick = signOut; // Reatribuir o listener

    } else {
        // Se não há usuário logado, esconde tudo e mostra o login
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
        fetchAndDisplayPlayerInfo(); // Atualiza as informações exibidas
        updateUIVisibility(true); // Mostra o menu e o balão de chat
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
        newCombatPower = (newHealth + newMana + newAttack + newDefense) * currentLevel / 10;
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
        fetchAndDisplayPlayerInfo();
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
        fetchAndDisplayPlayerInfo();
    }
}

// Funções de Chat
async function sendMessage() {
    const messageText = chatInput.value.trim();
    if (messageText === '') return;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        console.error('Nenhum usuário logado para enviar mensagem.');
        return;
    }

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('name, rank') // Buscar o rank para verificar permissão
        .eq('id', user.id)
        .single();

    if (playerError) {
        console.error('Erro ao buscar nome/rank do jogador para o chat:', playerError);
        return;
    }

    // Verificação de Rank para chat global
    // Conforme o resumo: Apenas "Monarcas" e "Nobres" podem escrever
    if (player.rank !== 'Monarca' && player.rank !== 'Nobre') {
        authMessage.textContent = 'Apenas Monarcas e Nobres podem escrever no chat global.';
        setTimeout(() => { authMessage.textContent = ''; }, 5000);
        return;
    }

    // Limite de caracteres para mensagens
    if (messageText.length > 200) {
        authMessage.textContent = 'Mensagem muito longa! Máximo de 200 caracteres.';
        setTimeout(() => { authMessage.textContent = ''; }, 5000);
        return;
    }

    const playerName = player ? player.name : 'Desconhecido';

    const { error } = await supabaseClient
        .from('chat_messages')
        .insert({ user_id: user.id, username: playerName, message: messageText });

    if (error) {
        console.error('Erro ao enviar mensagem:', error);
        if (error.code === '42501') {
            authMessage.textContent = 'Permissão negada para enviar mensagem. Verifique seu Rank.';
            setTimeout(() => { authMessage.textContent = ''; }, 5000);
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
    // Inscreve-se nas últimas 20 mensagens (precisaria de uma view ou função no DB para isso)
    // Por enquanto, apenas busca as mensagens e se inscreve em novas
    supabaseClient
        .channel('chat_messages_channel') // Nome do canal para Realtime
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
            // Apenas exibe as 20 últimas mensagens
            loadInitialChatMessages(); // Recarrega para manter o limite de 20
        })
        .subscribe();

    loadInitialChatMessages();
}

async function loadInitialChatMessages() {
    // Buscar apenas as últimas 20 mensagens
    const { data: messages, error } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false }) // Ordena do mais novo para o mais antigo
        .limit(20); // Limita a 20 mensagens

    if (error) {
        console.error('Erro ao carregar mensagens iniciais:', error);
        return;
    }
    chatBox.innerHTML = ''; // Limpa antes de carregar
    messages.reverse().forEach(displayChatMessage); // Inverte para exibir do mais antigo para o mais novo
}


// --- Funções dos Botões do Menu ---
function showGuildMenu() {
    alert("Menu da Guilda (Em desenvolvimento)");
    // Futuramente, irá mostrar a interface da guilda
}

function showPvPMenu() {
    alert("Menu de PvP (Em desenvolvimento)");
    // Futuramente, irá mostrar a interface de PvP
}

function showAfkMenu() {
    alert("Menu AFK (Aventura e Idle - Em desenvolvimento)");
    // Futuramente, irá mostrar a interface AFK
}

function showMiningMenu() {
    alert("Menu de Mineração (Em desenvolvimento)");
    // Futuramente, irá mostrar a interface de Mineração
}

function showCastlesMenu() {
    alert("Menu de Castelos (Em desenvolvimento)");
    // Futuramente, irá mostrar a interface de Castelos
}

// --- Funções de Visibilidade da UI ---
function updateUIVisibility(isLoggedIn) {
    if (isLoggedIn) {
        playerInfoDiv.style.display = 'block';
        gameContainer.style.display = 'block';
        // chatContainer.style.display = 'block'; // Chat agora é controlado pelo balão
        authContainer.style.display = 'none';
        footerMenu.style.display = 'flex'; // Mostra o menu do rodapé
        chatBubble.style.display = 'flex'; // Mostra o balão de chat
    } else {
        authContainer.style.display = 'block';
        playerInfoDiv.style.display = 'none';
        gameContainer.style.display = 'none';
        chatContainer.style.display = 'none';
        profileEditModal.style.display = 'none'; // Garante que o modal esteja oculto
        footerMenu.style.display = 'none'; // Esconde o menu do rodapé
        chatBubble.style.display = 'none'; // Esconde o balão de chat
    }
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

    // Listeners para os botões do rodapé
    guildBtn.addEventListener('click', showGuildMenu);
    pvpBtn.addEventListener('click', showPvPMenu);
    afkBtn.addEventListener('click', showAfkMenu);
    miningBtn.addEventListener('click', showMiningMenu);
    castlesBtn.addEventListener('click', showCastlesMenu);

    // Listener para o balão de chat
    chatBubble.addEventListener('click', () => {
        chatContainer.style.display = chatContainer.style.display === 'none' ? 'block' : 'none';
        if (chatContainer.style.display === 'block') {
            loadInitialChatMessages(); // Carrega mensagens ao abrir
        }
    });


    // Inicializa a UI com base no estado de autenticação
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            fetchAndDisplayPlayerInfo();
            // A inscrição no chat ocorre após fetchAndDisplayPlayerInfo para garantir que o perfil seja carregado
        } else {
            updateUIVisibility(false); // Esconde elementos se deslogado
        }
    });

    // Chama fetchAndDisplayPlayerInfo no carregamento inicial da página
    fetchAndDisplayPlayerInfo();
});
