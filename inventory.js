const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let globalUser = null;
let equippedItems = [];
let playerBaseStats = {};
let allInventoryItems = [];
let selectedItem = null;

// =======================================================================
// CACHE KEYS
// =======================================================================
const EQUIPPED_CACHE_KEY = 'aden_equipped_stats_cache_v1';
const MPA_PLAYER_CACHE_KEY = 'player_data_cache'; // Mantido para o sistema de Minas

// =======================================================================
// AUTH HELPER (Zero Egress Check)
// =======================================================================
function getLocalUserId() {
    try {
        const cached = localStorage.getItem(MPA_PLAYER_CACHE_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.data && parsed.data.id) {
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

// =======================================================================
// INICIALIZAÇÃO
// =======================================================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM carregado. Iniciando inventory.js refatorado...');
    
    // 1. Auth Otimista
    const localId = getLocalUserId();
    
    if (localId) {
        globalUser = { id: localId };
    } else {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            window.location.href = "index.html?refresh=true";
            return;
        }
        globalUser = session.user;
    }
    
    // Carrega dados (Cache persistente para equipados + Rede para bolsa)
    await loadPlayerAndItems();

    // Event Listeners Originais
    document.getElementById('refreshBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        // Força limpeza visual do cache para dar feedback
        localStorage.removeItem(EQUIPPED_CACHE_KEY); 
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

// =======================================================================
// LÓGICA CORE: CARREGAMENTO (REFATORADA)
// =======================================================================
async function loadPlayerAndItems(forceRefresh = false) {
    // 1. CARREGAMENTO OTIMISTA (Apenas Status e Equipados)
    // Se não for um refresh forçado, tenta mostrar a UI imediatamente com o cache local
    if (!forceRefresh) {
        try {
            const cached = localStorage.getItem(EQUIPPED_CACHE_KEY);
            if (cached) {
                const { stats, equipped } = JSON.parse(cached);
                if (stats && equipped) {
                    playerBaseStats = stats;
                    equippedItems = equipped;
                    calculatePlayerStats(); // Renderiza Avatar e Status
                    renderEquippedItems();  // Renderiza Slots
                    console.log('⚡ UI restaurada do cache persistente.');
                }
            }
        } catch (e) {
            console.warn('Cache inválido:', e);
        }
    }

    // 2. FETCH DA REDE (Sempre executa para garantir bolsa fresca)
    console.log('🚀 Buscando dados atualizados do Supabase...');
    
    // Busca paralela para eficiência
    const [playerResponse, itemsResponse] = await Promise.all([
        supabase
            .from('players')
            .select(`
                id, name, avatar_url, level,
                min_attack, attack, defense, crit_chance, crit_damage, evasion, health, crystals
            `)
            .eq('id', globalUser.id)
            .single(),
        supabase
            .from('inventory_items')
            .select(`
                id, item_id, quantity, equipped_slot, level, refine_level, xp_progress,
                min_attack_bonus, attack_bonus, defense_bonus, health_bonus,
                crit_chance_bonus, crit_damage_bonus, evasion_bonus,
                reforge_slot1, reforge_slot2,
                items (
                    item_id, name, display_name, item_type, rarity, stars, crafts_item_id,
                    min_attack, attack, defense, health, crit_chance, crit_damage, evasion, description
                )
            `)
            .eq('player_id', globalUser.id)
    ]);

    if (playerResponse.error) {
        console.error('Erro player:', playerResponse.error);
        return;
    }
    if (itemsResponse.error) {
        console.error('Erro itens:', itemsResponse.error);
        return;
    }

    // 3. ATUALIZAÇÃO DO ESTADO
    playerBaseStats = playerResponse.data;
    allInventoryItems = itemsResponse.data || [];
    
    // Separa os equipados baseados na resposta fresca da rede
    equippedItems = allInventoryItems.filter(item => item.equipped_slot !== null);

    // 4. ATUALIZAÇÃO DO CACHE PERSISTENTE (Equipados + Stats)
    // Salva no localStorage para a próxima vez que o jogador abrir a página
    localStorage.setItem(EQUIPPED_CACHE_KEY, JSON.stringify({
        stats: playerBaseStats,
        equipped: equippedItems
    }));

    // Atualiza Cache MPA (Minas)
    const mpaCache = {
        data: playerBaseStats,
        timestamp: Date.now(),
        expires: Date.now() + (24 * 60 * 60 * 1000)
    };
    localStorage.setItem(MPA_PLAYER_CACHE_KEY, JSON.stringify(mpaCache));

    // 5. RENDERIZAÇÃO FINAL
    calculatePlayerStats();
    renderEquippedItems();
    
    // Renderiza a bolsa (sem cache, sempre fresca)
    const activeTab = document.querySelector('.tab-button.active')?.id.replace('tab-', '') || 'all';
    loadItems(activeTab, allInventoryItems);
    
    console.log('✅ Dados atualizados e renderizados.');
}

// =======================================================================
// CÁLCULO DE STATUS (CORRIGIDO)
// =======================================================================
function calculatePlayerStats() {
    let currentStats = { 
        min_attack: playerBaseStats.min_attack || 0,
        attack: playerBaseStats.attack || 0,
        defense: playerBaseStats.defense || 0,
        health: playerBaseStats.health || 0,
        crit_chance: playerBaseStats.crit_chance || 0,
        crit_damage: playerBaseStats.crit_damage || 0,
        evasion: playerBaseStats.evasion || 0,
        avatar_url: playerBaseStats.avatar_url
    };

    // Soma explicitamente: Base do Item + Bônus do Item
    equippedItems.forEach(invItem => {
        // 1. Status Base do Equipamento (da tabela 'items')
        if (invItem.items) {
            currentStats.min_attack += invItem.items.min_attack || 0;
            currentStats.attack += invItem.items.attack || 0;
            currentStats.defense += invItem.items.defense || 0;
            currentStats.health += invItem.items.health || 0;
            currentStats.crit_chance += invItem.items.crit_chance || 0;
            currentStats.crit_damage += invItem.items.crit_damage || 0;
            currentStats.evasion += invItem.items.evasion || 0;
        }

        // 2. Status Bônus do Equipamento (Evolução/Refino/Refundição)
        currentStats.min_attack += invItem.min_attack_bonus || 0;
        currentStats.attack += invItem.attack_bonus || 0;
        currentStats.defense += invItem.defense_bonus || 0;
        currentStats.health += invItem.health_bonus || 0;
        currentStats.crit_chance += invItem.crit_chance_bonus || 0;
        currentStats.crit_damage += invItem.crit_damage_bonus || 0;
        currentStats.evasion += invItem.evasion_bonus || 0;
    });

    // Atualiza DOM
    const avatarEl = document.getElementById('playerAvatarEquip');
    if (avatarEl && currentStats.avatar_url) avatarEl.src = currentStats.avatar_url;

    const setObj = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };

    setObj('playerAttack', `${Math.floor(currentStats.min_attack)} - ${Math.floor(currentStats.attack)}`);
    setObj('playerDefense', Math.floor(currentStats.defense));
    setObj('playerHealth', Math.floor(currentStats.health));
    setObj('playerCritChance', `${currentStats.crit_chance.toFixed(1).replace(/\.0$/, '')}%`); // Formatação limpa
    setObj('playerCritDamage', `${currentStats.crit_damage.toFixed(1).replace(/\.0$/, '')}%`);
    setObj('playerEvasion', `${currentStats.evasion.toFixed(1).replace(/\.0$/, '')}%`);

    // Remove Shimmer (efeito de carregamento)
    document.querySelectorAll('.shimmer').forEach(el => el.classList.remove('shimmer'));
}

// =======================================================================
// RENDERIZAÇÃO E UI
// =======================================================================
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
                
                let html = `<img src="${imgSrc}" alt="${item.display_name}">`;
        
                // Nível do item
                if (item.item_type !== 'fragmento' && item.item_type !== 'outros' && invItem.level && invItem.level >= 1) {
                    html += `<div class="item-level">Nv. ${invItem.level}</div>`;
                }

                slotDiv.innerHTML = html;
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

        // Animação para fragmentos "craftáveis"
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
            // Stats Base
            if ((item.items.attack || 0) > 0) { itemStats.innerHTML += `<p>ATK Base: ${item.items.attack}</p>`; }
            if ((item.items.defense || 0) > 0) { itemStats.innerHTML += `<p>DEF Base: ${item.items.defense}</p>`; }
            if ((item.items.health || 0) > 0) { itemStats.innerHTML += `<p>HP Base: ${item.items.health}</p>`; }
            if ((item.items.crit_chance || 0) > 0) { itemStats.innerHTML += `<p>CRIT Base: ${item.items.crit_chance}%</p>`; }
            if ((item.items.crit_damage || 0) > 0) { itemStats.innerHTML += `<p>DANO CRIT Base: +${item.items.crit_damage}%</p>`; }
            if ((item.items.evasion || 0) > 0) { itemStats.innerHTML += `<p>EVASÃO Base: +${item.items.evasion}%</p>`; }
            
            // Stats Bônus
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

// =======================================================================
// HANDLERS E FUNÇÕES AUXILIARES
// =======================================================================
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
        
        // Atualiza cache e UI forçadamente
        await loadPlayerAndItems(true); 
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

function getXpRequired(level, rarity) {
    const xpBase = { 'R': 20, 'SR': 40, 'SSR': 80 };
    const base = xpBase[rarity] || 40;
    return base + (level * 45);
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
            await loadPlayerAndItems(true); // Atualiza
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
            await loadPlayerAndItems(true); // Atualiza
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
            await loadPlayerAndItems(true); // Atualiza
            document.getElementById('craftingModal').style.display = 'none';
        } else {
            showCustomAlert('Não foi possível construir o item. Tente novamente.');
        }
    } catch (err) {
        console.error('Erro geral ao construir:', err);
        showCustomAlert('Ocorreu um erro ao tentar construir o item.');
    }
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

// Shimmer Effect inicial para UX rápida
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