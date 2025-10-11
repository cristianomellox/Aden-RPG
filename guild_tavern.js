// guild_tavern.js - Versão com Cache Local de Mensagens
document.addEventListener('DOMContentLoaded', async () => {
    // --- Bloco de Inicialização Seguro ---
    let supabase;
    try {
        const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
        const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
        supabase = (window.supabase && window.supabase.createClient) ?
            window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) :
            null;
        if (!supabase) throw new Error('Cliente Supabase não pôde ser inicializado.');
    } catch (error) {
        console.error("Erro fatal na inicialização:", error);
        return;
    }

    // --- Referências do DOM ---
    const tTitle = document.getElementById('tavernTitle');
    const tControls = document.getElementById('tavernControls');
    const tChat = document.getElementById('tavernChat');
    const tMessageInput = document.getElementById('tavernMessageInput');
    const tSendBtn = document.getElementById('tavernSendBtn');
    const tActiveArea = document.getElementById('tavernActiveArea');
    const tNotifContainer = document.getElementById('tavernNotificationContainer') || document.body;
    const tShowMembersBtn = document.getElementById('showMembersBtn');
    const tMembersCount = document.getElementById('membersCount');
    const tMembersModal = document.getElementById('membersModal');
    const tCloseMembersModal = document.getElementById('closeMembersModal');
    const tMembersList = document.getElementById('membersList');

    // --- Variáveis de Estado ---
    let userId = null;
    let guildId = null;
    let myPlayerData = {};
    let currentRoom = null;
    let joined = false;
    let tavernPollId = null;
    const playersCache = new Map();
    let messageCache = []; // NOVO: Cache local para as mensagens

    // --- Notificações de entradas (cache/local) ---
    let lastSeenEntries = []; // array of { player_name, timestamp }
    const recentEntryQueue = []; // FIFO queue for new entries
    let processingEntryQueue = false;
    let lastMessageTimestamp = new Date(0).toISOString();

    // --- Funções de UX ---
    
    function showNotification(message, duration = 3000) {
        // returns a Promise that resolves when the notif is removed
        return new Promise((resolve) => {
            const notifEl = document.createElement('div');
            notifEl.className = 'tavern-notification';
            notifEl.textContent = message;
            notifEl.style.cssText = `position: fixed; top: 10px; left: 50%; transform: translateX(-50%) translateY(-10px); width: 320px; max-width: 90vw; text-align: center; background: rgba(34,34,34,0.95); color: #fff; padding: 10px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.6); z-index: 99999; opacity: 0;`;
            (tNotifContainer || document.body).appendChild(notifEl);
            // force a frame so transition applies
            requestAnimationFrame(() => {
                notifEl.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
                notifEl.style.opacity = '1';
                notifEl.style.transform = 'translateX(-50%) translateY(0)';
            });
            // remove after duration
            setTimeout(() => {
                notifEl.style.opacity = '0';
                notifEl.style.transform = 'translateX(-50%) translateY(-20px)';
                setTimeout(() => {
                    try { notifEl.remove(); } catch(e){}
                    resolve();
                }, 360);
            }, duration);
        });
    }


    // NOVA FUNÇÃO: Renderiza mensagens na tela para evitar repetição de código
    function renderMessages(messagesToRender) {
        messagesToRender.forEach(m => {
            const div = document.createElement('div');
            div.className = 'tavern-message';
            // Sanitiza a mensagem para evitar injeção de HTML
            const sanitizedMessage = m.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            div.innerHTML = `<img src="${m.player_avatar || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${m.player_name}" /><div><b>${m.player_name}</b><div class="bubble">${sanitizedMessage}</div></div>`;
            tChat.appendChild(div);
        });
    }
    
    // --- Funções de Gerenciamento de Estado ---
    async function getSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;
        userId = session.user.id;
        const { data: player } = await supabase.from('players').select('guild_id, name, avatar_url').eq('id', userId).single();
        if (!player) return false;
        guildId = player.guild_id;
        myPlayerData = { name: player.name, avatar_url: player.avatar_url };
        playersCache.set(userId, myPlayerData);
        return true;
    }

    async function ensureRoom() {
        // ... (função mantida como estava)
        const { data } = await supabase.from('tavern_rooms').select('*').eq('guild_id', guildId).limit(1);
        if (data && data.length) {
            currentRoom = data[0];
        } else {
            const { data: created } = await supabase.rpc('create_tavern_room', { p_guild_id: guildId, p_name: 'Taverna', p_open: false });
            currentRoom = created[0];
        }
    }

    // ATUALIZADO: para incluir inicialização do chat
    async function joinRoom() {
        if (!currentRoom || joined) return;
        
        await supabase.rpc('join_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        
        joined = true;
        showNotification(`${myPlayerData.name} entrou na Taverna.`);
        tActiveArea.style.display = 'block';
        tSendBtn.disabled = false;
        
        await initializeChat(); // Puxa o histórico inicial de mensagens
        
        renderControls();
        startPolling();
    }

    // ATUALIZADO: para limpar o cache ao sair
    async function leaveRoom() {
        if (!currentRoom || !joined) return;
        await supabase.rpc('leave_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        joined = false;
        stopPolling();
        tActiveArea.style.display = 'none';
        tSendBtn.disabled = true;
        renderControls();
        
        // Limpa a tela e o cache local
        tChat.innerHTML = '';
        messageCache = [];
        lastMessageTimestamp = new Date(0).toISOString();
    }

    // NOVA FUNÇÃO: Busca o histórico inicial de mensagens
    async function initializeChat() {
        tChat.innerHTML = '';
        messageCache = [];

        const { data: initialMsgs, error } = await supabase
            .from('tavern_messages')
            .select('player_name, player_avatar, message, created_at')
            .eq('room_id', currentRoom.id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            console.error("Erro ao buscar histórico do chat:", error);
            return;
        }

        if (initialMsgs && initialMsgs.length > 0) {
            initialMsgs.reverse(); // Coloca na ordem cronológica correta
            messageCache = initialMsgs;
            renderMessages(messageCache);
            lastMessageTimestamp = messageCache[messageCache.length - 1].created_at;
            tChat.scrollTop = tChat.scrollHeight; // Rola para a mensagem mais recente
        }
    }
    
    // --- Lógica de Polling ---
    function startPolling() {
        stopPolling();
        tavernPollId = setInterval(pollTavernState, 30000);
        pollTavernState();
    }

    function stopPolling() {
        clearInterval(tavernPollId);
    }
    
    async function pollTavernState() {
        if (!joined) return;
        try {
            await supabase.rpc('cleanup_inactive_tavern_members');
            await supabase.rpc('cleanup_old_tavern_messages');
            const { count } = await supabase.from('tavern_members').select('*', { count: 'exact', head: true }).eq('room_id', currentRoom.id);
            if (tMembersCount) tMembersCount.textContent = count || 0;
            await updateChat();
            await checkRecentEntries();
        } catch (e) {
            console.warn("Falha no polling da Taverna:", e);
        }
    }

    function renderControls() {
        // ... (função mantida como estava)
         if (joined) {
            tControls.innerHTML = `<button id="leaveTavernBtn" class="tavernSendBtn">Sair</button>`;
            document.getElementById('leaveTavernBtn').onclick = leaveRoom;
        } else {
            tControls.innerHTML = `<button id="joinTavernBtn" class="tavernSendBtn">Entrar na Taverna</button>`;
            document.getElementById('joinTavernBtn').onclick = joinRoom;
        }
    }
    
    // ATUALIZADO: para adicionar novas mensagens ao cache
    async function updateChat() {
        if (!joined) return;
        const { data: newMsgs } = await supabase
            .from('tavern_messages')
            .select('player_name, player_avatar, message, created_at')
            .eq('room_id', currentRoom.id)
            .gt('created_at', lastMessageTimestamp)
            .order('created_at', { ascending: true })
            .limit(100); // Limite de 100 novas mensagens por busca

        if (newMsgs && newMsgs.length > 0) {
            const shouldScroll = (tChat.scrollHeight - tChat.scrollTop < tChat.clientHeight + 250);
            
            messageCache.push(...newMsgs); // Adiciona ao cache local
            renderMessages(newMsgs); // Renderiza apenas as novas
            
            lastMessageTimestamp = newMsgs[newMsgs.length - 1].created_at;

            if(shouldScroll) {
                tChat.scrollTop = tChat.scrollHeight;
            }
        }
    }
    
    tSendBtn.onclick = async () => {
        // ... (função mantida como na última versão, a lógica de cache não precisa ser tocada aqui)
        const txt = tMessageInput.value.trim();
        if (!txt || !joined) return;

        const messageToSend = txt;
        tMessageInput.value = '';
        
        const div = document.createElement('div');
        div.className = 'tavern-message';
        div.innerHTML = `<img src="${myPlayerData.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" /><div><b>${myPlayerData.name}</b><div class="bubble">${messageToSend.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div>`;
        tChat.appendChild(div);
        tChat.scrollTop = tChat.scrollHeight;
        
        try {
            const { data: newMessages, error } = await supabase.rpc('post_tavern_message', { 
                p_room_id: currentRoom.id, 
                p_player_id: userId, 
                p_player_name: myPlayerData.name, 
                p_player_avatar: myPlayerData.avatar_url, 
                p_message: messageToSend 
            });

            if (error) throw error;
            
            if (newMessages && newMessages.length > 0) {
                lastMessageTimestamp = newMessages[0].created_at;
            }
            await supabase.rpc('update_tavern_member_activity', { p_room_id: currentRoom.id, p_player_id: userId });

        } catch(e) {
            console.error("Falha ao enviar mensagem:", e);
            div.remove();
            showNotification("Sua mensagem não pôde ser enviada.");
            tMessageInput.value = messageToSend;
        }
    };
    
    tMessageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            tSendBtn.click();
        }
    });

    // --- Lógica do Modal de Membros ---
    // ... (função fetchTavernMembers e listeners mantidos como estavam)
    async function fetchTavernMembers() {
        if (!currentRoom?.id) return;
        tMembersList.innerHTML = '<li>Carregando membros...</li>';
        try {
            const { data, error } = await supabase.rpc('get_tavern_members', { p_room_id: currentRoom.id });
            if (error) throw error;
            if (tMembersCount) tMembersCount.textContent = data.length;
            if (data.length === 0) {
                tMembersList.innerHTML = '<li>Ninguém na taverna.</li>';
                return;
            }
            const playerIdsToFetch = data.map(m => m.player_id).filter(id => !playersCache.has(id));
            if (playerIdsToFetch.length > 0) {
                const { data: players, error: playerError } = await supabase.from('players').select('id, name, avatar_url').in('id', playerIdsToFetch);
                if (playerError) throw playerError;
                players.forEach(p => playersCache.set(p.id, p));
            }
            tMembersList.innerHTML = data.map(member => {
                const player = playersCache.get(member.player_id);
                return `
                <li style="display: flex; align-items: center; margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px solid #555;">
                    <img src="${player?.avatar_url || 'default_avatar.png'}" alt="${player?.name}" style="width: 30px; height: 30px; border-radius: 50%; margin-right: 10px; object-fit: cover;">
                    <span style="font-size: 0.8em;">
                        <strong>${player?.name || 'Carregando...'}</strong>
                    </span>
                </li>`;
            }).join('');
        } catch (e) {
            console.error('Erro ao buscar membros:', e);
            tMembersList.innerHTML = `<li>Erro ao carregar a lista.</li>`;
        }
    }
    if (tShowMembersBtn) tShowMembersBtn.addEventListener('click', () => { if (tMembersModal) { tMembersModal.style.display = 'block'; fetchTavernMembers(); } });
    if (tCloseMembersModal) tCloseMembersModal.addEventListener('click', () => { tMembersModal.style.display = 'none'; });
    if (tMembersModal) tMembersModal.addEventListener('click', (e) => { if (e.target === tMembersModal) { tMembersModal.style.display = 'none'; } });

    // --- Inicialização ---
    
    // --- Funções para gerenciar fila de notificações de entrada ---
    function enqueueEntry(entry) {
        // entry: { player_name, timestamp }
        recentEntryQueue.push(entry);
        processEntryQueue();
    }

    async function processEntryQueue() {
        if (processingEntryQueue) return;
        processingEntryQueue = true;
        try {
            while (recentEntryQueue.length > 0) {
                const entry = recentEntryQueue.shift();
                // mostra a notificação (espera terminar antes de mostrar a próxima)
                try {
                    await showNotification(`${entry.player_name} entrou na Taverna.`, 3000);
                } catch (e) {
                    // falha silenciosa para não travar a fila
                    console.warn("Erro ao mostrar notificação de entrada:", e);
                }
            }
        } finally {
            processingEntryQueue = false;
        }
    }

    async function loadRecentEntries() {
        if (!currentRoom?.id) return;
        try {
            const { data, error } = await supabase
                .from('tavern_rooms')
                .select('recent_entries')
                .eq('id', currentRoom.id)
                .maybeSingle();
            if (error) {
                console.warn("Erro ao carregar recent_entries:", error);
                return;
            }
            if (data && Array.isArray(data.recent_entries)) {
                lastSeenEntries = data.recent_entries.slice();
            } else {
                lastSeenEntries = [];
            }
        } catch (e) {
            console.error("Falha em loadRecentEntries:", e);
        }
    }

    async function checkRecentEntries() {
        if (!currentRoom?.id || !joined) return;
        try {
            const { data, error } = await supabase
                .from('tavern_rooms')
                .select('recent_entries')
                .eq('id', currentRoom.id)
                .maybeSingle();
            if (error) {
                console.warn("Erro ao buscar entradas recentes:", error);
                return;
            }
            const entries = (data && Array.isArray(data.recent_entries)) ? data.recent_entries : [];
            // Ordena por timestamp (asc)
            entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            // Filtra apenas as novas (não vistas)
            const newEntries = entries.filter(e => {
                return !lastSeenEntries.some(seen => seen.player_name === e.player_name && seen.timestamp === e.timestamp);
            });
            // Enfileira novas entradas (exceto a própria entrada do usuário)
            newEntries.forEach(e => {
                if (e.player_name !== myPlayerData.name) enqueueEntry(e);
            });
            // Atualiza o cache local para o estado do servidor
            lastSeenEntries = entries;
        } catch (e) {
            console.error("Falha ao verificar entradas recentes:", e);
        }
    }

async function initialize() {
        if (!(await getSession())) {
            tControls.innerHTML = '<p>Você precisa estar logado e em uma guilda para usar a Taverna.</p>';
            return;
        }
        if (!guildId) {
            tControls.innerHTML = '<p>Você precisa estar em uma guilda para usar a Taverna.</p>';
            return;
        }
        await ensureRoom();
        await loadRecentEntries();
        tTitle.textContent = currentRoom?.name || 'Taverna';
        renderControls();
    }

    initialize();
});