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

    let userId = null;
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) userId = user.id;
    } catch (e) {
        console.error("Erro ao obter usuário:", e.message);
    }
    
    // ✅ Cache de 24 horas
    const CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000;

    // Elementos
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

    const combatScreen = document.getElementById("combat-screen");
    const monsterNameSpan = document.getElementById("monster-name");
    const monsterImage = document.getElementById("monsterImage");
    const monsterHpFill = document.getElementById("monster-hp-fill");
    const monsterHpBar = document.getElementById("monster-hp-bar");
    const monsterHpValueSpan = document.getElementById("monster-hp-value");
    const battleCountdownDisplay = document.getElementById("battle-countdown");
    const attacksLeftSpan = document.getElementById("time-left");

    const resultModal = document.getElementById("result-modal");
    const resultText = document.getElementById("result-text");
    const confirmBtn = document.getElementById("confirm-btn");
    const returnMainIdleBtn = document.getElementById("return-main-idle");

    const tutorialModal = document.getElementById("tutorial-modal");
    const closeTutorialBtn = document.getElementById("close-tutorial-btn");

    const musicPermissionModal = document.getElementById("music-permission-modal");
    const musicPermissionBtn = document.getElementById("music-permission-btn");

    let playerAfkData = {};
    let afkStartTime = null;
    let timerInterval;
    let startAfkCooldownActive = false;
    const START_AFK_COOLDOWN_TIME_MS = 1000;
    let countdownInterval;
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
                console.log('Dados AFK do jogador carregados do cache.');
                return playerAfkData;
            }
        }

        const { data, error } = await supabase.rpc('get_player_afk_data', { uid: userId });
        if (error) {
            console.error("Erro ao obter dados AFK do jogador:", error.message);
            return null;
        }

        playerAfkData = data || {};
        localStorage.setItem(cacheKey, JSON.stringify({ data: playerAfkData, timestamp: Date.now() }));
        console.log('Dados AFK do jogador carregados da API e armazenados no cache.');

        if (playerAfkData.last_afk_start_time) {
            afkStartTime = new Date(playerAfkData.last_afk_start_time).getTime();
        }
        playerTotalXpSpan.textContent = formatNumberCompact(playerAfkData.xp);
        playerTotalGoldSpan.textContent = formatNumberCompact(playerAfkData.gold);
        afkStageSpan.textContent = playerAfkData.current_afk_stage ?? 1;
        dailyAttemptsLeftSpan.textContent = playerAfkData.daily_attempts_left ?? 0;
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
        applyStartAfkCooldown();
    }

    function showCombatScreen() {
        idleScreen.style.display = "none";
        combatScreen.style.display = "flex";
        idleMusic.pause();
        combatMusic.play().catch(() => {});
    }

    function applyStartAfkCooldown() {
        startAfkBtn.disabled = true;
        startAfkCooldownActive = true;
        let timeLeft = START_AFK_COOLDOWN_TIME_MS / 1000;
        startAfkCooldownDisplay.style.display = "inline";
        startAfkCooldownDisplay.textContent = `(${timeLeft}s)`;
        countdownInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                startAfkCooldownDisplay.textContent = `(${timeLeft}s)`;
            } else {
                clearInterval(countdownInterval);
                startAfkBtn.disabled = false;
                startAfkCooldownActive = false;
                startAfkCooldownDisplay.style.display = "none";
            }
        }, 1000);
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
        if (startAfkCooldownActive || !userId) return;
        
        const { data, error } = await supabase.rpc('perform_afk_combat', { 
            p_player_id: userId,
            p_monster_base_health: 100 + ((playerAfkData.current_afk_stage ?? 1) - 1) * 143,
            p_attacks_limit: 10
        });

        // ✅ Trate corretamente mensagens de erro do SQL
        if (error || !data?.success) {
            const message = data?.message || data?.error || error?.message || "Ocorreu um erro ao iniciar a aventura.";
            console.error("Erro ao iniciar aventura AFK:", error || data);
            resultText.textContent = message;
            resultModal.style.display = "block";
            await getAndSetPlayerAfkData(true);
            return;
        }

        await getAndSetPlayerAfkData(true);

        showCombatScreen();
        monsterNameSpan.textContent = `Monstro do Estágio ${playerAfkData.current_afk_stage}`;
        monsterImage.src = window.monsterStageImages?.[Math.floor(Math.random() * window.monsterStageImages.length)] || '';

        monsterHpBar.style.display = 'none';
        attacksLeftSpan.style.display = 'none';
        battleCountdownDisplay.style.display = 'block';
        let countdown = 4;
        battleCountdownDisplay.textContent = `A batalha começará em: ${countdown}`;

        const countdownIntervalId = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                battleCountdownDisplay.textContent = `A batalha começará em: ${countdown}`;
            } else {
                clearInterval(countdownIntervalId);
                battleCountdownDisplay.style.display = 'none';
                monsterHpBar.style.display = 'flex';
                attacksLeftSpan.style.display = 'block';

                const monsterMaxHp = 100 + (playerAfkData.current_afk_stage - 1) * 143;
                let currentMonsterHp = monsterMaxHp;
                monsterHpValueSpan.textContent = `${formatNumberCompact(currentMonsterHp)} / ${formatNumberCompact(monsterMaxHp)}`;

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
                        monsterHpValueSpan.textContent = `${(currentMonsterHp)} / ${(monsterMaxHp)}`;

                        currentAttackIndex++;
                        attacksLeftSpan.textContent = attackLog.length - currentAttackIndex; 

                        setTimeout(animateAttack, attackAnimationInterval);
                    } else {
                        const message = data.venceu
                            ? `Monstro derrotado! Ganhou ${formatNumberCompact(data.xp_ganho)} XP e ${formatNumberCompact(data.gold_ganho)} Ouro!`
                            : `Você não derrotou o monstro. Ele ainda tem ${formatNumberCompact(data.monstro_hp_restante)} HP.`;
                        resultText.textContent = message;
                        resultModal.style.display = "block";
                        if (data.leveled_up) showLevelUpBalloon(data.new_level);
                        setTimeout(() => {
                            resultModal.style.display = "none";
                            showIdleScreen();
                        }, 3000);
                    }
                };
                animateAttack();
            }
        }, 1000);
    });

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

        setTimeout(() => {
            resultModal.style.display = "none";
            showIdleScreen();
        }, 3000);
    });

    confirmBtn.addEventListener("click", () => resultModal.style.display = "none");
    
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

    function showLevelUpBalloon(newLevel) {
        const balloon = document.getElementById("levelUpBalloon");
        const text = document.getElementById("levelUpBalloonText");
        text.innerText = newLevel;
        balloon.style.display = "block";
        setTimeout(() => balloon.style.display = "none", 5000);
    }
});