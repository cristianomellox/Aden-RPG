import { supabase } from './supabaseClient.js'

// =======================================================================
// NOVO: ADEN GLOBAL DB (INTEGRAÇÃO ZERO EGRESS)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 1;
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
const DB_VERSION = 41;

function openInventoryDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function surgicalCacheUpdate(newItems, newTimestamp, updatedStats) {
    try {
        const db = await openInventoryDB();
        const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const meta = tx.objectStore(META_STORE);

        // 1. Atualiza itens
        if (Array.isArray(newItems) && newItems.length > 0) {
            newItems.forEach(item => store.put(item));
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
function updateLocalPlayerCache(newCrystals) {
    try {
        const cachedStr = localStorage.getItem('player_data_cache');
        if (cachedStr) {
            const cachedObj = JSON.parse(cachedStr);
            if (cachedObj.data) {
                cachedObj.data.crystals = newCrystals;
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

    let claimToken = localStorage.getItem('pending_reward_token');

    if (localStorage.getItem('pending_reward_token')) {
        localStorage.removeItem('pending_reward_token');
    }

    if (!claimToken) {
        messageDiv.textContent = 'Erro: Token de recompensa ausente. Você será redirecionado em breve.';
        setTimeout(() => {
            window.location.href = '/index.html';
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
        
        // 1. Atualiza LocalStorage (Cristais) e prepara objeto de updates
        if (typeof rpcData.new_crystals === 'number') {
            updateLocalPlayerCache(rpcData.new_crystals);
            updates.crystals = rpcData.new_crystals;
        }

        // 2. Atualiza IndexedDB de Inventário (Itens e Timestamp)
        if (rpcData.new_timestamp) {
            const statsUpdate = (typeof rpcData.new_crystals === 'number') ? { crystals: rpcData.new_crystals } : null;
            await surgicalCacheUpdate(rpcData.inventory_updates || [], rpcData.new_timestamp, statsUpdate);
        }

        // 3. Atualiza GlobalDB (Player Store) para que a Home/Loja leia o saldo correto imediatamente
        if (Object.keys(updates).length > 0) {
            await GlobalDB.updatePlayerPartial(updates);
        }

        messageDiv.innerHTML += `<p>Retornando à loja...</p>`;

        // Redireciona
        setTimeout(() => {
            window.location.href = '/index.html?action=openShopVideo';
        }, 2000);

    } catch (error) {
        console.error(error);
        messageDiv.textContent = `Ocorreu um erro: ${error.message || 'Desconhecido'}. Você será redirecionado.`;
        setTimeout(() => {
            window.location.href = '/index.html?action=openShopVideo';
        }, 3000);
    }
});