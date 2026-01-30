import { supabase } from './supabaseClient.js'

// =======================================================================
// NOVO: ADEN GLOBAL DB (INTEGRAÇÃO ZERO EGRESS)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 6;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(PLAYER_STORE)) db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(AUTH_STORE, 'readonly');
                const req = tx.objectStore(AUTH_STORE).get('current_session');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    // Usado para verificar dados do próprio usuário se necessário
    getPlayer: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(PLAYER_STORE, 'readonly');
                const req = tx.objectStore(PLAYER_STORE).get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};

document.addEventListener("DOMContentLoaded", () => {
    
    // --- INÍCIO: FUNÇÕES DE CACHE ---
    /**
     * Armazena dados no localStorage com um tempo de expiração.
     */
    function setCache(key, data, ttl) {
        const now = new Date();
        const item = {
            data: data,
            expiry: now.getTime() + ttl,
        };
        try {
            localStorage.setItem(key, JSON.stringify(item));
        } catch (e) {
            console.warn("[playerModal.js] Erro ao salvar no cache (localStorage cheio?):", e);
        }
    }

    /**
     * Recupera dados do localStorage se não estiverem expirados.
     */
    function getCache(key) {
        const itemStr = localStorage.getItem(key);
        if (!itemStr) return null;
        try {
            const item = JSON.parse(itemStr);
            const now = new Date();
            if (now.getTime() > item.expiry) {
                localStorage.removeItem(key);
                return null;
            }
            return item.data;
        } catch (e) {
            console.error("[playerModal.js] Erro ao ler cache:", e);
            localStorage.removeItem(key); 
            return null;
        }
    }
    // --- FIM: FUNÇÕES DE CACHE ---

    // Tempo de vida do cache (24 horas) - usado como fallback
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; 

    // Referências DOM
    const playerModal = document.getElementById('playerModal');
    const closeBtn = document.getElementById('closePlayerModal');
    const playerNameEl = document.getElementById('playerName');
    const playerLevelEl = document.getElementById('playerLevel');
    const playerGuildFlagImg = document.getElementById('playerGuildFlag');
    const playerGuildNameEl = document.getElementById('playerGuildName');
    const playerAvatarEl = document.getElementById('playerAvatarEquip');
    const combatPowerEl = document.getElementById('playerCombatPower');

    const playerAttackEl = document.getElementById('playerAttack');
    const playerDefenseEl = document.getElementById('playerDefense');
    const playerHealthEl = document.getElementById('playerHealth');
    const playerCritChanceEl = document.getElementById('playerCritChance');
    const playerCritDamageEl = document.getElementById('playerCritDamage');
    const playerEvasionEl = document.getElementById('playerEvasion');

    // Referência ao botão de Enviar MP
    const sendMpButton = document.getElementById('sendmp');

    // Slots de equipamentos
    const equipmentSlots = {
        weapon: document.getElementById('weapon-slot'),
        ring: document.getElementById('ring-slot'),
        helm: document.getElementById('helm-slot'),
        special1: document.getElementById('special1-slot'),
        amulet: document.getElementById('amulet-slot'),
        wing: document.getElementById('wing-slot'),
        armor: document.getElementById('armor-slot'),
        special2: document.getElementById('special2-slot')
    };

    // Tradução de slots
    const SLOT_MAP = {
        arma: 'weapon',
        anel: 'ring',
        elmo: 'helm',
        colar: 'amulet',
        asa: 'wing',
        armadura: 'armor'
    };

    // fallback para formatNumberCompact se não existir em outro script
    const formatNumberCompact = window.formatNumberCompact || ((n) => {
        try {
            if (n === 0) return "0";
            if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
            if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
            if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
            return String(n);
        } catch (e) {
            return String(n);
        }
    });

    function clearModalContent() {
        if (playerNameEl) playerNameEl.textContent = 'Carregando...';
        if (playerLevelEl) playerLevelEl.textContent = '';
        if (playerGuildFlagImg) playerGuildFlagImg.setAttribute("src", "https://aden-rpg.pages.dev/assets/guildaflag.webp");
        if (playerGuildNameEl) playerGuildNameEl.textContent = '';
        if (playerAvatarEl) playerAvatarEl.src = 'https://via.placeholder.com/100';
        if (combatPowerEl) combatPowerEl.textContent = '';

        const statsElements = [
            playerAttackEl,
            playerDefenseEl,
            playerHealthEl,
            playerCritChanceEl,
            playerCritDamageEl,
            playerEvasionEl
        ];
        statsElements.forEach(el => {
            if (!el) return;
            el.textContent = '';
            el.classList.add('shimmer');
        });

        Object.values(equipmentSlots).forEach(slot => {
            if (slot) {
                slot.innerHTML = '';
                slot.classList.add('shimmer');
            }
        });

        if (sendMpButton) {
            sendMpButton.style.display = 'none';
            sendMpButton.removeAttribute('data-player-id');
            sendMpButton.removeAttribute('data-player-name');
        }
    }

    // --- POPULATE MODAL OTIMIZADO ---
    // Agora usa cached_combat_stats em vez de calcular manualmente
    async function populateModal(player, equippedItems = [], guildData = null) {
        try {
            if (!player) return;

            // 1. Obtém Stats diretamente do JSON cacheado do banco
            // Se o JSON for nulo (conta nova/bug), usa fallback seguro
            const cachedStats = player.cached_combat_stats || {};
            
            // Fallback para atributos base se o JSON estiver vazio
            const stats = {
                min_attack: cachedStats.min_attack || player.min_attack || 0,
                attack: cachedStats.attack || player.attack || 0,
                defense: cachedStats.defense || player.defense || 0,
                health: cachedStats.health || player.health || 0,
                crit_chance: cachedStats.crit_chance || player.crit_chance || 0,
                crit_damage: cachedStats.crit_damage || player.crit_damage || 0,
                evasion: cachedStats.evasion || player.evasion || 0,
                // O avatar também pode vir do cache ou da coluna direta
                avatar_url: cachedStats.avatar_url || player.avatar_url
            };

            // Preenche UI - Identidade
            if (playerNameEl) playerNameEl.textContent = player.name || 'Jogador';
            if (playerLevelEl) playerLevelEl.textContent = `Nv. ${player.level || 1}`;

            if (playerGuildFlagImg) {
                playerGuildFlagImg.setAttribute("src",
                    guildData?.flag_url && guildData.flag_url.trim() !== ""
                        ? guildData.flag_url
                        : "https://aden-rpg.pages.dev/assets/guildaflag.webp"
                );
            }

            if (playerGuildNameEl) playerGuildNameEl.textContent = guildData?.name || '';
            if (playerAvatarEl) playerAvatarEl.src = stats.avatar_url || 'https://via.placeholder.com/100';

            // Preenche UI - Atributos Totais (Sem cálculo local)
            if (playerAttackEl) playerAttackEl.textContent = `${formatNumberCompact(stats.min_attack)} - ${formatNumberCompact(stats.attack)}`;
            if (playerDefenseEl) playerDefenseEl.textContent = `${formatNumberCompact(stats.defense)}`;
            if (playerHealthEl) playerHealthEl.textContent = `${formatNumberCompact(stats.health)}`;
            if (playerCritChanceEl) playerCritChanceEl.textContent = `${stats.crit_chance}%`;
            if (playerCritDamageEl) playerCritDamageEl.textContent = `${stats.crit_damage}%`;
            if (playerEvasionEl) playerEvasionEl.textContent = `${stats.evasion}%`;

            // CP (Se estiver disponível no objeto player ou calculado previamente)
            const cp = player.combat_power || 0; 
            if (combatPowerEl) combatPowerEl.textContent = `${formatNumberCompact(Number(cp))}`;

            // Remove shimmer
            const allShimmer = document.querySelectorAll('.shimmer');
            allShimmer.forEach(el => el.classList.remove('shimmer'));

            // Limpa slots e monta equipamentos (Visual Only)
            Object.values(equipmentSlots).forEach(slot => {
                if (slot) slot.innerHTML = '';
            });

            (equippedItems || []).forEach(invItem => {
                const mapped = SLOT_MAP[invItem.equipped_slot] || invItem.equipped_slot;
                if (mapped && equipmentSlots[mapped]) {
                    const slotDiv = equipmentSlots[mapped];
                    if (!slotDiv) return;

                    const totalStars = (invItem.items?.stars || 0) + (invItem.refine_level || 0);
                    const safeName = invItem.items?.name || 'unknown';
                    const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${safeName}_${totalStars}estrelas.webp`;

                    slotDiv.innerHTML = `<img src="${imgSrc}" alt="${invItem.items?.display_name || ''}">`;

                    if (invItem.level && invItem.level >= 1) {
                        const levelElement = document.createElement('div');
                        levelElement.className = 'item-level';
                        levelElement.textContent = `Nv. ${invItem.level}`;
                        slotDiv.appendChild(levelElement);
                    }
                }
            });

        } catch (e) {
            console.error('Erro ao popular modal:', e);
        }
    }

    // ----------------------------------------
    // fetchPlayerData: OTIMIZADO
    // ----------------------------------------
    async function fetchPlayerData(playerId) {
        try {
            if (!supabase) {
                console.error("Supabase não inicializado.");
                return;
            }

            // --- ID do usuário atual (para lógica do botão MP) ---
            let currentUserId = null;
            const globalAuth = await GlobalDB.getAuth();
            if (globalAuth && globalAuth.value && globalAuth.value.user) {
                currentUserId = globalAuth.value.user.id;
            } else {
                try {
                    const { data: sessionData } = await supabase.auth.getSession({ cache: 'memory-only' });
                    currentUserId = sessionData?.session?.user?.id || null;
                } catch (e) {}
            }

            clearModalContent();

            const cacheKey = `player_modal_data_${playerId}`;
            const cachedData = getCache(cacheKey);

            // --- Validação de Cache ---
            if (cachedData) {
                let validationFailed = false;
                let newProfileUpdate = null;
                let newGuildId = null;
                let newEquipmentFingerprint = { total_item_level: 0, equipped_count: 0 }; 

                try {
                    // Checagem Leve 1: Perfil
                    const profilePromise = supabase
                        .from('players')
                        .select('last_profile_update, guild_id')
                        .eq('id', playerId)
                        .single();

                    // Checagem Leve 2: Impressão digital dos itens (apenas id e level)
                    // Necessário para saber se mudou o visual dos itens
                    const itemsPromise = supabase
                        .from('inventory_items')
                        .select('level, id')
                        .eq('player_id', playerId)
                        .not('equipped_slot', 'is', null);

                    const [profileResult, itemsResult] = await Promise.all([profilePromise, itemsPromise]);

                    if (profileResult.error) throw profileResult.error;

                    newProfileUpdate = profileResult.data.last_profile_update;
                    newGuildId = profileResult.data.guild_id;

                    if (!itemsResult.error && itemsResult.data) {
                        newEquipmentFingerprint.equipped_count = itemsResult.data.length;
                        newEquipmentFingerprint.total_item_level = itemsResult.data.reduce(
                            (sum, item) => sum + (Number(item.level) || 0), 0
                        );
                    }

                } catch (e) {
                    console.warn("[playerModal.js] Falha na validação cache. Forçando refresh.", e);
                    validationFailed = true;
                }

                const profileMatches = (newProfileUpdate === cachedData.player.last_profile_update);
                const guildMatches = (newGuildId === cachedData.player.guild_id);
                const cachedFingerprint = cachedData.equipmentFingerprint || { total_item_level: 0, equipped_count: 0 }; 
                const levelMatches = newEquipmentFingerprint.total_item_level === cachedFingerprint.total_item_level;
                const countMatches = newEquipmentFingerprint.equipped_count === cachedFingerprint.equipped_count;

                if (!validationFailed && profileMatches && guildMatches && levelMatches && countMatches) {
                    // Configura botão MP
                    if (sendMpButton) {
                        sendMpButton.setAttribute('data-player-id', cachedData.player.id);
                        sendMpButton.setAttribute('data-player-name', cachedData.player.name);
                        sendMpButton.style.display = (currentUserId && cachedData.player.id === currentUserId) ? 'none' : 'flex';
                    }
                    
                    await populateModal(cachedData.player, cachedData.items || [], cachedData.guildData);
                    return; // Cache hit
                }
            }
            // --- Fim Validação Cache ---


            // --- BUSCA FRESCA OTIMIZADA ---
            console.log(`[playerModal.js] Buscando dados frescos para ${playerId}`);

            // 1. Busca Player + Cached Stats (Substitui busca de colunas individuais)
            const { data: player, error: playerError } = await supabase
                .from('players')
                .select(`
                    id, name, level, avatar_url, guild_id, last_profile_update, combat_power,
                    cached_combat_stats
                `)
                .eq('id', playerId)
                .single();

            if (playerError || !player) {
                console.error('Erro ao buscar jogador', playerError);
                return;
            }

            // 2. BUSCA DE ITENS OTIMIZADA (Apenas visual)
            // Removemos attack, defense, crit, etc. da query.
            const { data: items, error: itemsError } = await supabase
                .from('inventory_items')
                .select(`
                    id,
                    equipped_slot,
                    level,
                    refine_level,
                    items (name, display_name, stars)
                `)
                .eq('player_id', playerId)
                .not('equipped_slot', 'is', null);

            if (itemsError) console.error('Erro ao buscar itens', itemsError);

            // 3. Busca Guilda (se houver)
            let guildData = null;
            if (player.guild_id) {
                try {
                    const { data: guild } = await supabase
                        .from('guilds')
                        .select('id, name, flag_url')
                        .eq('id', player.guild_id)
                        .single();
                    guildData = guild;
                } catch (e) { console.warn("Erro ao buscar guilda:", e); }
            }

            // Configura botão MP
            if (sendMpButton) {
                sendMpButton.setAttribute('data-player-id', player.id);
                sendMpButton.setAttribute('data-player-name', player.name);
                sendMpButton.style.display = (currentUserId && player.id === currentUserId) ? 'none' : 'flex';
            }

            // Popula Modal
            await populateModal(player, items || [], guildData);

            // --- Salva Cache ---
            try {
                const allItems = items || [];
                const newFingerprint = {
                    total_item_level: allItems.reduce((sum, item) => sum + (Number(item.level) || 0), 0),
                    equipped_count: allItems.length
                };
                
                setCache(cacheKey, { 
                    player, 
                    items: allItems, 
                    guildData, 
                    equipmentFingerprint: newFingerprint 
                }, CACHE_TTL_MS);
            } catch (e) {
                console.error("[playerModal.js] Erro ao salvar cache:", e);
            }

        } catch (e) {
            console.error('Erro inesperado ao carregar dados do jogador', e);
        }
    }

    // Event listeners
    closeBtn?.addEventListener('click', () => {
        if (playerModal) playerModal.style.display = 'none';
    });

    const setupClickListener = (listId) => {
        const list = document.getElementById(listId);
        if (list) {
            list.addEventListener('click', (e) => {
                const link = e.target.closest('.player-link');
                if (!link) return;
                const playerId = link.dataset.playerId;
                if (!playerId) return;

                if (playerModal) playerModal.style.display = 'flex';
                fetchPlayerData(playerId);
            });
        }
    };

    setupClickListener('guildMemberList');
    setupClickListener('guildViewMemberList');
    setupClickListener('guildRequestsList');

    window.clearModalContent = clearModalContent;
    window.fetchPlayerData = fetchPlayerData;

    console.log("[playerModal.js] carregado (versão otimizada cached_stats).");
});