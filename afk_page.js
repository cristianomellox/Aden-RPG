document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM totalmente carregado. Iniciando script afk_page.js...");

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

    // Supabase
    const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

    // =======================================================================
    // OTIMIZAÇÃO DE AUTH: Zero Egress
    // =======================================================================
    let userId = getLocalUserId(); // Tenta cache primeiro

    if (!userId) {
        // Fallback para rede apenas se não achar no cache
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                userId = session.user.id;
            } else {
                console.warn("Nenhuma sessão ativa encontrada.");
            }
        } catch (e) {
            console.error("Erro ao obter sessão:", e.message);
        }
    }
    
    // ✅ Cache de 24 horas
    const CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000;

    // Elementos da UI Principal
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

    // Elementos da Tela de Combate
    const combatScreen = document.getElementById("combat-screen");
    const monsterNameSpan = document.getElementById("monster-name");
    const monsterImage = document.getElementById("monsterImage");
    const monsterHpFill = document.getElementById("monster-hp-fill");
    const monsterHpBar = document.getElementById("monster-hp-bar");
    const monsterHpValueSpan = document.getElementById("monster-hp-value");
    const battleCountdownDisplay = document.getElementById("battle-countdown");
    const attacksLeftSpan = document.getElementById("time-left");

    // Elementos de Modais
    const resultModal = document.getElementById("result-modal");
    const resultText = document.getElementById("result-text");
    const confirmBtn = document.getElementById("confirm-btn");
    const returnMainIdleBtn = document.getElementById("return-main-idle");

    const tutorialModal = document.getElementById("tutorial-modal");
    const closeTutorialBtn = document.getElementById("close-tutorial-btn");

    const musicPermissionModal = document.getElementById("music-permission-modal");
    const musicPermissionBtn = document.getElementById("music-permission-btn");

    // Elementos do NOVO Modal de Escolha de Aventura
    const adventureOptionsModal = document.getElementById("adventure-options-modal");
    const btnFarmPrevious = document.getElementById("btn-farm-previous");
    const btnChallengeCurrent = document.getElementById("btn-challenge-current");
    const closeAdventureOptionsBtn = document.getElementById("close-adventure-options");
    const farmStageNumberSpan = document.getElementById("farm-stage-number");
    const challengeStageNumberSpan = document.getElementById("challenge-stage-number");

    let playerAfkData = {};
    let afkStartTime = null;
    let timerInterval;
    const MAX_AFK_SECONDS = 4 * 60 * 60;
    const attackAnimationInterval = 1000;

    function formatNumberCompact(num) {
        return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
    }

    function updateTimer() {
        if (!afkStartTime) {
            afkTimerSpan.textContent = `04:00:00`;
            return;
        }
        const now = Date.now();
        let secondsElapsed = Math.floor((now - afkStartTime) / 1000);
        secondsElapsed = Math.min(secondsElapsed, MAX_AFK_SECONDS);
        const remainingSeconds = MAX_AFK_SECONDS - secondsElapsed;
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;
        afkTimerSpan.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        if (secondsElapsed >= MAX_AFK_SECONDS) clearInterval(timerInterval);
    }

    function startClientSideTimer() {
        clearInterval(timerInterval);
        timerInterval = setInterval(updateTimer, 1000);
        updateTimer();
    }
    
    function isCacheDailyAttemptsStale(cacheTimestamp) {
        const now = new Date();
        const midnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        return cacheTimestamp < midnightUTC.getTime();
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

    async function getAndSetPlayerAfkData(forceRefresh = false) {
        if (!userId) return null;

        const cacheKey = `playerAfkData_${userId}`;
        const cachedData = localStorage.getItem(cacheKey);

        if (cachedData && !forceRefresh) {
            const { data, timestamp } = JSON.parse(cachedData);
            if (Date.now() - timestamp < CACHE_EXPIRATION_MS && !isCacheDailyAttemptsStale(timestamp)) {
                playerAfkData = data;
                if (playerAfkData.last_afk_start_time) {
                    afkStartTime = new Date(playerAfkData.last_afk_start_time).getTime();
                }
                playerTotalXpSpan.textContent = formatNumberCompact(playerAfkData.xp);
                playerTotalGoldSpan.textContent = formatNumberCompact(playerAfkData.gold);
                afkStageSpan.textContent = playerAfkData.current_afk_stage ?? 1;
                dailyAttemptsLeftSpan.textContent = playerAfkData.daily_attempts_left ?? 0;
                
                updateStartAfkButtonState(playerAfkData.daily_attempts_left ?? 0);
                return playerAfkData;
            }
        }

        const { data, error } = await supabase.rpc('get_player_afk_data', { uid: userId });
        if (error) {
            console.error("Erro ao obter dados AFK:", error.message);
            return null;
        }

        playerAfkData = data || {};
        localStorage.setItem(cacheKey, JSON.stringify({ data: playerAfkData, timestamp: Date.now() }));

        if (playerAfkData.last_afk_start_time) {
            afkStartTime = new Date(playerAfkData.last_afk_start_time).getTime();
        }
        playerTotalXpSpan.textContent = formatNumberCompact(playerAfkData.xp);
        playerTotalGoldSpan.textContent = formatNumberCompact(playerAfkData.gold);
        afkStageSpan.textContent = playerAfkData.current_afk_stage ?? 1;
        dailyAttemptsLeftSpan.textContent = playerAfkData.daily_attempts_left ?? 0;
        
        updateStartAfkButtonState(playerAfkData.daily_attempts_left ?? 0);

        return playerAfkData;
    }

    async function updateAfkRewardsPreview() {
        if (!userId) return;
        const { data } = await supabase.rpc('get_afk_rewards_preview', { uid: userId });
        afkXpSpan.textContent = formatNumberCompact(data.xp_earned);
        afkGoldSpan.textContent = formatNumberCompact(data.gold_earned);
        collectBtn.disabled = !data.is_collectable;
    }

    function showIdleScreen() {
        idleScreen.style.display = "flex";
        combatScreen.style.display = "none";
        combatMusic.pause();
        idleMusic.play().catch(() => {});
        updateAfkRewardsPreview();
        getAndSetPlayerAfkData();
        if (startAfkCooldownDisplay) startAfkCooldownDisplay.style.display = "none";
    }

    function showCombatScreen() {
        idleScreen.style.display = "none";
        combatScreen.style.display = "flex";
        idleMusic.pause();
        combatMusic.play().catch(() => {});
    }

    function displayDamageNumber(damage, isCrit) {
        const combatArea = combatScreen;
        const damageNum = document.createElement("div");
        damageNum.textContent = damage; 
        damageNum.className = isCrit ? "crit-damage-number" : "normal-damage-number";
        const monsterRect = monsterImage.getBoundingClientRect();
        const combatRect = combatArea.getBoundingClientRect();
        damageNum.style.position = "absolute";
        damageNum.style.left = `${(monsterRect.left - combatRect.left) + monsterRect.width / 2}px`;
        damageNum.style.top = `${(monsterRect.top - combatRect.top) + monsterRect.height / 4}px`;
        damageNum.style.transform = "translateX(-50%)";
        damageNum.style.animation = "floatAndFade 1.5s forwards";
        combatArea.appendChild(damageNum);
        damageNum.addEventListener("animationend", () => damageNum.remove());
    }

    function showLevelUpBalloon(newLevel) {
        const balloon = document.getElementById("levelUpBalloon");
        const text = document.getElementById("levelUpBalloonText");
        text.innerText = newLevel;
        balloon.style.display = "block";
        setTimeout(() => balloon.style.display = "none", 5000);
    }

    // 🎯 FUNÇÃO PRINCIPAL DE COMBATE (Modificada para Pular Animação no Farm)
    async function triggerAdventure(isFarming) {
        // Fecha o modal de opções
        if (adventureOptionsModal) adventureOptionsModal.style.display = "none";

        // Chama a RPC
        const { data, error } = await supabase.rpc('start_afk_adventure', { 
            p_player_id: userId,
            p_farm_mode: isFarming
        });

        if (error || !data?.success) {
            const message = data?.message || data?.error || error?.message || "Ocorreu um erro ao iniciar a aventura.";
            resultText.textContent = message;
            resultModal.style.display = "block";
            await getAndSetPlayerAfkData(true);
            return;
        }

        // Atualiza dados (consumo de tentativas, XP novo, etc)
        await getAndSetPlayerAfkData(true);

        // =================================================================
        // 🚀 LÓGICA DE FARM RÁPIDO (Sem animação)
        // =================================================================
        if (isFarming) {
            // Se for farm, mostramos o resultado direto e não trocamos de tela
            const message = `FARM CONCLUÍDO! Ganhou ${formatNumberCompact(data.xp_ganho)} XP e ${formatNumberCompact(data.gold_ganho)} Ouro! (Estágio mantido)`;
            
            resultText.textContent = message;
            resultModal.style.display = "block";
            
            if (data.leveled_up) showLevelUpBalloon(data.new_level);
            
            // Toca um som curto de sucesso (opcional, usando o de crítico baixo volume ou idle)
            // Mantemos a música Idle tocando
            return; // 🛑 PARA A EXECUÇÃO AQUI, NÃO ENTRA NO COMBATE VISUAL
        }

        // =================================================================
        // ⚔️ LÓGICA DE DESAFIO (Com animação)
        // =================================================================
        
        // Se for desafio, segue o fluxo normal de animação
        showCombatScreen();
        
        const targetStage = playerAfkData.current_afk_stage; // No desafio, o estágio é o atual
        monsterNameSpan.textContent = `Monstro do Estágio ${targetStage}`;
        monsterImage.src = window.monsterStageImages?.[Math.floor(Math.random() * window.monsterStageImages.length)] || '';

        // UI de batalha
        monsterHpBar.style.display = 'none';
        attacksLeftSpan.style.display = 'none';
        battleCountdownDisplay.style.display = 'block';
        
        let countdown = 4;
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
                            criticalHitSound.play();
                        } else {
                            normalHitSound.currentTime = 0;
                            normalHitSound.play();
                        }

                        currentMonsterHp = Math.max(0, currentMonsterHp - attack.damage);
                        monsterHpFill.style.width = `${(Math.max(0, currentMonsterHp) / monsterMaxHp) * 100}%`;
                        monsterHpValueSpan.textContent = `${formatNumberCompact(currentMonsterHp)} / ${formatNumberCompact(monsterMaxHp)}`;

                        currentAttackIndex++;
                        attacksLeftSpan.textContent = attackLog.length - currentAttackIndex; 

                        setTimeout(animateAttack, attackAnimationInterval);
                    } else {
                        // Fim da animação
                        let message = "";
                        if (data.venceu) {
                            message = `VITÓRIA! Ganhou ${formatNumberCompact(data.xp_ganho)} XP, ${formatNumberCompact(data.gold_ganho)} Ouro e AVANÇOU de estágio!`;
                        } else {
                            message = `Você não derrotou o monstro. Ele recuperou a vida para a próxima batalha.`;
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

    // 🎯 Event listeners

    musicPermissionBtn.addEventListener("click", () => {
        musicPermissionModal.style.display = "none";
        [combatMusic, normalHitSound, criticalHitSound].forEach(audio => {
            audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
            });
        });
        showIdleScreen();
    });

    startAfkBtn.addEventListener("click", async () => {
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

    if (btnFarmPrevious) {
        btnFarmPrevious.addEventListener("click", () => triggerAdventure(true));
    }
    if (btnChallengeCurrent) {
        btnChallengeCurrent.addEventListener("click", () => triggerAdventure(false));
    }
    if (closeAdventureOptionsBtn) {
        closeAdventureOptionsBtn.addEventListener("click", () => {
            adventureOptionsModal.style.display = "none";
        });
    }

    collectBtn.addEventListener("click", async () => {
        if (!userId) return;
        const { data, error } = await supabase.rpc('collect_afk_rewards', { uid: userId });
        if (error) {
            console.error("Erro ao coletar recompensas:", error);
            return;
        }
        resultText.textContent = `Você coletou ${formatNumberCompact(data.xp_earned)} XP e ${formatNumberCompact(data.gold_earned)} Ouro!`;
        resultModal.style.display = "block";

        await getAndSetPlayerAfkData(true);
        await updateAfkRewardsPreview();
        startClientSideTimer();
        if (data.leveled_up) showLevelUpBalloon(data.new_level);
    });

    confirmBtn.addEventListener("click", () => {
        resultModal.style.display = "none";
        showIdleScreen(); 
    });
    
    returnMainIdleBtn.addEventListener("click", () => {
        window.location.href = "index.html?refresh=true";
    });

    saibaMaisBtn.addEventListener("click", () => tutorialModal.style.display = "flex");
    closeTutorialBtn.addEventListener("click", () => tutorialModal.style.display = "none");

    (async () => {
        if (await getAndSetPlayerAfkData()) {
            await updateAfkRewardsPreview();
            startClientSideTimer();
        } else {
            afkTimerSpan.textContent = `04:00:00`;
        }
    })();
});