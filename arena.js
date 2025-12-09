document.addEventListener("DOMContentLoaded", async () => {
    // =======================================================================
    // 1. CONFIGURAÇÃO E VARIÁVEIS GLOBAIS
    // =======================================================================
    const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let userId = null;

    // --- HELPER DE AUTH OTIMISTA (ZERO EGRESS) ---
    function getLocalUserId() {
        // 1. Tenta pegar do seu cache personalizado (criado no script.js)
        try {
            const cached = localStorage.getItem('player_data_cache');
            if (cached) {
                const parsed = JSON.parse(cached);
                // Verifica se não expirou
                if (parsed && parsed.data && parsed.data.id && parsed.expires > Date.now()) {
                    return parsed.data.id;
                }
            }
        } catch (e) {}

        // 2. Tenta pegar do cache interno do Supabase (sem chamada de rede)
        try {
            // Loop simples para achar a chave do supabase no localStorage se o nome variar
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                    const sessionStr = localStorage.getItem(k);
                    const session = JSON.parse(sessionStr);
                    if (session && session.user && session.user.id) {
                        return session.user.id;
                    }
                }
            }
        } catch (e) {}

        return null;
    }

    // Estado da Batalha
    let currentBattleId = null;
    let turnTimerInterval = null;
    let turnTimeLeft = 10;
    let isMyTurn = false;
    let battleStateCache = null;

    // Elementos DOM Principais
    const loadingOverlay = document.getElementById("loading-overlay");
    const challengeBtn = document.getElementById("challengeBtn");
    const arenaAttemptsLeftSpan = document.getElementById("arenaAttemptsLeft");
    const skipBtn = document.getElementById("skip");

    // Modais
    const pvpCombatModal = document.getElementById("pvpCombatModal");
    const confirmModal = document.getElementById("confirmModal");
    const confirmMessage = document.getElementById("confirmMessage");
    const confirmTitle = document.getElementById("confirmTitle");
    let confirmActionBtn = document.getElementById("confirmActionBtn");

    const rankingModal = document.getElementById("rankingModal");
    const openRankingBtn = document.getElementById("openRankingBtn");
    const closeRankingBtn = document.getElementById("closeRankingBtn");
    const rankingList = document.getElementById("rankingList");
    const seasonInfoSpan = document.getElementById("seasonInfo");

    const rankingListPast = document.getElementById("rankingListPast");
    const rankingHistoryList = document.getElementById("rankingHistoryList");
    const seasonInfoContainer = document.getElementById("seasonInfoContainer");
    const seasonPastInfoSpan = document.getElementById("seasonPastInfo");

    // Elementos da Arena (Visual)
    const pvpCountdown = document.getElementById("pvpCountdown");
    const challengerSide = document.getElementById("challengerSide");
    const defenderSide = document.getElementById("defenderSide");
    const challengerName = document.getElementById("challengerName");
    const defenderName = document.getElementById("defenderName");
    const challengerAvatar = document.getElementById("challengerAvatar");
    const defenderAvatar = document.getElementById("defenderAvatar");
    const challengerHpFill = document.getElementById("challengerHpFill");
    const defenderHpFill = document.getElementById("defenderHpFill");
    const challengerHpText = document.getElementById("challengerHpText");
    const defenderHpText = document.getElementById("defenderHpText");
    
    // Loadout de Poções
    const potionSelectModal = document.getElementById("potionSelectModal");
    const closePotionModalBtn = document.getElementById("closePotionModal");
    const potionListGrid = document.getElementById("potionListGrid");
    const potionSlots = document.querySelectorAll(".potion-slot");

    // Mapa de IDs para Nomes de Arquivo
    const POTION_MAP = {
        43: "pocao_de_cura_r", 44: "pocao_de_cura_sr",
        45: "pocao_de_furia_r", 46: "pocao_de_furia_sr",
        47: "pocao_de_destreza_r", 48: "pocao_de_destreza_sr",
        49: "pocao_de_ataque_r", 50: "pocao_de_ataque_sr"
    };

    // =======================================================================
    // 2. SISTEMA DE ÁUDIO
    // =======================================================================
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffers = {};
    let backgroundMusic = null;
    let musicStarted = false;

    const audioFiles = {
        normal: "https://aden-rpg.pages.dev/assets/normal_hit.mp3",
        critical: "https://aden-rpg.pages.dev/assets/critical_hit.mp3",
        evade: "https://aden-rpg.pages.dev/assets/evade.mp3",
        streak3: "https://aden-rpg.pages.dev/assets/killingspree.mp3",
        streak4: "https://aden-rpg.pages.dev/assets/implacavel.mp3",
        streak5: "https://aden-rpg.pages.dev/assets/dominando.mp3",
        background: "https://aden-rpg.pages.dev/assets/arena.mp3",
        heal: "https://aden-rpg.pages.dev/assets/pot_cura.mp3",
        dex: "https://aden-rpg.pages.dev/assets/pot_dex.mp3",
        fury: "https://aden-rpg.pages.dev/assets/pot_furia.mp3",
        atk: "https://aden-rpg.pages.dev/assets/pot_atk.mp3",
        win: "https://aden-rpg.pages.dev/assets/win.mp3", 
        loss: "https://aden-rpg.pages.dev/assets/loss.mp3"
    };

    async function preload(name) {
        try {
            const url = audioFiles[name];
            if (!url) return;
            const res = await fetch(url);
            const ab = await res.arrayBuffer();
            audioBuffers[name] = await new Promise((resolve, reject) => {
                audioContext.decodeAudioData(ab, resolve, reject);
            });
        } catch (e) {
            audioBuffers[name] = null;
        }
    }
    Object.keys(audioFiles).forEach(key => preload(key));

    function playSound(name, opts = {}) {
        const vol = typeof opts.volume === 'number' ? opts.volume : 1;
        const buf = audioBuffers[name];
        if (buf && audioContext.state !== 'closed') {
            try {
                const source = audioContext.createBufferSource();
                source.buffer = buf;
                const gain = audioContext.createGain();
                gain.gain.value = vol;
                source.connect(gain).connect(audioContext.destination);
                source.start(0);
                return;
            } catch (err) {}
        }
        try {
            const a = new Audio(audioFiles[name] || audioFiles.normal);
            a.volume = Math.min(1, Math.max(0, vol));
            a.play().catch(e => {});
        } catch (e) {}
    }

    let sfxUnlocked = false;
    async function unlockSfx() {
        if (sfxUnlocked) return;
        sfxUnlocked = true;
        if (audioContext.state === 'suspended') {
            try { await audioContext.resume(); } catch(e){}
        }
    }

    function startBackgroundMusic() {
        if (musicStarted) return;
        if (!backgroundMusic) {
            backgroundMusic = new Audio(audioFiles.background);
            backgroundMusic.volume = 0.015;
            backgroundMusic.loop = true;
        }
        backgroundMusic.play().then(() => { musicStarted = true; }).catch(err => { musicStarted = false; });
    }

    function addCapturedListener(target, evt, handler, opts = {}) {
        try { target.addEventListener(evt, handler, Object.assign({ capture: true, passive: true, once: false }, opts)); } catch (e) {}
    }

    function resumeAudioContext() {
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(e => {});
        }
    }

    const primaryEvents = ["click", "pointerdown", "touchstart", "mousedown", "keydown"];
    for (const ev of primaryEvents) {
        addCapturedListener(window, ev, () => {
            resumeAudioContext();
            startBackgroundMusic();
            unlockSfx();
        }, { once: true });
    }

    // =======================================================================
    // 3. UTILITÁRIOS E CACHE
    // =======================================================================
    function showLoading() { if (loadingOverlay) loadingOverlay.style.display = "flex"; }
    function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = "none"; }
    const esc = (s) => (s === 0 || s) ? String(s).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])) : "";

    function showModalAlert(message, title = "Aviso") {
        if (!confirmModal) { alert(message); return; }
        
        if (confirmTitle) confirmTitle.textContent = title;
        if (confirmMessage) confirmMessage.innerHTML = message;
        
        const newBtn = confirmActionBtn.cloneNode(true);
        confirmActionBtn.parentNode.replaceChild(newBtn, confirmActionBtn);
        confirmActionBtn = newBtn;
        
        confirmActionBtn.textContent = "Ok";
        confirmActionBtn.onclick = () => { confirmModal.style.display = 'none'; };
        
        confirmModal.style.display = 'flex';
    }

    const CACHE_TTL_24H = 1440;
    function setCache(key, data, ttlMinutes = CACHE_TTL_24H) {
        try { localStorage.setItem(key, JSON.stringify({ expires: Date.now() + ttlMinutes * 60000, data })); } catch {}
    }
    function getCache(key) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            if (Date.now() > parsed.expires) { localStorage.removeItem(key); return null; }
            return parsed.data;
        } catch { return null; }
    }

    async function getCachedPlayerInfo(playerId) {
        if (!playerId) return null;

        // OTIMIZAÇÃO: 1. Tenta pegar do cache global gerado pelo script.js (player_data_cache)
        // Isso evita chamada ao DB se o usuário veio do menu principal
        const globalCache = getCache('player_data_cache');
        if (globalCache && globalCache.id === playerId) {
            return globalCache;
        }

        // 2. Cache Local da Arena
        const key = `player_${playerId}`;
        let cached = getCache(key);
        if (cached) return cached;

        // 3. Busca no Banco
        const { data } = await supabase.from('players')
            .select('id, name, avatar_url, guild_id, ranking_points')
            .eq('id', playerId).single();
        if (data) setCache(key, data, CACHE_TTL_24H);
        return data;
    }

    function cacheOpponent(opponent) {
        if (opponent?.id) setCache('last_opponent', opponent, 5);
    }

    function normalizeRpcResult(data) {
        try {
            if (!data) return null;
            if (Array.isArray(data)) {
                const first = data[0];
                if (first && typeof first === 'object') {
                    const keys = Object.keys(first);
                    if (keys.length === 1 && typeof first[keys[0]] === 'object') return first[keys[0]];
                    return first;
                }
            }
            if (typeof data === 'string') { try { return normalizeRpcResult(JSON.parse(data)); } catch {} }
            return data;
        } catch (e) { return null; }
    }

    async function updateAttemptsUI() {
        if (!userId) return;
        try {
            const { data } = await supabase.from('players').select('arena_attempts_left').eq('id', userId).single();
            const attempts = data?.arena_attempts_left ?? 0;
            if (arenaAttemptsLeftSpan) arenaAttemptsLeftSpan.textContent = attempts;
            
            if (challengeBtn) {
                if (attempts <= 0) {
                    challengeBtn.disabled = true;
                    challengeBtn.textContent = "Volte às 21h00";
                    challengeBtn.style.filter = "grayscale(1)";
                    challengeBtn.style.cursor = "not-allowed";
                } else {
                    challengeBtn.disabled = false;
                    challengeBtn.textContent = "Desafiar";
                    challengeBtn.style.filter = "none";
                    challengeBtn.style.cursor = "pointer";
                }
            }
        } catch { if (arenaAttemptsLeftSpan) arenaAttemptsLeftSpan.textContent = "Erro"; }
    }

    const STREAK_KEY = 'arena_win_streak';
    const STREAK_DATE_KEY = 'arena_win_streak_date'; 
    function getTodayUTCDateString() {
        const now = new Date();
        return now.getUTCFullYear() + '-' + String(now.getUTCMonth()+1).padStart(2,'0') + '-' + String(now.getUTCDate()).padStart(2,'0');
    }
    function loadStreak() {
        try {
            const raw = localStorage.getItem(STREAK_KEY);
            const dateRaw = localStorage.getItem(STREAK_DATE_KEY);
            const today = getTodayUTCDateString();
            if (!dateRaw || dateRaw !== today) {
                localStorage.setItem(STREAK_KEY, "0");
                localStorage.setItem(STREAK_DATE_KEY, today);
                return 0;
            }
            return parseInt(raw, 10) || 0;
        } catch (e) { return 0; }
    }
    function saveStreak(n) {
        try {
            const today = getTodayUTCDateString();
            localStorage.setItem(STREAK_KEY, String(Math.max(0, Math.floor(n))));
            localStorage.setItem(STREAK_DATE_KEY, today);
        } catch (e) {}
    }
    let currentStreak = loadStreak();
    function ensureStreakDate() {
        try {
            const dateRaw = localStorage.getItem(STREAK_DATE_KEY);
            const today = getTodayUTCDateString();
            if (!dateRaw || dateRaw !== today) { currentStreak = 0; saveStreak(0); }
        } catch(e){}
    }
    ensureStreakDate();

    // =======================================================================
    // 4. LOADOUT E POÇÕES
    // =======================================================================
    async function loadArenaLoadout() {
        if (!userId) return;
        const { data, error } = await supabase.rpc('get_my_arena_loadout');
        
        document.querySelectorAll('.potion-slot').forEach(el => {
            el.innerHTML = '<span style="display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; font-size:2em; color:#555; pointer-events:none;">+</span>';
            el.dataset.itemId = "";
            el.style.border = "1px dashed #555";
        });

        if (error) return console.error("Erro loadout:", error);

        if (data && Array.isArray(data)) {
            data.forEach(item => {
                const typeMap = item.slot_type.toLowerCase() === 'attack' ? 'atk' : 'def';
                const slotEl = document.getElementById(`slot-${typeMap}-${item.slot_index}`);
                if (slotEl) {
                    slotEl.innerHTML = `<img src="${item.item_image}" style="width:100%; height:100%; object-fit:contain; border-radius:4px;">`;
                    slotEl.dataset.itemId = item.item_id;
                    slotEl.style.border = "1px solid gold";
                }
            });
        }
    }

    potionSlots.forEach(slot => {
        slot.addEventListener('click', async () => {
            if (!potionSelectModal) return;
            potionSelectModal.style.display = 'flex';
            potionListGrid.innerHTML = '<p style="color:#fff;">Carregando...</p>';
            
            const allowedIds = [43, 44, 45, 46, 47, 48, 49, 50];
            const { data: items, error } = await supabase
                .from('inventory_items')
                .select('*, items(*)')
                .in('item_id', allowedIds)
                .eq('player_id', userId)
                .gt('quantity', 0);

            potionListGrid.innerHTML = "";
            
            const unequipBtn = document.createElement('div');
            unequipBtn.className = "inventory-item"; 
            unequipBtn.style.border = "1px solid red";
            unequipBtn.innerHTML = '<img src="https://aden-rpg.pages.dev/assets/expulsar.webp" alt="Remover" style="width: 50px; height: 50px; margin-bottom: 5px;"><small>Remover</small>';
            unequipBtn.onclick = async () => {
                showLoading();
                await supabase.rpc('unequip_arena_potion', { p_slot_type: slot.dataset.type.toUpperCase(), p_slot_index: parseInt(slot.dataset.index) });
                hideLoading();
                potionSelectModal.style.display = 'none';
                await loadArenaLoadout();
            };
            potionListGrid.appendChild(unequipBtn);

            if (!items || items.length === 0) {
                const msg = document.createElement('p');
                msg.textContent = "Sem poções de batalha.";
                msg.style.color = "#ccc";
                potionListGrid.appendChild(msg);
                return;
            }

            items.forEach(inv => {
                const div = document.createElement('div');
                div.className = "inventory-item";
                div.style.cursor = "pointer";
                div.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/itens/${inv.items.name}.webp" style="width:50px; height:50px;">
                    <span class="item-quantity">${inv.quantity}</span>
                    <div style="font-size:0.7em; margin-top:5px; color:#fff;">${inv.items.display_name}</div>
                `;
                div.onclick = async () => {
                    showLoading();
                    const { data: res, error: rpcErr } = await supabase.rpc('equip_arena_potion', { 
                        p_slot_type: slot.dataset.type.toUpperCase(), 
                        p_slot_index: parseInt(slot.dataset.index), 
                        p_item_id: inv.item_id 
                    });
                    hideLoading();
                    const result = normalizeRpcResult(res);
                    if (rpcErr || (result && result.success === false)) {
                        showModalAlert(result?.message || "Erro ao equipar poção.");
                    } else {
                        potionSelectModal.style.display = 'none';
                        await loadArenaLoadout();
                    }
                };
                potionListGrid.appendChild(div);
            });
        });
    });
    if (closePotionModalBtn) closePotionModalBtn.addEventListener('click', () => potionSelectModal.style.display = 'none');

    // =======================================================================
    // 5. LÓGICA DE COMBATE
    // =======================================================================

    const style = document.createElement('style');
    style.innerHTML = `
        #attackBtnContainer:active { transform: scale(0.95); }
        .attack-anim { animation: attack-pulse 0.2s ease-in-out; }
        @keyframes attack-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
        .battle-potion-slot { transition: transform 0.2s; border: 1px solid #777; background: #000; border-radius: 4px; overflow: hidden; width: 40px; height: 40px; position: relative; }
        .potion-clickable:hover { transform: scale(1.1); border-color: gold; cursor: pointer; }
        .potion-disabled { filter: grayscale(1); cursor: not-allowed; opacity: 0.5; }
        @keyframes floatUpPotion { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.5); } 20% { opacity: 1; transform: translate(-50%, -20px) scale(1.2); } 100% { opacity: 0; transform: translate(-50%, -60px) scale(1); } }
        @keyframes blinkPotion { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.9); } }
    `;
    document.head.appendChild(style);

    const btnContainer = document.getElementById("attackBtnContainer");
    if (btnContainer) {
        const newBtn = btnContainer.cloneNode(true);
        btnContainer.parentNode.replaceChild(newBtn, btnContainer);

        newBtn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (isMyTurn) await performAction('ATTACK');
        });
        
        newBtn.style.cursor = "pointer";
        newBtn.style.pointerEvents = "auto";
    }

    if (skipBtn) {
        skipBtn.addEventListener("click", (e) => {
            if (skipBtn.disabled || skipBtn.style.opacity === "0.5") return;
            
            if (confirmTitle) confirmTitle.textContent = "Pular Combate?";
            if (confirmMessage) confirmMessage.innerHTML = "O sistema irá simular o restante da luta instantaneamente.<br>Isso não garante vitória!";
            
            const newBtn = confirmActionBtn.cloneNode(true);
            confirmActionBtn.parentNode.replaceChild(newBtn, confirmActionBtn); 
            confirmActionBtn = newBtn;
            
            confirmActionBtn.textContent = "Sim, Pular";
            confirmActionBtn.onclick = async () => {
                confirmModal.style.display = 'none';
                showLoading();
                try {
                    const { data, error } = await supabase.rpc('skip_arena_battle', { p_battle_id: currentBattleId });
                    const res = normalizeRpcResult(data);
                    
                    if (error || !res?.success) throw new Error(res?.message || "Erro ao pular.");
                    
                    updatePvpHpBar(challengerHpFill, challengerHpText, res.win ? 1 : 0, 100);
                    updatePvpHpBar(defenderHpFill, defenderHpText, res.win ? 0 : 1, 100);
                    
                    endBattle(res.win, res);
                } catch (e) {
                    showModalAlert(e.message || "Erro ao pular batalha.");
                    isMyTurn = true;
                    startPlayerTurn();
                } finally {
                    hideLoading();
                }
            };
            
            confirmModal.style.display = 'flex';
        });
    }
    
    async function handleChallengeClick() {
        if (!challengeBtn || challengeBtn.disabled) return;
        if (arenaAttemptsLeftSpan.textContent === '0') return;

        challengeBtn.disabled = true;
        showLoading();
        
        try {
            const { data: findData, error: findError } = await supabase.rpc('find_arena_opponent');
            const findResult = normalizeRpcResult(findData);
            
            if (findError || !findResult?.success) {
                challengeBtn.disabled = false;
                return showModalAlert(findResult?.message || "Nenhum oponente encontrado.");
            }
            
            const opponent = findResult.opponent; 
            cacheOpponent(opponent);

            const { data: initData, error: initError } = await supabase.rpc('init_arena_battle_manual', { p_opponent_id: opponent.id });
            const initResult = normalizeRpcResult(initData);
            
            if (initError || !initResult?.success) {
                challengeBtn.disabled = false;
                return showModalAlert(initResult?.message || "Falha ao iniciar batalha.");
            }

            currentBattleId = initResult.battle_id;
            battleStateCache = initResult.state;
            
            const myInfo = await getCachedPlayerInfo(userId);
            
            setupBattleUI(battleStateCache, myInfo, opponent);
            
            hideLoading();

            if (pvpCountdown) {
                pvpCountdown.style.display = 'block';
                for (let i = 3; i > 0; i--) {
                    pvpCountdown.textContent = `A batalha começará em ${i}...`;
                    await new Promise(r => setTimeout(r, 1000));
                }
                pvpCountdown.style.display = 'none';
            }

            startPlayerTurn();

        } catch (e) {
            console.error("Erro no desafio:", e);
            challengeBtn.disabled = false;
            showModalAlert("Erro inesperado: " + (e?.message || e));
            hideLoading();
        } finally {
            await updateAttemptsUI();
        }
    }

    function setupBattleUI(state, me, opp) {
        pvpCombatModal.style.display = "flex";
        
        document.getElementById("turnTimerContainer").style.display = "block";
        document.getElementById("combatControls").style.display = "flex";
        
        const defAvatar = 'https://aden-rpg.pages.dev/avatar01.webp';
        challengerName.textContent = me?.name || "Você";
        challengerAvatar.src = me?.avatar_url || defAvatar;
        
        defenderName.textContent = opp?.name || "Oponente";
        defenderAvatar.src = opp?.avatar_url || defAvatar;

        updateBattleStateUI(state);
        
        // Renderiza Inicial
        renderBattlePotions(challengerSide, state.attacker_potions, 'left', true); 
        renderBattlePotions(defenderSide, state.defender_potions, 'right', false); 
        
        if (skipBtn) {
            skipBtn.disabled = true;
            skipBtn.style.opacity = "0.5";
            skipBtn.style.cursor = "not-allowed";
        }
    }

    function startPlayerTurn() {
        if (!currentBattleId) return;
        isMyTurn = true;
        turnTimeLeft = 10; 
        
        if (skipBtn) {
            const t = battleStateCache ? battleStateCache.turn_count : 1;
            if (t >= 0) {
                skipBtn.disabled = false;
                skipBtn.style.opacity = "1";
                skipBtn.style.cursor = "pointer";
            } else {
                skipBtn.disabled = true;
                skipBtn.style.opacity = "0.5";
                skipBtn.style.cursor = "not-allowed";
            }
        }

        const timerContainer = document.getElementById("turnTimerContainer");
        const attackBtn = document.getElementById("attackBtnContainer");
        
        if (timerContainer) timerContainer.style.opacity = "1";
        if (attackBtn) {
            attackBtn.style.filter = "none";
            attackBtn.style.opacity = "1";
            attackBtn.style.pointerEvents = "auto";
            attackBtn.classList.remove("attack-anim");
        }
        updateTimerUI();
        togglePlayerPotions(true);

        clearInterval(turnTimerInterval);
        turnTimerInterval = setInterval(() => {
            turnTimeLeft--;
            updateTimerUI();
            if (turnTimeLeft <= 0) {
                performAction('ATTACK'); 
            }
        }, 1000);
    }

    function updateTimerUI() {
        const el = document.getElementById("turnTimerValue");
        const circle = document.getElementById("turnTimerCircle");
        if(el) el.textContent = turnTimeLeft;
        if(circle) {
            circle.style.borderColor = (turnTimeLeft <= 3) ? "red" : "#FFC107";
        }
    }

    async function performAction(type, itemId = null) {
        if (!isMyTurn) return;
        
        if (type === 'ATTACK') {
            clearInterval(turnTimerInterval);
            isMyTurn = false;
            
            const attackBtn = document.getElementById("attackBtnContainer");
            if (attackBtn) {
                attackBtn.classList.add("attack-anim");
                attackBtn.style.pointerEvents = "none";
                attackBtn.style.filter = "grayscale(1)";
                attackBtn.style.opacity = "0.5"; 
            }
            if(skipBtn) skipBtn.disabled = true; 
            document.getElementById("turnTimerContainer").style.opacity = "0.3";
            togglePlayerPotions(false);
            
            animateActorMove(challengerSide);
        }

        try {
            var preState = JSON.parse(JSON.stringify(battleStateCache));

            const { data, error } = await supabase.rpc('process_arena_action', {
                p_battle_id: currentBattleId,
                p_action_type: type,
                p_item_id: itemId
            });

            const res = normalizeRpcResult(data);
            if (error || !res?.success) throw new Error("Erro na ação.");

            // CASO 1: JOGADOR USOU POÇÃO
            if (type === 'POTION') {
                updateBattleStateUI(res.state);
                battleStateCache = res.state;
                flashPotionIcon(itemId, challengerSide); 
                
                // [CORREÇÃO] Sons distintos para cada tipo de poção
                if (itemId === 43 || itemId === 44) playSound('heal');
                else if (itemId === 45 || itemId === 46) playSound('fury'); 
                else if (itemId === 47 || itemId === 48) playSound('dex'); // Destreza
                else if (itemId === 49 || itemId === 50) playSound('atk'); // Ataque
                else playSound('fury'); // Fallback

                renderBattlePotions(challengerSide, res.state.attacker_potions, 'left', true);
                return; 
            }

            // CASO 2: JOGADOR ATACOU
            if (type === 'ATTACK') {
                const newState = res.state || {}; 
                const dmgDealt = Math.max(0, preState.defender_hp - (res.finished && res.win ? 0 : newState.defender_hp));
                
                await new Promise(r => setTimeout(r, 400));
                
                if (dmgDealt > 0 || (res.finished && res.win)) {
                    displayDamageNumber(dmgDealt, false, false, defenderSide);
                    updatePvpHpBar(defenderHpFill, defenderHpText, (res.finished && res.win ? 0 : newState.defender_hp), preState.defender_max_hp);
                }

                if (res.finished && res.win) {
                    endBattle(true, res);
                    return;
                }

                // --- TURNO INIMIGO ---
                const attackerTookDamage = (!res.finished && newState.attacker_hp < preState.attacker_hp) || (res.finished && !res.win);

                if (attackerTookDamage) {
                    await new Promise(r => setTimeout(r, 600));

                    let enemyUsedItem = null;
                    const prePots = preState.defender_potions || [];
                    const newPots = newState.defender_potions || [];
                    
                    for (let i = 0; i < prePots.length; i++) {
                        const oldQ = prePots[i].qty;
                        const newQ = newPots[i] ? newPots[i].qty : oldQ;
                        if (newQ < oldQ) { enemyUsedItem = prePots[i].item_id; break; }
                    }

                    if (enemyUsedItem) {
                        renderBattlePotions(defenderSide, newState.defender_potions, 'right', false);
                        flashPotionIcon(enemyUsedItem, defenderSide);
                        // Som simplificado para inimigo (Cura ou Buff genérico)
                        playSound(enemyUsedItem < 45 ? 'heal' : 'fury');
                        updatePvpHpBar(defenderHpFill, defenderHpText, newState.defender_hp, preState.defender_max_hp);
                        await new Promise(r => setTimeout(r, 800));
                    }

                    animateActorMove(defenderSide);
                    await new Promise(r => setTimeout(r, 300));

                    const currentAttHp = res.finished && !res.win ? 0 : newState.attacker_hp;
                    const dmgReceived = Math.max(0, preState.attacker_hp - currentAttHp);
                    
                    displayDamageNumber(dmgReceived, false, false, challengerSide);
                    updatePvpHpBar(challengerHpFill, challengerHpText, currentAttHp, preState.attacker_max_hp);
                }

                if (res.finished) {
                    await new Promise(r => setTimeout(r, 500));
                    endBattle(res.win, res); 
                } else {
                    updateBattleStateUI(newState);
                    battleStateCache = newState;
                    startPlayerTurn();
                }
            }

        } catch (e) {
            console.error(e);
            challengeBtn.disabled = false;
            if (type === 'ATTACK') {
                 isMyTurn = true;
                 startPlayerTurn();
            }
        }
    }

    // --- Helpers Visuais ---
    function updateBattleStateUI(state) {
        if (!state) return;
        updatePvpHpBar(challengerHpFill, challengerHpText, state.attacker_hp, state.attacker_max_hp);
        updatePvpHpBar(defenderHpFill, defenderHpText, state.defender_hp, state.defender_max_hp);
        renderActiveBuffs(challengerSide, state.attacker_buffs, state.turn_count);
        renderActiveBuffs(defenderSide, state.defender_buffs, state.turn_count);
        
        // [CORREÇÃO] Redesenhar as poções do jogador para atualizar status de Cooldown (desbloquear slots após turno)
        if (state.attacker_potions) {
             renderBattlePotions(challengerSide, state.attacker_potions, 'left', true);
        }
    }

    function renderActiveBuffs(container, buffs, currentTurn) {
        const old = container.querySelector('.active-buffs-row');
        if (old) old.remove();

        if (!buffs) return;

        const row = document.createElement('div');
        row.className = 'active-buffs-row';
        row.style.cssText = 'position:absolute; top: 115px; width: 100%; display: flex; justify-content: center; gap: 5px; z-index: 10; pointer-events: none;';

        Object.keys(buffs).forEach(key => {
            const buff = buffs[key];
            if (buff.ends_at_turn >= currentTurn) {
                const img = document.createElement('img');
                const itemName = POTION_MAP[buff.item_id] || `item_${buff.item_id}`;
                img.src = `https://aden-rpg.pages.dev/assets/itens/${itemName}.webp`;
                img.style.width = '35px';
                img.style.height = '35px';
                img.style.animation = 'blinkPotion 1s infinite alternate';
                img.title = key;
                row.appendChild(img);
            }
        });

        if (row.children.length > 0) container.appendChild(row);
    }

    function renderBattlePotions(container, potions, side, interactive) {
        const old = container.querySelector('.battle-potions-container');
        if (old) old.remove();

        if (!potions || !potions.length) return;

        const ct = document.createElement('div');
        ct.className = 'battle-potions-container';
        ct.style.position = "absolute";
        ct.style.top = "60px";
        ct.style.display = "flex";
        ct.style.flexDirection = "column";
        ct.style.gap = "8px";
        ct.style.zIndex = "20";
        ct.style.background = "rgba(0,0,0,0.5)";
        ct.style.padding = "4px";
        ct.style.borderRadius = "6px";
        if(side === 'left') ct.style.left = "-25px"; else ct.style.right = "-25px";

        potions.forEach(p => {
            const slot = document.createElement('div');
            slot.className = 'battle-potion-slot';
            // Só é clicável se tiver quantidade, cooldown 0 e for turno do jogador (interactive flag)
            if (interactive && p.qty > 0 && p.cd <= 0) {
                slot.classList.add('potion-clickable');
                slot.onclick = (e) => { e.stopPropagation(); performAction('POTION', p.item_id); };
            } else if (interactive) {
                slot.classList.add('potion-disabled');
            } else {
                 slot.style.filter = "grayscale(1)";
                 slot.style.opacity = "0.7";
            }

            const name = POTION_MAP[p.item_id] || "pocao_de_cura_r";
            // Cooldown visual (cheio se > 0)
            const cdHeight = p.cd > 0 ? "100%" : "0%";
            
            slot.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/itens/${name}.webp" style="width:100%;height:100%;object-fit:contain;">
                <span style="position:absolute; bottom:0; right:0; font-size:0.7em; color:white; background:rgba(0,0,0,0.7); padding:1px;">${p.qty}</span>
                <div class="cooldown-overlay" style="position:absolute;bottom:0;left:0;width:100%;height:${cdHeight};background:rgba(0,0,0,0.7);"></div>
            `;
            ct.appendChild(slot);
        });
        container.appendChild(ct);
    }

    function togglePlayerPotions(enable) {
        const slots = document.querySelectorAll('.battle-potion-slot.potion-clickable');
        slots.forEach(s => {
            s.style.pointerEvents = enable ? 'auto' : 'none';
            s.style.filter = enable ? 'none' : 'grayscale(0.5)';
        });
    }

    function updatePvpHpBar(el, txt, cur, max) {
        if (!el) return;
        const pct = Math.max(0, Math.min(100, (cur / (max || 1)) * 100));
        el.style.width = pct + '%';
        if (txt) txt.textContent = `${Math.floor(cur).toLocaleString()} / ${max.toLocaleString()}`;
    }

    function displayDamageNumber(dmg, crit, evd, target) {
        if (!target) return;
        const el = document.createElement("div");
        if (evd) {
            el.textContent = "Desviou";
            el.className = "evade-text";
            playSound('evade', { volume: 0.3 });
        } else {
            const val = typeof dmg === 'number' ? dmg.toLocaleString() : dmg;
            el.textContent = val;
            el.className = crit ? "crit-damage-number" : "damage-number";
            playSound(crit ? 'critical' : 'normal', { volume: crit ? 0.1 : 0.5 });
        }
        target.appendChild(el);
        el.addEventListener("animationend", () => el.remove());
        setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
    }

    function flashPotionIcon(itemId, sideElement) {
        const img = document.createElement("img");
        const itemName = POTION_MAP[itemId] || `item_${itemId}`; 
        img.src = `https://aden-rpg.pages.dev/assets/itens/${itemName}.webp`; 
        img.style.position = "absolute";
        img.style.top = "50%";
        img.style.left = "50%";
        img.style.width = "50px";
        img.style.height = "50px";
        img.style.zIndex = "25";
        img.style.animation = "floatUpPotion 1s ease-out forwards";
        sideElement.appendChild(img);
        setTimeout(() => img.remove(), 1000);
    }
    
    function animateActorMove(element) {
        element.style.transition = "transform 0.1s";
        element.style.transform = "scale(1.1) translateY(-10px)";
        setTimeout(() => {
            element.style.transform = "scale(1) translateY(0)";
        }, 150);
    }

    async function endBattle(win, data) {
        clearInterval(turnTimerInterval);
        
        if (win) playSound('win');
        else playSound('loss');

        try {
            ensureStreakDate();
            if (win) {
                currentStreak++;
                saveStreak(currentStreak);
                if (currentStreak >= 5) playSound('streak5', { volume: 0.9 });
                else if (currentStreak === 4) playSound('streak4', { volume: 0.9 });
                else if (currentStreak === 3) playSound('streak3', { volume: 0.9 });
            } else {
                currentStreak = 0;
                saveStreak(0);
            }
        } catch(e){}

        let msg = win 
            ? `<strong style="color:#4CAF50; font-size: 1.2em;">Vitória!</strong><br>Você roubou ${data.points || 0} pontos.` 
            : `<strong style="color:#f44336; font-size: 1.2em;">Derrota!</strong><br>Você perdeu ${data.points || 0} pontos.`;

        let rewardsHTML = "";
        try {
            const r = data.rewards || {};
            let items = [];
            
            const st = "display:flex; align-items:center; background:rgba(0,0,0,0.4); padding:6px 10px; border-radius:5px; margin:2px; font-weight:bold; border: 1px solid #555;";
            const imS = "width:28px; height:28px; margin-right:8px; object-fit:contain;";
            
            const crystals = r.crystals || 0;
            const commonQty = r.item_41 || r.common || 0;
            const rareQty = r.item_42 || r.rare || 0;

            if(crystals > 0) items.push(`<div style="${st}"><img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="${imS}"> +${crystals}</div>`);
            if(commonQty > 0) items.push(`<div style="${st}"><img src="https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_comum.webp" style="${imS}"> +${commonQty}</div>`);
            if(rareQty > 0) items.push(`<div style="${st}"><img src="https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_avancado.webp" style="${imS}"> +${rareQty}</div>`);
            
            if(items.length) {
                rewardsHTML = `<div style="display:flex; flex-wrap:wrap; justify-content:center; margin-top:15px; gap:8px; border-top:1px dashed #555; padding-top:10px;">${items.join('')}</div>`;
            }
        } catch (err) {
            console.warn("Erro ao processar recompensas visuais:", err);
        }
            
        await new Promise(r => setTimeout(r, 1000));
        
        pvpCombatModal.style.display = "none";
        
        showModalAlert(msg + rewardsHTML, win ? "Vitória!" : "Fim de Combate");
        
        challengeBtn.disabled = false;
        currentBattleId = null;
        battleStateCache = null;
        isMyTurn = false;
        
        await loadArenaLoadout();
        await updateAttemptsUI();
    }

    // =======================================================================
    // 6. RANKING E SISTEMA
    // =======================================================================
    async function fetchAndRenderRanking() {
        showLoading();
        try {
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'block'; 
            let rankingData = getCache('arena_top_100_cache');
            if (!rankingData) { 
                const { data: rpcData, error: rpcError } = await supabase.rpc('get_arena_top_100');
                if (rpcError) rankingData = await fallbackFetchTopPlayers();
                else {
                    const result = normalizeRpcResult(rpcData);
                    if (result?.success && Array.isArray(result.ranking)) {
                        rankingData = result.ranking;
                        if (rankingData.length > 0) setCache('arena_top_100_cache', rankingData, 15);
                    } else rankingData = await fallbackFetchTopPlayers();
                }
            }
            renderRanking(rankingData || []); 
            if (rankingModal) rankingModal.style.display = 'flex';
        } catch (e) { showModalAlert("Erro ao carregar ranking."); } finally { hideLoading(); }
    }

    async function fallbackFetchTopPlayers() {
        try {
            const { data: players } = await supabase.from('players').select('id, name, avatar_url, avatar, ranking_points, guild_id').neq('is_banned', true).order('ranking_points', { ascending: false }).limit(100);
            if (!players || players.length === 0) return [];
            const guildIds = [...new Set(players.map(p => p.guild_id).filter(Boolean))];
            let guildsMap = {};
            if (guildIds.length) {
                const { data: guilds } = await supabase.from('guilds').select('id, name').in('id', guildIds);
                if (guilds) guildsMap = Object.fromEntries(guilds.map(g => [g.id, g.name]));
            }
            return players.map(p => ({
                name: p.name,
                avatar_url: p.avatar_url || p.avatar || 'https://aden-rpg.pages.dev/avatar01.webp',
                ranking_points: p.ranking_points,
                guild_name: p.guild_id ? (guildsMap[p.guild_id] || 'Sem Guilda') : 'Sem Guilda'
            }));
        } catch { return []; }
    }

    function renderRanking(data) {
        if (seasonInfoSpan) {
            const now = new Date();
            const month = now.toLocaleString('pt-BR', { month: 'long' });
            seasonInfoSpan.innerHTML = `<strong>Temporada<br> ${month[0].toUpperCase() + month.slice(1)} / ${now.getFullYear()}</strong>`;
        }
        if (!rankingList) return;
        rankingList.innerHTML = "";
        if (!data || !data.length) { rankingList.innerHTML = "<li style='text-align:center; padding: 20px; color: #aaa;'>Nenhum jogador classificado ainda.</li>"; return; }
        const defaultAvatar = 'https://aden-rpg.pages.dev/avatar01.webp';
        for (const [i, p] of data.entries()) {
            const avatar = p.avatar_url || p.avatar || defaultAvatar;
            const li = document.createElement("li");
            li.innerHTML = `<span class="rank-position">${i + 1}.</span><img src="${esc(avatar)}" onerror="this.src='${defaultAvatar}'" class="rank-avatar"><div class="rank-player-info"><span class="rank-player-name">${esc(p.name)}</span><span class="rank-guild-name">${esc(p.guild_name) || 'Sem Guilda'}</span></div><span class="rank-points">${Number(p.ranking_points || 0).toLocaleString()} pts</span>`;
            rankingList.appendChild(li);
        }
    }

    async function fetchPastSeasonRanking() {
        showLoading();
        try {
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'none';
            if (rankingListPast) rankingListPast.innerHTML = "";
            if (seasonPastInfoSpan) seasonPastInfoSpan.textContent = "Carregando...";

            let d = getCache('arena_last_season_cache');
            let snap = null;
            if (!d) {
                try {
                    const { data: rpcData } = await supabase.rpc('get_arena_top_100_past');
                    let r = normalizeRpcResult(rpcData);
                    let candidate = null;
                    if (Array.isArray(r)) candidate = r;
                    else if (r?.ranking && Array.isArray(r.ranking)) candidate = r.ranking;
                    else if (r?.result?.ranking) candidate = r.result.ranking;
                    if (Array.isArray(candidate) && candidate.length) {
                        d = candidate;
                        setCache('arena_last_season_cache', d, 60);
                    }
                } catch {}
                
                if (!d) {
                    const { data: snaps } = await supabase.from('arena_season_snapshots').select('ranking, season_year, season_month, created_at').order('created_at', { ascending: false }).limit(1);
                    if (snaps && snaps.length > 0) {
                        snap = snaps[0];
                        let rv = snap.ranking;
                        if (typeof rv === 'string') try { rv = JSON.parse(rv); } catch {}
                        if (Array.isArray(rv)) { d = rv; setCache('arena_last_season_cache', d, 60); }
                    }
                }
            }
            
            let seasonInfoText = "Temporada Anterior";
            if (snap && snap.season_month) {
                const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
                seasonInfoText = `Temporada: ${monthNames[snap.season_month - 1] || snap.season_month} / ${snap.season_year}`;
            }
            if (seasonPastInfoSpan) seasonPastInfoSpan.textContent = seasonInfoText;

            if (!d || !d.length) {
                if (rankingListPast) rankingListPast.innerHTML = "<li style='padding:12px;text-align:center;color:#aaa;'>Ainda não houve temporada passada.</li>";
            } else {
                rankingListPast.innerHTML = "";
                const defAv = 'https://aden-rpg.pages.dev/avatar01.webp';
                d.forEach((p, i) => {
                    const av = p.avatar_url || p.avatar || defAv;
                    rankingListPast.innerHTML += `<li id="rankingListPast" style="width: 82vw;"><span style="width:40px;font-weight:bold;color:#FFC107;">${i+1}.</span><img class="rank-avatar" src="${esc(av)}" onerror="this.src='${defAv}'" style="width:45px;height:45px;border-radius:50%"><div style="flex-grow:1;text-align:left;"><div class="rank-player-name">${esc(p.name)}</div><div class="rank-guild-name" style="font-weight: bold;">${esc(p.guild_name||'Sem Guilda')}</div></div><div class="rank-points">${Number(p.ranking_points||0).toLocaleString()} pts</div></li>`;
                });
            }
            if (rankingModal) rankingModal.style.display = 'flex';
        } catch { showModalAlert("Erro ao carregar temporada passada."); } finally { hideLoading(); }
    }

    async function fetchAttackHistory() {
        showLoading();
        try {
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'none';
            if (rankingHistoryList) rankingHistoryList.innerHTML = "";
            supabase.rpc('cleanup_old_arena_logs').then(()=>{});

            const cacheKey = 'arena_attack_history';
            let h = getCache(cacheKey);
            if (!h) {
                const { data } = await supabase.rpc('get_arena_attack_logs');
                const r = normalizeRpcResult(data);
                if (r?.success && Array.isArray(r.logs) && r.logs.length) {
                    h = r.logs; setCache(cacheKey, h, 60);
                } else if (userId) {
                    const { data: logsDirect } = await supabase.from('arena_attack_logs').select('*').eq('defender_id', userId).order('created_at', { ascending: false }).limit(200);
                    if (logsDirect) { h = logsDirect; setCache(cacheKey, h, 60); }
                }
            }

            if (!h || !h.length) rankingHistoryList.innerHTML = "<li style='padding:12px;text-align:center;color:#aaa;'>Sem registros.</li>";
            else {
                rankingHistoryList.innerHTML = "";
                h.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).forEach(l => {
                    const date = new Date(l.created_at).toLocaleString('pt-BR');
                    const attackerWon = String(l.attacker_won) === 'true' || l.attacker_won === true;
                    const msg = attackerWon ? `${esc(l.attacker_name)} atacou você e venceu. Você perdeu ${Number(l.points_taken).toLocaleString()} pts.` : `${esc(l.attacker_name)} atacou você e perdeu. Você tomou ${Number(l.points_taken).toLocaleString()} pts.`;
                    rankingHistoryList.innerHTML += `<li style='padding:8px;border-bottom:1px solid #444;color:#ddd;'><strong>${date}</strong><br>${msg}</li>`;
                });
            }
            if (rankingModal) rankingModal.style.display = 'flex';
        } catch { showModalAlert("Erro ao carregar histórico."); } finally { hideLoading(); }
    }

    function initRankingTabs() {
        const tabs = document.querySelectorAll(".ranking-tab");
        if (!tabs.length) return;
        tabs.forEach(tab => {
            tab.addEventListener("click", async () => {
                tabs.forEach(t => { t.classList.remove("active"); t.style.background = "none"; t.style.color = "#e0dccc"; });
                tab.classList.add("active"); tab.style.background = "#c9a94a"; tab.style.color = "#000";
                
                document.querySelectorAll(".tab-panel").forEach(p => { p.classList.remove("active"); p.style.display = 'none'; });
                
                const tn = tab.dataset.tab;
                if (tn === 'current') {
                    document.getElementById('rankingCurrent').style.display = 'block';
                    await fetchAndRenderRanking();
                } else if (tn === 'past') {
                    document.getElementById('rankingPast').style.display = 'block';
                    await fetchPastSeasonRanking();
                } else {
                    document.getElementById('rankingHistory').style.display = 'block';
                    await fetchAttackHistory();
                }
            });
        });
    }

    async function checkAndResetArenaSeason() {
        try {
            const now = new Date();
            if (now.getUTCDate() !== 1) return;
            const lastResetRaw = localStorage.getItem('arena_last_season_reset');
            const keyData = lastResetRaw ? JSON.parse(lastResetRaw) : null;
            if (keyData && keyData.month === (now.getUTCMonth() + 1)) return;
            localStorage.removeItem('arena_top_100_cache');
            localStorage.removeItem('arena_last_season_cache');
            const { data } = await supabase.rpc('reset_arena_season');
            const r = normalizeRpcResult(data);
            if (r?.success) localStorage.setItem('arena_last_season_reset', JSON.stringify({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }));
        } catch {}
    }

    async function boot() {
        showLoading();
        try {
            // OTIMIZAÇÃO ZERO EGRESS:
            // Tenta pegar o ID do cache local primeiro
            userId = getLocalUserId();

            // Se não achou no cache, aí sim tentamos a rede (fallback de segurança)
            if (!userId) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) { window.location.href = "index.html"; return; }
                userId = session.user.id;
            }

            // A chamada RPC vai falhar se o token for inválido, servindo como validação
            await supabase.rpc("check_abandoned_battles");
            await checkAndResetArenaSeason();
            await supabase.rpc("reset_player_arena_attempts");
            await updateAttemptsUI();
            ensureStreakDate();
            await loadArenaLoadout();

        } catch (e) {
            console.error("Erro no boot:", e);
            // Se der erro de permissão, aí sim manda pro login
            if (e.message && (e.message.includes('JWT') || e.message.includes('auth'))) {
                window.location.href = "index.html";
            }
        } finally {
            hideLoading();
        }
    }

    window.addEventListener('beforeunload', (e) => {
        if (currentBattleId) {
            e.preventDefault();
            e.returnValue = "Se você sair agora, perderá a batalha automaticamente.";
            return e.returnValue;
        }
    });

    if (challengeBtn) challengeBtn.addEventListener("click", handleChallengeClick);
    if (openRankingBtn) openRankingBtn.addEventListener("click", () => { document.querySelector(".ranking-tab[data-tab='current']").click(); });
    if (closeRankingBtn) closeRankingBtn.addEventListener("click", () => { if (rankingModal) rankingModal.style.display = 'none'; });
    initRankingTabs();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === 'hidden' && backgroundMusic && !backgroundMusic.paused) backgroundMusic.pause();
      else if (document.visibilityState === 'visible' && musicStarted && backgroundMusic && backgroundMusic.paused) backgroundMusic.play().catch(()=>{});
    });

    boot();
});