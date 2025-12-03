document.addEventListener("DOMContentLoaded", async () => {
  console.log("[mines] DOM ready - Versão Completa Otimizada (Baixo Egress + PvP Full)");

  // --- Áudio (WebAudio + fallback) ---
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
        console.warn("[audio] WebAudio play falhou, fallback:", e);
      }
    }
    try {
      const s = new Audio(audioFiles[name] || audioFiles.normal);
      s.volume = vol;
      s.play().catch(()=>{});
    } catch(e) {}
  }

  // --- Supabase ---
  const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- Estado Otimizado ---
  let userId = null;
  let buyMode = 'attack';
  let currentMineId = null;
  let maxMonsterHealth = 1;
  
  // Estado Local de Ataques (Optimistic UI)
  let localAttacksLeft = 0;
  let nextAttackTime = null; // Timestamp em milissegundos
  let cooldownInterval = null;

  let combatTimerInterval = null;
  let combatTimeLeft = 0;
  let hasAttackedOnce = false;

  // --- DOM ---
  const minesContainer = document.getElementById("minesContainer") || document.getElementById("minasContainer");
  const combatModal = document.getElementById("combatModal");
  const combatTitle = document.getElementById("combatModalTitle");
  const combatTimerSpan = document.getElementById("combatTimer");
  const playerAttacksSpan = document.getElementById("playerAttacks");
  const attackCooldownSpan = document.getElementById("attackCooldown");
  const attackBtn = document.getElementById("attackBtn");
  const backBtn = document.getElementById("backBtn");
  const monsterImage = document.getElementById("monsterImage");
  const monsterHpFill = document.getElementById("monsterHpFill");
  const monsterHpTextOverlay = document.getElementById("monsterHpTextOverlay");
  const loadingOverlay = document.getElementById("loading-overlay");
  const monsterArea = document.getElementById("monsterArea");
  const damageRankingList = document.getElementById("damageRankingList");
  const confirmModal = document.getElementById("confirmModal");
  const confirmMessage = document.getElementById("confirmMessage");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");
  const confirmActionBtn = document.getElementById("confirmActionBtn");
  const buyAttackBtn = document.getElementById("buyAttackBtn");
  const cycleInfoElement = document.getElementById("cycleInfo");
  const refreshBtn = document.getElementById("refreshBtn");
  
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
  
  // Buy Modals
  const buyModal = document.getElementById("buyModal");
  const buyPlayerGoldInfo = document.getElementById("buyPlayerGoldInfo");
  const buyAttackQtySpan = document.getElementById("buyAttackQty");
  const buyAttackCostInfo = document.getElementById("buyAttackCostInfo");
  const buyDecreaseQtyBtn = document.getElementById("buyDecreaseQtyBtn");
  const buyIncreaseQtyBtn = document.getElementById("buyIncreaseQtyBtn");
  const buyCancelBtn = document.getElementById("buyCancelBtn");
  const buyConfirmBtn = document.getElementById("buyConfirmBtn");

  const buyPvpModal = document.getElementById('buyPvpModal');
  const buyPvpPlayerGoldInfo = document.getElementById('buyPvpPlayerGoldInfo');
  const buyPvpQtySpan = document.getElementById('buyPvpQty');
  const buyPvpCostInfo = document.getElementById('buyPvpCostInfo');
  const buyPvpDecreaseQtyBtn = document.getElementById('buyPvpDecreaseQtyBtn');
  const buyPvpIncreaseQtyBtn = document.getElementById('buyPvpIncreaseQtyBtn');
  const buyPvpCancelBtn = document.getElementById('buyPvpCancelBtn');
  const buyPvpConfirmBtn = document.getElementById('buyPvpConfirmBtn');

  if (!minesContainer) {
    console.error("[mines] ERRO: não achei #minesContainer");
    return;
  }

  // --- Utils ---
  function showLoading() { if (loadingOverlay) loadingOverlay.style.display = "flex"; }
  function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = "none"; }
  const esc = (s) => (s === 0 || s) ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;") : "";

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    let result = '';
    if (h > 0) result += `${h}h `;
    if (m > 0) result += `${m}m `;
    result += `${ss}s`;
    return result.trim();
  }

  function updateHpBar(cur, max) {
    const c = Math.max(0, Number(cur || 0));
    const m = Math.max(1, Number(max || 1));
    if (monsterHpFill) {
      const pct = Math.max(0, Math.min(100, (c / m) * 100));
      monsterHpFill.style.width = `${pct}%`;
    }
    if (monsterHpTextOverlay) {
      monsterHpTextOverlay.textContent = `${c.toLocaleString()} / ${m.toLocaleString()}`;
    }
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
        try {
          if (isCrit) playSound('critical', { volume: 0.1 });
          else playSound('normal', { volume: 0.5 });
        } catch(_) {}
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

  // --- LÓGICA DE RANKING (Vindo do Ataque/Load) ---
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
            <img src="${esc(row.avatar_url || '/assets/default_avatar.png')}" alt="Avatar" class="ranking-avatar">
            <span class="player-name">${esc(row.player_name)} ${isMe ? '(Você)' : ''}</span>
            <span class="player-damage">${Number(row.total_damage_dealt||0).toLocaleString()}</span>
          </div>`;
        damageRankingList.appendChild(li);
      }
  }

  async function refreshPlayerStats() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('players').select('gold, crystals').eq('id', user.id).single();
    } catch (e) {}
  }

  // --- HISTÓRICO INCREMENTAL (Cache) ---
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
          // Usa RPC incremental para economizar banda
          const { data, error } = await supabase.rpc('sync_pvp_history', { 
              p_player_id: userId, 
              p_last_sync_time: lastSync 
          });

          if (error) { console.warn("Sync error:", error); return; }

          const newLogs = data.new_logs || [];
          if (newLogs.length > 0) {
              const currentLogs = getLocalLogs();
              // Adiciona novos e mantém limite de 50
              const updatedLogs = [...currentLogs, ...newLogs];
              if (updatedLogs.length > 50) updatedLogs.splice(0, updatedLogs.length - 50);
              
              saveLocalLogs(updatedLogs);
              const lastLogTime = newLogs[newLogs.length - 1].attack_time;
              localStorage.setItem(STORAGE_KEY_LAST_SYNC, lastLogTime);
              
              if (newLogIndicator) newLogIndicator.style.display = 'block';
          }
      } catch (e) {
          console.warn("[mines] sync history error:", e);
      }
  }

  function openHistory() {
      const logs = getLocalLogs();
      // Ordena decrescente para exibição
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

  // --- Compra de ataques PvE ---
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
    buyMode = 'attack';
    if (!userId) { showModalAlert("Faça login para comprar."); return; }
    try {
      const { data: player, error } = await supabase.from("players").select("gold, attacks_bought_count").eq("id", userId).single();
      if (error) throw error;
      
      buyPlayerGold = player.gold || 0;
      buyBaseBoughtCount = player.attacks_bought_count || 0;
      buyQty = 1;
      refreshBuyModalUI();
      if (buyModal) buyModal.style.display = "flex";
    } catch (e) {
      console.error("[mines] openBuyModal erro:", e);
      showModalAlert("Erro ao abrir modal de compra.");
    }
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
        const rpcFunction = 'buy_mine_attack';
        for (let i = 0; i < buyQty; i++) {
            const { data, error } = await supabase.rpc(rpcFunction, { p_player_id: userId });
            if (error || !data?.success) {
                if (purchased === 0) showModalAlert(error?.message || data?.message || "Compra não pôde ser concluída.");
                break;
            }
            purchased += 1;
            spent += (data.cost || 0);
            buyPlayerGold = Math.max(0, (buyPlayerGold || 0) - (data.cost || 0));
        }
        if (purchased > 0) {
            showModalAlert(`Comprado(s) ${purchased} ataque(s) PvE por ${spent} Ouro.`);
            await refreshPlayerStats();
            // Ao comprar, precisamos sincronizar o contador local
            await syncAttacksState();
        }
    } catch (e) {
      console.error("[mines] buyConfirm erro:", e);
      showModalAlert("Erro inesperado durante a compra.");
    } finally {
      hideLoading();
    }
  });


  // --- Compra PvP ---
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
    if (!userId) { showModalAlert("Faça login para comprar."); return; }
    try {
        const { data: player, error } = await supabase.from("players").select("gold, mine_pvp_attempts_bought_count").eq("id", userId).single();
        if (error) throw error;
        buyPvpPlayerGold = player.gold || 0;
        buyPvpBaseBoughtCount = player.mine_pvp_attempts_bought_count || 0;
        buyPvpQty = 1;
        refreshBuyPvpModalUI();
        if (buyPvpModal) buyPvpModal.style.display = 'flex';
    } catch (e) { showModalAlert("Erro ao abrir modal de compra PvP."); }
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
                if (purchased === 0) showModalAlert(error?.message || data?.message || "Compra não pôde ser concluída.");
                break;
            }
            purchased++; spent += (data.cost || 0);
            buyPvpPlayerGold = Math.max(0, (buyPvpPlayerGold || 0) - (data.cost || 0));
        }
        if (purchased > 0) {
            showModalAlert(`Comprado(s) ${purchased} tentativa(s) PvP por ${spent} Ouro.`);
            await refreshPlayerStats();
            await updatePVPAttemptsUI();
        }
    } catch (e) { showModalAlert("Erro inesperado."); } finally { hideLoading(); }
  });

  // --- UI Updates ---
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
        const { data, error } = await supabase.from('mining_caverns').select('name, id').eq('owner_player_id', userId).single();
        if (playerMineSpan) playerMineSpan.textContent = data ? data.name : 'Nenhuma';
    } catch (e) {}
  }

  // --- SISTEMA DE COOLDOWN LOCAL (Sem Fetch Loop) ---
  function startLocalCooldownTimer() {
      if (cooldownInterval) clearInterval(cooldownInterval);
      const updateTimerUI = () => {
          if (localAttacksLeft >= 5) {
              if (attackCooldownSpan) attackCooldownSpan.textContent = "";
              clearInterval(cooldownInterval);
              return;
          }
          if (!nextAttackTime) return;
          const now = Date.now();
          const diff = nextAttackTime - now;
          if (diff <= 0) {
              // Tempo acabou, ganha ataque
              localAttacksLeft = Math.min(5, localAttacksLeft + 1);
              updateAttacksDisplay();
              if (localAttacksLeft < 5) {
                  nextAttackTime = Date.now() + 30000;
              } else {
                  nextAttackTime = null;
                  clearInterval(cooldownInterval);
              }
          } else {
              const sec = Math.ceil(diff / 1000);
              if (attackCooldownSpan) attackCooldownSpan.textContent = `(+ 1 em ${sec}s)`;
          }
      };
      updateTimerUI();
      cooldownInterval = setInterval(updateTimerUI, 1000);
  }

  function updateAttacksDisplay() {
      if (playerAttacksSpan) playerAttacksSpan.textContent = `${localAttacksLeft}/5`;
      if (localAttacksLeft <= 0) {
          if (attackBtn) { attackBtn.classList.add('disabled-attack-btn'); attackBtn.disabled = true; }
      } else {
          if (attackBtn) { attackBtn.classList.remove('disabled-attack-btn'); attackBtn.disabled = false; }
      }
  }

  async function syncAttacksState() {
      try {
          // Busca estado real no servidor uma vez
          const { data, error } = await supabase.rpc("get_player_attacks_state", { _player_id: userId });
          if (error) throw error;
          
          localAttacksLeft = data.attacks_left;
          
          if (data.time_to_next_attack > 0) {
              nextAttackTime = Date.now() + (data.time_to_next_attack * 1000);
              startLocalCooldownTimer();
          } else if (localAttacksLeft < 5) {
               nextAttackTime = Date.now() + 30000;
               startLocalCooldownTimer();
          } else {
               nextAttackTime = null;
               if (cooldownInterval) clearInterval(cooldownInterval);
               if (attackCooldownSpan) attackCooldownSpan.textContent = "";
          }
          updateAttacksDisplay();
      } catch (e) {
          console.warn("Sync attacks fail:", e);
      }
  }

  // --- Guilda Dominante ---
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

  // --- Carregar minas ---
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

      renderMines(mines || [], ownersMap);
      await updateDominantGuild(mines || [], ownersMap);
      await syncAndCheckLogs();
      await updatePVPAttemptsUI();
      await updatePlayerMineUI();
    } catch (err) {
      console.error("[mines] loadMines erro:", err);
      minesContainer.innerHTML = `<p>Erro ao carregar minas: ${esc(err.message || err)}</p>`;
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

  // --- Entrar/Iniciar Combate PvE ---
  async function startCombat(mineId) {
    showLoading();
    hasAttackedOnce = false;
    try {
      // Trigger global de limpeza de minas expiradas
      supabase.rpc('resolve_all_expired_mines').then(()=>{});

      const sel = await supabase
        .from("mining_caverns")
        .select("id, name, status, monster_health, initial_monster_health, owner_player_id, competition_end_time")
        .eq("id", mineId)
        .single();
      if (sel.error || !sel.data) { showModalAlert("Caverna não encontrada."); return; }
      const cavern = sel.data;
      if (cavern.owner_player_id) { showModalAlert('Esta mina já tem um dono. Use "Desafiar".'); return; }

      currentMineId = mineId;
      maxMonsterHealth = Number(cavern.initial_monster_health || 1);
      updateHpBar(cavern.monster_health, maxMonsterHealth);
      if (combatTitle) combatTitle.textContent = `Disputa pela ${esc(cavern.name)}`;

      await syncAttacksState();

      if (cavern.competition_end_time) {
        const remaining = Math.max(0, Math.floor((new Date(cavern.competition_end_time).getTime() - Date.now()) / 1000));
        startCombatTimer(remaining);
      } else {
        if (combatTimerSpan) combatTimerSpan.textContent = "Aguardando 1º golpe";
        if (combatTimerInterval) clearInterval(combatTimerInterval);
      }

      if (combatModal) combatModal.style.display = "flex";
      
      // Busca Ranking Inicial (Única vez)
      const { data: rankingData } = await supabase.rpc("get_mine_damage_ranking", { _mine_id: currentMineId });
      renderRanking(rankingData);

      ambientMusic.play();
    } catch (e) {
      console.error("[mines] startCombat erro:", e);
      showModalAlert("Erro ao entrar no combate.");
    } finally {
      hideLoading();
    }
  }

  // --- Ataque PvE (OTIMIZADO) ---
  async function attack() {
    if (attackBtn) {
        attackBtn.classList.remove('attack-anim');
        void attackBtn.offsetWidth;
        attackBtn.classList.add('attack-anim');
    }
    
    if (!currentMineId) return;
    if (attackBtn) attackBtn.disabled = true;

    // --- Optimistic Update Local ---
    if (localAttacksLeft > 0) {
        localAttacksLeft--;
        updateAttacksDisplay();
        // Se não tinha timer, inicia um de 30s
        if (!nextAttackTime) {
            nextAttackTime = Date.now() + 30000;
            startLocalCooldownTimer();
        }
    }

    try {
      const { data, error } = await supabase.rpc("attack_mine_monster", { _player_id: userId, _mine_id: currentMineId });
      
      if (error) throw error;
      if (data.success === false) { 
          showModalAlert(data.message); 
          syncAttacksState(); // Rollback do ataque gasto se falhou
          return; 
      }

      displayDamageNumber(data.damage_dealt, !!data.is_crit, false, monsterArea);
      if (!hasAttackedOnce) { hasAttackedOnce = true; }
      updateHpBar(data.current_monster_health, data.max_monster_health || maxMonsterHealth);
      
      // Atualiza Ranking com dados do RPC
      if (data.ranking) {
          renderRanking(data.ranking);
      }

      // Sync do contador real
      if (typeof data.attacks_left === 'number') {
          localAttacksLeft = data.attacks_left;
          updateAttacksDisplay();
      }

      if (data.competition_end_time && !combatTimerInterval) {
        const remaining = Math.max(0, Math.floor((new Date(data.competition_end_time).getTime() - Date.now()) / 1000));
        startCombatTimer(remaining);
      }

      if (data.owner_set) {
        await new Promise(r => setTimeout(r, 1200));
        showModalAlert("O monstro foi derrotado! Mina conquistada ou resetada.");
        resetCombatUI();
        await loadMines();
      }
    } catch (e) {
      console.error("[mines] attack erro:", e);
      syncAttacksState(); // Resync em caso de erro
    } finally {
        if (localAttacksLeft > 0 && attackBtn) attackBtn.disabled = false;
    }
  }

  // --- Timers e UI Helper ---
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
      console.error("[mines] onCombatTimerEnd erro:", e);
    } finally {
      resetCombatUI();
      await loadMines();
    }
  }

  function resetCombatUI() {
    if (combatModal) combatModal.style.display = "none";
    if (monsterHpFill) monsterHpFill.style.width = "100%";
    if (monsterHpTextOverlay) monsterHpTextOverlay.textContent = "";
    if (damageRankingList) damageRankingList.innerHTML = "";
    currentMineId = null;
    if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
    if (cooldownInterval) { clearInterval(cooldownInterval); cooldownInterval = null; }
    if (buyAttackBtn) { buyAttackBtn.disabled = true; }
    ambientMusic.pause();
    ambientMusic.currentTime = 0;
  }

  // --- PvP Logic (Original preservada) ---
  async function challengeMine(targetMine, owner, allMines) {
    if (!userId) return;
    const ownerName = owner.name || "Desconhecido";
    showLoading();
    try {
        const { data: player, error } = await supabase.from('players').select('mine_pvp_attempts_left').eq('id', userId).single();
        if (error) throw error;
        
        let attemptsLeft = player.mine_pvp_attempts_left;
        if (attemptsLeft <= 0) { showModalAlert("Sem tentativas de PvP hoje."); return; }

        let warningMessage = "";
        const currentOwnedMine = allMines.find(m => m.owner_player_id === userId);
        if (currentOwnedMine) warningMessage = `<br><br><strong style="color: #ffcc00;">AVISO:</strong> Abandonará "${esc(currentOwnedMine.name)}".`;

        confirmMessage.innerHTML = `Tentativas: <strong>${attemptsLeft}</strong>.<br>Desafiar <strong>${esc(ownerName)}</strong>?${warningMessage}`;
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
        const { data: challengerData, error: ce } = await supabase.rpc('get_player_combat_stats', { p_player_id: userId });
        const { data: defenderData, error: de } = await supabase.rpc('get_player_combat_stats', { p_player_id: ownerId });
        if (ce || de) throw "Erro stats";
        
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

  // --- Boot ---
  async function boot() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "login.html"; return; }
      userId = user.id;

      supabase.rpc('resolve_all_expired_mines');
      supabase.rpc('reset_player_pvp_attempts');

      await Promise.all([
          loadMines(),
          syncAndCheckLogs() // Sync inicial do histórico
      ]);
      
      syncAttacksState(); // Setup inicial de cooldowns

    } catch (e) {
      console.error("[mines] auth erro:", e);
      window.location.href = "login.html";
    }
  }

  boot();

  window.addEventListener("beforeunload", () => {
    if (combatTimerInterval) clearInterval(combatTimerInterval);
    if (cooldownInterval) clearInterval(cooldownInterval);
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
    if (cycleInfoElement) cycleInfoElement.innerHTML = ` <strong>${formatTime(diffInSeconds)}</strong>`;
  }
  updateCountdown();
  setInterval(updateCountdown, 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'hidden') {
      if (ambientMusic && !ambientMusic.paused) { ambientMusic.pause(); ambientMusic._wasPlaying = true; }
      if (currentMineId) { avisoTelaSound.currentTime = 0; avisoTelaSound.play().catch(()=>{}); }
    } else {
        // Ao voltar, recarrega se não estiver em combate
        if (!currentMineId) loadMines();
        syncAndCheckLogs();
    }
  });

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
});