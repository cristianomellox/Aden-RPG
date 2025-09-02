document.addEventListener("DOMContentLoaded", async () => {
  console.log("[mines] DOM ready");
  
  // --- Lógica para o botão de voltar do navegador ---
  history.pushState(null, null, location.href);
  window.addEventListener('popstate', function(event) {
    history.pushState(null, null, location.href);
  });
  
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
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
    }
  });

  let userId = null;
  let userName = null;
  let playerStats = {};
  let currentMineId = null;
  let combatTimerInterval = null;
  let minesRefreshInterval = null;
  let monsterHpRefreshInterval = null;
  let combatSessionEnded = false;
  let isCombatInProgress = false;

  const playerStatusElement = document.getElementById("playerStatus");
  const modalAttackBtn = document.getElementById("modalAttackBtn");
  const backBtn = document.getElementById("backBtn");
  const combatLogElement = document.getElementById("combatLog");
  const attackQtySpan = document.getElementById("attackQty");
  const decreaseQtyBtn = document.getElementById("decreaseQtyBtn");
  const increaseQtyBtn = document.getElementById("increaseQtyBtn");
  const confirmAttackBtn = document.getElementById("confirmAttackBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const mineContainer = document.getElementById("mineContainer");
  const combatLogModal = document.getElementById("combatLogModal");
  const closeCombatLogModalBtn = document.getElementById("closeCombatLogModalBtn");
  const openCombatLogBtn = document.getElementById("openCombatLogBtn");
  const mineDetailsModal = document.getElementById("mineDetailsModal");
  const buyAttacksModal = document.getElementById("buyAttacksModal");
  const buyIncreaseQtyBtn = document.getElementById("buyIncreaseQtyBtn");
  const buyDecreaseQtyBtn = document.getElementById("buyDecreaseQtyBtn");
  const buyAttackQty = document.getElementById("buyAttackQty");
  const buyConfirmBtn = document.getElementById("buyConfirmBtn");
  const buyCancelBtn = document.getElementById("buyCancelBtn");
  const buyAttackCostInfo = document.getElementById("buyAttackCostInfo");
  const confirmModal = document.getElementById("confirmModal");
  const confirmMessage = document.getElementById("confirmMessage");
  const confirmActionBtn = document.getElementById("confirmActionBtn");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");
  const cycleInfoElement = document.getElementById("cycleInfo");

  // --- Funções de Ajuda ---
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(v => v < 10 ? "0" + v : v).join(":");
  }

  function formatTimeShort(seconds) {
    if (seconds >= 3600) {
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    } else if (seconds >= 60) {
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
  }

  function showModal(modalId) {
    document.getElementById(modalId).style.display = "flex";
  }

  function hideModal(modalId) {
    document.getElementById(modalId).style.display = "none";
  }

  // --- Lógica do Jogo ---
  async function loadPlayerAndMines() {
    try {
      const {
        data: {
          user
        }
      } = await supabase.auth.getUser();
      if (!user) {
        redirectToLogin();
        return;
      }
      userId = user.id;

      const {
        data: playerData,
        error: playerError
      } = await supabase
        .from("players")
        .select("id, name, level, gold, guild_name, inventory, current_monster_health, remaining_attacks_in_combat, mine_pvp_attempts_left, last_mine_pvp_reset, crystals, is_silenced_until, is_banned, total_damage_dealt")
        .eq("id", userId)
        .single();
      if (playerError) throw playerError;
      playerStats = playerData;
      userName = playerStats.name;

      if (playerStats.is_banned) {
        alert("Você está banido e não pode acessar o jogo.");
        return;
      }

      await loadMines();
      minesRefreshInterval = setInterval(loadMines, 10000); // Atualiza a cada 10s
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
      redirectToLogin();
    }
  }

  async function loadMines() {
    try {
      // Fetch the current user's combat state first
      const {
        data: {
          user
        }
      } = await supabase.auth.getUser();
      if (!user) {
        redirectToLogin();
        return;
      }
      const userId = user.id;

      const {
        data: mineData,
        error: mineError
      } = await supabase
        .from("mining_caverns")
        .select("id, name, monster_health, initial_monster_health, owner_player_id, last_attack_time, competition_end_time, status, type, open_time");

      if (mineError) throw mineError;
      
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
          redirectToLogin();
          return;
      }
      const currentUserId = currentUser.id;

      // --- ALTERAÇÃO AQUI: Buscar nomes dos donos ANTES de renderizar ---
      const ownerIds = Array.from(new Set((mineData || []).map(m => m.owner_player_id).filter(Boolean)));
      const ownersMap = {};
      if (ownerIds.length) {
        const { data: ownersData } = await supabase.from("players").select("id, name").in("id", ownerIds);
        (ownersData || []).forEach(p => ownersMap[p.id] = p.name);
      }
      
      renderMines(mineData || [], ownersMap);
      updatePlayerInfo();

    } catch (error) {
      console.error("Erro ao carregar minas:", error);
    }
  }

  function renderMines(mines, ownersMap) {
    const grid = document.getElementById("minesGrid");
    grid.innerHTML = "";
    mines.forEach(mine => {
      const mineCard = document.createElement("div");
      mineCard.className = "mine-card";
      mineCard.dataset.id = mine.id;
      mineCard.dataset.status = mine.status;

      const monsterHP = Math.max(0, mine.monster_health);
      const initialHP = mine.initial_monster_health;
      const progress = (monsterHP / initialHP) * 100;
      
      const ownerName = mine.owner_player_id ? (ownersMap[mine.owner_player_id] || "Desconhecido") : null;
      const isMineOwner = mine.owner_player_id === userId;

      let ownerText = "";
      if (isMineOwner) {
        ownerText = `<span class="mine-owner-status">Você é o Dono</span>`;
      } else if (ownerName) {
        ownerText = `Dono: <span class="mine-owner-name">${ownerName}</span>`;
      } else {
        ownerText = `Sem Dono`;
      }

      const statusText = isCombatInProgress && currentMineId === mine.id ? "Em Combate" : (mine.status === "aberta" ? "Aberta" : (mine.status === "disputando" ? "Em Disputa" : "Ocupada"));

      mineCard.innerHTML = `
        <h3>${mine.name}</h3>
        <p>Status: <span class="mine-status">${statusText}</span></p>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${progress}%; background-color: ${getColorByStatus(mine.status)};"></div>
        </div>
        <p class="hp-text">${monsterHP} / ${initialHP} HP</p>
        <p>${ownerText}</p>
        <button class="mine-action-btn" data-mine-id="${mine.id}">
            ${getActionText(mine)}
        </button>
      `;
      grid.appendChild(mineCard);
    });
  }

  function getColorByStatus(status) {
    switch (status) {
      case 'ocupada':
        return '#007BFF'; // Azul
      case 'disputando':
        return '#dc3545'; // Vermelho
      case 'aberta':
        return '#28a745'; // Verde
      default:
        return '#6c757d'; // Cinza
    }
  }
  
  function getActionText(mine) {
    if (mine.owner_player_id === userId) {
      return "Abandonar";
    } else if (mine.status === "ocupada" && mine.owner_player_id) {
        return "Atacar";
    } else if (mine.status === "disputando" && mine.owner_player_id) {
        return "Participar";
    } else if (mine.status === "aberta" && !mine.owner_player_id) {
        return "Capturar";
    } else {
        return "Atacar";
    }
  }

  async function handleMineAction(mineId, actionType) {
    try {
      let rpcName;
      let params = {
        _player_id: userId
      };

      switch (actionType) {
        case "Capturar":
        case "Participar":
          rpcName = "start_mine_combat";
          params._mine_id = mineId;
          break;
        case "Atacar":
          rpcName = "capture_mine";
          params.p_challenger_id = userId;
          params.p_mine_id = mineId;
          break;
        case "Abandonar":
          rpcName = "abandon_mine";
          params._player_id = userId;
          params._mine_id = mineId;
          break;
        default:
          alert("Ação inválida.");
          return;
      }

      const {
        data: result,
        error
      } = await supabase.rpc(rpcName, params);

      if (error) throw error;

      if (result.success) {
        if (actionType === "Atacar" && result.winner_id) {
          alert(result.message);
          isCombatInProgress = false; // Resetar para que o modal de combate seja fechado
          await loadPlayerAndMines();
        } else if (actionType === "Abandonar") {
          alert("Mina abandonada com sucesso!");
          await loadPlayerAndMines();
        } else {
          showModal("combatModal");
          currentMineId = mineId;
          isCombatInProgress = true;
          // Iniciar a sessão de combate local
          const combatLogTitle = document.getElementById("combatLogTitle");
          combatLogTitle.textContent = `Combate em andamento!`;
          loadCombatInfo(mineId);
          combatTimerInterval = setInterval(() => loadCombatInfo(mineId), 1000);
          monsterHpRefreshInterval = setInterval(() => loadMines(), 1000);
        }
      } else {
        alert(result.message);
      }
    } catch (error) {
      console.error("Erro na ação da mina:", error);
      alert("Erro ao executar a ação.");
    }
  }

  async function loadCombatInfo(mineId) {
    if (!isCombatInProgress) {
      clearInterval(combatTimerInterval);
      clearInterval(monsterHpRefreshInterval);
      return;
    }

    // Pega informações da mina
    const {
      data: mine,
      error: mineError
    } = await supabase
      .from("mining_caverns")
      .select("id, name, monster_health, initial_monster_health, status, competition_end_time, owner_player_id")
      .eq("id", mineId)
      .single();

    if (mineError) {
      console.error("Erro ao carregar info da mina:", mineError);
      return;
    }

    if (mine.status !== 'disputando' && mine.status !== 'ocupada' && !combatSessionEnded) {
      endCombatSession("A sessão de combate terminou.");
      return;
    }

    const modalMineName = document.getElementById("modalMineName");
    const modalMonsterHp = document.getElementById("modalMonsterHp");
    const modalCombatTimer = document.getElementById("modalCombatTimer");
    const modalProgressBar = document.getElementById("modalProgressBar");

    modalMineName.textContent = mine.name;
    modalMonsterHp.textContent = `${mine.monster_health}/${mine.initial_monster_health} HP`;
    const progress = (mine.monster_health / mine.initial_monster_health) * 100;
    modalProgressBar.style.width = `${progress}%`;
    modalProgressBar.style.backgroundColor = getColorByStatus(mine.status);

    const now = new Date();
    const competitionEndTime = new Date(mine.competition_end_time);

    if (mine.competition_end_time) {
      const diffInSeconds = Math.max(0, Math.floor((competitionEndTime.getTime() - now.getTime()) / 1000));
      modalCombatTimer.textContent = `Tempo restante: ${formatTime(diffInSeconds)}`;
    } else {
      modalCombatTimer.textContent = `Tempo restante: 00:00:00`;
    }

    // Pega ataques do jogador e ranking
    const {
      data: attacksState,
      error: attacksError
    } = await supabase.rpc('get_player_attacks_state', {
      _player_id: userId
    });

    if (attacksError) {
      console.error("Erro ao pegar ataques:", attacksError);
      return;
    }

    if (attacksState && attacksState.attacks_left !== undefined) {
      playerStats.remaining_attacks_in_combat = attacksState.attacks_left;
      updatePlayerInfo();
      // Desabilita o botão se não houver ataques
      modalAttackBtn.disabled = attacksState.attacks_left <= 0;
    }

    const {
      data: rankingData,
      error: rankingError
    } = await supabase.from('mining_session_damage')
      .select('player_id, total_damage_dealt')
      .eq('cavern_id', mineId)
      .order('total_damage_dealt', {
        ascending: false
      });

    if (rankingError) {
      console.error("Erro ao carregar ranking:", rankingError);
      return;
    }
    
    // Obter nomes dos jogadores do ranking
    const playerIdsInRanking = rankingData.map(d => d.player_id);
    const { data: playersInRanking, error: playersError } = await supabase.from('players').select('id, name').in('id', playerIdsInRanking);
    if (playersError) {
        console.error("Erro ao carregar nomes do ranking:", playersError);
        return;
    }
    const playerNamesMap = playersInRanking.reduce((acc, p) => {
        acc[p.id] = p.name;
        return acc;
    }, {});
    
    renderRanking(rankingData, playerNamesMap);
  }

  function renderRanking(ranking, playerNamesMap) {
    const rankingTableBody = document.querySelector("#rankingTable tbody");
    rankingTableBody.innerHTML = "";
    ranking.forEach(entry => {
      const row = rankingTableBody.insertRow();
      row.innerHTML = `
        <td>${playerNamesMap[entry.player_id] || 'Desconhecido'}</td>
        <td>${entry.total_damage_dealt}</td>
      `;
    });
  }

  async function attackMonster() {
    if (!currentMineId || !isCombatInProgress) return;
    try {
      const {
        data: result,
        error
      } = await supabase.rpc('attack_mine_monster', {
        _player_id: userId,
        _mine_id: currentMineId,
      });

      if (error) throw error;

      if (result.success) {
        const damageDealt = result.damage_dealt;
        const isCrit = result.is_crit;
        const logEntry = isCrit ?
          `<span class="critical">Você causou ${damageDealt} de dano! (CRÍTICO)</span>` :
          `<span class="normal">Você causou ${damageDealt} de dano.</span>`;
        addCombatLog(logEntry);

        if (isCrit) {
          criticalHitSound.play();
        } else {
          normalHitSound.play();
        }

        // Atualizar o HP do monstro no modal
        const modalMonsterHp = document.getElementById("modalMonsterHp");
        const currentHp = parseInt(modalMonsterHp.textContent.split('/')[0]);
        modalMonsterHp.textContent = `${Math.max(0, currentHp - damageDealt)} / ${result.monster_initial_health} HP`;
        
        // Atualiza a barra de progresso do modal
        const modalProgressBar = document.getElementById("modalProgressBar");
        const newProgress = (Math.max(0, currentHp - damageDealt) / result.monster_initial_health) * 100;
        modalProgressBar.style.width = `${newProgress}%`;

        // Se o monstro morrer, a RPC já vai finalizar a sessão.
        // O `loadCombatInfo` vai detectar a mudança de status e fechar o modal.
      } else {
        alert(result.message);
      }
    } catch (error) {
      console.error("Erro ao atacar monstro:", error);
      alert("Erro ao atacar. Verifique sua conexão.");
    }
  }

  function addCombatLog(log) {
    const logItem = document.createElement("p");
    logItem.innerHTML = log;
    combatLogElement.prepend(logItem);
    // Limita o log a 50 entradas
    if (combatLogElement.children.length > 50) {
      combatLogElement.removeChild(combatLogElement.lastChild);
    }
  }

  function endCombatSession(message) {
    combatSessionEnded = true;
    isCombatInProgress = false;
    clearInterval(combatTimerInterval);
    clearInterval(monsterHpRefreshInterval);
    alert(message);
    hideModal("combatModal");
    loadPlayerAndMines();
  }
  
  // --- Modais e Interações ---
  mineContainer.addEventListener("click", (e) => {
    const btn = e.target.closest(".mine-action-btn");
    if (btn) {
      const mineId = btn.dataset.mineId;
      const actionType = btn.textContent.trim();
      handleMineAction(mineId, actionType);
    }
  });

  if (modalAttackBtn) {
    modalAttackBtn.addEventListener("click", attackMonster);
  }

  if (backBtn) {
    backBtn.addEventListener("click", endCombatSession);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", endCombatSession);
  }

  if (closeCombatLogModalBtn) {
    closeCombatLogModalBtn.addEventListener("click", () => {
      hideModal("combatLogModal");
    });
  }

  if (openCombatLogBtn) {
    openCombatLogBtn.addEventListener("click", () => {
      showModal("combatLogModal");
    });
  }

  if (buyIncreaseQtyBtn) {
    buyIncreaseQtyBtn.addEventListener("click", () => {
        let currentQty = parseInt(buyAttackQty.textContent);
        if (currentQty < 100) {
            currentQty++;
            buyAttackQty.textContent = currentQty;
            updateBuyCost();
        }
    });
  }
  
  if (buyDecreaseQtyBtn) {
    buyDecreaseQtyBtn.addEventListener("click", () => {
        let currentQty = parseInt(buyAttackQty.textContent);
        if (currentQty > 1) {
            currentQty--;
            buyAttackQty.textContent = currentQty;
            updateBuyCost();
        }
    });
  }

  if (buyConfirmBtn) {
    buyConfirmBtn.addEventListener("click", async () => {
        const qty = parseInt(buyAttackQty.textContent);
        try {
            const { data, error } = await supabase.rpc('buy_mine_attacks', { 
                _player_id: userId,
                _attacks_to_buy: qty
            });
            if (error) throw error;
            if (data.success) {
                alert(`Você comprou ${qty} ataques com sucesso!`);
                playerStats.gold = data.new_gold;
                playerStats.attacks_bought_count = data.new_attacks_bought_count;
                playerStats.remaining_attacks_in_combat = data.new_remaining_attacks;
                updatePlayerInfo();
                hideModal("buyAttacksModal");
            } else {
                alert(data.message);
            }
        } catch (err) {
            console.error('Erro ao comprar ataques:', err);
            alert('Erro ao comprar ataques.');
        }
    });
  }

  if (buyCancelBtn) {
    buyCancelBtn.addEventListener("click", () => {
        hideModal("buyAttacksModal");
    });
  }

  function updateBuyCost() {
      const qty = parseInt(buyAttackQty.textContent);
      const cost = qty * 50; // Cada ataque custa 50 de ouro
      buyAttackCostInfo.textContent = `Custo total: ${cost} Ouro`;
  }
  
  document.getElementById("buyAttacksBtn").addEventListener("click", () => {
      buyAttackQty.textContent = "1";
      updateBuyCost();
      showModal("buyAttacksModal");
  });
  
  if (confirmActionBtn) {
    confirmActionBtn.addEventListener("click", () => {
        // Ação já definida no momento que o modal é exibido
        hideModal("confirmModal");
    });
  }

  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener("click", () => {
        hideModal("confirmModal");
        if (typeof confirmActionBtn.action === 'function') {
            confirmActionBtn.action = null; // Limpa a ação para evitar execuções indesejadas
        }
    });
  }

  function showConfirmModal(message, action) {
    confirmMessage.textContent = message;
    confirmActionBtn.action = action;
    confirmActionBtn.addEventListener("click", action); // Adiciona o listener para a ação
    showModal("confirmModal");
  }

  // --- Lógica do cronômetro da próxima sessão ---
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
          if (cycleInfoElement) {
              cycleInfoElement.innerHTML = `Sessão em andamento!`;
          }
          setTimeout(updateCountdown, 1000);
          return;
      }

      const formattedTime = formatTime(diffInSeconds);

      if (cycleInfoElement) {
          cycleInfoElement.innerHTML = `Próxima sessão em: <strong>${formattedTime}</strong>`;
      }
      setTimeout(updateCountdown, 1000);
  }

  // --- Funções de interface ---
  function updatePlayerInfo() {
    if (!playerStatusElement) return;
    playerStatusElement.innerHTML = `
      <p>Ouro: ${playerStats.gold}</p>
      <p>Cristais: ${playerStats.crystals}</p>
      <p>Ataques: ${playerStats.remaining_attacks_in_combat}/5</p>
      <p>Tentativas PvP: ${playerStats.mine_pvp_attempts_left}/5</p>
    `;
  }

  function redirectToLogin() {
    window.location.href = "login.html";
  }

  // cleanup
  window.addEventListener("beforeunload", () => {
    if (minesRefreshInterval) clearInterval(minesRefreshInterval);
    if (combatTimerInterval) clearInterval(combatTimerInterval);
    if (monsterHpRefreshInterval) clearInterval(monsterHpRefreshInterval);
  });

  // Start
  loadPlayerAndMines();
  preloadSounds();
  ambientMusic.play();
  updateCountdown();
});