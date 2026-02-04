import { supabase } from './supabaseClient.js'

console.log("guild_raid.js (v13.3) - Independent IndexedDB Update Logic");

// =========================================================
// >>> HELPER INDEXEDDB LOCAL (REPLICADO DO INVENTORY.JS) <<<
// =========================================================
// Isso permite que a Raid atualize o cache de inventário
// sem depender que o script.js esteja carregado na página.
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 47; // Mantenha a mesma versão do inventory.js

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Atualiza o cache local "cirurgicamente" dentro da página de Raid.
 * @param {Array} newItems - Array de itens (Inventory Rows com Join em Items)
 * @param {String} newTimestamp - O novo timestamp vindo do servidor
 */
async function localSurgicalCacheUpdate(newItems, newTimestamp) {
    try {
        const db = await openDB();
        const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const meta = tx.objectStore(META_STORE);

        // 1. Atualiza ou insere os itens modificados
        if (Array.isArray(newItems)) {
            newItems.forEach(item => store.put(item));
        }

        // 2. Atualiza o Timestamp para "enganar" o inventory.js
        // Dizendo: "Ei, eu já tenho a versão desse horário!"
        if (newTimestamp) {
            meta.put({ key: "last_updated", value: newTimestamp });
            // Atualiza também o cache_time para não expirar por idade
            meta.put({ key: "cache_time", value: Date.now() }); 
        }

        return new Promise(resolve => {
            tx.oncomplete = () => {
                console.log("✅ [Raid Local] Cache de inventário atualizado com sucesso via IndexedDB.");
                resolve();
            }
        });
    } catch (e) {
        console.warn("⚠️ Falha ao atualizar IndexedDB localmente na Raid:", e);
    }
}
// =========================================================


const MAX_ATTACKS = 3;
const ATTACK_COOLDOWN_SECONDS = 60;
const ATTEMPTS_CACHE_DURATION_MS = 15 * 60 * 1000;

const AMBIENT_AUDIO_INTERVAL_MS = 60 * 1000;
const BOSS_ATTACK_INTERVAL_SECONDS = 30;

const BATCH_THRESHOLD = 3;
const BATCH_DEBOUNCE_MS = 40000;

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
let localPlayerHp = 1;
let attacksLeft = 0, lastAttackAt = null, raidEndsAt = null;
let uiSecondInterval = null, raidTimerInterval = null, reviveUITickerInterval = null, countdownInterval = null;
let refreshAttemptsPending = false;
let shownRewardIds = new Set(); 

// Death Notification
let deathNotificationQueue = [];
let isDisplayingDeathNotification = false;
let processedDeathTimestamps = new Set(); 

// Visual/Logic Boss
let optimisticBossInterval = null;
let nextBossAttackTime = 0;

// Otimista & Batch
let playerStatsCache = null; 
let pendingAttacksQueue = 0; 
let batchSyncTimer = null; 
let localDamageDealtInBatch = 0; 
let isBatchSyncing = false; 

let isSwitchingFloors = false; 

// Ações e Mídia
let actionQueue = [];
let isProcessingAction = false;
let isMediaUnlocked = false;
let ambientAudioInterval = null;
let ambientAudioPlayer = null; 
let bossMusicPlayer = null;
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

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
        if (data.raidId === currentRaidId && (Date.now() - data.ts < 600000)) {
            pendingAttacksQueue = data.queue || 0;
            localDamageDealtInBatch = data.dmg || 0;
            if (pendingAttacksQueue > 0) {
                 triggerBatchSync(); 
            }
        } else {
            localStorage.removeItem('raid_batch_state');
        }
    } catch(e) {}
}

async function cachePlayerStats() {
    if (playerStatsCache) return; 
    if (!userId) return;
    try {
        const { data, error } = await supabase.rpc("get_player_details_for_raid", { p_player_id: userId });
        if (data && !error) {
            playerStatsCache = {
                min_attack: Number(data.min_attack || 0),
                attack: Number(data.attack || 0),
                crit_chance: Number(data.crit_chance || 0),
                crit_damage: Number(data.crit_damage || 0),
                defense: Number(data.defense || 0),
                evasion: Number(data.evasion || 0),
                health: Number(data.health || 0)
            };
            playerMaxHealth = Math.max(1, playerStatsCache.health);
        }
    } catch(e) { console.warn("Erro ao cachear stats:", e); }
}

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
        audioContext.resume().catch(e => console.warn(e));
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
}

function primeMedia() {
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
                    if(isMediaUnlocked) videoPlayer.muted = false;
                })
                .catch(err => {
                    console.warn("Falha ao preparar mídia.", err);
                });
        }
    }
}


function playRandomAmbientAudio() {
    if (!isMediaUnlocked || isProcessingAction || document.visibilityState !== 'visible') return;
    const audioSrc = AMBIENT_AUDIO_URLS[Math.floor(Math.random() * AMBIENT_AUDIO_URLS.length)];
    ambientAudioPlayer.src = audioSrc;
    ambientAudioPlayer.play().catch(e => {});
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
            bossMusicPlayer.play().catch(e => {});
        }
    } else {
        if (bossMusicPlayer && !bossMusicPlayer.paused) {
            bossMusicPlayer.pause();
        }
        if (!ambientAudioInterval) {
            try { playRandomAmbientAudio(); } catch(e) {}
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
    
    // Reset animation
    banner.classList.remove('show');
    void banner.offsetWidth; // trigger reflow
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

        if (raidError || !raidData || !Array.isArray(raidData.recent_deaths)) return;

        const newDeaths = raidData.recent_deaths.filter(death => !processedDeathTimestamps.has(death.timestamp));

        if (newDeaths.length === 0) return;

        newDeaths.forEach(death => processedDeathTimestamps.add(death.timestamp));
        
        const newPlayerIds = newDeaths.map(death => death.player_id);
        const others = newPlayerIds.filter(id => id !== userId);
        
        if (others.length === 0) return;

        const { data: players, error: playersError } = await supabase
            .from('players')
            .select('id, name')
            .in('id', others);

        if (playersError) return;

        const playerNamesMap = new Map(players.map(p => [p.id, p.name]));
        
        others.forEach(pid => {
            const name = playerNamesMap.get(pid);
            if (name) {
                deathNotificationQueue.push(name);
            }
        });
        processDeathNotificationQueue();

    } catch (e) {}
}

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
        const { data } = await supabase.auth.getSession({ cache: 'memory-only' });
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

// Substitua a função loadRaid existente por esta:
async function loadRaid() {
    if (!userGuildId) return;
    stopAllFloorMusic();
    isSwitchingFloors = false; 

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

        const now = new Date();
        const endsAt = new Date(data.ends_at);
        const startTime = new Date(data.starts_at);

        // --- CORREÇÃO DO BUG "PRESO NO FINAL" ---
        // Se a Raid está marcada como ativa no banco, mas o tempo já acabou:
        if (now >= endsAt) {
            console.log("Detectada Raid expirada durante o load. Finalizando no servidor...");
            
            // Chama a função SQL para marcar active = false oficialmente
            await supabase.rpc('end_expired_raid', { p_raid_id: data.id });
            
            // Exibe o alerta e encerra o load. 
            // Na próxima vez que o jogador clicar, ela não virá mais como ativa.
            showRaidAlert("A Raid anterior chegou ao fim.");
            closeCombatModal();
            
            // Opcional: Recarregar a página ou reabrir o modal para cair no "lastRaidResultModal"
            // Mas apenas fechar já resolve o loop.
            return; 
        }
        // ----------------------------------------

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
    await cachePlayerStats(); 
    loadBatchState(); 

    await checkPendingRaidRewards();

    deathNotificationQueue = [];
    isDisplayingDeathNotification = false;
    processedDeathTimestamps.clear(); 
    
    const rankEl = $id("raidDamageRankingList");
    if(rankEl) rankEl.innerHTML = "";

    startUISecondTicker();
    startRaidTimer();
    startOptimisticBossCombat();
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

function saveAttemptsCache(left, last) {
    if (!userId) return;
    const cacheKey = `raid_attempts_${userId}`;
    const data = {
        left: left,
        last: last,
        ts: Date.now()
    };
    localStorage.setItem(cacheKey, JSON.stringify(data));
}

async function loadAttempts() {
  if (!currentRaidId || !userId) return;
  
  try {
      const cacheKey = `raid_attempts_${userId}`;
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
          const cached = JSON.parse(raw);
          if (Date.now() - cached.ts < ATTEMPTS_CACHE_DURATION_MS) {
              attacksLeft = cached.left;
              lastAttackAt = cached.last ? new Date(cached.last) : null;
              updateAttackUI();
              return;
          }
      }
  } catch(e) {}

  try {
    const { data, error } = await supabase.from("guild_raid_attempts").select("attempts_left, last_attack_at").eq("raid_id", currentRaidId).eq("player_id", userId).single();
    if (error || !data) {
      attacksLeft = MAX_ATTACKS;
      lastAttackAt = null;
    } else {
      attacksLeft = Number(data.attempts_left || 0);
      lastAttackAt = data.last_attack_at ? new Date(data.last_attack_at) : null;
    }
    saveAttemptsCache(attacksLeft, lastAttackAt);
    updateAttackUI();
  } catch (e) {
    console.error("loadAttempts", e);
  }
}

function computeShownAttacksAndRemaining() {
  const now = new Date();
  
  // [FIX 1 - Robustez do Timer]
  // Se temos menos que o máximo e o timer é nulo, houve um desync.
  // Forçamos um "lastAttackAt" para agora para evitar UI travada em 0/3 sem texto.
  if (attacksLeft < MAX_ATTACKS && !lastAttackAt) {
      // Auto-correção visual: assume que gastou agora
      return { shownAttacks: attacksLeft, secondsToNext: ATTACK_COOLDOWN_SECONDS };
  }

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
  
  const visualAttacksLeft = Math.max(0, shownAttacks - pendingAttacksQueue);

  attacksEl.textContent = `${visualAttacksLeft} / ${MAX_ATTACKS}`;
  
  // [FIX] Se estiver 0/3 e timer vazio, exibe algo genérico ou força estado de espera
  if (visualAttacksLeft < MAX_ATTACKS && secondsToNext <= 0) {
      cooldownEl.textContent = "Recuperando...";
  } else {
      cooldownEl.textContent = (secondsToNext > 0 && visualAttacksLeft < MAX_ATTACKS) 
          ? `+ 1 em ${formatTime(secondsToNext)}` 
          : "";
  }
  
  const playerDead = isPlayerDeadLocal();
  if (playerDead || isProcessingAction || isSwitchingFloors) { 
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
        return;
    }
    playerMaxHealth = playerDetails.health || 1;
    const { data: pData } = await supabase.from("players").select("raid_player_health, revive_until, avatar_url").eq("id", userId).single();
    if(pData) {
        localPlayerHp = pData.raid_player_health !== null ? pData.raid_player_health : playerMaxHealth;
        _playerReviveUntil = pData.revive_until;
        if(pData.avatar_url && $id("raidPlayerAvatar")) $id("raidPlayerAvatar").src = pData.avatar_url;
    } else {
        localPlayerHp = playerMaxHealth;
    }
    
    updatePlayerHpUi(localPlayerHp, playerMaxHealth);

    if (isPlayerDeadLocal()) {
        if (!reviveUITickerInterval) startReviveUITicker();
    }

  } catch (e) {
    console.error("loadInitialPlayerState", e);
  }
}

async function performAttackOptimistic() {
    if (!currentRaidId || !userId || isProcessingAction) return;
    if (isPlayerDeadLocal()) { showRaidAlert("Você está morto."); return; }
    if (isSwitchingFloors) return; 
    
    const { shownAttacks } = computeShownAttacksAndRemaining();
    const visualAttacksLeft = shownAttacks - pendingAttacksQueue; 

    if (visualAttacksLeft <= 0) {
        showRaidAlert("Sem ataques. Aguarde regeneração.");
        return;
    }

    if (!playerStatsCache) await cachePlayerStats();
    
    const { min_attack, attack, crit_chance, crit_damage } = playerStatsCache || { min_attack: 1, attack: 5, crit_chance: 0, crit_damage: 0 };
    const isCrit = (Math.random() * 100) < crit_chance;
    let damage = Math.floor(Math.random() * ((attack - min_attack) + 1) + min_attack);
    if (isCrit) damage = Math.floor(damage * (1 + crit_damage / 100.0));
    damage = Math.max(1, damage);

    displayFloatingDamageOver($id("raidMonsterArea"), damage, isCrit);
    playHitSound(isCrit);
    
    const currentMonsterHp = Number($id("raidMonsterHpText").textContent.split('/')[0].replace(/[^\d]/g, ''));
    const newVisualHp = Math.max(0, currentMonsterHp - damage);
    updateHpBar(newVisualHp, maxMonsterHealth);
    
    const monsterImg = $id("raidMonsterImage");
    if (monsterImg) {
        monsterImg.classList.add('shake-animation');
        setTimeout(() => monsterImg.classList.remove('shake-animation'), 300);
    }

    pendingAttacksQueue++;
    localDamageDealtInBatch += damage;
    
    if (attacksLeft >= MAX_ATTACKS && lastAttackAt === null) {
         lastAttackAt = new Date(); 
    }
    
    updateAttackUI(); 
    saveBatchState(); 
    saveAttemptsCache(attacksLeft, lastAttackAt);

    if (batchSyncTimer) clearTimeout(batchSyncTimer);
    
    if (newVisualHp <= 0) {
        isSwitchingFloors = true; 
        updateAttackUI(); 
        stopOptimisticBossCombat(); 
        triggerBatchSync(); 
    } else if (pendingAttacksQueue >= BATCH_THRESHOLD) {
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

    pendingAttacksQueue = 0;
    localDamageDealtInBatch = 0;
    saveBatchState(); 
    if (batchSyncTimer) clearTimeout(batchSyncTimer);

    updateAttackUI();

    try {
        console.log(`[Sync] Enviando lote de ${attacksToSend} ataques...`);
        
        const { data, error } = await supabase.rpc("perform_raid_attack_batch", { 
            p_player_id: userId,
            p_raid_id: currentRaidId,
            p_attack_count: attacksToSend
        });

        // [FIX - Tratamento de Erro vs Morte]
        if (error) {
            throw new Error(error.message);
        }

        // Se o sucesso for false mas tiver revive_until, tratamos como morte, não erro
        // O SQL atualizado retorna success: true mesmo se morto, mas vamos garantir.
        if (data.revive_until && new Date(data.revive_until) > new Date()) {
             // O jogador morreu durante o batch ou já estava morto
             _playerReviveUntil = data.revive_until;
             localPlayerHp = 0;
             updatePlayerHpUi(0, playerMaxHealth);
             
             // Inicia timer de revive
             if (!reviveUITickerInterval) startReviveUITicker();
             
             // Mostra banner se ainda não mostrou
             displayDeathNotification(userName || "Você");
             
             // NÃO faz rollback de ataques se morreu. Os ataques foram "gastos" ou invalidados.
             // Apenas atualiza o contador real do server
             if (data.attacks_left !== undefined) {
                 attacksLeft = data.attacks_left;
                 lastAttackAt = data.last_attack_at ? new Date(data.last_attack_at) : null;
                 saveAttemptsCache(attacksLeft, lastAttackAt);
             }
             updateAttackUI();
             
             isBatchSyncing = false;
             return;
        }

        if (!data.success) {
            throw new Error(data.message || "Erro no sync");
        }

        // --- Sucesso Normal ---
        updateHpBar(data.monster_health, data.max_monster_health);
        
        if (data.player_health !== undefined) {
             localPlayerHp = Math.min(localPlayerHp, data.player_health);
             updatePlayerHpUi(localPlayerHp, playerMaxHealth);
        }

        attacksLeft = data.attacks_left;
        lastAttackAt = data.last_attack_at ? new Date(data.last_attack_at) : null;
        
        if (attacksLeft < MAX_ATTACKS && !lastAttackAt) {
            lastAttackAt = new Date();
        }

        saveAttemptsCache(attacksLeft, lastAttackAt);
        updateAttackUI();

        // === [NOVO] ATUALIZAÇÃO CIRÚRGICA DE INVENTÁRIO (LOCALMENTE) ===
        if (data.inventory_updates && data.new_timestamp) {
             await localSurgicalCacheUpdate(data.inventory_updates, data.new_timestamp);
        }
        // ================================================================

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
        } else {
             isSwitchingFloors = false;
             updateAttackUI();
        }
        
        if (currentFloor % 5 === 0) {
            checkOtherPlayerDeaths();
        }

    } catch (e) {
        console.error("Falha no Sync Batch:", e);
        // Rollback APENAS se for erro de rede/lógica, não morte
        pendingAttacksQueue += attacksToSend;
        localDamageDealtInBatch += expectedDamage;
        isSwitchingFloors = false;
        saveBatchState();
        updateAttackUI();
        batchSyncTimer = setTimeout(() => { isBatchSyncing = false; triggerBatchSync(); }, 5000);
        return; 
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

function startOptimisticBossCombat() {
    stopOptimisticBossCombat();
    if ((currentFloor % 5) !== 0) return;

    const now = Date.now();
    nextBossAttackTime = now + (BOSS_ATTACK_INTERVAL_SECONDS * 1000);

    optimisticBossInterval = setInterval(async () => {
        if (isProcessingAction || isPlayerDeadLocal()) return;
        
        const now = Date.now();
        if (now >= nextBossAttackTime) {
            await simulateLocalBossAttackLogic();
            nextBossAttackTime = now + (BOSS_ATTACK_INTERVAL_SECONDS * 1000);
        }
    }, 1000); 
}

function stopOptimisticBossCombat() {
    if (optimisticBossInterval) clearInterval(optimisticBossInterval);
    optimisticBossInterval = null;
}

async function simulateLocalBossAttackLogic() {
    const currentMonsterHp = Number($id("raidMonsterHpText").textContent.split('/')[0].replace(/[^\d]/g, ''));
    if (currentMonsterHp <= 0) return;

    if (!playerStatsCache) await cachePlayerStats();
    
    const randomAttackVideo = BOSS_ATTACK_VIDEO_URLS[Math.floor(Math.random() * BOSS_ATTACK_VIDEO_URLS.length)];
    queueAction(() => {
        playVideo(randomAttackVideo, () => {
             const stats = playerStatsCache || { defense: 0, evasion: 0, health: 1 };
             const isEvaded = (Math.random() * 100) < stats.evasion;
             
             if (isEvaded) {
                 displayFloatingDamageOver($id("raidPlayerArea"), "Errou!", false);
                 return;
             }

             const baseDmg = Math.max(1, Math.floor(maxMonsterHealth * 0.03));
             const finalDmg = Math.max(1, baseDmg - Math.floor(stats.defense / 10));
             
             localPlayerHp = Math.max(0, localPlayerHp - finalDmg);
             updatePlayerHpUi(localPlayerHp, playerMaxHealth);
             
             displayFloatingDamageOver($id("raidPlayerArea"), finalDmg, false);
             
             const playerAvatar = $id("raidPlayerAvatar");
             if (playerAvatar) {
                playerAvatar.classList.add('shake-animation');
                setTimeout(() => playerAvatar.classList.remove('shake-animation'), 1000);
             }

             if (localPlayerHp <= 0) {
                 handleOptimisticDeath();
             }
        });
    });
}

function handleOptimisticDeath() {
    const reviveTimeMs = 62000; 
    _playerReviveUntil = new Date(Date.now() + reviveTimeMs).toISOString();
    
    updateAttackUI(); 
    displayDeathNotification(userName || "Você"); 
    startReviveUITicker();
}

function startReviveUITicker() {
    stopReviveUITicker();
    reviveUITickerInterval = setInterval(() => {
        if (!_playerReviveUntil) {
            stopReviveUITicker();
            return;
        }
        const remaining = Math.ceil((new Date(_playerReviveUntil) - new Date()) / 1000);
        setPlayerReviveOverlayText(Math.max(0, remaining));

        if (remaining <= 0) {
            _playerReviveUntil = null;
            localPlayerHp = playerMaxHealth;
            updatePlayerHpUi(localPlayerHp, playerMaxHealth);
            setPlayerReviveOverlayText(0);
            updateAttackUI(); 
            stopReviveUITicker();
        }
    }, 1000);
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

function startUISecondTicker() {
  stopUISecondTicker();
  uiSecondInterval = setInterval(async () => {
    updateAttackUI();
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

  if (pendingAttacksQueue > 0) triggerBatchSync();

  stopUISecondTicker(); 
  clearRaidTimer(); 
  stopOptimisticBossCombat();
  stopReviveUITicker();
  stopAllFloorMusic();
  clearCountdown();
  actionQueue = [];
  isProcessingAction = false;
  isSwitchingFloors = false;
}

function openRaidModal() { const m = $id("raidModal"); if (m) m.style.display = "flex"; }
function closeRaidModal(){ const m = $id("raidModal"); if (m) m.style.display = "none"; }
function openCombatModal(){ const m = $id("raidCombatModal"); if (m) m.style.display = "flex"; }

function bindEvents() {
  const tdd = $id("tdd");
  if (tdd) {
    tdd.addEventListener("click", async () => {
      try { primeMedia(); } catch(e) {}

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
    try { primeMedia(); } catch(e) {}

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

  $id("raidAttackBtn")?.addEventListener("click", async (e) => {
    try { unlockMedia(); } catch(e) {}
    try { await performAttackOptimistic(); } catch(err) { console.error('performAttackOptimistic error', err); }
});

  $id("cancelRaidBtn")?.addEventListener("click", closeRaidModal);
  $id("raidBackBtn")?.addEventListener("click", () => closeCombatModal());
  
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
          attacksLeft += purchased; 
          saveAttemptsCache(attacksLeft, lastAttackAt);
          updateAttackUI();
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