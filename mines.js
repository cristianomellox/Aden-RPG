
import { supabase } from './supabaseClient.js'

// =======================================================================
// NOVO: ADEN GLOBAL DB (INTEGRAÇÃO ZERO EGRESS + CACHE DE DONOS V3)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 6; 
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';
const OWNERS_STORE = 'owners_store'; 

const OWNERS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 Horas em milissegundos

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
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
    setPlayer: async function(playerData) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            tx.objectStore(PLAYER_STORE).put({ key: 'player_data', value: playerData });
        } catch(e) { console.warn("Erro ao salvar Player no DB Global", e); }
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
            }
        } catch(e) { console.warn("Erro update parcial", e); }
    },

    // --- MÉTODOS DE CACHE DE DONOS (V3) ---
    getAllOwners: async function() {
        try {
            const db = await this.open();
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
            const tx = db.transaction(OWNERS_STORE, 'readwrite');
            const store = tx.objectStore(OWNERS_STORE);
            const now = Date.now();

            ownersList.forEach(o => {
                // Tenta mapear chaves curtas (do RPC) ou usa as normais
                const cacheObj = {
                    id: o.id || o.i,
                    name: o.name || o.n,
                    avatar_url: o.avatar_url || o.a,
                    guild_id: o.guild_id || o.g,
                    timestamp: now // Reinicia a contagem de 24h
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
  console.log("[mines] DOM ready - Versão Otimizada vFinal");

  // =================================================================
  // 1. ÁUDIO SYSTEM (INTACTO)
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

  // --- CACHE GLOBAL DE DONOS ---
  let globalOwnersMap = {}; 

  // Estado Local de Ataques (Optimistic UI)
  let localAttacksLeft = 0;
  let nextAttackTime = null; 
  let cooldownInterval = null;

  // ── ACTIVITY STATE (cache local compartilhado com páginas de caça) ──
  const ACTIVITY_KEY = 'aden_activity_state';

  // Sessões iniciam nas horas ímpares UTC (01:00, 03:00 ... 23:00) e duram 110 min.
  // Retorna o Date de fim da sessão que estava ativa no timestamp fornecido.
  function getSessionEndForTime(ts) {
    const d = new Date(ts);
    const totalMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    for (let oddH = 23; oddH >= 1; oddH -= 2) {
      if (totalMinutes >= oddH * 60) {
        const end = new Date(d);
        end.setUTCHours(oddH, 0, 0, 0);
        end.setTime(end.getTime() + 110 * 60 * 1000);
        return end;
      }
    }
    // Antes de 01:00 UTC — sessão de 23:00 do dia anterior
    const end = new Date(d);
    end.setUTCDate(end.getUTCDate() - 1);
    end.setUTCHours(23, 0, 0, 0);
    end.setTime(end.getTime() + 110 * 60 * 1000);
    return end;
  }

  function getActivity(){
    try{
        const a=JSON.parse(localStorage.getItem(ACTIVITY_KEY));
        if(!a)return null;
        // Penalidade de morte expirada: desbloqueia mineração automaticamente
        // (cobre o caso de fechar o browser durante os 3 min de penalidade na floresta)
        if(a.pvp_dead&&a.dead_until&&Date.now()>a.dead_until){
            localStorage.removeItem(ACTIVITY_KEY);
            return null;
        }
        // Expira quando a sessão em que a atividade foi registrada terminar
        if(a.started_at && Date.now() > getSessionEndForTime(a.started_at).getTime()){
            localStorage.removeItem(ACTIVITY_KEY);
            return null;
        }
        return a;
    }catch{return null;}
  }
  function setActivityMining(mineName){localStorage.setItem(ACTIVITY_KEY,JSON.stringify({type:'mining',mine_name:mineName,started_at:Date.now()}));}
  function clearActivity(){localStorage.removeItem(ACTIVITY_KEY);}

  // Sincroniza o estado de atividade com a posse real de mina.
  // Chamado sempre que myOwnedMineId é atualizado (após PvP, loadMines, boot).
  // Não interfere em sessões PvE ativas (currentMineId preenchido).
  function syncMiningActivity() {
    if (currentMineId) return; // Em combate PvE ativo: não sobrescreve
    if (myOwnedMineId) {
      const current = getActivity();
      if (!current || current.type !== 'mining') {
        setActivityMining('Mina'); // Bloqueia caça enquanto for dono de mina
      }
    } else {
      // Só limpa se a atividade for de mineração (não apaga caça)
      const current = getActivity();
      if (current && current.type === 'mining') {
        clearActivity();
      }
    }
  }

  // Timers de Combate
  let combatTimerInterval = null;
  let combatTimeLeft = 0;

  // --- VARIÁVEIS OTIMIZAÇÃO ---
  let cachedCombatStats = null;      
  let pendingBatch = 0;              
  let pendingDamageBatch = 0;        
  let batchFlushTimer = null;        
  let currentMonsterHealthGlobal = 0; 
  
  // CONFIGURAÇÃO DE BATCH
  let knownParticipantCount = 0;     
  
  const BATCH_THRESHOLD_MULTI = 5;   
  const BATCH_THRESHOLD_SOLO = 5;   
  
  const DEBOUNCE_TIME_MULTI = 10000;  
  const DEBOUNCE_TIME_SOLO = 300000;  
  
  const STATS_CACHE_DURATION = 72 * 60 * 60 * 1000; 
  
  let isFirstAttackSequence = true; 

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
  // 4. CACHE HELPER & AUTH (OTIMIZADO)
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

        const globalData = await GlobalDB.getPlayer();
        if (globalData && globalData.attack !== undefined) {
             cachedCombatStats = {
                 min_attack: globalData.min_attack || 0,
                 attack: globalData.attack || 0,
                 crit_chance: globalData.crit_chance || 0,
                 crit_damage: globalData.crit_damage || 0,
                 health: globalData.health || 0
             };
             return cachedCombatStats;
        }

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
  // 5. FUNÇÕES UTILITÁRIAS
  // =================================================================
  
  function getWeekendMultiplier() {
      const day = new Date().getUTCDay();
      return (day === 6 || day === 0) ? 2 : 1;
  }

  function checkEventStatus() {
      const mult = getWeekendMultiplier();
      const existingBanner = document.getElementById("eventBanner");
      if (existingBanner) existingBanner.remove();

      if (mult > 1 && cycleInfoElement && cycleInfoElement.parentNode) {
          const banner = document.createElement("h4");
          banner.id = "eventBanner";
          banner.innerHTML = '<img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="width: 40px; height: 40px; vertical-align: -6px; margin-top: 8px;"> <span> X2</span>!';
          banner.style.cssText = "text-shadow: none!important; background: linear-gradient(to bottom, lightblue 0%, white 50%, blue 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 5px 0 0 0; font-size: 1.9em;";
          cycleInfoElement.parentNode.appendChild(banner);
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
  // 6. HISTÓRICO (INCREMENTAL / CACHE)
  // =================================================================
  const STORAGE_KEY_LOGS = 'pvp_logs_cache';
  const STORAGE_KEY_LAST_SYNC = 'pvp_logs_last_sync';

  function getLocalLogs() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS) || '[]'); } catch { return []; }
  }

  function saveLocalLogs(logs) {
      localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
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
  // 7. RANKING E UI
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
        const rName = row.n || row.name || row.player_name;
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

  function updateBlindRanking(count, myDmg, topDmg, isLeader) {
      if (!damageRankingList) return;
      damageRankingList.innerHTML = "";
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
              renderRanking(data || [], false); 
          };
      }
  }

  // =================================================================
  // 8. COMPRA DE ATAQUES (PVE)
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


  // =================================================================
  // 9. COMPRA DE TENTATIVAS PVP
  // =================================================================
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
        // [OTIMIZADO] Usa RPC 'get_player_pvp_simple' (leitura leve)
        const { data } = await supabase.rpc('get_player_pvp_simple', { p_player_id: userId });
        if (data && playerAttemptsSpan) {
            playerAttemptsSpan.textContent = data.l;
        }
    } catch (e) { console.warn("Erro ao buscar tentativas PvP", e); }
  }

  // [OTIMIZADO] Calcula mina do jogador baseado na lista JÁ carregada
  function updatePlayerMineUI(minesList) {
    if (!userId || !minesList) return;
    const myMine = minesList.find(m => m.owner_player_id === userId);
    
    if (playerMineSpan) {
        playerMineSpan.textContent = myMine ? myMine.name : 'Nenhuma';
    }
    myOwnedMineId = myMine ? myMine.id : null;
    syncMiningActivity(); // Sincroniza o lock de caça com a posse real de mina
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
  // 12. CARREGAMENTO DE MINAS (RPC LEVE)
  // =================================================================
  async function loadMines() {
    showLoading();
    try {
      // [OTIMIZADO] Usa 'get_visible_mines' (chaves minificadas)
      const { data: minesJson } = await supabase.rpc("get_visible_mines");
      const mines = minesJson || [];

      // Mapeia chaves curtas para longas
      const mappedMines = mines.map(m => ({
          id: m.i, 
          name: m.n, 
          status: m.s === 'A' ? 'aberta' : (m.s === 'D' ? 'disputando' : (m.s === 'O' ? 'ocupada' : m.s)), 
          owner_player_id: m.o, 
          open_time: m.t, 
          competition_end_time: m.e, 
          monster_health: m.m, 
          initial_monster_health: m.h
      }));

      // Lazy Load Profiles
      const allOwnerIds = mappedMines.map(m => m.owner_player_id).filter(Boolean);
      const uniqueOwnerIds = [...new Set(allOwnerIds)];
      const missingIds = uniqueOwnerIds.filter(id => !globalOwnersMap[id]);
      
      if (missingIds.length > 0) {
          const { data: profiles } = await supabase.rpc("get_missing_profiles", { p_user_ids: missingIds });
          if (profiles) {
              await GlobalDB.saveOwners(profiles);
              profiles.forEach(p => globalOwnersMap[p.id] = p);
          }
      }

      renderMines(mappedMines, globalOwnersMap);
      await updateDominantGuild(mappedMines, globalOwnersMap);
      updatePlayerMineUI(mappedMines); // Cálculo local
      await updatePVPAttemptsUI(); // RPC leve

    } catch (e) {
      console.error(e);
      minesContainer.innerHTML = `<p>Erro ao carregar minas.</p>`;
    } finally {
      hideLoading();
    }
  }

  function renderMines(mines, ownersMap) {
    globalOwnersMap = { ...globalOwnersMap, ...ownersMap };

    minesContainer.innerHTML = "";
    for (const mine of mines) {
      const owner = ownersMap[mine.owner_player_id];
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
          else if (actionType === "challengeMine") challengeMine(mine, owner, mines);
        });
      }
      minesContainer.appendChild(card);
    }
  }

  function renderAndAppendSingleCard(mine) {
      if (!minesContainer) return;
      if (document.getElementById(`mine-card-${mine.id}`)) return;

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

  // [OTIMIZADO] Atualiza um card individual
  async function updateSingleMineCard(targetMineId) {
      if (!targetMineId) return null;
      
      const cardElement = document.getElementById(`mine-card-${targetMineId}`);
      if (!cardElement) return null; 

      try {
          // Usa RPC leve 'get_mine_info_light'
          const { data: mine, error } = await supabase.rpc("get_mine_info_light", { p_mine_id: targetMineId });

          if (error || !mine) throw error;

          const mappedMine = {
              id: mine.id,
              name: mine.n,
              status: mine.s,
              monster_health: mine.m,
              initial_monster_health: mine.h,
              owner_player_id: mine.o,
              open_time: mine.t
          };

          let owner = null;
          if (mappedMine.owner_player_id) {
              if (globalOwnersMap[mappedMine.owner_player_id]) {
                  owner = globalOwnersMap[mappedMine.owner_player_id];
              } else {
                  // Fallback
                  const { data: p } = await supabase.from("players").select("id, name, avatar_url, guild_id").eq("id", mappedMine.owner_player_id).single();
                  if (p) {
                      globalOwnersMap[p.id] = p;
                      await GlobalDB.saveOwners([p]);
                      owner = p;
                  }
              }
          }

          const ownerName = owner ? (owner.name || "Desconhecido") : null;
          const ownerAvatarHtml = owner && owner.avatar_url ? `<img src="${esc(owner.avatar_url)}" alt="Avatar" class="owner-avatar" />` : '';

          let collectingHtml = "";
          if (mappedMine.owner_player_id) {
              const start = new Date(mappedMine.open_time || new Date());
              const seconds = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
              const mult = getWeekendMultiplier();
              const maxCrystals = 1500 * mult;
              const crystals = Math.min(maxCrystals, Math.floor(seconds * (maxCrystals / 6600.0)));
              collectingHtml = `<p><img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="width: 27px; height: 27px; vertical-align: -6px;"><strong> ${crystals}</strong></p>`;
          }

          let actionType = null;
          let cardClass = "";
          if (mappedMine.status === "aberta" && !mappedMine.owner_player_id) {
              actionType = "startCombat";
          } else if (mappedMine.status === "disputando") {
              actionType = "startCombat";
          } else if (mappedMine.owner_player_id && mappedMine.owner_player_id !== userId) {
              actionType = "challengeMine";
          } else if (mappedMine.owner_player_id === userId) {
              cardClass = "disabled-card";
          }
          
          cardElement.className = `mine-card ${mappedMine.status || ""} ${actionType ? 'clickable' : ''} ${cardClass}`;
          cardElement.innerHTML = `
            <h3 style="color: yellow;">${esc(mappedMine.name)}</h3>
            <p>${esc(mappedMine.status || "Fechada")}</p>
            ${ownerName ? `
              <div class="mine-owner-container">
                ${ownerAvatarHtml}
                <span>${esc(ownerName)}</span>
              </div>` : "<p><strong>Sem Dono</strong></p>"}
            ${collectingHtml}`;

          const newCard = cardElement.cloneNode(true);
          cardElement.parentNode.replaceChild(newCard, cardElement);
          
          if (actionType) {
              newCard.addEventListener("click", () => {
                  if (actionType === "startCombat") startCombat(mappedMine.id);
                  else if (actionType === "challengeMine") challengeMine(mappedMine, owner, []); 
              });
          }

          if (mappedMine.owner_player_id === userId) myOwnedMineId = mappedMine.id;
          else if (myOwnedMineId === mappedMine.id) myOwnedMineId = null;
          syncMiningActivity(); // Sincroniza o lock de caça com a posse real de mina
          
          return mappedMine;

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

  function saveOptimisticState(debounceFlushTime) {
      const key = getOptimisticCacheKey();
      if (!key) return;
      const state = {
          timestamp: Date.now(),
          hp: currentMonsterHealthGlobal,
          stamina: localAttacksLeft,
          pending: pendingBatch,
          pendingDmg: pendingDamageBatch, 
          flushTime: debounceFlushTime,
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
          // Validade do Cache: 5 minutos
          if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
              currentMonsterHealthGlobal = cached.hp;
              localAttacksLeft = cached.stamina;
              pendingBatch = cached.pending;
              pendingDamageBatch = cached.pendingDmg || 0;
              isFirstAttackSequence = cached.isFirst; 
              hasAttackedOnce = cached.hasAttacked;
              knownParticipantCount = cached.pc || 1;
              
              updateHpBar(currentMonsterHealthGlobal, cavern.initial_monster_health);
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
          console.warn("Erro ao restaurar sessão:", e);
          clearOptimisticState();
      }
      return false;
  }

  // =================================================================
  // OTIMIZAÇÃO: START COMBAT VIA RPC
  // =================================================================
  async function startCombat(mineId) {
    showLoading();
    hasAttackedOnce = false;
    isFirstAttackSequence = true;

    // Verifica se está caçando em outra página
    const activity = getActivity();
    if (activity?.type === 'hunting') {
      const regionName = activity.region || 'uma região';
      hideLoading();
      showModalAlert(`<strong>Você não é onipresente...</strong><br>No momento você está caçando em <strong>${esc(regionName)}</strong>.<br>Pause a caçada para minerar.`);
      return;
    }
    
    knownParticipantCount = 1;

    if (buyAttackBtn) buyAttackBtn.disabled = false;
    
    pendingBatch = 0;
    pendingDamageBatch = 0; 
    if (batchFlushTimer) clearTimeout(batchFlushTimer);

    try {
      const { data, error } = await supabase.rpc("enter_mine_combat", { 
          p_mine_id: mineId,
          p_player_id: userId
      });
      
      if (error || !data.success) { 
          showModalAlert(data?.message || "Erro ao entrar na mina."); 
          return; 
      }

      const cavern = {
          id: data.mine.id,
          name: data.mine.name,
          status: data.mine.status,
          monster_health: data.mine.hp,
          initial_monster_health: data.mine.max_hp,
          competition_end_time: data.mine.end_time
      };

      currentMineId = mineId;
      setActivityMining(cavern.name || 'Mina');
      maxMonsterHealth = Number(cavern.initial_monster_health || 1);
      
      currentMonsterHealthGlobal = cavern.monster_health;
      updateHpBar(currentMonsterHealthGlobal, maxMonsterHealth);
      
      await getOrUpdatePlayerStatsCache();
      await syncAttacksState();

      restoreOptimisticState(cavern);

      if (combatTitle) combatTitle.textContent = `Disputa pela ${esc(cavern.name)}`;

      if (cavern.competition_end_time) {
        const remaining = Math.max(0, Math.floor((new Date(cavern.competition_end_time).getTime() - Date.now()) / 1000));
        startCombatTimer(remaining);
      } else {
        if (combatTimerSpan) combatTimerSpan.textContent = "Aguardando 1º golpe";
        if (combatTimerInterval) clearInterval(combatTimerInterval);
      }

      if (combatModal) combatModal.style.display = "flex";
      
      const rankingData = data.ranking;
      knownParticipantCount = data.participant_count || 0;
      const isSolo = (knownParticipantCount <= 1);
      
      renderRanking(rankingData, isSolo);

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

  // Processar Fila (Batch com Smoke Signal)
  async function processAttackQueue() {
      if (pendingBatch === 0) return;

      const countToSend = pendingBatch;
      const damageToSend = pendingDamageBatch; 
      
      pendingBatch = 0;
      pendingDamageBatch = 0; 
      if (batchFlushTimer) clearTimeout(batchFlushTimer);

      clearOptimisticState();

      try {
          const { data, error } = await supabase.rpc("batch_attack_mine", { 
              p_player_id: userId, 
              p_mine_id: currentMineId,
              p_attack_count: countToSend,
              p_claimed_damage: damageToSend 
          });

          if (error) throw error;
          if (!data.success) {
              console.warn("Erro no sync:", data.message);
              showModalAlert(data.message);
              syncAttacksState();
              loadMines();
              return;
          }

          knownParticipantCount = data.pc || 1;

          // LÓGICA HÍBRIDA
          if (knownParticipantCount <= 1 && !data.win) {
              localAttacksLeft = data.al;
              // No modo solo, confiamos no cálculo local
              if (currentMonsterHealthGlobal <= 0 && data.hp > 0) {
                  currentMonsterHealthGlobal = data.hp;
                  updateHpBar(currentMonsterHealthGlobal, maxMonsterHealth);
              }
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
              showModalAlert("Mina conquistada/resetada!");
              renderRanking(data.r || [], false); 
              resetCombatUI();
          } else {
              updateBlindRanking(data.pc, data.md, data.td, data.il);
          }

      } catch (e) {
          console.error("Falha no batch sync:", e);
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
    if (currentMonsterHealthGlobal <= 0) {
        if (pendingBatch > 0) processAttackQueue();
        return;
    }

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
    pendingDamageBatch += damage;

    if (batchFlushTimer) clearTimeout(batchFlushTimer);

    if (isFirstAttackSequence) {
        isFirstAttackSequence = false;
        saveOptimisticState(null);
        await processAttackQueue();
        return;
    }

    const debounceTime = (knownParticipantCount <= 1) ? DEBOUNCE_TIME_SOLO : DEBOUNCE_TIME_MULTI;
    const threshold = (knownParticipantCount <= 1) ? BATCH_THRESHOLD_SOLO : BATCH_THRESHOLD_MULTI;

    if (pendingBatch >= threshold || currentMonsterHealthGlobal <= 0) {
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
        combatTimerInterval = null;
        onCombatTimerEnd();
      }
    }, 1000);
  }

  async function onCombatTimerEnd() {
    try {
      if (!currentMineId) return;
      showLoading();
      await supabase.rpc("end_mine_combat_session", { _mine_id: currentMineId });
      showModalAlert("Tempo esgotado!");
    } catch (e) {
    } finally {
      resetCombatUI();
    }
  }

  async function resetCombatUI() { 
    const mineToUpdate = currentMineId;

    if (combatModal) combatModal.style.display = "none";
    
    clearOptimisticState();
    currentMineId = null;
    clearActivity();
    
    if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
    if (buyAttackBtn) { buyAttackBtn.disabled = true; }
    
    pendingBatch = 0;
    pendingDamageBatch = 0;
    if(batchFlushTimer) clearTimeout(batchFlushTimer);
    
    ambientMusic.pause();
    ambientMusic.currentTime = 0;

    if (mineToUpdate) {
        const updatedMine = await updateSingleMineCard(mineToUpdate);
        
        // Verifica se precisa renderizar nova mina
        if (updatedMine && updatedMine.status === 'disputando') {
            try {
                const renderedIds = Array.from(document.querySelectorAll('.mine-card'))
                                         .map(el => el.id.replace('mine-card-', ''));
                
                const { data: newMine, error } = await supabase.rpc('get_next_open_mine', { 
                    p_visible_ids: renderedIds 
                });

                if (!error && newMine && newMine.length > 0) {
                    renderAndAppendSingleCard(newMine[0]);
                }
            } catch (err) {
                console.warn("[Mines] Erro ao buscar próxima mina:", err);
            }
        }
    } else {
        loadMines();
    }
  }

  // =================================================================
  // 14. PVP (DESAFIO E SIMULAÇÃO)
  // =================================================================
  async function challengeMine(targetMine, owner, allMines) {
    if (!userId) return;
    const ownerName = owner.name || "Desconhecido";

    // Verifica se está caçando em outra página
    const activity = getActivity();
    if (activity?.type === 'hunting') {
      const regionName = activity.region || 'uma região';
      showModalAlert(`<strong>Você não é onipresente...</strong><br>No momento você está caçando em <strong>${esc(regionName)}</strong>.<br>Pause a caçada para minerar.`);
      return;
    }

    showLoading();
    try {
        // [OTIMIZADO]
        const { data } = await supabase.rpc('get_player_pvp_simple', { p_player_id: userId });
        const attemptsLeft = data?.l || 0;

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
            startPvpCombat(targetMine.id, owner.id, owner.name, owner.avatar_url);
        };
        confirmCancelBtn.onclick = () => confirmModal.style.display = 'none';
    } catch (e) { showModalAlert("Erro PvP check."); } finally { hideLoading(); }
  }

  async function startPvpCombat(mineId, ownerId, ownerName, ownerAvatar) {
    showLoading();
    try {
        const challengerData = await getOrUpdatePlayerStatsCache();
        
        let challengerAvatarUrl = 'https://aden-rpg.pages.dev/assets/default_avatar.png';
        const cachedP = await getCachedPlayerData();
        if(cachedP && cachedP.avatar_url) challengerAvatarUrl = cachedP.avatar_url;

        const challengerMaxHp = Number(challengerData.health || 0);
        let challengerCurrentHp = challengerMaxHp;
        
        const { data, error } = await supabase.rpc("capture_mine", { p_challenger_id: userId, p_mine_id: mineId });
        if (error || !data?.success) throw error || data?.message;

        let defenderMaxHp = 0;
        const combatLog = data.combat.battle_log;
        
        let totalDmgToDefender = 0;
        combatLog.forEach(l => {
            if (l.attacker_id !== ownerId) totalDmgToDefender += l.damage;
        });
        const defenderLeft = data.combat.defender_health_left;
        defenderMaxHp = defenderLeft + totalDmgToDefender;
        let defenderCurrentHp = defenderMaxHp;

        challengerName.textContent = challengerData.name || "Desafiante";
        defenderName.textContent = ownerName || "Dono";
        challengerAvatar.src = challengerAvatarUrl;
        defenderAvatar.src = ownerAvatar || 'https://aden-rpg.pages.dev/assets/default_avatar.png';
        
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

        for (const turn of combatLog) {
            const targetElement = turn.attacker_id === ownerId ? challengerSide : defenderSide;
            if (turn.attacker_id === ownerId) {
                challengerCurrentHp = Math.max(0, challengerCurrentHp - Number(turn.damage));
                updatePvpHpBar(challengerHpFill, challengerHpText, challengerCurrentHp, challengerMaxHp);
            } else {
                defenderCurrentHp = Math.max(0, defenderCurrentHp - Number(turn.damage));
                updatePvpHpBar(defenderHpFill, defenderHpText, defenderCurrentHp, defenderMaxHp);
            }
            displayDamageNumber(turn.damage, turn.critical, turn.evaded, targetElement);
            const victimAvatarId = turn.attacker_id === ownerId ? "challengerAvatar" : "defenderAvatar";
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
  // 15. INICIALIZAÇÃO OTIMIZADA (MONOLITH PATTERN + LAZY OWNERS)
  // =================================================================
  async function boot() {
    try {
      userId = await getLocalUserId();
      if (window.currentPlayerId) userId = window.currentPlayerId;
      if (!userId && typeof session !== 'undefined' && session) userId = session.user.id;
      
      if (!userId) { window.location.href = "index.html"; return; }

      const BOT_IDS = ["bc6b795d-da47-4f14-9f57-3781bfb21e53", "856545ef-e33e-4b86-b2af-71957a9772f9", "9d0af1a4-7f36-4f19-9ce6-5e507b17e912", "37baa684-f4dc-4d80-93cb-9004a3cbe2b9", "1888d6d8-ca41-48cc-b92e-e48af088d643"];

      try { await supabase.rpc('populate_bot_mines', { p_bot_ids: BOT_IDS }); } catch (e) {}
      try { await supabase.rpc('resolve_all_expired_mines'); } catch (e) {}
      try { await supabase.rpc('reset_player_pvp_attempts'); } catch (e) {}

      showLoading();
      
      const cachedOwners = await GlobalDB.getAllOwners();
      globalOwnersMap = { ...cachedOwners };

      // 3. MONOLITH FETCH (1 única requisição RPC)
      const lastSync = localStorage.getItem(STORAGE_KEY_LAST_SYNC) || '1970-01-01T00:00:00Z';
      
      const { data, error } = await supabase.rpc('get_mine_boot_state', { 
          p_player_id: userId,
          p_last_sync_time: lastSync
      });

      if (error) throw error;

      // A) Stats
      if (data.s && data.s.success) {
          cachedCombatStats = data.s; 
          localStorage.setItem(`player_combat_stats_${userId}`, JSON.stringify({ timestamp: Date.now(), data: data.s }));
      }

      // B) Attacks
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

      // C) PvP Info
      if (data.p) {
          if (playerAttemptsSpan) playerAttemptsSpan.textContent = data.p.l; 
          if (window.currentPlayerData) {
               window.currentPlayerData.mine_pvp_attempts_left = data.p.l;
               window.currentPlayerData.mine_pvp_attempts_bought_count = data.p.b;
          }
      }

      // D) Owners (Compatibilidade)
      if (data.o && data.o.length > 0) {
          await GlobalDB.saveOwners(data.o); 
          data.o.forEach(o => { globalOwnersMap[o.i] = { id: o.i, name: o.n, avatar_url: o.a, guild_id: o.g }; });
      }

      // E) Minas (Render)
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
      
      // LAZY LOAD DE DONOS
      const allOwnerIds = mappedMines.map(m => m.owner_player_id).filter(Boolean);
      const uniqueOwnerIds = [...new Set(allOwnerIds)];
      const missingIds = uniqueOwnerIds.filter(id => !globalOwnersMap[id]);

      if (missingIds.length > 0) {
          const { data: profiles } = await supabase.rpc('get_missing_profiles', { p_user_ids: missingIds });
          if (profiles) {
              await GlobalDB.saveOwners(profiles);
              profiles.forEach(p => globalOwnersMap[p.id] = p);
          }
      }
      
      renderMines(mappedMines, globalOwnersMap);
      await updateDominantGuild(mappedMines, globalOwnersMap);
      
      const myMine = mappedMines.find(m => m.owner_player_id === userId);
      myOwnedMineId = myMine ? myMine.id : null;
      updatePlayerMineUI(mappedMines);

      // F) Logs (Histórico)
      const newLogs = data.l || [];
      if (newLogs.length > 0) {
          const mappedLogs = newLogs.map(l => ({
              attacker_name: l.an, 
              attack_time: l.at, 
              damage_dealt_by_attacker: l.da, 
              damage_dealt_by_defender: l.dd 
          }));
          const currentLogs = getLocalLogs();
          const updatedLogs = [...currentLogs, ...mappedLogs];
          if (updatedLogs.length > 50) updatedLogs.splice(0, updatedLogs.length - 50);
          
          saveLocalLogs(updatedLogs);
          localStorage.setItem(STORAGE_KEY_LAST_SYNC, mappedLogs[mappedLogs.length - 1].attack_time);
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
    if (cycleInfoElement) cycleInfoElement.innerHTML = ` <strong>${formatTimeHHMMSS(diffInSeconds)}</strong>`;
    checkEventStatus();
  }
  setInterval(updateCountdown, 1000);
  updateCountdown();

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