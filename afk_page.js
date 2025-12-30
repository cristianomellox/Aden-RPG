import { supabase } from './supabaseClient.js'

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
    }
};

// =======================================================================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM totalmente carregado. Iniciando script afk_page.js CORREÇÃO DE TIMER...");

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

    // --- CONFIGURAÇÕES DE CÁLCULO ---
    const XP_RATE_PER_SEC = 1.0 / 1800; 
    const GOLD_RATE_PER_SEC = 0;        
    const MAX_AFK_SECONDS = 4 * 60 * 60; // 4 horas
    const MIN_COLLECT_SECONDS = 3600;    // 1 hora
    const CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000; 
    const STATS_CACHE_DURATION = 48 * 60 * 60 * 1000; 

    // --- UI ELEMENTS ---
    const afkXpSpan = document.getElementById("afk-xp");
    const afkGoldSpan = document.getElementById("afk-gold");
    const afkTimerSpan = document.getElementById("afk-timer");
    const afkStageSpan = document.getElementById("afk-stage");
    const collectBtn = document.getElementById("collect-rewards-idle");
    const startAfkBtn = document.getElementById("start-afk");
    const idleScreen = document.getElementById("idle-screen");
    const dailyAttemptsLeftSpan = document.getElementById("daily-attempts-left");
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
    let playerAfkData = {}; 
    let afkStartTime = null;
    let localSimulationInterval;
    let cachedCombatStats = null; 
    let userId = null; 

    // --- HELPER DE AUTH ---
    async function getLocalUserId() {
        const globalAuth = await GlobalDB.getAuth();
        if (globalAuth && globalAuth.value && globalAuth.value.user) {
            return globalAuth.value.user.id;
        }
        try {
            const cached = localStorage.getItem('player_data_cache');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.data && parsed.data.id) return parsed.data.id;
                if (parsed && parsed.id) return parsed.id;
            }
        } catch (e) {}
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

    function formatNumberCompact(num) {
        return new Intl.NumberFormat('en-US').format(num);
    }

    // --- SIMULAÇÃO LOCAL ---
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

    async function getOrUpdatePlayerStatsCache(forceUpdate = false) {
        if (!userId) return null;
        const cacheKey = `player_combat_stats_${userId}`; 
        let stored = localStorage.getItem(cacheKey);
        if (stored && !forceUpdate) {
            try {
                const parsed = JSON.parse(stored);
                if (Date.now() - parsed.timestamp < STATS_CACHE_DURATION) {
                    cachedCombatStats = parsed.data;
                    return cachedCombatStats;
                }
            } catch(e) {}
        }
        return null;
    }

    // --- DATA MANAGEMENT ---
    
    function renderPlayerData() {
        if (!playerAfkData) return;
        
        // Verifica o campo correto vindo do DB
        const startTimeStr = playerAfkData.last_afk_start_time || playerAfkData.last_afk_start;
        
        if (startTimeStr) {
            afkStartTime = new Date(startTimeStr).getTime();
            // Segurança extra: data inválida ou no futuro
            if (isNaN(afkStartTime) || afkStartTime > Date.now()) {
                console.warn("Data de AFK inválida ou futura, resetando visualmente.");
                afkStartTime = Date.now();
            }
        } else {
            console.log("Nenhum tempo anterior encontrado, iniciando contagem visual agora.");
            afkStartTime = Date.now();
        }

        playerTotalXpSpan.textContent = formatNumberCompact(playerAfkData.xp || 0);
        playerTotalGoldSpan.textContent = formatNumberCompact(playerAfkData.gold || 0);
        afkStageSpan.textContent = playerAfkData.current_afk_stage ?? 1;
        dailyAttemptsLeftSpan.textContent = playerAfkData.daily_attempts_left ?? 0;
        
        updateStartAfkButtonState(playerAfkData.daily_attempts_left ?? 0);
        updateLocalSimulation();
    }

    // Helper para salvar cache otimizado
    async function saveToCache(data) {
        if (!userId) return;
        if (!data.id) data.id = userId;
        await GlobalDB.setPlayer(data);
        const cacheKey = `playerAfkData_${userId}`;
        localStorage.setItem(cacheKey, JSON.stringify({ data: data, timestamp: Date.now() }));
    }

    async function initializePlayerData() {
        userId = await getLocalUserId();

        if (!userId) {
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData && sessionData.session) {
                userId = sessionData.session.user.id;
            } else {
                window.location.href = "index.html";
                return;
            }
        }

        await getOrUpdatePlayerStatsCache();

        let shouldUseCache = false;
        
        // Tenta GlobalDB
        const globalData = await GlobalDB.getPlayer();
        if (globalData) {
            // FIX CRÍTICO: Só usa o cache se tiver o ID E a data de início válida
            // Se não tiver data, o cache é inútil para o AFK e vai causar o reset
            const hasValidTime = globalData.last_afk_start_time || globalData.last_afk_start;
            
            if (globalData.id === userId && hasValidTime) {
                playerAfkData = globalData;
                shouldUseCache = true;
                console.log("[AFK] Dados válidos carregados via GlobalDB.");
            } else {
                console.log("[AFK] Cache incompleto (sem data de início). Forçando busca no servidor.");
            }
        }

        // Fallback LocalStorage (também com validação de tempo)
        if (!shouldUseCache) {
            const cacheKey = `playerAfkData_${userId}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const { data, timestamp } = JSON.parse(cached);
                    const hasValidTime = data.last_afk_start_time || data.last_afk_start;
                    
                    if ((Date.now() - timestamp < CACHE_EXPIRATION_MS) && hasValidTime) {
                        playerAfkData = data;
                        shouldUseCache = true;
                    }
                } catch (e) {}
            }
        }

        // Se o cache falhou ou estava incompleto, busca no servidor
        if (!shouldUseCache) {
            console.log("Buscando dados limpos no servidor...");
            
            let { data, error } = await supabase.rpc('get_player_afk_data', { uid: userId });

            if (error || (data && data.error)) {
                const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
                if (!refreshError && refreshData.session) {
                    userId = refreshData.session.user.id; 
                    const retry = await supabase.rpc('get_player_afk_data', { uid: userId });
                    data = retry.data;
                    error = retry.error;
                } else {
                    return;
                }
            }

            if (data && !error && !data.error) {
                playerAfkData = data;
                playerAfkData.id = userId;

                // Garante que o objeto tenha o campo unificado para evitar confusão futura
                if (!playerAfkData.last_afk_start_time && playerAfkData.last_afk_start) {
                    playerAfkData.last_afk_start_time = playerAfkData.last_afk_start;
                }

                if (playerAfkData.cached_combat_stats) {
                    const statsKey = `player_combat_stats_${userId}`;
                    localStorage.setItem(statsKey, JSON.stringify({
                        timestamp: Date.now(),
                        data: playerAfkData.cached_combat_stats
                    }));
                }
                saveToCache(playerAfkData);
            }
        } else {
            // Se usou cache, faz verificação leve de reset diário
            const lastResetDate = new Date(playerAfkData.last_attempt_reset || 0);
            const now = new Date();
            const isNewDayUtc = now.getUTCDate() !== lastResetDate.getUTCDate() || 
                                now.getUTCMonth() !== lastResetDate.getUTCMonth();

            if (isNewDayUtc) {
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
        
        const { data, error } = await supabase.rpc('collect_afk_rewards', { uid: userId });
        
        if (error) {
            console.error("Erro ao coletar:", error);
            collectBtn.disabled = false;
            return;
        }

        if (data) {
            if (data.xp_earned) playerAfkData.xp = (playerAfkData.xp || 0) + data.xp_earned;
            if (data.gold_earned) playerAfkData.gold = (playerAfkData.gold || 0) + data.gold_earned;
            
            // Atualiza data de início para agora
            playerAfkData.last_afk_start_time = new Date().toISOString();
            playerAfkData.last_afk_start = playerAfkData.last_afk_start_time; // Compatibilidade

            if (data.leveled_up) {
                playerAfkData.level = data.new_level;
                if (data.new_attack) playerAfkData.attack = data.new_attack;
                if (data.new_defense) playerAfkData.defense = data.new_defense;
                if (data.new_health) playerAfkData.health = data.new_health;
                if (data.new_min_attack) playerAfkData.min_attack = data.new_min_attack;
                if (data.new_xp_needed) playerAfkData.xp_needed_for_level = data.new_xp_needed;

                showLevelUpBalloon(data.new_level);
            } else if (data.new_xp_needed) {
                playerAfkData.xp_needed_for_level = data.new_xp_needed;
            }
        }

        await saveToCache(playerAfkData);
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
            resultText.textContent = data?.message || "Erro desconhecido.";
            resultModal.style.display = "block";
            // Limpa cache para forçar reload na próxima
            localStorage.removeItem(`playerAfkData_${userId}`);
            initializePlayerData();
            return;
        }

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
            if (data.new_stats) Object.assign(playerAfkData, data.new_stats);
        }

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
                
                const animateAttack = () => {
                    if (currentAttackIndex < attackLog.length) {
                        const attackData = attackLog[currentAttackIndex];
                        let damage, isCrit;

                        if (Array.isArray(attackData)) {
                            damage = attackData[0];
                            isCrit = attackData[1] === 1; 
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