document.addEventListener("DOMContentLoaded", async () => {
  console.log("[mines] DOM ready");

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
      // compat: alguns navegadores aceitam Promise, outros usam callback
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
      // console.log(`[audio] pré-carregado ${name}`);
    } catch (e) {
      console.warn(`[audio] preload ${name} falhou, fallback ativado:`, e);
      audioBuffers[name] = null;
    }
  }

  // Preload dos sons curtos que serão disparados com frequência
  preload('normal');
  preload('critical');
  preload('evade');

  // Mantemos ambient e avisos em HTMLAudio (loop e desbloqueio fácil)
  const ambientMusic = new Audio(audioFiles.ambient);
  ambientMusic.volume = 0.05;
  ambientMusic.loop = true;

  const avisoTelaSound = new Audio(audioFiles.avisoTela);
  avisoTelaSound.volume = 0.5;
  const obrigadoSound = new Audio(audioFiles.obrigado);
  obrigadoSound.volume = 0.5;

  // Garante que o AudioContext é retomado após a primeira interação do usuário
  document.addEventListener("click", async () => {
    try { if (audioContext.state === 'suspended') await audioContext.resume(); } catch(e) {}
    avisoTelaSound.play().then(()=> { avisoTelaSound.pause(); avisoTelaSound.currentTime = 0; }).catch(()=>{});
    obrigadoSound.play().then(()=> { obrigadoSound.pause(); obrigadoSound.currentTime = 0; }).catch(()=>{});
  }, { once: true });

  // Função universal para tocar sons (usa WebAudio se pré-carregado, senão fallback com new Audio)
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
    // fallback HTMLAudio (cria nova instância para permitir sobreposição)
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

  // --- Estado ---
  let userId = null;
  let monsterHpInterval = null;
  let historyCache = [];
  let logsPollInterval = null;
  let buyMode = 'attack';
  let playerOwnedMineId = null;
  let currentMineId = null;
  let maxMonsterHealth = 1;
  let attacksLeft = 0;
  let cooldownInterval = null;
  let combatTimerInterval = null;
  let combatTimeLeft = 0;
  const MINES_REFRESH_MS = 20000;
  let minesRefreshInterval = null;
  let rankingInterval = null;
  const RANKING_REFRESH_MS = 20000;
  
  let hasAttackedOnce = false;
// --- Controladores de auto-refresh de minas ---
  function startMinesAutoRefresh() {
    // evita múltiplos intervalos
    if (minesRefreshInterval) return;
    // só inicia se não estivermos em um combate (currentMineId === null)
    if (currentMineId) return;
    minesRefreshInterval = setInterval(() => {
      // antes de chamar loadMines checamos se o usuário ainda está na tela das minas e a página visível
      if (!document.hidden && !currentMineId) {
        loadMines().catch(e => console.warn("[mines] auto loadMines falhou:", e));
      }
    }, MINES_REFRESH_MS);
    // faz um primeiro carregamento imediato (opcional)
    // loadMines().catch(()=>{});
  }

  function stopMinesAutoRefresh() {
    if (minesRefreshInterval) {
      clearInterval(minesRefreshInterval);
      minesRefreshInterval = null;
    }
  }

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
  
  // --- Footer & History DOM elements ---
  const playerAttemptsSpan = document.getElementById("playerPVPAttemptsLeft");
  const buyPVPAttemptsBtn = document.getElementById("buyPVPAttemptsBtn");
  const playerMineSpan = document.getElementById("playerOwnedMine");
  const historyModal = document.getElementById("historyModal");
  const historyList = document.getElementById("historyList");
  const openHistoryBtn = document.getElementById("openHistoryBtn");
  const closeHistoryBtn = document.getElementById("closeHistoryBtn");
  const newLogIndicator = document.querySelector(".new-log-indicator");
  
  // --- Elementos do Modal PvP ---
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
  
  // Modal de compra PvE
  const buyModal = document.getElementById("buyModal");
  const buyPlayerGoldInfo = document.getElementById("buyPlayerGoldInfo");
  const buyAttackQtySpan = document.getElementById("buyAttackQty");
  const buyAttackCostInfo = document.getElementById("buyAttackCostInfo");
  const buyDecreaseQtyBtn = document.getElementById("buyDecreaseQtyBtn");
  const buyIncreaseQtyBtn = document.getElementById("buyIncreaseQtyBtn");
  const buyCancelBtn = document.getElementById("buyCancelBtn");
  const buyConfirmBtn = document.getElementById("buyConfirmBtn");

  if (!minesContainer) {
    console.error("[mines] ERRO: não achei #minesContainer (ou #minasContainer)");
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
  
  // --- Funções de atualização da barra de vida PvP ---
  function updatePvpHpBar(element, textElement, current, max) {
    const c = Math.max(0, Number(current || 0));
    const m = Math.max(1, Number(max || 1));
    const pct = Math.max(0, Math.min(100, (c / m) * 100));
    if (element) {
        element.style.width = `${pct}%`;
    }
    if (textElement) {
        textElement.textContent = `${c.toLocaleString()} / ${m.toLocaleString()}`;
    }
  }

  function displayDamageNumber(damage, isCrit, isEvaded, targetElement) {
    if (!targetElement) return;
    const el = document.createElement("div");
    
    // **CORREÇÃO AQUI**
    if (isEvaded) {
        el.textContent = "Desviou";
        el.className = "evade-text";
        playSound('evade', { volume: 0.3 });
    } else {
        el.textContent = Number(damage).toLocaleString();
        el.className = isCrit ? "crit-damage-number" : "damage-number";
        // Som do ataque (PvE/PvP)
        try {
          if (isCrit) playSound('critical', { volume: 0.1 });
          else playSound('normal', { volume: 0.06 });
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
      confirmMessage.innerHTML = message; // Use innerHTML para formatar
      confirmCancelBtn.style.display = 'none';
      confirmActionBtn.textContent = 'Ok';
      confirmActionBtn.onclick = () => { confirmModal.style.display = 'none'; };
      confirmModal.style.display = 'flex';
    } else {
      alert(message);
    }
  }

  // --- Ranking ---
  async function fetchAndRenderDamageRanking() {
    if (!currentMineId || !damageRankingList) return;
    try {
      const { data, error } = await supabase.rpc("get_mine_damage_ranking", { _mine_id: currentMineId });
      if (error) {
        console.warn("[mines] get_mine_damage_ranking falhou:", error.message);
        return;
      }
      damageRankingList.innerHTML = "";
      for (const row of (data || [])) {
        const li = document.createElement("li");
        li.innerHTML = `
          <div class="ranking-entry">
            <img src="${esc(row.avatar_url || '/assets/default_avatar.png')}" alt="Avatar" class="ranking-avatar">
            <span class="player-name">${esc(row.player_name)}</span>
            <span class="player-damage">${Number(row.total_damage_dealt||0).toLocaleString()}</span>
          </div>`;
        damageRankingList.appendChild(li);
      }
    } catch (e) {
      console.error("[mines] fetchAndRenderDamageRanking erro:", e);
    }
  }

  async function refreshPlayerStats() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('players').select('gold, crystals').eq('id', user.id).single();
    } catch (e) {
      console.warn("[mines] refreshPlayerStats:", e?.message || e);
    }
  }

  // --- Compra de ataques ---
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
    if (buyConfirmBtn) buyConfirmBtn.disabled = (total > (buyPlayerGold || 0));
  }

  async function openBuyModal() {
    buyMode = 'attack'; // Garante que este modal é apenas para ataques PvE
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
        const rpcFunction = 'buy_mine_attack'; // Apenas para PvE
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
            await updatePlayerAttacksUI();
        }
    } catch (e) {
      console.error("[mines] buyConfirm erro:", e);
      showModalAlert("Erro inesperado durante a compra.");
    } finally {
      hideLoading();
    }
  });


  // --- Funções do Rodapé e Histórico ---
  const buyPvpModal = document.getElementById('buyPvpModal');
  const buyPvpPlayerGoldInfo = document.getElementById('buyPvpPlayerGoldInfo');
  const buyPvpQtySpan = document.getElementById('buyPvpQty');
  const buyPvpCostInfo = document.getElementById('buyPvpCostInfo');
  const buyPvpDecreaseQtyBtn = document.getElementById('buyPvpDecreaseQtyBtn');
  const buyPvpIncreaseQtyBtn = document.getElementById('buyPvpIncreaseQtyBtn');
  const buyPvpCancelBtn = document.getElementById('buyPvpCancelBtn');
  const buyPvpConfirmBtn = document.getElementById('buyPvpConfirmBtn');
  let buyPvpQty = 1;
  let buyPvpPlayerGold = 0;
  let buyPvpBaseBoughtCount = 0;

  function calcPvpCost(qty, baseCount) {
    let total = 0;
    for (let i = 0; i < qty; i++) {
      const group = Math.floor((baseCount + i) / 5); // a cada 5 compras aumenta
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
    buyPvpConfirmBtn.disabled = (total > buyPvpPlayerGold);
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
    } catch (e) {
        console.error("[mines] openBuyPvpModal erro:", e);
        showModalAlert("Erro ao abrir modal de compra PvP.");
    }
  }

  function closeBuyPvpModal() {
      if (buyPvpModal) buyPvpModal.style.display = 'none';
  }

  async function checkForNewPvpLogs() {
    if (!userId || !newLogIndicator) return;
    try {
        // CORREÇÃO: Removido o parâmetro p_limit que causava o erro
        const { data, error } = await supabase.rpc('get_pvp_history', { p_player_id: userId });
        if (error) {
            console.warn("[mines] Falha ao checar novos logs:", error.message);
            return;
        }
        
        if (data && data.length > 0) {
            newLogIndicator.style.display = 'block';
        } else {
            newLogIndicator.style.display = 'none';
        }
    } catch (e) {
        console.error("[mines] Erro em checkForNewPvpLogs:", e);
    }
  }
  
  // -- FUNÇÃO CORRIGIDA --
  async function updatePVPAttemptsUI() {
    if (!userId) return;
    try {
        // CORREÇÃO: Lê o valor diretamente da tabela 'players'
        const { data, error } = await supabase.from('players').select('mine_pvp_attempts_left, last_mine_pvp_reset').eq('id', userId).single();
        if (error) throw error;
        
        let attemptsLeft = data?.mine_pvp_attempts_left || 0;
        const lastResetDate = data?.last_mine_pvp_reset ? new Date(data.last_mine_pvp_reset).getUTCDate() : null;
        const todayDate = new Date().getUTCDate();

        // Se o dia do último reset for diferente de hoje, chama a função de reset
        if (lastResetDate !== todayDate) {
            const { error: resetError } = await supabase.rpc('reset_daily_pvp_attempts', { p_player_id: userId });
            if (resetError) throw resetError;
            attemptsLeft = 5; // Define o valor de exibição para 5 após o reset
        }

        if (playerAttemptsSpan) {
            playerAttemptsSpan.textContent = attemptsLeft;
        }
    } catch (e) {
        console.warn("[mines] updatePVPAttemptsUI failed:", e);
    }
  }

  async function updatePlayerMineUI() {
    if (!userId) return;
    try {
        const { data, error } = await supabase.from('mining_caverns').select('name, id').eq('owner_player_id', userId).single();
        if (error && error.code !== 'PGRST116') { // PGRST116 = linha não encontrada
            throw error;
        }
        if (playerMineSpan) {
            playerMineSpan.textContent = data ? data.name : 'Nenhuma';
        }
    } catch (e) {
        console.warn("[mines] updatePlayerMineUI failed:", e);
    }
  }

  async function fetchAndRenderHistory() {
    showLoading();
    try {
        if (newLogIndicator) newLogIndicator.style.display = 'none';

        const { data, error } = await supabase.rpc('get_pvp_history', { p_player_id: userId });
        if (error) throw error;
        historyCache = data || [];
        
        localStorage.setItem('pvpHistory', JSON.stringify(historyCache));
        
        await supabase.rpc('clear_pvp_history', { p_player_id: userId });

        historyList.innerHTML = "";
        if (historyCache.length === 0) {
            historyList.innerHTML = "<li>Nenhum ataque registrado.</li>";
        } else {
            for (const entry of historyCache.slice(0, 10)) {
                const li = document.createElement("li");
                const date = new Date(entry.attack_time).toLocaleString();
                let resultText, resultColor;
                if (entry.damage_dealt_by_defender >= entry.damage_dealt_by_attacker) {
                    resultText = "Você venceu";
                    resultColor = "yellow";
                } else {
                    resultText = "Você perdeu";
                    resultColor = "red";
                }
                li.innerHTML = `
                    <span><strong>Data:</strong> ${date}</span>
                    <span><strong>Atacante:</strong> ${esc(entry.attacker_name)}</span>
                    <span><strong>Dano Recebido:</strong> ${entry.damage_dealt_by_attacker.toLocaleString()}</span>
                    <span><strong>Dano Causado:</strong> ${entry.damage_dealt_by_defender.toLocaleString()}</span>
                    <span><strong>Resultado:</strong> <strong style="color: ${resultColor};">${resultText}</strong></span>
                `;
                historyList.appendChild(li);
            }
        }
        historyModal.style.display = 'flex';
    } catch (e) {
        console.error("[mines] Erro ao carregar histórico:", e);
        showModalAlert("Erro ao carregar histórico.");
    } finally {
        hideLoading();
    }
  }

  function closeHistory() {
      if (historyModal) historyModal.style.display = 'none';
  }

  // --- UI ataques/cooldown ---
  async function updatePlayerAttacksUI() {
    try {
      const { data: player, error } = await supabase.rpc("get_player_attacks_state", { _player_id: userId });
      if (error) { console.error("Erro ao buscar ataques do jogador:", error); return; }
      
      attacksLeft = player.attacks_left;
      const timeToNextAttack = player.time_to_next_attack;

      if (playerAttacksSpan) playerAttacksSpan.textContent = `${attacksLeft}/5`;
      updatePVPAttemptsUI(); // Atualiza a barra do footer também
      if (cooldownInterval) clearInterval(cooldownInterval);

      if (attacksLeft < 5) {
        let timeRemaining = timeToNextAttack;
        if (attackCooldownSpan) attackCooldownSpan.textContent = `(+ 1 em ${Math.max(0, timeRemaining)}s)`;
        cooldownInterval = setInterval(() => {
          timeRemaining--;
          if (timeRemaining > 0) {
            if (attackCooldownSpan) attackCooldownSpan.textContent = `(+ 1 em ${timeRemaining}s)`;
          } else {
            clearInterval(cooldownInterval);
            cooldownInterval = null;
            updatePlayerAttacksUI();
          }
        }, 1000);
      } else {
        if (attackCooldownSpan) attackCooldownSpan.textContent = "";
      }
      if (buyAttackBtn) buyAttackBtn.disabled = false;
    } catch (e) {
      console.warn("[mines] updatePlayerAttacksUI:", e?.message || e);
    }
  }

  // --- Carregar minas + finalizar combates expirados ---
  async function loadMines() {
    showLoading();
    try {
      let { data: mines, error } = await supabase
        .from("mining_caverns")
        .select("id, name, status, monster_health, owner_player_id, open_time, competition_end_time, initial_monster_health")
        .order("name", { ascending: true });
      if (error) throw error;

      const now = new Date();
      const expiradas = (mines || []).filter(m => m.status === "disputando" && m.competition_end_time && new Date(m.competition_end_time) <= now);
      if (expiradas.length) {
        await Promise.all(expiradas.map(m => supabase.rpc("end_mine_combat_session", { _mine_id: m.id })));
        const res2 = await supabase
          .from("mining_caverns")
          .select("id, name, status, monster_health, owner_player_id, open_time, competition_end_time, initial_monster_health")
          .order("name", { ascending: true });
        if (!res2.error) mines = res2.data || [];
      }

      const ownerIds = Array.from(new Set((mines || []).map(m => m.owner_player_id).filter(Boolean)));
      const ownersMap = {};
      if (ownerIds.length) {
        const { data: ownersData, error: ownersError } = await supabase.from("players").select("id, name, avatar_url").in("id", ownerIds);
        if (ownersError) throw ownersError;
        (ownersData || []).forEach(p => ownersMap[p.id] = p);
      }

      renderMines(mines || [], ownersMap);
      await checkForNewPvpLogs();
      await updatePVPAttemptsUI();   // Atualiza tentativas PvP no footer
      await updatePlayerMineUI();    // Atualiza a mina do jogador no footer
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
        collectingHtml = `<p>${crystals} cristais</p>`;
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
    // Interrompe o auto refresh ao entrar em combate PvE
    stopMinesAutoRefresh();
    try {
      // RESETA O FLAG AQUI para cada novo combate
      hasAttackedOnce = false;

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

      await updatePlayerAttacksUI();

      if (cavern.competition_end_time) {
        const remaining = Math.max(0, Math.floor((new Date(cavern.competition_end_time).getTime() - Date.now()) / 1000));
        startCombatTimer(remaining);
      } else {
        if (combatTimerSpan) combatTimerSpan.textContent = "Aguardando 1º golpe";
        if (combatTimerInterval) clearInterval(combatTimerInterval);
      }

      if (combatModal) combatModal.style.display = "flex";
      await fetchAndRenderDamageRanking();

      if (rankingInterval) clearInterval(rankingInterval);
      rankingInterval = setInterval(fetchAndRenderDamageRanking, RANKING_REFRESH_MS);

      ambientMusic.play();
    } catch (e) {
      console.error("[mines] startCombat erro:", e);
      showModalAlert("Erro ao entrar no combate.");
    } finally {
      hideLoading();
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
      const { data, error } = await supabase.rpc("end_mine_combat_session", { _mine_id: currentMineId });
      if (error) {
        console.error("[mines] end_mine_combat_session erro:", error);
        showModalAlert("Erro ao encerrar a sessão de combate.");
      } else {
        const newOwnerId = data?.new_owner_id || null;
        const newOwnerName = data?.new_owner_name || null;
        if (newOwnerId) {
          if (newOwnerId === userId) showModalAlert("Você causou o maior dano e conquistou a mina!");
          else showModalAlert(`O tempo acabou! ${newOwnerName || "Outro jogador"} conquistou a mina.`);
        } else {
          showModalAlert("Tempo esgotado: ninguém causou dano. A mina foi resetada.");
        }
      }
    } catch (e) {
      console.error("[mines] onCombatTimerEnd erro:", e);
    } finally {
      resetCombatUI();
      await loadMines();
    }
  }

  // --- Ataque PvE ---
  async function attack() {
    if (attackBtn) {
        // Remove a classe para garantir que a animação possa ser reativada
        attackBtn.classList.remove('attack-anim');
        // Força o navegador a reiniciar a animação (reflow)
        void attackBtn.offsetWidth;
        // Adiciona a classe para iniciar a animação de zoom
        attackBtn.classList.add('attack-anim');
    }
    
    if (!currentMineId) return;
    if (attackBtn) attackBtn.disabled = true;
    try {
      const sel = await supabase.from("mining_caverns").select("status").eq("id", currentMineId).single();
      if (sel.data?.status === "aberta") {
        const res = await supabase.rpc("start_mine_combat", { _player_id: userId, _mine_id: currentMineId });
        if (res.error || !res.data?.success) {
          showModalAlert(res.error?.message || res.data?.message || "Falha ao iniciar combate.");
          return;
        }
      }

      const { data, error } = await supabase.rpc("attack_mine_monster", { _player_id: userId, _mine_id: currentMineId });
      if (error) { showModalAlert("Erro ao atacar: " + error.message); return; }
      if (data.success === false) { showModalAlert(data.message); await updatePlayerAttacksUI(); return; }

      displayDamageNumber(data.damage_dealt, !!data.is_crit, false, monsterArea);
      if (!hasAttackedOnce) { hasAttackedOnce = true; }
      updateHpBar(data.current_monster_health, data.max_monster_health || maxMonsterHealth);
      fetchAndRenderDamageRanking();

      attacksLeft = data.attacks_left;
      if (playerAttacksSpan) playerAttacksSpan.textContent = `${attacksLeft}/5`;

      if (data.competition_end_time && combatTimerInterval === null) {
        const remaining = Math.max(0, Math.floor((new Date(data.competition_end_time).getTime() - Date.now()) / 1000));
        startCombatTimer(remaining);
      }

      if (data.owner_set) {
        await new Promise(r => setTimeout(r, 1200));
        if (data.new_owner_id) {
          if (data.new_owner_id === userId) showModalAlert("Você derrotou o monstro e conquistou a mina!");
          else showModalAlert(`O monstro foi derrotado! ${data.new_owner_name || 'Outro jogador'} conquistou a mina.`);
        } else {
          showModalAlert("O monstro foi derrotado, mas a mina foi resetada.");
        }
        resetCombatUI();
        await loadMines();
      } else {
        updatePlayerAttacksUI();
      }
    } catch (e) {
      console.error("[mines] attack erro:", e);
      showModalAlert("Erro ao atacar.");
    } finally {
        if (attackBtn) attackBtn.disabled = false;
    }
  }

  // --- PvP: Abre modal de confirmação com aviso ---
  async function challengeMine(targetMine, owner, allMines) {
    if (!userId) return;
    
    const ownerName = owner.name || "Desconhecido";
    
    showLoading();
    try {
        const { data: player, error } = await supabase.from('players').select('mine_pvp_attempts_left, last_mine_pvp_reset').eq('id', userId).single();
        if (error) throw error;
        
        let attemptsLeft = player.mine_pvp_attempts_left;
        const lastResetDate = player.last_mine_pvp_reset ? new Date(player.last_mine_pvp_reset).getUTCDate() : null;
        const todayDate = new Date().getUTCDate();

        if (lastResetDate !== todayDate) {
            attemptsLeft = 5;
        }

        if (attemptsLeft <= 0) {
            showModalAlert("Você não tem mais tentativas de captura hoje.");
            return;
        }

        let warningMessage = "";
        const currentOwnedMine = allMines.find(m => m.owner_player_id === userId);
        if (currentOwnedMine) {
            warningMessage = `<br><br><strong style="color: #ffcc00;">AVISO:</strong> Você já é o dono da mina "${esc(currentOwnedMine.name)}". Ao desafiar, você abandonará sua mina atual.`;
        }

        confirmMessage.innerHTML = `Você tem <strong>${attemptsLeft}</strong> tentativa(s) restante(s).<br>Deseja desafiar <strong>${esc(ownerName)}</strong>?${warningMessage}`;
        confirmCancelBtn.style.display = 'inline-block';
        confirmActionBtn.textContent = 'Desafiar';
        confirmModal.style.display = 'flex';

        confirmActionBtn.onclick = () => {
            confirmModal.style.display = 'none';
            startPvpCombat(targetMine.id, owner.id, owner.name, owner.avatar_url);
        };

        confirmCancelBtn.onclick = () => {
            confirmModal.style.display = 'none';
        };
    } catch (e) {
        console.error("[mines] challengeMine erro:", e);
        showModalAlert("Erro ao verificar suas tentativas de PvP.");
    } finally {
        hideLoading();
    }
  }

  // --- Inicia e simula o combate PvP ---
  async function startPvpCombat(mineId, ownerId, ownerName, ownerAvatar) {
    showLoading();
    // assegura que as minas não fiquem sendo recarregadas durante a simulação PvP
    stopMinesAutoRefresh();
    try {
        // Busca os stats de combate do desafiante
        const { data: challengerData, error: challengerError } = await supabase.rpc('get_player_combat_stats', { p_player_id: userId });
        if (challengerError) throw challengerError;
        if (!challengerData?.success) {
            showModalAlert(challengerData?.message || "Erro ao obter os atributos do desafiante.");
            return;
        }
        
        // Busca os stats de combate do defensor
        const { data: defenderData, error: defenderError } = await supabase.rpc('get_player_combat_stats', { p_player_id: ownerId });
        if (defenderError) throw defenderError;
        if (!defenderData?.success) {
            showModalAlert(defenderData?.message || "Erro ao obter os atributos do defensor.");
            return;
        }
        
        // Busca o avatar do desafiante separadamente, pois a função RPC não o retorna
        const { data: challengerInfo, error: challengerInfoError } = await supabase.from('players').select('avatar_url').eq('id', userId).single();
        if (challengerInfoError) throw challengerInfoError;

        const challengerMaxHp = Number(challengerData.health || 0);
        const defenderMaxHp = Number(defenderData.health || 0);
        
        let challengerCurrentHp = challengerMaxHp;
        let defenderCurrentHp = defenderMaxHp;

        const { data, error } = await supabase.rpc("capture_mine", { p_challenger_id: userId, p_mine_id: mineId });
        if (error) throw error;
        if (!data?.success) {
            showModalAlert(data?.message || "O desafio falhou por um motivo desconhecido.");
            return;
        }

        challengerName.textContent = challengerData.name || "Desafiante";
        defenderName.textContent = ownerName || "Dono";
        // Usa o URL do avatar buscado separadamente
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
                // Defender atacou, desafiante recebeu dano
                challengerCurrentHp = Math.max(0, challengerCurrentHp - Number(turn.damage));
                updatePvpHpBar(challengerHpFill, challengerHpText, challengerCurrentHp, challengerMaxHp);
            } else {
                // Desafiante atacou, defensor recebeu dano
                defenderCurrentHp = Math.max(0, defenderCurrentHp - Number(turn.damage));
                updatePvpHpBar(defenderHpFill, defenderHpText, defenderCurrentHp, defenderMaxHp);
            }

            // **CORREÇÃO AQUI**: Passando a flag 'evaded'
            displayDamageNumber(turn.damage, turn.critical, turn.evaded, targetElement);
            
            await new Promise(r => setTimeout(r, 1000));
        }

        await new Promise(r => setTimeout(r, 1000));

        const winnerId = data.combat?.winner_id;
        const crystalsMsg = `Cristais distribuídos: ${data.crystals_distributed || 0}`;
        if (winnerId === userId) {
            showModalAlert(`VOCÊ VENCEU a batalha e conquistou a mina!<br>${crystalsMsg}`);
        } else {
            showModalAlert(`Você foi derrotado. O dono defendeu a mina!<br>${crystalsMsg}`);
        }

    } catch (e) {
        console.error("[mines] startPvpCombat erro:", e);
        showModalAlert("Ocorreu um erro crítico ao desafiar a mina.");
    } finally {
        if(pvpCombatModal) pvpCombatModal.style.display = 'none';
        hideLoading();
        // reinicia auto refresh após PvP
        startMinesAutoRefresh();
        await loadMines();
    }
  }

  // --- Encerrar manualmente ---
  async function endCombat() {
    // RESETA O FLAG AQUI para cada novo combate
    hasAttackedOnce = false;
    resetCombatUI();
    await loadMines();
  }

  function resetCombatUI() {
    if (combatModal) combatModal.style.display = "none";
    if (monsterHpFill) monsterHpFill.style.width = "100%";
    if (monsterHpTextOverlay) monsterHpTextOverlay.textContent = "";
    if (damageRankingList) damageRankingList.innerHTML = "";
    currentMineId = null;
    if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
    if (rankingInterval) { clearInterval(rankingInterval); rankingInterval = null; }
    if (buyAttackBtn) { buyAttackBtn.disabled = true; }
    ambientMusic.pause();
    ambientMusic.currentTime = 0;

    // reinicia o auto refresh quando o combate termina / UI é resetada
    startMinesAutoRefresh();
  }

  // --- Listeners globais ---
  if (attackBtn) attackBtn.addEventListener("click", attack);
  if (backBtn) backBtn.addEventListener("click", endCombat);
  if (buyAttackBtn) {
    buyAttackBtn.addEventListener("click", () => {
      if (!hasAttackedOnce) {
        showModalAlert("A compra de ataques só é possível após você realizar o primeiro ataque.");
        return;
      }
      openBuyModal();
    });
  }
  if (buyPVPAttemptsBtn) buyPVPAttemptsBtn.addEventListener("click", () => openBuyPvpModal());
  if (openHistoryBtn) openHistoryBtn.addEventListener("click", fetchAndRenderHistory);
  if (closeHistoryBtn) closeHistoryBtn.addEventListener("click", closeHistory);
  if (refreshBtn) refreshBtn.addEventListener("click", () => { loadMines(); });

  if (buyPvpIncreaseQtyBtn) buyPvpIncreaseQtyBtn.addEventListener("click", () => { buyPvpQty += 1; refreshBuyPvpModalUI(); });
  if (buyPvpDecreaseQtyBtn) buyPvpDecreaseQtyBtn.addEventListener("click", () => { if (buyPvpQty > 1) buyPvpQty -= 1; refreshBuyPvpModalUI(); });
  if (buyPvpCancelBtn) buyPvpCancelBtn.addEventListener("click", closeBuyPvpModal);
  if (buyPvpConfirmBtn) buyPvpConfirmBtn.addEventListener("click", async () => {
    closeBuyPvpModal();
    showLoading();
    let purchased = 0;
    let spent = 0;
    try {
        // CORREÇÃO: Voltando ao método de loop com a função correta
        for (let i = 0; i < buyPvpQty; i++) {
            const { data, error } = await supabase.rpc("buy_mine_pvp_attack", { p_player_id: userId });
            if (error || !data?.success) {
                if (purchased === 0) showModalAlert(error?.message || data?.message || "Compra não pôde ser concluída.");
                break;
            }
            purchased++;
            spent += (data.cost || 0);
            buyPvpPlayerGold = Math.max(0, (buyPvpPlayerGold || 0) - (data.cost || 0));
        }
        if (purchased > 0) {
            showModalAlert(`Comprado(s) ${purchased} tentativa(s) PvP por ${spent} Ouro.`);
            await refreshPlayerStats();
            await updatePVPAttemptsUI();
        }
    } catch (e) {
        console.error("[mines] buyPvpConfirm erro:", e);
        showModalAlert("Erro inesperado durante a compra PvP.");
    } finally {
        hideLoading();
    }
  });

  // --- Boot ---
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "login.html"; return; }
    userId = user.id;
    await loadMines();
    await refreshPlayerStats();
    await updatePVPAttemptsUI();
    await updatePlayerMineUI(); 
    await checkForNewPvpLogs();
    if (!document.hidden) startMinesAutoRefresh();
  } catch (e) {
    console.error("[mines] auth erro:", e);
    window.location.href = "login.html";
  }

  window.addEventListener("beforeunload", () => {
    stopMinesAutoRefresh();
    if (combatTimerInterval) clearInterval(combatTimerInterval);
    if (cooldownInterval) clearInterval(cooldownInterval);
    if (rankingInterval) clearInterval(rankingInterval);
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
    const formattedTime = formatTime(diffInSeconds);
    if (cycleInfoElement) {
      cycleInfoElement.innerHTML = `Próxima sessão em: <strong>${formattedTime}</strong>`;
    }
  }
  updateCountdown();
  setInterval(updateCountdown, 1000);

  
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'hidden') {
      // pausa auto-refresh ao ocultar a aba/tela
      stopMinesAutoRefresh();

      if (currentMineId) {
        // ao sair durante combate, apenas toca aviso
        avisoTelaSound.currentTime = 0;
        avisoTelaSound.play().catch(e => console.warn("Falha ao tocar aviso:", e));
      }
      return;
    }

    // ao voltar para visível
    if (currentMineId) {
      // Pega nome da mina em disputa e mostra alerta
      supabase.from("mining_caverns")
        .select("name")
        .eq("id", currentMineId)
        .single()
        .then(({ data }) => {
          const mineName = data?.name || "mina desconhecida";
          resetCombatUI(); // força fechar modal
          showModalAlert(`Você saiu da tela durante a disputa pela ${mineName}.`);
        })
        .catch(() => {
          resetCombatUI();
          showModalAlert("Você saiu da tela durante a disputa por uma mina.");
        });

      obrigadoSound.currentTime = 0;
      obrigadoSound.play().catch(e => console.warn("Falha ao tocar obrigado:", e));
    } else {
      startMinesAutoRefresh(); // só reinicia se não houver combate
    }

    // Atualiza interface imediatamente
    loadMines().catch(e => console.warn("[mines] loadMines on visibilitychange falhou:", e));
  });

});