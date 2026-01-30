
// Registro do Service Worker Otimizado
if ('serviceWorker' in navigator) {
    const registerSW = () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                // Verifica se há atualizações a cada 1 hora se o app ficar aberto
                setInterval(() => reg.update(), 60 * 60 * 1000); 
                
                if (reg.installing) {
                    console.log('⚙️ SW: Instalando...');
                } else if (reg.waiting) {
                    console.log('⚙️ SW: Aguardando ativação...');
                } else if (reg.active) {
                    console.log('✅ SW: Ativo e servindo cache!');
                }
            })
            .catch(err => console.error('❌ Erro ao registrar SW:', err));
    };

    // Se a página já carregou, registra agora. Se não, espera o load.
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        registerSW();
    } else {
        window.addEventListener('load', registerSW);
    }
}
// 🎵 Música de Fundo (Refatorada para nova estratégia de MUTE/UNMUTE)
let musicStarted = false;
let backgroundMusic;

/**
 * Função global para iniciar a música de fundo.
 * Se chamada com forceMute=true (pelo intro), ela inicia o áudio no mudo.
 * Em chamadas futuras (clique/arraste), ela apenas desmuta.
 * * @param {boolean} [forceMute=false] - Se deve forçar o áudio a iniciar no mudo.
 */
function startBackgroundMusic(forceMute = false) 
{
  // Se intro estiver rodando, apenas sinalizamos interesse em tocar a música
  // Exceto se for uma chamada de forceMute (do clique inicial)
  if (window.__introPlaying && !forceMute) {
    console.log("Intro rodando — adiando desmute. Será iniciado ao finalizar/pular o intro.");
    window.__introWantedToStartMusic = true;
    return;
  }

  // Cria o objeto de áudio "preguiçosamente" (lazy-load) na primeira chamada
  if (typeof backgroundMusic === 'undefined' || backgroundMusic === null) {
    try {
      backgroundMusic = new Audio("https://aden-rpg.pages.dev/assets/aden.mp3");
      backgroundMusic.volume = 0.03;
      backgroundMusic.loop = true;
    } catch(e){
      console.warn("Falha ao criar backgroundMusic:", e);
      return;
    }
  }

  // Se já está tocando, e estamos chamando para desmutar (não forceMute)
  if (musicStarted && !forceMute && backgroundMusic.muted) {
     backgroundMusic.muted = false;
     console.log("🎵 Música de fundo desmutada pelo gesto do usuário!");
     return;
  }

  // Se já foi iniciada e não estamos em modo forceMute, ignora.
  if (musicStarted && !forceMute) return;


  // Define o estado de mudo com base no parâmetro
  backgroundMusic.muted = forceMute; 

  // Tenta tocar, com fallback de muted se bloqueado
  const playPromise = backgroundMusic.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      musicStarted = true; // Define o estado
      if (forceMute) {
        console.log("🎵 Música de fundo iniciada (MUTED) para desbloquear áudio.");
      } else {
        console.log("🎵 Música de fundo iniciada!");
      }
    }).catch(err => {
      console.warn("⚠️ Falha ao iniciar música (tentando fallback forçado):", err);
      try {
        backgroundMusic.muted = true;
        backgroundMusic.play().then(() => {
          musicStarted = true; // Define o estado
          console.log("🎵 Música de fundo iniciada (muted). Esperando gesto do usuário para ativar som.");
          // Se o fallback forçado funcionar, adiciona um listener para desmutar na próxima interação
          function onFirstGesture() {
            try {
              if (backgroundMusic && backgroundMusic.muted) backgroundMusic.muted = false;
            } catch(e){}
            window.removeEventListener('pointerdown', onFirstGesture);
          }
          window.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true });
        }).catch(e => {
          console.warn("Não foi possível iniciar música mesmo em muted:", e);
        });
      } catch(e2){
        console.warn("Fallback muted falhou:", e2);
      }
    });
  }
}

// Expor globalmente IMEDIATAMENTE para que o Intro (IIFE) possa encontrá-la
window.startBackgroundMusic = startBackgroundMusic;
window.__musicDebug = { isStarted: () => musicStarted };

// =======================================================================
// NOVA LÓGICA: CONTROLE DE VISIBILIDADE (PAUSAR/RETOMAR AO SAIR DA ABA)
// =======================================================================
document.addEventListener("visibilitychange", () => {
  // Se o objeto de áudio não existe, não faz nada
  if (!backgroundMusic) return;

  if (document.visibilityState === 'hidden') {
    // Usuário saiu da aba ou minimizou: Pausa a música se estiver tocando
    if (!backgroundMusic.paused) {
      backgroundMusic.pause();
      // console.log("🎵 Música pausada (aba em segundo plano).");
    }
  } else if (document.visibilityState === 'visible') {
    // Usuário voltou: Retoma APENAS se a música já tivesse sido iniciada anteriormente
    if (musicStarted && backgroundMusic.paused) {
      backgroundMusic.play().catch(e => console.warn("⚠️ Falha ao retomar música automaticamente:", e));
      // console.log("🎵 Música retomada (aba ativa).");
    }
  }
});
// =======================================================================


// Os listeners de interação SÓ podem ser adicionados após o DOM carregar
document.addEventListener("DOMContentLoaded", () => {
  
  // NENHUM 'new Audio()' aqui. Isso foi o erro.

  // Função utilitária para registrar listeners com opções comuns
  function addCapturedListener(target, evt, handler, opts = {}) {
    try {
      target.addEventListener(evt, handler, Object.assign({ capture: true, passive: true, once: false }, opts));
    } catch (e) {
      // alguns targets (ex: null) podem falhar, silenciosamente ignoramos
    }
  }

  // 1) Eventos primários que normalmente desbloqueiam áudio
  // (Estes listeners agora chamam a função global, que DESMUTA o áudio se ele estiver muted)
  const primaryEvents = ["click", "pointerdown", "touchstart", "mousedown", "keydown"];
  for (const ev of primaryEvents) {
    addCapturedListener(window, ev, function onPrimary(e) {
      startBackgroundMusic(); // Chama sem forceMute: Desmuta ou Inicia normal
    });
    addCapturedListener(document.body, ev, function onPrimary2(e) {
      startBackgroundMusic(); // Chama sem forceMute: Desmuta ou Inicia normal
    });
  }

  // 2) Tentar capturar ARRASTO (para desmutar)
  let moveArmed = false; 
  function armMove() { moveArmed = true; setTimeout(()=> moveArmed = false, 1200); }

  addCapturedListener(window, "pointerdown", armMove);
  addCapturedListener(window, "touchstart", armMove);
  addCapturedListener(document.body, "pointerdown", armMove);
  addCapturedListener(document.body, "touchstart", armMove);

  function handleMoveForMusic(e) {
    if (musicStarted && !backgroundMusic.muted) return; // Se tocando e não muted, ignora
    if (!moveArmed) return;

    const isTouchMove = (e.touches && e.touches.length > 0);
    const hasPressure = (e.pressure && e.pressure > 0) || (e.buttons && e.buttons > 0);
    if (isTouchMove || hasPressure || e.pointerType) {
      startBackgroundMusic(); // Chama sem forceMute: Desmuta ou Inicia normal
      moveArmed = false;
    }
  }
  addCapturedListener(window, "touchmove", handleMoveForMusic);
  addCapturedListener(window, "pointermove", handleMoveForMusic);
  addCapturedListener(document.body, "touchmove", handleMoveForMusic);
  addCapturedListener(document.body, "pointermove", handleMoveForMusic);

  // 3) Listeners de Mapa (para desmutar)
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
      addCapturedListener(el, "pointerdown", () => { startBackgroundMusic(); armMove(); }); // Chama sem forceMute: Desmuta ou Inicia normal
      addCapturedListener(el, "touchstart", () => { startBackgroundMusic(); armMove(); }); // Chama sem forceMute: Desmuta ou Inicia normal
      addCapturedListener(el, "touchmove", handleMoveForMusic);
      addCapturedListener(el, "pointermove", handleMoveForMusic);
    });
  }

  // 4) Fallbacks de "soltar" (Up)
  function tryOnUp(e) { if (!musicStarted || backgroundMusic.muted) startBackgroundMusic(); }
  addCapturedListener(window, "pointerup", tryOnUp);
  addCapturedListener(window, "touchend", tryOnUp);
  addCapturedListener(document.body, "pointerup", tryOnUp);
  addCapturedListener(document.body, "touchend", tryOnUp);

  // 5) Fallback temporizado (apenas tentará iniciar se nada ocorreu)
  setTimeout(() => {
    if (!musicStarted) {
      try { startBackgroundMusic(); } catch(e) {}
    }
  }, 6000);
});
// FIM DA MÚSICA DE FUNDO

// =======================================================================
// INÍCIO: SCRIPT DO INTRO E SELETOR DE IDIOMA (REFATORADO)
// =======================================================================

(function() {
    const INTRO_LOCALSTORAGE_KEY = 'aden_intro_seen_v31';
    const INTRO_VIDEO_SRC = 'https://aden-rpg.pages.dev/assets/aden_intro.webm';
    const FORCE_SHOW_PARAM = 'show_intro';

    // --- Lista de Idiomas Suportados ---
    const languages = [
        { code: 'pt', label: 'Português', flag: '🇧🇷' },
        { code: 'en', label: 'English', flag: '🇺🇸' },
        { code: 'es', label: 'Español', flag: '🇪🇸' },
        { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
        { code: 'ja', label: '日本語', flag: '🇯🇵' },
        { code: 'ko', label: '한국어', flag: '🇰🇷' },
        { code: 'id', label: 'Indonesian', flag: '🇮🇩' },
        { code: 'tl', label: 'Filipino', flag: '🇵🇭' },
        { code: 'ru', label: 'Русский', flag: '🇷🇺' },
        { code: 'it', label: 'Italiano', flag: '🇮🇹' },
        { code: 'fr', label: 'Français', flag: '🇫🇷' },
        { code: 'hi', label: 'Indian (Hindi)', flag: '🇮🇳' },
        { code: 'ms', label: 'Melayu', flag: '🇲🇾' },
        { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
        { code: 'ar', label: 'Arabic', flag: '🇸🇦' }
    ];

    // Injeta o CSS do modal apenas uma vez
    if (!document.getElementById('lang-modal-style')) {
        const style = document.createElement('style');
        style.id = 'lang-modal-style';
        style.innerHTML = `
        .lang-grid { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 8px; 
            margin-bottom: 20px; 
            max-height: 300px; 
            overflow-y: auto;
        }
        .lang-opt { 
            background: #1a1a1a; 
            border: 1px solid #444; 
            color: #bbb; 
            padding: 8px 4px; 
            cursor: pointer; 
            border-radius: 6px; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center;
            transition: all 0.2s;
        }
        .lang-opt:hover {
            background: #2a2a2a; 
            color: #fff;
        }
        .lang-opt.selected { 
            border-color: #c9a94a; 
            background: #2b2515; 
            color: #c9a94a;
            box-shadow: 0 0 8px rgba(201, 169, 74, 0.3);
            font-weight: bold;
        }
        .lang-flag { font-size: 1.5em; margin-bottom: 4px; }
        .lang-name { font-size: 0.8em; }
        #welcomeOkBtn:disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(1); }
      `;
        document.head.appendChild(style);
    }

    /**
     * Função Global para abrir o Modal de Idioma
     * @param {boolean} isUpdateMode - Se true, apenas troca o idioma e recarrega (sem vídeo).
     */
    window.openLanguageModal = function(isUpdateMode = false) {
        // Remove modal anterior se existir (para evitar duplicatas)
        const oldModal = document.getElementById('welcomeModal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'welcomeModal';
        modal.style.cssText = 'position:fixed;inset:0;display:flex;justify-content:center;align-items:center;z-index:2147483646;background:rgba(0,0,0,0.85);backdrop-filter:blur(3px);';

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        modalContent.style.cssText = 'width:90%;max-width:400px;padding:25px;border-radius:12px;background:#0b0b0b;color:#fff;text-align:center;border: 1px solid #333; box-shadow: 0 0 20px rgba(0,0,0,0.8);';

        // Título e Subtítulo baseados no modo
        const titleText = isUpdateMode ? "Idioma / Language" : "Bem-vindo / Welcome";
        const subText = isUpdateMode ? "Select new language:" : "Select your language to start:";

        // Título HTML
        const title = document.createElement('h2');
        title.innerHTML = titleText;
        title.style.cssText = "margin-top:0; color: #c9a94a; font-size: 1.2em;";
        modalContent.appendChild(title);
        
        const betaTag = document.createElement('p');
        betaTag.innerHTML = "(Tradução em fase Beta)";
        betaTag.style.cssText = "font-size: 0.9em; color: lightblue; font-weight: bold; margin-top: -12px; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px;";
        modalContent.appendChild(betaTag);

        // Instrução HTML
        const subtitle = document.createElement('p');
        subtitle.textContent = subText;
        subtitle.style.cssText = "font-size: 0.9em; color: #aaa; margin-bottom: 10px; font-weight: bold;";
        modalContent.appendChild(subtitle);

        // Grid de Idiomas
        const grid = document.createElement('div');
        grid.className = 'lang-grid';

        // Tenta pegar o idioma atual do cookie para pré-selecionar
        let currentCookieLang = 'pt';
        try {
            const cookies = document.cookie.split(";");
            const googCookie = cookies.find(c => c.trim().startsWith("googtrans="));
            if (googCookie) {
                const val = googCookie.split("=")[1];
                const parts = val.split("/");
                currentCookieLang = parts[parts.length - 1];
            }
        } catch (e) {}

        let selectedLang = currentCookieLang || 'pt';

        languages.forEach(lang => {
            const opt = document.createElement('div');
            opt.className = 'lang-opt';
            if (lang.code === selectedLang) opt.classList.add('selected');

            opt.innerHTML = `<span class="lang-flag">${lang.flag}</span><span class="lang-name">${lang.label}</span>`;

            opt.addEventListener('click', () => {
                document.querySelectorAll('.lang-opt').forEach(el => el.classList.remove('selected'));
                opt.classList.add('selected');
                selectedLang = lang.code;
            });

            grid.appendChild(opt);
        });
        modalContent.appendChild(grid);

        // Botão de Confirmar
        const btnText = isUpdateMode ? "Confirm & Reload" : "<strong>START GAME</strong>";
        const okBtn = document.createElement('button');
        okBtn.id = 'welcomeOkBtn';
        okBtn.innerHTML = btnText;
        okBtn.style.cssText = 'width:100%; padding:12px; font-size:16px; border-radius:8px; border:none; background: linear-gradient(180deg, #c9a94a, #8a7330); color:#000; cursor:pointer; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
        
        // Botão Cancelar (Apenas no modo Update)
        if (isUpdateMode) {
             const cancelBtn = document.createElement('button');
             cancelBtn.innerText = "Cancelar";
             cancelBtn.style.cssText = 'width:100%; padding:10px; margin-top:10px; background:transparent; border:1px solid #444; color:#aaa; cursor:pointer; font-size:0.9em; border-radius:8px;';
             cancelBtn.onclick = () => modal.remove();
             modalContent.appendChild(okBtn);
             modalContent.appendChild(cancelBtn);
        } else {
             modalContent.appendChild(okBtn);
        }

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // --- Ação do Botão Confirmar ---
        okBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();

            // 1. Aplica o Cookie de Tradução
            if (selectedLang !== 'pt') {
                const cookieValue = `/pt/${selectedLang}`;
                const domain = window.location.hostname;
                document.cookie = `googtrans=${cookieValue}; path=/;`;
                document.cookie = `googtrans=${cookieValue}; domain=.${domain}; path=/;`;
            } else {
                // Limpa cookie se for PT
                document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
                document.cookie = `googtrans=; domain=.${window.location.hostname}; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
            }

            // 2. Decide o fluxo (Update vs Intro)
            if (isUpdateMode) {
                // Modo Update: Apenas recarrega para aplicar a tradução
                window.location.reload();
            } else {
                // Modo Intro: Inicia música/vídeo
                if (typeof window.startBackgroundMusic === 'function') {
                    window.startBackgroundMusic(true);
                }
                startVideoFromUserGesture(selectedLang, modal);
            }
        });
    };

    // Função interna para rodar o vídeo da intro
    function startVideoFromUserGesture(lang, modalEl) {
        try {
            localStorage.setItem(INTRO_LOCALSTORAGE_KEY, '1');
            window.__introSeen = true;

            modalEl.remove(); // Remove o modal

            // Cria overlay do vídeo
            const overlay = document.createElement('div');
            overlay.id = 'gameIntroOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;display:flex;justify-content:center;align-items:center;background:black;z-index:2147483647;padding:0;margin:0;overflow:hidden;';
            
            const container = document.createElement('div');
            // FIX: Adicionado background-color: black para evitar o cinza do placeholder
            container.style.cssText = 'width:100vw;height:100vh;display:flex;justify-content:center;align-items:center;background-color: black;'; 
            
            const video = document.createElement('video');
            video.id = 'gameIntroVideo';
            video.src = INTRO_VIDEO_SRC;
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.setAttribute('preload', 'auto');
            // FIX: Adicionado background-color: black para o elemento de vídeo
            video.style.cssText = 'width:100%;height:100%;max-width:540px;max-height:960px;object-fit:cover;outline:none;border:none;background-color: black;'; 
            
            container.appendChild(video);
            overlay.appendChild(container);
            document.documentElement.appendChild(overlay);

            window.__introPlaying = true;
            const prevOverflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = 'hidden';

            video.muted = false;
            video.play().catch(() => {
                video.muted = true;
                video.play().catch(() => {});
            });

            video.addEventListener('ended', () => {
                window.__introPlaying = false;
                overlay.remove();
                document.documentElement.style.overflow = prevOverflow || '';

                if (typeof window.startBackgroundMusic === 'function') {
                    window.startBackgroundMusic();
                }

                // Se não for PT, recarrega para garantir tradução se não aplicou ainda
                if (lang !== 'pt' && !document.querySelector('.goog-te-banner-frame')) {
                    window.location.reload();
                }
            }, { once: true });

        } catch (e) {
            console.warn('Erro intro', e);
        }
    }

    // --- Lógica de Inicialização Automática (Intro) ---
    function _forceShowIntroFromUrl() {
        try { const qp = new URLSearchParams(location.search); return qp.get(FORCE_SHOW_PARAM) === '1'; } 
        catch (e) { return false; }
    }

    window.__introSeen = !!localStorage.getItem(INTRO_LOCALSTORAGE_KEY);

    // Se ainda não viu a intro (ou forçado por URL), abre em modo Intro
    if (!window.__introSeen || _forceShowIntroFromUrl()) {
        // Pequeno delay para garantir que DOM carregou
        setTimeout(() => window.openLanguageModal(false), 100);
    }

})();

// Adiciona Listener ao botão do Menu de Opções
document.addEventListener("DOMContentLoaded", () => {
    const changeLangBtn = document.getElementById('changeLanguageBtn');
    if (changeLangBtn) {
        changeLangBtn.addEventListener('click', (e) => {
            // Fecha o submenu ao clicar
            const submenus = document.querySelectorAll('.footer-submenu');
            submenus.forEach(s => s.style.display = 'none');
            
            // Abre o modal em modo "Update" (true)
            window.openLanguageModal(true);
        });
    }
});

// =======================================================================
// FIM DO SCRIPT DO INTRO
// =======================================================================

// =======================================================================
// INÍCIO: RESTANTE DO SCRIPT (SUPABASE, CACHE, JOGADOR, ETC.)
// =======================================================================

const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =======================================================================
// NOVO: ADEN GLOBAL DB (ZERO EGRESS & SURGICAL UPDATE)
// =======================================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 5;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(AUTH_STORE)) {
                    db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains(PLAYER_STORE)) {
                    db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
                }
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
    },

    setAuth: async function(sessionData) {
        try {
            const db = await this.open();
            const tx = db.transaction(AUTH_STORE, 'readwrite');
            // Salva com expiração para invalidar periodicamente se necessário
            const authObj = { 
                key: 'current_session', 
                value: sessionData, 
                updated_at: Date.now() 
            };
            tx.objectStore(AUTH_STORE).put(authObj);
        } catch(e) { console.warn("Erro ao salvar Auth no DB Global", e); }
    },

    clearAuth: async function() {
        try {
            const db = await this.open();
            const tx = db.transaction([AUTH_STORE, PLAYER_STORE], 'readwrite');
            tx.objectStore(AUTH_STORE).clear();
            tx.objectStore(PLAYER_STORE).clear();
        } catch(e) {}
    },

    getPlayer: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(PLAYER_STORE, 'readonly');
                const req = tx.objectStore(PLAYER_STORE).get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },

    setPlayer: async function(playerData) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            tx.objectStore(PLAYER_STORE).put({ key: 'player_data', value: playerData });
        } catch(e) { console.warn("Erro ao salvar Player no DB Global", e); }
    },

    // Atualização cirúrgica: Lê, mescla e salva
    updatePlayerPartial: async function(changes) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            const store = tx.objectStore(PLAYER_STORE);
            
            // Promise wrapper para get
            const currentData = await new Promise(resolve => {
                const req = store.get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });

            if (currentData) {
                const newData = { ...currentData, ...changes };
                store.put({ key: 'player_data', value: newData });
                // Atualiza também a variável global em memória se existir
                if (window.currentPlayerData) {
                    Object.assign(window.currentPlayerData, changes);
                    renderPlayerUI(window.currentPlayerData, true); // Re-renderiza UI
                }
            }
        } catch(e) { console.warn("Erro update parcial", e); }
    }
};

// Expor Globalmente para outros scripts (Mines, Arena, etc.)
window.GlobalState = GlobalDB;

// =======================================================================
// CACHE PERSISTENTE (Legacy - Mantido para compatibilidade)
// =======================================================================
const CACHE_TTL_MINUTES = 1440; // Cache de 1 hora como padrão (24h)

function setCache(key, data, ttlMinutes = CACHE_TTL_MINUTES) {
    const cacheItem = {
        expires: Date.now() + (ttlMinutes * 60 * 1000), 
        data: data
    };
    try {
        localStorage.setItem(key, JSON.stringify(cacheItem));
    } catch (e) {
        console.warn("Falha ao salvar no localStorage (provavelmente cheio):", e);
    }
}

function getCache(key, defaultTtlMinutes = CACHE_TTL_MINUTES) {
    try {
        const cachedItem = localStorage.getItem(key);
        if (!cachedItem) return null;
        const { expires, data } = JSON.parse(cachedItem);
        const expirationTime = (typeof expires === 'number') ? expires : (Date.now() - (defaultTtlMinutes * 60 * 1000) - 1); 
        if (Date.now() > expirationTime) {
            localStorage.removeItem(key);
            return null;
        }
        return data;
    } catch (e) {
        localStorage.removeItem(key); 
        return null;
    }
}

/**
 * Atualiza o cache e a UI localmente sem ir ao servidor.
 * Agora integrado ao GlobalDB.
 */
function updateLocalPlayerData(changes) {
    if (!currentPlayerData) return;

    // 1. Atualiza memória RAM
    Object.keys(changes).forEach(key => {
        currentPlayerData[key] = changes[key];
    });

    // 2. Atualiza Cache Legacy (LocalStorage)
    setCache('player_data_cache', currentPlayerData, 1440);

    // 3. Atualiza Novo Global DB (IndexedDB)
    GlobalDB.updatePlayerPartial(changes);

    // 4. Redesenha a UI
    renderPlayerUI(currentPlayerData, true);
}
// =======================================================================

// ============================================================
// HELPER INDEXEDDB PARA SCRIPT.JS (COMPARTILHADO COM INVENTORY)
// ============================================================
const DB_NAME = "aden_inventory_db";
const STORE_NAME = "inventory_store";
const META_STORE = "meta_store";
const DB_VERSION = 47; // Mantenha a mesma versão do inventory.js

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: "key" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Atualiza o cache local "cirurgicamente" e REMOVE itens com qtd 0.
 */
async function surgicalCacheUpdate(newItems, newTimestamp, updatedStats) {
    try {
        const db = await openDB();
        const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const meta = tx.objectStore(META_STORE);

        // 1. Atualiza, insere OU DELETA os itens modificados
        if (Array.isArray(newItems)) {
            newItems.forEach(item => {
                if (item.quantity > 0) {
                    store.put(item); // Salva/Atualiza se tiver quantidade
                } else {
                    // Se a quantidade for 0 ou menor, removemos fisicamente do IndexedDB
                    if (item.id) {
                        store.delete(item.id);
                        console.log(`🗑️ [Cache] Item ${item.id} removido (qtd 0).`);
                    }
                }
            });
        }

        // 2. Atualiza o Timestamp para manter sync com inventory.js
        if (newTimestamp) {
            meta.put({ key: "last_updated", value: newTimestamp });
            meta.put({ key: "cache_time", value: Date.now() }); 
        }

        // 3. Atualiza os stats do jogador (Ouro/Cristais)
        if (updatedStats) {
            GlobalDB.updatePlayerPartial(updatedStats);
            const req = meta.get("player_stats");
            req.onsuccess = () => {
                const currentStats = req.result ? req.result.value : {};
                const finalStats = { ...currentStats, ...updatedStats };
                meta.put({ key: "player_stats", value: finalStats });
            };
        }

        return new Promise(resolve => {
            tx.oncomplete = () => resolve();
        });
    } catch (e) {
        console.warn("⚠️ Falha ao atualizar IndexedDB via script.js:", e);
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
        { req: 2, item_id: 13, qty: 1, desc: "Alcance o estágio 2 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/itens/asa_guardia.webp" }, 
        { req: 3, item_id: 10, qty: 10, desc: "Alcance o estágio 3 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_anel_runico.webp" },
        { req: 4, crystals: 1500, qty: 1500, desc: "Alcance o estágio 4 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 5, crystals: 100, qty: 100, desc: "Alcance o estágio 5 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 6, crystals: 500, qty: 500, desc: "Alcance o estágio 6 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 7, crystals: 500, qty: 500, desc: "Alcance o estágio 7 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 8, crystals: 500, qty: 500, desc: "Alcance o estágio 8 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 9, crystals: 500, qty: 500, desc: "Alcance o estágio 9 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 10, crystals: 500, qty: 500, desc: "Alcance o estágio 10 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 11, crystals: 1000, qty: 1000, desc: "Alcance o estágio 11 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 12, crystals: 1000, qty: 1000, desc: "Alcance o estágio 12 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 13, crystals: 1000, qty: 1000, desc: "Alcance o estágio 13 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 14, crystals: 1000, qty: 1000, desc: "Alcance o estágio 14 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 15, crystals: 1500, qty: 1500, desc: "Alcance o estágio 15 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 16, crystals: 1000, qty: 1000, desc: "Alcance o estágio 16 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 17, crystals: 1000, qty: 1000, desc: "Alcance o estágio 17 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 18, crystals: 1000, qty: 1000, desc: "Alcance o estágio 18 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 19, crystals: 1000, qty: 1000, desc: "Alcance o estágio 19 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 20, crystals: 2500, qty: 2500, desc: "Alcance o estágio 20 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 21, crystals: 1000, qty: 1000, desc: "Alcance o estágio 21 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 22, crystals: 1000, qty: 1000, desc: "Alcance o estágio 22 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 23, crystals: 1000, qty: 1000, desc: "Alcance o estágio 23 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 24, crystals: 1000, qty: 1000, desc: "Alcance o estágio 24 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 25, crystals: 3000, qty: 3000, desc: "Alcance o estágio 25 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 26, crystals: 1000, qty: 1000, desc: "Alcance o estágio 26 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 27, crystals: 1000, qty: 1000, desc: "Alcance o estágio 27 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 28, crystals: 1000, qty: 1000, desc: "Alcance o estágio 28 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 29, crystals: 1000, qty: 1000, desc: "Alcance o estágio 29 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
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


// Função OTIMIZADA para carregar definições de itens no cache local
// Modificado para reduzir Egress buscando apenas o necessário e cacheando tudo
async function loadItemDefinitions() {
    const CACHE_KEY = 'item_definitions_full_v1'; // Alterado para forçar novo cache completo
    const CACHE_TTL_24H = 43200; // 24 horas * 60 minutos

    // 1. Tenta carregar do cache em memória (RAM)
    if (itemDefinitions.size > 0) return;

    // 2. Tenta carregar do cache persistente (LocalStorage)
    const cachedData = getCache(CACHE_KEY, CACHE_TTL_24H);
    if (cachedData) {
        // Recria o Map a partir dos dados [key, value] salvos no cache
        try {
             itemDefinitions = new Map(cachedData);
             console.log('📚 [Cache] Definições de itens carregadas (Memória/Local).');
             return;
        } catch(e) {
            console.warn("Falha ao parsear cache de itens, buscando novamente.", e);
            localStorage.removeItem(CACHE_KEY); // Limpa cache corrompido
        }
    }

    // 3. Se não houver cache, busca no Supabase
    // OTIMIZAÇÃO: Buscamos TODAS as colunas estáticas necessárias para evitar JOINs futuros
    console.log('🌐 [Network] Baixando definições COMPLETAS de itens...');
    const { data, error } = await supabaseClient
        .from('items')
        .select(`
            item_id, name, display_name, description, rarity, item_type, stars,
            min_attack, attack, defense, health, 
            crit_chance, crit_damage, evasion,
            crafts_item_id
        `);
    
    if (error) {
        console.error('Erro ao carregar definições de itens:', error);
        return;
    }
    
    const dataForCache = []; // Array [key, value] para salvar no localStorage
    for (const item of data) {
        // Fallback para display_name se vazio
        if (!item.display_name) item.display_name = item.name;
        
        itemDefinitions.set(item.item_id, item);
        dataForCache.push([item.item_id, item]); // Salva como [key, value]
    }
    
    // 4. Salva no cache persistente para a próxima vez com TTL de 24h
    setCache(CACHE_KEY, dataForCache, CACHE_TTL_24H);
    console.log(`✅ [Cache] ${data.length} definições completas salvas.`);
}

// Expõe globalmente para que o inventory.js possa hidratar itens sem ir ao banco
window.itemDefinitions = itemDefinitions;
window.getItemDefinition = function(itemId) {
    return itemDefinitions.get(itemId);
};

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
    
    // Ao logar com sucesso, o listener onAuthStateChange será disparado e
    // atualizará o GlobalDB
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
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
    // --- CORREÇÃO DE CACHE APLICADA ---
    // Limpa explicitamente o cache do jogador antes de sair e recarregar
    localStorage.removeItem('player_data_cache');
    await GlobalDB.clearAuth(); // Limpa DB Global
    
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Erro ao sair:', error.message);
    }
    window.location.reload();
}

// Função helper para renderizar a UI com os dados do jogador
// ALTERADO: Removidos stats detalhados (Atk, Def, HP, Crit, Evasão)
// Apenas exibe Nome, Facção e Botões
function renderPlayerUI(player, preserveActiveContainer = false) {
    authContainer.style.display = 'none';
    playerInfoDiv.innerHTML = `
      <p class="hellop">${player.name}!</p>
      <p>Facção: ${player.faction}</p>
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

// OTIMIZAÇÃO: Função applyItemBonuses removida. 
// O cálculo agora é feito via RPC no servidor para atualizar a coluna combat_power.

// Função principal para buscar e exibir as informações do jogador (OTIMIZADA ZERO EGRESS + SERVER-SIDE CP)
async function fetchAndDisplayPlayerInfo(forceRefresh = false, preserveActiveContainer = false) {
    // 1. OTIMIZAÇÃO: Tenta carregar do GlobalDB primeiro
    if (!forceRefresh) {
        const cachedPlayer = await GlobalDB.getPlayer();
        if (cachedPlayer) {
            console.log("⚡ [PlayerInfo] Usando dados do IndexedDB Global.");
            currentPlayerData = cachedPlayer;
            currentPlayerId = cachedPlayer.id;
            renderPlayerUI(cachedPlayer, preserveActiveContainer);
            checkProgressionNotifications(cachedPlayer);
            return;
        }
    }

    // 2. Se não tiver no DB, busca do Supabase
    let userId = currentPlayerId;
    if (!userId) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            updateUIVisibility(false);
            return;
        }
        userId = session.user.id;
        currentPlayerId = userId;
    }

    // --- MUDANÇA CRÍTICA: Select específico para economizar dados ---
    // Adicionei colunas usadas na UI e no 'checkProgressionNotifications'
    const columnsToSelect = `
        id, 
        name, 
        faction, 
        avatar_url, 
        level, 
        xp, 
        xp_needed_for_level, 
        gold, 
        crystals, 
        combat_power, 
        progression_state,
        current_afk_stage,
        last_attack_time,
        raid_attacks_bought_count,
        last_afk_start_time,
        guild_id,
        rank,
        daily_rewards_log 
    `;

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select(columnsToSelect)
        .eq('id', userId)
        .single();
        
    if (playerError || !player) {
        console.error("Erro ao buscar jogador:", playerError);
        return;
    }

    // --- LÓGICA DE CP NO SERVIDOR (OTIMIZADO: 1 VEZ POR DIA) ---
    // Só executa se a data salva for diferente da data de hoje
    const STORAGE_KEY_CP = `aden_cp_check_${player.id}`;
    const todayStr = new Date().toISOString().split('T')[0]; // Data atual (UTC) ex: "2023-10-27"
    const lastCheck = localStorage.getItem(STORAGE_KEY_CP);

    if (lastCheck !== todayStr) {
        console.log("🔄 [System] Executando verificação diária de Combat Power...");
        
        supabaseClient.rpc('update_and_get_combat_power', { target_player_id: player.id })
            .then(({ data: newCp, error }) => {
                if (!error && newCp !== null) {
                    // Marca como feito hoje
                    localStorage.setItem(STORAGE_KEY_CP, todayStr);
                    
                    // Atualiza a UI se houve mudança
                    if (player.combat_power !== newCp) {
                        console.log(`⚡ CP Atualizado de ${player.combat_power} para ${newCp}`);
                        player.combat_power = newCp;
                        document.getElementById('playerPower').textContent = formatNumberCompact(newCp);
                        
                        // Atualiza cache local com o novo valor
                        if (currentPlayerData) currentPlayerData.combat_power = newCp;
                        GlobalDB.updatePlayerPartial({ combat_power: newCp });
                        setCache('player_data_cache', currentPlayerData, 1440);
                    }
                }
            })
            .catch(err => console.warn("Falha no check diário de CP:", err));
    } else {
        // console.log("✅ [System] CP já verificado hoje.");
    }

    // Armazena e Renderiza
    currentPlayerData = player;
    
    // Salva no DB Global e Cache Legacy
    await GlobalDB.setPlayer(player);
    setCache('player_data_cache', player, 1440);

    renderPlayerUI(player, preserveActiveContainer);
    checkProgressionNotifications(player);

    if (/^Nome_[0-9a-fA-F]{6}$/.test(player.name)) {
        if (typeof window.updateProfileEditModal === 'function') {
            window.updateProfileEditModal(player);
        }
        const nameInput = document.getElementById('editPlayerName');
        if (nameInput) nameInput.value = '';
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

// --- UI ---// --- UI ---
window.updateUIVisibility = (isLoggedIn, activeContainerId = null) => {
  if (isLoggedIn) {
    authContainer.style.display = 'none';
    footerMenu.style.display = 'flex';
    welcomeContainer.style.display = 'block';
  } else {
    // ALTERAÇÃO: Usa flex em vez de block para manter a centralização
    authContainer.style.display = 'flex'; 
    welcomeContainer.style.display = 'none';
    footerMenu.style.display = 'none';
    signInBtn.style.display = 'block';
    signUpBtn.style.display = 'block';
    passwordInput.style.display = 'block';
    otpInputContainer.style.display = 'none';
    authMessage.textContent = '';
  }
};



// Eventos
signInBtn.addEventListener('click', signIn);
signUpBtn.addEventListener('click', signUp);
verifyOtpBtn.addEventListener('click', verifyOtp);

// =======================================================================
// OTIMIZAÇÃO DE AUTH & INICIALIZAÇÃO
// =======================================================================
window.authCheckComplete = false;

async function checkAuthStatus() {
    // 1. TENTA AUTH VIA GLOBAL DB (ZERO EGRESS)
    const cachedAuth = await GlobalDB.getAuth();
    if (cachedAuth && cachedAuth.value && cachedAuth.value.user) {
         console.log("⚡ [Auth] Sessão válida recuperada do IndexedDB Global.");
         currentPlayerId = cachedAuth.value.user.id;
         window.authCheckComplete = true;

         // Carrega jogador via DB ou rede se necessário
         await fetchAndDisplayPlayerInfo();
         
         if (typeof window.tryHideLoadingScreen === 'function') window.tryHideLoadingScreen();
         handleUrlActions();
         return;
    }

    // 2. Fallback: getSession() do Supabase (lê do LocalStorage ou Rede)
    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (session) {
        currentPlayerId = session.user.id;
        window.authCheckComplete = true;
        
        // Salva no Global DB para a próxima vez ser Zero Egress
        await GlobalDB.setAuth(session);
        
        // Busca dados
        fetchAndDisplayPlayerInfo(true); 
        
        if (typeof window.tryHideLoadingScreen === 'function') window.tryHideLoadingScreen();
        handleUrlActions();
    } else {
        // Sem sessão, mostra tela de login
        updateUIVisibility(false);
        window.authCheckComplete = true;
        if (typeof window.tryHideLoadingScreen === 'function') window.tryHideLoadingScreen();
    }
}

// 1. Tenta renderizar IMEDIATAMENTE usando o GlobalDB (Zero Network)
document.addEventListener("DOMContentLoaded", async () => {
    // Tenta renderizar algo na tela antes mesmo de checar auth
    const cachedPlayer = await GlobalDB.getPlayer();
    
    if (cachedPlayer) {
        console.log("⚡ [Init] Interface carregada via GlobalDB (Sem consumo de Auth)");
        currentPlayerData = cachedPlayer;
        currentPlayerId = cachedPlayer.id;
        renderPlayerUI(cachedPlayer);
        checkProgressionNotifications(cachedPlayer);
    }

    // 2. Inicia verificação de Auth
    checkAuthStatus();
});

// Escuta mudanças APENAS para Login/Logout explícitos
supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
        // Atualiza Global DB no login
        await GlobalDB.setAuth(session);
        if(!currentPlayerData) fetchAndDisplayPlayerInfo(true);
    } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem('player_data_cache');
        await GlobalDB.clearAuth();
        window.location.reload();
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
    titulosModal: "Títulos em breve!",
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
        window.location.href = "inventory.html";
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
 * Lida com o clique no botão "Resgatar" (MODIFICADO PARA ATUALIZAR O CACHE E EVITAR EGRESS)
 */
async function handleProgressionClaim(event) {
    const button = event.target;
    const category = button.dataset.category;
    if (!category) return;

    button.disabled = true;
    button.textContent = "Aguarde...";

    try {
        const { data, error } = await supabaseClient.rpc('claim_progression_reward', {
            p_category: category
        });

        if (error) throw new Error(error.message);

        showFloatingMessage(data.message || 'Recompensa resgatada com sucesso!');

        // 1. Atualiza Status Locais (Ouro/Cristais)
        const updates = {};
        if (data.crystals_added) updates.crystals = (currentPlayerData.crystals || 0) + data.crystals_added;
        if (data.gold_added) updates.gold = (currentPlayerData.gold || 0) + data.gold_added;
        
        // 2. Atualiza o Estado da Progressão Local
        if (data.new_index !== undefined) {
             const newState = { ...(currentPlayerData.progression_state || { level: 0, afk: 0, misc: 0 }) };
             newState[category] = data.new_index;
             updates.progression_state = newState;
        }

        updateLocalPlayerData(updates);

        // 3. Atualiza Cirurgicamente o Inventário (Se ganhou item)
        if (data.inventory_updates && data.new_timestamp) {
            await surgicalCacheUpdate(data.inventory_updates, data.new_timestamp);
        }

        // 4. Re-renderiza o modal e checa notificações (Sem baixar nada do server)
        checkProgressionNotifications(currentPlayerData);
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

/**
 * === CORREÇÃO "EXORCISTA" ===
 * Esta função força a sincronização APENAS dos cartões com o servidor.
 * Ela apaga TODOS os cartões locais (para eliminar fantasmas) e insere
 * os que vieram do servidor.
 */
async function syncSpiralCardsWithServer() {
    // 1. Busca estado real no servidor
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    // Busca apenas os cartões (item_id 41 e 42)
    const { data: serverItems, error } = await supabaseClient
        .from('inventory_items')
        .select('*, items!inner(item_id)')
        .eq('player_id', user.id)
        .in('items.item_id', [41, 42]);

    if (error) {
        console.warn("⚠️ [Gacha] Erro ao sincronizar cartões:", error);
        return; // Se der erro de rede, não mexe no cache para não piorar
    }

    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // 2. Busca TUDO localmente para identificar os fantasmas
        const allLocal = await new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });

        // Identifica IDs locais que são cartões (mesmo os fantasmas)
        const localCardIds = allLocal
            .filter(i => (i.item_id === 41 || i.items?.item_id === 41 || i.item_id === 42 || i.items?.item_id === 42))
            .map(i => i.id);

        // 3. APAGA TODOS os cartões locais (Exorcismo)
        if (localCardIds.length > 0) {
            // console.log(`🗑️ [Gacha] Removendo ${localCardIds.length} slots de cartões locais para limpeza.`);
            localCardIds.forEach(id => store.delete(id));
        }

        // 4. INSERE a verdade do servidor
        let common = 0, advanced = 0;
        if (serverItems && serverItems.length > 0) {
            serverItems.forEach(item => {
                if(item.quantity > 0) {
                    store.put(item); // Salva o item correto
                }
                // Conta para a UI
                if (item.items.item_id === 41) common += item.quantity;
                if (item.items.item_id === 42) advanced += item.quantity;
            });
        }

        // 5. Atualiza a UI imediatamente
        if(commonCardCountSpan) commonCardCountSpan.textContent = `x ${common}`;
        if(advancedCardCountSpan) advancedCardCountSpan.textContent = `x ${advanced}`;

    } catch (e) {
        console.warn("Erro ao limpar cache de cartões:", e);
    }
}

function openSpiralModal() {
    // CHAMA A NOVA FUNÇÃO DE SINCRONIZAÇÃO FORÇADA
    syncSpiralCardsWithServer();
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

// MODIFICADO PARA ATUALIZAR O CACHE VIA SYNC
confirmPurchaseBtn.addEventListener('click', async () => {
    const quantity = parseInt(cardQtyToBuySpan.textContent);
    confirmPurchaseBtn.disabled = true;
    buyCardsMessage.textContent = 'Processando...';

    try {
        const { data, error } = await supabaseClient.rpc('buy_spiral_cards', { purchase_quantity: quantity });

        if (error) throw error;
        if (!data.success) throw new Error(data.message);

        buyCardsMessage.textContent = data.message;
        
        // 1. Atualiza Cristais na UI e Cache Local (Sem refresh)
        updateLocalPlayerData({ crystals: data.new_crystals });
        
        // 2. Atualiza Cartões no Cache e UI (Via Surgical Update)
        // O surgicalCacheUpdate atualiza o IndexedDB e a UI se programado para isso
        if (data.inventory_updates && data.timestamp) {
            await surgicalCacheUpdate(data.inventory_updates, data.timestamp);
            
            // Atualiza visualmente o contador de cartões no modal aberto
            const cardItem = data.inventory_updates.find(i => i.item_id === 41);
            if (cardItem && commonCardCountSpan) {
                commonCardCountSpan.textContent = `x ${cardItem.quantity}`;
            }
        }

        setTimeout(() => {
            buyCardsModal.style.display = 'none';
            confirmPurchaseBtn.disabled = false;
        }, 1000);

    } catch (err) {
        buyCardsMessage.textContent = `Erro: ${err.message}`;
        confirmPurchaseBtn.disabled = false;
    }
});

function openDrawConfirmModal(type) {
    currentDrawType = type;
    drawQuantityInput.value = 1;
    drawConfirmMessage.textContent = '';
    drawConfirmModal.style.display = 'flex';
}

drawCommonBtn.addEventListener('click', () => openDrawConfirmModal('common'));
drawAdvancedBtn.addEventListener('click', () => openDrawConfirmModal('advanced'));

// MODIFICADO PARA GARANTIR SYNC APÓS SORTEIO
confirmDrawBtn.addEventListener('click', async () => {
    const quantity = parseInt(drawQuantityInput.value);
    if (isNaN(quantity) || quantity <= 0) return;

    confirmDrawBtn.disabled = true;
    drawConfirmMessage.textContent = 'Sorteando...';

    try {
        const { data, error } = await supabaseClient.rpc('perform_spiral_draw', {
            draw_type: currentDrawType,
            p_quantity: quantity
        });

        if (error) throw error;

        // Fecha modal de confirmação APENAS se deu sucesso
        drawConfirmModal.style.display = 'none';
        
        // 1. Mostra resultados VISUAIS usando dados parciais + Definições Locais
        displayDrawResults(data.visual_rewards);

        // 2. Atualiza Cache em Background (Sem travar a UI)
        if (data.inventory_updates && data.timestamp) {
            await surgicalCacheUpdate(data.inventory_updates, data.timestamp);
            
            // Atualiza contador de cartões na UI imediatamente
            const cardIdToCheck = currentDrawType === 'common' ? 41 : 42;
            const cardItem = data.inventory_updates.find(i => i.item_id === cardIdToCheck);
            const targetSpan = currentDrawType === 'common' ? commonCardCountSpan : advancedCardCountSpan;
            
            if (targetSpan) {
                targetSpan.textContent = `x ${cardItem ? cardItem.quantity : 0}`;
            }
        }

    } catch (err) {
        drawConfirmMessage.textContent = `Erro: ${err.message}`;
    } finally {
        confirmDrawBtn.disabled = false;
    }
});

function displayDrawResults(itemsMap) {
    drawResultsGrid.innerHTML = '';
    
    if (!itemsMap || Object.keys(itemsMap).length === 0) {
        drawResultsGrid.innerHTML = '<p>Nenhum item.</p>';
        drawResultsModal.style.display = 'flex';
        return;
    }

    // Itera sobre o mapa simples ID -> Qtd
    for (const [itemIdStr, qty] of Object.entries(itemsMap)) {
        const itemId = parseInt(itemIdStr, 10);
        
        // 1. Busca definição no CACHE LOCAL (Sem ir ao servidor)
        // Se itemDefinitions ainda não carregou, tenta recarregar (fallback seguro)
        let itemDef = itemDefinitions.get(itemId);
        
        // Se não achou, define placeholders seguros
        const name = itemDef ? itemDef.name : `Item #${itemId}`;
        
        // URL da imagem
        let imgUrl;
        if (itemDef) {
             imgUrl = `https://aden-rpg.pages.dev/assets/itens/${itemDef.name}.webp`;
        } else {
             // Fallback para imagem desconhecida ou placeholder
             console.warn(`Definição de item ${itemId} não encontrada no cache local.`);
             imgUrl = `https://aden-rpg.pages.dev/assets/itens/unknown.webp`; 
        }

        const itemDiv = document.createElement('div');
        itemDiv.className = 'result-item';
        // Adiciona classe de raridade se disponível para efeito visual extra (opcional)
        if (itemDef && itemDef.rarity) itemDiv.classList.add(`rarity-${itemDef.rarity.toLowerCase()}`);
        
        itemDiv.innerHTML = `
            <img src="${imgUrl}" alt="${name}" onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'">
            <span>x${qty}</span>
        `;
        drawResultsGrid.appendChild(itemDiv);
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
        const itemCost = button.getAttribute('data-cost'); // Deve ser string de número

        // Prepara a mensagem do modal
        confirmModalMessage.innerHTML = `Tem certeza que deseja comprar <strong>${itemName}</strong> por <img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:16px; height:16px; vertical-align: -2px;"> ${itemCost} de ouro?`;
        
        // Define o que o botão "Confirmar" fará (MODIFICADO PARA ATUALIZAR O CACHE E EVITAR EGRESS)
        purchaseHandler = async () => {
            purchaseConfirmModal.style.display = 'none'; // Esconde o modal de confirmação
            button.disabled = true;
            shopMessage.textContent = 'Processando sua compra...';

            try {
                // A RPC agora retorna JSONB com os dados
                const { data, error } = await supabaseClient.rpc('buy_shop_item', {
                    package_id: packageId
                });
                if (error) throw error;

                shopMessage.textContent = data.message;
                
                // 1. Atualiza SALDO localmente sem refresh completo
                if (data.new_gold !== undefined) {
                    updateLocalPlayerData({ gold: data.new_gold });
                }

                // 2. Atualiza Cirurgicamente o Inventário
                if (data.inventory_updates && data.new_timestamp) {
                    await surgicalCacheUpdate(data.inventory_updates, data.new_timestamp);
                }

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
        let logData = null;

        // 1. Tenta usar os dados já carregados na memória (ZERO EGRESS)
        if (currentPlayerData && currentPlayerData.daily_rewards_log) {
            logData = currentPlayerData.daily_rewards_log;
        } else {
            // Fallback apenas se não tiver carregado ainda (raro no fluxo normal)
            const { data: { user } } = await supabaseClient.auth.getSession(); // getSession já pode ter cache
            if (!user) {
                // Tenta getUser como fallback final
                const { data: { user: user2 } } = await supabaseClient.auth.getUser();
                if (!user2) return;
                
                const { data, error } = await supabaseClient
                    .from('players')
                    .select('daily_rewards_log')
                    .eq('id', user2.id)
                    .single();
                if (data) logData = data.daily_rewards_log;
            } else {
                 const { data, error } = await supabaseClient
                    .from('players')
                    .select('daily_rewards_log')
                    .eq('id', user.id)
                    .single();
                if (data) logData = data.daily_rewards_log;
            }
        }

        const log = logData || {}; 
        const counts = (log && log.counts) ? log.counts : {};
        const logDateStr = log && log.date ? String(log.date) : null;

        const todayUtc = new Date(new Date().toISOString().split('T')[0]).toISOString().split('T')[0];

        // Helpers visuais
        const enableBtn = (btn) => {
            btn.disabled = false;
            btn.style.filter = "";
            btn.style.pointerEvents = "";
            if (btn.getAttribute('data-original-text')) {
                btn.textContent = btn.getAttribute('data-original-text');
            } else {
                btn.setAttribute('data-original-text', btn.textContent);
            }
        };

        const disableBtn = (btn) => {
             btn.disabled = true;
             btn.style.filter = "grayscale(100%) brightness(60%)";
             btn.style.pointerEvents = "none";
             btn.setAttribute('data-original-text', btn.getAttribute('data-original-text') || btn.textContent);
             btn.textContent = "Limite atingido";
        };

        if (!logDateStr || String(logDateStr).split('T')[0] !== todayUtc) {
            watchVideoButtons.forEach(btn => enableBtn(btn));
            return;
        }

        watchVideoButtons.forEach(btn => {
            const type = btn.getAttribute('data-reward');
            const count = counts && (counts[type] !== undefined) ? parseInt(counts[type], 10) : 0;
            if (isNaN(count) || count < 5) {
                enableBtn(btn);
            } else {
                disableBtn(btn);
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

    // calcula limites para evitar o mapa ser arrastado completamente pra fora da viewport
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