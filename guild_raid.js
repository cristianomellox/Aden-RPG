console.log("guild_raid.js atualizado (correções de estado e UI) ✅");

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
  el.textContent = isCrit ? `✦ ${Number(val).toLocaleString()}` : Number(val).toLocaleString();
  el.className = isCrit ? "crit-damage-number" : "damage-number";
  el.style.position = "absolute";
  el.style.left = "50%";
  el.style.top = "30%"; // Ajustado para melhor posicionamento no container maior
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
  if ($id("raidPlayerArea")) return; // já criado

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

  // NOVO: Elemento de texto para reviver (fora do avatar)
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
  reviveOverlay.style.background = "rgba(0,0,0,0.6)"; // Efeito de escurecer
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

// --- monster HP UI text inside bar (like Mina) ---
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

// time helpers
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

function setRaidTitleFloorAndTimer(floor, endsAt) {
  const title = $id("raidCombatTitle");
  if (!title) return;
  currentFloor = floor || 1;
  let timerText = "";
  if (endsAt) {
    const diff = Math.max(0, Math.floor((new Date(endsAt) - new Date()) / 1000));
    timerText = ` — Tempo restante: ${formatTime(diff)}`;
  }
  title.textContent = `Andar ${floor}${timerText}`;
}

// --- session init
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

// --- load raid
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
      stopPolling();
      clearRaidTimer();
      stopBossChecker();
      stopReviveTicker();
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
    const title = $id("raidCombatTitle");
    if (title) {
      if (floor % 5 === 0) {
        title.textContent = `Desafiando Monstro — Andar ${floor}`;
      } else {
        title.textContent = `Andar ${floor}`;
      }
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
      await supabase.from("guild_raid_attempts").insert({
        raid_id: currentRaidId,
        player_id: userId,
        attempts_left: MAX_ATTACKS
      });
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
      alert("Sem ataques. Aguarde regeneração ou compre mais.");
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
      // Se a mensagem for que a raid acabou, o poller vai fechar a tela.
      await loadAttempts();
      return;
    }

    // ATUALIZAÇÃO IMEDIATA DO CONTADOR DE ATAQUES
    if (payload.attacks_left !== null && payload.attacks_left !== undefined) {
      attacksLeft = Number(payload.attacks_left);
    }
    if (payload.last_attack_at) {
      lastAttackAt = new Date(payload.last_attack_at);
    } else {
      lastAttackAt = null;
    }
    updateAttackUI(); // Força a atualização da UI com os novos dados

    const damage = payload.damage_dealt ?? 0;
    const isCrit = payload.is_crit === true;
    const monsterHp = payload.monster_health;
    const monsterMax = payload.max_monster_health || maxMonsterHealth;

    displayFloatingDamageOver($id("raidMonsterArea"), damage, isCrit);
    playHitSound(isCrit);

    await refreshRanking();

    if (monsterHp !== null) updateHpBar(monsterHp, monsterMax);
    if (payload.player_health !== null && payload.player_max_health !== null) {
      updatePlayerHpUi(payload.player_health, payload.player_max_health);
    }
    _playerReviveUntil = payload.player_revive_until || null;

    if (monsterHp !== null && Number(monsterHp) <= 0) {
      if (payload.xp_reward || payload.crystals_reward) {
        const modal = document.createElement("div");
        modal.className = "modal";
        modal.style.display = "flex";
        modal.innerHTML = `
          <div class="modal-content">
            <h3>Vitória!</h3>
            <p>Você ganhou:</p>
            <p><b>${payload.xp_reward || 0}</b> XP</p>
            <p><b>${payload.crystals_reward || 0}</b> Cristais</p>
            <button id="raidRewardOkBtn" class="action-btn">Ok</button>
          </div>`;
        document.body.appendChild(modal);
        document.getElementById("raidRewardOkBtn").addEventListener("click", () => {
          modal.remove();
          loadRaid().catch(()=>{});
        });
      } else {
        setTimeout(() => loadRaid().catch(()=>{}), 600);
      }
    }
  } catch (e) {
    console.error("performAttack erro:", e);
  } finally {
    if (attackBtn) attackBtn.style.pointerEvents = "";
  }
}

async function tryBossAttackForPlayer() {
  if (!currentRaidId || !userId) return;
  if ((currentFloor % 5) !== 0) return;

  try {
    const { data, error } = await supabase.rpc("guild_raid_boss_attack", { p_raid_id: currentRaidId, p_player_id: userId });
    if (error) {
      console.warn("boss attack rpc erro:", error);
      return;
    }
    const payload = Array.isArray(data) ? data[0] : data;
    if (!payload || !payload.success) return;

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
      displayFloatingDamageOver(playerArea, "Evade", false);
    }
  } catch (e) {
    console.error("tryBossAttackForPlayer", e);
  }
}

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
      try {
        const { data, error } = await supabase.rpc("player_revive_if_needed", { p_player_id: userId });
        if (error) {
          console.error("player_revive_if_needed erro:", error);
        } else {
          await loadPlayerCombatState();
          updateAttackUI();
        }
      } catch (rpcError) {
        console.error("Falha ao tentar reviver o jogador via RPC:", rpcError);
      }
    }
  }, REVIVE_CHECK_MS);
}
function stopReviveTicker() {
  if (reviveTickerInterval) clearInterval(reviveTickerInterval);
  reviveTickerInterval = null;
}

async function refreshRaidState() {
  if (!currentRaidId) return;
  try {
    const { data, error } = await supabase.from("guild_raids").select("*").eq("id", currentRaidId).single();

    if (error || !data || !data.active) {
      closeCombatModal();
      stopPolling();
      clearRaidTimer();
      currentRaidId = null;
      stopBossChecker();
      stopReviveTicker();
      alert("A Raid terminou.");
      return;
    }

    setRaidTitleFloorAndTimer(data.current_floor || 1, data.ends_at);
    updateHpBar(data.monster_health, data.initial_monster_health || maxMonsterHealth);
    if (data.current_floor) await loadMonsterForFloor(data.current_floor);
    
    if (data.active && data.ends_at && new Date(data.ends_at) <= new Date()) {
      await supabase.from("guild_raids").update({ active: false }).eq("id", currentRaidId);
    }
  } catch (e) {
    console.error("refreshRaidState", e);
  }
}

async function buyRaidAttack() {
  if (!userId) { alert("Faça login"); return; }
  try {
    const { data, error } = await supabase.rpc("buy_raid_attack", { p_player_id: userId });
    const resp = Array.isArray(data) ? data[0] : data;
    if (resp && resp.success) {
      alert(resp.message || "Compra efetuada");
      await loadAttempts();
    } else {
      alert(resp?.message || "Compra não efetuada");
    }
  } catch (e) {
    console.error("buyRaidAttack", e);
  }
}

// --- polling / timers control ---
function startPolling() {
  stopPolling();
  pollInterval = setInterval(() => {
    refreshRaidState().catch(()=>{});
    refreshRanking().catch(()=>{});
    loadPlayerCombatState().catch(()=>{});
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
      // A função refreshRaidState vai cuidar de fechar a raid e a UI.
      // Apenas garantimos que o servidor seja notificado, caso o poller ainda não tenha rodado.
      if (currentRaidId) supabase.from("guild_raids").update({ active: false }).eq("id", currentRaidId).catch(()=>{});
      refreshRaidState();
      return;
    }
    const floorMatch = $id("raidCombatTitle")?.textContent?.match(/Andar (\d+)/i);
    const floor = floorMatch ? Number(floorMatch[1]) : 1;
    setRaidTitleFloorAndTimer(floor, raidEndsAt);
  }, 1000);
}
function clearRaidTimer() { if (raidTimerInterval) clearInterval(raidTimerInterval); raidTimerInterval = null; }

// --- Modals open/close helpers (unchanged)
function openRaidModal() { const m = $id("raidModal"); if (m) m.style.display = "flex"; }
function closeRaidModal(){ const m = $id("raidModal"); if (m) m.style.display = "none"; }
function openCombatModal(){ const m = $id("raidCombatModal"); if (m) m.style.display = "flex"; }
function closeCombatModal(){ const m = $id("raidCombatModal"); if (m) m.style.display = "none"; stopPolling(); stopUISecondTicker(); clearRaidTimer(); stopBossChecker(); stopReviveTicker();}

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
  $id("raidBuyAttackBtn")?.addEventListener("click", buyRaidAttack);
  $id("raidBackBtn")?.addEventListener("click", () => closeCombatModal());
  $id("closeLastResultBtn")?.addEventListener("click", () => { const m=$id("lastRaidResultModal"); if(m) m.style.display="none"; });
}

// init
async function mainInit() {
  await initSession();
  bindEvents();
  await loadRaid();
}

document.addEventListener("DOMContentLoaded", mainInit);