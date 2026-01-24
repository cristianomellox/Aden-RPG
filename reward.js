// =======================================================================
// NOVO: ADEN GLOBAL DB (INTEGRAÇÃO ZERO EGRESS)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 3;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(PLAYER_STORE)) db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    // Atualiza apenas campos específicos no cache global (ex: Cristais)
    updatePlayerPartial: async function(changes) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            const store = tx.objectStore(PLAYER_STORE);
            
            const currentData = await new Promise(resolve => {
                const req = store.get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });

            if (currentData) {
                const newData = { ...currentData, ...changes };
                store.put({ key: 'player_data', value: newData });
                console.log("[Reward] GlobalDB atualizado com novos dados:", changes);
            }
        } catch(e) { console.warn("Erro update parcial GlobalDB", e); }
    }
};

// ============================================================
// HELPER INDEXEDDB (INVENTÁRIO)
// ============================================================
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 42;

function openInventoryDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Atualiza o cache local "cirurgicamente" e REMOVE itens com qtd 0.
 * IMPORTANTE: Realiza hidratação dos dados (preenche detalhes visuais) se eles vierem incompletos do servidor.
 */
async function surgicalCacheUpdate(newItems, newTimestamp, updatedStats) {
    try {
        const db = await openInventoryDB();
        const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const meta = tx.objectStore(META_STORE);

        // --- HIDRATAÇÃO: Carrega itemDefinitions se necessário ---
        if (!window.itemDefinitions) {
            // Em reward.js, talvez o script.js não esteja totalmente carregado ou a página seja independente.
            // Para garantir, tentamos buscar do LocalStorage.
            const CACHE_KEY = 'item_definitions_cache';
            try {
                const cachedData = localStorage.getItem(CACHE_KEY);
                if (cachedData) {
                    const parsed = JSON.parse(cachedData);
                    window.itemDefinitions = new Map(parsed.data || parsed); // Suporta formatos diferentes
                }
            } catch(e) {}
        }
        
        // Se ainda assim não tiver, os itens podem ficar sem imagem até o próximo reload completo.
        // Mas a estrutura do objeto 'items' existirá se fizermos o fallback abaixo.
        // ------------------------------------------------------------

        // 1. Atualiza itens
        if (Array.isArray(newItems) && newItems.length > 0) {
            newItems.forEach(item => {
                // HIDRATAÇÃO
                if ((!item.items || Object.keys(item.items).length === 0)) {
                    // Tenta pegar do cache global
                    if (window.itemDefinitions && window.itemDefinitions.get) {
                        const def = window.itemDefinitions.get(item.item_id);
                        if (def) item.items = def;
                    }
                    
                    // Fallback de emergência: Se ainda não tem 'items', cria um placeholder para não quebrar UI
                    if (!item.items) {
                        item.items = { item_id: item.item_id, name: "Item Carregando...", item_type: "unknown" };
                    }
                }
                store.put(item);
            });
        }

        // 2. Atualiza Timestamp
        if (newTimestamp) {
            meta.put({ key: "last_updated", value: newTimestamp });
            meta.put({ key: "cache_time", value: Date.now() }); 
        }

        // 3. Atualiza Stats (Cristais) no Meta Store
        if (updatedStats) {
            const req = meta.get("player_stats");
            req.onsuccess = () => {
                const currentStats = req.result ? req.result.value : {};
                const finalStats = { ...currentStats, ...updatedStats };
                meta.put({ key: "player_stats", value: finalStats });
            };
        }

        return new Promise(resolve => {
            tx.oncomplete = () => resolve();
        });
    } catch (e) {
        console.warn("⚠️ Falha ao atualizar IndexedDB via reward.js:", e);
    }
}

// Helper para atualizar localStorage
function updateLocalPlayerCache(updates) {
    try {
        const cachedStr = localStorage.getItem('player_data_cache');
        if (cachedStr) {
            const cachedObj = JSON.parse(cachedStr);
            if (cachedObj.data) {
                // Mescla os updates no cache existente
                Object.assign(cachedObj.data, updates);
                localStorage.setItem('player_data_cache', JSON.stringify(cachedObj));
            }
        }
    } catch (e) {
        console.warn("Erro ao atualizar localStorage:", e);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const messageDiv = document.getElementById('reward-message');
    const returnBtn = document.getElementById('return-btn'); 
    returnBtn.style.display = 'none'; 

    const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let claimToken = localStorage.getItem('pending_reward_token');

    if (localStorage.getItem('pending_reward_token')) {
        localStorage.removeItem('pending_reward_token');
    }

    if (!claimToken) {
        messageDiv.textContent = 'Erro: Token de recompensa ausente. Redirecionando...';
        setTimeout(() => {
            // Usa URL de redirecionamento customizada se existir, senão vai pra index
            const target = window.REWARD_REDIRECT_URL || '/index.html';
            window.location.href = target;
        }, 3000);
        return;
    }

    try {
        messageDiv.textContent = 'Processando sua recompensa...';
        
        // Agora retorna JSONB
        const { data: rpcData, error: rpcError } = await supabaseClient.rpc('grant_daily_reward', {
            p_claim_token: claimToken
        });

        if (rpcError) throw rpcError;

        // Atualiza a mensagem na tela
        messageDiv.innerHTML = `<h2>Recompensa Recebida!</h2><p>${rpcData.message}</p><p>Sincronizando dados...</p>`;
        
        // === ATUALIZAÇÃO DE CACHE (ZERO EGRESS & GLOBAL DB) ===
        
        const updates = {};
        
        // 1. Atualiza Cristais se houver mudança
        if (typeof rpcData.new_crystals === 'number') {
            updates.crystals = rpcData.new_crystals;
        }

        // 2. Atualiza Tentativas de AFK se vier no retorno
        if (typeof rpcData.new_attempts === 'number') {
            updates.daily_attempts_left = rpcData.new_attempts;
            
            // Tenta atualizar especificamente o cache de AFK se ele existir no localStorage
            try {
                // Recupera ID do usuário (hack rápido lendo do localStorage do supabase ou cache)
                const authKeys = Object.keys(localStorage).filter(k => k.includes('auth-token'));
                if(authKeys.length > 0) {
                    const session = JSON.parse(localStorage.getItem(authKeys[0]));
                    const uid = session.user.id;
                    const afkKey = `playerAfkData_${uid}`;
                    const afkCache = localStorage.getItem(afkKey);
                    if(afkCache) {
                        const parsed = JSON.parse(afkCache);
                        parsed.data.daily_attempts_left = rpcData.new_attempts;
                        localStorage.setItem(afkKey, JSON.stringify(parsed));
                    }
                }
            } catch(e) {}
        }

        // 3. Aplica atualizações no LocalStorage Geral
        updateLocalPlayerCache(updates);

        // 4. Atualiza IndexedDB de Inventário (Itens e Timestamp)
        if (rpcData.new_timestamp) {
            const statsUpdate = {};
            if (updates.crystals !== undefined) statsUpdate.crystals = updates.crystals;
            
            // inventory_updates agora virá como [{item_id:..., quantity:...}] (lean)
            await surgicalCacheUpdate(rpcData.inventory_updates || [], rpcData.new_timestamp, statsUpdate);
        }

        // 5. Atualiza GlobalDB (Player Store) para que a Home/Loja/AFK leia o saldo correto imediatamente
        if (Object.keys(updates).length > 0) {
            await GlobalDB.updatePlayerPartial(updates);
        }

        messageDiv.innerHTML += `<p>Retornando...</p>`;

        // Redireciona
        setTimeout(() => {
            const target = window.REWARD_REDIRECT_URL || '/index.html?action=openShopVideo';
            window.location.href = target;
        }, 2000);

    } catch (error) {
        console.error(error);
        messageDiv.textContent = `Ocorreu um erro: ${error.message || 'Desconhecido'}. Você será redirecionado.`;
        setTimeout(() => {
            const target = window.REWARD_REDIRECT_URL || '/index.html?action=openShopVideo';
            window.location.href = target;
        }, 3000);
    }
});