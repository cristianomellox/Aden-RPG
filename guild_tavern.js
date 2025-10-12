// guild_tavern.js - Versão híbrida com BroadcastChannel + lazy pull
// Zero egress local, Supabase consultado apenas quando necessário

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

    // --- Estado ---
    let userId = null;
    let guildId = null;
    let myPlayerData = {};
    let currentRoom = null;

    const PLAYERS_CACHE_KEY = 'tavern_players_cache_v1';
    const MESSAGES_CACHE_KEY = 'tavern_messages_cache_v1';
    const LAST_TS_KEY = 'tavern_last_message_ts_v1';
    const LAST_SYNC_KEY = 'tavern_last_sync_v1';

    // --- Caches ---
    const playersCache = new Map();
    try {
        const raw = localStorage.getItem(PLAYERS_CACHE_KEY);
        if (raw) JSON.parse(raw).forEach(([k, v]) => playersCache.set(k, v));
    } catch { }

    let messagesCache = [];
    try {
        const raw = localStorage.getItem(MESSAGES_CACHE_KEY);
        if (raw) messagesCache = JSON.parse(raw);
    } catch { }

    let lastMessageTimestamp = localStorage.getItem(LAST_TS_KEY) || new Date(0).toISOString();
    let lastSync = parseInt(localStorage.getItem(LAST_SYNC_KEY) || "0", 10);

    // --- UX ---
    function showNotification(message, duration = 4000) {
        const el = document.createElement('div');
        el.className = 'tavern-notification';
        el.textContent = message;
        el.style.cssText = `position:fixed;top:18px;left:50%;transform:translateX(-50%);
        width: 300px;
        text-align: center;
             background:#222;color:#fff;padding:10px 20px;border-radius:8px;
             box-shadow:0 4px 10px rgba(0,0,0,0.5);opacity:0;transition:opacity .4s;z-index:99999`;
        tNotifContainer.appendChild(el);
        setTimeout(() => el.style.opacity = 1, 10);
        setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 400); }, duration);
    }

    function renderMessageDOM(m) {
        const div = document.createElement('div');
        div.className = 'tavern-message';
        const avatar = m.player_avatar || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
        const safeMsg = (m.message || '').replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const playerName = m.player_name && m.player_name.trim() !== '' ? m.player_name : 'Jogador';
        div.innerHTML = `<img src="${avatar}" alt="${playerName}">
                         <div><b>${playerName}</b><div class="bubble">${safeMsg}</div></div>`;
        tChat.appendChild(div);
    }

    function renderCachedMessages() {
        tChat.innerHTML = '';
        if (messagesCache.length) messagesCache.forEach(renderMessageDOM);
        tChat.scrollTop = tChat.scrollHeight;
    }

    function persistCaches() {
        try {
            localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(Array.from(playersCache.entries())));
            localStorage.setItem(MESSAGES_CACHE_KEY, JSON.stringify(messagesCache));
            localStorage.setItem(LAST_TS_KEY, lastMessageTimestamp);
            localStorage.setItem(LAST_SYNC_KEY, String(lastSync));
        } catch { }
    }

    // --- Sessão ---
    async function getSession() {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) return false;

        userId = session.user.id;
        const { data: player, error: pErr } = await supabase
            .from('players')
            .select('guild_id,name,avatar_url')
            .eq('id', userId)
            .single();

        if (pErr || !player) return false;

        guildId = player.guild_id;
        myPlayerData = {
            name: player.name || 'Desconhecido',
            avatar_url: player.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'
        };
        playersCache.set(userId, myPlayerData);
        persistCaches();

        // Corrige mensagens antigas
        messagesCache = messagesCache.map(m =>
            m.player_id === userId ? { ...m, player_name: myPlayerData.name, player_avatar: myPlayerData.avatar_url } : m
        );
        persistCaches();

        return true;
    }

    async function ensureRoom() {
        if (!guildId) return;
        try {
            const { data } = await supabase.from('tavern_rooms')
                .select('*').eq('guild_id', guildId).limit(1);
            if (data?.length) currentRoom = data[0];
            else {
                const { data: created } = await supabase.rpc('create_tavern_room', {
                    p_guild_id: guildId, p_name: 'Taverna', p_open: false
                });
                currentRoom = Array.isArray(created) ? created[0] : created;
            }
        } catch (e) { console.warn('ensureRoom erro:', e); }
    }

    // --- Atualização (lazy pull) ---
    async function updateChat() {
        if (!currentRoom?.id) return;
        try {
            const { data: msgs, error } = await supabase
                .from('tavern_messages')
                .select('id,player_id,player_name,player_avatar,message,created_at')
                .eq('room_id', currentRoom.id)
                .gt('created_at', lastMessageTimestamp)
                .order('created_at', { ascending: true });

            if (error || !msgs?.length) return;

            const unknownIds = [];
            for (const m of msgs) {
                if (m.player_id && !playersCache.has(m.player_id)) {
                    playersCache.set(m.player_id, {
                        name: m.player_name || 'Jogador',
                        avatar_url: m.player_avatar || null
                    });
                    unknownIds.push(m.player_id);
                }
            }

            if (unknownIds.length) {
                const { data: players } = await supabase
                    .from('players').select('id,name,avatar_url')
                    .in('id', unknownIds);
                if (players?.length)
                    players.forEach(p => playersCache.set(p.id, { name: p.name, avatar_url: p.avatar_url }));
            }

            msgs.forEach(m => {
                const cached = playersCache.get(m.player_id);
                const normalized = {
                    id: m.id,
                    player_id: m.player_id,
                    player_name:
                        (m.player_id === userId ? myPlayerData.name :
                            m.player_name || cached?.name || 'Jogador'),
                    player_avatar:
                        (m.player_id === userId ? myPlayerData.avatar_url :
                            m.player_avatar || cached?.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'),
                    message: m.message,
                    created_at: m.created_at
                };
                renderMessageDOM(normalized);
                messagesCache.push(normalized);
            });

            lastMessageTimestamp = msgs[msgs.length - 1].created_at;
            persistCaches();
            tChat.scrollTop = tChat.scrollHeight;
        } catch (e) { console.warn('updateChat falhou:', e); }
    }

    // --- Envio ---
    tSendBtn.onclick = async () => {
        const txt = tMessageInput.value.trim();
        if (!txt) return;
        tMessageInput.value = '';
        tSendBtn.disabled = true;

        const msgData = {
            id: `optim-${Date.now()}`,
            player_id: userId,
            player_name: myPlayerData.name,
            player_avatar: myPlayerData.avatar_url,
            message: txt,
            created_at: new Date().toISOString()
        };

        renderMessageDOM(msgData);
        messagesCache.push(msgData);
        persistCaches();
        tChat.scrollTop = tChat.scrollHeight;

        // Broadcast local instantâneo
        if (window.bc) {
            bc.postMessage({ type: 'newMessage', guildId, data: msgData });
        }

        // Envio Supabase real
        try {
            const { data: newMsg, error } = await supabase.rpc('post_tavern_message', {
                p_room_id: currentRoom.id,
                p_player_id: userId,
                p_player_name: myPlayerData.name,
                p_player_avatar: myPlayerData.avatar_url,
                p_message: txt
            });
            if (error) throw error;
            const msg = Array.isArray(newMsg) ? newMsg[0] : newMsg;
            const idx = messagesCache.findIndex(m => m.id === msgData.id);
            if (idx !== -1) messagesCache[idx] = msg;
            persistCaches();
        } catch (e) {
            showNotification("Falha ao enviar mensagem", 3000);
            console.warn(e);
        } finally {
            tSendBtn.disabled = false;
        }
    };

    tMessageInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            tSendBtn.click();
        }
    });

    // --- Inicialização ---
    async function initialize() {
        if (tShowMembersBtn) tShowMembersBtn.style.display = 'none';
        renderCachedMessages();

        if (!(await getSession())) {
            tControls.innerHTML = '<p>Você precisa estar logado e em uma guilda para usar a Taverna.</p>';
            return;
        }
        await ensureRoom();

        // --- BroadcastChannel setup ---
        window.bc = new BroadcastChannel('guild_' + guildId);
        bc.onmessage = (ev) => {
            if (!ev.data || ev.data.guildId !== guildId) return;
            if (ev.data.type === 'newMessage') {
                const m = ev.data.data;
                renderMessageDOM(m);
                messagesCache.push(m);
                persistCaches();
                tChat.scrollTop = tChat.scrollHeight;
            }
        };

        // --- Lazy pull inicial + a cada 5 minutos ---
        await updateChat();
        lastSync = Date.now();
        persistCaches();
        setInterval(async () => {
            if (Date.now() - lastSync >= 5 * 60 * 1000) {
                await updateChat();
                lastSync = Date.now();
                persistCaches();
            }
        }, 60 * 1000);

        // --- RPC única de limpeza inicial ---
        try { await supabase.rpc('cleanup_old_tavern_messages'); } catch { }

        // --- Exibir área ---
        tTitle.textContent = currentRoom?.name || 'Taverna';
        tActiveArea.style.display = 'block';
        tSendBtn.disabled = false;
        showNotification(`${myPlayerData.name} está online`, 5000);
    }

    initialize();
});
