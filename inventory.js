
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
const DB_VERSION = 48; 

let _dbPromise = null;

function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout:' + label)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            console.log('IndexedDB: Upgrade necessário. Limpando caches antigos.');
            const db = e.target.result;
            if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
            if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
            db.createObjectStore(META_STORE, { keyPath: "key" });
        };
        // Outra aba/página com versão antiga aberta bloqueava o upgrade para sempre
        req.onblocked = () => console.warn('IndexedDB: abertura bloqueada por outra aba/página.');
        req.onsuccess = () => {
            const db = req.result;
            // Libera a conexão se outra página pedir upgrade (evita travar as demais)
            db.onversionchange = () => { db.close(); _dbPromise = null; };
            db.onclose = () => { _dbPromise = null; };
            resolve(db);
        };
        req.onerror = () => { _dbPromise = null; reject(req.error); };
    });
    return withTimeout(_dbPromise, 4000, 'openDB').catch(err => { _dbPromise = null; throw err; });
}

// Salva o cache completo
async function saveCache(items, stats, timestamp) {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const meta = tx.objectStore(META_STORE);

    store.clear();
    
    // Salva TUDO (inclusive itens com qtd 0 para o manifesto funcionar).
    // `items` (definição) continua sendo gravado como CONVENIÊNCIA para outras páginas
    // (pv.js, afk_page.js, tavernas.js leem direto do IndexedDB). Mas o inventory.js NUNCA confia
    // nele ao carregar (ver _stripDef + rehydrate), e placeholders ("unknown") jamais são gravados.
    (items || []).forEach(item => {
        const { _placeholder, ...rest } = item;
        if (_placeholder) delete rest.items;
        store.put(rest);
    });
    
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
        // Item sem item_id (cache parcial vindo do script.js) => assinatura inválida, força reenvio completo
        s: item.item_id == null
            ? 'stale'
            : `${item.quantity}_${item.level || 0}_${item.refine_level || 0}_${item.equipped_slot || 'none'}_${item.expires_at ? Math.floor(new Date(item.expires_at).getTime() / 1000) : 'x'}`
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
                // O servidor envia o item COMPLETO, mas com jsonb_strip_nulls (campos 0/NULL somem).
                // Fazer merge {...velho, ...novo} mantinha valores antigos (ex.: expires_at, xp_progress,
                // reforge_slot, bônus que voltaram a 0). Por isso SUBSTITUI, preservando só campos locais.
                const old = updatedList[idx];
                const replaced = { ...newItem };
                if (old.pending_reforge) replaced.pending_reforge = old.pending_reforge;
                updatedList[idx] = replaced;
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

const DEFS_CACHE_KEY = 'item_definitions_inventory_v2';   // chave PRÓPRIA (script.js usa outra, com formato/colunas diferentes)
const DEFS_TTL_MS = 24 * 60 * 60 * 1000;

// Uma definição só é válida para a bolsa se trouxer as colunas de skin (mesmo que null)
function _defsAreComplete(map) {
    if (!map || map.size === 0) return false;
    const sample = map.values().next().value;
    return !!sample && ('skin_frame_url' in sample) && ('skin_video_url' in sample) && ('skin_duration_hours' in sample);
}

async function ensureDefinitionsLoaded() {
    // 1. RAM (só vale se estiver completa; o script.js grava definições SEM colunas de skin)
    if (_defsAreComplete(window.itemDefinitions)) return true;

    // 2. LocalStorage (formato versionado {expires, data})
    try {
        const raw = localStorage.getItem(DEFS_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.data) && parsed.expires > Date.now()) {
                const m = new Map(parsed.data);
                if (_defsAreComplete(m)) {
                    window.itemDefinitions = m;
                    console.log("📚 [Inventory] Definições recuperadas do LocalStorage.");
                    return true;
                }
            }
            localStorage.removeItem(DEFS_CACHE_KEY);
        }
    } catch (e) {
        console.warn("Cache de definições inválido ou corrompido.", e);
        try { localStorage.removeItem(DEFS_CACHE_KEY); } catch (_) {}
    }

    // 3. Rede (até 2 tentativas, com timeout)
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const { data, error } = await withTimeout(
                supabase.from('items').select(`
                    item_id, name, display_name, rarity, item_type, stars,
                    crafts_item_id, skin_frame_url, skin_video_url, skin_duration_hours
                `),
                8000, 'items'
            );
            if (error || !data) throw error || new Error('sem dados');

            const map = new Map();
            data.forEach(item => {
                if (!item.display_name) item.display_name = item.name;
                map.set(item.item_id, item);
            });
            window.itemDefinitions = map;
            try {
                localStorage.setItem(DEFS_CACHE_KEY, JSON.stringify({ expires: Date.now() + DEFS_TTL_MS, data: [...map.entries()] }));
            } catch (e) { console.warn("Quota de storage excedida ao salvar definições."); }
            console.log(`✅ [Inventory] ${data.length} definições baixadas.`);
            return true;
        } catch (e) {
            console.warn(`❌ Falha ao baixar definições (tentativa ${attempt}):`, e);
        }
    }
    return false;
}

// Função robusta de hidratação (cruza dados crus com definições)
function hydrateItem(rawItem) {
    if (!rawItem) return null;
    if (rawItem.equipped_slot === undefined) rawItem.equipped_slot = null;

    // Já hidratado e NÃO é placeholder: mantém (definição fresca desta sessão)
    if (rawItem.items && rawItem.items.name && !rawItem._placeholder && rawItem.items.name !== 'unknown') {
        return rawItem;
    }

    const itemId = rawItem.item_id;
    let def = null;
    if (window.itemDefinitions && itemId != null) {
        def = window.itemDefinitions.get(itemId)
           || window.itemDefinitions.get(String(itemId))
           || window.itemDefinitions.get(Number(itemId));
    }

    if (def) {
        const { _placeholder, ...clean } = rawItem;
        return { ...clean, items: def };
    }

    // Sem definição: placeholder MARCADO (será re-hidratado quando as definições chegarem)
    return {
        ...rawItem,
        _placeholder: true,
        items: {
            item_id: rawItem.item_id,
            name: "unknown",
            display_name: "Carregando...",
            rarity: "R",
            item_type: "outros",
            stars: 1,
            description: "Carregando...",
            min_attack: 0, attack: 0, defense: 0, health: 0
        }
    };
}

// Re-hidrata tudo (usado quando as definições chegam depois da primeira renderização)
function rehydrateAll() {
    allInventoryItems = allInventoryItems.map(i => {
        const { items: _old, ...raw } = i;           // descarta o snapshot antigo
        return hydrateItem(raw);
    });
    equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
}

// ============================================================
// BOOT — ordem importa:
//   1) liga TODOS os eventos de UI (X dos modais, abas, botões)   → nunca depende de rede/IDB
//   2) inicia skins (vídeo/moldura) a partir do cache local       → idem
//   3) só então sessão + definições + inventário (com timeouts)
// Antes, 1 e 2 ficavam DEPOIS de `await loadPlayerAndItems()`. Se o IndexedDB ou o
// Supabase (lock de auth entre páginas) travasse, o handler nunca chegava neles:
// vídeo invisível (opacity:0), modal sem fechar, botões mortos. Recarregar "curava".
// ============================================================

const MODAL_CLOSERS = {
    closeDetailsModal:       'itemDetailsModal',
    closeCraftingModal:      'craftingModal',
    closeFragmentModal:      'fragmentSelectModal',
    closeRefineFragmentModal:'refineFragmentModal',
    customAlertOkBtn:        'customAlertModal'
};

function bindStaticUI() {
    if (window.__inventoryUIBound) return;
    window.__inventoryUIBound = true;

    // Delegação: continua funcionando mesmo se outro script clonar/substituir o botão (refundir.js faz isso com o OK)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest ? e.target.closest(Object.keys(MODAL_CLOSERS).map(id => '#' + id).join(',')) : null;
        if (!btn) return;
        const modal = document.getElementById(MODAL_CLOSERS[btn.id]);
        if (modal) modal.style.display = 'none';
    });

    // Rede de segurança: ESC fecha o modal aberto mais "alto"
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        for (const id of ['customAlertModal', 'refineFragmentModal', 'fragmentSelectModal', 'craftingModal', 'itemDetailsModal', 'skinManagerModal']) {
            const m = document.getElementById(id);
            if (m && m.style.display && m.style.display !== 'none') { m.style.display = 'none'; break; }
        }
    });

    document.getElementById('refreshBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('Botão de refresh clicado. Forçando a recarga.');
        await ensureDefinitionsLoaded();
        rehydrateAll();
        await loadPlayerAndItems(true);
    });

    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.tab-button.active')?.classList.remove('active');
            button.classList.add('active');
            loadItems(button.id.replace('tab-', ''));
        });
    });

    document.getElementById('levelUpBtn')?.addEventListener('click', () => {
        if (!selectedItem) { showCustomAlert('Nenhum item selecionado para evoluir.'); return; }
        document.getElementById('fragmentSelectModal').style.display = 'flex';
        renderFragmentList(selectedItem);
    });

    document.getElementById('refineBtn')?.addEventListener('click', () => {
        if (selectedItem) openRefineFragmentModal(selectedItem);
        else showCustomAlert('Nenhum item selecionado para refinar.');
    });

    document.getElementById('craftBtn')?.addEventListener('click', () => {
        if (selectedItem && selectedItem.items && selectedItem.items.crafts_item_id) {
            handleCraft(selectedItem.items.crafts_item_id, selectedItem.id);
        } else {
            showCustomAlert('Informações de construção incompletas.');
        }
    });

    document.getElementById('confirmFragmentSelection')?.addEventListener('click', () => {
        const item = selectedItem;
        const selections = [];
        let totalSelecionado = 0;

        document.querySelectorAll('#fragmentList li.selected').forEach(li => {
            const quantityInput = li.querySelector('.fragment-quantity-input');
            const qty = parseInt(quantityInput.value, 10) || 0;
            if (qty > 0) {
                selections.push({ fragment_id: li.dataset.inventoryItemId, qty, rarity: li.dataset.rarity });
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
}

// Garante sessão sem nunca travar o boot. Retorna false se precisou redirecionar.
async function resolveSession() {
    const localId = getLocalUserId();
    if (localId) {
        console.log("⚡ Auth Otimista: ID recuperado localmente.");
        globalUser = { id: localId };
    }

    try {
        const { data: { session }, error: sessionError } = await withTimeout(supabase.auth.getSession(), 6000, 'getSession');
        if (sessionError) throw sessionError;

        if (session && session.user) {
            globalUser = session.user;
            console.log("✅ Sessão Supabase validada/renovada.");
        } else if (!globalUser) {
            console.warn("Nenhuma sessão ativa. Redirecionando para login.");
            window.location.href = "index.html?refresh=true";
            return false;
        } else {
            const { data: refreshData } = await withTimeout(supabase.auth.refreshSession(), 6000, 'refreshSession');
            if (refreshData?.session?.user) {
                globalUser = refreshData.session.user;
                console.log("♻️ Sessão renovada via refreshSession.");
            } else {
                console.warn("Sessão inválida após refresh. Redirecionando.");
                window.location.href = "index.html?refresh=true";
                return false;
            }
        }
    } catch (e) {
        if (!globalUser) {
            console.error("Erro ao validar sessão:", e);
            window.location.href = "index.html?refresh=true";
            return false;
        }
        console.warn("⚠️ Falha/timeout ao validar sessão, usando ID em cache:", e);
    }
    return true;
}

async function bootstrapData() {
    if (!(await resolveSession())) return;

    const defsOk = await ensureDefinitionsLoaded();
    await loadPlayerAndItems();

    // Definições falharam (rede ruim)? Tenta de novo em segundo plano e re-hidrata sem recarregar a página
    if (!defsOk) {
        const retry = async () => {
            if (await ensureDefinitionsLoaded()) {
                rehydrateAll();
                renderUI();
                window.skinSystem?.reconcileWithServer?.(...(window.__lastActiveSkinIds || [undefined, undefined]));
                return true;
            }
            return false;
        };
        setTimeout(async () => { if (!(await retry())) setTimeout(retry, 15000); }, 4000);
    }
}

function startInventoryPage() {
    console.log('DOM carregado. Iniciando script inventory.js...');

    // 1) UI imediata
    try { bindStaticUI(); } catch (e) { console.error('Erro ao ligar UI:', e); }

    // 2) Skins imediatas (usa só localStorage). O fade-in do vídeo vem daqui.
    try { window.skinSystem?.init(); } catch (e) { console.error('Erro no skinSystem.init:', e); }

    // Rede de segurança: se por qualquer motivo o vídeo continuar invisível, mostra o que estiver carregado
    setTimeout(() => {
        const v = document.getElementById('background-video');
        if (v && parseFloat(getComputedStyle(v).opacity) === 0) {
            v.style.transition = 'opacity 1.5s ease-in';
            v.style.opacity = '0.98';
            v.play?.().catch(() => {});
        }
    }, 5000);

    // 3) Dados (nunca bloqueia os passos acima)
    bootstrapData().catch(err => console.error('Erro no carregamento do inventário:', err));
}

if (document.readyState === 'complete') startInventoryPage();
else document.addEventListener('DOMContentLoaded', startInventoryPage, { once: true });

function showCustomAlert(message, shareCtx) {
    const modal = document.getElementById('customAlertModal');
    document.getElementById('customAlertMessage').textContent = message;

    // Injeta o botão Compartilhar se ainda não existir no DOM
    let shareBtn = document.getElementById('customAlertShareBtn');
    if (!shareBtn) {
        const okBtn = document.getElementById('customAlertOkBtn');
        if (okBtn) {
            // Envolve o OK em um flex wrapper
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:4px;';
            okBtn.parentNode.insertBefore(wrapper, okBtn);
            wrapper.appendChild(okBtn);
            // Cria o botão Compartilhar
            shareBtn = document.createElement('button');
            shareBtn.id = 'customAlertShareBtn';
            shareBtn.className = okBtn.className;
            shareBtn.style.cssText = 'display:none;background-image:none;background-color:#7a5c1e;border:1px solid #c9a94a;color:#e8d08a;';
            shareBtn.textContent = '✦ Compartilhar';
            wrapper.appendChild(shareBtn);
        }
    }

    if (shareBtn) {
        if (shareCtx) {
            // Clona para remover listeners anteriores
            const fresh = shareBtn.cloneNode(true);
            shareBtn.parentNode.replaceChild(fresh, shareBtn);
            fresh.style.display = 'inline-block';
            fresh.addEventListener('click', () => {
                modal.style.display = 'none';
                if (typeof showItemActionSuccess === 'function') {
                    showItemActionSuccess(shareCtx.action, shareCtx);
                }
            });
        } else {
            shareBtn.style.display = 'none';
        }
    }

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

// Single-flight: evita 2 cargas simultâneas (ex.: expiração de skin + boot) corrompendo o cache
let _loadInFlight = null;
function loadPlayerAndItems(forceRefresh = false) {
    if (_loadInFlight) {
        return _loadInFlight.then(() => forceRefresh ? loadPlayerAndItems(true) : undefined);
    }
    _loadInFlight = _loadPlayerAndItems(forceRefresh)
        .catch(err => console.error('Erro em loadPlayerAndItems:', err))
        .finally(() => { _loadInFlight = null; });
    return _loadInFlight;
}

function _stripDef(item) {
    const { items: _def, _placeholder, ...raw } = item;
    return raw;
}

function _notifySkinReconcile(frameId, videoId) {
    window.__lastActiveSkinIds = [frameId ?? null, videoId ?? null];
    window.skinSystem?.reconcileWithServer(frameId ?? null, videoId ?? null);
}

async function _loadPlayerAndItems(forceRefresh = false) {
    if (!globalUser) return;

    let localItems = [];
    let localStats = null;

    // 1. Cache local (IndexedDB) — com timeout; falha aqui NUNCA pode travar o resto
    try {
        let localTimestamp;
        [localItems, localStats, localTimestamp] = await withTimeout(Promise.all([
            loadCache(),
            loadPlayerStatsFromCache(),
            getLastUpdated()
        ]), 5000, 'idb');

        // Descarta qualquer snapshot de definição que tenha ficado gravado (versões antigas)
        localItems = (localItems || []).map(_stripDef);

        // Descarta registros inventados por páginas antigas (id string "hunt_drop_..." ou id temporário negativo).
        // Eles não existem no servidor; mantê-los no manifesto derrubava o sync_inventory (cast para bigint).
        localItems = localItems.filter(i => typeof i.id === 'number' && i.id > 0);

        // Cache parcial (itens sem item_id gravados pelo script.js) => não dá para confiar: baixa tudo
        if (localItems.some(i => i.item_id == null)) {
            console.warn('⚠️ Cache local incompleto detectado. Forçando download completo.');
            forceRefresh = true;
        }

        if (localItems.length > 0) {
            console.log('✅ UI Otimista: Exibindo dados locais enquanto sincroniza...');
            allInventoryItems = localItems.map(item => hydrateItem({ ...item }));
            playerBaseStats = localStats || {};
            equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null && i.quantity > 0);
            renderUI();
        }
    } catch (e) {
        console.warn("Erro ao ler cache local:", e);
        localItems = [];
    }

    // 2. Refresh forçado ou cache vazio -> Download completo
    if (forceRefresh || !localItems || localItems.length === 0) {
        console.log('🔄 Cache vazio ou Refresh forçado. Iniciando Download Completo...');
        await fullDownload();
        return;
    }

    // 3. Delta Sync
    console.log('🔄 Iniciando Delta Sync com servidor...');
    const manifest = generateManifest(localItems);

    let deltaData = null, deltaError = null;
    try {
        ({ data: deltaData, error: deltaError } = await withTimeout(
            supabase.rpc('sync_inventory', { p_player_id: globalUser.id, p_client_manifest: manifest }),
            12000, 'sync_inventory'
        ));
    } catch (e) {
        deltaError = e;
    }

    if (deltaError || !deltaData) {
        console.warn('⚠️ Falha no Delta Sync. Fazendo fallback para Download Completo.', deltaError);
        await fullDownload();
        return;
    }

    // 4. Aplica o delta
    try {
        console.log(`📥 Delta recebido: ${deltaData.upsert?.length || 0} modificados, ${deltaData.remove?.length || 0} removidos.`);

        let mergedList = processInventoryDelta(localItems, deltaData).map(item => hydrateItem({ ...item }));

        allInventoryItems = mergedList;
        equippedItems = allInventoryItems.filter(i => i.equipped_slot !== null && i.quantity > 0);

        if (deltaData.player_stats) playerBaseStats = deltaData.player_stats;

        renderUI();

        // Salva ANTES de reconciliar/iniciar timers: se algo abaixo falhar, o cache já está correto
        await saveCache(allInventoryItems, playerBaseStats, deltaData.last_inventory_update);
        console.log('💾 Cache local sincronizado e salvo.');

        _notifySkinReconcile(deltaData.active_frame_inventory_id, deltaData.active_video_inventory_id);

        await initPendingSkinTimers();
    } catch (e) {
        console.error("Erro ao processar Delta Sync:", e);
        await fullDownload();
    }
}

// Download Completo (fallback seguro)
async function fullDownload() {
    console.log('⬇️ Executando get_player_data_lazy (Full Load)...');

    let playerData = null, rpcError = null;
    try {
        ({ data: playerData, error: rpcError } = await withTimeout(
            supabase.rpc('get_player_data_lazy', { p_player_id: globalUser.id }),
            15000, 'get_player_data_lazy'
        ));
    } catch (e) {
        rpcError = e;
    }

    if (rpcError || !playerData) {
        console.error('❌ Erro crítico ao baixar inventário:', rpcError?.message || rpcError);
        // Só incomoda o jogador se não há NADA na tela; senão mantém os dados locais
        if (!allInventoryItems || allInventoryItems.length === 0) {
            showCustomAlert('Erro ao carregar inventário. Verifique sua conexão.');
        }
        return;
    }

    playerBaseStats = playerData.cached_combat_stats || {};

    const rawItems = playerData.cached_inventory || [];
    allInventoryItems = rawItems.map(item => hydrateItem({ ...item }));
    equippedItems = allInventoryItems.filter(item => item.equipped_slot !== null && item.quantity > 0);

    renderUI();

    try {
        await saveCache(allInventoryItems, playerBaseStats, playerData.last_inventory_update);
        console.log('💾 Cache completo salvo com sucesso.');
    } catch (e) {
        console.warn("⚠️ Erro não-crítico ao salvar cache:", e);
    }

    _notifySkinReconcile(playerData.active_frame_inventory_id, playerData.active_video_inventory_id);

    await initPendingSkinTimers();
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

    ['playerAttack','playerDefense','playerHealth','playerCritChance','playerCritDamage','playerEvasion','playerCritReduction']
        .forEach(id => document.getElementById(id)?.classList.remove('shimmer'));

    const avatarEl = document.getElementById('playerAvatarEquip');
    if (avatarEl && stats.avatar_url) avatarEl.src = stats.avatar_url;

    const atkSpan = document.getElementById('playerAttack');
    const defSpan = document.getElementById('playerDefense');
    const hpSpan  = document.getElementById('playerHealth');
    const ccSpan  = document.getElementById('playerCritChance');
    const cdSpan  = document.getElementById('playerCritDamage');
    const evSpan  = document.getElementById('playerEvasion');
    const crSpan  = document.getElementById('playerCritReduction');

    if (atkSpan) atkSpan.textContent = `${Math.floor(stats.min_attack || 0)} - ${Math.floor(stats.attack || 0)}`;
    if (defSpan) defSpan.textContent = `${Math.floor(stats.defense || 0)}`;
    if (hpSpan)  hpSpan.textContent  = `${Math.floor(stats.health || 0)}`;
    
    if (ccSpan)  ccSpan.textContent  = `${Math.floor(stats.crit_chance || 0)}%`;
    if (cdSpan)  cdSpan.textContent  = `${Math.floor(stats.crit_damage || 0)}%`;
    if (evSpan)  evSpan.textContent  = `${Math.floor(stats.evasion || 0)}%`;
    if (crSpan)  crSpan.textContent  = `${Math.floor(stats.crit_reduction || 0)}%`;
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
        // Pula skins — elas têm equipped_slot='skin' mas não ocupam um slot de equipamento visual
        if (item && invItem.equipped_slot && invItem.equipped_slot !== 'skin') {
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
        // Skins no gerenciador (equipped_slot='skin') não aparecem na bolsa
        if (!item.items || item.equipped_slot !== null || item.quantity <= 0) return false;
        
        if (tab === 'all') return true;
        if (tab === 'equipment' && item.items.item_type !== 'fragmento' && item.items.item_type !== 'outros' && item.items.item_type !== 'skin') return true;
        if (tab === 'fragments' && item.items.item_type === 'fragmento') return true;
        // PATCH SKIN: skins aparecem na aba "Outros"
        if (tab === 'others' && (item.items.item_type === 'outros' || item.items.item_type === 'skin')) return true;
        return false;
    });

    if (filteredItems.length === 0) {
        bagItemsGrid.innerHTML = '<p class="empty-inventory-message">Nenhum item nesta categoria.</p>';
        return;
    }

    filteredItems.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'inventory-item';

        // AAA: borda/brilho colorido por raridade (R / SR / SSR)
        if (item.items.rarity) {
            itemDiv.classList.add('rarity-' + item.items.rarity);
        }

        if (item.items.item_type === 'fragmento' && item.items.crafts_item_id && item.quantity >= 30) {
            itemDiv.classList.add('zoom-border');
        }

        let imgSrc;
        if (item.items.name === 'unknown' || !item.items.name) {
             imgSrc = `https://aden-rpg.pages.dev/assets/itens/unknown.webp`;
        } else if (item.items.item_type === 'fragmento' || item.items.item_type === 'skin') {
            // PATCH SKIN: skins usam nome sem sufixo de estrelas, igual fragmentos
            imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}.webp`;
        } else {
            const totalStars = (item.items?.stars || 0) + (item.refine_level || 0);
            imgSrc = `https://aden-rpg.pages.dev/assets/itens/${item.items.name}_${totalStars}estrelas.webp`;
        }

        itemDiv.innerHTML = `<img src="${imgSrc}" alt="${item.items.display_name}" onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'">`;
        if ((item.items.item_type === 'fragmento' || item.items.item_type === 'outros') && item.quantity > 1) {
            itemDiv.innerHTML += `<span class="item-quantity">${item.quantity}</span>`;
        }

        // PATCH SKIN: badge de expiração no canto superior esquerdo
        // expires_at null = permanente (sem badge); valor = temporária (exibe contagem)
        if (item.items.item_type === 'skin' && item.expires_at) {
            const timeStr = window.skinSystem?.formatExpiryTime(item.expires_at);
            if (timeStr) {
                const badge = document.createElement('span');
                badge.className   = 'skin-expiry-badge';
                badge.textContent = timeStr;
                itemDiv.appendChild(badge);
            }
        }

        if (item.items.item_type !== 'fragmento' && item.items.item_type !== 'outros' && item.items.item_type !== 'skin' && item.level && item.level >= 1) {
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
// SKIN: Inicia timers de skins recebidas mas ainda não iniciadas
// (expires_at NULL + skin_duration_hours > 0 na definição do item)
// Chamada após cada carregamento — zero egress quando não há nada a fazer.
// -------------------------------------------------------------
async function initPendingSkinTimers() {
    if (!globalUser) return;

    const pending = (window.allInventoryItems || []).filter(i =>
        i.items?.item_type?.toLowerCase() === 'skin' &&
        i.expires_at == null &&
        (i.items?.skin_duration_hours ?? 0) > 0 &&
        i.equipped_slot !== 'skin'   // só na bolsa, não no gerenciador
    );

    if (pending.length === 0) return;

    console.log(`[Skin] ${pending.length} skin(s) sem timer — iniciando...`);

    for (const skinItem of pending) {
        let data = null;
        try {
            ({ data } = await withTimeout(supabase.rpc('start_skin_expiry', {
                p_inventory_item_id: skinItem.id,
                p_player_id        : globalUser.id
            }), 8000, 'start_skin_expiry'));
        } catch (e) { console.warn('[Skin] start_skin_expiry falhou:', e); continue; }

        if (data?.success && data.expires_at) {
            // Atualiza localmente sem precisar rebaixar tudo
            const idx = window.allInventoryItems.findIndex(i => i.id === skinItem.id);
            if (idx > -1) {
                window.allInventoryItems[idx].expires_at = data.expires_at;
            }
        }
    }

    // Persiste o estado atualizado no IDB e re-renderiza a bolsa
    await saveCache(window.allInventoryItems, window.playerBaseStats, new Date().toISOString());
    loadItems(document.querySelector('.tab-button.active')?.id.replace('tab-', '') || 'all');
}


async function updateLocalInventoryState(args) {
    const { updatedItemId, newItemData, usedFragments, usedCrystals, newStats, equipUpdate, inventoryUpdates, removedItemIds } = args;
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

    // 1b. Linhas COMPLETAS devolvidas pelo servidor (construção, desconstrução, refundição...). O servidor é a fonte da
    // verdade: evita descobrir localmente qual linha duplicada foi descontada e dispensa SELECT extra (egress).
    if (Array.isArray(removedItemIds)) {
        removedItemIds.forEach(rid => {
            const k = allInventoryItems.findIndex(i => i.id === rid);
            if (k > -1) allInventoryItems.splice(k, 1);
        });
    }
    if (Array.isArray(inventoryUpdates)) {
        inventoryUpdates.forEach(row => {
            if (!row || row.id == null) return;
            const { items: _ignored, ...raw } = row;               // nunca confia em definição embutida
            const k = allInventoryItems.findIndex(i => i.id === row.id);
            if (k > -1) {
                allInventoryItems[k] = { ...allInventoryItems[k], ...raw };
                if (selectedItem && selectedItem.id === row.id) selectedItem = allInventoryItems[k];
            } else {
                allInventoryItems.push(hydrateItem({ ...raw }));
                needsSort = true;
            }
        });
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
                // Remove de outros itens do mesmo slot (exceto skins — múltiplas podem coexistir no gerenciador)
                if (slot !== 'skin') {
                    allInventoryItems.forEach(i => { if (i.equipped_slot === slot) i.equipped_slot = null; });
                }
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
        await showItemDetails(selectedItem);
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

            const _shareCtx = {
                action:        'refine',
                itemName:      item.items?.display_name || item.items?.name || 'Item',
                itemImageUrl:  `https://aden-rpg.pages.dev/assets/itens/${item.items?.name}_${item.items?.stars}estrelas.webp`,
                itemImageName: item.items?.name,
                stars
            };

            document.getElementById('refineFragmentModal').style.display = 'none';
            document.getElementById('itemDetailsModal').style.display = 'none';
            selectedItem = null;

            // ATUALIZAÇÃO LOCAL — todos os bônus vêm do servidor
            await updateLocalInventoryState({
                updatedItemId: item.id,
                newItemData: {
                    refine_level:          data.new_refine_level,
                    xp_progress:           0,
                    min_attack_bonus:      data.min_attack_bonus      ?? 0,
                    attack_bonus:          data.attack_bonus          ?? 0,
                    defense_bonus:         data.defense_bonus         ?? 0,
                    health_bonus:          data.health_bonus          ?? 0,
                    crit_chance_bonus:     data.crit_chance_bonus     ?? 0,
                    crit_damage_bonus:     data.crit_damage_bonus     ?? 0,
                    evasion_bonus:         data.evasion_bonus         ?? 0,
                    crit_reduction_bonus:  data.crit_reduction_bonus  ?? 0,
                    afk_xp_bonus:          data.afk_xp_bonus          ?? 0
                },
                usedFragments: data.used_fragments,
                usedCrystals: data.used_crystals,
                newStats: data.player_stats
            });

            showCustomAlert(`Item refinado! Estrelas totais: ${stars}.`, _shareCtx);
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
            const _shareCtx = {
                action:        'level',
                itemName:      item.items?.display_name || item.items?.name || 'Item',
                itemImageUrl:  `https://aden-rpg.pages.dev/assets/itens/${item.items?.name}_${item.items?.stars}estrelas.webp`,
                itemImageName: item.items?.name,
                level:         data.new_level
            };

            document.getElementById('itemDetailsModal').style.display = 'none';
            selectedItem = null;

            // ATUALIZAÇÃO LOCAL — todos os bônus vêm do servidor
            await updateLocalInventoryState({
                updatedItemId: item.id,
                newItemData: {
                    level:                 data.new_level,
                    xp_progress:           data.new_xp,
                    min_attack_bonus:      data.min_attack_bonus      ?? 0,
                    attack_bonus:          data.attack_bonus          ?? 0,
                    defense_bonus:         data.defense_bonus         ?? 0,
                    health_bonus:          data.health_bonus          ?? 0,
                    crit_chance_bonus:     data.crit_chance_bonus     ?? 0,
                    crit_damage_bonus:     data.crit_damage_bonus     ?? 0,
                    evasion_bonus:         data.evasion_bonus         ?? 0,
                    crit_reduction_bonus:  data.crit_reduction_bonus  ?? 0,
                    afk_xp_bonus:          data.afk_xp_bonus          ?? 0
                },
                usedFragments: data.used_fragments,
                newStats: data.player_stats
            });

            showCustomAlert(`Item evoluído para Nível ${data.new_level}!`, _shareCtx);
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
            const craftDef = window.itemDefinitions?.get(itemId);
            const _shareCtx = {
                action:        'craft',
                itemName:      craftDef?.display_name || craftDef?.name || 'Item',
                itemImageUrl:  craftDef
                    ? `https://aden-rpg.pages.dev/assets/itens/${craftDef.name}_${craftDef.stars}estrelas.webp`
                    : 'https://aden-rpg.pages.dev/assets/itens/unknown.webp',
                itemImageName: craftDef?.name
            };

            document.getElementById('craftingModal').style.display = 'none';
            document.getElementById('itemDetailsModal').style.display = 'none';
            selectedItem = null;

            // O servidor já devolve a linha completa do item novo (new_item): sem SELECT extra.
            // O fetch fica só como fallback caso o SQL antigo ainda esteja publicado.
            let newItemFull = data.new_item || null;
            if (!newItemFull && data.new_item_id) {
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

            showCustomAlert(`Item construído com sucesso!`, _shareCtx);

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
        document.getElementById('itemDetailsModal').style.display = 'none';
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

    // === PATCH SKIN: Delega para o sistema de skins ===
    if (item.items?.item_type?.toLowerCase() === 'skin') {
        window.skinSystem?.showSkinDetails(item);
        return;
    }
    
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

    // AAA: aplica borda/brilho de raridade no card do modal de detalhes
    const detailsContentEl = document.getElementById('itemDetailsContent');
    if (detailsContentEl) {
        detailsContentEl.classList.remove('rarity-R', 'rarity-SR', 'rarity-SSR');
        if (item.items.rarity) detailsContentEl.classList.add('rarity-' + item.items.rarity);
    }

    // Garante que o skinExpiryInfo e activateSkinBtn ficam ocultos para itens normais
    const skinExpiryEl = document.getElementById('skinExpiryInfo');
    if (skinExpiryEl) skinExpiryEl.style.display = 'none';
    const activateSkinBtn = document.getElementById('activateSkinBtn');
    if (activateSkinBtn) activateSkinBtn.style.display = 'none';
    
    // OTIMIZAÇÃO: Lazy Load de descrição e stats se necessário
    const descEl = document.getElementById('itemDescription');
    if (!item.items.description || item.items.attack === undefined) {
        descEl.textContent = "Carregando detalhes...";
        const { data } = await supabase.from('items')
            .select('description, attack, defense, health, crit_chance, crit_damage, evasion, crit_reduction, min_attack, afk_xp')
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
            if ((item.items.crit_reduction || 0) > 0) { itemStats.innerHTML += `<p>REDUÇÃO CRIT Base: +${item.items.crit_reduction}%</p>`; }
            // Asa de XP AFK: exibe base e bônus acumulado
            if ((item.items.afk_xp || 0) > 0) { itemStats.innerHTML += `<p>XP AFK Base: +${item.items.afk_xp}%</p>`; }
            
            if ((item.attack_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus ATK: +${item.attack_bonus}</p>`;
            if ((item.defense_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus DEF: +${item.defense_bonus}</p>`;
            if ((item.health_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus HP: +${item.health_bonus}</p>`;
            if ((item.crit_chance_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus TAXA CRIT: +${item.crit_chance_bonus}%</p>`;
            if ((item.crit_damage_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus DANO CRIT: +${item.crit_damage_bonus}%</p>`;
            if ((item.evasion_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus EVASÃO: +${item.evasion_bonus}%</p>`;
            if ((item.crit_reduction_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus REDUÇÃO CRIT: +${item.crit_reduction_bonus}%</p>`;
            // Bônus acumulado de XP AFK (escala com nível e refino)
            if ((item.afk_xp_bonus || 0) > 0) itemStats.innerHTML += `<p class="bonus-stat">Bônus XP AFK: +${item.afk_xp_bonus.toFixed(1)}%</p>`;
        }
    
        const refineRow1 = document.getElementById('refineRow1');
        const refineRow2 = document.getElementById('refineRow2');

        if (refineRow1) {
            if (item.reforge_slot1) {
                const formattedName = formatAttrName(item.reforge_slot1.attr);
                let formattedValue = item.reforge_slot1.value;
                if (['TAXA CRIT','DANO CRIT','EVASÃO'].includes(formattedName)) formattedValue += '%';
                const textStyle1 = `font-size:1.1em; margin:0; color:silver; font-weight:bold; text-shadow: none;
  background: linear-gradient(to bottom, black 50%, white 30%, black 50%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;`;
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
                const textStyle2 = `font-size:1.1em; margin:0; color:silver; font-weight:bold; text-shadow: none;
  background: linear-gradient(to bottom, black 50%, white 30%, black 50%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;`;
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
        case "crit_reduction_bonus": return "REDUÇÃO CRIT";
        default: return attr;
    }
}

// ===============================
// Shimmer Patch
// ===============================
(function applyInitialShimmer(){
  function addShimmer(){
    ['playerAttack','playerDefense','playerHealth','playerCritChance','playerCritDamage','playerEvasion','playerCritReduction']
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
// PATCH SKIN: expõe funções internas necessárias para skin_system.js
window.saveCache = saveCache;
window.renderUI = renderUI;
window.loadPlayerAndItems = loadPlayerAndItems;
window.hydrateItem = hydrateItem;

if (!window.handleDeconstruct) window.handleDeconstruct = () => {};
