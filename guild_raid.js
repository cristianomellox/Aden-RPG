
console.log("guild_raid.js atualizado (boss + player hp + modals) ✅");

const SUPABASE_URL = "https://lqzlblvmkuwedcofmgfb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAX_ATTACKS = 3;
const ATTACK_COOLDOWN_SECONDS = 12;
const RAID_POLL_MS = 5000;
const BOSS_CHECK_MS = 3000; // checa a cada 3s se deve solicitar ataque do boss (backend aplica cooldown 30s)
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
  el.style.top = "5%";
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

  // separador horizontal
  const hr = document.createElement("hr");
  hr.style.width = "90%";
  hr.style.margin = "12px auto";
  container.appendChild(hr);

  // player area container
  const pArea = document.createElement("div");
  pArea.id = "raidPlayerArea";
  pArea.style.display = "flex";
  pArea.style.flexDirection = "column";
  pArea.style.alignItems = "center";
  pArea.style.gap = "8px";
  pArea.style.position = "relative";

  // avatar
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

  // revive overlay text
  const reviveOverlay = document.createElement("div");
  reviveOverlay.id = "raidPlayerReviveOverlay";
  reviveOverlay.style.position = "absolute";
  reviveOverlay.style.left = "0";
  reviveOverlay.style.top = "0";
  reviveOverlay.style.width = "100%";
  reviveOverlay.style.height = "100%";
  reviveOverlay.style.display = "none";
  reviveOverlay.style.flexDirection = "column";
  reviveOverlay.style.alignItems = "center";
  reviveOverlay.style.justifyContent = "center";
  reviveOverlay.style.color = "#fff";
  reviveOverlay.style.textAlign = "center";
  reviveOverlay.style.background = "rgba(0,0,0,0.45)";
  reviveOverlay.style.fontWeight = "bold";
  reviveOverlay.style.fontSize = "0.9rem";
  reviveOverlay.style.padding = "4px";
  avatarWrap.appendChild(reviveOverlay);

  // player hp bar
  const pHpContainer = document.createElement("div");
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
    if (overlay) { overlay.style.display = "none"; overlay.textContent = ""; }
  }
}

function setPlayerReviveOverlayText(remainingSeconds) {
  const overlay = $id("raidPlayerReviveOverlay");
  if (!overlay) return;
  if (remainingSeconds <= 0) {
    overlay.style.display = "none";
    return;
  }
  overlay.style.display = "flex";
  overlay.innerHTML = `<div style="font-size:0.9em">Revivendo em:</div><div style="font-size:1.1em;margin-top:4px">${remainingSeconds}s</div>`;
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
    await loadPlayerCombatState(); // player HP, avatar, etc.
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
    // atualiza título se for chefe
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

  // desabilita botão se jogador está morto (revive)
  const playerDead = isPlayerDeadLocal();
  if (playerDead) {
    attackBtn.style.pointerEvents = "none";
    attackBtn.style.filter = "grayscale(80%)";
  } else {
    attackBtn.style.pointerEvents = shownAttacks > 0 ? "" : "none";
    attackBtn.style.filter = shownAttacks > 0 ? "" : "grayscale(60%)";
  }
}

// verifica localmente se jogador está morto (consulta players.revive_until)
let _playerReviveUntil = null;
function isPlayerDeadLocal() {
  if (!_playerReviveUntil) return false;
  return new Date(_playerReviveUntil) > new Date();
}

// tenta sincronizar revive state e current_hp do player
async function loadPlayerCombatState() {
  if (!userId) return;
  try {
    const { data, error } = await supabase.from("players").select("current_monster_health, health, avatar_url, revive_until").eq("id", userId).single();
    if (!error && data) {
      const maxHp = data.health || 1;
      const curHp = (data.current_monster_health !== null && data.current_monster_health !== undefined) ? data.current_monster_health : maxHp;
      _playerReviveUntil = data.revive_until;
      const av = $id("raidPlayerAvatar");
      if (av && data.avatar_url) av.src = data.avatar_url;
      updatePlayerHpUi(curHp, maxHp);
      if (_playerReviveUntil && new Date(_playerReviveUntil) > new Date()) {
        // mostra contador
        const secs = Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000);
        setPlayerReviveOverlayText(secs);
      }
    }
  } catch (e) {
    console.error("loadPlayerCombatState", e);
  }
}

// --- attempts refresh RPC (unchanged)
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

// --- perform attack (verifica se vivo e chama RPC) ---
async function performAttack() {
  if (!currentRaidId || !userId) return;

  // impede ataque se jogador está revivendo
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
      // se backend retornar mensagem clara, mostra ela
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

    const damage = payload.damage_dealt ?? 0;
    const isCrit = payload.is_crit === true;
    const monsterHp = payload.monster_health;
    const monsterMax = payload.max_monster_health || maxMonsterHealth;

    displayFloatingDamageOver($id("raidMonsterArea"), damage, isCrit);
    playHitSound(isCrit);

    await loadAttempts();
    await refreshRanking();

    if (monsterHp !== null) updateHpBar(monsterHp, monsterMax);

    // quando monstro morre, backend nos retorna xp_reward e crystals_reward
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

// --- boss attack loop: periodicamente pede ao backend para atacar jogador (backend garante 30s cooldown)
async function tryBossAttackForPlayer() {
  if (!currentRaidId || !userId) return;
  // only check if current floor is boss
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
      // show floating dmg above avatar
      const avatarWrap = $id("raidPlayerAvatarWrap");
      displayFloatingDamageOver(avatarWrap, dmg, false);
      // update local state
      _playerReviveUntil = payload.player_revive_until || null;
      updatePlayerHpUi(newHp, newHp || 1); // will be corrected on next loadPlayerCombatState
      if (_playerReviveUntil && new Date(_playerReviveUntil) > new Date()) {
        setPlayerReviveOverlayText(Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000));
      }
      updateAttackUI();
    } else if (payload.action === "evaded") {
      const avatarWrap = $id("raidPlayerAvatarWrap");
      displayFloatingDamageOver(avatarWrap, "Evade", false);
    } else if (payload.action === "skipped") {
      // nothing
    } else if (payload.action === "target_reviving") {
      // nothing
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

// revive ticker show countdown above avatar
function startReviveTicker() {
  stopReviveTicker();
  reviveTickerInterval = setInterval(async () => {
    if (!isPlayerDeadLocal()) {
      setPlayerReviveOverlayText(0);
      return;
    }
    const remaining = Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000);
    setPlayerReviveOverlayText(remaining);
    if (remaining <= 0) {
      // reload player state
      await loadPlayerCombatState();
      updateAttackUI();
    }
  }, REVIVE_CHECK_MS);
}
function stopReviveTicker() {
  if (reviveTickerInterval) clearInterval(reviveTickerInterval);
  reviveTickerInterval = null;
}

// --- refresh raid state (garante que raid seja finalizada via polling também)
async function refreshRaidState() {
  if (!currentRaidId) return;
  try {
    const { data, error } = await supabase.from("guild_raids").select("*").eq("id", currentRaidId).single();
    if (error || !data) {
      closeCombatModal();
      stopPolling();
      clearRaidTimer();
      currentRaidId = null;
      stopBossChecker();
      stopReviveTicker();
      return;
    }
    // update UI
    setRaidTitleFloorAndTimer(data.current_floor || 1, data.ends_at);
    updateHpBar(data.monster_health, data.initial_monster_health || maxMonsterHealth);
    if (data.current_floor) await loadMonsterForFloor(data.current_floor);
    // if raid ended by time -> mark inactive (server update)
    if (data.ends_at && new Date(data.ends_at) <= new Date()) {
      await supabase.from("guild_raids").update({ active: false }).eq("id", currentRaidId);
      // close UI
      closeCombatModal();
      stopBossChecker();
      stopReviveTicker();
    }
  } catch (e) {
    console.error("refreshRaidState", e);
  }
}

// --- buy attack (unchanged)
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
      // force server to close raid (if not closed yet)
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

// bind events (inclui botão Iniciar Nova Raid)
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

  // Iniciar nova raid a partir do modal de resultado
  $id("startNewRaidFromLastResultBtn")?.addEventListener("click", () => {
    // abre o modal de iniciar raid
    openRaidModal();
    // fecha modal de resultado
    const m = $id("lastRaidResultModal"); if (m) m.style.display = "none";
  });

  $id("startRaidBtn")?.addEventListener("click", async () => {
    if (userRank !== "leader" && userRank !== "co-leader") { alert("Apenas líder/co-líder"); return; }
    const startBtn = $id("startRaidBtn");
    startBtn.disabled = true;
    try {
      const { data, error } = await supabase.rpc("start_guild_raid", { p_guild_id: userGuildId, p_player_id: userId, p_name: "Torre da Desolação" });
      if (error) {
        // backend já tem verificação "uma raid por dia seg-sex", exiba mensagem clara
        alert(error.message || "Erro ao iniciar raid");
        return;
      }
      // sucesso
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


// --- Ajuste para mostrar dano do chefe sobre avatar ---
function showBossDamageOnPlayer(damage) {
  const avatarWrap = document.getElementById("raidPlayerAvatarWrap");
  if (avatarWrap && damage > 0) {
    displayFloatingDamageOver(avatarWrap, damage, false);
    playHitSound(false);
  }
}
