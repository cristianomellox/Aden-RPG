// guild_tavern.js - Versão híbrida com BroadcastChannel + Polling com Backoff Progressivo
// Zero egress local, Supabase consultado de forma inteligente.

document.addEventListener('DOMContentLoaded', async () => {
    // --- Inicialização Supabase ---
    let supabase;
    try {
        const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
        const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
        supabase = (window.supabase && window.supabase.createClient)
            ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
            : null;
        if (!supabase) throw new Error('Cliente Supabase não pôde ser inicializado.');
    } catch (error) {
        console.error("Erro fatal na inicialização:", error);
        return;
    }

    // --- Referências DOM ---
    const tTitle = document.getElementById('tavernTitle');
    const tControls = document.getElementById('tavernControls');
    const tChat = document.getElementById('tavernChat');
    const tMessageInput = document.getElementById('tavernMessageInput');
    const tSendBtn = document.getElementById('tavernSendBtn');
    const tActiveArea = document.getElementById('tavernActiveArea');
    const tNotifContainer = document.getElementById('tavernNotificationContainer') || document.body;
    const tShowMembersBtn = document.getElementById('showMembersBtn');

    // --- Estado e Cooldown ---
    let userId = null;
    let myPlayerData = null;
    let currentRoom = null;
    let guildId = null;
    let messagesCache = [];
    let lastPolledMessageId = 0;
    // Cooldown: Inicializa para um tempo muito antigo para que o botão esteja ATIVO inicialmente
    let lastMessageTime = Date.now() - (60 * 1000 + 100); 
    const CHAT_COOLDOWN_MS = 60 * 1000;
    const originalSendBtnHTML = tSendBtn ? tSendBtn.innerHTML : 'Enviar';
    let countdownInterval = null;
    const ONLINE_PREFIX = 'PLAYER_ONLINE_SIGNAL:';
    let pollingBackoff = 0;
    let pollingInterval = null;
    
    // --- Funções de Ajuda ---

    /** Obtém a sessão do usuário e os dados do jogador. */
    async function getSession() {
        if (myPlayerData) return true;
        
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return false;
            userId = user.id;

            // Busca dados do jogador
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

    /** Garante que a sala da taverna para a guilda exista. */
    async function ensureRoom() {
        if (currentRoom) return;
        
        try {
            // Tenta obter a sala existente
            let { data: roomData, error: roomError } = await supabase
                .from('tavern_rooms')
                .select('id, name')
                .eq('guild_id', guildId)
                .single();
            
            // Se não existir, cria uma (assumindo que 'A Taverna' é o padrão)
            if (roomError && roomError.code === 'PGRST116') { // Não encontrou
                const { data: newRoom, error: createError } = await supabase.rpc('create_tavern_room', {
                    p_guild_id: guildId,
                    p_name: 'A Taverna',
                    p_open: false // Não é aberta a todos
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

    /** Cria e exibe uma notificação temporária. */
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

    /** Processa e exibe uma mensagem, incluindo as de sinalização. */
    function processAndDisplayMessage(message) {
        // Ignora mensagens sem conteúdo ou room_id
        if (!message || !message.message) return;

        // Verifica se é um sinal de jogador online
        if (message.message.startsWith(ONLINE_PREFIX)) {
            // AJUSTE 1: A notificação agora virá via polling/BC para TODOS, incluindo o próprio jogador
            // (se ele tiver mais de uma aba aberta)
            // Certifique-se de que a mensagem não é do sistema, mas de um jogador
            if (message.player_id && message.player_name) {
                showNotification(`${message.player_name} acabou de entrar na Taverna!`, 5000);
            }
            return; // Não exibe a mensagem de sinalização no chat
        }

        // Se a mensagem já estiver no cache, ignora
        if (messagesCache.some(m => m.id === message.id)) return;
        
        // Adiciona ao cache (e limita o tamanho do cache para evitar crescimento infinito)
        messagesCache.push(message);
        messagesCache.sort((a, b) => a.id - b.id);
        if (messagesCache.length > 50) messagesCache.shift();

        renderCachedMessages();
    }

    /** Renderiza o cache de mensagens no DOM. */
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
        tChat.scrollTop = tChat.scrollHeight; // Scroll para a última mensagem
    }

    /** Busca as últimas mensagens e atualiza o chat. */
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
            if (!newMessages || newMessages.length === 0) return;

            newMessages.forEach(msg => processAndDisplayMessage(msg));

            lastPolledMessageId = messagesCache.length > 0 ? messagesCache[messagesCache.length - 1].id : 0;
            
            pollingBackoff = 0;

        } catch (e) {
            console.error('Erro ao buscar mensagens:', e);
            pollingBackoff = Math.min(60000, pollingBackoff + 2000);
        }
    }

    /** Inicia o polling com backoff progressivo. */
    function startPollingWithBackoff(immediately = false) {
        if (pollingInterval) clearInterval(pollingInterval);
        
        async function poll() {
            await updateChat();
            
            const interval = Math.max(1000, Math.min(60000, 2000 + pollingBackoff));
            
            pollingInterval = setTimeout(poll, interval);
        }

        if (immediately) {
            poll();
        } else {
            pollingInterval = setTimeout(poll, 2000);
        }
    }

    /** Persiste o cache de mensagens no armazenamento local. */
    function persistCaches() {
        if (guildId) {
            localStorage.setItem(`tavern_cache_${guildId}`, JSON.stringify(messagesCache));
            localStorage.setItem(`tavern_last_id_${guildId}`, lastPolledMessageId);
        }
    }
    
    /** Carrega o cache de mensagens do armazenamento local. */
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

    // [NOVA FUNÇÃO] Para iniciar o cronômetro e desabilitar o botão
    function startCountdown() {
        if (!tSendBtn) return;
        tSendBtn.disabled = true;
        tSendBtn.style.filter = 'grayscale(0.7)';
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

    // [NOVA FUNÇÃO] Manipulador de envio de mensagem com lógica de cooldown
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

        // Inicia o cooldown IMEDIATAMENTE (e salva o tempo)
        lastMessageTime = now;
        startCountdown();

        tMessageInput.value = '';

        try {
            // Usa o RPC para postar a mensagem
            const { error } = await supabase.rpc('post_tavern_message', {
                p_room_id: currentRoom.id,
                p_player_id: userId,
                p_player_name: myPlayerData.name,
                p_player_avatar: myPlayerData.avatar_url || 'https://default.png', 
                p_message: message
            });
            
            if (error) throw error;

            await updateChat();
            
        } catch(e) {
            console.error('Erro ao enviar mensagem:', e);
        }
    }
    
    /** Inicializa a Taverna. */
    async function initialize() {
        if (!tControls || !tActiveArea) return;
        
        loadCaches();

        if (!(await getSession())) {
            tControls.innerHTML = '<p>Você precisa estar logado e em uma guilda para usar a Taverna.</p>';
            return;
        }
        await ensureRoom();

        // AJUSTE 1: RE-ADICIONADO - Mostrar notificação para o próprio jogador imediatamente.
        showNotification(`${myPlayerData.name} está online`, 5000);

        window.bc = new BroadcastChannel('guild_' + guildId);
        bc.onmessage = (ev) => {
            if (!ev.data || ev.data.guildId !== guildId) return;
            if (ev.data.type === 'newMessage') {
                processAndDisplayMessage(ev.data.data);
                persistCaches();
            }
        };

        await updateChat();
        startPollingWithBackoff(true);
        
        try { await supabase.rpc('cleanup_old_tavern_messages'); } catch { }

        // Enviar evento "online" para outros jogadores (usando o insert original)
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
        
        // Adicionar os manipuladores de eventos para o botão e Enter
        tSendBtn.onclick = handleSendMessage;
        tMessageInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                handleSendMessage();
                e.preventDefault();
            }
        };

        // Cooldown: O botão deve estar habilitado na inicialização
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