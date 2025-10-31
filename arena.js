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

    // elementos adicionais usados nas versões com abas/histórico (pode não existir no teu HTML; por isso checamos)
    const rankingListPast = document.getElementById("rankingListPast");
    const rankingHistoryList = document.getElementById("rankingHistoryList");
    const seasonInfoContainer = document.getElementById("seasonInfoContainer");

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

    // [MÚSICA]
    let backgroundMusic = null;
    let musicStarted = false;

    const audioFiles = {
        normal: "https://aden-rpg.pages.dev/assets/normal_hit.mp3",
        critical: "https://aden-rpg.pages.dev/assets/critical_hit.mp3",
        evade: "https://aden-rpg.pages.dev/assets/evade.mp3",
    };

    async function preload(name) {
        try {
            const res = await fetch(audioFiles[name]);
            const ab = await res.arrayBuffer();
            audioBuffers[name] = await new Promise((resolve, reject) => {
                audioContext.decodeAudioData(ab, resolve, reject);
            });
        } catch (e) {
            console.warn(`[audio] preload ${name} falhou:`, e);
            audioBuffers[name] = null;
        }
    }
    preload('normal'); preload('critical'); preload('evade');

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
        try { new Audio(audioFiles[name]).play(); } catch (e) {}
    }


    // [MÚSICA] Lógica de início de música robusta (baseada em zion.html)
    function startBackgroundMusic() {
        if (musicStarted) return;
        
        if (!backgroundMusic) {
            backgroundMusic = new Audio("https://aden-rpg.pages.dev/assets/IntoTheWilds.mp3");
            backgroundMusic.volume = 0.1;
            backgroundMusic.loop = true;
        }

        backgroundMusic.play().then(() => {
            musicStarted = true;
        }).catch(err => {
            console.warn("⚠️ Falha ao iniciar música:", err);
            musicStarted = false; // Permite tentar novamente
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
        }
    }
    addCapturedListener(window, "touchmove", handleMoveForMusic);
    addCapturedListener(window, "pointermove", handleMoveForMusic);
    // [FIM MÚSICA]


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

    // --- PvP: fluxo de desafio e animação ---
    async function handleChallengeClick() {
        if (!challengeBtn) return;
        showLoading();
        challengeBtn.disabled = true;
        let opponent = null; 
        let challengerInfo = null; 
        try {
            // 1) buscar oponente
            const { data: findData, error: findError } = await supabase.rpc('find_arena_opponent');
            if (findError) throw findError;
            const findResult = normalizeRpcResult(findData);
            if (!findResult?.success) return showModalAlert(findResult?.message || "Nenhum oponente encontrado.");
            opponent = findResult.opponent; 
            cacheOpponent(opponent);

            // [AVATAR] Buscar os dados do desafiante (nós mesmos)
            challengerInfo = await getCachedPlayerInfo(userId); 

            // 2) iniciar combate
            const { data: combatData, error: combatError } = await supabase.rpc('start_arena_combat', { p_opponent_id: opponent.id });
            if (combatError) throw combatError;
            const combatResult = normalizeRpcResult(combatData);
            if (!combatResult?.success) return showModalAlert(combatResult?.message || "Falha ao iniciar combate.");

            hideLoading(); 

            // [AVATAR] Combinar os dados de info (nome/avatar) com os dados de stats (HP/etc)
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

            // 3) animação/visualização do combate
            await simulatePvpAnimation(challengerData, defenderData, combatResult.combat_log);

            // 4) resultado [NOVA MENSAGEM]
            let msg = "";
            const points = combatResult.points_transferred || 0;
            const opponentName = esc(opponent?.name || 'Oponente');

            if (combatResult.winner_id === userId) {
                msg = `<strong style="color:#4CAF50;">Você venceu!</strong><br>Você derrotou ${opponentName} e tomou ${points.toLocaleString()} pontos dele(a).`;
            } else if (combatResult.winner_id === null) {
                msg = `<strong style="color:#FFC107;">Empate!</strong><br>Ninguém perdeu pontos nesta batalha.`;
            } else {
                msg = `<strong style="color:#f44336;">Você perdeu!</strong><br>${opponentName} derrotou você e tomou ${points.toLocaleString()} pontos.`;
            }
            showModalAlert(msg, "Resultado da Batalha");
            // [FIM NOVA MENSAGEM]

        } catch (e) {
            console.error("Erro no desafio:", e);
            showModalAlert("Erro inesperado: " + (e?.message || e));
        } finally {
            await updateAttemptsUI();
        }
    }

    async function simulatePvpAnimation(challenger, defender, log) {
        const hasPvpUI = pvpCombatModal && challengerName && defenderName && challengerHpFill && defenderHpFill && challengerHpText && defenderHpText;
        const defaultAvatar = 'https://aden-rpg.pages.dev/avatar01.webp';

        const cMax = +((challenger && (challenger.health || challenger.max_health)) || 0);
        const dMax = +((defender && (defender.health || defender.max_health)) || 0);
        let cHP = cMax, dHP = dMax;

        if (hasPvpUI) {
            challengerName.textContent = challenger.name || esc(challenger.name || 'Desconhecido');
            defenderName.textContent = defender.name || esc(defender.name || 'Desconhecido');

            // [AVATAR] garante avatar válido
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
    
    // [CORREÇÃO DEFINITIVA - RANKING VAZIO]
    async function fetchAndRenderRanking() {
        showLoading();
        try {
            const cacheKey = 'arena_top_100_cache';
            let rankingData = getCache(cacheKey); // 1. Tenta pegar do cache

            if (!rankingData) { // 2. Se o cache estiver vazio ou expirado, busca no servidor
                console.log("Cache de ranking vazio. Buscando do servidor...");
                const { data: rpcData, error: rpcError } = await supabase.rpc('get_arena_top_100');

                if (rpcError) {
                    // Erro na chamada RPC (ex: RLS, permissão)
                    console.warn('Erro RPC get_arena_top_100, usando fallback.', rpcError.message);
                    rankingData = await fallbackFetchTopPlayers();
                    // Não salvar o fallback no cache
                } else {
                    // Chamada RPC bem-sucedida
                    const result = normalizeRpcResult(rpcData);

                    if (result?.success && Array.isArray(result.ranking)) {
                        rankingData = result.ranking;
                        
                        // [A CORREÇÃO]
                        // Apenas salva no cache se a lista NÃO estiver vazia.
                        // Se a RPC falhar silenciosamente e retornar [], não vamos poluir o cache.
                        if (rankingData.length > 0) {
                            setCache(cacheKey, rankingData, CACHE_TTL_24H);
                        } else {
                            // Se a lista veio vazia, não salva no cache.
                            // Isso força uma nova busca na próxima vez que o modal for aberto.
                            console.log("RPC retornou ranking vazio, não será salvo no cache.");
                        }
                    } else {
                        // A função RPC retornou success: false ou dados mal formatados
                        console.warn('RPC get_arena_top_100 não retornou sucesso, usando fallback.');
                        rankingData = await fallbackFetchTopPlayers();
                        // Não salvar o fallback no cache
                    }
                }
            }
            
            renderRanking(rankingData || []); // Renderiza o que tiver (do cache ou do fetch)
            if (rankingModal) rankingModal.style.display = 'flex';
        
        } catch (e) {
            console.error("Ranking erro:", e);
            showModalAlert("Não foi possível carregar o ranking.");
        } finally {
            hideLoading();
        }
    }
    // [FIM CORREÇÃO DEFINITIVA - RANKING VAZIO]


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
            return []; // Retorna vazio se o fallback também falhar
        }
    }

    function renderRanking(data) {
        if (seasonInfoSpan) {
            const now = new Date();
            const month = now.toLocaleString('pt-BR', { month: 'long' });
            const year = now.getFullYear();
            seasonInfoSpan.textContent = `Temporada: ${month[0].toUpperCase() + month.slice(1)} / ${year}`;
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
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'none';
            if (rankingListPast) rankingListPast.innerHTML = "";

            let d = getCache('arena_last_season_cache');
            if (!d) {
                const { data } = await supabase.rpc('get_arena_top_100_past');
                const r = normalizeRpcResult(data);
                if (r?.success) {
                    d = r.ranking;
                    setCache('arena_last_season_cache', d, getMinutesUntilNextMonth());
                }
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
                    const defAv = 'https://aden-rpg.pages.dev/avatar01.webp';
                    d.forEach((p, i) => {
                        const av = p.avatar_url || p.avatar || defAv;
                        rankingListPast.innerHTML += `
<li style="display:flex;align:items:center;padding:8px;border-bottom:1px solid #444;">
<span style="width:40px;font-weight:bold;color:#FFC107;">${i+1}.</span>
<img src="${esc(av)}" onerror="this.src='${defAv}'" style="width:45px;height:45px;border-radius:50%;border:2px solid #888;margin-right:10px;">
<div style="flex-grow:1;text-align:left;">
<div style="font-weight:bold;color:#e0dccc">${esc(p.name)}</div>
<div style="font-size:0.8em;color:#aaa">${esc(p.guild_name||'Sem Guilda')}</div>
</div>
<div style="font-weight:bold;color:#fff; font-size: 0.8em;">${Number(p.ranking_points||0).toLocaleString()} pts</div>
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
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'none';
            if (rankingHistoryList) rankingHistoryList.innerHTML = "";

            // tenta limpar logs antigos (se a RPC existir)
            try {
                const cleanupResult = await supabase.rpc('cleanup_old_arena_logs');
                if (cleanupResult?.error) console.warn("Erro ao limpar logs antigos:", cleanupResult.error);
            } catch (cleanupErr) {
                // não é crítico — apenas logamos
                console.warn("cleanup_old_arena_logs falhou (ou não existe):", cleanupErr?.message || cleanupErr);
            }

            // busca os logs
            const { data, error } = await supabase.rpc('get_arena_attack_logs');
            if (error) throw error;

            const r = normalizeRpcResult(data);
            const fetchedLogs = (r && r.success && Array.isArray(r.logs)) ? r.logs : [];

            // mantemos o comportamento de cache local existente, mas com checagens defensivas
            let h = getCache('arena_attack_history') || [];
            if (Array.isArray(fetchedLogs) && fetchedLogs.length > 0) {
                const ids = new Set(h.map(i => i.id));
                const newOnes = fetchedLogs.filter(l => !ids.has(l.id));
                h = [...newOnes, ...h];
                const limit = Date.now() - (3 * 24 * 60 * 60 * 1000);
                h = h.filter(l => new Date(l.created_at).getTime() >= limit);
                setCache('arena_attack_history', h, 4320);
            } else {
                // se não veio nada novo e cache também vazio, mantemos h como está (possivelmente vazio)
                h = h || [];
            }

            if (!h.length) {
                if (rankingHistoryList) rankingHistoryList.innerHTML = `
                    <li style="padding:12px;text-align:center;color:#aaa;font-style:italic;">
                        Sem registros.
                    </li>`;
            } else {
                if (rankingHistoryList) {
                    rankingHistoryList.innerHTML = "";
                    h.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).forEach(l => {
                        const date = new Date(l.created_at).toLocaleString('pt-BR');
                        rankingHistoryList.innerHTML += `<li style='padding:8px;border-bottom:1px solid #444;color:#ddd;'>
<strong>${date}</strong><br>${esc(l.attacker_name)} atacou você e tomou ${Number(l.points_taken||0).toLocaleString()} pontos.
</li>`;
                    });
                }
            }

            if (rankingModal) rankingModal.style.display = 'flex';
        } catch (e) {
            console.error(e);
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
                document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
                const tn = tab.dataset.tab;
                if (tn === 'current') {
                    const el = document.getElementById('rankingCurrent');
                    if (el) el.classList.add('active');
                    await fetchAndRenderRanking(); // Chama a função corrigida
                } else if (tn === 'past') {
                    const el = document.getElementById('rankingPast');
                    if (el) el.classList.add('active');
                    await fetchPastSeasonRanking();
                } else {
                    const el = document.getElementById('rankingHistory');
                    if (el) el.classList.add('active');
                    await fetchAttackHistory();
                }
            });
        });
    }

    // --- Reset mensal da temporada (front-end safe call) ---
    // Objetivo: chamar a RPC reset_arena_season() apenas na virada do mês, minimizando chamadas.
    // Estratégia:
    // 1) Só tenta executar quando for dia 1 (UTC) — evita chamadas diárias.
    // 2) Mantém um registro local (localStorage) dizendo que já checamos/rodamos no mês atual.
    // 3) A RPC server-side deve ser idempotente e verificar se o snapshot já existe (evita duplicação se múltiplos clientes chamarem).

    async function checkAndResetArenaSeason() {
        try {
            const now = new Date();
            const utcDay = now.getUTCDate(); // usamos UTC para alinhar com o server
            if (utcDay !== 1) return; // só no primeiro dia do mês

            const year = now.getUTCFullYear();
            const month = now.getUTCMonth() + 1; // 1-12
            const ymd = `${year}-${String(month).padStart(2,'0')}`;

            const localKey = 'arena_reset_checked_' + ymd;
            if (localStorage.getItem(localKey)) {
                // já checamos/rodamos este mês neste browser
                return;
            }

            // Marca como checado imediatamente para evitar chamadas concorrentes do mesmo cliente
            try { localStorage.setItem(localKey, Date.now().toString()); } catch (e) {}

            // Chamada à RPC que faz snapshot + reseta pontos para 100 (server-side idempotente)
            const { data, error } = await supabase.rpc('reset_arena_season');
            if (error) {
                console.warn("Erro ao resetar temporada:", error.message || error);
                // se falhar, removemos a marca local para permitir nova tentativa nas próximas visitas
                try { localStorage.removeItem(localKey); } catch (e) {}
                return;
            }

            const r = normalizeRpcResult(data);
            if (r?.success) {
                console.log("✅ Temporada resetada via RPC:", r.message || r);
            } else {
                console.log("ℹ️ reset_arena_season retornou:", r?.message || r);
            }

        } catch (e) {
            console.error("checkAndResetArenaSeason erro:", e);
        }
    }

    // --- Boot ---
    async function boot() {
        showLoading();
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return (window.location.href = "index.html");
            userId = user.id;

            // Checa e, se necessário, executa o reset da temporada (apenas no dia 1 UTC e com marcação local)
            await checkAndResetArenaSeason();

            await supabase.rpc('reset_player_arena_attempts');
            await updateAttemptsUI();
        } catch (e) {
            console.error("Boot error:", e);
            document.body.innerHTML = "<p>Erro ao carregar Arena.</p>";
        } finally {
            hideLoading();
        }
    }

    // --- Eventos (liga handlers) ---
    if (challengeBtn) challengeBtn.addEventListener("click", handleChallengeClick);
    if (openRankingBtn) {
        openRankingBtn.addEventListener("click", async () => {
            const curTab = document.querySelector(".ranking-tab[data-tab='current']");
            if (curTab) {
                document.querySelectorAll(".ranking-tab").forEach(t => { t.classList.remove("active"); t.style.background = "none"; t.style.color = "#e0dccc"; });
                curTab.classList.add("active"); curTab.style.background = "#c9a94a"; curTab.style.color = "#000";
                document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
                const rc = document.getElementById("rankingCurrent");
                if (rc) rc.classList.add("active");
            }
            await fetchAndRenderRanking(); // Chama a função corrigida
        });
    }
    if (closeRankingBtn) closeRankingBtn.addEventListener("click", () => { if (rankingModal) rankingModal.style.display = 'none'; });
    initRankingTabs();

    boot();
});
