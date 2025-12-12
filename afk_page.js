document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM totalmente carregado. Iniciando script afk_page.js OTIMIZADO COM RESET LEVE...");

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

    // --- CONFIGURAÇÕES DE CÁLCULO (Sincronizado com SQL) ---
    const XP_RATE_PER_SEC = 1.0 / 1800; // Conforme SQL
    const GOLD_RATE_PER_SEC = 0;        // Conforme SQL
    const MAX_AFK_SECONDS = 4 * 60 * 60; // 4 horas
    const MIN_COLLECT_SECONDS = 3600;    // 1 hora
    const CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000;

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

    // --- HELPER DE AUTH ---
    function getLocalUserId() {
        try {
            const cached = localStorage.getItem('player_data_cache');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.data && parsed.data.id) return parsed.data.id;
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

    let userId = getLocalUserId();

    // Fallback de Auth (Rede)
    if (!userId) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) userId = session.user.id;
        } catch (e) { console.error(e); }
    }

    // --- VISUAL FORMATTING ---
    function formatNumberCompact(num) {
        // Alterado para exibir número completo com separadores (ex: 1,500)
        return new Intl.NumberFormat('en-US').format(num);
    }

    // --- CORE LOGIC: SIMULAÇÃO LOCAL (Zero Egress) ---
    function updateLocalSimulation() {
        if (!afkStartTime || !playerAfkData) return;

        const now = Date.now();
        // Garante que não ultrapasse o tempo máximo
        let secondsElapsed = Math.floor((now - afkStartTime) / 1000);
        
        // Timer Visual
        const displaySeconds = Math.min(secondsElapsed, MAX_AFK_SECONDS);
        const remainingSeconds = Math.max(0, MAX_AFK_SECONDS - displaySeconds);
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;
        afkTimerSpan.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        // Reward Calculation (Simulando get_afk_rewards_preview.sql)
        const cappedSeconds = Math.min(secondsElapsed, MAX_AFK_SECONDS);
        const stage = playerAfkData.current_afk_stage || 1;
        
        let xpEarned = Math.floor(cappedSeconds * XP_RATE_PER_SEC * stage);
        let goldEarned = Math.floor(cappedSeconds * GOLD_RATE_PER_SEC);

        // Nível 100 cap
        if ((playerAfkData.level || 1) >= 100) xpEarned = 0;

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

    // --- DATA MANAGEMENT (Cache & Sync) ---
    
    // Atualiza a UI com os dados que já temos na memória
    function renderPlayerData() {
        if (!playerAfkData) return;
        
        if (playerAfkData.last_afk_start_time) {
            afkStartTime = new Date(playerAfkData.last_afk_start_time).getTime();
        } else {
            // Se for null, define agora para começar a contar
            afkStartTime = Date.now();
        }

        playerTotalXpSpan.textContent = formatNumberCompact(playerAfkData.xp || 0);
        playerTotalGoldSpan.textContent = formatNumberCompact(playerAfkData.gold || 0);
        afkStageSpan.textContent = playerAfkData.current_afk_stage ?? 1;
        dailyAttemptsLeftSpan.textContent = playerAfkData.daily_attempts_left ?? 0;
        
        updateStartAfkButtonState(playerAfkData.daily_attempts_left ?? 0);
        
        // Força atualização imediata da simulação
        updateLocalSimulation();
    }

    function saveToCache(data) {
        if(!userId) return;
        const cacheKey = `playerAfkData_${userId}`;
        localStorage.setItem(cacheKey, JSON.stringify({ data: data, timestamp: Date.now() }));
    }

    async function initializePlayerData() {
        if (!userId) return;

        const cacheKey = `playerAfkData_${userId}`;
        const cached = localStorage.getItem(cacheKey);

        let shouldUseCache = false;

        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            
            // 1. Verifica Validade Geral do Cache (24h)
            if (Date.now() - timestamp < CACHE_EXPIRATION_MS) {
                playerAfkData = data;
                shouldUseCache = true;
                
                // 2. OTIMIZAÇÃO DE RESET DIÁRIO (Zero Egress parcial)
                // Verifica se virou o dia em UTC desde o último reset registrado no cache
                const lastResetDate = new Date(playerAfkData.last_attempt_reset || 0);
                const now = new Date();
                
                // Compara Dia, Mês e Ano em UTC (compatível com servidor)
                const isNewDayUtc = now.getUTCDate() !== lastResetDate.getUTCDate() || 
                                    now.getUTCMonth() !== lastResetDate.getUTCMonth() || 
                                    now.getUTCFullYear() !== lastResetDate.getUTCFullYear();

                if (isNewDayUtc) {
                    console.log("Virada de dia detectada (UTC). Verificando reset via RPC leve...");
                    // Chama RPC leve apenas para atualizar tentativas
                    const { data: resetData, error: resetError } = await supabase.rpc('check_daily_reset', { p_player_id: userId });
                    
                    if (!resetError && resetData) {
                        console.log("Status do Reset Diário:", resetData);
                        // Atualiza apenas os campos necessários no objeto local
                        playerAfkData.daily_attempts_left = resetData.daily_attempts_left;
                        if (resetData.reset_performed) {
                            playerAfkData.last_attempt_reset = new Date().toISOString(); 
                        }
                        // Salva o cache atualizado para não chamar RPC de novo hoje
                        saveToCache(playerAfkData);
                    }
                } else {
                    console.log("Usando Cache Local (Zero Egress) - Mesmo dia UTC");
                }
            }
        }

        if (!shouldUseCache) {
            console.log("Cache inválido ou inexistente. Buscando dados completos do Servidor...");
            const { data, error } = await supabase.rpc('get_player_afk_data', { uid: userId });
            if (error) {
                console.error("Erro ao obter dados:", error);
                return;
            }
            playerAfkData = data;
            saveToCache(playerAfkData);
        }

        renderPlayerData();
        
        // Inicia o Loop de Simulação Local (roda a cada 1s)
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

    // 1. Coleta de Recompensas (Otimizado)
    collectBtn.addEventListener("click", async () => {
        if (!userId || collectBtn.disabled) return;
        
        collectBtn.disabled = true; // Previne clique duplo
        
        const { data, error } = await supabase.rpc('collect_afk_rewards', { uid: userId });
        
        if (error) {
            console.error("Erro ao coletar:", error);
            collectBtn.disabled = false;
            return;
        }

        // STATE PATCHING: Atualiza o objeto local com a resposta do servidor
        // Em vez de recarregar tudo com get_player_afk_data
        playerAfkData.xp += data.xp_earned;
        playerAfkData.gold += data.gold_earned;
        playerAfkData.last_afk_start_time = new Date().toISOString(); // Reset timer local
        
        if (data.leveled_up) {
            playerAfkData.level = data.new_level;
            showLevelUpBalloon(data.new_level);
        }

        // Salva novo estado no cache e renderiza
        saveToCache(playerAfkData);
        renderPlayerData();

        resultText.textContent = `Você coletou ${formatNumberCompact(data.xp_earned)} XP e ${formatNumberCompact(data.gold_earned)} Ouro!`;
        resultModal.style.display = "block";
    });

    // 2. Iniciar Aventura / Combate
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
            // Em caso de erro, forçamos um refresh real para garantir sincronia
            localStorage.removeItem(`playerAfkData_${userId}`);
            initializePlayerData();
            return;
        }

        // STATE PATCHING: O servidor retornou tudo que precisamos.
        // Não fazemos GET request. Apenas atualizamos a memória.
        
        // 1. Consome tentativa
        playerAfkData.daily_attempts_left = data.daily_attempts_left;
        
        // 2. Adiciona ganhos se venceu
        if (data.venceu) {
            playerAfkData.xp += data.xp_ganho;
            playerAfkData.gold += data.gold_ganho;
            
            // Se não estava farmando e venceu, subiu de estágio
            if (!isFarming) {
                playerAfkData.current_afk_stage = (playerAfkData.current_afk_stage || 1) + 1;
            }
        }
        
        // 3. Level Up
        if (data.leveled_up) {
            playerAfkData.level = data.new_level;
        }

        // 4. Salva Cache Atualizado
        saveToCache(playerAfkData);
        
        // 5. Atualiza UI "Passiva" (XP total, tentativas, etc)
        renderPlayerData();

        // --- VISUALIZAÇÃO DO COMBATE ---
        
        if (isFarming) {
            // Farm Rápido (Skip Animation)
            const message = `FARM CONCLUÍDO! Ganhou ${formatNumberCompact(data.xp_ganho)} XP e ${formatNumberCompact(data.gold_ganho)} Ouro! (Estágio mantido)`;
            resultText.textContent = message;
            resultModal.style.display = "block";
            if (data.leveled_up) showLevelUpBalloon(data.new_level);
        } else {
            // Desafio (Com Animação)
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
            mImg.classList.remove('shake-animation'); // Remove classe anterior se houver
            void mImg.offsetWidth; // Força o navegador a reconhecer a remoção (Reflow)
            mImg.classList.add('shake-animation'); // Adiciona a animação
            
            // Remove a classe após 300ms para voltar a flutuar
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
                        
                        // Velocidade da animação
                        setTimeout(animateAttack, 1000);
                    } else {
                        // Fim da Luta
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
        renderPlayerData(); // Re-renderiza dados atualizados do cache
    }

    function showCombatScreen() {
        idleScreen.style.display = "none";
        combatScreen.style.display = "flex";
        idleMusic.pause();
        combatMusic.play().catch(() => {});
    }

    function displayDamageNumber(damage, isCrit) {
        const damageNum = document.createElement("div");
        damageNum.textContent = formatNumberCompact(damage); // Formata número do dano também
        damageNum.className = isCrit ? "crit-damage-number" : "normal-damage-number";
        
        // Posição centralizada no monstro
        // Nota: Ajuste fino pode ser necessário dependendo do CSS do combat-screen
        damageNum.style.position = "absolute";
        damageNum.style.left = "50%";
        damageNum.style.top = "40%";
        damageNum.style.transform = "translate(-50%, -50%)";
        
        damageNum.style.animation = "floatAndFade 1.5s forwards";
        combatScreen.appendChild(damageNum); // Anexa ao container relativo
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
            // "Pre-warm" audio contexts
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