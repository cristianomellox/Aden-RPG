import { supabase } from './supabaseClient.js'


document.addEventListener('DOMContentLoaded', async () => {
    

    const tTitle = document.getElementById('tavernTitle');
    const tControls = document.getElementById('tavernControls');
    const tChat = document.getElementById('tavernChat');
    const tMessageInput = document.getElementById('tavernMessageInput');
    const tSendBtn = document.getElementById('tavernSendBtn');
    const tActiveArea = document.getElementById('tavernActiveArea');
    const tNotifContainer = document.getElementById('tavernNotificationContainer') || document.body;
    const tShowMembersBtn = document.getElementById('showMembersBtn');

    let userId = null;
    let myPlayerData = null;
    let currentRoom = null;
    let guildId = null;
    let messagesCache = [];
    let lastPolledMessageId = 0;
    let lastMessageTime = Date.now() - (2 * 60 * 1000 + 100);
    const CHAT_COOLDOWN_MS = 2 * 60 * 1000;
    const originalSendBtnHTML = tSendBtn ? tSendBtn.innerHTML : 'Enviar';
    let countdownInterval = null;
    const ONLINE_PREFIX = 'PLAYER_ONLINE_SIGNAL:';

    // --- CONFIGURAÇÕES DO NOVO POLLING COM BACKOFF E FOCUS POLLING ---
    // Aumento dos intervalos para transformar o chat em um "mural"
    const MAX_POLLING_INTERVAL = 1800000; // 30 minutos
    const BACKOFF_INCREMENT = 300000; // 5 minutos
    const MIN_POLLING_INTERVAL = 300000; // 5 minutos
    let pollingBackoff = MIN_POLLING_INTERVAL - 2000;
    let pollingInterval = null;
    let isPolling = false;

    async function getSession() {
        if (myPlayerData) return true;
        
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return false;
            userId = user.id;

            const { data: playerData, error: playerError } = await supabase
                .from('players')
                .select('name, avatar_url, guild_id')
                .eq('id', userId)
                .single();

            if (playerError || !playerData || !playerData.guild_id) {
                tControls.innerHTML = '<p>Você precisa estar em uma guilda para usar a Taverna.</p>';
                return false;
            }

            myPlayerData = playerData;
            guildId = playerData.guild_id;
            return true;
        } catch (e) {
            console.error('Erro ao obter sessão ou dados do jogador:', e);
            tControls.innerHTML = '<p>Erro ao inicializar a sessão. Por favor, recarregue.</p>';
            return false;
        }
    }

    async function ensureRoom() {
        if (currentRoom) return;
        
        try {
            let { data: roomData, error: roomError } = await supabase
                .from('tavern_rooms')
                .select('id, name')
                .eq('guild_id', guildId)
                .single();
            
            if (roomError && roomError.code === 'PGRST116') {
                const { data: newRoom, error: createError } = await supabase.rpc('create_tavern_room', {
                    p_guild_id: guildId,
                    p_name: 'A Taverna',
                    p_open: false
                });
                if (createError) throw createError;
                currentRoom = newRoom[0];
            } else if (roomError) {
                throw roomError;
            } else {
                currentRoom = roomData;
            }
        } catch (e) {
            console.error('Erro ao garantir sala da Taverna:', e);
            tControls.innerHTML = '<p>Erro ao acessar a sala da Taverna. Tente novamente.</p>';
            throw e;
        }
    }

    function showNotification(message, duration = 3000) {
        if (!tNotifContainer) return;
        const notif = document.createElement('div');
        notif.className = 'tavern-notification';
        notif.textContent = message;
        tNotifContainer.appendChild(notif);

        setTimeout(() => {
            notif.style.opacity = '0';
            setTimeout(() => tNotifContainer.removeChild(notif), 500);
        }, duration);
    }

    function processAndDisplayMessage(message) {
        if (!message || !message.message) return;

        if (message.message.startsWith(ONLINE_PREFIX)) {
                if (message.player_id && message.player_name) {
                    showNotification(`${message.player_name} acabou de entrar na Taverna!`, 5000);
                }
            return;
        }

        if (messagesCache.some(m => m.id === message.id)) return;
        
        messagesCache.push(message);
        messagesCache.sort((a, b) => a.id - b.id);
        if (messagesCache.length > 50) messagesCache.shift();

        renderCachedMessages();
    }

    function renderCachedMessages() {
        tChat.innerHTML = '';
        const fragment = document.createDocumentFragment();

        messagesCache.forEach(message => {
            const msgEl = document.createElement('div');
            msgEl.className = 'tavern-message';
            msgEl.classList.add(message.player_id === userId ? 'self-message' : 'other-message');

            const avatar = document.createElement('img');
            avatar.src = message.player_avatar || 'https://default-avatar.png';
            avatar.alt = message.player_name;
            avatar.title = message.player_name;

            const content = document.createElement('div');
            content.className = 'bubble';
            
            const name = document.createElement('span');
            name.className = 'message-name';
            name.textContent = message.player_name;

            const text = document.createElement('p');
            text.className = 'message-text';
            text.textContent = message.message;

            content.appendChild(name);
            content.appendChild(text);

            msgEl.appendChild(avatar);
            msgEl.appendChild(content);
            fragment.appendChild(msgEl);
        });

        tChat.appendChild(fragment);
        tChat.scrollTop = tChat.scrollHeight;
    }

    async function updateChat(forceReload = false) {
        if (!currentRoom) return;

        try {
            let query = supabase
                .from('tavern_messages')
                .select('id, player_id, player_name, player_avatar, message, created_at')
                .eq('room_id', currentRoom.id)
                .order('id', { ascending: true });

            if (lastPolledMessageId > 0 && !forceReload) {
                query = query.gt('id', lastPolledMessageId);
            } else if (lastPolledMessageId === 0 && !forceReload) {
                query = query.limit(20);
            }

            const { data: newMessages, error } = await query;

            if (error) throw error;
            
            if (newMessages && newMessages.length > 0) {
                newMessages.forEach(msg => processAndDisplayMessage(msg));
                lastPolledMessageId = messagesCache.length > 0 ? messagesCache[messagesCache.length - 1].id : 0;
                
                // Reseta o backoff para garantir o intervalo mínimo
                pollingBackoff = MIN_POLLING_INTERVAL - 2000; 
                persistCaches(); // Salva o cache ao encontrar novas mensagens
            } else {
                // Aumenta o backoff se NÃO houver novas mensagens
                pollingBackoff = Math.min(MAX_POLLING_INTERVAL - 2000, pollingBackoff + BACKOFF_INCREMENT); 
            }

        } catch (e) {
            console.error('Erro ao buscar mensagens:', e);
            // Aumenta o backoff em caso de erro
            pollingBackoff = Math.min(MAX_POLLING_INTERVAL - 2000, pollingBackoff + BACKOFF_INCREMENT); 
        }
    }

    function startPolling() {
        if (isPolling) return;
        isPolling = true;
        
        async function poll() {
            await updateChat();
            
            const interval = Math.max(MIN_POLLING_INTERVAL, Math.min(MAX_POLLING_INTERVAL, 2000 + pollingBackoff));
            
            pollingInterval = setTimeout(poll, interval);
        }

        // Inicia o primeiro polling após um pequeno delay
        pollingInterval = setTimeout(poll, 2000);
    }
    
    function stopPolling() {
        if (!isPolling) return;
        clearTimeout(pollingInterval);
        isPolling = false;
    }

    function handleVisibilityChange() {
        if (document.visibilityState === 'visible') {
            // Se o usuário voltar para a aba, força uma atualização e inicia o polling
            updateChat(true); 
            startPolling();
        } else {
            // Se o usuário sair da aba, para o polling para economizar recursos
            stopPolling();
        }
    }

    function persistCaches() {
        if (guildId) {
            localStorage.setItem(`tavern_cache_${guildId}`, JSON.stringify(messagesCache));
            localStorage.setItem(`tavern_last_id_${guildId}`, lastPolledMessageId);
        }
    }
    
    function loadCaches() {
        try {
            const cachedMessages = localStorage.getItem(`tavern_cache_${guildId}`);
            const cachedLastId = localStorage.getItem(`tavern_last_id_${guildId}`);
            if (cachedMessages) {
                messagesCache = JSON.parse(cachedMessages);
                renderCachedMessages();
                tChat.scrollTop = tChat.scrollHeight;
            }
            if (cachedLastId) {
                lastPolledMessageId = parseInt(cachedLastId, 10);
            }
        } catch (e) {
            console.warn('Erro ao carregar cache local:', e);
            messagesCache = [];
            lastPolledMessageId = 0;
        }
    }

    function startCountdown() {
        if (!tSendBtn) return;
        tSendBtn.disabled = true;
        tSendBtn.style.filter = 'grayscale(0.98)';
        tSendBtn.innerHTML = `<span><span id="cooldownText">${Math.ceil(CHAT_COOLDOWN_MS / 1000)}s</span></span>`;
        const cooldownText = tSendBtn.querySelector('#cooldownText');

        if (countdownInterval) clearInterval(countdownInterval);

        function updateTimer() {
            const timeElapsed = Date.now() - lastMessageTime;
            const timeLeftSeconds = Math.ceil((CHAT_COOLDOWN_MS - timeElapsed) / 1000);

            if (timeLeftSeconds <= 0) {
                clearInterval(countdownInterval);
                countdownInterval = null;
                tSendBtn.disabled = false;
                tSendBtn.style.filter = 'none';
                tSendBtn.innerHTML = originalSendBtnHTML;
            } else {
                if (cooldownText) {
                    cooldownText.textContent = `${timeLeftSeconds}s`;
                }
            }
        }

        countdownInterval = setInterval(updateTimer, 1000);
        updateTimer();
    }

    async function handleSendMessage() {
        if (!tMessageInput || !tSendBtn || !myPlayerData || !currentRoom) return;

        const message = tMessageInput.value.trim();
        if (!message) return;

        const now = Date.now();
        if (now - lastMessageTime < CHAT_COOLDOWN_MS) {
            console.log('Cooldown ativo. Aguarde.');
            showNotification('Aguarde 60 segundos entre as mensagens.', 3000);
            return;
        }

        lastMessageTime = now;
        startCountdown();

        tMessageInput.value = '';

        try {
            const { error } = await supabase.rpc('post_tavern_message', {
                p_room_id: currentRoom.id,
                p_player_id: userId,
                p_player_name: myPlayerData.name,
                p_player_avatar: myPlayerData.avatar_url || 'https://default.png', 
                p_message: message
            });
            
            if (error) throw error;

            await updateChat(true); // Força atualização imediata para ver a mensagem enviada
            
        } catch(e) {
            console.error('Erro ao enviar mensagem:', e);
        }
    }
    
    async function initialize() {
        if (!tControls || !tActiveArea) return;
        
        loadCaches();

        if (!(await getSession())) {
            tControls.innerHTML = '<p>Você precisa estar logado e em uma guilda para usar a Taverna.</p>';
            return;
        }
        await ensureRoom();

        // BroadcastChannel para sincronização entre abas
        window.bc = new BroadcastChannel('guild_' + guildId);
        bc.onmessage = (ev) => {
            if (!ev.data || ev.data.guildId !== guildId) return;
            if (ev.data.type === 'newMessage') {
                processAndDisplayMessage(ev.data.data);
                persistCaches();
            }
        };

        // Adiciona o listener para o evento de visibilidade
        document.addEventListener('visibilitychange', handleVisibilityChange);
        
        // Inicia o chat com uma atualização e o polling, caso a aba esteja visível
        if (document.visibilityState === 'visible') {
            await updateChat(true);
            startPolling();
        }

        try { await supabase.rpc('cleanup_old_tavern_messages'); } catch { }

        try {
            await supabase.from('tavern_messages').insert({
                room_id: currentRoom.id,
                player_id: userId,
                player_name: myPlayerData.name,
                message: `${ONLINE_PREFIX}${myPlayerData.name}`
            });
        } catch(e) {
            console.warn("Não foi possível notificar entrada na taverna:", e);
        }
        
        tSendBtn.onclick = handleSendMessage;
        tMessageInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                handleSendMessage();
                e.preventDefault();
            }
        };

        if (tSendBtn) {
            tSendBtn.disabled = false;
            tSendBtn.style.filter = 'none';
            tSendBtn.innerHTML = originalSendBtnHTML;
        }

        tTitle.textContent = currentRoom?.name || 'Taverna';
        tActiveArea.style.display = 'block';
    }

    initialize();
});