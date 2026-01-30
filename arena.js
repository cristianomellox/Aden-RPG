import { supabase } from './supabaseClient.js'

// =======================================================================
// 1. ADEN GLOBAL DB (INTEGRAÇÃO ZERO EGRESS & SYNC COM CACHE COMPARTILHADO)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 6; 
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';
const OWNERS_STORE = 'owners_store'; 

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(PLAYER_STORE)) db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(OWNERS_STORE)) db.createObjectStore(OWNERS_STORE, { keyPath: 'id' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(AUTH_STORE, 'readonly');
                const req = tx.objectStore(AUTH_STORE).get('current_session');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    getPlayer: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(PLAYER_STORE, 'readonly');
                const req = tx.objectStore(PLAYER_STORE).get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
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
                console.log("⚡ [Arena] GlobalDB atualizado parcialmente:", changes);
            }
        } catch(e) { console.warn("Erro update parcial GlobalDB", e); }
    },
    // --- Lógica Compartilhada de Leitura de Donos/Perfis ---
    getAllOwners: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(OWNERS_STORE, 'readonly');
                const store = tx.objectStore(OWNERS_STORE);
                const req = store.getAll();
                req.onsuccess = () => {
                    const result = req.result || [];
                    const map = {};
                    result.forEach(o => map[o.id] = o);
                    resolve(map);
                };
                req.onerror = () => resolve({});
            });
        } catch(e) { return {}; }
    },
    // --- Salva e Atualiza Timestamp (Keep-Alive para Cache) ---
    // [ATUALIZADO] Agora salva guild_name também
    saveOwners: async function(ownersList) {
        if (!ownersList || ownersList.length === 0) return;
        try {
            const db = await this.open();
            const tx = db.transaction(OWNERS_STORE, 'readwrite');
            const store = tx.objectStore(OWNERS_STORE);
            const now = Date.now();

            ownersList.forEach(o => {
                // Salva ID, Nome, Avatar, GuildID e GuildName. Timestamp atualizado impede expiração.
                const cacheObj = {
                    id: o.id,
                    name: o.name,
                    avatar_url: o.avatar_url,
                    guild_id: o.guild_id,
                    guild_name: o.guild_name, // [NOVO] Persistência do nome da guilda
                    timestamp: now 
                };
                store.put(cacheObj);
            });
            return new Promise(resolve => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
        } catch(e) { console.warn("Erro ao salvar donos no cache global:", e); }
    }
};

// =======================================================================
// 2. HELPER INDEXEDDB INVENTORY (Surgical Update com Hidratação)
// =======================================================================
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 47;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function surgicalCacheUpdate(newItems, newTimestamp, updatedStats) {
    try {
        const db = await openDB();
        const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const meta = tx.objectStore(META_STORE);

        if (Array.isArray(newItems)) {
            newItems.forEach(item => {
                // Tenta hidratar se o item estiver "pelado" (veio do RPC sem JOIN)
                if (!item.items || !item.items.name) {
                    if (window.itemDefinitions) {
                        const def = window.itemDefinitions.get(item.item_id);
                        if (def) item.items = def;
                    } else if (localStorage.getItem('item_definitions_full_v1')) {
                        // Fallback: lê do storage se a RAM não tiver
                        try {
                             const cached = JSON.parse(localStorage.getItem('item_definitions_full_v1'));
                             const map = new Map(cached.data || cached);
                             const def = map.get(item.item_id);
                             if(def) item.items = def;
                        } catch(e){}
                    }
                }
                store.put(item);
            });
        }

        if (newTimestamp) {
            meta.put({ key: "last_updated", value: newTimestamp });
            meta.put({ key: "cache_time", value: Date.now() }); 
        }

        if (updatedStats) {
            const req = meta.get("player_stats");
            req.onsuccess = () => {
                const currentStats = req.result ? req.result.value : {};
                const finalStats = { ...currentStats, ...updatedStats };
                meta.put({ key: "player_stats", value: finalStats });
            };
            await GlobalDB.updatePlayerPartial(updatedStats);
        }

        return new Promise(resolve => {
            tx.oncomplete = () => {
                console.log("✅ [Arena Surgical Update] Caches locais atualizados.");
                resolve();
            }
        });
    } catch (e) {
        console.warn("⚠️ Falha ao atualizar IndexedDB via arena.js:", e);
    }
}

// =======================================================================
// 3. FUNÇÃO DE HIDRATAÇÃO DE PERFIS (ZERO EGRESS - ATUALIZADA)
// =======================================================================
/**
 * Recebe uma lista de objetos "esqueleto" (com id, guild_id, etc).
 * Verifica o cache GlobalDB.
 * Baixa apenas os perfis faltantes do Supabase (com JOIN de guilda).
 * Retorna lista completa com names, avatares e nomes de guilda.
 */
async function hydrateProfiles(skeletonList) {
    if (!skeletonList || skeletonList.length === 0) return [];

    // 1. Ler Cache Global
    const globalCacheMap = await GlobalDB.getAllOwners();
    const missingIds = [];
    const idsToUpdateTimestamp = [];
    const hydratedList = [];

    // 2. Cruzamento (Cache Hit vs Miss)
    skeletonList.forEach(item => {
        // Suporta tanto item.id quanto item.opponent_id (se vier de log)
        const targetId = item.id || item.opponent_id; 
        if(!targetId) return;

        const cached = globalCacheMap[targetId];
        // [ATUALIZADO] Verifica se temos nome e agora também guild_name no cache
        if (cached && cached.name) {
            // Temos no cache!
            hydratedList.push({
                ...item,
                name: cached.name,
                avatar_url: cached.avatar_url,
                // Mantém o guild_id do esqueleto se existir (prioridade), ou usa do cache
                guild_id: item.guild_id || cached.guild_id,
                // [ATUALIZADO] Tenta pegar o nome da guilda do cache ou usa 'Sem Guilda'
                guild_name: cached.guild_name || item.guild_name || 'Sem Guilda'
            });
            idsToUpdateTimestamp.push(cached);
        } else {
            // Não temos (ou está incompleto), marcar para baixar
            missingIds.push(targetId);
            hydratedList.push({ ...item, _needsFetch: true });
        }
    });

    // 3. Fetch dos faltantes (Delta Fetch)
    if (missingIds.length > 0) {
        // [ATUALIZADO] Fazemos o Join com a tabela de guildas para pegar o nome
        const { data: freshProfiles } = await supabase
            .from('players')
            .select('id, name, avatar_url, guild_id, guilds (name)') 
            .in('id', missingIds);

        if (freshProfiles) {
            const toSave = [];
            freshProfiles.forEach(fp => {
                // [ATUALIZADO] Achatar o objeto da guilda
                const gName = fp.guilds ? fp.guilds.name : 'Sem Guilda';
                
                // Cria objeto plano para salvar no cache
                const flatProfile = {
                    id: fp.id,
                    name: fp.name,
                    avatar_url: fp.avatar_url,
                    guild_id: fp.guild_id,
                    guild_name: gName
                };

                // Encontra todos os itens na lista hidratada que precisam desse perfil
                // (pode haver duplicados se o mesmo oponente aparecer várias vezes)
                hydratedList.forEach(hItem => {
                   const tId = hItem.id || hItem.opponent_id;
                   if(tId === fp.id && hItem._needsFetch) {
                       hItem.name = fp.name;
                       hItem.avatar_url = fp.avatar_url;
                       if (!hItem.guild_id) hItem.guild_id = fp.guild_id; 
                       hItem.guild_name = gName; // Preenche o nome da guilda
                       delete hItem._needsFetch;
                   }
                });
                toSave.push(flatProfile);
            });
            // Salva novos perfis no cache global (incluindo o nome da guilda)
            await GlobalDB.saveOwners(toSave);
        }
    }

    // 4. Renova TTL dos caches usados (Keep-alive para Minas/Ranking CP)
    if (idsToUpdateTimestamp.length > 0) {
        await GlobalDB.saveOwners(idsToUpdateTimestamp);
    }

    return hydratedList;
}

document.addEventListener("DOMContentLoaded", async () => {
    // =======================================================================
    // 4. CONFIGURAÇÃO E VARIÁVEIS GLOBAIS
    // =======================================================================
    let userId = null;
    
    // --- CACHE DE DEFINIÇÕES DE ITENS (Lê do LocalStorage gerado pelo script.js) ---
    let localItemDefinitions = new Map();

    function loadLocalItemDefinitions() {
        try {
            const cached = localStorage.getItem('item_definitions_full_v1');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && Array.isArray(parsed.data)) {
                    localItemDefinitions = new Map(parsed.data);
                } else if (Array.isArray(parsed)) { // Formato array simples
                    localItemDefinitions = new Map(parsed);
                }
                // Expor globalmente para o surgicalCacheUpdate usar
                if (!window.itemDefinitions) window.itemDefinitions = localItemDefinitions;
                console.log(`📦 [Arena] Definições de itens carregadas: ${localItemDefinitions.size}`);
            }
        } catch (e) {
            console.warn("Erro ao ler item_definitions_full_v1:", e);
        }
    }
    // Carrega imediatamente ao iniciar
    loadLocalItemDefinitions();

    function getItemName(id) {
        const def = localItemDefinitions.get(parseInt(id));
        return def ? def.name : 'unknown'; // Retorna o nome do arquivo (ex: 'pocao_vida')
    }
    
    function getItemDisplayName(id) {
        const def = localItemDefinitions.get(parseInt(id));
        return def ? (def.display_name || def.name.replace(/_/g, ' ')) : 'Item Desconhecido';
    }

    async function getLocalUserId() {
        const globalAuth = await GlobalDB.getAuth();
        if (globalAuth && globalAuth.value && globalAuth.value.user) {
            return globalAuth.value.user.id;
        }
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

    // --- RASTREADOR DE CONSUMO DE POÇÕES ---
    let sessionConsumedPotions = {}; 
    let sessionOpponentsConsumed = {};

    function trackConsumedPotion(itemId) {
        const id = parseInt(itemId);
        if (!sessionConsumedPotions[id]) sessionConsumedPotions[id] = 0;
        sessionConsumedPotions[id]++;
    }

    function trackOpponentConsumption(opponentId, itemId) {
        const id = parseInt(itemId);
        if (!sessionOpponentsConsumed[opponentId]) {
            sessionOpponentsConsumed[opponentId] = {};
        }
        if (!sessionOpponentsConsumed[opponentId][id]) {
            sessionOpponentsConsumed[opponentId][id] = 0;
        }
        sessionOpponentsConsumed[opponentId][id]++;
    }

    function syncSessionLoadout(itemId, newQuantity) {
        if (!currentSession || !currentSession.loadout) return;
        currentSession.loadout.forEach(p => {
            if (parseInt(p.item_id) === parseInt(itemId)) {
                p.quantity = newQuantity;
            }
        });
        localStorage.setItem('arena_session_v1', JSON.stringify(currentSession));
    }

    // --- ENGINE DE BATALHA LOCAL ---
    class ArenaEngine {
        constructor(playerStats, opponentData, playerLoadout) {
            this.player = {
                id: userId,
                name: playerStats.name || 'Você',
                stats: playerStats,
                hp: parseInt(playerStats.health),
                maxHp: parseInt(playerStats.health),
                buffs: {},
                potions: []
            };

            const uniquePotions = {};
            if (Array.isArray(playerLoadout)) {
                playerLoadout.forEach(p => {
                    const pId = parseInt(p.item_id);
                    if (!uniquePotions[pId]) {
                        uniquePotions[pId] = { ...p, cd: 0, quantity: parseInt(p.quantity) };
                    }
                });
            }
            this.player.potions = Object.values(uniquePotions);
            
            const oppStats = opponentData.combat_stats || {};
            const uniqueOppPotions = {};
            (opponentData.potions || []).forEach(p => {
                const pId = parseInt(p.item_id || p.itemId); // Fallback para compatibilidade
                if(!uniqueOppPotions[pId]) {
                    uniqueOppPotions[pId] = { 
                        item_id: pId, 
                        cd: 0, 
                        quantity: parseInt(p.qty || p.quantity || 1) 
                    };
                }
            });

            this.opponent = {
                id: opponentData.id,
                name: opponentData.name || 'Oponente',
                stats: oppStats,
                hp: parseInt(oppStats.health || 1000),
                maxHp: parseInt(oppStats.health || 1000),
                buffs: {},
                potions: Object.values(uniqueOppPotions)
            };

            this.turn = 1;
            this.finished = false;
            this.playerWon = false;
            this.turnLimit = 100;
        }

        random(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
        hasBuff(entity, type) { return entity.buffs[type] && entity.buffs[type].ends_at >= this.turn; }
        getBuffId(entity, type) { return entity.buffs[type] ? entity.buffs[type].item_id : 0; }

        processTurn(actionType, itemId = null) {
            if (this.finished) return this.getState();

            if (actionType === 'ATTACK') {
                this.player.potions.forEach(p => { if(p.cd > 0) p.cd--; });
            }

            let actionResult = { type: actionType, dmg: 0, crit: false, heal: 0 };
            let enemyActions = [];

            if (actionType === 'POTION') {
                const targetId = parseInt(itemId);
                const pot = this.player.potions.find(p => parseInt(p.item_id) === targetId);
                
                if (pot && pot.quantity > 0 && (!pot.cd || pot.cd <= 0)) {
                    this.applyEffect(this.player, pot.item_id);
                    pot.quantity--; 
                    trackConsumedPotion(pot.item_id); 
                    syncSessionLoadout(pot.item_id, pot.quantity);
                    // Recarga: Cura (0), Buffs (1 turno para evitar spam instantaneo visual)
                    pot.cd = ([43,44].includes(parseInt(pot.item_id))) ? 0 : 1;
                    actionResult.heal = 1; 
                } else {
                    return { ...this.getState(), actionResult, enemyActions };
                }
                return { ...this.getState(), actionResult, enemyActions };
            }

            if (actionType === 'ATTACK') {
                let dmgResult = this.calculateDamage(this.player, this.opponent);
                actionResult.dmg = dmgResult.value;
                actionResult.crit = dmgResult.isCrit;

                this.opponent.hp = Math.max(0, this.opponent.hp - dmgResult.value);
                
                if (this.opponent.hp <= 0) {
                    this.finished = true;
                    this.playerWon = true;
                    return { ...this.getState(), actionResult, enemyActions };
                }
                
                enemyActions = this.processEnemyAI();
                this.turn++;

                if (this.player.hp <= 0) {
                    this.finished = true;
                    this.playerWon = false;
                } else if (this.turn >= this.turnLimit) {
                    this.finished = true;
                    const pHp = this.player.hp / this.player.maxHp;
                    const oHp = this.opponent.hp / this.opponent.maxHp;
                    this.playerWon = pHp > oHp;
                }
            }
            return { ...this.getState(), actionResult, enemyActions };
        }

        processEnemyAI() {
            let actions = [];
            this.opponent.potions.forEach(p => { if(p.cd > 0) p.cd--; });

            for (let pot of this.opponent.potions) {
                if (pot.quantity > 0 && pot.cd <= 0) {
                    const pId = parseInt(pot.item_id);
                    // Lógica simples de IA
                    if ([43,44].includes(pId)) { // Cura
                        if (this.opponent.hp < (this.opponent.maxHp * 0.65)) {
                            let oldHp = this.opponent.hp;
                            this.applyEffect(this.opponent, pId);
                            let healedAmount = this.opponent.hp - oldHp;
                            pot.quantity--; pot.cd = 7; 
                            trackOpponentConsumption(this.opponent.id, pId);
                            actions.push({ type: 'POTION', itemId: pId, healed: healedAmount });
                        }
                    } else { // Buffs
                        let type = 'ATK';
                        if ([45,46].includes(pId)) type = 'FURY';
                        if ([47,48].includes(pId)) type = 'DEX';
                        if ([49,50].includes(pId)) type = 'ATK';
                        if (!this.hasBuff(this.opponent, type)) {
                             this.applyEffect(this.opponent, pId);
                             pot.quantity--; pot.cd = 15;
                             trackOpponentConsumption(this.opponent.id, pId);
                             actions.push({ type: 'POTION', itemId: pId });
                        }
                    }
                }
            }
            let dmgResult = this.calculateDamage(this.opponent, this.player);
            this.player.hp = Math.max(0, this.player.hp - dmgResult.value);
            actions.push({ type: 'ATTACK', dmg: dmgResult.value, crit: dmgResult.isCrit });
            return actions;
        }

        calculateDamage(attacker, defender) {
            let dmg = (parseInt(attacker.stats.min_attack) || 0) + this.random(0, 5);
            let mult = 1.0;
            if (this.hasBuff(attacker, 'ATK')) mult += (this.getBuffId(attacker, 'ATK') === 49 ? 0.05 : 0.10);
            dmg = Math.floor(dmg * mult);

            let critChance = (parseInt(attacker.stats.crit_chance) || 5);
            if (this.hasBuff(attacker, 'DEX')) critChance += (this.getBuffId(attacker, 'DEX') === 47 ? 5 : 10);

            let critMult = 1.5;
            if (this.hasBuff(attacker, 'FURY')) critMult = (this.getBuffId(attacker, 'FURY') === 45 ? 2.0 : 2.5);

            let isCrit = false;
            if (this.random(0, 100) < critChance) {
                dmg = Math.floor(dmg * critMult);
                isCrit = true;
            }
            return { value: dmg, isCrit: isCrit };
        }

        applyEffect(target, itemId) {
            const id = parseInt(itemId);
            if (id === 43) target.hp = Math.min(target.maxHp, target.hp + 500);
            else if (id === 44) target.hp = Math.min(target.maxHp, target.hp + 1000);
            else {
                let type = 'ATK';
                if ([45,46].includes(id)) type = 'FURY';
                if ([47,48].includes(id)) type = 'DEX';
                if ([49,50].includes(id)) type = 'ATK';
                target.buffs[type] = { item_id: id, ends_at: this.turn + 5 };
            }
        }

        skipBattle() {
            let safety = 0;
            while (!this.finished && safety < 200) { this.processTurn('ATTACK'); safety++; }
            return this.getState();
        }

        getState() {
            return {
                attacker_hp: this.player.hp,
                attacker_max_hp: this.player.maxHp,
                defender_hp: this.opponent.hp,
                defender_max_hp: this.opponent.maxHp,
                attacker_potions: this.player.potions,
                defender_potions: this.opponent.potions,
                attacker_buffs: this.player.buffs,
                defender_buffs: this.opponent.buffs,
                turn_count: this.turn,
                finished: this.finished,
                win: this.playerWon,
                opponent_id: this.opponent.id
            };
        }
    }

    // Variáveis de Sessão
    let currentSession = null;
    let currentOpponentIndex = 0;
    let sessionResults = [];
    let currentBattleEngine = null;

    let turnTimerInterval = null;
    let turnTimeLeft = 10;
    let isMyTurn = false;

    // Elementos DOM
    const loadingOverlay = document.getElementById("loading-overlay");
    const challengeBtn = document.getElementById("challengeBtn");
    const arenaAttemptsLeftSpan = document.getElementById("arenaAttemptsLeft");
    const skipBtn = document.getElementById("skip");

    const pvpCombatModal = document.getElementById("pvpCombatModal");
    const confirmModal = document.getElementById("confirmModal");
    const confirmMessage = document.getElementById("confirmMessage");
    const confirmTitle = document.getElementById("confirmTitle");
    let confirmActionBtn = document.getElementById("confirmActionBtn");

    const rankingModal = document.getElementById("rankingModal");
    const openRankingBtn = document.getElementById("openRankingBtn");
    const closeRankingBtn = document.getElementById("closeRankingBtn");
    const rankingList = document.getElementById("rankingList");
    const seasonInfoSpan = document.getElementById("seasonInfo");
    const rankingListPast = document.getElementById("rankingListPast");
    const rankingHistoryList = document.getElementById("rankingHistoryList");
    const seasonInfoContainer = document.getElementById("seasonInfoContainer");
    const seasonPastInfoSpan = document.getElementById("seasonPastInfo");

    const pvpCountdown = document.getElementById("pvpCountdown");
    const challengerSide = document.getElementById("challengerSide");
    const defenderSide = document.getElementById("defenderSide");
    const challengerName = document.getElementById("challengerName");
    const defenderName = document.getElementById("defenderName");
    const challengerAvatar = document.getElementById("challengerAvatar");
    const defenderAvatar = document.getElementById("defenderAvatar");
    const challengerHpFill = document.getElementById("challengerHpFill");
    const defenderHpFill = document.getElementById("defenderHpFill");
    const challengerHpText = document.getElementById("challengerHpText");
    const defenderHpText = document.getElementById("defenderHpText");
    
    const potionSelectModal = document.getElementById("potionSelectModal");
    const closePotionModalBtn = document.getElementById("closePotionModal");
    const potionListGrid = document.getElementById("potionListGrid");
    const potionSlots = document.querySelectorAll(".potion-slot");

    // =======================================================================
    // 5. SISTEMA DE ÁUDIO
    // =======================================================================
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffers = {};
    let backgroundMusic = null;
    let musicStarted = false;

    const audioFiles = {
        normal: "https://aden-rpg.pages.dev/assets/normal_hit.mp3",
        critical: "https://aden-rpg.pages.dev/assets/critical_hit.mp3",
        evade: "https://aden-rpg.pages.dev/assets/evade.mp3",
        streak3: "https://aden-rpg.pages.dev/assets/killingspree.mp3",
        streak4: "https://aden-rpg.pages.dev/assets/implacavel.mp3",
        streak5: "https://aden-rpg.pages.dev/assets/dominando.mp3",
        background: "https://aden-rpg.pages.dev/assets/arena.mp3",
        heal: "https://aden-rpg.pages.dev/assets/pot_cura.mp3",
        dex: "https://aden-rpg.pages.dev/assets/pot_dex.mp3",
        fury: "https://aden-rpg.pages.dev/assets/pot_furia.mp3",
        atk: "https://aden-rpg.pages.dev/assets/pot_atk.mp3",
        win: "https://aden-rpg.pages.dev/assets/win.mp3", 
        loss: "https://aden-rpg.pages.dev/assets/loss.mp3"
    };

    async function preload(name) {
        try {
            const url = audioFiles[name];
            if (!url) return;
            const res = await fetch(url);
            const ab = await res.arrayBuffer();
            audioBuffers[name] = await new Promise((resolve, reject) => {
                audioContext.decodeAudioData(ab, resolve, reject);
            });
        } catch (e) { audioBuffers[name] = null; }
    }
    Object.keys(audioFiles).forEach(key => preload(key));

    function playSound(name, opts = {}) {
        const vol = typeof opts.volume === 'number' ? opts.volume : 1;
        const buf = audioBuffers[name];
        if (buf && audioContext.state !== 'closed') {
            try {
                const source = audioContext.createBufferSource();
                source.buffer = buf;
                const gain = audioContext.createGain();
                gain.gain.value = vol;
                source.connect(gain).connect(audioContext.destination);
                source.start(0);
                return;
            } catch (err) {}
        }
        try {
            const a = new Audio(audioFiles[name] || audioFiles.normal);
            a.volume = Math.min(1, Math.max(0, vol));
            a.play().catch(e => {});
        } catch (e) {}
    }

    let sfxUnlocked = false;
    async function unlockSfx() {
        if (sfxUnlocked) return;
        sfxUnlocked = true;
        if (audioContext.state === 'suspended') { try { await audioContext.resume(); } catch(e){} }
    }

    function startBackgroundMusic() {
        if (musicStarted) return;
        if (!backgroundMusic) {
            backgroundMusic = new Audio(audioFiles.background);
            backgroundMusic.volume = 0.015;
            backgroundMusic.loop = true;
        }
        backgroundMusic.play().then(() => { musicStarted = true; }).catch(err => { musicStarted = false; });
    }

    function addCapturedListener(target, evt, handler, opts = {}) {
        try { target.addEventListener(evt, handler, Object.assign({ capture: true, passive: true, once: false }, opts)); } catch (e) {}
    }
    function resumeAudioContext() {
        if (audioContext.state === 'suspended') { audioContext.resume().catch(e => {}); }
    }
    const primaryEvents = ["click", "pointerdown", "touchstart", "mousedown", "keydown"];
    for (const ev of primaryEvents) {
        addCapturedListener(window, ev, () => {
            resumeAudioContext(); startBackgroundMusic(); unlockSfx();
        }, { once: true });
    }

    // =======================================================================
    // 6. UTILITÁRIOS E UI
    // =======================================================================
    function showLoading() { if (loadingOverlay) loadingOverlay.style.display = "flex"; }
    function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = "none"; }
    const esc = (s) => (s === 0 || s) ? String(s).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])) : "";

    function showModalAlert(message, title = "Aviso") {
        if (!confirmModal) { alert(message); return; }
        if (confirmTitle) confirmTitle.textContent = title;
        if (confirmMessage) confirmMessage.innerHTML = message;
        const newBtn = confirmActionBtn.cloneNode(true);
        confirmActionBtn.parentNode.replaceChild(newBtn, confirmActionBtn);
        confirmActionBtn = newBtn;
        confirmActionBtn.textContent = "Ok";
        confirmActionBtn.onclick = () => { confirmModal.style.display = 'none'; };
        confirmModal.style.display = 'flex';
    }

    const CACHE_TTL_24H_MIN = 4320;
    function setCache(key, data, ttlMinutes = CACHE_TTL_24H_MIN) {
        try { localStorage.setItem(key, JSON.stringify({ expires: Date.now() + ttlMinutes * 60000, data })); } catch {}
    }
    function getCache(key) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            if (Date.now() > parsed.expires) { localStorage.removeItem(key); return null; }
            return parsed.data;
        } catch { return null; }
    }

    function getMinutesToMidnightUTC() {
        const now = new Date();
        const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
        const diffMs = midnight - now;
        return Math.max(1, Math.floor(diffMs / 60000));
    }
    function getMinutesToNextMonthUTC() {
        const now = new Date();
        const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
        const diffMs = nextMonth - now;
        return Math.max(1, Math.floor(diffMs / 60000));
    }

    function normalizeRpcResult(data) {
        try {
            if (!data) return null;
            if (Array.isArray(data)) {
                const first = data[0];
                if (first && typeof first === 'object') {
                    const keys = Object.keys(first);
                    if (keys.length === 1 && typeof first[keys[0]] === 'object') return first[keys[0]];
                    return first;
                }
            }
            if (typeof data === 'string') { try { return normalizeRpcResult(JSON.parse(data)); } catch {} }
            return data;
        } catch (e) { return null; }
    }

    async function updateAttemptsUI() {
        if (!userId) return;
        try {
            if (currentSession && currentSession.attempts_left !== undefined) {
                if (arenaAttemptsLeftSpan) arenaAttemptsLeftSpan.textContent = currentSession.attempts_left - currentOpponentIndex;
            } else {
                const { data } = await supabase.from('players').select('arena_attempts_left').eq('id', userId).single();
                const attempts = data?.arena_attempts_left ?? 0;
                if (arenaAttemptsLeftSpan) arenaAttemptsLeftSpan.textContent = attempts;
                
                if (challengeBtn) {
                    if (attempts <= 0) {
                        challengeBtn.disabled = true;
                        challengeBtn.textContent = "Volte às 21h00";
                        challengeBtn.style.filter = "grayscale(1)";
                        challengeBtn.style.cursor = "not-allowed";
                    } else {
                        challengeBtn.disabled = false;
                        challengeBtn.textContent = "Desafiar";
                        challengeBtn.style.filter = "none";
                        challengeBtn.style.cursor = "pointer";
                    }
                }
            }
        } catch { if (arenaAttemptsLeftSpan) arenaAttemptsLeftSpan.textContent = "Erro"; }
    }

    const STREAK_KEY = 'arena_win_streak';
    const STREAK_DATE_KEY = 'arena_win_streak_date'; 
    function getTodayUTCDateString() {
        const now = new Date();
        return now.getUTCFullYear() + '-' + String(now.getUTCMonth()+1).padStart(2,'0') + '-' + String(now.getUTCDate()).padStart(2,'0');
    }
    function loadStreak() {
        try {
            const raw = localStorage.getItem(STREAK_KEY);
            const dateRaw = localStorage.getItem(STREAK_DATE_KEY);
            const today = getTodayUTCDateString();
            if (!dateRaw || dateRaw !== today) {
                localStorage.setItem(STREAK_KEY, "0");
                localStorage.setItem(STREAK_DATE_KEY, today);
                return 0;
            }
            return parseInt(raw, 10) || 0;
        } catch (e) { return 0; }
    }
    function saveStreak(n) {
        try {
            const today = getTodayUTCDateString();
            localStorage.setItem(STREAK_KEY, String(Math.max(0, Math.floor(n))));
            localStorage.setItem(STREAK_DATE_KEY, today);
        } catch (e) {}
    }
    let currentStreak = loadStreak();
    function ensureStreakDate() {
        try {
            const dateRaw = localStorage.getItem(STREAK_DATE_KEY);
            const today = getTodayUTCDateString();
            if (!dateRaw || dateRaw !== today) { currentStreak = 0; saveStreak(0); }
        } catch(e){}
    }
    ensureStreakDate();

    // =======================================================================
    // 7. LOADOUT E POÇÕES (OTIMIZADO COM DEFINITIONS LOCAIS)
    // =======================================================================
    async function loadArenaLoadout() {
        if (!userId) return;
        
        // RPC get_my_arena_loadout retorna item_id e slot_type. 
        // O restante (imagem) montamos aqui.
        const { data, error } = await supabase.rpc('get_my_arena_loadout');
        
        document.querySelectorAll('.potion-slot').forEach(el => {
            el.innerHTML = '<span style="display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; font-size:2em; color:#555; pointer-events:none;">+</span>';
            el.dataset.itemId = "";
            el.style.border = "1px dashed #555";
        });

        if (error) return console.error("Erro loadout:", error);
        
        if (data && Array.isArray(data)) {
            data.forEach(item => {
                const typeMap = item.slot_type.toLowerCase() === 'attack' ? 'atk' : 'def';
                const slotEl = document.getElementById(`slot-${typeMap}-${item.slot_index}`);
                if (slotEl) {
                    const itemName = getItemName(item.item_id);
                    const imgUrl = `https://aden-rpg.pages.dev/assets/itens/${itemName}.webp`;
                    slotEl.innerHTML = `<img src="${imgUrl}" onerror="this.style.display='none'" style="width:100%; height:100%; object-fit:contain; border-radius:4px;">`;
                    slotEl.dataset.itemId = item.item_id;
                    slotEl.style.border = "1px solid gold";
                }
            });
        }
    }

    potionSlots.forEach(slot => {
        slot.addEventListener('click', async () => {
            if (!potionSelectModal) return;
            potionSelectModal.style.display = 'flex';
            potionListGrid.innerHTML = '<p style="color:#fff;">Carregando...</p>';
            
            const allowedIds = [43, 44, 45, 46, 47, 48, 49, 50];
            
            // OTIMIZAÇÃO: Busca apenas ID e Quantidade
            const { data: items, error } = await supabase
                .from('inventory_items')
                .select('item_id, quantity')
                .in('item_id', allowedIds)
                .eq('player_id', userId)
                .gt('quantity', 0);

            potionListGrid.innerHTML = "";
            
            // Botão Remover
            const unequipBtn = document.createElement('div');
            unequipBtn.className = "inventory-item"; 
            unequipBtn.style.border = "1px solid red";
            unequipBtn.innerHTML = '<img src="https://aden-rpg.pages.dev/assets/expulsar.webp" alt="Remover" style="width: 50px; height: 50px; margin-bottom: 5px;"><small>Remover</small>';
            unequipBtn.onclick = async () => {
                showLoading();
                await supabase.rpc('unequip_arena_potion', { p_slot_type: slot.dataset.type.toUpperCase(), p_slot_index: parseInt(slot.dataset.index) });
                hideLoading();
                potionSelectModal.style.display = 'none';
                await loadArenaLoadout();
            };
            potionListGrid.appendChild(unequipBtn);

            if (!items || items.length === 0) {
                const msg = document.createElement('p');
                msg.textContent = "Sem poções de batalha.";
                msg.style.color = "#ccc";
                potionListGrid.appendChild(msg);
                return;
            }

            items.forEach(inv => {
                const div = document.createElement('div');
                div.className = "inventory-item";
                div.style.cursor = "pointer";
                
                // Usa Definições Locais
                const itemName = getItemName(inv.item_id);
                const displayName = getItemDisplayName(inv.item_id);
                
                div.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/itens/${itemName}.webp" style="width:50px; height:50px;">
                    <span class="item-quantity">${inv.quantity}</span>
                    <div style="font-size:0.7em; margin-top:5px; color:#fff;">${displayName}</div>
                `;
                div.onclick = async () => {
                    showLoading();
                    const { data: res, error: rpcErr } = await supabase.rpc('equip_arena_potion', { 
                        p_slot_type: slot.dataset.type.toUpperCase(), 
                        p_slot_index: parseInt(slot.dataset.index), 
                        p_item_id: inv.item_id 
                    });
                    hideLoading();
                    const result = normalizeRpcResult(res);
                    if (rpcErr || (result && result.success === false)) {
                        showModalAlert(result?.message || "Erro ao equipar poção.");
                    } else {
                        potionSelectModal.style.display = 'none';
                        await loadArenaLoadout();
                    }
                };
                potionListGrid.appendChild(div);
            });
        });
    });
    
    if (closePotionModalBtn) closePotionModalBtn.addEventListener('click', () => potionSelectModal.style.display = 'none');

    // =======================================================================
    // 8. LÓGICA DE COMBATE E UI
    // =======================================================================
    const style = document.createElement('style');
    style.innerHTML = `
        #attackBtnContainer:active { transform: scale(0.95); }
        .attack-anim { animation: attack-pulse 0.2s ease-in-out; }
        @keyframes attack-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
        .battle-potion-slot { transition: transform 0.2s; border: 1px solid #777; background: #000; border-radius: 4px; overflow: hidden; width: 40px; height: 40px; position: relative; }
        .potion-clickable:hover { transform: scale(1.1); border-color: gold; cursor: pointer; }
        .potion-disabled { filter: grayscale(1); cursor: not-allowed; opacity: 0.5; }
        @keyframes floatUpPotion { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.5); } 20% { opacity: 1; transform: translate(-50%, -20px) scale(1.2); } 100% { opacity: 0; transform: translate(-50%, -60px) scale(1); } }
        @keyframes blinkPotion { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.9); } }
    `;
    document.head.appendChild(style);

    const btnContainer = document.getElementById("attackBtnContainer");
    if (btnContainer) {
        const newBtn = btnContainer.cloneNode(true);
        btnContainer.parentNode.replaceChild(newBtn, btnContainer);
        newBtn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (isMyTurn) await performAction('ATTACK');
        });
        newBtn.style.cursor = "pointer";
        newBtn.style.pointerEvents = "auto";
    }

    if (skipBtn) {
        skipBtn.addEventListener("click", (e) => {
            if (skipBtn.disabled || skipBtn.style.opacity === "0.5") return;
            if (confirmTitle) confirmTitle.textContent = "Pular Combate?";
            if (confirmMessage) confirmMessage.innerHTML = "O sistema irá simular o restante da luta instantaneamente.<br>Isso não garante vitória!";
            const newBtn = confirmActionBtn.cloneNode(true);
            confirmActionBtn.parentNode.replaceChild(newBtn, confirmActionBtn); 
            confirmActionBtn = newBtn;
            confirmActionBtn.textContent = "Sim, Pular";
            confirmActionBtn.onclick = async () => {
                confirmModal.style.display = 'none';
                showLoading();
                try {
                    if (currentBattleEngine) {
                        const res = currentBattleEngine.skipBattle();
                        updatePvpHpBar(challengerHpFill, challengerHpText, res.win ? 1 : 0, 100);
                        updatePvpHpBar(defenderHpFill, defenderHpText, res.win ? 0 : 1, 100);
                        finishLocalFight(res);
                    }
                } catch (e) {
                    showModalAlert("Erro na simulação local.");
                } finally { hideLoading(); }
            };
            confirmModal.style.display = 'flex';
        });
    }
    
    // --- LÓGICA DE SESSÃO COM HIDRATAÇÃO ---
    async function handleChallengeClick() {
        if (!challengeBtn || challengeBtn.disabled) return;
        if (arenaAttemptsLeftSpan.textContent === '0') return;

        challengeBtn.disabled = true;
        showLoading();
        try {
            const savedSession = localStorage.getItem('arena_session_v1');
            if (savedSession) {
                currentSession = JSON.parse(savedSession);
                sessionResults = currentSession.results || [];
                currentOpponentIndex = sessionResults.length;
                startNextFight();
            } else {
                // RPC LEVE: Retorna ID e Stats
                const { data, error } = await supabase.rpc('get_arena_daily_session');
                const result = normalizeRpcResult(data);
                
                if (error || !result?.success) {
                    challengeBtn.disabled = false;
                    return showModalAlert(result?.message || "Erro ao buscar oponentes.");
                }

                // HIDRATAÇÃO: Busca nomes, avatares e nomes de guilda no Cache Global
                // Isso economiza banda baixando apenas o que falta
                const hydratedOpponents = await hydrateProfiles(result.opponents);

                currentSession = { ...result, opponents: hydratedOpponents };
                currentSession.results = [];
                currentOpponentIndex = 0;
                sessionResults = [];
                localStorage.setItem('arena_session_v1', JSON.stringify(currentSession));
                
                startNextFight();
            }
        } catch (e) {
            console.error("Erro no desafio:", e);
            challengeBtn.disabled = false;
            showModalAlert("Erro inesperado: " + (e?.message || e));
            hideLoading();
        } finally { hideLoading(); }
    }

    function startNextFight() {
        if (!currentSession || currentOpponentIndex >= currentSession.opponents.length) {
            commitSession();
            return;
        }

        const opponent = currentSession.opponents[currentOpponentIndex];
        const playerStats = currentSession.player_stats;
        const loadout = currentSession.loadout; 

        currentBattleEngine = new ArenaEngine(playerStats, opponent, loadout);
        const myInfo = { name: playerStats.name, avatar_url: playerStats.avatar_url };
        const oppInfo = { name: opponent.name, avatar_url: opponent.avatar_url };
        
        setupBattleUI(currentBattleEngine.getState(), myInfo, oppInfo);
        if (pvpCountdown) {
            pvpCountdown.style.display = 'block';
            pvpCountdown.textContent = `Luta ${currentOpponentIndex + 1} de ${currentSession.opponents.length}`;
            setTimeout(() => { pvpCountdown.style.display = 'none'; startPlayerTurn(); }, 2000);
        } else { startPlayerTurn(); }
    }

    function setupBattleUI(state, me, opp) {
        pvpCombatModal.style.display = "flex";
        document.getElementById("turnTimerContainer").style.display = "block";
        document.getElementById("combatControls").style.display = "flex";
        
        const defAvatar = 'https://aden-rpg.pages.dev/avatar01.webp';
        challengerName.textContent = me?.name || "Você";
        challengerAvatar.src = me?.avatar_url || defAvatar;
        defenderName.textContent = opp?.name || "Oponente";
        defenderAvatar.src = opp?.avatar_url || defAvatar;

        updateBattleStateUI(state);
        renderBattlePotions(challengerSide, state.attacker_potions, 'left', true); 
        renderBattlePotions(defenderSide, state.defender_potions, 'right', false); 
        
        if (skipBtn) {
            skipBtn.disabled = true;
            skipBtn.style.opacity = "0.5";
            skipBtn.style.cursor = "not-allowed";
        }
    }

    function startPlayerTurn() {
        isMyTurn = true;
        turnTimeLeft = 10; 
        
        if (skipBtn) {
            skipBtn.disabled = false;
            skipBtn.style.opacity = "1";
            skipBtn.style.cursor = "pointer";
        }

        const timerContainer = document.getElementById("turnTimerContainer");
        const attackBtn = document.getElementById("attackBtnContainer");
        if (timerContainer) timerContainer.style.opacity = "1";
        if (attackBtn) {
            attackBtn.style.filter = "none";
            attackBtn.style.opacity = "1";
            attackBtn.style.pointerEvents = "auto";
            attackBtn.classList.remove("attack-anim");
        }
        updateTimerUI();
        togglePlayerPotions(true);

        clearInterval(turnTimerInterval);
        turnTimerInterval = setInterval(() => {
            turnTimeLeft--;
            updateTimerUI();
            if (turnTimeLeft <= 0) { performAction('ATTACK'); }
        }, 1000);
    }

    function updateTimerUI() {
        const el = document.getElementById("turnTimerValue");
        const circle = document.getElementById("turnTimerCircle");
        if(el) el.textContent = turnTimeLeft;
        if(circle) circle.style.borderColor = (turnTimeLeft <= 3) ? "red" : "#FFC107";
    }

    function playPotionSound(itemId) {
        const id = parseInt(itemId);
        if ([43,44].includes(id)) playSound('heal');
        else if ([45,46].includes(id)) playSound('fury');
        else if ([47,48].includes(id)) playSound('dex');
        else if ([49,50].includes(id)) playSound('atk');
        else playSound('heal');
    }

    async function performAction(type, itemId = null) {
        if (!isMyTurn || !currentBattleEngine) return;
        
        if (type === 'ATTACK') {
            clearInterval(turnTimerInterval);
            isMyTurn = false;
            const attackBtn = document.getElementById("attackBtnContainer");
            if (attackBtn) {
                attackBtn.classList.add("attack-anim");
                attackBtn.style.pointerEvents = "none";
                attackBtn.style.filter = "grayscale(1)";
                attackBtn.style.opacity = "0.5"; 
            }
            if(skipBtn) skipBtn.disabled = true; 
            document.getElementById("turnTimerContainer").style.opacity = "0.3";
            togglePlayerPotions(false);
            animateActorMove(challengerSide);
        }

        try {
            const preState = currentBattleEngine.getState();
            const resultData = currentBattleEngine.processTurn(type, itemId);
            const newState = resultData; 
            const playerResult = resultData.actionResult;
            const enemyActions = resultData.enemyActions; 

            if (type === 'POTION') {
                updateBattleStateUI(newState);
                flashPotionIcon(itemId, challengerSide); 
                playPotionSound(itemId);
                renderBattlePotions(challengerSide, newState.attacker_potions, 'left', true);
                return; 
            }

            if (type === 'ATTACK') {
                const dmgDealt = playerResult.dmg || 0;
                await new Promise(r => setTimeout(r, 400));
                
                if (dmgDealt > 0 || (newState.finished && newState.win)) {
                    displayDamageNumber(dmgDealt, playerResult.crit, false, defenderSide);
                    updatePvpHpBar(defenderHpFill, defenderHpText, newState.defender_hp, preState.defender_max_hp);
                }

                if (newState.finished && newState.win) {
                    finishLocalFight(newState);
                    return;
                }

                if (enemyActions && enemyActions.length > 0) {
                    await new Promise(r => setTimeout(r, 800)); 
                    for (const action of enemyActions) {
                        if (action.type === 'POTION') {
                            flashPotionIcon(action.itemId, defenderSide);
                            playPotionSound(action.itemId);
                            updateBattleStateUI(currentBattleEngine.getState());
                            if (action.healed) {
                                displayDamageNumber(`+${action.healed}`, false, false, defenderSide);
                            }
                            await new Promise(r => setTimeout(r, 1000));
                        }
                        else if (action.type === 'ATTACK') {
                            animateActorMove(defenderSide);
                            await new Promise(r => setTimeout(r, 300));
                            const dmgReceived = action.dmg || 0;
                            displayDamageNumber(dmgReceived, action.crit, false, challengerSide);
                            updatePvpHpBar(challengerHpFill, challengerHpText, newState.attacker_hp, preState.attacker_max_hp);
                        }
                    }
                }

                if (newState.finished) {
                    await new Promise(r => setTimeout(r, 500));
                    finishLocalFight(newState);
                } else {
                    updateBattleStateUI(newState);
                    startPlayerTurn();
                }
            }
        } catch (e) {
            console.error(e);
            challengeBtn.disabled = false;
        }
    }

    function finishLocalFight(finalState) {
        clearInterval(turnTimerInterval);
        if (finalState.win) {
            playSound('win');
            try {
                ensureStreakDate();
                currentStreak++;
                saveStreak(currentStreak);
                if (currentStreak >= 5) playSound('streak5', { volume: 0.9 });
                else if (currentStreak === 4) playSound('streak4', { volume: 0.9 });
                else if (currentStreak === 3) playSound('streak3', { volume: 0.9 });
            } catch(e){}
        } else {
            playSound('loss');
            currentStreak = 0;
            saveStreak(0);
        }

        sessionResults.push({
            opponent_id: finalState.opponent_id,
            win: finalState.win,
            turn_count: finalState.turn_count
        });
        
        currentSession.results = sessionResults;
        localStorage.setItem('arena_session_v1', JSON.stringify(currentSession));
        currentOpponentIndex++;

        showModalAlert(
            finalState.win ? 
            `<strong style="color:#4CAF50;">Vitória!</strong><br>Prepare-se para a próxima luta.` : 
            `<strong style="color:#f44336;">Derrota!</strong><br>Prepare-se para a próxima luta.`,
            "Resultado da Luta"
        );

        const nextBtn = confirmActionBtn;
        if (currentOpponentIndex >= currentSession.opponents.length) {
            nextBtn.textContent = "Ver Resultados Finais";
            nextBtn.onclick = () => { confirmModal.style.display = 'none'; commitSession(); };
        } else {
            nextBtn.textContent = "Próxima Luta >>";
            nextBtn.onclick = () => { confirmModal.style.display = 'none'; startNextFight(); };
        }
    }

    async function commitSession() {
        pvpCombatModal.style.display = "none";
        showLoading();
        try {
            const consumedArray = Object.keys(sessionConsumedPotions).map(k => ({
                item_id: parseInt(k),
                qty: sessionConsumedPotions[k]
            }));

            let opponentsConsumedArray = [];
            Object.keys(sessionOpponentsConsumed).forEach(oppId => {
                const itemsMap = sessionOpponentsConsumed[oppId];
                Object.keys(itemsMap).forEach(itemId => {
                    opponentsConsumedArray.push({
                        opponent_id: oppId,
                        item_id: parseInt(itemId),
                        qty: itemsMap[itemId]
                    });
                });
            });

            const { data, error } = await supabase.rpc('commit_arena_session_results', { 
                p_results: sessionResults,
                p_consumed_items: consumedArray,
                p_opponents_consumed: opponentsConsumedArray
            });

            if (error) throw error;
            const res = normalizeRpcResult(data);
            
            // =======================================================
            // ATUALIZAÇÃO CIRÚRGICA DE CACHE (ZERO EGRESS)
            // =======================================================
            if (res.timestamp && res.inventory_updates) {
                let currentCrystals = 0;

                // 1. Atualiza Stats Globais no Cache (LocalStorage - Legacy)
                const cached = localStorage.getItem('player_data_cache');
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        if (parsed && parsed.data) {
                            if (typeof res.crystals === 'number') {
                                parsed.data.crystals = (parsed.data.crystals || 0) + res.crystals;
                                currentCrystals = parsed.data.crystals; 
                            }
                            localStorage.setItem('player_data_cache', JSON.stringify(parsed));
                        }
                    } catch(e) {}
                }

                // 2. Atualiza GlobalDB (Novo Padrão)
                let updateData = {};
                if (currentCrystals > 0) {
                     updateData.crystals = currentCrystals;
                } else {
                     const gPlayer = await GlobalDB.getPlayer();
                     if (gPlayer) {
                         updateData.crystals = (gPlayer.crystals || 0) + (res.crystals || 0);
                     }
                }
                
                // Salva inventário atualizado
                await surgicalCacheUpdate(res.inventory_updates, res.timestamp, updateData);
            }
            
            localStorage.removeItem('arena_session_v1');
            currentSession = null;
            sessionResults = [];
            currentBattleEngine = null;
            sessionConsumedPotions = {}; 
            sessionOpponentsConsumed = {};

            let msg = `Sessão Finalizada!<br>Vitórias: <strong>${res.total_wins}</strong><br>Pontos Líquidos: ${res.points_gained}`;
            let itemsHTML = [];
            const st = "display:flex; align-items:center; background:rgba(0,0,0,0.4); padding:6px 10px; border-radius:5px; margin:2px; font-weight:bold; border: 1px solid #555;";
            const imS = "width:28px; height:28px; margin-right:8px; object-fit:contain;";
            if(res.crystals > 0) itemsHTML.push(`<div style="${st}"><img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="${imS}"> +${res.crystals}</div>`);
            if(res.items_common > 0) itemsHTML.push(`<div style="${st}"><img src="https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_comum.webp" style="${imS}"> +${res.items_common}</div>`);
            if(res.items_rare > 0) itemsHTML.push(`<div style="${st}"><img src="https://aden-rpg.pages.dev/assets/itens/cartao_de_espiral_avancado.webp" style="${imS}"> +${res.items_rare}</div>`);
            
            let rewardsHTML = itemsHTML.length ? `<div style="display:flex; flex-wrap:wrap; justify-content:center; margin-top:15px; gap:8px; border-top:1px dashed #555; padding-top:10px;">${itemsHTML.join('')}</div>` : "";
            showModalAlert(msg + rewardsHTML, "Resumo Diário");
            
            challengeBtn.disabled = false;
            await loadArenaLoadout();
            await updateAttemptsUI();
        } catch (e) { showModalAlert("Erro ao salvar resultados: " + e.message); } finally { hideLoading(); }
    }

    // --- Helpers Visuais ---
    function updateBattleStateUI(state) {
        if (!state) return;
        updatePvpHpBar(challengerHpFill, challengerHpText, state.attacker_hp, state.attacker_max_hp);
        updatePvpHpBar(defenderHpFill, defenderHpText, state.defender_hp, state.defender_max_hp);
        renderActiveBuffs(challengerSide, state.attacker_buffs, state.turn_count);
        renderActiveBuffs(defenderSide, state.defender_buffs, state.turn_count);
        if (state.attacker_potions) renderBattlePotions(challengerSide, state.attacker_potions, 'left', true);
    }

    function renderActiveBuffs(container, buffs, currentTurn) {
        const old = container.querySelector('.active-buffs-row');
        if (old) old.remove();
        if (!buffs) return;
        const row = document.createElement('div');
        row.className = 'active-buffs-row';
        row.style.cssText = 'position:absolute; top: 115px; width: 100%; display: flex; justify-content: center; gap: 5px; z-index: 10; pointer-events: none;';
        Object.keys(buffs).forEach(key => {
            const buff = buffs[key];
            if (buff.ends_at > currentTurn) { 
                const img = document.createElement('img');
                const itemId = parseInt(buff.item_id);
                // USA CACHE LOCAL
                const itemName = getItemName(itemId);
                img.src = `https://aden-rpg.pages.dev/assets/itens/${itemName}.webp`;
                img.style.width = '35px'; img.style.height = '35px';
                img.style.animation = 'blinkPotion 1s infinite alternate';
                img.title = key;
                row.appendChild(img);
            }
        });
        if (row.children.length > 0) container.appendChild(row);
    }

    function renderBattlePotions(container, potions, side, interactive) {
        const old = container.querySelector('.battle-potions-container');
        if (old) old.remove();
        if (!potions || !potions.length) return;
        const ct = document.createElement('div');
        ct.className = 'battle-potions-container';
        ct.style.cssText = "position:absolute; top:60px; display:flex; flex-direction:column; gap:8px; z-index:20; background:rgba(0,0,0,0.5); padding:4px; border-radius:6px;";
        if(side === 'left') ct.style.left = "-25px"; else ct.style.right = "-25px";
        potions.forEach(p => {
            const qty = parseInt(p.quantity || 0);
            if (qty <= 0) return; 
            const slot = document.createElement('div');
            slot.className = 'battle-potion-slot';
            const cd = parseInt(p.cd || 0);
            if (interactive && cd <= 0) {
                slot.classList.add('potion-clickable');
                slot.onclick = (e) => { e.stopPropagation(); performAction('POTION', p.item_id); };
            } else if (interactive) {
                slot.classList.add('potion-disabled');
            } else {
                 slot.style.filter = "grayscale(1)"; slot.style.opacity = "0.7";
            }
            const itemId = parseInt(p.item_id);
            // USA CACHE LOCAL
            const name = getItemName(itemId);
            const cdHeight = (cd > 0) ? "100%" : "0%";
            slot.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/itens/${name}.webp" style="width:100%;height:100%;object-fit:contain;"><span style="position:absolute; bottom:0; right:0; font-size:0.7em; color:white; background:rgba(0,0,0,0.7); padding:1px;">${qty}</span><div class="cooldown-overlay" style="position:absolute;bottom:0;left:0;width:100%;height:${cdHeight};background:rgba(0,0,0,0.7);transition:height 0.3s;"></div>`;
            ct.appendChild(slot);
        });
        container.appendChild(ct);
    }

    function togglePlayerPotions(enable) {
        const slots = document.querySelectorAll('.battle-potion-slot.potion-clickable');
        slots.forEach(s => { s.style.pointerEvents = enable ? 'auto' : 'none'; s.style.filter = enable ? 'none' : 'grayscale(0.5)'; });
    }

    function updatePvpHpBar(el, txt, cur, max) {
        if (!el) return;
        const pct = Math.max(0, Math.min(100, (cur / (max || 1)) * 100));
        el.style.width = pct + '%';
        if (txt) txt.textContent = `${Math.floor(cur).toLocaleString()} / ${max.toLocaleString()}`;
    }

    function displayDamageNumber(dmg, crit, evd, target) {
        if (!target) return;
        const el = document.createElement("div");
        if (evd) {
            el.textContent = "Desviou"; el.className = "evade-text"; playSound('evade', { volume: 0.3 });
        } else {
            const val = (typeof dmg === 'number') ? dmg.toLocaleString() : dmg;
            el.textContent = val;
            el.className = crit ? "crit-damage-number" : "damage-number";
            if(typeof dmg === 'number' || !String(dmg).includes('+')) playSound(crit ? 'critical' : 'normal', { volume: crit ? 0.1 : 0.5 });
        }
        target.appendChild(el);
        el.addEventListener("animationend", () => el.remove());
        setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
    }

    function flashPotionIcon(itemId, sideElement) {
        const img = document.createElement("img");
        const iId = parseInt(itemId);
        // USA CACHE LOCAL
        const itemName = getItemName(iId); 
        img.src = `https://aden-rpg.pages.dev/assets/itens/${itemName}.webp`; 
        img.style.cssText = "position:absolute; top:50%; left:50%; width:50px; height:50px; z-index:25; animation: floatUpPotion 1s ease-out forwards;";
        sideElement.appendChild(img);
        setTimeout(() => img.remove(), 1000);
    }
    
    function animateActorMove(element) {
        element.style.transition = "transform 0.1s";
        element.style.transform = "scale(1.1) translateY(-10px)";
        setTimeout(() => { element.style.transform = "scale(1) translateY(0)"; }, 150);
    }

    // =======================================================================
    // 9. RANKING E SISTEMA (COM HIDRATAÇÃO ZERO EGRESS)
    // =======================================================================

    function renderFixedFooter(playerData) {
        const container = document.getElementById('fixedArenaRank');
        if (!container) return;

        if (!playerData) {
            container.style.display = 'none';
            return;
        }

        const avatar = playerData.avatar_url || playerData.avatar || 'https://aden-rpg.pages.dev/avatar01.webp';
        
        container.innerHTML = `
            <div class="fixed-rank-inner">
                 <span class="fixed-rank-pos">${playerData.rank}º</span>
                 <img class="fixed-rank-avatar" src="${esc(avatar)}" onerror="this.src='https://aden-rpg.pages.dev/avatar01.webp'">
                 <div class="fixed-rank-info">
                     <span class="fixed-rank-name">${esc(playerData.name)}</span>
                     <span class="fixed-rank-guild">${esc(playerData.guild_name || 'Sem Guilda')}</span>
                 </div>
                 <span class="fixed-rank-points">${Number(playerData.ranking_points || 0).toLocaleString()} pts</span>
            </div>
        `;
        container.style.display = 'block';
    }

    async function fetchAndRenderRanking() {
        showLoading();
        // Esconde barra fixa ao começar a carregar
        const footer = document.getElementById('fixedArenaRank');
        if(footer) footer.style.display = 'none';

        try {
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'block'; 
            
            // Limpa cache antigo se não tiver ID (para migração)
            let rawCache = localStorage.getItem('arena_top_100_cache');
            if(rawCache && !rawCache.includes('"id"')) {
                localStorage.removeItem('arena_top_100_cache');
            }

            let rankingData = getCache('arena_top_100_cache');
            
            if (!rankingData) { 
                // RPC LEVE (Esqueleto)
                const { data: rpcData, error: rpcError } = await supabase.rpc('get_arena_top_100');
                
                if (rpcError) rankingData = await fallbackFetchTopPlayers();
                else {
                    const result = normalizeRpcResult(rpcData);
                    if (result?.success && Array.isArray(result.ranking)) {
                        // HIDRATAÇÃO DO RANKING (Agora busca nome da guilda corretamente)
                        rankingData = await hydrateProfiles(result.ranking);
                        if (rankingData.length > 0) setCache('arena_top_100_cache', rankingData, getMinutesToMidnightUTC());
                    } else rankingData = await fallbackFetchTopPlayers();
                }
            }
            renderRanking(rankingData || []); 

            // === LÓGICA DO RODAPÉ FIXO (ATUAL) ===
            if (userId) {
                let myRankObj = null;
                // 1. Verifica se estou no Top 100 baixado
                const myIndex = rankingData.findIndex(p => p.id === userId);
                
                if (myIndex !== -1) {
                    myRankObj = { ...rankingData[myIndex], rank: myIndex + 1 };
                } else {
                    // 2. Se não estiver no Top 100, busca meus dados e calcula rank via Count no DB
                    try {
                        const { data: me } = await supabase
                            .from('players')
                            .select('id, name, avatar_url, ranking_points, guild_id')
                            .eq('id', userId)
                            .single();
                        
                        if (me) {
                            // Conta quantos têm mais pontos que eu
                            const { count } = await supabase
                                .from('players')
                                .select('*', { count: 'exact', head: true })
                                .gt('ranking_points', me.ranking_points)
                                .neq('is_banned', true);
                            
                            let gName = 'Sem Guilda';
                            if (me.guild_id) {
                                const { data: g } = await supabase.from('guilds').select('name').eq('id', me.guild_id).single();
                                if(g) gName = g.name;
                            }

                            myRankObj = {
                                name: me.name,
                                avatar_url: me.avatar_url,
                                ranking_points: me.ranking_points,
                                guild_name: gName,
                                rank: (count || 0) + 1
                            };
                        }
                    } catch(e) { console.warn("Erro ao calcular rank pessoal", e); }
                }
                
                if (myRankObj) renderFixedFooter(myRankObj);
            }

            if (rankingModal) rankingModal.style.display = 'flex';
        } catch (e) { showModalAlert("Erro ao carregar ranking."); } finally { hideLoading(); }
    }

    async function fallbackFetchTopPlayers() {
        try {
            const { data: players } = await supabase.from('players').select('id, name, avatar_url, avatar, ranking_points, guild_id').neq('is_banned', true).order('ranking_points', { ascending: false }).limit(10);
            if (!players || players.length === 0) return [];
            const guildIds = [...new Set(players.map(p => p.guild_id).filter(Boolean))];
            let guildsMap = {};
            if (guildIds.length) {
                const { data: guilds } = await supabase.from('guilds').select('id, name').in('id', guildIds);
                if (guilds) guildsMap = Object.fromEntries(guilds.map(g => [g.id, g.name]));
            }
            return players.map(p => ({
                id: p.id,
                name: p.name,
                avatar_url: p.avatar_url || p.avatar || 'https://aden-rpg.pages.dev/avatar01.webp',
                ranking_points: p.ranking_points,
                guild_name: p.guild_id ? (guildsMap[p.guild_id] || 'Sem Guilda') : 'Sem Guilda'
            }));
        } catch { return []; }
    }

    function renderRanking(data) {
        if (seasonInfoSpan) {
            const now = new Date();
            const month = now.toLocaleString('pt-BR', { month: 'long' });
            seasonInfoSpan.innerHTML = `<strong>Temporada<br> ${month[0].toUpperCase() + month.slice(1)} / ${now.getFullYear()}</strong>`;
        }
        if (!rankingList) return;
        rankingList.innerHTML = "";
        if (!data || !data.length) { rankingList.innerHTML = "<li style='text-align:center; padding: 20px; color: #aaa;'>Nenhum jogador classificado ainda.</li>"; return; }
        const defaultAvatar = 'https://aden-rpg.pages.dev/avatar01.webp';
        for (const [i, p] of data.entries()) {
            const avatar = p.avatar_url || p.avatar || defaultAvatar;
            const li = document.createElement("li");
            li.innerHTML = `<span class="rank-position">${i + 1}.</span><img src="${esc(avatar)}" onerror="this.src='${defaultAvatar}'" class="rank-avatar"><div class="rank-player-info"><span class="rank-player-name">${esc(p.name)}</span><span class="rank-guild-name">${esc(p.guild_name) || 'Sem Guilda'}</span></div><span class="rank-points">${Number(p.ranking_points || 0).toLocaleString()} pts</span>`;
            rankingList.appendChild(li);
        }
    }

    async function fetchPastSeasonRanking() {
        showLoading();
        // Esconde footer no passado
        const footer = document.getElementById('fixedArenaRank');
        if(footer) footer.style.display = 'none';

        try {
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'none';
            if (rankingListPast) rankingListPast.innerHTML = "";
            if (seasonPastInfoSpan) seasonPastInfoSpan.textContent = "Carregando...";

            let d = getCache('arena_last_season_cache');
            let snap = null;
            if (!d) {
                try {
                    // RPC LEVE
                    const { data: rpcData } = await supabase.rpc('get_arena_top_100_past');
                    let r = normalizeRpcResult(rpcData);
                    let candidate = null;
                    if (Array.isArray(r)) candidate = r;
                    else if (r?.ranking && Array.isArray(r.ranking)) candidate = r.ranking;
                    else if (r?.result?.ranking) candidate = r.result.ranking;
                    
                    if (Array.isArray(candidate) && candidate.length) {
                        // HIDRATAÇÃO (Busca nome da guilda se necessário)
                        d = await hydrateProfiles(candidate);
                        setCache('arena_last_season_cache', d, getMinutesToNextMonthUTC());
                    }
                } catch {}
                
                if (!d) {
                    const { data: snaps } = await supabase.from('arena_season_snapshots').select('ranking, season_year, season_month, created_at').order('created_at', { ascending: false }).limit(1);
                    if (snaps && snaps.length > 0) {
                        snap = snaps[0];
                        let rv = snap.ranking;
                        if (typeof rv === 'string') try { rv = JSON.parse(rv); } catch {}
                        if (Array.isArray(rv)) { 
                            // Snapshots antigos já podem ter nomes, mas se não tiverem, hidratamos
                            d = await hydrateProfiles(rv);
                            setCache('arena_last_season_cache', d, getMinutesToNextMonthUTC()); 
                        }
                    }
                }
            }
            
            let seasonInfoText = "Temporada Anterior";
            if (snap && snap.season_month) {
                const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
                seasonInfoText = `Temporada: ${monthNames[snap.season_month - 1] || snap.season_month} / ${snap.season_year}`;
            }
            if (seasonPastInfoSpan) seasonPastInfoSpan.textContent = seasonInfoText;

            if (!d || !d.length) {
                if (rankingListPast) rankingListPast.innerHTML = "<li style='padding:12px;text-align:center;color:#aaa;'>Ainda não houve temporada passada.</li>";
            } else {
                rankingListPast.innerHTML = "";
                const defAv = 'https://aden-rpg.pages.dev/avatar01.webp';
                d.forEach((p, i) => {
                    const av = p.avatar_url || p.avatar || defAv;
                    rankingListPast.innerHTML += `<li id="rankingListPast" style="width: 82vw;"><span style="width:40px;font-weight:bold;color:#FFC107;">${i+1}.</span><img class="rank-avatar" src="${esc(av)}" onerror="this.src='${defAv}'" style="width:45px;height:45px;border-radius:50%"><div style="flex-grow:1;text-align:left;"><div class="rank-player-name">${esc(p.name)}</div><div class="rank-guild-name" style="font-weight: bold;">${esc(p.guild_name||'Sem Guilda')}</div></div><div class="rank-points">${Number(p.ranking_points||0).toLocaleString()} pts</div></li>`;
                });

                // === LÓGICA DO RODAPÉ FIXO (PASSADO) ===
                if (userId) {
                    const myIndex = d.findIndex(p => p.id === userId);
                    if (myIndex !== -1) {
                        const myRankObj = { ...d[myIndex], rank: myIndex + 1 };
                        renderFixedFooter(myRankObj);
                    }
                }
            }
            if (rankingModal) rankingModal.style.display = 'flex';
        } catch { showModalAlert("Erro ao carregar temporada passada."); } finally { hideLoading(); }
    }

    async function fetchAttackHistory() {
        showLoading();
        // Esconde footer no histórico
        const footer = document.getElementById('fixedArenaRank');
        if(footer) footer.style.display = 'none';

        try {
            if (seasonInfoContainer) seasonInfoContainer.style.display = 'none';
            if (rankingHistoryList) rankingHistoryList.innerHTML = "";
            const cacheKey = 'arena_attack_history';
            let h = getCache(cacheKey);
            if (!h) {
                supabase.rpc('cleanup_old_arena_logs').then(()=>{});
                const { data } = await supabase.rpc('get_arena_attack_logs');
                const r = normalizeRpcResult(data);
                if (r?.success && Array.isArray(r.logs) && r.logs.length) {
                    h = r.logs; 
                    setCache(cacheKey, h, getMinutesToMidnightUTC());
                } else if (userId) {
                    const { data: logsDirect } = await supabase.from('arena_attack_logs').select('*').eq('defender_id', userId).order('created_at', { ascending: false }).limit(5);
                    if (logsDirect) { 
                        h = logsDirect; 
                        setCache(cacheKey, h, getMinutesToMidnightUTC()); 
                    }
                }
            }
            if (!h || !h.length) rankingHistoryList.innerHTML = "<li style='padding:12px;text-align:center;color:#aaa;'>Sem registros.</li>";
            else {
                rankingHistoryList.innerHTML = "";
                h.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).forEach(l => {
                    const date = new Date(l.created_at).toLocaleString('pt-BR');
                    const attackerWon = String(l.attacker_won) === 'true' || l.attacker_won === true;
                    const msg = attackerWon ? `${esc(l.attacker_name)} atacou você e venceu. Você perdeu ${Number(l.points_taken).toLocaleString()} pts.` : `${esc(l.attacker_name)} atacou você e perdeu. Você tomou ${Number(l.points_taken).toLocaleString()} pts.`;
                    rankingHistoryList.innerHTML += `<li style='padding:8px;border-bottom:1px solid #444;color:#ddd;'><strong>${date}</strong><br>${msg}</li>`;
                });
            }
            if (rankingModal) rankingModal.style.display = 'flex';
        } catch { showModalAlert("Erro ao carregar histórico."); } finally { hideLoading(); }
    }

    function initRankingTabs() {
        const tabs = document.querySelectorAll(".ranking-tab");
        if (!tabs.length) return;
        tabs.forEach(tab => {
            tab.addEventListener("click", async () => {
                // Esconde footer ao trocar de aba
                const footer = document.getElementById('fixedArenaRank');
                if(footer) footer.style.display = 'none';

                tabs.forEach(t => { t.classList.remove("active"); t.style.background = "none"; t.style.color = "#e0dccc"; });
                tab.classList.add("active"); tab.style.background = "#c9a94a"; tab.style.color = "#000";
                document.querySelectorAll(".tab-panel").forEach(p => { p.classList.remove("active"); p.style.display = 'none'; });
                const tn = tab.dataset.tab;
                if (tn === 'current') { document.getElementById('rankingCurrent').style.display = 'block'; await fetchAndRenderRanking(); }
                else if (tn === 'past') { document.getElementById('rankingPast').style.display = 'block'; await fetchPastSeasonRanking(); }
                else { document.getElementById('rankingHistory').style.display = 'block'; await fetchAttackHistory(); }
            });
        });
    }

    async function checkAndResetArenaSeason() {
        try {
            const now = new Date();
            if (now.getUTCDate() !== 1) return;
            const lastResetRaw = localStorage.getItem('arena_last_season_reset');
            const keyData = lastResetRaw ? JSON.parse(lastResetRaw) : null;
            if (keyData && keyData.month === (now.getUTCMonth() + 1)) return;
            localStorage.removeItem('arena_top_100_cache');
            localStorage.removeItem('arena_last_season_cache');
            const { data } = await supabase.rpc('reset_arena_season');
            const r = normalizeRpcResult(data);
            if (r?.success) localStorage.setItem('arena_last_season_reset', JSON.stringify({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }));
        } catch {}
    }

    async function checkAndResetDailyAttempts() {
        const todayKey = getTodayUTCDateString();
        const lastCheck = localStorage.getItem('arena_last_daily_check');
        if (lastCheck !== todayKey) {
            try {
                await supabase.rpc('reset_arena_daily_attempts');
                localStorage.setItem('arena_last_daily_check', todayKey);
            } catch(e) { console.error("Falha ao resetar tentativas diárias", e); }
        }
    }

    async function boot() {
        showLoading();
        try {
            userId = await getLocalUserId();
            if (!userId) {
                if (typeof session === 'undefined' || !session) { 
                     window.location.href = "index.html"; 
                     return; 
                }
                userId = session.user.id;
            }

            if (localStorage.getItem('arena_session_v1')) handleChallengeClick();
            
            await checkAndResetArenaSeason();
            await checkAndResetDailyAttempts();
            await updateAttemptsUI();
            ensureStreakDate();
            await loadArenaLoadout();
        } catch (e) {
            console.error("Erro no boot:", e);
            if (e.message && (e.message.includes('JWT') || e.message.includes('auth'))) { window.location.href = "index.html"; }
        } finally { hideLoading(); }
    }

    window.addEventListener('beforeunload', (e) => {
        if (currentSession && currentSession.results.length > 0 && currentSession.results.length < currentSession.opponents.length) {
            // Lógica opcional de aviso de saída
        }
    });

    if (challengeBtn) challengeBtn.addEventListener("click", handleChallengeClick);
    if (openRankingBtn) openRankingBtn.addEventListener("click", () => { document.querySelector(".ranking-tab[data-tab='current']").click(); });
    
    if (closeRankingBtn) closeRankingBtn.addEventListener("click", () => { 
        if (rankingModal) rankingModal.style.display = 'none';
        const footer = document.getElementById('fixedArenaRank');
        if(footer) footer.style.display = 'none';
    });
    
    initRankingTabs();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === 'hidden' && backgroundMusic && !backgroundMusic.paused) backgroundMusic.pause();
      else if (document.visibilityState === 'visible' && musicStarted && backgroundMusic && backgroundMusic.paused) backgroundMusic.play().catch(()=>{});
    });

    boot();
});