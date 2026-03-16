document.addEventListener("DOMContentLoaded", () => {
    // Configurações e Chaves de Armazenamento
    const STORAGE_KEY_DATE = 'aden_last_daily_reset_utc';
    const STORAGE_KEY_ACTIONS = 'aden_daily_actions_status';
    const STORAGE_KEY_OWNERS_SUNDAY_RESET = 'aden_owners_sunday_reset_date';
    
    // Mapeamento dos botões (Apenas os que somem com clique/reset diário)
    const targets = [
        // Menu Iniciar (Footer)
        { id: 'btnAfk', key: 'afk', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        { id: 'btnArena', key: 'arena', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        { id: 'btnBoss', key: 'boss', type: 'daily', isSubmenu: true, parentGroup: 'recursos' },
        // Áreas de Caça (apenas filhos via container disparam a ação)
        // btnCacaToggle só expande o menu, não marca como concluído
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
            // 'caca' é tratado separadamente dos targets, mas também é diário
            currentStatus['caca'] = true;
            
            localStorage.setItem(STORAGE_KEY_DATE, todayStr);
            localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(currentStatus));
            return currentStatus;
        } 
        return JSON.parse(localStorage.getItem(STORAGE_KEY_ACTIONS) || '{}');
    };

    // Verifica se o evento das Ruínas está ativo (Horários UTC específicos)
    const checkRuinsEvent = () => {
        const now = new Date();
        const h = now.getUTCHours();
        const m = now.getUTCMinutes();

        // Horários: 00, 04, 08, 12, 16, 20 (Múltiplos de 4)
        // Duração: 30 minutos (0 a 30)
        const isHourMatch = (h % 4 === 0);
        const isMinuteMatch = (m >= 0 && m <= 30);

        return isHourMatch && isMinuteMatch;
    };

    const renderDots = (status) => {
        let pendingRecursos = false;
        let pendingLoja = false;

        // 1. Renderiza bolinhas baseadas no status diário (clique para sumir)
        targets.forEach(t => {
            const btn = document.getElementById(t.id);
            if (status[t.key] === true) {
                if (t.parentGroup === 'recursos') pendingRecursos = true;
                if (t.parentGroup === 'loja') pendingLoja = true;

                if (btn) {
                    addDotToElement(btn, t.id === 'btnShopVideoTab' ? 'tab-notification-dot' : 'submenu-notification-dot');
                }
            } else {
                if (btn) {
                    removeDotFromElement(btn);
                }
            }
        });

        // 1b. Lógica especial para Áreas de Caça (dots no toggle pai + filhos do dropdown)
        const btnCacaToggle = document.getElementById('btnCacaToggle');
        if (btnCacaToggle) {
            if (status['caca'] === true) {
                pendingRecursos = true;
                addDotToElement(btnCacaToggle, 'submenu-notification-dot');
            } else {
                removeDotFromElement(btnCacaToggle);
            }
        }

        const cacaDropdown = document.getElementById('cacaDropdownContent');
        if (cacaDropdown) {
            const cacaChildren = cacaDropdown.querySelectorAll('.footer-submenu-btn');
            cacaChildren.forEach(child => {
                if (status['caca'] === true) {
                    addDotToElement(child, 'submenu-notification-dot');
                } else {
                    removeDotFromElement(child);
                }
            });
        }

        // 2. Lógica das Ruínas Ancestrais (Baseada em horário, não some com clique)
        const isRuinsActive = checkRuinsEvent();
        
        // Botão específico das Ruínas (dentro do dropdown)
        const btnRuins = document.getElementById('btnRuins');
        if (btnRuins) {
            if (isRuinsActive) {
                addDotToElement(btnRuins, 'submenu-notification-dot');
            } else {
                removeDotFromElement(btnRuins);
            }
        }

        // Botão "Áreas" (Pai do dropdown)
        const btnAreas = document.getElementById('btnAreasToggle');
        if (btnAreas) {
            if (isRuinsActive) {
                addDotToElement(btnAreas, 'submenu-notification-dot');
                // Se Ruínas está ativo, o grupo recursos também fica pendente (para notificar no footer)
                pendingRecursos = true; 
            } else {
                removeDotFromElement(btnAreas);
            }
        }

        // 3. Renderiza bolinhas nos botões Pais (Footer / Menu Lateral)
        
        // Botão Iniciar (Footer)
        const mainBtn = document.getElementById('recursosBtn');
        if (mainBtn) {
            removeDotFromElement(mainBtn);
            if (pendingRecursos) {
                addDotToElement(mainBtn, 'footer-notification-dot');
            }
        }

        // Botão Loja (Lateral)
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
        
        // 4. Atualiza a lógica da guilda
        handleGuildSpecialEvents();
    };

    // Funções auxiliares para manipular o DOM das bolinhas
    const addDotToElement = (element, className) => {
        // Verifica se já existe para não duplicar
        if (!element.querySelector(`.${className}`)) {
            const dot = document.createElement('div');
            dot.className = className;
            element.appendChild(dot);
        }
    };

    const removeDotFromElement = (element) => {
        const existingDot = element.querySelector('.notification-dot, .submenu-notification-dot, .footer-notification-dot, .tab-notification-dot');
        if (existingDot) existingDot.remove();
    };

    // --- LÓGICA ESPECIAL DA GUILDA ---
    const handleGuildSpecialEvents = () => {
        const now = new Date();
        const day = now.getUTCDay(); // 0=Dom, 6=Sab, 1=Seg
        const hours = now.getUTCHours();
        const minutes = now.getUTCMinutes();
        
        let showGuildDot = false;
        
        const KEY_SAT = 'aden_guild_notif_seen_saturday';

        // 1. Limpeza na Segunda-feira (Dia 1)
        if (day === 1) {
            localStorage.removeItem(KEY_SAT);
            const guildBtn = document.getElementById('guildBtn');
            if (guildBtn) removeDotFromElement(guildBtn);
            return;
        }

        // 2. Verifica Sábado (Dia 6) - Comportamento Padrão (some ao clicar)
        if (day === 6) {
            if (!localStorage.getItem(KEY_SAT)) {
                showGuildDot = true;
            }
        }

        // 3. Verifica Domingo (Dia 0) - Comportamento Persistente
        if (day === 0) {
            const isAfterStart = (hours === 0 && minutes >= 1) || hours > 0;
            const isBeforeEnd = (hours < 23) || (hours === 23 && minutes < 59);

            if (isAfterStart && isBeforeEnd) {
                showGuildDot = true; 
            }
        }

        // 4. Renderiza a bolinha no botão da Guilda
        const guildBtn = document.getElementById('guildBtn');
        if (guildBtn) {
            if (showGuildDot) {
                addDotToElement(guildBtn, 'footer-notification-dot');
            } else {
                removeDotFromElement(guildBtn);
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

    // --- RESET DOMINICAL DO CACHE DE DONOS DE MINAS (IDB) ---
    const clearOwnersCacheIDB = () => {
        return new Promise((resolve) => {
            // Abre sem especificar versão para não disparar onupgradeneeded
            const req = indexedDB.open('aden_global_db');
            req.onsuccess = (e) => {
                const db = e.target.result;
                // Garante que a store existe antes de tentar limpar
                if (!db.objectStoreNames.contains('owners_store')) {
                    db.close();
                    return resolve();
                }
                try {
                    const tx = db.transaction('owners_store', 'readwrite');
                    tx.objectStore('owners_store').clear();
                    tx.oncomplete = () => {
                        console.log('🗑️ [Reset System] Cache de donos de minas (IDB) limpo com sucesso (Domingo UTC).');
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => { db.close(); resolve(); };
                } catch (err) {
                    console.warn('[Reset System] Erro ao limpar owners_store:', err);
                    db.close();
                    resolve();
                }
            };
            // Silencioso se o IDB ainda não existir
            req.onerror = () => resolve();
        });
    };

    const checkSundayOwnersReset = async () => {
        const now = new Date();
        // Só executa aos domingos UTC (day === 0)
        if (now.getUTCDay() !== 0) return;

        const todayStr = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_OWNERS_SUNDAY_RESET);

        // Já resetou hoje? Não faz nada.
        if (lastReset === todayStr) return;

        await clearOwnersCacheIDB();
        localStorage.setItem(STORAGE_KEY_OWNERS_SUNDAY_RESET, todayStr);
    };

    // Inicialização
    let currentStatus = checkReset();
    renderDots(currentStatus);
    checkSundayOwnersReset();

    targets.forEach(t => {
        const btn = document.getElementById(t.id);
        if (btn) {
            btn.addEventListener('click', () => handleActionClick(t.key));
        }
    });
    
    // Listener para qualquer filho do dropdown Áreas de Caça
    const cacaDropdownContent = document.getElementById('cacaDropdownContent');
    if (cacaDropdownContent) {
        cacaDropdownContent.addEventListener('click', () => handleActionClick('caca'));
    }

    // Listener específico para o botão da Guilda
    const guildBtn = document.getElementById('guildBtn');
    if (guildBtn) {
        guildBtn.addEventListener('click', () => {
            const now = new Date();
            const day = now.getUTCDay();
            
            if (day === 6) {
                localStorage.setItem('aden_guild_notif_seen_saturday', 'true');
                removeDotFromElement(guildBtn);
            }
        });
    }

    // Intervalo de verificação (a cada 60s)
    setInterval(() => {
        const todayStr = getTodayUTC();
        const lastReset = localStorage.getItem(STORAGE_KEY_DATE);
        
        // Se mudou o dia, reseta tudo
        if (todayStr !== lastReset) {
            currentStatus = checkReset();
        }
        
        // Chama renderDots a cada minuto para atualizar eventos baseados em horário (Ruínas e Guilda)
        // mesmo que o dia não tenha mudado.
        renderDots(currentStatus);

        // Verifica reset dominical do cache de donos de minas (IDB)
        checkSundayOwnersReset();
        
    }, 60000);
});
