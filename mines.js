document.addEventListener("DOMContentLoaded", async () => {
  console.log("[mines] DOM ready");

  // --- Sons ---
  const normalHitSound = new Audio("https://aden-rpg.pages.dev/assets/normal_hit.mp3");
  const criticalHitSound = new Audio("https://aden-rpg.pages.dev/assets/critical_hit.mp3");
  const ambientMusic = new Audio("https://aden-rpg.pages.dev/assets/mina.mp3");

  normalHitSound.volume = 0.06;
  criticalHitSound.volume = 0.1;
  ambientMusic.volume = 0.05;
  ambientMusic.loop = true;

  function preloadSounds() {
    console.log("[mines] Pre-carregando sons...");
    normalHitSound.play().catch(e => console.warn("Erro ao reproduzir som normal:", e));
    normalHitSound.pause();
    criticalHitSound.play().catch(e => console.warn("Erro ao reproduzir som crítico:", e));
    criticalHitSound.pause();
    ambientMusic.play().catch(e => console.warn("Erro ao reproduzir música ambiente:", e));
    ambientMusic.pause();
  }

  // --- Supabase ---
  const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- Estado ---
  let userId = null;
  let currentMineId = null;
  let maxMonsterHealth = 1;

  // Ataques e cooldown
  let attacksLeft = 0;
  let lastAttackTime = null;
  const ATTACK_REGEN_TIME = 30;
  let cooldownInterval = null;

  // Timer de combate (UI)
  let combatTimerInterval = null;
  let combatTimeLeft = 0;

  // Refresh da página de minas
  const MINES_REFRESH_MS = 60000;
  let minesRefreshInterval = null;

  // --- DOM ---
  const minesContainer = document.getElementById("minesContainer");
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
  // Modal de compra
  const buyModal = document.getElementById("buyModal");
  const buyPlayerGoldInfo = document.getElementById("buyPlayerGoldInfo");
  const buyAttackQtySpan = document.getElementById("buyAttackQty");
  const buyAttackCostInfo = document.getElementById("buyAttackCostInfo");
  const buyDecreaseQtyBtn = document.getElementById("buyDecreaseQtyBtn");
  const buyIncreaseQtyBtn = document = document.getElementById("buyIncreaseQtyBtn");
  const buyCancelBtn = document.getElementById("buyCancelBtn");
  const buyConfirmBtn = document.getElementById("buyConfirmBtn");

  const confirmMessage = document.getElementById("confirmMessage");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");
  const confirmActionBtn = document.getElementById("confirmActionBtn");

  // NOVO: Elementos do DOM para Ouro e Botão de Compra
  const buyAttackBtn = document.getElementById("buyAttackBtn");
  // Elemento para o cronômetro da sessão
  const cycleInfoElement = document.getElementById("cycleInfo");
  // NOVO: Referência para o botão de refresh
  const refreshBtn = document.getElementById("refreshBtn");

  if (!minesContainer) {
    console.error("[mines] ERRO: não achei #minesContainer");
    return;
  }

  // --- Utils ---
  function showLoading() { if (loadingOverlay) loadingOverlay.style.display = "flex"; }
  function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = "none"; }
  const esc = (s) => (s === 0 || s) ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;") : "";

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    
    let result = '';
    if (h > 0) {
        result += `${h}h`;
    }
    if (m > 0) {
        if (result) result += ' ';
        result += `${m}m`;
    }
    if (ss.length > 0 || result.length === 0) {
        if (result) result += ' ';
        result += `${ss}s`;
    }
    
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

  function displayDamageNumber(damage, isCrit, side = "center") {
    if (!monsterArea || !monsterImage) return;
    const el = document.createElement("div");
    el.textContent = Number(damage).toLocaleString();
    el.className = isCrit ? "crit-damage-number" : "damage-number";
    const monsterRect = monsterImage.getBoundingClientRect();
    const combatRect = monsterArea.getBoundingClientRect();
    let left = (monsterRect.left - combatRect.left) + monsterRect.width / 2;
    let top  = (monsterRect.top  - combatRect.top ) + monsterRect.height / 2;
    if (side === "left")  left -= monsterRect.width * 0.35;
    if (side === "right") left += monsterRect.width * 0.35;
    el.style.position = "absolute";
    el.style.left = `25%`;
    el.style.top = `50%`;
    el.style.transform = "translate(-50%, -50%)";
    monsterArea.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }

  async function fetchAndRenderDamageRanking() {
    if (!currentMineId || !damageRankingList) return;
    const { data, error } = await supabase.rpc("get_mine_damage_ranking", { _mine_id: currentMineId });
    if (error) {
      console.warn("[mines] get_mine_damage_ranking falhou:", error.message);
      return;
    }
    damageRankingList.innerHTML = "";
    for (const row of (data || [])) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="player-name">${esc(row.player_name)}</span>
                      <span class="player-damage">${Number(row.total_damage_dealt||0).toLocaleString()}</span>`;
      damageRankingList.appendChild(li);
    }
  }

  function showModalAlert(message) {
      if (confirmModal && confirmMessage && confirmActionBtn && confirmCancelBtn) {
          confirmMessage.textContent = message;
          confirmCancelBtn.style.display = 'none';
          confirmActionBtn.textContent = 'Ok';
          confirmActionBtn.onclick = () => {
              confirmModal.style.display = 'none';
          };
          confirmModal.style.display = 'flex';
      } else {
          console.error("Elementos do modal de alerta não encontrados.");
      }
  }

  async function refreshPlayerStats() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: player, error } = await supabase.from('players').select('gold, crystals').eq('id', user.id).single();
      if (player) {
      }
    }
  }

  async function buyAttack() {
      if (!userId) {
          showModalAlert("Faça login para comprar ataques.");
          return;
      }
      showLoading();
      try {
          const { data, error } = await supabase.rpc('buy_mine_attack', { p_player_id: userId });

          if (error) {
              console.error('[mines] buyAttack erro:', error);
              showModalAlert(`Erro ao comprar ataque: ${error.message}`);
          } else {
              if (data.success) {
                  showModalAlert(`Ataque comprado por ${data.cost} Ouro!`);
                  // Atualizar o display de ataques e ouro
                  await refreshPlayerStats();
                  await updatePlayerAttacksUI();
              } else {
                  showModalAlert(data.message);
              }
          }
      } catch (e) {
          console.error('[mines] buyAttack catch:', e);
          showModalAlert('Erro inesperado ao comprar ataque.');
      } finally {
          hideLoading();
      }
  }


  // --- Carregar minas + finalizar combates expirados ---
  async function loadMines() {
    showLoading();
    try {
      // 1) Buscar minas
      let { data: mines, error } = await supabase
        .from("mining_caverns")
        .select("id, name, status, monster_health, owner_player_id, open_time, competition_end_time, initial_monster_health")
        .order("name", { ascending: true });
      if (error) throw error;

      // 2) Fechar combates expirados
      const now = new Date();
      const expiradas = (mines || []).filter(m => m.status === "disputando" && m.competition_end_time && new Date(m.competition_end_time) <= now);
      if (expiradas.length) {
        console.log("[mines] Fechando combates expirados:", expiradas.map(m => m.id).join(","));
        await Promise.all(expiradas.map(m => supabase.rpc("end_mine_combat_session", { _mine_id: m.id })));
        
        // Recarrega a lista após resolver expiradas
        const res2 = await supabase
          .from("mining_caverns")
          .select("id, name, status, monster_health, owner_player_id, open_time, competition_end_time, initial_monster_health")
          .order("name", { ascending: true });
        if (!res2.error) {
          mines = res2.data || [];
        }
      }

      // --- ALTERAÇÃO AQUI: Buscar nomes dos donos ANTES de renderizar ---
      const ownerIds = Array.from(new Set((mines || []).map(m => m.owner_player_id).filter(Boolean)));
      const ownersMap = {};
      if (ownerIds.length) {
        const { data: ownersData } = await supabase.from("players").select("id, name").in("id", ownerIds);
        (ownersData || []).forEach(p => ownersMap[p.id] = p.name);
      }
      
      renderMines(mines || [], ownersMap);
      
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
      const ownerName = mine.owner_player_id ? (ownersMap[mine.owner_player_id] || "Desconhecido") : null;
      let collectingHtml = "";
      if (mine.owner_player_id) {
        const start = new Date(mine.open_time || new Date());
        const seconds = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
        const crystals = Math.min(1500, Math.floor(seconds * (1500.0 / 6600))); // UI apenas
        collectingHtml = `<p>Coletando: ${crystals} cristais</p>`;
      }

      let isClickable = true;
      let actionType = null;
      let cardClass = "";

      if (mine.status === "aberta" && !mine.owner_player_id) {
        actionType = "startCombat";
      } else if (mine.status === "disputando") {
        actionType = "startCombat";
      } else if (mine.owner_player_id && mine.owner_player_id !== userId) {
        actionType = "challengeMine";
      } else if (mine.owner_player_id === userId) {
        isClickable = false;
        cardClass = "disabled-card";
      }

      const card = document.createElement("div");
      card.className = `mine-card ${mine.status || ""} ${isClickable ? 'clickable' : ''} ${cardClass}`;
      card.innerHTML = `
        <h3 style="color: yellow;">${esc(mine.name)}</h3>
        <p>${esc(mine.status || "Fechada")}</p>
        ${ownerName ? `<p><strong>Dono:</strong> ${esc(ownerName)}</p>` : "<p><strong>Sem Dono</strong></p>"}
        ${collectingHtml}`;
      
      if (isClickable) {
        card.addEventListener("click", () => {
          preloadSounds(); // Chama a função para pré-carregar os sons no primeiro clique
          if (actionType === "startCombat") {
            startCombat(mine.id);
          } else if (actionType === "challengeMine") {
            challengeMine(mine.id);
          }
        });
      }

      minesContainer.appendChild(card);
    }
  }

  // --- Entrar/Iniciar Combate ---
  async function startCombat(mineId) {
    showLoading();
    try {
      const sel = await supabase
        .from("mining_caverns")
        .select("id, name, status, monster_health, initial_monster_health, owner_player_id, competition_end_time")
        .eq("id", mineId)
        .single();
      if (sel.error || !sel.data) {
        showModalAlert("Caverna não encontrada.");
        return;
      }
      let cavern = sel.data;
      if (cavern.owner_player_id) {
        showModalAlert('Esta mina já tem um dono. Use "Desafiar".');
        return;
      }
      
      currentMineId = mineId;
      maxMonsterHealth = Number(cavern.initial_monster_health || 1);
      updateHpBar(cavern.monster_health, maxMonsterHealth);
      if (combatTitle) combatTitle.textContent = `Disputa pela ${esc(cavern.name)}`;

      await updatePlayerAttacksUI();

      if (cavern.competition_end_time) {
        const remaining = Math.max(0, Math.floor((new Date(cavern.competition_end_time).getTime() - Date.now()) / 1000));
        if (combatTimerSpan) combatTimerSpan.textContent = formatTime(remaining);
        startCombatTimer(remaining);
      } else {
        if (combatTimerSpan) combatTimerSpan.textContent = "Aguardando 1º golpe";
        if (combatTimerInterval) clearInterval(combatTimerInterval);
      }
      
      if (combatModal) combatModal.style.display = "flex";
      fetchAndRenderDamageRanking();
      ambientMusic.play(); // Inicia a música de ambiente

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
    if (combatTimeLeft <= 0) {
      onCombatTimerEnd();
      return;
    }
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
      if (error) throw error;
      if (data?.new_owner_id) {
        showModalAlert(data.new_owner_id === userId ? "Você causou o maior dano e conquistou a mina!" : "O tempo acabou! Outro jogador conquistou a mina.");
      } else {
        showModalAlert("Tempo esgotado: ninguém causou dano. A mina foi resetada.");
      }
    } catch (e) {
      console.error("[mines] onCombatTimerEnd erro:", e);
    } finally {
      resetCombatUI();
      await loadMines();
    }
  }

  // Função para atualizar os ataques e o cooldown na UI
  async function updatePlayerAttacksUI() {
    const { data: player, error } = await supabase.rpc("get_player_attacks_state", { _player_id: userId });
    
    if (error) {
      console.error("Erro ao buscar ataques do jogador:", error);
      return;
    }
    
    attacksLeft = player.attacks_left;
    const timeToNextAttack = player.time_to_next_attack;
    
    // NOVO: Exibir a quantidade de ataques
    if (playerAttacksSpan) playerAttacksSpan.textContent = `${attacksLeft}/5`;
    
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

    // NOVO: Atualizar o texto do botão de compra
    const attacksBought = player.attacks_bought_count;
    const nextCost = 10 + (Math.floor(attacksBought / 5) * 5);
    if (buyAttackBtn) {
        buyAttackBtn.textContent = `+`;
    }
  }

  // --- Ataque ---
  async function attack() {
    if (!currentMineId) return;
    
    // NOVO: Habilita o botão de compra após o primeiro ataque
    if (buyAttackBtn) {
        buyAttackBtn.disabled = false;
    }

    try {
      // 🔹 Primeiro golpe? Se sim, iniciar o combate
      const sel = await supabase
        .from("mining_caverns")
        .select("status")
        .eq("id", currentMineId)
        .single();
      if (sel.data?.status === "aberta") {
        const res = await supabase.rpc("start_mine_combat", { _player_id: userId, _mine_id: currentMineId });
        if (res.error || !res.data || !res.data.success) {
          showModalAlert(res.error?.message || res.data?.message || "Falha ao iniciar combate.");
          return;
        }
      }

      // Agora sim, atacar normalmente
      const { data, error } = await supabase.rpc("attack_mine_monster", { _player_id: userId, _mine_id: currentMineId });
      
      if (error) {
        showModalAlert("Erro ao atacar: " + error.message);
        return;
      }
      
      if (data.success === false) {
        showModalAlert(data.message);
        await updatePlayerAttacksUI();
        return;
      }

      displayDamageNumber(data.damage_dealt, !!data.is_crit);
      updateHpBar(data.current_monster_health, data.max_monster_health || maxMonsterHealth);
      fetchAndRenderDamageRanking();

      // 🎵 Toca o som de ataque usando cloneNode() para evitar bloqueio
      if (data.is_crit) {
          const soundToPlay = criticalHitSound.cloneNode();
          soundToPlay.volume = criticalHitSound.volume;
          soundToPlay.play();
      } else {
          const soundToPlay = normalHitSound.cloneNode();
          soundToPlay.volume = normalHitSound.volume;
          soundToPlay.play();
      }
      
      // Atualiza a UI com os dados do servidor
      attacksLeft = data.attacks_left;
      if (playerAttacksSpan) playerAttacksSpan.textContent = `${attacksLeft}/5`;

      // Inicia o cronômetro do combate no primeiro ataque, se ainda não estiver rodando
      if (data.competition_end_time && combatTimerInterval === null) {
        const remaining = Math.max(0, Math.floor((new Date(data.competition_end_time).getTime() - Date.now()) / 1000));
        if (combatTimerSpan) combatTimerSpan.textContent = formatTime(remaining);
        startCombatTimer(remaining);
      }

      if (data.owner_set) {
        await new Promise(r => setTimeout(r, 1200));
        if (data.new_owner_id === userId) {
          showModalAlert("Você derrotou o monstro e conquistou a mina!");
        } else if (data.new_owner_id) {
          showModalAlert("O monstro foi derrotado por outro jogador!");
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
    }
  }

  // --- Encerrar modal manualmente (ex: botão voltar) ---
  async function endCombat() {
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

    // NOVO: Desabilita o botão de compra quando o combate termina
    if (buyAttackBtn) {
        buyAttackBtn.disabled = true;
    }
  }

  // --- PvP: desafiar dono ---
  async function challengeMine(mineId) {
    showLoading();
    try {
      const { data, error } = await supabase.rpc("capture_mine", { p_challenger_id: userId, p_mine_id: mineId });
      if (error) throw error;
      if (!data?.success) {
        showModalAlert(data?.message || "Desafio falhou.");
        return;
      }

      // Anima os ataques (se retornados)
      if (data.combat?.attacks?.length) {
        if (combatTitle) combatTitle.textContent = "Desafio pela Mina";
        if (combatModal) combatModal.style.display = "flex";
        ambientMusic.play(); // Inicia a música para o desafio
        let side = "left";
        for (const atk of data.combat.attacks) {
          displayDamageNumber(atk.damage, !!atk.is_crit, side);
          side = side === "left" ? "right" : "left";
          await new Promise(r => setTimeout(r, 450));
        }
        await new Promise(r => setTimeout(r, 1200));
      }

      const winnerId = data.combat?.winner_id;
      if (winnerId === userId) {
        showModalAlert(`Você venceu! Cristais distribuídos: ${data.crystals_distributed}.`);
      } else {
        showModalAlert(`Você foi derrotado. Cristais distribuídos: ${data.crystals_distributed}.`);
      }
      resetCombatUI();
      await loadMines();
    } catch (e) {
      console.error("[mines] challengeMine erro:", e);
      showModalAlert("Erro ao desafiar a mina.");
    } finally {
      hideLoading();
    }
  }


  // --- Modal de compra: estado e funções ---
  let buyQty = 1;
  let buyPlayerGold = 0;
  let buyBaseBoughtCount = 0; // attacks_bought_count no momento de abrir o modal

  function calcTotalCost(qty, baseCount) {
    // soma progressiva: 10,10,10,10,10, 15x5, 20x5, ...
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
    if (buyAttackCostInfo) buyAttackCostInfo.innerHTML = `Custo total:<br><img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width: 30px; height: 27px; vertical-align: -4px"><strong> ${total}</strong>`;
    if (buyPlayerGoldInfo) buyPlayerGoldInfo.innerHTML = `Você tem: <br><img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width: 30px; height: 27px; vertical-align: -4px"><strong> ${Number(buyPlayerGold || 0).toLocaleString()}</strong>`;
    if (buyConfirmBtn) {
      // desabilita confirmar se não tem ouro suficiente
      buyConfirmBtn.disabled = (total > (buyPlayerGold || 0));
    }
  }

  async function openBuyModal() {
    if (!userId) {
      showModalAlert("Faça login para comprar ataques.");
      return;
    }
    try {
      const { data: player, error } = await supabase
        .from("players").select("gold, attacks_bought_count").eq("id", userId).single();
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

  function closeBuyModal() {
    if (buyModal) buyModal.style.display = "none";
  }

  // Eventos dos botões do modal de compra
  if (buyIncreaseQtyBtn) {
    buyIncreaseQtyBtn.addEventListener("click", () => {
      buyQty += 1;
      refreshBuyModalUI();
    });
  }
  if (buyDecreaseQtyBtn) {
    buyDecreaseQtyBtn.addEventListener("click", () => {
      if (buyQty > 1) buyQty -= 1;
      refreshBuyModalUI();
    });
  }
  if (buyCancelBtn) {
    buyCancelBtn.addEventListener("click", () => {
      closeBuyModal();
    });
  }
  if (buyConfirmBtn) {
    buyConfirmBtn.addEventListener("click", async () => {
      // Realiza as compras em sequência
      closeBuyModal();
      showLoading();
      let purchased = 0;
      let spent = 0;
      try {
        for (let i = 0; i < buyQty; i++) {
          const { data, error } = await supabase.rpc('buy_mine_attack', { p_player_id: userId });
          if (error) {
            console.error('[mines] buy_mine_attack erro:', error);
            if (purchased === 0) showModalAlert(`Erro ao comprar ataque: ${error.message}`);
            break;
          }
          if (!data || !data.success) {
            if (purchased === 0) showModalAlert(data?.message || "Compra não pôde ser concluída.");
            break;
          }
          purchased += 1;
          spent += (data.cost || 0);
          // Atualiza ouro local para bloquear compra além do saldo durante o loop
          buyPlayerGold = Math.max(0, (buyPlayerGold || 0) - (data.cost || 0));
        }
        if (purchased > 0) {
          showModalAlert(`Comprados ${purchased} ataque(s) por ${spent} Ouro.`);
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
  }

  // --- Listeners globais ---
  if (attackBtn) attackBtn.addEventListener("click", attack);
  if (backBtn) backBtn.addEventListener("click", endCombat);
  // NOVO: Listener para o botão de compra
  if (buyAttackBtn) {
    buyAttackBtn.addEventListener("click", openBuyModal);
    // Continua começando desabilitado; habilita após o primeiro ataque
    buyAttackBtn.disabled = true;
  }
  // Adicionando listener para o novo botão de refresh
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadMines();
    });
  }

  // --- Boot ---
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "login.html"; return; }
    userId = user.id;
    await loadMines();
    await refreshPlayerStats(); // NOVO: Carregar stats do jogador ao iniciar
    minesRefreshInterval = setInterval(loadMines, MINES_REFRESH_MS);
  } catch (e) {
    console.error("[mines] auth erro:", e);
    window.location.href = "login.html";
  }

  // cleanup
  window.addEventListener("beforeunload", () => {
    if (minesRefreshInterval) clearInterval(minesRefreshInterval);
    if (combatTimerInterval) clearInterval(combatTimerInterval);
  });

  // --- Lógica para o cronômetro da próxima sessão ---
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

      if (diffInSeconds <= 0) {
          // Se a sessão já começou, reseta o cronômetro para a próxima hora par
          if (cycleInfoElement) {
              cycleInfoElement.innerHTML = `Sessão em andamento!`;
          }
          setTimeout(updateCountdown, 1000); // Tenta atualizar novamente em 1s
          return;
      }

      const formattedTime = formatTime(diffInSeconds);

      if (cycleInfoElement) {
          cycleInfoElement.innerHTML = `Próxima sessão em: <strong>${formattedTime}</strong>`;
      }
  }

  // Inicia o cronômetro e o atualiza a cada segundo
  updateCountdown();
  setInterval(updateCountdown, 1000);

});