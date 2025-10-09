// guild_tavern.js
document.addEventListener('DOMContentLoaded', async () => {
    // --- Bloco de Inicialização Seguro ---
    let supabase;
    try {
        const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
        const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
        supabase = (window.supabase && window.supabase.createClient) ?
            window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) :
            null;

        if (!supabase) {
            throw new Error('Cliente Supabase não pôde ser inicializado.');
        }
    } catch (error) {
        console.error("Erro fatal na inicialização:", error);
        return;
    }

    // --- Referências do DOM ---
    const tTitle = document.getElementById('tavernTitle');
    const tControls = document.getElementById('tavernControls');
    const tSeats = document.getElementById('tavernSeats');
    const tChat = document.getElementById('tavernChat');
    const tMessageInput = document.getElementById('tavernMessageInput');
    const tSendBtn = document.getElementById('tavernSendBtn');
    const tActiveArea = document.getElementById('tavernActiveArea');
    const tAudioContainer = document.getElementById('tavernListeners');
    // NOVO: Container de Notificações (Assumindo que este container existe no guild.html)
    const tNotifContainer = document.getElementById('tavernNotificationContainer') || document.body;

    // --- Variáveis de Estado ---
    let userId = null;
    let guildId = null;
    let userRole = 'member';
    let myPlayerData = {}; 
    let currentRoom = null;
    let myMemberInfo = null;
    let joined = false;
    // --- caches / otimizações locais (inserir) ---
    let lastMembers = []; // último snapshot de members (usado pelo popover)
    let playersCache = new Map(); // playerId -> { id, name, avatar_url, fetchedAt }
    const PLAYERS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

    let messagesCache = []; // mensagens locais (apresentação)
    let lastMessageAt = null; // ISO string timestamp da última mensagem conhecida (para polling incremental)

    let lastSignalAt = null; // timestamp para sinal incremental


    let statePollId = null;
    let signalPollId = null;

    let localStream = null;
    let peerConnections = {};
    let processedSignalIds = new Set();

    const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    // --- NOVAS FUNÇÕES DE UX ---

    /**
     * Exibe um balão de notificação no topo por um tempo determinado.
     * @param {string} message A mensagem a ser exibida.
     * @param {number} duration O tempo em milissegundos que a notificação deve durar.
     */
    function showNotification(message, duration = 5000) {
        const notifEl = document.createElement('div');
        notifEl.className = 'tavern-notification';
        notifEl.textContent = message;
        
        // Adiciona um estilo básico se o container não for o body e não tiver CSS próprio
        notifEl.style.cssText = `
            position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
            width: 300px;
            background: #222; color: #fff; padding: 10px 20px; border-radius: 8px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5); z-index: 9999; opacity: 0;
            transition: opacity 0.5s, transform 0.5s;
        `;

        tNotifContainer.appendChild(notifEl);

        // Fade in
        setTimeout(() => {
            notifEl.style.opacity = 1;
            notifEl.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);

        // Fade out e remoção
        setTimeout(() => {
            notifEl.style.opacity = 0;
            notifEl.style.transform = 'translateX(-50%) translateY(-20px)';
            setTimeout(() => {
                notifEl.remove();
            }, 500); // tempo de transição
        }, duration);
    }

    /**
     * Exibe um overlay de "shimmer" para mascarar a latência de conexão.
     */
    function showShimmerOverlay() {
        // Remove qualquer shimmer existente para evitar duplicatas
        const existingShimmer = document.getElementById('shimmerOverlay');
        if (existingShimmer) existingShimmer.remove();

        const shimmerEl = document.createElement('div');
        shimmerEl.id = 'shimmerOverlay';
        shimmerEl.innerHTML = `
            <div class="shimmer-content">
                <span class="shimmer-text">Estabelecendo conexão segura de áudio com criptografia de ponta a ponta. Por favor, aguarde...</span>
                <div class="shimmer-bar"></div>
            </div>
        `;
        
        // Estilos básicos do overlay (você deve estilizá-lo melhor via CSS)
        shimmerEl.style.cssText = `
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.9); z-index: 1000;
            display: flex; justify-content: center; align-items: center;
            color: #fff; font-size: 1.2rem; text-align: center;
        `;

        // Estilos básicos para o efeito shimmer
        const style = document.createElement('style');
        style.textContent = `
            #shimmerOverlay .shimmer-content {
                max-width: 80%; padding: 20px; border-radius: 10px;
                background: rgba(255, 255, 255, 0.1); backdrop-filter: blur(2px);
            }
            #shimmerOverlay .shimmer-bar {
                height: 4px; width: 100%; background: linear-gradient(to right, transparent, #fff, transparent);
                animation: shimmerAnim 1.5s infinite linear; margin-top: 10px; border-radius: 2px;
            }
            @keyframes shimmerAnim {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }
        `;
        document.head.appendChild(style);

        tActiveArea.appendChild(shimmerEl);

        // Remove o overlay após 10 segundos
        setTimeout(() => {
            shimmerEl.remove();
            style.remove(); // Limpa os estilos injetados
        }, 10000);
    }


    // --- Funções de Gerenciamento de Estado ---

    async function getSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;
        userId = session.user.id;
        const { data: player } = await supabase.from('players').select('guild_id, rank, name, avatar_url').eq('id', userId).single();
        if (!player) return false;
        guildId = player.guild_id;
        userRole = player.rank;
        myPlayerData = { name: player.name, avatar_url: player.avatar_url }; 
        return true;
    }

    async function ensureRoom() {
        const { data } = await supabase.from('tavern_rooms').select('*').eq('guild_id', guildId).limit(1);
        if (data && data.length) {
            currentRoom = data[0];
        } else {
            const { data: created } = await supabase.rpc('create_tavern_room', { p_guild_id: guildId, p_name: 'Taverna', p_open: false });
            currentRoom = created[0];
        }
    }

    async function joinRoom() {
        if (!currentRoom || joined) return;
        joined = true;
        await supabase.rpc('join_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        
        // 🌟 IMPLEMENTAÇÃO 2: Balão de notificação
        showNotification(`${myPlayerData.name} entrou na Taverna.`, 5000);

        tActiveArea.style.display = 'block';
        tSendBtn.disabled = false;
        startPolling();
    }

    async function leaveRoom() {
        if (!currentRoom || !joined) return;
        await supabase.rpc('leave_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        joined = false;
        stopPolling();
        cleanupAll();
        tActiveArea.style.display = 'none';
        tSendBtn.disabled = true;
    }

    async function moveSeat(seatNumber) {
        if (!joined) return;
        await supabase.rpc('move_tavern_seat', { p_room_id: currentRoom.id, p_player_id: userId, p_new_seat: seatNumber });
    }

    // --- Lógica de Polling ---
    function startPolling() {
        stopPolling();
        // Aumentando os tempos de polling conforme solicitado para reduzir egress
        signalPollId = setInterval(pollForSignals, 10000); // 4s -> 10s
        statePollId = setInterval(pollForState, 30000);  // 15s -> 30s
        pollForState();
    }

    function stopPolling() {
        clearInterval(signalPollId);
        clearInterval(statePollId);
    }
    
    async function pollForState() {
        if (!joined) return;
        
        // Chamada para funções de limpeza no Supabase (RPC)
        try {
            await supabase.rpc('cleanup_old_tavern_signals');
            await supabase.rpc('cleanup_old_tavern_messages');
        } catch (e) {
            console.warn("Falha na limpeza do Supabase (verifique se as RPCs existem):", e);
        }

        const { data: members } = await supabase.from('tavern_members').select('*').eq('room_id', currentRoom.id);
        if (!members) return;

        const oldSeat = myMemberInfo?.seat_number;
        myMemberInfo = members.find(m => m.player_id === userId);
        
        if (!myMemberInfo) {
            if (joined) leaveRoom();
            return;
        }

        if (oldSeat !== myMemberInfo.seat_number) {
            await updateConnections(members);
        }
        
        await renderUI(members);
        await updateChat();
    }

    async function pollForSignals() {
        if (!joined) return;
        const { data: signals } = await supabase.from('tavern_signals').select('*').eq('to_player', userId);
        if (signals) {
            for (const signal of signals) {
                if (!processedSignalIds.has(signal.id)) {
                    handleSignal(signal); 
                    processedSignalIds.add(signal.id);
                }
            }
        }
    }

    // --- Lógica WebRTC ---
    async function updateConnections(members) {
        if (!myMemberInfo) return;
        const amISpeaker = myMemberInfo.seat_number != null;

        if (amISpeaker && !localStream) {
            
            // 🌟 IMPLEMENTAÇÃO 1: Shimmer Overlay
            showShimmerOverlay(); 
            
            try {
                // A latência é justificada pelo Shimmer
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
            } catch (err) {
                // Se falhar, remove o shimmer imediatamente se ainda estiver lá
                document.getElementById('shimmerOverlay')?.remove(); 

                console.warn('Permissão de microfone negada.', err);
                tSeats.insertAdjacentHTML('beforebegin', '<div id="mic_error" style="color:orange;padding:10px;text-align:center;">🔴 Microfone bloqueado. Conceda a permissão ao aplicativo e tente novamente.</div>');
                await moveSeat(null);
                return; 
            }
        } else if (!amISpeaker && localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        const errorDiv = document.getElementById('mic_error');
        if (errorDiv) errorDiv.remove();


        const speakers = members.filter(m => m.seat_number != null);
        let peersToConnect = amISpeaker ? speakers.filter(s => s.player_id !== userId) : speakers;
        const peerIdsToConnect = new Set(peersToConnect.map(p => p.player_id));

        for (const peer of peersToConnect) {
            if (!peerConnections[peer.player_id]) {
                createPeerConnection(peer.player_id, true);
            }
        }
        
        for (const existingPeerId in peerConnections) {
            if (!peerIdsToConnect.has(existingPeerId)) {
                peerConnections[existingPeerId]?.close();
                delete peerConnections[existingPeerId];
                const audioEl = document.getElementById(`audio-${existingPeerId}`);
                if (audioEl) audioEl.remove();
            }
        }
    }
    
    function createPeerConnection(peerId, isInitiator) {
        if (peerConnections[peerId]) return;
        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS }); 
        peerConnections[peerId] = pc;

        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        pc.ontrack = (event) => {
            let audioEl = document.getElementById(`audio-${peerId}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio-${peerId}`;
                audioEl.autoplay = true;
                tAudioContainer.appendChild(audioEl);
            }
            audioEl.srcObject = event.streams[0];
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                supabase.from('tavern_signals').insert({ room_id: currentRoom.id, from_player: userId, to_player: peerId, type: 'candidate', payload: event.candidate }).then();
            }
        };

        pc.onconnectionstatechange = () => {
             if (['disconnected', 'closed', 'failed'].includes(pc.connectionState)) {
                pc.close();
                delete peerConnections[peerId];
                const audioEl = document.getElementById(`audio-${peerId}`);
                if (audioEl) audioEl.remove();
            }
        };
        
        if (isInitiator) {
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    supabase.from('tavern_signals').insert({ room_id: currentRoom.id, from_player: userId, to_player: peerId, type: 'offer', payload: pc.localDescription }).then();
                });
        }
    }

    async function handleSignal(signal) {
        const peerId = signal.from_player;
        let pc = peerConnections[peerId];
        
        if (signal.type === 'offer' && !pc) {
            createPeerConnection(peerId, false);
            pc = peerConnections[peerId];
        }

        if (!pc) return;

        switch (signal.type) {
            case 'offer':
                await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await supabase.from('tavern_signals').insert({ room_id: currentRoom.id, from_player: userId, to_player: peerId, type: 'answer', payload: pc.localDescription });
                break;
            case 'answer':
                await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
                break;
            case 'candidate':
                if (signal.payload) {
                    await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
                }
                break;
        }
        
        // CRÍTICO: Excluir o sinal após o processamento
        try {
            await supabase.from('tavern_signals').delete().eq('id', signal.id);
            processedSignalIds.delete(signal.id); 
        } catch (e) {
            console.error("Erro ao deletar o sinal do Supabase:", e);
        }
    }

    // --- Funções de UI e Limpeza ---
    function renderControls() {
        const canManage = userRole === 'leader' || userRole === 'co-leader';
        let adminButtonHtml = '';
        if (canManage && currentRoom) {
            const buttonText = currentRoom.is_open_to_all ? 'Aberta a Todos' : 'Somente Guilda';
            adminButtonHtml = `<button id="toggleOpenBtn" class="tavernSendBtn">${buttonText}</button>`;
        }

        tControls.innerHTML = `
            <button id="joinTavernBtn" class="tavernSendBtn">Entrar na Taverna</button>
            <button id="leaveTavernBtn" class="tavernSendBtn">Sair</button>
            ${adminButtonHtml}
        `;

        document.getElementById('joinTavernBtn').onclick = joinRoom;
        document.getElementById('leaveTavernBtn').onclick = leaveRoom;
        if (canManage) {
            document.getElementById('toggleOpenBtn').onclick = async () => {
                const newStatus = !currentRoom.is_open_to_all;
                await supabase.rpc('toggle_tavern_room_open', { p_room_id: currentRoom.id, p_open: newStatus });
                currentRoom.is_open_to_all = newStatus;
                renderControls();
            };
        }
    }

    async function renderUI(members) {
        tSeats.innerHTML = '';
        const playersData = (await supabase.from('players').select('id, name, avatar_url').in('id', members.map(m => m.player_id))).data;
        if (!playersData) return;
        const playersMap = new Map(playersData.map(p => [p.id, p]));
        const memberMap = new Map(members.map(m => [m.seat_number, m]));

        for (let i = 1; i <= 5; i++) {
            const el = document.createElement('div');
            el.className = 'tavern-seat';
            el.dataset.seat = i;
            const member = memberMap.get(i);
            if (member) {
                const player = playersMap.get(member.player_id);
                el.innerHTML = `<img src="${player?.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${player?.name}" /><div class="seat-number">${i}</div>`;
                if (member.player_id === userId) {
                    el.classList.add('my-seat');
                    el.title = "Sair do assento";
                }
            } else {
                el.classList.add('empty');
                el.innerHTML = `<div class="seat-number" style="bottom: 1px;">${i}</div><div style="color:yellow;font-size: 0.7em; margin-top: -5px;">Livre</div>`;
            }
            tSeats.appendChild(el);
        }
    }

    async function updateChat() {
        const { data: msgs } = await supabase.from('tavern_messages').select('id, player_name, player_avatar, message').eq('room_id', currentRoom.id).order('created_at', { ascending: false }).limit(50);
        if (msgs) {
            tChat.innerHTML = '';
            msgs.reverse().forEach(m => {
                const div = document.createElement('div');
                div.className = 'tavern-message';
                div.innerHTML = `<img src="${m.player_avatar || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" /><div><b>${m.player_name}</b><div class="bubble">${m.message}</div></div>`;
                tChat.appendChild(div);
            });
            if(tChat.scrollHeight - tChat.scrollTop < tChat.clientHeight + 150) {
                tChat.scrollTop = tChat.scrollHeight;
            }
        }
    }
    
    function cleanupAll() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        tAudioContainer.innerHTML = '';
        processedSignalIds.clear();
        myMemberInfo = null;
    }

    // --- Handlers de Eventos ---

    tSeats.onclick = async (ev) => {
        const seatEl = ev.target.closest('.tavern-seat');
        if (!seatEl) return;
    
        const myCurrentSeatEl = tSeats.querySelector('.my-seat');
        const seatNumber = parseInt(seatEl.dataset.seat);
    
        if (seatEl.classList.contains('my-seat')) {
            if (myCurrentSeatEl) {
                myCurrentSeatEl.classList.remove('my-seat');
                myCurrentSeatEl.classList.add('empty');
                myCurrentSeatEl.innerHTML = `<div class="seat-number" style="bottom: 1px;">${myCurrentSeatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
            }
            moveSeat(null).then(() => pollForState());
    
        } else if (seatEl.classList.contains('empty')) {
            if (myCurrentSeatEl) {
                myCurrentSeatEl.classList.remove('my-seat');
                myCurrentSeatEl.classList.add('empty');
                myCurrentSeatEl.innerHTML = `<div class="seat-number" style="bottom: 1px;">${myCurrentSeatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
            }
            seatEl.classList.remove('empty');
            seatEl.classList.add('my-seat');
            seatEl.innerHTML = `<img src="${myPlayerData.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${myPlayerData.name}" /><div class="seat-number">${seatNumber}</div>`;
            seatEl.title = "Sair do assento";
            moveSeat(seatNumber).then(() => pollForState());
        }
    };

    tSendBtn.onclick = async () => {
        const txt = tMessageInput.value.trim();
        if (!txt || !joined) return;
        await supabase.rpc('post_tavern_message', { p_room_id: currentRoom.id, p_player_id: userId, p_player_name: myPlayerData.name, p_player_avatar: myPlayerData.avatar_url, p_message: txt });
        tMessageInput.value = '';
        await updateChat();
    };

    // --- Inicialização ---
    async function initialize() {
        if (!(await getSession())) {
            tControls.innerHTML = '<p>Você precisa estar logado.</p>';
            return;
        }
        await ensureRoom();
        tTitle.textContent = currentRoom?.name || 'Taverna';
        renderControls();
    }

    // --- OVERRIDES E NOVAS FUNÇÕES PARA OTIMIZAÇÃO E UI ---
    function startPolling() {
        stopPolling();
        // reduzimos a taxa para economizar egress (ajustável)
        signalPollId = setInterval(pollForSignals, 10000); // 10s
        statePollId = setInterval(pollForState, 30000);   // 30s
        // iniciamos um primeiro poll imediato
        pollForState();
    }

    function stopPolling() {
        clearInterval(signalPollId);
        clearInterval(statePollId);
    }

    async function pollForState() {
        if (!joined) return;

        // limpeza no servidor: sinais, mensagens antigas e membros inativos
        try {
            await supabase.rpc('cleanup_old_tavern_signals');
            await supabase.rpc('cleanup_old_tavern_messages');
            try {
                await supabase.rpc('cleanup_inactive_tavern_members');
            } catch (e) {
                // Se não existir essa RPC, apenas logamos (compatibilidade)
                console.debug('cleanup_inactive_tavern_members RPC não encontrada ou falhou:', e);
            }
        } catch (e) {
            console.warn("Falha nas RPCs de limpeza (verifique se existem):", e);
        }

        try {
            const { data: members, error: membersErr } = await supabase
                .from('tavern_members')
                .select('*')
                .eq('room_id', currentRoom.id);
            if (membersErr) {
                console.warn("Erro ao buscar membros da taverna:", membersErr);
                return;
            }
            if (!Array.isArray(members)) return;

            // atualiza cache local
            lastMembers = members;

            const oldSeat = myMemberInfo?.seat_number;
            myMemberInfo = members.find(m => m.player_id === userId);

            if (!myMemberInfo) {
                // o servidor diz que não estamos na sala -> forçar leave local
                if (joined) {
                    await leaveRoom();
                }
                return;
            }

            // se trocou de assento, ajusta conexões webRTC
            if (oldSeat !== myMemberInfo.seat_number) {
                await updateConnections(members);
            }

            // renderiza UI (mapeando players via cache)
            await renderUI(members);

            // atualiza chat incremental
            await updateChat();

            // limpeza local leve
            cleanupLocalCaches();
        } catch (e) {
            console.error("pollForState erro:", e);
        }
    }

    async function pollForSignals() {
        if (!joined) return;
        try {
            let q = supabase.from('tavern_signals').select('*').eq('to_player', userId).order('created_at', { ascending: true }).limit(50);
            if (lastSignalAt) q = q.gt('created_at', lastSignalAt);
            const { data: signals, error } = await q;
            if (error) {
                console.warn("Erro ao buscar signals:", error);
                return;
            }
            if (!signals || !signals.length) return;

            for (const signal of signals) {
                if (!processedSignalIds.has(signal.id)) {
                    await handleSignal(signal);
                    processedSignalIds.add(signal.id);
                }
            }
            // marca último timestamp
            const last = signals[signals.length - 1];
            if (last && last.created_at) lastSignalAt = last.created_at;
        } catch (e) {
            console.error("pollForSignals erro:", e);
        }
    }

    // Controls: join/leave visibility and removal of toggleOpenBtn (tavern only for guild)
    function renderControls() {
        const canManage = userRole === 'leader' || userRole === 'co-leader';

        tControls.innerHTML = `
            <button id="joinTavernBtn" class="tavernSendBtn">Entrar na Taverna</button>
            <button id="leaveTavernBtn" class="tavernSendBtn">Sair</button>
        `;

        const joinBtn = document.getElementById('joinTavernBtn');
        const leaveBtn = document.getElementById('leaveTavernBtn');
        joinBtn.onclick = joinRoom;
        leaveBtn.onclick = leaveRoom;

        // Controle de visibilidade baseado no estado `joined`
        joinBtn.style.display = joined ? 'none' : '';
        leaveBtn.style.display = joined ? '' : 'none';
    }

    async function joinRoom() {
        if (!currentRoom || joined) return;
        try {
            await supabase.rpc('join_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        } catch (e) {
            console.warn("join_tavern_room RPC falhou:", e);
        }
        joined = true;

        showNotification(`${myPlayerData.name} entrou na Taverna.`, 5000);

        tActiveArea.style.display = 'block';
        tSendBtn.disabled = false;

        renderControls();

        startPolling();
    }

    async function leaveRoom() {
        if (!currentRoom || !joined) return;
        try {
            await supabase.rpc('leave_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        } catch (e) {
            console.warn("leave_tavern_room RPC falhou:", e);
        }
        joined = false;

        stopPolling();
        cleanupAll();

        // limpa caches locais
        messagesCache = [];
        lastMessageAt = null;
        playersCache.clear();
        lastMembers = [];

        tActiveArea.style.display = 'none';
        tSendBtn.disabled = true;

        renderControls();
    }

    // Render UI com proteção XSS (usar textContent) e cache de players
    async function renderUI(members) {
        tSeats.innerHTML = '';
        // Obter lista de player_ids necessários
        const playerIds = Array.from(new Set(members.map(m => m.player_id)));
        const now = Date.now();

        // descobrir quais playerIds não temos em cache ou expiraram
        const needFetch = playerIds.filter(id => {
            const cached = playersCache.get(id);
            return !cached || (now - (cached.fetchedAt || 0) > PLAYERS_CACHE_TTL_MS);
        });

        if (needFetch.length) {
            try {
                const { data: playersData } = await supabase.from('players').select('id, name, avatar_url').in('id', needFetch);
                if (Array.isArray(playersData)) {
                    playersData.forEach(p => playersCache.set(p.id, { ...p, fetchedAt: Date.now() }));
                }
            } catch (e) {
                console.warn("Erro ao buscar players para UI:", e);
            }
        }

        const playersMap = new Map(playerIds.map(id => [id, playersCache.get(id) || { id, name: '???', avatar_url: '' }]));
        const memberMap = new Map(members.map(m => [m.seat_number, m]));

        for (let i = 1; i <= 5; i++) {
            const el = document.createElement('div');
            el.className = 'tavern-seat';
            el.dataset.seat = i;
            el.style.position = 'relative';
            const member = memberMap.get(i);
            if (member) {
                const player = playersMap.get(member.player_id) || {};
                const img = document.createElement('img');
                img.src = player.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
                img.alt = player.name || '';
                img.dataset.playerId = member.player_id;
                el.appendChild(img);

                const seatNumber = document.createElement('div');
                seatNumber.className = 'seat-number';
                seatNumber.textContent = String(i);
                el.appendChild(seatNumber);

                if (member.player_id === userId) {
                    el.classList.add('my-seat');
                    el.title = "Clique no avatar para ações";
                }

                // se está silenciado no servidor, aplica visual
                if (member.is_muted) {
                    applyMuteVisual(el);
                }
            } else {
                el.classList.add('empty');
                const seatNumber = document.createElement('div');
                seatNumber.className = 'seat-number';
                seatNumber.style.bottom = '1px';
                seatNumber.textContent = String(i);
                el.appendChild(seatNumber);

                const freeLabel = document.createElement('div');
                freeLabel.style.color = 'yellow';
                freeLabel.style.fontSize = '0.7em';
                freeLabel.style.marginTop = '-5px';
                freeLabel.textContent = 'Livre';
                el.appendChild(freeLabel);
            }
            tSeats.appendChild(el);
        }
    }

    async function updateChat() {
        try {
            if (!lastMessageAt) {
                const { data: msgs } = await supabase
                    .from('tavern_messages')
                    .select('id, player_name, player_avatar, message, created_at')
                    .eq('room_id', currentRoom.id)
                    .order('created_at', { ascending: false })
                    .limit(50);

                if (!msgs) return;
                msgs.reverse();
                messagesCache = msgs.map(m => ({ ...m }));
                if (messagesCache.length) lastMessageAt = messagesCache[messagesCache.length - 1].created_at;
                tChat.innerHTML = '';
                messagesCache.forEach(appendChatMessageToDom);
                tChat.scrollTop = tChat.scrollHeight;
                return;
            }

            const { data: newMsgs } = await supabase
                .from('tavern_messages')
                .select('id, player_name, player_avatar, message, created_at')
                .eq('room_id', currentRoom.id)
                .gt('created_at', lastMessageAt)
                .order('created_at', { ascending: true });

            if (!newMsgs || newMsgs.length === 0) return;

            newMsgs.forEach(m => {
                messagesCache.push(m);
                appendChatMessageToDom(m);
            });
            lastMessageAt = messagesCache[messagesCache.length - 1].created_at;

            if (tChat.scrollHeight - tChat.scrollTop < tChat.clientHeight + 150) {
                tChat.scrollTop = tChat.scrollHeight;
            }

        } catch (e) {
            console.error("updateChat erro:", e);
        }
    }

    // helper para adicionar uma mensagem ao DOM usando textContent (evita innerHTML)
    function appendChatMessageToDom(m) {
        const div = document.createElement('div');
        div.className = 'tavern-message';

        const img = document.createElement('img');
        img.src = m.player_avatar || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
        img.alt = m.player_name || '';
        div.appendChild(img);

        const meta = document.createElement('div');
        const strong = document.createElement('b');
        strong.textContent = m.player_name || '???';
        meta.appendChild(strong);

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = m.message || '';
        meta.appendChild(bubble);

        div.appendChild(meta);
        tChat.appendChild(div);
    }

    // substitui handler do botão de enviar para otimização local
    if (tSendBtn) {
        tSendBtn.onclick = async () => {
            const txt = tMessageInput.value.trim();
            if (!txt || !joined) return;
            try {
                await supabase.rpc('post_tavern_message', { p_room_id: currentRoom.id, p_player_id: userId, p_player_name: myPlayerData.name, p_player_avatar: myPlayerData.avatar_url, p_message: txt });

                const nowIso = new Date().toISOString();
                const localMsg = { id: `local-${Date.now()}`, player_name: myPlayerData.name, player_avatar: myPlayerData.avatar_url, message: txt, created_at: nowIso };
                messagesCache.push(localMsg);
                appendChatMessageToDom(localMsg);
                lastMessageAt = localMsg.created_at;
                tMessageInput.value = '';

                if (tChat.scrollHeight - tChat.scrollTop < tChat.clientHeight + 150) {
                    tChat.scrollTop = tChat.scrollHeight;
                }
            } catch (e) {
                console.error("Erro ao enviar mensagem:", e);
            }
        };
    }

    // substitui handler de cliques nas seats para abrir popover/ações
    if (tSeats) {
        tSeats.onclick = async (ev) => {
            const seatEl = ev.target.closest('.tavern-seat');
            if (!seatEl) return;

            const clickedImg = ev.target.closest('img');
            const myCurrentSeatEl = tSeats.querySelector('.my-seat');
            const seatNumber = parseInt(seatEl.dataset.seat);

            if (clickedImg) {
                // clique no avatar: abre popover com ações
                const member = lastMembers.find(m => Number(m.seat_number) === seatNumber);
                showSeatPopover(seatEl, member);
                return;
            }

            // clique fora do avatar (no próprio seat)
            if (seatEl.classList.contains('my-seat')) {
                // o usuário quer sair do assento (comportamento antigo): mantenha troca visual instantânea
                if (myCurrentSeatEl) {
                    myCurrentSeatEl.classList.remove('my-seat');
                    myCurrentSeatEl.classList.add('empty');
                    myCurrentSeatEl.innerHTML = `<div class="seat-number" style="bottom: 1px;">${myCurrentSeatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
                }
                moveSeat(null).then(() => pollForState());
            } else if (seatEl.classList.contains('empty')) {
                // sentar: efeito visual instantâneo
                if (myCurrentSeatEl) {
                    myCurrentSeatEl.classList.remove('my-seat');
                    myCurrentSeatEl.classList.add('empty');
                    myCurrentSeatEl.innerHTML = `<div class="seat-number" style="bottom: 1px;">${myCurrentSeatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
                }
                seatEl.classList.remove('empty');
                seatEl.classList.add('my-seat');
                seatEl.innerHTML = `<img src="${myPlayerData.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${myPlayerData.name}" /><div class="seat-number">${seatNumber}</div>`;
                seatEl.title = "Clique no avatar para ações";
                moveSeat(seatNumber).then(() => pollForState());
            }
        };
    }

    // aplica visual de silenciado em um elemento .tavern-seat
    function applyMuteVisual(seatEl) {
        const img = seatEl.querySelector('img');
        if (img) img.style.filter = 'grayscale(0.7)';
        if (!seatEl.querySelector('.mute-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'mute-overlay';
            overlay.textContent = '🔇';
            overlay.style.position = 'absolute';
            overlay.style.left = '6px';
            overlay.style.top = '6px';
            overlay.style.fontSize = '18px';
            overlay.style.zIndex = '5';
            seatEl.appendChild(overlay);
        }
    }

    // remove visual de silenciado
    function removeMuteVisual(seatEl) {
        const img = seatEl.querySelector('img');
        if (img) img.style.filter = '';
        const overlay = seatEl.querySelector('.mute-overlay');
        if (overlay) overlay.remove();
    }

    // exibe popover simples dentro do seatEl (posição relativa)
    function showSeatPopover(seatEl, member) {
        // remove popovers existentes
        document.querySelectorAll('.tavern-popover').forEach(el => el.remove());

        const pop = document.createElement('div');
        pop.className = 'tavern-popover';
        pop.style.position = 'absolute';
        pop.style.right = '4px';
        pop.style.top = '4px';
        pop.style.background = '#111';
        pop.style.color = '#fff';
        pop.style.padding = '6px';
        pop.style.borderRadius = '6px';
        pop.style.boxShadow = '0 4px 12px rgba(0,0,0,0.6)';
        pop.style.zIndex = '50';
        pop.style.minWidth = '120px';
        pop.style.display = 'flex';
        pop.style.flexDirection = 'column';
        pop.style.gap = '6px';

        const targetPlayerId = member?.player_id;

        if (!member) {
            const p = document.createElement('div');
            p.className = 'pop-item';
            p.textContent = 'Assento livre';
            pop.appendChild(p);
            seatEl.appendChild(pop);
            setTimeout(() => pop.remove(), 4000);
            return;
        }

        const nameItem = document.createElement('div');
        nameItem.className = 'pop-item';
        nameItem.textContent = playersCache.get(targetPlayerId)?.name || 'Jogador';
        seatEl.appendChild(pop);
        pop.appendChild(nameItem);

        if (targetPlayerId === userId) {
            const btnMuteSelf = document.createElement('button');
            btnMuteSelf.className = 'pop-item';
            btnMuteSelf.textContent = member.is_muted ? 'Remover silêncio (eu)' : 'Silenciar-me';
            btnMuteSelf.onclick = async () => {
                const newMute = !member.is_muted;
                try {
                    await supabase.rpc('mute_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: userId, p_mute: newMute });
                } catch (e) { console.warn("mute RPC falhou:", e); }
                if (newMute) applyMuteVisual(seatEl); else removeMuteVisual(seatEl);
                if (member) member.is_muted = newMute;
                pop.remove();
            };
            pop.appendChild(btnMuteSelf);
        } else {
            if (userRole === 'leader' || userRole === 'co-leader') {
                const btnKick = document.createElement('button');
                btnKick.className = 'pop-item';
                btnKick.textContent = 'Remover (kick)';
                btnKick.onclick = async () => {
                    try {
                        await supabase.rpc('kick_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: targetPlayerId });
                    } catch (e) { console.warn("kick RPC falhou:", e); }
                    seatEl.classList.remove('my-seat');
                    seatEl.classList.add('empty');
                    seatEl.innerHTML = `<div class="seat-number" style="bottom: 1px;">${seatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
                    pop.remove();
                    pollForState();
                };
                pop.appendChild(btnKick);

                const btnMute = document.createElement('button');
                btnMute.className = 'pop-item';
                btnMute.textContent = member.is_muted ? 'Remover silêncio' : 'Silenciar';
                btnMute.onclick = async () => {
                    const newMute = !member.is_muted;
                    try {
                        await supabase.rpc('mute_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: targetPlayerId, p_mute: newMute });
                    } catch (e) { console.warn("mute RPC falhou:", e); }
                    if (newMute) applyMuteVisual(seatEl); else removeMuteVisual(seatEl);
                    if (member) member.is_muted = newMute;
                    pop.remove();
                };
                pop.appendChild(btnMute);
            } else {
                const info = document.createElement('div');
                info.className = 'pop-item';
                info.textContent = 'Sem ações disponíveis';
                pop.appendChild(info);
                setTimeout(() => pop.remove(), 3500);
            }
        }

        setTimeout(() => {
            document.addEventListener('click', function onDocClick(e) {
                if (!pop.contains(e.target) && !seatEl.contains(e.target)) {
                    pop.remove();
                    document.removeEventListener('click', onDocClick);
                }
            });
        }, 30);
    }

    function cleanupLocalCaches() {
        const now = Date.now();
        for (const [k, v] of playersCache.entries()) {
            if (now - (v.fetchedAt || 0) > PLAYERS_CACHE_TTL_MS) playersCache.delete(k);
        }
        if (messagesCache.length > 500) {
            messagesCache = messagesCache.slice(messagesCache.length - 500);
        }
    }
    initialize();
});