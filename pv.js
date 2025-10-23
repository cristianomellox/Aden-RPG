// pv.js - Lógica para o Sistema de Mensagens Privadas

document.addEventListener("DOMContentLoaded", () => {
    // --- ELEMENTOS DA UI ---
    const pvMenuBtn = document.getElementById('pvMenuBtn');
    const pvModal = document.getElementById('pvModal');
    const closePvModalBtn = document.getElementById('closePvModalBtn');
    const pvNotificationDot = document.getElementById('pvNotificationDot');
    
    // Abas
    const pvTabs = document.querySelectorAll('.pv-tab-btn');
    const pvMessageContent = document.getElementById('pv-messages');
    const pvSystemContent = document.getElementById('pv-system');

    // Lista de Conversas vs Visão do Chat
    const conversationListDiv = document.getElementById('pv-conversation-list');
    const chatViewDiv = document.getElementById('pv-chat-view');

    // Elementos do Chat
    const backToListBtn = document.getElementById('pv-back-to-list-btn');
    const chatWithName = document.getElementById('pv-chat-with-name');
    const deleteConvoBtn = document.getElementById('pv-delete-convo-btn');
    const chatMessagesDiv = document.getElementById('pv-chat-messages');
    const chatInput = document.getElementById('pv-chat-input');
    const sendMessageBtn = document.getElementById('pv-send-message-btn');
    
    // Lista de Mensagens do Sistema
    const systemMessagesListDiv = document.getElementById('pv-system-messages-list');
    
    // --- ESTADO LOCAL ---
    let localConversations = new Map();
    let localSystemMessages = new Map();
    let currentPlayer = null;
    let currentOpenConversationId = null;

    // --- FUNÇÕES DE INICIALIZAÇÃO E DADOS ---

    // Ponto de entrada chamado de script.js ou quando o jogador loga
    async function initializePV() {
        if (!supabaseClient) {
            console.error("Supabase client não encontrado. O sistema de PV não funcionará.");
            return;
        }
        
        // Carrega dados do LocalStorage
        loadFromLocalStorage();

        // Obtém o ID do jogador atual
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
            const { data: player, error } = await supabaseClient.from('players').select('id, name').eq('id', user.id).single();
            if(player) currentPlayer = player;
        }
        
        // Limpa mensagens antigas no DB e busca novas
        await fetchAndSyncMessages();

        // Adiciona listeners de eventos
        setupEventListeners();

        // Verifica se há mensagens não lidas para mostrar a notificação
        checkUnreadStatus();
    }

    async function fetchAndSyncMessages() {
        if (!currentPlayer) return;

        // 1. Chama a RPC para limpar mensagens antigas no DB (a "cron job" manual)
        await supabaseClient.rpc('cleanup_old_private_messages');

        // 2. Busca conversas do DB onde o jogador está envolvido
        const { data: dbConversations, error: convoError } = await supabaseClient
            .from('private_messages')
            .select('*')
            .or(`player_one_id.eq.${currentPlayer.id},player_two_id.eq.${currentPlayer.id}`);

        if (convoError) {
            console.error("Erro ao buscar conversas:", convoError);
            return;
        }

        // 3. Sincroniza com o LocalStorage
        dbConversations.forEach(dbConvo => {
            const localConvo = localConversations.get(dbConvo.id) || { messages: [] };
            // O DB é a fonte da verdade para o estado atual
            localConvo.id = dbConvo.id;
            localConvo.player_one_id = dbConvo.player_one_id;
            localConvo.player_two_id = dbConvo.player_two_id;
            localConvo.last_sender_id = dbConvo.last_sender_id;
            localConvo.last_message = dbConvo.last_message;
            
            // Determina se há mensagens não lidas para o jogador atual
            const isPlayerOne = dbConvo.player_one_id === currentPlayer.id;
            localConvo.is_unread = isPlayerOne ? dbConvo.unread_by_player_one : dbConvo.unread_by_player_two;

            // Anexa novas mensagens
            const existingMessageTimestamps = new Set(localConvo.messages.map(m => m.timestamp));
            dbConvo.messages.forEach(dbMsg => {
                if (!existingMessageTimestamps.has(dbMsg.timestamp)) {
                    localConvo.messages.push(dbMsg);
                }
            });
            
            localConversations.set(dbConvo.id, localConvo);
        });

        // 4. Busca mensagens do sistema
        // (Lógica a ser implementada de forma similar)

        // 5. Salva e renderiza
        saveToLocalStorage();
        renderConversationList();
        checkUnreadStatus();
    }
    
    function loadFromLocalStorage() {
        const storedConvos = JSON.parse(localStorage.getItem('pv_conversations') || '{}');
        localConversations = new Map(Object.entries(storedConvos).map(([k, v]) => [parseInt(k), v]));
    }

    function saveToLocalStorage() {
        const convosToStore = Object.fromEntries(localConversations);
        localStorage.setItem('pv_conversations', JSON.stringify(convosToStore));
    }

    // --- FUNÇÕES DE RENDERIZAÇÃO ---

    function renderConversationList() {
        conversationListDiv.innerHTML = '<p>Carregando conversas...</p>';
        if (localConversations.size === 0) {
            conversationListDiv.innerHTML = '<p>Nenhuma mensagem ainda. Inicie uma conversa!</p>';
            return;
        }
        
        conversationListDiv.innerHTML = '';
        // Ordenar por data da última mensagem
        const sortedConversations = [...localConversations.values()].sort((a, b) => {
             const lastMsgA = a.messages[a.messages.length - 1]?.timestamp || 0;
             const lastMsgB = b.messages[b.messages.length - 1]?.timestamp || 0;
             return new Date(lastMsgB) - new Date(lastMsgA);
        });
        
        sortedConversations.forEach(async (convo) => {
            const otherPlayerId = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
            
            // TODO: Cache de nomes de jogadores para evitar buscas repetidas
            const { data: otherPlayer } = await supabaseClient.from('players').select('name').eq('id', otherPlayerId).single();

            const item = document.createElement('div');
            item.className = 'conversation-item';
            item.dataset.conversationId = convo.id;
            if (convo.is_unread) {
                item.classList.add('unread');
            }
            item.innerHTML = `
                <p class="conversation-name">${otherPlayer?.name || 'Desconhecido'}</p>
                <p class="conversation-preview">${convo.last_message || 'Nenhuma mensagem ainda.'}</p>
            `;
            item.addEventListener('click', () => openChatView(convo.id));
            conversationListDiv.appendChild(item);
        });
    }

    async function openChatView(conversationId) {
        currentOpenConversationId = conversationId;
        const convo = localConversations.get(conversationId);
        if (!convo) return;
        
        // Determinar se a coluna de 'não lida' correta
        const isPlayerOne = convo.player_one_id === currentPlayer.id;
        const unreadColumn = isPlayerOne ? 'unread_by_player_one' : 'unread_by_player_two';
        
        // Marcar como lida
        if (convo.is_unread) {
            convo.is_unread = false;
            
            // *** INÍCIO DA MODIFICAÇÃO: Atualiza o status no DB ***
            const { error: updateError } = await supabaseClient
                .from('private_messages')
                .update({ [unreadColumn]: false })
                .eq('id', conversationId);
            
            if (updateError) {
                console.error("Erro ao marcar mensagem como lida no DB:", updateError);
            }
            // *** FIM DA MODIFICAÇÃO ***
            
            saveToLocalStorage();
            renderConversationList();
            checkUnreadStatus();
        }

        conversationListDiv.style.display = 'none';
        chatViewDiv.style.display = 'flex';

        // Renderiza o chat
        renderChatMessages(convo);
        
        // Lógica do input desabilitado
        if (convo.last_sender_id === currentPlayer.id) {
            chatInput.disabled = true;
            chatInput.placeholder = 'Aguardando resposta do outro jogador.';
            sendMessageBtn.disabled = true;
        } else {
            chatInput.disabled = false;
            chatInput.placeholder = 'Digite sua mensagem...';
            sendMessageBtn.disabled = false;
        }
    }
    
    function renderChatMessages(convo) {
        chatMessagesDiv.innerHTML = '';
        convo.messages.forEach(msg => {
            const msgDiv = document.createElement('div');
            msgDiv.className = 'chat-message';
            msgDiv.classList.add(msg.sender_id === currentPlayer.id ? 'sent' : 'received');
            
            const sentDate = new Date(msg.timestamp);
            const formattedDate = `${sentDate.toLocaleDateString()} ${sentDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;

            msgDiv.innerHTML = `
                ${msg.text}
                <small>${formattedDate}</small>
            `;
            chatMessagesDiv.appendChild(msgDiv);
        });
        // Scroll para a última mensagem
        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    }

    function checkUnreadStatus() {
        const hasUnread = [...localConversations.values()].some(c => c.is_unread);
        // Adicionar lógica para mensagens do sistema também
        
        pvNotificationDot.style.display = hasUnread ? 'block' : 'none';
    }

    // --- MANIPULADORES DE EVENTOS ---

    function setupEventListeners() {
        if (pvMenuBtn) {
            pvMenuBtn.onclick = () => {
                pvModal.style.display = 'flex';
                // Ao abrir o modal, removemos a notificação visual,
                // pois o jogador está prestes a ver as mensagens.
                pvNotificationDot.style.display = 'none';
            };
        }
        
        if (closePvModalBtn) closePvModalBtn.onclick = () => pvModal.style.display = 'none';
        
        pvTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                pvTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                if (tab.dataset.tab === 'pv-messages') {
                    pvMessageContent.style.display = 'block';
                    pvSystemContent.style.display = 'none';
                } else {
                    pvMessageContent.style.display = 'none';
                    pvSystemContent.style.display = 'block';
                }
            });
        });

        backToListBtn.onclick = () => {
            chatViewDiv.style.display = 'none';
            conversationListDiv.style.display = 'flex';
            currentOpenConversationId = null;
        };

        sendMessageBtn.onclick = async () => {
            const messageText = chatInput.value.trim();
            if (!messageText || !currentOpenConversationId) return;
            
            sendMessageBtn.disabled = true;
            chatInput.disabled = true;
            
            const { data, error } = await supabaseClient.rpc('send_private_message', {
                conversation_id: currentOpenConversationId,
                message_text: messageText
            });

            if (error) {
                showFloatingMessage(`Erro: ${error.message}`);
                // Reabilita o input em caso de erro
                sendMessageBtn.disabled = false;
                chatInput.disabled = false;
            } else {
                chatInput.value = '';
                // Atualiza a conversa localmente e re-renderiza
                await fetchAndSyncMessages();
                openChatView(currentOpenConversationId);
            }
        };

        deleteConvoBtn.onclick = () => {
            if (!currentOpenConversationId) return;
            const confirmDelete = confirm("Tem certeza que deseja apagar esta conversa? Esta ação não pode ser desfeita e apagará a conversa apenas para você.");
            if (confirmDelete) {
                localConversations.delete(currentOpenConversationId);
                saveToLocalStorage();
                renderConversationList();
                backToListBtn.click(); // Volta para a lista
                showFloatingMessage("Conversa apagada.");
            }
        };
    }
    
    // Inicia o sistema de PV
    initializePV();
});