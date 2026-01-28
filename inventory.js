import { supabase } from './supabaseClient.js'

window.supabase = supabase;
window.supabaseClient = supabase;

window.globalUser = null;
window.equippedItems = [];
window.playerBaseStats = {};
window.allInventoryItems = [];
window.selectedItem = null;


// ===============================
// IndexedDB utilitário simples (Cache 24h)
// ===============================
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 47; // Incrementado para garantir limpeza de estruturas antigas

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
    
    // >>> ALTERAÇÃO PARA MANIFESTO EFICIENTE <<<
    // Não filtramos itens com quantity <= 0. Salvamos TUDO.
    // Assim, se o jogador ganhar o item de novo, o manifesto sabe que já temos os dados estáticos.
    (items || []).forEach(item => store.put(item));
    
    meta.put({ key: "last_updated", value: timestamp }); 
    meta.put({ key: "player_stats", value: stats });     
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
    // Agora permitimos salvar item com quantidade 0 (placeholder para manifesto)
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

// Gera o manifesto leve para enviar ao servidor
function generateManifest(items) {
    // O manifesto deve incluir itens com qtd 0 para o servidor saber que já temos o cache
    return items.map(item => ({
        id: item.id,
        // Assinatura: Quantidade_Nivel_Refino_Slot
        // Se qualquer um desses mudar, o servidor manda o update
        s: `${item.quantity}_${item.level || 0}_${item.refine_level || 0}_${item.equipped_slot || 'none'}`
    }));
}

// Aplica as diferenças retornadas pelo servidor ao array local
function processInventoryDelta(localItems, delta) {
    let updatedList = [...localItems];
    
    // 1. Remover itens deletados no servidor (se houver remoção explícita)
    if (delta.remove && delta.remove.length > 0) {
        const removeSet = new Set(delta.remove);
        updatedList = updatedList.filter(item => !removeSet.has(item.id));
    }

    // 2. Upsert (Adicionar ou Atualizar) itens retornados pelo servidor
    if (delta.upsert && delta.upsert.length > 0) {
        delta.upsert.forEach(newItem => {
            const idx = updatedList.findIndex(i => i.id === newItem.id);
            if (idx !== -1) {
                // Merge inteligente (preserva 'items' estático se o servidor mandou partial)
                updatedList[idx] = { ...updatedList[idx], ...newItem };
            } else {
                // Item Novo (Server mandou Full Object)
                updatedList.push(newItem);
            }
        });
    }

    return updatedList;
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
        
        if (!session) {
            console.warn("Nenhuma sessão ativa encontrada. Redirecionando para login.");
            window.location.href = "index.html?refresh=true";
            return;
        }
        globalUser = session.user;
    }
    
    // Inicia carregamento
    await loadPlayerAndItems();

    document.getElementById('refreshBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('Botão de refresh clicado. Forçando a recarga.');
        await loadPlayerAndItems(true); 
    });

    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.tab-button.active')?.classList.remove('active');
            button.classList.add('active');
            loadItems(button.id.replace('tab-', ''));
        });
    });

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
            
            // >>> AJUSTE PARA SOFT DELETE <<<
            // allInventoryItems contém TUDO (inclusive zeros)
            allInventoryItems = localItems;
            
            playerBaseStats = localStats || {};
            
            // equippedItems só considera itens que existem (qtd > 0)
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
        
        const mergedList = processInventoryDelta(localItems, deltaData);
        
        // Atualiza variáveis globais (mergedList pode conter qtd=0)
        allInventoryItems = mergedList;
        equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
        
        // Atualiza stats se o servidor mandou (mandará se houver mudança ou sync)
        if (deltaData.player_stats) {
            playerBaseStats = deltaData.player_stats;
        }

        // Renderiza com os dados atualizados
        renderUI();

        // Salva o novo estado no cache (incluindo zerados)
        await saveCache(allInventoryItems, playerBaseStats, deltaData.last_inventory_update);
        console.log('💾 Cache local sincronizado e salvo.');

    } catch (e) {
        console.error("Erro ao processar Delta Sync:", e);
        await fullDownload(); // Última tentativa de segurança
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

    // Atualiza variáveis globais
    playerBaseStats = playerData.cached_combat_stats || {};
    // Pega todos, inclusive zerados se o RPC mandar (mas RPC lazy geralmente manda tudo)
    const rawItems = playerData.cached_inventory || [];
    allInventoryItems = rawItems;
    equippedItems = allInventoryItems.filter(item => item.equipped_slot !== null && item.quantity > 0);

    // Renderiza
    renderUI();

    // Salva no cache
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
    // Recupera a tab ativa ou usa 'all'
    const activeTab = document.querySelector('.tab-button.active');
    const tabId = activeTab ? activeTab.id.replace('tab-', '') : 'all';
    
    // loadItems é responsável por filtrar visualmente os zerados
    loadItems(tabId, allInventoryItems);
}

// Atualiza a UI usando os stats já calculados pelo servidor
function updateStatsUI(stats) {
    if (!stats) return;

    // Remove shimmer
    ['playerAttack','playerDefense','playerHealth','playerCritChance','playerCritDamage','playerEvasion']
        .forEach(id => document.getElementById(id)?.classList.remove('shimmer'));

    // Avatar
    const avatarEl = document.getElementById('playerAvatarEquip');
    if (avatarEl && stats.avatar_url) avatarEl.src = stats.avatar_url;

    // Valores
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

// Mantido apenas como compatibilidade, pois o cálculo real agora vem do servidor
function calculatePlayerStats() {
    // console.log("Stats sincronizados.");
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
                slotDiv.innerHTML = `<img src="${imgSrc}" alt="${item.display_name}">`;
        
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
        // SEGURANÇA VISUAL: 
        // 1. Não mostra itens equipados
        // 2. Não mostra itens com quantidade <= 0 (Isso é crucial para o sistema Soft Delete)
        if (item.equipped_slot !== null || item.quantity <= 0) return false;
        
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
        if (item.items.item_type === 'fragmento') {
            imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}.webp`;
        } else {
            const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);
            imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}_${totalStars}estrelas.webp`;
        }

        itemDiv.innerHTML = `<img src="${imgSrc}" alt="${item.items.name}">`;
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

function showItemDetails(item) {
    selectedItem = item;
    const itemDetails = document.getElementById('itemDetailsModal');
    if (!itemDetails) return;

    document.getElementById('itemDetailsContent').dataset.currentItem = JSON.stringify(item);

    let imgSrc;
    if (item.items.item_type === 'fragmento') {
        imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}.webp`;
    } else {
        const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);
        imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}_${totalStars}estrelas.webp`;
    }
    document.getElementById('detailItemImage').src = imgSrc;

    const itemDescriptionDiv = document.getElementById('itemDescription');
    if (itemDescriptionDiv) {
        itemDescriptionDiv.textContent = item.items.description || 'Nenhuma descrição disponível.';
    }

    document.getElementById('detailItemRarity').textContent = item.items.rarity;
    document.getElementById('detailItemName').textContent = item.items.display_name;
  
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
        const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);

        if (refineRow1) {
            if (item.reforge_slot1) {
                const formattedName = formatAttrName(item.reforge_slot1.attr);
                let formattedValue = item.reforge_slot1.value;

                if (formattedName === 'TAXA CRIT' || formattedName === 'DANO CRIT' || formattedName === 'EVASÃO') {
                    formattedValue += '%';
                }

                refineRow1.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Reforjado" class="refine-icon" style="width: 38px; height: 38px;">
                    <p style="font-size: 1.1em;">${formattedName} +${formattedValue}</p>
                `;
                refineRow1.style.background = item.reforge_slot1.color;
                refineRow1.style.color = "black";
                refineRow1.style.height = "15px";
            } else if (totalStars >= 4) {
                refineRow1.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Liberado" class="refine-icon" style="width: 38px; height: 38px;">
                    <p style="font-size: 0.9em;">Liberado para Refundição</p>
                `;
                refineRow1.style.background = '';
                refineRow1.style.color = '';
            } else {
                refineRow1.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/locked.webp" alt="Bloqueado" class="refine-icon" style="width: 38px; height: 38px;">
                    <p style="font-size: 0.7em;">Refine para 4 estrelas para desbloquear</p>
                `;
                refineRow1.style.background = '';
                refineRow1.style.color = '';
            }
        }

        if (refineRow2) {
            if (item.reforge_slot2) {
                const formattedName = formatAttrName(item.reforge_slot2.attr);
                let formattedValue = item.reforge_slot2.value;

                if (formattedName === 'TAXA CRIT' || formattedName === 'DANO CRIT' || formattedName === 'EVASÃO') {
                    formattedValue += '%';
                }
                
                refineRow2.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Reforjado" class="refine-icon" style="width: 38px; height: 38px;">
                    <p style="font-size: 1.1em;">${formattedName} +${formattedValue}</p>
                `;
                refineRow2.style.background = item.reforge_slot2.color;
                refineRow2.style.color = "black";
                refineRow2.style.height = "15px";
            } else if (totalStars >= 5) {
                refineRow2.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Liberado" class="refine-icon" style="width: 38px; height: 38px;">
                    <p style="font-size: 0.9em;">Liberado para Refundição</p>
                `;
                refineRow2.style.background = '';
                refineRow2.style.color = '';
            } else {
                refineRow2.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/locked.webp" alt="Bloqueado" class="refine-icon" style="width: 38px; height: 38px;">
                    <p style="font-size: 0.7em;">Refine para 5 estrelas para desbloquear</p>
                `;
                refineRow2.style.background = '';
                refineRow2.style.color = '';
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
    itemDetails.style.display = 'flex';
}

function getXpRequired(level, rarity) {
    const xpBase = { 'R': 20, 'SR': 40, 'SSR': 80 };
    const base = xpBase[rarity] || 40;
    return base + (level * 45);
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
        
        // Força recarga completa pois equipamento afeta stats globais
        await updateLocalInventoryState(item.id); 
    } catch (err) {
        console.error('Erro geral ao equipar/desequipar:', err);
        showCustomAlert('Ocorreu um erro inesperado.');
    }
}

function renderFragmentList(itemToLevelUp) {
    const fragmentListContainer = document.getElementById('fragmentList');
    fragmentListContainer.innerHTML = '';

    // Filtra visualmente apenas os que tem > 0
    const fragments = allInventoryItems.filter(item => item.items.item_type === 'fragmento' && item.quantity > 0);

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

        // Botão MAX
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
            if (parseInt(qtyInput.value, 10) > 0) {
                fragmentLi.classList.add('selected');
            } else {
                fragmentLi.classList.remove('selected');
            }
        });

        fragmentListContainer.appendChild(fragmentLi);
    });
}

function getXpGainPerFragmentByRarity(rarity) {
    if (rarity === 'R') return 40;
    if (rarity === 'SR') return 80;
    if (rarity === 'SSR') return 160;
    return 40;
}

function calcularFragmentosNecessariosParaCap(item, fragmentRarity) {
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
            if (lvl === currentLevel) {
                totalXpNeeded += Math.max(0, xpRequired - xpProgress);
            } else {
                totalXpNeeded += xpRequired;
            }
        }

        const xpPerFragment = getXpGainPerFragmentByRarity(fragmentRarity);
        if (xpPerFragment <= 0) return 0;
        return Math.max(0, Math.ceil(totalXpNeeded / xpPerFragment));
    } catch (e) {
        console.error('Erro ao calcular fragmentos necessários:', e);
        return 0;
    }
}

async function showCraftingModal(fragment) {
    selectedItem = fragment;
    const craftingModal = document.getElementById('craftingModal');
    if (!craftingModal) return;

    document.getElementById('craftingContent').dataset.currentFragment = JSON.stringify(fragment);

    const { data: itemToCraft, error: itemError } = await supabase
        .from('items')
        .select(`name, display_name, rarity, stars`)
        .eq('item_id', fragment.items.crafts_item_id)
        .single();

    if (itemError) {
        console.error('Erro ao buscar item a ser construído:', itemError.message);
        showCustomAlert('Não foi possível carregar os detalhes de construção.');
        return;
    }

    document.getElementById('craftingFragmentImage').src =
        `https://aden-rpg.pages.dev/assets/itens/${fragment.items.name}.webp`;
    document.getElementById('craftingFragmentName').textContent = fragment.items.display_name;

    document.getElementById('craftingTargetImage').src =
        `https://aden-rpg.pages.dev/assets/itens/${itemToCraft.name}_${itemToCraft.stars}estrelas.webp`;

    const crystalCost = { 'R': 100, 'SR': 300, 'SSR': 600 };
    const fragmentsNeeded = 30;

    document.getElementById('craftingFragmentQuantity').textContent = ` ${fragment.quantity}`;
    document.getElementById('fragmentsNeeded').textContent = `${fragmentsNeeded} (você tem: ${fragment.quantity})`;
    document.getElementById('crystalCost').textContent = crystalCost[itemToCraft.rarity] || 0;

    craftingModal.style.display = 'flex';
}

function getCapLevelForCurrentStar(item) {
    const cap = ((item.items?.stars || 0) + (item.refine_level || 0) + 1) * 5;
    return Math.min(cap, 30);
}

function getRefineFragmentsRequired(capLevel, rarity) {
    const table = { 5: 40, 10: 60, 15: 90, 20: 120, 25: 160 };
    return table[capLevel] || null;
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

    if (!modal || !list || !costsText || !confirmBtn) {
        showCustomAlert('Estrutura do modal de refino não encontrada.');
        return;
    }

    const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);
    if (totalStars >= 5) {
        showCustomAlert('Este item já está no refinamento máximo (5★).');
        return;
    }

    const capLevel = getCapLevelForCurrentStar(item);
    if ((item.level || 0) !== capLevel) {
        showCustomAlert(`Você precisa atingir o nível ${capLevel} para refinar.`);
        return;
    }

    const requiredFragments = getRefineFragmentsRequired(capLevel, item.items?.rarity);
    const requiredCrystals = getRefineCrystalsRequired(capLevel, item.items?.rarity);
    if (!requiredFragments) {
        showCustomAlert('Não foi possível determinar o custo de refino para este nível.');
        return;
    }

    // Filtro visual: só mostra quem tem > 0
    const sameRarityFragments = (allInventoryItems || []).filter(inv =>
        inv.items?.item_type === 'fragmento' &&
        inv.items?.rarity === item.items?.rarity &&
        (inv.quantity || 0) > 0
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
            if (qty > 0) {
                selections.push({ fragment_id: li.getAttribute('data-inventory-item-id'), qty });
            }
        });

        const sum = selections.reduce((acc, s) => acc + s.qty, 0);
        if (sum !== requiredFragments) {
            showCustomAlert(`A soma das quantidades deve ser exatamente ${requiredFragments}. (atual: ${sum})`);
            return;
        }

        modal.style.display = 'none';
        handleRefineMulti(item, selections, requiredCrystals); // Passamos o custo de cristais
    };

    sameRarityFragments.forEach(fragmentInv => {
        const available = fragmentInv.quantity || 0;
        const li = document.createElement('li');
        li.className = 'inventory-item';
        li.setAttribute('data-inventory-item-id', fragmentInv.id);
        
        li.innerHTML = `
            <div class="fragment-info" style="display:flex;align-items:center;gap:8px;">
                <img src="https://aden-rpg.pages.dev/assets/itens/${fragmentInv.items.name}.webp"
                     alt="${fragmentInv.items.display_name}" style="width:40px;height:40px;object-fit:contain;">
                <span>${fragmentInv.items.display_name} (x${available})</span>
            </div>
            <div class="fragment-quantity" style="display:flex;align-items:center;gap:6px;">
                <label>Qtd:</label>
                <input type="number" class="fragment-quantity-input" max="${available}" placeholder="0" style="width: 50px; text-align: center;">
                <span class="btn-max-action" style="font-size: 0.75em; color: #FFD700; cursor: pointer; text-decoration: underline; font-weight: bold; margin-left: 2px;">MAX</span>
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (e.target && (e.target.classList.contains('fragment-quantity-input') || e.target.classList.contains('btn-max-action'))) return;
            li.classList.toggle('selected');
        });

        const qtyInput = li.querySelector('.fragment-quantity-input');
        const maxBtn = li.querySelector('.btn-max-action');

        // Botão MAX
        maxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            qtyInput.value = available;
            qtyInput.dispatchEvent(new Event('input'));
        });

        qtyInput.addEventListener('input', () => {
            let val = parseInt(qtyInput.value || '0', 10);
            if (isNaN(val) || val < 0) val = 0;
            if (val > available) {
                qtyInput.value = available;
                showCustomAlert(`Você só tem ${available} fragmentos disponíveis.`);
            } else {
                qtyInput.value = val;
            }
            if (parseInt(qtyInput.value, 10) > 0) li.classList.add('selected');
            else li.classList.remove('selected');
        });

        list.appendChild(li);
    });

    modal.style.display = 'flex';
}

// -------------------------------------------------------------
// FUNÇÃO MÁGICA DE ATUALIZAÇÃO LOCAL (Sem baixar tudo de novo)
// -------------------------------------------------------------
async function updateLocalInventoryState(updatedItem, usedFragments, usedCrystals, newItem = null) {
    let needsSort = false;

    // 1. Atualiza Item Principal (Equipamento evoluído/refinado)
    if (updatedItem) {
        // Se vier objeto completo ou ID
        const itemId = updatedItem.id || updatedItem;
        
        // Busca dados limpos no Supabase para garantir integridade
        // (Isso é um fetch leve por ID, muito melhor que recarregar tudo)
        const { data: fetchItem } = await supabase
            .from('inventory_items')
            .select('*, items(*)')
            .eq('id', itemId)
            .single();

        if (fetchItem) {
             const idx = allInventoryItems.findIndex(i => i.id === fetchItem.id);
             
             // >>> AJUSTE PARA SOFT DELETE <<<
             // Se quantity <= 0, NÃO removemos do array. Apenas atualizamos.
             // O filtro visual acontece no renderUI.
             if (idx !== -1) {
                 allInventoryItems[idx] = fetchItem;
                 if (fetchItem.quantity > 0) {
                     selectedItem = fetchItem; 
                 }
             } else if (fetchItem.quantity > 0) {
                 allInventoryItems.push(fetchItem); // Caso raro de item novo
                 needsSort = true;
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
                // >>> AJUSTE PARA SOFT DELETE <<<
                // Se quantity chegar a 0, mantemos no array.
                // Apenas garantimos que não fique negativo.
                if (allInventoryItems[idx].quantity < 0) {
                    allInventoryItems[idx].quantity = 0;
                }
            }
        });
    }

    // 3. Adiciona Item Novo (ex: craft)
    if (newItem) {
        const newItemId = newItem.id || newItem;
        const { data: newFetchItem } = await supabase
            .from('inventory_items')
            .select('*, items(*)')
            .eq('id', newItemId)
            .single();
        
        if (newFetchItem && newFetchItem.quantity > 0) {
            allInventoryItems.push(newFetchItem);
            needsSort = true;
        }
    }

    // 4. Atualiza Cristais do Jogador (se gasto)
    if (usedCrystals && playerBaseStats) {
        playerBaseStats.crystals = Math.max(0, (playerBaseStats.crystals || 0) - usedCrystals);
    }
    
    // 5. >>> CORREÇÃO: Atualiza os STATS de Combate <<<
    // O backend já recalculou isso na tabela players. Vamos buscar só essa coluna (MUITO leve).
    await refreshPlayerStatsOnly();

    // 6. Atualiza Globais
    // equippedItems só deve ter itens válidos (>0)
    equippedItems = allInventoryItems.filter(invItem => invItem.equipped_slot !== null && invItem.quantity > 0);

    // 7. Salva no Cache Local (INCLUINDO ITEMS COM QTD 0) e Re-renderiza
    const nowISO = new Date().toISOString();
    await saveCache(allInventoryItems, playerBaseStats, nowISO); 

    renderUI();
    
    // Se estávamos vendo detalhes de um item que ainda existe (qtd>0), atualiza a modal
    if (selectedItem && allInventoryItems.find(i => i.id === selectedItem.id && i.quantity > 0)) {
        showItemDetails(selectedItem);
    } else {
        document.getElementById('itemDetailsModal').style.display = 'none';
    }
}

// Helper para buscar APENAS os stats do jogador (Egress mínimo)
async function refreshPlayerStatsOnly() {
    try {
        const { data, error } = await supabase
            .from('players')
            .select('cached_combat_stats')
            .eq('id', globalUser.id)
            .single();
        
        if (data && data.cached_combat_stats) {
            playerBaseStats = data.cached_combat_stats;
        }
    } catch (e) {
        console.error("Erro ao atualizar stats do jogador:", e);
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
            await updateLocalInventoryState(item.id, data.used_fragments, data.used_crystals);
            
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
            showCustomAlert(`Item evoluído para Nível ${data.new_level}! XP atual: ${data.new_xp}.`);
            
            // ATUALIZAÇÃO LOCAL
            await updateLocalInventoryState(item.id, data.used_fragments, 0);

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
            
            // ATUALIZAÇÃO LOCAL
            await updateLocalInventoryState(
                null, 
                [{fragment_inventory_id: fragmentId, used_qty: 30}], 
                data.crystals_spent, 
                data.new_item_id
            );

            document.getElementById('craftingModal').style.display = 'none';
        } else {
            showCustomAlert('Não foi possível construir o item. Tente novamente.');
        }
    } catch (err) {
        console.error('Erro geral ao construir:', err);
        showCustomAlert('Ocorreu um erro ao tentar construir o item.');
    }
}


// ===============================
// >>> Cache & Shimmer FIX PATCH (appended) <<<
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
window.updateLocalInventoryState = updateLocalInventoryState; // EXPORTADO

window.showCustomAlert = showCustomAlert;

if (!window.handleDeconstruct) window.handleDeconstruct = () => {};