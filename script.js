// Mantenha o conteúdo do script.js como está da última vez.
// Não há mudanças significativas necessárias neste arquivo para as novas funcionalidades.
// Apenas garanta que ele esteja atualizado com as chaves do Supabase.

// Configuração do Supabase (AQUI!)
// **ATENÇÃO: Substitua estes valores pelos do seu projeto Supabase!**
const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co'; // Ex: 'https://abcdefg1234.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx'; // Ex: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

// Define supabaseClient globalmente para ser acessível em outros scripts
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Elementos da UI
const authContainer = document.getElementById('authContainer');
const playerInfoDiv = document.getElementById('playerInfoDiv');
const chatContainer = document.getElementById('chatContainer');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const authMessage = document.getElementById('authMessage');

const profileEditModal = document.getElementById('profileEditModal');
const editPlayerNameInput = document.getElementById('editPlayerName');
const editPlayerFactionSelect = document.getElementById('editPlayerFaction');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileEditMessage = document.getElementById('profileEditMessage');

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

// Referência ao novo elemento de mensagem flutuante (para menus)
const floatingMessageDiv = document.getElementById('floatingMessage');
// Referência ao novo elemento de popup de dano de combate
const combatDamagePopupDiv = document.getElementById('combatDamagePopup');
// Referências ao modal de resultado de combate
const combatResultModal = document.getElementById('combatResultModal');
const combatResultTitle = document.getElementById('combatResultTitle');
const combatResultMessage = document.getElementById('combatResultMessage');
const confirmCombatResultBtn = document.getElementById('confirmCombatResultBtn');


// --- Funções de Notificação Flutuante (para menus) ---
function showFloatingMessage(message, duration = 3000) {
    if (!floatingMessageDiv) return;

    floatingMessageDiv.textContent = message;
    floatingMessageDiv.style.display = 'block';
    floatingMessageDiv.offsetWidth; // Força o reflow
    floatingMessageDiv.style.opacity = '1';

    setTimeout(() => {
        floatingMessageDiv.style.opacity = '0';
        setTimeout(() => {
            floatingMessageDiv.style.display = 'none';
        }, 500); // Duração da transição CSS
    }, duration);
}

// --- Funções de Popup de Dano (para combate) ---
// Função de Popup de Dano AGORA RECEBE O NOME DO ATACANTE E SE É CRÍTICO
function showDamagePopup(attackerName, damageAmount, isCritical) {
    if (!combatDamagePopupDiv) return;

    combatDamagePopupDiv.textContent = `${attackerName}: ${damageAmount}`;
    combatDamagePopupDiv.classList.remove('critical');

    if (isCritical) {
        combatDamagePopupDiv.classList.add('critical');
    }

    combatDamagePopupDiv.style.display = 'block';
    // Posição aleatória para múltiplos popups serem visíveis
    const offset = Math.random() * 40 - 20; // -20 a +20 pixels
    combatDamagePopupDiv.style.transform = `translate(-50%, -50%) translateX(${offset}px) translateY(${offset}px)`;
    combatDamagePopupDiv.style.opacity = '1';

    setTimeout(() => {
        combatDamagePopupDiv.style.opacity = '0';
        setTimeout(() => {
            combatDamagePopupDiv.style.display = 'none';
            combatDamagePopupDiv.style.transform = `translate(-50%, -50%)`; // Reseta a posição
        }, 100); // Transição CSS de opacidade
    }, 1000); // Duração que o popup fica visível
}

// EXPOR A FUNÇÃO DE POPUP DE DANO PARA USO PELO AFK SCRIPT
window.showDamagePopup = showDamagePopup;

// --- Funções do Modal de Resultado de Combate ---
// Esta função será chamada pelo afk_script.js
window.showCombatResultModal = (title, message, onConfirmCallback) => {
    combatResultTitle.textContent = title;
    combatResultMessage.innerHTML = message; // Use innerHTML para permitir quebras de linha ou formatação
    combatResultModal.style.display = 'flex'; // Exibe o modal

    // Limpa listeners antigos para evitar chamadas duplicadas
    confirmCombatResultBtn.onclick = null;
    confirmCombatResultBtn.onclick = () => {
        combatResultModal.style.display = 'none'; // Esconde o modal ao confirmar
        if (onConfirmCallback) {
            onConfirmCallback(); // Chama o callback para aplicar recompensas e atualizar a UI
        }
    };
};


// Funções de Autenticação
async function signIn() {
    console.log("Tentando login...");
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    authMessage.textContent = 'Tentando fazer login...';
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        authMessage.textContent = `Erro ao fazer login: ${error.message}`;
        console.error('Erro ao fazer login:', error);
    } else {
        authMessage.textContent = ''; // Limpa a mensagem de erro
        console.log("Login bem-sucedido.");
    }
}

async function signUp() {
    console.log("Tentando registro...");
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    authMessage.textContent = 'Registrando usuário...';
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
        authMessage.textContent = `Erro ao registrar: ${error.message}`;
        console.error('Erro ao registrar:', error);
    } else {
        authMessage.textContent = 'Registro realizado! Verifique seu email para confirmar a conta.';
        console.log("Registro solicitado. Verifique o email.");
    }
}

async function signOut() {
    console.log("Tentando sair...");
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Erro ao sair:', error.message);
    } else {
        console.log("Sessão encerrada.");
        chatBox.innerHTML = ''; // Limpa o chat
    }
}

// Funções de Perfil do Jogador
async function fetchAndDisplayPlayerInfo() {
    console.log("Buscando informações do jogador...");
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (user) {
        authContainer.style.display = 'none';

        const { data: player, error } = await supabaseClient
            .from('players')
            .select('id, created_at, name, faction, level, xp, gold, health, mana, attack, defense, combat_power, ranking_points, guild_id, crystals, current_afk_stage, last_afk_start_time, rank, is_silenced_until, is_banned, last_active')
            .eq('id', user.id)
            .single();

        if (error || (player.rank === 'Aventureiro(a)' && player.name === user.email)) {
            console.log("Perfil não configurado ou erro ao buscar. Abrindo modal de edição.");
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

        console.log("Informações do jogador carregadas. Exibindo UI padrão.");
        updateUIVisibility(true, 'playerInfoDiv'); // Mostra o playerInfoDiv por padrão
        subscribeToChat();
        updateLastActive(user.id); // Atualiza last_active ao fazer login

        if (typeof window.onPlayerInfoLoadedForAfk === 'function') {
            window.onPlayerInfoLoadedForAfk(player);
        }

    } else {
        console.log("Nenhum usuário logado. Exibindo tela de login.");
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
    console.log("Salvando perfil...");

    const { data, error } = await supabaseClient
        .from('players')
        .update({ name: newName, faction: newFaction, rank: 'Aventureiro(a)' })
        .eq('id', user.id);

    if (error) {
        console.error('Erro ao salvar perfil:', error);
        profileEditMessage.textContent = `Erro ao salvar perfil: ${error.message}`;
    } else {
        profileEditMessage.textContent = "Perfil salvo com sucesso!";
        console.log("Perfil salvo com sucesso.");
        profileEditModal.style.display = 'none'; // Esconde o modal
        fetchAndDisplayPlayerInfo(); // Atualiza as informações exibidas e a UI
    }
});

// FUNÇÕES DE PROGRESSÃO DO JOGADOR (ainda necessárias para as recompensas AFK)
window.gainXP = async (userId, amount) => {
    console.log(`Tentando ganhar ${amount} XP para o usuário ${userId}`);
    const { data: player, error: fetchError } = await supabaseClient
        .from('players')
        .select('xp, level, health, mana, attack, defense, combat_power')
        .eq('id', userId)
        .single();

    if (fetchError) {
        console.error('Erro ao buscar XP atual:', fetchError);
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
        console.log(`Jogador subiu para o nível ${currentLevel}!`);
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
        console.log(`XP e nível atualizados para ${userId}. Novo XP: ${currentXP}, Nível: ${currentLevel}`);
        return { success: true, leveledUp: leveledUp, newLevel: currentLevel, message: `Ganhou ${amount} XP.` };
    }
}

window.gainGold = async (userId, amount) => {
    console.log(`Tentando ganhar ${amount} Ouro para o usuário ${userId}`);
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
        console.log(`Ouro atualizado para ${userId}. Novo Ouro: ${newGold}`);
        return { success: true, message: `Ganhou ${amount} Ouro.` };
    }
}


// Funções de Chat
async function sendMessage() {
    const messageText = chatInput.value.trim();
    if (messageText === '') return;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        console.error('Nenhum usuário logado para enviar mensagem.');
        showFloatingMessage('Você precisa estar logado para enviar mensagens.');
        return;
    }

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('name, rank')
        .eq('id', user.id)
        .single();

    if (playerError) {
        console.error('Erro ao buscar nome/rank do jogador para o chat:', playerError);
        showFloatingMessage('Erro ao verificar seu perfil para o chat.');
        return;
    }

    // Verificação de Rank para chat global
    if (player.rank !== 'Monarca' && player.rank !== 'Nobre') {
        showFloatingMessage('Apenas Monarcas e Nobres podem escrever no chat global.');
        return;
    }

    // Limite de caracteres para mensagens
    if (messageText.length > 200) {
        showFloatingMessage('Mensagem muito longa! Máximo de 200 caracteres.');
        return;
    }

    const playerName = player ? player.name : 'Desconhecido';

    const { error } = await supabaseClient
        .from('chat_messages')
        .insert({ user_id: user.id, username: playerName, message: messageText });

    if (error) {
        console.error('Erro ao enviar mensagem:', error);
        if (error.code === '42501') {
            showFloatingMessage('Permissão negada para enviar mensagem (RLS).');
        } else {
            showFloatingMessage(`Erro ao enviar mensagem: ${error.message}`);
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
    console.log("Inscrito no canal de chat.");
    supabaseClient.removeChannel('chat_messages_channel');

    supabaseClient
        .channel('chat_messages_channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
            loadInitialChatMessages();
        })
        .subscribe();

    loadInitialChatMessages();
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


// --- Funções de Visibilidade da UI ---
function updateUIVisibility(showGameUI, activeContainerId = 'playerInfoDiv') {
    playerInfoDiv.style.display = 'none';
    chatContainer.style.display = 'none';
    afkContainer.style.display = 'none';
    profileEditModal.style.display = 'none';
    combatResultModal.style.display = 'none'; // Garante que o modal de combate esteja oculto

    // Esconde as barras de HP por padrão ao mudar de tela
    document.getElementById('playerHpBarContainer').style.display = 'none';
    document.getElementById('monsterHpBarContainer').style.display = 'none';


    if (showGameUI) {
        authContainer.style.display = 'none';
        footerMenu.style.display = 'flex';
        chatBubble.style.display = 'flex';

        const activeDiv = document.getElementById(activeContainerId);
        if (activeDiv) {
            activeDiv.style.display = 'block';
            console.log(`Exibindo container: ${activeContainerId}`);
        } else {
            playerInfoDiv.style.display = 'block';
            console.warn(`Container ${activeContainerId} não encontrado. Exibindo playerInfoDiv.`);
        }
    } else {
        authContainer.style.display = 'block';
        playerInfoDiv.style.display = 'none';
        footerMenu.style.display = 'none';
        chatBubble.style.display = 'none';
        console.log("Exibindo tela de login.");
    }
    authMessage.textContent = '';
}


// --- Funções dos Botões do Menu ---
function showGuildMenu() {
    updateUIVisibility(true, 'playerInfoDiv');
    showFloatingMessage("Menu da Guilda (Em desenvolvimento)");
}

function showPvPMenu() {
    updateUIVisibility(true, 'playerInfoDiv');
    showFloatingMessage("Menu de PvP (Em desenvolvimento)");
}

function showAfkMenu() {
    updateUIVisibility(true, 'afkContainer');
    if (typeof window.initAfkDisplay === 'function') {
        window.initAfkDisplay();
    }
}

function showMiningMenu() {
    updateUIVisibility(true, 'playerInfoDiv');
    showFloatingMessage("Menu de Mineração (Em desenvolvimento)");
}

function showCastlesMenu() {
    updateUIVisibility(true, 'playerInfoDiv');
    showFloatingMessage("Menu de Castelos (Em desenvolvimento)");
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

    if (guildBtn) guildBtn.addEventListener('click', showGuildMenu);
    if (pvpBtn) pvpBtn.addEventListener('click', showPvPMenu);
    if (afkBtn) afkBtn.addEventListener('click', showAfkMenu);
    if (miningBtn) miningBtn.addEventListener('click', showMiningMenu);
    if (castlesBtn) castlesBtn.addEventListener('click', showCastlesMenu);

    if (chatBubble) chatBubble.addEventListener('click', () => {
        if (chatContainer.style.display === 'none') {
            updateUIVisibility(true, 'chatContainer');
            loadInitialChatMessages();
            chatInput.f
