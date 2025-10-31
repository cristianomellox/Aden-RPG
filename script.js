if ('serviceWorker' in navigator) {
  try {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (let reg of registrations) {
        reg.unregister().then(success => {
          if (success) console.log('Service Worker removido:', reg);
        }).catch(()=>{});
      }
    }).catch(()=>{});
  } catch(e) {}
}

// 🎵 Música de Fundo (Adicionada aqui)// 🎵 Música de Fundo (Melhorada para arrastar mapa)
let musicStarted = false;
let backgroundMusic;

document.addEventListener("DOMContentLoaded", () => {
  backgroundMusic = new Audio("https://aden-rpg.pages.dev/assets/index.mp3");
  backgroundMusic.volume = 0.02;
  backgroundMusic.loop = true;

  function startBackgroundMusic() {
    if (musicStarted) return;
    backgroundMusic.play().then(() => {
      musicStarted = true;
      console.log("🎵 Música de fundo iniciada!");
    }).catch(err => console.warn("⚠️ Falha ao iniciar música:", err));
  }

  // Função utilitária para registrar listeners com opções comuns
  function addCapturedListener(target, evt, handler, opts = {}) {
    try {
      target.addEventListener(evt, handler, Object.assign({ capture: true, passive: true, once: false }, opts));
    } catch (e) {
      // alguns targets (ex: null) podem falhar, silenciosamente ignoramos
    }
  }

  // 1) Eventos primários que normalmente desbloqueiam áudio
  const primaryEvents = ["click", "pointerdown", "touchstart", "mousedown", "keydown"];
  for (const ev of primaryEvents) {
    addCapturedListener(window, ev, function onPrimary(e) {
      startBackgroundMusic();
      // remover listener é opcional; play() verifica musicStarted
    });
    addCapturedListener(document.body, ev, function onPrimary2(e) {
      startBackgroundMusic();
    });
  }

  // 2) Tentar capturar ARRASTO — só inicia se houver um toque/pointer real associado
  let moveArmed = false; // armará o gatilho quando detectarmos um pointerdown/touchstart
  function armMove() { moveArmed = true; /* breve timeout para evitar ficar armado indefinidamente */ setTimeout(()=> moveArmed = false, 1200); }

  addCapturedListener(window, "pointerdown", armMove);
  addCapturedListener(window, "touchstart", armMove);
  addCapturedListener(document.body, "pointerdown", armMove);
  addCapturedListener(document.body, "touchstart", armMove);

  function handleMoveForMusic(e) {
    if (musicStarted || !moveArmed) return;
    // Verifica se o movimento tem dedos ou pressão (sinal de arraste real)
    const isTouchMove = (e.touches && e.touches.length > 0);
    const hasPressure = (e.pressure && e.pressure > 0) || (e.buttons && e.buttons > 0);
    if (isTouchMove || hasPressure || e.pointerType) {
      startBackgroundMusic();
      moveArmed = false;
    }
  }
  addCapturedListener(window, "touchmove", handleMoveForMusic);
  addCapturedListener(window, "pointermove", handleMoveForMusic);
  addCapturedListener(document.body, "touchmove", handleMoveForMusic);
  addCapturedListener(document.body, "pointermove", handleMoveForMusic);

  // 3) Especial: anexa listeners diretamente aos elementos de mapa mais comuns
  // Busca por ids/classes que costumam ser usadas por mapas (ajuste se seu mapa usa outro seletor)
  const mapSelectors = [
    "#mapContainer",
    "#map",
    ".map",
    ".leaflet-container",
    ".mapboxgl-canvas",
    ".mapboxgl-map"
  ];
  for (const sel of mapSelectors) {
    document.querySelectorAll(sel).forEach(el => {
      addCapturedListener(el, "pointerdown", () => { startBackgroundMusic(); armMove(); });
      addCapturedListener(el, "touchstart", () => { startBackgroundMusic(); armMove(); });
      addCapturedListener(el, "touchmove", handleMoveForMusic);
      addCapturedListener(el, "pointermove", handleMoveForMusic);
    });
  }

  // 4) Fallbacks adicionais: se usuário soltar (pointerup / touchend) após arrastar, tente tocar
  function tryOnUp(e) { if (!musicStarted) startBackgroundMusic(); }
  addCapturedListener(window, "pointerup", tryOnUp);
  addCapturedListener(window, "touchend", tryOnUp);
  addCapturedListener(document.body, "pointerup", tryOnUp);
  addCapturedListener(document.body, "touchend", tryOnUp);

  // 5) Fallback temporizado (após pequena interação) — evita tentar tocar muitas vezes
  setTimeout(() => {
    if (!musicStarted) {
      // última tentativa silenciosa
      try { startBackgroundMusic(); } catch(e) {}
    }
  }, 6000);

  // Expor para debug / chamadas manuais
  window.startBackgroundMusic = startBackgroundMusic;
  window.__musicDebug = { isStarted: () => musicStarted };
});
// FIM DA MÚSICA DE FUNDO

// FIM DA MÚSICA DE FUNDO

const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =======================================================================
// CACHE PERSISTENTE (LocalStorage com TTL) - ADICIONADO
// =======================================================================
const CACHE_TTL_MINUTES = 60; // Cache de 1 hora como padrão

/**
 * Salva dados no LocalStorage com um timestamp e TTL.
 * @param {string} key A chave para o cache.
 * @param {any} data Os dados a serem salvos (serão convertidos para JSON).
 * @param {number} [ttlMinutes=CACHE_TTL_MINUTES] Tempo de vida em minutos.
 */
function setCache(key, data, ttlMinutes = CACHE_TTL_MINUTES) {
    const cacheItem = {
        expires: Date.now() + (ttlMinutes * 60 * 1000), // Salva o timestamp de expiração
        data: data
    };
    try {
        localStorage.setItem(key, JSON.stringify(cacheItem));
    } catch (e) {
        console.warn("Falha ao salvar no localStorage (provavelmente cheio):", e);
    }
}

/**
 * Busca dados do LocalStorage e verifica se expiraram.
 * @param {string} key A chave do cache.
 * @param {number} [defaultTtlMinutes=CACHE_TTL_MINUTES] TTL padrão (não usado se o item já tem 'expires').
 * @returns {any|null} Os dados (se encontrados e não expirados) ou null.
 */
function getCache(key, defaultTtlMinutes = CACHE_TTL_MINUTES) {
    try {
        const cachedItem = localStorage.getItem(key);
        if (!cachedItem) return null;

        const { expires, data } = JSON.parse(cachedItem);
        
        // Se não tiver 'expires' (formato antigo) ou se 'expires' não for um número, usa o TTL padrão
        const expirationTime = (typeof expires === 'number') ? expires : (Date.now() - (defaultTtlMinutes * 60 * 1000) - 1); // Força expiração se for formato antigo

        if (Date.now() > expirationTime) {
            localStorage.removeItem(key);
            return null;
        }
        return data;
    } catch (e) {
        console.error("Falha ao ler cache:", e);
        localStorage.removeItem(key); // Remove item corrompido
        return null;
    }
}
// =======================================================================


// =======================================================================
// DADOS DO JOGADOR E DEFINIÇÕES DE MISSÃO
// =======================================================================
let currentPlayerId = null; // Armazena o ID do usuário logado
let currentPlayerData = null; // Armazena todos os dados do jogador (com bônus)

// Definições das Missões de Progressão (Client-side para UI)
const mission_definitions = {
    level: [
        { req: 2, item_id: 2, qty: 10, desc: "Alcance nível 2.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_de_ferro.webp" },
        { req: 3, item_id: 2, qty: 10, desc: "Alcance nível 3.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_de_ferro.webp" },
        { req: 4, item_id: 2, qty: 10, desc: "Alcance nível 4.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_de_ferro.webp" },
        { req: 5, item_id: 26, qty: 5, desc: "Alcance nível 5.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 10, item_id: 26, qty: 5, desc: "Alcance nível 10.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 15, item_id: 26, qty: 5, desc: "Alcance nível 15.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 20, item_id: 26, qty: 5, desc: "Alcance nível 20.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 25, item_id: 26, qty: 5, desc: "Alcance nível 25.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 30, item_id: 26, qty: 5, desc: "Alcance nível 30.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" }
    ],
    afk: [
        { req: 5, crystals: 100, qty: 100, desc: "Alcance o estágio 5 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 10, crystals: 500, qty: 500, desc: "Alcance o estágio 10 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 15, crystals: 1500, qty: 1500, desc: "Alcance o estágio 15 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 20, crystals: 2500, qty: 2500, desc: "Alcance o estágio 20 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 25, crystals: 3000, qty: 3000, desc: "Alcance o estágio 25 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 30, crystals: 3000, qty: 3000, desc: "Alcance o estágio 30 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 35, crystals: 3000, qty: 3000, desc: "Alcance o estágio 35 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 40, crystals: 3000, qty: 3000, desc: "Alcance o estágio 40 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 50, item_id: 42, qty: 3, desc: "Alcance o estágio 50 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/itens/cartaoavancado.webp" },
        { req: 60, crystals: 3000, qty: 3000, desc: "Alcance o estágio 60 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 70, crystals: 3000, qty: 3000, desc: "Alcance o estágio 70 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 80, crystals: 3000, qty: 3000, desc: "Alcance o estágio 80 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 90, crystals: 3000, qty: 3000, desc: "Alcance o estágio 90 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 100, crystals: 5000, qty: 5000, desc: "Alcance o estágio 100 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" }
    ],
    misc: [
        { req_type: "inventory", crystals: 200, qty: 200, desc: "Construa ou adquira um novo equipamento na bolsa.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req_type: "mine_attack", crystals: 500, qty: 500, desc: "Dispute uma mina de cristal.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req_type: "buy_raid_attack", gold: 10, qty: 10, desc: "Compre um ataque na Raid de guilda.", img: "https://aden-rpg.pages.dev/assets/goldcoin.webp" }
    ]
};

// =======================================================================
// FUNÇÃO PARA LIDAR COM AÇÕES NA URL (REABRIR LOJA OU ABRIR PV)
// =======================================================================
async function handleUrlActions() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    if (action === 'openShopVideo') {
        const shopModal = document.getElementById('shopModal');
        if (shopModal) {
            shopModal.style.display = 'flex';
        }
        const videoTabButton = document.querySelector('.shop-tab-btn[data-tab="shop-video"]');
        if (videoTabButton) {
            videoTabButton.click();
        }
        history.replaceState(null, '', window.location.pathname);

    } else if (action === 'open_pv') {
        const targetId = urlParams.get('target_id');
        const targetName = urlParams.get('target_name');

        if (targetId && targetName) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                showFloatingMessage("Você precisa estar logado para iniciar uma conversa.");
                return;
            }

            showFloatingMessage(`Abrindo conversa com ${targetName}...`);

            try {
                const { data, error } = await supabaseClient.rpc('get_or_create_private_conversation', {
                    target_player_id: targetId
                });

                if (error) throw error;

                const conversationId = data.conversation_id;
                const pvModal = document.getElementById('pvModal');
                
                if (pvModal) {
                    pvModal.style.display = 'flex';
                    if (window.openChatView) {
                        await window.openChatView(conversationId, targetName);
                    } else {
                        console.error('A função window.openChatView não está pronta.');
                        showFloatingMessage('Erro ao carregar o chat. Tente novamente.');
                    }
                }
            } catch (err) {
                console.error("Erro ao tentar abrir PV a partir da URL:", err);
                showFloatingMessage(`Erro ao abrir conversa: ${err.message}`);
            }

            history.replaceState(null, '', window.location.pathname);
        }
    }
}


// Cache de definições de itens para uso no Espiral e outras funcionalidades
let itemDefinitions = new Map();

// Elementos da UI
const authContainer = document.getElementById('authContainer');
const playerInfoDiv = document.getElementById('playerInfoDiv');
const authMessage = document.getElementById('authMessage');

const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');
const otpInputContainer = document.getElementById('otpInputContainer');
const otpInput = document.getElementById('otpInput');
const verifyOtpBtn = document.getElementById('verifyOtpBtn');

const profileEditModal = document.getElementById('profileEditModal');
const editPlayerNameInput = document.getElementById('editPlayerName');
const editPlayerFactionSelect = document.getElementById('editPlayerFaction');
const profileEditMessage = document.getElementById('profileEditMessage');

const welcomeContainer = document.getElementById('welcomeContainer');

const floatingMessageDiv = document.getElementById('floatingMessage');
const footerMenu = document.getElementById('footerMenu');
// const homeBtn = document.getElementById('homeBtn'); // REMOVIDO

// --- Elementos para recuperação de senha ---
const forgotPasswordLink = document.getElementById('forgotPasswordLink');
const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const forgotPasswordEmailInput = document.getElementById('forgotPasswordEmailInput');
const sendRecoveryCodeBtn = document.getElementById('sendRecoveryCodeBtn');
const closeForgotPasswordModalBtn = document.getElementById('closeForgotPasswordModalBtn');
const forgotPasswordMessage = document.getElementById('forgotPasswordMessage');

const verifyRecoveryModal = document.getElementById('verifyRecoveryModal');
const recoveryEmailDisplay = document.getElementById('recoveryEmailDisplay');
const recoveryCodeInput = document.getElementById('recoveryCodeInput');
const newPasswordInput = document.getElementById('newPasswordInput');
const updatePasswordBtn = document.getElementById('updatePasswordBtn');
const closeVerifyRecoveryModalBtn = document.getElementById('closeVerifyRecoveryModalBtn');
const verifyRecoveryMessage = document.getElementById('verifyRecoveryMessage');

// --- Elementos da Loja ---
const shopModal = document.getElementById('shopModal');
const shopMessage = document.getElementById('shopMessage');
const closeShopModalBtn = document.getElementById('closeShopModalBtn');

// --- Elementos do Modal de Confirmação de Compra ---
const purchaseConfirmModal = document.getElementById('purchaseConfirmModal');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmPurchaseFinalBtn = document.getElementById('confirmPurchaseFinalBtn');
const cancelPurchaseBtn = document.getElementById('cancelPurchaseBtn');


// Função para carregar definições de itens no cache local (MODIFICADA COM CACHE PERSISTENTE)
async function loadItemDefinitions() {
    const CACHE_KEY = 'item_definitions_cache';
    const CACHE_TTL_24H = 1440; // 24 horas * 60 minutos

    // 1. Tenta carregar do cache em memória (RAM) - lógica original
    if (itemDefinitions.size > 0) return;

    // 2. Tenta carregar do cache persistente (LocalStorage)
    const cachedData = getCache(CACHE_KEY, CACHE_TTL_24H);
    if (cachedData) {
        // Recria o Map a partir dos dados [key, value] salvos no cache
        try {
             itemDefinitions = new Map(cachedData);
             console.log('Definições de itens carregadas do LocalStorage.');
             return;
        } catch(e) {
            console.warn("Falha ao parsear cache de itens, buscando novamente.", e);
            localStorage.removeItem(CACHE_KEY); // Limpa cache corrompido
        }
    }

    // 3. Se não houver cache, busca no Supabase
    console.log('Buscando definições de itens do Supabase...');
    const { data, error } = await supabaseClient.from('items').select('item_id, name');
    if (error) {
        console.error('Erro ao carregar definições de itens:', error);
        return;
    }
    
    const dataForCache = []; // Array [key, value] para salvar no localStorage
    for (const item of data) {
        itemDefinitions.set(item.item_id, item);
        dataForCache.push([item.item_id, item]); // Salva como [key, value]
    }
    
    // 4. Salva no cache persistente para a próxima vez com TTL de 24h
    setCache(CACHE_KEY, dataForCache, CACHE_TTL_24H);
    console.log('Definições de itens carregadas do Supabase e salvas no cache.');
}

// Funções de Notificação Flutuante
function showFloatingMessage(message, duration = 5000) {
    if (!floatingMessageDiv) return;
    floatingMessageDiv.textContent = message;
    floatingMessageDiv.style.display = 'block';
    floatingMessageDiv.offsetWidth;
    floatingMessageDiv.style.opacity = '1';
    setTimeout(() => {
        floatingMessageDiv.style.opacity = '0';
        setTimeout(() => {
            floatingMessageDiv.style.display = 'none';
        }, 500);
    }, duration);
}
window.showFloatingMessage = showFloatingMessage; // Expor globalmente

// Funções de Autenticação
async function signIn() {
    const email = emailInput.value;
    const password = passwordInput.value;
    authMessage.textContent = 'Tentando entrar...';
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        authMessage.textContent = `Erro ao entrar: ${error.message}`;
    }
}

async function signUp() {
    const email = emailInput.value;
    const password = passwordInput.value;
    authMessage.textContent = 'Enviando código de confirmação...';

    const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: {
            emailRedirectTo: window.location.origin
        }
    });

    if (error) {
        authMessage.textContent = `Erro ao registrar: ${error.message}`;
    } else {
        authMessage.textContent = 'Código de confirmação enviado para seu e-mail! Verifique a caixa de spam, caso não receba.';
        signInBtn.style.display = 'none';
        signUpBtn.style.display = 'none';
        passwordInput.style.display = 'none';
        otpInputContainer.style.display = 'block';
    }
}

async function verifyOtp() {
    const email = emailInput.value;
    const token = otpInput.value;
    authMessage.textContent = 'Verificando código...';

    const { error } = await supabaseClient.auth.verifyOtp({
        email,
        token,
        type: 'email'
    });

    if (error) {
        authMessage.textContent = `Erro ao verificar código: ${error.message}`;
    }
}

async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Erro ao sair:', error.message);
    }
        window.location.reload();
}

// Função helper para renderizar a UI com os dados do jogador
function renderPlayerUI(player, preserveActiveContainer = false) {
    authContainer.style.display = 'none';
    playerInfoDiv.innerHTML = `
      <p>Olá, ${player.name}!</p>
      <p>Facção: ${player.faction}</p>
      <p>Ataque: ${player.min_attack} - ${player.attack}</p>
      <p>Defesa: ${player.defense}</p>
      <p>HP: ${player.health ?? 0}</p>
      <p>Taxa Crítica: ${player.crit_chance ?? 0}%</p>
      <p>Dano Crítico: ${player.crit_damage ?? 0}%</p>
      <p>Evasão: ${player.evasion ?? 0}%</p>
      <button id="editProfileBtn">Editar Perfil</button>
      <button id="signOutBtn">Deslogar</button>
    `;
    const editProfileBtn = playerInfoDiv.querySelector('#editProfileBtn');
    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', () => {
            document.getElementById('editProfileIcon').click();
        });
    }
    document.getElementById('playerAvatar').src = player.avatar_url || 'https://aden-rpg.pages.dev/avatar01.webp';
    document.getElementById('playerNameText').textContent = player.name;
    document.getElementById('playerLevel').textContent = `Nv. ${player.level}`;
    document.getElementById('playerPower').textContent = formatNumberCompact(player.combat_power);
    document.getElementById('playerGold').innerHTML = `<img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width: 22px; height: 17px; vertical-align: -4px;"> ${formatNumberCompact(player.gold)}`;
    document.getElementById('playerCrystals').innerHTML = `<img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="width: 17px; height: 17px; vertical-align: -4px;"> ${formatNumberCompact(player.crystals)}`;
    const xpPercent = Math.min(100, Math.floor((player.xp / player.xp_needed_for_level) * 100));
    document.getElementById('xpBarContainer').style.display = 'flex';
    document.getElementById('xpBar').style.width = `${xpPercent}%`;
    document.getElementById('xpText').textContent = `${player.xp} / ${player.xp_needed_for_level}`;
    document.getElementById('playerTopBar').style.display = 'flex';
    if (welcomeContainer && player && player.name) {
        welcomeContainer.innerHTML = `
            <div id="mapContainer">
                <div id="mapImage"></div>
            </div>
        `;
    }
if (!preserveActiveContainer) {
        updateUIVisibility(true, 'welcomeContainer');
    }
}

// Nova função auxiliar para aplicar os bônus dos itens aos atributos
function applyItemBonuses(player, equippedItems) {
    let combinedStats = { ...player };
    equippedItems.forEach(invItem => {
        if (invItem.items) {
            combinedStats.min_attack += invItem.items.min_attack || 0;
            combinedStats.attack += invItem.items.attack || 0;
            combinedStats.defense += invItem.items.defense || 0;
            combinedStats.health += invItem.items.health || 0;
            combinedStats.crit_chance += invItem.items.crit_chance || 0;
            combinedStats.crit_damage += invItem.items.crit_damage || 0;
            combinedStats.evasion += invItem.items.evasion || 0;
        }
        combinedStats.min_attack += invItem.min_attack_bonus || 0;
        combinedStats.attack += invItem.attack_bonus || 0;
        combinedStats.defense += invItem.defense_bonus || 0;
        combinedStats.health += invItem.health_bonus || 0;
        combinedStats.crit_chance += invItem.crit_chance_bonus || 0;
        combinedStats.crit_damage += invItem.crit_damage_bonus || 0;
        combinedStats.evasion += invItem.evasion_bonus || 0;
    });
    return combinedStats;
}

// Função principal para buscar e exibir as informações do jogador (MODIFICADA COM CACHE)
async function fetchAndDisplayPlayerInfo(forceRefresh = false, preserveActiveContainer = false) {
    
    const PLAYER_CACHE_KEY = 'player_data_cache';
    const PLAYER_CACHE_TTL = 15; // 5 minutos. 24 horas (1440) quebraria a UI.

    // 1. Tenta usar o cache se forceRefresh NÃO for true
    if (!forceRefresh) {
        const cachedPlayer = getCache(PLAYER_CACHE_KEY, PLAYER_CACHE_TTL);
        if (cachedPlayer) {
            // console.log("Carregando dados do jogador do cache (5 min).");
            currentPlayerData = cachedPlayer;
            currentPlayerId = cachedPlayer.id; // Garante que o ID esteja setado
            renderPlayerUI(cachedPlayer, preserveActiveContainer);
            checkProgressionNotifications(cachedPlayer);
            return; // Sai da função, usou o cache
        }
    }
    
    // console.log("Buscando dados do jogador do Supabase (Cache expirado ou forçado).");

    // 2. Se não houver cache ou se forceRefresh=true, busca no Supabase
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        updateUIVisibility(false);
        currentPlayerData = null; // Limpa dados do jogador ao deslogar
        localStorage.removeItem(PLAYER_CACHE_KEY); // Limpa o cache ao deslogar
        return;
    }
    
    currentPlayerId = user.id; // Armazena o ID do usuário

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('*') // Busca todas as colunas
        .eq('id', user.id)
        .single();
        
    if (playerError || !player) {
        updateUIVisibility(false);
        currentPlayerData = null; // Limpa dados em caso de erro
        localStorage.removeItem(PLAYER_CACHE_KEY); // Limpa o cache em caso de erro
        return;
    }

    const { data: equippedItems, error: itemsError } = await supabaseClient
        .from('inventory_items')
        .select(`
            equipped_slot,
            min_attack_bonus,
            attack_bonus,
            defense_bonus,
            health_bonus,
            crit_chance_bonus,
            crit_damage_bonus,
            evasion_bonus,
            items (
                name,
                min_attack,
                attack,
                defense,
                health,
                crit_chance,
                crit_damage,
                evasion
            )
        `)
        .eq('player_id', user.id)
        .neq('equipped_slot', null);

    if (itemsError) {
        console.error('Erro ao buscar itens equipados:', itemsError.message);
    }

    const playerWithEquips = applyItemBonuses(player, equippedItems || []);
    playerWithEquips.combat_power = Math.floor(
        (playerWithEquips.attack * 12.5) +
        (playerWithEquips.min_attack * 1.5) +
        (playerWithEquips.crit_chance * 5.35) +
        (playerWithEquips.crit_damage * 6.5) +
        (playerWithEquips.defense * 2) +
        (playerWithEquips.health * 3.2625) +
        (playerWithEquips.evasion * 1)
    );

    // Armazena os dados completos do jogador (com bônus) globalmente
    currentPlayerData = playerWithEquips;
    
    // 3. Salva os dados frescos no cache
    setCache(PLAYER_CACHE_KEY, playerWithEquips, PLAYER_CACHE_TTL);

    renderPlayerUI(playerWithEquips, preserveActiveContainer);
    
    // Verifica notificações de progressão
    checkProgressionNotifications(playerWithEquips);

    if (playerWithEquips.name === 'Nome') {
        document.getElementById('editPlayerName').value = '';
        profileEditModal.style.display = 'flex';
    }
}
// === Botão de copiar ID do jogador ===
document.addEventListener('DOMContentLoaded', () => {
  const copiarIdDiv = document.getElementById('copiarid');
  if (!copiarIdDiv) return;

  copiarIdDiv.addEventListener('click', async () => {
    if (!currentPlayerId) {
      showFloatingMessage('ID do jogador ainda não carregado.');
      return;
    }

    try {
      await navigator.clipboard.writeText(currentPlayerId);

      const originalText = copiarIdDiv.textContent.trim();
      copiarIdDiv.classList.add('copied');
      copiarIdDiv.textContent = 'Copiado!';

      // Reinsere o ícone SVG junto do texto
      copiarIdDiv.insertAdjacentHTML('afterbegin', `
       
      `);

      setTimeout(() => {
        copiarIdDiv.classList.remove('copied');
        copiarIdDiv.textContent = originalText;
        copiarIdDiv.insertAdjacentHTML('afterbegin', `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style="margin-right: 4px; vertical-align: middle;">
        <path d="M4 1.5H14V11.5H4V1.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="M12 4.5V14.5H2V4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
        `);
      }, 3000);
    } catch (err) {
      console.error('Falha ao copiar ID:', err);
      showFloatingMessage('Não foi possível copiar o ID.');
    }
  });
});


// --- Recuperação de senha com token ---
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', e => {
        e.preventDefault();
        forgotPasswordModal.style.display = 'flex';
        forgotPasswordMessage.textContent = '';
    });
}
if (closeForgotPasswordModalBtn) {
    closeForgotPasswordModalBtn.addEventListener('click', () => {
        forgotPasswordModal.style.display = 'none';
    });
}
if (sendRecoveryCodeBtn) {
    sendRecoveryCodeBtn.addEventListener('click', async () => {
        const email = forgotPasswordEmailInput.value;
        if (!email) {
            forgotPasswordMessage.textContent = 'Informe um e-mail válido.';
            return;
        }
        forgotPasswordMessage.textContent = 'Enviando código...';
        const { error } = await supabaseClient.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false }
        });
        if (error) {
            forgotPasswordMessage.textContent = `Erro: ${error.message}`;
        } else {
            forgotPasswordMessage.textContent = 'Código enviado! Verifique seu e-mail.';
            forgotPasswordModal.style.display = 'none';
            verifyRecoveryModal.style.display = 'flex';
            recoveryEmailDisplay.value = email;
        }
    });
}
if (closeVerifyRecoveryModalBtn) {
    closeVerifyRecoveryModalBtn.addEventListener('click', () => {
        verifyRecoveryModal.style.display = 'none';
    });
}
if (updatePasswordBtn) {
    updatePasswordBtn.addEventListener('click', async () => {
        const email = recoveryEmailDisplay.value;
        const token = recoveryCodeInput.value;
        const newPassword = newPasswordInput.value;
        if (!email || !token || !newPassword) {
            verifyRecoveryMessage.textContent = 'Preencha todos os campos.';
            return;
        }
        if (newPassword.length < 6) {
            verifyRecoveryMessage.textContent = 'A senha deve ter pelo menos 6 caracteres.';
            return;
        }
        const { error: verifyError } = await supabaseClient.auth.verifyOtp({
            email,
            token,
            type: 'recovery'
        });
        if (verifyError) {
            verifyRecoveryMessage.textContent = `Erro: ${verifyError.message}`;
            return;
        }
        const { error: updateError } = await supabaseClient.auth.updateUser({ password: newPassword });
        if (updateError) {
            verifyRecoveryMessage.textContent = `Erro: ${updateError.message}`;
            return;
        }
        verifyRecoveryMessage.textContent = 'Senha atualizada! Faça login novamente.';
        setTimeout(() => {
            verifyRecoveryModal.style.display = 'none';
            window.location.reload();
        }, 2500);
    });
}

// --- UI ---
window.updateUIVisibility = (isLoggedIn, activeContainerId = null) => {
    if (isLoggedIn) {
        authContainer.style.display = 'none';
        footerMenu.style.display = 'flex';
        welcomeContainer.style.display = 'block';
    } else {
        // Exibe corretamente o container de autenticação quando o usuário NÃO está logado
        if (authContainer) authContainer.style.display = 'block';
        if (welcomeContainer) welcomeContainer.style.display = 'none';
        if (footerMenu) footerMenu.style.display = 'none';
        if (signInBtn) signInBtn.style.display = 'block';
        if (signUpBtn) signUpBtn.style.display = 'block';
        if (passwordInput) passwordInput.style.display = 'block';
        if (otpInputContainer) otpInputContainer.style.display = 'none';
        if (authMessage) authMessage.textContent = '';
    }
};

// Eventos
signInBtn.addEventListener('click', signIn);
signUpBtn.addEventListener('click', signUp);
verifyOtpBtn.addEventListener('click', verifyOtp);
// homeBtn.addEventListener('click', () => { // REMOVIDO
//     updateUIVisibility(true, 'welcomeContainer');
//     fetchAndDisplayPlayerInfo(true, true);
//     showFloatingMessage("Você está na página inicial!");
// });

// Sessão e inicialização
supabaseClient.auth.onAuthStateChange(async (event, session) => {
    try {
        if (session) {
            // Session ativa: carrega os dados do jogador de forma resiliente
            await fetchAndDisplayPlayerInfo().then(() => {
                // Após carregar o jogador, processa ações da URL (se houver)
                try { handleUrlActions(); } catch(e){ console.warn('handleUrlActions erro', e); }
            }).catch(err => {
                console.error('Erro em fetchAndDisplayPlayerInfo dentro do onAuthStateChange:', err);
            });
        } else {
            // Sem sessão: mostra a tela de login
            updateUIVisibility(false);
        }
    } catch (err) {
        console.error('onAuthStateChange handler error', err);
        updateUIVisibility(false);
    }
});

// Checagem inicial ao carregar a página para garantir que a UI mostre o login quando apropriado
(async function _initialAuthCheck(){
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            // sem usuário -> mostra login
            updateUIVisibility(false);
        } else {
            // já logado -> carrega dados e ações de URL
            await fetchAndDisplayPlayerInfo().then(() => {
                try { handleUrlActions(); } catch(e){ console.warn('handleUrlActions erro', e); }
            });
        }
    } catch (e) {
        console.error('Erro no _initialAuthCheck:', e);
        updateUIVisibility(false);
    }
})();
        });
    } else {
        updateUIVisibility(false);
    }
});



// --- Modal de avatar ---
document.addEventListener('DOMContentLoaded', () => {
    const avatar = document.getElementById('playerAvatar');
    const modal = document.getElementById('playerInfoModal');
    const modalContent = document.getElementById('modalPlayerInfoContent');
    const closeBtn = document.getElementById('closePlayerInfoBtn');
    if (avatar && modal && closeBtn && modalContent && playerInfoDiv) {
        avatar.addEventListener('click', () => {
            modalContent.innerHTML = playerInfoDiv.innerHTML;
            modal.style.display = 'flex';
            const modalEditProfileBtn = modal.querySelector('#editProfileBtn');
            if (modalEditProfileBtn) {
                modalEditProfileBtn.onclick = () => {
                    modal.style.display = 'none';
                    document.getElementById('editProfileIcon').click();
                };
            }
            const modalSignOutBtn = modal.querySelector('#signOutBtn');
            if (modalSignOutBtn) {
                modalSignOutBtn.onclick = () => {
                    modal.style.display = 'none';
                    signOut();
                };
            }
        });
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
});
document.getElementById('editProfileIcon').onclick = () => {
    profileEditModal.style.display = 'flex';
};
const closeProfileModalBtn = document.getElementById('closeProfileModalBtn');
if (closeProfileModalBtn) {
    closeProfileModalBtn.onclick = () => {
        profileEditModal.style.display = 'none';
    };
}

// === MENU LATERAL (LOSANGOS) ===
document.addEventListener("DOMContentLoaded", () => {
  
  // Carrega as definições de itens ao iniciar a página (agora usa cache).
  loadItemDefinitions();
    
  const missionsBtn = document.getElementById("missionsBtn");
  const missionsSub = document.getElementById("missionsSubmenu");
  const moreBtn = document.getElementById("moreBtn");
  const moreSub = document.getElementById("moreSubmenu");

  function toggleSubmenu(btn, submenu) {
    const isVisible = submenu.style.display === "flex";
    document.querySelectorAll("#sideMenu .submenu").forEach(s => s.style.display = "none");
    if (!isVisible) {
      submenu.style.display = "flex";
      const btnRect = btn.getBoundingClientRect();
      submenu.style.top = btn.offsetTop + btn.offsetHeight / 2 + "px";
    }
  }

  missionsBtn.addEventListener("click", () => toggleSubmenu(missionsBtn, missionsSub));
  moreBtn.addEventListener("click", () => toggleSubmenu(moreBtn, moreSub));

  document.addEventListener("click", e => {
    if (!e.target.closest("#sideMenu")) {
      document.querySelectorAll("#sideMenu .submenu").forEach(s => s.style.display = "none");
    }
  });

  const modal = document.getElementById("genericModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalMessage = document.getElementById("modalMessage");
  const closeModal = document.getElementById("closeGenericModal");

  const modalMessages = {
    tarefasModal: "Tarefas em breve!",
    // "progressaoModal" removido daqui
    comercioModal: "Comércio em breve!",
    rankingModal: "Ranking em breve!",
    petsModal: "Pets em breve!"
  };

  document.querySelectorAll("#sideMenu .menu-item[data-modal]").forEach(item => {
    item.addEventListener("click", () => {
      const key = item.getAttribute("data-modal");

      if (key === "espiralModal") {
        openSpiralModal();
        return;
      }
      
      // NOVA LÓGICA PARA PROGRESSÃO
      if (key === "progressaoModal") {
        openProgressionModal();
        return;
      }
      
      if (key === "lojaModal") {
        openShopModal();
        return;
      }
      
      if (key === "bolsaModal") {
        window.location.href = "/inventory.html";
        return;
      }
      if (key === "pvModal") {
        document.getElementById('pvModal').style.display = "flex";
        return;
      }

      if (modalMessages[key]) {
        modalTitle.textContent = item.querySelector("span").textContent;
        modalMessage.textContent = modalMessages[key];
        modal.style.display = "flex";
      }
    });
  });

  closeModal.addEventListener("click", () => {
    modal.style.display = "none";
  });
  
  // Listener para fechar o novo modal de progressão
  const closeProgressionBtn = document.getElementById('closeProgressionModalBtn');
  if (closeProgressionBtn) {
      closeProgressionBtn.addEventListener('click', closeProgressionModal);
  }

  // ===============================================
  // === INÍCIO - LÓGICA DO NOVO FOOTER MENU ===
  // ===============================================
  const recursosBtn = document.getElementById('recursosBtn');
  const pvpBtnFooter = document.getElementById('pvpBtnFooter');
  const maisBtnFooter = document.getElementById('maisBtnFooter');

  const recursosSubmenu = document.getElementById('recursosSubmenu');
  const pvpSubmenu = document.getElementById('pvpSubmenu');
  const maisSubmenu = document.getElementById('maisSubmenu');

  const allSubmenus = [recursosSubmenu, pvpSubmenu, maisSubmenu];

  function closeAllFooterSubmenus() {
      allSubmenus.forEach(submenu => {
          if (submenu) submenu.style.display = 'none';
      });
  }

  function toggleFooterSubmenu(submenu, button) {
      if (!submenu || !button) return;
      
      const isVisible = submenu.style.display === 'flex';
      closeAllFooterSubmenus();

      if (!isVisible) {
          submenu.style.display = 'flex';
          
          // Posiciona o submenu acima do botão
          const btnRect = button.getBoundingClientRect();
          const footerRect = document.getElementById('footerMenu').getBoundingClientRect();
          submenu.style.bottom = (window.innerHeight - footerRect.top) + 5 + 'px'; // 5px de espaço

          // Centraliza o submenu horizontalmente com o botão
          const submenuRect = submenu.getBoundingClientRect();
          let newLeft = (btnRect.left + (btnRect.width / 2) - (submenuRect.width / 2));

          // Ajusta se sair da tela
          if (newLeft < 5) { newLeft = 5; }
          if ((newLeft + submenuRect.width) > (window.innerWidth - 5)) { 
              newLeft = (window.innerWidth - submenuRect.width - 5);
          }
          
          submenu.style.left = newLeft + 'px';
      }
  }

  if (recursosBtn) {
      recursosBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Impede que o 'document' click feche imediatamente
          toggleFooterSubmenu(recursosSubmenu, recursosBtn);
      });
  }
  if (pvpBtnFooter) {
      pvpBtnFooter.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFooterSubmenu(pvpSubmenu, pvpBtnFooter);
      });
  }
  if (maisBtnFooter) {
      maisBtnFooter.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFooterSubmenu(maisSubmenu, maisBtnFooter);
      });
  }

  // Fecha submenus ao clicar em qualquer outro lugar
  // Adiciona ao listener 'click' principal do 'document' que já existe para o sideMenu
  const originalDocClickListener = document.onclick;
  document.addEventListener('click', (e) => {
      // Chama o listener original se existir
      if (typeof originalDocClickListener === 'function') {
          originalDocClickListener(e);
      }

      // Lógica para fechar os submenus do footer
      if (!e.target.closest('.footer-submenu') && !e.target.closest('.footer-btn')) {
          closeAllFooterSubmenus();
      }
  });
  // ===============================================
  // === FIM - LÓGICA DO NOVO FOOTER MENU ===
  // ===============================================

});


// ===============================================
// === LÓGICA DO SISTEMA DE PROGRESSÃO (NOVO) ===
// ===============================================

/**
 * Verifica se há missões de progressão resgatáveis (APENAS Level e AFK).
 * Isso é rápido e pode ser chamado após o login.
 */
function checkProgressionNotifications(player) {
    if (!player) return;

    const missionsDot = document.getElementById('missionsNotificationDot');
    const progressionDot = document.getElementById('progressionNotificationDot');
    if (!missionsDot || !progressionDot) return;

    let hasClaimable = false;
    const state = player.progression_state || { level: 0, afk: 0, misc: 0 };

    // 1. Checar Nível
    const levelIndex = state.level || 0;
    if (levelIndex < mission_definitions.level.length) {
        const currentMission = mission_definitions.level[levelIndex];
        if (player.level >= currentMission.req) {
            hasClaimable = true;
        }
    }

    // 2. Checar AFK (só checa se ainda não achou resgatável)
    if (!hasClaimable) {
        const afkIndex = state.afk || 0;
        if (afkIndex < mission_definitions.afk.length) {
            const currentMission = mission_definitions.afk[afkIndex];
            if (player.current_afk_stage >= currentMission.req) {
                hasClaimable = true;
            }
        }
    }
    
    // 3. Checar Misc (só checa se ainda não achou resgatável)
    // Vamos checar apenas os que não exigem busca no inventário (Misc 2 e 3)
     if (!hasClaimable) {
        const miscIndex = state.misc || 0;
        if (miscIndex === 1) { // Missão "Dispute uma mina"
             if (player.last_attack_time) {
                hasClaimable = true;
             }
        } else if (miscIndex === 2) { // Missão "Compre um ataque na Raid"
            if (player.raid_attacks_bought_count > 0) {
                hasClaimable = true;
            }
        }
    }


    missionsDot.style.display = hasClaimable ? 'block' : 'none';
    progressionDot.style.display = hasClaimable ? 'block' : 'none';
}

/**
 * Abre o modal de progressão e chama a renderização
 */
function openProgressionModal() {
    const modal = document.getElementById('progressionModal');
    if (modal) {
        modal.style.display = 'flex';
        renderProgressionModal();
    }
}

/**
 * Fecha o modal de progressão
 */
function closeProgressionModal() {
    const modal = document.getElementById('progressionModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Renderiza o conteúdo do modal de progressão
 */
async function renderProgressionModal() {
    const container = document.getElementById('progressionListContainer');
    if (!container) return;

    if (!currentPlayerData) {
        container.innerHTML = '<p>Erro ao carregar dados do jogador. Tente novamente.</p>';
        return;
    }
    
    container.innerHTML = ''; // Limpa o conteúdo
    const player = currentPlayerData;
    const state = player.progression_state || { level: 0, afk: 0, misc: 0 };

    // --- Categoria 1: Nível ---
    const levelIndex = state.level || 0;
    const levelCatDiv = document.createElement('div');
    levelCatDiv.className = 'progression-category';
    levelCatDiv.innerHTML = '<h3>Progresso de Nível</h3>';
    
    if (levelIndex >= mission_definitions.level.length) {
        levelCatDiv.innerHTML += '<p class="mission-complete-message">Missões dessa categoria completas!</p>';
    } else {
        const mission = mission_definitions.level[levelIndex];
        const canClaim = player.level >= mission.req;
        levelCatDiv.innerHTML += `
            <div class="mission-item">
                <div class="mission-reward">
                    <img src="${mission.img}" alt="Recompensa">
                    <span>x${mission.qty}</span>
                </div>
                <div class="mission-details">
                    <p>${mission.desc}</p>
                </div>
                <div class="mission-actions">
                    <button class="claim-btn" data-category="level" ${canClaim ? '' : 'disabled'}>
                        Resgatar
                    </button>
                </div>
            </div>
        `;
    }
    container.appendChild(levelCatDiv);

    // --- Categoria 2: AFK ---
    const afkIndex = state.afk || 0;
    const afkCatDiv = document.createElement('div');
    afkCatDiv.className = 'progression-category';
    afkCatDiv.innerHTML = '<h3>Progresso de Aventura (AFK)</h3>';

    if (afkIndex >= mission_definitions.afk.length) {
        afkCatDiv.innerHTML += '<p class="mission-complete-message">Missões dessa categoria completas!</p>';
    } else {
        const mission = mission_definitions.afk[afkIndex];
        const canClaim = player.current_afk_stage >= mission.req;
        afkCatDiv.innerHTML += `
            <div class="mission-item">
                <div class="mission-reward">
                    <img src="${mission.img}" alt="Recompensa">
                    <span>x${mission.qty}</span>
                </div>
                <div class="mission-details">
                    <p>${mission.desc}</p>
                </div>
                <div class="mission-actions">
                    <button class="claim-btn" data-category="afk" ${canClaim ? '' : 'disabled'}>
                        Resgatar
                    </button>
                </div>
            </div>
        `;
    }
    container.appendChild(afkCatDiv);

    // --- Categoria 3: Diversos ---
    const miscIndex = state.misc || 0;
    const miscCatDiv = document.createElement('div');
    miscCatDiv.className = 'progression-category';
    miscCatDiv.innerHTML = '<h3>Missões Diversas</h3>';

    if (miscIndex >= mission_definitions.misc.length) {
        miscCatDiv.innerHTML += '<p class="mission-complete-message">Missões dessa categoria completas!</p>';
    } else {
        const mission = mission_definitions.misc[miscIndex];
        // A verificação de "canClaim" para "misc" é assíncrona ou depende de dados variados
        const canClaim = await checkMiscRequirement(miscIndex, player);
        miscCatDiv.innerHTML += `
            <div class="mission-item">
                <div class="mission-reward">
                    <img src="${mission.img}" alt="Recompensa">
                    <span>x${mission.qty}</span>
                </div>
                <div class="mission-details">
                    <p>${mission.desc}</p>
                </div>
                <div class="mission-actions">
                    <button class="claim-btn" data-category="misc" ${canClaim ? '' : 'disabled'}>
                        Resgatar
                    </button>
                </div>
            </div>
        `;
    }
    container.appendChild(miscCatDiv);
    
    // Adiciona listeners aos botões de resgate
    container.querySelectorAll('.claim-btn').forEach(btn => {
        btn.addEventListener('click', handleProgressionClaim);
    });
}

/**
 * Verifica o requisito para a missão "misc" atual.
 */
async function checkMiscRequirement(missionIndex, player) {
    if (missionIndex === 0) {
        // "Construa ou adquira um novo equipamento na bolsa."
        try {
            // Tenta usar RPC (se você a criou)
             const { data, error: rpcError } = await supabaseClient
                .rpc('count_player_equipment', { p_player_id: player.id });

            if (rpcError) {
                 // Fallback para a query com JOIN (mais lenta)
                 console.warn("RPC count_player_equipment não encontrada, usando query com join.");
                 const { count: inventoryCount, error: inventoryError } = await supabaseClient
                    .from('inventory_items')
                    .select('items!inner(item_type)', { count: 'exact', head: true }) //
                    .eq('player_id', player.id)
                    .in('items.item_type', ['arma', 'armadura', 'anel', 'colar', 'elmo', 'asa']); //
                
                if(inventoryError) throw inventoryError;
                return (inventoryCount || 0) > 0;
            }
            
            return (data || 0) > 0;

        } catch (err) {
            console.error("Erro ao checar inventário para missão misc 0:", err);
            // Fallback 2 (caso a primeira query falhe por algum motivo)
             try {
                const { count: finalCount, error: finalError } = await supabaseClient
                    .from('inventory_items')
                    .select('items!inner(item_type)', { count: 'exact', head: true }) //
                    .eq('player_id', player.id)
                    .in('items.item_type', ['arma', 'armadura', 'anel', 'colar', 'elmo', 'asa']); //
                if (finalError) return false;
                return (finalCount || 0) > 0;
             } catch(e) { return false; }
        }
    } else if (missionIndex === 1) {
        // "Dispute uma mina de cristal."
        return !!player.last_attack_time; // Retorna true se last_attack_time não for null/undefined
    } else if (missionIndex === 2) {
        // "Compre um ataque na Raid de guilda."
        return (player.raid_attacks_bought_count || 0) > 0; //
    }
    return false;
}

/**
 * Lida com o clique no botão "Resgatar" (MODIFICADO PARA ATUALIZAR O CACHE)
 */
async function handleProgressionClaim(event) {
    const button = event.target;
    const category = button.dataset.category;
    if (!category) return;

    button.disabled = true;
    button.textContent = "Aguarde...";

    try {
        // *** CORREÇÃO APLICADA AQUI ***
        // Removido o underscore "_" extra
        const { data, error } = await supabaseClient.rpc('claim_progression_reward', {
            p_category: category
        });

        if (error) throw new Error(error.message);

        showFloatingMessage(data.message || 'Recompensa resgatada com sucesso!');

        // MODIFICADO: Em vez de atualizar manualmente, força um refresh
        // que atualizará a UI, o cache e a variável global 'currentPlayerData'.
        // O segundo 'true' (preserveActiveContainer) é vital para não fechar o modal.
        await fetchAndDisplayPlayerInfo(true, true); 

        // A checagem de notificação agora usará o 'currentPlayerData' atualizado pela função acima
        checkProgressionNotifications(currentPlayerData);
        
        // Re-renderiza o modal de progressão
        await renderProgressionModal();

    } catch (error) {
        console.error(`Erro ao resgatar recompensa [${category}]:`, error);
        showFloatingMessage(`Erro: ${error.message.replace('Error: ', '')}`);
        // Re-habilita o botão em caso de erro
        button.disabled = false;
        button.textContent = "Resgatar";
    }
}


// ===============================================
// === LÓGICA DO SISTEMA DE ESPIRAL (Gacha) ===
// ===============================================

const spiralModal = document.getElementById('spiralModal');
const commonSpiralTab = document.querySelector('.tab-btn[data-tab="common"]');
const advancedSpiralTab = document.querySelector('.tab-btn[data-tab="advanced"]');
const commonSpiralContent = document.getElementById('common-spiral');
const advancedSpiralContent = document.getElementById('advanced-spiral');
const commonCardCountSpan = document.getElementById('commonCardCount');
const advancedCardCountSpan = document.getElementById('advancedCardCount');
const buyCommonCardBtn = document.getElementById('buyCommonCardBtn');
const drawCommonBtn = document.getElementById('drawCommonBtn');
const drawAdvancedBtn = document.getElementById('drawAdvancedBtn');

const buyCardsModal = document.getElementById('buyCardsModal');
const decreaseCardQtyBtn = document.getElementById('decreaseCardQtyBtn');
const increaseCardQtyBtn = document.getElementById('increaseCardQtyBtn');
const cardQtyToBuySpan = document.getElementById('cardQtyToBuy');
const totalCrystalCostSpan = document.getElementById('totalCrystalCost');
const confirmPurchaseBtn = document.getElementById('confirmPurchaseBtn');
const buyCardsMessage = document.getElementById('buyCardsMessage');

const drawConfirmModal = document.getElementById('drawConfirmModal');
const drawQuantityInput = document.getElementById('drawQuantityInput');
const confirmDrawBtn = document.getElementById('confirmDrawBtn');
const drawConfirmMessage = document.getElementById('drawConfirmMessage');
let currentDrawType = 'common';

const drawResultsModal = document.getElementById('drawResultsModal');
const drawResultsGrid = document.getElementById('drawResultsGrid');

async function updateCardCounts() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data, error } = await supabaseClient
        .from('inventory_items')
        .select('item_id, quantity')
        .eq('player_id', user.id)
        .in('item_id', [41, 42]); //

    if (error) {
        console.error("Erro ao buscar cartões:", error);
        return;
    }

    const commonCards = data.find(item => item.item_id === 41); //
    const advancedCards = data.find(item => item.item_id === 42); //

    commonCardCountSpan.textContent = `x ${commonCards ? commonCards.quantity : 0}`;
    advancedCardCountSpan.textContent = `x ${advancedCards ? advancedCards.quantity : 0}`;
}

function openSpiralModal() {
    updateCardCounts();
    spiralModal.style.display = 'flex';
}

commonSpiralTab.addEventListener('click', () => {
    commonSpiralTab.classList.add('active');
    advancedSpiralTab.classList.remove('active');
    commonSpiralContent.style.display = 'block';
    advancedSpiralContent.style.display = 'none';
});

advancedSpiralTab.addEventListener('click', () => {
    advancedSpiralTab.classList.add('active');
    commonSpiralTab.classList.remove('active');
    advancedSpiralContent.style.display = 'block';
    commonSpiralContent.style.display = 'none';
});

document.querySelector('.close-spiral-modal').addEventListener('click', () => spiralModal.style.display = 'none');
document.getElementById('closeBuyCardsModalBtn').addEventListener('click', () => buyCardsModal.style.display = 'none');
document.getElementById('closeDrawConfirmModalBtn').addEventListener('click', () => drawConfirmModal.style.display = 'none');
document.getElementById('closeDrawResultsModalBtn').addEventListener('click', () => drawResultsModal.style.display = 'none');

buyCommonCardBtn.addEventListener('click', () => {
    cardQtyToBuySpan.textContent = '1';
    totalCrystalCostSpan.textContent = '250';
    buyCardsMessage.textContent = '';
    buyCardsModal.style.display = 'flex';
});

increaseCardQtyBtn.addEventListener('click', () => {
    let qty = parseInt(cardQtyToBuySpan.textContent) + 1;
    cardQtyToBuySpan.textContent = qty;
    totalCrystalCostSpan.textContent = qty * 250;
});

decreaseCardQtyBtn.addEventListener('click', () => {
    let qty = parseInt(cardQtyToBuySpan.textContent);
    if (qty > 1) {
        qty--;
        cardQtyToBuySpan.textContent = qty;
        totalCrystalCostSpan.textContent = qty * 250;
    }
});

// MODIFICADO PARA ATUALIZAR O CACHE
confirmPurchaseBtn.addEventListener('click', async () => {
    const quantity = parseInt(cardQtyToBuySpan.textContent);
    confirmPurchaseBtn.disabled = true;
    buyCardsMessage.textContent = 'Processando compra...';

    const { data, error } = await supabaseClient.rpc('buy_spiral_cards', { purchase_quantity: quantity });

    if (error) {
        buyCardsMessage.textContent = `Erro: ${error.message}`;
    } else {
        buyCardsMessage.textContent = data;
        await updateCardCounts();
        // Força o refresh (true) e preserva o container (true)
        await fetchAndDisplayPlayerInfo(true, true); 
        setTimeout(() => {
            buyCardsModal.style.display = 'none';
        }, 2000);
    }
    confirmPurchaseBtn.disabled = false;
});

function openDrawConfirmModal(type) {
    currentDrawType = type;
    drawQuantityInput.value = 1;
    drawConfirmMessage.textContent = '';
    drawConfirmModal.style.display = 'flex';
}

drawCommonBtn.addEventListener('click', () => openDrawConfirmModal('common'));
drawAdvancedBtn.addEventListener('click', () => openDrawConfirmModal('advanced'));

confirmDrawBtn.addEventListener('click', async () => {
    const quantity = parseInt(drawQuantityInput.value);
    if (isNaN(quantity) || quantity <= 0) {
        drawConfirmMessage.textContent = 'Por favor, insira uma quantidade válida.';
        return;
    }

    confirmDrawBtn.disabled = true;
    drawConfirmMessage.textContent = 'Sorteando...';

    const { data: wonItems, error } = await supabaseClient.rpc('perform_spiral_draw', {
        draw_type: currentDrawType,
        p_quantity: quantity
    });

    if (error) {
        drawConfirmMessage.textContent = `Erro: ${error.message}`;
    } else {
        drawConfirmModal.style.display = 'none';
        displayDrawResults(wonItems);
        await updateCardCounts();
        // Não é necessário forçar refresh aqui, pois 'perform_spiral_draw'
        // só gasta cartões, não ouro/cristais (o updateCardCounts já cuida disso)
        // Mas se o sorteio der ouro/cristais, um refresh seria bom.
        // Vamos adicionar por segurança.
        await fetchAndDisplayPlayerInfo(true, true);
    }
    confirmDrawBtn.disabled = false;
});

function displayDrawResults(items) {
    drawResultsGrid.innerHTML = '';
    if (Object.keys(items).length === 0) {
        drawResultsGrid.innerHTML = '<p>Nenhum item especial foi obtido desta vez.</p>';
    } else {
        for (const itemIdStr in items) {
            const itemId = parseInt(itemIdStr, 10);
            const quantity = items[itemId];
            const itemDef = itemDefinitions.get(itemId);

            if (!itemDef) {
                console.warn(`Definição não encontrada para o item ID: ${itemId}`);
                continue; 
            }
            
            const imageUrl = `https://aden-rpg.pages.dev/assets/itens/${itemDef.name}.webp`;

            const itemDiv = document.createElement('div');
            itemDiv.className = 'result-item';
            itemDiv.innerHTML = `
                <img src="${imageUrl}" alt="${itemDef.name}">
                <span>x${quantity}</span>
            `;
            drawResultsGrid.appendChild(itemDiv);
        }
    }
    drawResultsModal.style.display = 'flex';
}

// ===============================================
// === LÓGICA DO SISTEMA DE LOJA (Shop)      ===
// ===============================================

function openShopModal() {
    shopMessage.textContent = '';
    shopModal.style.display = 'flex';
}

if (closeShopModalBtn) {
    closeShopModalBtn.addEventListener('click', () => {
        shopModal.style.display = 'none';
    });
}

// Lógica para alternar entre as abas da loja
const shopTabs = document.querySelectorAll('.shop-tab-btn');
const shopContents = document.querySelectorAll('.shop-content');

shopTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        shopTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const targetContentId = tab.getAttribute('data-tab');
        shopContents.forEach(content => {
            if (content.id === targetContentId) {
                content.style.display = 'block';
            } else {
                content.style.display = 'none';
            }
        });
    });
});

// Lógica para os botões de compra com modal de confirmação
const buyButtons = document.querySelectorAll('.shop-buy-btn');
let purchaseHandler = null; // Variável para armanezar a função de compra

buyButtons.forEach(button => {
    button.addEventListener('click', () => {
        const packageId = button.getAttribute('data-package');
        const itemName = button.getAttribute('data-name');
        const itemCost = button.getAttribute('data-cost');

        // Prepara a mensagem do modal
        confirmModalMessage.innerHTML = `Tem certeza que deseja comprar <strong>${itemName}</strong> por <img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:16px; height:16px; vertical-align: -2px;"> ${itemCost} de ouro?`;
        
        // Define o que o botão "Confirmar" fará (MODIFICADO PARA ATUALIZAR O CACHE)
        purchaseHandler = async () => {
            purchaseConfirmModal.style.display = 'none'; // Esconde o modal de confirmação
            button.disabled = true;
            shopMessage.textContent = 'Processando sua compra...';

            try {
                const { data, error } = await supabaseClient.rpc('buy_shop_item', {
                    package_id: packageId
                });
                if (error) throw error;

                shopMessage.textContent = data;
                // Força o refresh (true) e preserva o container (true)
                await fetchAndDisplayPlayerInfo(true, true);
            } catch (error) {
                shopMessage.textContent = `Erro: ${error.message}`;
            } finally {
                button.disabled = false;
            }
        };

        // Mostra o modal de confirmação
        purchaseConfirmModal.style.display = 'flex';
    });
});

// Listener para o botão de confirmação final
confirmPurchaseFinalBtn.addEventListener('click', () => {
    if (purchaseHandler) {
        purchaseHandler();
    }
});

// Listener para o botão de cancelar
cancelPurchaseBtn.addEventListener('click', () => {
    purchaseConfirmModal.style.display = 'none';
    purchaseHandler = null; // Limpa o handler
});

// =======================================================================
// === LÓGICA DE RECOMPENSA POR VÍDEO (INTEGRADA AO APPCREATOR24) ===
// =======================================================================

async function checkRewardLimit() {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return;

        const { data: playerData, error } = await supabaseClient
            .from('players')
            .select('daily_rewards_log')
            .eq('id', user.id)
            .single();

        if (error || !playerData) return;

        const log = playerData.daily_rewards_log || {}; //
        const counts = (log && log.counts) ? log.counts : {};
        const logDateStr = log && log.date ? String(log.date) : null;

        const todayUtc = new Date(new Date().toISOString().split('T')[0]).toISOString().split('T')[0];

        if (!logDateStr || String(logDateStr).split('T')[0] !== todayUtc) {
            watchVideoButtons.forEach(btn => {
                btn.disabled = false;
                btn.style.filter = "";
                btn.style.pointerEvents = "";
                if (btn.getAttribute('data-original-text')) {
                    btn.textContent = btn.getAttribute('data-original-text');
                } else {
                    btn.setAttribute('data-original-text', btn.textContent);
                }
            });
            return;
        }

        watchVideoButtons.forEach(btn => {
            const type = btn.getAttribute('data-reward');
            const count = counts && (counts[type] !== undefined) ? parseInt(counts[type], 10) : 0;
            if (isNaN(count) || count < 5) {
                btn.disabled = false;
                btn.style.filter = "";
                btn.style.pointerEvents = "";
                if (!btn.getAttribute('data-original-text')) {
                    btn.setAttribute('data-original-text', btn.textContent);
                } else {
                    btn.textContent = btn.getAttribute('data-original-text');
                }
            } else {
                btn.disabled = true;
                btn.style.filter = "grayscale(100%) brightness(60%)";
                btn.style.pointerEvents = "none";
                btn.setAttribute('data-original-text', btn.getAttribute('data-original-text') || btn.textContent);
                btn.textContent = "Limite atingido";
            }
        });
    } catch (e) {
        console.error("Erro ao verificar limites de vídeo:", e);
    }
}

const watchVideoButtons = document.querySelectorAll('.watch-video-btn');

watchVideoButtons.forEach(button => {
    button.addEventListener('click', async () => {
        const rewardType = button.getAttribute('data-reward');
        button.disabled = true;
        showFloatingMessage('Preparando sua recompensa...');

        try {
            const { data: token, error: rpcError } = await supabaseClient.rpc('generate_reward_token', {
                p_reward_type: rewardType
            });

            if (rpcError) {
                if (rpcError.message && rpcError.message.toLowerCase().includes('limite')) {
                    showFloatingMessage('Você já atingiu o limite diário para esta recompensa.');
                    checkRewardLimit();
                } else {
                    showFloatingMessage(`Erro: ${rpcError.message}`);
                }
                button.disabled = false;
                return;
            }

            localStorage.setItem('pending_reward_token', token); //

            const triggerId = `trigger-${rewardType}-ad`;
            const triggerLink = document.getElementById(triggerId);

            if (triggerLink) {
                triggerLink.click();
            } else {
                throw new Error(`Gatilho para recompensa '${rewardType}' não encontrado.`);
            }

        } catch (error) {
            showFloatingMessage(`Erro: ${error.message}`);
            localStorage.removeItem('pending_reward_token'); //
        } finally {
            setTimeout(() => { button.disabled = false; }, 3000);
        }
    });
});

setTimeout(() => {
    checkRewardLimit();
}, 600);

// fim do arquivo
/* === MAP INTERACTION INSERTED BY CHATGPT === */


/* === MAP INTERACTION INSERTED BY CHATGPT === */
// Cria a interação do mapa (arrastar com mouse/touch) com inércia. Não altera nenhuma outra lógica.
function enableMapInteraction() {
    const map = document.getElementById('mapImage');
    if (!map) return;

    let isDragging = false;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    let minX, maxX, minY, maxY;

    // NOVAS VARIÁVEIS PARA INÉRCIA
    let velocityX = 0;
    let velocityY = 0;
    let lastDragTime = 0;
    let lastDragX = 0;
    let lastDragY = 0;
    let animationFrameId = null;
    const FRICTION = 0.98; // Fator de desaceleração (ajuste se quiser mais ou menos inércia)

    // calcula limites para evitar que o mapa seja arrastado completamente pra fora da viewport
    function recalcLimits() {
        const container = document.getElementById('mapContainer');
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const mapWidth = map.offsetWidth || 3000;
        const mapHeight = map.offsetHeight || 3000;

        minX = Math.min(0, containerRect.width - mapWidth);
        maxX = 0;
        minY = Math.min(0, containerRect.height - mapHeight);
        maxY = 0;
    }

    recalcLimits();
    window.addEventListener('resize', recalcLimits);

    map.style.touchAction = 'none';
    map.style.userSelect = 'none';

    function setTransform(x, y) {
        // aplica limites
        if (typeof minX !== 'undefined') {
            x = Math.max(minX, Math.min(maxX, x));
            y = Math.max(minY, Math.min(maxY, y));
        }
        currentX = x; currentY = y;
        map.style.transform = `translate(${currentX}px, ${currentY}px) scale(1)`; // mantém o zoom reduzido
    }
    
    function inertiaAnimation() {
        // Aplica atrito (desaceleração)
        velocityX *= FRICTION;
        velocityY *= FRICTION;

        // Calcula a nova posição
        const nextX = currentX + velocityX;
        const nextY = currentY + velocityY;

        setTransform(nextX, nextY);

        // Verifica se a velocidade é insignificante para parar a animação
        if (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1) {
            animationFrameId = requestAnimationFrame(inertiaAnimation);
        } else {
            // Garante que a inércia para de vez
            velocityX = 0;
            velocityY = 0;
            animationFrameId = null;
        }
    }

    function getPoint(e) {
        if (e.touches && e.touches.length) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else {
            return { x: e.clientX, y: e.clientY };
        }
    }

    function startDrag(e) {
        // Cancela qualquer animação de inércia anterior
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        const p = getPoint(e);
        isDragging = true;
        startX = p.x - currentX;
        startY = p.y - currentY;
        map.style.cursor = 'grabbing';
        
        // Prepara para calcular a velocidade
        lastDragX = p.x;
        lastDragY = p.y;
        lastDragTime = performance.now();
    }

    function onDrag(e) {
        if (!isDragging) return;
        e.preventDefault();
        const p = getPoint(e);
        const nextX = p.x - startX;
        const nextY = p.y - startY;
        setTransform(nextX, nextY);
        
        // Calcula a velocidade (momentum)
        const currentTime = performance.now();
        const deltaTime = currentTime - lastDragTime;

        if (deltaTime > 0) {
            // Velocidade em pixels por milissegundo
            velocityX = (p.x - lastDragX) / deltaTime;
            velocityY = (p.y - lastDragY) / deltaTime;
        }

        lastDragX = p.x;
        lastDragY = p.y;
        lastDragTime = currentTime;
    }

    function endDrag() {
        isDragging = false;
        map.style.cursor = 'grab';
        
        // Inicia a inércia se a velocidade for significativa
        // O fator 10 é um ajuste para converter a velocidade (px/ms) em um deslocamento (px)
        if (Math.abs(velocityX * 10) > 2 || Math.abs(velocityY * 10) > 2) {
            // Multiplicamos a velocidade para que o deslize inicial seja mais perceptível
            velocityX *= 10; 
            velocityY *= 10;
            inertiaAnimation();
        } else {
            velocityX = 0;
            velocityY = 0;
        }
    }

    map.addEventListener('mousedown', startDrag, { passive: true });
    window.addEventListener('mousemove', onDrag, { passive: false });
    window.addEventListener('mouseup', endDrag, { passive: true });

    map.addEventListener('touchstart', startDrag, { passive: true });
    window.addEventListener('touchmove', onDrag, { passive: false });
    window.addEventListener('touchend', endDrag, { passive: true });

    map.style.cursor = 'grab';

    setTimeout(recalcLimits, 100);
}

(function() {
    const originalRenderPlayerUI = window.renderPlayerUI;
    if (typeof originalRenderPlayerUI === 'function') {
        window.renderPlayerUI = function(player, preserveActiveContainer) {
            originalRenderPlayerUI(player, preserveActiveContainer);
            setTimeout(enableMapInteraction, 150);
        };
    } else {
        window.enableMapInteraction = enableMapInteraction;
    }
})();