document.addEventListener("DOMContentLoaded", () => {
    // Configurações e Chaves de Armazenamento
    const STORAGE_KEY_DATE = 'aden_last_daily_reset_utc';
    const STORAGE_KEY_ACTIONS = 'aden_daily_actions_status';
    
    // Mapeamento dos botões
    // type: 'daily' = reseta todo dia
    // type: 'weekly' = reseta em dia específico (day: 6 = Sábado)
    // isSubmenu: true = usa a bolinha pequena e ativa o botão pai "Iniciar"
    const targets = [
        { id: 'btnAfk', key: 'afk', type: 'daily', isSubmenu: true },
        { id: 'btnArena', key: 'arena', type: 'daily', isSubmenu: true },
        { id: 'btnBoss', key: 'boss', type: 'daily', isSubmenu: true },
        { id: 'guildBtn', key: 'guild', type: 'weekly', day: 0, isSubmenu: false } // 6 = Sábado (UTC)
    ];

    // Obtém a data UTC atual no formato YYYY-MM-DD
    const getTodayUTC = () => {
        return new Date().toISOString().split('T')[0];
    };

    // Inicializa ou Reseta o estado
    const checkReset = () => {
        const todayStr = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_DATE);
        
        // Se a data mudou (virou o dia UTC) ou nunca foi definida
        if (todayStr !== lastReset) {
            console.log("🔄 [Reset System] Novo dia detectado (UTC). Verificando regras.");
            
            const currentStatus = {};
            const todayDate = new Date();
            const currentDayOfWeek = todayDate.getUTCDay(); // 0 (Dom) a 6 (Sab)

            targets.forEach(t => {
                if (t.type === 'daily') {
                    // Diários sempre resetam para true na virada do dia
                    currentStatus[t.key] = true;
                } else if (t.type === 'weekly') {
                    // Semanais só ficam true se for o dia correto (Ex: Sábado)
                    // Caso contrário, ficam false (para limpar notificações antigas)
                    currentStatus[t.key] = (currentDayOfWeek === t.day);
                }
            });
            
            // Salva novo estado e nova data
            localStorage.setItem(STORAGE_KEY_DATE, todayStr);
            localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(currentStatus));
            
            return currentStatus;
        } 
        
        // Se ainda é o mesmo dia, carrega o estado atual do storage
        return JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIONS) || '{}');
    };

    // Renderiza as bolinhas na tela
    const renderDots = (status) => {
        let hasPendingSubmenu = false;

        targets.forEach(t => {
            const btn = document.getElementById(t.id);
            if (!btn) return;

            // Define qual classe CSS usar baseada se é submenu ou botão principal
            const dotClass = t.isSubmenu ? 'submenu-notification-dot' : 'footer-notification-dot';

            // Remove bolinha existente para evitar duplicatas
            const existingDot = btn.querySelector(`.${dotClass}`);
            if (existingDot) existingDot.remove();

            // Verifica se deve mostrar a bolinha
            if (status[t.key] === true) {
                const dot = document.createElement('div');
                dot.className = dotClass;
                btn.appendChild(dot);

                // Se for um item de submenu, marca que o pai precisa de notificação
                if (t.isSubmenu) {
                    hasPendingSubmenu = true;
                }
            }
        });

        // Lógica Específica para o botão PAI "Recursos/Iniciar" (#recursosBtn)
        // Ele acende se qualquer filho (AFK, Arena, Boss) estiver pendente
        const mainBtn = document.getElementById('recursosBtn');
        if (mainBtn) {
            const existingMainDot = mainBtn.querySelector('.footer-notification-dot');
            if (existingMainDot) existingMainDot.remove();

            if (hasPendingSubmenu) {
                const dot = document.createElement('div');
                dot.className = 'footer-notification-dot';
                mainBtn.appendChild(dot);
            }
        }
    };

    // Marca uma ação como feita ao clicar
    const handleActionClick = (key) => {
        const status = JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIONS) || '{}');
        
        if (status[key] === true) {
            status[key] = false; // Marca como visto/feito
            localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(status));
            renderDots(status); // Atualiza UI imediatamente
        }
    };

    // --- Inicialização ---

    // 1. Checa reset e desenha bolinhas iniciais
    let currentStatus = checkReset();
    renderDots(currentStatus);

    // 2. Adiciona Listeners de clique
    targets.forEach(t => {
        const btn = document.getElementById(t.id);
        if (btn) {
            btn.addEventListener('click', () => handleActionClick(t.key));
        }
    });

    // 3. Verificação periódica (caso o jogador esteja com o jogo aberto na virada do dia)
    setInterval(() => {
        const todayStr = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_DATE);
        if (todayStr !== lastReset) {
            currentStatus = checkReset();
            renderDots(currentStatus);
        }
    }, 60000); // Checa a cada 1 minuto
});