document.addEventListener("DOMContentLoaded", () => {
    // Configurações e Chaves de Armazenamento
    const STORAGE_KEY_DATE = 'aden_last_daily_reset_utc';
    const STORAGE_KEY_ACTIONS = 'aden_daily_actions_status';
    
    // Mapeamento dos botões
    // type: 'daily' = reseta todo dia
    // type: 'weekly' = reseta em dia específico (day: 6 = Sábado)
    // isSubmenu: true = ativa lógica de notificação pai
    const targets = [
        // Menu Iniciar (Footer)
        { id: 'btnAfk', key: 'afk', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        { id: 'btnArena', key: 'arena', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        { id: 'btnBoss', key: 'boss', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        { id: 'guildBtn', key: 'guild', type: 'weekly', day: 0, isSubmenu: false }, 
        
        // Menu Loja (Side Menu & Modal)
        { id: 'btnShopVideoTab', key: 'shop_video', type: 'daily', isSubmenu: true, parentGroup: 'loja' }
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
                    // Semanais só ficam true se for o dia correto
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
        let pendingRecursos = false;
        let pendingLoja = false;

        targets.forEach(t => {
            const btn = document.getElementById(t.id);
            
            // Se a ação está pendente (true)
            if (status[t.key] === true) {
                
                // Marca flags para os pais
                if (t.parentGroup === 'recursos') pendingRecursos = true;
                if (t.parentGroup === 'loja') pendingLoja = true;

                // Desenha a bolinha no próprio elemento (Submenu ou Tab)
                if (btn) {
                    // Remove anterior
                    const existingDot = btn.querySelector('.notification-dot, .submenu-notification-dot, .footer-notification-dot, .tab-notification-dot');
                    if (existingDot) existingDot.remove();

                    // Cria nova
                    const dot = document.createElement('div');
                    
                    // Define classe baseada no tipo de botão
                    if (t.id === 'btnShopVideoTab') {
                         dot.className = 'tab-notification-dot'; // Classe específica para a aba
                    } else if (t.isSubmenu) {
                        dot.className = 'submenu-notification-dot';
                    } else {
                        dot.className = 'footer-notification-dot';
                    }
                    
                    btn.appendChild(dot);
                }
            } else {
                // Se status é false, garante que remove a bolinha
                if (btn) {
                    const existingDot = btn.querySelector('.notification-dot, .submenu-notification-dot, .footer-notification-dot, .tab-notification-dot');
                    if (existingDot) existingDot.remove();
                }
            }
        });

        // --- Lógica do Pai: Recursos/Iniciar (#recursosBtn) ---
        const mainBtn = document.getElementById('recursosBtn');
        if (mainBtn) {
            const existingMainDot = mainBtn.querySelector('.footer-notification-dot');
            if (existingMainDot) existingMainDot.remove();

            if (pendingRecursos) {
                const dot = document.createElement('div');
                dot.className = 'footer-notification-dot';
                mainBtn.appendChild(dot);
            }
        }

        // --- Lógica do Pai: Loja (#btnLojaSide) ---
        const lojaSideBtn = document.getElementById('btnLojaSide');
        if (lojaSideBtn) {
            // No menu lateral, a bolinha fica dentro da div .diamond
            const diamond = lojaSideBtn.querySelector('.diamond');
            if (diamond) {
                // Remove bolinha antiga (usando a classe do menu lateral)
                const existingLojaDot = diamond.querySelector('.notification-dot');
                if (existingLojaDot) existingLojaDot.remove();

                if (pendingLoja) {
                    const dot = document.createElement('span');
                    dot.className = 'notification-dot'; // Classe CSS já existente para o menu lateral
                    dot.style.display = 'block'; // Força display
                    diamond.appendChild(dot);
                }
            }
        }
    };

    // Marca uma ação como feita ao clicar
    const handleActionClick = (key) => {
        const status = JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIONS) || '{}');
        
        if (status[key] === true) {
            status[key] = false; // Marca como visto/feito
            localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(status));
            renderDots(status); // Atualiza UI imediatamente (remove do filho e verifica pais)
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
            // Quando clicar no botão alvo (ex: aba video), remove a notificação
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