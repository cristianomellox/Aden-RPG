// pv.js - Lógica para o Sistema de Mensagens Privadas (Versão Corrigida e Estável)

document.addEventListener("DOMContentLoaded", () => {
    // --- SETUP INICIAL ---
    const supabaseClient = window.supabaseClient || (window.supabase && window.supabase.createClient ? window.supabase.createClient('https://lqzlblvmkuwedcofmgfb.supabase.co', 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx') : null);
    const showFloatingMessage = window.showFloatingMessage || console.log;

    // --- ELEMENTOS DA UI ---
    const pvMenuBtn = document.querySelector('.menu-item[data-modal="pvModal"]');
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
    
    // --- LÓGICA DO MODAL DE CONFIRMAÇÃO ---
    const confirmModal = document.getElementById('confirmModal');
    const confirmModalMessage = document.getElementById('pvConfirmModalMessage');
    let confirmModalConfirmBtn = document.getElementById('confirmModalConfirmBtn');
    const confirmModalCancelBtn = document.getElementById('confirmModalCancelBtn');
    const confirmModalCloseBtn = confirmModal ? confirmModal.querySelector('.close-btn') : null;

    const closeConfirmModal = () => { if (confirmModal) confirmModal.style.display = 'none'; };

    function showConfirmModal(message, onConfirm) {
        if (!confirmModal || !confirmModalMessage || !confirmModalConfirmBtn) {
            if (confirm(message)) onConfirm(); // Fallback para o alert nativo
            return;
        }
        confirmModalMessage.textContent = message;
        const newConfirmBtn = confirmModalConfirmBtn.cloneNode(true);
        confirmModalConfirmBtn.parentNode.replaceChild(newConfirmBtn, confirmModalConfirmBtn);
        confirmModalConfirmBtn = newConfirmBtn;
        confirmModalConfirmBtn.addEventListener('click', () => {
            closeConfirmModal();
            if (typeof onConfirm === 'function') onConfirm();
        }, { once: true });
        confirmModal.style.display = 'flex';
        confirmModalConfirmBtn.focus();
    }

    if (confirmModal) {
        confirmModalCancelBtn.addEventListener('click', closeConfirmModal);
        confirmModalCloseBtn.addEventListener('click', closeConfirmModal);
        confirmModal.addEventListener('click', (event) => { if (event.target === confirmModal) closeConfirmModal(); });
    }

    // --- ESTADO LOCAL ---
    let localConversations = new Map();
    let localSystemMessages = new Map();
    let currentPlayer = null;
    let currentOpenConversationId = null;

    // --- FUNÇÕES DE DADOS E RENDERIZAÇÃO ---

    async function fetchAndSyncMessages() {
        if (!currentPlayer) return;
        await supabaseClient.rpc('cleanup_old_private_messages');
        const { data: dbConversations, error: convoError } = await supabaseClient.from('private_messages').select('*').or(`player_one_id.eq.${currentPlayer.id},player_two_id.eq.${currentPlayer.id}`);
        if (convoError) { console.error("Erro ao buscar conversas:", convoError); return; }
        
        const newConversations = new Map();
        dbConversations.forEach(dbConvo => {
            const convoId = String(dbConvo.id);
            const localConvo = localConversations.get(convoId) || { messages: [] };
            localConvo.id = convoId;
            localConvo.player_one_id = dbConvo.player_one_id;
            localConvo.player_two_id = dbConvo.player_two_id;
            localConvo.last_sender_id = dbConvo.last_sender_id;
            localConvo.last_message = dbConvo.last_message;
            const isPlayerOne = dbConvo.player_one_id === currentPlayer.id;
            localConvo.is_unread = isPlayerOne ? dbConvo.unread_by_player_one : dbConvo.unread_by_player_two;
            const existingMessageTimestamps = new Set(localConvo.messages.map(m => m.timestamp));
            (dbConvo.messages || []).forEach(dbMsg => { if (!existingMessageTimestamps.has(dbMsg.timestamp)) { localConvo.messages.push(dbMsg); } });
            newConversations.set(convoId, localConvo);
        });
        localConversations = newConversations;

        saveToLocalStorage();
        renderConversationList();
        checkUnreadStatus();
    }
    
    function loadFromLocalStorage() {
        try {
            const storedConvos = JSON.parse(localStorage.getItem('pv_conversations') || '{}');
            localConversations = new Map(Object.entries(storedConvos));
        } catch (e) {
            localConversations = new Map();
        }
    }

    function saveToLocalStorage() {
        const convosToStore = Object.fromEntries(localConversations);
        localStorage.setItem('pv_conversations', JSON.stringify(convosToStore));
    }

    function renderConversationList() {
        if (!conversationListDiv) return;
        conversationListDiv.innerHTML = '<p>Carregando conversas...</p>';
        if (localConversations.size === 0) {
            conversationListDiv.innerHTML = '<p>Nenhuma mensagem ainda. Inicie uma conversa!</p>';
            return;
        }
        
        conversationListDiv.innerHTML = '';
        const sortedConversations = [...localConversations.values()].sort((a, b) => {
             const lastMsgA = a.messages[a.messages.length - 1]?.timestamp || 0;
             const lastMsgB = b.messages[b.messages.length - 1]?.timestamp || 0;
             return new Date(lastMsgB) - new Date(lastMsgA);
        });
        
        sortedConversations.forEach(async (convo) => {
            const otherPlayerId = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
            const { data: otherPlayer } = await supabaseClient.from('players').select('name').eq('id', otherPlayerId).single();
            const item = document.createElement('div');
            item.className = 'conversation-item';
            item.dataset.conversationId = convo.id;
            if (convo.is_unread) { item.classList.add('unread'); }
            item.innerHTML = `<p class="conversation-name">${otherPlayer?.name || 'Desconhecido'}</p><p class="conversation-preview">${convo.last_message || 'Nenhuma mensagem ainda.'}</p>`;
            item.addEventListener('click', () => openChatView(convo.id, otherPlayer?.name));
            conversationListDiv.appendChild(item);
        });
    }

    async function openChatView(conversationId, targetPlayerName = null) {
        currentOpenConversationId = String(conversationId);
        let convo = localConversations.get(currentOpenConversationId);
        if (!convo) {
            await fetchAndSyncMessages();
            convo = localConversations.get(currentOpenConversationId);
            if (!convo) { showFloatingMessage("Não foi possível carregar a conversa."); return; }
        }
        
        if (targetPlayerName) {
            chatWithName.textContent = targetPlayerName;
        } else {
            const otherPlayerId = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
            const { data: otherPlayer } = await supabaseClient.from('players').select('name').eq('id', otherPlayerId).single();
            chatWithName.textContent = otherPlayer?.name || 'Desconhecido';
        }
        
        const isPlayerOne = convo.player_one_id === currentPlayer.id;
        const unreadColumn = isPlayerOne ? 'unread_by_player_one' : 'unread_by_player_two';
        
        if (convo.is_unread) {
            convo.is_unread = false;
            await supabaseClient.from('private_messages').update({ [unreadColumn]: false }).eq('id', currentOpenConversationId);
            saveToLocalStorage();
            renderConversationList();
            checkUnreadStatus();
        }

        conversationListDiv.style.display = 'none';
        chatViewDiv.style.display = 'flex';
        renderChatMessages(convo);
        
        if (convo.last_sender_id === currentPlayer.id) {
            chatInput.disabled = true;
            chatInput.placeholder = 'Aguardando resposta do outro jogador.';
            sendMessageBtn.style.filter = 'grayscale(1)';
        } else {
            chatInput.disabled = false;
            chatInput.placeholder = 'Digite sua mensagem...';
            sendMessageBtn.style.filter = '';
        }
    }
    window.openChatView = openChatView; // Expor globalmente
    
    function renderChatMessages(convo) {
        chatMessagesDiv.innerHTML = '';
        (convo.messages || []).forEach(msg => {
            const msgDiv = document.createElement('div');
            msgDiv.className = 'chat-message';
            msgDiv.classList.add(msg.sender_id === currentPlayer.id ? 'sent' : 'received');
            const sentDate = new Date(msg.timestamp);
            const formattedDate = `${sentDate.toLocaleDateString()} ${sentDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            msgDiv.innerHTML = `<p>${msg.text}</p><small>${formattedDate}</small>`;
            chatMessagesDiv.appendChild(msgDiv);
        });
        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    }

    function checkUnreadStatus() {
        const hasUnread = [...localConversations.values()].some(c => c.is_unread);
        if (pvNotificationDot) { pvNotificationDot.style.display = hasUnread ? 'block' : 'none'; }
    }

    // --- INICIALIZAÇÃO E EVENT LISTENERS ---

    async function initializePV() {
        if (!supabaseClient) {
            console.error("Supabase client não encontrado. O sistema de PV não funcionará.");
            return;
        }
        
        loadFromLocalStorage();

        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
            const { data: player } = await supabaseClient.from('players').select('id, name').eq('id', user.id).single();
            if (player) currentPlayer = player;
        }
        
        await fetchAndSyncMessages();
        setupEventListeners();
        checkUnreadStatus();
    }

    function setupEventListeners() {
        if (pvMenuBtn) { pvMenuBtn.onclick = () => { pvModal.style.display = 'flex'; pvNotificationDot.style.display = 'none'; }; }
        if (closePvModalBtn) { closePvModalBtn.onclick = () => pvModal.style.display = 'none'; }
        
        // Listener das abas (MENSAGENS / SISTEMA) - RESTAURADO
        pvTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                pvTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                pvMessageContent.style.display = (tab.dataset.tab === 'pv-messages') ? 'block' : 'none';
                pvSystemContent.style.display = (tab.dataset.tab === 'pv-system') ? 'block' : 'none';
            });
        });

        if (backToListBtn) { backToListBtn.onclick = () => { chatViewDiv.style.display = 'none'; conversationListDiv.style.display = 'flex'; currentOpenConversationId = null; }; }
        const handleSendMessage = async () => {
            const messageText = chatInput.value.trim();
            if (!messageText || !currentOpenConversationId) return;
            
            sendMessageBtn.style.pointerEvents = 'none';
            chatInput.disabled = true;

            // CORREÇÃO: Revertendo para os nomes de parâmetros e tipo de dado originais e funcionais.
            const { data, error } = await supabaseClient.rpc('send_private_message', {
                conversation_id: currentOpenConversationId, // Corrigido de p_conversation_id e sem parseInt
                message_text: messageText                   // Corrigido de p_message_text
            });

            if (error) {
                showFloatingMessage(`Erro: ${error.message}`);
                // Reabilita o input em caso de erro
                sendMessageBtn.style.pointerEvents = 'auto';
                chatInput.disabled = false;
            } else {
                chatInput.value = '';
                // Atualiza a conversa localmente e re-renderiza
                await fetchAndSyncMessages();
                const currentConvo = localConversations.get(currentOpenConversationId);
                if (currentConvo) {
                   renderChatMessages(currentConvo);
                   chatInput.placeholder = 'Aguardando resposta...';
                   sendMessageBtn.style.filter = 'grayscale(1)';
                } else {
                   backToListBtn.click();
                }
            }
        };
        

        if (sendMessageBtn) { sendMessageBtn.onclick = handleSendMessage; }
        if (chatInput) { chatInput.onkeydown = (e) => { if (e.key === 'Enter' && !chatInput.disabled) { handleSendMessage(); } }; }

        if (deleteConvoBtn) {
            deleteConvoBtn.onclick = () => {
                if (!currentOpenConversationId) return;
                showConfirmModal(
                    "Tem certeza que deseja apagar esta conversa? Esta ação não pode ser desfeita e apagará a conversa apenas para você.",
                    () => { // onConfirm callback
                        localConversations.delete(currentOpenConversationId);
                        saveToLocalStorage();
                        renderConversationList();
                        backToListBtn.click();
                        showFloatingMessage("Conversa apagada.");
                    }
                );
            };
        }
    }
    
    // --- PONTO DE PARTIDA ---
    // Cria a promessa global e inicia a inicialização.
    window.pvInitializationPromise = new Promise(async (resolve) => {
        await initializePV();
        console.log("[pv.js] Promise de inicialização resolvida.");
        resolve();
    });
});