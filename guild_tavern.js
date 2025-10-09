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

        if (!supabase) throw new Error('Cliente Supabase não pôde ser inicializado.');
    } catch (error) {
        console.error("Erro fatal na inicialização:", error);
        return;
    }

    // --- Referências do DOM ---
    const tTitle = document.getElementById('tavernTitle'), tControls = document.getElementById('tavernControls'),
        tSeats = document.getElementById('tavernSeats'), tChat = document.getElementById('tavernChat'),
        tMessageInput = document.getElementById('tavernMessageInput'), tSendBtn = document.getElementById('tavernSendBtn'),
        tActiveArea = document.getElementById('tavernActiveArea'), tAudioContainer = document.getElementById('tavernListeners'),
        tPopoverTemplate = document.getElementById('tavernPopoverTemplate'), tNotifContainer = document.body;

    // --- Variáveis de Estado ---
    let userId = null, guildId = null, userRole = 'member', myPlayerData = {}, currentRoom = null,
        myMemberInfo = null, isJoined = false, statePollId = null, signalPollId = null,
        heartbeatId = null, localStream = null, peerConnections = {}, processedSignalIds = new Set(),
        lastMessageId = 0;
    const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    // --- Funções de UX ---
    function showNotification(message, duration = 5000) {
        const notifEl = document.createElement('div');
        notifEl.textContent = message;
        notifEl.style.cssText = `position: fixed; top: 10px; left: 50%; transform: translateX(-50%) translateY(-30px); background: rgba(34, 34, 34, 0.9); color: #fff; padding: 10px 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); z-index: 9999; opacity: 0; transition: opacity 0.5s, transform 0.5s; font-size: 0.9em; text-align: center; width: 300px;`;
        tNotifContainer.appendChild(notifEl);
        setTimeout(() => {
            notifEl.style.opacity = 1;
            notifEl.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);
        setTimeout(() => {
            notifEl.style.opacity = 0;
            notifEl.style.transform = 'translateX(-50%) translateY(-20px)';
            setTimeout(() => notifEl.remove(), 500);
        }, duration);
    }
    
    function showShimmerOverlay() {
        if (document.getElementById('shimmerOverlay')) return;
        const shimmerEl = document.createElement('div');
        shimmerEl.id = 'shimmerOverlay';
        shimmerEl.innerHTML = `<div class="shimmer-content"><span class="shimmer-text">Estabelecendo conexão segura de áudio...</span><div class="shimmer-bar"></div></div>`;
        shimmerEl.style.cssText = `position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.9); z-index: 1000; display: flex; justify-content: center; align-items: center; color: #fff; font-size: 1.2rem; text-align: center;`;
        const style = document.createElement('style');
        style.textContent = `#shimmerOverlay .shimmer-content { max-width: 80%; padding: 20px; border-radius: 10px; background: rgba(255, 255, 255, 0.1); backdrop-filter: blur(2px); } #shimmerOverlay .shimmer-bar { height: 4px; width: 100%; background: linear-gradient(to right, transparent, #fff, transparent); animation: shimmerAnim 1.5s infinite linear; margin-top: 10px; border-radius: 2px; } @keyframes shimmerAnim { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`;
        document.head.appendChild(style);
        tActiveArea.appendChild(shimmerEl);
        setTimeout(() => { shimmerEl.remove(); style.remove(); }, 10000);
    }

    // --- Funções Principais ---
    async function getSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;
        userId = session.user.id;
        const { data: player } = await supabase.from('players').select('guild_id, rank, name, avatar_url').eq('id', userId).single();
        if (!player || !player.guild_id) return false;
        guildId = player.guild_id;
        userRole = player.rank;
        myPlayerData = { name: player.name, avatar_url: player.avatar_url };
        return true;
    }

    async function ensureRoom() {
        const { data } = await supabase.from('tavern_rooms').select('*').eq('guild_id', guildId).limit(1);
        if (data && data.length) currentRoom = data[0];
        else {
            const { data: created } = await supabase.rpc('create_tavern_room', { p_guild_id: guildId, p_name: `Taverna da Guilda` });
            currentRoom = created[0];
        }
    }

    function updateButtonVisibility() {
        const joinBtn = document.getElementById('joinTavernBtn'), leaveBtn = document.getElementById('leaveTavernBtn');
        if (joinBtn && leaveBtn) {
            joinBtn.style.display = isJoined ? 'none' : 'inline-block';
            leaveBtn.style.display = isJoined ? 'inline-block' : 'none';
        }
    }

    async function joinRoom() {
        if (!currentRoom || isJoined) return;
        isJoined = true;
        updateButtonVisibility();
        await supabase.rpc('join_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        showNotification(`${myPlayerData.name} entrou na Taverna.`, 4000);
        tActiveArea.style.display = 'block';
        tSendBtn.disabled = false;
        startPolling();
    }

    async function leaveRoom() {
        if (!currentRoom || !isJoined) return;
        isJoined = false;
        await supabase.rpc('leave_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        stopPolling();
        cleanupAll();
        tActiveArea.style.display = 'none';
        tSendBtn.disabled = true;
        updateButtonVisibility();
        await pollForState(false);
    }

    async function moveSeat(seatNumber) {
        if (!isJoined) return;
        await supabase.rpc('move_tavern_seat', { p_room_id: currentRoom.id, p_player_id: userId, p_new_seat: seatNumber });
    }

    async function sendHeartbeat() {
        if (!isJoined || !currentRoom) return;
        await supabase.from('tavern_members').update({ last_active_at: new Date().toISOString() }).match({ room_id: currentRoom.id, player_id: userId });
    }

    function startPolling() {
        stopPolling();
        signalPollId = setInterval(pollForSignals, 8000);
        statePollId = setInterval(() => pollForState(true), 20000);
        heartbeatId = setInterval(sendHeartbeat, 45000);
        sendHeartbeat();
        pollForState(true);
    }

    function stopPolling() {
        clearInterval(signalPollId); clearInterval(statePollId); clearInterval(heartbeatId);
    }

    let cleanupCounter = 0;
    async function pollForState(isCurrentlyJoined) {
        if (!currentRoom) return;
        cleanupCounter++;
        if (isCurrentlyJoined && cleanupCounter > 6) {
            try {
                await supabase.rpc('cleanup_old_tavern_signals');
                await supabase.rpc('cleanup_old_tavern_messages');
                await supabase.rpc('cleanup_inactive_tavern_members', { p_interval_seconds: 90 });
                cleanupCounter = 0;
            } catch (e) { console.warn("Falha na limpeza do Supabase:", e); }
        }
        
        const { data: members } = await supabase.from('tavern_members').select('*').eq('room_id', currentRoom.id);
        if (!members) return;

        const oldSeat = myMemberInfo?.seat_number;
        myMemberInfo = members.find(m => m.player_id === userId);

        if (isCurrentlyJoined && !myMemberInfo) { leaveRoom(); return; }
        if (isCurrentlyJoined && oldSeat !== myMemberInfo?.seat_number) await updateConnections(members);

        await renderUI(members);
        await updateChat();
    }

    function renderControls() {
        tControls.innerHTML = `
            <button id="joinTavernBtn" class="tavernSendBtn">Entrar na Taverna</button>
            <button id="leaveTavernBtn" class="tavernSendBtn" style="display:none;">Sair</button>
        `;
        document.getElementById('joinTavernBtn').onclick = joinRoom;
        document.getElementById('leaveTavernBtn').onclick = leaveRoom;
        updateButtonVisibility();
    }

    async function renderUI(members) {
        tSeats.innerHTML = '';
        const playersData = (await supabase.from('players').select('id, name, avatar_url').in('id', members.map(m => m.player_id))).data;
        if (!playersData) return;
        const playersMap = new Map(playersData.map(p => [p.id, p]));
        
        for (let i = 1; i <= 5; i++) {
            const el = document.createElement('div'), member = members.find(m => m.seat_number === i);
            el.className = 'tavern-seat';
            el.dataset.seat = i;
            if (member) {
                const player = playersMap.get(member.player_id);
                el.innerHTML = `<img src="${player?.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${player?.name}" /><div class="seat-number">${i}</div>`;
                el.dataset.playerId = player.id;
                el.dataset.isMuted = member.is_muted;
                if (member.is_muted) {
                    el.querySelector('img').classList.add('muted-player');
                    el.insertAdjacentHTML('beforeend', '<span class="mute-icon">🔇</span>');
                    el.title = `${player?.name} (Silenciado)`;
                }
            } else {
                el.classList.add('empty');
                el.innerHTML = `<div class="seat-number" style="bottom: 1px;">${i}</div><div style="color:yellow;font-size: 0.7em; margin-top: -5px;">Livre</div>`;
            }
            tSeats.appendChild(el);
        }
    }
    
    async function updateChat() {
        if (!isJoined) { tChat.innerHTML = ''; return; }
        const { data: msgs } = await supabase.rpc('get_new_tavern_messages', { p_room_id: currentRoom.id, p_last_id: lastMessageId });
        if (msgs && msgs.length > 0) {
            msgs.forEach(m => {
                const div = document.createElement('div'), bubble = document.createElement('div'), contentDiv = document.createElement('div'), nameBold = document.createElement('b');
                div.className = 'tavern-message';
                bubble.className = 'bubble';
                bubble.textContent = m.message;
                nameBold.textContent = m.player_name;
                contentDiv.appendChild(nameBold); contentDiv.appendChild(bubble);
                div.innerHTML = `<img src="${m.player_avatar || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" />`;
                div.appendChild(contentDiv);
                tChat.appendChild(div);
            });
            lastMessageId = msgs[msgs.length - 1].id;
            if(tChat.scrollHeight - tChat.scrollTop < tChat.clientHeight + 150) tChat.scrollTop = tChat.scrollHeight;
        }
    }

    function cleanupAll() {
        if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        tAudioContainer.innerHTML = '';
        processedSignalIds.clear();
        myMemberInfo = null;
        lastMessageId = 0;
    }

    document.addEventListener('click', (e) => {
        const popover = document.getElementById('activeTavernPopover');
        if (popover && !popover.contains(e.target) && !tSeats.contains(e.target)) popover.remove();
    });

    function setSeatAsEmpty(seatEl) {
        if(!seatEl) return;
        seatEl.className = 'tavern-seat empty';
        seatEl.removeAttribute('data-player-id');
        seatEl.removeAttribute('data-is-muted');
        seatEl.innerHTML = `<div class="seat-number" style="bottom: 1px;">${seatEl.dataset.seat}</div><div style="color:yellow;font-size: 0.7em; margin-top: -5px;">Livre</div>`;
        seatEl.style.border = ''; seatEl.title = '';
    }

    function setSeatAsMuted(seatEl, isMuted) {
        if (!seatEl) return;
        const img = seatEl.querySelector('img'), icon = seatEl.querySelector('.mute-icon');
        seatEl.dataset.isMuted = isMuted;
        if (isMuted) {
            img?.classList.add('muted-player');
            if (!icon) seatEl.insertAdjacentHTML('beforeend', '<span class="mute-icon">🔇</span>');
        } else {
            img?.classList.remove('muted-player');
            icon?.remove();
        }
    }

    tSeats.onclick = async (ev) => {
        const seatEl = ev.target.closest('.tavern-seat');
        if (!seatEl) return;
        
        document.getElementById('activeTavernPopover')?.remove();

        const seatNumber = parseInt(seatEl.dataset.seat), targetPlayerId = seatEl.dataset.playerId;
        const canManage = userRole === 'leader' || userRole === 'co-leader';

        if (seatEl.classList.contains('empty')) {
            const oldSeatNumber = myMemberInfo?.seat_number;
            if(oldSeatNumber) setSeatAsEmpty(tSeats.querySelector(`[data-seat='${oldSeatNumber}']`));
            seatEl.classList.remove('empty');
            seatEl.dataset.playerId = userId;
            seatEl.innerHTML = `<img src="${myPlayerData.avatar_url}" alt="${myPlayerData.name}" /><div class="seat-number">${seatNumber}</div>`;
            moveSeat(seatNumber);
        } else if (targetPlayerId) {
            const popover = tPopoverTemplate.cloneNode(true);
            popover.id = 'activeTavernPopover';
            popover.style.display = 'block';
            let optionsHtml = '';
            const isSelf = targetPlayerId === userId;

            if (isSelf) {
                const isMuted = myMemberInfo?.is_muted || false;
                const muteToggleText = isMuted ? 'Dessilenciar-se' : 'Silenciar-se';
                optionsHtml += `<div class="pop-item" data-action="leave-seat">Sair do Assento</div>`;
                optionsHtml += `<div class="pop-item" data-action="self-mute">${muteToggleText}</div>`;
            } else if (canManage) {
                const targetIsMuted = seatEl.dataset.isMuted === 'true';
                const muteToggleText = targetIsMuted ? 'Dessilenciar' : 'Silenciar';
                optionsHtml += `<div class="pop-item" data-action="kick" data-target-id="${targetPlayerId}">Remover</div>`;
                optionsHtml += `<div class="pop-item" data-action="mute" data-target-id="${targetPlayerId}">${muteToggleText}</div>`;
            }

            popover.innerHTML = optionsHtml; document.body.appendChild(popover);
            const rect = seatEl.getBoundingClientRect();
            popover.style.top = `${rect.bottom + window.scrollY}px`; popover.style.left = `${rect.left + window.scrollX}px`;

            popover.onclick = async (popEvent) => {
                const action = popEvent.target.dataset.action;
                const targetId = popEvent.target.dataset.targetId;
                popover.remove();
                switch (action) {
                    case 'leave-seat': setSeatAsEmpty(seatEl); moveSeat(null); break;
                    case 'self-mute': {
                        const isCurrentlyMuted = myMemberInfo?.is_muted || false;
                        setSeatAsMuted(seatEl, !isCurrentlyMuted);
                        await supabase.rpc('mute_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: userId, p_mute: !isCurrentlyMuted });
                        if(myMemberInfo) myMemberInfo.is_muted = !isCurrentlyMuted;
                        break;
                    }
                    case 'kick': setSeatAsEmpty(seatEl); await supabase.rpc('kick_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: targetId }); break;
                    case 'mute': {
                        const isCurrentlyMuted = seatEl.dataset.isMuted === 'true';
                        setSeatAsMuted(seatEl, !isCurrentlyMuted);
                        await supabase.rpc('mute_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: targetId, p_mute: !isCurrentlyMuted });
                        break;
                    }
                }
            };
        }
    };

    tSendBtn.onclick = async () => {
        const txt = tMessageInput.value.trim();
        if (!txt || !isJoined) return;
        tMessageInput.value = '';
        await supabase.rpc('post_tavern_message', { p_room_id: currentRoom.id, p_player_id: userId, p_player_name: myPlayerData.name, p_player_avatar: myPlayerData.avatar_url, p_message: txt });
        await updateChat();
    };

    async function initialize() {
        if (!(await getSession())) {
            tControls.innerHTML = '<p>Você precisa estar em uma guilda para acessar a Taverna.</p>';
            document.getElementById('tavernContainer').style.display = 'none';
            return;
        }
        await ensureRoom();
        tTitle.textContent = currentRoom?.name || 'Taverna';
        renderControls();
        pollForState(false);
    }
    initialize();

    // --- Funções WebRTC ---
    async function updateConnections(members) {
        if (!myMemberInfo) return;
        const amISpeaker = myMemberInfo.seat_number != null;
        if (amISpeaker && !localStream) {
            showShimmerOverlay();
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                document.getElementById('shimmerOverlay')?.remove();
            } catch (err) {
                document.getElementById('shimmerOverlay')?.remove();
                console.warn('Permissão de microfone negada.', err);
                if (!document.getElementById('mic_error')) {
                    tSeats.insertAdjacentHTML('beforebegin', '<div id="mic_error" style="color:orange;padding:10px;text-align:center;">🔴 Microfone bloqueado. Conceda a permissão ao aplicativo e tente novamente.</div>');
                }
                await moveSeat(null);
                return;
            }
        } else if (!amISpeaker && localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        document.getElementById('mic_error')?.remove();

        const speakers = members.filter(m => m.seat_number != null);
        let peersToConnect = amISpeaker ? speakers.filter(s => s.player_id !== userId) : speakers;
        const peerIdsToConnect = new Set(peersToConnect.map(p => p.player_id));

        for (const peer of peersToConnect) if (!peerConnections[peer.player_id]) createPeerConnection(peer.player_id, true);
        for (const existingPeerId in peerConnections) {
            if (!peerIdsToConnect.has(existingPeerId)) {
                peerConnections[existingPeerId]?.close();
                delete peerConnections[existingPeerId];
                document.getElementById(`audio-${existingPeerId}`)?.remove();
            }
        }
    }
    function createPeerConnection(peerId, isInitiator) {
        if (peerConnections[peerId]) return;
        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        peerConnections[peerId] = pc;
        if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        pc.ontrack = (event) => {
            let audioEl = document.getElementById(`audio-${peerId}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio-${peerId}`; audioEl.autoplay = true;
                tAudioContainer.appendChild(audioEl);
            }
            audioEl.srcObject = event.streams[0];
        };
        pc.onicecandidate = (event) => {
            if (event.candidate) supabase.from('tavern_signals').insert({ room_id: currentRoom.id, from_player: userId, to_player: peerId, type: 'candidate', payload: event.candidate }).then();
        };
        pc.onconnectionstatechange = () => {
             if (['disconnected', 'closed', 'failed'].includes(pc.connectionState)) {
                pc.close();
                delete peerConnections[peerId];
                document.getElementById(`audio-${peerId}`)?.remove();
            }
        };
        if (isInitiator) {
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => supabase.from('tavern_signals').insert({ room_id: currentRoom.id, from_player: userId, to_player: peerId, type: 'offer', payload: pc.localDescription }).then());
        }
    }
    async function pollForSignals() {
        if (!isJoined) return;
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
                if (signal.payload) await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
                break;
        }
        try {
            await supabase.from('tavern_signals').delete().eq('id', signal.id);
            processedSignalIds.delete(signal.id);
        } catch (e) { console.error("Erro ao deletar o sinal do Supabase:", e); }
    }
});