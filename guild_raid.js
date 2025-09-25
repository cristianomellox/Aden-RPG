
console.log("guild_raid.js atualizado (andar canto sup. esq + timer central + cristais proporcionais) ✅");

const SUPABASE_URL = "https://lqzlblvmkuwedcofmgfb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAX_ATTACKS = 3;
const ATTACK_COOLDOWN_SECONDS = 12;
const RAID_POLL_MS = 2000;
const BOSS_CHECK_MS = 20000;
const REVIVE_CHECK_MS = 1000;

let userId = null;
let userGuildId = null;
let userRank = "member";
let currentRaidId = null;
let currentFloor = 1;
let maxMonsterHealth = 1;
let attacksLeft = 0;
let lastAttackAt = null;
let raidEndsAt = null;

let pollInterval = null;
let uiSecondInterval = null;
let raidTimerInterval = null;
let bossCheckInterval = null;
let reviveTickerInterval = null;
let refreshAttemptsPending = false;


let shownRewardIds = new Set(); // controla rewards já mostradas nesta sessão

// audio
const audioNormal = new Audio("https://aden-rpg.pages.dev/assets/normal_hit.mp3");
const audioCrit = new Audio("https://aden-rpg.pages.dev/assets/critical_hit.mp3");
audioNormal.volume = 0.06;
audioCrit.volume = 0.1;

function playHitSound(isCrit) {
  try {
    if (isCrit) {
      audioCrit.currentTime = 0;
      audioCrit.play().catch(()=>{});
    } else {
      audioNormal.currentTime = 0;
      audioNormal.play().catch(()=>{});
    }
  } catch(e){ console.warn("playHitSound", e); }
}

const $id = id => document.getElementById(id);

function displayFloatingDamageOver(targetEl, val, isCrit) {
  if (!targetEl) return;
  const el = document.createElement("div");
  el.textContent = isCrit ? `${Number(val).toLocaleString()}` : String(val);
  el.className = isCrit ? "crit-damage-number" : "damage-number";
  el.style.position = "absolute";
  el.style.left = "50%";
  el.style.top = "30%";
  el.style.transform = "translate(-50%,-50%)";
  el.style.zIndex = "999";
  targetEl.style.position = targetEl.style.position || "relative";
  targetEl.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// --- HP bars helpers (monster + player) ---
function ensurePlayerHpUi() {
  const container = $id("raidMonsterArea");
  if (!container) return;
  if ($id("raidPlayerArea")) return;

  const hr = document.createElement("hr");
  hr.style.width = "90%";
  hr.style.margin = "12px auto";
  container.appendChild(hr);

  const pArea = document.createElement("div");
  pArea.id = "raidPlayerArea";
  pArea.style.display = "flex";
  pArea.style.flexDirection = "column";
  pArea.style.alignItems = "center";
  pArea.style.gap = "8px";
  pArea.style.position = "relative";

  const reviveText = document.createElement("div");
  reviveText.id = "raidPlayerReviveText";
  reviveText.style.position = "absolute";
  reviveText.style.top = "-20px";
  reviveText.style.left = "50%";
  reviveText.style.transform = "translateX(-50%)";
  reviveText.style.color = "#ffdddd";
  reviveText.style.fontWeight = "bold";
  reviveText.style.fontSize = "0.9em";
  reviveText.style.textShadow = "1px 1px 2px #000";
  reviveText.style.zIndex = "1000";
  pArea.appendChild(reviveText);

  const avatarWrap = document.createElement("div");
  avatarWrap.style.position = "relative";
  avatarWrap.style.width = "80px";
  avatarWrap.style.height = "80px";
  avatarWrap.style.borderRadius = "50%";
  avatarWrap.style.overflow = "hidden";
  avatarWrap.style.display = "flex";
  avatarWrap.style.alignItems = "center";
  avatarWrap.style.justifyContent = "center";
  avatarWrap.style.background = "#222";
  avatarWrap.id = "raidPlayerAvatarWrap";

  const avatar = document.createElement("img");
  avatar.id = "raidPlayerAvatar";
  avatar.src = "https://via.placeholder.com/80";
  avatar.style.width = "80px";
  avatar.style.height = "80px";
  avatar.style.borderRadius = "50%";
  avatar.style.objectFit = "cover";
  avatarWrap.appendChild(avatar);

  const reviveOverlay = document.createElement("div");
  reviveOverlay.id = "raidPlayerReviveOverlay";
  reviveOverlay.style.position = "absolute";
  reviveOverlay.style.left = "0";
  reviveOverlay.style.top = "0";
  reviveOverlay.style.width = "100%";
  reviveOverlay.style.height = "100%";
  reviveOverlay.style.display = "none";
  reviveOverlay.style.background = "rgba(0,0,0,0.6)";
  avatarWrap.appendChild(reviveOverlay);

  const pHpContainer = document.createElement("div");
  pHpContainer.id = "raidPlayerHpBar";
  pHpContainer.style.width = "86%";
  pHpContainer.style.maxWidth = "360px";
  pHpContainer.style.background = "#333";
  pHpContainer.style.borderRadius = "12px";
  pHpContainer.style.overflow = "hidden";
  pHpContainer.style.position = "relative";
  pHpContainer.style.height = "22px";

  const pFill = document.createElement("div");
  pFill.id = "raidPlayerHpFill";
  pFill.style.height = "100%";
  pFill.style.width = "100%";
  pFill.style.transition = "width 300ms ease";
  pFill.style.display = "flex";
  pFill.style.alignItems = "center";
  pFill.style.justifyContent = "center";
  pFill.style.fontWeight = "bold";
  pFill.style.color = "#000";
  pFill.style.background = "linear-gradient(90deg,#ff6b6b,#ffb86b)";

  const pText = document.createElement("span");
  pText.id = "raidPlayerHpText";
  pText.style.fontSize = "0.9em";
  pText.style.color = "#000";
  pFill.appendChild(pText);

  pHpContainer.appendChild(pFill);
  pArea.appendChild(avatarWrap);
  pArea.appendChild(pHpContainer);
  container.appendChild(pArea);
}

function updatePlayerHpUi(cur, max) {
  ensurePlayerHpUi();
  const fill = $id("raidPlayerHpFill");
  const text = $id("raidPlayerHpText");
  const avatar = $id("raidPlayerAvatar");
  const overlay = $id("raidPlayerReviveOverlay");
  const c = Math.max(0, Number(cur || 0));
  const m = Math.max(1, Number(max || 1));
  const pct = Math.max(0, Math.min(100, (c / m) * 100));
  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = `${c.toLocaleString()} / ${m.toLocaleString()}`;
  if (c <= 0) {
    if (avatar) avatar.style.filter = "grayscale(80%)";
    if (overlay) overlay.style.display = "flex";
  } else {
    if (avatar) avatar.style.filter = "";
    if (overlay) { overlay.style.display = "none"; }
  }
}

function setPlayerReviveOverlayText(remainingSeconds) {
  const overlay = $id("raidPlayerReviveOverlay");
  const reviveText = $id("raidPlayerReviveText");
  if (!overlay || !reviveText) return;

  if (remainingSeconds <= 0) {
    overlay.style.display = "none";
    reviveText.innerHTML = "";
    return;
  }
  overlay.style.display = "flex";
  reviveText.innerHTML = `Revivendo em: <strong>${remainingSeconds}s</strong>`;
}

function updateHpBar(cur, max) {
  const fill = $id("raidMonsterHpFill");
  const text = $id("raidMonsterHpText");
  const c = Math.max(0, Number(cur || 0));
  const m = Math.max(1, Number(max || 1));
  const pct = Math.max(0, Math.min(100, (c / m) * 100));
  if (fill) fill.style.width = `${pct}%`;
  if (text) {
    text.textContent = `${c.toLocaleString()} / ${m.toLocaleString()}`;
    text.style.position = "absolute";
    text.style.left = "50%";
    text.style.top = "50%";
    text.style.transform = "translate(-50%,-50%)";
    text.style.fontWeight = "bold";
    text.style.color = "#fff";
    text.style.textShadow = "0 1px 2px rgba(0,0,0,0.7)";
  }
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  let result = "";
  if (h > 0) result += `${h}h `;
  if (m > 0) result += `${m}m `;
  result += `${ss}s`;
  return result.trim();
}

// -------- ALTERADO: floor canto esquerdo + timer central ----------
function setRaidTitleFloorAndTimer(floor, endsAt) {
  currentFloor = floor || 1;

  // procura elementos; se não existirem, tenta criar um header dentro do modal
  let floorBox = $id("raidFloorInfo");
  let timerBox = $id("raidTimerInfo");

  if (!floorBox || !timerBox) {
    const combatModal = $id("raidCombatModal");
    if (combatModal) {
      let header = $id("raidHeader");
      if (!header) {
        header = document.createElement("div");
        header.id = "raidHeader";
        header.style.position = "relative";
        header.style.display = "flex";
        header.style.justifyContent = "center";
        header.style.alignItems = "center";
        header.style.padding = "8px 0";
        // insere no topo do modal
        combatModal.insertBefore(header, combatModal.firstChild);
      }

      if (!floorBox) {
        floorBox = document.createElement("div");
        floorBox.id = "raidFloorInfo";
        floorBox.style.position = "absolute";
        floorBox.style.left = "3px";
        floorBox.style.top = "2px";
        floorBox.style.textAlign = "center";
        header.appendChild(floorBox);
      }

      if (!timerBox) {
        timerBox = document.createElement("div");
        timerBox.id = "raidTimerInfo";
        timerBox.style.fontWeight = "bold";
        timerBox.style.fontSize = "1.1em";
        header.appendChild(timerBox);
      }
    }
  }

  if (floorBox) {
    floorBox.innerHTML = `<div style="text-align:center; line-height:1.1;">
      <div style="font-weight:bold; font-size:0.9em;">${floor}°</div>
      <div style="font-size:0.6em;">Andar</div>
    </div>`;
  }

  if (timerBox) {
    if (endsAt) {
      const diff = Math.max(0, Math.floor((new Date(endsAt) - new Date()) / 1000));
      timerBox.textContent = formatTime(diff);
    } else {
      timerBox.textContent = "";
    }
  }
}
// -----------------------------------------------------------------

async function initSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return;
    userId = data.session.user.id;
    const { data: player, error } = await supabase.from("players").select("guild_id, rank, avatar_url").eq("id", userId).single();
    if (!error && player) {
      userGuildId = player.guild_id;
      userRank = player.rank || "member";
      if (player.avatar_url) {
        const av = $id("raidPlayerAvatar");
        if (av) av.src = player.avatar_url;
      }
    }
  } catch (e) { console.error("initSession", e); }
}

async function loadRaid() {
  if (!userGuildId) return;
  try {
    const { data, error } = await supabase
      .from("guild_raids")
      .select("*")
      .eq("guild_id", userGuildId)
      .eq("active", true)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      currentRaidId = null;
      closeCombatModal();
      return;
    }

    currentRaidId = data.id;
    maxMonsterHealth = Number(data.initial_monster_health) || 1;
    raidEndsAt = data.ends_at;

    setRaidTitleFloorAndTimer(data.current_floor || 1, raidEndsAt);
    updateHpBar(data.monster_health, maxMonsterHealth);
    await loadMonsterForFloor(data.current_floor);
    await refreshRanking();
    await loadAttempts();
    await loadPlayerCombatState();
    startPolling();
    startUISecondTicker();
    startRaidTimer();
    startBossChecker();
    startReviveTicker();
    openCombatModal();
  } catch (e) {
    console.error("loadRaid erro:", e);
  }
}

async function loadMonsterForFloor(floor) {
  if (!floor) return;
  try {
    const { data, error } = await supabase.from("guild_raid_monsters").select("image_url, base_health, name").eq("floor", floor).single();
    if (!error && data) {
      const img = $id("raidMonsterImage");
      if (img) img.src = data.image_url;
      if (data.base_health) maxMonsterHealth = Number(data.base_health);
    }
  } catch (e) {
    console.error("loadMonsterForFloor", e);
  }
}

async function refreshRanking() {
  if (!currentRaidId) return;
  try {
    const { data } = await supabase
      .from("guild_raid_damage")
      .select("player_id, damage, players(name)")
      .eq("raid_id", currentRaidId)
      .order("damage", { ascending: false });
    const ul = $id("raidDamageRankingList");
    if (!ul) return;
    ul.innerHTML = "";
    (data || []).forEach(r => {
      const li = document.createElement("li");
      li.textContent = `${r.players?.name || "??"} — ${Number(r.damage || 0).toLocaleString()}`;
      ul.appendChild(li);
    });
  } catch (e) { console.error("refreshRanking", e); }
}

async function loadAttempts() {
  if (!currentRaidId || !userId) return;
  try {
    const { data, error } = await supabase
      .from("guild_raid_attempts")
      .select("attempts_left, last_attack_at")
      .eq("raid_id", currentRaidId)
      .eq("player_id", userId)
      .single();

    if (error || !data) {
      attacksLeft = MAX_ATTACKS;
      lastAttackAt = null;
    } else {
      attacksLeft = Number(data.attempts_left || 0);
      lastAttackAt = data.last_attack_at ? new Date(data.last_attack_at) : null;
    }
    updateAttackUI();
  } catch (e) {
    console.error("loadAttempts", e);
  }
}

function computeShownAttacksAndRemaining() {
  const now = new Date();
  if (!lastAttackAt) {
    return { shownAttacks: attacksLeft, secondsToNext: 0 };
  }
  const elapsed = Math.floor((now - new Date(lastAttackAt)) / 1000);
  const recovered = Math.floor(elapsed / ATTACK_COOLDOWN_SECONDS);
  let shown = Math.min(MAX_ATTACKS, attacksLeft + recovered);
  let secondsToNext = 0;
  if (shown < MAX_ATTACKS) {
    const sinceLast = elapsed % ATTACK_COOLDOWN_SECONDS;
    secondsToNext = ATTACK_COOLDOWN_SECONDS - sinceLast;
  }
  return { shownAttacks: shown, secondsToNext };
}

function updateAttackUI() {
  const attacksEl = $id("raidPlayerAttacks");
  const cooldownEl = $id("raidAttackCooldown");
  const attackBtn = $id("raidAttackBtn");
  if (!attacksEl || !cooldownEl || !attackBtn) return;

  const { shownAttacks, secondsToNext } = computeShownAttacksAndRemaining();
  attacksEl.textContent = `${shownAttacks} / ${MAX_ATTACKS}`;
  cooldownEl.textContent = secondsToNext > 0 ? `Próx recarga em ${formatTime(secondsToNext)}` : "";

  const playerDead = isPlayerDeadLocal();
  if (playerDead) {
    attackBtn.style.pointerEvents = "none";
    attackBtn.style.filter = "grayscale(80%)";
  } else {
    attackBtn.style.pointerEvents = shownAttacks > 0 ? "" : "none";
    attackBtn.style.filter = shownAttacks > 0 ? "" : "grayscale(60%)";
  }
}

let _playerReviveUntil = null;
function isPlayerDeadLocal() {
  if (!_playerReviveUntil) return false;
  return new Date(_playerReviveUntil) > new Date();
}

async function loadPlayerCombatState() {
  if (!userId) return;
  try {
    const { data: playerDetails, error: detailsError } = await supabase.rpc("get_player_details_for_raid", { p_player_id: userId });
    const { data: playerState, error: stateError } = await supabase.from("players").select("raid_player_health, avatar_url, revive_until").eq("id", userId).single();

    if (detailsError || stateError || !playerDetails || !playerState) {
        console.error("Erro ao carregar estado do jogador:", detailsError || stateError);
        return;
    }

    const maxHp = playerDetails.health || 1;

// Se a vida de raid do jogador não estiver inicializada, força restauração no servidor
// Se a vida de raid do jogador não estiver inicializada ou estiver zerada, força restauração no servidor
if (playerState.raid_player_health === null || playerState.raid_player_health >= 0) {
  try {
    await supabase.rpc("restore_player_raid_health", { p_player_id: userId });
    // Recarrega estado após restaurar
    const { data: refreshedState } = await supabase
      .from("players")
      .select("raid_player_health")
      .eq("id", userId)
      .single();
    if (refreshedState && refreshedState.raid_player_health !== null) {
      playerState.raid_player_health = refreshedState.raid_player_health;
    }
  } catch (e) {
    console.error("Erro ao restaurar vida do jogador:", e);
  }
}


    const curHp = (playerState.raid_player_health !== null && playerState.raid_player_health !== undefined) ? playerState.raid_player_health : maxHp;
    _playerReviveUntil = playerState.revive_until;
    const av = $id("raidPlayerAvatar");
    if (av && playerState.avatar_url) av.src = playerState.avatar_url;
    updatePlayerHpUi(curHp, maxHp);
    if (_playerReviveUntil && new Date(_playerReviveUntil) > new Date()) {
      const secs = Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000);
      setPlayerReviveOverlayText(secs);
    }
  } catch (e) {
    console.error("loadPlayerCombatState", e);
  }
}

async function refreshAttemptsServerSideOnceIfNeeded() {
  if (!currentRaidId || !userId || refreshAttemptsPending) return;
  const { shownAttacks } = computeShownAttacksAndRemaining();
  const shouldRefresh = (shownAttacks > attacksLeft);
  if (!shouldRefresh) return;

  refreshAttemptsPending = true;
  try {
    const { data } = await supabase.rpc("refresh_guild_raid_attempts", {
      p_raid_id: currentRaidId,
      p_player_id: userId
    });
    const payload = Array.isArray(data) ? data[0] : data;
    if (payload) {
      attacksLeft = Number(payload.attempts_left || 0);
      lastAttackAt = payload.last_attack_at ? new Date(payload.last_attack_at) : null;
    }
    updateAttackUI();
  } catch (e) {
    console.error("refreshAttemptsServerSideOnceIfNeeded", e);
  } finally {
    refreshAttemptsPending = false;
  }
}

async function performAttack() {
  if (!currentRaidId || !userId) return;

  if (isPlayerDeadLocal()) {
    alert("Você está morto. Aguarde reviver.");
    return;
  }

  const { shownAttacks } = computeShownAttacksAndRemaining();
  if (shownAttacks <= 0) {
    await refreshAttemptsServerSideOnceIfNeeded();
    const recalc = computeShownAttacksAndRemaining();
    if (recalc.shownAttacks <= 0) {
      alert("Sem ataques. Aguarde regeneração.");
      return;
    }
  }

  const attackBtn = $id("raidAttackBtn");
  if (attackBtn) attackBtn.style.pointerEvents = "none";

  try {
    const { data, error } = await supabase.rpc("perform_raid_attack", { p_raid_id: currentRaidId, p_player_id: userId });
    if (error) {
      alert(error.message || "Erro ao atacar (server).");
      await loadAttempts();
      return;
    }

    const payload = Array.isArray(data) ? data[0] : data;
    if (!payload || payload.success === false) {
      alert(payload?.message || "Ataque não realizado");
      await loadAttempts();
      return;
    }

    if (payload.attacks_left !== null && payload.attacks_left !== undefined) {
      attacksLeft = Number(payload.attacks_left);
    }
    lastAttackAt = payload.last_attack_at ? new Date(payload.last_attack_at) : (attacksLeft < MAX_ATTACKS ? new Date() : null);
    updateAttackUI();

    const damage = payload.damage_dealt ?? 0;
    const isCrit = payload.is_crit === true;
    displayFloatingDamageOver($id("raidMonsterArea"), damage, isCrit);
    playHitSound(isCrit);

    await refreshRanking();

    if (payload.monster_health !== null) updateHpBar(payload.monster_health, payload.max_monster_health || maxMonsterHealth);

    if (payload.monster_health !== null && Number(payload.monster_health) <= 0) {
      // tenta usar valor vindo do servidor (mantemos undefined quando não vier)
      let xp = (typeof payload.xp_reward !== 'undefined') ? payload.xp_reward : (typeof payload.gained_xp !== 'undefined' ? payload.gained_xp : (typeof payload.gained_experience !== 'undefined' ? payload.gained_experience : undefined));
      let crystals = (typeof payload.crystals_reward !== 'undefined') ? payload.crystals_reward : (typeof payload.gained_crystals !== 'undefined' ? payload.gained_crystals : (typeof payload.gained_crystal !== 'undefined' ? payload.gained_crystal : undefined));

      // se algum dos campos não vier, busca o fallback apenas para o campo ausente
      if (typeof xp === 'undefined' || typeof crystals === 'undefined') {
        console.log("RPC não retornou xp/crystals completos — buscando recompensas do DB (fallback) para campos ausentes.");
        try {
          const { data: mrow } = await supabase.from('guild_raid_monsters').select('*').eq('floor', currentFloor).limit(1).single();
          if (typeof xp === 'undefined') {
            xp = mrow?.xp_reward ?? mrow?.gained_xp ?? mrow?.xp ?? mrow?.reward_xp ?? 0;
          }
          if (typeof crystals === 'undefined') {
            crystals = mrow?.crystals_reward ?? mrow?.gained_crystals ?? mrow?.crystals ?? mrow?.reward_crystals ?? 0;
          }
          console.log("fallback rewards from guild_raid_monsters:", xp, crystals);
        } catch (e) {
          console.warn("Erro ao buscar guild_raid_monsters para rewards:", e);
          if (typeof xp === 'undefined') xp = 0;
          if (typeof crystals === 'undefined') crystals = 0;
        }
      }

      showRewardModal(xp, crystals, () => {
        setTimeout(() => loadRaid().catch(()=>{}), 200);
      });
      return;
    }
  } catch (e) {
    console.error("performAttack erro:", e);
  } finally {
    if (attackBtn) attackBtn.style.pointerEvents = "";
  }
}

// --------- Recompensa modal helper (adicionado para restaurar UI de recompensas) ----------
function showRewardModal(xp, crystals, onOk, rewardId) {
  console.log("showRewardModal => XP:", xp, "Crystals:", crystals);
  const xpEl = $id("rewardXpText");
  const crEl = $id("rewardCrystalsText");
  const modal = $id("raidRewardModal");
  const okBtn = $id("rewardOkBtn");
  if (!modal) {
    console.warn("Modal de recompensa não encontrado.");
    if (onOk) onOk();
    return;
  }
  if (xpEl) xpEl.textContent = `${Number(xp || 0).toLocaleString()} XP`;
  if (crEl) crEl.textContent = `${Number(crystals || 0).toLocaleString()} Cristais`;
  modal.style.display = "flex";
  if (okBtn) {
    okBtn.onclick = async () => {
      modal.style.display = "none";
      // Marca imediatamente como claimed no clique para evitar reabertura por polling
      try {
        if (rewardId) {
          await supabase.from("guild_raid_rewards")
            .update({ claimed: true, claimed_at: new Date().toISOString() })
            .eq("id", rewardId);
        } else {
          if (currentRaidId && userId) {
            await supabase.from("guild_raid_rewards")
              .update({ claimed: true, claimed_at: new Date().toISOString() })
              .eq("raid_id", currentRaidId)
              .eq("player_id", userId)
              .eq("claimed", false);
          }
        }
      } catch (e) {
        console.error("Erro ao marcar reward como claimed no clique:", e);
      }
      if (onOk) onOk();
    };
  }
}

// -------------------------------------------------------------------------------
async function tryBossAttackForPlayer() {
  if (!currentRaidId || !userId) return;
  if ((currentFloor % 5) !== 0) return;

  try {
    // A chamada RPC volta a ser como na versão original, passando o ID do jogador
    const { data, error } = await supabase.rpc("guild_raid_boss_attack", { p_raid_id: currentRaidId, p_player_id: userId });

    if (error) {
      console.warn("boss attack rpc erro:", error);
      return;
    }
    const payload = Array.isArray(data) ? data[0] : data;
    if (!payload || !payload.success) return;

    // A lógica de UI é restaurada para dar feedback ao jogador
    if (payload.action === "attacked") {
      const dmg = payload.damage || 0;
      const newHp = payload.player_new_hp ?? 0;
      const maxHp = payload.player_max_health ?? 1;

      const playerArea = $id("raidPlayerArea");
      displayFloatingDamageOver(playerArea, dmg, false);

      _playerReviveUntil = payload.player_revive_until || null;
      updatePlayerHpUi(newHp, maxHp);
      if (_playerReviveUntil && new Date(_playerReviveUntil) > new Date()) {
        setPlayerReviveOverlayText(Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000));
      }
      updateAttackUI();
    } else if (payload.action === "evaded") {
      const playerArea = $id("raidPlayerArea");
      displayFloatingDamageOver(playerArea, "Esquivou!", false);
    }
  } catch (e) {
    console.error("tryBossAttackForPlayer", e);
  }
}
// =================================================================

function startBossChecker() {
  stopBossChecker();
  bossCheckInterval = setInterval(() => {
    tryBossAttackForPlayer().catch(()=>{});
  }, BOSS_CHECK_MS);
}
function stopBossChecker() {
  if (bossCheckInterval) clearInterval(bossCheckInterval);
  bossCheckInterval = null;
}

function startReviveTicker() {
  stopReviveTicker();
  reviveTickerInterval = setInterval(async () => {
    if (!_playerReviveUntil) {
      setPlayerReviveOverlayText(0);
      return;
    }
    const remaining = Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000);
    setPlayerReviveOverlayText(Math.max(0, remaining));

    if (remaining <= 0) {
      await supabase.rpc("player_revive_if_needed", { p_player_id: userId });
      await loadPlayerCombatState();
      updateAttackUI();
    }
  }, REVIVE_CHECK_MS);
}
function stopReviveTicker() {
  if (reviveTickerInterval) clearInterval(reviveTickerInterval);
  reviveTickerInterval = null;
}

// =================================================================
// FUNÇÃO DE ATUALIZAÇÃO DE ESTADO - ATUALIZADA
// =================================================================
async function refreshRaidState() {
  if (!currentRaidId) return;
  try {
    // Chama a nova função para verificar e finalizar a raid se o tempo acabou
    await supabase.rpc('end_expired_raid', { p_raid_id: currentRaidId });

    // Continua buscando os dados da raid
    const { data, error } = await supabase.from("guild_raids").select("*").eq("id", currentRaidId).single();

    if (error || !data || !data.active) {
      closeCombatModal();
      alert("A Raid terminou.");
      return;
    }

    if (data.current_floor !== currentFloor) {
      // Recarrega tudo se o andar mudou
      await loadRaid();
    } else {
      setRaidTitleFloorAndTimer(data.current_floor || 1, data.ends_at);
      updateHpBar(data.monster_health, data.initial_monster_health || maxMonsterHealth);
    }
  } catch (e) {
    console.error("refreshRaidState", e);
  }
}
// =================================================================

// --- polling / timers control ---
// --- Verifica recompensas pendentes (para que todos que participaram recebam o modal) ---
async function checkPendingRaidRewards() {
  if (!currentRaidId || !userId) return;
  try {
    const { data, error } = await supabase
      .from("guild_raid_rewards")
      .select("id, xp, crystals")
      .eq("raid_id", currentRaidId)
      .eq("player_id", userId)
      .eq("claimed", false)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) {
      console.warn("checkPendingRaidRewards error", error);
      return;
    }
    if (data && data.length > 0) {
      const reward = data[0];
      if (shownRewardIds.has(reward.id)) {
        return;
      }
      shownRewardIds.add(reward.id);
showRewardModal(reward.xp, reward.crystals, async () => {
        try {
          await supabase.from("guild_raid_rewards").update({ claimed: true }).eq("id", reward.id);
        } catch (e) {
          console.error("Erro ao marcar reward como claimed:", e);
        }
        await loadRaid().catch(()=>{});
      }, reward.id);
    }
  } catch (e) { console.error("checkPendingRaidRewards", e); }
}
// -----------------------------------------------------------------------------

function startPolling() {
  stopPolling();
  pollInterval = setInterval(() => {
    refreshRaidState().catch(()=>{});
    refreshRanking().catch(()=>{});
    loadPlayerCombatState().catch(()=>{});
    checkPendingRaidRewards().catch(()=>{});
  }, RAID_POLL_MS);
}
function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
}

function startUISecondTicker() {
  stopUISecondTicker();
  uiSecondInterval = setInterval(async () => {
    updateAttackUI();
    const { shownAttacks, secondsToNext } = computeShownAttacksAndRemaining();
    if (secondsToNext === 0 && shownAttacks > attacksLeft) {
      await refreshAttemptsServerSideOnceIfNeeded();
    }
  }, 1000);
}
function stopUISecondTicker() { if (uiSecondInterval) clearInterval(uiSecondInterval); uiSecondInterval = null; }

function startRaidTimer() {
  clearRaidTimer();
  if (!raidEndsAt) return;
  raidTimerInterval = setInterval(() => {
    const diff = Math.floor((new Date(raidEndsAt) - new Date()) / 1000);
    if (diff <= 0) {
      clearRaidTimer();
      refreshRaidState(); // Força uma última atualização
      return;
    }
    setRaidTitleFloorAndTimer(currentFloor, raidEndsAt);
  }, 1000);
}
function clearRaidTimer() { if (raidTimerInterval) clearInterval(raidTimerInterval); raidTimerInterval = null; }

function closeCombatModal(){ 
  const m = $id("raidCombatModal"); 
  if (m) m.style.display = "none"; 
  stopPolling(); 
  stopUISecondTicker(); 
  clearRaidTimer(); 
  stopBossChecker(); 
  stopReviveTicker();
}

// --- Modals open/close helpers (unchanged)
function openRaidModal() { const m = $id("raidModal"); if (m) m.style.display = "flex"; }
function closeRaidModal(){ const m = $id("raidModal"); if (m) m.style.display = "none"; }
function openCombatModal(){ const m = $id("raidCombatModal"); if (m) m.style.display = "flex"; }

// bind events
function bindEvents() {
  const tdd = $id("tdd");
  if (tdd) {
    tdd.addEventListener("click", async () => {
      if (!userGuildId) return;

      const { data: activeRaid } = await supabase
        .from("guild_raids")
        .select("id")
        .eq("guild_id", userGuildId)
        .eq("active", true)
        .limit(1)
        .single();

      if (activeRaid) {
        await loadRaid();
      } else {
        const { data: lastRaid } = await supabase
          .from("guild_raids")
          .select("current_floor, active")
          .eq("guild_id", userGuildId)
          .order("ends_at", { ascending: false })
          .limit(1)
          .single();

        if (lastRaid && !lastRaid.active) {
          const modal = $id("lastRaidResultModal");
          if (modal) {
            $id("lastRaidFloorResult").textContent = `Andar ${lastRaid.current_floor || 0}`;
            modal.style.display = "flex";
          }
        } else {
          openRaidModal();
        }
      }
    });
  }


  $id("startNewRaidFromLastResultBtn")?.addEventListener("click", () => {
    openRaidModal();
    const m = $id("lastRaidResultModal"); if (m) m.style.display = "none";
  });
  $id("closeLastResultBtn")?.addEventListener("click", () => { const m=$id("lastRaidResultModal"); if(m) m.style.display="none"; });


  $id("startRaidBtn")?.addEventListener("click", async () => {

    if (userRank !== "leader" && userRank !== "co-leader") { alert("Apenas líder/co-líder"); return; }
    const startBtn = $id("startRaidBtn");
    startBtn.disabled = true;
    try {
      const { data, error } = await supabase.rpc("start_guild_raid", { p_guild_id: userGuildId, p_player_id: userId, p_name: "Torre da Desolação" });
      if (error) {
        alert(error.message || "Erro ao iniciar raid");
        return;
      }
      await loadRaid();
      closeRaidModal();
    } catch(e) {
      console.error("startRaid", e);
      alert("Erro ao iniciar raid");
    } finally {
      startBtn.disabled = false;
    }
  });

  $id("cancelRaidBtn")?.addEventListener("click", closeRaidModal);
  $id("raidAttackBtn")?.addEventListener("click", performAttack);
  $id("raidBackBtn")?.addEventListener("click", () => closeCombatModal());
}

// init
async function mainInit() {
  await initSession();
  bindEvents();
  // Tenta carregar uma raid ativa ao iniciar a página, caso o jogador tenha fechado a aba no meio de uma.
  await loadRaid();
}

document.addEventListener("DOMContentLoaded", mainInit);