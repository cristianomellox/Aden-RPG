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
        authContainer.style.display = 'block';
        playerInfoDiv.style.display = 'none';
        gameContainer.style.display = 'none';
        chatContainer.style.display = 'none';
        profileEditModal.style.display = 'none'; // Garante que o modal esteja oculto
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
            .select('*')
            .eq('id', user.id)
            .single();

        if (error) {
            console.error('Erro ao buscar informações do jogador:', error);
            // Se o perfil não for encontrado ou houver outro erro, exibir o modal de edição
            // Isso pode acontecer se o trigger falhar ou for um usuário novo ainda não processado.
            profileEditModal.style.display = 'flex';
            editPlayerNameInput.value = user.email.split('@')[0]; // Sugere nome baseado no email
            editPlayerFactionSelect.value = 'Reino Ocidental'; // Facção padrão no modal
            return; // Impede a exibição do playerInfoDiv até o perfil ser salvo
        }

        // Se o rank for 'Novato' E o nome ainda for o email (indicando perfil padrão recém-criado)
        if (player.rank === 'Novato' && player.name === user.email) {
            profileEditModal.style.display = 'flex';
            editPlayerNameInput.value = player.name; // Preenche com o nome atual (que é o email)
            editPlayerFactionSelect.value = player.faction; // Preenche com a facção atual (Nenhuma)
            return; // Impede a exibição do playerInfoDiv até o perfil ser salvo
        }

        // Se não é um perfil novo ou já foi editado, exibe as informações normais e o jogo
        playerInfoDiv.innerHTML = `
            <p>Olá, ${player.name}!</p>
            <p>Nível: ${player.level}</p>
            <p>XP: ${player.xp}</p>
            <p>Ouro: ${player.gold}</p>
            <p>Classe: ${player.class}</p>
            <p>Facção: ${player.faction}</p>
            <p>Rank: ${player.rank}</p>
            <button id="signOutBtn">Sair</button>
        `;
        playerInfoDiv.style.display = 'block';
        gameContainer.style.display = 'block';
        chatContainer.style.display = 'block';

        // Reatribuir o listener para o botão de sair, pois o innerHTML o recria
        document.getElementById('signOutBtn').onclick = signOut;

    } else {
        // Se não há usuário logado, esconde tudo e mostra o login
        authContainer.style.display = 'block';
        playerInfoDiv.style.display = 'none';
        gameContainer.style.display = 'none';
        chatContainer.style.display = 'none';
        profileEditModal.style.display = 'none'; // Garante que o modal esteja oculto
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
        .update({ name: newName, faction: newFaction, rank: 'Novato' }) // Define rank como 'Novato' após edição inicial
        .eq('id', user.id);

    if (error) {
        console.error('Erro ao salvar perfil:', error);
        profileEditMessage.textContent = `Erro ao salvar perfil: ${error.message}`;
    } else {
        profileEditMessage.textContent = "Perfil salvo com sucesso!";
        profileEditModal.style.display = 'none'; // Esconde o modal
        fetchAndDisplayPlayerInfo(); // Atualiza as informações exibidas
    }
});


// Funções de Chat
async function sendMessage() {
    const messageText = chatInput.value.trim();
    if (messageText === '') return;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        console.error('Nenhum usuário logado para enviar mensagem.');
        return;
    }

    // Busca o nome do jogador para exibir no chat
    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('name')
        .eq('id', user.id)
        .single();

    if (playerError) {
        console.error('Erro ao buscar nome do jogador para o chat:', playerError);
        return;
    }

    const playerName = player ? player.name : 'Desconhecido';

    const { error } = await supabaseClient
        .from('chat_messages')
        .insert({ user_id: user.id, username: playerName, message: messageText });

    if (error) {
        console.error('Erro ao enviar mensagem:', error);
        // Exemplo: Se a RLS negar, o usuário verá isso
        if (error.code === '42501') { // Código de erro para RLS denial
             // Isso é o esperado para usuários comuns tentando postar.
            authMessage.textContent = 'Permissão negada para enviar mensagem. Verifique seu Rank.'; // Use authMessage ou crie uma específica para o chat
            setTimeout(() => { authMessage.textContent = ''; }, 5000); // Limpa após 5 segundos
        }
    } else {
        chatInput.value = ''; // Limpa o input
    }
}

function displayChatMessage(message) {
    const p = document.createElement('p');
    p.classList.add('chat-message');
    p.innerHTML = `<strong>[${message.username}]</strong>: ${message.message}`;
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight; // Rola para o final
}

function subscribeToChat() {
    supabaseClient
        .channel('chat_messages')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, payload => {
            if (payload.eventType === 'INSERT') {
                displayChatMessage(payload.new);
            }
            // Você pode adicionar lógica para UPDATE/DELETE aqui se necessário
        })
        .subscribe();

    // Carregar mensagens existentes
    loadInitialChatMessages();
}

async function loadInitialChatMessages() {
    const { data: messages, error } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true }); // Ordena por data

    if (error) {
        console.error('Erro ao carregar mensagens iniciais:', error);
        return;
    }
    chatBox.innerHTML = ''; // Limpa antes de carregar
    messages.forEach(displayChatMessage);
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

    // Inicializa a UI com base no estado de autenticação
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            fetchAndDisplayPlayerInfo();
            subscribeToChat();
        } else {
            fetchAndDisplayPlayerInfo(); // Esconde elementos se deslogado
        }
    });

    // Chama fetchAndDisplayPlayerInfo no carregamento inicial da página
    fetchAndDisplayPlayerInfo();
});
