/* guild_raid.js — atualizado e corrigido
   - Corrige chamada para iniciar raid (RPC: start_guild_raid).
   - Corrige lógica de clique em 'tdd' para abrir modal de início de raid quando não há raid ativa.
   - Mantém melhorias de regeneração de ataques, cooldown e UI.
*/

console.log("guild_raid.js (corrigido) carregado ✅");

const SUPABASE_URL = "https://lqzlblvmkuwedcofmgfb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Config
const MAX_ATTACKS = 3;
const ATTACK_COOLDOWN_SECONDS = 12; // 2 minutos
const RAID_POLL_MS = 5000; // polling para estado geral (hp, ranking etc.)

// Estado
let userId = null;
let userGuildId = null;
let userRank = "member";
let currentRaidId = null;
let maxMonsterHealth = 1;
let attacksLeft = 0;
let lastAttackAt = null;
let raidEndsAt = null;

// Timers
let pollInterval = null;
let uiSecondInterval = null;
let raidTimerInterval = null;

// Flag para evitar múltiplos refreshes simultâneos
let refreshAttemptsPending = false;

// --- Audio (igual à mina) ---
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

// --- DOM helper ---
const $id = (id) => document.getElementById(id);

// --- UI: dano flutuante (igual Mina) ---
function displayFloatingDamage(val, isCrit) {
  const target = $id("raidMonsterArea");
  if (!target) return;
  const el = document.createElement("div");
  el.textContent = isCrit ? `✦ ${Number(val).toLocaleString()}` : Number(val).toLocaleString();
  el.className = isCrit ? "crit-damage-number" : "damage-number";
  el.style.position = "absolute";
  el.style.left = "50%";
  el.style.top = "20%";
  el.style.transform = "translate(-50%,-50%)";
  el.style.zIndex = "999";
  target.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// --- HP bar ---
function updateHpBar(cur, max) {
  const fill = $id("raidMonsterHpFill");
  const text = $id("raidMonsterHpText");
  const c = Math.max(0, Number(cur || 0));
  const m = Math.max(1, Number(max || 1));
  const pct = Math.max(0, Math.min(100, (c / m) * 100));
  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = `${c.toLocaleString()} / ${m.toLocaleString()}`;
}

// --- Título / Timer ---
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
  let timerText = "";
  if (endsAt) {
    const diff = Math.max(0, Math.floor((new Date(endsAt) - new Date()) / 1000));
    timerText = ` — Tempo restante: ${formatTime(diff)}`;
  }
  title.textContent = `Andar ${floor}${timerText}`;
}

// --- Sessão / init ---
async function initSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return;
    userId = data.session.user.id;
    const { data: player, error } = await supabase.from("players").select("guild_id, rank").eq("id", userId).single();
    if (!error && player) {
      userGuildId = player.guild_id;
      userRank = player.rank || "member";
    }
  } catch (e) { console.error("initSession", e); }
}

// --- Carrega Raid ativa ---
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
    startPolling();
    startUISecondTicker();
    startRaidTimer();
    openCombatModal();
  } catch (e) {
    console.error("loadRaid erro:", e);
  }
}

// --- Carrega imagem do monstro (por andar) ---
async function loadMonsterForFloor(floor) {
  if (!floor) return;
  try {
    const { data, error } = await supabase.from("guild_raid_monsters").select("image_url, base_health").eq("floor", floor).single();
    if (!error && data) {
      const img = $id("raidMonsterImage");
      if (img) img.src = data.image_url;
      if (data.base_health) maxMonsterHealth = Number(data.base_health);
    } else {
      const img = $id("raidMonsterImage");
      if (img) img.src = (floor % 5 === 0)
        ? `https://aden-rpg.pages.dev/assets/raid_boss_floor${floor}.webp`
        : `https://aden-rpg.pages.dev/assets/raid_monster_floor${floor}.webp`;
    }
  } catch (e) {
    console.error("loadMonsterForFloor", e);
  }
}

// --- Ranking ---
async function refreshRanking() {
  if (!currentRaidId) return;
  try {
    const { data, error } = await supabase
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

// --- Load attempts (from DB) ---
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

// --- Calcula ataques exibidos (client-side) com base no estado persistido ---
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

// --- Atualiza UI dos ataques (mostra X / 3, cooldown por segundo) ---
function updateAttackUI() {
  const attacksEl = $id("raidPlayerAttacks");
  const cooldownEl = $id("raidAttackCooldown");
  const attackBtn = $id("raidAttackBtn");
  if (!attacksEl || !cooldownEl || !attackBtn) return;

  const { shownAttacks, secondsToNext } = computeShownAttacksAndRemaining();

  attacksEl.textContent = `${shownAttacks} / ${MAX_ATTACKS}`;

  if (secondsToNext > 0) {
    cooldownEl.textContent = `Próx recarga em ${formatTime(secondsToNext)}`;
  } else {
    cooldownEl.textContent = "";
  }

  if (shownAttacks > 0) {
    attackBtn.style.pointerEvents = "";
    attackBtn.style.filter = "";
  } else {
    attackBtn.style.pointerEvents = "none";
    attackBtn.style.filter = "grayscale(60%)";
  }
}

// --- RPC: refresh attempts server-side (persiste recargas) ---
async function refreshAttemptsServerSideOnceIfNeeded() {
  if (!currentRaidId || !userId || refreshAttemptsPending) return;
  const { shownAttacks } = computeShownAttacksAndRemaining();

  const shouldRefresh = (shownAttacks > attacksLeft);
  if (!shouldRefresh) return;

  refreshAttemptsPending = true;
  try {
    const { data, error } = await supabase.rpc("refresh_guild_raid_attempts", {
      p_raid_id: currentRaidId,
      p_player_id: userId
    });
    if (error) {
      console.warn("refresh_guild_raid_attempts erro:", error);
    } else {
      const payload = Array.isArray(data) ? data[0] : data;
      if (payload) {
        attacksLeft = Number(payload.attempts_left || 0);
        lastAttackAt = payload.last_attack_at ? new Date(payload.last_attack_at) : null;
      }
      updateAttackUI();
    }
  } catch (e) {
    console.error("refreshAttemptsServerSideOnceIfNeeded", e);
  } finally {
    refreshAttemptsPending = false;
  }
}

// --- Ataque (cliente) ---
async function performAttack() {
  if (!currentRaidId || !userId) return;

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
      await loadAttempts();
      return;
    }

    const damage = payload.damage_dealt ?? 0;
    const isCrit = payload.is_crit === true;
    const monsterHp = payload.monster_health;
    const monsterMax = payload.max_monster_health || maxMonsterHealth;

    displayFloatingDamage(damage, isCrit);
    playHitSound(isCrit);

    await loadAttempts();
    await refreshRanking();

    if (monsterHp !== null) updateHpBar(monsterHp, monsterMax);
    if (monsterHp !== null && Number(monsterHp) <= 0) {
      setTimeout(() => loadRaid().catch(()=>{}), 600);
    }
  } catch (e) {
    console.error("performAttack erro:", e);
  } finally {
    if (attackBtn) attackBtn.style.pointerEvents = "";
  }
}

// --- refresh raid state (hp, floor, ends_at) ---
async function refreshRaidState() {
  if (!currentRaidId) return;
  try {
    const { data, error } = await supabase.from("guild_raids").select("*").eq("id", currentRaidId).single();
    if (error || !data || !data.active) {
      closeCombatModal();
      stopPolling();
      clearRaidTimer();
      currentRaidId = null;
      return;
    }
    setRaidTitleFloorAndTimer(data.current_floor || 1, data.ends_at);
    updateHpBar(data.monster_health, data.initial_monster_health || maxMonsterHealth);
    if (data.current_floor) await loadMonsterForFloor(data.current_floor);
    if (data.ends_at && new Date(data.ends_at) <= new Date()) {
      await supabase.from("guild_raids").update({ active: false }).eq("id", currentRaidId);
    }
  } catch (e) {
    console.error("refreshRaidState", e);
  }
}

// --- Compra de ataque ---
async function buyRaidAttack() {
  if (!userId) { alert("Faça login"); return; }
  try {
    const { data, error } = await supabase.rpc("buy_raid_attack", { p_player_id: userId });
    if (error) {
      alert(error.message || "Compra indisponível");
      return;
    }
    const resp = Array.isArray(data) ? data[0] : data;
    if (resp && resp.success) {
      alert(resp.message || "Compra efetuada");
      await loadAttempts();
    } else {
      alert(resp.message || "Compra não efetuada");
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

function stopUISecondTicker() {
  if (uiSecondInterval) clearInterval(uiSecondInterval);
  uiSecondInterval = null;
}

// --- Raid countdown (ends_at) ---
function startRaidTimer() {
  clearRaidTimer();
  if (!raidEndsAt) return;
  raidTimerInterval = setInterval(() => {
    const diff = Math.floor((new Date(raidEndsAt) - new Date()) / 1000);
    if (diff <= 0) {
      clearRaidTimer();
      refreshRaidState();
      return;
    }
    const floorMatch = $id("raidCombatTitle")?.textContent?.match(/Andar (\d+)/i);
    const floor = floorMatch ? Number(floorMatch[1]) : 1;
    setRaidTitleFloorAndTimer(floor, raidEndsAt);
  }, 1000);
}

function clearRaidTimer() {
  if (raidTimerInterval) clearInterval(raidTimerInterval);
  raidTimerInterval = null;
}

// --- Modal helpers ---
function openRaidModal() { const m = $id("raidModal"); if (m) m.style.display = "flex"; }
function closeRaidModal(){ const m = $id("raidModal"); if (m) m.style.display = "none"; }
function openCombatModal(){ const m = $id("raidCombatModal"); if (m) m.style.display = "flex"; }
function closeCombatModal(){ const m = $id("raidCombatModal"); if (m) m.style.display = "none"; stopPolling(); stopUISecondTicker(); clearRaidTimer();}

// --- DOM bindings ---
function bindEvents() {
  const tdd = $id("tdd");
  if (tdd) {
    tdd.addEventListener("click", async () => {
      if (!userGuildId) {
        console.warn("Guild ID não encontrado. Ação de raid interrompida.");
        return;
      }
      
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
        openRaidModal();
      }
    });
  }

  const startBtn = $id("startRaidBtn");
  if (startBtn) startBtn.addEventListener("click", async () => {
    if (userRank !== "leader" && userRank !== "co-leader") { alert("Apenas líder/co-líder"); return; }
    startBtn.disabled = true;
    try {
      await supabase.rpc("start_guild_raid", { p_guild_id: userGuildId, p_player_id: userId, p_name: "Torre da Desolação" });
      await loadRaid();
      closeRaidModal();
    } catch(e) { console.error("startRaid", e); alert("Erro ao iniciar raid"); }
    finally { startBtn.disabled = false; }
  });

  const cancelBtn = $id("cancelRaidBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", closeRaidModal);

  const attackBtn = $id("raidAttackBtn");
  if (attackBtn) attackBtn.addEventListener("click", performAttack);

  const buyBtn = $id("raidBuyAttackBtn");
  if (buyBtn) buyBtn.addEventListener("click", buyRaidAttack);

  const backBtn = $id("raidBackBtn");
  if (backBtn) backBtn.addEventListener("click", () => closeCombatModal());

  const raidModalEl = $id("raidModal");
  if (raidModalEl) raidModalEl.addEventListener("click", (e) => { if (e.target === raidModalEl) closeRaidModal(); });
  const raidCombatModalEl = $id("raidCombatModal");
  if (raidCombatModalEl) raidCombatModalEl.addEventListener("click", (e) => { if (e.target === raidCombatModalEl) closeCombatModal(); });
}

// --- Init main ---
async function mainInit() {
  await initSession();
  bindEvents();
  await loadRaid();
}

document.addEventListener("DOMContentLoaded", mainInit);