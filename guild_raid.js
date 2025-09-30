console.log("guild_raid.js (v5) com intro de raid, música de chefe e correções ✅");

const SUPABASE_URL = "https://lqzlblvmkuwedcofmgfb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAX_ATTACKS = 3;
const ATTACK_COOLDOWN_SECONDS = 60;
const RAID_POLL_MS = 2000;
const BOSS_CHECK_MS = 1000;
const REVIVE_CHECK_MS = 1000;
const AMBIENT_AUDIO_INTERVAL_MS = 60 * 1000;

// URLs de Mídia
// PONTO 3: Adicione a URL correta para o vídeo de introdução da RAID
const RAID_INTRO_VIDEO_URL = "https://aden-rpg.pages.dev/assets/tddintro.webm"; // <-- SUBSTITUIR URL
const BOSS_INTRO_VIDEO_URL = "https://aden-rpg.pages.dev/assets/tddbossintro.webm";
const BOSS_DEATH_VIDEO_URL = "https://aden-rpg.pages.dev/assets/tddbossoutro.webm";
const BOSS_ATTACK_VIDEO_URLS = [
    "https://aden-rpg.pages.dev/assets/tddbossatk01.webm", "https://aden-rpg.pages.dev/assets/tddbossatk02.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk03.webm", "https://aden-rpg.pages.dev/assets/tddbossatk04.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk05.webm"
];
const AMBIENT_AUDIO_URLS = [
    "https://aden-rpg.pages.dev/assets/tddboss01.mp3", "https://aden-rpg.pages.dev/assets/tddboss02.mp3", "https://aden-rpg.pages.dev/assets/tddboss03.mp3", "https://aden-rpg.pages.dev/assets/tddboss04.mp3", "https://aden-rpg.pages.dev/assets/tddboss05.mp3", "https://aden-rpg.pages.dev/assets/tddboss06.mp3", "https://aden-rpg.pages.dev/assets/tddboss07.mp3", "https://aden-rpg.pages.dev/assets/tddboss08.mp3", "https://aden-rpg.pages.dev/assets/tddboss09.mp3", "https://aden-rpg.pages.dev/assets/tddboss10.mp3", "https://aden-rpg.pages.dev/assets/tddboss11.mp3", "https://aden-rpg.pages.dev/assets/tddboss12.mp3", "https://aden-rpg.pages.dev/assets/tddboss13.mp3", "https://aden-rpg.pages.dev/assets/tddboss14.mp3", "https://aden-rpg.pages.dev/assets/tddboss15.mp3"
];
// PONTO 4: Adicione a URL correta para a MÚSICA do chefe
const BOSS_MUSIC_URL = "https://aden-rpg.pages.dev/assets/desolation_tower.mp3";

// Variáveis de estado
let userId = null, userGuildId = null, userRank = "member";
let currentRaidId = null, currentFloor = 1, maxMonsterHealth = 1;
let attacksLeft = 0, lastAttackAt = null, raidEndsAt = null;
let pollInterval = null, uiSecondInterval = null, raidTimerInterval = null, bossCheckInterval = null, reviveTickerInterval = null;
let refreshAttemptsPending = false;
let shownRewardIds = new Set(); 

// Sistema de Fila de Ações e Controle de Mídia
let actionQueue = [];
let isProcessingAction = false;
let isMediaUnlocked = false;
let ambientAudioInterval = null;
let ambientAudioPlayer = null; 
let bossMusicPlayer = null; // PONTO 4: Player de música do chefe
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Áudio de Efeitos
const audioNormal = new Audio("https://aden-rpg.pages.dev/assets/normal_hit.mp3");
const audioCrit = new Audio("https://aden-rpg.pages.dev/assets/critical_hit.mp3");
audioNormal.volume = 0.06;
audioCrit.volume = 0.1;

function playHitSound(isCrit) {
    if(!isMediaUnlocked) return;
    try {
        const audio = isCrit ? audioCrit : audioNormal;
        audio.currentTime = 0;
        audio.play().catch(()=>{});
    } catch(e){ console.warn("playHitSound", e); }
}

const $id = id => document.getElementById(id);

// --- Sistema de Fila de Ações ---
function processNextAction() {
    if (isProcessingAction || actionQueue.length === 0) return;
    isProcessingAction = true;
    const nextAction = actionQueue.shift();
    nextAction();
}

function queueAction(action) {
    actionQueue.push(action);
    processNextAction();
}

// --- Funções de Mídia ---
function createMediaPlayers() {
    if (!$id('raidVideoOverlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'raidVideoOverlay';
        overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: black; z-index: 20000; display: none; justify-content: center; align-items: center;`;
        const video = document.createElement('video');
        video.id = 'raidVideoPlayer';
        // avoid showing browser poster/placeholder; keep hidden until loaded
        video.style.cssText = 'width: 100%; height: 100%; background: none; object-fit: cover; visibility: hidden;';
        video.setAttribute('playsinline', '');
        video.setAttribute('preload', 'auto');
        try { video.removeAttribute('poster'); } catch(e){}
        video.addEventListener('loadeddata', () => {
            try { video.style.visibility = 'visible'; } catch(e){}
        }, { once: true });
        overlay.appendChild(video);
        document.body.appendChild(overlay);
    }
    if (!ambientAudioPlayer) {
        ambientAudioPlayer = new Audio();
        ambientAudioPlayer.volume = 0.3;
    }
    // PONTO 4: Cria o player de música do chefe
    if (!bossMusicPlayer) {
        bossMusicPlayer = new Audio(BOSS_MUSIC_URL);
        bossMusicPlayer.volume = 0.05;
        bossMusicPlayer.loop = true;
    }
}

function playVideo(src, onVideoEndCallback) {
    const videoOverlay = $id('raidVideoOverlay');
    const videoPlayer = $id('raidVideoPlayer');
    if (!videoOverlay || !videoPlayer) {
        console.warn("playVideo: elementos de vídeo não encontrados");
        if (onVideoEndCallback) onVideoEndCallback();
        return;
    }

    try {
        videoPlayer.style.visibility = 'hidden';
        videoPlayer.setAttribute('poster', '');
        videoPlayer.muted = !isMediaUnlocked;
        videoPlayer.src = src;
    } catch(e) { console.warn('playVideo prepare erro', e); }

    videoOverlay.style.display = 'flex';

    const onLoaded = () => {
        try {
            videoPlayer.style.visibility = 'visible';
            videoPlayer.play().catch(()=>{});
        } catch(e){}
    };
    videoPlayer.addEventListener('loadeddata', onLoaded, { once: true });

    const endPlayback = () => {
        try {
            videoPlayer.removeEventListener('ended', endPlayback);
            videoPlayer.pause();
            videoPlayer.currentTime = 0;
        } catch(e){}
        try { videoOverlay.style.display = 'none'; } catch(e){}
        if (onVideoEndCallback) onVideoEndCallback();
        isProcessingAction = false;
        processNextAction();
    };
    videoPlayer.addEventListener('ended', endPlayback, { once: true });
}function unlockMedia() {
    if (isMediaUnlocked) return;
    
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(e => console.warn("AudioContext resume falhou", e));
    }

    const audiosToUnlock = [audioNormal, audioCrit, ambientAudioPlayer, bossMusicPlayer];
    audiosToUnlock.forEach(audio => {
        if (audio) {
            const wasPaused = audio.paused;
            if (wasPaused) {
                audio.play().then(() => {
                    audio.pause();
                    audio.currentTime = 0;
                }).catch(() => {});
            }
        }
    });
    
    const videoPlayer = $id('raidVideoPlayer');
    if (videoPlayer) videoPlayer.muted = false;
    isMediaUnlocked = true;
    console.log("Mídia desbloqueada pela interação do usuário.");
}

function playRandomAmbientAudio() {
    if (!isMediaUnlocked || isProcessingAction || document.visibilityState !== 'visible') return;
    const audioSrc = AMBIENT_AUDIO_URLS[Math.floor(Math.random() * AMBIENT_AUDIO_URLS.length)];
    ambientAudioPlayer.src = audioSrc;
    ambientAudioPlayer.play().catch(e => console.warn("Falha no play do áudio ambiente:", e));
}

// PONTO 4: Sistema de música de fundo
function stopAllFloorMusic() {
    if (ambientAudioInterval) {
        clearInterval(ambientAudioInterval);
        ambientAudioInterval = null;
    }
    if (bossMusicPlayer && !bossMusicPlayer.paused) {
        bossMusicPlayer.pause();
        bossMusicPlayer.currentTime = 0;
    }
}

function startFloorMusic() {
    stopAllFloorMusic();
    if (!isMediaUnlocked) return;

    if (currentFloor % 5 === 0) {
        bossMusicPlayer.play().catch(e => console.warn("Falha no play da música do chefe:", e));
    } else {
        ambientAudioInterval = setInterval(playRandomAmbientAudio, AMBIENT_AUDIO_INTERVAL_MS);
    }
}

// O restante do código permanece o mesmo, com pequenas alterações para chamar as novas funções de música
// ... (código de UI, HP, etc., sem alterações) ...
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


function setRaidTitleFloorAndTimer(floor, endsAt) {
  const displayFloor = floor || currentFloor || 1;

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
      <div style="font-weight:bold; font-size:0.9em;">${displayFloor}°</div>
      <div style="font-size:0.6em; font-weight: bold;">Andar</div>
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
    stopAllFloorMusic();
    try {
        const { data, error } = await supabase.from("guild_raids").select("*").eq("guild_id", userGuildId).eq("active", true).order("started_at", { ascending: false }).limit(1).single();
        if (error || !data) {
            currentRaidId = null;
            closeCombatModal();
            return;
        }
        const isNewFloor = data.current_floor !== currentFloor;
        const isEnteringBossFloor = isNewFloor && (data.current_floor % 5 === 0);
        await continueLoadingRaid(data);
        if (isEnteringBossFloor) {
            queueAction(() => playVideo(BOSS_INTRO_VIDEO_URL));
        }
    } catch (e) {
        console.error("loadRaid erro:", e);
    }
}

async function continueLoadingRaid(raidData) {
    currentRaidId = raidData.id;
    currentFloor = raidData.current_floor || 1; 
    maxMonsterHealth = Number(raidData.initial_monster_health) || 1;
    raidEndsAt = raidData.ends_at;

    setRaidTitleFloorAndTimer(currentFloor, raidEndsAt);
    updateHpBar(raidData.monster_health, maxMonsterHealth);
    await loadMonsterForFloor(currentFloor);
    await refreshRanking();
    await loadAttempts();
    await loadPlayerCombatState();
    
    startPolling();
    startUISecondTicker();
    startRaidTimer();
    startBossChecker();
    startReviveTicker();
    startFloorMusic();
    openCombatModal();
}

async function loadMonsterForFloor(floor) {
  if (!floor) return;
  try {
    const { data, error } = await supabase.from("guild_raid_monsters").select("image_url, base_health, name").eq("floor", floor).single();
    if (!error && data) {
      const img = $id("raidMonsterImage");
      if (img) img.src = data.image_url;
      let monsterNameEl = $id("raidMonsterName");
      if (!monsterNameEl) {
        monsterNameEl = document.createElement("div");
        monsterNameEl.id = "raidMonsterName";
        monsterNameEl.style.cssText = "text-align: center; font-weight: bold; font-size: 1em; color: #fff; margin-top: -5px; text-shadow: 2px 2px 4px #000;";
        const monsterArea = $id("raidMonsterArea");
        if (monsterArea) {
          monsterArea.insertBefore(monsterNameEl, monsterArea.firstChild);
        }
      }
      monsterNameEl.textContent = data.name || "Monstro";
      if (data.base_health) maxMonsterHealth = Number(data.base_health);
    }
  } catch (e) {
    console.error("loadMonsterForFloor", e);
  }
}

async function refreshRanking() {
  if (!currentRaidId) return;
  try {
    const { data } = await supabase.from("guild_raid_damage").select("player_id, damage, players(name)").eq("raid_id", currentRaidId).order("damage", { ascending: false });
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
    const { data, error } = await supabase.from("guild_raid_attempts").select("attempts_left, last_attack_at").eq("raid_id", currentRaidId).eq("player_id", userId).single();
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
  if (Number(attacksLeft || 0) > MAX_ATTACKS) {
    return { shownAttacks: Number(attacksLeft || 0), secondsToNext: 0 };
  }
  let shown = Math.min(MAX_ATTACKS, Number(attacksLeft || 0) + recovered);
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
  cooldownEl.textContent = secondsToNext > 0 ? `+ 1 em ${formatTime(secondsToNext)}` : "";
  const playerDead = isPlayerDeadLocal();
  if (playerDead || isProcessingAction) { 
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
  if (!shouldRefresh) return;
  refreshAttemptsPending = true;
  try {
    const { data } = await supabase.rpc("refresh_guild_raid_attempts", { p_raid_id: currentRaidId, p_player_id: userId });
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

// PONTO 1: Lógica de ataque e morte do monstro corrigida
async function performAttack() {
    if (!currentRaidId || !userId || isProcessingAction) return;
    if (isPlayerDeadLocal()) {
        alert("Você está morto. Aguarde reviver.");
        return;
    }
    const { shownAttacks } = computeShownAttacksAndRemaining();
    if (shownAttacks <= 0) {
        await refreshAttemptsServerSideOnceIfNeeded();
        if (computeShownAttacksAndRemaining().shownAttacks <= 0) {
            alert("Sem ataques. Aguarde regeneração.");
            return;
        }
    }
    const attackBtn = $id("raidAttackBtn");
    if (attackBtn) attackBtn.style.pointerEvents = "none";
    try {
        const { data: payload, error } = await supabase.rpc("perform_raid_attack", { p_raid_id: currentRaidId, p_player_id: userId });
        if (error || !payload?.success) {
            alert(error?.message || payload?.message || "Ataque não realizado");
            await loadAttempts();
            return;
        }
        if (payload.attacks_left !== null) attacksLeft = Number(payload.attacks_left);
        lastAttackAt = payload.last_attack_at ? new Date(payload.last_attack_at) : (attacksLeft < MAX_ATTACKS ? new Date() : null);
        updateAttackUI();
        displayFloatingDamageOver($id("raidMonsterArea"), payload.damage_dealt ?? 0, payload.is_crit === true);
        playHitSound(payload.is_crit === true);
        await refreshRanking();
        if (payload.monster_health !== null) updateHpBar(payload.monster_health, payload.max_monster_health || maxMonsterHealth);
        
        // Se o monstro morreu
        if (payload.monster_health !== null && Number(payload.monster_health) <= 0) {
            const floorDefeated = currentFloor; // Guarda o andar que acabou de ser derrotado
            const wasBoss = floorDefeated % 5 === 0;
            const rewardCallback = () => {
                showRewardModal(payload.xp_reward, payload.crystals_reward, () => {
                    setTimeout(() => loadRaid().catch(()=>{}), 200);
                }, undefined, payload.items_dropped);
            };

            if (wasBoss) {
                // Se era um chefe, toca o vídeo de morte e depois mostra a recompensa
                queueAction(() => playVideo(BOSS_DEATH_VIDEO_URL, rewardCallback));
            } else {
                // Se era um monstro normal, apenas mostra a recompensa e carrega o próximo
                rewardCallback();
            }
            return; // Encerra a função aqui
        }
    } catch (e) {
        console.error("performAttack erro:", e);
    } finally {
        if (attackBtn) attackBtn.style.pointerEvents = "";
        updateAttackUI(); 
    }
}

function showRewardModal(xp, crystals, onOk, rewardId, itemsDropped) {
  const xpEl = $id("rewardXpText");
  const crEl = $id("rewardCrystalsText");
  const modal = $id("raidRewardModal");
  const okBtn = $id("rewardOkBtn");
  if (!modal) {
    if (onOk) onOk();
    return;
  }
  if (xpEl) {
    xpEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px; justify-content: center; text-align: center;"><img src="https://aden-rpg.pages.dev/assets/exp.webp" alt="XP" style="width:70px;height:70px;object-fit:contain;"> x <span style="font-weight:bold; font-size: 1.3em;">${Number(xp || 0).toLocaleString()}</span></div>`;
  }
  if (crEl) {
    crEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px; justify-content: center; text-align: center;"><img src="https://aden-rpg.pages.dev/assets/cristais.webp" alt="Cristais" style="width:70px;height:70px;object-fit:contain;"> x <span style="font-weight:bold; font-size: 1.3em;">${Number(crystals || 0).toLocaleString()}</span></div>`;
  }
  const itemsContainerId = "rewardItemsContainer";
  let itemsContainer = $id(itemsContainerId);
  if (!itemsContainer) {
    itemsContainer = document.createElement("div");
    itemsContainer.id = itemsContainerId;
    itemsContainer.style.cssText = "margin-top: 8px; display: none; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto;";
    if (okBtn?.parentNode) {
      okBtn.parentNode.insertBefore(itemsContainer, okBtn);
    } else {
      modal.appendChild(itemsContainer);
    }
  }
  itemsContainer.innerHTML = "";
  let itemsArray = itemsDropped;
  try {
    if (typeof itemsDropped === "string") itemsArray = JSON.parse(itemsDropped);
    if (!Array.isArray(itemsArray)) itemsArray = [];
  } catch (e) {
    itemsArray = [];
  }
  if (Array.isArray(itemsArray) && itemsArray.length > 0) {
    itemsContainer.style.display = "block";
    const ul = document.createElement("ul");
    ul.style.cssText = "list-style: none; padding: 0; margin: 6px 0 0 0;";
    itemsArray.forEach(it => {
      const li = document.createElement("li");
      li.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 6px 0;";
      const img = document.createElement("img");
      img.src = "https://aden-rpg.pages.dev/assets/itens/placeholder.webp";
      img.style.cssText = "width: 70px; height: 70px; object-fit: contain;";
      img.alt = `Item ${it.item_id}`;
      const span = document.createElement("span");
      span.style.fontWeight = "bold";
      span.textContent = `x ${it.quantity}`;
      li.appendChild(img);
      li.appendChild(span);
      ul.appendChild(li);
    });
    itemsContainer.appendChild(ul);
    try {
      const ids = itemsArray.map(i => i.item_id);
      supabase.from('items').select('item_id, display_name, name').in('item_id', ids).then(res => {
        if (!res.error && Array.isArray(res.data) && res.data.length > 0) {
          const map = {};
          res.data.forEach(r => { map[r.item_id] = { name: r.name, display_name: r.display_name || r.name || (`#${r.item_id}`) }; });
          const lis = ul.querySelectorAll('li');
          itemsArray.forEach((it, idx) => {
            const entry = map[it.item_id];
            const li = lis[idx];
            if (!li) return;
            const img = li.querySelector('img');
            const imageUrl = entry?.name ? `https://aden-rpg.pages.dev/assets/itens/${entry.name}.webp` : "https://aden-rpg.pages.dev/assets/itens/placeholder.webp";
            if (img) img.src = imageUrl;
          });
        }
      });
    } catch(e) { console.warn('Erro ao processar itemsDropped:', e); }
  } else {
    itemsContainer.style.display = "none";
  }
  modal.style.display = "flex";
  if (okBtn) {
    okBtn.onclick = async () => {
      modal.style.display = "none";
      try {
        if (rewardId) {
          await supabase.from("guild_raid_rewards").update({ claimed: true, claimed_at: new Date().toISOString() }).eq("id", rewardId);
        } else if (currentRaidId && userId) {
          await supabase.from("guild_raid_rewards").update({ claimed: true, claimed_at: new Date().toISOString() }).eq("raid_id", currentRaidId).eq("player_id", userId).eq("claimed", false);
        }
      } catch (e) {
        console.error("Erro ao marcar reward como claimed:", e);
      }
      if (onOk) onOk();
    };
  }
}

async function tryBossAttackForPlayer() {
  if (!currentRaidId || !userId || isProcessingAction) return;
  if ((currentFloor % 5) !== 0) return;
  try {
    const { data: payload, error } = await supabase.rpc("guild_raid_boss_attack", { p_raid_id: currentRaidId, p_player_id: userId });
    if (error || !payload?.success) return;
    if (payload.action === "attacked") {
      const randomAttackVideo = BOSS_ATTACK_VIDEO_URLS[Math.floor(Math.random() * BOSS_ATTACK_VIDEO_URLS.length)];
      queueAction(() => {
        playVideo(randomAttackVideo, () => {
          displayFloatingDamageOver($id("raidPlayerArea"), payload.damage || 0, false);
          _playerReviveUntil = payload.player_revive_until || null;
          updatePlayerHpUi(payload.player_new_hp ?? 0, payload.player_max_health ?? 1);
          if (_playerReviveUntil && new Date(_playerReviveUntil) > new Date()) {
            setPlayerReviveOverlayText(Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000));
          }
          updateAttackUI();
        });
      });
    } else if (payload.action === "evaded") {
      displayFloatingDamageOver($id("raidPlayerArea"), "Desviou", false);
    }
  } catch (e) {
    console.error("tryBossAttackForPlayer", e);
  }
}

function startBossChecker() {
  stopBossChecker();
  if (currentFloor % 5 === 0) {
    bossCheckInterval = setInterval(() => {
      tryBossAttackForPlayer().catch(()=>{});
    }, BOSS_CHECK_MS);
  }
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

async function refreshRaidState() {
  if (!currentRaidId || isProcessingAction) return;
  try {
    await supabase.rpc("tick_raid_boss_attack");
    await supabase.rpc('end_expired_raid', { p_raid_id: currentRaidId });
    const { data, error } = await supabase.from("guild_raids").select("*").eq("id", currentRaidId).single();
    if (error || !data || !data.active) {
      closeCombatModal();
      alert("A Raid terminou.");
      return;
    }
    if (data.current_floor !== currentFloor) {
      await loadRaid();
    } else {
      setRaidTitleFloorAndTimer(data.current_floor || 1, data.ends_at);
      updateHpBar(data.monster_health, data.initial_monster_health || maxMonsterHealth);
      startBossChecker(); 
    }
  } catch (e) {
    console.error("refreshRaidState", e);
  }
}

async function checkPendingRaidRewards() {
  if (!currentRaidId || !userId) return;
  try {
    const { data, error } = await supabase.from("guild_raid_rewards").select("id, xp, crystals, items_dropped").eq("raid_id", currentRaidId).eq("player_id", userId).eq("claimed", false).order("created_at", { ascending: true });
    if (error) {
      console.warn("checkPendingRaidRewards error", error);
      return;
    }
    for (const reward of (data || [])) {
      if (shownRewardIds.has(reward.id)) continue;
      shownRewardIds.add(reward.id);
      await new Promise(resolve => {
        showRewardModal(reward.xp, reward.crystals, async () => {
          await loadRaid().catch(()=>{});
          resolve();
        }, reward.id, reward.items_dropped);
      });
    }
  } catch (e) { console.error("checkPendingRaidRewards", e); }
}

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
    if (computeShownAttacksAndRemaining().secondsToNext === 0 && computeShownAttacksAndRemaining().shownAttacks > attacksLeft) {
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
      refreshRaidState(); 
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
  stopAllFloorMusic();
  actionQueue = [];
  isProcessingAction = false;
}

function openRaidModal() { const m = $id("raidModal"); if (m) m.style.display = "flex"; }
function closeRaidModal(){ const m = $id("raidModal"); if (m) m.style.display = "none"; }
function openCombatModal(){ const m = $id("raidCombatModal"); if (m) m.style.display = "flex"; }

function bindEvents() {
  $id("tdd")?.addEventListener("click", async () => {
      if (!userGuildId) return;
      const { data: activeRaid } = await supabase.from("guild_raids").select("id").eq("guild_id", userGuildId).eq("active", true).limit(1).single();
      if (activeRaid) {
          await loadRaid();
      } else {
          // ... (código de resultado da última raid) ...
          openRaidModal();
      }
  });

  $id("startRaidBtn")?.addEventListener("click", async () => {
    if (userRank !== "leader" && userRank !== "co-leader") { alert("Apenas líder/co-líder"); return; }
    const startBtn = $id("startRaidBtn");
    startBtn.disabled = true;
    try {
        const { error } = await supabase.rpc("start_guild_raid", { p_guild_id: userGuildId, p_player_id: userId, p_name: "Torre da Desolação" });
        if (error) {
            alert(error.message || "Erro ao iniciar raid");
            return;
        }
        closeRaidModal();
        // PONTO 3: Enfileira o vídeo de introdução da raid
        queueAction(() => {
            playVideo(RAID_INTRO_VIDEO_URL, () => {
                loadRaid(); // Carrega a raid após o vídeo
            });
        });
    } catch(e) {
      console.error("startRaid", e);
      alert("Erro ao iniciar raid");
    } finally {
      startBtn.disabled = false;
    }
  });

  $id("raidAttackBtn")?.addEventListener("click", async (e) => {
    try { unlockMedia(); } catch(e) { console.warn('unlockMedia error', e); }
    try { startFloorMusic(); } catch(e) { console.warn('startFloorMusic error', e); }
    try { await performAttack(); } catch(err) { console.error('performAttack error', err); }
});
  // ... outros listeners ...
  $id("cancelRaidBtn")?.addEventListener("click", closeRaidModal);
  $id("raidBackBtn")?.addEventListener("click", () => closeCombatModal());
}

async function mainInit() {
  createMediaPlayers();
  // PONTO 2: Adiciona o ouvinte global para desbloquear a mídia
  document.addEventListener("click", unlockMedia, { once: true });
  await initSession();
  bindEvents();
  await loadRaid();
}

document.addEventListener("DOMContentLoaded", mainInit);


// 
// --- Compra de ataques Raid ---
let raidBuyQty = 1;
let raidBuyPlayerGold = 0;
let raidBuyBaseBoughtCount = 0;

function calcRaidTotalCost(qty, baseCount) {
  let total = 0;
  for (let i = 0; i < qty; i++) {
    const cost = 10 + (Math.floor((baseCount + i) / 5) * 5);
    total += cost;
  }
  return total;
}

function refreshRaidBuyModalUI() {
  const buyModal = $id("buyModal");
  if (!buyModal) return;
  const qtyEl = $id("buyAttackQty");
  const costEl = $id("buyAttackCostInfo");
  const goldEl = $id("buyPlayerGoldInfo");
  const confirmBtn = $id("buyConfirmBtn");
  if (qtyEl) qtyEl.textContent = String(raidBuyQty);
  const total = calcRaidTotalCost(raidBuyQty, raidBuyBaseBoughtCount);
  if (costEl) costEl.innerHTML = `Custo total:<br><img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:30px;height:27px;vertical-align:-4px"><strong> ${total}</strong>`;
  if (goldEl) goldEl.innerHTML = `Você tem:<br><img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:30px;height:27px;vertical-align:-4px"><strong> ${Number(raidBuyPlayerGold || 0).toLocaleString()}</strong>`;
  if (confirmBtn) confirmBtn.disabled = (total > (raidBuyPlayerGold || 0));
}

async function openRaidBuyModal() {
  if (!userId) { alert("Faça login para comprar."); return; }
  try {
    const { data: player, error } = await supabase.from("players").select("gold, raid_attacks_bought_count, raid_last_attack_time").eq("id", userId).single();
    if (error) { console.error("openRaidBuyModal", error); alert("Erro ao abrir modal de compra."); return; }
    raidBuyPlayerGold = player.gold || 0;
    const lastDate = player.raid_last_attack_time ? new Date(player.raid_last_attack_time).toDateString() : null;
    raidBuyBaseBoughtCount = (lastDate === new Date().toDateString()) ? (player.raid_attacks_bought_count || 0) : 0;
    raidBuyQty = 1;
    refreshRaidBuyModalUI();
    const buyModal = $id("buyModal");
    if (buyModal) buyModal.style.display = "flex";
  } catch (e) {
    console.error("[raid] openRaidBuyModal erro:", e);
    alert("Erro ao abrir modal de compra.");
  }
}

function closeRaidBuyModal() { const m = $id("buyModal"); if (m) m.style.display = "none"; }

document.addEventListener("DOMContentLoaded", () => {
  try {
    const launchBtn = $id("raidBuyAttackBtn");
    if (launchBtn) launchBtn.addEventListener("click", openRaidBuyModal);
    const inc = $id("buyIncreaseQtyBtn");
    if (inc) inc.addEventListener("click", () => { raidBuyQty++; refreshRaidBuyModalUI(); });
    const dec = $id("buyDecreaseQtyBtn");
    if (dec) dec.addEventListener("click", () => { if (raidBuyQty > 1) raidBuyQty--; refreshRaidBuyModalUI(); });
    const cancel = $id("buyCancelBtn");
    if (cancel) cancel.addEventListener("click", closeRaidBuyModal);
    const confirm = $id("buyConfirmBtn");
    if (confirm) confirm.addEventListener("click", async () => {
      closeRaidBuyModal();
      let purchased = 0;
      let spent = 0;
      try {
        for (let i = 0; i < raidBuyQty; i++) {
          const { data, error } = await supabase.rpc("buy_raid_attack", { p_player_id: userId });
          if (error || !(data && (data.success === true || data.success === 't'))) {
            if (purchased === 0) alert(error?.message || (data && data.message) || "Compra não pôde ser concluída.");
            break;
          }
          const payload = Array.isArray(data) ? data[0] : data;
          purchased++;
          spent += (payload.cost || 0);
          raidBuyPlayerGold = Math.max(0, (raidBuyPlayerGold || 0) - (payload.cost || 0));
        }
        if (purchased > 0) {
          alert(`Comprado(s) ${purchased} ataque(s) por ${spent} Ouro.`);
          if (typeof loadAttempts === 'function') await loadAttempts();
        }
      } catch (e) {
        console.error("[raid] buyConfirm erro:", e);
        alert("Erro inesperado na compra.");
      }
    });
  } catch (e) {
    console.error("[raid] buy modal attach erro", e);
  }
});
