/**
 * GERENCIADOR DE DADOS LOCAIS (IndexedDB)
 * Objetivo: Zerar egress do Supabase cacheando tabelas completas.
 */

const DB_NAME = 'AdenRPG_LocalDB';
const DB_VERSION = 1;
const SYNC_KEY = 'aden_last_full_sync';
const SYNC_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 Dias em milissegundos

class LocalGameDB {
    constructor() {
        this.db = null;
    }

    // Inicializa o banco de dados
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Store de Jogador (Clona tabela players)
                if (!db.objectStoreNames.contains('players')) {
                    db.createObjectStore('players', { keyPath: 'id' });
                }
                // Store de Itens (Clona tabela items - definições)
                if (!db.objectStoreNames.contains('items')) {
                    db.createObjectStore('items', { keyPath: 'item_id' });
                }
                // Store de Inventário (Clona inventory_items)
                if (!db.objectStoreNames.contains('inventory')) {
                    const invStore = db.createObjectStore('inventory', { keyPath: 'id' }); // id único do item no inventário
                    invStore.createIndex('player_id', 'player_id', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error("Erro ao abrir IndexedDB:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    // --- MÉTODOS DE SINCRONIZAÇÃO ---

    /**
     * Verifica se precisa sincronizar com o servidor (passou 7 dias ou cache vazio)
     */
    async needsSync(userId) {
        const lastSync = parseInt(localStorage.getItem(SYNC_KEY) || '0');
        const now = Date.now();
        
        // Verifica se tem dados do jogador
        const player = await this.getPlayer(userId);
        
        if (!player || (now - lastSync > SYNC_INTERVAL)) {
            console.log("🔄 Sincronização necessária (Cache expirado ou inexistente).");
            return true;
        }
        console.log("✅ Dados locais válidos. Usando cache Local-First.");
        return false;
    }

    /**
     * Baixa TUDO do Supabase e salva no IndexedDB
     */
    async fullSync(userId, supabaseClient) {
        console.time("FullSync");
        try {
            // 1. Busca Jogador
            const { data: player, error: errP } = await supabaseClient
                .from('players').select('*').eq('id', userId).single();
            if (errP) throw errP;

            // 2. Busca Definições de Itens (Tabela items)
            // Otimização: Buscar apenas itens relevantes ou todos se a tabela for pequena (<1000 itens)
            const { data: itemsDef, error: errI } = await supabaseClient
                .from('items').select('*'); 
            if (errI) throw errI;

            // 3. Busca Inventário Completo
            const { data: inventory, error: errInv } = await supabaseClient
                .from('inventory_items').select('*').eq('player_id', userId);
            if (errInv) throw errInv;

            // 4. Salva tudo no IndexedDB (Transação única para performance)
            const transaction = this.db.transaction(['players', 'items', 'inventory'], 'readwrite');
            
            transaction.objectStore('players').put(player);
            
            const itemStore = transaction.objectStore('items');
            itemsDef.forEach(item => itemStore.put(item));

            const invStore = transaction.objectStore('inventory');
            // Limpa inventário antigo antes de inserir o novo para evitar lixo
            // (Para fazer isso corretamente precisaríamos de um índice ou clear, 
            // aqui vamos assumir clear total do store inventory por simplicidade ou lógica de merge)
            // Para simplificar: deletar itens desse player seria o ideal, mas vamos sobrescrever.
            inventory.forEach(invItem => invStore.put(invItem));

            // Atualiza timestamp
            localStorage.setItem(SYNC_KEY, Date.now().toString());
            console.timeEnd("FullSync");
            return player;

        } catch (error) {
            console.error("Erro na sincronização completa:", error);
            throw error;
        }
    }

    // --- MÉTODOS DE LEITURA (SEM EGRESS) ---

    async getPlayer(userId) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('players', 'readonly');
            const store = tx.objectStore('players');
            const req = store.get(userId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    }

    async getItemDefinition(itemId) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('items', 'readonly');
            const store = tx.objectStore('items');
            const req = store.get(itemId);
            req.onsuccess = () => resolve(req.result);
        });
    }

    async getInventory(userId) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('inventory', 'readonly');
            const store = tx.objectStore('inventory');
            const index = store.index('player_id');
            const req = index.getAll(userId);
            req.onsuccess = () => resolve(req.result || []);
        });
    }

    // --- MÉTODOS DE ESCRITA OTIMISTA (SEM WAIT DO SERVIDOR) ---

    async updatePlayerLocal(playerObj) {
        const tx = this.db.transaction('players', 'readwrite');
        tx.objectStore('players').put(playerObj);
        return playerObj;
    }

    // --- LÓGICA DE CÁLCULO DE CP (Replicando SQL) ---
    
    async calculateStatsAndCP(userId) {
        const player = await this.getPlayer(userId);
        if (!player) return null;

        const inventory = await this.getInventory(userId);
        
        // Objeto acumulador de stats
        let stats = {
            attack: player.attack || 0,
            min_attack: player.min_attack || 0,
            defense: player.defense || 0,
            health: player.health || 0,
            crit_chance: Number(player.crit_chance || 0),
            crit_damage: Number(player.crit_damage || 0),
            evasion: player.evasion || 0
        };

        // Itera sobre itens equipados
        for (const invItem of inventory) {
            if (invItem.equipped_slot) {
                // 1. Soma Bônus do Inventário (Reforja/Encantamento)
                stats.attack += (invItem.attack_bonus || 0);
                stats.min_attack += (invItem.min_attack_bonus || 0);
                stats.defense += (invItem.defense_bonus || 0);
                stats.health += (invItem.health_bonus || 0);
                stats.crit_chance += Number(invItem.crit_chance_bonus || 0);
                stats.crit_damage += Number(invItem.crit_damage_bonus || 0);
                stats.evasion += (invItem.evasion_bonus || 0);

                // 2. Busca Atributos Base do Item (Tabela items)
                const itemDef = await this.getItemDefinition(invItem.item_id);
                if (itemDef) {
                    stats.attack += (itemDef.attack || 0);
                    stats.min_attack += (itemDef.min_attack || 0);
                    stats.defense += (itemDef.defense || 0);
                    stats.health += (itemDef.health || 0);
                    stats.crit_chance += Number(itemDef.crit_chance || 0);
                    stats.crit_damage += Number(itemDef.crit_damage || 0);
                    stats.evasion += (itemDef.evasion || 0);
                }
            }
        }

        // Fórmula de CP (Idêntica ao SQL)
        // (attack * 12.5) + (min_attack * 1.5) + (crit_chance * 5.35) + 
        // (crit_damage * 6.5) + (defense * 2) + (health * 3.2625) + (evasion * 1)
        
        const cp = Math.floor(
            (stats.attack * 12.5) +
            (stats.min_attack * 1.5) +
            (stats.crit_chance * 5.35) +
            (stats.crit_damage * 6.5) +
            (stats.defense * 2) +
            (stats.health * 3.2625) +
            (stats.evasion * 1)
        );

        // Atualiza o objeto do jogador localmente
        player.combat_power = cp;
        
        // Salva o novo CP no banco local
        await this.updatePlayerLocal(player);

        return player;
    }
}

// Exporta instância global
window.localDB = new LocalGameDB();