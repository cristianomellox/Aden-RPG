import { supabase } from './supabaseClient.js'

// =======================================================================
// ADEN GLOBAL DB (CÓPIA LOCAL PARA STANDALONE)
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

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM totalmente carregado. Iniciando script afk_page.js OTIMIZADO...");

    // --- 1. OTIMIZAÇÃO: DICIONÁRIO DE MENSAGENS (Economia de Banda) ---
    const MESSAGES = {
        NO_PLAYER: "Jogador não encontrado.",
        MAX_LEVEL: "Nível Máximo atingido.",
        NO_ATTEMPTS: "Sem tentativas diárias.",
        MAX_STAGE: "Estágio máximo atingido.",
        CANT_FARM_LV1: "Não é possível farmar estágio anterior estando no estágio 1.",
        VICTORY: (xp, gold) => `VITÓRIA! Ganhou ${xp} XP, ${gold} Ouro e AVANÇOU de estágio!`,
        DEFEAT: "Você não derrotou o monstro. Tente melhorar seus equipamentos!",
        FARM_SUCCESS: (xp, gold) => `FARM CONCLUÍDO! Ganhou ${xp} XP e ${gold} Ouro! (Estágio mantido)`,
        COLLECT: (xp, gold) => `Você coletou ${xp} XP e ${gold} Ouro!`
    };

    // --- 2. OTIMIZAÇÃO: AUDIO MANAGER (Lazy Loading) ---
    // Substitui o carregamento imediato "new Audio()" que consumia banda
    const AudioManager = {
        sounds: {},
        sources: {
            normal: "https://aden-rpg.pages.dev/assets/normal_hit.mp3",
            crit: "https://aden-rpg.pages.dev/assets/critical_hit.mp3",
            idle: "https://aden-rpg.pages.dev/assets/idlesong.mp3",
            combat: "https://aden-rpg.pages.dev/assets/combat_afk_bg.mp3"
        },
        muted: false, 
        
        init: function() {
            // Verifica preferência salva (opcional, mas recomendado)
            this.muted = localStorage.getItem('mute_sounds') === 'true';
        },

        play: function(key, loop = false) {
            if (this.muted) return;
            
            // Instancia o áudio SOMENTE na primeira vez que for necessário
            if (!this.sounds[key]) {
                this.sounds[key] = new Audio(this.sources[key]);
                // Configuração de Volumes originais
                if (key === 'normal') this.sounds[key].volume = 0.5;
                if (key === 'crit') this.sounds[key].volume = 0.1;
                if (key === 'idle') this.sounds[key].volume = 0.2;
                if (key === 'combat') this.sounds[key].volume = 0.4;
            }
            
            const sound = this.sounds[key];
            sound.loop = loop;
            
            // Promise catch para evitar erros de autoplay policy
            sound.play().catch(() => console.log(`Autoplay bloqueado para: ${key}`));
        },

        stop: function(key) {
            if (this.sounds[key]) {
                this.sounds[key].pause();
                this.sounds[key].currentTime = 0;
            }
        },

        preloadHitSounds: function() {
            // Opcional: pré-carregar apenas os hits curtos para evitar delay no combate
            if(!this.muted) {
                if(!this.sounds['normal']) this.sounds['normal'] = new Audio(this.sources['normal']);
                if(!this.sounds['crit']) this.sounds['crit'] = new Audio(this.sources['crit']);
            }
        }
    };
    AudioManager.init();

    // --- CONFIGURAÇÕES DE CÁLCULO (Sincronizado com SQL) ---
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

    // --- CORE LOGIC: SIMULAÇÃO LOCAL ---
    function updateLocalSimulation() {
        if (!afkStartTime || !playerAfkData) return;

        const now = Date.now();
        let secondsElapsed = Math.floor((now - afkStartTime) / 1000);
        
        const displaySeconds = Math.min(secondsElapsed, MAX_AFK_SECONDS);
        const remainingSeconds = Math.max(0, MAX_AFK_SECONDS - displaySeconds);
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;
        afkTimerSpan.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

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
                    return cachedCombatStats;
                }
            } catch(e) {}
        }
        return null;
    }

    // --- DATA MANAGEMENT & RENDER ---
    
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
        await GlobalDB.setPlayer(data);
        const cacheKey = `playerAfkData_${userId}`;
        localStorage.setItem(cacheKey, JSON.stringify({ data: data, timestamp: Date.now() }));
    }

    // --- OTIMIZAÇÃO: INICIALIZAÇÃO COM SYNC CONDICIONAL ---
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

        // Tenta carregar stats de combate locais
        await getOrUpdatePlayerStatsCache();

        // 1. Tenta carregar dados do GlobalDB/Cache primeiro
        let shouldUseCache = false;
        
        const globalData = await GlobalDB.getPlayer();
        if (globalData && globalData.id === userId && globalData.last_afk_start_time) {
            playerAfkData = globalData;
            shouldUseCache = true;
        }

        if (!shouldUseCache) {
            const cacheKey = `playerAfkData_${userId}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const { data } = JSON.parse(cached);
                    playerAfkData = data;
                    shouldUseCache = true;
                } catch (e) {}
            }
        }

        // 2. Fetch Inteligente (304 Not Modified)
        // Se temos dados locais, enviamos o timestamp deles para o servidor
        let lastSyncTime = null;
        if (shouldUseCache && playerAfkData.server_timestamp) {
            lastSyncTime = playerAfkData.server_timestamp;
        }

        console.log("Sincronizando dados... Timestamp local:", lastSyncTime);
        
        // Chamada RPC atualizada com parâmetro de timestamp
        let { data, error } = await supabase.rpc('get_player_afk_data', { 
            uid: userId,
            p_local_data_timestamp: lastSyncTime
        });

        if (error || (data && data.error)) {
             const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
             if (!refreshError && refreshData.session) {
                 userId = refreshData.session.user.id; 
                 const retry = await supabase.rpc('get_player_afk_data', { 
                     uid: userId, 
                     p_local_data_timestamp: lastSyncTime 
                 });
                 data = retry.data;
                 error = retry.error;
             } else {
                 window.location.href = "index.html"; 
                 return;
             }
        }

        if (data && !error && !data.error) {
            // Lógica "Not Modified"
            if (data.status === 'not_modified') {
                console.log("[AFK] Cache local confirmado pelo servidor.");
                // Apenas atualiza o timestamp do cache local para não parecer velho
                if (playerAfkData) {
                    playerAfkData.last_check = Date.now();
                    saveToCache(playerAfkData);
                }
            } else {
                // Dados frescos recebidos
                console.log("[AFK] Dados atualizados recebidos do servidor.");
                // Mescla, dando preferência aos dados novos do servidor
                playerAfkData = { ...playerAfkData, ...data };
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

        if (data) {
            if (data.xp_earned) playerAfkData.xp = (playerAfkData.xp || 0) + data.xp_earned;
            if (data.gold_earned) playerAfkData.gold = (playerAfkData.gold || 0) + data.gold_earned;
            playerAfkData.last_afk_start_time = new Date().toISOString();

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

        // Usa dicionário de mensagens
        resultText.textContent = MESSAGES.COLLECT(formatNumberCompact(data.xp_earned || 0), formatNumberCompact(data.gold_earned || 0));
        resultModal.style.display = "block";
    });

    async function triggerAdventure(isFarming) {
        if (adventureOptionsModal) adventureOptionsModal.style.display = "none";

        const { data, error } = await supabase.rpc('start_afk_adventure', { 
            p_player_id: userId,
            p_farm_mode: isFarming
        });

        // Tratamento de erro via dicionário ou mensagem direta
        if (error || !data?.success) {
            let msg = "Erro desconhecido.";
            if (data?.err_code && MESSAGES[data.err_code]) {
                msg = MESSAGES[data.err_code];
            } else if (data?.message) {
                msg = data.message;
            } else if (error?.message) {
                msg = error.message;
            }
            resultText.textContent = msg;
            resultModal.style.display = "block";
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
            if (data.new_stats) {
                Object.assign(playerAfkData, data.new_stats);
            }
        }

        await saveToCache(playerAfkData);
        renderPlayerData();

        if (isFarming) {
            const message = MESSAGES.FARM_SUCCESS(formatNumberCompact(data.xp_ganho), formatNumberCompact(data.gold_ganho));
            resultText.textContent = message;
            resultModal.style.display = "block";
            if (data.leveled_up) showLevelUpBalloon(data.new_level);
        } else {
            runCombatAnimation(data);
        }
    }

    // --- OTIMIZAÇÃO: COMBAT LOG COMPACTO (Array Plano) ---
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

        // Pré-carrega sons de hit
        AudioManager.preloadHitSounds();

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

                // data.attacks agora é um array plano [dano1, crit1, dano2, crit2...]
                const attackLog = data.attacks || [];
                
                // Calculamos o total de golpes dividindo o array por 2
                const totalAttacks = Math.floor(attackLog.length / 2);
                let currentPairIndex = 0; 
                attacksLeftSpan.textContent = totalAttacks;

                const animateAttack = () => {
                    // Verifica se ainda há pares de dados no array (indice * 2 < tamanho)
                    if (currentPairIndex * 2 < attackLog.length) {
                        const baseIndex = currentPairIndex * 2;
                        
                        // Extrai dados do formato plano
                        const damage = attackLog[baseIndex];
                        const isCritInt = attackLog[baseIndex + 1];
                        const isCrit = (isCritInt === 1);

                        displayDamageNumber(damage, isCrit);

                        // Usa AudioManager ao invés de new Audio()
                        if (isCrit) {
                            AudioManager.play('crit');
                        } else {
                            AudioManager.play('normal');
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

                        currentPairIndex++;
                        attacksLeftSpan.textContent = totalAttacks - currentPairIndex; 
                        
                        setTimeout(animateAttack, 1000);
                    } else {
                        // Fim do combate
                        let message = "";
                        if (data.venceu) {
                            message = data.is_farming
                                ? MESSAGES.FARM_SUCCESS(formatNumberCompact(data.xp_ganho), formatNumberCompact(data.gold_ganho))
                                : MESSAGES.VICTORY(formatNumberCompact(data.xp_ganho), formatNumberCompact(data.gold_ganho));
                        } else {
                            message = MESSAGES.DEFEAT;
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
        
        // Controle de audio via Manager
        AudioManager.stop('combat');
        AudioManager.play('idle', true);
        
        renderPlayerData(); 
    }

    function showCombatScreen() {
        idleScreen.style.display = "none";
        combatScreen.style.display = "flex";
        
        // Controle de audio via Manager
        AudioManager.stop('idle');
        AudioManager.play('combat', true);
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
        if(text) text.innerText = newLevel;
        if(balloon) {
            balloon.style.display = "block";
            setTimeout(() => balloon.style.display = "none", 5000);
        }
    }

    // --- EVENT LISTENERS ---

    musicPermissionBtn.addEventListener("click", () => {
        musicPermissionModal.style.display = "none";
        
        // Desbloqueia contexto de áudio
        // Toca e pausa rapidamente para habilitar
        ['idle', 'combat', 'normal', 'crit'].forEach(key => {
            // Apenas inicializa, não toca tudo de uma vez
            // O AudioManager lida com a criação sob demanda, mas aqui forçamos 
            // a permissão do navegador se necessário.
            // Para simplificar e evitar downloads, apenas prosseguimos para a tela Idle.
            // O AudioManager tentará tocar 'idle' em seguida.
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