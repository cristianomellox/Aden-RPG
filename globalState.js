// globalState.js

const DB_NAME = "aden_inventory_db";
// Aumentamos a versão para forçar a criação das novas tabelas
const DB_VERSION = 42; 

// Nomes das Stores (Tabelas Locais)
export const STORES = {
    INVENTORY: "inventory_store", // Já existe
    META: "meta_store",           // Já existe
    PLAYER: "player_store",       // NOVO: Dados do jogador (gold, crystals, stats)
    MINES: "mines_store",         // NOVO: Lista de minas e status
    GUILD: "guild_store",         // NOVO: Dados da guilda
    ARENA: "arena_store"          // NOVO: Sessão e oponentes
};

let dbInstance = null;

// Abre conexão (Singleton)
export async function getDB() {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Cria stores se não existirem
            if (!db.objectStoreNames.contains(STORES.INVENTORY)) db.createObjectStore(STORES.INVENTORY, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORES.META)) db.createObjectStore(STORES.META, { keyPath: "key" });
            
            // Novas Stores Globais
            if (!db.objectStoreNames.contains(STORES.PLAYER)) db.createObjectStore(STORES.PLAYER, { keyPath: "id" }); 
            if (!db.objectStoreNames.contains(STORES.MINES)) db.createObjectStore(STORES.MINES, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORES.GUILD)) db.createObjectStore(STORES.GUILD, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORES.ARENA)) db.createObjectStore(STORES.ARENA, { keyPath: "session_date" });
        };

        req.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        req.onerror = (event) => reject("Erro ao abrir GlobalDB: " + event.target.error);
    });
}

// --- PLAYER API ---

export async function getPlayerState(userId) {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORES.PLAYER, "readonly");
        const req = tx.objectStore(STORES.PLAYER).get(userId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

export async function savePlayerState(playerData) {
    if (!playerData || !playerData.id) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.PLAYER, "readwrite");
        const store = tx.objectStore(STORES.PLAYER);
        // Adiciona timestamp local para saber se o dado é velho
        playerData._last_updated = Date.now();
        store.put(playerData);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Atualização parcial (ex: ganhou só ouro)
export async function patchPlayerState(userId, changes) {
    const current = await getPlayerState(userId);
    if (!current) return; // Não atualiza se não tiver o base
    const newData = { ...current, ...changes };
    await savePlayerState(newData);
    return newData;
}

// --- MINES API (Exemplo) ---

export async function getMinesCache() {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORES.MINES, "readonly");
        const req = tx.objectStore(STORES.MINES).getAll();
        req.onsuccess = () => resolve(req.result || []);
    });
}

export async function saveMinesCache(minesArray) {
    const db = await getDB();
    const tx = db.transaction(STORES.MINES, "readwrite");
    const store = tx.objectStore(STORES.MINES);
    
    // Limpa cache antigo ou faz update inteligente (aqui limpamos para simplificar sync)
    // store.clear(); 
    
    minesArray.forEach(mine => store.put(mine));
    
    return new Promise(resolve => {
        tx.oncomplete = () => resolve();
    });
}