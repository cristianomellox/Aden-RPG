import { supabase } from './supabaseClient.js'
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[mines] DOM ready - Versão Otimizada (Batching + Cache 12h + Sessão Persistente)");

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

  // Estado Local de Ataques (Optimistic UI)
  let localAttacksLeft = 0;
  let nextAttackTime = null; // Timestamp em milissegundos
  let cooldownInterval = null;

  // Timers de Combate
  let combatTimerInterval = null;
  let combatTimeLeft = 0;

  // --- NOVAS VARIÁVEIS PARA OTIMIZAÇÃO (BATCH & CACHE) ---
  let cachedCombatStats = null;      // Stats de combate (Dano, Crit)
  let pendingBatch = 0;              // Contagem de ataques na fila
  let batchFlushTimer = null;        // Timer para enviar se parar de clicar
  let currentMonsterHealthGlobal = 0; // HP Otimista Global
  
  // CONFIGURAÇÃO DE BATCH E DEBOUNCE
  const BATCH_THRESHOLD = 5;         // Envia a cada 5 ataques
  const DEBOUNCE_TIME_MS = 60000;     // Tempo de espera
  const STATS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 Horas
  
  // Controle do primeiro ataque
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
  const refreshBtn = document.getElementById("refreshBtn");
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
  // 4. CACHE HELPER & AUTH
  // =================================================================
  
  function getLocalUserId() {
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
  function getCachedPlayerData() {
    try {
      if (window.currentPlayerData) return window.currentPlayerData;
      const cached = localStorage.getItem('player_data_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.data;
      }
    } catch(e) { console.warn("Erro lendo cache", e); }
    return null;
  }

  // --- CACHE DE COMBAT STATS (12 HORAS) ---
  async function getOrUpdatePlayerStatsCache(forceUpdate = false) {
    if (!userId) return null;
    const now = Date.now();
    const cacheKey = `player_combat_stats_${userId}`;
    
    // Tenta ler do LocalStorage
    let stored = localStorage.getItem(cacheKey);
    if (stored && !forceUpdate) {
        try {
            const parsed = JSON.parse(stored);
            // Verifica validade (12h)
            if (now - parsed.timestamp < STATS_CACHE_DURATION) {
                cachedCombatStats = parsed.data;
                return cachedCombatStats;
            }
        } catch(e) { console.warn("Cache stats inválido", e); }
    }

    // Busca do Backend (1 requisição a cada 12h)
    const { data, error } = await supabase.rpc('get_player_combat_stats', { p_player_id: userId });
    
    if (error || !data) {
        console.error("Erro ao buscar stats", error);
        return null;
    }

    // Salva no Cache
    const cacheObj = { timestamp: now, data: data };
    localStorage.setItem(cacheKey, JSON.stringify(cacheObj));
    cachedCombatStats = data;
    return cachedCombatStats;
  }

  function updateCachedGold(newGold) {
    try {
      if (window.currentPlayerData) window.currentPlayerData.gold = newGold;
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
  function showLoading() { if (loadingOverlay) loadingOverlay.style.display = "flex"; }
  function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = "none"; }
  const esc = (s) => (s === 0 || s) ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;") : "";

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    if (h > 0) return `${h}h ${m}m ${ss}s`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`; 
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

  async function syncAndCheckLogs() {
      if (!userId) return;
      const lastSync = localStorage.getItem(STORAGE_KEY_LAST_SYNC) || '1970-01-01T00:00:00Z';
      
      try {
          const { data, error } = await supabase.rpc('sync_pvp_history', { 
              p_player_id: userId, 
              p_last_sync_time: lastSync 
          });

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
      } catch (e) {
          console.warn("History sync error:", e);
      }
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
  function renderRanking(rankingData) {
      if (!damageRankingList) return;
      damageRankingList.innerHTML = "";
      
      if (!rankingData || rankingData.length === 0) {
          damageRankingList.innerHTML = "<li style='text-align:center;color:#888'>Nenhum dano ainda</li>";
          return;
      }

      for (const row of rankingData) {
        const isMe = row.player_id === userId;
        const li = document.createElement("li");
        li.innerHTML = `
          <div class="ranking-entry">
            <img src="${esc(row.avatar_url || '/assets/default_avatar.png')}" alt="Av" class="ranking-avatar">
            <span class="player-name">${esc(row.player_name)} ${isMe ? '(Você)' : ''}</span>
            <span class="player-damage">${Number(row.total_damage_dealt||0).toLocaleString()}</span>
          </div>`;
        damageRankingList.appendChild(li);
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
    
    // OTIMIZAÇÃO: Usa cache local em vez de fetch
    const playerData = getCachedPlayerData();
    
    if (playerData) {
       buyPlayerGold = playerData.gold || 0;
       // Fallback: Se não tiver no cache, fetch leve
       if (playerData.attacks_bought_count !== undefined) {
           buyBaseBoughtCount = playerData.attacks_bought_count;
       } else {
           const { data } = await supabase.from("players").select("attacks_bought_count").eq("id", userId).single();
           buyBaseBoughtCount = data?.attacks_bought_count || 0;
       }
    } else {
       // Fallback total
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
            
            // ATUALIZAÇÃO DO CACHE LOCAL (Sem Fetch)
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
    
    // OTIMIZAÇÃO: Usa cache local
    const playerData = getCachedPlayerData();
    if (playerData) {
        buyPvpPlayerGold = playerData.gold || 0;
        // Mesmo fallback para bought count
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
            
            // ATUALIZAÇÃO DO CACHE LOCAL
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
                   attackCooldownSpan.textContent = `(+ 1 em ${sec}s)`;
              }
          }
      };
      
      updateTimerUI();
      cooldownInterval = setInterval(updateTimerUI, 1000);
  }

  function updateAttacksDisplay() {
      if (playerAttacksSpan) playerAttacksSpan.textContent = `${localAttacksLeft}/5`;
      
      // ALTERAÇÃO: Verifica se o jogador já tem uma mina E se não está na mina dele
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

  async function loadMines() {
    showLoading();
    try {
      const { data: mines, error } = await supabase
        .from("mining_caverns")
        .select("id, name, status, monster_health, owner_player_id, open_time, competition_end_time, initial_monster_health")
        .order("name", { ascending: true });
      if (error) throw error;

      const ownerIds = Array.from(new Set((mines || []).map(m => m.owner_player_id).filter(Boolean)));
      const ownersMap = {};
      if (ownerIds.length) {
        const { data: ownersData } = await supabase.from("players").select("id, name, avatar_url, guild_id").in("id", ownerIds);
        (ownersData || []).forEach(p => ownersMap[p.id] = p);
      }

      // ALTERAÇÃO: Identifica se eu já sou dono de alguma mina
      const myMine = (mines || []).find(m => m.owner_player_id === userId);
      myOwnedMineId = myMine ? myMine.id : null;

      renderMines(mines || [], ownersMap);
      await updateDominantGuild(mines || [], ownersMap);
      await syncAndCheckLogs();
      await updatePVPAttemptsUI();
      await updatePlayerMineUI();
    } catch (err) {
      minesContainer.innerHTML = `<p>Erro: ${esc(err.message)}</p>`;
    } finally {
      hideLoading();
    }
  }

  function renderMines(mines, ownersMap) {
    minesContainer.innerHTML = "";
    for (const mine of mines) {
      const owner = ownersMap[mine.owner_player_id];
      const ownerName = owner ? (owner.name || "Desconhecido") : null;
      const ownerAvatarHtml = owner && owner.avatar_url ? `<img src="${esc(owner.avatar_url)}" alt="Avatar" class="owner-avatar" />` : '';

      let collectingHtml = "";
      if (mine.owner_player_id) {
        const start = new Date(mine.open_time || new Date());
        const seconds = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
        const crystals = Math.min(1500, Math.floor(seconds * (1500.0 / 6600)));
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
          flushTime: debounceFlushTime,
          isFirst: isFirstAttackSequence, // Flag crucial
          hasAttacked: hasAttackedOnce
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
          if (Date.now() - cached.timestamp > 5 * 60 * 1000) {
              clearOptimisticState();
              return false;
          }

          // Restaura Valores Otimistas
          currentMonsterHealthGlobal = cached.hp;
          localAttacksLeft = cached.stamina;
          pendingBatch = cached.pending;
          isFirstAttackSequence = cached.isFirst; // Recupera se é a primeira vez ou não
          hasAttackedOnce = cached.hasAttacked;
          
          updateHpBar(currentMonsterHealthGlobal, cavern.initial_monster_health);
          updateAttacksDisplay();

          // Lógica de Retomada do Batch
          if (pendingBatch > 0) {
              // Se o tempo de flush já passou enquanto estava fora, envia agora
              if (cached.flushTime && Date.now() >= cached.flushTime) {
                  // console.log("[Mines] Flush atrasado recuperado. Enviando batch...");
                  processAttackQueue(); 
              } else {
                  // Se ainda tem tempo, reinicia o timer com o tempo restante
                  const remaining = Math.max(100, cached.flushTime - Date.now());
                  if (batchFlushTimer) clearTimeout(batchFlushTimer);
                  batchFlushTimer = setTimeout(processAttackQueue, remaining);
              }
          }
          return true;

      } catch (e) {
          console.warn("Erro ao restaurar sessão:", e);
          clearOptimisticState();
          return false;
      }
  }

  async function startCombat(mineId) {
    showLoading();
    hasAttackedOnce = false;
    isFirstAttackSequence = true;
    
    // Reset de variaveis de batch
    pendingBatch = 0;
    if (batchFlushTimer) clearTimeout(batchFlushTimer);

    try {
      supabase.rpc('resolve_all_expired_mines').then(()=>{});

      const sel = await supabase
        .from("mining_caverns")
        .select("id, name, status, monster_health, initial_monster_health, owner_player_id, competition_end_time")
        .eq("id", mineId)
        .single();
      
      if (sel.error || !sel.data) { showModalAlert("Caverna não encontrada."); return; }
      const cavern = sel.data;
      if (cavern.owner_player_id) { showModalAlert('Mina já tem dono.'); return; }

      currentMineId = mineId;
      maxMonsterHealth = Number(cavern.initial_monster_health || 1);
      
      // Inicializa com dados do servidor
      currentMonsterHealthGlobal = cavern.monster_health;
      updateHpBar(currentMonsterHealthGlobal, maxMonsterHealth);
      
      // Garante que o cache de stats está pronto (12h)
      await getOrUpdatePlayerStatsCache();
      await syncAttacksState();

      // Tenta Restaurar Sessão Otimista (Se existir e for recente)
      // Se restaurar, pendingBatch e HP serão atualizados do localStorage
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
      
      const { data: rankingData } = await supabase.rpc("get_mine_damage_ranking", { _mine_id: currentMineId });
      renderRanking(rankingData ? rankingData.slice(0, 3) : []);

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

  // Processar Fila
  async function processAttackQueue() {
      if (pendingBatch === 0) return;

      const countToSend = pendingBatch;
      
      // Reseta fila imediata
      pendingBatch = 0;
      if (batchFlushTimer) clearTimeout(batchFlushTimer);

      // Limpa cache otimista pois estamos enviando
      clearOptimisticState();

      try {
          const { data, error } = await supabase.rpc("batch_attack_mine", { 
              p_player_id: userId, 
              p_mine_id: currentMineId,
              p_attack_count: countToSend
          });

          if (error) throw error;
          if (!data.success) {
              console.warn("Erro no sync:", data.message);
              showModalAlert(data.message);
              syncAttacksState();
              loadMines();
              return;
          }

          // Atualiza com a verdade do servidor
          currentMonsterHealthGlobal = data.current_monster_health;
          updateHpBar(data.current_monster_health, data.max_monster_health);
          
          if (data.ranking && data.ranking.length > 0) {
              renderRanking(data.ranking);
          }

          localAttacksLeft = data.attacks_left;
          updateAttacksDisplay();
          
          if (data.competition_end_time && !combatTimerInterval) {
             const remaining = Math.max(0, Math.floor((new Date(data.competition_end_time).getTime() - Date.now()) / 1000));
             startCombatTimer(remaining);
          }

          if (data.owner_set) {
              showModalAlert("Mina conquistada/resetada!");
              resetCombatUI();
              await loadMines();
          }

      } catch (e) {
          console.error("Falha no batch sync:", e);
          syncAttacksState();
      }
  }

  async function attack() {
    // UI Feedback
    if (attackBtn) {
        attackBtn.classList.remove('attack-anim');
        void attackBtn.offsetWidth;
        attackBtn.classList.add('attack-anim');
    }
    
    if (!currentMineId) return;

    // Check Local Stamina
    if (localAttacksLeft <= 0) return; 

    // Se não tiver stats, busca agora (fallback)
    if (!cachedCombatStats) await getOrUpdatePlayerStatsCache();
    if (!cachedCombatStats) return;

    // 1. Decrementa Stamina Local
    localAttacksLeft--;
    updateAttacksDisplay();

    // 2. Timer de Cooldown Local
    if (!nextAttackTime) {
        nextAttackTime = Date.now() + 30000;
        startLocalCooldownTimer();
    }

    // 3. Calcula Dano (Optimistic)
    const { damage, isCrit } = calculateLocalDamage(cachedCombatStats, currentMonsterHealthGlobal);
    
    // 4. Atualiza UI Monstro
    currentMonsterHealthGlobal = Math.max(0, currentMonsterHealthGlobal - damage);
    updateHpBar(currentMonsterHealthGlobal, maxMonsterHealth);
    displayDamageNumber(damage, isCrit, false, monsterArea);
    if (!hasAttackedOnce) hasAttackedOnce = true;
const mImg = document.getElementById("monsterImage");
    if (mImg) {
        mImg.classList.remove('shake-animation');
        void mImg.offsetWidth; // Força reflow (reinicia animação)
        mImg.classList.add('shake-animation');
        setTimeout(() => mImg.classList.remove('shake-animation'), 300);
    }
    // 5. Adiciona à Fila (Batch)
    pendingBatch++;

    // --- NOVA LÓGICA: PRIMEIRO ATAQUE vs BATCH ---
    if (batchFlushTimer) clearTimeout(batchFlushTimer);

    // Se for o primeiro ataque da sequência, envia imediatamente
    if (isFirstAttackSequence) {
        isFirstAttackSequence = false; // Próximos irão para batch
        // Salva estado para garantir que se o user der F5 agora, não conta como primeiro de novo
        saveOptimisticState(null);
        await processAttackQueue();    // Envia este (pendingBatch=1) agora
        return;
    }

    // Se não for o primeiro, usa lógica de Batch
    if (pendingBatch >= BATCH_THRESHOLD || currentMonsterHealthGlobal <= 0 || localAttacksLeft === 0) {
        await processAttackQueue();
    } else {
        // Debounce de 5 segundos + Salvamento Otimista
        const flushTime = Date.now() + DEBOUNCE_TIME_MS;
        batchFlushTimer = setTimeout(processAttackQueue, DEBOUNCE_TIME_MS);
        saveOptimisticState(flushTime);
    }
  }

  function startCombatTimer(seconds) {
    if (combatTimerInterval) clearInterval(combatTimerInterval);
    combatTimeLeft = Math.max(0, Number(seconds || 0));
    if (combatTimerSpan) combatTimerSpan.textContent = formatTime(combatTimeLeft);
    if (combatTimeLeft <= 0) { onCombatTimerEnd(); return; }
    combatTimerInterval = setInterval(() => {
      combatTimeLeft = Math.max(0, combatTimeLeft - 1);
      if (combatTimerSpan) combatTimerSpan.textContent = formatTime(combatTimeLeft);
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
      await loadMines();
    }
  }

  function resetCombatUI() {
    if (combatModal) combatModal.style.display = "none";
    
    // Limpa cache otimista ao sair da sessão
    clearOptimisticState();
    currentMineId = null;
    
    if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
    if (buyAttackBtn) { buyAttackBtn.disabled = true; }
    
    // Limpa filas pendentes
    pendingBatch = 0;
    if(batchFlushTimer) clearTimeout(batchFlushTimer);
    
    ambientMusic.pause();
    ambientMusic.currentTime = 0;
  }

  // =================================================================
  // 14. PVP (DESAFIO E SIMULAÇÃO)
  // =================================================================
  async function challengeMine(targetMine, owner, allMines) {
    if (!userId) return;
    const ownerName = owner.name || "Desconhecido";
    showLoading();
    try {
        let attemptsLeft = 0;
        const cached = getCachedPlayerData();
        if (cached && cached.mine_pvp_attempts_left !== undefined) {
             attemptsLeft = cached.mine_pvp_attempts_left;
        } else {
             const { data: player } = await supabase.from('players').select('mine_pvp_attempts_left').eq('id', userId).single();
             attemptsLeft = player?.mine_pvp_attempts_left || 0;
        }

        if (attemptsLeft <= 0) { showModalAlert("Sem tentativas de PvP hoje."); return; }

        let warningMessage = "";
        const currentOwnedMine = allMines.find(m => m.owner_player_id === userId);
        if (currentOwnedMine) warningMessage = `<br><br><strong style="color: #ffcc00;">AVISO:</strong> Abandonará "${esc(currentOwnedMine.name)}".`;

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
        // Usa cache para o desafiante (Otimização)
        const challengerData = await getOrUpdatePlayerStatsCache();
        
        // Defensor ainda precisa vir do DB (para ser justo/atual)
        const { data: defenderData } = await supabase.rpc('get_player_combat_stats', { p_player_id: ownerId });
        
        const { data: challengerInfo } = await supabase.from('players').select('avatar_url').eq('id', userId).single();

        const challengerMaxHp = Number(challengerData.health || 0);
        const defenderMaxHp = Number(defenderData.health || 0);
        let challengerCurrentHp = challengerMaxHp;
        let defenderCurrentHp = defenderMaxHp;

        const { data, error } = await supabase.rpc("capture_mine", { p_challenger_id: userId, p_mine_id: mineId });
        if (error || !data?.success) throw error || data?.message;

        challengerName.textContent = challengerData.name || "Desafiante";
        defenderName.textContent = ownerName || "Dono";
        challengerAvatar.src = challengerInfo.avatar_url || 'https://aden-rpg.pages.dev/assets/default_avatar.png';
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

        const combatLog = data.combat.battle_log;
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
                void vImg.offsetWidth; // Força reflow
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
    loadMines();
  }

  // =================================================================
  // 15. INICIALIZAÇÃO
  // =================================================================
  async function boot() {
    try {
      userId = getLocalUserId();
      if (window.currentPlayerId) userId = window.currentPlayerId;

      if (!userId) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) { window.location.href = "index.html"; return; }
          userId = session.user.id;
      }

      await supabase.rpc('resolve_all_expired_mines');
      await supabase.rpc('reset_player_pvp_attempts');

      await Promise.all([
          loadMines(),
          syncAndCheckLogs()
      ]);
      
      syncAttacksState();
      // Pre-aquece o cache de stats se não existir
      getOrUpdatePlayerStatsCache();

    } catch (e) {
      console.error("[mines] auth erro:", e);
      window.location.href = "index.html";
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
          
          // Força envio do que tiver pendente antes de sair (Best Effort)
          processAttackQueue();
          
          // NÃO resetamos mais a UI aqui, confiamos na persistência se ele voltar
          // resetCombatUI();
      }
    } else {
        if (currentMineId && document.visibilityState === 'visible') {
           // Se voltou e estamos em combate, tenta restaurar se algo falhou
           // A função restoreOptimisticState é chamada no start, mas aqui podemos apenas
           // verificar se o flush timer precisa ser reativado
        } else if (!currentMineId) {
           loadMines();
        }
        syncAndCheckLogs();
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
    if (cycleInfoElement) cycleInfoElement.innerHTML = ` <strong>${formatTime(diffInSeconds)}</strong>`;
  }
  setInterval(updateCountdown, 1000);
  updateCountdown();

  // Listeners
  if (attackBtn) attackBtn.addEventListener("click", attack);
  if (backBtn) backBtn.addEventListener("click", endCombat);
  if (buyAttackBtn) buyAttackBtn.addEventListener("click", () => {
      if (!hasAttackedOnce) { showModalAlert("Ataque ao menos uma vez para comprar."); return; }
      openBuyModal();
  });
  if (buyPVPAttemptsBtn) buyPVPAttemptsBtn.addEventListener("click", () => openBuyPvpModal());
  if (openHistoryBtn) openHistoryBtn.addEventListener("click", openHistory);
  if (closeHistoryBtn) closeHistoryBtn.addEventListener("click", () => historyModal.style.display = 'none');
  if (refreshBtn) refreshBtn.addEventListener("click", () => { loadMines(); });

  boot();
});