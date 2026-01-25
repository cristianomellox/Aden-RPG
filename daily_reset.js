
document.addEventListener("DOMContentLoaded", () => {
    // Configurações e Chaves de Armazenamento
    const STORAGE_KEY_DATE = 'aden_last_daily_reset_utc';
    const STORAGE_KEY_ACTIONS = 'aden_daily_actions_status';
    
    // Mapeamento dos botões
    // OBS: Removi a guilda da lista genérica para tratar com lógica de horário específica abaixo
    const targets = [
        // Menu Iniciar (Footer)
        { id: 'btnAfk', key: 'afk', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        { id: 'btnArena', key: 'arena', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        { id: 'btnBoss', key: 'boss', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        // Menu Loja (Side Menu & Modal)
        { id: 'btnShopVideoTab', key: 'shop_video', type: 'daily', isSubmenu: true, parentGroup: 'loja' }
    ];

    const getTodayUTC = () => {
        return new Date().toISOString().split('T')[0];
    };

    const checkReset = () => {
        const todayStr = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_DATE);
        
        if (todayStr !== lastReset) {
            console.log("🔄 [Reset System] Novo dia detectado (UTC).");
            const currentStatus = {};
            targets.forEach(t => {
                // Como removemos 'weekly' genérico da guilda, todos aqui são daily
                currentStatus[t.key] = true;
            });
            
            localStorage.setItem(STORAGE_KEY_DATE, todayStr);
            localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(currentStatus));
            return currentStatus;
        } 
        return JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIONS) || '{}');
    };

    const renderDots = (status) => {
        let pendingRecursos = false;
        let pendingLoja = false;

        targets.forEach(t => {
            const btn = document.getElementById(t.id);
            if (status[t.key] === true) {
                if (t.parentGroup === 'recursos') pendingRecursos = true;
                if (t.parentGroup === 'loja') pendingLoja = true;

                if (btn) {
                    const existingDot = btn.querySelector('.notification-dot, .submenu-notification-dot, .footer-notification-dot, .tab-notification-dot');
                    if (existingDot) existingDot.remove();

                    const dot = document.createElement('div');
                    if (t.id === 'btnShopVideoTab') {
                         dot.className = 'tab-notification-dot';
                    } else if (t.isSubmenu) {
                        dot.className = 'submenu-notification-dot';
                    } else {
                        dot.className = 'footer-notification-dot';
                    }
                    btn.appendChild(dot);
                }
            } else {
                if (btn) {
                    const existingDot = btn.querySelector('.notification-dot, .submenu-notification-dot, .footer-notification-dot, .tab-notification-dot');
                    if (existingDot) existingDot.remove();
                }
            }
        });

        // Pais
        const mainBtn = document.getElementById('recursosBtn');
        if (mainBtn) {
            const existing = mainBtn.querySelector('.footer-notification-dot');
            if (existing) existing.remove();
            if (pendingRecursos) {
                const dot = document.createElement('div');
                dot.className = 'footer-notification-dot';
                mainBtn.appendChild(dot);
            }
        }

        const lojaSideBtn = document.getElementById('btnLojaSide');
        if (lojaSideBtn) {
            const diamond = lojaSideBtn.querySelector('.diamond');
            if (diamond) {
                const existing = diamond.querySelector('.notification-dot');
                if (existing) existing.remove();
                if (pendingLoja) {
                    const dot = document.createElement('span');
                    dot.className = 'notification-dot';
                    dot.style.display = 'block';
                    diamond.appendChild(dot);
                }
            }
        }
        
        // --- LÓGICA ESPECIAL DA GUILDA (Sábado e Domingo 23:30+) ---
        handleGuildSpecialEvents();
    };

    // Lógica Específica para a Guilda (Index/Footer)
    const handleGuildSpecialEvents = () => {
        const now = new Date();
        const day = now.getUTCDay(); // 0=Dom, 6=Sab, 1=Seg
        const hours = now.getUTCHours();
        const minutes = now.getUTCMinutes();
        
        let showGuildDot = false;
        
        // 1. Definição das Chaves de Controle
        const KEY_SAT = 'aden_guild_notif_seen_saturday';
        const KEY_SUN = 'aden_guild_notif_seen_sunday';

        // 2. Limpeza na Segunda-feira (Dia 1)
        if (day === 1) {
            localStorage.removeItem(KEY_SAT);
            localStorage.removeItem(KEY_SUN);
            // Remove a bolinha se existir
            const guildBtn = document.getElementById('guildBtn');
            if (guildBtn) {
                const dot = guildBtn.querySelector('.footer-notification-dot');
                if (dot) dot.remove();
            }
            return;
        }

        // 3. Verifica Sábado (Dia 6)
        if (day === 6) {
            // Se ainda não viu (null), mostra bolinha
            if (!localStorage.getItem(KEY_SAT)) {
                showGuildDot = true;
            }
        }

        // 4. Verifica Domingo (Dia 0) APÓS 23:30 UTC
        if (day === 0) {
            if (hours === 23 && minutes >= 30) {
                if (!localStorage.getItem(KEY_SUN)) {
                    showGuildDot = true;
                }
            }
        }

        // 5. Renderiza a bolinha no botão da Guilda
        const guildBtn = document.getElementById('guildBtn');
        if (guildBtn) {
            const existingDot = guildBtn.querySelector('.footer-notification-dot');
            if (existingDot) existingDot.remove();

            if (showGuildDot) {
                const dot = document.createElement('div');
                dot.className = 'footer-notification-dot';
                guildBtn.appendChild(dot);
            }
        }
    };

    const handleActionClick = (key) => {
        const status = JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIONS) || '{}');
        if (status[key] === true) {
            status[key] = false;
            localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(status));
            renderDots(status);
        }
    };

    // Inicialização
    let currentStatus = checkReset();
    renderDots(currentStatus);

    targets.forEach(t => {
        const btn = document.getElementById(t.id);
        if (btn) {
            btn.addEventListener('click', () => handleActionClick(t.key));
        }
    });
    
    // Listener específico para o botão da Guilda no index
    const guildBtn = document.getElementById('guildBtn');
    if (guildBtn) {
        guildBtn.addEventListener('click', () => {
            // Ao clicar no botão do footer, marcamos como visto para o horário atual
            const now = new Date();
            const day = now.getUTCDay();
            const hours = now.getUTCHours();
            const minutes = now.getUTCMinutes();
            
            // Se for Sábado, marca o sábado como visto
            if (day === 6) {
                localStorage.setItem('aden_guild_notif_seen_saturday', 'true');
            }
            // Se for Domingo após 23:30, marca domingo como visto
            if (day === 0 && (hours === 23 && minutes >= 30)) {
                localStorage.setItem('aden_guild_notif_seen_sunday', 'true');
            }
            
            // Remove a bolinha visualmente na hora
            const dot = guildBtn.querySelector('.footer-notification-dot');
            if (dot) dot.remove();
        });
    }

    setInterval(() => {
        const todayStr = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_DATE);
        if (todayStr !== lastReset) {
            currentStatus = checkReset();
            renderDots(currentStatus);
        } else {
            // Verifica os horários especiais da guilda a cada minuto também
            handleGuildSpecialEvents();
        }
    }, 60000);
});