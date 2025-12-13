console.log("guild_raid.js (v9.0) - Zero Egress + Batch Sync + Otimista");

const SUPABASE_URL = "https://lqzlblvmkuwedcofmgfb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAX_ATTACKS = 3;
const ATTACK_COOLDOWN_SECONDS = 60;
const RAID_POLL_MS = 20000; // Polling mantido para checar estado dos outros
const SECONDARY_POLL_MS = 80000;
const REVIVE_CHECK_MS = 10000;
const AMBIENT_AUDIO_INTERVAL_MS = 60 * 1000;
const BOSS_ATTACK_INTERVAL_SECONDS = 30;

// Configurações Batch / Otimista
const BATCH_THRESHOLD = 3; // Envia ao servidor a cada 3 ataques acumulados
const BATCH_DEBOUNCE_MS = 60000; // Ou após 3 segundos sem clicar

// URLs de Mídia
const RAID_INTRO_VIDEO_URL = "https://aden-rpg.pages.dev/assets/tddintro.webm";
const BOSS_INTRO_VIDEO_URL = "https://aden-rpg.pages.dev/assets/tddbossintro.webm";
const BOSS_DEATH_VIDEO_URL = "https://aden-rpg.pages.dev/assets/tddbossoutro.webm";
const BOSS_ATTACK_VIDEO_URLS = [
    "https://aden-rpg.pages.dev/assets/tddbossatk01.webm", "https://aden-rpg.pages.dev/assets/tddbossatk02.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk03.webm", "https://aden-rpg.pages.dev/assets/tddbossatk04.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk05.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk06.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk07.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk08.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk09.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk10.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk11.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk12.webm",
    "https://aden-rpg.pages.dev/assets/tddbossatk13.webm"
];
const AMBIENT_AUDIO_URLS = [
    "https://aden-rpg.pages.dev/assets/tddboss01.mp3", "https://aden-rpg.pages.dev/assets/tddboss02.mp3", "https://aden-rpg.pages.dev/assets/tddboss03.mp3", "https://aden-rpg.pages.dev/assets/tddboss04.mp3", "https://aden-rpg.pages.dev/assets/tddboss05.mp3", "https://aden-rpg.pages.dev/assets/tddboss06.mp3", "https://aden-rpg.pages.dev/assets/tddboss07.mp3", "https://aden-rpg.pages.dev/assets/tddboss08.mp3", "https://aden-rpg.pages.dev/assets/tddboss09.mp3", "https://aden-rpg.pages.dev/assets/tddboss10.mp3", "https://aden-rpg.pages.dev/assets/tddboss11.mp3", "https://aden-rpg.pages.dev/assets/tddboss12.mp3", "https://aden-rpg.pages.dev/assets/tddboss13.mp3", "https://aden-rpg.pages.dev/assets/tddboss14.mp3", "https://aden-rpg.pages.dev/assets/tddboss15.mp3"
];
const BOSS_MUSIC_URL = "https://aden-rpg.pages.dev/assets/desolation_tower.mp3";

// Variáveis de estado
let userId = null, userGuildId = null, userRank = "member", userName = null;
let currentRaidId = null, currentFloor = 1, maxMonsterHealth = 1, playerMaxHealth = 1;
let attacksLeft = 0, lastAttackAt = null, raidEndsAt = null;
let pollInterval = null, secondaryPollInterval = null, uiSecondInterval = null, raidTimerInterval = null, reviveTickerInterval = null, reviveUITickerInterval = null, countdownInterval = null;
let refreshAttemptsPending = false;
let shownRewardIds = new Set(); 
let playerRankInfo = { rank: null, damage: 0 };

// --- Variáveis de estado para notificação de morte ---
let deathNotificationQueue = [];
let isDisplayingDeathNotification = false;
let processedDeathTimestamps = new Set(); 

// --- Variáveis para o ataque visual do chefe ---
let visualBossAttackInterval = null;
let nextBossAttackAt = null;

// --- STATE OTIMISTA & BATCH ---
let playerStatsCache = null; // { min_attack, attack, crit_chance, crit_damage }
let pendingAttacksQueue = 0; // Quantos ataques estão na fila
let batchSyncTimer = null; // Timer do debounce
let localDamageDealtInBatch = 0; // Dano acumulado visualmente
let isBatchSyncing = false; // Flag para evitar duplicação

// Sistema de Fila de Ações e Controle de Mídia
let actionQueue = [];
let isProcessingAction = false;
let isMediaUnlocked = false;
let ambientAudioInterval = null;
let ambientAudioPlayer = null; 
let bossMusicPlayer = null;
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Áudio de Efeitos
const audioNormal = new Audio("https://aden-rpg.pages.dev/assets/normal_hit.mp3");
const audioCrit = new Audio("https://aden-rpg.pages.dev/assets/critical_hit.mp3");
audioNormal.volume = 0.5;
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

function showRaidAlert(message) {
  const modal = $id("raidAlertModal");
  const msgEl = $id("raidAlertMessage");
  const okBtn = $id("raidAlertOkBtn");

  if (!modal || !msgEl || !okBtn) {
    console.warn("Modal de alerta não encontrado.");
    return;
  }

  msgEl.innerHTML = message;
  modal.style.display = "flex";

  okBtn.onclick = () => {
    modal.style.display = "none";
  };
}

// --- Funções de Persistência Batch ---
function saveBatchState() {
    if (!currentRaidId) return;
    const data = {
        queue: pendingAttacksQueue,
        dmg: localDamageDealtInBatch,
        raidId: currentRaidId,
        ts: Date.now()
    };
    localStorage.setItem('raid_batch_state', JSON.stringify(data));
}

function loadBatchState() {
    try {
        const raw = localStorage.getItem('raid_batch_state');
        if (!raw) return;
        const data = JSON.parse(raw);
        // Recupera apenas se for da mesma raid e recente (10 min)
        if (data.raidId === currentRaidId && (Date.now() - data.ts < 600000)) {
            pendingAttacksQueue = data.queue || 0;
            localDamageDealtInBatch = data.dmg || 0;
            if (pendingAttacksQueue > 0) {
                 // Tenta sincronizar logo se houver pendências
                 triggerBatchSync(); 
            }
        } else {
            // Limpa dados velhos
            localStorage.removeItem('raid_batch_state');
        }
    } catch(e) {}
}

// --- Cache de Stats do Jogador ---
async function cachePlayerStats() {
    if (playerStatsCache) return; // Já carregado
    if (!userId) return;
    try {
        const { data, error } = await supabase.rpc("get_player_details_for_raid", { p_player_id: userId });
        if (data && !error) {
            playerStatsCache = {
                min_attack: Number(data.min_attack || 0),
                attack: Number(data.attack || 0),
                crit_chance: Number(data.crit_chance || 0),
                crit_damage: Number(data.crit_damage || 0)
            };
            console.log("Stats cacheados:", playerStatsCache);
        }
    } catch(e) { console.warn("Erro ao cachear stats:", e); }
}


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
        video.style.cssText = 'width: 100%; height: 100%; background: none; object-fit: cover; visibility: hidden;';
        video.setAttribute('playsinline', '');
        video.setAttribute('preload', 'auto');
        overlay.appendChild(video);
        document.body.appendChild(overlay);
    }
    if (!ambientAudioPlayer) {
        ambientAudioPlayer = new Audio();
        ambientAudioPlayer.volume = 0.5;
    }
    if (!bossMusicPlayer) {
        bossMusicPlayer = new Audio(BOSS_MUSIC_URL);
        bossMusicPlayer.volume = 0.06;
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

    videoPlayer.style.visibility = 'hidden';
    videoPlayer.src = src;
    videoPlayer.load(); 

    videoOverlay.style.display = 'flex';

    const onCanPlay = () => {
        videoPlayer.style.visibility = 'visible';
        const playPromise = videoPlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.warn("Autoplay bloqueado, tentando com som desativado.", error);
                videoPlayer.muted = true;
                videoPlayer.play();
            });
        }
    };
    
    videoPlayer.addEventListener('canplay', onCanPlay, { once: true });

    const endPlayback = () => {
        videoPlayer.removeEventListener('ended', endPlayback);
        videoPlayer.pause();
        videoPlayer.currentTime = 0;
        videoOverlay.style.display = 'none';
        if (onVideoEndCallback) onVideoEndCallback();
        isProcessingAction = false;
        processNextAction();
    };
    videoPlayer.addEventListener('ended', endPlayback, { once: true });
}

function unlockMedia() {
    if (isMediaUnlocked) return;
    
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(e => console.warn("AudioContext resume falhou", e));
    }

    const videoPlayer = $id('raidVideoPlayer');
    if (videoPlayer) {
        videoPlayer.muted = false;
    }
    
    const audiosToUnlock = [audioNormal, audioCrit, ambientAudioPlayer, bossMusicPlayer];
    audiosToUnlock.forEach(audio => {
        if (audio && audio.paused) {
            audio.play().then(() => audio.pause()).catch(() => {});
        }
    });
    
    isMediaUnlocked = true;
    console.log("Mídia desbloqueada pela interação do usuário.");
}

function primeMedia() {
    console.log("Preparando mídia para autoplay...");
    unlockMedia(); 
    const videoPlayer = $id('raidVideoPlayer');
    if (videoPlayer) {
        videoPlayer.src = RAID_INTRO_VIDEO_URL; 
        videoPlayer.load();
        videoPlayer.muted = true; 
        const playPromise = videoPlayer.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    videoPlayer.pause();
                    console.log("Mídia preparada com sucesso.");
                    if(isMediaUnlocked) videoPlayer.muted = false;
                })
                .catch(err => {
                    console.warn("Falha ao preparar a mídia. A reprodução pode ser silenciosa.", err);
                });
        }
    }
}


function playRandomAmbientAudio() {
    if (!isMediaUnlocked || isProcessingAction || document.visibilityState !== 'visible') return;
    const audioSrc = AMBIENT_AUDIO_URLS[Math.floor(Math.random() * AMBIENT_AUDIO_URLS.length)];
    ambientAudioPlayer.src = audioSrc;
    ambientAudioPlayer.play().catch(e => console.warn("Falha no play do áudio ambiente:", e));
}

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
    if (!isMediaUnlocked) return;

    if (currentFloor % 5 === 0) {
        if (ambientAudioInterval) {
            clearInterval(ambientAudioInterval);
            ambientAudioInterval = null;
        }
        if (bossMusicPlayer && bossMusicPlayer.paused) {
            bossMusicPlayer.play().catch(e => console.warn("Falha no play da música do chefe:", e));
        }
    } else {
        if (bossMusicPlayer && !bossMusicPlayer.paused) {
            bossMusicPlayer.pause();
        }
        if (!ambientAudioInterval) {
            try { playRandomAmbientAudio(); } catch(e) { console.warn("Falha no ambient inicial", e); }
            ambientAudioInterval = setInterval(playRandomAmbientAudio, AMBIENT_AUDIO_INTERVAL_MS);
        }
    }
}

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

function ensurePlayerRankUi() {
    let rankEl = $id("raidPlayerRankInfo");
    if (rankEl) return;

    const container = $id("raidDamageRankingContainer");
    if (!container) return;
    
    rankEl = document.createElement("div");
    rankEl.id = "raidPlayerRankInfo";
    rankEl.style.cssText = "text-align: center; margin-top: 10px; margin-bottom: 10px; padding: 5px; background-color: rgba(0, 0, 0, 0.2); border-radius: 5px; font-size: 0.9em;";
    
    const title = document.createElement("strong");
    title.textContent = "Sua Posição";
    
    const details = document.createElement("div");
    details.id = "raidPlayerRankDetails";
    details.textContent = "Ataque para atualizar...";

    rankEl.appendChild(title);
    rankEl.appendChild(details);

    container.insertBefore(rankEl, container.firstChild);
}

function updatePlayerRankUi(rank, totalDamage) {
    ensurePlayerRankUi();
    const detailsEl = $id("raidPlayerRankDetails");
    if (!detailsEl) return;

    if (rank && totalDamage > 0) {
        playerRankInfo = { rank, damage: totalDamage };
        detailsEl.innerHTML = `
            <span style="color: #ffc107;">#${rank}</span> com 
            <span style="color: #ffdddd;">${totalDamage.toLocaleString()}</span> de dano
        `;
    } else {
        detailsEl.textContent = "Você ainda não causou dano.";
    }
}

function updatePlayerHpUi(cur, max) {
  ensurePlayerHpUi();
  const fill = $id("raidPlayerHpFill");
  const text = $id("raidPlayerHpText");
  const avatar = $id("raidPlayerAvatar");
  const overlay = $id("raidPlayerReviveOverlay");
  const c = Math.max(0, Number(cur === null ? max : cur));
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

function createDeathNotificationUI() {
    if ($id('raidDeathNotification')) return;

    const banner = document.createElement('div');
    banner.id = 'raidDeathNotification';

    const style = document.createElement('style');
    style.textContent = `
        #raidDeathNotification {
            position: fixed;
            top: 10px;
            transform: translateX(100%);
            right: 0;
            background-color: rgb(0, 0, 255);
            color: white;
            padding: 10px 20px;
            border-radius: 5px 0 0 5px;
            z-index: 25000;
            font-weight: bold;
            white-space: nowrap;
            text-shadow: 1px 1px 2px #000;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
            opacity: 0;
            transition: opacity 0.3s;
        }
        #raidDeathNotification.show {
            opacity: 1;
            animation: slideAcrossContinuous 15s linear forwards;
        }
        @keyframes slideAcrossContinuous {
            0% {
                transform: translateX(100%);
            }
            100% {
                transform: translateX(calc(-100% - 1%));
            }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(banner);
}

function displayDeathNotification(playerName) {
    const banner = $id('raidDeathNotification');
    if (!banner) return;

    const monsterNameEl = $id("raidMonsterName");
    const bossName = monsterNameEl ? monsterNameEl.textContent : "Imperador Veinur";

    banner.innerHTML = `<span style="color: yellow;">${playerName}</span> foi derrotado(a) pelo <span style="color: lightgreen;">${bossName}</span>!`;
    banner.classList.add('show');

    const onAnimationEnd = () => {
        banner.classList.remove('show');
        banner.removeEventListener('animationend', onAnimationEnd);
        isDisplayingDeathNotification = false;
        setTimeout(() => processDeathNotificationQueue(), 200);
    };
    banner.addEventListener('animationend', onAnimationEnd, { once: true });
}

function processDeathNotificationQueue() {
    if (isDisplayingDeathNotification || deathNotificationQueue.length === 0) {
        return;
    }
    isDisplayingDeathNotification = true;
    const playerName = deathNotificationQueue.shift();
    displayDeathNotification(playerName);
}

async function checkOtherPlayerDeaths() {
    if (!currentRaidId) return;

    try {
        const { data: raidData, error: raidError } = await supabase
            .from('guild_raids')
            .select('recent_deaths')
            .eq('id', currentRaidId)
            .single();

        if (raidError || !raidData || !Array.isArray(raidData.recent_deaths)) {
            if(raidError) console.warn("Erro ao buscar mortes da raid:", raidError.message);
            return;
        }

        const newDeaths = raidData.recent_deaths.filter(death => !processedDeathTimestamps.has(death.timestamp));

        if (newDeaths.length === 0) {
            return;
        }

        newDeaths.forEach(death => processedDeathTimestamps.add(death.timestamp));
        
        const newPlayerIds = newDeaths.map(death => death.player_id);

        const { data: players, error: playersError } = await supabase
            .from('players')
            .select('id, name')
            .in('id', newPlayerIds);

        if (playersError) {
            console.warn("Erro ao buscar nomes dos jogadores:", playersError.message);
            return;
        }

        const playerNamesMap = new Map(players.map(p => [p.id, p.name]));
        
        newDeaths.forEach(death => {
            const name = playerNamesMap.get(death.player_id);
            if (name) {
                deathNotificationQueue.push(name);
            }
        });

        processDeathNotificationQueue();

    } catch (e) {
        console.error("Exceção em checkOtherPlayerDeaths:", e);
    }
}

// =======================================================================
// OTIMIZAÇÃO DE AUTH: Zero Egress + Cache Local de Dados
// =======================================================================

function getLocalUserId() {
    try {
        const cached = localStorage.getItem('player_data_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.data && parsed.data.id && parsed.expires > Date.now()) {
                return parsed.data.id;
            }
        }
    } catch (e) {}

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                const sessionStr = localStorage.getItem(k);
                const session = JSON.parse(sessionStr);
                if (session && session.user && session.user.id) {
                    return session.user.id;
                }
            }
        }
    } catch (e) {}
    return null;
}

function getLocalPlayerData() {
    try {
        const cached = localStorage.getItem('player_data_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.data && parsed.data.id && parsed.expires > Date.now()) {
                return parsed.data;
            }
        }
    } catch (e) {}
    return null;
}

async function initSession() {
  try {
    const cachedPlayer = getLocalPlayerData();
    if (cachedPlayer) {
        console.log("⚡ [Raid] Dados do jogador recuperados do cache.");
        userId = cachedPlayer.id;
        userName = cachedPlayer.name;
        userGuildId = cachedPlayer.guild_id;
        userRank = cachedPlayer.rank || "member";
        if (cachedPlayer.avatar_url) {
            const av = $id("raidPlayerAvatar");
            if (av) av.src = cachedPlayer.avatar_url;
        }
        return; 
    }

    let localId = getLocalUserId();
    
    if (!localId) {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
            localId = data.session.user.id;
        }
    }

    if (!localId) return; 

    userId = localId;

    const { data: player, error } = await supabase.from("players").select("name, guild_id, rank, avatar_url").eq("id", userId).single();
    if (!error && player) {
      userName = player.name;
      userGuildId = player.guild_id;
      userRank = player.rank || "member";
      if (player.avatar_url) {
        const av = $id("raidPlayerAvatar");
        if (av) av.src = player.avatar_url;
      }
    }
  } catch (e) { console.error("initSession", e); }
}

function clearCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
}

async function handleRaidCountdown(raidData) {
    clearCountdown();
    openCombatModal();
    ['raidHeader', 'raidMonsterArea', 'raidAttackBtn', 'raidDamageRankingContainer'].forEach(id => {
        const el = $id(id);
        if (el) el.style.display = 'none';
    });
    const attackPara = $id('raidPlayerAttacks')?.parentNode;
    if (attackPara) attackPara.style.display = 'none';
    const countdownContainer = $id('raidCountdownContainer');
    if (countdownContainer) countdownContainer.style.display = 'block';
    let starterName = 'O líder da guilda';
    try {
        const { data: logData, error } = await supabase.from('guild_logs').select('players(name)').eq('guild_id', raidData.guild_id).eq('action', 'start_guild_raid').order('created_at', { ascending: false }).limit(1).single();
        if (!error && logData?.players?.name) starterName = logData.players.name;
    } catch(e) {
        console.warn("Não foi possível buscar o nome de quem iniciou a raid.", e);
    }
    const msgEl = $id('raidCountdownMessage');
    if (msgEl) msgEl.innerHTML = `A Raid foi iniciada.<br>A Torre da Desolação começará em:`;
    const timerEl = $id('raidCountdownTimer');
    const startTime = new Date(raidData.starts_at);
    const updateTimer = () => {
        const diff = Math.max(0, Math.floor((startTime - new Date()) / 1000));
        const minutes = String(Math.floor(diff / 60)).padStart(2, '0');
        const seconds = String(diff % 60).padStart(2, '0');
        if (timerEl) timerEl.textContent = `${minutes}:${seconds}`;
        if (diff <= 0) {
            clearCountdown();
            if (countdownContainer) countdownContainer.style.display = 'none';
            queueAction(() => {
                playVideo(RAID_INTRO_VIDEO_URL, () => {
                    loadRaid(); 
                });
            });
        }
    };
    updateTimer();
    countdownInterval = setInterval(updateTimer, 1000);
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
        const now = new Date();
        const startTime = new Date(data.starts_at);
        if (now < startTime) {
            await handleRaidCountdown(data);
        } else {
            const isNewFloor = data.current_floor !== currentFloor;
            const isEnteringBossFloor = isNewFloor && (data.current_floor % 5 === 0);
            await continueLoadingRaid(data);
            if (isEnteringBossFloor) {
                queueAction(() => playVideo(BOSS_INTRO_VIDEO_URL));
            }
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
    $id('raidCountdownContainer').style.display = 'none';
    ['raidHeader', 'raidMonsterArea', 'raidAttackBtn', 'raidDamageRankingContainer'].forEach(id => {
        const el = $id(id);
        if (el) el.style.display = ''; 
    });
    const attackPara = $id('raidPlayerAttacks')?.parentNode;
    if (attackPara) attackPara.style.display = '';
    
    setRaidTitleFloorAndTimer(currentFloor, raidEndsAt);
    updateHpBar(raidData.monster_health, maxMonsterHealth);
    
    await loadMonsterForFloor(currentFloor);
    await loadAttempts();
    await loadInitialPlayerState();
    await cachePlayerStats(); // Cachear stats para o modo otimista
    loadBatchState(); // Recupera fila de batch se houver

    await refreshRanking();
    await checkPendingRaidRewards();

    deathNotificationQueue = [];
    isDisplayingDeathNotification = false;
    processedDeathTimestamps.clear(); 
    playerRankInfo = { rank: null, damage: 0 };
    updatePlayerRankUi(null, 0);

    startPolling();
    startSecondaryPolling();
    startUISecondTicker();
    startRaidTimer();
    startVisualBossAttackTicker(raidData.last_boss_attack_at);
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
    const { data } = await supabase.from("guild_raid_damage").select("player_id, damage, players(name)").eq("raid_id", currentRaidId).order("damage", { ascending: false }).limit(10);
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
  const { shownAttacks } = computeShownAttacksAndRemaining();
  
  // Deduz visualmente os ataques que estão na fila de envio
  const visualAttacksLeft = Math.max(0, shownAttacks - pendingAttacksQueue);

  attacksEl.textContent = `${visualAttacksLeft} / ${MAX_ATTACKS}`;
  
  // Cooldown continua baseado no último ataque real/oficial
  const { secondsToNext } = computeShownAttacksAndRemaining();
  cooldownEl.textContent = secondsToNext > 0 ? `+ 1 em ${formatTime(secondsToNext)}` : "";
  
  const playerDead = isPlayerDeadLocal();
  if (playerDead || isProcessingAction) { 
    attackBtn.style.pointerEvents = "none";
    attackBtn.style.filter = "grayscale(80%)";
  } else {
    attackBtn.style.pointerEvents = visualAttacksLeft > 0 ? "" : "none";
    attackBtn.style.filter = visualAttacksLeft > 0 ? "" : "grayscale(60%)";
  }
}

let _playerReviveUntil = null;
function isPlayerDeadLocal() {
  if (!_playerReviveUntil) return false;
  return new Date(_playerReviveUntil) > new Date();
}

async function loadInitialPlayerState() {
  if (!userId) return;
  try {
    const { data: playerDetails, error } = await supabase.rpc("get_player_details_for_raid", { p_player_id: userId });
    if (error || !playerDetails) {
        console.error("Erro ao carregar detalhes do jogador:", error);
        return;
    }
    playerMaxHealth = playerDetails.health || 1;
    
    updatePlayerHpUi(playerMaxHealth, playerMaxHealth);

    const av = $id("raidPlayerAvatar");
    const { data: pData } = await supabase.from("players").select("avatar_url").eq("id", userId).single();
    if (av && pData?.avatar_url) av.src = pData.avatar_url;

  } catch (e) {
    console.error("loadInitialPlayerState", e);
  }
}

async function refreshAttemptsServerSideOnceIfNeeded() {
  if (!currentRaidId || !userId || refreshAttemptsPending) return;
  // Com batching, a lógica de refresh é menos crítica, pois o cliente calcula.
  // Mas mantemos caso haja drift grande.
  const { shownAttacks } = computeShownAttacksAndRemaining();
  const shouldRefresh = (shownAttacks > attacksLeft);
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

// --- FUNÇÃO DE ATAQUE OTIMISTA (Substitui performAttack) ---
async function performAttackOptimistic() {
    if (!currentRaidId || !userId || isProcessingAction) return;
    if (isPlayerDeadLocal()) { showRaidAlert("Você está morto."); return; }
    
    // 1. Verificar Cooldown Local
    const { shownAttacks } = computeShownAttacksAndRemaining();
    const visualAttacksLeft = shownAttacks - pendingAttacksQueue; 

    if (visualAttacksLeft <= 0) {
        // Tenta um refresh de emergência
        await refreshAttemptsServerSideOnceIfNeeded();
        if ((computeShownAttacksAndRemaining().shownAttacks - pendingAttacksQueue) <= 0) {
            showRaidAlert("Sem ataques. Aguarde regeneração.");
            return;
        }
    }

    // 2. Calcular Dano Local (RNG JS)
    if (!playerStatsCache) await cachePlayerStats();
    
    const { min_attack, attack, crit_chance, crit_damage } = playerStatsCache || { min_attack: 1, attack: 5, crit_chance: 0, crit_damage: 0 };
    const isCrit = (Math.random() * 100) < crit_chance;
    let damage = Math.floor(Math.random() * ((attack - min_attack) + 1) + min_attack);
    if (isCrit) damage = Math.floor(damage * (1 + crit_damage / 100.0));
    damage = Math.max(1, damage);

    // 3. Atualizar UI Imediatamente (Feedback Instantâneo)
    displayFloatingDamageOver($id("raidMonsterArea"), damage, isCrit);
    playHitSound(isCrit);
    
    // Atualiza barra de vida do monstro localmente
    const currentMonsterHp = Number($id("raidMonsterHpText").textContent.split('/')[0].replace(/[^\d]/g, ''));
    const newVisualHp = Math.max(0, currentMonsterHp - damage);
    updateHpBar(newVisualHp, maxMonsterHealth);
    
    const monsterImg = $id("raidMonsterImage");
    if (monsterImg) {
        monsterImg.classList.add('shake-animation');
        setTimeout(() => monsterImg.classList.remove('shake-animation'), 300);
    }

    // 4. Adicionar à Fila de Sync
    pendingAttacksQueue++;
    localDamageDealtInBatch += damage;
    
    // Inicia cooldown visual se estava full
    if (attacksLeft >= MAX_ATTACKS && lastAttackAt === null) {
         lastAttackAt = new Date(); 
    }
    
    updateAttackUI(); 
    saveBatchState(); 

    // 5. Decisão de Sync
    if (batchSyncTimer) clearTimeout(batchSyncTimer);
    
    if (pendingAttacksQueue >= BATCH_THRESHOLD || newVisualHp <= 0) {
        triggerBatchSync();
    } else {
        batchSyncTimer = setTimeout(triggerBatchSync, BATCH_DEBOUNCE_MS);
    }
}

async function triggerBatchSync() {
    if (pendingAttacksQueue === 0 || isBatchSyncing) return;
    isBatchSyncing = true;

    const attacksToSend = pendingAttacksQueue;
    const expectedDamage = localDamageDealtInBatch; 

    // Limpa fila local PROVISORIAMENTE (Optimistic success)
    pendingAttacksQueue = 0;
    localDamageDealtInBatch = 0;
    saveBatchState(); 
    if (batchSyncTimer) clearTimeout(batchSyncTimer);

    // Atualiza UI para refletir fila vazia
    updateAttackUI();

    try {
        console.log(`[Sync] Enviando lote de ${attacksToSend} ataques...`);
        
        const { data, error } = await supabase.rpc("perform_raid_attack_batch", { 
            p_player_id: userId,
            p_raid_id: currentRaidId,
            p_attack_count: attacksToSend
        });

        if (error || !data.success) {
            throw new Error(error?.message || data?.message || "Erro no sync");
        }

        // --- RECONCILIAÇÃO ---
        updateHpBar(data.monster_health, data.max_monster_health);

        // Atualizar Tentativas Reais (Correção de Drift)
        attacksLeft = data.attacks_left;
        lastAttackAt = data.last_attack_at ? new Date(data.last_attack_at) : null;
        updateAttackUI();

        // Atualizar Rank e Dano Total
        updatePlayerRankUi(data.player_rank, data.new_total_damage);

        // Checar Morte (Recompensas)
        if (data.monster_health <= 0) {
             const floorDefeated = currentFloor; 
             const wasBoss = floorDefeated % 5 === 0;
             const rewardCallback = () => {
                showRewardModal(data.xp_reward, data.crystals_reward, () => {
                    setTimeout(() => loadRaid().catch(()=>{}), 200);
                }, undefined, data.items_dropped);
             };

             if (wasBoss) {
                queueAction(() => playVideo(BOSS_DEATH_VIDEO_URL, rewardCallback));
             } else {
                rewardCallback();
             }
        }

    } catch (e) {
        console.error("Falha no Sync Batch:", e);
        // Rollback: Devolve os ataques para a fila para tentar de novo
        pendingAttacksQueue += attacksToSend;
        localDamageDealtInBatch += expectedDamage;
        saveBatchState();
        updateAttackUI();
        // Tenta de novo em 5s
        batchSyncTimer = setTimeout(() => { isBatchSyncing = false; triggerBatchSync(); }, 5000);
        return; // Retorna aqui para não setar isBatchSyncing false abaixo
    }
    isBatchSyncing = false;
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

function getSimulatedBossDamage() {
    const baseDamage = Math.max(1, Math.floor(maxMonsterHealth * 0.02));
    return baseDamage;
}

function simulateLocalBossAttack() {
    if (isProcessingAction || isPlayerDeadLocal()) return;

    const randomAttackVideo = BOSS_ATTACK_VIDEO_URLS[Math.floor(Math.random() * BOSS_ATTACK_VIDEO_URLS.length)];
    queueAction(() => {
        playVideo(randomAttackVideo, () => {
            const visualDamage = getSimulatedBossDamage();
            displayFloatingDamageOver($id("raidPlayerArea"), visualDamage, false);
            
            const playerAvatar = $id("raidPlayerAvatar");
            if (playerAvatar) {
                playerAvatar.classList.add('shake-animation');
                setTimeout(() => playerAvatar.classList.remove('shake-animation'), 1000);
            }
        });
    });
}

function syncBossAttackTimer(lastAttackAtFromServer) {
    if (!lastAttackAtFromServer) {
        nextBossAttackAt = null; 
        return;
    }

    const now = new Date().getTime();
    const lastAttackTime = new Date(lastAttackAtFromServer).getTime();
    const intervalMs = BOSS_ATTACK_INTERVAL_SECONDS * 1000;

    const timeSinceLast = now - lastAttackTime;
    if (timeSinceLast < 0) {
        nextBossAttackAt = new Date(lastAttackTime + intervalMs);
        return;
    }

    const ticksPassed = Math.floor(timeSinceLast / intervalMs);
    const nextAttackTimestamp = lastAttackTime + (ticksPassed + 1) * intervalMs;
    nextBossAttackAt = new Date(nextAttackTimestamp);
}

function startVisualBossAttackTicker(lastAttackAtFromServer) {
    stopVisualBossAttackTicker();
    if (currentFloor % 5 !== 0) return;

    syncBossAttackTimer(lastAttackAtFromServer);

    visualBossAttackInterval = setInterval(() => {
        if (!nextBossAttackAt || isProcessingAction) return;

        if (new Date() >= nextBossAttackAt) {
            simulateLocalBossAttack();
            nextBossAttackAt = new Date(nextBossAttackAt.getTime() + (BOSS_ATTACK_INTERVAL_SECONDS * 1000));
        }
    }, 500);
}

function stopVisualBossAttackTicker() {
    if (visualBossAttackInterval) clearInterval(visualBossAttackInterval);
    visualBossAttackInterval = null;
    nextBossAttackAt = null;
}

function startReviveTicker() {
  stopReviveTicker();
  reviveTickerInterval = setInterval(async () => {
    if (!_playerReviveUntil) return;
    
    const remaining = (new Date(_playerReviveUntil) - new Date()) / 1000;
    
    if (remaining <= 0) {
      const { data: reviveResult, error } = await supabase.rpc("player_revive_if_needed", { p_player_id: userId });

      if (error) {
        console.error("Erro ao tentar reviver jogador:", error);
        await loadInitialPlayerState();
        return;
      }

      if (reviveResult && reviveResult.action === 'revived') {
        _playerReviveUntil = null;
        updatePlayerHpUi(reviveResult.new_health, reviveResult.new_health);
        updateAttackUI();
        
        stopReviveTicker();
        stopReviveUITicker();
      } else {
        const { data: state } = await supabase.rpc('get_raid_essential_state', { p_raid_id: currentRaidId, p_player_id: userId });
         if(state) _playerReviveUntil = state.revive_until;
      }
    }
  }, REVIVE_CHECK_MS);
}

function startReviveUITicker() {
    stopReviveUITicker();
    reviveUITickerInterval = setInterval(() => {
        if (!_playerReviveUntil) {
            setPlayerReviveOverlayText(0);
            stopReviveUITicker();
            return;
        }
        const remaining = Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000);
        setPlayerReviveOverlayText(Math.max(0, remaining));

    }, 1000);
}

function stopReviveTicker() {
  if (reviveTickerInterval) clearInterval(reviveTickerInterval);
  reviveTickerInterval = null;
}

function stopReviveUITicker() {
    if (reviveUITickerInterval) clearInterval(reviveUITickerInterval);
    reviveUITickerInterval = null;
    setPlayerReviveOverlayText(0);
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
        showRewardModal(reward.xp, reward.crystals, () => {
          resolve();
        }, reward.id, reward.items_dropped);
      });
    }
  } catch (e) { console.error("checkPendingRaidRewards", e); }
}
function clearGuildCache(guildId) {
    if (!guildId) return;
    try {
        localStorage.removeItem(`guild_info_${guildId}`);
        console.log(`[Raid] Cache da guilda ${guildId} limpo após fim da raid.`);
    } catch (e) { console.warn(e); }
}

function startPolling() {
  stopPolling();
  // Polling ajustado para 20s. 
  // Nota: A atualização do player agora acontece no triggerBatchSync,
  // mas o polling ainda é necessário para ver dano dos outros, morte de outros, 
  // ataques do boss em tempo real no servidor, etc.
  pollInterval = setInterval(async () => {
    if (!currentRaidId || !userId || isProcessingAction) return;

    const { data: state, error } = await supabase.rpc('get_raid_essential_state', {
      p_raid_id: currentRaidId,
      p_player_id: userId
    });

    if (error || !state || !state.success) {
      if (!state?.active) {
        clearGuildCache(userGuildId);
          closeCombatModal();
          showRaidAlert("A Raid terminou.");
      }
      return;
    }

    if (!state.active) {
      closeCombatModal();
      showRaidAlert("A Raid terminou.");
      return;
    }

    // Só atualiza HP visual se não estivermos "batendo" agora (evitar jitter)
    if (pendingAttacksQueue === 0) {
        updateHpBar(state.monster_health, state.initial_monster_health);
    }
    
    updatePlayerHpUi(state.player_health, playerMaxHealth);
    syncBossAttackTimer(state.last_boss_attack_at);

    _playerReviveUntil = state.revive_until;
    if (isPlayerDeadLocal()) {
      if (!reviveTickerInterval) startReviveTicker();
      if (!reviveUITickerInterval) startReviveUITicker();
    } else {
      if (reviveTickerInterval) stopReviveTicker();
      if (reviveUITickerInterval) stopReviveUITicker();
    }
  }, RAID_POLL_MS);
}

function startSecondaryPolling() {
    stopSecondaryPolling();
    secondaryPollInterval = setInterval(() => {
        if (!currentRaidId || isProcessingAction) return;
        refreshRanking().catch(e => console.warn("Falha ao atualizar ranking geral:", e));
        if (currentFloor % 5 === 0) {
            checkOtherPlayerDeaths().catch(e => console.warn("Falha ao checar mortes:", e));
        }
    }, SECONDARY_POLL_MS);
}

function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
}

function stopSecondaryPolling() {
    if (secondaryPollInterval) clearInterval(secondaryPollInterval);
    secondaryPollInterval = null;
}

function startUISecondTicker() {
  stopUISecondTicker();
  uiSecondInterval = setInterval(async () => {
    updateAttackUI();
    // Se o cliente acha que deve ter ataques mas o servidor ainda não confirmou,
    // podemos checar se o contador local já estourou o cooldown.
    const { shownAttacks, secondsToNext } = computeShownAttacksAndRemaining();
    // Se visualmente temos 0 e timer 0, mas attacksLeft é menor do que devia
    if (secondsToNext === 0 && shownAttacks > attacksLeft && pendingAttacksQueue === 0) {
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
      const m = $id("raidCombatModal");
      if(m && m.style.display !== 'none') {
        closeCombatModal();
        showRaidAlert("A Raid terminou.");
      }
      return;
    }
    setRaidTitleFloorAndTimer(currentFloor, raidEndsAt);
  }, 1000);
}

function clearRaidTimer() { if (raidTimerInterval) clearInterval(raidTimerInterval); raidTimerInterval = null; }

function closeCombatModal(){ 
  const m = $id("raidCombatModal"); 
  if (m) m.style.display = "none"; 

  const banner = $id('raidDeathNotification');
  if (banner) {
      banner.classList.remove('show');
      banner.style.animation = 'none';
      banner.offsetHeight;
      banner.style.animation = null; 
  }
  deathNotificationQueue = [];
  isDisplayingDeathNotification = false;
  processedDeathTimestamps.clear();

  // Garante que se fechar, tenta enviar o que sobrou
  if (pendingAttacksQueue > 0) triggerBatchSync();

  stopPolling(); 
  stopSecondaryPolling();
  stopUISecondTicker(); 
  clearRaidTimer(); 
  stopVisualBossAttackTicker();
  stopReviveTicker();
  stopReviveUITicker();
  stopAllFloorMusic();
  clearCountdown();
  actionQueue = [];
  isProcessingAction = false;
}

function openRaidModal() { const m = $id("raidModal"); if (m) m.style.display = "flex"; }
function closeRaidModal(){ const m = $id("raidModal"); if (m) m.style.display = "none"; }
function openCombatModal(){ const m = $id("raidCombatModal"); if (m) m.style.display = "flex"; }

function bindEvents() {
  const tdd = $id("tdd");
  if (tdd) {
    tdd.addEventListener("click", async () => {
      try { primeMedia(); } catch(e) { console.warn('Erro ao preparar mídia no clique do tdd', e); }

      if (!userGuildId) return;

      const { data: activeRaid } = await supabase
        .from("guild_raids")
        .select("id, current_floor")
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
  $id("closeLastResultBtn")?.addEventListener("click", () => { const m = $id("lastRaidResultModal"); if (m) m.style.display = "none"; });

  $id("startRaidBtn")?.addEventListener("click", async () => {
    try { primeMedia(); } catch(e) { console.warn('Erro ao preparar mídia no início da raid', e); }

    if (userRank !== "leader" && userRank !== "co-leader") { showRaidAlert("Apenas líder/co-líder"); return; }
    const startBtn = $id("startRaidBtn");
    startBtn.disabled = true;
    try {
        const { error } = await supabase.rpc("start_guild_raid", { p_guild_id: userGuildId, p_player_id: userId, p_name: "Torre da Desolação" });
        if (error) {
            showRaidAlert(error.message || "Erro ao iniciar raid");
            return;
        }
        closeRaidModal();
        await loadRaid();
    } catch(e) {
      console.error("startRaid", e);
      showRaidAlert("Erro ao iniciar raid");
    } finally {
      startBtn.disabled = false;
    }
  });

  // Alterado para chamar performAttackOptimistic
  $id("raidAttackBtn")?.addEventListener("click", async (e) => {
    try { unlockMedia(); } catch(e) { console.warn('unlockMedia error', e); }
    try { await performAttackOptimistic(); } catch(err) { console.error('performAttackOptimistic error', err); }
});

  $id("cancelRaidBtn")?.addEventListener("click", closeRaidModal);
  $id("raidBackBtn")?.addEventListener("click", () => closeCombatModal());
  
  // Salva batch ao sair da página
  window.addEventListener('beforeunload', () => {
      if (pendingAttacksQueue > 0) triggerBatchSync();
  });
}

async function mainInit() {
  createMediaPlayers();
  createDeathNotificationUI();
  await initSession();
  bindEvents();
  closeCombatModal();
}

document.addEventListener("DOMContentLoaded", mainInit);

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
  if (!userId) { showRaidAlert("Faça login para comprar."); return; }
  try {
    const { data: player, error } = await supabase.from("players").select("gold, raid_attacks_bought_count, raid_last_attack_time").eq("id", userId).single();
    if (error) { console.error("openRaidBuyModal", error); showRaidAlert("Erro ao abrir modal de compra."); return; }
    raidBuyPlayerGold = player.gold || 0;
    const lastDate = player.raid_last_attack_time ? new Date(player.raid_last_attack_time).toDateString() : null;
    raidBuyBaseBoughtCount = (lastDate === new Date().toDateString()) ? (player.raid_attacks_bought_count || 0) : 0;
    raidBuyQty = 1;
    refreshRaidBuyModalUI();
    const buyModal = $id("buyModal");
    if (buyModal) buyModal.style.display = "flex";
  } catch (e) {
    console.error("[raid] openRaidBuyModal erro:", e);
    showRaidAlert("Erro ao abrir modal de compra.");
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
            if (purchased === 0) showRaidAlert(error?.message || (data && data.message) || "Compra não pôde ser concluída.");
            break;
          }
          const payload = Array.isArray(data) ? data[0] : data;
          purchased++;
          spent += (payload.cost || 0);
          raidBuyPlayerGold = Math.max(0, (raidBuyPlayerGold || 0) - (payload.cost || 0));
        }
        if (purchased > 0) {
          showRaidAlert(`Comprado(s) ${purchased} ataque(s) por ${spent} Ouro.`);
          // Atualiza attacksLeft localmente ao comprar
          attacksLeft += purchased; 
          updateAttackUI();
          if (typeof loadAttempts === 'function') await loadAttempts();
        }
      } catch (e) {
        console.error("[raid] buyConfirm erro:", e);
        showRaidAlert("Erro inesperado na compra.");
      }
    });
  } catch (e) {
    console.error("[raid] buy modal attach erro", e);
  }
});


async function checkActiveRaidOnEntry() {
  try {
    let waited = 0;
    while (!userGuildId && waited < 3000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (!userGuildId) return;

    const { data: activeRaid, error } = await supabase
      .from("guild_raids")
      .select("id")
      .eq("guild_id", userGuildId)
      .eq("active", true)
      .limit(1)
      .single();

    if (error || !activeRaid) return;

    await new Promise(r => setTimeout(r, 300));

    try {
      showRaidAlert("Há uma Raid em andamento. Vá verificar!");
    } catch (e) {
      console.warn('alert falhou:', e);
    }

  } catch (e) {
    console.error("checkActiveRaidOnEntry error:", e);
  }
}

setTimeout(() => { checkActiveRaidOnEntry().catch(()=>{}); }, 800);