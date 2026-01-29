import { supabase } from './supabaseClient.js'

window.supabase = supabase;
window.supabaseClient = supabase;

window.globalUser = null;
window.equippedItems = [];
window.playerBaseStats = {};
window.allInventoryItems = [];
window.selectedItem = null;

// ===============================
// CACHE DE DEFINIÇÕES (Hidratação Visual)
// ===============================
let itemDefinitions = new Map();

function loadLocalItemDefinitions() {
    try {
        const raw = localStorage.getItem('item_definitions_cache');
        if (raw) {
            const parsed = JSON.parse(raw);
            // Suporta formato array de arrays (Map entries) ou objeto direto
            if (Array.isArray(parsed.data)) {
                itemDefinitions = new Map(parsed.data);
            } else if (parsed.data) {
                Object.keys(parsed.data).forEach(k => itemDefinitions.set(parseInt(k), parsed.data[k]));
            } else if (Array.isArray(parsed)) {
                 itemDefinitions = new Map(parsed);
            }
            console.log(`📚 Definições de itens carregadas: ${itemDefinitions.size} itens.`);
        } else {
            console.warn("⚠️ Cache de definições vazio! Tente recarregar a página inicial.");
        }
    } catch(e) {
        console.warn("Falha ao carregar definições locais", e);
    }
}

// Função Vital: Pega um item "seco" (só ID) e anexa os dados visuais (Nome/Img)
function hydrateItem(invItem) {
    if (!invItem) return null;
    
    // Se já tem dados visuais populados (veio de um cache completo antigo), mantém
    if (invItem.items && invItem.items.name) return invItem;

    // Se não tem, busca no mapa
    const def = itemDefinitions.get(invItem.item_id);
    
    if (def) {
        // Clona para não alterar a referência do Map
        invItem.items = { ...def };
    } else {
        // Fallback seguro para não quebrar a tela enquanto carrega
        invItem.items = {
            item_id: invItem.item_id,
            name: 'unknown',
            display_name: 'Carregando...',
            rarity: 'R',
            item_type: 'unknown', // Tipo unknown evita mostrar barra de nível errada
            stars: 0,
            description: 'Dados do item não encontrados localmente.'
        };
    }
    return invItem;
}

// ===============================
// INDEXEDDB (Cache do Inventário)
// ===============================
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 47; 

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
            if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
            db.createObjectStore(META_STORE, { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveCache(items, stats, timestamp) {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const meta = tx.objectStore(META_STORE);

    store.clear();
    // Salva itens. Mesmo sem 'items' populado dentro do DB, o ID permite reidratar no load.
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

// --- HELPER DE AUTH OTIMISTA ---
function getLocalUserId() {
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                const session = JSON.parse(localStorage.getItem(k));
                if (session?.user?.id) return session.user.id;
            }
        }
    } catch (e) {}
    return null;
}

// ===============================
// LÓGICA DE MANIFESTO (SYNC)
// ===============================
function generateManifest(items) {
    // Envia assinatura curta para economizar upload
    return items.map(item => ({
        id: item.id,
        s: `${item.quantity}_${item.level || 0}_${item.refine_level || 0}_${item.equipped_slot || 'none'}`
    }));
}

function processInventoryDelta(localItems, delta) {
    let updatedList = [...localItems];
    
    // 1. Remove itens deletados no servidor
    if (delta.remove && delta.remove.length > 0) {
        const removeSet = new Set(delta.remove);
        updatedList = updatedList.filter(item => !removeSet.has(item.id));
    }

    // 2. Atualiza ou Adiciona itens
    if (delta.upsert && delta.upsert.length > 0) {
        delta.upsert.forEach(newItem => {
            const idx = updatedList.findIndex(i => i.id === newItem.id);
            if (idx !== -1) {
                // Merge inteligente (preserva propriedades locais se necessário)
                updatedList[idx] = { ...updatedList[idx], ...newItem };
            } else {
                updatedList.push(newItem);
            }
        });
    }
    return updatedList;
}

// ===============================
// INICIALIZAÇÃO
// ===============================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM carregado. Iniciando inventory.js com hidratação...');
    
    // 1. Carrega Definições Estáticas (IMAGENS/NOMES)
    loadLocalItemDefinitions();

    // 2. Autenticação
    const localId = getLocalUserId();
    if (localId) {
        globalUser = { id: localId };
    } else {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
            globalUser = data.session.user;
        } else {
            console.warn("Sem sessão. Redirecionando...");
            window.location.href = "index.html?refresh=true";
            return;
        }
    }
    
    // 3. Inicia carregamento do inventário
    await loadPlayerAndItems();

    // --- SETUP LISTENERS DA UI ---

    document.getElementById('refreshBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('Botão de refresh clicado. Forçando a recarga.');
        await loadPlayerAndItems(true); 
    });

    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.tab-button.active')?.classList.remove('active');
            button.classList.add('active');
            // ID da aba ex: "tab-equipment" -> "equipment"
            const category = button.id.replace('tab-', '');
            loadItems(category);
        });
    });

    document.getElementById('closeDetailsModal')?.addEventListener('click', () => {
        document.getElementById('itemDetailsModal').style.display = 'none';
    });

    document.getElementById('closeCraftingModal')?.addEventListener('click', () => {
        document.getElementById('craftingModal').style.display = 'none';
    });

    // Configura botões de ação (Evoluir, Refinar, etc)
    setupActionListeners();
});

function setupActionListeners() {
    document.getElementById('levelUpBtn')?.addEventListener('click', () => {
        if (!selectedItem) return showCustomAlert('Nenhum item selecionado para evoluir.');
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
}

// ===============================
// CARREGAMENTO DE DADOS (Load Logic)
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

        // Optimistic UI: Exibe dados locais imediatamente
        if (localItems && localItems.length >= 0) {
            // >>> HIDRATAÇÃO IMEDIATA <<<
            allInventoryItems = localItems.map(hydrateItem);
            playerBaseStats = localStats || {};
            equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
            renderUI();
        }
    } catch (e) {
        console.warn("Erro ao ler cache local:", e);
    }

    // 2. Se for Refresh Forçado ou Cache Vazio -> Download Completo
    if (forceRefresh || !localItems || localItems.length === 0) {
        console.log('🔄 Cache vazio ou Refresh. Baixando tudo...');
        await fullDownload();
        return;
    }

    // 3. Tenta Sincronização Diferencial (Delta Sync)
    console.log('🔄 Iniciando Delta Sync...');
    const manifest = generateManifest(localItems);

    const { data: deltaData, error: deltaError } = await supabase.rpc('sync_inventory', {
        p_player_id: globalUser.id,
        p_client_manifest: manifest
    });

    if (deltaError || !deltaData) {
        console.warn('⚠️ Falha no Delta Sync. Fazendo fallback para Download Completo.');
        await fullDownload();
        return;
    }

    // 4. Aplica as mudanças do Delta Sync
    try {
        console.log(`📥 Delta recebido: ${deltaData.upsert?.length || 0} modificados, ${deltaData.remove?.length || 0} removidos.`);
        
        const mergedList = processInventoryDelta(localItems, deltaData);
        
        // >>> HIDRATAÇÃO PÓS-SYNC <<<
        allInventoryItems = mergedList.map(hydrateItem);
        equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
        
        // Atualiza stats
        if (deltaData.player_stats) {
            playerBaseStats = deltaData.player_stats;
        }

        renderUI();

        // Salva o novo estado no cache
        await saveCache(allInventoryItems, playerBaseStats, deltaData.last_inventory_update);
        console.log('💾 Cache sincronizado e salvo.');

    } catch (e) {
        console.error("Erro ao processar Delta Sync:", e);
        await fullDownload();
    }
}

async function fullDownload() {
    console.log('⬇️ Executando Download Completo...');
    
    const { data: playerData, error: rpcError } = await supabase
        .rpc('get_player_data_lazy', { p_player_id: globalUser.id });

    if (rpcError) {
        console.error('❌ Erro crítico ao baixar inventário:', rpcError.message);
        showCustomAlert('Erro ao carregar inventário. Verifique sua conexão.');
        return;
    }

    playerBaseStats = playerData.cached_combat_stats || {};
    const rawItems = playerData.cached_inventory || [];
    
    // >>> HIDRATAÇÃO DO FULL DOWNLOAD <<<
    allInventoryItems = rawItems.map(hydrateItem);
    equippedItems = allInventoryItems.filter(item => item.equipped_slot !== null && item.quantity > 0);

    renderUI();

    try {
        await saveCache(allInventoryItems, playerBaseStats, playerData.last_inventory_update);
        console.log('💾 Cache completo salvo.');
    } catch (e) {
        console.warn("⚠️ Erro ao salvar cache:", e);
    }
}

// ===============================
// RENDERIZAÇÃO E UI
// ===============================

function renderUI() {
    updateStatsUI(playerBaseStats);
    renderEquippedItems();
    
    // Detecta aba ativa
    const activeTab = document.querySelector('.tab-button.active');
    const tabId = activeTab ? activeTab.id.replace('tab-', '') : 'all';
    
    loadItems(tabId, allInventoryItems);
}

function updateStatsUI(stats) {
    if (!stats) return;

    // Remove shimmer
    ['playerAttack','playerDefense','playerHealth','playerCritChance','playerCritDamage','playerEvasion']
        .forEach(id => document.getElementById(id)?.classList.remove('shimmer'));

    // Avatar
    const avatarEl = document.getElementById('playerAvatarEquip');
    if (avatarEl && stats.avatar_url) avatarEl.src = stats.avatar_url;

    // Valores
    const setTxt = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };

    setTxt('playerAttack', `${Math.floor(stats.min_attack || 0)} - ${Math.floor(stats.attack || 0)}`);
    setTxt('playerDefense', `${Math.floor(stats.defense || 0)}`);
    setTxt('playerHealth', `${Math.floor(stats.health || 0)}`);
    setTxt('playerCritChance', `${Math.floor(stats.crit_chance || 0)}%`);
    setTxt('playerCritDamage', `${Math.floor(stats.crit_damage || 0)}%`);
    setTxt('playerEvasion', `${Math.floor(stats.evasion || 0)}%`);
}

// Mantido para compatibilidade com chamadas externas
function calculatePlayerStats() {
    // A lógica real agora vem do servidor (playerBaseStats), então essa função pode ser vazia
}

function renderEquippedItems() {
    // Limpa slots
    const slots = ['weapon', 'ring', 'helm', 'special1', 'amulet', 'wing', 'armor', 'special2'];
    slots.forEach(slot => {
        const slotDiv = document.getElementById(`${slot}-slot`);
        if (slotDiv) slotDiv.innerHTML = '';
    });

    equippedItems.forEach(invItem => {
        const item = invItem.items; // Já hidratado
        if (item && invItem.equipped_slot) {
            const slotDiv = document.getElementById(`${invItem.equipped_slot}-slot`);
            if (slotDiv) {
                // Lógica de URL restaurada
                const totalStars = (item.stars || 0) + (invItem.refine_level || 0);
                
                // Se o nome for 'unknown', usa placeholder. Senão, monta a URL.
                let imgSrc;
                if (item.name === 'unknown') {
                    imgSrc = 'https://aden-rpg.pages.dev/assets/itens/unknown.webp';
                } else {
                    // Equipamentos usam o sufixo _Xestrelas.webp
                    imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.name}_${totalStars}estrelas.webp`;
                }

                slotDiv.innerHTML = `<img src="${imgSrc}" alt="${item.display_name}" onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'">`;
        
                // Nível só aparece se for > 0
                if (invItem.level && invItem.level >= 1) {
                    slotDiv.innerHTML += `<div class="item-level">Nv. ${invItem.level}</div>`;
                }

                slotDiv.onclick = () => showItemDetails(invItem);
            }
        }
    });
}

function loadItems(tab = 'all', itemsList = null) {
    const items = itemsList || allInventoryItems;
    const bagItemsGrid = document.getElementById('bagItemsGrid');
    if (!bagItemsGrid) return;

    bagItemsGrid.innerHTML = '';

    const filteredItems = items.filter(item => {
        // Filtro de Segurança
        if (item.equipped_slot !== null || item.quantity <= 0) return false;
        
        // Garante que item.items existe (segurança extra)
        if (!item.items) item = hydrateItem(item);
        
        const type = item.items.item_type;
        // Normaliza tipo para comparação (lowercase)
        const safeType = type ? type.toLowerCase() : 'outros';

        if (tab === 'all') return true;
        
        // Equipamentos: não são fragmentos e não são outros
        if (tab === 'equipment') {
            return safeType !== 'fragmento' && safeType !== 'outros' && safeType !== 'consumivel' && safeType !== 'unknown';
        }
        
        if (tab === 'fragments') {
            return safeType === 'fragmento';
        }
        
        if (tab === 'others') {
            return safeType === 'outros' || safeType === 'consumivel' || safeType === 'unknown';
        }
        
        return false;
    });

    if (filteredItems.length === 0) {
        bagItemsGrid.innerHTML = '<p class="empty-inventory-message">Nenhum item nesta categoria.</p>';
        return;
    }

    filteredItems.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'inventory-item';

        // Efeito visual para fragmentos craftáveis
        if (item.items.item_type === 'fragmento' && item.items.crafts_item_id && item.quantity >= 30) {
            itemDiv.classList.add('zoom-border');
        }

        const totalStars = (item.items.stars || 0) + (item.refine_level || 0);
        let imgSrc;
        
        if (item.items.name === 'unknown') {
            imgSrc = 'https://aden-rpg.pages.dev/assets/itens/unknown.webp';
        } else if (item.items.item_type === 'fragmento' || item.items.item_type === 'outros' || item.items.item_type === 'consumivel') {
            // Itens empilháveis não tem estrelas no nome do arquivo
            imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}.webp`;
        } else {
            // Equipamentos
            imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}_${totalStars}estrelas.webp`;
        }

        itemDiv.innerHTML = `<img src="${imgSrc}" alt="${item.items.name}" onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'">`;
        
        // Lógica de Quantidade: Mostra se > 1 e for empilhável (ou se for Outros/Fragmento)
        // Correção para Outros: Sempre mostra quantidade se > 1
        const isStackable = ['fragmento', 'outros', 'consumivel', 'unknown'].includes(item.items.item_type);
        if (item.quantity > 1 || isStackable) {
            itemDiv.innerHTML += `<span class="item-quantity">${item.quantity}</span>`;
        }

        // Lógica de Nível: SÓ mostra se NÃO for empilhável
        if (!isStackable && item.level && item.level >= 1) {
            itemDiv.innerHTML += `<div class="item-level">Lv. ${item.level}</div>`;
        }

        itemDiv.dataset.inventoryItemId = item.id;
        bagItemsGrid.appendChild(itemDiv);

        itemDiv.onclick = () => {
            if (item.items.item_type === 'fragmento' && item.items.crafts_item_id) {
                showCraftingModal(item);
            } else {
                showItemDetails(item);
            }
        };
    });
}

function showItemDetails(item) {
    selectedItem = item;
    const modal = document.getElementById('itemDetailsModal');
    if (!modal) return;

    if(!item.items) item = hydrateItem(item);

    const totalStars = (item.items.stars || 0) + (item.refine_level || 0);
    
    // Lógica de Imagem no Detalhe (Mesma do Grid)
    let imgSrc;
    if (item.items.name === 'unknown') {
        imgSrc = 'https://aden-rpg.pages.dev/assets/itens/unknown.webp';
    } else if (['fragmento', 'outros', 'consumivel'].includes(item.items.item_type)) {
        imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}.webp`;
    } else {
        imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}_${totalStars}estrelas.webp`;
    }

    document.getElementById('detailItemImage').src = imgSrc;
    document.getElementById('detailItemName').textContent = item.items.display_name;
    document.getElementById('detailItemRarity').textContent = item.items.rarity;
    
    const descDiv = document.getElementById('itemDescription');
    if(descDiv) descDiv.textContent = item.items.description || 'Nenhuma descrição.';

    // Verifica se é equipamento equipável
    const isStackable = ['consumivel', 'fragmento', 'outros', 'unknown'].includes(item.items.item_type);
    const isEquipment = !isStackable;
    
    // Lista explícita de tipos equipáveis para o botão
    const equipSlots = ['arma','Arma','Escudo','Anel','anel','Elmo','elmo','Asa','asa','Armadura','armadura','Colar','colar'];
    const isEquipableType = equipSlots.includes(item.items.item_type);

    if (isEquipment) {
        const level = item.level || 0;
        const maxLevelForStar = Math.min((totalStars + 1) * 5, 30);
        const xpRequired = getXpRequired(level, item.items.rarity);
        const xpProgress = item.xp_progress || 0;
        const xpPercentage = xpRequired > 0 ? (xpProgress / xpRequired) * 100 : 0;

        document.getElementById('detailItemLevel').textContent = `Nv. ${level} / ${maxLevelForStar}`;
        document.getElementById('levelXpBar').style.width = `${Math.min(xpPercentage, 100)}%`;
        document.getElementById('levelXpText').textContent = `${xpProgress} / ${xpRequired}`;
        document.querySelector('.progress-bar-container').style.display = 'block';

        const levelUpBtn = document.getElementById('levelUpBtn');
        levelUpBtn.style.display = (level >= maxLevelForStar) ? 'none' : 'block';
        
        renderStats(item);
        renderRefineInfo(item, totalStars);
        
        document.getElementById('itemActions').style.display = 'flex';
    } else {
        // Esconde coisas de equipamento para itens normais
        document.querySelector('.progress-bar-container').style.display = 'none';
        document.getElementById('levelUpBtn').style.display = 'none';
        document.getElementById('detailItemLevel').textContent = ''; // Limpa texto de nível
        document.getElementById('itemStats').style.display = 'none';
        document.getElementById('itemRefineSection').style.display = 'none';
        document.getElementById('itemActions').style.display = 'none';
    }

    // Botão Equipar
    const equipBtnModal = document.getElementById('equipBtnModal');
    if (isEquipableType) {
        equipBtnModal.style.display = 'block';
        equipBtnModal.textContent = item.equipped_slot ? 'Retirar' : 'Equipar';
        equipBtnModal.onclick = () => handleEquipUnequip(item, !!item.equipped_slot);
    } else {
        equipBtnModal.style.display = 'none';
    }
    
    modal.style.display = 'flex';
}

function renderStats(item) {
    const itemStats = document.getElementById('itemStats');
    itemStats.style.display = 'block';
    itemStats.innerHTML = '';
    
    const i = item.items; // Definição base
    const b = item;       // Dados de inventário (bônus)

    const show = (label, base, bonus, suffix='') => {
        if(base > 0 || bonus > 0) {
            itemStats.innerHTML += `<p>${label} Base: ${base}${suffix}</p>`;
            if(bonus > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus ${label}: +${bonus}${suffix}</p>`;
        }
    };

    show('ATK', i.attack, b.attack_bonus);
    show('DEF', i.defense, b.defense_bonus);
    show('HP', i.health, b.health_bonus);
    show('CRIT', i.crit_chance, b.crit_chance_bonus, '%');
    show('DANO CRIT', i.crit_damage, b.crit_damage_bonus, '%');
    show('EVASÃO', i.evasion, b.evasion_bonus, '%');
}

function renderRefineInfo(item, totalStars) {
    const refineSectionDiv = document.getElementById('itemRefineSection');
    const r1 = document.getElementById('refineRow1');
    const r2 = document.getElementById('refineRow2');

    const renderSlot = (el, slotData, requiredStars) => {
        if (slotData) {
            const formattedName = formatAttrName(slotData.attr);
            let formattedValue = slotData.value;
            if (['TAXA CRIT','DANO CRIT','EVASÃO'].includes(formattedName)) formattedValue += '%';

            el.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Reforjado" class="refine-icon" style="width: 38px; height: 38px;">
                <p style="font-size: 1.1em;">${formattedName} +${formattedValue}</p>
            `;
            el.style.background = slotData.color;
            el.style.color = "black";
            el.style.height = "15px";
        } else if (totalStars >= requiredStars) {
            el.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Liberado" class="refine-icon" style="width: 38px; height: 38px;">
                <p style="font-size: 0.9em;">Liberado para Refundição</p>
            `;
            el.style.background = '';
            el.style.color = '';
        } else {
            el.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/locked.webp" alt="Bloqueado" class="refine-icon" style="width: 38px; height: 38px;">
                <p style="font-size: 0.7em;">Refine para ${requiredStars} estrelas para desbloquear</p>
            `;
            el.style.background = '';
            el.style.color = '';
        }
    };

    renderSlot(r1, item.reforge_slot1, 4);
    renderSlot(r2, item.reforge_slot2, 5);
    refineSectionDiv.style.display = 'block';
}

function getXpRequired(level, rarity) {
    const xpBase = { 'R': 20, 'SR': 40, 'SSR': 80 };
    const base = xpBase[rarity] || 40;
    return base + (level * 45);
}

function formatAttrName(attr) {
    const map = {
        'attack_bonus': 'ATK', 'defense_bonus': 'DEF', 'health_bonus': 'HP',
        'crit_chance_bonus': 'TAXA CRIT', 'crit_damage_bonus': 'DANO CRIT', 'evasion_bonus': 'EVASÃO'
    };
    return map[attr] || attr;
}

// ===============================
// AÇÕES E UPDATES (Local State)
// ===============================

async function handleEquipUnequip(item, isEquipped) {
    try {
        const { data, error } = await supabase.rpc('toggle_equip', {
            p_inventory_item_id: item.id,
            p_player_id: globalUser.id,
            p_equip_status: !isEquipped
        });

        if (error) {
            showCustomAlert('Erro ao equipar/desequipar item: ' + error.message);
            return;
        }
        if (data && data.error) {
            showCustomAlert(data.error);
            return;
        }

        showCustomAlert(isEquipped ? 'Item desequipado com sucesso.' : 'Item equipado com sucesso.');
        document.getElementById('itemDetailsModal').style.display = 'none';
        
        // Atualização local imediata
        await updateLocalInventoryState(item.id); 
    } catch (err) {
        console.error(err);
        showCustomAlert('Ocorreu um erro inesperado.');
    }
}

async function handleRefineMulti(item, selections, crystalCost) {
    try {
        const { data, error } = await supabase.rpc('refine_item', {
            _inventory_item_id: item.id,
            _fragments: selections
        });

        if (error || data?.error) return showCustomAlert(error?.message || data?.error);

        const stars = (data.new_total_stars !== undefined) ? data.new_total_stars : ((item.items?.stars||0) + (item.refine_level||0) + 1);
        showCustomAlert(`Item refinado! Estrelas totais: ${stars}.`);
        
        await updateLocalInventoryState(item.id, data.used_fragments, data.used_crystals);
        document.getElementById('itemDetailsModal').style.display = 'none';
    } catch (err) {
        console.error(err);
        showCustomAlert('Erro ao refinar.');
    }
}

async function handleLevelUpMulti(item, selections) {
    document.getElementById('fragmentSelectModal').style.display = 'none';
    try {
        const { data, error } = await supabase.rpc('level_up_item', {
            p_inventory_item_id: item.id,
            p_fragments: selections
        });

        if (error || data?.error) return showCustomAlert(error?.message || data?.error);

        showCustomAlert(`Item evoluído para Nível ${data.new_level}! XP: ${data.new_xp}.`);
        
        await updateLocalInventoryState(item.id, data.used_fragments, 0);
        document.getElementById('itemDetailsModal').style.display = 'none';
    } catch (err) {
        console.error(err);
        showCustomAlert('Erro ao evoluir.');
    }
}

async function handleCraft(itemId, fragmentId) {
    try {
        const { data, error } = await supabase.rpc('craft_item', {
            p_item_id: itemId,
            p_fragment_id: fragmentId
        });

        if (error || data?.error) return showCustomAlert(error?.message || data?.error);

        showCustomAlert(`Item construído com sucesso!`);
        
        // Atualiza local: gasta 30 frags do tipo selecionado, gasta cristais, ganha novo item
        await updateLocalInventoryState(
            null, 
            [{fragment_inventory_id: fragmentId, used_qty: 30}], 
            data.crystals_spent, 
            data.new_item_id
        );

        document.getElementById('craftingModal').style.display = 'none';
    } catch (err) {
        console.error(err);
        showCustomAlert('Erro ao construir.');
    }
}

// --- FUNÇÃO CRUCIAL PARA ATUALIZAÇÃO LOCAL SEM RE-DOWNLOAD ---
async function updateLocalInventoryState(updatedItem, usedFragments, usedCrystals, newItemId) {
    // 1. Atualiza Item Principal (Equipamento evoluído/refinado/equipado)
    if (updatedItem) {
        const id = updatedItem.id || updatedItem;
        
        // Busca dados limpos no Supabase (Leve, sem JOIN) para garantir consistência
        const { data: fetchItem } = await supabase
            .from('inventory_items')
            .select('*') // Sem join com 'items'
            .eq('id', id)
            .single();

        if (fetchItem) {
             const idx = allInventoryItems.findIndex(i => i.id === fetchItem.id);
             // Hidrata antes de salvar
             const hydrated = hydrateItem(fetchItem);
             
             if (idx !== -1) {
                 allInventoryItems[idx] = hydrated;
                 if (fetchItem.quantity > 0) selectedItem = hydrated; 
             } else if (fetchItem.quantity > 0) {
                 allInventoryItems.push(hydrated);
             }
        }
    }

    // 2. Decrementa Fragmentos Usados
    if (usedFragments && Array.isArray(usedFragments)) {
        usedFragments.forEach(usage => {
            const fragId = usage.fragment_inventory_id || usage.id; 
            const qtyUsed = usage.used_qty || usage.qty;

            const idx = allInventoryItems.findIndex(i => i.id === fragId);
            if (idx !== -1) {
                allInventoryItems[idx].quantity -= qtyUsed;
                // Soft Delete (Quantity 0) mantido
                if (allInventoryItems[idx].quantity < 0) allInventoryItems[idx].quantity = 0;
            }
        });
    }

    // 3. Adiciona Novo Item (Craft)
    if (newItemId) {
        const { data: newFetchItem } = await supabase
            .from('inventory_items')
            .select('*')
            .eq('id', newItemId)
            .single();
        
        if (newFetchItem && newFetchItem.quantity > 0) {
            allInventoryItems.push(hydrateItem(newFetchItem));
        }
    }

    // 4. Atualiza Cristais do Jogador
    if (usedCrystals && playerBaseStats) {
        playerBaseStats.crystals = Math.max(0, (playerBaseStats.crystals || 0) - usedCrystals);
    }
    
    // 5. Atualiza Stats de Combate (apenas o JSON)
    try {
        const { data } = await supabase.from('players').select('cached_combat_stats').eq('id', globalUser.id).single();
        if (data && data.cached_combat_stats) playerBaseStats = data.cached_combat_stats;
    } catch(e) {}

    // 6. Atualiza Globais
    equippedItems = allInventoryItems.filter(invItem => invItem.equipped_slot !== null && invItem.quantity > 0);

    // 7. Salva no Cache e Renderiza
    const nowISO = new Date().toISOString();
    await saveCache(allInventoryItems, playerBaseStats, nowISO); 

    renderUI();
    
    // Atualiza modal se estiver aberta
    if (selectedItem && allInventoryItems.find(i => i.id === selectedItem.id && i.quantity > 0)) {
        showItemDetails(selectedItem);
    } else {
        document.getElementById('itemDetailsModal').style.display = 'none';
    }
}

// ===============================
// UI HELPERS (Modals, Render Lists)
// ===============================

function renderFragmentList(itemToLevelUp) {
    const list = document.getElementById('fragmentList');
    list.innerHTML = '';

    const fragments = allInventoryItems.filter(item => item.items && item.items.item_type === 'fragmento' && item.quantity > 0);

    if (fragments.length === 0) {
        list.innerHTML = '<p>Você não tem fragmentos.</p>';
        document.getElementById('confirmFragmentSelection').disabled = true;
        return;
    }
    document.getElementById('confirmFragmentSelection').disabled = false;

    fragments.forEach(fragment => {
        const li = document.createElement('li');
        // Define imagem com segurança
        const imgSrc = fragment.items.name ? `https://aden-rpg.pages.dev/assets/itens/${fragment.items.name}.webp` : 'https://aden-rpg.pages.dev/assets/itens/unknown.webp';
        
        li.innerHTML = `
            <div class="fragment-info" style="display:flex; align-items:center; gap:8px;">
                <img src="${imgSrc}" alt="${fragment.items.display_name}" style="width:40px; height:40px; object-fit:contain;">
                <span>${fragment.items.display_name} (x${fragment.quantity})</span>
            </div>
            <div class="fragment-quantity" style="display:flex; align-items:center; gap:6px;">
                <label>Qtd:</label>
                <input type="number" class="fragment-quantity-input" placeholder="0" max="${fragment.quantity}" style="width: 50px; text-align: center;">
                <span class="btn-max-action" style="font-size: 0.75em; color: #FFD700; cursor: pointer; text-decoration: underline; font-weight: bold; margin-left: 2px;">MAX</span>
            </div>
        `;
        li.dataset.inventoryItemId = fragment.id;
        li.dataset.rarity = fragment.items.rarity;
        li.classList.add('inventory-item');

        li.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.classList.contains('btn-max-action')) return;
            li.classList.toggle('selected');
        });

        const input = li.querySelector('.fragment-quantity-input');
        const maxBtn = li.querySelector('.btn-max-action');

        maxBtn.onclick = (e) => {
            e.stopPropagation();
            input.value = fragment.quantity;
            input.dispatchEvent(new Event('input'));
        };

        input.oninput = () => {
            let v = parseInt(input.value || '0', 10);
            if (v < 0) v = 0;
            if (v > fragment.quantity) {
                v = fragment.quantity;
                showCustomAlert(`Máximo: ${fragment.quantity}`);
            }
            input.value = v;
            if (v > 0) li.classList.add('selected'); else li.classList.remove('selected');
        };

        list.appendChild(li);
    });
}

function getXpGainPerFragmentByRarity(rarity) {
    return { 'R': 40, 'SR': 80, 'SSR': 160 }[rarity] || 40;
}

function calcularFragmentosNecessariosParaCap(item, fragmentRarity) {
    try {
        const curLvl = item.level || 0;
        const curXp = item.xp_progress || 0;
        const cap = Math.min(((item.items?.stars||0) + (item.refine_level||0) + 1) * 5, 30);
        
        if (curLvl >= cap) return 0;

        let total = 0;
        for (let l = curLvl; l < cap; l++) {
            const req = getXpRequired(l, item.items.rarity);
            total += (l === curLvl) ? Math.max(0, req - curXp) : req;
        }
        
        const perFrag = getXpGainPerFragmentByRarity(fragmentRarity);
        return Math.ceil(total / perFrag);
    } catch(e) { return 0; }
}

async function showCraftingModal(fragment) {
    selectedItem = fragment;
    const modal = document.getElementById('craftingModal');
    if (!modal) return;

    if(!fragment.items) fragment = hydrateItem(fragment);

    // Precisa buscar dados do item ALVO (Server ou Cache)
    const { data: itemToCraft, error } = await supabase
        .from('items')
        .select(`name, display_name, rarity, stars`)
        .eq('item_id', fragment.items.crafts_item_id)
        .single();

    if (error) return showCustomAlert('Erro ao carregar detalhes.');

    document.getElementById('craftingFragmentImage').src = `https://aden-rpg.pages.dev/assets/itens/${fragment.items.name}.webp`;
    document.getElementById('craftingFragmentName').textContent = fragment.items.display_name;
    document.getElementById('craftingTargetImage').src = `https://aden-rpg.pages.dev/assets/itens/${itemToCraft.name}_${itemToCraft.stars}estrelas.webp`;

    const costs = { 'R': 100, 'SR': 300, 'SSR': 600 };
    document.getElementById('craftingFragmentQuantity').textContent = ` ${fragment.quantity}`;
    document.getElementById('fragmentsNeeded').textContent = `30 (você tem: ${fragment.quantity})`;
    document.getElementById('crystalCost').textContent = costs[itemToCraft.rarity] || 0;

    modal.style.display = 'flex';
}

function getCapLevelForCurrentStar(item) {
    return Math.min(((item.items?.stars||0) + (item.refine_level||0) + 1) * 5, 30);
}

function getRefineFragmentsRequired(capLevel) {
    return { 5: 40, 10: 60, 15: 90, 20: 120, 25: 160 }[capLevel] || null;
}

function getRefineCrystalsRequired(capLevel, rarity) {
    const table = {
        5:  { 'R': 400,  'SR': 800,   'SSR': 1600 },
        10: { 'R': 1200, 'SR': 2400,  'SSR': 4000 },
        15: { 'R': 1800, 'SR': 3200,  'SSR': 6000 },
        20: { 'R': 2600, 'SR': 4500,  'SSR': 9000 },
        25: { 'R': 3200, 'SR': 6000,  'SSR': 12000 }
    };
    return table[capLevel]?.[rarity] || 0;
}

function openRefineFragmentModal(item) {
    const modal = document.getElementById('refineFragmentModal');
    const list = document.getElementById('refineFragmentList');
    const costsText = document.getElementById('refineCostsText');
    const confirmBtn = document.getElementById('confirmRefineSelectionRefine');

    if (!modal) return;

    if(!item.items) item = hydrateItem(item);

    const totalStars = (item.items.stars||0) + (item.refine_level||0);
    if (totalStars >= 5) return showCustomAlert('Item já no máximo (5★).');

    const cap = getCapLevelForCurrentStar(item);
    if ((item.level||0) !== cap) return showCustomAlert(`Atinja nível ${cap} para refinar.`);

    const reqFrags = getRefineFragmentsRequired(cap);
    const reqCryst = getRefineCrystalsRequired(cap, item.items.rarity);

    const frags = allInventoryItems.filter(i => 
        i.items && i.items.item_type === 'fragmento' && 
        i.items.rarity === item.items.rarity && 
        i.quantity > 0
    );

    list.innerHTML = '';
    costsText.textContent = `Custo: ${reqFrags} fragmentos ${item.items.rarity} + ${reqCryst} cristais.`;

    if (frags.length === 0) {
        list.innerHTML = '<p>Você não possui fragmentos desta raridade.</p>';
        confirmBtn.disabled = true;
    } else {
        confirmBtn.disabled = false;
        confirmBtn.onclick = () => {
            const sels = [];
            list.querySelectorAll('li.selected').forEach(li => {
                const qty = parseInt(li.querySelector('.fragment-quantity-input').value, 10) || 0;
                if(qty > 0) sels.push({ fragment_id: li.dataset.inventoryItemId, qty });
            });
            const sum = sels.reduce((a,b) => a + b.qty, 0);
            if (sum !== reqFrags) return showCustomAlert(`Soma deve ser ${reqFrags}. (Atual: ${sum})`);
            
            modal.style.display = 'none';
            handleRefineMulti(item, sels, reqCryst);
        };

        frags.forEach(f => {
            const li = document.createElement('li');
            const imgSrc = f.items.name ? `https://aden-rpg.pages.dev/assets/itens/${f.items.name}.webp` : '';
            li.innerHTML = `
                <div class="fragment-info" style="display:flex;align-items:center;gap:8px;">
                    <img src="${imgSrc}" style="width:40px;height:40px;object-fit:contain;">
                    <span>${f.items.display_name} (x${f.quantity})</span>
                </div>
                <div class="fragment-quantity" style="display:flex;align-items:center;gap:6px;">
                    <label>Qtd:</label>
                    <input type="number" class="fragment-quantity-input" max="${f.quantity}" placeholder="0" style="width:50px;text-align:center;">
                    <span class="btn-max-action" style="font-size:0.75em;color:#FFD700;cursor:pointer;text-decoration:underline;">MAX</span>
                </div>
            `;
            li.dataset.inventoryItemId = f.id;
            li.classList.add('inventory-item');
            
            li.onclick = (e) => { if(e.target.tagName !== 'INPUT' && !e.target.classList.contains('btn-max-action')) li.classList.toggle('selected'); };
            const inp = li.querySelector('input');
            li.querySelector('.btn-max-action').onclick = (e) => { e.stopPropagation(); inp.value = f.quantity; inp.dispatchEvent(new Event('input')); };
            inp.oninput = () => {
                let v = parseInt(inp.value||'0', 10);
                if(v > f.quantity) { v = f.quantity; showCustomAlert(`Max: ${f.quantity}`); }
                inp.value = v;
                if(v > 0) li.classList.add('selected'); else li.classList.remove('selected');
            };
            list.appendChild(li);
        });
    }
    modal.style.display = 'flex';
}

function showCustomAlert(msg) {
    const el = document.getElementById('customAlertMessage');
    const mo = document.getElementById('customAlertModal');
    if (el && mo) { el.textContent = msg; mo.style.display = 'flex'; }
    else alert(msg);
}

function showCustomConfirm(msg, cb) {
    const el = document.getElementById('customConfirmMessage');
    const mo = document.getElementById('customConfirmModal');
    if (el && mo) {
        el.textContent = msg;
        mo.style.display = 'flex';
        document.getElementById('customConfirmYesBtn').onclick = () => { mo.style.display = 'none'; cb(); };
        document.getElementById('customConfirmNoBtn').onclick = () => mo.style.display = 'none';
    } else {
        if(confirm(msg)) cb();
    }
}

// Exports
window.loadItems = loadItems;
window.calculatePlayerStats = calculatePlayerStats;
window.renderEquippedItems = renderEquippedItems;
window.showItemDetails = showItemDetails;
window.updateCacheItem = updateCacheItem;
window.removeCacheItem = removeCacheItem;
window.updateLocalInventoryState = updateLocalInventoryState;
window.showCustomAlert = showCustomAlert;
if (!window.handleDeconstruct) window.handleDeconstruct = () => {};