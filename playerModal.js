import { supabase } from './supabaseClient.js'

console.log("🚀 playerModal.js: Carregado e aguardando interações.");

// =======================================================================
// 1. ADEN GLOBAL DB (CACHE DE DONOS - UI OTIMISTA)
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
    }
};

// =======================================================================
// 2. INVENTORY DB (CACHE DE ITENS E STATS LOCAIS)
// =======================================================================
const INV_DB_NAME = "aden_inventory_db";
const INV_STORE_NAME = "inventory_store";
const META_STORE_NAME = "meta_store";

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
                const req = tx.objectStore(INV_STORE_NAME).getAll();
                req.onsuccess = () => {
                    const all = req.result || [];
                    const equipped = all.filter(i => i.equipped_slot !== null && i.quantity > 0);
                    // Tenta hidratar com definições globais se faltar dados
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
    getStats: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                if (!db.objectStoreNames.contains(META_STORE_NAME)) { resolve(null); return; }
                const tx = db.transaction(META_STORE_NAME, 'readonly');
                // O inventory.js salva como key='player_stats'
                const req = tx.objectStore(META_STORE_NAME).get('player_stats');
                req.onsuccess = () => {
                    // O objeto salvo geralmente é { key: 'player_stats', value: {...} } ou direto o objeto
                    const res = req.result;
                    if (!res) resolve(null);
                    else resolve(res.value || res); // Suporta os dois formatos
                };
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};

// =======================================================================
// 3. LÓGICA DE UI E MODAL
// =======================================================================

// Função auxiliar para cache no LocalStorage (memória curta para visitas)
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
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

// Referências DOM (carregadas dinamicamente)
const getUiElements = () => ({
    modal: document.getElementById('playerModal'),
    name: document.getElementById('playerName'),
    level: document.getElementById('playerLevel'),
    flag: document.getElementById('playerGuildFlag'),
    guildName: document.getElementById('playerGuildName'),
    avatar: document.getElementById('playerAvatarEquip'),
    cp: document.getElementById('playerCombatPower'),
    sendMpBtn: document.getElementById('sendmp'),
    stats: {
        atk: document.getElementById('playerAttack'),
        def: document.getElementById('playerDefense'),
        hp: document.getElementById('playerHealth'),
        critChance: document.getElementById('playerCritChance'),
        critDmg: document.getElementById('playerCritDamage'),
        evasion: document.getElementById('playerEvasion')
    },
    slots: {
        weapon: document.getElementById('weapon-slot'),
        ring: document.getElementById('ring-slot'),
        helm: document.getElementById('helm-slot'),
        special1: document.getElementById('special1-slot'),
        amulet: document.getElementById('amulet-slot'),
        wing: document.getElementById('wing-slot'),
        armor: document.getElementById('armor-slot'),
        special2: document.getElementById('special2-slot')
    }
});

const SLOT_MAP = { arma: 'weapon', anel: 'ring', elmo: 'helm', colar: 'amulet', asa: 'wing', armadura: 'armor' };
const formatNumberCompact = window.formatNumberCompact || ((n) => n);

function clearModalContent() {
    const ui = getUiElements();
    if (ui.name) ui.name.textContent = 'Carregando...';
    if (ui.level) ui.level.textContent = '';
    if (ui.flag) ui.flag.src = "https://aden-rpg.pages.dev/assets/guildaflag.webp";
    if (ui.guildName) ui.guildName.textContent = '';
    if (ui.avatar) ui.avatar.src = 'https://via.placeholder.com/100';
    if (ui.cp) ui.cp.textContent = '';
    if (ui.sendMpBtn) ui.sendMpBtn.style.display = 'none';

    // Limpa stats e slots com efeito shimmer
    Object.values(ui.stats).forEach(el => { if(el) { el.textContent = ''; el.classList.add('shimmer'); } });
    Object.values(ui.slots).forEach(el => { if(el) { el.innerHTML = ''; el.classList.add('shimmer'); } });
}

function populateModal(player, equippedItems = [], guildData = null) {
    const ui = getUiElements();
    if (!player) return;

    // Prioriza stats cacheados ou diretos
    const s = player.cached_combat_stats || player; 
    
    // Fallback seguro para zeros
    const val = (v) => v ? Math.floor(v) : 0;

    if(ui.name) ui.name.textContent = player.name || 'Desconhecido';
    if(ui.level) ui.level.textContent = `Nv. ${player.level || 1}`;
    
    // Guilda
    const gName = guildData?.name || player.guild_name || 'Sem Guilda';
    const gFlag = guildData?.flag_url || "https://aden-rpg.pages.dev/assets/guildaflag.webp";
    if(ui.guildName) ui.guildName.textContent = gName;
    if(ui.flag) ui.flag.src = gFlag;

    // Avatar
    if(ui.avatar) ui.avatar.src = player.avatar_url || s.avatar_url || 'https://aden-rpg.pages.dev/avatar01.webp';

    // CP
    if(ui.cp) ui.cp.textContent = formatNumberCompact(Number(player.combat_power || 0));

    // Stats
    if(ui.stats.atk) ui.stats.atk.textContent = `${formatNumberCompact(val(s.min_attack))} - ${formatNumberCompact(val(s.attack))}`;
    if(ui.stats.def) ui.stats.def.textContent = formatNumberCompact(val(s.defense));
    if(ui.stats.hp) ui.stats.hp.textContent = formatNumberCompact(val(s.health));
    if(ui.stats.critChance) ui.stats.critChance.textContent = `${val(s.crit_chance)}%`;
    if(ui.stats.critDmg) ui.stats.critDmg.textContent = `${val(s.crit_damage)}%`;
    if(ui.stats.evasion) ui.stats.evasion.textContent = `${val(s.evasion)}%`;

    // Remove Shimmer
    document.querySelectorAll('.shimmer').forEach(el => el.classList.remove('shimmer'));

    // Itens
    Object.values(ui.slots).forEach(s => s ? s.innerHTML = '' : null);

    (equippedItems || []).forEach(item => {
        const slotKey = SLOT_MAP[item.equipped_slot] || item.equipped_slot;
        const div = ui.slots[slotKey];
        if (div && item.items) {
            const stars = (item.items.stars || 0) + (item.refine_level || 0);
            const safeName = item.items.name || 'unknown';
            const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${safeName}_${stars}estrelas.webp`;
            
            let html = `<img src="${imgSrc}" onerror="this.src='https://via.placeholder.com/64?text=?'">`;
            if (item.level > 0) html += `<div class="item-level">+${item.level}</div>`;
            div.innerHTML = html;
        }
    });
}

// ----------------------------------------
// FETCH PLAYER DATA (A "Mágica")
// ----------------------------------------
async function fetchPlayerData(playerId) {
    const ui = getUiElements();
    if (!ui.modal) {
        console.error("❌ Modal element #playerModal não encontrado no DOM.");
        return;
    }

    // 1. Abre o Modal
    ui.modal.style.display = 'flex';
    clearModalContent();

    try {
        // --- Identificar Usuário Atual (Cache Auth) ---
        let currentUserId = null;
        const globalAuth = await GlobalDB.getAuth();
        if (globalAuth?.user?.id) {
            currentUserId = globalAuth.user.id;
        } else {
            // Fallback LocalStorage SB
            Object.keys(localStorage).forEach(k => {
                if(k.startsWith('sb-') && k.endsWith('-auth-token')) {
                    const s = JSON.parse(localStorage.getItem(k));
                    if(s?.user?.id) currentUserId = s.user.id;
                }
            });
        }

        // =========================================================
        // A. MEU PRÓPRIO PERFIL (ZERO EGRESS)
        // =========================================================
        if (currentUserId && playerId === currentUserId) {
            console.log("👤 [Modal] Abrindo meu próprio perfil (Offline/Local).");
            
            const [localData, localItems, localStats] = await Promise.all([
                GlobalDB.getPlayer(),
                InventoryDB.getEquippedItems(),
                InventoryDB.getStats()
            ]);

            if (localData) {
                // Mescla os dados básicos com os stats calculados do inventory.js
                const fullData = { ...localData, ...localStats };
                
                let guildData = null;
                if (localData.guild_name) {
                    guildData = { name: localData.guild_name, flag_url: localData.guild_flag };
                }
                
                populateModal(fullData, localItems, guildData);
                return; // FIM
            }
        }

        // =========================================================
        // B. OUTRO JOGADOR
        // =========================================================
        
        // UI Otimista (Cache de Donos)
        const cachedOwner = await GlobalDB.getOwner(playerId);
        if (cachedOwner) {
            console.log("⚡ [Modal] Cache Hit (Donos):", cachedOwner.name);
            if(ui.name) ui.name.textContent = cachedOwner.name;
            if(ui.avatar) ui.avatar.src = cachedOwner.avatar_url || 'https://aden-rpg.pages.dev/avatar01.webp';
        }

        // Cache Completo (LocalStorage)
        const cacheKey = `player_modal_${playerId}`;
        const stored = getCache(cacheKey);
        if (stored) {
            console.log("📦 [Modal] Cache Hit (Full).");
            populateModal(stored.player, stored.items, stored.guildData);
            setupSendMp(playerId, stored.player.name);
            return;
        }

        // Fetch Real (Supabase)
        console.log("🌐 [Modal] Buscando dados no Supabase...");
        
        const { data: player, error: pErr } = await supabase
            .from('players')
            .select('id, name, level, avatar_url, guild_id, combat_power, guild_name, cached_combat_stats')
            .eq('id', playerId)
            .single();

        if (pErr || !player) throw pErr || new Error("Jogador não encontrado");

        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, equipped_slot, level, refine_level, items (name, display_name, stars)')
            .eq('player_id', playerId)
            .not('equipped_slot', 'is', null);

        // Fetch Guilda (Opcional)
        let guildData = null;
        if (player.guild_id) {
            const { data: g } = await supabase.from('guilds').select('name, flag_url').eq('id', player.guild_id).single();
            guildData = g;
        }

        populateModal(player, items || [], guildData);
        setupSendMp(playerId, player.name);

        // Salvar Cache
        setCache(cacheKey, { player, items, guildData }, CACHE_TTL_MS);

    } catch (err) {
        console.error("❌ Erro no Modal:", err);
        if(ui.name) ui.name.textContent = "Erro ao carregar";
    }
}

function setupSendMp(playerId, playerName) {
    const btn = document.getElementById('sendmp');
    if (!btn) return;
    
    btn.style.display = 'flex';
    btn.onclick = (e) => {
        e.preventDefault();
        document.getElementById('playerModal').style.display = 'none';
        
        // Tenta abrir modal de PV se estiver na mesma página, senão redireciona
        const pvModal = document.getElementById('pvModal');
        if(pvModal && window.getComputedStyle(pvModal).display !== 'none') {
             // Lógica específica se já estiver com chat aberto (opcional)
        }
        window.location.href = `index.html?action=open_pv&target_id=${playerId}&target_name=${encodeURIComponent(playerName)}`;
    };
}

// =======================================================================
// 4. EVENT LISTENER GLOBAL (A CORREÇÃO PRINCIPAL)
// =======================================================================
// Usamos "Event Delegation" no body. Assim, mesmo que a lista de jogadores
// seja criada DEPOIS desse script rodar, o clique ainda funciona.
document.body.addEventListener('click', (e) => {
    // Procura se o clique foi dentro de um .player-link
    const link = e.target.closest('.player-link');
    
    if (link) {
        const pid = link.dataset.playerId;
        if (pid) {
            console.log("👆 Clique detectado em jogador:", pid);
            fetchPlayerData(pid);
        }
    }
    
    // Fecha o modal
    if (e.target.id === 'closePlayerModal' || e.target.closest('#closePlayerModal')) {
        const m = document.getElementById('playerModal');
        if(m) m.style.display = 'none';
    }
    // Fecha clicando fora
    if (e.target.id === 'playerModal') {
        e.target.style.display = 'none';
    }
});

// Exporta para uso manual se necessário
window.fetchPlayerData = fetchPlayerData;
window.clearModalContent = clearModalContent;