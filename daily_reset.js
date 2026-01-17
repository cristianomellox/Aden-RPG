document.addEventListener("DOMContentLoaded", () => {
    // Configurações
    const STORAGE_KEY_DATE = 'aden_last_daily_reset_utc';
    const STORAGE_KEY_ACTIONS = 'aden_daily_actions_status';
    
    // Mapeamento dos botões que terão notificações
    const targets = [
        { id: 'btnAfk', key: 'afk' },
        { id: 'btnArena', key: 'arena' },
        { id: 'btnBoss', key: 'boss' }
    ];

    // Obtém a data UTC atual no formato YYYY-MM-DD
    const getTodayUTC = () => {
        return new Date().toISOString().split('T')[0];
    };

    // Inicializa ou Reseta o estado
    const checkDailyReset = () => {
        const today = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_DATE);
        
        // Se a data mudou (virou o dia UTC) ou nunca foi definida
        if (today !== lastReset) {
            console.log("🔄 [Daily Reset] Novo dia detectado (UTC). Resetando notificações.");
            
            // Define todas as ações como "pendentes" (true)
            const initialStatus = {};
            targets.forEach(t => initialStatus[t.key] = true);
            
            // Salva
            localStorage.setItem(STORAGE_KEY_DATE, today);
            localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(initialStatus));
            
            return initialStatus;
        } 
        
        // Se ainda é o mesmo dia, carrega o estado atual
        return JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIONS) || '{}');
    };

    // Renderiza as bolinhas na tela
    const renderDots = (status) => {
        let hasAnyPending = false;

        // 1. Renderiza bolinhas nos submenus
        targets.forEach(t => {
            const btn = document.getElementById(t.id);
            if (!btn) return;

            // Remove bolinha existente para evitar duplicatas
            const existingDot = btn.querySelector('.submenu-notification-dot');
            if (existingDot) existingDot.remove();

            if (status[t.key] === true) {
                hasAnyPending = true;
                const dot = document.createElement('div');
                dot.className = 'submenu-notification-dot';
                btn.appendChild(dot);
            }
        });

        // 2. Renderiza bolinha no botão principal (Iniciar)
        const mainBtn = document.getElementById('recursosBtn');
        if (mainBtn) {
            const existingMainDot = mainBtn.querySelector('.footer-notification-dot');
            if (existingMainDot) existingMainDot.remove();

            if (hasAnyPending) {
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
    let currentStatus = checkDailyReset();
    renderDots(currentStatus);

    // 2. Adiciona Listeners de clique aos botões do submenu
    targets.forEach(t => {
        const btn = document.getElementById(t.id);
        if (btn) {
            // Usa 'mousedown' ou 'click' para garantir captura rápida
            btn.addEventListener('click', () => handleActionClick(t.key));
        }
    });

    // 3. Verificação periódica (caso o jogador esteja com o jogo aberto na virada do dia)
    setInterval(() => {
        const today = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_DATE);
        if (today !== lastReset) {
            currentStatus = checkDailyReset();
            renderDots(currentStatus);
        }
    }, 60000); // Checa a cada 1 minuto
});