
import { supabase } from './supabaseClient.js'

window.supabase = supabase;
window.supabaseClient = supabase;

window.globalUser = null;
window.equippedItems = [];
window.playerBaseStats = {};
window.allInventoryItems = [];
window.selectedItem = null;

// Garante que o mapa global exista
if (!window.itemDefinitions) {
    window.itemDefinitions = new Map();
}

// ===============================
// IndexedDB utilitário simples (Cache 24h)
// ===============================
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 47; 

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            console.log('IndexedDB: Upgrade necessário. Limpando caches antigos.');
            const db = e.target.result;
            if (db.objectStoreNames.contains(STORE_NAME)) {
                db.deleteObjectStore(STORE_NAME);
            }
            if (db.objectStoreNames.contains(META_STORE)) {
                db.deleteObjectStore(META_STORE);
            }
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
            db.createObjectStore(META_STORE, { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Salva o cache completo
async function saveCache(items, stats, timestamp) {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const meta = tx.objectStore(META_STORE);

    store.clear();
    
    // Salva TUDO (inclusive itens com qtd 0 para o manifesto funcionar)
    (items || []).forEach(item => store.put(item));
    
    if (timestamp) meta.put({ key: "last_updated", value: timestamp }); 
    if (stats) meta.put({ key: "player_stats", value: stats });     
    meta.put({ key: "cache_time", value: Date.now() });  

    return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
    });
}

async function loadCache() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    return new Promise((resolve, reject) => {
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function loadPlayerStatsFromCache() {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    return new Promise((resolve) => {
        const req = tx.objectStore(META_STORE).get("player_stats");
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
    });
}

async function getLastUpdated() {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    return new Promise((resolve) => {
        const req = tx.objectStore(META_STORE).get("last_updated");
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
    });
}

async function updateCacheItem(item) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    return tx.complete;
}

async function removeCacheItem(itemId) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(itemId);
    return tx.complete;
}

// --- HELPER DE AUTH OTIMISTA (ZERO EGRESS) ---
function getLocalUserId() {
    try {
        const cached = localStorage.getItem('player_data_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.data && parsed.data.id && parsed.expires > Date.now()) {
                return parsed.data.id;
            }
        }
    } catch (e) {}

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                const sessionStr = localStorage.getItem(k);
                const session = JSON.parse(sessionStr);
                if (session && session.user && session.user.id) {
                    return session.user.id;
                }
            }
        }
    } catch (e) {}
    return null;
}

// ===============================
// LÓGICA DE DELTA SYNC (MANIFESTO)
// ===============================

function generateManifest(items) {
    return items.map(item => ({
        id: item.id,
        s: `${item.quantity}_${item.level || 0}_${item.refine_level || 0}_${item.equipped_slot || 'none'}`
    }));
}

function processInventoryDelta(localItems, delta) {
    let updatedList = [...localItems];
    
    if (delta.remove && delta.remove.length > 0) {
        const removeSet = new Set(delta.remove);
        updatedList = updatedList.filter(item => !removeSet.has(item.id));
    }

    if (delta.upsert && delta.upsert.length > 0) {
        delta.upsert.forEach(newItem => {
            const idx = updatedList.findIndex(i => i.id === newItem.id);
            if (idx !== -1) {
                updatedList[idx] = { ...updatedList[idx], ...newItem };
            } else {
                updatedList.push(newItem);
            }
        });
    }

    return updatedList;
}

// ========================================================
// >>> HIDRATAÇÃO E CACHE DE DEFINIÇÕES (CORRIGIDO) <<<
// ========================================================

async function ensureDefinitionsLoaded() {
    // 1. Verifica se já está na memória RAM (carregado pelo script.js)
    if (window.itemDefinitions && window.itemDefinitions.size > 0) {
        return;
    }

    const CACHE_KEY = 'item_definitions_full_v1';

    // 2. Tenta carregar do LocalStorage
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
        try {
            const mapData = JSON.parse(cached); // Array de [key, value]
            window.itemDefinitions = new Map(mapData);
            console.log("📚 [Inventory] Definições recuperadas do LocalStorage e carregadas na RAM.");
            return;
        } catch (e) {
            console.warn("Cache de definições inválido ou corrompido.", e);
            localStorage.removeItem(CACHE_KEY);
        }
    }

    // 3. ÚLTIMO RECURSO: Baixa agora se não existir em lugar nenhum
    console.log("⚠️ [Inventory] Definições ausentes. Baixando definições 'Lite'...");
    
    // OTIMIZAÇÃO: Removemos description e stats de combate do load inicial.
    const { data, error } = await supabase
        .from('items')
        .select(`
            item_id, name, display_name, rarity, item_type, stars,
            crafts_item_id
        `);

    if (!error && data) {
        window.itemDefinitions = new Map();
        const dataForCache = [];
        data.forEach(item => {
            if (!item.display_name) item.display_name = item.name;
            window.itemDefinitions.set(item.item_id, item);
            dataForCache.push([item.item_id, item]);
        });
        
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(dataForCache));
        } catch(e) {
            console.warn("Quota de storage excedida ao salvar definições.");
        }
        console.log(`✅ [Inventory] ${data.length} definições baixadas e salvas.`);
    } else {
        console.error("❌ Falha crítica ao baixar definições de itens:", error);
    }
}

// Função robusta de hidratação (cruza dados crus com definições)
function hydrateItem(rawItem) {
    if (!rawItem) return null;
    if (rawItem.equipped_slot === undefined) {
        rawItem.equipped_slot = null;
    }
    
    // Se já estiver hidratado corretamente, retorna
    if (rawItem.items && rawItem.items.name) return rawItem;

    let def = null;
    const itemId = rawItem.item_id;

    if (window.itemDefinitions) {
        // Tenta buscar pelo ID numérico
        def = window.itemDefinitions.get(itemId);
        
        // Se falhar, tenta buscar pelo ID string (caso haja divergência de tipos)
        if (!def) def = window.itemDefinitions.get(String(itemId));
        if (!def) def = window.itemDefinitions.get(Number(itemId));
    }

    // Se ainda não achou, usa placeholder para não quebrar a UI
    if (!def) {
        def = {
            item_id: rawItem.item_id,
            name: "unknown",
            display_name: "Carregando...",
            rarity: "R",
            item_type: "outros",
            stars: 1,
            description: "Carregando...",
            min_attack: 0, attack: 0, defense: 0, health: 0 
        };
    }

    return {
        ...rawItem,
        items: def
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM carregado. Iniciando script inventory.js...');
    
    // Auth Otimista
    const localId = getLocalUserId();
    if (localId) {
        console.log("⚡ Auth Otimista: ID recuperado localmente.");
        globalUser = { id: localId };
    } else {
        console.warn("Auth Cache Miss: Buscando sessão no servidor...");
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
            console.warn("Nenhuma sessão ativa encontrada. Redirecionando para login.");
            window.location.href = "index.html?refresh=true";
            return;
        }
        globalUser = session.user;
    }
    
    // >>> PASSO CRUCIAL: Garante que temos as definições <<<
    await ensureDefinitionsLoaded();

    // Inicia carregamento do inventário
    await loadPlayerAndItems();

    document.getElementById('refreshBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('Botão de refresh clicado. Forçando a recarga.');
        await ensureDefinitionsLoaded();
        await loadPlayerAndItems(true); 
    });

    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.tab-button.active')?.classList.remove('active');
            button.classList.add('active');
            loadItems(button.id.replace('tab-', ''));
        });
    });

    // Eventos de Modais
    document.getElementById('closeDetailsModal')?.addEventListener('click', () => {
        document.getElementById('itemDetailsModal').style.display = 'none';
    });

    document.getElementById('closeCraftingModal')?.addEventListener('click', () => {
        document.getElementById('craftingModal').style.display = 'none';
    });

    document.getElementById('levelUpBtn')?.addEventListener('click', () => {
        if (!selectedItem) {
            showCustomAlert('Nenhum item selecionado para evoluir.');
            return;
        }
        document.getElementById('fragmentSelectModal').style.display = 'flex';
        renderFragmentList(selectedItem);
    });

    document.getElementById('refineBtn')?.addEventListener('click', () => {
        if (selectedItem) {
            openRefineFragmentModal(selectedItem);
        } else {
            showCustomAlert('Nenhum item selecionado para refinar.');
        }
    });

    document.getElementById('craftBtn')?.addEventListener('click', () => {
        if (selectedItem && selectedItem.items && selectedItem.items.crafts_item_id) {
            const itemToCraftId = selectedItem.items.crafts_item_id;
            handleCraft(itemToCraftId, selectedItem.id);
        } else {
            showCustomAlert('Informações de construção incompletas.');
        }
    });

    document.getElementById('closeFragmentModal')?.addEventListener('click', () => {
        document.getElementById('fragmentSelectModal').style.display = 'none';
    });
  
    document.getElementById('closeRefineFragmentModal')?.addEventListener('click', () => {
        document.getElementById('refineFragmentModal').style.display = 'none';
    });

    document.getElementById('confirmFragmentSelection')?.addEventListener('click', () => {
        const item = selectedItem;
        const selections = [];
        let totalSelecionado = 0;

        document.querySelectorAll('#fragmentList li.selected').forEach(li => {
            const quantityInput = li.querySelector('.fragment-quantity-input');
            const qty = parseInt(quantityInput.value, 10) || 0;
            if (qty > 0) {
                selections.push({
                    fragment_id: li.dataset.inventoryItemId,
                    qty,
                    rarity: li.dataset.rarity
                });
                totalSelecionado += qty;
            }
        });

        if (selections.length === 0) {
            showCustomAlert('Selecione pelo menos um fragmento e uma quantidade válida.');
            return;
        }

        const fragmentRarity = selections[0]?.rarity || item.items.rarity;
        const maxNecessario = calcularFragmentosNecessariosParaCap(item, fragmentRarity);

        if (totalSelecionado > maxNecessario) {
            showCustomAlert(`Você só precisa de ${maxNecessario} fragmentos para atingir o limite. Ajuste a quantidade.`);
            return;
        }

        handleLevelUpMulti(item, selections);
    });

    document.getElementById('customAlertOkBtn')?.addEventListener('click', () => {
        document.getElementById('customAlertModal').style.display = 'none';
    });
});

function showCustomAlert(message) {
    const modal = document.getElementById('customAlertModal');
    document.getElementById('customAlertMessage').textContent = message;
    modal.style.display = 'flex';
}

function showCustomConfirm(message, onConfirm) {
    const modal = document.getElementById('customConfirmModal');
    document.getElementById('customConfirmMessage').textContent = message;
    modal.style.display = 'flex';

    const confirmYesBtn = document.getElementById('customConfirmYesBtn');
    const confirmNoBtn = document.getElementById('customConfirmNoBtn');

    confirmYesBtn.onclick = () => {
        modal.style.display = 'none';
        onConfirm();
    };

    confirmNoBtn.onclick = () => {
        modal.style.display = 'none';
    };
}

// ===============================
// CARREGAMENTO OTIMIZADO (Delta Sync + Lazy Load Fallback)
// ===============================

async function loadPlayerAndItems(forceRefresh = false) {
    if (!globalUser) return;

    let localItems = [];
    let localStats = null;
    let localTimestamp = null;

    // 1. Tenta carregar dados do Cache Local (IndexedDB)
    try {
        [localItems, localStats, localTimestamp] = await Promise.all([
            loadCache(),
            loadPlayerStatsFromCache(),
            getLastUpdated()
        ]);

        // Se tiver dados locais, exibe imediatamente (Optimistic UI)
        if (localItems && localItems.length >= 0) {
            console.log('✅ UI Otimista: Exibindo dados locais enquanto sincroniza...');
            
            // Hidrata os itens do cache
            allInventoryItems = localItems.map(item => hydrateItem(item));
            
            playerBaseStats = localStats || {};
            
            equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
            
            renderUI();
        }
    } catch (e) {
        console.warn("Erro ao ler cache local:", e);
    }

    // 2. Se for Refresh Forçado ou Cache Vazio -> Download Completo
    if (forceRefresh || !localItems || localItems.length === 0) {
        console.log('🔄 Cache vazio ou Refresh forçado. Iniciando Download Completo...');
        await fullDownload();
        return;
    }

    // 3. Tenta Sincronização Diferencial (Delta Sync)
    console.log('🔄 Iniciando Delta Sync com servidor...');
    const manifest = generateManifest(localItems);

    const { data: deltaData, error: deltaError } = await supabase.rpc('sync_inventory', {
        p_player_id: globalUser.id,
        p_client_manifest: manifest
    });

    if (deltaError || !deltaData) {
        console.warn('⚠️ Falha no Delta Sync (RPC error). Fazendo fallback para Download Completo.', deltaError);
        await fullDownload();
        return;
    }

    // 4. Aplica as mudanças do Delta Sync
    try {
        console.log(`📥 Delta recebido: ${deltaData.upsert?.length || 0} modificados, ${deltaData.remove?.length || 0} removidos.`);
        
        let mergedList = processInventoryDelta(localItems, deltaData);
        
        // >>> HIDRATAÇÃO: Cruza com as definições carregadas <<<
        mergedList = mergedList.map(item => hydrateItem(item));
        
        allInventoryItems = mergedList;
        equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
        
        if (deltaData.player_stats) {
            playerBaseStats = deltaData.player_stats;
        }

        renderUI();

        // Salva o novo estado no cache
        await saveCache(allInventoryItems, playerBaseStats, deltaData.last_inventory_update);
        console.log('💾 Cache local sincronizado e salvo.');

    } catch (e) {
        console.error("Erro ao processar Delta Sync:", e);
        await fullDownload();
    }
}

// Função de Download Completo (Fallback seguro)
async function fullDownload() {
    console.log('⬇️ Executando get_player_data_lazy (Full Load)...');
    
    const { data: playerData, error: rpcError } = await supabase
        .rpc('get_player_data_lazy', { p_player_id: globalUser.id });

    if (rpcError) {
        console.error('❌ Erro crítico ao baixar inventário:', rpcError.message);
        showCustomAlert('Erro ao carregar inventário. Verifique sua conexão.');
        return;
    }

    playerBaseStats = playerData.cached_combat_stats || {};
    
    // Pega itens crus e HIDRATA no cliente
    const rawItems = playerData.cached_inventory || [];
    allInventoryItems = rawItems.map(item => hydrateItem(item));
    
    equippedItems = allInventoryItems.filter(item => item.equipped_slot !== null && item.quantity > 0);

    renderUI();

    try {
        await saveCache(allInventoryItems, playerBaseStats, playerData.last_inventory_update);
        console.log('💾 Cache completo salvo com sucesso.');
    } catch (e) {
        console.warn("⚠️ Erro não-crítico ao salvar cache:", e);
    }
}

function renderUI() {
    updateStatsUI(playerBaseStats);
    renderEquippedItems();
    
    const activeTab = document.querySelector('.tab-button.active');
    const tabId = activeTab ? activeTab.id.replace('tab-', '') : 'all';
    
    loadItems(tabId, allInventoryItems);
}

function updateStatsUI(stats) {
    if (!stats) return;

    ['playerAttack','playerDefense','playerHealth','playerCritChance','playerCritDamage','playerEvasion']
        .forEach(id => document.getElementById(id)?.classList.remove('shimmer'));

    const avatarEl = document.getElementById('playerAvatarEquip');
    if (avatarEl && stats.avatar_url) avatarEl.src = stats.avatar_url;

    const atkSpan = document.getElementById('playerAttack');
    const defSpan = document.getElementById('playerDefense');
    const hpSpan  = document.getElementById('playerHealth');
    const ccSpan  = document.getElementById('playerCritChance');
    const cdSpan  = document.getElementById('playerCritDamage');
    const evSpan  = document.getElementById('playerEvasion');

    if (atkSpan) atkSpan.textContent = `${Math.floor(stats.min_attack || 0)} - ${Math.floor(stats.attack || 0)}`;
    if (defSpan) defSpan.textContent = `${Math.floor(stats.defense || 0)}`;
    if (hpSpan)  hpSpan.textContent  = `${Math.floor(stats.health || 0)}`;
    
    if (ccSpan)  ccSpan.textContent  = `${Math.floor(stats.crit_chance || 0)}%`;
    if (cdSpan)  cdSpan.textContent  = `${Math.floor(stats.crit_damage || 0)}%`;
    if (evSpan)  evSpan.textContent  = `${Math.floor(stats.evasion || 0)}%`;
}

function calculatePlayerStats() {
    // Mantido para compatibilidade
}

function renderEquippedItems() {
    const slots = ['weapon', 'ring', 'helm', 'special1', 'amulet', 'wing', 'armor', 'special2'];
    slots.forEach(slot => {
        const slotDiv = document.getElementById(`${slot}-slot`);
        if (slotDiv) slotDiv.innerHTML = '';
    });

    equippedItems.forEach(invItem => {
        const item = invItem.items;
        if (item && invItem.equipped_slot) {
            const slotDiv = document.getElementById(`${invItem.equipped_slot}-slot`);
            if (slotDiv) {
                const totalStars = (invItem.items?.stars || 0) + (invItem.refine_level || 0);
                const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.name}_${totalStars}estrelas.webp`;
                slotDiv.innerHTML = `<img src="${imgSrc}" alt="${item.display_name}" onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'">`;
        
                if (item.item_type !== 'fragmento' && item.item_type !== 'outros' && invItem.level && invItem.level >= 1) {
                    const levelElement = document.createElement('div');
                    levelElement.className = 'item-level';
                    levelElement.textContent = `Nv. ${invItem.level}`;
                    slotDiv.appendChild(levelElement);
                }

                slotDiv.addEventListener('click', () => {
                    showItemDetails(invItem);
                });
            }
        }
    });
}

async function loadItems(tab = 'all', itemsList = null) {
    const items = itemsList || allInventoryItems;
    const bagItemsGrid = document.getElementById('bagItemsGrid');
    if (!bagItemsGrid) return;

    bagItemsGrid.innerHTML = '';

    const filteredItems = items.filter(item => {
        // Agora verificamos item.items para garantir que a hidratação funcionou
        if (!item.items || item.equipped_slot !== null || item.quantity <= 0) return false;
        
        if (tab === 'all') return true;
        if (tab === 'equipment' && item.items.item_type !== 'fragmento' && item.items.item_type !== 'outros') return true;
        if (tab === 'fragments' && item.items.item_type === 'fragmento') return true;
        if (tab === 'others' && item.items.item_type === 'outros') return true;
        return false;
    });

    if (filteredItems.length === 0) {
        bagItemsGrid.innerHTML = '<p class="empty-inventory-message">Nenhum item nesta categoria.</p>';
        return;
    }

    filteredItems.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'inventory-item';

        if (item.items.item_type === 'fragmento' && item.items.crafts_item_id && item.quantity >= 30) {
            itemDiv.classList.add('zoom-border');
        }

        let imgSrc;
        if (item.items.name === 'unknown' || !item.items.name) {
             imgSrc = `https://aden-rpg.pages.dev/assets/itens/unknown.webp`;
        } else if (item.items.item_type === 'fragmento') {
            imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}.webp`;
        } else {
            const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);
            imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}_${totalStars}estrelas.webp`;
        }

        itemDiv.innerHTML = `<img src="${imgSrc}" alt="${item.items.display_name}" onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'">`;
        if ((item.items.item_type === 'fragmento' || item.items.item_type === 'outros') && item.quantity > 1) {
            itemDiv.innerHTML += `<span class="item-quantity">${item.quantity}</span>`;
        }

        if (item.items.item_type !== 'fragmento' && item.items.item_type !== 'outros' && item.level && item.level >= 1) {
            const levelElement = document.createElement('div');
            levelElement.className = 'item-level';
            levelElement.textContent = `Lv. ${item.level}`;
            itemDiv.appendChild(levelElement);
        }

        itemDiv.dataset.inventoryItemId = item.id;
        bagItemsGrid.appendChild(itemDiv);

        itemDiv.addEventListener('click', async () => {
            if (item.items.item_type === 'fragmento' && item.items.crafts_item_id) {
                showCraftingModal(item);
            } else {
                showItemDetails(item);
            }
        });
    });
}

// -------------------------------------------------------------
// FUNÇÃO MÁGICA DE ATUALIZAÇÃO LOCAL (Sem baixar tudo de novo)
// -------------------------------------------------------------
async function updateLocalInventoryState(args) {
    const { updatedItemId, newItemData, usedFragments, usedCrystals, newStats, equipUpdate } = args;
    let needsSort = false;

    // 1. Atualiza Item Principal (Equipamento evoluído/refinado)
    if (updatedItemId && newItemData) {
        // Encontra o item localmente
        const idx = allInventoryItems.findIndex(i => i.id === updatedItemId);
        if (idx > -1) {
            // Merge dos dados novos
            allInventoryItems[idx] = { ...allInventoryItems[idx], ...newItemData };
            
            // Se o objeto estiver selecionado, atualiza a referência
            if (selectedItem && selectedItem.id === updatedItemId) {
                selectedItem = allInventoryItems[idx];
            }
        }
    } else if (newItemData && newItemData.id) {
        // Item novo (Craft) - Precisa hidratar
        const hydrated = hydrateItem(newItemData);
        allInventoryItems.push(hydrated);
        needsSort = true;
    }

    // 2. Decrementa Fragmentos Usados
    if (usedFragments && Array.isArray(usedFragments)) {
        usedFragments.forEach(usage => {
            const fragId = usage.fragment_inventory_id || usage.id; 
            const qtyUsed = usage.used_qty || usage.qty;

            const idx = allInventoryItems.findIndex(i => i.id === fragId);
            if (idx !== -1) {
                allInventoryItems[idx].quantity -= qtyUsed;
                // >>> AJUSTE PARA SOFT DELETE <<<
                if (allInventoryItems[idx].quantity < 0) {
                    allInventoryItems[idx].quantity = 0;
                }
            }
        });
    }

    // 3. Atualiza Cristais e Stats do Jogador (Zero Egress)
    if (newStats) {
        playerBaseStats = newStats;
    }
    
    // Fallback visual para cristais se não vier stats completos (ex: craft que não retorna stats)
    if (usedCrystals && playerBaseStats) {
        playerBaseStats.crystals = Math.max(0, (playerBaseStats.crystals || 0) - usedCrystals);
    }

    // 4. Equipar/Desequipar (Logica Local)
    if (equipUpdate) {
        const { itemId, isEquipping, slot } = equipUpdate;
        const idx = allInventoryItems.findIndex(i => i.id === itemId);
        if (idx > -1) {
            if (isEquipping) {
                // Remove de outros itens do mesmo slot
                allInventoryItems.forEach(i => { if (i.equipped_slot === slot) i.equipped_slot = null; });
                allInventoryItems[idx].equipped_slot = slot;
            } else {
                allInventoryItems[idx].equipped_slot = null;
            }
        }
    }

    // 5. Salva no Cache Local e Re-renderiza
    // equippedItems só deve ter itens válidos (>0)
    equippedItems = allInventoryItems.filter(invItem => invItem.equipped_slot !== null && invItem.quantity > 0);

    const nowISO = new Date().toISOString();
    await saveCache(allInventoryItems, playerBaseStats, nowISO); 

    renderUI();
    
    // Se estávamos vendo detalhes de um item que ainda existe, atualiza a modal
    if (selectedItem && allInventoryItems.find(i => i.id === selectedItem.id && i.quantity > 0)) {
        showItemDetails(selectedItem);
    } else {
        document.getElementById('itemDetailsModal').style.display = 'none';
    }
}

// -------------------------------------------------------------
// HANDLERS MODIFICADOS (ZERO EGRESS)
// -------------------------------------------------------------

async function handleRefineMulti(item, selections, crystalCost) {
    try {
        const { data, error } = await supabase.rpc('refine_item', {
            _inventory_item_id: item.id,
            _fragments: selections
        });

        if (error) {
            console.error('Erro na chamada RPC:', error.message);
            showCustomAlert(`Erro ao refinar: ${error.message}`);
            return;
        }
    
        if (data && data.error) {
            showCustomAlert(`Erro ao refinar: ${data.error}`);
        } else if (data && data.success) {
            const stars = (typeof data.new_total_stars !== 'undefined') ? data.new_total_stars : ((item.items?.stars || 0) + ((item.refine_level || 0) + 1));
            showCustomAlert(`Item refinado! Estrelas totais: ${stars}.`);
            
            // ATUALIZAÇÃO LOCAL
            await updateLocalInventoryState({
                updatedItemId: item.id,
                newItemData: { refine_level: data.new_refine_level, xp_progress: 0 }, // Reset xp usually happens
                usedFragments: data.used_fragments,
                usedCrystals: data.used_crystals,
                newStats: data.player_stats // Recebe stats atualizados
            });
            
            document.getElementById('itemDetailsModal').style.display = 'none';
        } else {
            showCustomAlert('Não foi possível refinar o item. Tente novamente.');
        }
    } catch (err) {
        console.error('Erro geral ao refinar:', err);
        showCustomAlert('Ocorreu um erro ao tentar refinar o item.');
    }
}

async function handleLevelUpMulti(item, selections) {
    document.getElementById('fragmentSelectModal').style.display = 'none';

    try {
        const { data, error } = await supabase.rpc('level_up_item', {
            p_inventory_item_id: item.id,
            p_fragments: selections
        });

        if (error) {
            console.error('Erro na chamada RPC:', error.message);
            showCustomAlert(`Erro ao subir de nível: ${error.message}`);
            return;
        }

        if (data && data.error) {
            showCustomAlert(`Erro ao subir de nível: ${data.error}`);
        } else if (data && data.success) {
            showCustomAlert(`Item evoluído para Nível ${data.new_level}!`);
            
            // ATUALIZAÇÃO LOCAL
            await updateLocalInventoryState({
                updatedItemId: item.id,
                newItemData: { level: data.new_level, xp_progress: data.new_xp },
                usedFragments: data.used_fragments,
                newStats: data.player_stats // Recebe stats atualizados
            });

            document.getElementById('itemDetailsModal').style.display = 'none';
        } else {
            showCustomAlert('Não foi possível evoluir o item. Tente novamente.');
        }
    } catch (err) {
        console.error('Erro geral ao subir o nível:', err);
        showCustomAlert('Ocorreu um erro ao tentar subir o nível do item.');
    }
}

async function handleCraft(itemId, fragmentId) {
    try {
        const { data, error } = await supabase.rpc('craft_item', {
            p_item_id: itemId,
            p_fragment_id: fragmentId
        });

        if (error) {
            console.error('Erro na chamada RPC:', error.message);
            showCustomAlert(`Erro ao construir o item: ${error.message}`);
            return;
        }

        if (data && data.error) {
            showCustomAlert(`Erro ao construir: ${data.error}`);
        } else if (data && data.success) {
            showCustomAlert(`Item construído com sucesso!`);
            document.getElementById('craftingModal').style.display = 'none';
            
            let newItemFull = null;
            if (data.new_item_id) {
                // Fetch necessário aqui pois é um item novo que não temos no cache
                const { data: fetched } = await supabase.from('inventory_items').select('*').eq('id', data.new_item_id).single();
                newItemFull = fetched;
            }

            // ATUALIZAÇÃO LOCAL
            await updateLocalInventoryState({
                newItemData: newItemFull,
                usedFragments: [{ id: fragmentId, qty: 30 }], // Construção gasta 30
                usedCrystals: data.crystals_spent,
                newStats: null 
            });

        } else {
            showCustomAlert('Não foi possível construir o item. Tente novamente.');
        }
    } catch (err) {
        console.error('Erro geral ao construir:', err);
        showCustomAlert('Ocorreu um erro ao tentar construir o item.');
    }
}

async function handleEquipUnequip(item, isEquipped) {
    try {
        const { data, error } = await supabase.rpc('toggle_equip', {
            p_inventory_item_id: item.id,
            p_player_id: globalUser.id,
            p_equip_status: !isEquipped
        });

        if (error) {
            console.error('Erro na chamada RPC:', error.message);
            showCustomAlert('Erro ao equipar/desequipar item: ' + error.message);
            return;
        }
        if (data && data.error) {
            showCustomAlert(data.error);
            return;
        }

        showCustomAlert(isEquipped ? 'Item desequipado com sucesso.' : 'Item equipado com sucesso.');
        document.getElementById('itemDetailsModal').style.display = 'none';
        
        // Determina slot para update visual
        let slot = item.equipped_slot;
        if (!slot) {
             const type = item.items.item_type.toLowerCase();
             if (type === 'arma') slot = 'weapon';
             else if (type === 'anel') slot = 'ring';
             else if (type === 'elmo') slot = 'helm';
             else if (type === 'colar') slot = 'amulet';
             else if (type === 'asa') slot = 'wing';
             else if (type === 'armadura') slot = 'armor';
        }

        await updateLocalInventoryState({
            equipUpdate: { itemId: item.id, isEquipping: !isEquipped, slot: slot },
            newStats: data.player_stats // Recebe stats atualizados
        }); 
    } catch (err) {
        console.error('Erro geral ao equipar/desequipar:', err);
        showCustomAlert('Ocorreu um erro inesperado.');
    }
}

// ===============================
// UI HELPERS (MODALS, DETAILS, LISTS)
// ===============================

async function showItemDetails(item) {
    if (!item.items) item = hydrateItem(item);
    selectedItem = item;
    
    const modal = document.getElementById('itemDetailsModal');
    if (!modal) return;

    document.getElementById('itemDetailsContent').dataset.currentItem = JSON.stringify(item);

    // Image logic
    const totalStars = (item.items.stars||0) + (item.refine_level||0);
    const imgName = item.items.item_type === 'fragmento' ? item.items.name : `${item.items.name}_${totalStars}estrelas`;
    
    const imgEl = document.getElementById('detailItemImage');
    imgEl.src = `https://aden-rpg.pages.dev/assets/itens/${imgName}.webp`;
    imgEl.onerror = () => { imgEl.src = 'https://aden-rpg.pages.dev/assets/itens/unknown.webp'; };

    document.getElementById('detailItemName').textContent = item.items.display_name;
    document.getElementById('detailItemRarity').textContent = item.items.rarity;
    
    // OTIMIZAÇÃO: Lazy Load de descrição e stats se necessário
    const descEl = document.getElementById('itemDescription');
    if (!item.items.description || item.items.attack === undefined) {
        descEl.textContent = "Carregando detalhes...";
        const { data } = await supabase.from('items')
            .select('description, attack, defense, health, crit_chance, crit_damage, evasion, min_attack')
            .eq('item_id', item.item_id).single();
        if (data) {
            Object.assign(item.items, data);
            window.itemDefinitions.set(item.item_id, item.items);
        }
    }
    descEl.textContent = item.items.description || "";

    const isEquipment = !['consumivel', 'fragmento', 'outros'].includes(item.items.item_type);
    const isEquipable = ['arma', 'Arma', 'Escudo', 'Anel', 'anel', 'Elmo', 'elmo', 'Asa', 'asa', 'Armadura', 'armadura', 'Colar', 'colar'].includes(item.items.item_type);

    if (isEquipment) {
        const level = item.level || 0;
        const maxLevelForStar = (item.items.stars + (item.refine_level || 0) + 1) * 5;
        const xpRequired = getXpRequired(level, item.items.rarity);
        const xpProgress = item.xp_progress || 0;
        const xpPercentage = xpRequired > 0 ? (xpProgress / xpRequired) * 100 : 0;

        document.getElementById('detailItemLevel').textContent = `Nv. ${level} / ${Math.min(maxLevelForStar, 30)}`;
        document.getElementById('levelXpBar').style.width = `${Math.min(xpPercentage, 100)}%`;
        document.getElementById('levelXpText').textContent = `${xpProgress} / ${xpRequired}`;
        document.querySelector('.progress-bar-container').style.display = 'block';

        const levelUpBtn = document.getElementById('levelUpBtn');
        if (level >= Math.min(maxLevelForStar, 30)) {
            levelUpBtn.style.display = 'none';
        } else {
            levelUpBtn.style.display = 'block';
        }
    } else {
        document.querySelector('.progress-bar-container').style.display = 'none';
        document.getElementById('levelUpBtn').style.display = 'none';
        document.getElementById('detailItemLevel').textContent = '';
    }

    const itemStats = document.getElementById('itemStats');
    const refineSectionDiv = document.getElementById('itemRefineSection');
    const itemActionsDiv = document.getElementById('itemActions');

    if (isEquipment) {
        if (itemStats) {
            itemStats.style.display = 'block';
            itemStats.innerHTML = '';
            if ((item.items.attack || 0) > 0) { itemStats.innerHTML += `<p>ATK Base: ${item.items.attack}</p>`; }
            if ((item.items.defense || 0) > 0) { itemStats.innerHTML += `<p>DEF Base: ${item.items.defense}</p>`; }
            if ((item.items.health || 0) > 0) { itemStats.innerHTML += `<p>HP Base: ${item.items.health}</p>`; }
            if ((item.items.crit_chance || 0) > 0) { itemStats.innerHTML += `<p>CRIT Base: ${item.items.crit_chance}%</p>`; }
            if ((item.items.crit_damage || 0) > 0) { itemStats.innerHTML += `<p>DANO CRIT Base: +${item.items.crit_damage}%</p>`; }
            if ((item.items.evasion || 0) > 0) { itemStats.innerHTML += `<p>EVASÃO Base: +${item.items.evasion}%</p>`; }
            
            if ((item.attack_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus ATK: +${item.attack_bonus}</p>`;
            if ((item.defense_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus DEF: +${item.defense_bonus}</p>`;
            if ((item.health_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus HP: +${item.health_bonus}</p>`;
            if ((item.crit_chance_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus TAXA CRIT: +${item.crit_chance_bonus}%</p>`;
            if ((item.crit_damage_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus DANO CRIT: +${item.crit_damage_bonus}%</p>`;
            if ((item.evasion_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus EVASÃO: +${item.evasion_bonus}%</p>`;
        }
    
        const refineRow1 = document.getElementById('refineRow1');
        const refineRow2 = document.getElementById('refineRow2');

        if (refineRow1) {
            if (item.reforge_slot1) {
                const formattedName = formatAttrName(item.reforge_slot1.attr);
                let formattedValue = item.reforge_slot1.value;
                if (['TAXA CRIT','DANO CRIT','EVASÃO'].includes(formattedName)) formattedValue += '%';
                const textStyle1 = `font-size:1.1em; margin:0; color:silver; font-weight:bold; text-shadow:1px 1px 2px black,-1px -1px 2px black,1px -1px 2px black,-1px 1px 2px black,0 0 2px black,0 0 4px black;`;
                refineRow1.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/refund.webp" class="refine-icon" style="width:38px;height:38px;"><p style="${textStyle1}">${formattedName} +${formattedValue}</p>`;
                refineRow1.style.setProperty('background', rarityGradient(item.reforge_slot1.color));
                refineRow1.style.height = "15px";
            } else if (totalStars >= 4) {
                refineRow1.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/refund.webp" class="refine-icon" style="width:38px;height:38px;"><p style="font-size:0.9em;">Liberado para Refundição</p>`;
                refineRow1.style.background = ''; refineRow1.style.color = '';
            } else {
                refineRow1.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/locked.webp" class="refine-icon" style="width:38px;height:38px;"><p style="font-size:0.7em;">Refine para 4 estrelas para desbloquear</p>`;
                refineRow1.style.background = ''; refineRow1.style.color = '';
            }
        }

        if (refineRow2) {
            if (item.reforge_slot2) {
                const formattedName = formatAttrName(item.reforge_slot2.attr);
                let formattedValue = item.reforge_slot2.value;
                if (['TAXA CRIT','DANO CRIT','EVASÃO'].includes(formattedName)) formattedValue += '%';
                const textStyle2 = `font-size:1.1em; margin:0; color:silver; font-weight:bold; text-shadow:1px 1px 2px black,-1px -1px 2px black,1px -1px 2px black,-1px 1px 2px black,0 0 2px black,0 0 4px black;`;
                refineRow2.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/refund.webp" class="refine-icon" style="width:38px;height:38px;"><p style="${textStyle2}">${formattedName} +${formattedValue}</p>`;
                refineRow2.style.setProperty('background', rarityGradient(item.reforge_slot2.color));
                refineRow2.style.height = "15px";
            } else if (totalStars >= 5) {
                refineRow2.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/refund.webp" class="refine-icon" style="width:38px;height:38px;"><p style="font-size:0.9em;">Liberado para Refundição</p>`;
                refineRow2.style.background = ''; refineRow2.style.color = '';
            } else {
                refineRow2.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/locked.webp" class="refine-icon" style="width:38px;height:38px;"><p style="font-size:0.7em;">Refine para 5 estrelas para desbloquear</p>`;
                refineRow2.style.background = ''; refineRow2.style.color = '';
            }
        }

        if (refineSectionDiv) refineSectionDiv.style.display = 'block';
        if (itemActionsDiv) itemActionsDiv.style.display = 'flex';
    } else {
        if (itemStats) itemStats.style.display = 'none';
        if (refineSectionDiv) refineSectionDiv.style.display = 'none';
        if (itemActionsDiv) itemActionsDiv.style.display = 'none';
    }

    const equipBtnModal = document.getElementById('equipBtnModal');
    if (isEquipable) {
        const isEquipped = item.equipped_slot !== null;
        equipBtnModal.textContent = isEquipped ? 'Retirar' : 'Equipar';
        equipBtnModal.style.display = 'block';
        equipBtnModal.onclick = () => handleEquipUnequip(item, isEquipped);
    } else {
        equipBtnModal.style.display = 'none';
    }
    modal.style.display = 'flex';
}

function renderFragmentList(itemToLevelUp) {
    const fragmentListContainer = document.getElementById('fragmentList');
    fragmentListContainer.innerHTML = '';

    const fragments = allInventoryItems.filter(item => item.items && item.items.item_type === 'fragmento' && item.quantity > 0);

    if (fragments.length === 0) {
        fragmentListContainer.innerHTML = '<p>Você não tem fragmentos para usar.</p>';
        document.getElementById('confirmFragmentSelection').disabled = true;
        return;
    }

    document.getElementById('confirmFragmentSelection').disabled = false;

    fragments.forEach(fragment => {
        const fragmentLi = document.createElement('li');
        
        fragmentLi.innerHTML = `
            <div class="fragment-info" style="display:flex; align-items:center; gap:8px;">
                <img src="https://aden-rpg.pages.dev/assets/itens/${fragment.items.name}.webp"
                     alt="${fragment.items.display_name}" style="width:40px; height:40px; object-fit:contain;">
                <span>${fragment.items.display_name} (x${fragment.quantity})</span>
            </div>
            <div class="fragment-quantity" style="display:flex; align-items:center; gap:6px;">
                <label for="fragmentQuantityInput">Qtd:</label>
                <input type="number" class="fragment-quantity-input" placeholder="0" max="${fragment.quantity}" style="width: 50px; text-align: center;">
                <span class="btn-max-action" style="font-size: 0.75em; color: #FFD700; cursor: pointer; text-decoration: underline; font-weight: bold; margin-left: 2px;">MAX</span>
            </div>
        `;
        fragmentLi.setAttribute('data-inventory-item-id', fragment.id);
        fragmentLi.setAttribute('data-rarity', fragment.items.rarity);
        fragmentLi.classList.add('inventory-item');

        fragmentLi.addEventListener('click', (e) => {
            if (e.target && (e.target.classList.contains('fragment-quantity-input') || e.target.classList.contains('btn-max-action'))) return;
            fragmentLi.classList.toggle('selected');
        });

        const qtyInput = fragmentLi.querySelector('.fragment-quantity-input');
        const maxBtn = fragmentLi.querySelector('.btn-max-action');

        maxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            qtyInput.value = fragment.quantity;
            qtyInput.dispatchEvent(new Event('input'));
        });

        qtyInput.addEventListener('input', () => {
            let v = parseInt(qtyInput.value || '0', 10);
            if (isNaN(v) || v < 0) v = 0;
            if (v > fragment.quantity) {
                qtyInput.value = fragment.quantity;
                showCustomAlert(`Você só tem ${fragment.quantity} fragmentos disponíveis.`);
            } else {
                qtyInput.value = v;
            }
            if (parseInt(qtyInput.value, 10) > 0) fragmentLi.classList.add('selected');
            else fragmentLi.classList.remove('selected');
        });

        fragmentListContainer.appendChild(fragmentLi);
    });
}

async function showCraftingModal(fragment) {
    selectedItem = fragment;
    const craftingModal = document.getElementById('craftingModal');
    if (!craftingModal) return;

    let targetDef = window.itemDefinitions.get(fragment.items.crafts_item_id);
    if (!targetDef) {
        const { data } = await supabase.from('items').select('item_id, name, display_name, rarity, stars').eq('item_id', fragment.items.crafts_item_id).single();
        if (data) {
            targetDef = data;
            window.itemDefinitions.set(data.item_id, data);
        } else {
            return showCustomAlert('Erro ao carregar receita.');
        }
    }

    document.getElementById('craftingFragmentImage').src = `https://aden-rpg.pages.dev/assets/itens/${fragment.items.name}.webp`;
    document.getElementById('craftingFragmentName').textContent = fragment.items.display_name;
    document.getElementById('craftingTargetImage').src = `https://aden-rpg.pages.dev/assets/itens/${targetDef.name}_${targetDef.stars}estrelas.webp`;

    const crystalCost = { 'R': 100, 'SR': 300, 'SSR': 600 };
    document.getElementById('fragmentsNeeded').textContent = `30 (você tem: ${fragment.quantity})`;
    document.getElementById('crystalCost').textContent = crystalCost[targetDef.rarity] || 0;

    craftingModal.style.display = 'flex';
}

function openRefineFragmentModal(item) {
    const modal = document.getElementById('refineFragmentModal');
    const list = document.getElementById('refineFragmentList');
    const costsText = document.getElementById('refineCostsText');
    const confirmBtn = document.getElementById('confirmRefineSelectionRefine');

    if (!modal || !list || !costsText || !confirmBtn) return;

    const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);
    if (totalStars >= 5) return showCustomAlert('Este item já está no refinamento máximo (5★).');

    const capLevel = getCapLevelForCurrentStar(item);
    if ((item.level || 0) !== capLevel) return showCustomAlert(`Você precisa atingir o nível ${capLevel} para refinar.`);

    const requiredFragments = getRefineFragmentsRequired(capLevel, item.items?.rarity);
    const requiredCrystals = getRefineCrystalsRequired(capLevel, item.items?.rarity);

    const sameRarityFragments = (allInventoryItems || []).filter(inv =>
        inv.items?.item_type === 'fragmento' && inv.items?.rarity === item.items?.rarity && (inv.quantity || 0) > 0
    );

    list.innerHTML = '';
    costsText.textContent = `Custo: ${requiredFragments} fragmentos ${item.items?.rarity} + ${requiredCrystals} cristais.`;

    if (sameRarityFragments.length === 0) {
        list.innerHTML = '<p>Você não possui fragmentos desta raridade.</p>';
        confirmBtn.disabled = true;
        modal.style.display = 'flex';
        return;
    }

    confirmBtn.disabled = false;
    confirmBtn.onclick = () => {
        const selections = [];
        list.querySelectorAll('li.selected').forEach(li => {
            const qty = parseInt(li.querySelector('.fragment-quantity-input')?.value || '0', 10);
            if (qty > 0) selections.push({ fragment_id: li.getAttribute('data-inventory-item-id'), qty });
        });

        const sum = selections.reduce((acc, s) => acc + s.qty, 0);
        if (sum !== requiredFragments) return showCustomAlert(`A soma deve ser ${requiredFragments}. (atual: ${sum})`);

        handleRefineMulti(item, selections, requiredCrystals);
    };

    sameRarityFragments.forEach(f => {
        const li = document.createElement('li');
        li.dataset.inventoryItemId = f.id;
        li.innerHTML = `<div class="fragment-info" style="display:flex;align-items:center;gap:8px;"><img src="https://aden-rpg.pages.dev/assets/itens/${f.items.name}.webp" width="30"><span>${f.items.display_name} (x${f.quantity})</span></div><div class="fragment-quantity"><label>Qtd:</label><input class="fragment-quantity-input" type="number" max="${f.quantity}" placeholder="0"><span class="btn-max-action" style="font-size:0.75em;color:#FFD700;cursor:pointer;margin-left:4px;">MAX</span></div>`;
        
        const inp = li.querySelector('input');
        const maxBtn = li.querySelector('.btn-max-action');

        li.addEventListener('click', (e) => {
            if (e.target !== inp && e.target !== maxBtn) li.classList.toggle('selected');
        });

        maxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            inp.value = f.quantity;
            inp.dispatchEvent(new Event('input'));
        });

        inp.addEventListener('input', () => {
            if (parseInt(inp.value) > 0) li.classList.add('selected'); else li.classList.remove('selected');
        });
        
        list.appendChild(li);
    });
    modal.style.display = 'flex';
}

function getXpRequired(level, rarity) {
    const base = { 'R': 20, 'SR': 40, 'SSR': 80 }[rarity] || 40;
    return base + (level * 45);
}
function calcularFragmentosNecessariosParaCap(item, fragRarity) {
    try {
        const currentLevel = item.level || 0;
        const xpProgress = item.xp_progress || 0;
        const baseRarity = item.items?.rarity;
        if (!baseRarity) return 0;
        const capLevel = Math.min(((item.items?.stars || 0) + (item.refine_level || 0) + 1) * 5, 30);
        if (currentLevel >= capLevel) return 0;
        let totalXpNeeded = 0;
        for (let lvl = currentLevel; lvl < capLevel; lvl++) {
            const xpRequired = getXpRequired(lvl, baseRarity);
            if (lvl === currentLevel) totalXpNeeded += Math.max(0, xpRequired - xpProgress);
            else totalXpNeeded += xpRequired;
        }
        const xpPerFragment = getXpGainPerFragmentByRarity(fragRarity);
        if (xpPerFragment <= 0) return 0;
        return Math.max(0, Math.ceil(totalXpNeeded / xpPerFragment));
    } catch (e) { return 0; }
}
function getXpGainPerFragmentByRarity(rarity) {
    if (rarity === 'R') return 40;
    if (rarity === 'SR') return 80;
    if (rarity === 'SSR') return 160;
    return 40;
}
function getCapLevelForCurrentStar(item) {
    return Math.min(((item.items?.stars || 0) + (item.refine_level || 0) + 1) * 5, 30);
}
function getRefineFragmentsRequired(cap, rarity) {
    const table = { 5: 40, 10: 60, 15: 90, 20: 120, 25: 160 };
    return table[cap] || 0;
}
function getRefineCrystalsRequired(cap, rarity) {
    const table = {
        5:  { 'R': 400,  'SR': 800,   'SSR': 1600 },
        10: { 'R': 1200, 'SR': 2400,  'SSR': 4000 },
        15: { 'R': 1800, 'SR': 3200,  'SSR': 6000 },
        20: { 'R': 2600, 'SR': 4500,  'SSR': 9000 },
        25: { 'R': 3200, 'SR': 6000,  'SSR': 12000 }
    };
    return table[cap]?.[rarity] || 0;
}
function rarityGradient(color) {
    const map = {
        '#3aaef5': 'linear-gradient(180deg, #3aaef5, #1a7ab5, #3aaef5)',
        '#b23af5': 'linear-gradient(180deg, #b23af5, #7e0dbe, #b23af5)',
        '#f5d33a': 'linear-gradient(180deg, #f5d33a, #b29513, #f5d33a)'
    };
    return map[color] || color;
}
function formatAttrName(attr) {
    switch (attr) {
        case "attack_bonus": return "ATK";
        case "defense_bonus": return "DEF";
        case "health_bonus": return "HP";
        case "crit_chance_bonus": return "TAXA CRIT";
        case "crit_damage_bonus": return "DANO CRIT";
        case "evasion_bonus": return "EVASÃO";
        default: return attr;
    }
}

// ===============================
// Shimmer Patch
// ===============================
(function applyInitialShimmer(){
  function addShimmer(){
    ['playerAttack','playerDefense','playerHealth','playerCritChance','playerCritDamage','playerEvasion']
      .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('shimmer'); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addShimmer, { once: true });
  } else {
    addShimmer();
  }
})();

// ========================================================
// >>> EXPORTAÇÃO GLOBAL (PONTE PARA OUTROS SCRIPTS) <<<
// ========================================================
window.loadItems = loadItems;
window.calculatePlayerStats = calculatePlayerStats;
window.renderEquippedItems = renderEquippedItems;
window.showItemDetails = showItemDetails;
window.updateCacheItem = updateCacheItem;
window.removeCacheItem = removeCacheItem;
window.updateLocalInventoryState = updateLocalInventoryState; 
window.showCustomAlert = showCustomAlert;
window.openRefineFragmentModal = openRefineFragmentModal;

if (!window.handleDeconstruct) window.handleDeconstruct = () => {};