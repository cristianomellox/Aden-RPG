document.addEventListener('DOMContentLoaded', async () => {
    const afkContainer = document.getElementById('afkContainer');
    const playerInfoDiv = document.getElementById('playerInfoDiv');
    const authContainer = document.getElementById('authContainer');
    const collectAfkRewardsBtn = document.getElementById('collectAfkRewardsBtn');
    const afkStageSpan = document.getElementById('afkStage');
    const afkTimeSpan = document.getElementById('afkTime');
    const afkXPGainSpan = document.getElementById('afkXPGain');
    const afkGoldGainSpan = document.getElementById('afkGoldGain');
    const afkMessage = document.getElementById('afkMessage');
    const dailyAttemptsLeftSpan = document.getElementById('dailyAttemptsLeft');
    const startAdventureBtn = document.getElementById('startAdventureBtn');
    const attackButton = document.getElementById('attackButton');
    const monsterHealthPercentage = document.getElementById('monsterHealthPercentage');
    const monsterCurrentHealthDisplay = document.getElementById('monsterCurrentHealthDisplay');
    const monsterDisplayContainer = document.getElementById('monsterDisplayContainer');
    const monsterNameDisplay = document.getElementById('monsterNameDisplay');
    const monsterImage = document.getElementById('monsterImage');
    const attackCountDisplay = document.getElementById('attackCountDisplay');
    const remainingAttacksSpan = document.getElementById('remainingAttacks');
    const combatLog = document.getElementById('combatLog');
    const combatDamagePopup = document.getElementById('combatDamagePopup');
    const popupDamageAmount = document.getElementById('popupDamageAmount');
    const combatResultModal = document.getElementById('combatResultModal');
    const combatResultTitle = document.getElementById('combatResultTitle');
    const combatResultMessage = document.getElementById('combatResultMessage');
    const confirmCombatResultBtn = document.getElementById('confirmCombatResultBtn');
    const chatContainer = document.getElementById('chatContainer');
    const chatBox = document.getElementById('chatBox');
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const chatBubble = document.getElementById('chatBubble');
    const footerMenu = document.getElementById('footerMenu');
    const homeBtn = document.getElementById('homeBtn');
    const guildBtn = document.getElementById('guildBtn');
    const pvpBtn = document.getElementById('pvpBtn');
    const afkBtn = document.getElementById('afkBtn');
    const miningBtn = document.getElementById('miningBtn');
    const castlesBtn = document.getElementById('castlesBtn');
    const floatingMessage = document.getElementById('floatingMessage');


    let currentMonster = null;
    let playerDamage = 0;
    let playerDefense = 0;
    let attacksRemaining = 0;
    let combatInterval = null;
    let userId = null;
    let playerName = '';
    let playerFaction = '';
    let currentGold = 0;
    let currentXP = 0;
    let afkLoopInterval = null;
    let monsterFlashTimeout = null;
    let xpPerStage = 100; // XP base por estágio
    let goldPerStage = 50; // Ouro base por estágio
    let pveStageLevel = 1; // Nível atual do estágio PvE


    // Inicialização do Supabase (substitua com suas próprias chaves)
    const SUPABASE_URL = 'SUA_SUPABASE_URL'; // Substitua
    const SUPABASE_ANON_KEY = 'SUA_SUPABASE_ANON_KEY'; // Substitua
    const supabase = Supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Variáveis de elementos do perfil (do script.js)
    const profileEditModal = document.getElementById('profileEditModal');
    const editPlayerNameInput = document.getElementById('editPlayerName');
    const editPlayerFactionSelect = document.getElementById('editPlayerFaction');
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const profileEditMessage = document.getElementById('profileEditMessage');


    async function updateUI() {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            userId = user.id;
            authContainer.style.display = 'none';
            playerInfoDiv.style.display = 'block';
            afkContainer.style.display = 'block';
            chatContainer.style.display = 'block';
            chatBubble.style.display = 'flex';
            footerMenu.style.display = 'flex';
            await fetchPlayerInfo(userId);
            await fetchAFKData();
            startAfkLoop();
            setupChat();
        } else {
            authContainer.style.display = 'block';
            playerInfoDiv.style.display = 'none';
            afkContainer.style.display = 'none';
            chatContainer.style.display = 'none';
            chatBubble.style.display = 'none';
            footerMenu.style.display = 'none';
            stopAfkLoop();
        }
    }

    async function fetchPlayerInfo(id) {
        const { data: playerData, error: playerError } = await supabase
            .from('players')
            .select('*')
            .eq('id', id)
            .single();

        if (playerError && playerError.code === 'PGRST116') { // Nenhum dado encontrado
            showProfileEditModal(true);
            return;
        } else if (playerError) {
            console.error('Erro ao buscar informações do jogador:', playerError.message);
            return;
        }

        if (playerData) {
            playerName = playerData.name;
            playerFaction = playerData.faction;
            currentGold = playerData.gold;
            currentXP = playerData.xp;
            playerDamage = playerData.damage;
            playerDefense = playerData.defense;
            pveStageLevel = playerData.pve_stage_level; // Carrega o nível do estágio
            displayPlayerInfo(playerData);
            if (!playerData.name || !playerData.faction) {
                showProfileEditModal(true);
            }
        } else {
            showProfileEditModal(true);
        }
    }

    function displayPlayerInfo(playerData) {
        playerInfoDiv.innerHTML = `
            <h2>Informações do Jogador</h2>
            <p>Nome: ${playerData.name}</p>
            <p>Facção: ${playerData.faction}</p>
            <p>Ouro: ${playerData.gold}</p>
            <p>XP: ${playerData.xp}</p>
            <p>Dano: ${playerData.damage}</p>
            <p>Defesa: ${playerData.defense}</p>
            <button id="editProfileBtn">Editar Perfil</button>
            <button id="signOutBtn">Sair</button>
        `;
        document.getElementById('editProfileBtn').addEventListener('click', () => showProfileEditModal(false));
        document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
    }

    function showProfileEditModal(isNewUser) {
        profileEditModal.style.display = 'flex';
        if (isNewUser) {
            document.querySelector('#profileEditModal h2').textContent = 'Bem-vindo(a), Aventureiro(a)!';
            document.querySelector('#profileEditModal p').textContent = 'Seu perfil é novo. Por favor, edite seu nome e escolha sua facção inicial.';
        } else {
            document.querySelector('#profileEditModal h2').textContent = 'Editar Perfil';
            document.querySelector('#profileEditModal p').textContent = ''; // Limpa a mensagem
            editPlayerNameInput.value = playerName;
            editPlayerFactionSelect.value = playerFaction;
        }
    }

    saveProfileBtn.addEventListener('click', async () => {
        const newName = editPlayerNameInput.value.trim();
        const newFaction = editPlayerFactionSelect.value;

        if (!newName) {
            profileEditMessage.textContent = 'O nome do jogador não pode ser vazio!';
            return;
        }

        const { data, error } = await supabase
            .from('players')
            .upsert({ id: userId, name: newName, faction: newFaction }, { onConflict: 'id' })
            .select()
            .single();

        if (error) {
            profileEditMessage.textContent = 'Erro ao salvar perfil: ' + error.message;
            console.error('Erro ao salvar perfil:', error);
        } else {
            profileEditMessage.textContent = 'Perfil salvo com sucesso!';
            playerName = data.name;
            playerFaction = data.faction;
            displayPlayerInfo(data);
            profileEditModal.style.display = 'none';
        }
    });

    async function handleSignOut() {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Erro ao sair:', error.message);
        } else {
            updateUI(); // Atualiza a UI para o estado de não logado
        }
    }

    supabase.auth.onAuthStateChange((event, session) => {
        updateUI();
    });

    // Função de registro e login (do script.js)
    document.getElementById('signUpBtn').addEventListener('click', async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const { data, error } = await supabase.auth.signUp({ email, password });

        if (error) {
            document.getElementById('authMessage').textContent = 'Erro no registro: ' + error.message;
        } else if (data.user) {
            document.getElementById('authMessage').textContent = 'Registro bem-sucedido! Por favor, verifique seu e-mail para confirmar.';
            // Criar entrada do jogador na tabela 'players'
            const { error: playerError } = await supabase
                .from('players')
                .insert([
                    { id: data.user.id, name: '', faction: '', gold: 0, xp: 0, damage: 10, defense: 5, pve_stage_level: 1, last_afk_collect: new Date().toISOString(), daily_pve_attempts: 3 }
                ]);
            if (playerError) {
                console.error('Erro ao criar player:', playerError.message);
                document.getElementById('authMessage').textContent += ' Erro ao inicializar dados do jogador.';
            } else {
                showProfileEditModal(true); // Redireciona para edição de perfil para novo usuário
            }
        }
    });

    document.getElementById('signInBtn').addEventListener('click', async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            document.getElementById('authMessage').textContent = 'Erro no login: ' + error.message;
        } else if (data.user) {
            document.getElementById('authMessage').textContent = 'Login bem-sucedido!';
            updateUI();
        }
    });

    // Funções AFK
    async function fetchAFKData() {
        const { data: playerData, error } = await supabase
            .from('players')
            .select('last_afk_collect, daily_pve_attempts, pve_stage_level')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Erro ao buscar dados AFK:', error.message);
            afkMessage.textContent = 'Erro ao carregar dados AFK.';
            return;
        }

        const lastCollectTime = new Date(playerData.last_afk_collect).getTime();
        const currentTime = new Date().getTime();
        const afkDurationSeconds = Math.floor((currentTime - lastCollectTime) / 1000);

        // Calcula XP e Ouro baseados no tempo AFK e nível do estágio PvE
        const currentXPPerSecond = (xpPerStage / 3600) * playerData.pve_stage_level;
        const currentGoldPerSecond = (goldPerStage / 3600) * playerData.pve_stage_level;

        afkTimeSpan.textContent = formatTime(afkDurationSeconds);
        afkXPGainSpan.textContent = Math.floor(currentXPPerSecond * afkDurationSeconds);
        afkGoldGainSpan.textContent = Math.floor(currentGoldPerSecond * afkDurationSeconds);
        afkStageSpan.textContent = playerData.pve_stage_level;
        dailyAttemptsLeftSpan.textContent = playerData.daily_pve_attempts;

        // Desabilita o botão se não houver tentativas restantes
        startAdventureBtn.disabled = playerData.daily_pve_attempts <= 0;
    }

    function startAfkLoop() {
        if (afkLoopInterval) {
            clearInterval(afkLoopInterval);
        }
        afkLoopInterval = setInterval(fetchAFKData, 5000); // Atualiza a cada 5 segundos
    }

    function stopAfkLoop() {
        if (afkLoopInterval) {
            clearInterval(afkLoopInterval);
            afkLoopInterval = null;
        }
    }

    collectAfkRewardsBtn.addEventListener('click', async () => {
        const collectedXP = parseInt(afkXPGainSpan.textContent);
        const collectedGold = parseInt(afkGoldGainSpan.textContent);

        const { error } = await supabase
            .from('players')
            .update({
                xp: currentXP + collectedXP,
                gold: currentGold + collectedGold,
                last_afk_collect: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) {
            afkMessage.textContent = 'Erro ao coletar recompensas: ' + error.message;
        } else {
            afkMessage.textContent = `Recompensas coletadas! +${collectedXP} XP, +${collectedGold} Ouro.`;
            currentXP += collectedXP;
            currentGold += collectedGold;
            // Atualiza imediatamente a UI de AFK e PlayerInfo
            await fetchPlayerInfo(userId);
            await fetchAFKData();
        }
    });

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}h ${m}m ${s}s`;
    }

    // Funções de Combate PvE
    startAdventureBtn.addEventListener('click', async () => {
        const { data: playerData, error } = await supabase
            .from('players')
            .select('daily_pve_attempts, pve_stage_level')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Erro ao buscar tentativas diárias:', error.message);
            afkMessage.textContent = 'Erro ao iniciar aventura.';
            return;
        }

        if (playerData.daily_pve_attempts <= 0) {
            afkMessage.textContent = 'Você não tem mais tentativas de aventura para hoje!';
            return;
        }

        // Decrementa uma tentativa diária imediatamente no banco de dados
        const { error: updateError } = await supabase
            .from('players')
            .update({ daily_pve_attempts: playerData.daily_pve_attempts - 1 })
            .eq('id', userId);

        if (updateError) {
            console.error('Erro ao decrementar tentativas diárias:', updateError.message);
            afkMessage.textContent = 'Erro ao decrementar tentativa de aventura.';
            return;
        }

        dailyAttemptsLeftSpan.textContent = playerData.daily_pve_attempts - 1; // Atualiza a UI

        afkMessage.textContent = ''; // Limpa mensagens anteriores
        startAdventureBtn.style.display = 'none';
        collectAfkRewardsBtn.style.display = 'none';
        attackButton.style.display = 'block';
        monsterHealthPercentage.style.display = 'block';
        monsterDisplayContainer.style.display = 'block';
        attackCountDisplay.style.display = 'block';
        combatLog.style.display = 'block';
        combatLog.innerHTML = ''; // Limpa o log de combate

        // Inicia o combate
        await startCombat(playerData.pve_stage_level);
    });

    async function startCombat(stageLevel) {
        // Define o monstro com base no nível do estágio
        const monsterData = getMonsterForStage(stageLevel);
        currentMonster = { ...monsterData, currentHealth: monsterData.health };

        monsterNameDisplay.textContent = currentMonster.name;
        monsterImage.src = currentMonster.image_url;
        updateMonsterHealthDisplay();

        attacksRemaining = 10; // Número de ataques por combate
        remainingAttacksSpan.textContent = attacksRemaining;

        appendCombatLog(`Um ${currentMonster.name} apareceu! Prepare-se para o combate!`);
        appendCombatLog(`HP do ${currentMonster.name}: ${currentMonster.health}`);

        // Inicia o loop de combate (se necessário, ou espera por clique do usuário)
        // Se o combate for por clique do usuário, não precisamos de setInterval aqui.
        // Se for automático, descomente:
        // combatInterval = setInterval(performAttack, 1000); // Ataque a cada segundo
    }

    function getMonsterForStage(stage) {
        // Exemplo simples: monstro mais forte a cada estágio
        // Você pode expandir isso com um array de monstros ou lookup no DB
        switch (stage) {
            case 1:
                return { name: "Goblin", health: 100, damage: 5, defense: 2, xpReward: 50, goldReward: 20, image_url: "https://drive.google.com/uc?export=view&id=1RUyh2rbNdWdtdHd3jtWw89j0asHh6p_L" };
            case 2:
                return { name: "Slime Gigante", health: 150, damage: 8, defense: 3, xpReward: 75, goldReward: 30, image_url: "https://drive.google.com/uc?export=view&id=1RUyh2rbNdWdtdHd3jtWw89j0asHh6p_L" }; // Placeholder
            // Adicione mais estágios e monstros
            default:
                return { name: "Monstro Desconhecido", health: 200, damage: 10, defense: 5, xpReward: 100, goldReward: 40, image_url: "https://drive.google.com/uc?export=view&id=1RUyh2rbNdWdtdHd3jtWw89j0asHh6p_L" }; // Placeholder
        }
    }

    attackButton.addEventListener('click', performAttack);

    async function performAttack() {
        if (!currentMonster || attacksRemaining <= 0) {
            return;
        }

        attacksRemaining--;
        remainingAttacksSpan.textContent = attacksRemaining;

        let damageDealt = Math.max(0, playerDamage - currentMonster.defense);
        const isCritical = Math.random() < 0.2; // 20% de chance de crítico
        if (isCritical) {
            damageDealt *= 2; // Dano dobrado no crítico
        }

        currentMonster.currentHealth -= damageDealt;
        updateMonsterHealthDisplay();
        showDamagePopup(damageDealt, isCritical);
        flashMonsterImage(); // Adiciona o flash na imagem

        appendCombatLog(`${playerName} atacou o ${currentMonster.name} causando ${damageDealt} de dano! ${isCritical ? '(Crítico!)' : ''}`);

        // Ataque do monstro
        const monsterDamageTaken = Math.max(0, currentMonster.damage - playerDefense);
        appendCombatLog(`${currentMonster.name} atacou ${playerName} causando ${monsterDamageTaken} de dano!`);
        // Aqui você precisaria de uma variável de HP do jogador para subtrair o dano

        if (currentMonster.currentHealth <= 0) {
            currentMonster.currentHealth = 0; // Garante que não mostre HP negativo
            updateMonsterHealthDisplay();
            await endCombat(true); // Vitória
        } else if (attacksRemaining <= 0) {
            // Se o jogador acabou os ataques e o monstro ainda está vivo
            await endCombat(false); // Derrota (ou Empate/Fuga)
        }
    }

    function updateMonsterHealthDisplay() {
        const healthPercent = Math.max(0, Math.ceil((currentMonster.currentHealth / currentMonster.health) * 100));
        monsterCurrentHealthDisplay.textContent = `${healthPercent}%`;

        // Altera a cor da imagem do monstro baseada na vida
        if (healthPercent > 50) {
            monsterImage.style.filter = 'grayscale(0%)'; // Vida alta
        } else if (healthPercent > 20) {
            monsterImage.style.filter = 'sepia(50%) hue-rotate(300deg)'; // Vida média, cor mais quente
        } else {
            monsterImage.style.filter = 'grayscale(100%) brightness(50%)'; // Vida baixa, preto e branco, escuro
        }
    }

    function showDamagePopup(amount, isCritical) {
        combatDamagePopup.textContent = `DANO: ${amount}`;
        combatDamagePopup.classList.remove('critical');
        if (isCritical) {
            combatDamagePopup.classList.add('critical');
        }
        combatDamagePopup.style.display = 'block';
        combatDamagePopup.style.opacity = '1';
        combatDamagePopup.style.transform = 'translate(-50%, -50%) scale(1)';

        setTimeout(() => {
            combatDamagePopup.style.opacity = '0';
            combatDamagePopup.style.transform = 'translate(-50%, -70%) scale(0.8)'; // Move para cima enquanto some
            combatDamagePopup.addEventListener('transitionend', function handler() {
                combatDamagePopup.style.display = 'none';
                combatDamagePopup.removeEventListener('transitionend', handler);
            });
        }, 800); // Exibe por 0.8 segundos
    }

    function flashMonsterImage() {
        monsterImage.classList.add('flash-animation');
        if (monsterFlashTimeout) {
            clearTimeout(monsterFlashTimeout);
        }
        monsterFlashTimeout = setTimeout(() => {
            monsterImage.classList.remove('flash-animation');
        }, 200); // Duração da animação de flash
    }

    async function endCombat(isVictory) {
        if (combatInterval) {
            clearInterval(combatInterval);
            combatInterval = null;
        }

        attackButton.style.display = 'none';
        // monsterHealthPercentage.style.display = 'none'; // Manter visível para ver o HP final
        attackCountDisplay.style.display = 'none';
        // combatLog.style.display = 'none'; // Manter visível para revisar o log

        if (isVictory) {
            const xpEarned = currentMonster.xpReward;
            const goldEarned = currentMonster.goldReward;
            const newStageLevel = pveStageLevel + 1; // Avança para o próximo estágio

            appendCombatLog(`Você derrotou o ${currentMonster.name}!`);
            appendCombatLog(`Recompensas: +${xpEarned} XP, +${goldEarned} Ouro.`);
            appendCombatLog(`Avançando para o Estágio PvE ${newStageLevel}!`);

            combatResultTitle.textContent = 'VITÓRIA!';
            combatResultMessage.innerHTML = `Parabéns! Você derrotou o ${currentMonster.name}.<br>Você ganhou ${xpEarned} XP e ${goldEarned} Ouro.<br>Você avançou para o Estágio PvE ${newStageLevel}!`;

            // Atualiza o jogador no banco de dados
            const { error: updateError } = await supabase
                .from('players')
                .update({
                    xp: currentXP + xpEarned,
                    gold: currentGold + goldEarned,
                    pve_stage_level: newStageLevel // Atualiza o nível do estágio
                })
                .eq('id', userId);

            if (updateError) {
                console.error('Erro ao atualizar jogador após vitória:', updateError.message);
                afkMessage.textContent = 'Erro ao salvar recompensas da vitória.';
            } else {
                currentXP += xpEarned;
                currentGold += goldEarned;
                pveStageLevel = newStageLevel; // Atualiza a variável local
                await fetchPlayerInfo(userId); // Atualiza player info display
            }
        } else {
            appendCombatLog(`Você não conseguiu derrotar o ${currentMonster.name}.`);
            combatResultTitle.textContent = 'DERROTA!';
            combatResultMessage.innerHTML = `O ${currentMonster.name} foi muito forte. Tente novamente!`;
        }
        showCombatResultModal();
    }

    function showCombatResultModal() {
        combatResultModal.style.display = 'flex';
    }

    confirmCombatResultBtn.addEventListener('click', () => {
        combatResultModal.style.display = 'none';
        // Reinicializa a UI para o estado AFK
        startAdventureBtn.style.display = 'block';
        collectAfkRewardsBtn.style.display = 'block';
        monsterDisplayContainer.style.display = 'none'; // Esconde o monstro
        monsterHealthPercentage.style.display = 'none'; // Esconde o HP
        combatLog.style.display = 'none'; // Esconde o log
        afkMessage.textContent = 'Pronto para a próxima aventura!';
        fetchAFKData(); // Atualiza os dados AFK e tentativas
    });


    function appendCombatLog(message) {
        const p = document.createElement('p');
        p.textContent = message;
        combatLog.appendChild(p);
        combatLog.scrollTop = combatLog.scrollHeight; // Scroll para o final
    }

    // Funções de Chat
    function setupChat() {
        // Remove listeners antigos para evitar duplicação
        sendChatBtn.removeEventListener('click', handleSendMessage);
        chatInput.removeEventListener('keypress', handleChatInputKeyPress);

        // Adiciona novos listeners
        sendChatBtn.addEventListener('click', handleSendMessage);
        chatInput.addEventListener('keypress', handleChatInputKeyPress);

        // Inicia a escuta de mensagens do chat
        supabase
            .from('chat_messages')
            .on('INSERT', payload => {
                const message = payload.new;
                appendChatMessage(message.sender_name, message.message);
            })
            .subscribe();

        fetchChatMessages();
    }

    async function fetchChatMessages() {
        const { data, error } = await supabase
            .from('chat_messages')
            .select('sender_name, message')
            .order('created_at', { ascending: true })
            .limit(50); // Pega as últimas 50 mensagens

        if (error) {
            console.error('Erro ao buscar mensagens do chat:', error.message);
            return;
        }

        chatBox.innerHTML = ''; // Limpa antes de adicionar
        data.forEach(msg => {
            appendChatMessage(msg.sender_name, msg.message);
        });
    }

    function appendChatMessage(sender, message) {
        const messageElement = document.createElement('p');
        messageElement.classList.add('chat-message');
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll
    }

    async function handleSendMessage() {
        const message = chatInput.value.trim();
        if (message && playerName) { // Verifica se há mensagem e nome do jogador
            const { error } = await supabase
                .from('chat_messages')
                .insert([
                    { sender_id: userId, sender_name: playerName, message: message }
                ]);

            if (error) {
                console.error('Erro ao enviar mensagem:', error.message);
            } else {
                chatInput.value = ''; // Limpa o input
            }
        }
    }

    function handleChatInputKeyPress(event) {
        if (event.key === 'Enter') {
            handleSendMessage();
        }
    }

    // Gerenciamento de Visibilidade dos Containers via Botões do Rodapé
    function hideAllContainers() {
        playerInfoDiv.style.display = 'none';
        afkContainer.style.display = 'none';
        chatContainer.style.display = 'none';
        // Esconder elementos de combate se estiverem visíveis
        attackButton.style.display = 'none';
        monsterHealthPercentage.style.display = 'none';
        monsterDisplayContainer.style.display = 'none';
        attackCountDisplay.style.display = 'none';
        combatLog.style.display = 'none';
    }

    homeBtn.addEventListener('click', () => {
        hideAllContainers();
        playerInfoDiv.style.display = 'block';
        showFloatingMessage('Página Inicial');
    });

    guildBtn.addEventListener('click', () => {
        hideAllContainers();
        showFloatingMessage('Funcionalidade de Guilda em Desenvolvimento');
    });

    pvpBtn.addEventListener('click', () => {
        hideAllContainers();
        showFloatingMessage('Arena PvP em Breve!');
    });

    afkBtn.addEventListener('click', () => {
        hideAllContainers();
        afkContainer.style.display = 'block';
        fetchAFKData(); // Atualiza os dados AFK ao voltar para a aba
        showFloatingMessage('Aventura AFK');
    });

    miningBtn.addEventListener('click', () => {
        hideAllContainers();
        showFloatingMessage('Mineração em Desenvolvimento');
    });

    castlesBtn.addEventListener('click', () => {
        hideAllContainers();
        showFloatingMessage('Batalhas de Castelo em Breve!');
    });

    chatBubble.addEventListener('click', () => {
        hideAllContainers(); // Esconde outros para focar no chat
        chatContainer.style.display = 'block';
        showFloatingMessage('Chat Global');
    });

    function showFloatingMessage(message) {
        floatingMessage.textContent = message;
        floatingMessage.style.display = 'block';
        floatingMessage.style.opacity = '1';

        setTimeout(() => {
            floatingMessage.style.opacity = '0';
            floatingMessage.addEventListener('transitionend', function handler() {
                floatingMessage.style.display = 'none';
                floatingMessage.removeEventListener('transitionend', handler);
            });
        }, 2000); // Mensagem visível por 2 segundos
    }

    // Inicializa a UI na carga da página
    updateUI();
});
