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

    // --- Variáveis de Estado ---
    let userId = null;
    let guildId = null;
    let currentRoom = null;
    let myMemberInfo = null; // { player_id, seat_number, ... }
    let joined = false;

    let statePollId = null;
    let signalPollId = null;

    let localStream = null;
    let peerConnections = {};
    let processedSignalIds = new Set();

    const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    // --- Funções de Gerenciamento de Estado ---

    async function getSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;
        userId = session.user.id;
        const { data: player } = await supabase.from('players').select('guild_id').eq('id', userId).single();
        if (!player) return false;
        guildId = player.guild_id;
        return true;
    }

    async function ensureRoom() {
        const { data } = await supabase.from('tavern_rooms').select('*').eq('guild_id', guildId).limit(1);
        currentRoom = (data && data.length) ? data[0] : (await supabase.rpc('create_tavern_room', { p_guild_id: guildId, p_name: 'Taverna', p_open: false })).data[0];
    }

    async function joinRoom() {
        if (!currentRoom || joined) return;
        joined = true;

        await supabase.rpc('join_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });

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
        // Se o seatNumber for nulo, significa "Sair do Assento"
        await supabase.rpc('move_tavern_seat', { p_room_id: currentRoom.id, p_player_id: userId, p_new_seat: seatNumber });
        // O poll de estado vai cuidar do resto
    }

    // --- Lógica de Polling ---

    function startPolling() {
        // Poll rápido para sinais WebRTC
        signalPollId = setInterval(pollForSignals, 4000); // 4 segundos
        // Poll mais lento para estado geral (membros e chat)
        statePollId = setInterval(pollForState, 15000); // 15 segundos
        // Executa uma vez imediatamente para carregar o estado inicial
        pollForState();
    }

    function stopPolling() {
        clearInterval(signalPollId);
        clearInterval(statePollId);
        signalPollId = null;
        statePollId = null;
    }

    async function pollForState() {
        if (!joined) return;
        
        // 1. Buscar todos os membros na sala
        const { data: members } = await supabase.from('tavern_members').select('*').eq('room_id', currentRoom.id);
        if (!members) return;

        myMemberInfo = members.find(m => m.player_id === userId);
        if (!myMemberInfo) { // Fui kickado ou saí
            leaveRoom();
            return;
        }

        // 2. Renderizar a UI
        await renderUI(members);

        // 3. Atualizar conexões WebRTC com base no estado atual
        await updateConnections(members);
        
        // 4. Atualizar chat de texto
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
        const amISpeaker = myMemberInfo && myMemberInfo.seat_number != null;

        // Ativa/desativa microfone conforme o papel
        if (amISpeaker && !localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (err) {
                console.warn('Permissão de microfone negada.', err);
                // Força o usuário a sair do assento se negar o microfone
                await moveSeat(null);
            }
        } else if (!amISpeaker && localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        const speakers = members.filter(m => m.seat_number != null);

        // Para quem eu devo me conectar?
        let peersToConnect = [];
        if (amISpeaker) {
            // Locutores se conectam a outros locutores
            peersToConnect = speakers.filter(s => s.player_id !== userId);
        } else {
            // Ouvintes se conectam a todos os locutores
            peersToConnect = speakers;
        }
        
        const peerIdsToConnect = new Set(peersToConnect.map(p => p.player_id));

        // Criar conexões para novos peers
        for (const peer of peersToConnect) {
            if (!peerConnections[peer.player_id]) {
                createPeerConnection(peer.player_id, true); // Sou o iniciador
            }
        }
        
        // Remover conexões de peers que saíram ou mudaram de papel
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

        // Adiciona stream local APENAS se eu for um locutor
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
            createPeerConnection(peerId, false); // Não sou o iniciador
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
    }

    // --- Funções de UI e Limpeza ---

    async function renderUI(members) {
        tSeats.innerHTML = '';
        const playersData = (await supabase.from('players').select('id, name, avatar_url').in('id', members.map(m => m.player_id))).data;
        const playersMap = new Map(playersData.map(p => [p.id, p]));

        const memberMap = new Map(members.map(m => [m.seat_number, m]));

        for (let i = 1; i <= 15; i++) {
            const el = document.createElement('div');
            el.className = 'tavern-seat';
            el.dataset.seat = i;

            const member = memberMap.get(i);
            if (member) { // Assento Ocupado
                const player = playersMap.get(member.player_id);
                el.innerHTML = `<img src="${player?.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${player?.name}" /><div class="seat-number">${i}</div>`;
                if (member.player_id === userId) {
                    el.classList.add('my-seat');
                    el.title = "Sair do assento";
                }
            } else { // Assento Livre
                el.classList.add('empty');
                el.innerHTML = `<div class="seat-number">${i}</div><div style="color:white;opacity:.6;">Livre</div>`;
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
            if(tChat.scrollHeight - tChat.scrollTop < tChat.clientHeight + 100) {
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

        if (seatEl.classList.contains('my-seat')) {
            await moveSeat(null); // Sair do assento
        } else if (seatEl.classList.contains('empty')) {
            const num = parseInt(seatEl.dataset.seat);
            await moveSeat(num); // Entrar em um assento
        }
    };

    tSendBtn.onclick = async () => {
        const txt = tMessageInput.value.trim();
        if (!txt || !joined) return;
        const { data: p } = await supabase.from('players').select('name, avatar_url').eq('id', userId).single();
        await supabase.rpc('post_tavern_message', { p_room_id: currentRoom.id, p_player_id: userId, p_player_name: p.name, p_player_avatar: p.avatar_url, p_message: txt });
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
        tControls.innerHTML = `<button id="joinTavernBtn" class="action-btn">Entrar na Taverna</button><button id="leaveTavernBtn" class="action-btn">Sair</button>`;
        document.getElementById('joinTavernBtn').onclick = joinRoom;
        document.getElementById('leaveTavernBtn').onclick = leaveRoom;
    }

    initialize();
});