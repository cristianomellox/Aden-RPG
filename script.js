// Configuração do Supabase (AQUI!)
// **ATENÇÃO: Substitua estes valores pelos do seu projeto Supabase!**
const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
// Ex: 'https://abcdefg1234.supabase.co'
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
const homeBtn = document.getElementById('homeBtn'); // NOVO: Referência ao botão "Início"
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
const popupDamageAmountSpan = document.getElementById('popupDamageAmount');
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
    // Força o reflow para garantir que a transição de opacidade ocorra
    floatingMessageDiv.offsetWidth;
    floatingMessageDiv.style.opacity = '1';
    setTimeout(() => {
        floatingMessageDiv.style.opacity = '0';
        setTimeout(() => {
            floatingMessageDiv.style.display = 'none';
        }, 500); // Duração da transição CSS
    }, duration);
}

// --- Funções de Popup de Dano (para combate) ---
function showDamagePopup(damageAmount, isCritical) {
    if (!combatDamagePopupDiv) {
        console.error("combatDamagePopupDiv não encontrado!");
        return;
    }

    const damageSpan = combatDamagePopupDiv.querySelector('#popupDamageAmount');

    if (damageSpan) {
        damageSpan.textContent = damageAmount;
    } else {
        console.warn("popupDamageAmount span not found inside combatDamagePopupDiv");
    }

    combatDamagePopupDiv.classList.remove('critical');

    if (isCritical) {
        combatDamagePopupDiv.classList.add('critical');
    }

    combatDamagePopupDiv.style.display = 'block';
    // Posição aleatória para múltiplos popups serem visíveis
    const offset = Math.random() * 40 - 20;
    // -20 a +20 pixels
    combatDamagePopupDiv.style.transform = `translate(-50%, -50%) translateX(${offset}px) translateY(${offset}px)`;
    combatDamagePopupDiv.style.opacity = '1';
    setTimeout(() => {
        combatDamagePopupDiv.style.opacity = '0';
        setTimeout(() => {
            combatDamagePopupDiv.style.display = 'none';
            combatDamagePopupDiv.style.transform = `translate(-50%, -50%)`; // Reseta a posição
        }, 100); // Transição CSS de opacidade
    }, 1000);
    // Duração que o popup fica visível
}

// EXPOR A FUNÇÃO DE POPUP DE DANO PARA USO PELO AFK SCRIPT
window.showDamagePopup = showDamagePopup;

// --- Funções do Modal de Resultado de Combate ---
// Esta função será chamada pelo afk_script.js
window.showCombatResultModal = (title, message, onConfirmCallback) => {
    combatResultTitle.textContent = title;
    combatResultMessage.innerHTML = message;
    combatResultModal.style.display = 'flex';

    confirmCombatResultBtn.onclick = null; // Limpa qualquer listener anterior
    confirmCombatResultBtn.onclick = () => {
        combatResultModal.style.display = 'none';
        if (onConfirmCallback) {
            onConfirmCallback();
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
        authMessage.textContent = '';
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
        chatBox.innerHTML = '';
    }
}

// Funções de Perfil do Jogador
async function fetchAndDisplayPlayerInfo(preserveActiveContainer = false) { // Adicionado parâmetro
    console.log("Buscando informações do jogador...");
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        authContainer.style.display = 'none';
        const { data: player, error } = await supabaseClient
            .from('players')
            .select('id, created_at, name, faction, level, xp, gold, health, mana, attack, defense, combat_power, ranking_points, guild_id, crystals, current_afk_stage, last_afk_start_time, rank, is_silenced_until, is_banned, last_active, daily_attempts_left, last_attempt_reset')
            .eq('id', user.id)
            .single();

        if (error || (player.rank === 'Aventureiro(a)' && player.name === user.email)) {
            console.log("Perfil não configurado ou erro ao buscar. Abrindo modal de edição.");
            profileEditModal.style.display = 'flex';
            editPlayerNameInput.value = player ? player.name : user.email.split('@')[0];
            editPlayerFactionSelect.value = player ? player.faction : 'Aliança da Floresta';
            updateUIVisibility(false); // Oculta tudo, pois o modal é a prioridade
            footerMenu.style.display = 'none';
            chatBubble.style.display = 'none';
            return;
        }

        // NOVO: Calcula o XP necessário para o próximo nível com base na nova curva
        const xpNeededForNextLevel = calculateXPForNextLevel(player.level);

        playerInfoDiv.innerHTML = `
            <p>Olá, ${player.name}!</p>
            <p>Nível: ${player.level}</p>
            <p>XP: ${player.xp} / ${xpNeededForNextLevel} (próximo nível)</p>
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
        // Se preserveActiveContainer for true, não altere o container atual
        if (!preserveActiveContainer) {
            updateUIVisibility(true, 'playerInfoDiv'); // Volta para a tela de informações do jogador por padrão
        } else {
            // Se já há um container ativo (ex: AFK), apenas garante que playerInfoDiv está escondido
            playerInfoDiv.style.display = 'none';
        }
        
        subscribeToChat();
        updateLastActive(user.id);
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
        profileEditModal.style.display = 'none';
        fetchAndDisplayPlayerInfo(); // Redireciona para o perfil após salvar
    }
});

// NOVO: Constante para o nível máximo do jogador
const MAX_PLAYER_LEVEL = 100;

// NOVO: Função para calcular o XP necessário para o próximo nível
// A curva é exponencial para tornar cada vez mais difícil
function calculateXPForNextLevel(level) {
    if (level <= 0) return 100; // Caso base para nível 0 ou erro
    return Math.floor(100 * Math.pow(level, 1.5));
}

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

    let currentXP = player.xp;
    let currentLevel = player.level;
    let newHealth = player.health;
    let newMana = player.mana;
    let newAttack = player.attack;
    let newDefense = player.defense;
    let newCombatPower = player.combat_power;
    let leveledUp = false;

    // NOVO: Verifica se o jogador já atingiu o nível máximo
    if (currentLevel >= MAX_PLAYER_LEVEL) {
        console.log(`Jogador ${userId} já está no nível máximo (${MAX_PLAYER_LEVEL}). Não receberá mais XP.`);
        return { success: false, message: `Você já atingiu o nível máximo (${MAX_PLAYER_LEVEL})!` };
    }

    currentXP += amount;
    const xpNeededForNextLevel = calculateXPForNextLevel(currentLevel); // NOVO: Usa a nova função de cálculo

    if (currentXP >= xpNeededForNextLevel) {
        leveledUp = true;
        currentLevel++;
        currentXP -= xpNeededForNextLevel; // Reseta o XP após subir de nível

        // NOVO: Garante que o XP não continue acumulando se atingir o nível máximo logo após subir de nível
        if (currentLevel >= MAX_PLAYER_LEVEL) {
            currentLevel = MAX_PLAYER_LEVEL;
            currentXP = 0; // Zera o XP ao atingir o nível máximo para evitar overflow ou confusão.
            console.log(`Jogador ${userId} atingiu o nível máximo: ${MAX_PLAYER_LEVEL}!`);
        }

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

// Funções de UI
window.updateUIVisibility = (isLoggedIn, activeContainerId = null) => {
    if (isLoggedIn) {
        authContainer.style.display = 'none';
        footerMenu.style.display = 'flex';
        chatBubble.style.display = 'flex';

        // Oculta todos os containers e mostra apenas o ativo
        const containers = [playerInfoDiv, afkContainer, chatContainer]; // Adicione outros containers aqui conforme a necessidade
        containers.forEach(container => {
            if (container) {
                container.style.display = 'none';
            }
        });

        if (activeContainerId === 'chatContainer') {
            chatContainer.style.display = 'block';
        } else if (activeContainerId === 'afkContainer') {
            afkContainer.style.display = 'block';
        } else {
            // Por padrão, mostra playerInfoDiv se nenhum específico for solicitado
            playerInfoDiv.style.display = 'block';
        }

    } else {
        authContainer.style.display = 'block';
        playerInfoDiv.style.display = 'none';
        chatContainer.style.display = 'none';
        afkContainer.style.display = 'none';
        footerMenu.style.display = 'none';
        chatBubble.style.display = 'none';
    }
}

// Event Listeners
document.getElementById('signInBtn').addEventListener('click', signIn);
document.getElementById('signUpBtn').addEventListener('click', signUp);
document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', function(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
});

// NOVO: Event Listener para o botão "Início"
homeBtn.addEventListener('click', () => {
    fetchAndDisplayPlayerInfo(); // Atualiza as infos e volta para playerInfoDiv
    showFloatingMessage("Você está na página inicial!");
});

// NOVO: Event Listeners para botões do rodapé com mensagem "Em desenvolvimento"
guildBtn.addEventListener('click', () => {
    showFloatingMessage("Guilda: Em desenvolvimento!");
});
pvpBtn.addEventListener('click', () => {
    showFloatingMessage("PvP: Em desenvolvimento!");
});
miningBtn.addEventListener('click', () => {
    showFloatingMessage("Mineração: Em desenvolvimento!");
});
castlesBtn.addEventListener('click', () => {
    showFloatingMessage("Castelos: Em desenvolvimento!");
});

// EXISTENTES: Event Listeners para botões do rodapé
afkBtn.addEventListener('click', () => {
    updateUIVisibility(true, 'afkContainer');
    showFloatingMessage("Você entrou na Aventura AFK!");
});

chatBubble.addEventListener('click', () => {
    updateUIVisibility(true, 'chatContainer');
    showFloatingMessage("Você abriu o Chat Global!");
});


// Funções de verificação de sessão e inicialização
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        console.log('Sessão encontrada:', session);
        fetchAndDisplayPlayerInfo(); // Chama sem preserveActiveContainer para voltar ao playerInfoDiv
    } else {
        console.log('Nenhuma sessão.');
        updateUIVisibility(false);
    }
});

// Inicialização
fetchAndDisplayPlayerInfo(); // Tenta buscar informações do usuário na carga inicial
updateLastActive = async (userId) => {
    const { error } = await supabaseClient
        .from('players')
        .update({ last_active: new Date().toISOString() })
        .eq('id', userId);
    if (error) {
        console.error('Erro ao atualizar last_active:', error.message);
    }
};

// Temporizador para atualizar o last_active a cada 5 minutos (ajustável)
setInterval(async () => {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        await updateLastActive(user.id);
    }
}, 5 * 60 * 1000); // 5 minutos
