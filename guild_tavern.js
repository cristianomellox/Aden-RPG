// guild_tavern.js - Refatorado para Baixo Consumo
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
    const tNotifContainer = document.getElementById('tavernNotificationContainer') || document.body;
    const tPopoverTemplate = document.getElementById('tavernPopoverTemplate');


    // --- Variáveis de Estado ---
    let userId = null;
    let guildId = null;
    let userRole = 'member';
    let myPlayerData = {};
    let currentRoom = null;
    let myMemberInfo = null;
    let joined = false;

    let statePollId = null;
    let signalPollId = null;
    let activityPollId = null; 

    let localStream = null;
    let peerConnections = {};
    let processedSignalIds = new Set();
    
    const playersCache = new Map();
    let lastMessageTimestamp = new Date(0).toISOString();

    const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    // --- Funções de UX ---
    function showNotification(message, duration = 5000) {
        // (código existente sem alterações)
        const notifEl = document.createElement('div');
        notifEl.className = 'tavern-notification';
        notifEl.textContent = message;
        notifEl.style.cssText = `position: fixed; top: 10px; left: 50%; transform: translateX(-50%); width: 300px; text-align: center; background: #222; color: #fff; padding: 10px 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); z-index: 9999; opacity: 0; transition: opacity 0.5s, transform 0.5s;`;
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

    // ALTERADO: Shimmer com cronômetro de 60 segundos
    function showShimmerOverlay() {
        const existingShimmer = document.getElementById('shimmerOverlay');
        if (existingShimmer) existingShimmer.remove();

        const shimmerEl = document.createElement('div');
        shimmerEl.id = 'shimmerOverlay';
        
        const textSpan = document.createElement('span');
        textSpan.className = 'shimmer-text';
        
        shimmerEl.innerHTML = `<div class="shimmer-content"></div><div class="shimmer-bar"></div>`;
        shimmerEl.querySelector('.shimmer-content').appendChild(textSpan);

        shimmerEl.style.cssText = `position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.9); z-index: 1000; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #fff; font-size: 1.2rem; text-align: center;`;
        
        const style = document.createElement('style');
        style.textContent = `#shimmerOverlay .shimmer-content { max-width: 80%; padding: 20px; border-radius: 10px; background: rgba(255, 255, 255, 0.1); backdrop-filter: blur(2px); } #shimmerOverlay .shimmer-bar { height: 4px; width: 100%; background: linear-gradient(to right, transparent, #fff, transparent); animation: shimmerAnim 1.5s infinite linear; margin-top: 10px; border-radius: 2px; } @keyframes shimmerAnim { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`;
        document.head.appendChild(style);
        
        let countdown = 60;
        const updateTimer = () => {
            textSpan.textContent = `Estabelecendo conexão de áudio com criptografia de ponta a ponta. Por favor, aguarde: (${countdown}s)`;
            countdown--;
        };
        updateTimer();
        const timerId = setInterval(updateTimer, 1000);

        tActiveArea.appendChild(shimmerEl);

        setTimeout(() => {
            clearInterval(timerId);
            shimmerEl.remove();
            style.remove();
        }, 60000); // Efeito dura 60 segundos
    }
    
    // --- Funções de Gerenciamento de Estado ---
    async function getSession() {
        // (código existente sem alterações)
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;
        userId = session.user.id;
        if (!playersCache.has(userId)) {
             const { data: player } = await supabase.from('players').select('guild_id, rank, name, avatar_url').eq('id', userId).single();
             if (!player) return false;
             guildId = player.guild_id;
             userRole = player.rank;
             myPlayerData = { name: player.name, avatar_url: player.avatar_url };
             playersCache.set(userId, myPlayerData);
        } else {
            const player = (await supabase.from('players').select('guild_id, rank').eq('id', userId).single()).data;
            if (!player) return false;
            guildId = player.guild_id;
            userRole = player.rank;
            myPlayerData = playersCache.get(userId);
        }
        return true;
    }

    async function ensureRoom() {
        // (código existente sem alterações)
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
        
        // ALTERADO: Limpezas executadas ao entrar
        try {
            await supabase.rpc('cleanup_inactive_tavern_members');
            await supabase.rpc('cleanup_old_tavern_signals');
            await supabase.rpc('cleanup_old_tavern_messages');
        } catch(e) {
            console.warn("Falha na limpeza inicial:", e);
        }

        joined = true;
        await supabase.rpc('join_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        showNotification(`${myPlayerData.name} entrou na Taverna.`, 5000);
        tActiveArea.style.display = 'block';
        tSendBtn.disabled = false;
        renderControls();
        startPolling();
    }

    async function leaveRoom() {
        // (código existente sem alterações)
        if (!currentRoom || !joined) return;
        await supabase.rpc('leave_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
        joined = false;
        stopPolling();
        cleanupAll();
        tActiveArea.style.display = 'none';
        tSendBtn.disabled = true;
        renderControls();
    }

    async function moveSeat(seatNumber) {
        // (código existente sem alterações)
        if (!joined) return;
        await supabase.rpc('move_tavern_seat', { p_room_id: currentRoom.id, p_player_id: userId, p_new_seat: seatNumber });
    }
    
    // --- Lógica de Polling ---
    async function updateMyActivity() {
        if (!joined || !currentRoom || !userId) return;
        try {
            await supabase.rpc('update_tavern_member_activity', { p_room_id: currentRoom.id, p_player_id: userId });
        } catch (e) {
            console.warn('Falha ao atualizar atividade na taverna:', e);
        }
    }

    function startPolling() {
        stopPolling();
        
        // ALTERADO: Novos intervalos de polling
        signalPollId = setInterval(pollForSignals, 30000);   // A cada 30 segundos
        statePollId = setInterval(pollForState, 90000);     // A cada 90 segundos
        activityPollId = setInterval(updateMyActivity, 3540000); // A cada 59 minutos

        pollForState();
        pollForSignals();
        updateMyActivity(); 
    }

    function stopPolling() {
        clearInterval(signalPollId);
        clearInterval(statePollId);
        clearInterval(activityPollId);
    }
    
    async function pollForState() {
        if (!joined) return;
        
        try {
            await supabase.rpc('cleanup_inactive_tavern_members');
            await supabase.rpc('cleanup_old_tavern_signals');
            await supabase.rpc('cleanup_old_tavern_messages');
        } catch (e) {
            console.warn("Falha na limpeza do Supabase:", e);
        }

        const { data: members } = await supabase.from('tavern_members').select('*').eq('room_id', currentRoom.id);
        if (!members) return;

        const oldSeat = myMemberInfo?.seat_number;
        const oldMuteStatus = myMemberInfo?.is_muted;
        
        myMemberInfo = members.find(m => m.player_id === userId);
        
        if (!myMemberInfo) {
            if (joined) {
                console.log("Desconectado da taverna por inatividade ou remoção.");
                leaveRoom();
            }
            return;
        }

        if (oldSeat !== myMemberInfo.seat_number || oldMuteStatus !== myMemberInfo.is_muted) {
            await updateConnections(members);
        }
        
        await renderUI(members);
        await updateChat(); // ALTERADO: Chat agora atualiza junto com o estado
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
        // ALTERADO: Chamada para updateChat foi removida daqui
    }
    
    // --- Lógica WebRTC e UI (sem alterações) ---
    // (O restante do código, incluindo WebRTC, Popover, Mute, etc., permanece o mesmo)
    async function updateConnections(members) {
        if (!myMemberInfo) return;
        const amISpeaker = myMemberInfo.seat_number != null && !myMemberInfo.is_muted;

        if (amISpeaker && !localStream) {
            showShimmerOverlay(); 
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (err) {
                document.getElementById('shimmerOverlay')?.remove(); 
                console.warn('Permissão de microfone negada.', err);
                tSeats.insertAdjacentHTML('beforebegin', '<div id="mic_error" style="color:orange;padding:10px;text-align:center;">🔴 Microfone bloqueado. Conceda a permissão e sente-se novamente.</div>');
                await moveSeat(null);
                return; 
            }
        } else if (!amISpeaker && localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        const errorDiv = document.getElementById('mic_error');
        if (errorDiv) errorDiv.remove();

        const speakers = members.filter(m => m.seat_number != null && !m.is_muted);
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
        
        try {
            await supabase.from('tavern_signals').delete().eq('id', signal.id);
            processedSignalIds.delete(signal.id); 
        } catch (e) {
            console.error("Erro ao deletar o sinal do Supabase:", e);
        }
    }

    function renderControls() {
        if (joined) {
            tControls.innerHTML = `<button id="leaveTavernBtn" class="tavernSendBtn">Sair</button>`;
            document.getElementById('leaveTavernBtn').onclick = leaveRoom;
        } else {
            tControls.innerHTML = `<button id="joinTavernBtn" class="tavernSendBtn">Entrar na Taverna</button>`;
            document.getElementById('joinTavernBtn').onclick = joinRoom;
        }
    }
    
    async function fetchPlayersData(playerIds) {
        const idsToFetch = playerIds.filter(id => !playersCache.has(id));
        if (idsToFetch.length > 0) {
            const { data, error } = await supabase.from('players').select('id, name, avatar_url').in('id', idsToFetch);
            if (error) {
                console.error("Erro ao buscar dados dos jogadores:", error);
                return;
            }
            data.forEach(player => playersCache.set(player.id, player));
        }
    }

    async function renderUI(members) {
        tSeats.innerHTML = '';
        const playerIds = members.map(m => m.player_id);
        await fetchPlayersData(playerIds);

        const memberMap = new Map(members.map(m => [m.seat_number, m]));

        for (let i = 1; i <= 5; i++) {
            const el = document.createElement('div');
            el.className = 'tavern-seat';
            el.dataset.seat = i;
            const member = memberMap.get(i);
            
            if (member) {
                const player = playersCache.get(member.player_id);
                const isMuted = member.is_muted;
                const mutedClass = isMuted ? 'muted-player' : '';
                const muteIcon = isMuted ? '<span class="mute-icon">🔇</span>' : '';

                el.innerHTML = `<img src="${player?.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${player?.name}" class="${mutedClass}" />
                                <div class="seat-number">${i}</div>
                                ${muteIcon}`;
                
                if (member.player_id === userId) {
                    el.classList.add('my-seat');
                }
            } else {
                el.classList.add('empty');
                el.innerHTML = `<div class="seat-number" style="bottom: 1px;">${i}</div><div style="color:yellow;font-size: 0.7em; margin-top: -5px;">Livre</div>`;
            }
            tSeats.appendChild(el);
        }
    }

    async function updateChat() {
        if (!joined) return;
        const { data: msgs } = await supabase
            .from('tavern_messages')
            .select('id, player_name, player_avatar, message, created_at')
            .eq('room_id', currentRoom.id)
            .gt('created_at', lastMessageTimestamp)
            .order('created_at', { ascending: true });

        if (msgs && msgs.length > 0) {
            msgs.forEach(m => {
                const div = document.createElement('div');
                div.className = 'tavern-message';
                
                const img = document.createElement('img');
                img.src = m.player_avatar || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';

                const contentDiv = document.createElement('div');
                const nameB = document.createElement('b');
                nameB.textContent = m.player_name;
                
                const bubbleDiv = document.createElement('div');
                bubbleDiv.className = 'bubble';
                bubbleDiv.textContent = m.message;
                
                contentDiv.appendChild(nameB);
                contentDiv.appendChild(bubbleDiv);
                
                div.appendChild(img);
                div.appendChild(contentDiv);
                
                tChat.appendChild(div);
            });
            
            lastMessageTimestamp = msgs[msgs.length - 1].created_at;

            if(tChat.scrollHeight - tChat.scrollTop < tChat.clientHeight + 250) {
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
        lastMessageTimestamp = new Date(0).toISOString();
        tChat.innerHTML = '';
    }

    tSeats.onclick = async (ev) => {
        const seatEl = ev.target.closest('.tavern-seat');
        if (!seatEl) return;
        
        const seatNumber = parseInt(seatEl.dataset.seat, 10);

        if (seatEl.classList.contains('empty')) {
             const myCurrentSeatEl = tSeats.querySelector('.my-seat');
             if (myCurrentSeatEl) {
                myCurrentSeatEl.classList.remove('my-seat');
                myCurrentSeatEl.classList.add('empty');
                myCurrentSeatEl.innerHTML = `<div class="seat-number" style="bottom: 1px;">${myCurrentSeatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
            }
            seatEl.classList.remove('empty');
            seatEl.classList.add('my-seat');
            seatEl.innerHTML = `<img src="${myPlayerData.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" alt="${myPlayerData.name}" /><div class="seat-number">${seatNumber}</div>`;
            seatEl.title = "Sair do assento";
            await moveSeat(seatNumber);
            pollForState();

        } else {
            const { data: members } = await supabase.from('tavern_members').select('*').eq('room_id', currentRoom.id).eq('seat_number', seatNumber);
            if (members && members.length > 0) {
                const targetMember = members[0];
                const targetPlayer = playersCache.get(targetMember.player_id);
                showSeatPopover(seatEl, targetMember, targetPlayer);
            }
        }
    };
    
    function showSeatPopover(seatEl, targetMember, targetPlayer) {
        closePopover(); 
        
        const popover = tPopoverTemplate.cloneNode(true);
        popover.id = 'tavernPopoverActive';
        popover.style.display = 'block';
        
        const rect = seatEl.getBoundingClientRect();
        popover.style.top = `${rect.bottom + window.scrollY + 5}px`;
        popover.style.left = `${rect.left + window.scrollX}px`;
        
        const canManage = userRole === 'leader' || userRole === 'co-leader';
        const isSelf = targetMember.player_id === userId;

        let content = '';
        if (isSelf) {
            const muteText = targetMember.is_muted ? 'Dissilenciar' : 'Silenciar-se';
            content += `<div class="pop-item" data-action="mute" data-target-id="${targetMember.player_id}" data-muted="${targetMember.is_muted}">${muteText}</div>`;
            content += `<div class="pop-item" data-action="leave">Sair do Assento</div>`;
        } else if (canManage) {
            const muteText = targetMember.is_muted ? 'Dissilenciar Jogador' : 'Silenciar Jogador';
            content += `<div class="pop-item" data-action="mute" data-target-id="${targetMember.player_id}" data-muted="${targetMember.is_muted}">${muteText}</div>`;
            content += `<div class="pop-item" data-action="kick" data-target-id="${targetMember.player_id}">Remover da Taverna</div>`;
        } else {
            return;
        }

        popover.innerHTML = content;
        document.body.appendChild(popover);

        popover.onclick = (ev) => {
            const actionEl = ev.target.closest('.pop-item');
            if (!actionEl) return;
            
            const action = actionEl.dataset.action;
            const targetId = actionEl.dataset.targetId;
            const isMuted = actionEl.dataset.muted === 'true';

            switch (action) {
                case 'leave':
                    handleLeaveSeat();
                    break;
                case 'mute':
                    handleMute(targetId, !isMuted, seatEl);
                    break;
                case 'kick':
                    handleKick(targetId);
                    break;
            }
            closePopover();
        };

        setTimeout(() => document.addEventListener('click', closePopover, { once: true }), 0);
    }
    
    function closePopover(event) {
        const popover = document.getElementById('tavernPopoverActive');
        if (event && popover && popover.contains(event.target)) {
            setTimeout(() => document.addEventListener('click', closePopover, { once: true }), 0);
            return;
        }
        if (popover) {
            popover.remove();
        }
    }
    
    async function handleLeaveSeat() {
        const mySeatEl = tSeats.querySelector('.my-seat');
        if (mySeatEl) {
            mySeatEl.classList.remove('my-seat');
            mySeatEl.classList.add('empty');
            mySeatEl.innerHTML = `<div class="seat-number" style="bottom: 1px;">${mySeatEl.dataset.seat}</div><div style="color:white;opacity:.6;">Livre</div>`;
        }
        await moveSeat(null);
        pollForState();
    }
    
    async function handleMute(targetId, shouldMute, seatEl) {
        const img = seatEl.querySelector('img');
        const existingIcon = seatEl.querySelector('.mute-icon');

        if (shouldMute) {
            img.classList.add('muted-player');
            if (!existingIcon) {
                const muteIcon = document.createElement('span');
                muteIcon.className = 'mute-icon';
                muteIcon.textContent = '🔇';
                seatEl.appendChild(muteIcon);
            }
        } else {
            img.classList.remove('muted-player');
            if (existingIcon) {
                existingIcon.remove();
            }
        }
        
        await supabase.rpc('mute_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: targetId, p_mute: shouldMute });
    }

    async function handleKick(targetId) {
        await supabase.rpc('kick_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: targetId });
        showNotification("Jogador removido da Taverna.", 3000);
        pollForState();
    }

    // ALTERADO: Lógica de envio de mensagem otimista
    tSendBtn.onclick = async () => {
        const txt = tMessageInput.value.trim();
        if (!txt || !joined) return;

        // 1. Renderiza a mensagem localmente IMEDIATAMENTE
        const div = document.createElement('div');
        div.className = 'tavern-message';
        div.innerHTML = `<img src="${myPlayerData.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" /><div><b>${myPlayerData.name}</b><div class="bubble">${txt.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div>`;
        tChat.appendChild(div);
        tChat.scrollTop = tChat.scrollHeight;
        
        const messageToSend = txt;
        tMessageInput.value = '';

        // 2. Envia para o Supabase em segundo plano
        try {
            await supabase.rpc('post_tavern_message', { 
                p_room_id: currentRoom.id, 
                p_player_id: userId, 
                p_player_name: myPlayerData.name, 
                p_player_avatar: myPlayerData.avatar_url, 
                p_message: messageToSend 
            });
        } catch(e) {
            console.error("Falha ao enviar mensagem:", e);
            // Opcional: Adicionar um indicador de falha na UI
        }
        // Não chama mais o updateChat aqui.
    };
    
    tMessageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            tSendBtn.click();
        }
    });

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
        tTitle.textContent = currentRoom?.name || 'Taverna';
        renderControls();
    }

    initialize();
});