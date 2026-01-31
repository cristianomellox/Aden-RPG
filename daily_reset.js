document.addEventListener("DOMContentLoaded", () => {
    // Configurações e Chaves de Armazenamento
    const STORAGE_KEY_DATE = 'aden_last_daily_reset_utc';
    const STORAGE_KEY_ACTIONS = 'aden_daily_actions_status';
    
    // Mapeamento dos botões
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
        
        // Atualiza a lógica da guilda
        handleGuildSpecialEvents();
    };

    // --- LÓGICA ESPECIAL DA GUILDA ---
    const handleGuildSpecialEvents = () => {
        const now = new Date();
        const day = now.getUTCDay(); // 0=Dom, 6=Sab, 1=Seg
        const hours = now.getUTCHours();
        const minutes = now.getUTCMinutes();
        
        let showGuildDot = false;
        
        const KEY_SAT = 'aden_guild_notif_seen_saturday';
        // Nota: Removemos a KEY_SUN pois a lógica de domingo agora é persistente por horário

        // 1. Limpeza na Segunda-feira (Dia 1)
        if (day === 1) {
            localStorage.removeItem(KEY_SAT);
            // Remove a bolinha se existir
            const guildBtn = document.getElementById('guildBtn');
            if (guildBtn) {
                const dot = guildBtn.querySelector('.footer-notification-dot');
                if (dot) dot.remove();
            }
            return;
        }

        // 2. Verifica Sábado (Dia 6) - Comportamento Padrão (some ao clicar)
        if (day === 6) {
            if (!localStorage.getItem(KEY_SAT)) {
                showGuildDot = true;
            }
        }

        // 3. Verifica Domingo (Dia 0) - Comportamento Persistente
        // Mostra a partir de 00:01 UTC até 23:58:59 UTC
        // Some automaticamente quando bater 23:59 UTC
        if (day === 0) {
            const isAfterStart = (hours === 0 && minutes >= 1) || hours > 0;
            const isBeforeEnd = (hours < 23) || (hours === 23 && minutes < 59);

            if (isAfterStart && isBeforeEnd) {
                showGuildDot = true; // Força true independente de cliques
            }
        }

        // 4. Renderiza a bolinha no botão da Guilda
        const guildBtn = document.getElementById('guildBtn');
        if (guildBtn) {
            const existingDot = guildBtn.querySelector('.footer-notification-dot');

            if (showGuildDot) {
                // Só cria se ainda não existir para evitar duplicidade
                if (!existingDot) {
                    const dot = document.createElement('div');
                    dot.className = 'footer-notification-dot';
                    guildBtn.appendChild(dot);
                }
            } else {
                // Se showGuildDot for false (ex: virou 23:59 no domingo), removemos
                if (existingDot) existingDot.remove();
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
    
    // Listener específico para o botão da Guilda
    const guildBtn = document.getElementById('guildBtn');
    if (guildBtn) {
        guildBtn.addEventListener('click', () => {
            const now = new Date();
            const day = now.getUTCDay();
            
            // Se for Sábado, marca como visto e remove a bolinha (comportamento padrão)
            if (day === 6) {
                localStorage.setItem('aden_guild_notif_seen_saturday', 'true');
                const dot = guildBtn.querySelector('.footer-notification-dot');
                if (dot) dot.remove();
            }
            
            // Se for Domingo (day === 0), NÃO fazemos nada.
            // A bolinha continua lá visualmente e não salvamos nada no storage.
            // Ela sumirá sozinha quando handleGuildSpecialEvents detectar 23:59 UTC.
        });
    }

    // Intervalo de verificação (a cada 60s)
    setInterval(() => {
        const todayStr = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_DATE);
        if (todayStr !== lastReset) {
            currentStatus = checkReset();
            renderDots(currentStatus);
        } else {
            // Verifica os horários especiais da guilda a cada minuto
            // Isso garante que a bolinha suma sozinha às 23:59 UTC no Domingo
            handleGuildSpecialEvents();
        }
    }, 60000);
});