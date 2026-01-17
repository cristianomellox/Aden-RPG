import { supabase } from './supabaseClient.js'

// =======================================================================
// MÓDULO: ADEN GLOBAL DB (CÓPIA LOCAL OTIMIZADA)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 2;
const AUTH_STORE = 'auth_store';

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(AUTH_STORE, 'readonly');
                const req = tx.objectStore(AUTH_STORE).get('current_session');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};

// ================= HELPER: AUTH OTIMISTA =================
async function getLocalUserId() {
    const globalAuth = await GlobalDB.getAuth();
    if (globalAuth && globalAuth.value && globalAuth.value.user) {
        return globalAuth.value.user.id;
    }
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                const session = JSON.parse(localStorage.getItem(k));
                if (session?.user?.id) return session.user.id;
            }
        }
    } catch (e) {}
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
}

// ================= CONFIGURAÇÕES =================
const BOSS_ATTACK_INTERVAL = 45000; 
const ATTACK_REGEN_MS = 60000;      
const MAX_ATTACKS = 3;
const REVIVE_TIME_MS = 29000;       
const CACHE_KEY_PREFIX = "aden_solo_boss_";

const VIDEO_INTRO = "https://aden-rpg.pages.dev/assets/karintro.mp4";
const VIDEO_DEATH = "https://aden-rpg.pages.dev/assets/karoutro.mp4";
const ATTACK_VIDEOS = [
    "https://aden-rpg.pages.dev/assets/karatk01.mp4",
    "https://aden-rpg.pages.dev/assets/karatk02.mp4",
    "https://aden-rpg.pages.dev/assets/karatk03.mp4",
    "https://aden-rpg.pages.dev/assets/karatk04.mp4",
    "https://aden-rpg.pages.dev/assets/karatk05.mp4",
    "https://aden-rpg.pages.dev/assets/karatk06.mp4"
];

// Cache em memória para os vídeos (Blob URLs)
const videoBlobCache = {};

// Função para pré-carregar vídeos em memória (Buffer) com Progresso
async function bufferBattleVideos(onProgress) {
    const allVideos = [...ATTACK_VIDEOS, VIDEO_INTRO, VIDEO_DEATH];
    let loadedCount = 0;
    const total = allVideos.length;

    // Função auxiliar para baixar um único vídeo
    const fetchVideo = async (url) => {
        if (videoBlobCache[url]) {
            loadedCount++;
            if (onProgress) onProgress(Math.floor((loadedCount / total) * 100));
            return;
        }

        try {
            const response = await fetch(url);
            const blob = await response.blob();
            videoBlobCache[url] = URL.createObjectURL(blob);
        } catch (e) {
            console.warn("Falha ao criar buffer do vídeo:", url, e);
        } finally {
            loadedCount++;
            if (onProgress) onProgress(Math.floor((loadedCount / total) * 100));
        }
    };

    // Dispara todos os downloads em paralelo
    const promises = allVideos.map(url => fetchVideo(url));
    await Promise.allSettled(promises);
}

const AUDIO_HIT = new Audio("https://aden-rpg.pages.dev/assets/normal_hit.mp3");
const AUDIO_CRIT = new Audio("https://aden-rpg.pages.dev/assets/critical_hit.mp3");

// Áudio de fundo
const AUDIO_BGM = new Audio("https://aden-rpg.pages.dev/assets/kar-drakul.mp3"); 
AUDIO_BGM.loop = true;
AUDIO_BGM.volume = 0.3;

AUDIO_HIT.volume = 0.4;
AUDIO_CRIT.volume = 0.4;

// ================= ESTADO LOCAL =================
let state = {
    sessionId: null,
    playerId: null,
    active: false,
    expiresAt: 0,
    bossHp: 0,
    maxBossHp: 0,
    initialBossHp: 0,
    bossImageUrl: "", 
    totalHits: 0, 
    playerHp: 0,
    maxPlayerHp: 0,
    playerStats: {},
    playerAvatarUrl: "", 
    attacksLeft: 3,
    lastAttackTime: null,
    nextBossAttack: 0,
    reviveUntil: null
};

let loops = { timer: null, combat: null };

// ================= INICIALIZAÇÃO =================
document.addEventListener("DOMContentLoaded", async () => {
    // 1. CORREÇÃO DO VÍDEO DE FUNDO
    const bgVideo = document.getElementById('sbBackgroundVideo');
    if (bgVideo) {
        bgVideo.load();
        const fadeInVideo = () => { bgVideo.style.opacity = '1'; };
        if (bgVideo.readyState >= 3) {
            fadeInVideo();
        } else {
            bgVideo.addEventListener('canplaythrough', fadeInVideo, { once: true });
            bgVideo.addEventListener('canplay', fadeInVideo, { once: true });
        }
    }

    document.getElementById('msgCloseBtn').addEventListener('click', () => {
        document.getElementById('msgModal').style.display = 'none';
    });

    const userId = await getLocalUserId();
    
    if (!userId) {
        window.location.href = 'index.html';
        return;
    }
    state.playerId = userId;
    
    // Verifica sessão (Reload logic)
    await checkSession(); 
    
    document.getElementById('sbStartBtn').addEventListener('click', startBattle);
    document.getElementById('sbAttackBtn').addEventListener('click', playerAttack);
});

// ================= UI HELPERS DE LOADING =================
function showLoading(text) {
    const modal = document.getElementById('loadingModal');
    const txt = document.getElementById('loadingText');
    const barFill = document.getElementById('loadingBarFill');
    const pct = document.getElementById('loadingPercent');
    
    txt.textContent = text || "Carregando...";
    barFill.style.width = "0%";
    pct.textContent = "0%";
    modal.style.display = 'flex';
}

function updateLoadingProgress(percent) {
    const barFill = document.getElementById('loadingBarFill');
    const pct = document.getElementById('loadingPercent');
    if(barFill) barFill.style.width = `${percent}%`;
    if(pct) pct.textContent = `${percent}%`;
}

function hideLoading() {
    document.getElementById('loadingModal').style.display = 'none';
}

// ================= HELPER DE MENSAGEM (MODAL) =================
let currentMsgCallback = null;

function showMsg(title, message, type = 'info', callback = null, btnText = "Entendido") {
    const modal = document.getElementById('msgModal');
    const titleEl = document.getElementById('msgTitle');
    const bodyEl = document.getElementById('msgBody');
    const btn = document.getElementById('msgCloseBtn');

    titleEl.textContent = title;
    bodyEl.innerHTML = message;
    btn.textContent = btnText;

    if (type === 'error') {
        titleEl.style.color = '#ff4444';
        btn.style.borderColor = '#ff4444';
    } else {
        titleEl.style.color = 'gold';
        btn.style.borderColor = 'gold';
    }

    currentMsgCallback = callback;
    btn.onclick = () => {
        modal.style.display = 'none';
        if (currentMsgCallback) {
            currentMsgCallback();
            currentMsgCallback = null;
        }
    };

    modal.style.display = 'flex';
}

// ================= INTERAÇÃO FORÇADA E CHECK SESSION =================

// Chamado apenas DEPOIS que o buffer de vídeo já carregou no checkSession
function forceUserInteraction(onResume) {
    document.getElementById('sbLobby').style.display = 'none';
    
    showMsg(
        "Batalha em Andamento",
        "Sua sessão foi recuperada e os recursos carregados. Clique abaixo para retomar.",
        "info",
        async () => {
            // Destrava áudio
            try {
                await AUDIO_BGM.play();
            } catch(e) {
                console.warn("Áudio bloqueado, tentará novamente.");
            }
            onResume();
        },
        "Retomar Combate"
    );
}

async function checkSession() {
    const localData = localStorage.getItem(CACHE_KEY_PREFIX + state.playerId);
    
    if (localData) {
        try {
            const parsed = JSON.parse(localData);
            
            // Se expirou
            if (new Date(parsed.expiresAt) <= new Date()) {
                console.log("Sessão local expirada detectada. Finalizando...");
                state = parsed;
                await finishBattle(false);
                return;
            }

            // Sessão válida encontrada
            state = parsed;
            if (typeof state.totalHits === 'undefined') state.totalHits = 0;

            // 1. Mostra Loading com Barra para o usuário que deu F5
            showLoading("Restaurando Memória...");
            
            // 2. Aguarda baixar todos os vídeos para evitar tela preta
            await bufferBattleVideos((pct) => {
                updateLoadingProgress(pct);
            });

            // 3. Esconde loading
            hideLoading();

            // 4. Pede interação (agora com vídeos prontos na memória)
            forceUserInteraction(() => {
                setupUI();
                startLoops();
            });
            return; 

        } catch(e) {
            console.warn("Erro ao ler cache local", e);
            localStorage.removeItem(CACHE_KEY_PREFIX + state.playerId);
            hideLoading();
        }
    }

    // Se não tem sessão, mostra Lobby
    document.getElementById('sbLobby').style.display = 'flex';
    document.getElementById('sbContainer').style.display = 'none';
}

async function startBattle() {
    const btn = document.getElementById('sbStartBtn');
    
    // Tenta iniciar áudio imediatamente no clique
    AUDIO_BGM.play().catch(()=>{});

    localStorage.removeItem(CACHE_KEY_PREFIX + state.playerId);
    const bossImg = document.getElementById('bossImage');
    if(bossImg) bossImg.src = "";

    // 1. Inicia UI de Loading
    showLoading("Baixando Recursos...");
    btn.disabled = true;

    // 2. Carrega Vídeos em Buffer e atualiza Barra
    await bufferBattleVideos((pct) => {
        updateLoadingProgress(pct);
    });

    // 3. Só agora chama o servidor (videos já estão em 100%)
    const { data, error } = await supabase.rpc('start_solo_boss', { p_player_id: state.playerId });

    if (error || !data.success) {
        hideLoading();
        showMsg(
            "Não foi possível iniciar", 
            data?.message || "Ocorreu um erro ao conectar com o servidor.", 
            "error"
        );
        btn.disabled = false;
        return;
    }

    if (data.recovered) {
        state.totalHits = 0; 
        await initCombatState(data);
        hideLoading();
        
        // Se recuperou via servidor (raro vir aqui se nao tinha localstorage, mas possivel em outro device)
        // Como o usuário já clicou em iniciar, o áudio tá ok.
        setupUI();
        startLoops();
    } else {
        await initCombatState(data);
        
        // Mantem loading escondido, mas inicia video intro
        hideLoading();
        
        playVideo(VIDEO_INTRO, () => {
            AUDIO_BGM.play().catch(()=>{});
            setupUI();
            startLoops();
        });
    }
}

async function initCombatState(serverData) {
    const { data: pStats } = await supabase.rpc('get_player_details_for_raid', { p_player_id: state.playerId });
    
    state.sessionId = serverData.session_id;
    state.expiresAt = new Date(serverData.expires_at).getTime();
    state.active = true;
    
    state.maxBossHp = Number(serverData.boss_hp);
    state.initialBossHp = state.maxBossHp;
    state.bossHp = state.maxBossHp;
    state.bossImageUrl = serverData.boss_image || "https://aden-rpg.pages.dev/assets/kar-drakul.png"; 
    
    if (typeof state.totalHits === 'undefined') state.totalHits = 0;
    
    state.playerStats = {
        min_attack: Number(pStats.min_attack || 0),
        attack: Number(pStats.attack || 0),
        crit_chance: Number(pStats.crit_chance || 0),
        crit_damage: Number(pStats.crit_damage || 0),
        defense: Number(pStats.defense || 0),
        evasion: Number(pStats.evasion || 0),
        health: Number(pStats.health || 100)
    };
    state.maxPlayerHp = state.playerStats.health;
    state.playerHp = state.maxPlayerHp;
    state.playerAvatarUrl = pStats.avatar_url || "https://via.placeholder.com/80"; 
    
    state.attacksLeft = 3;
    state.lastAttackTime = Date.now(); 
    state.nextBossAttack = Date.now() + 10000;
    state.reviveUntil = null;
    
    saveState();
}

function setupUI() {
    document.getElementById('sbLobby').style.display = 'none';
    document.getElementById('sbContainer').style.display = 'flex'; 
    
    if (state.bossImageUrl) document.getElementById('bossImage').src = state.bossImageUrl;
    if (state.playerAvatarUrl) document.getElementById('playerAvatar').src = state.playerAvatarUrl;
    
    updateBars();
}

function saveState() {
    if(!state.active) {
        localStorage.removeItem(CACHE_KEY_PREFIX + state.playerId);
        return;
    }
    localStorage.setItem(CACHE_KEY_PREFIX + state.playerId, JSON.stringify(state));
}

function startLoops() {
    if(loops.timer) clearInterval(loops.timer);
    if(loops.combat) clearInterval(loops.combat);
    loops.timer = setInterval(uiLoop, 1000);
    loops.combat = setInterval(combatLoop, 1000);
}

function uiLoop() {
    const now = Date.now();
    const diff = state.expiresAt - now;
    
    if (diff <= 0) {
        finishBattle(false);
        return;
    }
    
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById('sbTimer').textContent = `${m}:${s < 10 ? '0'+s : s}`;

    if (state.attacksLeft < MAX_ATTACKS && state.lastAttackTime) {
        if (now - state.lastAttackTime >= ATTACK_REGEN_MS) {
            state.attacksLeft++;
            state.lastAttackTime = (state.attacksLeft < MAX_ATTACKS) ? now : null;
            saveState();
        }
        if(state.attacksLeft < MAX_ATTACKS) {
            const nextIn = Math.ceil((ATTACK_REGEN_MS - (now - state.lastAttackTime)) / 1000);
            document.getElementById('cooldownTimer').textContent = `+1 em ${nextIn}s`;
        } else {
            document.getElementById('cooldownTimer').textContent = "";
        }
    } else {
        document.getElementById('cooldownTimer').textContent = "Máximo";
    }

    if (state.reviveUntil) {
        if (now >= state.reviveUntil) {
            state.reviveUntil = null;
            state.playerHp = state.maxPlayerHp;
            document.getElementById('reviveOverlay').style.display = 'none';
            document.getElementById('playerAvatar').style.filter = "none";
            saveState();
        } else {
            const revSecs = Math.ceil((state.reviveUntil - now) / 1000);
            const overlay = document.getElementById('reviveOverlay');
            overlay.style.display = 'flex';
            overlay.textContent = `${revSecs}s`;
            document.getElementById('playerAvatar').style.filter = "grayscale(100%)";
        }
    }

    const atkBtn = document.getElementById('sbAttackBtn');
    const isDead = !!state.reviveUntil;
    const hasAttacks = state.attacksLeft > 0;
    
    document.getElementById('attacksLeft').textContent = state.attacksLeft;

    if (isDead || !hasAttacks) atkBtn.classList.add('disabled-btn');
    else atkBtn.classList.remove('disabled-btn');
    
    updateBars();
}

function combatLoop() {
    if (document.hidden || state.reviveUntil) return;
    if (Date.now() >= state.nextBossAttack) performBossAttack();
}

function playerAttack() {
    if (state.reviveUntil || state.attacksLeft <= 0) return;

    state.attacksLeft--;
    if (state.lastAttackTime === null) state.lastAttackTime = Date.now();

    const s = state.playerStats;
    const isCrit = (Math.random() * 100) < s.crit_chance;
    let dmg = Math.floor(Math.random() * ((s.attack - s.min_attack) + 1) + s.min_attack);
    if (isCrit) dmg = Math.floor(dmg * (1 + s.crit_damage / 100));
    dmg = Math.max(1, dmg);

    state.bossHp = Math.max(0, state.bossHp - dmg);
    state.totalHits++; 

    triggerShake('bossImage'); 
    createFloatingText(dmg, isCrit ? 'crit' : 'normal', 'bossImage');
    
    const aud = isCrit ? AUDIO_CRIT : AUDIO_HIT;
    aud.currentTime = 0;
    aud.play().catch(()=>{});

    saveState();
    updateBars();

    if (state.bossHp <= 0) {
        finishBattle(true);
    }
}

function performBossAttack() {
    state.nextBossAttack = Date.now() + BOSS_ATTACK_INTERVAL;
    saveState();

    const vid = ATTACK_VIDEOS[Math.floor(Math.random() * ATTACK_VIDEOS.length)];
    playVideo(vid, () => {
        const s = state.playerStats;
        const evaded = (Math.random() * 100) < s.evasion;

        if (evaded) {
            createFloatingText("Errou!", "normal", "playerUiArea");
        } else {
            let baseDmg = Math.floor(state.maxPlayerHp * 0.15); 
            let dmg = Math.max(1, baseDmg - Math.floor(s.defense / 5));
            
            state.playerHp = Math.max(0, state.playerHp - dmg);
            createFloatingText(`-${dmg}`, "player-dmg", "playerAvatar");
            triggerShake('playerAvatar'); 

            if (state.playerHp <= 0) {
                state.reviveUntil = Date.now() + REVIVE_TIME_MS;
                createFloatingText("Morto!", "player-dmg", "playerUiArea");
            }
        }
        saveState();
        updateBars();
    });
}

async function finishBattle(victory) {
    clearInterval(loops.timer);
    clearInterval(loops.combat);
    state.active = false;
    
    // Para música ao finalizar
    AUDIO_BGM.pause();
    AUDIO_BGM.currentTime = 0;
    
    localStorage.removeItem(CACHE_KEY_PREFIX + state.playerId);

    const processFinish = async () => {
        // Reutiliza loading modal, mas sem barra (ou reinicia barra)
        showLoading("Calculando resultados...");
        updateLoadingProgress(100);

        const { data, error } = await supabase.rpc('finish_solo_boss', {
            p_player_id: state.playerId,
            p_session_id: state.sessionId,
            p_victory: victory,
            p_total_hits: state.totalHits 
        });

        hideLoading();

        if (error || !data.success) {
            showMsg(
                "Sessão Encerrada", 
                "Esta sessão de batalha não é mais válida ou expirou no servidor.", 
                "error",
                () => { window.location.href = 'index.html'; }
            );
            return;
        }

        showVictoryModal(data, victory);
    };

    if (victory) {
        playVideo(VIDEO_DEATH, processFinish);
    } else {
        processFinish();
    }
}

function triggerShake(elementId) {
    const el = document.getElementById(elementId);
    if(el) {
        el.classList.remove('anim-float'); 
        el.classList.remove('shake-animation');
        void el.offsetWidth; 
        el.classList.add('shake-animation');
        
        setTimeout(() => {
            el.classList.remove('shake-animation');
            if(elementId === 'bossImage') el.classList.add('anim-float');
        }, 500); 
    }
}

function showVictoryModal(data, isVictory) {
    const titleEl = document.getElementById('resultTitle');
    const msgEl = document.getElementById('resultMsg');
    const list = document.getElementById('rewardsList');

    if (isVictory) {
        titleEl.textContent = "Vitória!";
        titleEl.style.color = "gold";
        msgEl.innerHTML = "Kar-Drakul foi derrotado.<br>Recompensas Máximas!";
    } else {
        titleEl.textContent = "Fim de Combate";
        titleEl.style.color = "#ff4444";
        const hits = data.hits_registered || 0;
        const pct = data.participation_pct || 0;
        msgEl.innerHTML = `Tempo Esgotado.<br>Golpes desferidos: <strong style="color:white">${hits}</strong><br>O conselho de Zion ficou <strong style="color:lime">${pct}%</strong> satisfeito com o dano causado.`;
    }

    list.innerHTML = `
        <div style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">
            <img src="https://aden-rpg.pages.dev/assets/exp.webp" style="width:24px;"> 
            <span>${nFmt(data.xp)} XP</span>
        </div>
        <div style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">
            <img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="width:24px;"> 
            <span>${nFmt(data.crystals)} Cristais</span>
        </div>
    `;
    
    if (data.items && data.items.length > 0) {
        list.innerHTML += `<div style="margin-top:10px; border-top:1px solid #444; padding-top:5px; color: gold; margin-bottom:5px;"><strong>Itens achados:</strong></div>`;
        data.items.forEach(item => {
            const itemName = item.name || "placeholder";
            const imageUrl = `https://aden-rpg.pages.dev/assets/itens/${itemName}.webp`;

            list.innerHTML += `
            <div class="reward-item">
                <img src="${imageUrl}" onerror="this.src='https://aden-rpg.pages.dev/assets/itens/placeholder.webp'">
                <div>
                    <div style="font-size:0.9em; color:yellow; display: none;">${itemName}</div>
                    <div style="font-size:0.8em; color:#ccc;">Quantidade: ${item.quantity}</div>
                </div>
            </div>`;
        });
    }
    
    document.getElementById('victoryModal').style.display = 'flex';
}

function updateBars() {
    const bPct = (state.bossHp / state.maxBossHp) * 100;
    document.getElementById('bossHpFill').style.width = `${bPct}%`;
    document.getElementById('bossHpText').textContent = `${nFmt(state.bossHp)} / ${nFmt(state.maxBossHp)}`;
    
    const pPct = (state.playerHp / state.maxPlayerHp) * 100;
    document.getElementById('playerHpFill').style.width = `${pPct}%`;
    document.getElementById('playerHpText').textContent = `${nFmt(state.playerHp)} / ${nFmt(state.maxPlayerHp)}`;
}

function createFloatingText(text, className, targetId) {
    const el = document.createElement('div');
    el.className = `floating-dmg ${className}`;
    el.textContent = text;
    
    const target = document.getElementById(targetId);
    if(!target) return;

    const rect = target.getBoundingClientRect();
    const container = document.getElementById('sbContainer');
    const containerRect = container.getBoundingClientRect();

    const leftPos = (rect.left - containerRect.left) + (rect.width / 2);
    const topPos = (rect.top - containerRect.top) + (rect.height / 2);

    el.style.left = leftPos + 'px';
    el.style.top = topPos + 'px';
    
    container.appendChild(el);
    setTimeout(() => el.remove(), 800);
}

function playVideo(src, callback) {
    // Pausa BGM para focar no vídeo
    const wasBgmPlaying = !AUDIO_BGM.paused;
    if (wasBgmPlaying) AUDIO_BGM.pause();

    const overlay = document.getElementById('videoOverlay');
    const vid = document.getElementById('gameVideo');
    if (!overlay || !vid) { if (callback) callback(); return; }

    // Verifica se temos a versão em memória (Blob), senão usa a URL normal
    const videoSrc = videoBlobCache[src] || src;

    // Reset visual
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
        overlay.style.opacity = '1'; 
    });
    
    vid.style.opacity = '0'; // Começa invisível
    vid.src = videoSrc;
    
    vid.muted = false;
    vid.volume = 1.0;
    vid.load();

    // Lógica de Fade Out (Ease Out) 0.6s antes do fim
    const timeUpdateHandler = () => {
        if (vid.duration && vid.currentTime > vid.duration - 0.6) {
            vid.style.opacity = '0'; // Inicia Fade Out
        }
    };
    vid.addEventListener('timeupdate', timeUpdateHandler);

    // Fade In quando o vídeo realmente começar a tocar
    const onPlaying = () => {
        vid.style.opacity = '1'; 
    };
    vid.addEventListener('playing', onPlaying, { once: true });

    // Tenta reproduzir
    const tryPlay = async () => {
        try {
            await vid.play();
        } catch (e) {
            console.warn("Autoplay falhou, tentando mudo", e);
            vid.muted = true;
            vid.play().catch(console.error);
        }
    };
    tryPlay();

    // Ao finalizar
    vid.onended = () => {
        vid.removeEventListener('timeupdate', timeUpdateHandler);
        
        overlay.style.opacity = '0';

        setTimeout(() => {
            overlay.style.display = 'none';
            vid.pause();
            vid.currentTime = 0;
            
            // Retoma BGM se estava tocando
            if (wasBgmPlaying && state.active) {
                AUDIO_BGM.play().catch(()=>{});
            }
            if(callback) callback();
        }, 300);
    };
}

function nFmt(num) {
    return Number(num).toLocaleString('pt-BR');
}