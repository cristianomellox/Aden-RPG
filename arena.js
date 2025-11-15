// arena.js — versão final com correção de avatares + caching total + SFX de streak
document.addEventListener("DOMContentLoaded", async () => {
    // --- Configuração do Supabase ---
    const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let userId = null;

    // --- DOM Elements (com checagens defensivas) ---
    const loadingOverlay = document.getElementById("loading-overlay");
    const challengeBtn = document.getElementById("challengeBtn");
    const arenaAttemptsLeftSpan = document.getElementById("arenaAttemptsLeft");

    const pvpCombatModal = document.getElementById("pvpCombatModal");
    const confirmModal = document.getElementById("confirmModal");
    const confirmMessage = document.getElementById("confirmMessage");
    const confirmActionBtn = document.getElementById("confirmActionBtn");
    const rankingModal = document.getElementById("rankingModal");
    const openRankingBtn = document.getElementById("openRankingBtn");
    const closeRankingBtn = document.getElementById("closeRankingBtn");
    const rankingList = document.getElementById("rankingList");
    const seasonInfoSpan = document.getElementById("seasonInfo");

    const rankingListPast = document.getElementById("rankingListPast");
    const rankingHistoryList = document.getElementById("rankingHistoryList");
    const seasonInfoContainer = document.getElementById("seasonInfoContainer");
    
    // NOVO: Span da temporada passada
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

    // --- Sons ---
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffers = {};

    let backgroundMusic = null;
    let musicStarted = false;

    const audioFiles = {
        normal: "https://aden-rpg.pages.dev/assets/normal_hit.mp3",
        critical: "https://aden-rpg.pages.dev/assets/critical_hit.mp3",
        evade: "https://aden-rpg.pages.dev/assets/evade.mp3",
        // SFX de streak (3,4,5)
        streak3: "https://aden-rpg.pages.dev/assets/killingspree.mp3",
        streak4: "https://aden-rpg.pages.dev/assets/implacavel.mp3",
        streak5: "https://aden-rpg.pages.dev/assets/dominando.mp3",
        // música de fundo (já usada)
        background: "https://aden-rpg.pages.dev/assets/arena.mp3"
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
    // Preload dos principais efeitos (inclui streaks)
    preload('normal'); preload('critical'); preload('evade');
    preload('streak3'); preload('streak4'); preload('streak5');

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
        // fallback para HTMLAudio
        try {
            const a = new Audio(audioFiles[name] || audioFiles.normal);
            a.volume = Math.min(1, Math.max(0, vol));
            // don't keep reference — fire and forget
            a.play().catch(e => {});
        } catch (e) {}
    }

    // Função para "destravar" SFX: toca silenciosamente cada buffer (ou html audio) e para imediatamente.
    let sfxUnlocked = false;
    async function unlockSfx() {
        if (sfxUnlocked) return;
        sfxUnlocked = true;

        // Resume audio context se necessário
        if (audioContext.state === 'suspended') {
            try { await audioContext.resume(); } catch(e){ console.warn("AudioContext resume falhou", e); }
        }

        // Toca cada buffer brevemente com ganho 0 para destravar
        const names = ['normal','critical','evade','streak3','streak4','streak5'];
        for (const name of names) {
            const buf = audioBuffers[name];
            if (buf && audioContext.state !== 'closed') {
                try {
                    const source = audioContext.createBufferSource();
                    source.buffer = buf;
                    const gain = audioContext.createGain();
                    gain.gain.value = 0.0; // silencioso
                    source.connect(gain).connect(audioContext.destination);
                    source.start(0);
                    // stop safe after short interval
                    setTimeout(() => {
                        try { source.stop(); } catch(e){}
                    }, 60);
                } catch (e) {
                    // fallback below
                }
            } else {
                // fallback HTMLAudio play/pause with volume 0
                try {
                    const a = new Audio(audioFiles[name] || audioFiles.normal);
                    a.volume = 0;
                    const p = a.play();
                    if (p && p.then) {
                        p.then(() => { try { a.pause(); a.currentTime = 0; } catch(e){} });
                    } else {
                        try { a.pause(); a.currentTime = 0; } catch(e){}
                    }
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

        backgroundMusic.play().then(() => {
            musicStarted = true;
        }).catch(err => {
            console.warn("⚠️ Falha ao iniciar música:", err);
            musicStarted = false; 
        });
    }

    function addCapturedListener(target, evt, handler, opts = {}) {
        try {
            target.addEventListener(evt, handler, Object.assign({ capture: true, passive: true, once: false }, opts));
        } catch (e) {}
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
            // desbloqueia SFX na primeira interação (silencioso)
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
        if (!confirmModal) {
            alert(message);
            return;
        }
        const confirmTitle = document.getElementById("confirmTitle");
        if (confirmTitle) confirmTitle.textContent = title;
        if (confirmMessage) confirmMessage.innerHTML = message;
        if (confirmActionBtn) {
            confirmActionBtn.onclick = () => { confirmModal.style.display = 'none'; };
        }
        confirmModal.style.display = 'flex';
    }

    // --- Cache ---
    const CACHE_TTL_24H = 1440;
    function setCache(key, data, ttlMinutes = CACHE_TTL_24H) {
        try {
            localStorage.setItem(key, JSON.stringify({ expires: Date.now() + ttlMinutes * 60000, data }));
        } catch {}
    }
    function getCache(key) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            if (Date.now() > parsed.expires) {
                localStorage.removeItem(key);
                return null;
            }
            return parsed.data;
        } catch { return null; }
    }

    function getMinutesUntilNextMonth() {
        const now = new Date();
        const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
        const diffMs = nextMonth.getTime() - Date.now();
        return Math.max(1, Math.floor(diffMs / 60000));
    }

    /**
     * Calcula o número de minutos restantes até a próxima meia-noite (00:00) UTC.
     * Isso garante que o cache expire no horário exato do reset diário.
     */
    function getMinutesUntilUTCMidnight() {
        const now = new Date();
        // Cria uma data para 00:00 UTC de amanhã
        const tomorrowUTC = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1, // O dia seguinte
            0, 0, 0, 0 // Às 00:00:00.000
        ));
        
        const diffMs = tomorrowUTC.getTime() - now.getTime();
        
        return Math.max(1, Math.ceil(diffMs / 60000));
    }


    // --- Cache adicional: jogadores e guildas ---
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
        const { data } = await supabase.from('guilds')
            .select('name').eq('id', guildId).single();
        const name = data?.name || 'Sem Guilda';
        setCache(key, name, CACHE_TTL_24H);
        return name;
    }

    function cacheOpponent(opponent) {
        if (opponent?.id) setCache('last_opponent', opponent, 5);
    }

    // --- Normalização do RPC ---
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
            if (typeof data === 'string') {
                try { return normalizeRpcResult(JSON.parse(data)); } catch {}
            }
            return data;
        } catch (e) {
            console.error("normalizeRpcResult error:", e);
            return null;
        }
    }

    // --- Arena: tentativas / UI ---
    async function updateAttemptsUI() {
        if (!userId) return;
        try {
            const { data } = await supabase.from('players')
                .select('arena_attempts_left').eq('id', userId).single();
            const attempts = data?.arena_attempts_left ?? 0;
            if (arenaAttemptsLeftSpan) arenaAttemptsLeftSpan.textContent = attempts;
            if (challengeBtn) {
                challengeBtn.disabled = attempts <= 0;
                challengeBtn.style.filter = attempts <= 0 ? "grayscale(1)" : "none";
                challengeBtn.textContent = attempts <= 0 ? "Volte Amanhã" : "Desafiar";
            }
        } catch {
            if (arenaAttemptsLeftSpan) arenaAttemptsLeftSpan.textContent = "Erro";
        }
    }

    // --- Streak (vitórias consecutivas) — cache frontend (localStorage) ---
    const STREAK_KEY = 'arena_win_streak';
    const STREAK_DATE_KEY = 'arena_win_streak_date'; // YYYY-MM-DD (UTC)
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
                // novo dia — reset
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

    // Função para checar se dia mudou (por exemplo, sessão longa)
    function ensureStreakDate() {
        try {
            const dateRaw = localStorage.getItem(STREAK_DATE_KEY);
            const today = getTodayUTCDateString();
            if (!dateRaw || dateRaw !== today) {
                currentStreak = 0;
                saveStreak(0);
            }
        } catch(e){}
    }

    // Chama para garantir que, ao carregar, se for novo dia zera
    ensureStreakDate();

    // --- PvP: fluxo de desafio e animação ---
    
    // >>> ESTE BLOCO FOI ATUALIZADO <<<
    async function handleChallengeClick() {
        if (!challengeBtn) return;
        showLoading();
        challengeBtn.disabled = true;
        let opponent = null; 
        let challengerInfo = null; 
        let combatResult = null;
        try {
            const { data: findData, error: findError } = await supabase.rpc('find_arena_opponent');
            if (findError) throw findError;
            const findResult = normalizeRpcResult(findData);
            if (!findResult?.success) return showModalAlert(findResult?.message || "Nenhum oponente encontrado.");
            opponent = findResult.opponent; 
            cacheOpponent(opponent);

            challengerInfo = await getCachedPlayerInfo(userId); 

            const { data: combatData, error: combatError } = await supabase.rpc('start_arena_combat', { p_opponent_id: opponent.id });
            if (combatError) throw combatError;
            combatResult = normalizeRpcResult(combatData);
            if (!combatResult?.success) return showModalAlert(combatResult?.message || "Falha ao iniciar combate.");

            // 🔥 CORREÇÃO: Esconde o loading overlay AQUI para que a animação do PvP seja visível.
            hideLoading();
            
            const challengerData = { 
                ...(combatResult.challenger_stats || {}), 
                id: userId,
                name: challengerInfo?.name || 'Desafiante', 
                avatar_url: challengerInfo?.avatar_url || null 
            };
            const defenderData = { 
                ...(combatResult.defender_stats || {}),
                id: opponent?.id,
                name: opponent?.name || 'Defensor', 
                avatar_url: opponent?.avatar_url || null 
            };

            await simulatePvpAnimation(challengerData, defenderData, combatResult.combat_log);

            let msg = "";
            const points = combatResult.points_transferred || 0;
            const opponentName = esc(opponent?.name || 'Oponente');

            // --- Atualiza streak NO FRONTEND (cache local) conforme resultado ---
            try {
                ensureStreakDate(); // garante reset diário se necessário

                if (combatResult.winner_id === userId) {
                    // vitória do jogador
                    currentStreak = loadStreak(); // recarrega (safety)
                    currentStreak = currentStreak + 1;
                    saveStreak(currentStreak);

                    // dispara SFX conforme thresholds
                    if (currentStreak >= 5) {
                        try { playSound('streak5', { volume: 0.9 }); } catch(e){ console.warn("play streak5", e); }
                    } else if (currentStreak === 4) {
                        try { playSound('streak4', { volume: 0.9 }); } catch(e){ console.warn("play streak4", e); }
                    } else if (currentStreak === 3) {
                        try { playSound('streak3', { volume: 0.9 }); } catch(e){ console.warn("play streak3", e); }
                    }
                } else if (combatResult.winner_id === null) {
                    // empate: neutro
                } else {
                    // derrota do jogador -> zera streak
                    currentStreak = 0;
                    saveStreak(0);
                }
            } catch (stErr) {
                console.warn("Erro ao atualizar streak local:", stErr);
            }

            if (combatResult.winner_id === userId) {
                msg = `<strong style="color:#4CAF50;">Você venceu!</strong><br>Você derrotou ${opponentName} e tomou ${points.toLocaleString()} pontos dele(a).`;
            } else if (combatResult.winner_id === null) {
                msg = `<strong style="color:#FFC107;">Empate!</strong><br>Ninguém perdeu pontos nesta batalha.`;
            } else {
                msg = `<strong style="color:#f44336;">Você perdeu!</strong><br>${opponentName} derrotou você e tomou ${points.toLocaleString()} pontos.`;
            }
            
            // [NOVO] INÍCIO: Construir HTML das Recompensas
            let rewardsHTML = "";
            const rewards = combatResult.rewards_granted;

            if (rewards && (rewards.crystals > 0 || rewards.item_41 > 0 || rewards.item_42 > 0)) {
                let rewardsItems = [];
                // Estilos CSS para os ícones e texto
                const imgStyle = "width: 35px; height: 38px; margin-right: 5px; image-rendering: pixelated; object-fit: contain;";
                const itemStyle = "display: flex; align-items: center; background: rgba(0,0,0,0.3); padding: 5px 8px; border-radius: 5px;";
                const textStyle = "font-size: 1.1em; color: #fff; font-weight: bold; text-shadow: 1px 1px 2px #000;";

                // Adiciona Cristais se houver
                if (rewards.crystals > 0) {
                    rewardsItems.push(`
                        <div style="${itemStyle}">
                            <img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="${imgStyle}">
                            <span style="${textStyle}">x ${rewards.crystals.toLocaleString()}</span>
                        </div>
                    `);
                }
                // Adiciona Item 41 (Comum) se houver
                if (rewards.item_41 > 0) {
                    rewardsItems.push(`
                        <div style="${itemStyle}">
                            <img src="https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_comum.webp" style="${imgStyle}">
                            <span style="${textStyle}">x ${rewards.item_41}</span>
                        </div>
                    `);
                }
                // Adiciona Item 42 (Avançado) se houver
                if (rewards.item_42 > 0) {
                    rewardsItems.push(`
                        <div style="${itemStyle}">
                            <img src="https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_avancado.webp" style="${imgStyle}">
                            <span style="${textStyle}">x ${rewards.item_42}</span>
                        </div>
                    `);
                }

                if (rewardsItems.length > 0) {
                    rewardsHTML = `
                        <hr style="border-color: #555; margin: 15px 0; border-style: dashed;">
                        <div style="display: flex; align-items: center; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            ${rewardsItems.join('')}
                        </div>
                    `;
                }
            }
            // [NOVO] FIM: Construir HTML das Recompensas

            // Adiciona o HTML das recompensas à mensagem
            showModalAlert(msg + rewardsHTML, "Resultado da Batalha");

        } catch (e) {
            console.error("Erro no desafio:", e);
            showModalAlert("Erro inesperado: " + (e?.message || e));
        } finally {
            await updateAttemptsUI();
            hideLoading();
        }
    }
    // >>> FIM DO BLOCO ATUALIZADO <<<

    async function simulatePvpAnimation(challenger, defender, log) {
        const hasPvpUI = pvpCombatModal && challengerName && defenderName && challengerHpFill && defenderHpFill && challengerHpText && defenderHpText;
        const defaultAvatar = 'https://aden-rpg.pages.dev/avatar01.webp';

        const cMax = +((challenger && (challenger.health || challenger.max_health)) || 0);
        const dMax = +((defender && (defender.health || defender.max_health)) || 0);
        let cHP = cMax, dHP = dMax;

        if (hasPvpUI) {
            challengerName.textContent = challenger.name || esc(challenger.name || 'Desconhecido');
            defenderName.textContent = defender.name || esc(defender.name || 'Desconhecido');

            if (challengerAvatar) challengerAvatar.src = challenger.avatar_url || challenger.avatar || defaultAvatar;
            if (defenderAvatar) defenderAvatar.src = defender.avatar_url || defender.avatar || defaultAvatar;

            updatePvpHpBar(challengerHpFill, challengerHpText, cHP, cMax);
            updatePvpHpBar(defenderHpFill, defenderHpText, dHP, dMax);
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

        for (const turn of (log || [])) {
            const dmg = +turn.damage || 0, isCrit = !!turn.critical, isEvade = !!turn.evaded;
            const atkId = turn.attacker_id;
            const defenderId = defender?.id, challengerId = challenger?.id;

            if (atkId && defenderId && atkId === defenderId) {
                cHP = Math.max(0, cHP - dmg);
                if (hasPvpUI) updatePvpHpBar(challengerHpFill, challengerHpText, cHP, cMax);
            } else {
                dHP = Math.max(0, dHP - dmg);
                if (hasPvpUI) updatePvpHpBar(defenderHpFill, defenderHpText, dHP, dMax);
            }

            if (hasPvpUI && challengerSide && defenderSide) {
                const targetEl = (atkId && defenderId && atkId === defenderId) ? challengerSide : defenderSide;
                displayDamageNumber(dmg, isCrit, isEvade, targetEl);
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        await new Promise(r => setTimeout(r, 1500));
        if (hasPvpUI) pvpCombatModal.style.display = 'none';
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

    // --- Ranking ---
    
    async function fetchAndRenderRanking() {
        showLoading();
        try {
            const cacheKey = 'arena_top_100_cache';
            let rankingData = getCache(cacheKey); 

            if (!rankingData) { 
                console.log("Cache de ranking (atual) vazio. Buscando do servidor...");
                const { data: rpcData, error: rpcError } = await supabase.rpc('get_arena_top_100');

                if (rpcError) {
                    console.warn('Erro RPC get_arena_top_100, usando fallback.', rpcError.message);
                    rankingData = await fallbackFetchTopPlayers();
                } else {
                    const result = normalizeRpcResult(rpcData);

                    if (result?.success && Array.isArray(result.ranking)) {
                        rankingData = result.ranking;
                        
                        if (rankingData.length > 0) {
                            // Salva no cache com TTL de 15 minutos (conforme solicitado)
                            setCache(cacheKey, rankingData, 15);
                        } else {
                            console.log("RPC retornou ranking vazio, não será salvo no cache.");
                        }
                    } else {
                        console.warn('RPC get_arena_top_100 não retornou sucesso, usando fallback.');
                        rankingData = await fallbackFetchTopPlayers();
                    }
                }
            }
            
            // CORREÇÃO 1: Garante que as informações da temporada atual sejam exibidas.
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'block'; 

            renderRanking(rankingData || []); 
            
            // CORREÇÃO 3: REMOVIDO o código que forçava a visibilidade do painel "Passada" (rankingPast), resolvendo a sobreposição de listas.
            
            if (rankingModal) rankingModal.style.display = 'flex';
        
        } catch (e) {
            console.error("Ranking erro:", e);
            showModalAlert("Não foi possível carregar o ranking.");
        } finally {
            hideLoading();
        }
    }


    async function fallbackFetchTopPlayers() {
        try {
            const { data: players } = await supabase
                .from('players')
                .select('id, name, avatar_url, avatar, ranking_points, guild_id')
                .neq('is_banned', true)
                .order('ranking_points', { ascending: false })
                .limit(100);
            
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
        } catch (fallbackError) {
            console.error("Fallback de ranking falhou:", fallbackError.message);
            return []; 
        }
    }

    function renderRanking(data) {
        if (seasonInfoSpan) {
            const now = new Date();
            const month = now.toLocaleString('pt-BR', { month: 'long' });
            const year = now.getFullYear();
            seasonInfoSpan.innerHTML = `<strong>Temporada<br> ${month[0].toUpperCase() + month.slice(1)} / ${year}</strong>`;
        }

        if (!rankingList) return;
        rankingList.innerHTML = "";
        if (!data || !data.length) {
            rankingList.innerHTML = "<li style='text-align:center; padding: 20px; color: #aaa;'>Nenhum jogador classificado ainda.</li>";
            return;
        }

        const defaultAvatar = 'https://aden-rpg.pages.dev/avatar01.webp';

        for (const [i, p] of data.entries()) {
            const avatar = (p.avatar_url && p.avatar_url.trim() !== "")
                ? p.avatar_url
                : (p.avatar && p.avatar.trim() !== "")
                ? p.avatar
                : defaultAvatar;

            const li = document.createElement("li");
            li.innerHTML = `
                <span class="rank-position">${i + 1}.</span>
                <img src="${esc(avatar)}" onerror="this.src='${defaultAvatar}'" class="rank-avatar">
                <div class="rank-player-info">
                    <span class="rank-player-name">${esc(p.name)}</span>
                    <span class="rank-guild-name">${esc(p.guild_name) || 'Sem Guilda'}</span>
                </div>
                <span class="rank-points">${Number(p.ranking_points || 0).toLocaleString()} pts</span>`;
            rankingList.appendChild(li);
        }
    }

    // --- Season past & attack history (Lógica das Abas) ---
    async function fetchPastSeasonRanking() {
        showLoading();
        try {
            // CORREÇÃO 1: Oculta info da temporada atual (Corrigido para voltar na aba Atual)
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'none';
            if (rankingListPast) rankingListPast.innerHTML = "";
            // Inicializa o span com um texto de carregamento/padrão
            if (seasonPastInfoSpan) seasonPastInfoSpan.textContent = "Carregando Temporada Anterior...";


            // Tentativa 1: cache
            let d = getCache('arena_last_season_cache');
            let snap = null; // Variável para armazenar o snapshot para o título da temporada

            if (d && Array.isArray(d)) {
                console.log("Usando cache local da temporada passada.");
            } else {
                console.log("Cache de ranking (passado) vazio. Tentando RPC 'get_arena_top_100_past'...");
                // Tenta RPC
                try {
                    const { data: rpcData, error: rpcError } = await supabase.rpc('get_arena_top_100_past');
                    if (rpcError) {
                        console.warn("RPC get_arena_top_100_past erro:", rpcError.message || rpcError);
                    } else {
                        // Normalizar possíveis formatos de retorno do RPC
                        let r = rpcData;
                        if (Array.isArray(r) && r.length === 1 && typeof r[0] === 'object' && r[0] !== null) {
                            r = r[0].result || r[0];
                        }
                        let candidate = null;
                        if (!r) {
                            candidate = null;
                        } else if (Array.isArray(r)) {
                            candidate = r;
                        } else if (typeof r === 'string') {
                            try { candidate = JSON.parse(r); } catch(e) { candidate = null; }
                        } else if (typeof r === 'object') {
                            if (Array.isArray(r.ranking)) candidate = r.ranking;
                            else if (typeof r.ranking === 'string') {
                                try { candidate = JSON.parse(r.ranking); } catch(e) { candidate = null; }
                            } else if (Array.isArray(r.result)) candidate = r.result;
                            else if (r.result && typeof r.result === 'object' && Array.isArray(r.result.ranking)) candidate = r.result.ranking;
                        }
                        if (Array.isArray(candidate) && candidate.length) {
                            d = candidate;
                            setCache('arena_last_season_cache', d, getMinutesUntilNextMonth());
                            console.log("Temporada passada carregada com sucesso via RPC.");
                        } else {
                            console.log("RPC não retornou ranking válido; seguiremos com fallback.");
                        }
                    }} catch (rpcCatchErr) {
                    console.warn("Erro ao chamar RPC get_arena_top_100_past:", rpcCatchErr);
                }

                // Fallback: ler direto a tabela arena_season_snapshots (mais confiável)
                if (!d || !Array.isArray(d) || d.length === 0) {
                    try {
                        const { data: snaps, error: snapErr } = await supabase
  .from('arena_season_snapshots')
  .select('ranking, season_year, season_month, created_at')
  .order('created_at', { ascending: false })
  .limit(1);

if (snapErr) {
  console.warn("Erro ao buscar arena_season_snapshots diretamente:", snapErr.message || snapErr);
} else if (Array.isArray(snaps) && snaps.length > 0) {
  snap = snaps[0]; // Armazena o snapshot para obter o título da temporada
  if (snap && snap.ranking) {
    let rankingVal = snap.ranking;
    if (typeof rankingVal === 'string') {
      try { rankingVal = JSON.parse(rankingVal); } catch (e) {
        console.warn("Erro ao parsear JSON do ranking:", e);
        rankingVal = [];
      }
    }
    if (Array.isArray(rankingVal)) {
      d = rankingVal;
      setCache('arena_last_season_cache', d, getMinutesUntilNextMonth());
      console.log("Temporada passada carregada com sucesso a partir de arena_season_snapshots.");
    }
  }
}
                    } catch (tableErr) {
                        console.error("Erro no fallback read de arena_season_snapshots:", tableErr);
                    }
                }
            }

            // CORREÇÃO: Gera o título da temporada passada e ATUALIZA O SPAN.
            let seasonInfoText = "Temporada Anterior";
            if (snap && snap.season_month && snap.season_year) {
                const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
                const monthIndex = snap.season_month - 1; // 0-indexed
                if(monthIndex >= 0 && monthIndex < 12) {
                    seasonInfoText = `Temporada: ${monthNames[monthIndex]} / ${snap.season_year}`;
                } else {
                     seasonInfoText = `Temporada: ${snap.season_month} / ${snap.season_year}`;
                }
            }
            if (seasonPastInfoSpan) {
                seasonPastInfoSpan.textContent = seasonInfoText;
            }


            if (!d || !d.length) {
                if (rankingListPast) {
                    rankingListPast.innerHTML = `
                        <li style="padding:12px;text-align:center;color:#aaa;font-style:italic;">
                            Ainda não houve temporada passada.
                        </li>`;
                }
            } else {
                if (rankingListPast) {
                    rankingListPast.innerHTML = "";
                    
                    // LINHA REMOVIDA: A inserção do <li> com o título da temporada passada foi movida para o span (#seasonPastInfo).

                    const defAv = 'https://aden-rpg.pages.dev/avatar01.webp';
                    d.forEach((p, i) => {
                        const av = p.avatar_url || p.avatar || defAv;
                        rankingListPast.innerHTML += `
<li id="rankingListPast" style="width: 82vw;">
<span style="width:40px;font-weight:bold;color:#FFC107;">${i+1}.</span>
<img class="rank-avatar" src="${esc(av)}" onerror="this.src='${defAv}'" style="width:45px;height:45px;border-radius:50%">
<div style="flex-grow:1;text-align:left;">
<div class="rank-player-name">${esc(p.name)}</div>
<div class="rank-guild-name" style="font-weight: bold;">${esc(p.guild_name||'Sem Guilda')}</div>
</div>
<div class="rank-points">${Number(p.ranking_points||0).toLocaleString()} pts</div>
</li>`;
                    });
                }
            }
            if (rankingModal) rankingModal.style.display = 'flex';
        } catch (e) {
            console.error(e);
            showModalAlert("Erro ao carregar temporada passada.");
        } finally {
            hideLoading();
        }
    }

    async function fetchAttackHistory() {
        showLoading();
        try {
            // CORREÇÃO 1: Oculta info da temporada atual (Corrigido para voltar na aba Atual)
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'none';
            if (rankingHistoryList) rankingHistoryList.innerHTML = "";

            // A RPC de cleanup não deve travar o processo.
            supabase.rpc('cleanup_old_arena_logs').then(cleanupResult => {
                 if (cleanupResult?.error) console.warn("Erro ao limpar logs antigos:", cleanupResult.error);
            });

            // Tenta carregar do cache com TTL de 60 minutos (1 hora)
            const cacheKey = 'arena_attack_history';
            let h = getCache(cacheKey);

            if (!h || !Array.isArray(h)) {
                // Chama a RPC principal
                try {
                    const { data, error } = await supabase.rpc('get_arena_attack_logs');
                    if (error) {
                        console.warn("RPC get_arena_attack_logs erro:", error.message || error);
                    } else {
                        const r = normalizeRpcResult(data);
                        if (r?.success && Array.isArray(r.logs) && r.logs.length) {
                            h = r.logs;
                            setCache(cacheKey, h, 60); // TTL 60 minutos conforme solicitado
                            console.log("Historico obtido via RPC e salvo em cache (60min).");
                        } else if (r?.logs && typeof r.logs === 'string') {
                            try { const parsed = JSON.parse(r.logs); if (Array.isArray(parsed)) { h = parsed; setCache(cacheKey, h, 60); } } catch(e){}
                        } else {
                            console.log("RPC não retornou logs válidos. Fallback para leitura direta da tabela.");
                        }
                    }
                } catch (rpcErr) {
                    console.warn("Erro ao chamar RPC get_arena_attack_logs:", rpcErr);
                }

                // Fallback: consulta direta na tabela arena_attack_logs filtrando defender_id
                if ((!h || !Array.isArray(h) || h.length === 0) && userId) {
                    try {
                        const { data: logsDirect, error: logsErr } = await supabase
                            .from('arena_attack_logs')
                            .select('id, attacker_id, defender_id, attacker_name, points_taken, created_at, attacker_won')
                            .eq('defender_id', userId)
                            .order('created_at', { ascending: false })
                            .limit(200);

                        if (logsErr) {
                            console.warn("Erro ao buscar arena_attack_logs diretamente:", logsErr.message || logsErr);
                        } else if (Array.isArray(logsDirect)) {
                            h = logsDirect.map(l => ({
                                id: l.id,
                                attacker_id: l.attacker_id,
                                defender_id: l.defender_id,
                                attacker_name: l.attacker_name,
                                points_taken: l.points_taken,
                                created_at: l.created_at,
                                attacker_won: (typeof l.attacker_won === 'boolean') ? l.attacker_won : false
                            }));
                            if (h.length) {
                                setCache(cacheKey, h, 60); // cache 60 minutos
                                console.log("Historico obtido via leitura direta e salvo em cache (60min).");
                            }
                        }
                    } catch (tableErr) {
                        console.error("Erro no fallback read de arena_attack_logs:", tableErr);
                    }
                }
            } else {
                console.log("Usando cache local do histórico de ataques.");
            }

            if (!h || !h.length) {
                if (rankingHistoryList) rankingHistoryList.innerHTML = `
                    <li style="padding:12px;text-align:center;color:#aaa;font-style:italic;">
                        Sem registros.
                    </li>`;
            } else {
                if (rankingHistoryList) {
                    rankingHistoryList.innerHTML = "";
                    // Ordena por via das dúvidas (se os dados vierem do cache)
                    h.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).forEach(l => {
                        const date = new Date(l.created_at).toLocaleString('pt-BR');
                        const attackerName = esc(l.attacker_name);
                        const points = Number(l.points_taken || 0).toLocaleString();

                        // --- NORMALIZAÇÃO ROBUSTA DE attacker_won ---
                        const attackerWon = (
                            l.attacker_won === true ||
                            l.attacker_won === 't' ||
                            l.attacker_won === 'T' ||
                            l.attacker_won === 'true' ||
                            l.attacker_won === 'True' ||
                            l.attacker_won === 1 ||
                            l.attacker_won === '1'
                        );

                        // Mensagens claras e sem ambiguidade:
                        const msg = attackerWon
                            ? `${attackerName} atacou você e venceu. Você perdeu ${points} pontos.`
                            : `${attackerName} atacou você e perdeu. Você tomou ${points} pontos dele(a).`;

                        rankingHistoryList.innerHTML += `<li style='padding:8px;border-bottom:1px solid #444;color:#ddd;'>
<strong>${date}</strong><br>${msg}
</li>`;
                    });
                }
            }

            if (rankingModal) rankingModal.style.display = 'flex';
        } catch (e) {
            console.error("Erro ao carregar histórico:", e);
            showModalAlert("Erro ao carregar histórico.");
        } finally {
            hideLoading();
        }
    }

    // --- Abas de ranking (inicialização) ---
    function initRankingTabs() {
        const tabs = document.querySelectorAll(".ranking-tab");
        if (!tabs || !tabs.length) return;
        tabs.forEach(tab => {
            tab.addEventListener("click", async () => {
                tabs.forEach(t => { t.classList.remove("active"); t.style.background = "none"; t.style.color = "#e0dccc"; });
                tab.classList.add("active");
                tab.style.background = "#c9a94a"; tab.style.color = "#000";
                
                // Garante que a exibição da aba ativa seja controlada pelo JS
                document.querySelectorAll(".tab-panel").forEach(p => {
                    p.classList.remove("active");
                    p.style.display = 'none'; // Adicionado para forçar ocultação de todas
                });
                
                const tn = tab.dataset.tab;
                let activePanel = null;

                if (tn === 'current') {
                    activePanel = document.getElementById('rankingCurrent');
                    await fetchAndRenderRanking();
                } else if (tn === 'past') {
                    activePanel = document.getElementById('rankingPast');
                    await fetchPastSeasonRanking();
                } else {
                    activePanel = document.getElementById('rankingHistory');
                    await fetchAttackHistory(); // Chama a função corrigida
                }

                if (activePanel) {
                    activePanel.classList.add('active');
                    activePanel.style.display = 'block'; // Garante que a aba selecionada seja exibida
                }
            });
        });
    }

    // --- Reset mensal da temporada (front-end safe call) ---

    async function checkAndResetArenaSeason() {
        try {
            const now = new Date();
            const utcDay = now.getUTCDate(); // usamos UTC para alinhar com o server
            const currentMonth = now.getUTCMonth() + 1; // 1..12
            const currentYear = now.getUTCFullYear();

            try {
                if (utcDay === 1) {
                    if (localStorage.getItem('arena_top_100_cache')) {
                        localStorage.removeItem('arena_top_100_cache');
                        console.log("Cache de Ranking Atual (arena_top_100_cache) limpo (Dia 1).");
                    }
                    if (localStorage.getItem('arena_last_season_cache')) {
                        localStorage.removeItem('arena_last_season_cache');
                        console.log("Cache de Temporada Passada (arena_last_season_cache) limpo (Dia 1).");
                    }
                }
            } catch (e) {
                console.warn("Falha ao limpar caches no Dia 1:", e);
            }

            // --- Proteção cliente: só chamamos a RPC se for dia 1 UTC e se ainda não executamos este mês ---
            try {
                const lastResetRaw = localStorage.getItem('arena_last_season_reset');
                let lastReset = null;
                if (lastResetRaw) {
                    try { lastReset = JSON.parse(lastResetRaw); } catch(e){ lastReset = null; }
                }

                const alreadyDone = lastReset && lastReset.year === currentYear && lastReset.month === currentMonth;

                if (utcDay !== 1) {
                    console.log("⏸️ Reset da temporada não necessário (não é dia 1 UTC).");
                    return;
                }

                if (alreadyDone) {
                    console.log("⏸️ Reset da temporada já foi executado neste mês por este cliente (localStorage).");
                    return;
                }

                console.log("⚙️ Executando RPC 'reset_arena_season' (chamado no Dia 1 UTC e ainda não executado neste mês)...");
                const { data, error } = await supabase.rpc('reset_arena_season');
                
                if (error) {
                    console.warn("Erro ao executar 'reset_arena_season':", error.message || error);
                    return;
                }

                const r = normalizeRpcResult(data);
                if (r?.success) {
                    console.log("✅ Temporada verificada/resetada via RPC:", r.message || r);
                    // Marca localmente para evitar múltiplas execuções durante o mesmo mês
                    try {
                        localStorage.setItem('arena_last_season_reset', JSON.stringify({ year: currentYear, month: currentMonth }));
                    } catch(e) {
                        console.warn("Falha ao gravar arena_last_season_reset no localStorage:", e);
                    }
                } else {
                    console.log("ℹ️ 'reset_arena_season' retornou:", r?.message || r);
                }
            } catch (rpcErr) {
                console.warn("Erro durante tentativa segura de reset:", rpcErr);
            }

        } catch (e) {
            console.error("checkAndResetArenaSeason erro fatal:", e);
        }
    }

    // --- Boot (corrigido para aguardar autenticação) ---
    async function boot() {
        showLoading();
        try {
            let { data: { user } } = await supabase.auth.getUser();

            // Aguarda autenticação se ainda não tiver o usuário carregado
            if (!user) {
              console.log("⏳ Aguardando autenticação do Supabase...");
              await new Promise((resolve) => {
                const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
                  if (session?.user) {
                    user = session.user;
                    try { listener.subscription.unsubscribe(); } catch(e){/*ignore*/}
                    resolve();
                  }
                });
                // timeout fallback: em 5s resolvemos para evitar bloqueio indefinido
                setTimeout(() => resolve(), 5000);
              });
            }

            if (!user) {
              console.warn("Usuário não autenticado, redirecionando...");
              window.location.href = "index.html";
              return;
            }

            userId = user.id;
            console.log("Usuário autenticado:", user.email || user.id);

            // 🔥 Agora sim — chamamos o reset garantido (com proteção cliente)
            await checkAndResetArenaSeason();

            // Reset diário das tentativas
            await supabase.rpc("reset_player_arena_attempts");

            // Atualiza tentativas na interface
            await updateAttemptsUI();

            // Garante que o streak seja verificado no boot (novo dia)
            ensureStreakDate();

        } catch (e) {
            console.error("Erro no boot:", e);
            document.body.innerHTML = "<p>Erro ao carregar Arena.</p>";
        } finally {
            hideLoading();
        }
    }

    // --- Eventos (liga handlers) ---
    if (challengeBtn) challengeBtn.addEventListener("click", handleChallengeClick);
    if (openRankingBtn) {
        openRankingBtn.addEventListener("click", async () => {
            // Garante que a aba "Atual" esteja selecionada visualmente
            const tabs = document.querySelectorAll(".ranking-tab");
            const curTab = document.querySelector(".ranking-tab[data-tab='current']");
            
            if (tabs && curTab) {
                tabs.forEach(t => { t.classList.remove("active"); t.style.background = "none"; t.style.color = "#e0dccc"; });
                curTab.classList.add("active"); curTab.style.background = "#c9a94a"; curTab.style.color = "#000";
            }
            
            // Garante que APENAS o painel 'current' esteja visível/ativo
            document.querySelectorAll(".tab-panel").forEach(p => {
                p.classList.remove("active");
                p.style.display = 'none';
            });
            const rc = document.getElementById("rankingCurrent");
            if (rc) {
                 rc.classList.add("active");
                 rc.style.display = 'block';
            }
            
            await fetchAndRenderRanking(); 
        });
    }
    if (closeRankingBtn) closeRankingBtn.addEventListener("click", () => { if (rankingModal) rankingModal.style.display = 'none'; });
    initRankingTabs();

    boot();
});