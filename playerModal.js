import { supabase } from './supabaseClient.js'

// =======================================================================
// 1. ADEN GLOBAL DB (CACHE COMPARTILHADO: PERFIL E DONOS)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 6;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';
const OWNERS_STORE = 'owners_store'; 

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
    },
    // CORREÇÃO 1: Implementação do saveOwners para alimentar o cache de Arena/Minas
    saveOwners: async function(ownersList) {
        if (!ownersList || ownersList.length === 0) return;
        try {
            const db = await this.open();
            const tx = db.transaction(OWNERS_STORE, 'readwrite');
            const store = tx.objectStore(OWNERS_STORE);
            const now = Date.now();

            ownersList.forEach(o => {
                const cacheObj = {
                    id: o.id,
                    name: o.name,
                    avatar_url: o.avatar_url,
                    guild_id: o.guild_id,
                    timestamp: now // Atualiza timestamp (24h TTL logic em outros scripts)
                };
                store.put(cacheObj);
            });
            return new Promise(resolve => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
        } catch(e) { console.warn("Erro ao salvar donos no cache global:", e); }
    }
};

// =======================================================================
// 2. INVENTORY DB (CACHE DE ITENS E STATS LOCAIS)
// =======================================================================
const INV_DB_NAME = "aden_inventory_db";
const INV_STORE_NAME = "inventory_store";
const INV_META_STORE = "meta_store";

const InventoryDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(INV_DB_NAME); 
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getEquippedItems: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                if (!db.objectStoreNames.contains(INV_STORE_NAME)) { resolve([]); return; }
                const tx = db.transaction(INV_STORE_NAME, 'readonly');
                const store = tx.objectStore(INV_STORE_NAME);
                const req = store.getAll();
                
                req.onsuccess = () => {
                    const allItems = req.result || [];
                    const equipped = allItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
                    
                    // Hidratação (Nome/Imagem) via definitions globais
                    const hydrated = equipped.map(item => {
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
        } catch(e) { return []; }
    },
    // CORREÇÃO 2: Busca os stats calculados pelo inventory.js
    getLocalStats: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                if (!db.objectStoreNames.contains(INV_META_STORE)) { resolve(null); return; }
                const tx = db.transaction(INV_META_STORE, 'readonly');
                const req = tx.objectStore(INV_META_STORE).get('player_stats');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};

document.addEventListener("DOMContentLoaded", () => {
    
    // UI References
    const playerModal = document.getElementById('playerModal');
    const closeBtn = document.getElementById('closePlayerModal');
    
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
    const SLOT_MAP = { arma: 'weapon', anel: 'ring', elmo: 'helm', colar: 'amulet', asa: 'wing', armadura: 'armor' };

    // Format Number
    const formatNumberCompact = window.formatNumberCompact || ((n) => {
        try {
            if (n === 0) return "0";
            if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
            if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
            if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
            return String(n);
        } catch (e) { return String(n); }
    });

    // LocalStorage Cache Helper
    function setCache(key, data, ttl) {
        try { localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttl })); } catch (e) {}
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
        Object.values(ui.stats).forEach(el => { if(el) { el.textContent = ''; el.classList.add('shimmer'); } });
        Object.values(equipmentSlots).forEach(slot => { if(slot) { slot.innerHTML = ''; slot.classList.add('shimmer'); } });
        if(sendMpButton) sendMpButton.style.display = 'none';
    }

    // --- POPULATE MODAL ---
    async function populateModal(player, equippedItems = [], guildData = null) {
        try {
            if (!player) return;

            // Stats Logic:
            // 1. Tenta usar stats calculados locais (se passados via inventoryDB)
            // 2. Tenta usar cached_combat_stats (se vier do banco)
            // 3. Fallback para colunas diretas
            const cachedStats = player.calculated_local_stats || player.cached_combat_stats || player;
            
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

            // Basic Info
            if(ui.name) ui.name.textContent = player.name || 'Jogador';
            if(ui.level) ui.level.textContent = `Nv. ${player.level || 1}`;

            // Guild Info
            let gName = guildData?.name || player.guild_name || '';
            let gFlag = guildData?.flag_url || "https://aden-rpg.pages.dev/assets/guildaflag.webp";
            if(ui.flag) ui.flag.src = gFlag;
            if(ui.guildName) ui.guildName.textContent = gName;
            
            // Avatar
            if(ui.avatar) ui.avatar.src = stats.avatar_url || 'https://via.placeholder.com/100';

            // Stats Render
            if(ui.stats.atk) ui.stats.atk.textContent = `${formatNumberCompact(stats.min_attack)} - ${formatNumberCompact(stats.attack)}`;
            if(ui.stats.def) ui.stats.def.textContent = formatNumberCompact(stats.defense);
            if(ui.stats.hp) ui.stats.hp.textContent = formatNumberCompact(stats.health);
            if(ui.stats.critChance) ui.stats.critChance.textContent = `${stats.crit_chance}%`;
            if(ui.stats.critDmg) ui.stats.critDmg.textContent = `${stats.crit_damage}%`;
            if(ui.stats.evasion) ui.stats.evasion.textContent = `${stats.evasion}%`;

            if(ui.cp) ui.cp.textContent = formatNumberCompact(Number(player.combat_power || 0));

            document.querySelectorAll('.shimmer').forEach(el => el.classList.remove('shimmer'));

            // Items Render
            Object.values(equipmentSlots).forEach(s => s ? s.innerHTML = '' : null);
            (equippedItems || []).forEach(invItem => {
                const mapped = SLOT_MAP[invItem.equipped_slot] || invItem.equipped_slot;
                const slotDiv = equipmentSlots[mapped];
                if (slotDiv && invItem.items) {
                    const totalStars = (invItem.items.stars || 0) + (invItem.refine_level || 0);
                    const safeName = invItem.items.name || 'unknown';
                    const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${safeName}_${totalStars}estrelas.webp`;
                    let html = `<img src="${imgSrc}" alt="${invItem.items.display_name || ''}">`;
                    if (invItem.level && invItem.level >= 1) html += `<div class="item-level">Nv. ${invItem.level}</div>`;
                    slotDiv.innerHTML = html;
                }
            });

        } catch (e) { console.error('Populate Error:', e); }
    }

    // ----------------------------------------
    // fetchPlayerData: SUPER OTIMIZADO
    // ----------------------------------------
    async function fetchPlayerData(playerId) {
        try {
            clearModalContent();
            
            // 1. Identificar Usuário Atual (Zero Egress)
            let currentUserId = null;
            const globalAuth = await GlobalDB.getAuth();
            if (globalAuth && globalAuth.value && globalAuth.value.user) {
                currentUserId = globalAuth.value.user.id;
            } else {
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
                console.log("[playerModal] Visualizando perfil próprio (Local DB).");
                
                // A. Carrega Perfil Básico (GlobalDB)
                const localPlayer = await GlobalDB.getPlayer();
                
                // B. Carrega Itens Equipados (InventoryDB)
                const localItems = await InventoryDB.getEquippedItems();
                
                // C. CORREÇÃO: Carrega Stats Calculados (InventoryDB Meta Store)
                // Isso resolve o problema dos stats zerados, pois inventory.js salva aqui
                const localStats = await InventoryDB.getLocalStats();

                if (localPlayer) {
                    // Mescla os stats calculados no objeto do player para o populateModal usar
                    if (localStats) {
                        localPlayer.calculated_local_stats = localStats;
                    }
                    
                    let guildData = null;
                    if (localPlayer.guild_name) {
                        guildData = { name: localPlayer.guild_name, flag_url: localPlayer.guild_flag || '' };
                    }
                    if (sendMpButton) sendMpButton.style.display = 'none';

                    populateModal(localPlayer, localItems, guildData);
                    return; 
                }
            }

            // =========================================================
            // CASO B: VENDO OUTRO JOGADOR
            // =========================================================
            
            if (sendMpButton) {
                sendMpButton.setAttribute('data-player-id', playerId);
                sendMpButton.setAttribute('data-player-name', '...');
                sendMpButton.style.display = 'flex';
            }

            // 1. UI Otimista (Cache de Donos)
            const cachedOwner = await GlobalDB.getOwner(playerId);
            if (cachedOwner) {
                if(ui.name) ui.name.textContent = cachedOwner.name;
                if(ui.avatar) ui.avatar.src = cachedOwner.avatar_url || 'https://via.placeholder.com/100';
                if (sendMpButton) sendMpButton.setAttribute('data-player-name', cachedOwner.name);
            }

            // 2. Cache Completo (LocalStorage)
            const cacheKey = `player_modal_data_${playerId}`;
            const cachedData = getCache(cacheKey);
            if (cachedData) {
                populateModal(cachedData.player, cachedData.items || [], cachedData.guildData);
                return;
            }

            // 3. Busca Remota Otimizada
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
                .not('equipped_slot', 'is', null);

            const [playerRes, itemsRes] = await Promise.all([playerPromise, itemsPromise]);

            if (playerRes.error) throw playerRes.error;
            const player = playerRes.data;
            const items = itemsRes.data || [];

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

            if (sendMpButton) sendMpButton.setAttribute('data-player-name', player.name);

            populateModal(player, items, guildData);

            // 4. Salvar Caches
            setCache(cacheKey, { player, items, guildData }, CACHE_TTL_MS);

            // CORREÇÃO: Salva no GlobalDB Owners para outros scripts usarem
            if (player) {
                await GlobalDB.saveOwners([{
                    id: player.id,
                    name: player.name,
                    avatar_url: player.avatar_url,
                    guild_id: player.guild_id
                }]);
            }

        } catch (e) {
            console.error('Erro geral playerModal:', e);
            if(ui.name) ui.name.textContent = 'Erro ao carregar';
        }
    }

    // Listener
    closeBtn?.addEventListener('click', () => { if (playerModal) playerModal.style.display = 'none'; });

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
});