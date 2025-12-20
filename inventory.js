// =======================================================================
// CONFIGURAÇÃO INICIAL E CLIENTE SUPABASE
// =======================================================================
const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';

// Garante que o objeto window.supabase existe antes de tentar criar o cliente
let supabase;
try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error("ERRO CRÍTICO: Supabase SDK não encontrado.", e);
    alert("Erro ao carregar sistema. Recarregue a página.");
}

// Variáveis Globais
let globalUser = null;
let equippedItems = [];
let playerBaseStats = {};
let allInventoryItems = [];
let selectedItem = null;

// =======================================================================
// CACHE LOCAL (INDEXEDDB) - Versão 31 (Forçando Limpeza)
// =======================================================================
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 31; 

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            // Limpa stores antigos se existirem
            if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
            if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
            // Cria novos
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
            db.createObjectStore(META_STORE, { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveCache(items, stats, timestamp) {
    try {
        const db = await openDB();
        const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const meta = tx.objectStore(META_STORE);

        store.clear();
        (items || []).forEach(item => store.put(item));
        
        meta.put({ key: "last_updated", value: timestamp });
        meta.put({ key: "player_stats", value: stats });
        meta.put({ key: "cache_time", value: Date.now() });

        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve(); 
        });
    } catch (e) { console.warn("Erro ao salvar cache:", e); }
}

async function loadCache() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        return new Promise((resolve) => {
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch(e) { return null; }
}

async function loadPlayerStatsFromCache() {
    try {
        const db = await openDB();
        const tx = db.transaction(META_STORE, "readonly");
        return new Promise((resolve) => {
            const req = tx.objectStore(META_STORE).get("player_stats");
            req.onsuccess = () => resolve(req.result ? req.result.value : null);
            req.onerror = () => resolve(null);
        });
    } catch(e) { return null; }
}

async function getLastUpdated() {
    try {
        const db = await openDB();
        const tx = db.transaction(META_STORE, "readonly");
        return new Promise((resolve) => {
            const req = tx.objectStore(META_STORE).get("last_updated");
            req.onsuccess = () => resolve(req.result ? req.result.value : null);
            req.onerror = () => resolve(null);
        });
    } catch(e) { return null; }
}

// =======================================================================
// RENDERIZAÇÃO DE EMERGÊNCIA (SKELETON UI)
// =======================================================================
// Esta função roda imediatamente para garantir que a página não fique branca
function renderSkeletonUI() {
    console.log("🎨 Desenhando UI Skeleton (Shimmer)...");
    
    // 1. Aplica classe shimmer nos status
    const statIds = ['playerAttack','playerDefense','playerHealth','playerCritChance','playerCritDamage','playerEvasion'];
    statIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = "...";
            el.classList.add('shimmer');
        }
    });

    // 2. Desenha slots de equipamento vazios
    const slots = ['weapon', 'ring', 'helm', 'special1', 'amulet', 'wing', 'armor', 'special2'];
    slots.forEach(slot => {
        const slotDiv = document.getElementById(`${slot}-slot`);
        if (slotDiv) {
            // Mantém a imagem de fundo do CSS, apenas limpa conteúdo extra
            slotDiv.innerHTML = ''; 
            slotDiv.classList.add('shimmer'); // Adiciona efeito de carregamento no slot
        }
    });

    // 3. Desenha grade de inventário vazia (placeholder)
    const bagGrid = document.getElementById('bagItemsGrid');
    if (bagGrid) {
        bagGrid.innerHTML = '';
        // Cria alguns quadrados vazios para simular carregamento
        for(let i=0; i<10; i++) {
            const div = document.createElement('div');
            div.className = 'inventory-item shimmer';
            div.style.opacity = '0.3';
            bagGrid.appendChild(div);
        }
    }
}

// Remove o efeito shimmer
function removeShimmer() {
    const shimmerEls = document.querySelectorAll('.shimmer');
    shimmerEls.forEach(el => el.classList.remove('shimmer'));
}

// =======================================================================
// LÓGICA DE AUTENTICAÇÃO COM TIMEOUT
// =======================================================================
async function ensureAuthenticated() {
    console.log("🔐 Verificando autenticação...");
    
    // Promessa com timeout de 4 segundos para não travar a tela
    const authPromise = new Promise(async (resolve) => {
        // 1. Sessão Atual
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            globalUser = session.user;
            resolve(true);
            return;
        }

        console.warn("⚠️ Sessão não encontrada. Tentando refresh...");

        // 2. Refresh Forçado
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError && refreshData.session) {
            console.log("✅ Sessão renovada.");
            globalUser = refreshData.session.user;
            resolve(true);
            return;
        }
        
        console.error("❌ Falha de Auth:", refreshError);
        resolve(false);
    });

    // Timeout de segurança
    const timeoutPromise = new Promise(resolve => setTimeout(() => {
        console.error("⏰ Timeout na verificação de Auth.");
        resolve(false);
    }, 4000));

    return Promise.race([authPromise, timeoutPromise]);
}

// =======================================================================
// INICIALIZAÇÃO PRINCIPAL
// =======================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. DESENHA A UI IMEDIATAMENTE (Não espera nada)
    renderSkeletonUI();

    // 2. Tenta Autenticar
    const isAuthenticated = await ensureAuthenticated();
    
    if (!isAuthenticated) {
        console.warn("🚫 Usuário não autenticado. Redirecionando...");
        // Pequeno delay para usuário ver que falhou antes de redirecionar
        showCustomAlert("Sessão expirada. Redirecionando...");
        setTimeout(() => {
             window.location.href = "index.html?error=session_expired";
        }, 1500);
        return;
    }

    // 3. Inicia carregamento de dados
    await loadPlayerAndItems();

    // 4. Configura Eventos da Página (Listeners)
    setupEventListeners();
});

// =======================================================================
// CARREGAMENTO DE DADOS (DATA FETCHING)
// =======================================================================
async function loadPlayerAndItems(forceRefresh = false) {
    if (!globalUser) return;

    try {
        // Tenta cache local primeiro (se não for forçado)
        if (!forceRefresh) {
            const localTimestamp = await getLastUpdated();
            // Verifica metadata no servidor (leve)
            const { data: serverMeta } = await supabase
                .from('players')
                .select('last_inventory_update')
                .eq('id', globalUser.id)
                .single();

            if (serverMeta && localTimestamp === serverMeta.last_inventory_update) {
                const [itemsFromCache, statsFromCache] = await Promise.all([
                    loadCache(),
                    loadPlayerStatsFromCache()
                ]);

                if (itemsFromCache && statsFromCache) {
                    console.log('⚡ Cache Local Carregado.');
                    allInventoryItems = itemsFromCache;
                    playerBaseStats = statsFromCache;
                    processAndRenderData();
                    return;
                }
            }
        }

        // Se não tem cache ou é refresh, busca do servidor
        console.log('⬇️ Buscando dados do servidor (RPC)...');
        const { data, error } = await supabase.rpc('get_player_data_lazy', { p_player_id: globalUser.id });

        if (error) {
            console.error("Erro na RPC:", error);
            // Se erro for de token (JWT), tenta refresh e rechama (recursão única)
            if (error.code === 'PGRST301' || error.message.includes("JWT")) {
                await supabase.auth.refreshSession();
                const retry = await supabase.rpc('get_player_data_lazy', { p_player_id: globalUser.id });
                if (retry.data) {
                    handleServerData(retry.data);
                    return;
                }
            }
            showCustomAlert("Erro de conexão. Tente atualizar.");
            removeShimmer(); // Remove shimmer para não ficar "loading" eterno
            return;
        }

        if (data) {
            handleServerData(data);
        } else {
             // Caso venha vazio (raro), limpa UI
             removeShimmer();
             allInventoryItems = [];
             renderUI();
        }

    } catch (err) {
        console.error("Erro fatal no carregamento:", err);
        removeShimmer();
    }
}

async function handleServerData(data) {
    playerBaseStats = data.cached_combat_stats || {};
    allInventoryItems = data.cached_inventory || [];
    
    // Atualiza Cache
    await saveCache(allInventoryItems, playerBaseStats, data.last_inventory_update);
    
    processAndRenderData();
}

function processAndRenderData() {
    equippedItems = allInventoryItems.filter(item => item.equipped_slot !== null);
    removeShimmer(); // Tira o efeito de carregamento
    renderUI();
}

// =======================================================================
// RENDERIZAÇÃO DA UI (DISPLAY)
// =======================================================================
function renderUI() {
    updateStatsUI(playerBaseStats);
    renderEquippedItems();
    
    // Identifica aba ativa
    const activeBtn = document.querySelector('.tab-button.active');
    const tab = activeBtn ? activeBtn.id.replace('tab-', '') : 'all';
    
    loadItems(tab, allInventoryItems);
}

function updateStatsUI(stats) {
    if (!stats) return;
    
    const set = (id, val) => { 
        const el = document.getElementById(id); 
        if(el) {
            el.textContent = val;
            el.classList.remove('shimmer'); // Garante remoção
        }
    };

    set('playerAttack', `${Math.floor(stats.min_attack || 0)} - ${Math.floor(stats.attack || 0)}`);
    set('playerDefense', `${Math.floor(stats.defense || 0)}`);
    set('playerHealth', `${Math.floor(stats.health || 0)}`);
    set('playerCritChance', `${Math.floor(stats.crit_chance || 0)}%`);
    set('playerCritDamage', `${Math.floor(stats.crit_damage || 0)}%`);
    set('playerEvasion', `${Math.floor(stats.evasion || 0)}%`);

    const avatarEl = document.getElementById('playerAvatarEquip');
    if (avatarEl && stats.avatar_url) avatarEl.src = stats.avatar_url;
}

function renderEquippedItems() {
    const slots = ['weapon', 'ring', 'helm', 'special1', 'amulet', 'wing', 'armor', 'special2'];
    
    // Limpa slots primeiro
    slots.forEach(slot => {
        const slotDiv = document.getElementById(`${slot}-slot`);
        if (slotDiv) {
            slotDiv.innerHTML = '';
            slotDiv.classList.remove('shimmer');
        }
    });

    // Preenche slots
    equippedItems.forEach(invItem => {
        const item = invItem.items;
        if (item && invItem.equipped_slot) {
            const slotDiv = document.getElementById(`${invItem.equipped_slot}-slot`);
            if (slotDiv) {
                const totalStars = (invItem.items?.stars || 0) + (invItem.refine_level || 0);
                const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.name}_${totalStars}estrelas.webp`;
                
                slotDiv.innerHTML = `<img src="${imgSrc}" alt="${item.display_name}">`;
        
                if (item.item_type !== 'fragmento' && item.item_type !== 'outros' && invItem.level >= 1) {
                    const levelElement = document.createElement('div');
                    levelElement.className = 'item-level';
                    levelElement.textContent = `Nv. ${invItem.level}`;
                    slotDiv.appendChild(levelElement);
                }

                slotDiv.onclick = () => showItemDetails(invItem);
            }
        }
    });
}

function loadItems(tab = 'all', itemsList = null) {
    const items = itemsList || allInventoryItems || [];
    const bagItemsGrid = document.getElementById('bagItemsGrid');
    if (!bagItemsGrid) return;

    bagItemsGrid.innerHTML = ''; // Limpa shimmer ou items antigos

    const filteredItems = items.filter(item => {
        if (item.equipped_slot !== null || item.quantity <= 0) return false;
        if (tab === 'all') return true;
        if (tab === 'equipment' && !['fragmento','outros'].includes(item.items.item_type)) return true;
        if (tab === 'fragments' && item.items.item_type === 'fragmento') return true;
        if (tab === 'others' && item.items.item_type === 'outros') return true;
        return false;
    });

    if (filteredItems.length === 0) {
        bagItemsGrid.innerHTML = '<p class="empty-inventory-message">Vazio.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();

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

        let html = `<img src="${imgSrc}" loading="lazy" alt="${item.items.name}">`;
        
        if ((item.items.item_type === 'fragmento' || item.items.item_type === 'outros') && item.quantity > 1) {
            html += `<span class="item-quantity">${item.quantity}</span>`;
        } else if (item.level >= 1) {
            html += `<div class="item-level">Lv. ${item.level}</div>`;
        }

        itemDiv.innerHTML = html;
        itemDiv.dataset.inventoryItemId = item.id;
        
        itemDiv.onclick = () => {
            if (item.items.item_type === 'fragmento' && item.items.crafts_item_id) {
                showCraftingModal(item);
            } else {
                showItemDetails(item);
            }
        };

        fragment.appendChild(itemDiv);
    });

    bagItemsGrid.appendChild(fragment);
}

// =======================================================================
// EVENTOS E MODAIS
// =======================================================================
function setupEventListeners() {
    // Botão de Refresh
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            refreshBtn.style.opacity = '0.5';
            renderSkeletonUI(); // Mostra loading visual
            await loadPlayerAndItems(true); 
            refreshBtn.style.opacity = '1';
        });
    }

    // Abas
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.tab-button.active')?.classList.remove('active');
            button.classList.add('active');
            loadItems(button.id.replace('tab-', ''));
        });
    });

    // Modais
    document.getElementById('closeDetailsModal')?.addEventListener('click', () => {
        document.getElementById('itemDetailsModal').style.display = 'none';
    });

    document.getElementById('closeCraftingModal')?.addEventListener('click', () => {
        document.getElementById('craftingModal').style.display = 'none';
    });

    document.getElementById('levelUpBtn')?.addEventListener('click', () => {
        if (!selectedItem) return showCustomAlert('Nenhum item selecionado.');
        document.getElementById('fragmentSelectModal').style.display = 'flex';
        renderFragmentList(selectedItem);
    });

    document.getElementById('refineBtn')?.addEventListener('click', () => {
        if (selectedItem) openRefineFragmentModal(selectedItem);
        else showCustomAlert('Nenhum item selecionado.');
    });

    document.getElementById('craftBtn')?.addEventListener('click', () => {
        if (selectedItem?.items?.crafts_item_id) {
            handleCraft(selectedItem.items.crafts_item_id, selectedItem.id);
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

    document.getElementById('confirmFragmentSelection')?.addEventListener('click', handleFragmentConfirm);
    
    document.getElementById('customAlertOkBtn')?.addEventListener('click', () => {
        document.getElementById('customAlertModal').style.display = 'none';
    });
}

// =======================================================================
// LÓGICA DE DETALHES E AÇÕES (GAMEPLAY)
// =======================================================================
function showItemDetails(item) {
    selectedItem = item;
    const itemDetails = document.getElementById('itemDetailsModal');
    if (!itemDetails) return;

    // Seta imagem e textos
    let imgSrc;
    if (item.items.item_type === 'fragmento') {
        imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}.webp`;
    } else {
        const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);
        imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}_${totalStars}estrelas.webp`;
    }
    
    const els = {
        img: document.getElementById('detailItemImage'),
        desc: document.getElementById('itemDescription'),
        rarity: document.getElementById('detailItemRarity'),
        name: document.getElementById('detailItemName')
    };

    if(els.img) els.img.src = imgSrc;
    if(els.desc) els.desc.textContent = item.items.description || '...';
    if(els.rarity) els.rarity.textContent = item.items.rarity;
    if(els.name) els.name.textContent = item.items.display_name;
  
    const isEquipment = !['consumivel', 'fragmento', 'outros'].includes(item.items.item_type);
    
    renderItemStatsInModal(item, isEquipment);
    itemDetails.style.display = 'flex';
}

function renderItemStatsInModal(item, isEquipment) {
    const ui = {
        stats: document.getElementById('itemStats'),
        refine: document.getElementById('itemRefineSection'),
        actions: document.getElementById('itemActions'),
        progress: document.querySelector('.progress-bar-container'),
        lvlBtn: document.getElementById('levelUpBtn'),
        lvlTxt: document.getElementById('detailItemLevel'),
        xpBar: document.getElementById('levelXpBar'),
        xpTxt: document.getElementById('levelXpText')
    };

    if (isEquipment) {
        // XP e Nível
        const level = item.level || 0;
        const maxLevelForStar = (item.items.stars + (item.refine_level || 0) + 1) * 5;
        const xpRequired = getXpRequired(level, item.items.rarity);
        const xpProgress = item.xp_progress || 0;
        const xpPercentage = xpRequired > 0 ? (xpProgress / xpRequired) * 100 : 0;
        
        if(ui.lvlTxt) ui.lvlTxt.textContent = `Nv. ${level} / ${Math.min(maxLevelForStar, 30)}`;
        if(ui.xpBar) ui.xpBar.style.width = `${Math.min(xpPercentage, 100)}%`;
        if(ui.xpTxt) ui.xpTxt.textContent = `${xpProgress} / ${xpRequired}`;
        if(ui.progress) ui.progress.style.display = 'block';
        if(ui.lvlBtn) ui.lvlBtn.style.display = (level >= Math.min(maxLevelForStar, 30)) ? 'none' : 'block';

        // Stats
        if (ui.stats) {
            ui.stats.style.display = 'block';
            let html = '';
            const i = item.items;
            if (i.attack) html += `<p>ATK Base: ${i.attack}</p>`;
            if (i.defense) html += `<p>DEF Base: ${i.defense}</p>`;
            if (i.health) html += `<p>HP Base: ${i.health}</p>`;
            if (i.crit_chance) html += `<p>CRIT Base: ${i.crit_chance}%</p>`;
            if (i.crit_damage) html += `<p>DANO CRIT Base: +${i.crit_damage}%</p>`;
            if (i.evasion) html += `<p>EVASÃO Base: +${i.evasion}%</p>`;
            
            // Bonus
            const map = {attack_bonus:'ATK', defense_bonus:'DEF', health_bonus:'HP', crit_chance_bonus:'TAXA CRIT', crit_damage_bonus:'DANO CRIT', evasion_bonus:'EVASÃO'};
            for (const [key, label] of Object.entries(map)) {
                if(item[key]) html += `<p class="bonus-stat">Bônus ${label}: +${item[key]}${label.includes('CRIT')||label.includes('EVAS')?'%':''}</p>`;
            }
            ui.stats.innerHTML = html;
        }

        if (ui.refine) ui.refine.style.display = 'block';
        if (ui.actions) ui.actions.style.display = 'flex';
        
        setupRefineRows(item);

    } else {
        if(ui.progress) ui.progress.style.display = 'none';
        if(ui.lvlBtn) ui.lvlBtn.style.display = 'none';
        if(ui.stats) ui.stats.style.display = 'none';
        if(ui.refine) ui.refine.style.display = 'none';
        if(ui.actions) ui.actions.style.display = 'none';
    }

    // Botão Equipar
    const equipBtn = document.getElementById('equipBtnModal');
    const isEquipable = ['arma', 'Arma', 'Escudo', 'Anel', 'anel', 'Elmo', 'elmo', 'Asa', 'asa', 'Armadura', 'armadura', 'Colar', 'colar'].includes(item.items.item_type);
    
    if (isEquipable && equipBtn) {
        const isEquipped = item.equipped_slot !== null;
        equipBtn.textContent = isEquipped ? 'Retirar' : 'Equipar';
        equipBtn.style.display = 'block';
        equipBtn.onclick = () => handleEquipUnequip(item, isEquipped);
    } else if (equipBtn) {
        equipBtn.style.display = 'none';
    }
}

function setupRefineRows(item) {
    const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);
    const r1 = document.getElementById('refineRow1');
    const r2 = document.getElementById('refineRow2');

    const renderRow = (el, slot, unlockStar) => {
        if (!el) return;
        if (slot) {
            let val = slot.value;
            if (['TAXA CRIT','DANO CRIT','EVASÃO'].includes(formatAttrName(slot.attr))) val += '%';
            el.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/refund.webp" style="width: 38px;"><p style="font-size: 1.1em;">${formatAttrName(slot.attr)} +${val}</p>`;
            el.style.background = slot.color;
            el.style.color = "black";
        } else if (totalStars >= unlockStar) {
            el.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/refund.webp" style="width: 38px;"><p>Liberado</p>`;
            el.style.background = '';
            el.style.color = '';
        } else {
            el.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/locked.webp" style="width: 38px;"><p style="font-size:0.7em">Refine p/ liberar</p>`;
            el.style.background = '';
            el.style.color = '';
        }
    };
    renderRow(r1, item.reforge_slot1, 4);
    renderRow(r2, item.reforge_slot2, 5);
}

// =======================================================================
// AÇÕES DO USUÁRIO (HANDLERS)
// =======================================================================

async function handleEquipUnequip(item, isEquipped) {
    try {
        const { data, error } = await supabase.rpc('toggle_equip', {
            p_inventory_item_id: item.id,
            p_player_id: globalUser.id,
            p_equip_status: !isEquipped
        });

        if (error) throw error;
        if (data && data.error) throw new Error(data.error);

        showCustomAlert(isEquipped ? 'Desequipado.' : 'Equipado.');
        document.getElementById('itemDetailsModal').style.display = 'none';
        await loadPlayerAndItems(true); 
    } catch (err) {
        showCustomAlert('Erro: ' + err.message);
    }
}

function handleFragmentConfirm() {
    const item = selectedItem;
    const selections = [];
    let totalSelecionado = 0;

    document.querySelectorAll('#fragmentList li.selected').forEach(li => {
        const qty = parseInt(li.querySelector('.fragment-quantity-input').value, 10) || 0;
        if (qty > 0) {
            selections.push({
                fragment_id: li.dataset.inventoryItemId,
                qty,
                rarity: li.dataset.rarity
            });
            totalSelecionado += qty;
        }
    });

    if (selections.length === 0) return showCustomAlert('Selecione ao menos um fragmento.');

    // Opcional: Validação de Cap
    const capLevel = Math.min(((item.items?.stars || 0) + (item.refine_level || 0) + 1) * 5, 30);
    if ((item.level || 0) >= capLevel) return showCustomAlert('Nível máximo atingido.');

    handleLevelUpMulti(item, selections);
}

async function handleLevelUpMulti(item, selections) {
    document.getElementById('fragmentSelectModal').style.display = 'none';
    const { data, error } = await supabase.rpc('level_up_item', {
        p_inventory_item_id: item.id, p_fragments: selections
    });
    if (error || data?.error) {
        showCustomAlert(error?.message || data?.error);
    } else {
        showCustomAlert(`Level Up! Nível ${data.new_level}.`);
        document.getElementById('itemDetailsModal').style.display = 'none';
        await loadPlayerAndItems(true);
    }
}

async function handleCraft(itemId, fragmentId) {
    const { data, error } = await supabase.rpc('craft_item', {
        p_item_id: itemId, p_fragment_id: fragmentId
    });
    if (error || data?.error) {
        showCustomAlert(error?.message || data?.error);
    } else {
        showCustomAlert(`Item construído!`);
        document.getElementById('craftingModal').style.display = 'none';
        await loadPlayerAndItems(true);
    }
}

async function handleRefineMulti(item, selections) {
    document.getElementById('refineFragmentModal').style.display = 'none';
    const { data, error } = await supabase.rpc('refine_item', {
        _inventory_item_id: item.id, _fragments: selections
    });
    if (error || data?.error) {
        showCustomAlert(error?.message || data?.error);
    } else {
        showCustomAlert(`Refinado com sucesso!`);
        document.getElementById('itemDetailsModal').style.display = 'none';
        await loadPlayerAndItems(true);
    }
}

// =======================================================================
// HELPERS E UTILITÁRIOS
// =======================================================================
function showCustomAlert(message) {
    const modal = document.getElementById('customAlertModal');
    if(modal) {
        document.getElementById('customAlertMessage').textContent = message;
        modal.style.display = 'flex';
    } else {
        alert(message);
    }
}

function getXpRequired(level, rarity) {
    const base = { 'R': 20, 'SR': 40, 'SSR': 80 }[rarity] || 40;
    return base + (level * 45);
}

function formatAttrName(attr) {
    const map = { "attack_bonus":"ATK", "defense_bonus":"DEF", "health_bonus":"HP", "crit_chance_bonus":"TAXA CRIT", "crit_damage_bonus":"DANO CRIT", "evasion_bonus":"EVASÃO" };
    return map[attr] || attr;
}

// Funções de Modal (Renderização)
function renderFragmentList(itemToLevelUp) {
    const list = document.getElementById('fragmentList');
    list.innerHTML = '';
    const fragments = allInventoryItems.filter(i => i.items.item_type === 'fragmento' && i.quantity > 0);
    
    if(!fragments.length) {
        list.innerHTML = '<p>Sem fragmentos.</p>';
        document.getElementById('confirmFragmentSelection').disabled = true;
        return;
    }
    document.getElementById('confirmFragmentSelection').disabled = false;

    fragments.forEach(frag => {
        const li = document.createElement('li');
        li.className = 'inventory-item';
        li.dataset.inventoryItemId = frag.id;
        li.dataset.rarity = frag.items.rarity;
        li.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;">
                <img src="https://aden-rpg.pages.dev/assets/itens/${frag.items.name}.webp" style="width:40px;">
                <span>${frag.items.display_name} (x${frag.quantity})</span>
            </div>
            <input type="number" class="fragment-quantity-input" placeholder="0" max="${frag.quantity}" style="width:50px;">
        `;
        li.addEventListener('click', e => {
            if(e.target.tagName !== 'INPUT') li.classList.toggle('selected');
        });
        list.appendChild(li);
    });
}

async function showCraftingModal(fragment) {
    selectedItem = fragment;
    const modal = document.getElementById('craftingModal');
    const { data: target } = await supabase.from('items').select('*').eq('item_id', fragment.items.crafts_item_id).single();
    if(!target) return showCustomAlert('Erro ao carregar item alvo.');

    document.getElementById('craftingFragmentImage').src = `https://aden-rpg.pages.dev/assets/itens/${fragment.items.name}.webp`;
    document.getElementById('craftingTargetImage').src = `https://aden-rpg.pages.dev/assets/itens/${target.name}_${target.stars}estrelas.webp`;
    document.getElementById('craftingFragmentQuantity').textContent = fragment.quantity;
    
    modal.style.display = 'flex';
}

function openRefineFragmentModal(item) {
    const modal = document.getElementById('refineFragmentModal');
    const list = document.getElementById('refineFragmentList');
    const btn = document.getElementById('confirmRefineSelectionRefine');
    
    const capLevel = ((item.items?.stars||0) + (item.refine_level||0) + 1) * 5;
    if((item.level||0) < Math.min(capLevel, 30)) return showCustomAlert(`Precisa Nível ${Math.min(capLevel, 30)}`);
    
    const frags = allInventoryItems.filter(i => i.items.item_type === 'fragmento' && i.items.rarity === item.items.rarity && i.quantity > 0);
    list.innerHTML = '';
    
    if(!frags.length) {
        list.innerHTML = '<p>Sem fragmentos da mesma raridade.</p>';
        btn.disabled = true;
    } else {
        btn.disabled = false;
        frags.forEach(f => {
            const li = document.createElement('li');
            li.className = 'inventory-item';
            li.setAttribute('data-inventory-item-id', f.id);
            li.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/itens/${f.items.name}.webp" style="width:30px;">
                <span>${f.items.display_name} (x${f.quantity})</span>
                <input type="number" class="fragment-quantity-input" style="width:50px">
            `;
            li.onclick = (e) => { if(e.target.tagName!=='INPUT') li.classList.toggle('selected'); };
            list.appendChild(li);
        });
        
        btn.onclick = () => {
             const sels = [];
             list.querySelectorAll('li.selected').forEach(li => {
                 const qty = parseInt(li.querySelector('input').value||0);
                 if(qty>0) sels.push({fragment_id: li.getAttribute('data-inventory-item-id'), qty});
             });
             handleRefineMulti(item, sels);
        };
    }
    modal.style.display = 'flex';
}

function getCapLevelForCurrentStar(item) {
    return Math.min(((item.items?.stars || 0) + (item.refine_level || 0) + 1) * 5, 30);
}

// Helper para calcular requisitos (mantendo a lógica original)
function getRefineFragmentsRequired(capLevel, rarity) {
    const table = { 5: 40, 10: 60, 15: 90, 20: 120, 25: 160 };
    return table[capLevel] || 0;
}
function getRefineCrystalsRequired(capLevel, rarity) {
    // ... Lógica simplificada ou copiada da original se necessária, 
    // mas a validação principal é feita no backend pela RPC.
    return 0; 
}