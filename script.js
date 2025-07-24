// script.js

// Inicialização do Supabase
const supabaseUrl = 'https://lqzlblvmkuwedcofmgfb.supabase.co'; // Substitua pela sua URL do Supabase
const supabaseAnonKey = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx'; // Substitua pela sua chave anon do Supabase
const supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);

// Referências aos elementos HTML
const authContainer = document.getElementById('authContainer');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');
const authMessage = document.getElementById('authMessage');
const playerInfoDiv = document.getElementById('playerInfoDiv');
const profileEditModal = document.getElementById('profileEditModal');
const editPlayerNameInput = document.getElementById('editPlayerName');
const editPlayerFactionSelect = document.getElementById('editPlayerFaction');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileEditMessage = document.getElementById('profileEditMessage');

// Elementos do AFK (declarados aqui para serem acessíveis globalmente ou passados)
const afkContainer = document.getElementById('afkContainer');
// Outros elementos do AFK são declarados e manipulados dentro de afk_script.js

// Elementos do Chat
const chatContainer = document.getElementById('chatContainer');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatBubble = document.getElementById('chatBubble');

// Elementos do rodapé
const footerMenu = document.getElementById('footerMenu');
const guildBtn = document.getElementById('guildBtn');
const pvpBtn = document.getElementById('pvpBtn');
const afkBtn = document.getElementById('afkBtn');
const miningBtn = document.getElementById('miningBtn');
const castlesBtn = document.getElementById('castlesBtn');

// Elemento para mensagens flutuantes
const floatingMessage = document.getElementById('floatingMessage');

// Elementos do Modal de Dano de Combate
const combatDamagePopup = document.getElementById('combatDamagePopup');
const popupDamageAmount = document.getElementById('popupDamageAmount');

// Elementos do Modal de Resultado de Combate
const combatResultModal = document.getElementById('combatResultModal');
const combatResultTitle = document.getElementById('combatResultTitle');
const combatResultMessage = document.getElementById('combatResultMessage');
const confirmCombatResultBtn = document.getElementById('confirmCombatResultBtn');
const nextStageBtn = document.getElementById('nextStageBtn'); // Referência ao novo botão


// --- Funções de Autenticação ---

async function signIn() {
    const email = emailInput.value;
    const password = passwordInput.value;
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        authMessage.textContent = 'Erro ao fazer login: ' + error.message;
    } else {
        authMessage.textContent = 'Login bem-sucedido!';
        console.log('Usuário logado:', data.user);
        checkUserProfile(data.user);
    }
}

async function signUp() {
    const email = emailInput.value;
    const password = passwordInput.value;
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
        authMessage.textContent = 'Erro ao registrar: ' + error.message;
    } else {
        authMessage.textContent = 'Registro bem-sucedido! Verifique seu email para confirmar.';
        console.log('Usuário registrado:', data.user);
        // Após o registro, ainda é necessário que o usuário confirme o email
        // Não chamamos checkUserProfile aqui, pois o email ainda não está confirmado.
        // O perfil será criado na primeira vez que o usuário logar APÓS a confirmação.
    }
}

// --- Funções de Perfil de Jogador ---

async function checkUserProfile(user) {
    if (!user) return;

    const { data: player, error } = await supabaseClient
        .from('players')
        .select('*')
        .eq('id', user.id)
        .single();

    if (error && error.code === 'PGRST116') { // Não encontrado
        console.log("Perfil não encontrado, criando novo perfil...");
        showProfileEditModal(true); // Abre o modal para criar um novo perfil
    } else if (error) {
        console.error('Erro ao buscar perfil:', error.message);
        // Tratar outros erros
    } else {
        console.log("Perfil encontrado:", player);
        currentPlayer = player; // Armazena o perfil do jogador globalmente
        displayPlayerInfo(player);
        updateUIVisibility(true); // Mostra a UI principal do jogo
        profileEditModal.style.display = 'none'; // Esconde o modal de edição
        // Chama a função de inicialização do AFK script
        if (window.onPlayerInfoLoadedForAfk) {
            window.onPlayerInfoLoadedForAfk(player);
        }
        // Inicia o chat ao logar
        setupChat();
    }
}

async function createOrUpdateProfile() {
    const playerName = editPlayerNameInput.value.trim();
    const playerFaction = editPlayerFactionSelect.value;
    const user = (await supabaseClient.auth.getUser()).data.user;

    if (!user) {
        profileEditMessage.textContent = "Erro: Usuário não logado.";
        return;
    }
    if (!playerName) {
        profileEditMessage.textContent = "Por favor, digite um nome para o jogador.";
        return;
    }

    // Verifica se já existe um perfil com esse ID
    const { data: existingPlayer, error: fetchError } = await supabaseClient
        .from('players')
        .select('id')
        .eq('id', user.id)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // Outro erro que não seja 'não encontrado'
        profileEditMessage.textContent = "Erro ao verificar perfil existente: " + fetchError.message;
        return;
    }

    let operation;
    let updateData = {
        name: playerName,
        faction: playerFaction,
        last_login: new Date().toISOString()
    };

    if (existingPlayer) {
        // Atualiza perfil existente
        operation = supabaseClient
            .from('players')
            .update(updateData)
            .eq('id', user.id);
        profileEditMessage.textContent = "Atualizando perfil...";
    } else {
        // Cria novo perfil
        updateData.id = user.id;
        // Valores iniciais para um novo jogador
        updateData.level = 1;
        updateData.xp = 0;
        updateData.gold = 0;
        updateData.health = 100;
        updateData.attack = 10;
        updateData.current_afk_stage = 1; // Começa no estágio 1
        updateData.last_afk_start_time = new Date().toISOString(); // Marca o tempo de início do AFK
        updateData.daily_attempts_left = 5; // 5 tentativas diárias iniciais
        updateData.last_attempt_reset = new Date().toISOString(); // Define o reset para agora

        operation = supabaseClient
            .from('players')
            .insert([updateData]);
        profileEditMessage.textContent = "Criando perfil...";
    }

    const { data, error } = await operation;

    if (error) {
        profileEditMessage.textContent = 'Erro ao salvar perfil: ' + error.message;
        console.error('Erro:', error);
    } else {
        profileEditMessage.textContent = 'Perfil salvo com sucesso!';
        console.log('Perfil salvo/atualizado:', data);
        profileEditModal.style.display = 'none';
        checkUserProfile(user); // Re-carrega o perfil para exibir na UI principal
    }
}

function displayPlayerInfo(player) {
    let content = `
        <p>Nome: ${player.name}</p>
        <p>Facção: ${player.faction}</p>
        <p>Nível: ${player.level}</p>
        <p>XP: ${player.xp}</p>
        <p>Ouro: ${player.gold}</p>
        <p>Vida: ${player.health}</p>
        <p>Ataque: ${player.attack}</p>
        <p>Estágio AFK: ${player.current_afk_stage}</p>
    `;
    playerInfoDiv.innerHTML = content;
}

function showProfileEditModal(isNewPlayer = false) {
    if (isNewPlayer) {
        document.querySelector('#profileEditModal h2').textContent = "Bem-vindo(a), Aventureiro(a)!";
        document.querySelector('#profileEditModal p').textContent = "Seu perfil é novo. Por favor, edite seu nome e escolha sua facção inicial.";
        editPlayerNameInput.value = '';
        editPlayerFactionSelect.value = 'Aliança da Floresta';
    } else {
        document.querySelector('#profileEditModal h2').textContent = "Editar Perfil";
        document.querySelector('#profileEditModal p').textContent = "Edite seu nome ou facção.";
        editPlayerNameInput.value = currentPlayer ? currentPlayer.name : '';
        editPlayerFactionSelect.value = currentPlayer ? currentPlayer.faction : 'Aliança da Floresta';
    }
    profileEditMessage.textContent = '';
    profileEditModal.style.display = 'flex'; // Usar flex para centralizar
}

// --- Funções de XP e Ouro (expostas globalmente para afk_script.js) ---

window.gainXP = async (playerId, amount) => {
    if (amount <= 0) return { success: true, message: "Nenhum XP ganho.", leveledUp: false };

    const { data: player, error } = await supabaseClient
        .from('players')
        .select('xp, level')
        .eq('id', playerId)
        .single();

    if (error) {
        console.error('Erro ao buscar XP do jogador:', error.message);
        return { success: false, message: error.message };
    }

    let newXP = player.xp + amount;
    let newLevel = player.level;
    let leveledUp = false;

    // Lógica de nivelamento (exemplo simples)
    // XP necessário para o próximo nível (exemplo: Nível * 100)
    const xpToNextLevel = newLevel * 100;

    if (newXP >= xpToNextLevel) {
        newLevel++;
        newXP -= xpToNextLevel; // XP restante para o próximo nível
        leveledUp = true;
        // Aumentar atributos ao subir de nível (exemplo)
        await supabaseClient
            .from('players')
            .update({ attack: player.attack + 2, health: player.health + 10 })
            .eq('id', playerId);
        window.showFloatingMessage(`Você subiu para o nível ${newLevel}!`, 'level-up');
    }

    const { error: updateError } = await supabaseClient
        .from('players')
        .update({ xp: newXP, level: newLevel })
        .eq('id', playerId);

    if (updateError) {
        console.error('Erro ao atualizar XP do jogador:', updateError.message);
        return { success: false, message: updateError.message };
    }

    window.showFloatingMessage(`+${amount} XP`, 'xp-gain');
    return { success: true, newXP, newLevel, leveledUp };
};

window.gainGold = async (playerId, amount) => {
    if (amount <= 0) return { success: true, message: "Nenhum ouro ganho." };

    const { data, error } = await supabaseClient
        .from('players')
        .rpc('add_gold', { player_id_param: playerId, amount_param: amount });

    if (error) {
        console.error('Erro ao adicionar ouro:', error.message);
        return { success: false, message: error.message };
    }

    window.showFloatingMessage(`+${amount} Ouro`, 'gold-gain');
    return { success: true };
};

// Função para buscar e exibir informações atualizadas do jogador
window.fetchAndDisplayPlayerInfo = async () => {
    const { data: { user } = { user: null } } = await supabaseClient.auth.getUser();
    if (user) {
        const { data: player, error } = await supabaseClient
            .from('players')
            .select('*')
            .eq('id', user.id)
            .single();

        if (error) {
            console.error('Erro ao recarregar perfil:', error.message);
        } else {
            currentPlayer = player; // Atualiza o objeto currentPlayer global
            displayPlayerInfo(player); // Atualiza a exibição na div playerInfoDiv
            // Notifica o afk_script.js que os dados foram atualizados
            if (window.onPlayerInfoLoadedForAfk) {
                window.onPlayerInfoLoadedForAfk(player);
            }
        }
    }
};

// --- Funções do Chat ---

async function setupChat() {
    await fetchMessages(); // Busca mensagens existentes

    // Assina o canal 'chat' para novas mensagens
    supabaseClient
        .channel('chat_messages')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat' }, payload => {
            console.log('Change received!', payload);
            if (payload.eventType === 'INSERT') {
                displayMessage(payload.new);
            }
        })
        .subscribe();
}

async function fetchMessages() {
    const { data, error } = await supabaseClient
        .from('chat')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(50); // Limita para as 50 mensagens mais recentes

    if (error) {
        console.error('Erro ao buscar mensagens:', error.message);
    } else {
        chatBox.innerHTML = ''; // Limpa antes de exibir
        data.forEach(displayMessage);
    }
}

async function sendMessage() {
    const messageContent = chatInput.value.trim();
    if (messageContent === '') return;

    const user = (await supabaseClient.auth.getUser()).data.user;
    if (!user || !currentPlayer) {
        alert("Você precisa estar logado e ter um perfil para enviar mensagens.");
        return;
    }

    const { error } = await supabaseClient
        .from('chat')
        .insert([
            { sender_id: user.id, sender_name: currentPlayer.name, message: messageContent }
        ]);

    if (error) {
        console.error('Erro ao enviar mensagem:', error.message);
    } else {
        chatInput.value = ''; // Limpa o input
    }
}

function displayMessage(message) {
    const p = document.createElement('p');
    const timestamp = new Date(message.created_at).toLocaleTimeString();
    p.textContent = `[${timestamp}] ${message.sender_name}: ${message.message}`;
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll
}

// --- Funções de Visibilidade da UI ---

window.updateUIVisibility = (loggedIn, activeContainer = 'afkContainer') => {
    if (loggedIn) {
        authContainer.style.display = 'none';
        playerInfoDiv.style.display = 'block';
        footerMenu.style.display = 'flex'; // Exibe o menu do rodapé
        chatBubble.style.display = 'block'; // Exibe o ícone do chat flutuante

        // Oculta todos os containers de conteúdo primeiro
        afkContainer.style.display = 'none';
        chatContainer.style.display = 'none';
        // Adicione outras seções do jogo aqui se houver
        // ...

        // Exibe o container ativo
        const containerToShow = document.getElementById(activeContainer);
        if (containerToShow) {
            containerToShow.style.display = 'block';
        }

    } else {
        authContainer.style.display = 'block';
        playerInfoDiv.style.display = 'none';
        footerMenu.style.display = 'none'; // Esconde o menu do rodapé
        chatBubble.style.display = 'none'; // Esconde o ícone do chat flutuante
        afkContainer.style.display = 'none'; // Garante que o AFK esteja oculto
        chatContainer.style.display = 'none'; // Garante que o chat esteja oculto
    }
};

// --- Funções de Pop-up de Dano e Mensagens Flutuantes ---

window.showDamagePopup = (amount, isCritical) => {
    popupDamageAmount.textContent = amount;
    combatDamagePopup.className = 'combat-damage-popup ' + (isCritical ? 'critical' : '');
    combatDamagePopup.style.display = 'block';
    combatDamagePopup.style.opacity = '1';
    combatDamagePopup.style.transform = 'translateY(0)';

    // Resetar posição para a animação
    combatDamagePopup.style.transition = 'none';
    combatDamagePopup.style.transform = 'translateY(20px)';
    combatDamagePopup.style.opacity = '0';

    // Forçar reflow para reiniciar a transição
    combatDamagePopup.offsetHeight;

    combatDamagePopup.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
    combatDamagePopup.style.transform = 'translateY(0)';
    combatDamagePopup.style.opacity = '1';

    setTimeout(() => {
        combatDamagePopup.style.opacity = '0';
        combatDamagePopup.style.transform = 'translateY(-20px)'; // Move para cima enquanto desaparece
        setTimeout(() => {
            combatDamagePopup.style.display = 'none';
        }, 500); // Tempo para a animação de fade-out
    }, 800); // Tempo que o pop-up fica visível
};

window.showFloatingMessage = (message, type = '') => {
    floatingMessage.textContent = message;
    floatingMessage.className = `floating-message ${type}`; // Adiciona classe para estilização
    floatingMessage.style.display = 'block';
    floatingMessage.style.opacity = '1';

    // Reset position for re-animation if it was already visible
    floatingMessage.style.transition = 'none';
    floatingMessage.style.transform = 'translateY(20px)';
    floatingMessage.offsetHeight; // Trigger reflow

    floatingMessage.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
    floatingMessage.style.transform = 'translateY(0)';
    floatingMessage.style.opacity = '1';


    setTimeout(() => {
        floatingMessage.style.opacity = '0';
        floatingMessage.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            floatingMessage.style.display = 'none';
        }, 500); // Time for fade-out animation
    }, 1500); // Time visible before starting fade-out
};


// Funções do Modal de Resultado de Combate
// Esta função agora APENAS mostra o modal e configura o texto.
// Os event listeners dos botões serão configurados diretamente no afk_script.js.
window.showCombatResultModal = (title, message) => { 
    combatResultTitle.textContent = title;
    combatResultMessage.innerHTML = message;
    combatResultModal.style.display = 'flex'; // Garante que o modal seja exibido
    // Não configura confirmCombatResultBtn.onclick nem nextStageBtn.onclick aqui.
    // Isso será feito no afk_script.js para ter controle sobre ambos os botões.
};


// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', async () => {
    // Verifica o status de login ao carregar a página
    const { data: { user } = { user: null } } = await supabaseClient.auth.getUser();
    if (user) {
        checkUserProfile(user);
    } else {
        updateUIVisibility(false); // Mostra a tela de login/registro
    }

    signInBtn.addEventListener('click', signIn);
    signUpBtn.addEventListener('click', signUp);
    saveProfileBtn.addEventListener('click', createOrUpdateProfile);

    // Event listeners para o menu do rodapé
    if (guildBtn) {
        guildBtn.addEventListener('click', () => {
            alert('Funcionalidade de Guilda em desenvolvimento!');
            // updateUIVisibility(true, 'guildContainer'); // Exemplo de como mudar a tela
        });
    }
    if (pvpBtn) {
        pvpBtn.addEventListener('click', () => {
            alert('Funcionalidade de PvP em desenvolvimento!');
        });
    }
    if (afkBtn) {
        afkBtn.addEventListener('click', () => {
            updateUIVisibility(true, 'afkContainer'); // Exibe o container AFK
        });
    }
    if (miningBtn) {
        miningBtn.addEventListener('click', () => {
            alert('Funcionalidade de Mineração em desenvolvimento!');
        });
    }
    if (castlesBtn) {
        castlesBtn.addEventListener('click', () => {
            alert('Funcionalidade de Castelos em desenvolvimento!');
        });
    }

    // Chat
    if (sendChatBtn) {
        sendChatBtn.addEventListener('click', sendMessage);
    }
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
    if (chatBubble) {
        chatBubble.addEventListener('click', () => {
            // Alterna a visibilidade do chat
            if (chatContainer.style.display === 'block') {
                chatContainer.style.display = 'none';
                updateUIVisibility(true, 'afkContainer'); // Volta para a tela AFK se o chat for fechado
            } else {
                updateUIVisibility(true, 'chatContainer'); // Mostra o container do chat
                chatInput.focus(); // Foca no input do chat
            }
        });
    }
});

// Acompanha mudanças de autenticação (ex: logout)
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
        updateUIVisibility(false); // Volta para a tela de login
        // Limpa informações do jogador
        currentPlayer = null;
        if (playerInfoDiv) playerInfoDiv.innerHTML = '';
        if (window.onPlayerInfoLoadedForAfk) {
            window.onPlayerInfoLoadedForAfk(null); // Notifica o afk_script.js que não há jogador
        }
    } else if (event === 'SIGNED_IN') {
        // Quando o usuário faz login, ele já é tratado por checkUserProfile no DOMContentLoaded
        // Se já está logado e o token expira/refresca, esta parte garante que a UI permaneça correta.
        if (session && session.user) {
            checkUserProfile(session.user);
        }
    }
});
