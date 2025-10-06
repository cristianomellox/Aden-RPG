const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let globalUser = null;
let equippedItems = [];
let playerBaseStats = {};
let allInventoryItems = [];
let selectedItem = null;


// ===============================
// IndexedDB utilitário simples (Cache 24h)
// ===============================
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 18; // <-- ALTERADO PARA 2

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

async function saveCache(items) {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    items.forEach(item => store.put(item));
    tx.objectStore(META_STORE).put({ key: "last_updated", value: Date.now() });
    return tx.complete;
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


document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM carregado. Iniciando script...');
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        window.location.href = "index.html?refresh=true";
        return;
    }

    globalUser = user;
    // =================================================================
    // >>>>> CORREÇÃO APLICADA AQUI <<<<<
    // Força a busca de dados frescos do servidor ao carregar a página.
    // =================================================================
    await loadPlayerAndItems();

    document.getElementById('refreshBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('Botão de refresh clicado. Forçando a recarga do Supabase.');
        await loadPlayerAndItems(true); // Força refresh
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

async function loadPlayerAndItems(forceRefresh = false) {
    // Tenta carregar do sessionStorage primeiro para carregamento instantâneo
    if (!forceRefresh) {
        const cachedSessionItems = sessionStorage.getItem('inventoryItems');
        const cachedSessionStats = sessionStorage.getItem('playerStats');
        if (cachedSessionItems && cachedSessionStats) {
            try {
                allInventoryItems = JSON.parse(cachedSessionItems);
                playerBaseStats = JSON.parse(cachedSessionStats);
                equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null);
                calculatePlayerStats();
                renderEquippedItems();
                loadItems('all', allInventoryItems);
                console.log('✅ Dados carregados do sessionStorage.');
                return;
            } catch (e) {
                console.warn('Falha ao ler sessionStorage. Indo para IndexedDB/Supabase.', e);
                sessionStorage.clear();
            }
        }
    }

    const lastUpdated = await getLastUpdated();
    const isExpired = !lastUpdated || (Date.now() - lastUpdated > 60 * 1000);
    const canUseCache = !forceRefresh && !isExpired;

    console.log('[CACHE] forceRefresh=', forceRefresh, ' isExpired=', isExpired, ' lastUpdated=', lastUpdated);

    if (canUseCache) {
        try {
            const [itemsFromCache, cachedStats] = await Promise.all([loadCache(), loadPlayerStatsFromCache()]);
            if (cachedStats) {
                playerBaseStats = cachedStats;
            }
            if (Array.isArray(itemsFromCache)) {
                allInventoryItems = itemsFromCache;
                // Salva no sessionStorage para acessos futuros nesta aba
                sessionStorage.setItem('inventoryItems', JSON.stringify(allInventoryItems));
                sessionStorage.setItem('playerStats', JSON.stringify(playerBaseStats));

                equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null);
                calculatePlayerStats();
                renderEquippedItems();
                loadItems('all', allInventoryItems);
                console.log('✅ Dados carregados do cache (sem egress).');
                return;
            } else {
                console.warn('Cache inválido (itens). Indo para fallback Supabase...');
            }
        } catch (e) {
            console.warn('Falha ao ler cache. Fallback Supabase...', e);
        }
    }

    console.log('🚀 Iniciando carregamento de dados do jogador e itens do Supabase...');
    const { data: player, error: playerError } = await supabase
        .from('players')
        .select(`
            avatar_url,
            min_attack,
            attack,
            defense,
            crit_chance,
            crit_damage,
            evasion,
            health,
            crystals
        `)
        .eq('id', globalUser.id)
        .single();

    if (playerError) {
        console.error('❌ Erro ao buscar dados do jogador:', playerError.message);
        showCustomAlert('Erro ao carregar dados do jogador. Tente recarregar a página.');
        return;
    }

    const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select(`
            id,
            item_id,
            quantity,
            equipped_slot,
            level,
            refine_level,
            xp_progress,
            min_attack_bonus,
            attack_bonus,
            defense_bonus,
            health_bonus,
            crit_chance_bonus,
            crit_damage_bonus,
            evasion_bonus,
            reforge_slot1,
            reforge_slot2,
            items (
                item_id,
                name,
                display_name,
                item_type,
                rarity,
                stars,
                crafts_item_id,
                min_attack,
                attack,
                defense,
                health,
                crit_chance,
                crit_damage,
                evasion,
                description
            )
        `)
        .eq('player_id', globalUser.id);

    if (itemsError) {
        console.error('❌ Erro ao buscar itens do inventário:', itemsError.message);
        showCustomAlert('Erro ao carregar itens. Tente recarregar a página.');
        return;
    }

    playerBaseStats = player;
    allInventoryItems = items || [];
    equippedItems = allInventoryItems.filter(item => item.equipped_slot !== null);
    await saveCache(allInventoryItems);
    console.log('💾 Dados salvos no cache.');

    // Salva também no sessionStorage
    sessionStorage.setItem('inventoryItems', JSON.stringify(allInventoryItems));
    sessionStorage.setItem('playerStats', JSON.stringify(playerBaseStats));

    calculatePlayerStats();
    renderEquippedItems();
    loadItems('all', allInventoryItems);
    console.log('✅ Inventário renderizado com sucesso.');
}

function calculatePlayerStats() {
    let currentStats = { ...playerBaseStats };

    equippedItems.forEach(invItem => {
        if (invItem.items) {
            currentStats.min_attack += invItem.items.min_attack || 0;
            currentStats.attack += invItem.items.attack || 0;
            currentStats.defense += invItem.items.defense || 0;
            currentStats.health += invItem.items.health || 0;
            currentStats.crit_chance += invItem.items.crit_chance || 0;
            currentStats.crit_damage += invItem.items.crit_damage || 0;
            currentStats.evasion += invItem.items.evasion || 0;
        }

        currentStats.min_attack += invItem.min_attack_bonus || 0;
        currentStats.attack += invItem.attack_bonus || 0;
        currentStats.defense += invItem.defense_bonus || 0;
        currentStats.health += invItem.health_bonus || 0;
        currentStats.crit_chance += invItem.crit_chance_bonus || 0;
        currentStats.crit_damage += invItem.crit_damage_bonus || 0;
        currentStats.evasion += invItem.evasion_bonus || 0;
    });

    document.getElementById('playerAvatarEquip').src = currentStats.avatar_url || '';
    // Auto-reset de cache se avatar ou stats inválidos
    if (!currentStats.avatar_url || isNaN(currentStats.attack) || isNaN(currentStats.defense)) {
        console.warn('⚠️ Cache inválido detectado. Limpando IndexedDB...');
        indexedDB.deleteDatabase(DB_NAME);
        loadPlayerAndItems(true);
        return;
    }

    document.getElementById('playerAttack').textContent = `${currentStats.min_attack} - ${currentStats.attack}`;
    document.getElementById('playerDefense').textContent = currentStats.defense;
    document.getElementById('playerHealth').textContent = currentStats.health;
    document.getElementById('playerCritChance').textContent = `${currentStats.crit_chance}%`;
    document.getElementById('playerCritDamage').textContent = `${currentStats.crit_damage}%`;
    document.getElementById('playerEvasion').textContent = `${currentStats.evasion}%`;
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
        
                // Adiciona o nível do item, se não for um fragmento ou outros e for nível 1 ou maior
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
        // Filtra itens com quantidade > 0 e que não estejam equipados
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

        // Verifica a condição para adicionar a classe de animação
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


        // Adiciona o nível do item, se não for um fragmento ou outros e for nível 1 ou maior
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

    // Ocultar ou exibir a barra de progresso e o botão de "Evoluir"
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

    // Ocultar ou exibir o container de estatísticas, refino e ações
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
    
        // Lógica para exibir os atributos de refundição nos elementos corretos
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

    // Lógica específica para o botão de Equipar/Remover
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

// Converte nome do campo para nome visível
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
        
        await loadPlayerAndItems(true); // Força a recarga completa para garantir a atualização
    } catch (err) {
        console.error('Erro geral ao equipar/desequipar:', err);
        showCustomAlert('Ocorreu um erro inesperado.');
    }
}

function renderFragmentList(itemToLevelUp) {
    const fragmentListContainer = document.getElementById('fragmentList');
    fragmentListContainer.innerHTML = '';

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
                <input type="number" class="fragment-quantity-input" placeholder="0" max="${fragment.quantity}">
            </div>
        `;
        fragmentLi.setAttribute('data-inventory-item-id', fragment.id);
        fragmentLi.setAttribute('data-rarity', fragment.items.rarity);
        fragmentLi.classList.add('inventory-item');

        fragmentLi.addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('fragment-quantity-input')) return;
            fragmentLi.classList.toggle('selected');
        });

        const qtyInput = fragmentLi.querySelector('.fragment-quantity-input');
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

    // Ajuste aqui para carregar a imagem do item criado corretamente, incluindo as estrelas
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
        handleRefineMulti(item, selections);
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
                <input type="number" class="fragment-quantity-input" max="${available}" placeholder="0">
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('fragment-quantity-input')) return;
            li.classList.toggle('selected');
        });

        const qtyInput = li.querySelector('.fragment-quantity-input');
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

async function handleRefineMulti(item, selections) {
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
            await loadPlayerAndItems(true);
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
            await loadPlayerAndItems(true);
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
            await loadPlayerAndItems(true);
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

// Aplica shimmer cedo (antes de qualquer preenchimento) e remove depois
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

// Ler stats do jogador do IndexedDB (META_STORE)
async function loadPlayerStatsFromCache() {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    return await new Promise((resolve) => {
      const req = tx.objectStore(META_STORE).get("player_stats");
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('Falha ao ler player_stats do cache:', e);
    return null;
  }
}

// Salvar itens + playerBaseStats no cache (mantém a mesma assinatura usada no projeto)
async function saveCache(items) {
  const db = await openDB();
  const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.clear();
  (items || []).forEach(item => store.put(item));
  try {
    tx.objectStore(META_STORE).put({ key: "last_updated", value: Date.now() });
    if (typeof playerBaseStats === 'object' && playerBaseStats) {
      tx.objectStore(META_STORE).put({ key: "player_stats", value: playerBaseStats });
    }
  } catch (e) {
    console.warn('Falha ao salvar META_STORE:', e);
  }
  return tx.complete;
}

// Não apaga IndexedDB automaticamente; apenas tenta recuperar/fazer fallback
function calculatePlayerStats() {
  const stats = { ...playerBaseStats };
  const isNum = (v) => Number.isFinite(Number(v));

  // Agrega bônus dos itens equipados sem causar NaN
  (equippedItems || []).forEach(invItem => {
    const it = invItem.items || {};
    stats.min_attack = (Number(stats.min_attack) || 0) + (Number(it.min_attack) || 0) + (Number(invItem.min_attack_bonus) || 0);
    stats.attack     = (Number(stats.attack)     || 0) + (Number(it.attack)     || 0) + (Number(invItem.attack_bonus)     || 0);
    stats.defense    = (Number(stats.defense)    || 0) + (Number(it.defense)    || 0) + (Number(invItem.defense_bonus)    || 0);
    stats.health     = (Number(stats.health)     || 0) + (Number(it.health)     || 0) + (Number(invItem.health_bonus)     || 0);
    stats.crit_chance= (Number(stats.crit_chance)|| 0) + (Number(it.crit_chance)|| 0) + (Number(invItem.crit_chance_bonus)|| 0);
    stats.crit_damage= (Number(stats.crit_damage)|| 0) + (Number(it.crit_damage)|| 0) + (Number(invItem.crit_damage_bonus)|| 0);
    stats.evasion    = (Number(stats.evasion)    || 0) + (Number(it.evasion)    || 0) + (Number(invItem.evasion_bonus)    || 0);
  });

  // Se não houver stats válidos no cache, mantenha shimmer e não reseta o DB
  const ok = isNum(stats.attack) && isNum(stats.defense) && isNum(stats.min_attack) && isNum(stats.health);
  if (!ok) {
    console.warn('Stats incompletos no cache; mantendo shimmer. (Sem reset de cache)');
    return;
  }

  // Preenche avatar (não erra se vazio) e remove shimmer
  const avatarEl = document.getElementById('playerAvatarEquip');
  if (avatarEl && stats.avatar_url) avatarEl.src = stats.avatar_url;

  ['playerAttack','playerDefense','playerHealth','playerCritChance','playerCritDamage','playerEvasion']
    .forEach(id => document.getElementById(id)?.classList.remove('shimmer'));

  const atkSpan = document.getElementById('playerAttack');
  const defSpan = document.getElementById('playerDefense');
  const hpSpan  = document.getElementById('playerHealth');
  const ccSpan  = document.getElementById('playerCritChance');
  const cdSpan  = document.getElementById('playerCritDamage');
  const evSpan  = document.getElementById('playerEvasion');

  if (atkSpan) atkSpan.textContent = `${Math.max(0, Math.floor(stats.min_attack))} - ${Math.max(0, Math.floor(stats.attack))}`;
  if (defSpan) defSpan.textContent = `${Math.max(0, Math.floor(stats.defense))}`;
  if (hpSpan)  hpSpan.textContent  = `${Math.max(0, Math.floor(stats.health))}`;
  if (ccSpan)  ccSpan.textContent  = `${(Number(stats.crit_chance) || 0)}%`;
  if (cdSpan)  cdSpan.textContent  = `${(Number(stats.crit_damage) || 0)}%`;
  if (evSpan)  evSpan.textContent  = `${(Number(stats.evasion) || 0)}%`;
}