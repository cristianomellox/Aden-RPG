import { supabase } from './supabaseClient.js'

// =======================================================================
// ADEN GLOBAL DB (CACHE V3: Zero Egress + IndexedDB Persistent)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 3; 
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';
const OWNERS_STORE = 'owners_store'; 

const OWNERS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 Horas em milissegundos

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                console.warn("IndexedDB não suportado neste navegador.");
                return resolve(null); // Fallback silencioso
            }
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                // Stores originais
                if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(PLAYER_STORE)) db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
                // Nova Store de Donos (Chave primária: ID do jogador)
                if (!db.objectStoreNames.contains(OWNERS_STORE)) {
                    db.createObjectStore(OWNERS_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            if (!db) return null;
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
            if (!db) return null;
            return new Promise((resolve) => {
                const tx = db.transaction(PLAYER_STORE, 'readonly');
                const req = tx.objectStore(PLAYER_STORE).get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    setPlayer: async function(playerData) {
        try {
            const db = await this.open();
            if (!db) return;
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            tx.objectStore(PLAYER_STORE).put({ key: 'player_data', value: playerData });
        } catch(e) { console.warn("Erro ao salvar Player no DB Global", e); }
    },
    updatePlayerPartial: async function(changes) {
        try {
            const db = await this.open();
            if (!db) return;
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
            }
        } catch(e) { console.warn("Erro update parcial", e); }
    },
    // --- OWNER CACHE V3 ---
    getAllOwners: async function() {
        try {
            const db = await this.open();
            if (!db) return {};
            return new Promise((resolve) => {
                const tx = db.transaction(OWNERS_STORE, 'readonly');
                const store = tx.objectStore(OWNERS_STORE);
                const req = store.getAll();
                req.onsuccess = () => {
                    const result = req.result || [];
                    const validOwners = {};
                    const now = Date.now();
                    
                    result.forEach(owner => {
                        // Verifica expiração
                        if (owner.timestamp && (now - owner.timestamp < OWNERS_CACHE_TTL)) {
                            validOwners[owner.id] = owner;
                        }
                    });
                    resolve(validOwners);
                };
                req.onerror = () => resolve({});
            });
        } catch(e) { 
            console.warn("Erro ao ler cache de donos:", e);
            return {}; 
        }
    },
    saveOwners: async function(ownersList) {
        if (!ownersList || ownersList.length === 0) return;
        try {
            const db = await this.open();
            if (!db) return;
            const tx = db.transaction(OWNERS_STORE, 'readwrite');
            const store = tx.objectStore(OWNERS_STORE);
            const now = Date.now();

            ownersList.forEach(o => {
                // Suporta formato minificado (do RPC) ou verbose (da tabela)
                const cacheObj = {
                    id: o.id || o.i,
                    name: o.name || o.n,
                    avatar_url: o.avatar_url || o.a,
                    guild_id: o.guild_id || o.g,
                    timestamp: now 
                };

                if (cacheObj.id) {
                    store.put(cacheObj);
                }
            });

            return new Promise(resolve => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch(e) {
            console.warn("Erro ao salvar donos no cache:", e);
        }
    }
};

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[mines] DOM ready - Versão Completa Otimizada (V5 - Integrada)");

  // =================================================================
  // 1. ÁUDIO SYSTEM
  // =================================================================
  const audioFiles = {
    normal: "https://aden-rpg.pages.dev/assets/normal_hit.mp3",
    critical: "https://aden-rpg.pages.dev/assets/critical_hit.mp3",
    evade: "https://aden-rpg.pages.dev/assets/evade.mp3",
    ambient: "https://aden-rpg.pages.dev/assets/mina.mp3",
    avisoTela: "https://aden-rpg.pages.dev/assets/avisotela.mp3",
    obrigado: "https://aden-rpg.pages.dev/assets/obrigado.mp3"
  };

  const audioBuffers = {};
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  async function decodeAudioDataCompat(arrayBuffer) {
    try {
      return await new Promise((resolve, reject) => {
        audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      });
    } catch (err) {
      console.warn("[audio] decodeAudioData compat falhou:", err);
      throw err;
    }
  }

  async function preload(name) {
    try {
      const res = await fetch(audioFiles[name], { cache: 'force-cache' });
      if (!res.ok) throw new Error("fetch " + res.status);
      const ab = await res.arrayBuffer();
      audioBuffers[name] = await decodeAudioDataCompat(ab);
    } catch (e) {
      console.warn(`[audio] preload ${name} falhou, fallback ativado:`, e);
      audioBuffers[name] = null;
    }
  }

  // Preload sons curtos essenciais
  preload('normal');
  preload('critical');
  preload('evade');

  const ambientMusic = new Audio(audioFiles.ambient);
  ambientMusic.volume = 0.05;
  ambientMusic.loop = true;

  const avisoTelaSound = new Audio(audioFiles.avisoTela);
  avisoTelaSound.volume = 0.5;
  const obrigadoSound = new Audio(audioFiles.obrigado);
  obrigadoSound.volume = 0.5;

  // Desbloqueio de áudio no primeiro clique
  document.addEventListener("click", async () => {
    try { if (audioContext.state === 'suspended') await audioContext.resume(); } catch(e) {}
    avisoTelaSound.play().then(()=> { avisoTelaSound.pause(); avisoTelaSound.currentTime = 0; }).catch(()=>{});
    obrigadoSound.play().then(()=> { obrigadoSound.pause(); obrigadoSound.currentTime = 0; }).catch(()=>{});
  }, { once: true });

  function playSound(name, opts = {}) {
    const vol = (typeof opts.volume === 'number') ? opts.volume : 1;
    const buf = audioBuffers[name];
    if (buf && audioContext && audioContext.state !== 'closed') {
      try {
        const source = audioContext.createBufferSource();
        source.buffer = buf;
        const gain = audioContext.createGain();
        gain.gain.value = vol;
        source.connect(gain).connect(audioContext.destination);
        source.start(0);
        source.onended = () => { try { source.disconnect(); gain.disconnect(); } catch(e){} };
        return;
      } catch (e) {
        // Fallback silencioso
      }
    }
    // Fallback HTML5 Audio
    try {
      const s = new Audio(audioFiles[name] || audioFiles.normal);
      s.volume = vol;
      s.play().catch(()=>{});
    } catch(e) {}
  }

  // =================================================================
  // 2. SUPABASE & ESTADO GLOBAL
  // =================================================================
  
  let userId = null;
  let currentMineId = null;
  let myOwnedMineId = null; 
  let maxMonsterHealth = 1;
  let hasAttackedOnce = false;

  // --- NOVO: CACHE GLOBAL DE DONOS ---
  // Inicia vazio, será preenchido do IndexedDB no boot()
  let globalOwnersMap = {}; 

  // Estado Local de Ataques (Optimistic UI)
  let localAttacksLeft = 0;
  let nextAttackTime = null; // Timestamp em milissegundos
  let cooldownInterval = null;

  // Timers de Combate
  let combatTimerInterval = null;
  let combatTimeLeft = 0;

  // --- OTIMIZAÇÃO BATCH & CACHE ---
  let cachedCombatStats = null;      
  let pendingBatch = 0;              
  let batchFlushTimer = null;        
  let currentMonsterHealthGlobal = 0; 
  
  // Controle de Modo Híbrido (Solo vs Multi)
  let knownParticipantCount = 0;
  let isFirstAttackSequence = true; 

  // CONFIGURAÇÕES DE DEBOUNCE (Tuning Fino)
  const BATCH_THRESHOLD_MULTI = 5;   // Padrão Multi
  const BATCH_THRESHOLD_SOLO = 10;   // Padrão Solo (acumula mais)
  
  const DEBOUNCE_TIME_MULTI = 10000;  // 10s Multi
  const DEBOUNCE_TIME_SOLO = 40000;  // 40s Solo (Isso economiza 4x mais requisições no modo solo)
  
  const STATS_CACHE_DURATION = 72 * 60 * 60 * 1000; // 72 Horas
  
  // =================================================================
  // 3. SELETORES DOM
  // =================================================================
  const minesContainer = document.getElementById("minesContainer") || document.getElementById("minasContainer");
  
  // Modal Combate PvE
  const combatModal = document.getElementById("combatModal");
  const combatTitle = document.getElementById("combatModalTitle");
  const combatTimerSpan = document.getElementById("combatTimer");
  const playerAttacksSpan = document.getElementById("playerAttacks");
  const attackCooldownSpan = document.getElementById("attackCooldown");
  const attackBtn = document.getElementById("attackBtn");
  const backBtn = document.getElementById("backBtn");
  const monsterHpFill = document.getElementById("monsterHpFill");
  const monsterHpTextOverlay = document.getElementById("monsterHpTextOverlay");
  const monsterArea = document.getElementById("monsterArea");
  const damageRankingList = document.getElementById("damageRankingList");
  
  // Modal Confirmação/Alerta
  const confirmModal = document.getElementById("confirmModal");
  const confirmMessage = document.getElementById("confirmMessage");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");
  const confirmActionBtn = document.getElementById("confirmActionBtn");
  const loadingOverlay = document.getElementById("loading-overlay");

  // Botões Gerais
  const buyAttackBtn = document.getElementById("buyAttackBtn");
  const cycleInfoElement = document.getElementById("cycleInfo");

  // Footer & History
  const playerAttemptsSpan = document.getElementById("playerPVPAttemptsLeft");
  const buyPVPAttemptsBtn = document.getElementById("buyPVPAttemptsBtn");
  const playerMineSpan = document.getElementById("playerOwnedMine");
  const historyModal = document.getElementById("historyModal");
  const historyList = document.getElementById("historyList");
  const openHistoryBtn = document.getElementById("openHistoryBtn");
  const closeHistoryBtn = document.getElementById("closeHistoryBtn");
  const newLogIndicator = document.querySelector(".new-log-indicator");

  // PvP Modal
  const pvpCombatModal = document.getElementById("pvpCombatModal");
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

  // Buy PvE Modal
  const buyModal = document.getElementById("buyModal");
  const buyPlayerGoldInfo = document.getElementById("buyPlayerGoldInfo");
  const buyAttackQtySpan = document.getElementById("buyAttackQty");
  const buyAttackCostInfo = document.getElementById("buyAttackCostInfo");
  const buyDecreaseQtyBtn = document.getElementById("buyDecreaseQtyBtn");
  const buyIncreaseQtyBtn = document.getElementById("buyIncreaseQtyBtn");
  const buyCancelBtn = document.getElementById("buyCancelBtn");
  const buyConfirmBtn = document.getElementById("buyConfirmBtn");

  // Buy PvP Modal
  const buyPvpModal = document.getElementById('buyPvpModal');
  const buyPvpPlayerGoldInfo = document.getElementById('buyPvpPlayerGoldInfo');
  const buyPvpQtySpan = document.getElementById('buyPvpQty');
  const buyPvpCostInfo = document.getElementById('buyPvpCostInfo');
  const buyPvpDecreaseQtyBtn = document.getElementById('buyPvpDecreaseQtyBtn');
  const buyPvpIncreaseQtyBtn = document.getElementById('buyPvpIncreaseQtyBtn');
  const buyPvpCancelBtn = document.getElementById('buyPvpCancelBtn');
  const buyPvpConfirmBtn = document.getElementById('buyPvpConfirmBtn');

  if (!minesContainer) { console.error("[mines] ERRO: Container de minas não encontrado."); return; }

  // =================================================================
  // 4. AUTH & CACHING HELPERS
  // =================================================================
  
  async function getLocalUserId() {
    // 1. Tenta Auth GlobalDB (Zero Egress)
    const globalAuth = await GlobalDB.getAuth();
    if (globalAuth && globalAuth.value && globalAuth.value.user) {
        return globalAuth.value.user.id;
    }

    // 2. Fallback LocalStorage (Legacy)
    try {
        const cached = localStorage.getItem('player_data_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.data && parsed.data.id) return parsed.data.id;
        }
    } catch (e) {}

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                const sessionStr = localStorage.getItem(k);
                const session = JSON.parse(sessionStr);
                if (session && session.user && session.user.id) return session.user.id;
            }
        }
    } catch (e) {}
    return null;
  }

  // Cache Genérico de Player Data (Gold, etc.)
  async function getCachedPlayerData() {
    try {
      const globalData = await GlobalDB.getPlayer();
      if (globalData) return globalData;

      if (window.currentPlayerData) return window.currentPlayerData;
      
      const cached = localStorage.getItem('player_data_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.data;
      }
    } catch(e) { console.warn("Erro lendo cache", e); }
    return null;
  }

  // --- CACHE DE COMBAT STATS (Zero Egress) ---
  async function getOrUpdatePlayerStatsCache(forceUpdate = false) {
    if (!userId) return null;
    const now = Date.now();
    const cacheKey = `player_combat_stats_${userId}`;
    
    if (!forceUpdate) {
        if (cachedCombatStats) return cachedCombatStats;
        
        // 1. Tenta ler do GlobalDB
        const globalData = await GlobalDB.getPlayer();
        if (globalData && globalData.attack !== undefined) {
             cachedCombatStats = {
                 min_attack: globalData.min_attack || 0,
                 attack: globalData.attack || 0,
                 crit_chance: globalData.crit_chance || 0,
                 crit_damage: globalData.crit_damage || 0,
                 health: globalData.health || 0,
                 name: globalData.name, // Importante para o PvP Challenger Name
                 avatar_url: globalData.avatar_url
             };
             return cachedCombatStats;
        }

        // 2. Fallback LocalStorage
        let stored = localStorage.getItem(cacheKey);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (now - parsed.timestamp < STATS_CACHE_DURATION) {
                    cachedCombatStats = parsed.data;
                    return cachedCombatStats;
                }
            } catch(e) {}
        }
    }

    const { data, error } = await supabase.rpc('get_player_combat_stats', { p_player_id: userId });
    
    if (error || !data) {
        console.error("Erro ao buscar stats", error);
        return null;
    }

    const cacheObj = { timestamp: now, data: data };
    localStorage.setItem(cacheKey, JSON.stringify(cacheObj));
    cachedCombatStats = data;
    return cachedCombatStats;
  }

  function updateCachedGold(newGold) {
    try {
      if (window.currentPlayerData) window.currentPlayerData.gold = newGold;
      GlobalDB.updatePlayerPartial({ gold: newGold });
      const cached = localStorage.getItem('player_data_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.data.gold = newGold;
        localStorage.setItem('player_data_cache', JSON.stringify(parsed));
      }
      if (typeof window.renderPlayerUI === 'function' && window.currentPlayerData) {
        window.renderPlayerUI(window.currentPlayerData, true);
      }
    } catch(e) {}
  }

  // =================================================================
  // 5. HELPERS DE UI & DATA
  // =================================================================
  function getWeekendMultiplier() {
      const day = new Date().getUTCDay();
      return (day === 6 || day === 0) ? 2 : 1;
  }

  function checkEventStatus() {
      const mult = getWeekendMultiplier();
      const existingBanner = document.getElementById("eventBanner");
      if (existingBanner) existingBanner.remove();

      if (mult > 1 && cycleInfoElement) {
          const banner = document.createElement("h4");
          banner.id = "eventBanner";
          banner.textContent = "Coleta dobrada!";
          banner.style.cssText = "text-shadow: none!important; background: linear-gradient(to bottom, lightblue 0%, white 50%, blue 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 5px 0 0 0;";
          if (cycleInfoElement.parentNode) cycleInfoElement.parentNode.appendChild(banner);
      }
  }

  function showLoading() { if (loadingOverlay) loadingOverlay.style.display = "flex"; }
  function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = "none"; }
  const esc = (s) => (s === 0 || s) ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;") : "";

  function formatTimeHHMMSS(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${ss}`;
  }

  function formatTimeCombat(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
  }

  function updateHpBar(cur, max) {
    const c = Math.max(0, Number(cur || 0));
    const m = Math.max(1, Number(max || 1));
    if (monsterHpFill) monsterHpFill.style.width = `${Math.min(100, (c / m) * 100)}%`;
    if (monsterHpTextOverlay) monsterHpTextOverlay.textContent = `${c.toLocaleString()} / ${m.toLocaleString()}`;
  }

  function updatePvpHpBar(element, textElement, current, max) {
    const c = Math.max(0, Number(current || 0));
    const m = Math.max(1, Number(max || 1));
    const pct = Math.max(0, Math.min(100, (c / m) * 100));
    if (element) element.style.width = `${pct}%`;
    if (textElement) textElement.textContent = `${c.toLocaleString()} / ${m.toLocaleString()}`;
  }

  function displayDamageNumber(damage, isCrit, isEvaded, targetElement) {
    if (!targetElement) return;
    const el = document.createElement("div");
    if (isEvaded) {
        el.textContent = "Desviou";
        el.className = "evade-text";
        playSound('evade', { volume: 0.3 });
    } else {
        el.textContent = Number(damage).toLocaleString();
        el.className = isCrit ? "crit-damage-number" : "damage-number";
        try { isCrit ? playSound('critical', { volume: 0.1 }) : playSound('normal', { volume: 0.5 }); } catch(_) {}
    }
    el.style.position = "absolute";
    el.style.top = `50%`;
    el.style.left = `50%`;
    el.style.transform = "translate(-50%, -50%)";
    el.style.zIndex = "10";
    targetElement.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }

  function showModalAlert(message) {
    if (confirmModal && confirmMessage && confirmActionBtn && confirmCancelBtn) {
      confirmMessage.innerHTML = message;
      confirmCancelBtn.style.display = 'none';
      confirmActionBtn.textContent = 'Ok';
      confirmActionBtn.onclick = () => { confirmModal.style.display = 'none'; };
      confirmModal.style.display = 'flex';
    } else {
      alert(message);
    }
  }

  // =================================================================
  // 6. HISTÓRICO (CACHE E LISTAGEM)
  // =================================================================
  const STORAGE_KEY_LOGS = 'pvp_logs_cache';
  const STORAGE_KEY_LAST_SYNC = 'pvp_logs_last_sync';

  function getLocalLogs() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS) || '[]'); } catch { return []; }
  }

  function saveLocalLogs(logs) {
      localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
  }

  function syncAndCheckLogs() { /* LEGACY FUNCTION P/ COMPATIBILIDADE - Sincronização via BOOT preferível */
      if (!userId) return;
      const lastSync = localStorage.getItem(STORAGE_KEY_LAST_SYNC) || '1970-01-01T00:00:00Z';
      
      // OBS: Isso pode ser removido no futuro, pois boot faz isso via RPC
      // Mas para manter "full", mantemos aqui caso haja chamada explícita
      supabase.rpc('sync_pvp_history', { 
          p_player_id: userId, 
          p_last_sync_time: lastSync 
      }).then(({ data, error }) => {
          if (error) { console.warn("Sync error:", error); return; }
          const newLogs = data.new_logs || [];
          if (newLogs.length > 0) {
              const currentLogs = getLocalLogs();
              const updatedLogs = [...currentLogs, ...newLogs];
              if (updatedLogs.length > 50) updatedLogs.splice(0, updatedLogs.length - 50);
              saveLocalLogs(updatedLogs);
              const lastLogTime = newLogs[newLogs.length - 1].attack_time;
              localStorage.setItem(STORAGE_KEY_LAST_SYNC, lastLogTime);
              if (newLogIndicator) newLogIndicator.style.display = 'block';
          }
      });
  }

  function openHistory() {
      const logs = getLocalLogs();
      logs.sort((a, b) => new Date(b.attack_time) - new Date(a.attack_time));
      renderHistoryList(logs);
      if (newLogIndicator) newLogIndicator.style.display = 'none';
      historyModal.style.display = 'flex';
  }

  function renderHistoryList(list) {
    historyList.innerHTML = "";
    if (list.length === 0) {
        historyList.innerHTML = "<li>Nenhum ataque registrado.</li>";
    } else {
        for (const entry of list) {
            const li = document.createElement("li");
            const date = new Date(entry.attack_time).toLocaleString();
            const victory = entry.damage_dealt_by_defender >= entry.damage_dealt_by_attacker;
            li.innerHTML = `
                <span><strong>Data:</strong> ${date}</span>
                <span><strong>Atacante:</strong> ${esc(entry.attacker_name)}</span>
                <span><strong>Dano Recebido:</strong> ${entry.damage_dealt_by_attacker.toLocaleString()}</span>
                <span><strong>Dano Causado:</strong> ${entry.damage_dealt_by_defender.toLocaleString()}</span>
                <span><strong>Resultado:</strong> <strong style="color: ${victory ? 'yellow' : 'red'};">${victory ? "Você venceu" : "Você perdeu"}</strong></span>
            `;
            historyList.appendChild(li);
        }
    }
  }

  // =================================================================
  // 7. RANKING E SMOKE SIGNALS
  // =================================================================
  function renderRanking(rankingData, isSolo = false) {
      if (!damageRankingList) return;
      damageRankingList.innerHTML = "";
      
      if (isSolo) {
          damageRankingList.innerHTML = "<li style='text-align:center;color:#4caf50;font-style:italic;'>Apenas você disputando...</li>";
          return;
      }

      if (!rankingData || rankingData.length === 0) {
          damageRankingList.innerHTML = "<li style='text-align:center;color:#888'>Nenhum dano ainda</li>";
          return;
      }

      for (const row of rankingData) {
        const rName = row.n || row.player_name;
        const rDamage = row.d || row.total_damage_dealt;
        const rId = row.pid || row.player_id;

        const isMe = rId === userId;
        const li = document.createElement("li");
        
        li.innerHTML = `
          <div class="ranking-entry" style="padding: 4px 0;">
            <span class="player-name" style="margin-left: 0;">${esc(rName)} ${isMe ? '(Você)' : ''}</span>
            <span class="player-damage">${Number(rDamage||0).toLocaleString()}</span>
          </div>`;
        damageRankingList.appendChild(li);
      }
  }

  // NOVA FUNÇÃO: Renderiza o ranking "cego" (Smoke Signal)
  function updateBlindRanking(count, myDmg, topDmg, isLeader) {
      if (!damageRankingList) return;
      damageRankingList.innerHTML = "";

      // Atualiza variável global de participantes para ajustar debounce
      knownParticipantCount = count || 0;

      const myDmgFmt = Number(myDmg||0).toLocaleString();
      const topDmgFmt = Number(topDmg||0).toLocaleString();

      if (!count || count <= 1) {
          damageRankingList.innerHTML = `
            <li style='text-align:center;color:#4caf50;padding:10px;font-style:italic;'>
                Apenas você disputando...<br>
                <span style="font-size:0.9em;color:#fff">Dano: ${myDmgFmt}</span>
            </li>`;
          return;
      }

      const leaderText = isLeader ? "Você" : "Líder";
      const leaderColor = isLeader ? "#4caf50" : "#ff5555";
      
      const html = `
        <li style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid #333;">
            <span style="color:#aaa">Disputando:</span>
            <strong>${count} Jogadores</strong>
        </li>
        <li style="display:flex; justify-content:space-between; padding:5px; background: rgba(0,0,0,0.2);">
            <span style="color:${leaderColor}">${leaderText}:</span>
            <span>${topDmgFmt}</span>
        </li>
        ${!isLeader ? `
        <li style="display:flex; justify-content:space-between; padding:5px;">
            <span style="color:#4caf50">Você:</span>
            <span>${myDmgFmt}</span>
        </li>` : ''}
        <li style="text-align:center; margin-top:5px;">
            <button id="btnFetchDetails" style="background:none; border:none; color:#aaa; text-decoration:underline; cursor:pointer; font-size:0.8em;">
                Ver Ranking Detalhado
            </button>
        </li>
      `;
      
      damageRankingList.innerHTML = html;
      
      const btn = document.getElementById('btnFetchDetails');
      if(btn) {
          btn.onclick = async (e) => {
              e.target.textContent = "Carregando...";
              const { data } = await supabase.rpc("get_mine_damage_ranking", { _mine_id: currentMineId });
              // Passa false para renderRanking para forçar a lista detalhada mesmo que só tenha 1
              renderRanking(data || [], false); 
          };
      }
  }

  // =================================================================
  // 8. COMPRAS (LOJA PVE e PVP)
  // =================================================================
  let buyQty = 1;
  let buyPlayerGold = 0;
  let buyBaseBoughtCount = 0;
    
  function calcTotalCost(qty, baseCount) {
    let total = 0;
    for (let i = 0; i < qty; i++) {
      const cost = 10 + (Math.floor((baseCount + i) / 5) * 5);
      total += cost;
    }
    return total;
  }

  function refreshBuyModalUI() {
    if (!buyModal) return;
    if (buyAttackQtySpan) buyAttackQtySpan.textContent = String(buyQty);
    const total = calcTotalCost(buyQty, buyBaseBoughtCount);
    if (buyAttackCostInfo) buyAttackCostInfo.innerHTML = `Custo total:<br><img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:30px;height:27px;vertical-align:-4px"><strong> ${total}</strong>`;
    if (buyPlayerGoldInfo) buyPlayerGoldInfo.innerHTML = `Você tem: <br><img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:30px;height:27px;vertical-align:-4px"><strong> ${Number(buyPlayerGold || 0).toLocaleString()}</strong>`;
  }

  async function openBuyModal() {
    if (!userId) { showModalAlert("Faça login para comprar."); return; }
    
    // OTIMIZAÇÃO: Usa cache local (GlobalDB)
    const playerData = await getCachedPlayerData();
    
    if (playerData) {
       buyPlayerGold = playerData.gold || 0;
       if (playerData.attacks_bought_count !== undefined) {
           buyBaseBoughtCount = playerData.attacks_bought_count;
       } else {
           const { data } = await supabase.from("players").select("attacks_bought_count").eq("id", userId).single();
           buyBaseBoughtCount = data?.attacks_bought_count || 0;
       }
    } else {
       try {
          const { data: player } = await supabase.from("players").select("gold, attacks_bought_count").eq("id", userId).single();
          buyPlayerGold = player?.gold || 0;
          buyBaseBoughtCount = player?.attacks_bought_count || 0;
       } catch(e){}
    }
    
    buyQty = 1;
    refreshBuyModalUI();
    if (buyModal) buyModal.style.display = "flex";
  }

  function closeBuyModal() { if (buyModal) buyModal.style.display = "none"; }

  if (buyIncreaseQtyBtn) buyIncreaseQtyBtn.addEventListener("click", () => { buyQty += 1; refreshBuyModalUI(); });
  if (buyDecreaseQtyBtn) buyDecreaseQtyBtn.addEventListener("click", () => { if (buyQty > 1) buyQty -= 1; refreshBuyModalUI(); });
  if (buyCancelBtn) buyCancelBtn.addEventListener("click", () => { closeBuyModal(); });
  
  if (buyConfirmBtn) buyConfirmBtn.addEventListener("click", async () => {
    closeBuyModal();
    showLoading();
    
    await processAttackQueue();
    
    let purchased = 0;
    let spent = 0;
    try {
        for (let i = 0; i < buyQty; i++) {
            const { data, error } = await supabase.rpc('buy_mine_attack', { p_player_id: userId });
            
            if (error || !data?.success) {
                if (purchased === 0) showModalAlert(error?.message || data?.message || "Erro na compra.");
                break;
            }
            purchased += 1;
            spent += (data.cost || 0);
            
            if (typeof data.attacks_left === 'number') {
                localAttacksLeft = data.attacks_left;
                if (localAttacksLeft >= 5) {
                    nextAttackTime = null;
                    if (attackCooldownSpan) attackCooldownSpan.textContent = "";
                    if (cooldownInterval) clearInterval(cooldownInterval);
                }
                updateAttacksDisplay();
            }
        }
        
        if (purchased > 0) {
            showModalAlert(`Comprado(s) ${purchased} ataque(s).`);
            const currentGold = buyPlayerGold;
            const newGold = Math.max(0, currentGold - spent);
            updateCachedGold(newGold);
            syncAttacksState();
        }
    } catch (e) {
      console.error("[mines] buyConfirm erro:", e);
      showModalAlert("Erro inesperado.");
    } finally {
      hideLoading();
    }
  });

  // --- BUY PVP TRIES ---
  let buyPvpQty = 1;
  let buyPvpPlayerGold = 0;
  let buyPvpBaseBoughtCount = 0;

  function calcPvpCost(qty, baseCount) {
    let total = 0;
    for (let i = 0; i < qty; i++) {
      const group = Math.floor((baseCount + i) / 5);
      const cost = 30 + group * 5;
      total += cost;
    }
    return total;
  }

  function refreshBuyPvpModalUI() {
    if (!buyPvpModal) return;
    buyPvpQtySpan.textContent = String(buyPvpQty);
    const total = calcPvpCost(buyPvpQty, buyPvpBaseBoughtCount);
    buyPvpCostInfo.innerHTML = `Custo total:<br><img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:30px;height:27px;vertical-align:-4px"><strong> ${total}</strong>`;
    buyPvpPlayerGoldInfo.innerHTML = `Você tem: <br><img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:30px;height:27px;vertical-align:-4px"><strong> ${Number(buyPvpPlayerGold || 0).toLocaleString()}</strong>`;
  }

  async function openBuyPvpModal() {
    if (!userId) { showModalAlert("Faça login."); return; }
    
    const playerData = await getCachedPlayerData();
    if (playerData) {
        buyPvpPlayerGold = playerData.gold || 0;
        if (playerData.mine_pvp_attempts_bought_count !== undefined) {
             buyPvpBaseBoughtCount = playerData.mine_pvp_attempts_bought_count;
        } else {
             const { data } = await supabase.from("players").select("mine_pvp_attempts_bought_count").eq("id", userId).single();
             buyPvpBaseBoughtCount = data?.mine_pvp_attempts_bought_count || 0;
        }
    } else {
        const { data: player } = await supabase.from("players").select("gold, mine_pvp_attempts_bought_count").eq("id", userId).single();
        buyPvpPlayerGold = player?.gold || 0;
        buyPvpBaseBoughtCount = player?.mine_pvp_attempts_bought_count || 0;
    }

    buyPvpQty = 1;
    refreshBuyPvpModalUI();
    if (buyPvpModal) buyPvpModal.style.display = 'flex';
  }

  function closeBuyPvpModal() { if (buyPvpModal) buyPvpModal.style.display = 'none'; }
  if (buyPvpIncreaseQtyBtn) buyPvpIncreaseQtyBtn.addEventListener("click", () => { buyPvpQty += 1; refreshBuyPvpModalUI(); });
  if (buyPvpDecreaseQtyBtn) buyPvpDecreaseQtyBtn.addEventListener("click", () => { if (buyPvpQty > 1) buyPvpQty -= 1; refreshBuyPvpModalUI(); });
  if (buyPvpCancelBtn) buyPvpCancelBtn.addEventListener("click", closeBuyPvpModal);
  if (buyPvpConfirmBtn) buyPvpConfirmBtn.addEventListener("click", async () => {
    closeBuyPvpModal(); showLoading();
    let purchased = 0; let spent = 0;
    try {
        for (let i = 0; i < buyPvpQty; i++) {
            const { data, error } = await supabase.rpc("buy_mine_pvp_attack", { p_player_id: userId });
            if (error || !data?.success) {
                if (purchased === 0) showModalAlert(error?.message || data?.message || "Erro na compra.");
                break;
            }
            purchased++; spent += (data.cost || 0);
        }
        if (purchased > 0) {
            showModalAlert(`Comprado(s) ${purchased} tentativa(s) PvP.`);
            const newGold = Math.max(0, buyPvpPlayerGold - spent);
            updateCachedGold(newGold);
            await updatePVPAttemptsUI();
        }
    } catch (e) { showModalAlert("Erro inesperado."); } finally { hideLoading(); }
  });

  // =================================================================
  // 10. UI HELPERS GERAIS
  // =================================================================
  async function updatePVPAttemptsUI() {
    if (!userId) return;
    try {
        const { data, error } = await supabase.from('players').select('mine_pvp_attempts_left').eq('id', userId).single();
        if (error) throw error;
        if (playerAttemptsSpan) playerAttemptsSpan.textContent = data?.mine_pvp_attempts_left || 0;
    } catch (e) {}
  }

  async function updatePlayerMineUI() {
    if (!userId) return;
    try {
        const { data } = await supabase.from('mining_caverns').select('name').eq('owner_player_id', userId).single();
        if (playerMineSpan) playerMineSpan.textContent = data ? data.name : 'Nenhuma';
    } catch (e) {}
  }

  // =================================================================
  // 11. SISTEMA DE COOLDOWN LOCAL
  // =================================================================
  function startLocalCooldownTimer() {
      if (cooldownInterval) clearInterval(cooldownInterval);
      
      const updateTimerUI = () => {
          if (localAttacksLeft >= 5) {
              if (attackCooldownSpan) attackCooldownSpan.textContent = "";
              if (cooldownInterval) clearInterval(cooldownInterval);
              nextAttackTime = null;
              return;
          }
          
          if (!nextAttackTime) return;
          
          const now = Date.now();
          const diff = nextAttackTime - now;
          
          if (diff <= 0) {
              localAttacksLeft = Math.min(5, localAttacksLeft + 1);
              updateAttacksDisplay();
              
              if (localAttacksLeft < 5) {
                  nextAttackTime = Date.now() + 30000;
              } else {
                  nextAttackTime = null;
                  if (attackCooldownSpan) attackCooldownSpan.textContent = "";
                  clearInterval(cooldownInterval);
              }
          } else {
              const sec = Math.ceil(diff / 1000);
              if (sec > 0 && attackCooldownSpan) {
                   attackCooldownSpan.innerHTML = `(+ 1 em ${sec})`;
              }
          }
      };
      
      updateTimerUI();
      cooldownInterval = setInterval(updateTimerUI, 1000);
  }

  function updateAttacksDisplay() {
      if (playerAttacksSpan) playerAttacksSpan.textContent = `${localAttacksLeft}/5`;
      
      const hasOtherMine = (myOwnedMineId !== null && myOwnedMineId !== currentMineId);

      if (localAttacksLeft <= 0 || hasOtherMine) {
          if (attackBtn) { 
              attackBtn.classList.add('disabled-attack-btn'); 
              attackBtn.disabled = true; 
              
              if (hasOtherMine) {
                  attackBtn.style.filter = "grayscale(100%)";
                  attackBtn.title = "Você já possui uma mina e não pode atacar outra.";
              } else {
                  attackBtn.style.filter = "none";
                  attackBtn.title = "";
              }
          }
      } else {
          if (attackBtn) { 
              attackBtn.classList.remove('disabled-attack-btn'); 
              attackBtn.disabled = false; 
              attackBtn.style.filter = "none";
              attackBtn.title = "";
          }
      }
  }

  async function syncAttacksState() {
      try {
          const { data, error } = await supabase.rpc("get_player_attacks_state", { _player_id: userId });
          if (error) throw error;
          
          localAttacksLeft = data.attacks_left;
          
          if (localAttacksLeft < 5 && data.time_to_next_attack > 0) {
              nextAttackTime = Date.now() + (data.time_to_next_attack * 1000);
              startLocalCooldownTimer();
          } else if (localAttacksLeft < 5 && !nextAttackTime) {
               nextAttackTime = Date.now() + 30000;
               startLocalCooldownTimer();
          } else if (localAttacksLeft >= 5) {
               nextAttackTime = null;
               if (cooldownInterval) clearInterval(cooldownInterval);
               if (attackCooldownSpan) attackCooldownSpan.textContent = "";
          }
          updateAttacksDisplay();
      } catch (e) {
          console.warn("Sync attacks fail:", e);
      }
  }

  // =================================================================
  // 12. GUILDA DOMINANTE E MINAS
  // =================================================================
  async function updateDominantGuild(mines, ownersMap) {
      const guilddomSpan = document.getElementById("guilddom");
      if (!guilddomSpan) return;
      const guildCounts = {};
      for (const mine of mines) {
          if (mine.owner_player_id) {
              const owner = ownersMap[mine.owner_player_id];
              if (owner && owner.guild_id) {
                  guildCounts[owner.guild_id] = (guildCounts[owner.guild_id] || 0) + 1;
              }
          }
      }
      let dominantGuildId = null; let maxMines = 0;
      for (const guildId in guildCounts) {
          if (guildCounts[guildId] > maxMines) { maxMines = guildCounts[guildId]; dominantGuildId = guildId; }
      }
      if (dominantGuildId) {
          try {
              const { data: guild } = await supabase.from('guilds').select('name, flag_url').eq('id', dominantGuildId).single();
              if (guild) {
                  const flagUrl = guild.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
                  guilddomSpan.innerHTML = `<img src="${esc(flagUrl)}" style="width:50px; height:50px; border-radius: 4px; vertical-align: middle; margin-right: 8px;"><span style="font-weight: bold; color: yellow;">${esc(guild.name)}</span>`;
              } else { guilddomSpan.textContent = 'Nenhuma.'; }
          } catch (e) { guilddomSpan.textContent = 'Nenhuma.'; }
      } else { guilddomSpan.textContent = 'Nenhuma.'; }
  }

  // Função Legacy atualizada para usar a lógica de Janela Deslizante (RPC)
  // Usada internamente para recarregar sem refresh da página
  async function loadMines() {
    showLoading();
    try {
      // MUDANÇA: Usa RPC em vez de Select direto na tabela
      const { data: mines, error } = await supabase.rpc("get_visible_mines");
      
      if (error) throw error;

      const allOwnerIds = (mines || []).map(m => m.owner_player_id).filter(Boolean);
      const uniqueOwnerIds = [...new Set(allOwnerIds)];
      
      // Filtra apenas os donos que ainda não temos no cache global
      const idsToFetch = uniqueOwnerIds.filter(id => !globalOwnersMap[id]);

      if (idsToFetch.length > 0) {
        const { data: ownersData } = await supabase
            .from("players")
            .select("id, name, avatar_url, guild_id")
            .in("id", idsToFetch);
        
        if (ownersData && ownersData.length > 0) {
            // Atualiza memória
            ownersData.forEach(p => globalOwnersMap[p.id] = p);
            // Salva no DB Global para a próxima vez (persistência 24h)
            await GlobalDB.saveOwners(ownersData);
        }
      }

      const ownersMap = globalOwnersMap;
      const myMine = (mines || []).find(m => m.owner_player_id === userId);
      myOwnedMineId = myMine ? myMine.id : null;

      renderMines(mines || [], ownersMap);
      await updateDominantGuild(mines || [], ownersMap);
      await updatePVPAttemptsUI();
      await updatePlayerMineUI();
    } catch (err) {
      console.error(err);
      minesContainer.innerHTML = `<p>Erro ao carregar minas: ${esc(err.message)}</p>`;
    } finally {
      hideLoading();
    }
  }

  function renderMines(mines, ownersMap) {
    globalOwnersMap = { ...globalOwnersMap, ...ownersMap };

    minesContainer.innerHTML = "";
    for (const mine of mines) {
      renderAndAppendSingleCard(mine);
    }
  }

  // --- Função Auxiliar para renderizar um card individual e adicionar ao container ---
  function renderAndAppendSingleCard(mine) {
      if (!minesContainer) return;
      if (document.getElementById(`mine-card-${mine.id}`)) return; // Já existe

      const owner = globalOwnersMap[mine.owner_player_id];
      const ownerName = owner ? (owner.name || "Desconhecido") : null;
      const ownerAvatarHtml = owner && owner.avatar_url ? `<img src="${esc(owner.avatar_url)}" alt="Avatar" class="owner-avatar" />` : '';

      let collectingHtml = "";
      if (mine.owner_player_id) {
        const start = new Date(mine.open_time || new Date());
        const seconds = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
        const mult = getWeekendMultiplier();
        const maxCrystals = 1500 * mult;
        const crystals = Math.min(maxCrystals, Math.floor(seconds * (maxCrystals / 6600.0)));
        collectingHtml = `<p><img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="width: 27px; height: 27px; vertical-align: -6px;"><strong> ${crystals}</strong></p>`;
      }

      let actionType = null;
      let cardClass = "";

      if (mine.status === "aberta" && !mine.owner_player_id) {
        actionType = "startCombat";
      } else if (mine.status === "disputando") {
        actionType = "startCombat";
      } else if (mine.owner_player_id && mine.owner_player_id !== userId) {
        actionType = "challengeMine";
      } else if (mine.owner_player_id === userId) {
        cardClass = "disabled-card";
      }

      const card = document.createElement("div");
      card.id = `mine-card-${mine.id}`;
      card.className = `mine-card ${mine.status || ""} ${actionType ? 'clickable' : ''} ${cardClass}`;
      card.innerHTML = `
        <h3 style="color: yellow;">${esc(mine.name)}</h3>
        <p>${esc(mine.status || "Fechada")}</p>
        ${ownerName ? `
          <div class="mine-owner-container">
            ${ownerAvatarHtml}
            <span>${esc(ownerName)}</span>
          </div>` : "<p><strong>Sem Dono</strong></p>"}
        ${collectingHtml}`;

      if (actionType) {
        card.addEventListener("click", () => {
          if (actionType === "startCombat") startCombat(mine.id);
          else if (actionType === "challengeMine") challengeMine(mine, owner, []);
        });
      }
      minesContainer.appendChild(card);
  }

  // =================================================================
  // FUNÇÃO DE ATUALIZAÇÃO CIRÚRGICA (ECONOMIA DE DADOS)
  // =================================================================
  async function updateSingleMineCard(targetMineId) {
      if (!targetMineId) return null;
      
      const cardElement = document.getElementById(`mine-card-${targetMineId}`);
      if (!cardElement) return null; 

      try {
          // Busca no BD se não houver dados
          const { data: mine, error } = await supabase
              .from("mining_caverns")
              .select("id, name, status, monster_health, owner_player_id, open_time, initial_monster_health")
              .eq("id", targetMineId)
              .single();

          if (error || !mine) throw error;

          let owner = null;
          // Mágica de Cache para Owner também aqui
          if (mine.owner_player_id) {
              if (globalOwnersMap[mine.owner_player_id]) {
                  owner = globalOwnersMap[mine.owner_player_id];
              } else {
                  // Fallback se não estiver no mapa
                  const { data: p } = await supabase.from("players").select("id, name, avatar_url, guild_id").eq("id", mine.owner_player_id).single();
                  if (p) {
                      globalOwnersMap[p.id] = p;
                      await GlobalDB.saveOwners([p]); // Salva no cache também
                      owner = p;
                  }
              }
          }

          // Reconstrói a carta na mão
          cardElement.remove(); // Limpa DOM
          renderAndAppendSingleCard(mine);

          if (mine.owner_player_id === userId) myOwnedMineId = mine.id;
          else if (myOwnedMineId === mine.id) myOwnedMineId = null;
          
          return mine; // Retorna os dados para verificação de status

      } catch (e) {
          console.warn("[Mines] Surgical update failed, fallback to full load", e);
          loadMines(); 
          return null;
      }
  }

  // =================================================================
  // 13. COMBATE PVE (LÓGICA OTIMIZADA COM BATCH & SESSÃO PERSISTENTE)
  // =================================================================

  // --- PERSISTÊNCIA OTIMISTA ---
  function getOptimisticCacheKey() {
      if (!userId || !currentMineId) return null;
      return `mine_optimistic_state_${currentMineId}_${userId}`;
  }

  function saveOptimisticState(flushTime) {
      const key = getOptimisticCacheKey();
      if (!key) return;
      const state = {
          timestamp: Date.now(),
          hp: currentMonsterHealthGlobal,
          stamina: localAttacksLeft,
          pending: pendingBatch,
          flushTime: flushTime,
          isFirst: isFirstAttackSequence, 
          hasAttacked: hasAttackedOnce,
          pc: knownParticipantCount
      };
      localStorage.setItem(key, JSON.stringify(state));
  }

  function clearOptimisticState() {
      const key = getOptimisticCacheKey();
      if (key) localStorage.removeItem(key);
  }

  function restoreOptimisticState(cavern) {
      const key = getOptimisticCacheKey();
      if (!key) return false;
      const raw = localStorage.getItem(key);
      if (!raw) return false;

      try {
          const cached = JSON.parse(raw);
          if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
              currentMonsterHealthGlobal = cached.hp;
              localAttacksLeft = cached.stamina;
              pendingBatch = cached.pending;
              isFirstAttackSequence = cached.isFirst; 
              hasAttackedOnce = cached.hasAttacked;
              knownParticipantCount = cached.pc || 1;
              
              updateHpBar(currentMonsterHealthGlobal, cavern.initial_monster_health || maxMonsterHealth);
              updateAttacksDisplay();

              if (pendingBatch > 0) {
                  if (cached.flushTime && Date.now() >= cached.flushTime) {
                      processAttackQueue(); 
                  } else {
                      const remaining = Math.max(100, cached.flushTime - Date.now());
                      if (batchFlushTimer) clearTimeout(batchFlushTimer);
                      batchFlushTimer = setTimeout(processAttackQueue, remaining);
                  }
              }
              return true;
          }
          clearOptimisticState();
      } catch (e) {
          clearOptimisticState();
      }
      return false;
  }

  // --- START COMBAT UNIFICADO V2 ---
  async function startCombat(mineId) {
    showLoading();
    hasAttackedOnce = false;
    isFirstAttackSequence = true;
    
    // Reset temporário
    pendingBatch = 0;
    if (batchFlushTimer) clearTimeout(batchFlushTimer);

    if (buyAttackBtn) buyAttackBtn.disabled = false;

    try {
      // NOVA REQUEST ÚNICA: substitui "select mine", "get stats" e "get ranking" separados
      const { data, error } = await supabase.rpc('enter_mine_combat_session', { 
            p_player_id: userId, 
            p_mine_id: mineId 
      });

      if (error) throw error;
      if (!data.success) { showModalAlert(data.msg || "Não foi possível entrar."); return; }

      // Desempacota o retorno da RPC unificada
      const cavern = data.mine;     // { id, hp, max_hp, status, end_time }
      const pInfo = data.player;    // { al, ab, has_mine, stats }
      const ranking = data.ranking; // [...]
      
      if (pInfo.has_mine) { showModalAlert('Você já é dono de uma mina.'); return; }
      
      currentMineId = cavern.id;
      maxMonsterHealth = cavern.max_hp;
      currentMonsterHealthGlobal = cavern.hp;
      
      // Cache de Stats
      if (pInfo.stats) {
          cachedCombatStats = pInfo.stats;
          localStorage.setItem(`player_combat_stats_${userId}`, JSON.stringify({timestamp: Date.now(), data: pInfo.stats}));
      } else {
          await getOrUpdatePlayerStatsCache(true);
      }
      
      // Seta Estamina Local
      localAttacksLeft = pInfo.al;
      
      if (localAttacksLeft < 5 && !nextAttackTime) {
           nextAttackTime = Date.now() + 30000;
           startLocalCooldownTimer();
      }
      updateAttacksDisplay();

      // UI
      updateHpBar(currentMonsterHealthGlobal, maxMonsterHealth);
      if (combatTitle) combatTitle.textContent = `Disputa pela Mina`;

      // Restaura estado otimista
      restoreOptimisticState({ initial_monster_health: maxMonsterHealth });

      if (cavern.end_time) {
        const remaining = Math.max(0, Math.floor((new Date(cavern.end_time).getTime() - Date.now()) / 1000));
        startCombatTimer(remaining);
      } else {
        if (combatTimerSpan) combatTimerSpan.textContent = "Aguardando 1º golpe";
        if (combatTimerInterval) clearInterval(combatTimerInterval);
      }

      if (combatModal) combatModal.style.display = "flex";
      
      // Define se é solo
      knownParticipantCount = ranking ? ranking.length : 0;
      const isSolo = (knownParticipantCount <= 1);
      
      renderRanking(ranking ? ranking.slice(0, 3) : [], isSolo);

      ambientMusic.play();
    } catch (e) {
      console.error(e);
      showModalAlert("Erro ao entrar.");
    } finally {
      hideLoading();
    }
  }

  // Cálculo Local
  function calculateLocalDamage(stats, currentMonsterHp) {
      const min = stats.min_attack || 0;
      const max = stats.attack || 0;
      const critChance = stats.crit_chance || 0;
      const critDmg = stats.crit_damage || 0;

      const damageRange = Math.max(0, max - min);
      let damage = Math.floor(Math.random() * (damageRange + 1)) + min;
      let isCrit = false;

      if ((Math.random() * 100) < critChance) {
          isCrit = true;
          damage = Math.floor(damage * (1 + (critDmg / 100.0)));
      }

      const finalDamage = Math.min(damage, currentMonsterHp);
      return { damage: finalDamage, isCrit: isCrit };
  }

  // Processar Fila (Batch)
  async function processAttackQueue() {
      if (pendingBatch === 0) return;

      const countToSend = pendingBatch;
      pendingBatch = 0;
      if (batchFlushTimer) clearTimeout(batchFlushTimer);

      clearOptimisticState();

      try {
          const { data, error } = await supabase.rpc("batch_attack_mine", { 
              p_player_id: userId, 
              p_mine_id: currentMineId,
              p_attack_count: countToSend
          });

          if (error) throw error;
          if (!data.success) {
              showModalAlert(data.message);
              syncAttacksState();
              loadMines();
              return;
          }

          // Atualiza contagem
          knownParticipantCount = data.pc || 1;

          // SOLO MODE HÍBRIDO
          if (knownParticipantCount <= 1 && !data.win) {
              localAttacksLeft = data.al;
          } else {
              currentMonsterHealthGlobal = data.hp;
              updateHpBar(currentMonsterHealthGlobal, maxMonsterHealth);
              localAttacksLeft = data.al;
          }

          updateAttacksDisplay();

          if (data.end && !combatTimerInterval) {
             const remaining = Math.max(0, Math.floor((new Date(data.end).getTime() - Date.now()) / 1000));
             startCombatTimer(remaining);
          }

          if (data.win) {
              renderRanking(data.r || [], false); 
              showModalAlert(data.message || "Mina conquistada!");
              // Piggyback update: Passa objeto data com ui_update e owner_meta
              resetCombatUI(data); 
          } else {
              updateBlindRanking(data.pc, data.md, data.td, data.il);
          }

      } catch (e) {
          syncAttacksState();
      }
  }

  async function attack() {
    if (attackBtn) {
        attackBtn.classList.remove('attack-anim');
        void attackBtn.offsetWidth;
        attackBtn.classList.add('attack-anim');
    }
    
    if (!currentMineId) return;
    if (localAttacksLeft <= 0) return; 

    if (!cachedCombatStats) await getOrUpdatePlayerStatsCache();
    if (!cachedCombatStats) return;

    localAttacksLeft--;
    updateAttacksDisplay();

    if (!nextAttackTime) {
        nextAttackTime = Date.now() + 30000;
        startLocalCooldownTimer();
    }

    const { damage, isCrit } = calculateLocalDamage(cachedCombatStats, currentMonsterHealthGlobal);
    
    currentMonsterHealthGlobal = Math.max(0, currentMonsterHealthGlobal - damage);
    updateHpBar(currentMonsterHealthGlobal, maxMonsterHealth);
    displayDamageNumber(damage, isCrit, false, monsterArea);
    if (!hasAttackedOnce) hasAttackedOnce = true;
    
    const mImg = document.getElementById("monsterImage");
    if (mImg) {
        mImg.classList.remove('shake-animation');
        void mImg.offsetWidth;
        mImg.classList.add('shake-animation');
        setTimeout(() => mImg.classList.remove('shake-animation'), 300);
    }
    
    pendingBatch++;

    if (batchFlushTimer) clearTimeout(batchFlushTimer);

    if (isFirstAttackSequence) {
        isFirstAttackSequence = false;
        saveOptimisticState(null);
        await processAttackQueue();
        return;
    }

    // AJUSTE DINÂMICO DE DEBOUNCE (SOLO vs MULTI)
    const debounceTime = (knownParticipantCount <= 1) ? DEBOUNCE_TIME_SOLO : DEBOUNCE_TIME_MULTI;
    const threshold = (knownParticipantCount <= 1) ? BATCH_THRESHOLD_SOLO : BATCH_THRESHOLD_MULTI;

    if (pendingBatch >= threshold || currentMonsterHealthGlobal <= 0 || localAttacksLeft === 0) {
        await processAttackQueue();
    } else {
        const flushTime = Date.now() + debounceTime;
        batchFlushTimer = setTimeout(processAttackQueue, debounceTime);
        saveOptimisticState(flushTime);
    }
  }

  function startCombatTimer(seconds) {
    if (combatTimerInterval) clearInterval(combatTimerInterval);
    combatTimeLeft = Math.max(0, Number(seconds || 0));
    if (combatTimerSpan) combatTimerSpan.textContent = formatTimeCombat(combatTimeLeft);
    if (combatTimeLeft <= 0) { onCombatTimerEnd(); return; }
    combatTimerInterval = setInterval(() => {
      combatTimeLeft = Math.max(0, combatTimeLeft - 1);
      if (combatTimerSpan) combatTimerSpan.textContent = formatTimeCombat(combatTimeLeft);
      if (combatTimeLeft === 0) {
        clearInterval(combatTimerInterval);
        onCombatTimerEnd();
      }
    }, 1000);
  }

  async function onCombatTimerEnd() {
    try {
      if (!currentMineId) return;
      showLoading();
      const { data } = await supabase.rpc("end_mine_combat_session", { _mine_id: currentMineId });
      
      if (data?.success) {
         showModalAlert(data.message);
         resetCombatUI(data); // Passa o retorno completo com UI Piggyback
      } else {
         showModalAlert("Tempo esgotado!");
         resetCombatUI();
      }
    } catch (e) {
      resetCombatUI();
    } 
  }

  // --- UI UPDATE COM PIGGYBACK ---
  async function resetCombatUI(directUpdateData = null) { 
    const mineToUpdate = currentMineId;

    if (combatModal) combatModal.style.display = "none";
    
    clearOptimisticState();
    currentMineId = null;
    
    if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
    if (buyAttackBtn) { buyAttackBtn.disabled = true; }
    
    pendingBatch = 0;
    if(batchFlushTimer) clearTimeout(batchFlushTimer);
    
    ambientMusic.pause();
    ambientMusic.currentTime = 0;

    if (mineToUpdate) {
        // Se recebemos directUpdateData, temos dados frescos vindos da transação SQL
        if (directUpdateData && (directUpdateData.ui_update || directUpdateData.s)) {
             // Normaliza objeto (se veio do batch, ui_update estará lá. se veio direto, talvez flat)
             const ui = directUpdateData.ui_update || directUpdateData; 
             const meta = directUpdateData.owner_meta; // Metadados do Dono

             // Se veio owner_meta, SALVAMOS NO CACHE GLOBAL
             if (meta) { 
                 globalOwnersMap[meta.i] = { id: meta.i, name: meta.n, avatar_url: meta.a, guild_id: meta.g }; 
                 // Persistência async
                 await GlobalDB.saveOwners([ {id: meta.i, name: meta.n, avatar_url: meta.a, guild_id: meta.g} ]);
             }
             
             const el = document.getElementById(`mine-card-${mineToUpdate}`);
             if (el) {
                 el.remove(); // Limpa e redesenha com estado atualizado
                 renderAndAppendSingleCard({
                     id: ui.i || ui.id,
                     name: ui.n || ui.name || "Mina",
                     status: ui.s === 'A' ? 'aberta' : (ui.s === 'D' ? 'disputando' : (ui.s === 'O' ? 'ocupada' : ui.s)),
                     owner_player_id: ui.o, 
                     open_time: Date.now() 
                 });

                 // Smart check se liberou vaga
                 if (ui.s === 'disputando' || ui.s === 'ocupada') {
                     checkForNextMineSmart();
                 }
                 return; 
             }
        } 
        
        // Fallback: faz fetch se não houve dados diretos
        const m = await updateSingleMineCard(mineToUpdate);
        if (m && (m.status === 'disputando' || m.status === 'ocupada')) {
            checkForNextMineSmart();
        }
        
    } else {
        loadMines();
    }
  }

  // Lógica separada para checar nova mina disponível
  async function checkForNextMineSmart() {
      try {
            const renderedIds = Array.from(document.querySelectorAll('.mine-card'))
                                        .map(el => el.id.replace('mine-card-', ''));
            
            const { data: newMine, error } = await supabase.rpc('get_next_open_mine', { 
                p_visible_ids: renderedIds 
            });

            if (!error && newMine && newMine.length > 0) {
                renderAndAppendSingleCard(newMine[0]);
            }
        } catch (err) {}
  }

  // =================================================================
  // 14. PVP (DESAFIO E SIMULAÇÃO)
  // =================================================================
  async function challengeMine(targetMine, owner, allMines) {
    if (!userId) return;
    const ownerName = owner?.name || "Desconhecido";
    showLoading();
    try {
        let attemptsLeft = 0;
        const cached = await getCachedPlayerData();
        if (cached && cached.mine_pvp_attempts_left !== undefined) {
             attemptsLeft = cached.mine_pvp_attempts_left;
        } else {
             const { data: player } = await supabase.from('players').select('mine_pvp_attempts_left').eq('id', userId).single();
             attemptsLeft = player?.mine_pvp_attempts_left || 0;
        }

        if (attemptsLeft <= 0) { showModalAlert("Sem tentativas de PvP hoje."); return; }

        let warningMessage = "";
        if (allMines && allMines.length > 0) {
            const currentOwnedMine = allMines.find(m => m.owner_player_id === userId);
            if (currentOwnedMine) warningMessage = `<br><br><strong style="color: #ffcc00;">AVISO:</strong> Abandonará "${esc(currentOwnedMine.name)}".`;
        }

        confirmMessage.innerHTML = `Você possui <strong>${attemptsLeft}</strong> tentativas PvP.<br>Deseja desafiar <strong>${esc(ownerName)}</strong>?${warningMessage}`;
        confirmCancelBtn.style.display = 'inline-block';
        confirmActionBtn.textContent = 'Desafiar';
        confirmModal.style.display = 'flex';

        confirmActionBtn.onclick = () => {
            confirmModal.style.display = 'none';
            const ownerIdSafe = owner?.id || targetMine.owner_player_id;
            const ownerAvatarSafe = owner?.avatar_url || 'https://aden-rpg.pages.dev/assets/default_avatar.png';
            startPvpCombat(targetMine.id, ownerIdSafe, ownerName, ownerAvatarSafe);
        };
        confirmCancelBtn.onclick = () => confirmModal.style.display = 'none';
    } catch (e) { showModalAlert("Erro PvP check."); } finally { hideLoading(); }
  }

  // -- LOG DE COMBATE MINIFICADO V2 --
  async function startPvpCombat(mineId, ownerId, ownerName, ownerAvatar) {
    showLoading();
    try {
        const challengerData = await getOrUpdatePlayerStatsCache();
        const { data: defenderData } = await supabase.rpc('get_player_combat_stats', { p_player_id: ownerId });
        
        let challengerAvatarUrl = challengerData.avatar_url || 'https://aden-rpg.pages.dev/assets/default_avatar.png';

        const challengerMaxHp = Number(challengerData.health || 0);
        const defenderMaxHp = Number(defenderData.health || 0);
        let challengerCurrentHp = challengerMaxHp;
        let defenderCurrentHp = defenderMaxHp;

        const { data, error } = await supabase.rpc("capture_mine", { p_challenger_id: userId, p_mine_id: mineId });
        if (error || !data?.success) throw error || data?.message;

        challengerName.textContent = challengerData.name || "Desafiante";
        defenderName.textContent = ownerName || "Dono";
        challengerAvatar.src = challengerAvatarUrl;
        defenderAvatar.src = ownerAvatar;
        
        updatePvpHpBar(challengerHpFill, challengerHpText, challengerCurrentHp, challengerMaxHp);
        updatePvpHpBar(defenderHpFill, defenderHpText, defenderCurrentHp, defenderMaxHp);

        pvpCombatModal.style.display = 'flex';
        ambientMusic.play();

        pvpCountdown.style.display = 'block';
        for (let i = 4; i > 0; i--) {
            pvpCountdown.textContent = `A batalha começará em ${i}...`;
            await new Promise(r => setTimeout(r, 1000));
        }
        pvpCountdown.style.display = 'none';

        const combatLog = data.combat.battle_log;
        
        // Loop que aceita log minificado [turn, atkIdx, dmg, crit, evade]
        for (const turn of combatLog) {
            let dmg, isCrit, isEvaded, atkIdx;

            if (Array.isArray(turn)) {
                // Formato [turn_num, attacker_index, damage, is_crit, is_evade]
                atkIdx = turn[1]; dmg = turn[2]; isCrit = (turn[3] === 1); isEvaded = (turn[4] === 1);
            } else {
                // Formato Legacy
                atkIdx = (turn.attacker_id === userId ? 0 : 1); dmg = turn.damage; isCrit = turn.critical; isEvaded = turn.evaded;
            }

            const targetElement = (atkIdx === 1) ? challengerSide : defenderSide; 
            
            if (atkIdx === 1) { // Dono ataca (1)
                challengerCurrentHp = Math.max(0, challengerCurrentHp - Number(dmg));
                updatePvpHpBar(challengerHpFill, challengerHpText, challengerCurrentHp, challengerMaxHp);
            } else { // Desafiante ataca (0)
                defenderCurrentHp = Math.max(0, defenderCurrentHp - Number(dmg));
                updatePvpHpBar(defenderHpFill, defenderHpText, defenderCurrentHp, defenderMaxHp);
            }
            displayDamageNumber(dmg, isCrit, isEvaded, targetElement);
            
            const victimAvatarId = (atkIdx === 1) ? "challengerAvatar" : "defenderAvatar";
            const vImg = document.getElementById(victimAvatarId);
            
            if (vImg) {
                vImg.classList.remove('shake-animation');
                void vImg.offsetWidth;
                vImg.classList.add('shake-animation');
                setTimeout(() => vImg.classList.remove('shake-animation'), 300);
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        await new Promise(r => setTimeout(r, 1000));

        const winnerId = data.combat?.winner_id;
        if (winnerId === userId) showModalAlert(`VITÓRIA! Mina conquistada.`);
        else showModalAlert(`DERROTA. O dono defendeu a mina.`);

    } catch (e) {
        console.error("PvP Error", e);
        showModalAlert("Erro ao desafiar mina.");
    } finally {
        if(pvpCombatModal) pvpCombatModal.style.display = 'none';
        hideLoading();
        await loadMines(); 
    }
  }

  function endCombat() {
    resetCombatUI();
    hasAttackedOnce = false;
  }

  // =================================================================
  // 15. INICIALIZAÇÃO OTIMIZADA (MONOLITH PATTERN)
  // =================================================================
  async function boot() {
    try {
      userId = await getLocalUserId();
      if (window.currentPlayerId) userId = window.currentPlayerId;
      if (!userId && typeof session !== 'undefined' && session) userId = session.user.id;
      
      if (!userId) { 
        window.location.href = "index.html"; 
        return; 
      }
      const BOT_IDS = ["bc6b795d-da47-4f14-9f57-3781bfb21e53", "856545ef-e33e-4b86-b2af-71957a9772f9", "9d0af1a4-7f36-4f19-9ce6-5e507b17e912", "37baa684-f4dc-4d80-93cb-9004a3cbe2b9", "1888d6d8-ca41-48cc-b92e-e48af088d643", "10fddae3-d7d0-4784-b1ed-54883596b19b", "31dfad6d-3d1a-493f-ae72-423c65156e01"];

      try { await supabase.rpc('populate_bot_mines', { p_bot_ids: BOT_IDS }); } catch (botErr) {}
      try { await supabase.rpc('resolve_all_expired_mines'); } catch (err) {}

      showLoading();
      
      // Carrega donos válidos do Cache (24h)
      globalOwnersMap = await GlobalDB.getAllOwners();

      // MONOLITH FETCH (1 única requisição RPC no boot)
      const lastSync = localStorage.getItem(STORAGE_KEY_LAST_SYNC) || '1970-01-01T00:00:00Z';
      const { data, error } = await supabase.rpc('get_mine_boot_state', { 
          p_player_id: userId,
          p_last_sync_time: lastSync
      });

      if (error) throw error;

      // PROCESS DADOS
      if (data.s) {
          cachedCombatStats = data.s; 
          localStorage.setItem(`player_combat_stats_${userId}`, JSON.stringify({ timestamp: Date.now(), data: data.s }));
      }

      if (data.a) {
          localAttacksLeft = data.a.al;
          const timeToNext = data.a.t;
          if (localAttacksLeft < 5 && timeToNext > 0) {
              nextAttackTime = Date.now() + (timeToNext * 1000);
              startLocalCooldownTimer();
          } else if (localAttacksLeft < 5) {
              nextAttackTime = Date.now() + 30000;
              startLocalCooldownTimer();
          }
          updateAttacksDisplay();
      }

      if (data.p) {
          if (playerAttemptsSpan) playerAttemptsSpan.textContent = data.p.l; 
      }

      if (data.o && data.o.length > 0) {
          // Atualiza cache e memória com donos atuais vindos do boot
          await GlobalDB.saveOwners(data.o);
          data.o.forEach(o => { globalOwnersMap[o.i] = { id: o.i, name: o.n, avatar_url: o.a, guild_id: o.g }; });
      }

      const mappedMines = data.m.map(m => ({
          id: m.i, 
          name: m.n, 
          status: m.s === 'A' ? 'aberta' : (m.s === 'D' ? 'disputando' : (m.s === 'O' ? 'ocupada' : m.s)), 
          owner_player_id: m.o, 
          open_time: m.t, 
          competition_end_time: m.e,
          monster_health: m.m,
          initial_monster_health: m.h
      }));
      
      renderMines(mappedMines, globalOwnersMap);
      await updateDominantGuild(mappedMines, globalOwnersMap);
      
      myOwnedMineId = (mappedMines.find(m => m.owner_player_id === userId))?.id || null;
      updatePlayerMineUI();

      if (data.l && data.l.length > 0) {
          const l = data.l;
          localStorage.setItem(STORAGE_KEY_LAST_SYNC, l[l.length - 1].at);
          // Opcional: merge history, mas normalmente só indicator
          if (newLogIndicator) newLogIndicator.style.display = 'block';
      }

    } catch (e) {
      console.error("[mines] boot critical error:", e);
      loadMines();
    } finally {
      checkEventStatus();
      hideLoading();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'hidden') {
      if (ambientMusic && !ambientMusic.paused) { 
          ambientMusic.pause(); 
          ambientMusic._wasPlaying = true; 
      }
      
      if (currentMineId) { 
          avisoTelaSound.currentTime = 0; 
          avisoTelaSound.play().catch(()=>{}); 
          processAttackQueue();
      }
    } 
  });

  // Cycle Countdown
  function updateCountdown() {
    const now = new Date();
    const currentHour = now.getHours();
    let nextSessionDate = new Date();
    let nextSessionHour = currentHour + (currentHour % 2 === 0 ? 2 : 1);
    if (nextSessionHour > 23) {
      nextSessionHour = 0;
      nextSessionDate.setDate(nextSessionDate.getDate() + 1);
    }
    nextSessionDate.setHours(nextSessionHour, 0, 0, 0);
    const diffInMs = nextSessionDate.getTime() - now.getTime();
    const diffInSeconds = Math.floor(diffInMs / 1000);
    if (cycleInfoElement) {
        cycleInfoElement.innerHTML = ` <strong>${formatTimeHHMMSS(diffInSeconds)}</strong>`;
    }
    checkEventStatus();
  }
  setInterval(updateCountdown, 1000);
  updateCountdown();

  // Listeners Finais
  if (attackBtn) attackBtn.addEventListener("click", attack);
  if (backBtn) backBtn.addEventListener("click", endCombat);
  if (buyAttackBtn) buyAttackBtn.addEventListener("click", () => {
      if (!hasAttackedOnce) { showModalAlert("Ataque ao menos uma vez para comprar."); return; }
      openBuyModal();
  });
  if (buyPVPAttemptsBtn) buyPVPAttemptsBtn.addEventListener("click", () => openBuyPvpModal());
  if (openHistoryBtn) openHistoryBtn.addEventListener("click", openHistory);
  if (closeHistoryBtn) closeHistoryBtn.addEventListener("click", () => historyModal.style.display = 'none');

  boot();
});