// globalState.js

const DB_NAME = "aden_inventory_db";
const DB_VERSION = 42; 

// Nomes das Stores (Tabelas Locais)
export const STORES = {
    INVENTORY: "inventory_store",
    META: "meta_store",
    PLAYER: "player_store",
    MINES: "mines_store",
    GUILD: "guild_store",
    ARENA: "arena_store"
};

let dbInstance = null;

// Abre conexão (Singleton) - Garante apenas UMA conexão aberta por aba
export async function getDB() {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Cria stores se não existirem
            if (!db.objectStoreNames.contains(STORES.INVENTORY)) db.createObjectStore(STORES.INVENTORY, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORES.META)) db.createObjectStore(STORES.META, { keyPath: "key" });
            if (!db.objectStoreNames.contains(STORES.PLAYER)) db.createObjectStore(STORES.PLAYER, { keyPath: "id" }); 
            if (!db.objectStoreNames.contains(STORES.MINES)) db.createObjectStore(STORES.MINES, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORES.GUILD)) db.createObjectStore(STORES.GUILD, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORES.ARENA)) db.createObjectStore(STORES.ARENA, { keyPath: "session_date" });
        };

        req.onsuccess = (event) => {
            dbInstance = event.target.result;
            // Fecha a conexão se a aba for fechada ou recarregada para liberar travas
            dbInstance.onversionchange = () => {
                dbInstance.close();
                window.location.reload();
            };
            resolve(dbInstance);
        };

        req.onerror = (event) => {
            console.error("Erro GlobalDB:", event.target.error);
            reject("Erro ao abrir GlobalDB");
        };
    });
}

// --- PLAYER API ---

export async function getPlayerState(userId) {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORES.PLAYER, "readonly");
            const req = tx.objectStore(STORES.PLAYER).get(userId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch(e) { return null; }
}

export async function savePlayerState(playerData) {
    if (!playerData || !playerData.id) return;
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORES.PLAYER, "readwrite");
            const store = tx.objectStore(STORES.PLAYER);
            playerData._last_updated = Date.now();
            store.put(playerData);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch(e) { console.error(e); }
}

// --- CORE: SURGICAL UPDATE (Exportado para ser usado por script.js, arena.js, reward.js) ---
export async function surgicalCacheUpdate(newItems, newTimestamp, updatedStats) {
    try {
        const db = await getDB();
        const tx = db.transaction([STORES.INVENTORY, STORES.META, STORES.PLAYER], "readwrite");
        const store = tx.objectStore(STORES.INVENTORY);
        const meta = tx.objectStore(STORES.META);
        const playerStore = tx.objectStore(STORES.PLAYER);

        // 1. Atualiza Inventário
        if (Array.isArray(newItems) && newItems.length > 0) {
            newItems.forEach(item => store.put(item));
        }

        // 2. Atualiza Timestamp
        if (newTimestamp) {
            meta.put({ key: "last_updated", value: newTimestamp });
            meta.put({ key: "cache_time", value: Date.now() }); 
        }

        // 3. Atualiza Stats (Cristais/Ouro)
        if (updatedStats) {
            // Atualiza META (usado por inventory.js)
            meta.get("player_stats").onsuccess = (e) => {
                const currentStats = e.target.result ? e.target.result.value : {};
                const finalStats = { ...currentStats, ...updatedStats };
                meta.put({ key: "player_stats", value: finalStats });
            };

            // Atualiza PLAYER STORE (Se possível descobrir o ID)
            // Tenta achar qualquer registro recente ou atualiza se o ID for passado no updatedStats
            // Como fallback, isso depende do getPlayerState ser chamado depois.
        }

        return new Promise(resolve => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve(); // Resolve mesmo com erro para não travar UI
        });
    } catch (e) {
        console.warn("⚠️ Falha ao atualizar IndexedDB via Global:", e);
    }
}