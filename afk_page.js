import { supabase } from './supabaseClient.js'

// =======================================================================
// NOVO: ADEN GLOBAL DB (CÓPIA LOCAL PARA STANDALONE)
// Garante acesso aos dados compartilhados (Auth, Player, Stats)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 2;
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
// HELPER: MAPPER DE PROTOCOLO COMPACTO
// Converte os arrays do SQL otimizado de volta para Objetos JS
// =======================================================================
function mapLoadData(arr, uid) {
    // SQL Retorna: [0:Success, 1:XP, 2:Gold, 3:Stage, 4:Attempts, 5:MonsterHP, 6:AttacksLeft, 7:StartEpoch, 8:Level]
    if (!arr || !Array.isArray(arr) || arr[0] !== 1) return null;
    
    return {
        id: uid, // Reinsere o ID localmente
        xp: arr[1],
        gold: arr[2],
        current_afk_stage: arr[3],
        daily_attempts_left: arr[4],
        current_monster_health: arr[5],
        remaining_attacks_in_combat: arr[6],
        last_afk_start_time: arr[7] ? new Date(arr[7] * 1000).toISOString() : new Date().toISOString(),
        level: arr[8]
        // cached_combat_stats foi removido do fetch inicial para economizar dados
    };
}

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


    // --- CONFIGURAÇÕES DE CÁLCULO ---
    const XP_RATE_PER_SEC = 1.0 / 1800; 
    const GOLD_RATE_PER_SEC = 0 / 3600;        
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
    let playerAfkData = {}; 
    let afkStartTime = null;
    let timerInterval;
    let localSimulationInterval;
    let cachedCombatStats = null; 
    let userId = null; 

    // --- HELPER DE AUTH OTIMISTA (ZERO EGRESS) ---
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

    // --- CACHE DE COMBAT STATS ---
    async function getOrUpdatePlayerStatsCache(forceUpdate = false) {
        if (!userId) return null;
        const now = Date.now();
        const cacheKey = `player_combat_stats_${userId}`; 
        
        let stored = localStorage.getItem(cacheKey);
        if (stored && !forceUpdate) {
            try {
                const parsed = JSON.parse(stored);
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

    async function saveToCache(data) {
        if (!userId) return;
        // 1. Salva no GlobalDB (IndexedDB)
        await GlobalDB.setPlayer(data);
        
        // 2. Fallback LocalStorage (Legacy)
        const cacheKey = `playerAfkData_${userId}`;
        localStorage.setItem(cacheKey, JSON.stringify({ data: data, timestamp: Date.now() }));
    }

    async function initializePlayerData() {
        userId = await getLocalUserId();

        if (!userId) {
            const { data: sessionData, error: sessionError } = await supabase.auth.getSession({ cache: 'memory-only' });
            if (sessionData && sessionData.session) {
                userId = sessionData.session.user.id;
            } else {
                console.warn("Nenhum usuário autenticado encontrado. Redirecionando para login.");
                window.location.href = "index.html";
                return;
            }
        }

        // --- BLINDAGEM DE SESSÃO E CACHE ---
        await getOrUpdatePlayerStatsCache();

        let shouldUseCache = false;
        
        // Tenta GlobalDB
        const globalData = await GlobalDB.getPlayer();
        if (globalData) {
            if (globalData.id === userId && globalData.last_afk_start_time) {
                playerAfkData = globalData;
                shouldUseCache = true;
                console.log("[AFK] Dados carregados via GlobalDB (Zero Egress).");
            } else {
                console.warn("[AFK] Cache GlobalDB incompleto. Forçando fetch.");
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
                // RPC check_daily_reset (mantida como está ou otimizada no backend)
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
            console.log("Cache inválido ou inexistente. Buscando dados (Protocolo Compacto)...");
            
            // OTIMIZAÇÃO: Recebe Array ao invés de Objeto
            let { data, error } = await supabase.rpc('get_player_afk_data', { uid: userId });

            if (error || (data && data.error)) {
                // Tentativa de refresh se token expirado
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

            // Verifica se é o novo formato (Array) com índice 0 = 1 (Sucesso)
            if (data && Array.isArray(data) && data[0] === 1) {
                playerAfkData = mapLoadData(data, userId);
                
                // NOTA: Stats de combate não vêm mais nessa chamada para economizar dados
                // Se o cache local de stats estiver vazio, buscamos sob demanda (opcional)
                // ou confiamos que o GlobalDB já os tem de outras telas.
                
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
        
        const { data, error } = await supabase.rpc('collect_afk_rewards', { uid: userId });
        
        if (error) {
            console.error("Erro ao coletar:", error);
            collectBtn.disabled = false;
            return;
        }

        // OTIMIZAÇÃO: Protocolo Compacto
        // SQL Retorno: [1:Success, 2:XP_Gained, 3:Gold_Gained, 4:New_Level, 5:Leveled_Up(0/1)]
        if (data && Array.isArray(data) && data[0] === 1) {
            const xpGained = data[1];
            const goldGained = data[2];
            const newLevel = data[3]; // Pode ser string "Maximo"
            const isLevelUp = data[4] === 1;

            if (xpGained) playerAfkData.xp = (playerAfkData.xp || 0) + xpGained;
            if (goldGained) playerAfkData.gold = (playerAfkData.gold || 0) + goldGained;
            
            playerAfkData.last_afk_start_time = new Date().toISOString();

            if (isLevelUp) {
                playerAfkData.level = newLevel;
                // Como não retornamos stats novos na coleta compacta, 
                // não atualizamos attack/def aqui para economizar bytes.
                showLevelUpBalloon(newLevel);
            }

            await saveToCache(playerAfkData);
            renderPlayerData();

            resultText.textContent = `Você coletou ${formatNumberCompact(xpGained)} XP e ${formatNumberCompact(goldGained)} Ouro!`;
            resultModal.style.display = "block";
        } else {
            // Se retornar erro ou formato antigo por engano
            collectBtn.disabled = false;
        }
    });

    async function triggerAdventure(isFarming) {
        if (adventureOptionsModal) adventureOptionsModal.style.display = "none";

        const { data, error } = await supabase.rpc('start_afk_adventure', { 
            p_player_id: userId,
            p_farm_mode: isFarming
        });

        // OTIMIZAÇÃO: Protocolo Compacto
        // SQL Retorno: [0:Success, 1:Win(0/1), 2:XP, 3:Gold, 4:Level, 5:HP_Restante, 6:AttacksLog, 7:TargetStage]
        
        if (error || !data || !Array.isArray(data) || data[0] !== 1) {
            const msg = (data && data[1] === 'NO_ATTEMPTS') ? "Sem tentativas diárias!" : "Erro na aventura.";
            resultText.textContent = msg;
            resultModal.style.display = "block";
            return;
        }

        // Mapeamento local dos dados compactos
        const didWin = data[1] === 1;
        const xpGained = data[2];
        const goldGained = data[3];
        const newLevel = data[4];
        const hpLeft = data[5];
        const attackLog = data[6]; // Array [[dmg, crit], ...]
        const targetStage = data[7];

        // Atualiza estado local
        playerAfkData.daily_attempts_left = Math.max(0, playerAfkData.daily_attempts_left - 1);
        
        if (didWin) {
            playerAfkData.xp = (playerAfkData.xp || 0) + xpGained;
            playerAfkData.gold = (playerAfkData.gold || 0) + goldGained;
            if (!isFarming) {
                playerAfkData.current_afk_stage = (playerAfkData.current_afk_stage || 1) + 1;
            }
        }
        
        // Verifica Level Up pela mudança de nível
        const currentLvlStr = String(playerAfkData.level);
        const newLvlStr = String(newLevel);
        const leveledUp = currentLvlStr !== newLvlStr;

        if (leveledUp) {
            playerAfkData.level = newLevel;
        }

        await saveToCache(playerAfkData);
        renderPlayerData();

        // Reconstrói objeto para a função de animação (que espera o formato antigo)
        const combatDataObject = {
            venceu: didWin,
            xp_ganho: xpGained,
            gold_ganho: goldGained,
            leveled_up: leveledUp,
            new_level: newLevel,
            monster_hp_inicial: hpLeft + calculateTotalDamage(attackLog), // Recalcula HP inicial
            monstro_hp_restante: hpLeft,
            attacks: attackLog,
            target_stage: targetStage
        };

        if (isFarming) {
            const message = `FARM CONCLUÍDO! Ganhou ${formatNumberCompact(xpGained)} XP e ${formatNumberCompact(goldGained)} Ouro! (Estágio mantido)`;
            resultText.textContent = message;
            resultModal.style.display = "block";
            if (leveledUp) showLevelUpBalloon(newLevel);
        } else {
            runCombatAnimation(combatDataObject);
        }
    }
    
    // Helper auxiliar para reconstruir HP inicial
    function calculateTotalDamage(logs) {
        if(!logs || !Array.isArray(logs)) return 0;
        return logs.reduce((acc, curr) => {
            // Suporte para [dano, crit] ou formato antigo
            const dmg = Array.isArray(curr) ? curr[0] : (curr.damage || 0);
            return acc + dmg;
        }, 0);
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

                        // Suporte híbrido (Array otimizado ou Objeto antigo)
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