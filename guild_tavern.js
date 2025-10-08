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
    let userRole = 'member';
    let myPlayerData = {}; // NOVO: Armazena dados como nome e avatar para uso na UI
    let currentRoom = null;
    let myMemberInfo = null;
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
        const { data: player } = await supabase.from('players').select('guild_id, rank, name, avatar_url').eq('id', userId).single();
        if (!player) return false;
        guildId = player.guild_id;
        userRole = player.rank;
        myPlayerData = { name: player.name, avatar_url: player.avatar_url }; // Salva dados do jogador
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

    // ALTERADO: A função agora só envia o comando para o servidor.
    async function moveSeat(seatNumber) {
        if (!joined) return;
        // Não chama mais pollForState daqui.
        await supabase.rpc('move_tavern_seat', { p_room_id: currentRoom.id, p_player_id: userId, p_new_seat: seatNumber });
    }

    // --- Lógica de Polling ---
    function startPolling() {
        stopPolling();
        signalPollId = setInterval(pollForSignals, 4000);
        statePollId = setInterval(pollForState, 15000);
        pollForState();
    }

    function stopPolling() {
        clearInterval(signalPollId);
        clearInterval(statePollId);
    }
    
    async function pollForState() {
        if (!joined) return;
        const { data: members } = await supabase.from('tavern_members').select('*').eq('room_id', currentRoom.id);
        if (!members) return;

        const oldSeat = myMemberInfo?.seat_number;
        myMemberInfo = members.find(m => m.player_id === userId);
        
        if (!myMemberInfo) {
            if (joined) leaveRoom();
            return;
        }

        // Se o poll detectar uma mudança de assento, atualiza as conexões
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
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (err) {
                console.warn('Permissão de microfone negada.', err);
                await moveSeat(null);
                return; // Importante sair aqui para evitar mais processamento
            }
        } else if (!amISpeaker && localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

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
    
    // (O resto da lógica WebRTC como createPeerConnection e handleSignal permanece a mesma)
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
    }

    // --- Funções de UI e Limpeza ---
    function renderControls() {
        const canManage = userRole === 'leader' || userRole === 'co-leader';
        let adminButtonHtml = '';
        if (canManage && currentRoom) {
            const buttonText = currentRoom.is_open_to_all ? 'Aberta a Todos' : 'Somente Guilda';
            adminButtonHtml = `<button id="toggleOpenBtn" class="action-btn">${buttonText}</button>`;
        }

        tControls.innerHTML = `
            <button id="joinTavernBtn" class="action-btn">Entrar na Taverna</button>
            <button id="leaveTavernBtn" class="action-btn">Sair</button>
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
        // A lógica de renderização principal não muda.
        tSeats.innerHTML = '';
        const playersData = (await supabase.from('players').select('id, name, avatar_url').in('id', members.map(m => m.player_id))).data;
        if (!playersData) return;
        const playersMap = new Map(playersData.map(p => [p.id, p]));
        const memberMap = new Map(members.map(m => [m.seat_number, m]));

        for (let i = 1; i <= 15; i++) {
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

    // ALTERADO: Lógica de Atualização Otimista
    tSeats.onclick = async (ev) => {
        const seatEl = ev.target.closest('.tavern-seat');
        if (!seatEl) return;
    
        const myCurrentSeatEl = tSeats.querySelector('.my-seat');
        const seatNumber = parseInt(seatEl.dataset.seat);
    
        if (seatEl.classList.contains('my-seat')) {
            // Sair do assento
            if (myCurrentSeatEl) {
                myCurrentSeatEl.classList.remove('my-seat');
                myCurrentSeatEl.classList.add('empty');
                myCurrentSeatEl.innerHTML = `<div class="seat-number">${myCurrentSeatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
            }
            // Envia o comando em segundo plano
            moveSeat(null).then(() => pollForState());
    
        } else if (seatEl.classList.contains('empty')) {
            // Sair do assento antigo, se houver
            if (myCurrentSeatEl) {
                myCurrentSeatEl.classList.remove('my-seat');
                myCurrentSeatEl.classList.add('empty');
                myCurrentSeatEl.innerHTML = `<div class="seat-number">${myCurrentSeatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
            }
            // Entrar no novo assento
            seatEl.classList.remove('empty');
            seatEl.classList.add('my-seat');
            seatEl.innerHTML = `<img src="${myPlayerData.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${myPlayerData.name}" /><div class="seat-number">${seatNumber}</div>`;
            seatEl.title = "Sair do assento";
            // Envia o comando em segundo plano
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

    initialize();
});