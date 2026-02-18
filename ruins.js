import { supabase } from './supabaseClient.js';

// --- Configurações ---
const POLLING_INTERVAL = 30000; 

// --- Estado Local ---
let state = {
    sessionId: null,
    playerId: null,
    status: 'loading', 
    selectedClass: null,
    myPlayer: null,
    lastEventTs: 0,
    registrationEndsAt: null,
    battleEndsAt: null,
    nextOpenAt: null,
    collapseStartAt: null,
    isProcessing: false,
    cooldownInterval: null,
    relicHolderId: null,
    relicRoomId: null, 
    isSpectating: false,
    destroyedCount: 0, 
    
    // Estados para o Menu Lateral
    logHistory: [], 
    isSidebarOpen: false
};

// Controle de morte local para evitar sobrescrita do heartbeat
let ignoreHeartbeatDeath = false;

// --- Sistema de Áudio ---
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const audioBuffers = {};
const audioFiles = {
    normal: "https://aden-rpg.pages.dev/assets/normal_hit.mp3",
    critical: "https://aden-rpg.pages.dev/assets/critical_hit.mp3",
    evade: "https://aden-rpg.pages.dev/assets/evade.mp3",
    win: "https://aden-rpg.pages.dev/assets/win.mp3",
    loss: "https://aden-rpg.pages.dev/assets/loss.mp3",
    chest: "https://aden-rpg.pages.dev/assets/pot_dex.mp3", 
    trap: "https://aden-rpg.pages.dev/assets/normal_hit.mp3", // Corrigido: normal_hit
    monster: "https://aden-rpg.pages.dev/assets/pot_furia.mp3", // Corrigido: pot_furia
    heal: "https://aden-rpg.pages.dev/assets/pot_cura.mp3",
    relic: "https://aden-rpg.pages.dev/assets/pot_cura.mp3" 
};

async function preloadAudio() {
    for (const [key, url] of Object.entries(audioFiles)) {
        try {
            const res = await fetch(url);
            const ab = await res.arrayBuffer();
            audioBuffers[key] = await audioContext.decodeAudioData(ab);
        } catch(e) {
            console.warn("Erro ao carregar audio:", key);
        }
    }
}

function playSound(name) {
    if (audioContext.state === 'suspended') audioContext.resume().catch(()=>{});
    const buf = audioBuffers[name];
    if (buf) {
        const src = audioContext.createBufferSource();
        src.buffer = buf;
        src.connect(audioContext.destination);
        src.start(0);
    }
}

// --- Elementos DOM ---
const els = {
    lobby: document.getElementById('lobbyScreen'),
    game: document.getElementById('gameScreen'),
    timer: document.getElementById('lobbyTimer'),
    status: document.getElementById('lobbyStatus'),
    tickets: document.getElementById('ticketCount'),
    classArea: document.getElementById('classSelectionArea'),
    waitingArea: document.getElementById('waitingArea'),
    btnRegister: document.getElementById('btnRegister'),
    
    // Game HUD
    hpFill: document.getElementById('hudHpFill'),
    hpText: document.getElementById('hudHpText'),
    apText: document.getElementById('hudApText'),
    gameTimer: document.getElementById('gameTimer'),
    collapseTimer: document.getElementById('collapseTimer'),
    relicStatus: document.getElementById('relicStatus'),
    roomInfo: document.getElementById('roomInfo'),
    
    // Logs Divididos (Atualizado)
    logLeft: document.getElementById('eventLogLeft'),
    logRight: document.getElementById('eventLogRight'),
    
    // Room View
    roomView: document.getElementById('roomView'),
    roomContent: document.getElementById('roomContent'),
    entityImg: document.getElementById('entityImg'),
    entityName: document.getElementById('entityName'),
    collapseOverlay: document.getElementById('collapseOverlay'),
    
    // Controls
    navMsg: document.getElementById('navMessage'),
    actionButtons: document.querySelector('.action-buttons'),
    probeGrid: document.getElementById('probeOptions'),
    btnMove: document.getElementById('btnMoveBlind'),
    btnProbe: document.getElementById('btnProbe'),
    
    // Cooldown & Potions
    cooldownContainer: document.getElementById('cooldownTimerContainer'),
    cooldownText: document.getElementById('cooldownText'),
    decisionBar: document.getElementById('decisionTimerBar'),
    restPotionArea: document.getElementById('restPotionArea'),
    restPotionList: document.getElementById('restPotionList'),

    // Combat UI Elements
    combatMyName: document.getElementById('combatMyName'),
    combatMyClass: document.getElementById('combatMyClass'),
    combatOppName: document.getElementById('combatOppName'),
    combatOppClass: document.getElementById('combatOppClass')
};

// --- Funções Auxiliares Globais ---
function getClassName(classId) {
    const map = {
        'vanguard': 'Vanguarda',
        'scout': 'Batedor',
        'oracle': 'Oráculo',
        'guardian': 'Guardião',
        'monster': 'Criatura',
        'trap': 'Armadilha'
    };
    return map[classId] || classId || 'Desconhecido';
}

// --- Funções do Menu Lateral ---

window.toggleSidebar = () => {
    const sb = document.getElementById('ruinsSidebar');
    const btn = document.getElementById('toggleLogBtn');
    if (!sb || !btn) return;

    state.isSidebarOpen = !state.isSidebarOpen;
    
    if (state.isSidebarOpen) {
        sb.classList.add('open');
        btn.style.right = "300px"; 
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="gold" stroke-width="2"><path d="M9 19l7-7-7-7"/></svg>`;
    } else {
        sb.classList.remove('open');
        btn.style.right = "0";
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="gold" stroke-width="2"><path d="M15 19l-7-7 7-7"/></svg>`;
    }
};

function updateLogSidebar() {
    const container = document.getElementById('sidebarLogsArea');
    if (!container) return;
    
    container.innerHTML = '';
    state.logHistory.slice().reverse().forEach(entry => {
        const div = document.createElement('div');
        div.className = 'sidebar-log-entry';
        const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        div.innerHTML = `<span class="time">[${time}]</span> ${entry}`;
        container.appendChild(div);
    });
}

function updateParticipantsSidebar(list, relicHolderId, relicRoomId) {
    const container = document.getElementById('sidebarParticipantsArea');
    if (!container || !list) return;

    container.innerHTML = '';
    
    list.sort((a, b) => (a.is_dead === b.is_dead) ? 0 : a.is_dead ? 1 : -1);

    list.forEach(p => {
        const div = document.createElement('div');
        let classes = 'sb-participant-card';
        if (p.is_dead) classes += ' dead';
        if (p.id === relicHolderId) classes += ' relic';
        
        div.className = classes;
        
        let statusText = p.is_dead ? "(MORTO)" : "Vivo";
        let statusColor = p.is_dead ? "red" : "lime";
        
        if (p.id === relicHolderId) {
            statusText = "PORTADOR";
            statusColor = "cyan";
            if (relicRoomId) {
                statusText += ` [Sala ${relicRoomId}]`;
            }
        }

        let hpBarHtml = '';
        if (!p.is_dead && p.hp !== undefined && p.max_hp !== undefined) {
            const pct = Math.max(0, Math.min(100, (p.hp / p.max_hp) * 100));
            let barColor = '#4caf50'; 
            if (pct < 50) barColor = '#ffeb3b'; 
            if (pct < 25) barColor = '#f44336'; 
            
            hpBarHtml = `
                <div style="width: 100%; background: #333; height: 4px; margin-top: 4px; border-radius: 2px;">
                    <div style="width: ${pct}%; background: ${barColor}; height: 100%; border-radius: 2px; transition: width 0.3s;"></div>
                </div>
            `;
        }

        div.innerHTML = `
            <img src="${p.avatar || 'https://aden-rpg.pages.dev/avatar01.webp'}" class="sb-p-avatar">
            <div class="sb-p-info">
                <span class="sb-p-name">${p.name} ${p.is_bot ? '[Bot]' : ''}</span>
                <span class="sb-p-status" style="color:${statusColor}">${statusText}</span>
                ${hpBarHtml}
            </div>
        `;
        container.appendChild(div);
    });
}

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'index.html'; return; }
    state.playerId = session.user.id;

    const btn = document.getElementById('toggleLogBtn');
    if(btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="gold" stroke-width="2"><path d="M15 19l-7-7 7-7"/></svg>`;

    preloadAudio();
    document.body.addEventListener('click', () => { 
        if(audioContext.state === 'suspended') audioContext.resume(); 
    }, {once:true});

    const tutBtn = document.getElementById('tutorialBtn');
    const tutModal = document.getElementById('tutorialModal');
    const closeTut = document.getElementsByClassName('close-btn')[0]; 
    
    if (tutBtn && tutModal) {
        tutBtn.onclick = () => { tutModal.style.display = 'flex'; };
        if (closeTut) { closeTut.onclick = () => tutModal.style.display = 'none'; }
        window.onclick = (event) => { if (event.target == tutModal) tutModal.style.display = 'none'; };
        const closeActionBtn = tutModal.querySelector('.action-btn');
        if(closeActionBtn) { closeActionBtn.onclick = () => tutModal.style.display = 'none'; }
    }
    
    await checkMenuStatus();
    setInterval(updateTimers, 1000);
});

// --- Lógica do Lobby ---
async function checkMenuStatus() {
    const { data, error } = await supabase.rpc('get_ruins_menu_info');
    
    if (error || !data) {
        els.status.textContent = "Erro ao conectar.";
        return;
    }

    state.status = data.status;
    state.sessionId = data.session_id;
    state.registrationEndsAt = data.registration_ends_at ? new Date(data.registration_ends_at) : null;
    state.battleEndsAt = data.battle_ends_at ? new Date(data.battle_ends_at) : null;
    state.nextOpenAt = data.next_open_at ? new Date(data.next_open_at) : null;
    
    // Restaura a classe se o servidor retornou (Persistência)
    if (data.class_id) {
        state.selectedClass = data.class_id;
    }
    
    if (data.collapse_start) {
        state.collapseStartAt = new Date(data.collapse_start);
    }
    
    const used = data.tickets_used || 0;
    els.tickets.textContent = Math.max(0, 3 - used);

    // Caso 1: Jogo Ativo e usuário registrado -> Entrar direto
    if (data.is_registered && data.status === 'active') {
        // Se a classe não estava no state (ex: refresh), atualiza UI
        if(state.selectedClass) {
            document.getElementById('selectedClassName').textContent = getClassName(state.selectedClass);
        }
        enterGame();
        return;
    }

    // Caso 2: Usuário Registrado aguardando início
    if (data.is_registered) {
        showWaitingScreen();
        // Inicia o polling para verificar se o tempo acabou e iniciar o jogo automaticamente
        pollLobbyStart(); 
    } 
    // Caso 3: Inscrições Abertas (usuário não registrado)
    else if (data.status === 'registering') {
        els.status.textContent = "Inscrições Abertas";
        els.status.style.color = "gold";
        els.classArea.style.display = 'block';
        els.waitingArea.style.display = 'none';
        updateTimers();
    }
    // Caso 4: Fechado
    else if (data.status === 'closed') {
        els.status.textContent = "Inscrições abrem em:";
        els.status.style.color = "#aaa";
        els.classArea.style.display = 'none';
        els.waitingArea.style.display = 'none';
        updateTimers();
    }
}

window.selectClass = (classId) => {
    state.selectedClass = classId;
    document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.class-card[data-class="${classId}"]`).classList.add('selected');
    els.btnRegister.disabled = false;
    els.btnRegister.onclick = register;
};

async function register() {
    if (!state.selectedClass) return;
    els.btnRegister.disabled = true;
    els.btnRegister.textContent = "Inscrevendo...";

    const { data, error } = await supabase.rpc('register_for_ruins', {
        p_session_id: state.sessionId,
        p_class_id: state.selectedClass
    });

    if (error || !data.success) {
        alert(data?.message || error?.message || "Erro ao inscrever.");
        els.btnRegister.disabled = false;
        els.btnRegister.textContent = "Inscrever-se";
        return;
    }

    showWaitingScreen();
    pollLobbyStart();
}

function showWaitingScreen() {
    els.classArea.style.display = 'none';
    els.waitingArea.style.display = 'block';
    document.getElementById('selectedClassName').textContent = state.selectedClass ? getClassName(state.selectedClass) : "REGISTRADO";
    els.status.textContent = "Aguardando Início...";
    els.status.style.color = "cyan";
}

async function pollLobbyStart() {
    const now = new Date();
    if (state.registrationEndsAt && now >= state.registrationEndsAt) {
        enterGame(); 
    } else {
        setTimeout(pollLobbyStart, 2000);
    }
}

// --- Lógica da Intro ---
async function showMatchIntro(participants) {
    const overlay = document.getElementById('matchIntroOverlay');
    const list = document.getElementById('participantsList');
    const countEl = document.getElementById('introCountdown');
    
    list.innerHTML = '';
    
    if(participants && participants.length > 0) {
        participants.forEach(p => {
            const div = document.createElement('div');
            div.className = 'participant-card';
            const avatar = p.avatar || "https://aden-rpg.pages.dev/assets/monstromina1.webp";
            div.innerHTML = `<img src="${avatar}"><span>${p.name}</span>`;
            list.appendChild(div);
        });
    }

    overlay.style.display = 'flex';
    
    for(let i = 15; i > 0; i--) {
        countEl.textContent = i;
        await new Promise(r => setTimeout(r, 1000));
    }
    
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.5s';
    setTimeout(() => {
        overlay.style.display = 'none';
        overlay.style.opacity = '1';
    }, 500);
}

// --- Lógica do Jogo ---
async function enterGame() {
    const { data, error } = await supabase.rpc('enter_ruins_match', { p_session_id: state.sessionId });
    
    if (error || !data.success) {
        if (data?.message === 'Aguarde o início.') {
            setTimeout(pollLobbyStart, 2000);
            return;
        }
        alert("Erro ao entrar na partida: " + (data?.message || error?.message));
        return;
    }

    state.status = 'active';
    state.myPlayer = data.my_state;
    state.battleEndsAt = new Date(data.battle_ends_at);
    state.logHistory = []; 
    
    if (data.collapse_start) {
        state.collapseStartAt = new Date(data.collapse_start);
    }

    ignoreHeartbeatDeath = false;
    state.isSpectating = false;
    
    els.lobby.style.display = 'none';
    els.game.style.display = 'flex';
    
    updateHUD();
    updateTimers();
    
    if(data.participants_list) {
        updateParticipantsSidebar(data.participants_list, data.relic_holder, null);
    }
    
    if(data.participants_list) {
        await showMatchIntro(data.participants_list);
    }

    renderRoom(null);
    startTurnPhase();
    startHeartbeat();
}

function startTurnPhase() {
    if (state.isSpectating) {
        els.navMsg.textContent = "Modo Espectador";
        els.actionButtons.style.display = 'none';
        els.probeGrid.style.display = 'none';
        return;
    }

    state.isProcessing = false;
    els.navMsg.textContent = "Escolha seu caminho...";
    els.navMsg.style.color = "#e0dccc";
    
    els.actionButtons.style.display = 'flex';
    els.probeGrid.style.display = 'none';
    els.cooldownContainer.style.display = 'none';
    
    els.btnMove.disabled = false;
    els.btnProbe.disabled = false;

    const isRelicHolder = (state.relicHolderId === state.playerId);
    const roomsLeft = 50 - (state.destroyedCount || 0);
    
    if (isRelicHolder || roomsLeft < 3) {
        els.btnProbe.style.display = 'none';
    } else {
        els.btnProbe.style.display = 'block';
    }

    const isOracle = (state.myPlayer && state.myPlayer.class_id === 'oracle');
    if (isOracle) {
        els.btnProbe.textContent = "Sondar (0 AP)";
    } else {
        els.btnProbe.textContent = "Sondar (3 AP)";
    }
}

window.moveBlind = async () => {
    if (state.isProcessing) return;
    
    const isRelicHolder = (state.relicHolderId === state.playerId);
    const isScout = (state.myPlayer && state.myPlayer.class_id === 'scout');
    const cost = (isRelicHolder && !isScout) ? 2 : 1;

    if (state.myPlayer.ap < cost) { 
        logEvent(`Sem AP! Necessário: ${cost}`, "empty"); 
        return; 
    }
    
    executeMove(null);
};

window.probeRooms = async () => {
    if (state.isProcessing) return;
    const cost = state.myPlayer.class_id === 'oracle' ? 0 : 3; 
    if (state.myPlayer.ap < cost) { logEvent(`Sem AP para sondar! (Custa ${cost})`, "empty"); return; }

    state.isProcessing = true;
    const { data, error } = await supabase.rpc('probe_ruins_rooms');
    
    if (error || !data.success) {
        alert(data?.message || "Erro ao sondar.");
        state.isProcessing = false;
        return;
    }

    els.actionButtons.style.display = 'none';
    els.probeGrid.style.display = 'flex';
    els.probeGrid.innerHTML = '';
    
    data.options.forEach(roomId => {
        const btn = document.createElement('button');
        btn.className = 'room-opt-btn';
        btn.textContent = `Sala ${roomId}`;
        btn.onclick = () => executeMove(roomId);
        els.probeGrid.appendChild(btn);
    });
    
    state.myPlayer.ap = data.new_ap;
    updateHUD();
    els.navMsg.textContent = "Caminhos revelados. Escolha um:";
};

async function executeMove(roomId) {
    state.isProcessing = true;
    els.btnMove.disabled = true;
    els.btnProbe.disabled = true;
    els.probeGrid.style.display = 'none';
    els.actionButtons.style.display = 'none';

    const { data, error } = await supabase.rpc('move_ruins_player', { p_target_room_id: roomId });
    
    if (error || !data.success) {
        logEvent(data?.message || "Erro no movimento.", "empty");
        state.isProcessing = false;
        startTurnPhase();
        return;
    }

    state.myPlayer.ap = data.ap;
    state.myPlayer.current_room_id = data.room_id;
    updateHUD();
    
    renderRoom(data);

    if (data.combat_type === 'trap') {
        playSound('trap');
        logEvent(data.message, "trap");
        state.myPlayer.hp = data.hp;
        updateHUD();
        await new Promise(r => setTimeout(r, 1000));
    }
    else if (data.combat_type === 'pve') {
        playSound('monster'); // Som de monstro
        const startHP = data.hp + (data.combat_log.reduce((acc, t) => acc + t.opp_dmg, 0));
        state.myPlayer.hp = startHP; 
        updateHUD();
        await runCombatSequence(data);
        state.myPlayer.hp = data.hp;
        updateHUD();
    }
    else if (data.combat_type === 'pvp') {
        const startHP = data.hp + (data.combat_log.reduce((acc, t) => acc + t.opp_dmg, 0));
        state.myPlayer.hp = startHP; 
        updateHUD();
        await runCombatSequence(data);
        state.myPlayer.hp = data.hp;
        updateHUD();
    } 
    else if (data.combat_type === 'relic_event') {
        playSound('relic');
        logEvent(data.message, "relic");
        await new Promise(r => setTimeout(r, 2000));
    }
    else if (data.rewards && (data.rewards.crystals > 0 || data.rewards.coins > 0)) {
        playSound('chest');
        logEvent("Baú encontrado!", "chest");
        showChestRewards(data.rewards);
        await new Promise(r => setTimeout(r, 2000));
    } 
    else {
        logEvent("Sala Vazia.", "empty");
        els.navMsg.textContent = "Sala Vazia...";
        await new Promise(r => setTimeout(r, 1000));
    }

    if (data.dead) {
        ignoreHeartbeatDeath = true; 
        setTimeout(() => {
            let msg = "Você morreu.";
            if (data.combat_type === 'trap') msg = "Eliminado por uma Armadilha.";
            if (data.combat_type === 'pve') msg = "Morto por um Monstro.";
            if (data.combat_type === 'pvp') msg = "Derrotado em combate PvP.";
            
            logEvent(msg, "kill");
            
            setTimeout(() => {
                endGame({ win: false, message: msg });
            }, 1000);
        }, 1500);
        return;
    }

    // --- LÓGICA DE COOLDOWN ---
    let cooldownTime = 10; 
    
    const gotRelic = data.message && (data.message.includes("PEGOU A RELÍQUIA") || data.message.includes("TOMOU A RELÍQUIA") || data.message.includes("ROUBOU A RELÍQUIA"));
    
    if (gotRelic || state.relicHolderId === state.playerId) {
        cooldownTime = 30;
        if(gotRelic) showCenterNotification("PENALIDADE DA RELÍQUIA: 30s DE DESCANSO!");
    }

    startCooldownTimer(cooldownTime);
}

// --- Lógica de Descanso e Poções ---
async function startCooldownTimer(seconds) {
    els.cooldownContainer.style.display = 'block';
    els.navMsg.textContent = "Descansando...";
    let timeLeft = seconds;
    
    els.cooldownText.textContent = `Recuperando fôlego: ${timeLeft}s`;
    els.decisionBar.style.width = '100%';
    els.decisionBar.style.transition = `width ${seconds}s linear`;
    
    void els.decisionBar.offsetWidth;
    els.decisionBar.style.width = '0%';

    els.restPotionArea.style.display = 'block';
    await loadRestPotions();

    if (state.cooldownInterval) clearInterval(state.cooldownInterval);
    
    state.cooldownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            els.cooldownText.textContent = `Recuperando fôlego: ${timeLeft}s`;
        } else {
            clearInterval(state.cooldownInterval);
            els.cooldownContainer.style.display = 'none';
            els.restPotionArea.style.display = 'none'; 
            startTurnPhase();
        }
    }, 1000);
}

async function loadRestPotions() {
    els.restPotionList.innerHTML = '<span style="font-size:0.8em; color:#aaa;">Carregando...</span>';
    const { data, error } = await supabase.rpc('get_ruins_potions');
    els.restPotionList.innerHTML = '';

    if (error || !data || data.length === 0) {
        els.restPotionList.innerHTML = '<span style="font-size:0.8em; color:#555;">Nenhuma poção disponível</span>';
        return;
    }

    data.forEach(pot => {
        const div = document.createElement('div');
        div.style.cssText = "position: relative; width: 80px; height: 80px; background: #222; border: 4px solid #777; border-radius: 8px; cursor: pointer; display: flex; gap: 100px;";
        
        const imgUrl = pot.id === 43 
            ? "https://aden-rpg.pages.dev/assets/itens/pocao_de_cura_r.webp" 
            : "https://aden-rpg.pages.dev/assets/itens/pocao_de_cura_sr.webp";
            
        div.innerHTML = `
            <img src="${imgUrl}" style="width:100%; height:100%; object-fit:contain;">
            <span style="position:absolute; bottom:0; right:0; background:rgba(0,0,0,0.8); color:white; font-size:0.8em; padding:1px 3px; border-radius:4px;">${pot.qty}</span>
        `;
        
        div.onclick = () => usePotion(pot.id);
        els.restPotionList.appendChild(div);
    });
}

async function usePotion(itemId) {
    const { data, error } = await supabase.rpc('use_ruins_potion', { p_item_id: itemId });
    if (error || !data.success) {
        logEvent(data?.message || "Erro ao usar poção", "error");
        return;
    }
    
    playSound('heal');
    logEvent(`Curou ${data.healed} HP!`, "chest");
    
    state.myPlayer.hp = data.new_hp;
    updateHUD();
    
    await loadRestPotions();
}

async function runCombatSequence(data) {
    const overlay = document.getElementById('combatOverlay');
    const myAvatar = document.getElementById('combatMyAvatar');
    const oppAvatar = document.getElementById('combatOppAvatar');
    const countdownEl = document.getElementById('combatCountdown');
    const arenaEl = document.getElementById('combatArena');
    
    els.navMsg.textContent = "Inimigo à vista!";
    await new Promise(r => setTimeout(r, 2000));

    myAvatar.src = (state.myPlayer && state.myPlayer.avatar_url) ? state.myPlayer.avatar_url : "https://aden-rpg.pages.dev/avatar01.webp"; 
    els.combatMyName.textContent = state.myPlayer.name || "Eu";
    els.combatMyClass.textContent = getClassName(state.myPlayer.class_id);

    if (data.combat_type === 'pve') {
        oppAvatar.src = "https://aden-rpg.pages.dev/assets/monstromina1.webp";
        els.combatOppName.textContent = "Monstro";
        els.combatOppClass.textContent = "Criatura";
    }
    else {
        oppAvatar.src = data.opponent_avatar || "https://aden-rpg.pages.dev/avatar01.webp";
        els.combatOppName.textContent = data.opponent_name || "Inimigo";
        els.combatOppClass.textContent = getClassName(data.opponent_class);
    }

    overlay.style.display = 'flex';
    countdownEl.style.display = 'block';
    arenaEl.style.display = 'none';

    els.navMsg.textContent = "Preparando para combate...";
    for (let i = 2; i > 0; i--) {
        countdownEl.textContent = i;
        await new Promise(r => setTimeout(r, 1000));
    }
    countdownEl.style.display = 'none';
    arenaEl.style.display = 'flex';

    const logs = data.combat_log || [];
    for (const turn of logs) {
        if (turn.player_dmg > 0) {
            animateHit(oppAvatar, turn.player_dmg, turn.is_crit);
            await new Promise(r => setTimeout(r, 1000));
        }
        
        if (turn.opp_dmg > 0) {
            animateHit(myAvatar, turn.opp_dmg, false);
            state.myPlayer.hp = Math.max(0, state.myPlayer.hp - turn.opp_dmg);
            updateHUD();
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    await new Promise(r => setTimeout(r, 1000));
    overlay.style.display = 'none';
    
    const entityDiv = document.querySelector('.room-entity');
    if(entityDiv) {
        entityDiv.classList.remove('visible');
        entityDiv.classList.add('fading-out');
    }
    await new Promise(r => setTimeout(r, 1000));

    showCenterNotification(data.message);
}

function showCenterNotification(msg) {
    const div = document.createElement('div');
    div.className = 'center-notification';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function animateHit(targetEl, dmg, isCrit) {
    if (isCrit) playSound('critical'); else playSound('normal');
    targetEl.classList.remove('shake-hit');
    void targetEl.offsetWidth;
    targetEl.classList.add('shake-hit');

    const dmgEl = document.createElement('div');
    dmgEl.textContent = dmg;
    dmgEl.className = isCrit ? 'crit-damage-number' : 'damage-number';
    targetEl.parentElement.appendChild(dmgEl);
    setTimeout(() => dmgEl.remove(), 1000);
}

function renderRoom(data) {
    els.roomContent.style.display = 'none';
    els.roomContent.classList.remove('visible', 'fading-out'); 

    if (!data) { els.roomInfo.textContent = `Sala: ${state.myPlayer.current_room_id || '?'}`; return; }

    els.roomInfo.textContent = `Sala: ${data.room_id}`;
    let imgSrc = "", name = "", show = false;

    if (data.combat_type === 'pve') { imgSrc = "https://aden-rpg.pages.dev/assets/monstromina1.webp"; name = "Monstro"; show = true; }
    else if (data.combat_type === 'trap') { imgSrc = "https://aden-rpg.pages.dev/assets/armadilha.webp"; name = "Armadilha"; show = true; }
    else if (data.combat_type === 'pvp') { imgSrc = data.opponent_avatar; name = data.opponent_name; show = true; }
    else if (data.combat_type === 'relic_event') { imgSrc = "https://aden-rpg.pages.dev/assets/relic.webp"; name = "Relíquia Ancestral"; show = true; }
    else if (data.rewards && (data.rewards.crystals > 0 || data.rewards.coins > 0)) { imgSrc = "https://aden-rpg.pages.dev/assets/mbau.webp"; name = "Baú"; show = true; }

    if (show) {
        els.entityImg.src = imgSrc;
        els.entityName.textContent = name;
        els.roomContent.style.display = 'flex';
        requestAnimationFrame(() => els.roomContent.classList.add('visible'));
    }
}

function showChestRewards(rewards) {
    const overlay = document.getElementById('chestOverlay');
    const list = document.getElementById('chestRewards');
    list.innerHTML = '';
    if (rewards.crystals > 0) list.innerHTML += `<div class="chest-reward-item"><img src="https://aden-rpg.pages.dev/assets/cristais.webp"><span>${rewards.crystals} Cristais</span></div>`;
    if (rewards.coins > 0) list.innerHTML += `<div class="chest-reward-item"><img src="https://aden-rpg.pages.dev/assets/itens/moeda_runica.webp"><span>${rewards.coins} Moedas</span></div>`;
    overlay.style.display = 'block';
    setTimeout(() => { overlay.style.display = 'none'; }, 2500);
}

function updateHUD() {
    if (!state.myPlayer) return;
    const { hp, max_hp, ap } = state.myPlayer;
    const hpPct = (hp / max_hp) * 100;
    els.hpFill.style.width = `${hpPct}%`;
    els.hpText.textContent = `${hp}/${max_hp}`;
    els.apText.textContent = ap;

    const isRelicHolder = (state.relicHolderId === state.playerId);
    const isScout = (state.myPlayer.class_id === 'scout');
    
    const moveCost = (isRelicHolder && !isScout) ? 2 : 1;

    if (moveCost > 1) {
        els.btnMove.innerHTML = `Avançar Pesado <span style="color:green">(${moveCost} AP)</span>`;
        els.btnMove.style.borderColor = "red";
        els.btnMove.style.color = "gold"; 
    } else {
        els.btnMove.innerHTML = `Avançar na Névoa (${moveCost} AP)`;
        els.btnMove.style.borderColor = "#555";
        els.btnMove.style.color = "white";
    }
}

// --- Log System com Memória e Animação ---
function logEvent(msg, type) {
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    
    let formattedMsg = msg.replace(/(eliminou|eliminado)/gi, '<span style="color:gold; font-weight:bold;">$1</span>');
    div.innerHTML = formattedMsg;
    
    // Lógica de Divisão de Logs com Atraso
    if (type === 'relic' || msg.includes('Relíquia') || msg.includes('relíquia')) {
        // LOG ESQUERDO (RELÍQUIA) - ATRASO DE 4 SEGUNDOS
        setTimeout(() => {
            if (els.logLeft) {
                els.logLeft.appendChild(div);
                // Remove após 6 segundos (fica um pouco mais de tempo na tela)
                setTimeout(() => {
                    div.style.opacity = '0'; 
                    setTimeout(() => div.remove(), 1000); 
                }, 6000);
                
                // Adiciona ao histórico apenas quando aparece
                state.logHistory.push(formattedMsg);
                updateLogSidebar();
            }
        }, 4000); // <--- Atraso solicitado
    } else {
        // LOG DIREITO (GERAL) - IMEDIATO
        if (els.logRight) els.logRight.appendChild(div);
        
        setTimeout(() => {
            div.style.opacity = '0'; 
            setTimeout(() => div.remove(), 1000); 
        }, 5000);

        state.logHistory.push(formattedMsg);
        updateLogSidebar();
    }
}

function updateTimers() {
    const now = new Date();
    
    if (state.status === 'closed' && state.nextOpenAt) {
        const diff = Math.floor((state.nextOpenAt - now) / 1000);
        if (diff > 0) {
            const h = Math.floor(diff / 3600).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            els.timer.textContent = `${h}:${m}:${s}`;
        } else {
            els.timer.textContent = "00:00:00";
            setTimeout(checkMenuStatus, 1000);
        }
        return;
    }

    if (state.status === 'registering' && state.registrationEndsAt) {
        const diff = Math.floor((state.registrationEndsAt - now) / 1000);
        if (diff > 0) {
            const m = Math.floor(diff / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            els.timer.textContent = `${m}:${s}`;
        } else {
            els.timer.textContent = "Iniciando...";
        }
    }

    if ((state.status === 'active' || els.game.style.display === 'flex') && state.collapseStartAt) {
        const diff = Math.floor((state.collapseStartAt - now) / 1000);
        
        if (diff > 0) {
            const m = Math.floor(diff / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            els.collapseTimer.textContent = `Colapso em: ${m}:${s}`;
            els.collapseTimer.style.color = "white";
            els.collapseTimer.classList.remove('pulse-text');
            
            if(els.collapseOverlay) els.collapseOverlay.style.display = 'none';
        } else {
            els.collapseTimer.textContent = "COLAPSO IMINENTE!";
            els.collapseTimer.style.color = "silver";
            els.collapseTimer.classList.add('pulse-text');
            
            if(els.collapseOverlay) els.collapseOverlay.style.display = 'block';
        }
    }
}

// --- Heartbeat e Sincronização ---
let heartbeatInterval = null;
function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
        const { data, error } = await supabase.rpc('sync_ruins_state', {
            p_session_id: state.sessionId,
            p_last_event_ts: state.lastEventTs
        });

        if (error) return;

        // Atualiza Lista de Participantes na Sidebar
        if (data.participants_summary) {
            updateParticipantsSidebar(data.participants_summary, data.relic_holder, data.relic_room_id);
        }

        if (state.myPlayer) {
            if (data.ap !== undefined) state.myPlayer.ap = data.ap;
            if (data.hp !== undefined) state.myPlayer.hp = data.hp;
            updateHUD();
        }

        if (data.destroyed_count !== undefined) {
            state.destroyedCount = data.destroyed_count;
        }

        if (data.status === 'finished') {
            if (data.winner) {
                endGame({ win: true, message: "VITÓRIA! Você é o último sobrevivente.\n+50 Moedas Rúnicas!" });
            } else {
                endGame({ win: false, message: "A partida terminou. Não restaram sobreviventes." });
            }
            return;
        }
        
        if (data.is_dead && !ignoreHeartbeatDeath && !state.isSpectating) {
            if (data.killed_by_collapse) {
                endGame({ win: false, message: "Você foi eliminado pelo colapso." });
                return;
            } else {
                endGame({ win: false, message: "Você foi eliminado em combate." });
                return;
            }
        }

        if (data.events && data.events.length > 0) {
            data.events.forEach(evt => {
                if (evt.msg.includes(`atacou ${state.myPlayer.name}`)) {
                    logEvent("Você foi atacado!", "kill");
                    playSound('loss'); 
                }
                logEvent(evt.msg, evt.type);
                state.lastEventTs = Math.max(state.lastEventTs, evt.t);
            });
        }
        
        if (data.relic_holder) {
            state.relicHolderId = data.relic_holder;
            els.relicStatus.textContent = "Relíquia: TOMADA!";
            els.relicStatus.style.color = "silver";
            
            // Log da sala do portador (Novo)
            if (data.relic_room_id) {
                logEvent(`O Portador da Relíquia está na Sala ${data.relic_room_id}`, "relic");
            }
        } else {
            state.relicHolderId = null;
            els.relicStatus.textContent = "Relíquia: Livre";
            els.relicStatus.style.color = "gold";
            // No log about location
        }

    }, POLLING_INTERVAL);
}

// --- Fim de Jogo ---
function endGame(data) {
    const isGameOver = data.message.includes("terminou") || data.message.includes("VITÓRIA");

    if (state.isSpectating && !isGameOver) return;

    if (data.win) playSound('win');
    else playSound('loss');

    document.getElementById('resultTitle').textContent = data.win ? "VITÓRIA!" : "FIM DE JOGO";
    document.getElementById('resultTitle').style.color = data.win ? "gold" : "red";
    document.getElementById('resultMessage').textContent = data.message;
    
    const modalContent = document.querySelector('#resultModal .modal-content');
    
    const oldBtns = modalContent.querySelectorAll('.action-btn');
    oldBtns.forEach(b => b.remove());

    const btnBack = document.createElement('button');
    btnBack.className = 'action-btn';
    btnBack.textContent = 'Sair da Masmorra';
    btnBack.onclick = () => window.location.reload();
    modalContent.appendChild(btnBack);

    if (!data.win && !isGameOver) {
        const btnSpectate = document.createElement('button');
        btnSpectate.className = 'action-btn';
        btnSpectate.style.marginTop = '10px';
        btnSpectate.style.backgroundColor = '#333';
        btnSpectate.style.border = '1px solid #555';
        btnSpectate.textContent = 'Continuar Vendo';
        btnSpectate.onclick = () => {
            state.isSpectating = true;
            document.getElementById('resultModal').style.display = 'none';
            els.navMsg.textContent = "Modo Espectador";
            els.actionButtons.style.display = 'none';
            els.probeGrid.style.display = 'none';
        };
        modalContent.appendChild(btnSpectate);
    } else {
        if(heartbeatInterval) clearInterval(heartbeatInterval);
        if(state.cooldownInterval) clearInterval(state.cooldownInterval);
    }

    document.getElementById('resultModal').style.display = 'flex';
}