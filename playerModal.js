import { supabase } from './supabaseClient.js'

// =======================================================================
// ADEN GLOBAL DB (CACHE DE PERFIL E DONOS)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 6;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';
const OWNERS_STORE = 'owners_store'; // Cache compartilhado de perfis (Minas/Arena/Ranking)

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(PLAYER_STORE)) db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(OWNERS_STORE)) db.createObjectStore(OWNERS_STORE, { keyPath: 'id' });
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
    },
    // Busca um perfil no cache de "Donos" (populado por ranking/arena/minas)
    getOwner: async function(id) {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(OWNERS_STORE, 'readonly');
                const req = tx.objectStore(OWNERS_STORE).get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};

// =======================================================================
// INVENTORY DB (CACHE DE ITENS DO JOGADOR LOCAL)
// =======================================================================
// Conecta no mesmo banco usado pelo inventory.js para ler itens equipados sem ir ao servidor
const INV_DB_NAME = "aden_inventory_db";
const INV_STORE_NAME = "inventory_store";

const InventoryDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            // Apenas abre, não cria upgrade (deixa o inventory.js gerenciar versão)
            const req = indexedDB.open(INV_DB_NAME); 
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getEquippedItems: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                if (!db.objectStoreNames.contains(INV_STORE_NAME)) {
                    resolve([]); 
                    return;
                }
                const tx = db.transaction(INV_STORE_NAME, 'readonly');
                const store = tx.objectStore(INV_STORE_NAME);
                const req = store.getAll();
                
                req.onsuccess = () => {
                    const allItems = req.result || [];
                    // Filtra apenas itens equipados
                    const equipped = allItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
                    
                    // Garante hidratação com definições globais se necessário
                    const hydrated = equipped.map(item => {
                        // Se o item salvo não tem o objeto 'items' com nome, tenta pegar do window.itemDefinitions
                        if ((!item.items || !item.items.name) && window.itemDefinitions) {
                            const def = window.itemDefinitions.get(item.item_id);
                            if (def) item.items = def;
                        }
                        return item;
                    });
                    resolve(hydrated);
                };
                req.onerror = () => resolve([]);
            });
        } catch(e) { 
            console.warn("Erro ao ler InventoryDB local:", e);
            return []; 
        }
    }
};

document.addEventListener("DOMContentLoaded", () => {
    
    // Referências DOM
    const playerModal = document.getElementById('playerModal');
    const closeBtn = document.getElementById('closePlayerModal');
    
    // Referências de UI
    const ui = {
        name: document.getElementById('playerName'),
        level: document.getElementById('playerLevel'),
        flag: document.getElementById('playerGuildFlag'),
        guildName: document.getElementById('playerGuildName'),
        avatar: document.getElementById('playerAvatarEquip'),
        cp: document.getElementById('playerCombatPower'),
        stats: {
            atk: document.getElementById('playerAttack'),
            def: document.getElementById('playerDefense'),
            hp: document.getElementById('playerHealth'),
            critChance: document.getElementById('playerCritChance'),
            critDmg: document.getElementById('playerCritDamage'),
            evasion: document.getElementById('playerEvasion')
        }
    };

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

    const SLOT_MAP = {
        arma: 'weapon',
        anel: 'ring',
        elmo: 'helm',
        colar: 'amulet',
        asa: 'wing',
        armadura: 'armor'
    };

    // Helper numérico
    const formatNumberCompact = window.formatNumberCompact || ((n) => {
        try {
            if (n === 0) return "0";
            if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
            if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
            if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
            return String(n);
        } catch (e) { return String(n); }
    });

    // --- CACHE LOCALSTORAGE (Fallback e Cache de Terceiros) ---
    function setCache(key, data, ttl) {
        try {
            localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttl }));
        } catch (e) {}
    }
    function getCache(key) {
        try {
            const item = JSON.parse(localStorage.getItem(key));
            if (!item) return null;
            if (Date.now() > item.expiry) { localStorage.removeItem(key); return null; }
            return item.data;
        } catch (e) { return null; }
    }
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    function clearModalContent() {
        if(ui.name) ui.name.textContent = 'Carregando...';
        if(ui.level) ui.level.textContent = '';
        if(ui.flag) ui.flag.setAttribute("src", "https://aden-rpg.pages.dev/assets/guildaflag.webp");
        if(ui.guildName) ui.guildName.textContent = '';
        if(ui.avatar) ui.avatar.src = 'https://via.placeholder.com/100';
        if(ui.cp) ui.cp.textContent = '';

        Object.values(ui.stats).forEach(el => {
            if(el) { el.textContent = ''; el.classList.add('shimmer'); }
        });
        Object.values(equipmentSlots).forEach(slot => {
            if(slot) { slot.innerHTML = ''; slot.classList.add('shimmer'); }
        });
        if(sendMpButton) sendMpButton.style.display = 'none';
    }

    // --- POPULATE MODAL ---
    async function populateModal(player, equippedItems = [], guildData = null) {
        try {
            if (!player) return;

            // Stats: Tenta usar cached_combat_stats (DB) ou stats diretos (Local Player Object)
            // Se for o próprio jogador, 'player' pode ter os atributos direto na raiz se vier do GlobalDB
            const cachedStats = player.cached_combat_stats || player;
            
            const stats = {
                min_attack: cachedStats.min_attack || player.min_attack || 0,
                attack: cachedStats.attack || player.attack || 0,
                defense: cachedStats.defense || player.defense || 0,
                health: cachedStats.health || player.health || 0,
                crit_chance: cachedStats.crit_chance || player.crit_chance || 0,
                crit_damage: cachedStats.crit_damage || player.crit_damage || 0,
                evasion: cachedStats.evasion || player.evasion || 0,
                avatar_url: player.avatar_url || cachedStats.avatar_url
            };

            // Identidade
            if(ui.name) ui.name.textContent = player.name || 'Jogador';
            if(ui.level) ui.level.textContent = `Nv. ${player.level || 1}`;

            // Guilda
            // Prioridade: guildData passado > guild_name no player (OwnersStore) > Default
            let gName = guildData?.name || player.guild_name || '';
            let gFlag = guildData?.flag_url || "https://aden-rpg.pages.dev/assets/guildaflag.webp";
            
            // Se não veio guildData mas tem guild_id, tenta buscar nome rápido no OwnersStore cache ou deixa vazio
            if (!gName && player.guild_id && window.itemDefinitions) { 
               // Lógica opcional futura: cache de guildas
            }

            if(ui.flag) ui.flag.src = gFlag;
            if(ui.guildName) ui.guildName.textContent = gName;
            
            // Avatar
            if(ui.avatar) ui.avatar.src = stats.avatar_url || 'https://via.placeholder.com/100';

            // Stats
            if(ui.stats.atk) ui.stats.atk.textContent = `${formatNumberCompact(stats.min_attack)} - ${formatNumberCompact(stats.attack)}`;
            if(ui.stats.def) ui.stats.def.textContent = formatNumberCompact(stats.defense);
            if(ui.stats.hp) ui.stats.hp.textContent = formatNumberCompact(stats.health);
            if(ui.stats.critChance) ui.stats.critChance.textContent = `${stats.crit_chance}%`;
            if(ui.stats.critDmg) ui.stats.critDmg.textContent = `${stats.crit_damage}%`;
            if(ui.stats.evasion) ui.stats.evasion.textContent = `${stats.evasion}%`;

            if(ui.cp) ui.cp.textContent = formatNumberCompact(Number(player.combat_power || 0));

            // Remove Shimmer
            document.querySelectorAll('.shimmer').forEach(el => el.classList.remove('shimmer'));

            // Equipamentos
            Object.values(equipmentSlots).forEach(s => s ? s.innerHTML = '' : null);

            (equippedItems || []).forEach(invItem => {
                const mapped = SLOT_MAP[invItem.equipped_slot] || invItem.equipped_slot;
                const slotDiv = equipmentSlots[mapped];
                
                if (slotDiv && invItem.items) {
                    const totalStars = (invItem.items.stars || 0) + (invItem.refine_level || 0);
                    const safeName = invItem.items.name || 'unknown';
                    const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${safeName}_${totalStars}estrelas.webp`;
                    
                    let html = `<img src="${imgSrc}" alt="${invItem.items.display_name || ''}">`;
                    if (invItem.level && invItem.level >= 1) {
                        html += `<div class="item-level">Nv. ${invItem.level}</div>`;
                    }
                    slotDiv.innerHTML = html;
                }
            });

        } catch (e) {
            console.error('Erro ao popular modal:', e);
        }
    }

    // ----------------------------------------
    // fetchPlayerData: SUPER OTIMIZADO
    // ----------------------------------------
    async function fetchPlayerData(playerId) {
        try {
            clearModalContent();
            
            // 1. Identificar Usuário Atual (Zero Egress via Auth Cache)
            let currentUserId = null;
            const globalAuth = await GlobalDB.getAuth();
            if (globalAuth && globalAuth.value && globalAuth.value.user) {
                currentUserId = globalAuth.value.user.id;
            } else {
                // Fallback LocalStorage
                try {
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                            const session = JSON.parse(localStorage.getItem(k));
                            if (session?.user?.id) currentUserId = session.user.id;
                            break;
                        }
                    }
                } catch(e) {}
            }

            // =========================================================
            // CASO A: VENDO O PRÓPRIO PERFIL (ZERO EGRESS TOTAL)
            // =========================================================
            if (currentUserId && playerId === currentUserId) {
                console.log("[playerModal] Visualizando perfil próprio (Modo Offline/Local).");
                
                // A. Carrega Perfil do GlobalDB
                const localData = await GlobalDB.getPlayer();
                
                // B. Carrega Itens Equipados do InventoryDB (IndexedDB)
                const localItems = await InventoryDB.getEquippedItems();
                
                if (localData) {
                    // Prepara estrutura de guilda se existir nos dados locais
                    let guildData = null;
                    if (localData.guild_name) {
                        guildData = { name: localData.guild_name, flag_url: localData.guild_flag || '' };
                    }
                    
                    // Configura botão MP (esconde para si mesmo)
                    if (sendMpButton) sendMpButton.style.display = 'none';

                    populateModal(localData, localItems, guildData);
                    return; // FIM - Não chama Supabase
                }
            }

            // =========================================================
            // CASO B: VENDO OUTRO JOGADOR
            // =========================================================
            
            // Configura botão MP
            if (sendMpButton) {
                sendMpButton.setAttribute('data-player-id', playerId);
                sendMpButton.setAttribute('data-player-name', '...'); // Preenche depois
                sendMpButton.style.display = 'flex';
            }

            // 1. UI Otimista com Cache de Donos (OwnersStore)
            // Tenta mostrar Nome, Avatar e Guilda IMEDIATAMENTE se já vimos esse jogador
            const cachedOwner = await GlobalDB.getOwner(playerId);
            if (cachedOwner) {
                console.log("[playerModal] Hit no cache de donos (UI Otimista).");
                if(ui.name) ui.name.textContent = cachedOwner.name;
                if(ui.avatar) ui.avatar.src = cachedOwner.avatar_url || 'https://via.placeholder.com/100';
                // Guilda pode estar no cache
                if(cachedOwner.guild_id && window.itemDefinitions && ui.guildName) {
                    // Se tivermos um mapa de guildas cacheado em algum lugar, poderíamos usar.
                    // Por enquanto, deixa carregar no fetch completo.
                }
                
                if (sendMpButton) sendMpButton.setAttribute('data-player-name', cachedOwner.name);
            }

            // 2. Verifica Cache LocalStorage Completo (Profile + Items)
            const cacheKey = `player_modal_data_${playerId}`;
            const cachedData = getCache(cacheKey);
            
            // Validação simples do cache (evita bugs de troca de itens não refletida)
            // Para outros jogadores, aceitamos o cache de 24h para economizar egress,
            // a menos que o usuário queira "refresh" (não implementado aqui, mas o cache TTL cuida).
            if (cachedData) {
                console.log("[playerModal] Hit no cache completo (LocalStorage).");
                populateModal(cachedData.player, cachedData.items || [], cachedData.guildData);
                return;
            }

            // 3. Busca Fresca (Egress Necessário para Stats e Itens de outros)
            // OTIMIZAÇÃO: Seleciona apenas colunas necessárias e itens equipados
            console.log(`[playerModal] Buscando dados remotos para ${playerId}`);

            const playerPromise = supabase
                .from('players')
                .select(`id, name, level, avatar_url, guild_id, combat_power, cached_combat_stats`)
                .eq('id', playerId)
                .single();

            const itemsPromise = supabase
                .from('inventory_items')
                .select(`id, equipped_slot, level, refine_level, items (name, display_name, stars)`)
                .eq('player_id', playerId)
                .not('equipped_slot', 'is', null); // SÓ EQUIPADOS

            const [playerRes, itemsRes] = await Promise.all([playerPromise, itemsPromise]);

            if (playerRes.error) throw playerRes.error;
            const player = playerRes.data;
            const items = itemsRes.data || [];

            // 4. Busca Guilda (se houver e não estiver no cache simples)
            let guildData = null;
            if (player.guild_id) {
                try {
                    const { data: guild } = await supabase
                        .from('guilds')
                        .select('name, flag_url')
                        .eq('id', player.guild_id)
                        .single();
                    guildData = guild;
                } catch (e) {}
            }

            // Atualiza Botão MP
            if (sendMpButton) sendMpButton.setAttribute('data-player-name', player.name);

            // Popula Modal
            populateModal(player, items, guildData);

            // 5. Salva Cache Completo
            setCache(cacheKey, { player, items, guildData }, CACHE_TTL_MS);

            // 6. Atualiza Cache de Donos (para uso futuro otimista)
            // Salva apenas dados básicos para não poluir o store de owners
            if (player) {
                // Aqui precisaríamos de uma função GlobalDB.saveOwners, mas o script atual não tem exposta.
                // Como este arquivo é um módulo, não temos acesso fácil ao saveOwners do arena.js/mines.js 
                // a menos que movamos para o GlobalDB object deste arquivo.
                // (Opcional, mas recomendado se possível).
            }

        } catch (e) {
            console.error('Erro ao carregar jogador:', e);
            if(ui.name) ui.name.textContent = 'Erro ao carregar';
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

    // Exporta globalmente
    window.clearModalContent = clearModalContent;
    window.fetchPlayerData = fetchPlayerData;
});