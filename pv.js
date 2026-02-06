import { supabase } from './supabaseClient.js'

// =========================================================
// >>> ADEN GLOBAL DB (Zero Egress Auth & Player) <<<
// =========================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 3;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(AUTH_STORE, 'readonly');
                const req = tx.objectStore(AUTH_STORE).get('current_session');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    getPlayer: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(PLAYER_STORE, 'readonly');
                const req = tx.objectStore(PLAYER_STORE).get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
    // --- SETUP INICIAL ---
    
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
    
    // Elementos do Modal de Mensagem do Sistema
    const systemMessageModal = document.getElementById('systemMessageModal');
    const closeSystemMessageModalBtn = document.getElementById('closeSystemMessageModalBtn');
    const systemMessageTitle = document.getElementById('systemMessageTitle');
    const systemMessageContent = document.getElementById('systemMessageContent');
    const systemMessageDate = document.getElementById('systemMessageDate');

    // Referência ao Botão da Aba Sistema (para o dot local)
    const pvSystemTabBtn = document.querySelector('.pv-tab-btn[data-tab="pv-system"]');

    // Lógica do Modal de Confirmação (Não alterado)
    const confirmModal = document.getElementById('confirmModal');
    const confirmModalMessage = document.getElementById('pvConfirmModalMessage');
    let confirmModalConfirmBtn = document.getElementById('confirmModalConfirmBtn');
    const confirmModalCancelBtn = document.getElementById('confirmModalCancelBtn');
    const confirmModalCloseBtn = confirmModal ? confirmModal.querySelector('.close-btn') : null;

    const closeConfirmModal = () => { if (confirmModal) confirmModal.style.display = 'none'; };

    function showConfirmModal(message, onConfirm) {
        if (!confirmModal || !confirmModalMessage || !confirmModalConfirmBtn) {
            if (confirm(message)) onConfirm(); 
            return;
        }
        confirmModalMessage.textContent = message;
        const newConfirmBtn = confirmModalConfirmBtn.cloneNode(true);
        confirmModalConfirmBtn.parentNode.replaceChild(newConfirmBtn, confirmModalConfirmBtn);
        confirmModalConfirmBtn = newConfirmBtn;
        newConfirmBtn.addEventListener('click', () => { 
            closeConfirmModal();
            if (typeof onConfirm === 'function') onConfirm();
        }, { once: true });
        confirmModal.style.display = 'flex';
        newConfirmBtn.focus();
    }

    if (confirmModal) {
        confirmModalCancelBtn.addEventListener('click', closeConfirmModal);
        confirmModalCloseBtn.addEventListener('click', closeConfirmModal);
        confirmModal.addEventListener('click', (event) => { if (event.target === confirmModal) closeConfirmModal(); });
    }

    // --- FUNÇÕES DO MODAL DE MENSAGEM DO SISTEMA ---
    function showSystemMessageModal(title, content, date) {
        if (!systemMessageModal) return;
        systemMessageTitle.textContent = title;
        systemMessageContent.textContent = content;
        systemMessageDate.textContent = `Enviada em: ${date}`;
        systemMessageModal.style.display = 'flex';
    }

    function closeSystemMessageModal() {
        if (systemMessageModal) {
            systemMessageModal.style.display = 'none';
            systemMessageTitle.textContent = '';
            systemMessageContent.textContent = '';
            systemMessageDate.textContent = '';
        }
    }
    
    // Event listeners do Modal de Mensagem do Sistema
    if (closeSystemMessageModalBtn) {
        closeSystemMessageModalBtn.onclick = closeSystemMessageModal;
    }
    if (systemMessageModal) {
        systemMessageModal.addEventListener('click', (event) => {
            if (event.target === systemMessageModal) closeSystemMessageModal();
        });
    }

    // --- ESTADO LOCAL ---
    let localConversations = new Map();
    let localSystemMessages = new Map(); 
    let currentPlayer = null;
    let currentOpenConversationId = null;
    
    // --- CACHE DE JOGADORES ---
    const playerCache = new Map(); 

    // ----------------------------------------------------
    // FUNÇÕES DE MENSAGEM DE SISTEMA 
    // ----------------------------------------------------

    async function fetchAndRenderSystemMessages({ markAsRead = false } = {}) {
        if (!currentPlayer || !systemMessagesListDiv) return;

        // 1. Busca a ID da última mensagem de sistema lida por este jogador
        const lastReadId = parseInt(localStorage.getItem(`pv_system_last_read_${currentPlayer.id}`) || '0');
        let highestId = lastReadId;

        systemMessagesListDiv.innerHTML = '<p>Carregando mensagens do sistema...</p>';

        // Busca title, preview (LEVE) e created_at. Content (PESADO) é baixado apenas no clique.
        const { data: dbMessages, error: msgError } = await supabaseClient
            .from('system_messages')
            .select('id, title, preview, created_at') 
            .or(`target_player_id.is.null,target_player_id.eq.${currentPlayer.id}`)
            .order('created_at', { ascending: false }); 
        
        if (msgError) {
            console.error("Erro ao buscar mensagens do sistema:", msgError);
            systemMessagesListDiv.innerHTML = '<p>Erro ao carregar mensagens do sistema.</p>';
            return;
        }

        if (dbMessages.length === 0) {
            systemMessagesListDiv.innerHTML = '<p>Nenhuma mensagem do sistema.</p>';
            checkUnreadStatus(); 
            return;
        }

        localSystemMessages = new Map();
        systemMessagesListDiv.innerHTML = '';
        let hasUnreadSystem = false;

        dbMessages.forEach(msg => {
            const msgId = String(msg.id);
            localSystemMessages.set(msgId, msg);

            const msgDiv = document.createElement('div');
            msgDiv.className = 'system-message-item conversation-item';
            
            const numericId = parseInt(msg.id);

            // 2. Verifica se a mensagem é nova
            let isUnread = numericId > lastReadId;
            if (isUnread) {
                msgDiv.classList.add('unread');
                hasUnreadSystem = true;
            }

            // 3. Atualiza a ID mais alta encontrada
            if (numericId > highestId) {
                highestId = numericId;
            }

            const sentDate = new Date(msg.created_at);
            const formattedDate = `${sentDate.toLocaleDateString()} ${sentDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            
            // Renderiza o TÍTULO e a PRÉVIA
            msgDiv.innerHTML = `
                <p class="conversation-name">${msg.title || 'Mensagem do Sistema'}</p>
                <p class="conversation-preview">${msg.preview || 'Clique para ler.'}</p> 
                <small class="system-message-date">${formattedDate}</small>
            `;
            
            // 4. Implementação da visualização completa da mensagem no MODAL com Fetch Lazy
            msgDiv.addEventListener('click', async () => {
                 // Busca o conteúdo completo apenas agora
                 const { data: fullMsg } = await supabaseClient
                    .from('system_messages')
                    .select('content')
                    .eq('id', msg.id)
                    .single();

                 if (fullMsg) {
                     showSystemMessageModal(
                        msg.title || 'Mensagem do Sistema',
                        fullMsg.content,
                        formattedDate
                     );
                 }
                 
                 // Remove o visual de 'unread' localmente ao clicar
                 if (isUnread) {
                    msgDiv.classList.remove('unread');
                    // Não salva no local storage aqui, apenas na abertura da aba.
                 }
            });
            
            systemMessagesListDiv.appendChild(msgDiv);
        });

        // 5. Se for solicitado para marcar como lida, salva a ID mais alta
        if (markAsRead && highestId > lastReadId) {
            localStorage.setItem(`pv_system_last_read_${currentPlayer.id}`, highestId);
            hasUnreadSystem = false; // A notificação deve ser desligada
        }

        // 6. Recalcula o status geral de notificação
        checkUnreadStatus(hasUnreadSystem);
    }
    
    // Verifica o status de notificação geral (PV + Sistema)
    function checkUnreadStatus(hasUnreadSystem) {
        // Verifica mensagens privadas (PV)
        const hasUnreadPv = [...localConversations.values()].some(c => c.is_unread && !c.is_server_deleted);
        
        // Verifica mensagens de sistema (apenas se não foi passado no argumento)
        let systemUnread = hasUnreadSystem;
        if (systemUnread === undefined) {
             const lastReadId = parseInt(localStorage.getItem(`pv_system_last_read_${currentPlayer.id}`) || '0');
             const newestMsg = [...localSystemMessages.values()].reduce((max, msg) => Math.max(max, parseInt(msg.id)), 0);
             systemUnread = newestMsg > lastReadId;
        }

        // NOVO: Atualiza a bolinha de notificação local na aba "Sistema"
        if (pvSystemTabBtn) {
            if (systemUnread) {
                pvSystemTabBtn.classList.add('has-unread-system');
            } else {
                pvSystemTabBtn.classList.remove('has-unread-system');
            }
        }

        // Se houver PV ou sistema não lida, mostra o dot principal
        const hasUnreadTotal = hasUnreadPv || systemUnread;
        if (pvNotificationDot) { pvNotificationDot.style.display = hasUnreadTotal ? 'block' : 'none'; }
    }


    // ----------------------------------------------------
    // FUNÇÕES DE MENSAGEM PRIVADA (OTIMIZADA)
    // ----------------------------------------------------

    async function fetchAndSyncMessages() {
        if (!currentPlayer) return;
        
        if (currentPlayer.id && currentPlayer.name) {
            playerCache.set(String(currentPlayer.id), currentPlayer.name);
        }

        // --- LÓGICA DE LIMPEZA DIÁRIA (OTIMIZADO: 1 VEZ POR DIA) ---
        const STORAGE_KEY_CLEANUP = `aden_pv_cleanup_${currentPlayer.id}`;
        const todayStr = new Date().toISOString().split('T')[0];
        const lastCleanup = localStorage.getItem(STORAGE_KEY_CLEANUP);

        if (lastCleanup !== todayStr) {
            console.log("🧹 [PV] Executando limpeza diária de mensagens antigas...");
            // Executa sem 'await' para não travar o carregamento da interface (Fire & Forget)
            supabaseClient.rpc('cleanup_old_private_messages')
                .then(() => {
                    localStorage.setItem(STORAGE_KEY_CLEANUP, todayStr);
                    // console.log("✅ [PV] Limpeza concluída.");
                })
                .catch(err => console.warn("⚠️ Falha na limpeza de PV:", err));
        }
        
        // OTIMIZAÇÃO: Busca apenas metadados, SEM a coluna 'messages'
        const { data: dbConversations, error: convoError } = await supabaseClient
            .from('private_messages')
            .select('id, player_one_id, player_two_id, last_message, last_sender_id, updated_at, unread_by_player_one, unread_by_player_two')
            .or(`player_one_id.eq.${currentPlayer.id},player_two_id.eq.${currentPlayer.id}`);
        
        if (convoError) { 
            console.error("Erro ao buscar conversas:", convoError); 
            renderConversationList(); 
            checkUnreadStatus();
            return; 
        }
        
        const activeConvoIds = new Set();
        const allPlayerIdsToFetch = new Set(); 
        
        dbConversations.forEach(dbConvo => {
            const convoId = String(dbConvo.id);
            activeConvoIds.add(convoId);

            // Mantém mensagens antigas do cache local, pois não vieram do servidor
            const localConvo = localConversations.get(convoId) || { messages: [] };
            
            // Nota: Não fazemos merge de messages aqui para economizar banda. 
            // O merge é feito apenas no openChatView.

            localConvo.id = convoId;
            localConvo.player_one_id = dbConvo.player_one_id;
            localConvo.player_two_id = dbConvo.player_two_id;
            localConvo.last_sender_id = dbConvo.last_sender_id;
            localConvo.last_message = dbConvo.last_message;
            const isPlayerOne = dbConvo.player_one_id === currentPlayer.id;
            localConvo.is_unread = isPlayerOne ? dbConvo.unread_by_player_one : dbConvo.unread_by_player_two;
            
            localConvo.is_server_deleted = false; 

            localConversations.set(convoId, localConvo);

            const otherId = localConvo.player_one_id === currentPlayer.id ? localConvo.player_two_id : localConvo.player_one_id;
            allPlayerIdsToFetch.add(otherId);
        });

        localConversations.forEach((convo, convoId) => {
            if (!activeConvoIds.has(convoId) && convo.id) { 
                convo.is_server_deleted = true;
            }
            if(convo.is_server_deleted) {
                 const otherId = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
                 allPlayerIdsToFetch.add(otherId);
            }
        });

        const idsToFetch = [...allPlayerIdsToFetch].filter(id => !playerCache.has(String(id)) && String(id) !== String(currentPlayer.id));
        if (idsToFetch.length > 0) {
             const { data: otherPlayersData, error: playersError } = await supabaseClient.from('players').select('id, name').in('id', idsToFetch);
             if (playersError) { console.error("Erro ao buscar nomes de jogadores:", playersError); }
             else {
                 otherPlayersData.forEach(player => {
                     playerCache.set(String(player.id), player.name);
                 });
             }
        }

        saveToLocalStorage();
        renderConversationList();
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

    function getPlayerName(playerId) {
        return playerCache.get(String(playerId)) || 'Desconhecido';
    }

    async function renderConversationList() {
        if (!conversationListDiv) return;
        
        const convosToDisplay = [...localConversations.values()];

        if (convosToDisplay.length === 0) {
            conversationListDiv.innerHTML = '<p>Nenhuma mensagem ainda. Inicie uma conversa!</p>';
            return;
        }
        
        conversationListDiv.innerHTML = '';
        
        const sortedConversations = convosToDisplay.sort((a, b) => {
             const lastMsgA = a.messages[a.messages.length - 1]?.timestamp || 0;
             const lastMsgB = b.messages[b.messages.length - 1]?.timestamp || 0;
             return new Date(lastMsgB) - new Date(lastMsgA);
        });
        
        sortedConversations.forEach((convo) => {
            const otherPlayerId = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
            const otherPlayerName = getPlayerName(otherPlayerId); 

            const item = document.createElement('div');
            item.className = 'conversation-item';
            item.dataset.conversationId = convo.id;
            
            if (convo.is_server_deleted) {
                item.classList.add('archived');
                item.innerHTML = `<p class="conversation-name">${otherPlayerName} <span class="archived-label">(ARQUIVADA)</span></p><p class="conversation-preview">${convo.last_message || 'Histórico preservado.'}</p>`;
            } else {
                if (convo.is_unread) { item.classList.add('unread'); }
                item.innerHTML = `<p class="conversation-name">${otherPlayerName}</p><p class="conversation-preview">${convo.last_message || 'Nenhuma mensagem ainda.'}</p>`;
            }
            
            item.addEventListener('click', () => openChatView(convo.id, otherPlayerName));
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
        
        const otherPlayerId = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
        let finalPlayerName = targetPlayerName;

        if (!finalPlayerName || finalPlayerName === 'Desconhecido') {
            finalPlayerName = getPlayerName(otherPlayerId);
        }
        
        chatWithName.textContent = finalPlayerName;

        // OTIMIZAÇÃO: Busca o histórico pesado (messages) SOMENTE AQUI
        if (!convo.is_server_deleted) {
            const { data: msgData } = await supabaseClient
                .from('private_messages')
                .select('messages')
                .eq('id', currentOpenConversationId)
                .single();

            if (msgData && msgData.messages) {
                // Mescla mensagens novas com locais
                const existingMessageTimestamps = new Set(convo.messages.map(m => m.timestamp));
                msgData.messages.forEach(dbMsg => { 
                    if (!existingMessageTimestamps.has(dbMsg.timestamp)) { convo.messages.push(dbMsg); } 
                });
                
                // Salva o histórico atualizado no cache local
                localConversations.set(currentOpenConversationId, convo);
                saveToLocalStorage();
            }
        }
        
        // CORREÇÃO: Mantém o ícone, altera apenas o atributo title (tooltip)
        if (deleteConvoBtn) {
            deleteConvoBtn.style.display = 'block';
            if (convo.is_server_deleted) {
                deleteConvoBtn.title = 'Apagar Histórico Local';
            } else {
                deleteConvoBtn.title = 'Apagar Conversa';
            }
        }
        
        if (convo.is_server_deleted) {
            showFloatingMessage("Esta conversa foi arquivada do servidor. Você pode apenas visualizar o histórico.");
            chatInput.disabled = true;
            chatInput.placeholder = 'Conversa arquivada - somente leitura.';
            sendMessageBtn.style.filter = 'grayscale(1)';
        } else {
            const isPlayerOne = convo.player_one_id === currentPlayer.id;
            const unreadColumn = isPlayerOne ? 'unread_by_player_one' : 'unread_by_player_two';
            
            if (convo.is_unread) {
                convo.is_unread = false;
                await supabaseClient.from('private_messages').update({ [unreadColumn]: false }).eq('id', currentOpenConversationId);
                saveToLocalStorage();
                renderConversationList();
                checkUnreadStatus();
            }
            
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


        conversationListDiv.style.display = 'none';
        chatViewDiv.style.display = 'flex';
        renderChatMessages(convo);
    }
    window.openChatView = openChatView; 
    
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


    // --- INICIALIZAÇÃO E EVENT LISTENERS ---

    async function initializePV() {
        if (!supabaseClient) {
            console.error("Supabase client não encontrado. O sistema de PV não funcionará.");
            return;
        }
        
        loadFromLocalStorage();

        // 🔐 OTIMIZAÇÃO AUTH ZERO EGRESS: Aguardar o script.js carregar primeiro!
        // NÃO fazemos fallback para rede aqui. Se script.js não carregou o player, PV espera.
        
        const waitForPlayer = async () => {
            // 1. Verifica memória RAM (mais rápido)
            if (window.currentPlayerData && window.currentPlayerData.id) {
                return { id: window.currentPlayerData.id, name: window.currentPlayerData.name };
            }
            
            // 2. Verifica Cache Legacy (rápido)
            try {
                const legacyCache = JSON.parse(localStorage.getItem('player_data_cache'));
                if (legacyCache && legacyCache.data && legacyCache.data.id) {
                    return { id: legacyCache.data.id, name: legacyCache.data.name };
                }
            } catch(e) {}

            // 3. Verifica GlobalDB (IndexedDB)
            const globalPlayer = await GlobalDB.getPlayer();
            if (globalPlayer && globalPlayer.id) {
                return { id: globalPlayer.id, name: globalPlayer.name };
            }

            return null;
        };

        currentPlayer = await waitForPlayer();

        // Se ainda não temos player, entramos em modo de espera ativo pelo evento ou polling
        if (!currentPlayer) {
            console.log("⏳ [PV] Aguardando script.js carregar jogador...");
            
            await new Promise((resolve) => {
                // Listener para o evento do script.js
                const onPlayerReady = (e) => {
                    if (e.detail) {
                        currentPlayer = { id: e.detail.id, name: e.detail.name };
                        // console.log("✅ [PV] Jogador recebido via evento.");
                        resolve();
                    }
                };
                window.addEventListener('aden_player_ready', onPlayerReady, { once: true });

                // Polling de segurança (caso o evento já tenha disparado antes do listener)
                const checkInterval = setInterval(async () => {
                    const p = await waitForPlayer();
                    if (p) {
                        currentPlayer = p;
                        // console.log("✅ [PV] Jogador detectado via polling.");
                        window.removeEventListener('aden_player_ready', onPlayerReady);
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 500); // Checa a cada 500ms
            });
        }

        if (!currentPlayer) return; // Segurança extra
        
        // 1. Sincroniza mensagens privadas (apenas metadata e executa limpeza se necessário)
        await fetchAndSyncMessages();
        // 2. Sincroniza mensagens de sistema (sem marcar como lida e sem content pesado)
        await fetchAndRenderSystemMessages({ markAsRead: false }); 

        setupEventListeners();
        // 3. Verifica o status final
        checkUnreadStatus();
    }

    function setupEventListeners() {
        if (pvMenuBtn) { pvMenuBtn.onclick = () => { pvModal.style.display = 'flex'; }; }
        if (closePvModalBtn) { closePvModalBtn.onclick = () => pvModal.style.display = 'none'; };
        
        pvTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                pvTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                pvMessageContent.style.display = (tab.dataset.tab === 'pv-messages') ? 'block' : 'none';
                pvSystemContent.style.display = (tab.dataset.tab === 'pv-system') ? 'block' : 'none';

                if (tab.dataset.tab === 'pv-system') {
                    // Ao abrir a aba SISTEMA, marca como lida e atualiza a lista e o dot.
                    fetchAndRenderSystemMessages({ markAsRead: true }); 
                } else if (tab.dataset.tab === 'pv-messages') {
                    // Garante que o dot é atualizado quando volta para o PV
                    checkUnreadStatus();
                }
            });
        });

        // Botão Voltar (Mensagens Privadas)
        if (backToListBtn) { backToListBtn.onclick = () => { chatViewDiv.style.display = 'none'; conversationListDiv.style.display = 'flex'; currentOpenConversationId = null; }; }
        
        const handleSendMessage = async () => {
            const messageText = chatInput.value.trim();
            if (!messageText || !currentOpenConversationId) return;
            
            const convo = localConversations.get(currentOpenConversationId);
            if (convo && convo.is_server_deleted) {
                 showFloatingMessage("Não é possível enviar mensagens para uma conversa arquivada.");
                 return;
            }

            sendMessageBtn.style.pointerEvents = 'none';
            chatInput.disabled = true;

            const { data, error } = await supabaseClient.rpc('send_private_message', {
                conversation_id: currentOpenConversationId, 
                message_text: messageText                   
            });

            if (error) {
                showFloatingMessage(`Erro: ${error.message}`);
                sendMessageBtn.style.pointerEvents = 'auto';
                chatInput.disabled = false;
            } else {
                chatInput.value = '';
                await fetchAndSyncMessages();
                
                // Após enviar, precisamos atualizar o chat view manualmente pois o fetchAndSync não traz 'messages'
                const currentConvo = localConversations.get(currentOpenConversationId);
                
                // Força refresh das mensagens no chat aberto
                if (currentConvo) {
                    // Simula abertura para puxar novas mensagens
                    await openChatView(currentOpenConversationId);
                    
                    chatInput.placeholder = 'Aguardando resposta...';
                    sendMessageBtn.style.filter = 'grayscale(1)';
                } else {
                   backToListBtn.click();
                }
                
                sendMessageBtn.style.pointerEvents = 'auto'; // Restaura
            }
        };
        

        if (sendMessageBtn) { sendMessageBtn.onclick = handleSendMessage; }
        if (chatInput) { chatInput.onkeydown = (e) => { if (e.key === 'Enter' && !chatInput.disabled) { handleSendMessage(); } }; }

        if (deleteConvoBtn) {
            deleteConvoBtn.onclick = () => {
                if (!currentOpenConversationId) return;
                
                const convo = localConversations.get(currentOpenConversationId);
                // Mensagem de confirmação que varia dinamicamente
                const message = convo && convo.is_server_deleted 
                    ? "Tem certeza que deseja apagar ESTE HISTÓRICO? Esta ação a removerá permanentemente do seu cache local."
                    : "Tem certeza que deseja apagar esta conversa? Esta ação é irreversível e só apagará para você. A conversa ainda existirá para a outra pessoa, caso ela não a tenha apagado.";

                showConfirmModal(message, () => { 
                    localConversations.delete(currentOpenConversationId);
                    saveToLocalStorage();
                    renderConversationList();
                    backToListBtn.click();
                    showFloatingMessage("Conversa apagada.");
                });
            };
        }
    }
    
    // --- PONTO DE PARTIDA ---
    window.pvInitializationPromise = new Promise(async (resolve) => {
        await initializePV();
        console.log("[pv.js] Promise de inicialização resolvida.");
        resolve();
    });
});