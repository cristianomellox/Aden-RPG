// arena.js — Versão Final Integrada (PvP + Poções + Ranking + Histórico + Áudio)
document.addEventListener("DOMContentLoaded", async () => {
    // --- Configuração do Supabase ---
    const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let userId = null;

    // --- DOM Elements ---
    const loadingOverlay = document.getElementById("loading-overlay");
    const challengeBtn = document.getElementById("challengeBtn");
    const arenaAttemptsLeftSpan = document.getElementById("arenaAttemptsLeft");

    const pvpCombatModal = document.getElementById("pvpCombatModal");
    const confirmModal = document.getElementById("confirmModal");
    const confirmMessage = document.getElementById("confirmMessage");
    const confirmActionBtn = document.getElementById("confirmActionBtn");
    const confirmTitle = document.getElementById("confirmTitle");

    const rankingModal = document.getElementById("rankingModal");
    const openRankingBtn = document.getElementById("openRankingBtn");
    const closeRankingBtn = document.getElementById("closeRankingBtn");
    const rankingList = document.getElementById("rankingList");
    const seasonInfoSpan = document.getElementById("seasonInfo");

    const rankingListPast = document.getElementById("rankingListPast");
    const rankingHistoryList = document.getElementById("rankingHistoryList");
    const seasonInfoContainer = document.getElementById("seasonInfoContainer");
    const seasonPastInfoSpan = document.getElementById("seasonPastInfo");

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
    const pvpArena = document.getElementById("pvpArena");

    // --- Elementos de Poções (Novos) ---
    const potionSelectModal = document.getElementById("potionSelectModal");
    const closePotionModalBtn = document.getElementById("closePotionModal");
    const potionListGrid = document.getElementById("potionListGrid");
    const potionSlots = document.querySelectorAll(".potion-slot");

    // Mapeamento de Imagens das Poções
    const POTION_MAP = {
        43: "pocao_de_cura_r", 44: "pocao_de_cura_sr",
        45: "pocao_de_furia_r", 46: "pocao_de_furia_sr",
        47: "pocao_de_destreza_r", 48: "pocao_de_destreza_sr",
        49: "pocao_de_ataque_r", 50: "pocao_de_ataque_sr"
    };

    // --- Sons ---
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffers = {};

    let backgroundMusic = null;
    let musicStarted = false;

    // Lista de Arquivos de Áudio
    const audioFiles = {
        normal: "https://aden-rpg.pages.dev/assets/normal_hit.mp3",
        critical: "https://aden-rpg.pages.dev/assets/critical_hit.mp3",
        evade: "https://aden-rpg.pages.dev/assets/evade.mp3",
        streak3: "https://aden-rpg.pages.dev/assets/killingspree.mp3",
        streak4: "https://aden-rpg.pages.dev/assets/implacavel.mp3",
        streak5: "https://aden-rpg.pages.dev/assets/dominando.mp3",
        background: "https://aden-rpg.pages.dev/assets/arena.mp3",
        // Novos sons
        heal: "https://aden-rpg.pages.dev/assets/pot_cura.mp3",
        dex: "https://aden-rpg.pages.dev/assets/pot_dex.mp3",
        fury: "https://aden-rpg.pages.dev/assets/pot_furia.mp3",
        atk: "https://aden-rpg.pages.dev/assets/pot_atk.mp3"
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
            console.warn(`[audio] preload ${name} falhou:`, e);
            audioBuffers[name] = null;
        }
    }
    // Preload dos sons
    preload('normal'); preload('critical'); preload('evade');
    preload('streak3'); preload('streak4'); preload('streak5');
    preload('heal'); preload('dex'); preload('fury'); preload('atk');

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
            } catch (err) {
                console.warn("[audio] play error:", err);
            }
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
            try { await audioContext.resume(); } catch(e){ console.warn("AudioContext resume falhou", e); }
        }
        const names = ['normal','critical','evade','streak3','streak4','streak5', 'heal', 'dex', 'fury', 'atk'];
        for (const name of names) {
            const buf = audioBuffers[name];
            if (buf && audioContext.state !== 'closed') {
                try {
                    const source = audioContext.createBufferSource();
                    source.buffer = buf;
                    const gain = audioContext.createGain();
                    gain.gain.value = 0.0;
                    source.connect(gain).connect(audioContext.destination);
                    source.start(0);
                    setTimeout(() => { try { source.stop(); } catch(e){} }, 60);
                } catch (e) {}
            } else {
                try {
                    const a = new Audio(audioFiles[name] || audioFiles.normal);
                    a.volume = 0;
                    const p = a.play();
                    if (p && p.then) { p.then(() => { try { a.pause(); a.currentTime = 0; } catch(e){} }); } 
                    else { try { a.pause(); a.currentTime = 0; } catch(e){} }
                } catch (e) {}
            }
        }
    }

    function startBackgroundMusic() {
        if (musicStarted) return;
        if (!backgroundMusic) {
            backgroundMusic = new Audio(audioFiles.background);
            backgroundMusic.volume = 0.1;
            backgroundMusic.loop = true;
        }
        backgroundMusic.play().then(() => { musicStarted = true; }).catch(err => {
            console.warn("⚠️ Falha ao iniciar música:", err);
            musicStarted = false; 
        });
    }

    function addCapturedListener(target, evt, handler, opts = {}) {
        try { target.addEventListener(evt, handler, Object.assign({ capture: true, passive: true, once: false }, opts)); } catch (e) {}
    }

    function resumeAudioContext() {
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(e => console.warn("AudioContext resume falhou", e));
        }
    }

    const primaryEvents = ["click", "pointerdown", "touchstart", "mousedown", "keydown"];
    for (const ev of primaryEvents) {
        addCapturedListener(window, ev, () => {
            resumeAudioContext();
            startBackgroundMusic();
            try { unlockSfx(); } catch(e){ console.warn("unlockSfx erro", e); }
        }, { once: true });
    }

    let moveArmed = false; 
    function armMove() { moveArmed = true; setTimeout(()=> moveArmed = false, 1200); }
    addCapturedListener(window, "pointerdown", armMove);
    addCapturedListener(window, "touchstart", armMove);

    function handleMoveForMusic(e) {
        resumeAudioContext(); 
        if (musicStarted || !moveArmed) return;
        const isTouchMove = (e.touches && e.touches.length > 0);
        const hasPressure = (e.pressure && e.pressure > 0) || (e.buttons && e.buttons > 0);
        if (isTouchMove || hasPressure || e.pointerType) {
            startBackgroundMusic();
            moveArmed = false;
            try { unlockSfx(); } catch(e){}
        }
    }
    addCapturedListener(window, "touchmove", handleMoveForMusic);
    addCapturedListener(window, "pointermove", handleMoveForMusic);

    // --- Utilitários ---
    function showLoading() { if (loadingOverlay) loadingOverlay.style.display = "flex"; }
    function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = "none"; }
    const esc = (s) => (s === 0 || s) ? String(s).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])) : "";

    function showModalAlert(message, title = "Aviso") {
        if (!confirmModal) { alert(message); return; }
        if (confirmTitle) confirmTitle.textContent = title;
        if (confirmMessage) confirmMessage.innerHTML = message;
        if (confirmActionBtn) confirmActionBtn.onclick = () => { confirmModal.style.display = 'none'; };
        confirmModal.style.display = 'flex';
    }

    // --- Cache ---
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

    function getMinutesUntilNextMonth() {
        const now = new Date();
        const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
        const diffMs = nextMonth.getTime() - Date.now();
        return Math.max(1, Math.floor(diffMs / 60000));
    }

    async function getCachedPlayerInfo(playerId) {
        if (!playerId) return null;
        const key = `player_${playerId}`;
        let cached = getCache(key);
        if (cached) return cached;
        const { data } = await supabase.from('players')
            .select('id, name, avatar_url, guild_id, ranking_points')
            .eq('id', playerId).single();
        if (data) setCache(key, data, CACHE_TTL_24H);
        return data;
    }

    async function getCachedGuildName(guildId) {
        if (!guildId) return 'Sem Guilda';
        const key = `guild_${guildId}`;
        let cached = getCache(key);
        if (cached) return cached;
        const { data } = await supabase.from('guilds').select('name').eq('id', guildId).single();
        const name = data?.name || 'Sem Guilda';
        setCache(key, name, CACHE_TTL_24H);
        return name;
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
                challengeBtn.disabled = attempts <= 0;
                challengeBtn.style.filter = attempts <= 0 ? "grayscale(1)" : "none";
                challengeBtn.textContent = attempts <= 0 ? "Volte às 21h00" : "Desafiar";
            }
        } catch { if (arenaAttemptsLeftSpan) arenaAttemptsLeftSpan.textContent = "Erro"; }
    }

    // --- Streak ---
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
            const n = parseInt(raw, 10);
            return Number.isFinite(n) ? Math.max(0, n) : 0;
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
    // --- [NOVO] LÓGICA DE POÇÕES / LOADOUT ---
    // =======================================================================

    async function loadArenaLoadout() {
        if (!userId) return;
        const { data, error } = await supabase.rpc('get_my_arena_loadout');
        
        // Reseta visual
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

    async function openPotionSelectModal(slotType, slotIndex) {
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
        unequipBtn.innerHTML = '<img src="https://aden-rpg.pages.dev/assets/expulsar.webp" alt="Aviso" style="width: 80px; height: 80px; margin-bottom: 10px;"><small>Remover</small>';
        unequipBtn.onclick = async () => {
            showLoading();
            await supabase.rpc('unequip_arena_potion', { p_slot_type: slotType.toUpperCase(), p_slot_index: parseInt(slotIndex) });
            hideLoading();
            potionSelectModal.style.display = 'none';
            await loadArenaLoadout();
        };
        potionListGrid.appendChild(unequipBtn);

        if (error || !items || items.length === 0) {
            const msg = document.createElement('p');
            msg.textContent = "Você não possui poções de batalha no inventário.";
            msg.style.color = "#ccc";
            msg.style.gridColumn = "1 / -1";
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
                    p_slot_type: slotType.toUpperCase(), 
                    p_slot_index: parseInt(slotIndex), 
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
    }

    potionSlots.forEach(slot => {
        slot.addEventListener('click', () => openPotionSelectModal(slot.dataset.type, slot.dataset.index));
    });
    if (closePotionModalBtn) closePotionModalBtn.addEventListener('click', () => potionSelectModal.style.display = 'none');

    // =======================================================================
    // --- COMBATE (Atualizado para suportar poções) ---
    // =======================================================================

    async function handleChallengeClick() {
        if (!challengeBtn || challengeBtn.disabled) return;
        challengeBtn.disabled = true;
        showLoading();
        
        let opponent = null; 
        let challengerInfo = null; 
        try {
            const { data: findData, error: findError } = await supabase.rpc('find_arena_opponent');
            if (findError) throw findError;
            
            const findResult = normalizeRpcResult(findData);
            if (!findResult?.success) {
                challengeBtn.disabled = false;
                return showModalAlert(findResult?.message || "Nenhum oponente encontrado.");
            }
            
            opponent = findResult.opponent; 
            cacheOpponent(opponent);
            challengerInfo = await getCachedPlayerInfo(userId); 

            // Inicia combate (V2 no Backend)
            const { data: combatData, error: combatError } = await supabase.rpc('start_arena_combat', { p_opponent_id: opponent.id });
            if (combatError) throw combatError;
            
            const combatResult = normalizeRpcResult(combatData);
            if (!combatResult?.success) {
                 return showModalAlert(combatResult?.message || "Falha ao iniciar combate.");
            }

            await loadArenaLoadout(); // Atualiza inventário local (poções gastas)
            hideLoading();
            
            const challengerData = { 
                ...(combatResult.challenger_stats || {}), 
                id: userId, 
                name: challengerInfo?.name || 'Desafiante', 
                avatar_url: challengerInfo?.avatar_url 
            };
            const defenderData = { 
                ...(combatResult.defender_stats || {}), 
                id: opponent?.id, 
                name: opponent?.name || 'Defensor', 
                avatar_url: opponent?.avatar_url 
            };

            // CHAMA A NOVA ANIMAÇÃO COM OS ARRAYS DE POÇÕES
            await simulatePvpAnimation(
                challengerData, 
                defenderData, 
                combatResult.combat_log,
                combatResult.challenger_potions,
                combatResult.defender_potions
            );

            // Resultado
            let msg = "";
            const points = combatResult.points_transferred || 0;
            const opponentName = esc(opponent?.name || 'Oponente');

            try {
                ensureStreakDate();
                if (combatResult.winner_id === userId) {
                    currentStreak++;
                    saveStreak(currentStreak);
                    if (currentStreak >= 5) playSound('streak5', { volume: 0.9 });
                    else if (currentStreak === 4) playSound('streak4', { volume: 0.9 });
                    else if (currentStreak === 3) playSound('streak3', { volume: 0.9 });
                } else if (combatResult.winner_id && combatResult.winner_id !== userId) {
                    currentStreak = 0;
                    saveStreak(0);
                }
            } catch (stErr) {}

            if (combatResult.winner_id === userId) {
                msg = `<strong style="color:#4CAF50;">Você venceu!</strong><br>Você derrotou ${opponentName} e tomou ${points.toLocaleString()} pontos dele(a).`;
            } else if (combatResult.winner_id === null) {
                msg = `<strong style="color:#FFC107;">Empate!</strong><br>Ninguém perdeu pontos nesta batalha.`;
            } else {
                msg = `<strong style="color:#f44336;">Você perdeu!</strong><br>${opponentName} derrotou você e tomou ${points.toLocaleString()} pontos.`;
            }
            
            // Exibir Recompensas (V2)
            let rewardsHTML = "";
            const rewards = combatResult.rewards_granted;
            if (rewards && (rewards.crystals > 0 || rewards.item_41 > 0 || rewards.item_42 > 0)) {
                let rewardsItems = [];
                const imgStyle = "width: 35px; height: 38px; margin-right: 5px; image-rendering: pixelated; object-fit: contain;";
                const itemStyle = "display: flex; align-items: center; background: rgba(0,0,0,0.3); padding: 5px 8px; border-radius: 5px;";
                const textStyle = "font-size: 1.1em; color: #fff; font-weight: bold; text-shadow: 1px 1px 2px #000;";

                if (rewards.crystals > 0) rewardsItems.push(`<div style="${itemStyle}"><img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="${imgStyle}"><span style="${textStyle}">x ${rewards.crystals.toLocaleString()}</span></div>`);
                if (rewards.item_41 > 0) rewardsItems.push(`<div style="${itemStyle}"><img src="https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_comum.webp" style="${imgStyle}"><span style="${textStyle}">x ${rewards.item_41}</span></div>`);
                if (rewards.item_42 > 0) rewardsItems.push(`<div style="${itemStyle}"><img src="https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_avancado.webp" style="${imgStyle}"><span style="${textStyle}">x ${rewards.item_42}</span></div>`);

                if (rewardsItems.length > 0) {
                    rewardsHTML = `<hr style="border-color: #555; margin: 15px 0; border-style: dashed;"><div style="display: flex; align-items: center; gap: 10px; justify-content: center; flex-wrap: wrap;">${rewardsItems.join('')}</div>`;
                }
            }

            showModalAlert(msg + rewardsHTML, "Resultado da Batalha");

        } catch (e) {
            console.error("Erro no desafio:", e);
            challengeBtn.disabled = false;
            showModalAlert("Erro inesperado: " + (e?.message || e));
        } finally {
            await updateAttemptsUI();
            hideLoading();
        }
    }

    // --- Animação (Atualizada V2) ---
    async function simulatePvpAnimation(challenger, defender, log, cPots, dPots) {
        const hasPvpUI = pvpCombatModal && challengerName && defenderName;
        const defaultAvatar = 'https://aden-rpg.pages.dev/avatar01.webp';

        let cHP = +((challenger && (challenger.health || challenger.max_health)) || 0);
        const cMax = cHP;
        let dHP = +((defender && (defender.health || defender.max_health)) || 0);
        const dMax = dHP;

        // Limpeza de elementos antigos
        document.querySelectorAll('.active-buff-icon').forEach(e => e.remove());
        document.querySelectorAll('.battle-potions-container').forEach(e => e.remove());

        if (hasPvpUI) {
            challengerName.textContent = challenger.name || esc(challenger.name || 'Desafiante');
            defenderName.textContent = defender.name || esc(defender.name || 'Defensor');
            if (challengerAvatar) challengerAvatar.src = challenger.avatar_url || challenger.avatar || defaultAvatar;
            if (defenderAvatar) defenderAvatar.src = defender.avatar_url || defender.avatar || defaultAvatar;
            
            updatePvpHpBar(challengerHpFill, challengerHpText, cHP, cMax);
            updatePvpHpBar(defenderHpFill, defenderHpText, dHP, dMax);
            
            // Renderiza as poções laterais com cooldown
            renderBattlePotions(challengerSide, cPots, 'left');
            renderBattlePotions(defenderSide, dPots, 'right');

            pvpCombatModal.style.display = 'flex';
            if (pvpCountdown) {
                pvpCountdown.style.display = 'block';
                for (let i = 3; i > 0; i--) {
                    pvpCountdown.textContent = `A batalha começará em ${i}...`;
                    await new Promise(r => setTimeout(r, 1000));
                }
                pvpCountdown.style.display = 'none';
            }
        }

        // Prepara estado visual dos cooldowns
        const cds = [];
        const initCd = (arr, side) => {
            if(!arr) return;
            arr.forEach(p => {
                const el = document.getElementById(`bp-${side}-${p.item_id}`);
                if(el) {
                    // Mantido 7 e 15 para visualizar o tempo cheio
                    const max = (p.type === 'HEAL' ? 7 : 15); 
                    cds.push({ id: p.item_id, side, el: el.querySelector('.cooldown-overlay'), max, cur: 0 });
                }
            });
        };
        initCd(cPots, 'left'); initCd(dPots, 'right');

        for (const turn of (log || [])) {
            // Atualiza cooldowns visuais
            cds.forEach(c => { 
                if(c.cur > 0) { 
                    c.cur--; 
                    // Atualiza a altura da barra preta (overlay)
                    c.el.style.height = `${(c.cur/c.max)*100}%`; 
                } 
            });

            const actorId = turn.actor || turn.attacker_id;
            const isChallengerActor = actorId === challenger.id;
            const actorSide = isChallengerActor ? challengerSide : defenderSide;
            const targetSide = isChallengerActor ? defenderSide : challengerSide;
            const sideStr = isChallengerActor ? 'left' : 'right';

            if (turn.action === 'attack' || (!turn.action && turn.damage !== undefined)) {
                const dmg = +turn.damage || 0;
                if (isChallengerActor) dHP = Math.max(0, dHP - dmg); else cHP = Math.max(0, cHP - dmg);
                if (hasPvpUI) {
                    updatePvpHpBar(challengerHpFill, challengerHpText, cHP, cMax);
                    updatePvpHpBar(defenderHpFill, defenderHpText, dHP, dMax);
                    displayDamageNumber(dmg, !!turn.critical, !!turn.evaded, targetSide);
                }
            } else if (turn.action === 'potion' || turn.action === 'buff_start') {
                // Reset cooldown visual
                const cdObj = cds.find(x => x.id == turn.item_id && x.side == sideStr);
                if(cdObj) { 
                    cdObj.cur = cdObj.max; // Reseta para 7 (ou 15)
                    cdObj.el.style.height = "100%"; // Barra cheia (preta)
                }

                if (turn.type === 'HEAL') {
                    playSound('heal', { volume: 0.8 });
                    if (isChallengerActor) cHP = Math.min(cMax, cHP + turn.value); else dHP = Math.min(dMax, dHP + turn.value);
                    if (hasPvpUI) {
                        updatePvpHpBar(challengerHpFill, challengerHpText, cHP, cMax);
                        updatePvpHpBar(defenderHpFill, defenderHpText, dHP, dMax);
                        displayFloatingText(`+${turn.value}`, '#00ff00', actorSide);
                        flashPotionIcon(turn.item_id, actorSide);
                    }
                } else {
                    if (turn.type === 'FURY') playSound('fury', { volume: 0.8 });
                    else if (turn.type === 'DEX') playSound('dex', { volume: 0.8 });
                    else playSound('atk', { volume: 0.8 });

                    if (hasPvpUI) {
                        const buffName = turn.type === 'FURY' ? "FÚRIA!" : (turn.type === 'DEX' ? "DESTREZA!" : "FORÇA!");
                        displayFloatingText(buffName, '#ffaa00', actorSide);
                        flashPotionIcon(turn.item_id, actorSide);
                        addBuffIcon(actorSide, turn.item_id); 
                    }
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        await new Promise(r => setTimeout(r, 1500));
        if (hasPvpUI) pvpCombatModal.style.display = 'none';
        // Limpeza
        document.querySelectorAll('.active-buff-icon').forEach(e => e.remove());
        document.querySelectorAll('.battle-potions-container').forEach(e => e.remove());
    }

    function updatePvpHpBar(el, txt, cur, max) {
        if (!el) return;
        const pct = Math.max(0, Math.min(100, (cur / (max || 1)) * 100));
        el.style.width = pct + '%';
        if (txt) txt.textContent = `${cur.toLocaleString()} / ${max.toLocaleString()}`;
    }

    function displayDamageNumber(dmg, crit, evd, target) {
        if (!target) return;
        const el = document.createElement("div");
        if (evd) {
            el.textContent = "Desviou";
            el.className = "evade-text";
            playSound('evade', { volume: 0.3 });
        } else {
            el.textContent = dmg.toLocaleString();
            el.className = crit ? "crit-damage-number" : "damage-number";
            playSound(crit ? 'critical' : 'normal', { volume: crit ? 0.1 : 0.5 });
        }
        target.appendChild(el);
        el.addEventListener("animationend", () => el.remove());
        setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
    }

    // --- Helpers Visuais Poções ---
    function displayFloatingText(text, color, sideElement) {
        const el = document.createElement("div");
        el.textContent = text;
        el.style.position = "absolute";
        el.style.top = "40%";
        el.style.left = "50%";
        el.style.transform = "translate(-50%, -50%)";
        el.style.color = color;
        el.style.fontWeight = "bold";
        el.style.fontSize = "1.5em";
        el.style.textShadow = "2px 2px 0 #000";
        el.style.zIndex = "20";
        el.style.animation = "floatUpPotion 1.5s ease-out forwards";
        
        if(!document.getElementById('anim-float-style')) {
            const style = document.createElement('style');
            style.id = 'anim-float-style';
            style.innerHTML = `@keyframes floatUpPotion { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.5); } 20% { opacity: 1; transform: translate(-50%, -20px) scale(1.2); } 100% { opacity: 0; transform: translate(-50%, -60px) scale(1); } } @keyframes blinkPotion { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.9); } }`;
            document.head.appendChild(style);
        }
        sideElement.appendChild(el);
        setTimeout(() => el.remove(), 1500);
    }

    function flashPotionIcon(itemId, sideElement) {
        const img = document.createElement("img");
        const itemName = POTION_MAP[itemId] || `item_${itemId}`; 
        img.src = `https://aden-rpg.pages.dev/assets/itens/${itemName}.webp`; 
        img.style.position = "absolute";
        img.style.top = "60%";
        img.style.left = "50%";
        img.style.width = "40px";
        img.style.height = "40px";
        img.style.transform = "translate(-50%, -50%)";
        img.style.zIndex = "25";
        img.style.opacity = "0";
        img.style.transition = "opacity 0.2s, transform 0.5s";
        sideElement.appendChild(img);
        requestAnimationFrame(() => {
            img.style.opacity = "1";
            img.style.transform = "translate(-50%, -80%) scale(1.2)";
            setTimeout(() => { img.style.opacity = "0"; setTimeout(() => img.remove(), 300); }, 600);
        });
    }

    function addBuffIcon(sideElement, itemId) {
        let ct = sideElement.querySelector('.buff-container');
        if (!ct) {
            ct = document.createElement('div');
            ct.className = 'buff-container';
            ct.style.position = "absolute";
            ct.style.top = "130px"; // Abaixo do HP
            ct.style.width = "100%";
            ct.style.display = "flex";
            ct.style.justifyContent = "center";
            ct.style.gap = "5px";
            ct.style.zIndex = "1500";
            sideElement.appendChild(ct);
        }
        const icon = document.createElement("img");
        const imgName = POTION_MAP[itemId] || "pocao_de_cura_r";
        icon.src = `https://aden-rpg.pages.dev/assets/itens/${imgName}.webp`; 
        icon.style.width = "35px";
        icon.style.height = "35px";
        icon.style.objectFit = "contain";
        icon.style.animation = "blinkPotion 1s infinite"; 
        icon.style.filter = "drop-shadow(0 0 2px gold)";
        ct.appendChild(icon);
        setTimeout(() => icon.remove(), 7000);
    }

    function renderBattlePotions(tgt, pots, side) {
        if(!pots || !pots.length) return;
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
        
        pots.forEach(p => {
            const slot = document.createElement('div');
            slot.id = `bp-${side}-${p.item_id}`;
            slot.style.width = "40px";
            slot.style.height = "40px";
            slot.style.position = "relative";
            slot.style.border = "1px solid #777";
            slot.style.background = "#111";
            slot.style.borderRadius = "4px";
            slot.style.overflow = "hidden";

            const name = POTION_MAP[p.item_id] || "pocao_de_cura_r";
            slot.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/itens/${name}.webp" style="width:100%;height:100%;object-fit:contain;"><div class="cooldown-overlay" style="position:absolute;bottom:0;left:0;width:100%;height:0;background:rgba(0,0,0,0.85);transition:height 1s linear;"></div>`;
            ct.appendChild(slot);
        });
        tgt.appendChild(ct);
    }

    // --- Ranking Logic (Original Completo) ---
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
            let { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                await new Promise((resolve) => {
                    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
                        if (session?.user) { user = session.user; listener.subscription.unsubscribe(); resolve(); }
                    });
                    setTimeout(resolve, 5000);
                });
            }
            if (!user) { window.location.href = "index.html"; return; }
            userId = user.id;

            await checkAndResetArenaSeason();
            await supabase.rpc("reset_player_arena_attempts");
            await updateAttemptsUI();
            ensureStreakDate();
            await loadArenaLoadout();

        } catch (e) { console.error("Erro no boot:", e); } finally { hideLoading(); }
    }

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