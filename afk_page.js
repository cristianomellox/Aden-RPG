import { supabase } from './supabaseClient.js'

// =======================================================================
// NOVO: ADEN GLOBAL DB (CÓPIA LOCAL PARA STANDALONE)
// Garante acesso aos dados compartilhados (Auth, Player, Stats)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 1;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(PLAYER_STORE)) db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(AUTH_STORE, 'readonly');
                const req = tx.objectStore(AUTH_STORE).get('current_session');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    getPlayer: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(PLAYER_STORE, 'readonly');
                const req = tx.objectStore(PLAYER_STORE).get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    setPlayer: async function(playerData) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            tx.objectStore(PLAYER_STORE).put({ key: 'player_data', value: playerData });
        } catch(e) { console.warn("Erro ao salvar Player no DB Global", e); }
    },
    // Atualiza apenas campos específicos no cache global (XP, Gold, Level)
    updatePlayerPartial: async function(changes) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            const store = tx.objectStore(PLAYER_STORE);
            const currentData = await new Promise(resolve => {
                const req = store.get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
            if (currentData) {
                const newData = { ...currentData, ...changes };
                store.put({ key: 'player_data', value: newData });
            }
        } catch(e) { console.warn("Erro update parcial", e); }
    }
};
// =======================================================================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM totalmente carregado. Iniciando script afk_page.js OTIMIZADO COM GLOBAL DB...");

    // 🎵 Sons e músicas
    const normalHitSound = new Audio("https://aden-rpg.pages.dev/assets/normal_hit.mp3");
    const criticalHitSound = new Audio("https://aden-rpg.pages.dev/assets/critical_hit.mp3");
    const idleMusic = new Audio("https://aden-rpg.pages.dev/assets/idlesong.mp3");
    const combatMusic = new Audio("https://aden-rpg.pages.dev/assets/combat_afk_bg.mp3");

    normalHitSound.volume = 0.5;
    criticalHitSound.volume = 0.1;
    idleMusic.volume = 0.2;
    combatMusic.volume = 0.4;
    idleMusic.loop = true;
    combatMusic.loop = true;


    // --- CONFIGURAÇÕES DE CÁLCULO (Sincronizado com SQL) ---
    const XP_RATE_PER_SEC = 1.0 / 1800; // Conforme SQL
    const GOLD_RATE_PER_SEC = 0;        // Conforme SQL
    const MAX_AFK_SECONDS = 4 * 60 * 60; // 4 horas
    const MIN_COLLECT_SECONDS = 3600;    // 1 hora
    const CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000; // Aumentado para 24h devido ao GlobalDB
    const STATS_CACHE_DURATION = 48 * 60 * 60 * 1000; // 12 Horas para stats de combate

    // --- UI ELEMENTS ---
    const afkXpSpan = document.getElementById("afk-xp");
    const afkGoldSpan = document.getElementById("afk-gold");
    const afkTimerSpan = document.getElementById("afk-timer");
    const afkStageSpan = document.getElementById("afk-stage");
    const collectBtn = document.getElementById("collect-rewards-idle");
    const startAfkBtn = document.getElementById("start-afk");
    const idleScreen = document.getElementById("idle-screen");
    const dailyAttemptsLeftSpan = document.getElementById("daily-attempts-left");
    const startAfkCooldownDisplay = document.getElementById("start-afk-cooldown-display");
    const saibaMaisBtn = document.getElementById("saiba-mais");
    const playerTotalXpSpan = document.getElementById("player-total-xp");
    const playerTotalGoldSpan = document.getElementById("player-total-gold");
    
    // Combat UI
    const combatScreen = document.getElementById("combat-screen");
    const monsterNameSpan = document.getElementById("monster-name");
    const monsterImage = document.getElementById("monsterImage");
    const monsterHpFill = document.getElementById("monster-hp-fill");
    const monsterHpBar = document.getElementById("monster-hp-bar");
    const monsterHpValueSpan = document.getElementById("monster-hp-value");
    const battleCountdownDisplay = document.getElementById("battle-countdown");
    const attacksLeftSpan = document.getElementById("time-left");

    // Modals
    const resultModal = document.getElementById("result-modal");
    const resultText = document.getElementById("result-text");
    const confirmBtn = document.getElementById("confirm-btn");
    const returnMainIdleBtn = document.getElementById("return-main-idle");
    const tutorialModal = document.getElementById("tutorial-modal");
    const closeTutorialBtn = document.getElementById("close-tutorial-btn");
    const musicPermissionModal = document.getElementById("music-permission-modal");
    const musicPermissionBtn = document.getElementById("music-permission-btn");
    const adventureOptionsModal = document.getElementById("adventure-options-modal");
    const btnFarmPrevious = document.getElementById("btn-farm-previous");
    const btnChallengeCurrent = document.getElementById("btn-challenge-current");
    const closeAdventureOptionsBtn = document.getElementById("close-adventure-options");
    const farmStageNumberSpan = document.getElementById("farm-stage-number");
    const challengeStageNumberSpan = document.getElementById("challenge-stage-number");

    // --- STATE MANAGEMENT ---
    let playerAfkData = {}; // Cache em memória
    let afkStartTime = null;
    let timerInterval;
    let localSimulationInterval;
    let cachedCombatStats = null; // Stats de combate (Dano, Crit) - Compartilhado com Mina
    let userId = null; // Inicializa nulo para validação posterior

    // --- HELPER DE AUTH OTIMISTA (ZERO EGRESS) ---
    async function getLocalUserId() {
        // 1. Tenta Auth GlobalDB
        const globalAuth = await GlobalDB.getAuth();
        if (globalAuth && globalAuth.value && globalAuth.value.user) {
            return globalAuth.value.user.id;
        }

        // 2. Fallback LocalStorage (Legacy)
        try {
            const cached = localStorage.getItem('player_data_cache');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.data && parsed.data.id) return parsed.data.id;
                if (parsed && parsed.id) return parsed.id;
            }
        } catch (e) {}
        
        // 3. Fallback Supabase Key
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                    const session = JSON.parse(localStorage.getItem(k));
                    if (session?.user?.id) return session.user.id;
                }
            }
        } catch (e) {}
        return null;
    }

    // --- VISUAL FORMATTING ---
    function formatNumberCompact(num) {
        return new Intl.NumberFormat('en-US').format(num);
    }

    // --- CORE LOGIC: SIMULAÇÃO LOCAL (Zero Egress) ---
    function updateLocalSimulation() {
        if (!afkStartTime || !playerAfkData) return;

        const now = Date.now();
        let secondsElapsed = Math.floor((now - afkStartTime) / 1000);
        
        // Timer Visual
        const displaySeconds = Math.min(secondsElapsed, MAX_AFK_SECONDS);
        const remainingSeconds = Math.max(0, MAX_AFK_SECONDS - displaySeconds);
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;
        afkTimerSpan.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        // Reward Calculation
        const cappedSeconds = Math.min(secondsElapsed, MAX_AFK_SECONDS);
        const stage = playerAfkData.current_afk_stage || 1;
        
        let xpEarned = Math.floor(cappedSeconds * XP_RATE_PER_SEC * stage);
        let goldEarned = Math.floor(cappedSeconds * GOLD_RATE_PER_SEC);

        afkXpSpan.textContent = formatNumberCompact(xpEarned);
        afkGoldSpan.textContent = formatNumberCompact(goldEarned);

        // Botão Coletar
        const isCollectable = (xpEarned > 0 || goldEarned > 0) && (secondsElapsed >= MIN_COLLECT_SECONDS);
        collectBtn.disabled = !isCollectable;
        if(collectBtn.disabled) {
            collectBtn.style.opacity = "0.5";
            collectBtn.style.cursor = "not-allowed";
        } else {
             collectBtn.style.opacity = "1";
             collectBtn.style.cursor = "pointer";
        }
    }

    // --- NOVO: CACHE DE COMBAT STATS (Sincronizado com Mina) ---
    async function getOrUpdatePlayerStatsCache(forceUpdate = false) {
        if (!userId) return null;
        const now = Date.now();
        // NOTA: Usa a MESMA chave da mina para compartilhar o cache
        const cacheKey = `player_combat_stats_${userId}`; 
        
        // Tenta ler do LocalStorage
        let stored = localStorage.getItem(cacheKey);
        if (stored && !forceUpdate) {
            try {
                const parsed = JSON.parse(stored);
                // Verifica validade (12h)
                if (now - parsed.timestamp < STATS_CACHE_DURATION) {
                    cachedCombatStats = parsed.data;
                    console.log("[AFK] Combat stats carregados do cache local.");
                    return cachedCombatStats;
                }
            } catch(e) { console.warn("Cache stats inválido", e); }
        }
        return null;
    }

    // --- DATA MANAGEMENT (Cache & Sync) ---
    
    function renderPlayerData() {
        if (!playerAfkData) return;
        
        if (playerAfkData.last_afk_start_time) {
            afkStartTime = new Date(playerAfkData.last_afk_start_time).getTime();
        } else {
            afkStartTime = Date.now();
        }

        playerTotalXpSpan.textContent = formatNumberCompact(playerAfkData.xp || 0);
        playerTotalGoldSpan.textContent = formatNumberCompact(playerAfkData.gold || 0);
        afkStageSpan.textContent = playerAfkData.current_afk_stage ?? 1;
        dailyAttemptsLeftSpan.textContent = playerAfkData.daily_attempts_left ?? 0;
        
        updateStartAfkButtonState(playerAfkData.daily_attempts_left ?? 0);
        updateLocalSimulation();
    }

    // Helper para salvar cache otimizado (GlobalDB)
    async function saveToCache(data) {
        if (!userId) return;
        // 1. Salva no GlobalDB (IndexedDB)
        await GlobalDB.setPlayer(data);
        
        // 2. Mantém compatibilidade com LocalStorage (Legacy) para outras páginas que ainda não migraram
        const cacheKey = `playerAfkData_${userId}`;
        localStorage.setItem(cacheKey, JSON.stringify({ data: data, timestamp: Date.now() }));
    }

    async function initializePlayerData() {
        // 1. Tenta recuperar ID localmente primeiro
        userId = await getLocalUserId();

        // 2. Se não encontrar, tenta obter da sessão do Supabase
        if (!userId) {
            const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
            if (sessionData && sessionData.session) {
                userId = sessionData.session.user.id;
            } else {
                console.warn("Nenhum usuário autenticado encontrado. Redirecionando para login.");
                window.location.href = "index.html";
                return;
            }
        }

        // --- BLINDAGEM DE SESSÃO E CACHE ---

        // 3. Tenta carregar/validar cache de combate
        await getOrUpdatePlayerStatsCache();

        // 4. Lógica Otimizada: Tenta ler do GlobalDB primeiro
        let shouldUseCache = false;
        
        // Tenta GlobalDB
        // Tenta GlobalDB
        const globalData = await GlobalDB.getPlayer();
        if (globalData) {
            // Verifica se é o usuário correto E se tem o dado vital 'last_afk_start_time'
            // Se não tiver o start_time, o cache é considerado "incompleto" para esta página
            if (globalData.id === userId && globalData.last_afk_start_time) {
                playerAfkData = globalData;
                shouldUseCache = true;
                console.log("[AFK] Dados carregados via GlobalDB (Zero Egress).");
            } else {
                console.warn("[AFK] Cache GlobalDB encontrado, mas incompleto (falta timestamp). Forçando fetch no servidor.");
            }
        }

        // Fallback: Tenta LocalStorage Legacy
        if (!shouldUseCache) {
            const cacheKey = `playerAfkData_${userId}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const { data, timestamp } = JSON.parse(cached);
                    if (Date.now() - timestamp < CACHE_EXPIRATION_MS) {
                        playerAfkData = data;
                        shouldUseCache = true;
                    }
                } catch (e) {}
            }
        }

        // Reset Diário Otimizado
        if (shouldUseCache) {
            const lastResetDate = new Date(playerAfkData.last_attempt_reset || 0);
            const now = new Date();
            const isNewDayUtc = now.getUTCDate() !== lastResetDate.getUTCDate() || 
                                now.getUTCMonth() !== lastResetDate.getUTCMonth() || 
                                now.getUTCFullYear() !== lastResetDate.getUTCFullYear();

            if (isNewDayUtc) {
                console.log("Virada de dia detectada (UTC). Verificando reset via RPC leve...");
                const { data: resetData, error: resetError } = await supabase.rpc('check_daily_reset', { p_player_id: userId });
                if (!resetError && resetData) {
                    playerAfkData.daily_attempts_left = resetData.daily_attempts_left;
                    if (resetData.reset_performed) {
                        playerAfkData.last_attempt_reset = new Date().toISOString(); 
                    }
                    saveToCache(playerAfkData);
                }
            }
        }

        if (!shouldUseCache) {
            console.log("Cache inválido ou inexistente. Buscando dados completos no servidor...");
            
            let { data, error } = await supabase.rpc('get_player_afk_data', { uid: userId });

            if (error || (data && data.error)) {
                console.warn("Erro ao buscar dados ou Token Expirado. Tentando refresh...", error || data?.error);
                const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
                
                if (!refreshError && refreshData.session) {
                    userId = refreshData.session.user.id; 
                    const retry = await supabase.rpc('get_player_afk_data', { uid: userId });
                    data = retry.data;
                    error = retry.error;
                } else {
                    window.location.href = "index.html"; 
                    return;
                }
            }

            if (data && !error && !data.error) {
                playerAfkData = data;
                
                // Sincroniza o cache local de combate
                if (playerAfkData.cached_combat_stats) {
                    const statsKey = `player_combat_stats_${userId}`;
                    localStorage.setItem(statsKey, JSON.stringify({
                        timestamp: Date.now(),
                        data: playerAfkData.cached_combat_stats
                    }));
                }
                saveToCache(playerAfkData);
            }
        }

        renderPlayerData();
        
        if (localSimulationInterval) clearInterval(localSimulationInterval);
        localSimulationInterval = setInterval(updateLocalSimulation, 1000);
    }

    function updateStartAfkButtonState(attemptsLeft) {
        if (attemptsLeft <= 0) {
            startAfkBtn.disabled = true;
            startAfkBtn.style.opacity = "0.5";
            startAfkBtn.style.cursor = "not-allowed";
        } else {
            startAfkBtn.disabled = false;
            startAfkBtn.style.opacity = "1";
            startAfkBtn.style.cursor = "pointer";
        }
    }

    // --- AÇÕES DO JOGADOR ---

    collectBtn.addEventListener("click", async () => {
        if (!userId || collectBtn.disabled) return;
        collectBtn.disabled = true; 
        
        // Chama a procedure que calcula e aplica XP/Ouro e Level Up
        const { data, error } = await supabase.rpc('collect_afk_rewards', { uid: userId });
        
        if (error) {
            console.error("Erro ao coletar:", error);
            collectBtn.disabled = false;
            return;
        }

        // Otimização: A procedure 'collect_afk_rewards' já retorna o novo estado (XP, Nível, etc)
        // ou o delta. Vamos assumir que ela retorna os dados para atualizar o cliente.
        // Baseado no script SQL fornecido (check_and_level_up_player), o update já ocorre no banco.
        
        // Atualiza objeto local com o retorno da RPC
        if (data) {
            // Atualiza XP acumulado e Ouro
            if (data.xp_earned) playerAfkData.xp = (playerAfkData.xp || 0) + data.xp_earned;
            if (data.gold_earned) playerAfkData.gold = (playerAfkData.gold || 0) + data.gold_earned;
            
            // Reseta timer
            playerAfkData.last_afk_start_time = new Date().toISOString();

            // Se houve Level Up, a RPC deve retornar os novos stats e nível
            if (data.leveled_up) {
                playerAfkData.level = data.new_level;
                
                // Se a RPC retornar os novos stats (attack, def, health), atualizamos também
                // Isso garante que o cache global tenha os stats corretos para Arena/Mina
                if (data.new_attack) playerAfkData.attack = data.new_attack;
                if (data.new_defense) playerAfkData.defense = data.new_defense;
                if (data.new_health) playerAfkData.health = data.new_health;
                if (data.new_min_attack) playerAfkData.min_attack = data.new_min_attack;
                if (data.new_xp_needed) playerAfkData.xp_needed_for_level = data.new_xp_needed;

                showLevelUpBalloon(data.new_level);
            } else if (data.new_xp_needed) {
                // Mesmo sem upar, o requisito pode mudar (ex: visualização)
                playerAfkData.xp_needed_for_level = data.new_xp_needed;
            }
        }

        // Atualiza o GlobalDB imediatamente para que o Index.js leia o novo nível/XP sem fetch
        await saveToCache(playerAfkData);
        
        // Se houve mudança de stats (level up), atualiza também a tabela parcial de stats se estivermos usando uma store separada,
        // mas o saveToCache acima já atualiza o objeto player completo no PLAYER_STORE.
        
        renderPlayerData();

        resultText.textContent = `Você coletou ${formatNumberCompact(data.xp_earned || 0)} XP e ${formatNumberCompact(data.gold_earned || 0)} Ouro!`;
        resultModal.style.display = "block";
    });

    async function triggerAdventure(isFarming) {
        if (adventureOptionsModal) adventureOptionsModal.style.display = "none";

        const { data, error } = await supabase.rpc('start_afk_adventure', { 
            p_player_id: userId,
            p_farm_mode: isFarming
        });

        if (error || !data?.success) {
            const msg = data?.message || error?.message || "Erro desconhecido.";
            resultText.textContent = msg;
            resultModal.style.display = "block";
            // Força recarga do cache se der erro crítico de sincronia
            localStorage.removeItem(`playerAfkData_${userId}`);
            initializePlayerData();
            return;
        }

        // Atualiza estado local com resultado da aventura
        playerAfkData.daily_attempts_left = data.daily_attempts_left;
        
        if (data.venceu) {
            playerAfkData.xp = (playerAfkData.xp || 0) + (data.xp_ganho || 0);
            playerAfkData.gold = (playerAfkData.gold || 0) + (data.gold_ganho || 0);
            if (!isFarming) {
                playerAfkData.current_afk_stage = (playerAfkData.current_afk_stage || 1) + 1;
            }
        }
        
        if (data.leveled_up) {
            playerAfkData.level = data.new_level;
            // Se houver dados de stats retornados na aventura, atualizar aqui também
            // (Assumindo que start_afk_adventure também pode retornar stats atualizados se upou)
            if (data.new_stats) {
                Object.assign(playerAfkData, data.new_stats);
            }
        }

        // Salva estado atualizado no GlobalDB
        await saveToCache(playerAfkData);
        renderPlayerData();

        if (isFarming) {
            const message = `FARM CONCLUÍDO! Ganhou ${formatNumberCompact(data.xp_ganho)} XP e ${formatNumberCompact(data.gold_ganho)} Ouro! (Estágio mantido)`;
            resultText.textContent = message;
            resultModal.style.display = "block";
            if (data.leveled_up) showLevelUpBalloon(data.new_level);
        } else {
            runCombatAnimation(data);
        }
    }

    function runCombatAnimation(data) {
        showCombatScreen();
        const targetStage = data.target_stage; 
        monsterNameSpan.textContent = `Monstro do Estágio ${targetStage}`;
        monsterImage.src = window.monsterStageImages?.[Math.floor(Math.random() * window.monsterStageImages.length)] || '';

        monsterHpBar.style.display = 'none';
        attacksLeftSpan.style.display = 'none';
        battleCountdownDisplay.style.display = 'block';
        
        let countdown = 3;
        battleCountdownDisplay.textContent = `Batalha em: ${countdown}`;

        const countdownIntervalId = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                battleCountdownDisplay.textContent = `Batalha em: ${countdown}`;
            } else {
                clearInterval(countdownIntervalId);
                battleCountdownDisplay.style.display = 'none';
                monsterHpBar.style.display = 'flex';
                attacksLeftSpan.style.display = 'block';

                const monsterMaxHp = data.monster_hp_inicial; 
                let currentMonsterHp = monsterMaxHp; 
                
                monsterHpValueSpan.textContent = `${formatNumberCompact(currentMonsterHp)} / ${formatNumberCompact(monsterMaxHp)}`;
                monsterHpFill.style.width = '100%'; 

                const attackLog = data.attacks || [];
                attacksLeftSpan.textContent = attackLog.length;

                let currentAttackIndex = 0;
                
                // --- INICIO DA OTIMIZAÇÃO: Animação com suporte a log compactado ---
                const animateAttack = () => {
                    if (currentAttackIndex < attackLog.length) {
                        const attackData = attackLog[currentAttackIndex];
                        let damage, isCrit;

                        // Verifica se é o formato novo (Array) ou antigo (Objeto)
                        if (Array.isArray(attackData)) {
                            damage = attackData[0];
                            isCrit = attackData[1] === 1; // 1 é true
                        } else {
                            damage = attackData.damage;
                            isCrit = attackData.is_crit;
                        }

                        displayDamageNumber(damage, isCrit);

                        if (isCrit) {
                            criticalHitSound.currentTime = 0;
                            criticalHitSound.play().catch(()=>{});
                        } else {
                            normalHitSound.currentTime = 0;
                            normalHitSound.play().catch(()=>{});
                        }
                        const mImg = document.getElementById("monsterImage");
                        if (mImg) {
                            mImg.classList.remove('shake-animation');
                            void mImg.offsetWidth;
                            mImg.classList.add('shake-animation');
                            setTimeout(() => {
                                mImg.classList.remove('shake-animation');
                            }, 300);
                        }
                        currentMonsterHp = Math.max(0, currentMonsterHp - damage);
                        const pct = (currentMonsterHp / monsterMaxHp) * 100;
                        monsterHpFill.style.width = `${pct}%`;
                        monsterHpValueSpan.textContent = `${formatNumberCompact(currentMonsterHp)} / ${formatNumberCompact(monsterMaxHp)}`;

                        currentAttackIndex++;
                        attacksLeftSpan.textContent = attackLog.length - currentAttackIndex; 
                        
                        setTimeout(animateAttack, 1000);
                    } else {
                        let message = "";
                        if (data.venceu) {
                            message = `VITÓRIA! Ganhou ${formatNumberCompact(data.xp_ganho)} XP, ${formatNumberCompact(data.gold_ganho)} Ouro e AVANÇOU de estágio!`;
                        } else {
                            message = `Você não derrotou o monstro. Tente melhorar seus equipamentos!`;
                        }
                        
                        resultText.textContent = message;
                        resultModal.style.display = "block";
                        if (data.leveled_up) showLevelUpBalloon(data.new_level);
                    }
                };
                // --- FIM DA OTIMIZAÇÃO ---
                
                animateAttack();
            }
        }, 1000);
    }

    // --- AUXILIARES VISUAIS ---
    function showIdleScreen() {
        idleScreen.style.display = "flex";
        combatScreen.style.display = "none";
        combatMusic.pause();
        idleMusic.play().catch(() => {});
        renderPlayerData(); 
    }

    function showCombatScreen() {
        idleScreen.style.display = "none";
        combatScreen.style.display = "flex";
        idleMusic.pause();
        combatMusic.play().catch(() => {});
    }

    function displayDamageNumber(damage, isCrit) {
        const damageNum = document.createElement("div");
        damageNum.textContent = formatNumberCompact(damage);
        damageNum.className = isCrit ? "crit-damage-number" : "normal-damage-number";
        
        damageNum.style.position = "absolute";
        damageNum.style.left = "50%";
        damageNum.style.top = "40%";
        damageNum.style.transform = "translate(-50%, -50%)";
        
        damageNum.style.animation = "floatAndFade 1.5s forwards";
        combatScreen.appendChild(damageNum);
        damageNum.addEventListener("animationend", () => damageNum.remove());
    }

    function showLevelUpBalloon(newLevel) {
        const balloon = document.getElementById("levelUpBalloon");
        const text = document.getElementById("levelUpBalloonText");
        text.innerText = newLevel;
        balloon.style.display = "block";
        setTimeout(() => balloon.style.display = "none", 5000);
    }

    // --- EVENT LISTENERS ---

    musicPermissionBtn.addEventListener("click", () => {
        musicPermissionModal.style.display = "none";
        [combatMusic, normalHitSound, criticalHitSound].forEach(audio => {
            audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
            }).catch(()=>{});
        });
        showIdleScreen();
    });

    startAfkBtn.addEventListener("click", () => {
        if (startAfkBtn.disabled || !userId) return;
        const currentStage = playerAfkData.current_afk_stage || 1;
        if (challengeStageNumberSpan) challengeStageNumberSpan.textContent = currentStage;
        if (currentStage > 1) {
            if (farmStageNumberSpan) farmStageNumberSpan.textContent = currentStage - 1;
            if (btnFarmPrevious) btnFarmPrevious.style.display = "block"; 
        } else {
            if (btnFarmPrevious) btnFarmPrevious.style.display = "none";
        }
        if (adventureOptionsModal) adventureOptionsModal.style.display = "flex";
    });

    if (btnFarmPrevious) btnFarmPrevious.addEventListener("click", () => triggerAdventure(true));
    if (btnChallengeCurrent) btnChallengeCurrent.addEventListener("click", () => triggerAdventure(false));
    if (closeAdventureOptionsBtn) closeAdventureOptionsBtn.addEventListener("click", () => adventureOptionsModal.style.display = "none");

    confirmBtn.addEventListener("click", () => {
        resultModal.style.display = "none";
        showIdleScreen(); 
    });
    
    returnMainIdleBtn.addEventListener("click", () => {
        window.location.href = "index.html?refresh=true";
    });

    saibaMaisBtn.addEventListener("click", () => tutorialModal.style.display = "flex");
    closeTutorialBtn.addEventListener("click", () => tutorialModal.style.display = "none");

    // --- INICIALIZAÇÃO ---
    initializePlayerData();
});