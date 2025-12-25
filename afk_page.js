import { supabase } from './supabaseClient.js'

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM totalmente carregado. Iniciando script afk_page.js OTIMIZADO V2...");

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


    // --- CONFIGURAÇÕES ---
    const XP_RATE_PER_SEC = 1.0 / 1800;
    const GOLD_RATE_PER_SEC = 0;
    const MAX_AFK_SECONDS = 4 * 60 * 60; // 4 horas
    const MIN_COLLECT_SECONDS = 3600;    // 1 hora
    const CACHE_EXPIRATION_MS = 48 * 60 * 60 * 1000;

    // --- UI ELEMENTS ---
    const afkXpSpan = document.getElementById("afk-xp");
    const afkGoldSpan = document.getElementById("afk-gold");
    const afkTimerSpan = document.getElementById("afk-timer");
    const afkStageSpan = document.getElementById("afk-stage");
    const collectBtn = document.getElementById("collect-rewards-idle");
    const startAfkBtn = document.getElementById("start-afk");
    const idleScreen = document.getElementById("idle-screen");
    const dailyAttemptsLeftSpan = document.getElementById("daily-attempts-left");
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

    // --- STATE ---
    let playerAfkData = {};
    let afkStartTime = null;
    let localSimulationInterval;
    let userId = null;

    // --- HELPER DE AUTH ---
    function getLocalUserId() {
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
        collectBtn.style.opacity = isCollectable ? "1" : "0.5";
        collectBtn.style.cursor = isCollectable ? "pointer" : "not-allowed";
    }

    // --- DATA MANAGEMENT ---
    
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

    function saveToCache(data) {
        if(!userId) return;
        const cacheKey = `playerAfkData_${userId}`;
        localStorage.setItem(cacheKey, JSON.stringify({ data: data, timestamp: Date.now() }));
    }

    async function initializePlayerData() {
        userId = getLocalUserId();
        if (!userId) {
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData && sessionData.session) {
                userId = sessionData.session.user.id;
            } else {
                window.location.href = "index.html";
                return;
            }
        }

        const cacheKey = `playerAfkData_${userId}`;
        const cached = localStorage.getItem(cacheKey);
        let shouldUseCache = false;

        if (cached) {
            try {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_EXPIRATION_MS) {
                    playerAfkData = data;
                    shouldUseCache = true;
                    
                    // Validação rápida de dia (UTC) para reset visual
                    const lastResetDate = new Date(playerAfkData.last_attempt_reset || 0);
                    const now = new Date();
                    const isNewDayUtc = now.getUTCDate() !== lastResetDate.getUTCDate() || 
                                        now.getUTCMonth() !== lastResetDate.getUTCMonth();

                    if (isNewDayUtc) {
                         // Apenas verifica reset se for um novo dia visualmente
                        const { data: resetData } = await supabase.rpc('check_daily_reset', { p_player_id: userId });
                        if (resetData) {
                            playerAfkData.daily_attempts_left = resetData.daily_attempts_left;
                            if (resetData.reset_performed) playerAfkData.last_attempt_reset = new Date().toISOString(); 
                            saveToCache(playerAfkData);
                        }
                    }
                }
            } catch (e) { shouldUseCache = false; }
        }

        if (!shouldUseCache) {
            let { data, error } = await supabase.rpc('get_player_afk_data', { uid: userId });

            if (error) {
                const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
                if (!refreshError && refreshData.session) {
                    userId = refreshData.session.user.id;
                    const retry = await supabase.rpc('get_player_afk_data', { uid: userId });
                    data = retry.data;
                } else {
                    window.location.href = "index.html"; 
                    return;
                }
            }

            if (data && !data.error) {
                playerAfkData = data;
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

    // --- ACTIONS ---

    collectBtn.addEventListener("click", async () => {
        if (!userId || collectBtn.disabled) return;
        collectBtn.disabled = true; 
        
        const { data, error } = await supabase.rpc('collect_afk_rewards', { uid: userId });
        
        if (error) {
            collectBtn.disabled = false;
            return;
        }

        playerAfkData.xp += data.xp_earned;
        playerAfkData.gold += data.gold_earned;
        playerAfkData.last_afk_start_time = new Date().toISOString();
        
        if (data.leveled_up) {
            playerAfkData.level = data.new_level;
            showLevelUpBalloon(data.new_level);
        }

        saveToCache(playerAfkData);
        renderPlayerData();

        resultText.textContent = `Você coletou ${formatNumberCompact(data.xp_earned)} XP e ${formatNumberCompact(data.gold_earned)} Ouro!`;
        resultModal.style.display = "block";
    });

    async function triggerAdventure(isFarming) {
        if (adventureOptionsModal) adventureOptionsModal.style.display = "none";

        // Chama a aventura
        const { data, error } = await supabase.rpc('start_afk_adventure', { 
            p_player_id: userId,
            p_farm_mode: isFarming
        });

        if (error || !data?.success) {
            resultText.textContent = data?.message || "Erro desconhecido.";
            resultModal.style.display = "block";
            // Força recarga em erro para sincronizar
            localStorage.removeItem(`playerAfkData_${userId}`);
            initializePlayerData();
            return;
        }

        // Atualiza estado local
        playerAfkData.daily_attempts_left = data.daily_attempts_left;
        
        if (data.venceu) {
            playerAfkData.xp += data.xp_ganho;
            playerAfkData.gold += data.gold_ganho;
            if (!isFarming) {
                playerAfkData.current_afk_stage = (playerAfkData.current_afk_stage || 1) + 1;
            }
        }
        
        if (data.leveled_up) {
            playerAfkData.level = data.new_level;
        }

        saveToCache(playerAfkData);
        renderPlayerData();

        // LÓGICA DE FARM INSTANTÂNEO
        // Se não houver array de ataques ou estiver vazio, assumimos vitória instantânea (Farm)
        if (!data.attacks || data.attacks.length === 0) {
            const message = `⚡ FARM RÁPIDO! \n+${formatNumberCompact(data.xp_ganho)} XP \n+${formatNumberCompact(data.gold_ganho)} Ouro`;
            resultText.innerText = message; // innerText respeita quebras de linha
            resultModal.style.display = "block";
            if (data.leveled_up) showLevelUpBalloon(data.new_level);
        } else {
            // Se tem logs, é um desafio real -> Animação
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
                        const attack = attackLog[currentAttackIndex];
                        displayDamageNumber(attack.damage, attack.is_crit);

                        if (attack.is_crit) {
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
                        currentMonsterHp = Math.max(0, currentMonsterHp - attack.damage);
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
                            message = `Derrota! Melhore seus equipamentos e tente novamente.`;
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
        if(balloon) {
            const text = document.getElementById("levelUpBalloonText");
            text.innerText = newLevel;
            balloon.style.display = "block";
            setTimeout(() => balloon.style.display = "none", 5000);
        }
    }

    // --- EVENTS ---

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

    initializePlayerData();
});