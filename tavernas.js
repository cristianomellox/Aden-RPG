
// ── Config ──
const ABLY_KEY      = '5kVVVQ.Gn1VBA:lN3zK-KKFTZOWm3iBe3FfbPmtwb-oxsMTco_W0A-AZw';
const ROOM_CAPACITY = 30;
const MIC_GAIN      = 0.5;   // Amplificação do microfone (1.0 = sem ganho; aumente se ainda estiver baixo)
const NOISE_GATE    = 15;    // Threshold do noise gate (0–255). Suba se vazar ruído, desça se cortar voz.

// ── Supabase (cliente próprio — tavernas.html não herda o do script.js) ──
const SB_URL  = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
const SB_KEY  = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
let   sbClient = null;
function getSB() {
  // Prioridade 1: cliente autenticado exposto pelo módulo supabaseClient.js (mais confiável)
  if (window.__tavSB) { sbClient = window.__tavSB; return sbClient; }
  if (sbClient) return sbClient;
  try {
    if (window.supabaseClient) { sbClient = window.supabaseClient; return sbClient; }
    if (window.supabase?.createClient) {
      sbClient = window.supabase.createClient(SB_URL, SB_KEY, {
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      return sbClient;
    }
  } catch(_) {}
  return null;
}
const ICE_SERVERS   = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

// ── IndexedDB (mesma instância do jogo principal) ──
const GLOBAL_DB_NAME    = 'aden_global_db';
const GLOBAL_DB_VERSION = 7;
const PLAYER_STORE      = 'player_store';
const OWNERS_STORE      = 'owners_store';
const OWNERS_CACHE_TTL  = 24 * 60 * 60 * 1000; // 24h

function openGlobalDB() {
  return new Promise((resolve, reject) => {
    const req     = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
    const timeout = setTimeout(() => reject(new Error('idb_timeout')), 800);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('auth_store'))   db.createObjectStore('auth_store',   { keyPath: 'key' });
      if (!db.objectStoreNames.contains(PLAYER_STORE))   db.createObjectStore(PLAYER_STORE,   { keyPath: 'key' });
      if (!db.objectStoreNames.contains(OWNERS_STORE))   db.createObjectStore(OWNERS_STORE,   { keyPath: 'id'  });
      if (!db.objectStoreNames.contains('bonds_store'))  db.createObjectStore('bonds_store',  { keyPath: 'id'  });
    };
    req.onsuccess = () => {
      clearTimeout(timeout);
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror   = () => { clearTimeout(timeout); reject(req.error); };
    req.onblocked = () => { clearTimeout(timeout); reject(new Error('idb_blocked')); };
  });
}

async function dbGetPlayer() {
  try {
    const db = await openGlobalDB();
    return new Promise(resolve => {
      const tx  = db.transaction(PLAYER_STORE, 'readonly');
      const req = tx.objectStore(PLAYER_STORE).get('player_data');
      req.onsuccess = () => resolve(req.result?.value || null);
      req.onerror   = () => resolve(null);
    });
  } catch (e) { return null; }
}

async function dbGetAllOwners() {
  try {
    const db = await openGlobalDB();
    return new Promise(resolve => {
      const tx  = db.transaction(OWNERS_STORE, 'readonly');
      const req = tx.objectStore(OWNERS_STORE).getAll();
      req.onsuccess = () => {
        const now = Date.now();
        const map = {};
        (req.result || []).forEach(o => {
          if (!o.timestamp || (now - o.timestamp) < OWNERS_CACHE_TTL) {
            map[o.id] = o;
          }
        });
        resolve(map);
      };
      req.onerror = () => resolve({});
    });
  } catch (e) { return {}; }
}

async function dbSaveOwners(list) {
  if (!list?.length) return;
  try {
    const db  = await openGlobalDB();
    const tx  = db.transaction(OWNERS_STORE, 'readwrite');
    const st  = tx.objectStore(OWNERS_STORE);
    const now = Date.now();

    // CORREÇÃO: merge com o registro já cacheado em vez de put() cego.
    // Listas parciais (ex: seguidores, presenteadores) não trazem guild_id —
    // sem o merge, isso sobrescrevia e apagava o guild_id já conhecido
    // de jogadores cacheados por outras páginas (ranking, playerModal etc.),
    // já que o owners_store é compartilhado globalmente entre todas as telas.
    await Promise.all(list.map(o => new Promise(resolve => {
      const id = o.id || o.i;
      if (!id) { resolve(); return; }
      const getReq = st.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result || {};
        const incomingName   = o.name       !== undefined ? o.name       : o.n;
        const incomingAvatar = o.avatar_url !== undefined ? o.avatar_url : o.a;
        const incomingGuild  = o.guild_id   !== undefined ? o.guild_id   : o.g;
        st.put({
          id,
          name:       incomingName   !== undefined ? incomingName   : existing.name,
          avatar_url: incomingAvatar !== undefined ? incomingAvatar : existing.avatar_url,
          guild_id:   incomingGuild  !== undefined ? incomingGuild  : existing.guild_id,
          timestamp: now
        });
        resolve();
      };
      getReq.onerror = () => resolve();
    })));
  } catch (e) { console.warn('dbSaveOwners:', e); }
}

// ── Auth Store (IDB) — leitura de sessão sem egress de rede ──
async function getAuthFromDB() {
  try {
    const db = await openGlobalDB();
    return new Promise(resolve => {
      const tx  = db.transaction('auth_store', 'readonly');
      const req = tx.objectStore('auth_store').get('current_session');
      req.onsuccess = () => resolve(req.result?.value || null);
      req.onerror   = () => resolve(null);
    });
  } catch(e) { return null; }
}

// ── Player — id começa null; só é preenchido após validar sessão no IDB ──
let PLAYER = {
  id:         null,   // preenchido em initPlayer() após validar auth — nunca lê localStorage direto
  name:       localStorage.getItem('aden_name') || 'Jogador',
  role:       localStorage.getItem('aden_role') || 'member',
  guild:      localStorage.getItem('aden_guild')|| '',
  avatar_url: null,
  nobless:    0
};

async function initPlayer() {
  // 1. Tenta pegar sessão do IDB (zero egress)
  const auth = await getAuthFromDB();
  if (auth?.user?.id) {
    PLAYER.id = auth.user.id;
  }

  // 2. Se IDB não tem sessão, confirma com Supabase (cobre logout recente ou IDB limpo)
  if (!PLAYER.id) {
    try {
      const sb = getSB();
      if (sb) {
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user?.id) {
          PLAYER.id = session.user.id;
        }
      }
    } catch(e) {}
  }

  // 3. Sem sessão válida em nenhuma fonte → redireciona, limpa localStorage stale
  if (!PLAYER.id) {
    localStorage.removeItem('aden_pid');
    localStorage.removeItem('aden_name');
    localStorage.removeItem('aden_role');
    localStorage.removeItem('aden_guild');
    window.location.replace('index.html');
    return;
  }

  localStorage.setItem('aden_pid', PLAYER.id);

  const data = await dbGetPlayer();
  if (data) {
    // Mantém o ID autenticado se obtido do IDB auth
    PLAYER.id         = data.id         || PLAYER.id;
    PLAYER.name       = data.name       || PLAYER.name;
    PLAYER.role       = data.role       || PLAYER.role;
    PLAYER.guild      = data.guild_id   || PLAYER.guild;
    PLAYER.avatar_url = data.avatar_url || null;
    // Sincroniza localStorage como fallback rápido
    localStorage.setItem('aden_pid',   PLAYER.id);
    localStorage.setItem('aden_name',  PLAYER.name);
    localStorage.setItem('aden_role',  PLAYER.role);
    localStorage.setItem('aden_guild', PLAYER.guild);
  }
  // Se avatar ainda é null, busca direto do Supabase antes de entrar no Ably
  // Sempre busca do Supabase para garantir nobless, role e avatar atualizados
  try {
    const sb = getSB();
    if (sb) {
      const { data: rows } = await sb
        .from('players')
        .select('id, name, avatar_url, guild_id, nobless, rank')
        .eq('id', PLAYER.id)
        .maybeSingle();
      if (!rows) {
        // Jogador não encontrado no banco (conta desativada ou inexistente) → index
        window.location.replace('index.html');
        return;
      }
      PLAYER.avatar_url = rows.avatar_url || PLAYER.avatar_url;
      PLAYER.name       = rows.name       || PLAYER.name;
      PLAYER.guild      = rows.guild_id   || '';   // '' quando null (evita valor stale do localStorage)
      PLAYER.nobless    = rows.nobless    || 0;
      if (rows.rank) PLAYER.role = rows.rank;
      await dbSaveOwners([{ id: PLAYER.id, name: PLAYER.name, avatar_url: PLAYER.avatar_url, guild_id: PLAYER.guild }]);
      ownersCache[PLAYER.id] = { id: PLAYER.id, name: PLAYER.name, avatar_url: PLAYER.avatar_url };
    }
  } catch(e) { console.warn('initPlayer supabase fetch:', e); }
}

// Cache de perfis de outros jogadores (owners)
let ownersCache = {};  // id → { name, avatar_url }

async function loadOwnersCache() {
  ownersCache = await dbGetAllOwners();
}

// Busca perfis faltantes via Supabase com query direta (sem RPC)
async function fetchMissingProfiles(ids) {
  if (!ids?.length) return;
  const missing = ids.filter(id => !ownersCache[id]?.avatar_url);
  if (!missing.length) return;
  try {
    const sb = getSB();
    if (!sb) return;
    const { data, error } = await sb
      .from('players')
      .select('id, name, avatar_url, guild_id')
      .in('id', missing);
    if (error || !data?.length) return;
    await dbSaveOwners(data);
    data.forEach(p => {
      ownersCache[p.id] = { id: p.id, name: p.name, avatar_url: p.avatar_url || null, guild_id: p.guild_id };
    });
  } catch (e) { console.warn('fetchMissingProfiles:', e); }
}

// ── Mapeamento de Tronos por Cidade ──
// throneNobless[0]=null → líder da guilda dona da cidade
// throneNobless[N]      → código nobless exigido
const CITY_THRONE_DATA = {
  'Taverna da Capital': {
    cityId: 1,
    throneNobless: [null, 101, 102, 102],
    throneLabels:  ['Rei / Rainha', 'Consorte Real', 'Príncipe/Princesa', 'Príncipe/Princesa']
  },
  'Taverna de Zion':    { cityId: 2, throneNobless: [null, 201, 202], throneLabels: ['Lord / Lady', 'Consorte', 'Nobre'] },
  'Taverna de Elendor': { cityId: 3, throneNobless: [null, 301, 302], throneLabels: ['Lord / Lady', 'Consorte', 'Nobre'] },
  'Taverna de Mitrar':  { cityId: 4, throneNobless: [null, 401, 402], throneLabels: ['Lord / Lady', 'Consorte', 'Nobre'] },
  'Taverna de Tandra':  { cityId: 5, throneNobless: [null, 501, 502], throneLabels: ['Lord / Lady', 'Consorte', 'Nobre'] },
  'Taverna de Astrax':  { cityId: 6, throneNobless: [null, 601, 602], throneLabels: ['Lord / Lady', 'Consorte', 'Nobre'] },
  'Taverna de Duratar': { cityId: 7, throneNobless: [null, 701, 702], throneLabels: ['Lord / Lady', 'Consorte', 'Nobre'] },
};

// ── Silêncio Local (Sessão) ──
// Persiste enquanto a aba estiver aberta; limpa ao fechar/reabrir.
const localMutes = new Set(
  JSON.parse(sessionStorage.getItem('aden_local_mutes') || '[]')
);
function saveLocalMutes()          { sessionStorage.setItem('aden_local_mutes', JSON.stringify([...localMutes])); }
function isLocallyMuted(id)        { return localMutes.has(id); }

function toggleLocalMute(playerId) {
  if (localMutes.has(playerId)) localMutes.delete(playerId);
  else                          localMutes.add(playerId);
  saveLocalMutes();
  // Aplica no elemento de áudio
  const audio = document.getElementById('audio-' + playerId);
  if (audio) audio.muted = localMutes.has(playerId) || audioMuted;
  // Atualiza badge visual no assento atual do jogador
  const mem = roomMembers[playerId];
  if (mem?.seatId) updateSeatLocalMuteBadge(mem.seatId, playerId);
  showToast(localMutes.has(playerId) ? 'Silenciado para você.' : 'Silêncio removido.');
}

function updateSeatLocalMuteBadge(seatId, playerId) {
  document.getElementById('seat-btn-' + seatId)?.classList.toggle('locally-muted', isLocallyMuted(playerId));
}

// ── Runtime state ──
let ablyReady     = false;
let currentRoomCityMeta = null;   // { cityId, ownerGuildId, throneNobless, throneLabels }
let currentThroneIds    = [];      // ['t1','t2',...] — dinâmico por cidade
let ablyClient    = null;
let globalChannel = null; // 'taverna:global' — presença global para lista
let roomChannel   = null;
let sigChannel    = null;
let currentRoom   = null;   // { id, name, tag }
let roomMembers   = {};     // clientId → { name, role, seatId, muted, avatar_url }
let mySeats       = {};
let micOn         = false;
let micMuted      = false;
let audioMuted    = false;
let navDropOpen   = false;
let localStream   = null;   // stream raw do getUserMedia (usado para mute/detect)
let processedStream = null; // stream com GainNode aplicado (enviado via WebRTC)
let micAudioCtx   = null;   // AudioContext do ganho de microfone
let micGainNode   = null;   // GainNode — controlado pelo noise gate
let micGateThreshold = parseInt(localStorage.getItem('aden_mic_gate') || '14', 10); // 0–60
let peerConns     = {};
let audioCtx      = null;
let speakLastTs   = 0;
let speakLastState = false;
let selectedGiftRecipients = new Set();

// ── Intimidade por Proximidade (tempo sentado adjacente) ──
const PROX_INTERVAL_MS   = 5 * 60 * 1000;  // 5 minutos por intervalo
const PROX_MAX_INTERVALS = 3;               // 3 × 50 = 150 pts máx/dia
const PROX_PTS_INTERVAL  = 50;              // pontos por intervalo
const PROX_DAILY_LIMIT   = 150;             // limite diário por par
const _proxPairs         = {};              // pairKey → state object
const _proxBridges       = {};              // pairKey → { el, seatA, seatB }
let   _proxTicker        = null;            // setInterval do checker

// Cores exclusivas por par (mapeadas ao seatA da dupla adjacente)
const PROX_COLORS = [
  { fill: '#ff6b9d', glow: 'rgba(255,107,157,0.85)' }, // 1-2 → rosa
  { fill: '#ffb347', glow: 'rgba(255,179,71,0.85)'  }, // 2-3 → âmbar
  { fill: '#c3a0ff', glow: 'rgba(195,160,255,0.85)' }, // 3-4 → violeta
  { fill: '#5dd8f5', glow: 'rgba(93,216,245,0.85)'  }, // 5-6 → céu
  { fill: '#6bffb8', glow: 'rgba(107,255,184,0.85)' }, // 6-7 → menta
  { fill: '#ff9f7f', glow: 'rgba(255,159,127,0.85)' }, // 7-8 → pêssego
];

// ── Confirmação de presente pendente ──
let _giftConfirmPending = null;             // { gift } aguardando confirm

// Mapa: roomId → { count, members: [{name, avatar_url}] }
let globalPresenceMap = {};

// ══════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  buildSeatsGrid();
  bindTabs();
  bindInputs();
  resetListCards();   // Zera imediatamente os valores fictícios do HTML
  await initPlayer();
  await loadOwnersCache();
  initAbly();
  scaleFont();
  // Inicializa ponto de notificação
  _tavUpdateNotifDot();
  // Busca notificações de "novo seguidor" registradas via Supabase
  // (ex.: follows feitos na guilda/ranking, ou enquanto offline)
  _tavFetchPendingNotifications().catch(() => {});
  // Busca notificações de laço (bond_invite recebido + bond_response do remetente)
  // chamado aqui, após initPlayer(), para garantir que auth.uid() no SQL retorna corretamente
  _bondsFetchPendingNotifications().catch(() => {});
  // Pré-carrega sets de seguindo / seguidores (necessário para verificação de amizade mútua)
  _tavEnsureFollowingSet().catch(() => {});
  _tavEnsureFollowersSet().catch(() => {});
  // Limpeza lazy semanal: mensagens antigas das tavernas (>7 dias)
  _tavLazyCleanupOldMessages().catch(() => {});
  // Limpeza lazy semanal: notificações antigas (>30 dias)
  _tavLazyCleanupOldNotifications().catch(() => {});
  // Social stats clicáveis no modal do jogador
  const pmFollEl  = document.getElementById('pm-followers-val')?.parentElement;
  const pmFollgEl = document.getElementById('pm-following-val')?.parentElement;
  const pmFameEl  = document.getElementById('pm-fame-val')?.parentElement;
  const pmGiftsEl = document.getElementById('pm-gifts-val')?.parentElement;
  if (pmFollEl)  { pmFollEl.style.cursor  = 'pointer'; pmFollEl.onclick  = () => openSocialListModal('followers', window._tavModalLastPid); }
  if (pmFollgEl) { pmFollgEl.style.cursor = 'pointer'; pmFollgEl.onclick = () => openSocialListModal('following', window._tavModalLastPid); }
  if (pmFameEl)  { pmFameEl.style.cursor  = 'pointer'; pmFameEl.onclick  = () => openFameModal(window._tavModalLastPid); }
  if (pmGiftsEl) { pmGiftsEl.style.cursor = 'pointer'; pmGiftsEl.onclick = () => openGiftersModal(window._tavModalLastPid); }
  // Social stats clicáveis no modal "Eu"
  const mpmFollEl  = document.getElementById('mpm-followers')?.parentElement;
  const mpmFollgEl = document.getElementById('mpm-following')?.parentElement;
  const mpmFameEl  = document.getElementById('mpm-fame')?.parentElement;
  const mpmGiftsEl = document.getElementById('mpm-gifts')?.parentElement;
  if (mpmFollEl)  { mpmFollEl.style.cursor  = 'pointer'; mpmFollEl.onclick  = () => openSocialListModal('followers', PLAYER.id); }
  if (mpmFollgEl) { mpmFollgEl.style.cursor = 'pointer'; mpmFollgEl.onclick = () => openSocialListModal('following', PLAYER.id); }
  if (mpmFameEl)  { mpmFameEl.style.cursor  = 'pointer'; mpmFameEl.onclick  = () => openFameModal(PLAYER.id); }
  if (mpmGiftsEl) { mpmGiftsEl.style.cursor = 'pointer'; mpmGiftsEl.onclick = () => openGiftersModal(PLAYER.id); }
  // Social stats clicáveis na página de perfil de outro jogador (ppp)
  document.getElementById('ppp-stat-followers')?.addEventListener('click', () => openSocialListModal('followers', window._pppPlayerId));
  document.getElementById('ppp-stat-following')?.addEventListener('click', () => openSocialListModal('following', window._pppPlayerId));
  document.getElementById('ppp-stat-fame')?.addEventListener('click',      () => openFameModal(window._pppPlayerId));
  document.getElementById('ppp-stat-gifts')?.addEventListener('click',     () => openGiftersModal(window._pppPlayerId));
  // Botão fechar da página de perfil (ppp)
  document.getElementById('ppp-close')?.addEventListener('click', closePlayerProfilePage);
  // Botão "Ver Equipamentos" na página de perfil de outro jogador
  document.getElementById('ppp-equip-inner')?.addEventListener('click', () => {
    if (window._pppPlayerId) openEquipmentModal(window._pppPlayerId);
  });
  // Botão "Ver Equipamentos" no próprio perfil (modal "Eu")
  document.getElementById('mpm-equip-inner')?.addEventListener('click', () => {
    closeMyProfileModal();
    openEquipmentModal(PLAYER.id);
  });
  // Scroll infinito para o modal de lista de fama
  ['fame-list-monthly', 'fame-list-total'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onscroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) _tavLoadFamePage(_fame.tab);
    };
  });
});

// Zera contagens e avatares dos cards antes do Ably conectar
function resetListCards() {
  document.querySelectorAll('.tavern-card').forEach(card => {
    const onlineEl = card.querySelector('.t-online');
    if (onlineEl) {
      const dot = onlineEl.querySelector('.online-dot');
      onlineEl.textContent = '';
      if (dot) onlineEl.appendChild(dot);
      onlineEl.appendChild(document.createTextNode('0'));
    }
    const avContainer = card.querySelector('.tavern-avatars');
    if (avContainer) avContainer.innerHTML = '';
  });
}

// Libera o #bottom-nav travado por .nav-locked (idempotente)
function _tavUnlockFooterNav() {
  document.getElementById('bottom-nav')?.classList.remove('nav-locked');
}

function initAbly() {
  if (typeof Ably === 'undefined') { setTimeout(initAbly, 2000); return; }
  setConnDot('connecting');
  ablyClient = new Ably.Realtime({
    key:          ABLY_KEY,
    clientId:     PLAYER.id,
    echoMessages: false,
    recover:      (_, cb) => cb(false)  // FIX: nunca reutiliza estado antigo; evita replay de sinalizações WebRTC obsoletas
  });
  ablyClient.connection.on('connected',    () => { ablyReady = true;  setConnDot('on');  joinGlobalPresence(); });
  ablyClient.connection.on('disconnected', () => { ablyReady = false; setConnDot('off'); });
  // Se a conexão falhar, libera o footer mesmo assim — senão um problema
  // de rede/Ably trancaria o jogador na página sem nem conseguir navegar
  // de volta pelo menu inferior.
  ablyClient.connection.on('failed',       () => { ablyReady = false; setConnDot('err'); _tavUnlockFooterNav(); });
  ablyClient.connection.on('connecting',   () => setConnDot('connecting'));

  // Rede de segurança: se por algum motivo o carregamento (presence.get
  // completo + renderListCards) nunca disparar, libera o footer depois
  // de 15s de qualquer jeito, para nunca prender o jogador na página.
  setTimeout(_tavUnlockFooterNav, 15000);
}

// ── Reconexão ao voltar para a aba (resolve desconexão ao trocar janelas) ──
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  // 1. Reconecta Ably se a conexão caiu em background
  if (ablyClient) {
    const st = ablyClient.connection.state;
    if (['disconnected', 'suspended', 'failed'].includes(st)) {
      ablyClient.connect();
    }
  }

  // 2. Re-estabelece conexões WebRTC mortas após ~800ms (tempo para Ably reconectar)
  if (!currentRoom) return;
  setTimeout(() => {
    if (!micOn || !processedStream) return;
    Object.keys(roomMembers).forEach(peerId => {
      const pc = peerConns[peerId];
      if (!pc) {
        // Sem conexão — inicia nova
        initiateCall(peerId);
        return;
      }
      const state = pc.connectionState || pc.iceConnectionState || '';
      if (['disconnected', 'failed', 'closed'].includes(state)) {
        try { pc.close(); } catch(_) {}
        delete peerConns[peerId];
        document.getElementById('audio-' + peerId)?.remove();
        initiateCall(peerId);
      }
    });
  }, 800);
});

function setConnDot(state) {
  const d = document.getElementById('conn-dot');
  if (d) d.className = 'conn-dot ' + state;
}

// Busca avatares null no globalPresenceMap e atualiza o mapa + re-renderiza
async function refreshGlobalAvatars() {
  const nullIds = [];
  Object.values(globalPresenceMap).forEach(room => {
    room.members.forEach(m => { if (!m.avatar_url) nullIds.push(m.id); });
  });
  if (!nullIds.length) return;
  await fetchMissingProfiles(nullIds);
  let updated = false;
  Object.values(globalPresenceMap).forEach(room => {
    room.members.forEach(m => {
      if (!m.avatar_url && ownersCache[m.id]?.avatar_url) {
        m.avatar_url = ownersCache[m.id].avatar_url;
        updated = true;
      }
    });
  });
  if (updated) renderListCards();
}

// ══════════════════════════════════════════
//  PRESENÇA GLOBAL (para contagem na lista)
// ══════════════════════════════════════════
function joinGlobalPresence() {
  if (!ablyClient) return;
  globalChannel = ablyClient.channels.get('taverna:global');

  // Um único subscriber para TODOS os eventos de presença — evita perder eventos
  globalChannel.presence.subscribe((msg) => {
    onGlobalPresence(msg.action, msg);
  });

  // Entra sem sala (está na lista)
  globalChannel.presence.enter({
    name:       PLAYER.name,
    avatar_url: PLAYER.avatar_url || null,
    roomId:     null
  });

  // Após o canal ser attached (SYNC completo), faz refresh completo como segurança
  const doFullRefresh = async () => {
    try {
      const members = await globalChannel.presence.get();
      if (!members) return;
      globalPresenceMap = {};
      members.forEach(m => {
        const d = m.data || {};
        if (d.roomId) {
          const avatarUrl = d.avatar_url || ownersCache[m.clientId]?.avatar_url || null;
          addToGlobalMap(d.roomId, m.clientId, d.name, avatarUrl);
        }
      });
      renderListCards();
      // Busca avatares faltantes após SYNC
      refreshGlobalAvatars();
    } catch(err) {
      console.warn('[Ably] presence.get error:', err);
    }
  };

  if (globalChannel.state === 'attached') {
    doFullRefresh();
  } else {
    globalChannel.once('attached', doFullRefresh);
  }
}

function onGlobalPresence(action, msg) {
  const id = msg.clientId;
  const d  = msg.data || {};

  if (action === 'leave') {
    removeFromGlobalMap(id);
  } else {
    // enter / update / present — remove posição anterior e re-insere
    removeFromGlobalMap(id);
    if (d.roomId) {
      const avatarUrl = d.avatar_url || ownersCache[id]?.avatar_url || null;
      addToGlobalMap(d.roomId, id, d.name, avatarUrl);
      // Se ainda sem avatar, busca do Supabase e atualiza o mapa
      if (!avatarUrl) {
        fetchMissingProfiles([id]).then(() => {
          const fetched = ownersCache[id]?.avatar_url;
          if (!fetched) return;
          // Atualiza entrada no mapa
          const room = globalPresenceMap[d.roomId];
          if (room) {
            const entry = room.members.find(m => m.id === id);
            if (entry) { entry.avatar_url = fetched; renderListCards(); }
          }
        });
      }
    }
  }
  renderListCards();
}

function addToGlobalMap(roomId, clientId, name, avatar_url) {
  if (!globalPresenceMap[roomId]) globalPresenceMap[roomId] = { count: 0, members: [] };
  // Evita duplicatas
  if (!globalPresenceMap[roomId].members.find(m => m.id === clientId)) {
    globalPresenceMap[roomId].members.push({ id: clientId, name, avatar_url });
    globalPresenceMap[roomId].count++;
  }
}

function removeFromGlobalMap(clientId) {
  Object.keys(globalPresenceMap).forEach(roomId => {
    const m = globalPresenceMap[roomId].members;
    const idx = m.findIndex(x => x.id === clientId);
    if (idx !== -1) { m.splice(idx, 1); globalPresenceMap[roomId].count--; }
  });
}


function renderListCards() {
  // Remove shimmer overlay na primeira chamada real (Ably já conectado + presença recebida)
  const overlay = document.getElementById('tavs-shimmer-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.35s';
    setTimeout(() => overlay.remove(), 360);

    // Libera o menu do footer no mesmo instante do shimmer principal —
    // evita que o jogador clique em Navegar/Guilda/Notificações/Eu
    // antes do Ably e do fluxo da página terminarem de carregar.
    _tavUnlockFooterNav();
  }

  // Atualiza os cards na tela de lista
  document.querySelectorAll('.tavern-card').forEach(card => {
      const onclick = card.getAttribute('onclick') || '';
      const match   = onclick.match(/openRoom\('([^']+)'/);
      if (!match) return;
      const roomId = slugify(match[1]);
      const info   = globalPresenceMap[roomId];
      const count  = info?.count || 0;

      // Atualiza contagem — sempre
      const onlineEl = card.querySelector('.t-online');
      if (onlineEl) {
        const dot = onlineEl.querySelector('.online-dot');
        onlineEl.textContent = '';
        if (dot) onlineEl.appendChild(dot);
        onlineEl.appendChild(document.createTextNode(count));
      }

      // Atualiza avatares — sempre (limpa quando vazio)
      const avContainer = card.querySelector('.tavern-avatars');
      if (!avContainer) return;
      avContainer.innerHTML = '';
      if (!count || !info?.members?.length) return;

      const shown = info.members.slice(0, 3);
      shown.forEach(mem => {
        const div = document.createElement('div');
        div.className = 't-av';
        if (mem.avatar_url) {
          const img = document.createElement('img');
          img.src   = mem.avatar_url;
          img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
          div.appendChild(img);
        } else {
          const cv  = document.createElement('canvas');
          cv.width  = 32; cv.height = 32;
          cv.style.borderRadius = '50%';
          const cx  = cv.getContext('2d');
          const hue = [...(mem.name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
          cx.fillStyle = `hsl(${hue},42%,26%)`;
          cx.beginPath(); cx.arc(16, 16, 16, 0, Math.PI * 2); cx.fill();
          cx.fillStyle = '#e8d08a';
          cx.font = 'bold 10px sans-serif';
          cx.textAlign = 'center'; cx.textBaseline = 'middle';
          cx.fillText((mem.name || '?')[0].toUpperCase(), 16, 17);
          div.appendChild(cv);
        }
        avContainer.appendChild(div);
      });
      const extra = count - shown.length;
      if (extra > 0) {
        const more = document.createElement('div');
        more.className  = 't-av-more';
        more.textContent = '+' + extra;
        avContainer.appendChild(more);
      }
    });
}

// ══════════════════════════════════════════
//  ROOM OPEN / CLOSE
// ══════════════════════════════════════════
function openRoom(name, _online, tag) {
  if (!ablyReady) {
    showToast('Aguardando conexao...');
    setTimeout(() => openRoom(name, _online, tag), 1200);
    return;
  }

  const roomId = slugify(name);
  currentRoom  = { id: roomId, name, tag };
  roomMembers  = {};
  mySeats      = {};

  document.getElementById('topbar-center').textContent     = '';
  document.getElementById('btn-back').style.visibility     = 'visible';
  document.getElementById('btn-create').style.display      = 'none';
  document.getElementById('conn-dot').style.display        = 'block';
  document.getElementById('room-header-name').textContent  = name;
  document.getElementById('room-people-count').textContent = '–';
  startRoomNameSlide();

  document.getElementById('list-view').classList.remove('active');
  document.getElementById('room-view').classList.add('active', 'fade-in');

  // Resolve metadata de cidade para tronos
  const cityMeta = CITY_THRONE_DATA[name] ? { ...CITY_THRONE_DATA[name], _playerIsOwnerLeader: false } : null;
  currentRoomCityMeta = cityMeta;
  currentThroneIds = [];
  if (cityMeta) {
    currentThroneIds = cityMeta.throneNobless.map((_, i) => 't' + (i + 1));
    // Async: check if this player is the leader of the guild that owns this city
    (async () => {
      if (!supabase || !PLAYER.guild) return;
      const { data: cityRow } = await supabase
        .from('guild_battle_cities')
        .select('owner')
        .eq('id', cityMeta.cityId)
        .single();
      if (cityRow?.owner === PLAYER.guild && PLAYER.role === 'leader') {
        currentRoomCityMeta._playerIsOwnerLeader = true;
      }
    })();
  } else {
    currentThroneIds = ['t1', 't2'];
  }

  resetSeats();
  buildThroneRow(name);
  clearChat();
  sysMsg('Bem-vindo a ' + name + ' · max ' + ROOM_CAPACITY + ' pessoas');
  sysMsg('Clique em um assento para entrar com o microfone ativado.');

  // Atualiza presença global — informa que entrou nessa sala (sempre com avatar mais recente)
  const avatarForPresence = PLAYER.avatar_url || ownersCache[PLAYER.id]?.avatar_url || null;
  globalChannel?.presence.update({
    name:       PLAYER.name,
    avatar_url: avatarForPresence,
    roomId
  });

  joinChannel(roomId);
}

function closeRoom() {
  // 1. Vacata o assento ANTES de sair do canal
  const mySeatId = Object.keys(mySeats)[0];
  if (mySeatId) {
    clearSeat(mySeatId);
    roomChannel?.publish('seat', { seatId: null, prevSeatId: mySeatId, name: PLAYER.name, avatar_url: PLAYER.avatar_url || null });
    roomChannel?.presence.update({
      name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild,
      seatId: null, muted: micMuted, avatar_url: PLAYER.avatar_url || null
    });
    mySeats = {};
  }

  leaveChannel();
  stopVoice();

  // 2. Atualiza presença global — voltou para a lista (com avatar atualizado)
  const avatarForPresence = PLAYER.avatar_url || ownersCache[PLAYER.id]?.avatar_url || null;
  globalChannel?.presence.update({
    name:       PLAYER.name,
    avatar_url: avatarForPresence,
    roomId:     null
  });

  document.getElementById('topbar-center').textContent = 'Tavernas';
  document.getElementById('btn-back').style.visibility = 'hidden';
  document.getElementById('btn-create').style.display  = '';
  document.getElementById('conn-dot').style.display    = 'none';
  document.getElementById('room-view').classList.remove('active', 'fade-in');
  document.getElementById('list-view').classList.add('active', 'fade-in');
  // Stop room name slide
  clearTimeout(window._rnsTimer);
  const _rnsEl = document.getElementById('room-header-name');
  if (_rnsEl) { _rnsEl.style.transition = 'none'; _rnsEl.style.transform = ''; }

  currentRoom = null;
  micOn = false; micMuted = false; audioMuted = false;
  updateMicBtn();
  document.getElementById('btn-audio-mute')?.classList.remove('audio-off');

  // Limpa estado de proximidade
  Object.keys(_proxPairs).forEach(k => {
    const p = _proxPairs[k];
    renderAura(p.seatA, p.seatB, false, k);
    delete _proxPairs[k];
  });
  Object.keys(_proxBridges).forEach(k => removeProxBridge(k));
  if (_proxTicker) { clearInterval(_proxTicker); _proxTicker = null; }

  // Atualiza a lista com contagens reais (mapa já é mantido pelo onGlobalPresence)
  setTimeout(renderListCards, 400);
}

// ══════════════════════════════════════════
//  ABLY CHANNEL + PRESENCE
// ══════════════════════════════════════════
function joinChannel(roomId) {
  if (roomChannel) {
    try { roomChannel.unsubscribe();          } catch(_){}
    try { roomChannel.presence.unsubscribe(); } catch(_){}
    try { roomChannel.detach();               } catch(_){}
  }
  if (sigChannel) {
    try { sigChannel.unsubscribe(); } catch(_){}
    try { sigChannel.detach();      } catch(_){}
  }

  roomChannel = ablyClient.channels.get('taverna:' + roomId);

  roomChannel.subscribe('msg',   onMsg);
  roomChannel.subscribe('seat',  onSeat);
  roomChannel.subscribe('mod',   onMod);
  roomChannel.subscribe('speak', onSpeak);
  roomChannel.subscribe('gift',  onGiftMsg);
  roomChannel.subscribe('intimacy-aura', onIntimacyAura);
  roomChannel.subscribe('follow_notif', _tavHandleFollowNotif);
  roomChannel.subscribe('spectator-join', (msg) => {
    if (msg.clientId !== PLAYER.id && micOn && localStream) {
      initiateCall(msg.clientId);
    }
  });

  // Canal de sinalização WebRTC (pessoal)
  sigChannel = ablyClient.channels.get('sig:' + roomId + ':' + PLAYER.id);
  sigChannel.subscribe('offer',     (m) => handleOffer(m.clientId, m.data));
  sigChannel.subscribe('answer',    (m) => handleAnswer(m.clientId, m.data));
  sigChannel.subscribe('candidate', (m) => handleCandidate(m.clientId, m.data));

  // Subscriber único para TODOS os eventos de presença da sala
  // (inclui 'present' = membros existentes durante o SYNC inicial)
  roomChannel.presence.subscribe((msg) => onPresence(msg.action, msg));

  roomChannel.presence.enter({
    name: PLAYER.name, role: PLAYER.role,
    guild: PLAYER.guild, seatId: null, muted: false,
    avatar_url: PLAYER.avatar_url || null
  });

  // Aguarda o SYNC completo (canal 'attached') antes de buscar membros
  // Evita presence.get() retornar lista incompleta ou erro
  const doGetMembers = async () => {
    try {
      const members = await roomChannel.presence.get();
      // Sempre atualiza o contador, mesmo sem membros
      if (!members) { updateOnlineCount(); return; }
      const idsToFetch = [];
      members.forEach(m => {
        if (m.clientId === PLAYER.id) return;
        const d = m.data || {};
        // Não sobrescreve se 'present' já populou (durante SYNC)
        if (!roomMembers[m.clientId]) {
          roomMembers[m.clientId] = {
            name: d.name || '?', role: d.role || 'member',
            seatId: d.seatId || null, muted: !!d.muted,
            avatar_url: d.avatar_url || ownersCache[m.clientId]?.avatar_url || null
          };
          if (d.seatId) renderSeat(m.clientId, d.seatId, d.name, d.muted, roomMembers[m.clientId].avatar_url);
          // Popula ownersCache com avatar da presença (resolve chat e modal sem esperar Supabase)
          if (d.avatar_url) cacheAvatarFromPresence(m.clientId, d.name, d.avatar_url);
        } else {
          // Membro já veio via 'present' — só completa campos faltantes
          const ex = roomMembers[m.clientId];
          if (!ex.avatar_url && d.avatar_url) {
            ex.avatar_url = d.avatar_url;
            cacheAvatarFromPresence(m.clientId, d.name, d.avatar_url);
            if (ex.seatId) renderSeat(m.clientId, ex.seatId, ex.name, ex.muted, ex.avatar_url);
          }
        }
        if (!roomMembers[m.clientId].avatar_url) idsToFetch.push(m.clientId);
      });
      updateOnlineCount();
      refreshPeopleModal();
      // Calcula pares adjacentes após sync inicial de presença
      setTimeout(updateProximityPairs, 300);

      // Espectadores: pede aos membros SENTADOS que iniciem uma conexão WebRTC conosco
      // (localStream é null aqui pois não estamos sentados, então não podemos iniciar)
      // Publicamos um evento "spectator-join" para que quem tem microfone ativo
      // nos envie um offer, permitindo que ouçamos sem estar sentados.
      if (!localStream) {
        roomChannel?.publish('spectator-join', { id: PLAYER.id });
      }

      if (idsToFetch.length) {
        fetchMissingProfiles(idsToFetch).then(() => {
          idsToFetch.forEach(id => {
            const mem = roomMembers[id];
            if (!mem || !ownersCache[id]?.avatar_url) return;
            mem.avatar_url = ownersCache[id].avatar_url;
            if (mem.seatId) renderSeat(id, mem.seatId, mem.name, mem.muted, mem.avatar_url);
            if (currentRoom) {
              const room = globalPresenceMap[currentRoom.id];
              if (room) {
                const entry = room.members.find(m => m.id === id);
                if (entry && !entry.avatar_url) entry.avatar_url = ownersCache[id].avatar_url;
              }
            }
          });
          refreshPeopleModal();
          renderListCards();
        });
      }
    } catch(err) {
      console.warn('[Ably] presence.get error:', err);
      updateOnlineCount();
    }
  };

  if (roomChannel.state === 'attached') {
    doGetMembers();
  } else {
    roomChannel.once('attached', doGetMembers);
  }
}

function leaveChannel() {
  try { roomChannel?.presence.leave();       } catch(_){}
  try { roomChannel?.unsubscribe();          } catch(_){}
  try { roomChannel?.presence.unsubscribe(); } catch(_){}
  try { roomChannel?.detach();               } catch(_){}
  try { sigChannel?.unsubscribe();           } catch(_){}
  try { sigChannel?.detach();                } catch(_){}
  roomChannel = null; sigChannel = null;
  for (const pc of Object.values(peerConns)) { try { pc.close(); } catch(_){} }
  peerConns = {};
  document.querySelectorAll('.remote-audio').forEach(el => el.remove());
}

// Popula ownersCache com avatar recebido via presença (sem precisar do Supabase)
// Garante que resolveAvatar() funcione em chat e modal imediatamente
function cacheAvatarFromPresence(id, name, avatarUrl) {
  if (!avatarUrl) return;
  if (!ownersCache[id]) ownersCache[id] = {};
  ownersCache[id].avatar_url = ownersCache[id].avatar_url || avatarUrl;
  ownersCache[id].name       = ownersCache[id].name       || name;
}

function onPresence(action, msg) {
  const id = msg.clientId;
  const d  = msg.data || {};
  if (id === PLAYER.id) return;

  if (action === 'enter' || action === 'present') {
    // 'present' = membro já estava na sala durante o SYNC inicial do Ably
    // 'enter'   = membro entrou em tempo real
    const prevEntry = roomMembers[id];
    roomMembers[id] = {
      name:       d.name       || prevEntry?.name       || '?',
      role:       d.role       || prevEntry?.role       || 'member',
      seatId:     d.seatId     || prevEntry?.seatId     || null,
      muted:      d.muted !== undefined ? !!d.muted : (prevEntry?.muted ?? false),
      avatar_url: d.avatar_url || prevEntry?.avatar_url || ownersCache[id]?.avatar_url || null
    };
    // Popula ownersCache imediatamente — garante avatares em chat/modal sem aguardar Supabase
    if (d.avatar_url) cacheAvatarFromPresence(id, d.name, d.avatar_url);

    if (action === 'enter') sysMsg((d.name || '?') + ' entrou na taverna.');
    if (action === 'enter' && micOn && localStream) initiateCall(id);
    if (roomMembers[id].seatId) {
      renderSeat(id, roomMembers[id].seatId, roomMembers[id].name, roomMembers[id].muted, roomMembers[id].avatar_url);
    }
    // Atualiza pares de intimidade e re-transmite auras ao novo membro
    setTimeout(updateProximityPairs, 200);
    if (action === 'enter' && Object.keys(_proxPairs).length > 0) {
      setTimeout(broadcastAuras, 900);
    }
    // Busca avatar no Supabase se ainda null (último recurso)
    if (!roomMembers[id].avatar_url) {
      fetchMissingProfiles([id]).then(() => {
        if (!ownersCache[id]?.avatar_url) return;
        roomMembers[id].avatar_url = ownersCache[id].avatar_url;
        const mem = roomMembers[id];
        if (mem.seatId) renderSeat(id, mem.seatId, mem.name, mem.muted, mem.avatar_url);
        refreshPeopleModal();
        renderListCards();
      });
    }

  } else if (action === 'update') {
    const prev        = roomMembers[id]?.seatId;
    const existAvatar = roomMembers[id]?.avatar_url;
    const newAvatar   = d.avatar_url || existAvatar || ownersCache[id]?.avatar_url || null;
    roomMembers[id] = {
      name: d.name || '?', role: d.role || 'member',
      seatId: d.seatId || null, muted: !!d.muted,
      avatar_url: newAvatar
    };
    if (d.avatar_url) cacheAvatarFromPresence(id, d.name, d.avatar_url);
    if (prev && prev !== d.seatId) clearSeat(prev);
    if (d.seatId) renderSeat(id, d.seatId, d.name, d.muted, roomMembers[id].avatar_url);
    setTimeout(updateProximityPairs, 200);
    if (!roomMembers[id].avatar_url) {
      fetchMissingProfiles([id]).then(() => {
        if (!ownersCache[id]?.avatar_url) return;
        roomMembers[id].avatar_url = ownersCache[id].avatar_url;
        const mem = roomMembers[id];
        if (mem.seatId) renderSeat(id, mem.seatId, mem.name, mem.muted, mem.avatar_url);
        refreshPeopleModal();
        renderListCards();
      });
    }

  } else if (action === 'leave') {
    const m = roomMembers[id];
    if (m) {
      if (m.seatId) clearSeat(m.seatId);
      sysMsg((m.name || '?') + ' saiu da taverna.');
    }
    delete roomMembers[id];
    peerConns[id]?.close(); delete peerConns[id];
    document.getElementById('audio-' + id)?.remove();
    setTimeout(updateProximityPairs, 200);
  }

  updateOnlineCount();
  refreshPeopleModal();
}


function onMsg(msg) {
  let d = msg.data;
  // Prevenção caso o Ably entregue como string JSON devido à rede do celular
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch(e) {}
  }
  d = d || {};
  chatMsg(d.name || '?', d.text || '', false, msg.clientId);
}

function onSeat(msg) {
  if (msg.clientId === PLAYER.id) return;
  const d = msg.data || {};
  const m = roomMembers[msg.clientId];
  if (m) {
    if (m.seatId && m.seatId !== d.seatId) clearSeat(m.seatId);
    m.seatId = d.seatId || null;
  }
  if (d.seatId) renderSeat(msg.clientId, d.seatId, d.name, false, d.avatar_url || m?.avatar_url);
  else if (d.prevSeatId) clearSeat(d.prevSeatId);
  setTimeout(updateProximityPairs, 200);
}

function onSpeak(msg) {
  if (msg.clientId === PLAYER.id) return;
  const m = roomMembers[msg.clientId];
  if (m?.seatId) setSpeaking(m.seatId, msg.data?.speaking === true);
}

function onMod(msg) {
  const d = msg.data || {};
  if (d.text) modMsg(d.text);
  if (d.target === PLAYER.id) {
    if (d.action === 'kick') { closeRoom(); showToast('Voce foi expulso da sala.'); }
    if (d.action === 'mute') { forceMuteSelf(); }
  }
}

function onGiftMsg(msg) {
  // Ignora a própria mensagem (o remetente já ativou a animação localmente)
  if (msg.clientId === PLAYER.id) return;
  const d = msg.data || {};
  if (!d.giftId) return;
  triggerGiftAnimation({
    senderId:       d.senderId,
    senderAvatar:   d.senderAvatar,
    senderSeatId:   d.senderSeatId,
    recipientIds:   d.recipientIds   || [],
    giftImg:        d.giftImg,
    giftName:       d.giftName,
    giftId:         d.giftId,
    qty:            d.qty || 1,
    senderName:     d.senderName,
    recipientNames: d.recipientNames || []
  });
}

// Toast balão (diferente do showToast normal — posicionado em balão dourado)
function showBalloonToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show', 'toast-balloon');
  clearTimeout(window._btt);
  window._btt = setTimeout(() => { t.classList.remove('show', 'toast-balloon'); }, 3500);
}

function updateOnlineCount() {
  const n  = Object.keys(roomMembers).length + 1;
  const el = document.getElementById('room-people-count');
  if (el) el.textContent = n;
  updateCapacityBar(n);
}

function updateCapacityBar(n) {
  const bar = document.getElementById('capacity-bar');
  if (!bar) return;
  const pct = Math.min(100, Math.round(n / ROOM_CAPACITY * 100));
  bar.style.width = pct + '%';
  bar.style.background = pct >= 90
    ? 'linear-gradient(90deg,#c0392b,#e74c3c)'
    : 'linear-gradient(90deg,var(--green),var(--gold))';
}

// ══════════════════════════════════════════
//  AVATAR — URL real ou canvas de iniciais
// ══════════════════════════════════════════
const avatarCache = {};

function makeAvatar(name, size) {
  const key = name + '_' + size;
  if (avatarCache[key]) return avatarCache[key];
  const c  = document.createElement('canvas');
  c.width  = size; c.height = size;
  const cx = c.getContext('2d');
  const hue = [...(name||'?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  cx.fillStyle = `hsl(${hue},42%,26%)`;
  cx.beginPath(); cx.arc(size/2, size/2, size/2, 0, Math.PI*2); cx.fill();
  const initials = (name.match(/\S+/g)||['?']).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  cx.fillStyle = '#e8d08a';
  cx.font      = `bold ${Math.round(size*0.38)}px sans-serif`;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(initials, size/2, size/2 + 1);
  const url = c.toDataURL();
  avatarCache[key] = url;
  return url;
}

// Retorna URL de avatar: real se disponível, iniciais caso contrário
// Ordem: próprio player → ownersCache (Supabase) → roomMembers (dados de presença) → iniciais
function resolveAvatar(clientId, name, size) {
  if (clientId === PLAYER.id && PLAYER.avatar_url) return PLAYER.avatar_url;
  const cached = ownersCache[clientId];
  if (cached?.avatar_url) return cached.avatar_url;
  // Fallback: avatar vindo dos dados de presença (armazenado em roomMembers)
  const member = roomMembers[clientId];
  if (member?.avatar_url) return member.avatar_url;
  return makeAvatar(name || '?', size);
}

// ══════════════════════════════════════════
//  SEAT SKIN FRAMES
//  Cache compartilhado: skin_modal_v1_${pid} (24h)
//  Mesma chave usada por mines, covil, ranking → zero fetch redundante
// ══════════════════════════════════════════
const _TAV_SKIN_NS = 'skin_modal_v1_';

function _tavGetSkinCache(pid) {
  try {
    const raw = localStorage.getItem(_TAV_SKIN_NS + pid);
    if (!raw) return undefined;
    const obj = JSON.parse(raw);
    if (!obj.e || Date.now() >= obj.e) { localStorage.removeItem(_TAV_SKIN_NS + pid); return undefined; }
    return obj.v; // { frame_url, video_url }
  } catch(e) { return undefined; }
}

function _tavSetSkinCache(pid, data) {
  try { localStorage.setItem(_TAV_SKIN_NS + pid, JSON.stringify({ v: data, e: Date.now() + 86400000 })); } catch(e) {}
}

// Aplica / remove moldura num seat-btn pelo seatId
function _tavApplyFrameToSeat(seatId, frameUrl) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn) return;
  const fr = btn.querySelector('.tav-frame-ol');
  const sh = btn.querySelector('.tav-frame-sh');
  const av = btn.querySelector('.seat-avatar-img');
  if (!fr || !sh) return;
  if (frameUrl) {
    fr.style.backgroundImage = `url('${frameUrl}')`;
    fr.style.display          = 'block';
    if (av) av.style.border   = 'none';
    sh.style.webkitMaskImage  = `url('${frameUrl}')`;
    sh.style.maskImage        = `url('${frameUrl}')`;
    sh.style.display          = 'block';
    btn.classList.add('has-frame');       // Fix 2: push name down 10px via CSS
  } else {
    fr.style.backgroundImage  = '';
    fr.style.display          = 'none';
    sh.style.display          = 'none';
    if (av) av.style.border   = '';
    btn.classList.remove('has-frame');
  }
}

// Remove moldura de um assento (chamado em clearSeat)
function _tavClearFrameFromSeat(seatId) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn) return;
  const fr = btn.querySelector('.tav-frame-ol');
  const sh = btn.querySelector('.tav-frame-sh');
  if (fr) { fr.style.backgroundImage = ''; fr.style.display = 'none'; }
  if (sh) sh.style.display = 'none';
  const av = btn.querySelector('.seat-avatar-img');
  if (av) av.style.border = '';
  btn.classList.remove('has-frame');   // Fix 2: restore normal name gap
}

// Busca e aplica moldura para o jogador num assento
// Usa cache local (24h); se ausente, busca via RPC get_player_skin_urls
async function _tavFetchAndApplyFrame(seatId, playerId) {
  const cached = _tavGetSkinCache(playerId);
  if (cached !== undefined) {
    _tavApplyFrameToSeat(seatId, cached?.frame_url || null);
    return;
  }
  try {
    const sb = getSB();
    if (!sb) return;
    const { data, error } = await sb.rpc('get_player_skin_urls', { p_player_id: playerId });
    if (error) { _tavSetSkinCache(playerId, {}); return; }
    _tavSetSkinCache(playerId, data || {});
    // Verifica se o assento ainda pertence ao mesmo jogador antes de aplicar
    const mem = roomMembers[playerId];
    if (mem?.seatId === seatId || Object.keys(mySeats)[0] === seatId) {
      _tavApplyFrameToSeat(seatId, data?.frame_url || null);
    }
  } catch(e) {
    _tavSetSkinCache(playerId, {});
  }
}

// ══════════════════════════════════════════
//  SEAT RENDERING
// ══════════════════════════════════════════
function renderSeat(clientId, seatId, name, muted, avatarUrl) {
  const btn = document.getElementById('seat-btn-' + seatId);
  const nm  = document.getElementById('seat-name-' + seatId);
  if (!btn) return;
  btn.classList.add('taken');
  btn.classList.toggle('muted', !!muted);
  // Apply local-mute badge (only relevant for others, not self)
  if (clientId !== PLAYER.id) {
    btn.classList.toggle('locally-muted', isLocallyMuted(clientId));
  }
  const img = btn.querySelector('.seat-avatar-img');
  if (img) {
    const url = avatarUrl || resolveAvatar(clientId, name, 104);
    img.src = url;
    img.style.display = 'block';
  }
  if (nm) { nm.textContent = name || '?'; nm.classList.remove('vacant'); }
  // Esconde a plaquinha do trono quando alguém senta
  const badge = btn.querySelector('.throne-role-badge');
  if (badge) badge.style.display = 'none';
  // Aplica moldura (skin frame) para o avatar
  _tavFetchAndApplyFrame(seatId, clientId);
}

function clearSeat(seatId) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn) return;
  btn.className = 'seat-btn';
  const img = btn.querySelector('.seat-avatar-img');
  if (img) { img.src = ''; img.style.display = ''; }
  const nm = document.getElementById('seat-name-' + seatId);
  if (nm) { nm.textContent = 'Vago'; nm.classList.add('vacant'); }
  // Reexibe a plaquinha do trono ao desocupar
  const badge = btn.querySelector('.throne-role-badge');
  if (badge) badge.style.display = '';
  // Limpa moldura ao desocupar assento
  _tavClearFrameFromSeat(seatId);
}

function resetSeats() {
  mySeats = {};
  for (let i = 1; i <= 8; i++) clearSeat(String(i));
  // Clear all possible throne seats
  for (let t = 1; t <= 4; t++) clearSeat('t' + t);
}

function setSpeaking(seatId, on) {
  document.getElementById('seat-btn-' + seatId)?.classList.toggle('speaking', on);
}

// ══════════════════════════════════════════
//  SEAT CLICK / CLAIM
// ══════════════════════════════════════════
function isThroneId(seatId) {
  return /^t\d+$/.test(seatId);
}

// Returns null if allowed, or a string (toast message) if blocked
function getThroneAccessDeniedMsg(seatId) {
  // Bobo da Corte (103) bloqueado em TODOS os assentos de áudio
  if (PLAYER.nobless === 103) return 'O Bobo da Corte não pode usar assentos de áudio.';

  // Assentos normais (mic 1-10): qualquer jogador pode usar (exceto bobo, já tratado acima)
  if (!isThroneId(seatId)) return null;

  const meta = currentRoomCityMeta;

  // Sala sem metadado de cidade: apenas owner/admin (salas customizadas de jogadores)
  if (!meta) {
    if (PLAYER.role !== 'owner' && PLAYER.role !== 'admin')
      return 'Apenas o dono e administradores podem usar os tronos.';
    return null;
  }

  // ── Sala de cidade oficial ──
  const throneIdx      = parseInt(seatId.slice(1), 10) - 1;
  const requiredNobless = meta.throneNobless[throneIdx];

  // Trono do Rei/Rainha / Lord/Lady (requiredNobless === null)
  // → só o líder da guilda dona da cidade (verificado via _playerIsOwnerLeader)
  if (requiredNobless === null) {
    if (currentRoomCityMeta._playerIsOwnerLeader) return null;
    return 'Este trono é reservado ao Rei/Rainha ou Lord/Lady regente desta cidade.';
  }

  // Tronos de título (Consorte, Príncipe/Nobre…)
  // O nobless do jogador deve ser EXATAMENTE o código exigido por ESTE trono
  // (ex: nobless=101 = Consorte da Capital; nobless=201 = Consorte de Zion — não são intercambiáveis)
  if (PLAYER.nobless === requiredNobless) return null;

  const cityName = currentRoom?.name || 'desta cidade';
  const label    = meta.throneLabels[throneIdx] || 'título correspondente';
  return 'Este trono é exclusivo para ' + label + ' d' + (cityName.includes('Capital') ? 'a' : 'e') + ' ' + cityName.replace('Taverna da ', '').replace('Taverna de ', '') + '.';
}

function onSeatClick(seatId) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn) return;
  const isTaken  = btn.classList.contains('taken');
  const isMySeat = !!mySeats[seatId];

  if (!isTaken) {
    const deny = getThroneAccessDeniedMsg(seatId);
    if (deny) { showToast(deny); return; }
    // Regular seat jester block
    if (PLAYER.nobless === 103 && !isThroneId(seatId)) {
      showToast('O Bobo da Corte não pode usar assentos de áudio.');
      return;
    }
    claimSeat(seatId);
    return;
  }

  const rect       = btn.getBoundingClientRect();
  const occupantId = Object.keys(roomMembers).find(id => roomMembers[id].seatId === seatId);
  const occupant   = occupantId ? { id: occupantId, ...roomMembers[occupantId] } : null;
  const isAdmin    = PLAYER.role === 'owner' || PLAYER.role === 'admin';

  if (isMySeat) {
    showCtxMenu(rect, [{ icon: iconLeave(), label: 'Sair do assento', danger: false, action: () => vacateMySeat(seatId) }]);
  } else {
    showCtxMenu(rect, buildOtherMenu(occupant, isAdmin));
  }
}

async function claimSeat(seatId) {
  const total = Object.keys(roomMembers).length + 1;
  if (total >= ROOM_CAPACITY) { showToast('Sala cheia! Limite de ' + ROOM_CAPACITY + ' pessoas.'); return; }

  // Sai do assento anterior
  const prevId = Object.keys(mySeats)[0];
  if (prevId) {
    clearSeat(prevId);
    roomChannel?.publish('seat', { seatId: null, prevSeatId: prevId, name: PLAYER.name, avatar_url: PLAYER.avatar_url || null });
  }
  mySeats = {};

  // Senta com avatar real
  renderSeat(PLAYER.id, seatId, PLAYER.name, false, PLAYER.avatar_url);
  mySeats[seatId] = true;

  roomChannel?.publish('seat', { seatId, prevSeatId: prevId || null, name: PLAYER.name, avatar_url: PLAYER.avatar_url || null });
  roomChannel?.presence.update({
    name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild,
    seatId, muted: false, avatar_url: PLAYER.avatar_url || null
  });

  // Atualiza pares de intimidade por proximidade
  setTimeout(updateProximityPairs, 200);

  // FIX 3: Auto-ativa microfone ao sentar
  await activateMic();
}

function vacateMySeat(seatId) {
  const prev = Object.keys(mySeats)[0];
  clearSeat(seatId);
  delete mySeats[seatId];
  roomChannel?.publish('seat', { seatId: null, prevSeatId: prev || null, name: PLAYER.name, avatar_url: PLAYER.avatar_url || null });
  roomChannel?.presence.update({
    name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild,
    seatId: null, muted: micMuted, avatar_url: PLAYER.avatar_url || null
  });
  sysMsg('Voce saiu do assento.');
  if (micOn) stopVoice();
  setTimeout(updateProximityPairs, 200);
}

// ══════════════════════════════════════════
//  MIC / AUDIO
// ══════════════════════════════════════════
async function activateMic() {
  if (micOn) return; // já ativo
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Voz nao disponivel neste navegador. Use Chrome ou Firefox.');
    return;
  }
  try {
    // Constraints otimizados para captação máxima com fone pendurado / voz baixa.
    // noiseSuppression e echoCancellation DESATIVADOS intencionalmente:
    // — noiseSuppression descarta voz fraca/distante classificando como ruído → principal causa do problema
    // — echoCancellation em celular com fone externo é desnecessário e pode cortar o sinal
    // autoGainControl mantido: o navegador ajusta o nível base do microfone automaticamente
    const constraints = {
      audio: {
        echoCancellation:  false,  // desnecessário com fone externo
        noiseSuppression:  true,   // limpa ruído ambiente do sinal já aberto pelo gate
        autoGainControl:   true,
        sampleRate:        12000,
        channelCount:      1
      },
      video: false
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    // ── Pipeline de ganho via Web Audio API ──────────────────────
    // source (mic raw) → GainNode (MIC_GAIN) → MediaStreamDestination
    // O processedStream resultante é o que vai para os peers WebRTC.
    // Desativar o track do localStream (mute) interrompe o fluxo na
    // source, silenciando automaticamente o processedStream também.
    try {
      micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src      = micAudioCtx.createMediaStreamSource(localStream);
      const gainNode = micAudioCtx.createGain();
      gainNode.gain.value = MIC_GAIN;
      const dst      = micAudioCtx.createMediaStreamDestination();
      src.connect(gainNode);
      gainNode.connect(dst);
      processedStream = dst.stream;
      micGainNode = gainNode;  // salva referência para o noise gate controlar
    } catch (gainErr) {
      // Fallback: usa o stream direto sem ganho se Web Audio não disponível
      console.warn('GainNode nao disponivel, usando stream raw:', gainErr);
      processedStream = localStream;
    }

    micOn    = true;
    micMuted = false;
    updateMicBtn();
    startSpeakDetect();
    for (const peerId of Object.keys(roomMembers)) initiateCall(peerId);
    const sid = Object.keys(mySeats)[0];
    roomChannel?.presence.update({
      name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild,
      seatId: sid, muted: false, avatar_url: PLAYER.avatar_url || null
    });
  } catch (e) {
    localStream     = null;
    processedStream = null;
    const msg = e.name === 'NotAllowedError'  ? 'Permissao de microfone negada. Sente-se e toque no mic para tentar novamente.' :
                e.name === 'NotFoundError'     ? 'Nenhum microfone encontrado.' :
                e.name === 'NotReadableError'  ? 'Microfone em uso por outro app.' :
                'Erro ao acessar microfone: ' + (e.message || e.name);
    showToast(msg);
    console.error('getUserMedia:', e);
  }
}

async function toggleMic() {
  if (Object.keys(mySeats).length === 0) {
    showToast('Sente-se em um assento antes de ativar o microfone.');
    return;
  }

  if (!micOn) {
    showToast('Solicitando acesso ao microfone...');
    await activateMic();
    if (micOn) showToast('Microfone ativo!');
    return;
  }

  // Já ativo: toggle mute
  micMuted = !micMuted;
  localStream?.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
  updateMicBtn();
  const sid = Object.keys(mySeats)[0];
  if (sid) {
    setSpeaking(sid, false);
    document.getElementById('seat-btn-' + sid)?.classList.toggle('muted', micMuted);
  }
  roomChannel?.publish('speak', { speaking: false });
  roomChannel?.presence.update({
    name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild,
    seatId: sid || null, muted: micMuted, avatar_url: PLAYER.avatar_url || null
  });
  showToast(micMuted ? 'Microfone mutado.' : 'Microfone ativo.');
}

function updateMicBtn() {
  const btn    = document.getElementById('btn-mic-mute');
  if (!btn) return;
  const active = micOn && !micMuted;
  btn.classList.toggle('mic-on', active);
  btn.title = active ? 'Clique para mutar' : (micOn ? 'Clique para desmutar' : 'Ativar microfone');
}

function toggleAudio() {
  audioMuted = !audioMuted;
  document.getElementById('btn-audio-mute')?.classList.toggle('audio-off', audioMuted);
  document.querySelectorAll('.remote-audio').forEach(el => {
    const pid = el.id.replace('audio-', '');
    el.muted = audioMuted || isLocallyMuted(pid);
  });
  showToast(audioMuted ? 'Audio mutado.' : 'Audio reativado.');
}

function stopVoice() {
  localStream?.getTracks().forEach(t => { try { t.stop(); } catch(_){} });
  localStream     = null;
  processedStream = null;
  micOn = false; micMuted = false;
  updateMicBtn();
  try { micAudioCtx?.close(); } catch(_){}
  micAudioCtx = null;
  try { audioCtx?.close(); } catch(_){}
  audioCtx = null;
  for (const pc of Object.values(peerConns)) { try { pc.close(); } catch(_){} }
  peerConns = {};
  document.querySelectorAll('.remote-audio').forEach(el => el.remove());
}

function forceMuteSelf() {
  micMuted = true;
  localStream?.getAudioTracks().forEach(t => { t.enabled = false; });
  updateMicBtn();
  showToast('Voce foi silenciado por um moderador.');
}

// Speaking detection + Noise Gate (AnalyserNode — client-side, sem custo de rede)
// O noise gate controla o GainNode: abaixo do threshold o áudio é zerado,
// evitando que ruído ambiente vaze continuamente para os outros jogadores.
function startSpeakDetect() {
  if (!localStream) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(localStream);
    const anl = audioCtx.createAnalyser();
    anl.fftSize = 512;
    src.connect(anl);
    const buf = new Uint8Array(anl.frequencyBinCount);

    let gateOpen    = false;  // estado atual do gate
    let lastAbove   = 0;      // timestamp da última vez que o sinal ficou acima do threshold
    const GATE_HOLD = 300;    // ms — mantém o gate aberto após silêncio para não cortar pausas curtas

    const tick = () => {
      if (!micOn || !localStream) return;
      anl.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;

      // ── Noise Gate ──────────────────────────────────────────────
      if (avg >= NOISE_GATE) lastAbove = Date.now();
      const shouldOpen = (Date.now() - lastAbove) < GATE_HOLD;

      if (shouldOpen !== gateOpen && micGainNode) {
        gateOpen = shouldOpen;
        // Transição suave (10ms) para evitar cliques/estouros no áudio
        micGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        micGainNode.gain.setTargetAtTime(
          gateOpen ? MIC_GAIN : 0,
          audioCtx.currentTime,
          0.01  // constante de tempo da curva exponencial
        );
      }

      // ── Speak detection (anel visual) ───────────────────────────
      const talking = avg > NOISE_GATE && !micMuted;
      const sid     = Object.keys(mySeats)[0];
      if (sid) setSpeaking(sid, talking);

      const now = Date.now();
      if (talking !== speakLastState && now - speakLastTs > 900) {
        roomChannel?.publish('speak', { speaking: talking });
        speakLastTs    = now;
        speakLastState = talking;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) { console.warn('speak detect:', e); }
}

// ══════════════════════════════════════════
//  WEBRTC
// ══════════════════════════════════════════
async function initiateCall(peerId) {
  if (!processedStream) return;

  const existingPc = peerConns[peerId];
  if (existingPc) {
    const state = existingPc.connectionState || existingPc.iceConnectionState || '';
    if (['disconnected', 'failed', 'closed'].includes(state)) {
      // FIX: conexão morta — fecha e recria em vez de ignorar
      try { existingPc.close(); } catch(_) {}
      delete peerConns[peerId];
      document.getElementById('audio-' + peerId)?.remove();
      // cai no bloco abaixo para criar novo peer
    } else {
      const senders  = existingPc.getSenders();
      const hasAudio = senders.some(s => s.track && s.track.kind === 'audio');
      if (!hasAudio) {
        // Correção: Só adiciona a track se ela realmente não estiver lá
        processedStream.getTracks().forEach(t => {
          if (!senders.some(s => s.track === t)) {
            existingPc.addTrack(t, processedStream);
          }
        });
        try {
          const offer = await existingPc.createOffer();
          await existingPc.setLocalDescription(offer);
          sendSignal(peerId, 'offer', offer);
        } catch(e) { console.error('renegotiate:', e); }
      }
      return;
    }
  }

  const pc = makePeer(peerId);
  processedStream.getTracks().forEach(t => pc.addTrack(t, processedStream));
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(peerId, 'offer', offer);
  } catch (e) { console.error('initiateCall:', e); }
}

async function handleOffer(fromId, offer) {
  try {
    let pc = peerConns[fromId];

    // FIX: Glare resolution — ambos os lados podem enviar offer simultaneamente.
    // O lado "polite" (maior UUID) rola de volta seu próprio offer e aceita o do parceiro.
    // O lado "impolite" (menor UUID) ignora o offer de entrada e aguarda o answer.
    if (pc && pc.signalingState === 'have-local-offer') {
      const imPolite = PLAYER.id > fromId;
      if (!imPolite) return;  // lado impolite vence o glare: descarta offer de entrada
      // lado polite: desfaz o próprio offer e aceita o do parceiro
      await pc.setLocalDescription({ type: 'rollback' });
    }

    if (!pc) pc = makePeer(fromId);
    
    if (processedStream) {
      const senders = pc.getSenders();
      // Correção: Previne o erro "InvalidAccessError" que quebrava o áudio de volta
      processedStream.getTracks().forEach(t => {
        if (!senders.some(s => s.track === t)) {
          pc.addTrack(t, processedStream);
        }
      });
    }
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    sendSignal(fromId, 'answer', ans);
  } catch (e) {
    console.error('handleOffer error:', e);
  }
}

async function handleAnswer(fromId, answer) {
  try { await peerConns[fromId]?.setRemoteDescription(new RTCSessionDescription(answer)); } catch(_){}
}

function handleCandidate(fromId, cand) {
  try { peerConns[fromId]?.addIceCandidate(new RTCIceCandidate(cand)); } catch(_){}
}

function makePeer(peerId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConns[peerId] = pc;

  pc.onicecandidate = e => {
    if (e.candidate) sendSignal(peerId, 'candidate', e.candidate.toJSON());
  };
  pc.ontrack = e => {
    let audio = document.getElementById('audio-' + peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id       = 'audio-' + peerId;
      audio.className = 'remote-audio';
      audio.autoplay  = true;
      audio.muted     = audioMuted || isLocallyMuted(peerId);
      document.body.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
    // Correção: Força o play para contornar bloqueios de autoplay em webviews mobile
    audio.play().catch(err => console.warn('Audio play blocked:', err));
  };
  pc.onconnectionstatechange = () => {
    if (['disconnected','failed','closed'].includes(pc.connectionState)) {
      pc.close(); delete peerConns[peerId];
      document.getElementById('audio-' + peerId)?.remove();
    }
  };
  return pc;
}

function sendSignal(targetId, type, data) {
  if (!currentRoom || !ablyClient) return;
  ablyClient.channels.get('sig:' + currentRoom.id + ':' + targetId).publish(type, data);
}

// ══════════════════════════════════════════
//  CHAT
// ══════════════════════════════════════════
function sendMessage() {
  if (!roomChannel) { showToast('Conectando...'); return; }
  const inp  = document.getElementById('chat-input');
  const text = (inp.value || '').trim().slice(0, 300);
  if (!text) return;
  inp.value = '';
  chatMsg(PLAYER.name, text, true, PLAYER.id);
  roomChannel.publish('msg', { name: PLAYER.name, text });
}

function formatCompact(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

function renderMentions(rawText) {
  // Only renders @Name as bold yellow if Name matches an actual room member or self
  const parts = rawText.split(/(@\S+)/g);
  return parts.map(part => {
    if (!part.startsWith('@')) return esc(part);
    const name = part.slice(1);
    if (!name) return esc(part);

    // Check self
    if (name === PLAYER.name) {
      return `<span class="c-mention">${esc(part)}</span>`;
    }
    // Check room members
    const entry = Object.entries(roomMembers).find(([, v]) => v.name === name);
    if (entry) {
      const [id] = entry;
      return `<span class="c-mention" onclick="openPlayerModalFor('${esc(id)}','${esc(name)}')">${esc(part)}</span>`;
    }
    // Not a real member — render as plain text
    return esc(part);
  }).join('');
}

function chatMsg(name, text, isMine, clientId) {
  const c = document.getElementById('chat-messages');
  if (!c) return;
  const m = document.createElement('div');
  m.className = 'chat-msg';
  m.style.flexDirection = isMine ? 'row-reverse' : 'row';
  const av = clientId ? resolveAvatar(clientId, name, 50) : makeAvatar(name, 50);
  
  // Adicionado um balão visual para as mensagens recebidas também (evita parecer "linhas soltas")
  const textStyle = isMine 
    ? 'background:rgba(30,50,80,0.55);padding:5px 10px;border-radius:10px 2px 10px 10px;' 
    : 'background:rgba(60,45,25,0.55);padding:5px 10px;border-radius:2px 10px 10px 10px;border:1px solid rgba(201,169,74,0.15);';

  m.innerHTML = `
    <div class="c-av" onclick="onNameClick('${esc(name)}', event)">
      <img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
    </div>
    <div class="c-body" style="${isMine ? 'align-items:flex-end;' : 'align-items:flex-start;'}">
      <div class="c-name" onclick="onNameClick('${esc(name)}', event)">${esc(name)}</div>
      <div class="c-text" style="${textStyle}">${renderMentions(text)}</div>
    </div>`;
  c.appendChild(m);
  c.scrollTop = c.scrollHeight;
}

function sysMsg(text) {
  const c = document.getElementById('chat-messages');
  if (!c) return;
  const m = document.createElement('div');
  m.className = 'c-sys'; m.textContent = text;
  c.appendChild(m); c.scrollTop = c.scrollHeight;
}
function modMsg(text) {
  const c = document.getElementById('chat-messages');
  if (!c) return;
  const m = document.createElement('div');
  m.className = 'c-mod'; m.textContent = '[ Moderacao ] ' + text;
  c.appendChild(m); c.scrollTop = c.scrollHeight;
}
function clearChat() {
  const c = document.getElementById('chat-messages');
  if (c) c.innerHTML = '';
  closeMentionPicker();
}

function onNameClick(name, e) {
  if (name === PLAYER.name) return;
  const entry = Object.entries(roomMembers).find(([, v]) => v.name === name);
  if (!entry) return;
  const [id] = entry;
  const target = e?.currentTarget || e?.target;
  const rect = target?.getBoundingClientRect() || { bottom: (e?.clientY||100)+10, left: e?.clientX||10, top: e?.clientY||100 };
  showCtxMenu(rect, [
    { icon: iconMention(), label: '@Mencionar', danger: false, action: () => mentionPlayer(name) },
    { icon: iconProfile(), label: 'Ver perfil', danger: false, action: () => openPlayerProfilePage(id, name) },
  ]);
}

// ══════════════════════════════════════════
//  PLAYER PROFILE MODAL
// ══════════════════════════════════════════
// Abre o modal de perfil do jogador (mesmo padrão da guilda e ranking)
// Em tavernas: redireciona para a página de perfil completa (igual ao "Eu")
function openPlayerModalFor(playerId, name) {
  closeMyProfileModal();
  closePlayerProfilePage();

  if (playerId === PLAYER.id) { openMyProfileModal(); return; }
  openPlayerProfilePage(playerId, name);
}

// ══════════════════════════════════════════
//  PLAYER PROFILE PAGE — perfil completo de outro jogador
// ══════════════════════════════════════════
async function openPlayerProfilePage(playerId, name) {
  if (!playerId) return;
  if (playerId === PLAYER.id) { openMyProfileModal(); return; }

  const page = document.getElementById('player-profile-page');
  if (!page) { showToast('Perfil de ' + (name || '?')); return; }

  window._pppPlayerId   = playerId;
  window._pppPlayerName = name;
  window._pppGuildId    = null;

  // Reset UI
  const nameEl   = document.getElementById('ppp-name');
  const levelEl  = document.getElementById('ppp-level');
  const cpEl     = document.getElementById('ppp-cp-val');
  const avatarEl = document.getElementById('ppp-avatar');
  const frameEl  = document.getElementById('ppp-frame');
  const coverEl  = document.getElementById('ppp-cover');
  const guildDiv = document.getElementById('ppp-guild');
  if (nameEl)   nameEl.textContent  = name || '...';
  if (levelEl)  levelEl.textContent = '';
  if (cpEl)     cpEl.textContent    = '0';
  if (avatarEl) { avatarEl.src = makeAvatar(name || '?', 180); avatarEl.style.border = '3px solid var(--gold)'; }
  if (coverEl)  coverEl.style.backgroundImage = '';
  if (guildDiv) guildDiv.style.display = 'none';
  if (frameEl)  { frameEl.src = ''; frameEl.style.display = 'none'; }
  ['ppp-followers','ppp-following','ppp-fame','ppp-gifts'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '—'; el.style.opacity = '0.4'; }
  });

  // Follow button
  const followBtn = document.getElementById('ppp-follow-btn');
  if (followBtn) {
    followBtn.style.display = 'flex';
    Promise.all([_tavEnsureFollowingSet(), _tavEnsureFollowersSet()])
      .then(() => _tavUpdatePppFollowBtn(followBtn, playerId));
    followBtn.onclick = () => _tavTogglePppFollow(playerId, name);
  }

  // Message button
  const msgBtn = document.getElementById('ppp-msg-btn');
  if (msgBtn) {
    msgBtn.style.display = 'flex';
    msgBtn.onclick = () => {
      closePlayerProfilePage();
      window.location.href = `index.html?action=open_pv&target_id=${encodeURIComponent(playerId)}&target_name=${encodeURIComponent(name)}`;
    };
  }

  page.classList.add('open');

  // Scroll to top
  const inner = document.getElementById('ppp-inner');
  if (inner) inner.scrollTop = 0;

  // Load data in parallel
  _pppLoadPlayerData(playerId);
  _pppLoadSocialStats(playerId);
}

function closePlayerProfilePage() {
  document.getElementById('player-profile-page')?.classList.remove('open');
  window._pppPlayerId   = null;
  window._pppPlayerName = null;
  window._pppGuildId    = null;
}

async function _pppLoadPlayerData(playerId) {
  const avatarEl = document.getElementById('ppp-avatar');
  const frameEl  = document.getElementById('ppp-frame');
  const coverEl  = document.getElementById('ppp-cover');
  const nameEl   = document.getElementById('ppp-name');
  const levelEl  = document.getElementById('ppp-level');
  const cpEl     = document.getElementById('ppp-cp-val');
  const guildDiv = document.getElementById('ppp-guild');
  const fmt      = window.formatNumberCompact || formatCompact;

  // Optimistic avatar from cache
  const cachedOwner = ownersCache[playerId];
  if (cachedOwner?.avatar_url && avatarEl) {
    avatarEl.src = cachedOwner.avatar_url;
    if (coverEl) coverEl.style.backgroundImage = `url('${cachedOwner.avatar_url}')`;
  }

  try {
    // Check local cache (24h)
    const cacheKey = `tav_player_modal_v2_${playerId}`;
    const cached = (() => {
      try {
        const it = JSON.parse(localStorage.getItem(cacheKey));
        if (!it || Date.now() > it.expiry) { localStorage.removeItem(cacheKey); return null; }
        return it.data;
      } catch(e) { return null; }
    })();

    let player = null, guildData = null;

    if (cached) {
      player    = cached.player;
      guildData = cached.guildData;
    } else {
      const sb = getSB();
      if (!sb) return;
      const { data: p } = await sb.from('players')
        .select('id,name,level,avatar_url,guild_id,combat_power')
        .eq('id', playerId).maybeSingle();
      if (!p) return;
      player = p;

      if (p.guild_id) {
        try {
          const gc = sessionStorage.getItem('tav_guild_' + p.guild_id);
          if (gc) { const pg = JSON.parse(gc); if (pg?.n) guildData = { id: p.guild_id, name: pg.n, flag_url: pg.f || '' }; }
          if (!guildData) {
            const { data: g } = await sb.from('guilds').select('id,name,flag_url').eq('id', p.guild_id).maybeSingle();
            if (g) { guildData = g; sessionStorage.setItem('tav_guild_' + p.guild_id, JSON.stringify({ n: g.name, f: g.flag_url, t: Date.now() })); }
          }
        } catch(e) {}
      }
    }

    if (window._pppPlayerId !== playerId) return;

    if (nameEl)  nameEl.textContent  = player.name  || window._pppPlayerName || '?';
    if (levelEl) levelEl.textContent = 'Nível ' + (player.level || 1);
    if (cpEl)    cpEl.textContent    = fmt(Number(player.combat_power || 0));
    if (player.avatar_url) {
      if (avatarEl) avatarEl.src = player.avatar_url;
      if (coverEl)  coverEl.style.backgroundImage = `url('${player.avatar_url}')`;
      ownersCache[playerId] = ownersCache[playerId] || {};
      ownersCache[playerId].avatar_url = player.avatar_url;
    }

    // Skin frame
    const skinCache = _tavGetSkinCache(playerId);
    if (skinCache !== undefined) {
      if (skinCache?.frame_url && frameEl) {
        frameEl.src = skinCache.frame_url; frameEl.style.display = 'block';
        if (avatarEl) avatarEl.style.border = 'none';
      }
    } else {
      try {
        const sb2 = getSB();
        if (sb2) {
          const { data } = await sb2.rpc('get_player_skin_urls', { p_player_id: playerId });
          _tavSetSkinCache(playerId, data || {});
          if (data?.frame_url && frameEl && window._pppPlayerId === playerId) {
            frameEl.src = data.frame_url; frameEl.style.display = 'block';
            if (avatarEl) avatarEl.style.border = 'none';
          }
        }
      } catch(e) { _tavSetSkinCache(playerId, {}); }
    }

    // Guild
    window._pppGuildId = guildData?.id || player.guild_id || null;
    if (guildDiv && guildData?.name && window._pppPlayerId === playerId) {
      guildDiv.style.display = 'block';
      const flagEl  = document.getElementById('ppp-guild-flag');
      const gnameEl = document.getElementById('ppp-guild-name');
      if (flagEl)  flagEl.src        = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
      if (gnameEl) gnameEl.textContent = guildData.name;
      guildDiv.onclick = () => openTavGuildModal(window._pppGuildId);
    }

  } catch(e) { console.warn('[_pppLoadPlayerData]', e); }
}

async function _pppLoadSocialStats(playerId) {
  const sb = getSB();
  if (!sb) return;
  let stats = { fame: 0, followers: 0, following: 0, gifts: 0 };
  const cacheKey = 'tav_sstats_' + playerId;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) { const { v, t } = JSON.parse(cached); if (Date.now() - t < 3 * 60_000) stats = v; }
    if (!stats.fame && !stats.followers && !stats.gifts) {
      const { data } = await sb.rpc('get_social_stats', { p_player_id: playerId });
      if (data) { stats = { fame: data.fame||0, followers: data.followers||0, following: data.following||0, gifts: data.gifts||0 }; sessionStorage.setItem(cacheKey, JSON.stringify({ v: stats, t: Date.now() })); }
    }
  } catch(e) {}
  if (window._pppPlayerId !== playerId) return;
  const map = { 'ppp-fame': stats.fame, 'ppp-followers': stats.followers, 'ppp-following': stats.following, 'ppp-gifts': stats.gifts };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = formatCompact(val); el.style.opacity = '1'; }
  });
}

// Follow button da página de perfil
function _tavUpdatePppFollowBtn(btn, targetId) {
  if (!btn) return;
  const isF      = _tavIsFollowing(targetId);
  const followsMe = window._tavFollowersSet?.has(targetId) ?? false;
  const isMutual = isF && followsMe;
  if (isMutual) {
    btn.innerHTML = `<svg viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M1 7l3.5 3.5L9 3"/><path d="M8 7l3.5 3.5L16 3"/></svg><span>Amigos</span>`;
    btn.style.background = 'rgba(80,200,160,0.22)'; btn.style.borderColor = 'rgba(80,200,160,0.65)'; btn.style.color = '#3fcfa8';
  } else if (isF) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px;"><path d="M20 6L9 17l-5-5"/></svg><span>Seguindo</span>`;
    btn.style.background = 'rgba(122,184,255,0.22)'; btn.style.borderColor = 'rgba(122,184,255,0.6)'; btn.style.color = '#7ab8ff';
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg><span>Seguir</span>`;
    btn.style.background = 'rgba(122,184,255,0.08)'; btn.style.borderColor = 'rgba(122,184,255,0.3)'; btn.style.color = '#7ab8ff';
  }
}

async function _tavTogglePppFollow(targetId, targetName) {
  if (!PLAYER.id || !targetId || targetId === PLAYER.id) return;
  const now = Date.now();
  const lastAction = _tavFollowCooldowns[targetId] || 0;
  const remaining  = Math.ceil((_TAV_FOLLOW_COOLDOWN_MS - (now - lastAction)) / 1000);
  if (now - lastAction < _TAV_FOLLOW_COOLDOWN_MS) { showToast(`Aguarde ${remaining}s antes de alterar novamente.`); return; }
  await _tavEnsureFollowingSet();
  const btn = document.getElementById('ppp-follow-btn');
  const isF = _tavIsFollowing(targetId);
  const sb  = getSB();
  if (!sb) { showToast('Sem conexão.'); return; }
  if (isF) {
    const confirmed = await _tavShowUnfollowConfirm(targetName);
    if (!confirmed) return;
  }
  _tavFollowCooldowns[targetId] = now;
  if (isF) {
    // ── RPC PRIMEIRO — só atualiza UI se o banco confirmar ──
    let ufRes = null;
    try {
      const { data, error } = await sb.rpc('unfollow_with_bond_check', { p_target_id: targetId });
      if (error) throw error;
      ufRes = data;
    } catch(e) {
      console.error('[unfollow] RPC falhou:', e);
      showToast('Erro ao deixar de seguir. Tente novamente.');
      return; // aborta — não atualiza UI
    }
    window._tavFollowingSet.delete(targetId);
    _tavUpdatePppFollowBtn(btn, targetId);
    chatMsg('Sistema', `Você deixou de seguir ${targetName}.`, false, 'system');
    _tavRefreshSocialCount(-1);
    if (ufRes?.had_bond) {
      const lbl = ufRes.bond_type === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
      chatMsg('Sistema', `Laço de ${lbl} com ${targetName} foi desfeito.`, false, 'system');
      await _bondsClearCache(PLAYER.id);
      await _bondsClearCache(targetId);
    }
  } else {
    window._tavFollowingSet.add(targetId);
    _tavUpdatePppFollowBtn(btn, targetId);
    chatMsg('Sistema', `Você seguiu ${targetName}.`, false, 'system');
    try { await sb.rpc('follow_player', { p_following_id: targetId }); } catch(e) {}
    _tavRefreshSocialCount(+1);
    try { await sb.rpc('register_follow_notification', { p_target_id: targetId }); } catch(e) {}
    const ablyDedupKey = 'tav_follow_ably_' + targetId;
    const lastSent = Number(sessionStorage.getItem(ablyDedupKey) || 0);
    if (now - lastSent > 300_000) {
      try { if (roomChannel) roomChannel.publish('follow_notif', { toId: targetId, fromId: PLAYER.id, fromName: PLAYER.name }); sessionStorage.setItem(ablyDedupKey, String(now)); } catch(e) {}
    }
  }
}

// Abre o playerModal em modo "equipamentos apenas" (sem stats sociais / botões de ação)
function openEquipmentModal(playerId) {
  if (!playerId) return;
  const modal = document.getElementById('playerModal');
  if (!modal) return;

  window._tavModalEquipOnly = true;
  window._tavModalLastPid   = playerId;
  if (typeof window._tavModalResetSkin === 'function') window._tavModalResetSkin();

  // Oculta elementos sociais
  const socialEl = document.getElementById('pm-social-stats');
  if (socialEl) socialEl.style.display = 'none';
  ['pm-follow-btn','pm-mention-btn','sendmp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Guilda clicável → abre guild modal e fecha equipment
  const guildFlagEl = document.getElementById('playerGuildFlag');
  const guildNameEl = document.getElementById('playerGuildName');
  const _openGuildFromEquip = () => {
    const gid = window._tavModalCurrentGuildId || window._pppGuildId;
    if (gid) { modal.style.display = 'none'; window._tavModalResetSkin?.(); _closeEquipModal(); openTavGuildModal(gid); }
  };
  if (guildFlagEl) { guildFlagEl.onclick = _openGuildFromEquip; guildFlagEl.style.cursor = 'pointer'; }
  if (guildNameEl) { guildNameEl.onclick = _openGuildFromEquip; guildNameEl.style.cursor = 'pointer'; }

  modal.style.display = 'flex';
  tavFetchPlayerData(playerId, null);
}

function _closeEquipModal() {
  const modal = document.getElementById('playerModal');
  if (modal) modal.style.display = 'none';
  window._tavModalResetSkin?.();
  window._tavModalLastPid  = null;
  window._tavModalEquipOnly = false;
  // Restaura social stats e botões para uso normal futuro
  const socialEl = document.getElementById('pm-social-stats');
  if (socialEl) socialEl.style.display = '';
}

// Helper para mencionar jogador no chat
function mentionPlayer(name) {
  if (!name) return;
  const inp = document.getElementById('chat-input');
  if (inp) {
    inp.value = (inp.value.trimEnd() + ' @' + name + ' ');
    inp.focus();
  }
}

// ══════════════════════════════════════════
//  TAV PLAYER MODAL — busca e popula inline
//  Segue o mesmo padrão do playerModal.js
//  mas com correções para o contexto das tavernas
// ══════════════════════════════════════════
const _TAV_SLOT_MAP = { arma:'weapon', anel:'ring', elmo:'helm', colar:'amulet', asa:'wing', armadura:'armor' };
const _TAV_CACHE_TTL = 24 * 60 * 60 * 1000;

function _tavGetModalEls() {
  return {
    name:    document.getElementById('playerName'),
    level:   document.getElementById('playerLevel'),
    flag:    document.getElementById('playerGuildFlag'),
    guild:   document.getElementById('playerGuildName'),
    avatar:  document.getElementById('playerAvatarEquip'),
    cp:      document.getElementById('playerCombatPower'),
    stats: {
      atk:          document.getElementById('playerAttack'),
      def:          document.getElementById('playerDefense'),
      hp:           document.getElementById('playerHealth'),
      critChance:   document.getElementById('playerCritChance'),
      critDmg:      document.getElementById('playerCritDamage'),
      evasion:      document.getElementById('playerEvasion'),
      critReduction:document.getElementById('playerCritReduction'),
    },
    slots: {
      weapon:  document.getElementById('weapon-slot'),
      ring:    document.getElementById('ring-slot'),
      helm:    document.getElementById('helm-slot'),
      special1:document.getElementById('special1-slot'),
      amulet:  document.getElementById('amulet-slot'),
      wing:    document.getElementById('wing-slot'),
      armor:   document.getElementById('armor-slot'),
      special2:document.getElementById('special2-slot'),
    }
  };
}

function _tavClearModal(ui) {
  if (ui.name)  { ui.name.textContent  = 'Carregando...'; }
  if (ui.level) { ui.level.textContent = ''; }
  if (ui.flag)  { ui.flag.src = 'https://aden-rpg.pages.dev/assets/guildaflag.webp'; }
  if (ui.guild) { ui.guild.textContent = ''; }
  if (ui.avatar){ ui.avatar.src = 'https://via.placeholder.com/100'; }
  if (ui.cp)    { ui.cp.textContent = ''; }
  Object.values(ui.stats).forEach(el => { if(el) { el.textContent = ''; el.classList.add('shimmer'); } });
  Object.values(ui.slots).forEach(el => { if(el) { el.innerHTML = '';   el.classList.add('shimmer'); } });
  // Reset social stats
  ['pm-followers-val','pm-following-val','pm-fame-val','pm-gifts-val'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '—'; el.style.opacity = '0.4'; }
  });
}

function _tavPopulateModal(ui, player, items, guildData) {
  if (!player) return;

  const cachedStats = player.calculated_local_stats || player.cached_combat_stats || player;
  const fmt = window.formatNumberCompact || formatCompact;

  const stats = {
    min_attack:     cachedStats.min_attack     || 0,
    attack:         cachedStats.attack         || 0,
    defense:        cachedStats.defense        || 0,
    health:         cachedStats.health         || 0,
    crit_chance:    cachedStats.crit_chance    || 0,
    crit_damage:    cachedStats.crit_damage    || 0,
    evasion:        cachedStats.evasion        || 0,
    crit_reduction: cachedStats.crit_reduction || 0,
  };

  if (ui.name)  ui.name.textContent  = player.name  || 'Jogador';
  if (ui.level) ui.level.textContent = `Nv. ${player.level || 1}`;
  if (ui.avatar) ui.avatar.src = player.avatar_url || 'https://via.placeholder.com/100';
  if (ui.cp)    ui.cp.textContent = fmt(Number(player.combat_power || 0));

  const gName = guildData?.name || player.guild_name || '';
  const gFlag = guildData?.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
  const gId   = guildData?.id || player.guild_id || null;
  window._tavModalCurrentGuildId = gId; // para o clique na bandeira/nome
  if (ui.flag)  ui.flag.src = gFlag;
  if (ui.guild) ui.guild.textContent = gName;

  // Atributos sem compactar (exibe número inteiro)
  const fmtRaw = (n) => String(Number(n) || 0);
  if (ui.stats.atk)          ui.stats.atk.textContent          = `${fmtRaw(stats.min_attack)} - ${fmtRaw(stats.attack)}`;
  if (ui.stats.def)          ui.stats.def.textContent          = fmtRaw(stats.defense);
  if (ui.stats.hp)           ui.stats.hp.textContent           = fmtRaw(stats.health);
  if (ui.stats.critChance)   ui.stats.critChance.textContent   = `${stats.crit_chance}%`;
  if (ui.stats.critDmg)      ui.stats.critDmg.textContent      = `${stats.crit_damage}%`;
  if (ui.stats.evasion)      ui.stats.evasion.textContent      = `${stats.evasion}%`;
  if (ui.stats.critReduction)ui.stats.critReduction.textContent= `${stats.crit_reduction}%`;

  // Remove shimmer
  document.querySelectorAll('#playerModal .shimmer').forEach(el => el.classList.remove('shimmer'));

  // Render equipped items
  Object.values(ui.slots).forEach(s => { if(s) s.innerHTML = ''; });
  (items || []).forEach(invItem => {
    // Hidratação: se o join FK falhou, tenta window.itemDefinitions
    if (!invItem.items && invItem.item_id && window.itemDefinitions) {
      const def = window.itemDefinitions.get(invItem.item_id);
      if (def) invItem.items = def;
    }
    const mapped = _TAV_SLOT_MAP[invItem.equipped_slot] || invItem.equipped_slot;
    const slotDiv = ui.slots[mapped];
    if (!slotDiv || !invItem.items) return;
    const totalStars = (invItem.items.stars || 0) + (invItem.refine_level || 0);
    const safeName   = invItem.items.name || 'unknown';
    const imgSrc     = invItem.items.image_url
      || `https://aden-rpg.pages.dev/assets/itens/${safeName}_${totalStars}estrelas.webp`;
    let html = `<img src="${imgSrc}" alt="${invItem.items.display_name || ''}">`;
    if (invItem.level >= 1) html += `<div class="item-level">Nv. ${invItem.level}</div>`;
    slotDiv.innerHTML = html;
  });
}

async function tavFetchPlayerData(playerId, sendmpBtn) {
  const ui = _tavGetModalEls();
  _tavClearModal(ui);

  try {
    // ── Identify current user via existing helpers ──
    const auth = await getAuthFromDB();
    const currentUserId = auth?.user?.id || PLAYER.id || null;

    // ── CASO A: próprio jogador (zero egress) ──
    if (currentUserId && playerId === currentUserId) {
      if (sendmpBtn) sendmpBtn.style.display = 'none';

      const localPlayer = await dbGetPlayer();

      // InventoryDB items
      const localItems = await (async () => {
        try {
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open('aden_inventory_db');
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
          });
          if (!db.objectStoreNames.contains('inventory_store')) return [];
          return new Promise(res => {
            const tx  = db.transaction('inventory_store', 'readonly');
            const req = tx.objectStore('inventory_store').getAll();
            req.onsuccess = () => res((req.result || []).filter(i => i.equipped_slot !== null && i.quantity > 0));
            req.onerror = () => res([]);
          });
        } catch(e) { return []; }
      })();

      // Meta store (calculated stats)
      const localStats = await (async () => {
        try {
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open('aden_inventory_db');
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
          });
          if (!db.objectStoreNames.contains('meta_store')) return null;
          return new Promise(res => {
            const tx  = db.transaction('meta_store', 'readonly');
            const req = tx.objectStore('meta_store').get('player_stats');
            req.onsuccess = () => res(req.result?.value || null); req.onerror = () => res(null);
          });
        } catch(e) { return null; }
      })();

      if (localPlayer) {
        if (localStats) localPlayer.calculated_local_stats = localStats;

        // Hydrate items when itemDefinitions not available (tavernas context)
        let finalItems = localItems;
        if (window.itemDefinitions) {
          finalItems = localItems.map(i => {
            if (!i.items?.name) {
              const def = window.itemDefinitions.get(i.item_id || i.id);
              if (def) return { ...i, items: def };
            }
            return i;
          });
        } else {
          const needsHydration = localItems.filter(i => !i.items?.name);
          if (needsHydration.length > 0) {
            try {
              const sb  = getSB();
              const ids = [...new Set(needsHydration.map(i => i.item_id || i.id).filter(Boolean))];
              if (sb && ids.length) {
                const { data: defs } = await sb.from('items').select('id,name,display_name,stars').in('id', ids);
                if (defs?.length) {
                  const defMap = Object.fromEntries(defs.map(d => [d.id, d]));
                  finalItems = localItems.map(i => {
                    if (!i.items?.name) { const def = defMap[i.item_id || i.id]; if (def) return { ...i, items: def }; }
                    return i;
                  });
                }
              }
            } catch(e) {}
          }
        }

        // Guild data: prefer stored guild_name; otherwise fetch via guild_id (w/ sessionStorage cache)
        let guildData = null;
        if (localPlayer.guild_name) {
          guildData = { name: localPlayer.guild_name, flag_url: localPlayer.guild_flag || '' };
        } else if (localPlayer.guild_id) {
          try {
            const gCacheKey = 'tav_guild_' + localPlayer.guild_id;
            const gc = sessionStorage.getItem(gCacheKey);
            if (gc) {
              const p = JSON.parse(gc);
              guildData = { name: p.n || '', flag_url: p.f || '' };
            } else {
              const sb = getSB();
              if (sb) {
                const { data: g } = await sb.from('guilds').select('name,flag_url').eq('id', localPlayer.guild_id).maybeSingle();
                if (g) {
                  guildData = g;
                  sessionStorage.setItem(gCacheKey, JSON.stringify({ n: g.name, f: g.flag_url, t: Date.now() }));
                }
              }
            }
          } catch(e) {}
        }
        _tavPopulateModal(ui, localPlayer, finalItems, guildData);
        _tavLoadSocialStats(playerId);
        return;
      }
    }

    // ── CASO B: outro jogador ──
    if (sendmpBtn) {
      sendmpBtn.setAttribute('data-player-id',   playerId);
      sendmpBtn.setAttribute('data-player-name', '...');
      sendmpBtn.style.display = 'flex';
    }

    // UI otimista via IDB owners_store (zero egress)
    try {
      const cachedOwner = await (async () => {
        const db = await openGlobalDB();
        return new Promise(res => {
          const tx = db.transaction(OWNERS_STORE, 'readonly');
          const req = tx.objectStore(OWNERS_STORE).get(playerId);
          req.onsuccess = () => res(req.result || null);
          req.onerror  = () => res(null);
        });
      })();
      if (cachedOwner && cachedOwner.name) {
        if (ui.name)   ui.name.textContent = cachedOwner.name;
        if (ui.avatar) ui.avatar.src = cachedOwner.avatar_url || 'https://via.placeholder.com/100';
        if (sendmpBtn) sendmpBtn.setAttribute('data-player-name', cachedOwner.name);
      }
    } catch(e) {}

    // Cache local (24h)
    const cacheKey = `tav_player_modal_v2_${playerId}`;
    const cached   = (() => {
      try {
        const it = JSON.parse(localStorage.getItem(cacheKey));
        if (!it || Date.now() > it.expiry) { localStorage.removeItem(cacheKey); return null; }
        return it.data;
      } catch(e) { return null; }
    })();
    if (cached) {
      _tavPopulateModal(ui, cached.player, cached.items, cached.guildData);
      if (sendmpBtn) sendmpBtn.setAttribute('data-player-name', cached.player?.name || '');
      _tavLoadSocialStats(playerId);
      return;
    }

    const sb = getSB();
    if (!sb) throw new Error('sem conexão');

    // Player — sem fame (pode não existir ainda na tabela)
    const { data: player, error: pErr } = await sb
      .from('players')
      .select('id,name,level,avatar_url,guild_id,combat_power,cached_combat_stats')
      .eq('id', playerId)
      .maybeSingle();

    if (pErr) throw pErr;
    if (!player) throw new Error('Jogador não encontrado');
    if (sendmpBtn) sendmpBtn.setAttribute('data-player-name', player.name || '');

    // Items — usa inventory_items (mesmo padrão de playerModal.js)
    let items = [];
    try {      const { data: inv, error: invErr } = await sb
        .from('inventory_items')
        .select('id,item_id,equipped_slot,level,refine_level,items:items!inventory_items_item_id_fkey(name,display_name,stars)')
        .eq('player_id', playerId)
        .not('equipped_slot', 'is', null)
        .gt('quantity', 0);
      if (!invErr) items = inv || [];
    } catch(e) { items = []; }

    // Guilda: cache local primeiro, Supabase como fallback
    let guildData = null;
    if (player.guild_id) {
      try {
        // 1. localStorage do guild.js
        const glsRaw = localStorage.getItem('guild_info_' + player.guild_id);
        if (glsRaw) {
          const p = JSON.parse(glsRaw);
          if (p?.data?.name && Date.now() < p.expiry)
            guildData = { name: p.data.name, flag_url: p.data.flag_url || '' };
        }
        // 2. sessionStorage da taverna
        if (!guildData) {
          const ssRaw = sessionStorage.getItem('tav_guild_' + player.guild_id);
          if (ssRaw) {
            const p = JSON.parse(ssRaw);
            if (p?.n) guildData = { name: p.n, flag_url: p.f || '' };
          }
        }
        // 3. Supabase
        if (!guildData) {
          const { data: g } = await sb.from('guilds').select('name,flag_url').eq('id', player.guild_id).maybeSingle();
          if (g) {
            guildData = g;
            sessionStorage.setItem('tav_guild_' + player.guild_id,
              JSON.stringify({ n: g.name, f: g.flag_url || '', t: Date.now() }));
          }
        }
      } catch(e) {}
    }

    _tavPopulateModal(ui, player, items, guildData);
    _tavLoadSocialStats(playerId);

    // Salva em cache local (24h) e no IDB owners_store para UI otimista futura
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data: { player, items, guildData }, expiry: Date.now() + _TAV_CACHE_TTL }));
    } catch(e) {}
    try {
      await dbSaveOwners([{ id: player.id, name: player.name, avatar_url: player.avatar_url, guild_id: player.guild_id }]);
    } catch(e) {}

  } catch(e) {
    console.warn('[tavFetchPlayerData]', e);
    if (ui.name) ui.name.textContent = 'Indisponível';
    document.querySelectorAll('#playerModal .shimmer').forEach(el => el.classList.remove('shimmer'));
  }
}


async function _tavLoadSocialStats(playerId) {
  const sb = getSB();
  if (!sb) return;

  // 1 única chamada ao banco em vez de 4 queries separadas
  let stats = { fame: 0, followers: 0, following: 0, gifts: 0 };
  const cacheKey = 'tav_sstats_' + playerId;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { v, t } = JSON.parse(cached);
      if (Date.now() - t < 3 * 60_000) { stats = v; }
    }
    if (!stats.fame && !stats.followers && !stats.gifts) {
      const { data } = await sb.rpc('get_social_stats', { p_player_id: playerId });
      if (data) {
        stats = { fame: data.fame || 0, followers: data.followers || 0, following: data.following || 0, gifts: data.gifts || 0 };
        sessionStorage.setItem(cacheKey, JSON.stringify({ v: stats, t: Date.now() }));
      }
    }
  } catch(e) { console.warn('_tavLoadSocialStats:', e); }

  if (window._tavModalLastPid !== playerId) return;

  const fEl   = document.getElementById('pm-fame-val');
  const foEl  = document.getElementById('pm-followers-val');
  const figEl = document.getElementById('pm-following-val');
  const giEl  = document.getElementById('pm-gifts-val');
  if (fEl)   { fEl.textContent   = formatCompact(stats.fame);      fEl.style.opacity   = '1'; }
  if (foEl)  { foEl.textContent  = formatCompact(stats.followers);  foEl.style.opacity  = '1'; }
  if (figEl) { figEl.textContent = formatCompact(stats.following);  figEl.style.opacity = '1'; }
  if (giEl)  { giEl.textContent  = formatCompact(stats.gifts);      giEl.style.opacity  = '1'; }
}

// ══════════════════════════════════════════
//  MODERATION
// ══════════════════════════════════════════
function buildOtherMenu(occupant, isAdmin) {
  const isMuted = occupant ? isLocallyMuted(occupant.id) : false;
  const items = [
    { icon: iconMention(), label: '@Mencionar', danger: false,
      action: () => mentionPlayer(occupant?.name) },
    { icon: iconProfile(), label: 'Ver perfil', danger: false,
      action: () => openPlayerProfilePage(occupant?.id, occupant?.name) },
    { icon: iconLocalMute(isMuted),
      label: isMuted ? 'Remover silêncio' : 'Silenciar para mim',
      danger: false,
      action: () => { if (occupant) toggleLocalMute(occupant.id); } }
  ];
  if (isAdmin && occupant) {
    const canMod = !(occupant.role === 'owner' || (PLAYER.role === 'admin' && occupant.role === 'admin'));
    if (canMod) {
      items.push({ icon: iconMuteUser(), label: 'Silenciar',          danger: false, action: () => modAction('mute',       occupant) });
      items.push({ icon: iconRemove(),   label: 'Remover do assento', danger: false, action: () => modAction('removeSeat', occupant) });
      if (PLAYER.role === 'owner')
        items.push({ icon: iconKick(), label: 'Expulsar da sala', danger: true, action: () => modAction('kick', occupant) });
    }
  }
  return items;
}

function modAction(action, occupant) {
  if (!occupant || !roomChannel) return;
  let txt = '';

  if (action === 'removeSeat' && occupant.seatId) {
    clearSeat(occupant.seatId);
    if (roomMembers[occupant.id]) roomMembers[occupant.id].seatId = null;
    txt = PLAYER.name + ' removeu ' + occupant.name + ' do assento.';
  }
  if (action === 'mute') {
    const btn      = document.getElementById('seat-btn-' + occupant.seatId);
    const nowMuted = !btn?.classList.contains('muted');
    btn?.classList.toggle('muted', nowMuted);
    txt = PLAYER.name + (nowMuted ? ' silenciou ' : ' dessilenciou ') + occupant.name + '.';
  }
  if (action === 'kick') {
    if (occupant.seatId) clearSeat(occupant.seatId);
    delete roomMembers[occupant.id];
    peerConns[occupant.id]?.close(); delete peerConns[occupant.id];
    document.getElementById('audio-' + occupant.id)?.remove();
    txt = PLAYER.name + ' expulsou ' + occupant.name + ' da sala.';
    updateOnlineCount();
  }
  roomChannel.publish('mod', { action, target: occupant.id, text: txt });
  if (txt) modMsg(txt);
  refreshPeopleModal();
}

// ══════════════════════════════════════════
//  PEOPLE MODAL
// ══════════════════════════════════════════
function openPeopleModal() {
  document.getElementById('people-modal').classList.add('open');
  refreshPeopleModal();
}
function closePeopleModal() {
  document.getElementById('people-modal').classList.remove('open');
}

function refreshPeopleModal() {
  if (!document.getElementById('people-modal')?.classList.contains('open')) return;
  const list = document.getElementById('people-list');
  if (!list) return;
  list.innerHTML = '';

  const self = { id: PLAYER.id, name: PLAYER.name, role: PLAYER.role, seatId: Object.keys(mySeats)[0] || null, muted: micMuted, avatar_url: PLAYER.avatar_url };
  const all  = [self, ...Object.entries(roomMembers).map(([id, v]) => ({ id, ...v }))];
  const byRole = { owner:[], admin:[], member:[] };
  all.forEach(p => (byRole[p.role] ?? byRole.member).push(p));

  if (byRole.owner.length)  renderPeopleSection(list, 'Dono',            byRole.owner);
  if (byRole.admin.length)  renderPeopleSection(list, 'Administradores', byRole.admin);
  if (byRole.member.length) renderPeopleSection(list, 'Membros',         byRole.member);
}

function renderPeopleSection(container, title, people) {
  const lbl = document.createElement('div');
  lbl.className = 'people-section-lbl';
  lbl.textContent = title + ' (' + people.length + ')';
  container.appendChild(lbl);
  people.forEach(p => {
    const isMe    = p.id === PLAYER.id;
    const isAdmin = PLAYER.role === 'owner' || PLAYER.role === 'admin';
    const canMod  = isAdmin && !isMe && !(p.role === 'owner' || (PLAYER.role === 'admin' && p.role === 'admin'));
    const av      = resolveAvatar(p.id, p.name, 76);
    const row     = document.createElement('div');
    row.className = 'person-row';
    row.innerHTML = `
      <div class="person-avatar"><img src="${av}"></div>
      <div class="person-info">
        <div class="person-name">${esc(p.name)}${isMe ? ' <span style="color:var(--blue-light);font-size:0.58rem;">(voce)</span>' : ''}</div>
        <div class="person-role">${roleLabel(p.role)} · ${p.seatId ? 'Assento ' + p.seatId : 'Plateia'}</div>
      </div>
      ${canMod ? `<div class="person-actions">
        <button class="person-act-btn" title="Silenciar"
          onclick="event.stopPropagation();modAction('mute',{id:'${esc(p.id)}',name:'${esc(p.name)}',role:'${p.role}',seatId:'${p.seatId||''}'})">
          ${iconMuteUser()}
        </button>
        ${PLAYER.role==='owner' ? `<button class="person-act-btn danger" title="Expulsar"
          onclick="event.stopPropagation();modAction('kick',{id:'${esc(p.id)}',name:'${esc(p.name)}',role:'${p.role}',seatId:'${p.seatId||''}'});closePeopleModal()">
          ${iconKick()}
        </button>` : ''}
      </div>` : ''}`;
    if (!isMe) row.addEventListener('click', e => {
      if (!e.target.closest('.person-actions')) {
        closePeopleModal();
        openPlayerModalFor(p.id, p.name);
      }
    });
    container.appendChild(row);
  });
}

function roleLabel(r) { return r==='owner'?'Dono':r==='admin'?'Administrador':'Membro'; }

// ══════════════════════════════════════════
//  GIFT MODAL
// ══════════════════════════════════════════
// Presentes ordenados do mais barato ao mais caro
// currency: 'crystals' | 'gold'
const GIFTS = [
  {
    id: 'rosa', name: 'Rosa',
    currency: 'crystals', cost: 500,
    img: 'https://aden-rpg.pages.dev/assets/gift_rosa.webp',
    famePerUnit: 10, intimacyPerUnit: 5
  },
  {
    id: 'urso', name: 'Urso',
    currency: 'gold', cost: 3,
    img: 'https://aden-rpg.pages.dev/assets/gift_urso.webp',
    famePerUnit: 30, intimacyPerUnit: 10
  },
];

// Ícone de moeda por tipo
function currencyIcon(currency) {
  if (currency === 'gold') {
    return `<img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:13px;height:13px;object-fit:contain;vertical-align:-2px;">`;
  }
  return `<img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="width:13px;height:13px;object-fit:contain;vertical-align:-2px;">`;
}

function openGiftModal() {
  selectedGiftRecipients = new Set();
  buildGiftRecipients();
  buildGiftGrid();
  document.getElementById('gift-modal').classList.add('open');
}
function closeGiftModal() { document.getElementById('gift-modal').classList.remove('open'); }

function buildGiftRecipients() {
  const c = document.getElementById('gift-recipients');
  c.innerHTML = '';
  // Inclui todos com assento (exceto o próprio jogador)
  const inSeat = Object.entries(roomMembers)
    .filter(([id, v]) => v.seatId && id !== PLAYER.id)
    .map(([id, v]) => ({ id, ...v }));
  if (!inSeat.length) {
    c.innerHTML = `<span style="font-family:'Cinzel',serif;font-size:0.7rem;color:var(--text-muted);font-style:italic;">Nenhum membro nos assentos.</span>`;
    return;
  }
  inSeat.forEach(m => {
    const item = document.createElement('div');
    item.className = 'gift-rec-item';
    const av = resolveAvatar(m.id, m.name, 84);
    item.innerHTML = `<div class="gift-rec-avatar"><img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div><div class="gift-rec-name">${esc(m.name)}</div>`;
    item.addEventListener('click', () => {
      selectedGiftRecipients.has(m.id) ? selectedGiftRecipients.delete(m.id) : selectedGiftRecipients.add(m.id);
      item.classList.toggle('selected', selectedGiftRecipients.has(m.id));
    });
    c.appendChild(item);
  });
}

function buildGiftGrid() {
  const c = document.getElementById('gift-grid-geral');
  c.innerHTML = '';

  // Seletor de quantidade
  const qtyWrap = document.createElement('div');
  qtyWrap.className = 'gift-qty-wrap';
  qtyWrap.innerHTML = `
    <label class="gift-qty-label">Quantidade:</label>
    <select id="gift-qty-select" class="gift-qty-select">
      <option value="1" selected>1</option>
      <option value="10">10</option>
      <option value="50">50</option>
    </select>`;
  c.appendChild(qtyWrap);

  const g = document.createElement('div'); g.className = 'gift-grid';
  GIFTS.forEach(gift => {
    const card = document.createElement('div'); card.className = 'gift-card';
    card.innerHTML = `
      <div class="gift-icon gift-icon-img">
        <img src="${gift.img}" alt="${gift.name}" style="width:52px;height:52px;object-fit:contain;">
      </div>
      <div class="gift-name">${gift.name}</div>
      <div class="gift-cost">
        ${currencyIcon(gift.currency)}
        <span>${gift.cost.toLocaleString()}</span>
      </div>`;
    card.addEventListener('click', () => openGiftConfirmModal(gift));
    g.appendChild(card);
  });
  c.appendChild(g);
  document.getElementById('gift-grid-bolsa').innerHTML = `<div class="gift-empty">Sua bolsa esta vazia.</div>`;
}

// Verifica se dois assentos são adjacentes (para intimidade)
// Adjacentes: 1-2, 2-3, 3-4, 5-6, 6-7, 7-8, 8-9, 9-10 (exceto 4-5)
function areSeatsAdjacent(seatA, seatB) {
  const a = parseInt(seatA, 10);
  const b = parseInt(seatB, 10);
  if (isNaN(a) || isNaN(b)) return false;           // throne seats (t1, t2…) ignorados
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (hi - lo !== 1) return false;
  if (lo === 4 && hi === 5) return false;            // gap entre grupos
  return true;
}

async function sendGift(gift) {
  if (!selectedGiftRecipients.size) { showBalloonToast('Selecione ao menos um destinatário.'); return; }

  const qty        = parseInt(document.getElementById('gift-qty-select')?.value || '1', 10);
  const mySeatId   = Object.keys(mySeats)[0] || null;

  const sb = getSB();
  if (!sb) { showBalloonToast('Erro de conexão.'); return; }

  const recipientIds   = [...selectedGiftRecipients];
  const recipientNames = recipientIds.map(id => roomMembers[id]?.name || '?');
  const recipientSeats = recipientIds.map(id => String(roomMembers[id]?.seatId || ''));

  // Um único RPC atômico: deduz moeda, sobe fama e intimidade — SECURITY DEFINER (contorna RLS)
  const { data, error } = await sb.rpc('tavern_send_gift', {
    p_sender_id:     PLAYER.id,
    p_gift_id:       gift.id,
    p_currency:      gift.currency,
    p_cost_each:     gift.cost,
    p_qty:           qty,
    p_recipient_ids: recipientIds,
    p_fame_each:     gift.famePerUnit,
    p_intimacy_each: gift.intimacyPerUnit,
    p_sender_seat:   String(mySeatId || ''),
    p_recip_seats:   recipientSeats
  });

  if (error) {
    console.error('tavern_send_gift RPC error:', error);
    showBalloonToast('Erro ao enviar presente. Tente novamente.');
    return;
  }

  if (!data?.success) {
    const curr = gift.currency === 'crystals' ? 'cristais' : 'ouro';
    showBalloonToast(`Saldo insuficiente! Você precisa de ${(gift.cost * qty).toLocaleString()} ${curr}.`);
    return;
  }

  // Publica evento no canal para que todos os clientes executem a animação
  roomChannel?.publish('gift', {
    senderId:       PLAYER.id,
    senderName:     PLAYER.name,
    senderAvatar:   PLAYER.avatar_url || null,
    senderSeatId:   mySeatId,
    recipientIds,
    recipientNames,
    giftId:         gift.id,
    giftName:       gift.name,
    giftImg:        gift.img,
    qty
  });

  // Animação local (remetente vê imediatamente, sem esperar Ably echo)
  triggerGiftAnimation({
    senderId:       PLAYER.id,
    senderAvatar:   PLAYER.avatar_url || null,
    senderSeatId:   mySeatId,
    recipientIds,
    giftImg:        gift.img,
    giftName:       gift.name,
    giftId:         gift.id,
    qty,
    senderName:     PLAYER.name,
    recipientNames
  });

  closeGiftModal();
}

// ══════════════════════════════════════════
//  GIFT ANIMATION — queue + full-seat size
// ══════════════════════════════════════════

// Fila global de animações de presentes
const _giftQueue      = [];
let   _giftQueueBusy  = false;

// Obtém o rect do botão do assento (tamanho real em px)
function getSeatAvatarRect(seatId) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn) return null;
  return btn.getBoundingClientRect();
}

// Adiciona à fila e inicia se livre
function triggerGiftAnimation(d) {
  _giftQueue.push(d);
  if (!_giftQueueBusy) _processGiftQueue();
}

async function _processGiftQueue() {
  if (!_giftQueue.length) { _giftQueueBusy = false; return; }
  _giftQueueBusy = true;

  const item = _giftQueue.shift();

  // Log no chat
  giftChatMsg(item.senderName, item.giftImg, item.giftName, item.qty, (item.recipientNames || []).join(', '));

  // Todos os destinatários animam em PARALELO (mesmo tempo)
  const promises = (item.recipientIds || []).map(recipId => {
    // FIX: roomMembers não contém o próprio jogador; se o destinatário sou eu, busco em mySeats
    const recipSeatId = recipId === PLAYER.id
      ? (Object.keys(mySeats)[0] || null)
      : roomMembers[recipId]?.seatId;
    if (!item.senderSeatId || !recipSeatId) return Promise.resolve();
    const fromRect = getSeatAvatarRect(item.senderSeatId);
    const toRect   = getSeatAvatarRect(recipSeatId);
    if (!fromRect || !toRect) return Promise.resolve();
    return _flyGiftAsync(fromRect, toRect, item.senderAvatar, item.giftImg, recipSeatId, item.giftId);
  });

  await Promise.all(promises);

  // Pausa entre itens da fila (evita sobreposição visual)
  await new Promise(r => setTimeout(r, 280));

  _processGiftQueue();
}

// Projétil que voa de um assento ao outro — retorna Promise que resolve ao terminar
function _flyGiftAsync(fromRect, toRect, senderAvatarUrl, giftImg, recipSeatId, giftId) {
  return new Promise(resolve => {
    // Tamanho = 100% do círculo do assento de destino
    const size = Math.round(toRect.width * 2.5);
    const cx   = size / 2;

    const startX = fromRect.left + fromRect.width  / 2 - cx;
    const startY = fromRect.top  + fromRect.height / 2 - cx;
    const endX   = toRect.left   + toRect.width    / 2 - cx;
    const endY   = toRect.top    + toRect.height   / 2 - cx;

    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; z-index:9999; pointer-events:none;
      width:${size}px; height:${size}px; border-radius:50%; overflow:hidden;
      
      left:${startX}px; top:${startY}px;
      transition: left 0.72s cubic-bezier(.35,0,.2,1),
                  top  0.72s cubic-bezier(.35,0,.2,1),
                  opacity 0.18s ease 0.64s,
                  transform 0.72s cubic-bezier(.35,0,.2,1);
      transform: scale(1);
      opacity: 1;
    `;
    el.innerHTML = `<img src="${giftImg}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
    document.body.appendChild(el);

    // Força reflow para a transição CSS funcionar
    void el.offsetWidth;

    el.style.left      = endX + 'px';
    el.style.top       = endY + 'px';
    el.style.opacity   = '0';
    el.style.transform = 'scale(0.6)';

    setTimeout(() => {
      el.remove();
      glowSeat(recipSeatId, giftId);
      resolve();
    }, 940);
  });
}

function glowSeat(seatId, giftId) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn) return;

  // Partícula de chegada
  const spark = document.createElement('div');
  spark.className = 'gift-arrive-spark gift-arrive-' + (giftId || 'default');
  btn.style.position = 'relative';
  btn.appendChild(spark);
  setTimeout(() => spark.remove(), 900);

  // Glow no avatar
  btn.classList.add('gift-glow-pulse');
  setTimeout(() => btn.classList.remove('gift-glow-pulse'), 1000);
}

// Mensagem especial no chat para presentes
function giftChatMsg(senderName, giftImg, giftName, qty, recipientNames) {
  const c = document.getElementById('chat-messages');
  if (!c) return;
  const m = document.createElement('div');
  m.className = 'chat-msg chat-msg-gift';
  m.innerHTML = `
    <div class="c-gift-line">
      <img src="${giftImg}" class="c-gift-icon" alt="${esc(giftName)}">
      <span class="c-gift-text">
        <strong>${esc(senderName)}</strong> enviou
        <strong>${esc(giftName)}</strong>
        x${qty} para <strong>${esc(recipientNames)}</strong>
      </span>
    </div>`;
  c.appendChild(m);
  c.scrollTop = c.scrollHeight;
}

// ══════════════════════════════════════════
//  CONTEXT MENU
// ══════════════════════════════════════════
function showCtxMenu(rect, items) {
  const menu = document.getElementById('ctx-menu');
  const back = document.getElementById('ctx-backdrop');
  menu.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'ctx-item' + (item.danger ? ' danger' : '');
    div.innerHTML = item.icon + `<span>${item.label}</span>`;
    div.addEventListener('click', () => { closeCtxMenu(); item.action(); });
    menu.appendChild(div);
  });
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = rect.bottom + 6, left = rect.left;
  if (top  + items.length * 44 > vh) top  = rect.top  - items.length * 44 - 6;
  if (left + 178              > vw) left = vw - 182;
  menu.style.top  = Math.max(8, top)  + 'px';
  menu.style.left = Math.max(6, left) + 'px';
  menu.classList.add('open'); back.classList.add('open');
}
function closeCtxMenu() {
  document.getElementById('ctx-menu')?.classList.remove('open');
  document.getElementById('ctx-backdrop')?.classList.remove('open');
}

// ══════════════════════════════════════════
//  @MENTION PICKER
// ══════════════════════════════════════════
function showMentionPicker(query) {
  if (!currentRoom) { closeMentionPicker(); return; }
  const picker = document.getElementById('mention-picker');
  const inner  = document.getElementById('mention-picker-inner');
  if (!picker || !inner) return;

  // Build list: all room members + self, filtered by query
  const q = query.toLowerCase();
  const members = Object.entries(roomMembers)
    .map(([id, v]) => ({ id, ...v }))
    .filter(m => !q || m.name.toLowerCase().includes(q));

  if (!members.length) { closeMentionPicker(); return; }

  inner.innerHTML = '';
  members.forEach(m => {
    const av = resolveAvatar(m.id, m.name, 64);
    const seatLabel = m.seatId ? 'Assento ' + m.seatId : 'Plateia';
    const row = document.createElement('div');
    row.className = 'mention-row';
    row.innerHTML = `
      <div class="mention-row-av"><img src="${av}" alt=""></div>
      <span class="mention-row-name">${esc(m.name)}</span>
      <span class="mention-row-seat">${seatLabel}</span>`;
    row.addEventListener('click', () => insertMention(m.name));
    inner.appendChild(row);
  });

  picker.style.display = 'block';
}

function closeMentionPicker() {
  const picker = document.getElementById('mention-picker');
  if (picker) picker.style.display = 'none';
}

function insertMention(name) {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  const val    = inp.value;
  const cursor = inp.selectionStart;
  const before = val.slice(0, cursor);
  const after  = val.slice(cursor);
  // Replace the partial @word with full @Name + space
  const newBefore = before.replace(/@(\S*)$/, '@' + name + ' ');
  inp.value = newBefore + after;
  inp.focus();
  const newPos = newBefore.length;
  inp.setSelectionRange(newPos, newPos);
  closeMentionPicker();
}

// ══════════════════════════════════════════
//  MY PROFILE MODAL
// ══════════════════════════════════════════
async function openMyProfileModal() {
  const modal = document.getElementById('my-profile-modal');
  if (!modal) return;
  modal.classList.add('open');

  // 1. Use PLAYER data already in memory
  const name      = PLAYER.name       || 'Aventureiro';
  const avatarUrl = PLAYER.avatar_url || '';

  // 2. Full player data from IDB for level + cp
  const idbData = await dbGetPlayer();
  const level   = idbData?.level        || 1;
  const cp      = idbData?.combat_power || 0;
  let guildId = idbData?.guild_id || PLAYER.guild || null;
  // Fallback: se IDB não tiver guild_id (primeira vez ou sessão nova), busca do Supabase
  if (!guildId && PLAYER.id && !PLAYER.id.startsWith('p_')) {
    try {
      const sb = getSB();
      if (sb) {
        const { data: pd } = await sb.from('players').select('guild_id').eq('id', PLAYER.id).maybeSingle();
        if (pd?.guild_id) guildId = pd.guild_id;
      }
    } catch(e) {}
  }
  window._mpmGuildId = guildId || null;

  // 3. Cover photo (the avatar itself, full-visible)
  const coverEl = document.getElementById('mpm-cover');
  if (coverEl && avatarUrl) coverEl.style.backgroundImage = `url('${avatarUrl}')`;

  // 4. Avatar
  const avEl = document.getElementById('mpm-avatar');
  if (avEl) avEl.src = avatarUrl || makeAvatar(name, 180);

  // 5. Apply frame if cached
  const skinCache = _tavGetSkinCache(PLAYER.id);
  const frameEl   = document.getElementById('mpm-frame');
  if (frameEl) {
    if (skinCache?.frame_url) {
      frameEl.src           = skinCache.frame_url;
      frameEl.style.display = 'block';
      if (avEl) avEl.style.border = 'none';
    } else {
      frameEl.style.display = 'none';
    }
  }

  // 6. Text fields
  const nameEl = document.getElementById('mpm-name');
  if (nameEl) nameEl.textContent = name;

  const lvlEl = document.getElementById('mpm-level');
  if (lvlEl) lvlEl.textContent = 'Nível ' + level;

  const cpEl = document.getElementById('mpm-cp-val');
  if (cpEl) cpEl.textContent = formatCompact(cp);

  // 7. Social stats (fame, followers, following, gifts) — 1 chamada via RPC
  const sCacheKey = 'tav_sstats_' + PLAYER.id;
  let sStats = { fame: 0, followers: 0, following: 0, gifts: 0 };
  try {
    const cached = sessionStorage.getItem(sCacheKey);
    if (cached) {
      const { v, t } = JSON.parse(cached);
      if (Date.now() - t < 3 * 60_000) sStats = v;
    }
    if (!sStats.fame && !sStats.followers && !sStats.gifts) {
      const sb = getSB();
      if (sb) {
        const { data } = await sb.rpc('get_social_stats', { p_player_id: PLAYER.id });
        if (data) {
          sStats = { fame: data.fame||0, followers: data.followers||0, following: data.following||0, gifts: data.gifts||0 };
          sessionStorage.setItem(sCacheKey, JSON.stringify({ v: sStats, t: Date.now() }));
        }
      }
    }
  } catch(e) {}

  const fameEl = document.getElementById('mpm-fame');
  if (fameEl) fameEl.textContent = formatCompact(sStats.fame);
  const follEl = document.getElementById('mpm-followers');
  if (follEl) follEl.textContent = formatCompact(sStats.followers);
  const folwEl = document.getElementById('mpm-following');
  if (folwEl) folwEl.textContent = formatCompact(sStats.following);
  const giftsEl = document.getElementById('mpm-gifts');
  if (giftsEl) giftsEl.textContent = formatCompact(sStats.gifts);

  // Carrega set de IDs seguidos (para botão Seguir em outros modais)
  _tavEnsureFollowingSet().catch(() => {});

  // 8. Guild row
  const guildDiv = document.getElementById('mpm-guild');
  if (guildDiv && guildId) {
    guildDiv.style.display = 'block';
    const gCacheKey = 'mpm_guild_' + guildId;
    let guildName = '', guildFlag = 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
    try {
      // 1. sessionStorage da taverna
      const gc = sessionStorage.getItem(gCacheKey);
      if (gc) { const p = JSON.parse(gc); guildName = p.n || ''; guildFlag = p.f || guildFlag; }
      // 2. localStorage do guild.js (formato { data:{name,flag_url,...}, expiry:ts })
      if (!guildName) {
        const glsRaw = localStorage.getItem('guild_info_' + guildId);
        if (glsRaw) {
          const p = JSON.parse(glsRaw);
          if (p?.data?.name && Date.now() < p.expiry) {
            guildName = p.data.name;
            guildFlag = p.data.flag_url || guildFlag;
            // Propaga para sessionStorage para próximas chamadas
            sessionStorage.setItem(gCacheKey, JSON.stringify({ n: guildName, f: guildFlag }));
          }
        }
      }
      // 3. Supabase (fallback de rede)
      if (!guildName) {
        const sb = getSB();
        if (sb) {
          const { data } = await sb.from('guilds').select('name, flag_url').eq('id', guildId).maybeSingle();
          if (data) {
            guildName = data.name || '';
            guildFlag = data.flag_url || guildFlag;
            sessionStorage.setItem(gCacheKey, JSON.stringify({ n: guildName, f: guildFlag }));
          }
        }
      }
    } catch(e) {}
    const gNameEl = document.getElementById('mpm-guild-name');
    const gFlagEl = document.getElementById('mpm-guild-flag');
    if (gNameEl) gNameEl.textContent = guildName;
    if (gFlagEl) gFlagEl.src         = guildFlag;
  } else if (guildDiv) {
    guildDiv.style.display = 'none';
  }
}

function closeMyProfileModal() {
  document.getElementById('my-profile-modal')?.classList.remove('open');
}

// ══════════════════════════════════════════
//  TAV GUILD MODAL
// ══════════════════════════════════════════
async function openTavGuildModal(guildId) {
  if (!guildId) return;
  const modal = document.getElementById('tav-guild-modal');
  if (!modal) return;
  modal.classList.add('open');

  // Reset state
  const nameEl    = document.getElementById('tgm-name');
  const descEl    = document.getElementById('tgm-desc');
  const lvlEl     = document.getElementById('tgm-level');
  const membEl    = document.getElementById('tgm-members');
  const flagEl    = document.getElementById('tgm-flag');
  const listEl    = document.getElementById('tgm-member-list');
  const joinRow   = document.getElementById('tgm-join-row');
  const joinBtn   = document.getElementById('tgm-join-btn');

  if (nameEl)  nameEl.textContent = 'Carregando...';
  if (descEl)  descEl.textContent = '';
  if (listEl)  listEl.innerHTML   = '';
  // Esconde e reseta o botão de solicitação para não herdar estado de outra guilda
  if (joinRow) joinRow.style.display = 'none';
  if (joinBtn) {
    joinBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Solicitar Entrada`;
    joinBtn.disabled = false;
    joinBtn.classList.remove('requested');
  }
  window._tgmGuildId = guildId;

  const cacheKey = 'tgm_guild_' + guildId;
  let guildData  = null;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { v, t } = JSON.parse(cached);
      if (Date.now() - t < 10 * 60 * 1000) guildData = v;
    }
    if (!guildData) {
      const sb = getSB();
      if (!sb) throw new Error('no sb');

      const gRes = await sb.from('guilds')
        .select('id,name,description,level,flag_url,max_members')
        .eq('id', guildId).maybeSingle();
      if (gRes.error || !gRes.data) throw gRes.error || new Error('Guilda não encontrada');

      // get_guild_members é SECURITY DEFINER e contorna as RLS de
      // public.players, garantindo a lista de membros mesmo quando o
      // jogador atual não pertence a esta guilda.
      const { data: members, error: mErr } = await sb.rpc('get_guild_members', { p_guild_id: guildId });
      if (mErr) console.warn('get_guild_members:', mErr);

      guildData = gRes.data;
      guildData.players = members || [];
      sessionStorage.setItem(cacheKey, JSON.stringify({ v: guildData, t: Date.now() }));
    }
  } catch(e) {
    if (nameEl) nameEl.textContent = 'Erro ao carregar guilda.';
    return;
  }
  if (!guildData) { if (nameEl) nameEl.textContent = 'Guilda não encontrada.'; return; }

  const allMembers  = (guildData.players || []).filter(p => p.rank !== 'admin');
  const maxM        = guildData.max_members || 30;

  // Populate header
  if (flagEl) flagEl.src         = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
  if (nameEl) nameEl.textContent = guildData.name || '';
  if (descEl) descEl.textContent = guildData.description || '';
  if (lvlEl)  lvlEl.textContent  = 'Nv. ' + (guildData.level || 1);
  if (membEl) membEl.textContent = allMembers.length + ' / ' + maxM + ' membros';
  document.getElementById('tgm-title').textContent = guildData.name || 'Guilda';

  // Join button — show if player has no guild
  const idbPlayer = await dbGetPlayer();
  const hasGuild  = !!(idbPlayer?.guild_id || PLAYER.guild);
  const isInThisGuild = (idbPlayer?.guild_id === guildId || PLAYER.guild === guildId);
  if (joinRow && !hasGuild && !isInThisGuild) {
    joinRow.style.display = 'flex';
    // Check if already requested (persisted across modal close/reopen)
    try {
      const reqs = JSON.parse(localStorage.getItem('tav_guild_requests') || '{}');
      if (reqs[guildId]) {
        _tavSetGuildJoinRequested(document.getElementById('tgm-join-btn'));
        // Verify server-side: if leader rejected, the row no longer exists → clear localStorage
        _tavVerifyGuildRequest(guildId).then(stillPending => {
          if (!stillPending) {
            try {
              const r = JSON.parse(localStorage.getItem('tav_guild_requests') || '{}');
              delete r[guildId];
              localStorage.setItem('tav_guild_requests', JSON.stringify(r));
            } catch(_) {}
            // Restore "Solicitar Entrada" button
            const btn2 = document.getElementById('tgm-join-btn');
            if (btn2) {
              btn2.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Solicitar Entrada`;
              btn2.disabled = false;
              btn2.classList.remove('requested');
            }
          }
        });
      }
    } catch(_) {}
  }

  // Members list
  const ROLE_LABEL = { leader: 'Líder', 'co-leader': 'Co-Líder', member: 'Membro' };
  const ROLE_ORDER = { leader: 0, 'co-leader': 1, member: 2 };
  const sorted = allMembers.slice().sort((a,b) => (ROLE_ORDER[a.rank]??2) - (ROLE_ORDER[b.rank]??2));
  if (listEl) {
    sorted.forEach(m => {
      const av = m.avatar_url || makeAvatar(m.name || '?', 72);
      const row = document.createElement('div');
      row.className = 'tgm-member-row';
      row.innerHTML = `
        <div class="tgm-member-av"><img src="${esc(av)}" onerror="this.src='${makeAvatar(m.name||'?',72)}'"></div>
        <div class="tgm-member-info">
          <div class="tgm-member-name">${esc(m.name || '?')}</div>
          <div class="tgm-member-sub">Nv. ${m.level || 1} · PC ${formatCompact(m.combat_power || 0)}</div>
        </div>
        <div class="tgm-member-role">${ROLE_LABEL[m.rank] || 'Membro'}</div>`;
      listEl.appendChild(row);
    });
  }
}

function closeTavGuildModal() {
  document.getElementById('tav-guild-modal')?.classList.remove('open');
}

// ══════════════════════════════════════════
//  SISTEMA DE SEGUIR / SEGUIDORES  (Supabase)
// ══════════════════════════════════════════

// ── Cache em memória (sessão) dos IDs que o jogador atual segue ──
window._tavFollowingSet = null; // null = ainda não carregado
// ── Cache em memória dos IDs que me seguem (para detectar seguimento mútuo) ──
window._tavFollowersSet = null;

async function _tavEnsureFollowingSet() {
  if (window._tavFollowingSet !== null) return;
  window._tavFollowingSet = new Set();
  try {
    const sb = getSB();
    if (!sb || !PLAYER.id) return;
    const { data } = await sb.rpc('get_following_ids', { p_player_id: PLAYER.id });
    (data || []).forEach(r => window._tavFollowingSet.add(r.id));
  } catch(e) { console.warn('_tavEnsureFollowingSet:', e); }
}

async function _tavEnsureFollowersSet() {
  if (window._tavFollowersSet !== null) return;
  window._tavFollowersSet = new Set();
  try {
    const sb = getSB();
    if (!sb || !PLAYER.id) return;
    // Quem ME segue: busca follower_id onde following_id = eu
    const { data } = await sb
      .from('player_follows')
      .select('follower_id')
      .eq('following_id', PLAYER.id);
    (data || []).forEach(r => window._tavFollowersSet.add(r.follower_id));
  } catch(e) { console.warn('_tavEnsureFollowersSet:', e); }
}

function _tavIsFollowing(targetId) {
  return window._tavFollowingSet?.has(targetId) ?? false;
}

function _tavUpdateFollowBtn(btn, targetId) {
  if (!btn) return;
  const isF       = _tavIsFollowing(targetId);
  const followsMe = window._tavFollowersSet?.has(targetId) ?? false;
  const isMutual  = isF && followsMe;

  if (isMutual) {
    // Seguimento mútuo — ícone de dois V (double-checkmark) azul
    btn.innerHTML = `<svg viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:14px;"><path d="M1 7l3.5 3.5L9 3"/><path d="M8 7l3.5 3.5L16 3"/></svg>Amigos`;
    btn.style.background   = 'rgba(80,200,160,0.22)';
    btn.style.borderColor  = 'rgba(80,200,160,0.65)';
    btn.style.color        = '#3fcfa8';
  } else if (isF) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px;"><path d="M20 6L9 17l-5-5"/></svg>Seguindo`;
    btn.style.background   = 'rgba(122,184,255,0.22)';
    btn.style.borderColor  = 'rgba(122,184,255,0.6)';
    btn.style.color        = '#7ab8ff';
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>Seguir`;
    btn.style.background   = 'rgba(122,184,255,0.08)';
    btn.style.borderColor  = 'rgba(122,184,255,0.3)';
    btn.style.color        = '#7ab8ff';
  }
}

// ── Anti-flood: cooldown de 30s por alvo ──
const _tavFollowCooldowns = {};
const _TAV_FOLLOW_COOLDOWN_MS = 30_000;

// ══════════════════════════════════════════
//  CONFIRMAÇÃO: deixar de seguir
// ══════════════════════════════════════════
function _tavShowUnfollowConfirm(targetName) {
  return new Promise(resolve => {
    const modal  = document.getElementById('pm-unfollow-confirm');
    const txt    = document.getElementById('pm-unfollow-text');
    const yesBtn = document.getElementById('pm-unfollow-yes');
    const noBtn  = document.getElementById('pm-unfollow-no');
    if (!modal || !yesBtn || !noBtn) { resolve(true); return; }
    txt.textContent = `Tem certeza que deseja deixar de seguir ${targetName}?`;
    modal.style.display = 'flex';
    const cleanup = (val) => {
      modal.style.display = 'none';
      yesBtn.onclick = null; noBtn.onclick = null;
      resolve(val);
    };
    yesBtn.onclick = () => cleanup(true);
    noBtn.onclick  = () => cleanup(false);
  });
}

async function _tavToggleFollow(targetId, targetName) {
  if (!PLAYER.id || !targetId || targetId === PLAYER.id) return;

  const now = Date.now();
  const lastAction = _tavFollowCooldowns[targetId] || 0;
  const remaining  = Math.ceil((_TAV_FOLLOW_COOLDOWN_MS - (now - lastAction)) / 1000);
  if (now - lastAction < _TAV_FOLLOW_COOLDOWN_MS) {
    showToast(`Aguarde ${remaining}s antes de alterar novamente.`);
    return;
  }

  await _tavEnsureFollowingSet();
  const btn      = document.getElementById('pm-follow-btn');
  const isF      = _tavIsFollowing(targetId);
  const sb       = getSB();
  if (!sb) { showToast('Sem conexão.'); return; }

  if (isF) {
    // ── Confirmação antes de deixar de seguir ──
    const confirmed = await _tavShowUnfollowConfirm(targetName);
    if (!confirmed) return;
  }

  _tavFollowCooldowns[targetId] = now;

  if (isF) {
    // ── RPC PRIMEIRO — só atualiza UI se o banco confirmar ──
    let ufRes = null;
    try {
      const { data, error } = await sb.rpc('unfollow_with_bond_check', { p_target_id: targetId });
      if (error) throw error;
      ufRes = data;
    } catch(e) {
      console.error('[unfollow] RPC falhou:', e);
      showToast('Erro ao deixar de seguir. Tente novamente.');
      return; // aborta — não atualiza UI
    }
    // ── Banco confirmou: atualiza UI ──
    window._tavFollowingSet.delete(targetId);
    _tavUpdateFollowBtn(btn, targetId);
    chatMsg('Sistema', `Você deixou de seguir ${targetName}.`, false, 'system');
    _tavRefreshSocialCount(-1);
    if (ufRes?.had_bond) {
      const lbl = ufRes.bond_type === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
      chatMsg('Sistema', `Laço de ${lbl} com ${targetName} foi desfeito.`, false, 'system');
      await _bondsClearCache(PLAYER.id);
      await _bondsClearCache(targetId);
    }
  } else {
    // ── Seguir ──
    window._tavFollowingSet.add(targetId);
    _tavUpdateFollowBtn(btn, targetId);
    chatMsg('Sistema', `Você seguiu ${targetName}.`, false, 'system');
    try { await sb.rpc('follow_player', { p_following_id: targetId }); } catch(e) {}
    _tavRefreshSocialCount(+1);

    // Notificação persistida (Supabase) — entregue quando o alvo
    // entrar nas tavernas, mesmo que esteja offline agora
    try { await sb.rpc('register_follow_notification', { p_target_id: targetId }); } catch(e) {}

    // Ably: publica apenas se não enviou nos últimos 5 min (dedup sessão)
    const ablyDedupKey = 'tav_follow_ably_' + targetId;
    const lastSent = Number(sessionStorage.getItem(ablyDedupKey) || 0);
    if (now - lastSent > 300_000) {
      try {
        if (roomChannel) roomChannel.publish('follow_notif', {
          toId: targetId, fromId: PLAYER.id, fromName: PLAYER.name
        });
        sessionStorage.setItem(ablyDedupKey, String(now));
      } catch(e) {}
    }
  }
}

// Ajusta otimistamente a contagem exibida no modal aberto (evita re-fetch)
function _tavRefreshSocialCount(delta) {
  // No modal do jogador (pm) estamos vendo o perfil do ALVO:
  // quem sofre a mudança é o contador de seguidores dele.
  const pmEl = document.getElementById('pm-followers-val');
  if (pmEl) pmEl.textContent = Math.max(0, (parseInt(pmEl.textContent) || 0) + delta);
  // Na página de perfil (ppp) — contador de seguidores do alvo
  const pppEl = document.getElementById('ppp-followers');
  if (pppEl) pppEl.textContent = Math.max(0, (parseInt(pppEl.textContent) || 0) + delta);
  // No modal "Eu" (mpm) quem muda é o nosso próprio "seguindo".
  const mpmEl = document.getElementById('mpm-following');
  if (mpmEl) mpmEl.textContent = Math.max(0, (parseInt(mpmEl.textContent) || 0) + delta);
}

// ── Notificações (localStorage — recebidas via Ably ou seguimentos locais) ──
function _tavGetNotifications() {
  try { return JSON.parse(localStorage.getItem('tav_notifs_' + PLAYER.id) || '[]'); } catch(e) { return []; }
}
function _tavSaveNotifications(list) {
  try { localStorage.setItem('tav_notifs_' + PLAYER.id, JSON.stringify(list)); } catch(e) {}
}

// ── Busca notificações pendentes registradas via Supabase (ex.: follows
// feitos pela página de guilda/ranking, ou enquanto o jogador estava
// offline) e mescla no cache local de notificações ──
async function _tavFetchPendingNotifications() {
  try {
    const sb = getSB();
    if (!sb || !PLAYER.id) return;
    const { data, error } = await sb.rpc('get_and_clear_follow_notifications');
    if (error || !data?.length) return;

    const notifs = _tavGetNotifications();
    const now = Date.now();
    let changed = false;

    data.forEach(n => {
      if (n.type !== 'follow') return;
      const at = new Date(n.created_at).getTime();
      // Evita duplicar se já existir uma notificação recente do mesmo
      // seguidor (ex.: já recebida via Ably nesta mesma sessão)
      if (notifs.find(x => x.type === 'follow' && x.fromId === n.from_id && Math.abs(now - x.at) < 300_000)) return;
      notifs.unshift({
        id: 'f_' + n.from_id + '_' + at,
        type: 'follow',
        fromId: n.from_id,
        fromName: n.from_name || '',
        fromAvatar: n.from_avatar || ownersCache[n.from_id]?.avatar_url || '',
        readAt: null,
        at
      });
      changed = true;
    });

    if (changed) {
      _tavSaveNotifications(notifs.slice(0, 50));
      _tavUpdateNotifDot();
    }
  } catch(e) {}
}

function _tavHandleFollowNotif(msg) {
  try {
    const { toId, fromId, fromName } = msg.data || {};
    if (!toId || toId !== PLAYER.id) return;
    const notifs = _tavGetNotifications();
    const now    = Date.now();
    // Dedup 5 min
    if (notifs.find(n => n.type==='follow' && n.fromId===fromId && (now-n.at)<300_000)) return;
    notifs.unshift({ id:'f_'+fromId+'_'+now, type:'follow', fromId, fromName,
      fromAvatar: ownersCache[fromId]?.avatar_url||'', readAt:null, at:now });
    _tavSaveNotifications(notifs.slice(0, 50));
    chatMsg('Sistema', `${fromName} seguiu você.`, false, 'system');
    _tavUpdateNotifDot();
  } catch(e) {}
}

function _tavGetUnreadCount() {
  return _tavGetNotifications().filter(n => !n.readAt).length;
}
function _tavUpdateNotifDot() {
  const dot = document.getElementById('nav-notif-dot');
  if (dot) dot.style.display = _tavGetUnreadCount() > 0 ? 'block' : 'none';
}

function openNotifModal() {
  const modal = document.getElementById('tav-notif-modal');
  if (!modal) return;
  modal.classList.add('open');
  _tavRenderNotifs();
  const notifs = _tavGetNotifications().map(n => ({ ...n, readAt: Date.now() }));
  _tavSaveNotifications(notifs);
  _tavUpdateNotifDot();
}
function closeNotifModal() {
  document.getElementById('tav-notif-modal')?.classList.remove('open');
}

function _tavRenderNotifs() {
  const listEl = document.getElementById('tav-notif-list');
  if (!listEl) return;
  const notifs = _tavGetNotifications();
  if (!notifs.length) { listEl.innerHTML = '<div class="tav-notif-empty">Nenhuma notificação.</div>'; return; }
  listEl.innerHTML = '';
  notifs.forEach(n => {
    if (n.type !== 'follow') return;
    const av  = n.fromAvatar || makeAvatar(n.fromName || '?', 40);
    const row = document.createElement('div');
    row.className = 'tav-notif-row' + (n.readAt ? '' : ' unread');
    row.innerHTML = `
      <div class="tav-notif-av"><img src="${esc(av)}" onerror="this.src='${makeAvatar(n.fromName||'?',40)}'"></div>
      <div class="tav-notif-text">
        <strong>${esc(n.fromName)}</strong> começou a te seguir.
        <div class="tav-notif-time">${_tavTimeAgo(n.at)}</div>
      </div>`;
    row.onclick = () => { closeNotifModal(); openPlayerModalFor(n.fromId, n.fromName); };
    listEl.appendChild(row);
  });
}

// ══════════════════════════════════════════
//  LIMPAR NOTIFICAÇÕES (botão no modal)
//  Limpa o cache local (localStorage) E as linhas em
//  player_notifications no banco via clear_my_notifications().
// ══════════════════════════════════════════
async function clearAllNotifications() {
  _tavSaveNotifications([]);
  _tavRenderNotifs();
  _tavUpdateNotifDot();
  try {
    const sb = getSB();
    if (sb) await sb.rpc('clear_my_notifications');
  } catch(e) { console.warn('clear_my_notifications:', e); }
}

// ══════════════════════════════════════════
//  LIMPEZA LAZY SEMANAL: mensagens antigas das tavernas
//  Roda no máximo 1x por semana (por navegador), sem cron job.
// ══════════════════════════════════════════
function _tavGetIsoWeekKey(d = new Date()) {
  // Calcula ano/semana ISO-8601 para usar como chave de controle
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0 = segunda
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}_w${week}`;
}

async function _tavLazyCleanupOldMessages() {
  const sb = getSB();
  if (!sb) return;
  const ck = `tav_msgcleanup_${_tavGetIsoWeekKey()}`;
  if (localStorage.getItem(ck)) return; // já rodou esta semana
  try {
    await sb.rpc('cleanup_old_tavern_messages');
    localStorage.setItem(ck, '1');
  } catch(e) { console.warn('cleanup_old_tavern_messages:', e); }
}

// ══════════════════════════════════════════
//  LIMPEZA LAZY SEMANAL: notificações antigas (player_notifications)
// ══════════════════════════════════════════
async function _tavLazyCleanupOldNotifications() {
  const sb = getSB();
  if (!sb) return;
  const ck = `tav_notifcleanup_${_tavGetIsoWeekKey()}`;
  if (localStorage.getItem(ck)) return; // já rodou esta semana
  try {
    await sb.rpc('cleanup_old_player_notifications');
    localStorage.setItem(ck, '1');
  } catch(e) { console.warn('cleanup_old_player_notifications:', e); }
}

function _tavTimeAgo(ts) {
  const d = Date.now() - (ts||0), m = Math.floor(d/60000);
  if (m < 1)  return 'agora';
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h/24)}d atrás`;
}

// ══════════════════════════════════════════
//  MODAL DE LISTA: SEGUIDORES / SEGUINDO
//  (Supabase paginado, 10 por vez, infinite scroll)
// ══════════════════════════════════════════

const _tsl = { type:null, pid:null, page:0, loading:false, exhausted:false };

async function openSocialListModal(type, targetPlayerId) {
  const modal   = document.getElementById('tav-social-list-modal');
  const titleEl = document.getElementById('tsl-title');
  const listEl  = document.getElementById('tsl-list');
  if (!modal || !listEl) return;

  const pid = targetPlayerId || PLAYER.id;
  // Inicializa estado
  Object.assign(_tsl, { type, pid, page:0, loading:false, exhausted:false });

  if (titleEl) titleEl.textContent = type === 'following' ? 'Seguindo' : 'Seguidores';
  listEl.innerHTML = '<div class="tav-notif-empty">Carregando...</div>';
  modal.classList.add('open');

  // Configura scroll infinito
  listEl.onscroll = () => {
    if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 60) {
      _tavLoadSocialPage(listEl);
    }
  };

  await _tavLoadSocialPage(listEl, true /* first */);
}

async function _tavLoadSocialPage(listEl, isFirst = false) {
  if (_tsl.loading || _tsl.exhausted) return;
  _tsl.loading = true;

  const sb = getSB();
  if (!sb) {
    if (isFirst) listEl.innerHTML = '<div class="tav-notif-empty">Sem conexão.</div>';
    _tsl.loading = false;
    return;
  }

  const rpc  = _tsl.type === 'following' ? 'get_following' : 'get_followers';
  const empty = _tsl.type === 'following' ? 'Não está seguindo ninguém.' : 'Nenhum seguidor.';

  try {
    const { data, error } = await sb.rpc(rpc, {
      p_player_id: _tsl.pid,
      p_limit:     10,
      p_offset:    _tsl.page * 10
    });
    if (error) throw error;

    if (isFirst) listEl.innerHTML = '';

    const rows = data || [];
    if (!rows.length && isFirst) {
      listEl.innerHTML = `<div class="tav-notif-empty">${empty}</div>`;
      _tsl.exhausted = true;
      _tsl.loading   = false;
      return;
    }
    if (rows.length < 10) _tsl.exhausted = true;

    // Cacheia perfis no ownersCache + IDB
    if (rows.length) dbSaveOwners(rows);

    rows.forEach(p => {
      const av  = p.avatar_url || makeAvatar(p.name||'?', 40);
      const row = document.createElement('div');
      row.className = 'tav-notif-row';
      row.innerHTML = `
        <div class="tav-notif-av"><img src="${esc(av)}" onerror="this.src='${makeAvatar(p.name||'?',40)}'"></div>
        <div class="tav-notif-text">
          <strong>${esc(p.name||'?')}</strong>
          <div class="tav-notif-time">${formatCompact(p.combat_power||0)} CP</div>
        </div>`;
      row.onclick = () => { closeSocialListModal(); openPlayerModalFor(p.id, p.name); };
      listEl.appendChild(row);
    });

    _tsl.page++;
  } catch(e) {
    console.warn('_tavLoadSocialPage:', e);
    if (isFirst) listEl.innerHTML = '<div class="tav-notif-empty">Erro ao carregar.</div>';
  }
  _tsl.loading = false;
}

function closeSocialListModal() {
  document.getElementById('tav-social-list-modal')?.classList.remove('open');
  _tsl.loading = false; _tsl.exhausted = true; // cancela carregamentos pendentes
}

// ══════════════════════════════════════════
//  MODAL DE FAMA  (Mensal / Total — paginado)
// ══════════════════════════════════════════

const _fame = { tab:'monthly', pid:null, monthly:{page:0,loading:false,exhausted:false},
                total:{page:0,loading:false,exhausted:false} };

async function openFameModal(targetPlayerId) {
  const modal = document.getElementById('tav-fame-modal');
  if (!modal) return;
  const pid = targetPlayerId || PLAYER.id;
  _fame.pid = pid;
  _fame.monthly = { page:0, loading:false, exhausted:false };
  _fame.total   = { page:0, loading:false, exhausted:false };
  _fame.tab     = 'monthly';
  _tavFameSetTab('monthly');
  modal.classList.add('open');

  const sb  = getSB();
  const now = new Date();

  // ── Reconciliação lazy (sem trigger): só para o próprio jogador ──
  // Compara players.fame com a soma logada e insere a diferença se houver.
  // Roda no máximo 1× por sessão para não desperdiçar chamadas.
  if (pid === PLAYER.id && sb && !sessionStorage.getItem('tav_fame_reconciled')) {
    try {
      await sb.rpc('reconcile_fame_log');
      sessionStorage.setItem('tav_fame_reconciled', '1');
    } catch(e) { console.warn('reconcile_fame_log:', e); }
  }

  // ── Cleanup lazy BIMESTRAL (dia 1, meses pares): remove fama com
  // mais de 2 meses E convites de laço esquecidos/nunca respondidos.
  // getMonth()%2===0 garante que só dispara a cada 2 meses (antes
  // disparava todo dia 1 de TODO mês — mensal, não bimestral).
  if (now.getDate() === 1 && now.getMonth() % 2 === 0 && pid === PLAYER.id && sb) {
    const ck = `tav_fame_cleanup_${now.getFullYear()}_${now.getMonth()+1}`;
    if (!localStorage.getItem(ck)) {
      try {
        await sb.rpc('cleanup_old_fame_logs');
        localStorage.setItem(ck, '1');
      } catch(e) {}
    }
  }

  await _tavLoadFamePage('monthly', true);
}

function closeFameModal() {
  document.getElementById('tav-fame-modal')?.classList.remove('open');
  _fame.monthly.loading = false; _fame.monthly.exhausted = true;
  _fame.total.loading   = false; _fame.total.exhausted   = true;
}

function _tavFameSetTab(tab) {
  _fame.tab = tab;
  const btnM = document.getElementById('fame-tab-monthly');
  const btnT = document.getElementById('fame-tab-total');
  const listM = document.getElementById('fame-list-monthly');
  const listT = document.getElementById('fame-list-total');
  if (btnM)  btnM.classList.toggle('active',  tab === 'monthly');
  if (btnT)  btnT.classList.toggle('active',  tab === 'total');
  if (listM) listM.style.display = tab === 'monthly' ? 'block' : 'none';
  if (listT) listT.style.display = tab === 'total'   ? 'block' : 'none';
}

async function switchFameTab(tab) {
  _tavFameSetTab(tab);
  const state = _fame[tab];
  // Só carrega se ainda não carregou nenhuma página
  if (state.page === 0 && !state.loading) {
    await _tavLoadFamePage(tab, true);
  }
}

async function _tavLoadFamePage(tab, isFirst = false) {
  const state = _fame[tab];
  if (state.loading || state.exhausted) return;
  state.loading = true;

  const listEl = document.getElementById(tab === 'monthly' ? 'fame-list-monthly' : 'fame-list-total');
  if (!listEl) { state.loading = false; return; }

  if (isFirst) listEl.innerHTML = '<div class="tav-notif-empty">Carregando...</div>';

  const sb = getSB();
  if (!sb) {
    if (isFirst) listEl.innerHTML = '<div class="tav-notif-empty">Sem conexão.</div>';
    state.loading = false; return;
  }

  const rpc   = tab === 'monthly' ? 'get_fame_monthly' : 'get_fame_total';
  const empty = tab === 'monthly' ? 'Nenhuma fama acumulada este mês.' : 'Nenhum histórico de fama.';

  try {
    const { data, error } = await sb.rpc(rpc, {
      p_player_id: _fame.pid,
      p_limit:     10,
      p_offset:    state.page * 10
    });
    if (error) throw error;

    if (isFirst) listEl.innerHTML = '';
    const rows = data || [];

    if (!rows.length && isFirst) {
      listEl.innerHTML = `<div class="tav-notif-empty">${empty}</div>`;
      state.exhausted = true; state.loading = false; return;
    }
    if (rows.length < 10) state.exhausted = true;

    rows.forEach(r => {
      const when = new Date(r.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
      const row  = document.createElement('div');
      row.className = 'tav-fame-row';
      row.innerHTML = `
        <div class="tav-fame-icon">⭐</div>
        <div class="tav-fame-info">
          <div class="tav-fame-reason">${esc(r.reason || 'Fama recebida')}</div>
          <div class="tav-fame-when">${when}</div>
        </div>
        <div class="tav-fame-amount">+${formatCompact(r.amount)}</div>`;
      listEl.appendChild(row);
    });
    state.page++;
  } catch(e) {
    console.warn('_tavLoadFamePage:', e);
    if (isFirst) listEl.innerHTML = '<div class="tav-notif-empty">Erro ao carregar.</div>';
  }
  state.loading = false;
}

// ══════════════════════════════════════════
//  MODAL DE PRESENTES (Top Presenteadores)
//  Top 10 — quem mais deu fama em presentes
//  para o jogador alvo. Cache leve (3 min)
//  + ownersCache/IDB para avatares/nomes.
// ══════════════════════════════════════════

const _GIFTERS_CACHE_TTL = 3 * 60_000; // 3 minutos

async function openGiftersModal(targetPlayerId) {
  const modal  = document.getElementById('tav-gifters-modal');
  const listEl = document.getElementById('tav-gifters-list');
  if (!modal || !listEl) return;

  const pid = targetPlayerId || PLAYER.id;
  listEl.innerHTML = '<div class="tav-notif-empty">Carregando...</div>';
  modal.classList.add('open');

  // Cache leve em sessionStorage (evita re-leitura ao reabrir o modal)
  const cacheKey = 'tav_gifters_' + pid;
  let rows = null;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { v, t } = JSON.parse(cached);
      if (Date.now() - t < _GIFTERS_CACHE_TTL) rows = v;
    }
  } catch(e) {}

  if (!rows) {
    const sb = getSB();
    if (!sb) {
      listEl.innerHTML = '<div class="tav-notif-empty">Sem conexão.</div>';
      return;
    }
    try {
      const { data, error } = await sb.rpc('get_tavern_gifters', { p_player_id: pid, p_limit: 10 });
      if (error) throw error;
      rows = data || [];
      sessionStorage.setItem(cacheKey, JSON.stringify({ v: rows, t: Date.now() }));
    } catch(e) {
      console.warn('get_tavern_gifters:', e);
      listEl.innerHTML = '<div class="tav-notif-empty">Erro ao carregar.</div>';
      return;
    }
  }

  _tavRenderGiftersList(listEl, rows);
}

function _tavRenderGiftersList(listEl, rows) {
  if (!rows.length) {
    listEl.innerHTML = '<div class="tav-notif-empty">Nenhum presente recebido ainda.</div>';
    return;
  }

  // Cacheia perfis (nome/avatar) no ownersCache + IDB para reuso em outros modais
  dbSaveOwners(rows);

  listEl.innerHTML = '';
  rows.forEach((g, i) => {
    const pos = i + 1;
    const av  = g.avatar_url || ownersCache[g.id]?.avatar_url || makeAvatar(g.name || '?', 40);
    const qty = g.total_qty || 0;
    const row = document.createElement('div');
    row.className = 'tav-gifter-row' + (pos <= 3 ? ' top-' + pos : '');
    row.innerHTML = `
      <div class="tav-gifter-pos">${pos}</div>
      <div class="tav-gifter-av"><img src="${esc(av)}" onerror="this.src='${makeAvatar(g.name||'?',40)}'"></div>
      <div class="tav-gifter-info">
        <span class="tav-gifter-name">${esc(g.name || '?')}</span>
        <div class="tav-gifter-sub">${formatCompact(qty)} presente${qty === 1 ? '' : 's'} enviado${qty === 1 ? '' : 's'}</div>
      </div>
      <div class="tav-gifter-fame">+${formatCompact(g.total_fame || 0)}</div>`;
    row.onclick = () => { closeGiftersModal(); openPlayerModalFor(g.id, g.name); };
    listEl.appendChild(row);
  });
}

function closeGiftersModal() {
  document.getElementById('tav-gifters-modal')?.classList.remove('open');
}



// ── Guild join request persistence ──
function _tavSetGuildJoinRequested(btn) {
  if (!btn) return;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><polyline points="20 6 9 17 4 12"/></svg> Solicitado`;
  btn.disabled = true;
  btn.classList.add('requested');
}

// Verifica se a solicitação ainda está pendente no servidor.
// Retorna true se pendente, false se foi rejeitada/aceita/inexistente.
async function _tavVerifyGuildRequest(guildId) {
  try {
    const sb = getSB();
    if (!sb || !PLAYER.id) return true; // sem conexão → assume pendente
    const { data } = await sb
      .from('guild_join_requests')
      .select('id')
      .eq('guild_id', guildId)
      .eq('player_id', PLAYER.id)
      .maybeSingle();
    return !!data; // true = ainda existe (pendente)
  } catch(_) { return true; } // erro de rede → assume pendente
}

async function tavGuildJoinRequest() {
  const guildId = window._tgmGuildId;
  if (!guildId) return;
  const sb = getSB();
  if (!sb) { showToast('Sem conexão.'); return; }
  const btn = document.getElementById('tgm-join-btn');
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.rpc('create_guild_join_request', {
      p_guild_id:  guildId,
      p_player_id: PLAYER.id,
      p_message:   ''
    });
    if (error) throw error;
    showToast('Solicitação enviada com sucesso!');
    // Persist request so it survives modal close/reopen
    try {
      const reqs = JSON.parse(localStorage.getItem('tav_guild_requests') || '{}');
      reqs[guildId] = true;
      localStorage.setItem('tav_guild_requests', JSON.stringify(reqs));
    } catch(_) {}
    _tavSetGuildJoinRequested(btn);
  } catch(e) {
    showToast('Erro: ' + (e.message || 'Tente novamente.'));
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════
//  NAV
// ══════════════════════════════════════════
function toggleNavDropdown() {
  navDropOpen = !navDropOpen;
  document.getElementById('nav-dropdown').classList.toggle('open', navDropOpen);
  document.getElementById('nav-backdrop').classList.toggle('open', navDropOpen);
  document.getElementById('nav-navegar').classList.toggle('active', navDropOpen);
}
function closeNavDropdown() {
  navDropOpen = false;
  ['nav-dropdown','nav-backdrop'].forEach(id => document.getElementById(id)?.classList.remove('open'));
  document.getElementById('nav-navegar')?.classList.remove('active');
}
function openIframe(title, url) {
  closeNavDropdown();
  document.getElementById('iframe-page-title').textContent = title;
  document.getElementById('iframe-frame').src = url;
  document.getElementById('iframe-overlay').classList.add('open');
}
function closeIframe() {
  document.getElementById('iframe-overlay').classList.remove('open');
  document.getElementById('iframe-frame').src = '';
}

// ══════════════════════════════════════════
//  TABS + INPUTS
// ══════════════════════════════════════════
function bindTabs() {
  document.querySelectorAll('.list-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.list-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById('pane-' + this.dataset.tab)?.classList.add('active');
    });
  });
  document.querySelectorAll('.gift-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.gift-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.gift-tab-pane').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('gift-pane-' + this.dataset.tab)?.classList.add('active');
    });
  });
}
function bindInputs() {
  document.getElementById('btn-back')?.addEventListener('click', closeRoom);
  const chatInp = document.getElementById('chat-input');
  if (chatInp) {
    chatInp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeMentionPicker(); sendMessage(); }
      if (e.key === 'Escape') closeMentionPicker();
    });
    chatInp.addEventListener('input', () => {
      const val = chatInp.value;
      const cursor = chatInp.selectionStart;
      // Find if we're in the middle of typing an @mention
      const before = val.slice(0, cursor);
      const atMatch = before.match(/@(\S*)$/);
      if (atMatch) {
        showMentionPicker(atMatch[1]);
      } else {
        closeMentionPicker();
      }
    });
  }
}

// ══════════════════════════════════════════
//  THRONE ROW (dynamic per city)
// ══════════════════════════════════════════
function buildThroneRow(roomName) {
  const row = document.getElementById('throne-row');
  if (!row) return;
  row.innerHTML = '';

  const meta = CITY_THRONE_DATA[roomName];
  const count = meta ? meta.throneNobless.length : 2;
  const labels = meta ? meta.throneLabels : ['Trono', 'Trono'];

  for (let i = 0; i < count; i++) {
    const tid = 't' + (i + 1);
    const label = labels[i] || 'Trono';
    const seat = document.createElement('div');
    seat.className = 'seat throne-seat';
    seat.id = 'seat-wrap-' + tid;
    seat.innerHTML = `
      <div class="seat-btn" id="seat-btn-${tid}">
        <svg class="seat-mic-svg" viewBox="0 0 48 48" fill="none"><rect x="10" y="18" width="28" height="20" rx="3" fill="none" stroke="#c9a94a" stroke-width="1.4"/><rect x="8" y="36" width="32" height="5" rx="2" fill="none" stroke="#c9a94a" stroke-width="1.2"/><path d="M10 18 L10 8 L20 14 L24 6 L28 14 L38 8 L38 18" fill="none" stroke="#c9a94a" stroke-width="1.4" stroke-linejoin="round"/><circle cx="10" cy="8" r="2" fill="#e8d08a"/><circle cx="24" cy="6" r="2" fill="#e8d08a"/><circle cx="38" cy="8" r="2" fill="#e8d08a"/></svg>
        <img class="seat-avatar-img" src="" alt="">
        <div class="throne-role-badge">${label}</div>
        <div class="muted-badge"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>
        <div class="local-mute-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
          </svg>
        </div>
        <div class="tav-frame-ol"></div>
        <div class="tav-frame-sh"></div>
        <div class="speak-ring-overlay"></div>
      </div>
      <div class="seat-nm vacant" id="seat-name-${tid}">Vago</div>`;
    seat.addEventListener('click', () => onSeatClick(tid));
    row.appendChild(seat);
  }
}

// ══════════════════════════════════════════
//  SEAT GRID (JS-built)
// ══════════════════════════════════════════
function buildSeatsGrid() {
  const grid = document.getElementById('seats-grid');
  if (!grid) return;
  for (let i = 1; i <= 8; i++) {
    const s = document.createElement('div');
    s.className = 'seat';
    s.innerHTML = `
      <div class="seat-btn" id="seat-btn-${i}">
        <svg class="seat-mic-svg" viewBox="0 0 24 24" fill="none" stroke="var(--blue-light)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6">
          <rect x="9" y="2" width="6" height="11" rx="3"/>
          <path d="M5 10a7 7 0 0 0 14 0"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
        <img class="seat-avatar-img" src="" alt="">
        <div class="muted-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round">
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </div>
        <div class="local-mute-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
          </svg>
        </div>
        <div class="tav-frame-ol"></div>
        <div class="tav-frame-sh"></div>
        <div class="speak-ring-overlay"></div>
      </div>
      <div class="seat-nm vacant" id="seat-name-${i}">Vago</div>`;
    s.addEventListener('click', () => onSeatClick(String(i)));
    grid.appendChild(s);
  }
}

// ══════════════════════════════════════════
//  ICONS
// ══════════════════════════════════════════
function iconMention()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>`; }
function iconLocalMute(active) {
  const col = active ? '#e07070' : 'currentColor';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round">
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
    ${active ? '<line x1="1" y1="1" x2="23" y2="23"/>' : '<path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'}
  </svg>`;
}
function iconLeave()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`; }
function iconProfile()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`; }
function iconMuteUser() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`; }
function iconRemove()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`; }
function iconKick()     { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`; }

// ══════════════════════════════════════════
//  GIFT SVGS
// ══════════════════════════════════════════
function gSvg(n) {
  const s = {
    1:`<svg viewBox="0 0 40 40" fill="none"><rect x="14" y="18" width="12" height="18" rx="2" fill="rgba(240,220,160,0.15)" stroke="#e8d08a" stroke-width="1.2"/><path d="M20 18 C20 18 17 14 20 10 C23 14 20 18 20 18Z" fill="#f5a623" stroke="#c9a94a" stroke-width="0.8"/><line x1="20" y1="10" x2="20" y2="7" stroke="#c9a94a" stroke-width="1" stroke-linecap="round"/><rect x="12" y="34" width="16" height="3" rx="1" fill="none" stroke="#c9a94a" stroke-width="1"/></svg>`,
    2:`<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="4" fill="rgba(240,210,80,0.6)" stroke="#e8d08a" stroke-width="1.2"/><ellipse cx="20" cy="12" rx="3" ry="5" fill="rgba(220,100,140,0.5)" stroke="#e87ab0" stroke-width="1"/><ellipse cx="20" cy="28" rx="3" ry="5" fill="rgba(220,100,140,0.5)" stroke="#e87ab0" stroke-width="1"/><ellipse cx="12" cy="20" rx="5" ry="3" fill="rgba(220,100,140,0.5)" stroke="#e87ab0" stroke-width="1"/><ellipse cx="28" cy="20" rx="5" ry="3" fill="rgba(220,100,140,0.5)" stroke="#e87ab0" stroke-width="1"/><line x1="20" y1="32" x2="20" y2="38" stroke="#5a9a50" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    3:`<svg viewBox="0 0 40 40" fill="none"><path d="M15 16 L12 28 Q12 36 20 36 Q28 36 28 28 L25 16 Z" fill="rgba(100,60,200,0.3)" stroke="#9060e0" stroke-width="1.2"/><line x1="15" y1="16" x2="25" y2="16" stroke="#9060e0" stroke-width="1.2"/><rect x="17" y="10" width="6" height="7" rx="1" fill="none" stroke="#c9a94a" stroke-width="1.2"/><circle cx="20" cy="27" r="4" fill="rgba(160,100,255,0.4)" stroke="#b080ff" stroke-width="0.8"/></svg>`,
    4:`<svg viewBox="0 0 40 40" fill="none"><path d="M12 8 Q12 22 20 22 Q28 22 28 8 Z" fill="rgba(201,169,74,0.2)" stroke="#c9a94a" stroke-width="1.3"/><line x1="20" y1="22" x2="20" y2="30" stroke="#c9a94a" stroke-width="1.5"/><rect x="14" y="30" width="12" height="3" rx="1.5" fill="none" stroke="#c9a94a" stroke-width="1.2"/></svg>`,
    5:`<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="24" r="10" fill="none" stroke="#c9a94a" stroke-width="2"/><circle cx="20" cy="24" r="6" fill="none" stroke="#8a6e24" stroke-width="1"/><polygon points="20,10 23,16 30,16 24,20 26,27 20,23 14,27 16,20 10,16 17,16" fill="rgba(100,180,255,0.5)" stroke="#7ab8ff" stroke-width="1" stroke-linejoin="round"/></svg>`,
    6:`<svg viewBox="0 0 40 40" fill="none"><line x1="20" y1="5" x2="20" y2="30" stroke="#c0c8d8" stroke-width="2.5" stroke-linecap="round"/><line x1="12" y1="28" x2="28" y2="28" stroke="#c9a94a" stroke-width="2" stroke-linecap="round"/><rect x="18" y="28" width="4" height="7" rx="1" fill="rgba(201,169,74,0.4)" stroke="#8a6e24" stroke-width="1"/><polygon points="20,5 22,10 18,10" fill="rgba(200,210,220,0.6)" stroke="#a0aab8" stroke-width="0.8"/></svg>`,
    7:`<svg viewBox="0 0 40 40" fill="none"><path d="M6 28 L10 14 L16 22 L20 10 L24 22 L30 14 L34 28 Z" fill="rgba(201,169,74,0.25)" stroke="#c9a94a" stroke-width="1.4" stroke-linejoin="round"/><rect x="6" y="28" width="28" height="5" rx="2" fill="none" stroke="#c9a94a" stroke-width="1.2"/><circle cx="10" cy="14" r="2" fill="#e8d08a"/><circle cx="20" cy="10" r="2.5" fill="#ff8080"/><circle cx="30" cy="14" r="2" fill="#e8d08a"/></svg>`,
    8:`<svg viewBox="0 0 40 40" fill="none"><path d="M20 6 C14 10 10 16 12 22 C14 27 18 30 20 32 C22 30 26 27 28 22 C30 16 26 10 20 6Z" fill="rgba(180,60,60,0.35)" stroke="#e06060" stroke-width="1.2"/><path d="M14 14 C14 14 10 11 9 7 L12 10 L11 5 L15 9Z" fill="#c9a94a" opacity="0.9"/><path d="M26 14 C26 14 30 11 31 7 L28 10 L29 5 L25 9Z" fill="#c9a94a" opacity="0.9"/><circle cx="17" cy="17" r="2" fill="#ff8080"/><circle cx="23" cy="17" r="2" fill="#ff8080"/><path d="M17 24 Q20 28 23 24" stroke="#e8d08a" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`
  };
  return s[n] || '';
}

// ══════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,40);
}
let _tt;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(_tt); _tt = setTimeout(() => t.classList.remove('show'), 3000);
}
function scaleFont() {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;visibility:hidden;font-size:1rem;line-height:1;';
  d.textContent = 'M'; document.body.appendChild(d);
  const r = d.getBoundingClientRect().height;
  document.body.removeChild(d);
  if (r && Math.abs(r - 16) > 0.5) {
    const s = document.createElement('style');
    s.textContent = `html{font-size:${16*(16/r)}px!important;}`;
    document.head.appendChild(s);
  }
}
// ══════════════════════════════════════════
//  GIFT CONFIRMATION MODAL
// ══════════════════════════════════════════

function openGiftConfirmModal(gift) {
  if (!selectedGiftRecipients.size) {
    showBalloonToast('Selecione ao menos um destinatário.');
    return;
  }

  const qty = parseInt(document.getElementById('gift-qty-select')?.value || '1', 10);
  const recipNames = [...selectedGiftRecipients]
    .map(id => roomMembers[id]?.name || '?')
    .join(', ');

  // Monta a frase de destinatários
  const recipLabel = [...selectedGiftRecipients].size === 1
    ? recipNames
    : recipNames;

  // Intimidade total que será adicionada (por destinatário)
  const intimacyTotal = gift.intimacyPerUnit * qty;

  // Preenche o modal
  document.getElementById('gift-confirm-question').textContent =
    `Deseja enviar ${gift.name} para ${recipLabel}?`;
  const imgEl = document.getElementById('gift-confirm-img');
  imgEl.src = gift.img;
  imgEl.alt = gift.name;

  const intimacyEl = document.getElementById('gift-confirm-intimacy');
  if (intimacyTotal > 0) {
    intimacyEl.textContent = `Isso aumentará a Intimidade de vocês em ${intimacyTotal} pontos`;
    intimacyEl.style.display = '';
  } else {
    intimacyEl.style.display = 'none';
  }

  // Guarda o presente para quando confirmar
  _giftConfirmPending = gift;

  // Mostra o modal
  document.getElementById('gift-confirm-modal').classList.add('open');
}

function closeGiftConfirmModal() {
  document.getElementById('gift-confirm-modal').classList.remove('open');
  _giftConfirmPending = null;
}

function confirmGiftSend() {
  if (!_giftConfirmPending) return;
  const gift = _giftConfirmPending;
  closeGiftConfirmModal();
  sendGift(gift);
}

// ══════════════════════════════════════════
//  PROXIMITY INTIMACY — Intimidade por Tempo
// ══════════════════════════════════════════

// Chave única e ordenada para o par de jogadores
function proxPairKey(pidA, pidB) {
  return pidA < pidB ? `${pidA}__${pidB}` : `${pidB}__${pidA}`;
}

// Chave de localStorage para limite diário
// Usa data LOCAL do dispositivo → reset à meia-noite no horário do jogador
function getProxDailyKey(pairKey) {
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return `prox_daily_${localDate}_${pairKey}`;
}

// Pontos já concedidos hoje para este par
function getDailyProxPoints(pairKey) {
  return parseInt(localStorage.getItem(getProxDailyKey(pairKey)) || '0', 10);
}
function addDailyProxPoints(pairKey, pts) {
  const current = getDailyProxPoints(pairKey);
  localStorage.setItem(getProxDailyKey(pairKey), current + pts);
}

// Persiste o startTs de um par na sessão (para sobreviver a re-renders)
function getProxStoredStart(roomId, pairKey) {
  try {
    const raw = sessionStorage.getItem(`prox_start_${roomId}_${pairKey}`);
    return raw ? parseInt(raw, 10) : null;
  } catch (_) { return null; }
}
function saveProxStart(roomId, pairKey, ts) {
  try { sessionStorage.setItem(`prox_start_${roomId}_${pairKey}`, String(ts)); } catch (_) {}
}
function clearProxStart(roomId, pairKey) {
  try { sessionStorage.removeItem(`prox_start_${roomId}_${pairKey}`); } catch (_) {}
}

// Mapa de assentos atualmente ocupados: seatId → { playerId, name }
function getCurrentSeatMap() {
  const map = {};
  Object.keys(mySeats).forEach(sid => {
    map[sid] = { playerId: PLAYER.id, name: PLAYER.name };
  });
  Object.entries(roomMembers).forEach(([id, m]) => {
    if (m.seatId) map[m.seatId] = { playerId: id, name: m.name };
  });
  return map;
}

// Lista canônica de pares adjacentes (grupos separados pelo gap 4→5)
const ADJACENT_PAIRS = [[1,2],[2,3],[3,4],[5,6],[6,7],[7,8]];

// ── Verifica amizade mútua envolvendo PLAYER.id ──
// Retorna true somente se pid1 e pid2 se seguem mutuamente E
// um deles é PLAYER.id (caso contrário não temos os dados localmente).
function areMutualFriends(pid1, pid2) {
  const followingSet = window._tavFollowingSet;
  const followersSet = window._tavFollowersSet;
  if (!followingSet || !followersSet) return false; // sets ainda não carregados → aguarda

  let other = null;
  if (pid1 === PLAYER.id)      other = pid2;
  else if (pid2 === PLAYER.id) other = pid1;
  else return false; // nenhum é PLAYER.id → não conseguimos verificar localmente

  // Amizade mútua: eu sigo "other" E "other" me segue
  return followingSet.has(other) && followersSet.has(other);
}

// ── Reset de dia: verifica se o par precisa ser reativado porque virou o dia ──
// Retorna true se o par foi resetado (pode ser reativado).
function _checkDayResetForPair(key, pair, now) {
  if (!pair.done) return false; // nada a fazer — par ainda ativo
  const currentDailyPts = getDailyProxPoints(key);
  if (currentDailyPts >= PROX_DAILY_LIMIT) return false; // limite de hoje já atingido
  // O dia virou e o limite ainda não foi atingido hoje → reativa o par
  pair.done      = false;
  pair.intervals = Math.floor(currentDailyPts / PROX_PTS_INTERVAL);
  pair.startTs   = now;
  saveProxStart(currentRoom?.id, key, now);
  return true;
}

// Recalcula quais pares estão ativos e inicia/encerra efeitos
function updateProximityPairs() {
  if (!currentRoom) return;
  const seatMap = getCurrentSeatMap();
  const now     = Date.now();
  const activePairKeys = new Set();

  ADJACENT_PAIRS.forEach(([a, b]) => {
    const oA = seatMap[String(a)];
    const oB = seatMap[String(b)];
    if (!oA || !oB || oA.playerId === oB.playerId) return;

    // ── Verifica amizade mútua quando PLAYER.id está no par ──
    // Se PLAYER.id não está no par, deixamos para os clientes dos jogadores envolvidos verificarem.
    const imInPair = (oA.playerId === PLAYER.id || oB.playerId === PLAYER.id);
    if (imInPair && !areMutualFriends(oA.playerId, oB.playerId)) {
      // Não são amigos mútuos → garante que o par não existe localmente
      const keySkip = proxPairKey(oA.playerId, oB.playerId);
      if (_proxPairs[keySkip]) {
        renderAura(_proxPairs[keySkip].seatA, _proxPairs[keySkip].seatB, false, keySkip);
        clearProxStart(currentRoom?.id, keySkip);
        delete _proxPairs[keySkip];
        broadcastAuras();
      }
      return; // não cria o par
    }

    const key = proxPairKey(oA.playerId, oB.playerId);
    activePairKeys.add(key);

    if (!_proxPairs[key]) {
      // Verifica limite diário antes de iniciar
      if (getDailyProxPoints(key) >= PROX_DAILY_LIMIT) {
        _proxPairs[key] = { seatA: String(a), seatB: String(b),
          pidA: oA.playerId, pidB: oB.playerId,
          nameA: oA.name, nameB: oB.name,
          startTs: now, intervals: PROX_MAX_INTERVALS, done: true };
        return; // Limite atingido hoje, sem efeito
      }

      // Par novo! Recupera startTs salvo ou usa agora
      const stored = getProxStoredStart(currentRoom.id, key);
      const startTs = stored || now;
      if (!stored) saveProxStart(currentRoom.id, key, startTs);

      const dailyPts   = getDailyProxPoints(key);
      const doneIntervals = Math.floor(dailyPts / PROX_PTS_INTERVAL);

      _proxPairs[key] = {
        seatA: String(a), seatB: String(b),
        pidA: oA.playerId, pidB: oB.playerId,
        nameA: oA.name, nameB: oB.name,
        startTs, intervals: doneIntervals,
        done: doneIntervals >= PROX_MAX_INTERVALS
      };

      if (!_proxPairs[key].done) {
        renderAura(String(a), String(b), true, key);
        broadcastAuras();
      }

    } else {
      // Par já existe — verifica se o dia virou (pode reativar o par)
      const p = _proxPairs[key];
      const wasReset = _checkDayResetForPair(key, p, now);
      if (wasReset) {
        renderAura(String(a), String(b), true, key);
        broadcastAuras();
      }

      // Verifica se os jogadores mudaram de assento adjacente
      if (p.seatA !== String(a) || p.seatB !== String(b)) {
        p.seatA = String(a);
        p.seatB = String(b);
        p.nameA = oA.name;
        p.nameB = oB.name;
        // Reposiciona a ponte localmente — sem broadcast Ably (cada cliente recalcula)
        if (!p.done) renderAura(String(a), String(b), true, key);
      }
    }
  });

  // Remove pares que não são mais adjacentes
  Object.keys(_proxPairs).forEach(key => {
    if (!activePairKeys.has(key)) {
      const p = _proxPairs[key];
      renderAura(p.seatA, p.seatB, false, key);
      clearProxStart(currentRoom?.id, key);
      delete _proxPairs[key];
      broadcastAuras();
    }
  });

  // Gerencia o ticker de verificação de intervalos
  const activePairs = Object.values(_proxPairs).filter(p => !p.done);
  if (activePairs.length > 0 && !_proxTicker) {
    _proxTicker = setInterval(checkProximityIntervals, 30 * 1000);
    checkProximityIntervals();
  }
  if (activePairs.length === 0 && _proxTicker) {
    clearInterval(_proxTicker); _proxTicker = null;
  }
}

// Verifica se algum par completou um novo intervalo de 5 minutos
async function checkProximityIntervals() {
  if (!currentRoom) return;
  const now = Date.now();

  for (const [key, pair] of Object.entries(_proxPairs)) {
    // ── Verifica reset de dia: se o limite foi zerado, reativa o par ──
    if (pair.done) {
      const wasReset = _checkDayResetForPair(key, pair, now);
      if (wasReset) {
        renderAura(pair.seatA, pair.seatB, true, key);
        broadcastAuras();
        // Mensagem sutil no chat
        const otherName = pair.pidA === PLAYER.id ? pair.nameB : pair.nameA;
        if (pair.pidA === PLAYER.id || pair.pidB === PLAYER.id) {
          sysMsg(`💕 Novo dia! Sua intimidade com ${otherName} pode crescer novamente.`);
        }
      } else {
        continue; // ainda no limite → próximo par
      }
    }

    const elapsed        = now - pair.startTs;
    const totalIntervals = Math.floor(elapsed / PROX_INTERVAL_MS);
    const capped         = Math.min(PROX_MAX_INTERVALS, totalIntervals);

    if (capped > pair.intervals) {
      const newCount = capped - pair.intervals;

      // Apenas o jogador "primário" (menor UUID) faz a chamada ao Supabase
      // para evitar dupla-contagem quando ambos estão na mesma sala
      const imInPair = pair.pidA === PLAYER.id || pair.pidB === PLAYER.id;
      const primary  = pair.pidA < pair.pidB ? pair.pidA : pair.pidB;
      const imPrimary = PLAYER.id === primary;

      if (imInPair && imPrimary) {
        const dailyPts  = getDailyProxPoints(key);
        const remaining = PROX_DAILY_LIMIT - dailyPts;
        const raw       = newCount * PROX_PTS_INTERVAL;
        const ptsToGive = Math.min(raw, remaining);

        if (ptsToGive > 0) {
          await awardProximityRPC(pair.pidA, pair.pidB, ptsToGive);
          addDailyProxPoints(key, ptsToGive);
        }
      }

      pair.intervals = capped;

      if (pair.intervals >= PROX_MAX_INTERVALS) {
        pair.done = true;
        renderAura(pair.seatA, pair.seatB, false, key);
        clearProxStart(currentRoom?.id, key);
        broadcastAuras();
        // Mensagem sutil no chat
        const otherName = pair.pidA === PLAYER.id ? pair.nameB : pair.nameA;
        if (pair.pidA === PLAYER.id || pair.pidB === PLAYER.id) {
          sysMsg(`✨ Sua intimidade com ${otherName} cresceu ao máximo hoje!`);
        }
      }
    }
  }
}

// Chama o RPC de intimidade por proximidade
async function awardProximityRPC(pidA, pidB, pts) {
  const sb = getSB();
  if (!sb) return;
  try {
    const { error } = await sb.rpc('tavern_proximity_intimacy', {
      p_player_a_id: pidA,
      p_player_b_id: pidB,
      p_points: pts
    });
    if (error) console.warn('tavern_proximity_intimacy RPC error:', error);
  } catch (e) { console.warn('awardProximityRPC:', e); }
}

// Transmite os pares ativos via Ably para que outros clientes sincronizem
function broadcastAuras() {
  if (!roomChannel || !currentRoom) return;
  const pairs = Object.entries(_proxPairs)
    .filter(([, p]) => !p.done)
    .map(([key, p]) => ({
      key, seatA: p.seatA, seatB: p.seatB,
      pidA: p.pidA, pidB: p.pidB,
      nameA: p.nameA, nameB: p.nameB,
      startTs: p.startTs, intervals: p.intervals
    }));
  roomChannel.publish('intimacy-aura', { action: 'sync', pairs });
}

// Recebe transmissão de auras de outros clientes
function onIntimacyAura(msg) {
  if (msg.clientId === PLAYER.id) return; // ignora o próprio echo
  const d = msg.data || {};
  if (d.action !== 'sync' || !Array.isArray(d.pairs)) return;

  const seatMap = getCurrentSeatMap();

  d.pairs.forEach(p => {
    const existing = _proxPairs[p.key];

    // Verifica se o par ainda está sentado (validação local)
    const occupantA = seatMap[p.seatA];
    const occupantB = seatMap[p.seatB];
    const valid = occupantA?.playerId === p.pidA && occupantB?.playerId === p.pidB;

    if (!valid) return;
    if (getDailyProxPoints(p.key) >= PROX_DAILY_LIMIT) return;

    if (!existing) {
      // Novo par recebido via Ably → cria localmente com o startTs recebido
      const stored = getProxStoredStart(currentRoom?.id, p.key);
      const startTs = stored || p.startTs;
      if (!stored) saveProxStart(currentRoom?.id, p.key, startTs);

      _proxPairs[p.key] = {
        seatA: p.seatA, seatB: p.seatB,
        pidA: p.pidA, pidB: p.pidB,
        nameA: p.nameA, nameB: p.nameB,
        startTs, intervals: p.intervals, done: false
      };
      renderAura(p.seatA, p.seatB, true, p.key);

      // Inicia tickers se necessário
      updateProximityPairs();

    } else {
      // Sincroniza: usa o startTs mais antigo e o maior número de intervalos
      if (p.startTs < existing.startTs) existing.startTs = p.startTs;
      if (p.intervals > existing.intervals) existing.intervals = p.intervals;
    }
  });
}

// Cores por seatA: cada par adjacente tem sua identidade visual
function proxColorForSeatA(seatA) {
  const idx = { '1':0,'2':1,'3':2,'5':3,'6':4,'7':5 }[String(seatA)] ?? 0;
  return PROX_COLORS[idx];
}

// Cria a ponte de corações viajantes entre dois assentos
function createProxBridge(seatA, seatB, pairKey) {
  removeProxBridge(pairKey);
  const color  = proxColorForSeatA(seatA);
  const bridge = document.createElement('div');
  bridge.className = 'prox-bridge';
  bridge.id        = 'prox-bridge-' + pairKey;
  document.body.appendChild(bridge);
  _proxBridges[pairKey] = { el: bridge, seatA, seatB, color };

  // 4 corações: 2 indo para a direita, 2 para a esquerda, defasados
  const defs = [
    { rev: false, delay: '0s',    dur: '2.4s' },
    { rev: true,  delay: '0.6s',  dur: '2.4s' },
    { rev: false, delay: '1.2s',  dur: '2.4s' },
    { rev: true,  delay: '1.8s',  dur: '2.4s' },
  ];
  defs.forEach(d => {
    const h = document.createElement('span');
    h.className = 'prox-bh' + (d.rev ? ' prox-bh-rev' : '');
    h.textContent = '♥';
    h.style.setProperty('--heart-color', color.fill);
    h.style.setProperty('--heart-glow',  color.glow);
    h.style.setProperty('--delay',    d.delay);
    h.style.setProperty('--duration', d.dur);
    bridge.appendChild(h);
  });

  // Posiciona após um frame para garantir layout calculado
  requestAnimationFrame(() => positionProxBridge(pairKey));
}

function removeProxBridge(pairKey) {
  const b = _proxBridges[pairKey];
  if (b) { b.el.remove(); delete _proxBridges[pairKey]; }
}

// Calcula e aplica posição da ponte baseado nas posições reais dos botões
function positionProxBridge(pairKey) {
  const b = _proxBridges[pairKey];
  if (!b) return;
  const btnA = document.getElementById('seat-btn-' + b.seatA);
  const btnB = document.getElementById('seat-btn-' + b.seatB);
  if (!btnA || !btnB) return;

  const rA = btnA.getBoundingClientRect();
  const rB = btnB.getBoundingClientRect();
  if (!rA.width || !rB.width) return; // botões ainda não renderizados

  const cAx = rA.left + rA.width  / 2;
  const cBx = rB.left + rB.width  / 2;
  const topY = Math.max(rA.bottom, rB.bottom) + 4;

  const leftX = Math.min(cAx, cBx);
  const width  = Math.abs(cBx - cAx);

  b.el.style.left  = leftX + 'px';
  b.el.style.top   = topY  + 'px';
  b.el.style.width = width + 'px';

  // Dist que cada coração percorre (largura da ponte menos largura do símbolo)
  const dist = Math.max(0, width - 12);
  b.el.querySelectorAll('.prox-bh').forEach(h => {
    h.style.setProperty('--dist', dist + 'px');
  });
}

function positionAllProxBridges() {
  Object.keys(_proxBridges).forEach(positionProxBridge);
}

// Aplica ou remove o efeito visual de aura/ponte num par de assentos
function renderAura(seatA, seatB, active, pairKey) {
  if (active && pairKey) {
    createProxBridge(seatA, seatB, pairKey);
  } else if (pairKey) {
    removeProxBridge(pairKey);
  }
}

// Mantém compatibilidade com chamada sem pairKey (fallback)
function spawnProxHearts() {} // obsoleto — substituído pela ponte contínua

// Reposiciona pontes ao redimensionar (orientação do celular, etc.)
window.addEventListener('resize', () => {
  clearTimeout(window._proxResizeTimer);
  window._proxResizeTimer = setTimeout(positionAllProxBridges, 120);
});

// ══════════════════════════════════════════
//  ROOM NAME SLIDE MARQUEE
//  Inicia após 5s se o nome ultrapassar 200px.
//  Desliza à esquerda, volta pela direita, pausa 5s, repete.
// ══════════════════════════════════════════
function startRoomNameSlide() {
  clearTimeout(window._rnsTimer);
  clearTimeout(window._rnsTickTimer);
  const el = document.getElementById('room-header-name');
  if (!el) return;

  // Reset to initial position
  el.style.transition = 'none';
  el.style.transform  = 'translateX(0)';

  const CONTAINER_W = 200; // max-width do wrapper (px)

  // Precisa esperar 1 frame p/ o browser calcular scrollWidth com o texto novo
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const textW = el.scrollWidth;
      if (textW <= CONTAINER_W + 4) return; // cabe sem slide

      const dist = textW - CONTAINER_W + 14; // px a percorrer à esquerda
      const slideMs = Math.max(3500, dist * 24); // velocidade ~24ms/px

      function cycle() {
        // Fase 1: reposição instantânea na posição 0
        el.style.transition = 'none';
        el.style.transform  = 'translateX(0)';

        // Fase 2: aguarda 5s e desliza à esquerda
        window._rnsTimer = setTimeout(() => {
          el.style.transition = `transform ${slideMs}ms linear`;
          el.style.transform  = `translateX(-${dist}px)`;

          // Fase 3: após o slide, pula para a direita e desliza de volta ao 0
          window._rnsTickTimer = setTimeout(() => {
            el.style.transition = 'none';
            el.style.transform  = `translateX(${CONTAINER_W + 10}px)`; // fora de cena à direita

            requestAnimationFrame(() => requestAnimationFrame(() => {
              const returnMs = Math.max(1200, (dist + CONTAINER_W) * 9);
              el.style.transition = `transform ${returnMs}ms ease-out`;
              el.style.transform  = 'translateX(0)';

              // Fase 4: aguarda 5s e repete
              window._rnsTimer = setTimeout(cycle, returnMs + 5000);
            }));
          }, slideMs + 600); // pausa mínima no fim do slide
        }, 5000);
      }

      cycle();
    });
  });
}

// ══════════════════════════════════════════
//  TAVERN SHARE MODAL
// ══════════════════════════════════════════
const _TAV_SHARE_BASE_URL = 'https://aden-rpg.pages.dev/tavernas';

function openTavernShareModal() {
  if (!currentRoom) return;
  const roomName = currentRoom.name || 'esta Taverna';
  const shareText = `Meus amigos e eu estamos reunidos conversando na ${roomName}. Venha se juntar a nós!`;
  const shareUrl  = _TAV_SHARE_BASE_URL;

  // Popula subtítulo
  const subEl = document.getElementById('tav-share-sub');
  if (subEl) subEl.textContent = `"${shareText}"`;

  // Monta links
  const enc  = encodeURIComponent;
  const txt  = enc(shareText);
  const url  = enc(shareUrl);

  const set = (id, href) => { const a = document.getElementById(id); if (a) a.href = href; };
  set('tav-share-whatsapp', `https://wa.me/?text=${txt}%20${url}`);
  set('tav-share-telegram', `https://t.me/share/url?url=${url}&text=${txt}`);
  set('tav-share-twitter',  `https://twitter.com/intent/tweet?text=${txt}&url=${url}`);
  set('tav-share-facebook', `https://www.facebook.com/sharer/sharer.php?u=${url}`);
  set('tav-share-reddit',   `https://www.reddit.com/submit?url=${url}&title=${txt}`);

  document.getElementById('tav-share-modal')?.classList.add('open');
}

function closeTavernShareModal() {
  document.getElementById('tav-share-modal')?.classList.remove('open');
}

function copyTavernLink() {
  navigator.clipboard.writeText(_TAV_SHARE_BASE_URL).then(() => {
    const lbl = document.getElementById('tav-share-copy-label');
    if (!lbl) return;
    const orig = lbl.textContent;
    lbl.textContent = 'Copiado!';
    setTimeout(() => { lbl.textContent = orig; }, 2000);
  }).catch(() => { showToast('Não foi possível copiar.'); });
}

// ══════════════════════════════════════════
//  SISTEMA DE LAÇOS (Bonds)
//  Fase 1: 0–1000 pts (sem laço)
//  Fase 2: com laço, níveis 1–20
// ══════════════════════════════════════════

// Limiar de pontos para cada nível (índice 0 = nível 1)
const BOND_LEVEL_THRESHOLDS = [
  0,     // Nível 1
  1800,  // Nível 2
  2600,  // Nível 3
  3400,  // Nível 4
  4200,  // Nível 5
  5400,  // Nível 6
  6600,  // Nível 7
  7800,  // Nível 8
  9000,  // Nível 9
  11000, // Nível 10
  13000, // Nível 11
  15000, // Nível 12
  17000, // Nível 13
  19800, // Nível 14
  22600, // Nível 15
  25400, // Nível 16
  28200, // Nível 17
  31700, // Nível 18
  35200, // Nível 19
  38700, // Nível 20
];

const BONDS_CACHE_TTL = 5 * 60 * 1000; // 5 min (laços mudam raramente)

function getBondLevel(points) {
  let lv = 1;
  for (let i = 0; i < BOND_LEVEL_THRESHOLDS.length; i++) {
    if (points >= BOND_LEVEL_THRESHOLDS[i]) lv = i + 1;
    else break;
  }
  return Math.min(lv, 20);
}

function getBondLevelProgress(points) {
  const lv = getBondLevel(points);
  if (lv >= 20) return { level: 20, pct: 100, current: points, needed: 0 };
  const current = BOND_LEVEL_THRESHOLDS[lv - 1] || 0;
  const next    = BOND_LEVEL_THRESHOLDS[lv]    || current;
  const pct     = next > current ? Math.round(((points - current) / (next - current)) * 100) : 100;
  return { level: lv, pct, current: points - current, needed: next - current };
}

// ── Cache de laços — IDB bonds_store (TTL 5 min) ───────────────
// Padrão idêntico ao owners_store: IDB para persistência entre reloads,
// invalidação explícita quando laços mudam.

async function dbGetBonds(playerId) {
  try {
    const db = await Promise.race([
      openGlobalDB(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('idb_timeout')), 600))
    ]);
    // ← Envolve o new Promise no try para capturar DOMException do transaction
    const tx  = db.transaction('bonds_store', 'readonly');
    const req = tx.objectStore('bonds_store').get(playerId);
    return await new Promise(resolve => {
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec || !rec.data || (Date.now() - rec.timestamp) > BONDS_CACHE_TTL) {
          resolve(null);
        } else {
          resolve(rec.data);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch(e) { return null; }
}

async function dbSaveBonds(playerId, data) {
  try {
    const db = await openGlobalDB();
    const tx  = db.transaction('bonds_store', 'readwrite');
    tx.objectStore('bonds_store').put({ id: playerId, data, timestamp: Date.now() });
  } catch(e) { console.warn('dbSaveBonds:', e); }
}

async function dbClearBonds(playerId) {
  try {
    const db = await openGlobalDB();
    const tx  = db.transaction('bonds_store', 'readwrite');
    tx.objectStore('bonds_store').delete(playerId);
  } catch(e) {}
}

// Invalida cache de laços de um jogador em todas as camadas
async function _bondsClearCache(pid) {
  try { sessionStorage.removeItem('tav_bonds_' + pid); } catch(_) {}
  await dbClearBonds(pid);
}

// ── Estado do modal de laços ──
const _bonds = {
  targetId: null,
  isSelf:   false,
  data:     null,
};

// Timer humanizado para expiração de convite
function _bondsTimeLeft(expiresAt) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expirado';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ══════════════════════════════════════════
//  ABRIR MODAL DE LAÇOS
// ══════════════════════════════════════════
async function openBondsModal(targetId, isSelf) {
  if (!targetId) return;
  const modal = document.getElementById('tav-bonds-modal');
  if (!modal) return;

  _bonds.targetId = targetId;
  _bonds.isSelf   = isSelf;
  _bonds.data     = null;

  modal.classList.add('open');

  const titleEl = document.getElementById('tav-bonds-title');
  const cardsEl = document.getElementById('tav-bonds-cards');
  if (titleEl) titleEl.textContent = isSelf ? '❤ Meus Relacionamentos' : '❤ Relacionamentos';
  if (cardsEl) cardsEl.innerHTML = '<div class="tav-notif-empty">Carregando...</div>';

  // ── Camada 1: IDB (zero egress, persiste entre reloads) ──────
  const cached = await dbGetBonds(targetId);
  if (cached) {
    _bonds.data = cached;
    _bondsRenderCards();
    // Atualiza em background sem bloquear a UI
    _bondsFetchAndCache(targetId).catch(() => {});
    return;
  }

  // ── Camada 2: rede (Supabase) ─────────────────────────────
  await _bondsFetchAndCache(targetId);
}

// Busca laços da rede, salva no IDB e renderiza
async function _bondsFetchAndCache(targetId) {
  const cardsEl = document.getElementById('tav-bonds-cards');
  const sb = getSB();
  if (!sb) {
    if (cardsEl && !_bonds.data) cardsEl.innerHTML = '<div class="tav-notif-empty">Sem conexão.</div>';
    return;
  }

  // ── Fase 1: fetch da rede ──────────────────────────────────
  let fetchedData = null;
  try {
    const { data, error } = await sb.rpc('get_player_bonds', { p_player_id: targetId });
    if (error) throw error;
    fetchedData = data;
  } catch(e) {
    console.warn('[bonds] fetch error:', e);
    if (cardsEl && !_bonds.data)
      cardsEl.innerHTML = '<div class="tav-notif-empty">Erro ao carregar laços.</div>';
    return;
  }

  _bonds.data = fetchedData;
  dbSaveBonds(targetId, fetchedData).catch(() => {});
  try { sessionStorage.setItem('tav_bonds_' + targetId, JSON.stringify({ v: fetchedData, t: Date.now() })); } catch(_) {}

  // ── Fase 2: render (erro separado para não silenciar bugs) ─
  if (_bonds.targetId === targetId) {
    try {
      _bondsRenderCards();
    } catch(renderErr) {
      console.error('[bonds] render error:', renderErr);
      if (cardsEl)
        cardsEl.innerHTML = `<div class="tav-notif-empty">Erro ao exibir laços.<br><small style="font-size:0.65em;opacity:0.6;">${renderErr.message}</small></div>`;
    }
  }
}

function closeBondsModal() {
  document.getElementById('tav-bonds-modal')?.classList.remove('open');
}

// ── Renderiza os 6 cards (1 casal + 5 amigos) ──────────────────
function _bondsRenderCards() {
  const cardsEl = document.getElementById('tav-bonds-cards');
  if (!cardsEl) return;
  const d = _bonds.data || {};
  const couple       = d.couple      || null;
  const friends      = d.friends     || [];
  const pendingSent  = d.pending_sent || [];

  cardsEl.innerHTML = '';

  // ── Card de Casal ─────────────────────────────────────────
  const pendingCouple = pendingSent.find(p => p.bond_type === 'couple');
  cardsEl.appendChild(_bondsBuildCard({
    slotType:    'couple',
    bondData:    couple,
    pending:     pendingCouple || null,
    isSelf:      _bonds.isSelf,
    slotIndex:   0
  }));

  // ── 5 Cards de Melhor Amigo(a) ───────────────────────────────
  const pendingFriends = pendingSent.filter(p => p.bond_type === 'friend');
  for (let i = 0; i < 5; i++) {
    const bondData = friends[i] || null;
    const pending  = !bondData ? (pendingFriends[i - friends.length] || null) : null;
    cardsEl.appendChild(_bondsBuildCard({
      slotType:  'friend',
      bondData,
      pending,
      isSelf:    _bonds.isSelf,
      slotIndex: i
    }));
  }

  // ── Seção "Nossa intimidade" para visitantes ──────────────
  if (!_bonds.isSelf && PLAYER?.id && _bonds.targetId !== PLAYER.id) {
    _bondsMaybeShowMutualIntimacy(cardsEl, _bonds.targetId, d);
  }
}

// Busca e exibe seção "Nossa intimidade" para visitante sem laço com o alvo
async function _bondsMaybeShowMutualIntimacy(containerEl, targetId, bondsData) {
  if (!PLAYER?.id || !targetId || targetId === PLAYER.id) return;

  // Se o VIEWER já tem laço com o alvo, a XP bar do card cobre tudo — não duplicar
  const couple  = bondsData?.couple;
  const friends = bondsData?.friends || [];
  const alreadyBonded =
    (couple  && couple.partner_id === PLAYER.id) ||
    friends.some(f => f.partner_id === PLAYER.id);
  if (alreadyBonded) return;

  const sb = getSB();
  if (!sb) return;

  try {
    const { data, error } = await sb.rpc('get_mutual_intimacy', { p_target_id: targetId });
    if (error) { console.warn('[bonds] get_mutual_intimacy:', error); return; }

    const pts          = data?.points        ?? 0;
    const mutualFollow = data?.mutual_follow ?? false;

    // Sem seguimento mútuo → sem intimidade ativa; não exibe a seção
    if (!mutualFollow) return;

    // Exibe a seção sempre que não há laço, seja qual for a intimidade
    const cap   = 1000;
    const shown = Math.min(pts, cap);
    const pct   = Math.round((shown / cap) * 100);
    const label = pts >= cap
      ? `${cap.toLocaleString('pt-BR')} / ${cap.toLocaleString('pt-BR')} ✓`
      : `${pts.toLocaleString('pt-BR')} / ${cap.toLocaleString('pt-BR')}`;

    // Garante que o container ainda pertence ao mesmo targetId
    if (_bonds.targetId !== targetId) return;

    const sec = document.createElement('div');
    sec.className = 'bond-mutual-intimacy';
    sec.innerHTML = `
      <div class="bond-mutual-label">Nossa intimidade</div>
      <div class="bond-mutual-bar-track${pts >= cap ? ' bond-mutual-full' : ''}">
        <div class="bond-mutual-bar-fill" style="width:${pct}%;"></div>
        <span class="bond-mutual-bar-label">${label}</span>
      </div>`;
    containerEl.appendChild(sec);
  } catch(e) { console.warn('[bonds] mutual intimacy exception:', e); }
}

// Constrói um card de laço
function _bondsBuildCard({ slotType, bondData, pending, isSelf, slotIndex }) {
  const div = document.createElement('div');
  div.className = 'bond-card' + (slotType === 'couple' ? ' bond-couple' : '');

  const label = slotType === 'couple' ? 'Casal' : 'Melhor Amigo(a)';

  // ── Slot com laço confirmado ─────────────────────────────
  if (bondData) {
    const av      = bondData.partner_avatar || makeAvatar(bondData.partner_name || '?', 58);
    const pts     = bondData.intimacy_points || 0;
    const prog    = getBondLevelProgress(pts);
    const isMax   = prog.level >= 20;
    const xpLabel = isMax
      ? 'Nível Máximo'
      : `${prog.current.toLocaleString('pt-BR')} / ${prog.needed.toLocaleString('pt-BR')}`;
    const xpPct   = isMax ? 100 : prog.pct;

    div.innerHTML = `
      <div class="bond-card-circle"><img src="${esc(av)}" onerror="this.src='${makeAvatar(bondData.partner_name||'?',58)}'"></div>
      <div class="bond-card-info">
        <div class="bond-card-type">${label}</div>
        <div class="bond-card-name" data-pid="${esc(bondData.partner_id)}" data-pname="${esc(bondData.partner_name)}">${esc(bondData.partner_name)}</div>
        <div class="bond-card-level">Nível <span class="bond-lv-num">${prog.level}</span></div>
        <div class="bond-card-xpbar-wrap">
          <div class="bond-card-xpbar-track${isMax ? ' xpbar-max' : ''}">
            <div class="bond-card-xpbar-fill" style="width:${xpPct}%;"></div>
            <span class="bond-card-xpbar-label">${xpLabel}</span>
          </div>
        </div>
      </div>`;
    // Clicar no nome/avatar: se for próprio jogador → opções; se for visitante → abrir perfil
    const nameEl = div.querySelector('.bond-card-name');
    const circEl = div.querySelector('.bond-card-circle');
    if (isSelf) {
      const openOptions = () => _bondsOpenOwnOptions(bondData.partner_id, bondData.partner_name, av, bondData.bond_id, slotType);
      if (nameEl) nameEl.onclick = openOptions;
      if (circEl) circEl.onclick = openOptions;
    } else {
      const openProfile = () => { closeBondsModal(); openPlayerModalFor(bondData.partner_id, bondData.partner_name); };
      if (nameEl) nameEl.onclick = openProfile;
      if (circEl) { circEl.style.cursor = 'pointer'; circEl.onclick = openProfile; }
    }
    return div;
  }

  // ── Slot com convite pendente (só para o próprio jogador) ─
  if (pending && isSelf) {
    const av = pending.to_avatar || makeAvatar(pending.to_name || '?', 58);
    div.innerHTML = `
      <div class="bond-card-circle">
        <div class="bond-card-hourglass">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M5 2h14M5 22h14M6 2v4l5 6-5 6v4M18 2v4l-5 6 5 6v4"/>
          </svg>
        </div>
      </div>
      <div class="bond-card-info">
        <div class="bond-card-type">${label}</div>
        <div class="bond-card-name empty">Convite enviado para ${esc(pending.to_name)}</div>
        <div class="bond-card-timer">Expira em: ${_bondsTimeLeft(pending.expires_at)}</div>
      </div>`;
    return div;
  }

  // ── Slot vazio ───────────────────────────────────────────
  if (isSelf) {
    div.innerHTML = `
      <div class="bond-card-circle bond-card-plus">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
      <div class="bond-card-info">
        <div class="bond-card-type">${label}</div>
        <div class="bond-card-name empty">Vaga disponível</div>
        <div class="bond-card-level" style="color:var(--text-muted);font-style:italic;font-size:0.65rem;">Toque para convidar</div>
      </div>`;
    div.onclick = () => _bondsOpenEligiblePicker(slotType);
  } else {
    div.innerHTML = `
      <div class="bond-card-circle" style="opacity:0.4;">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.58-7 8-7s8 3 8 7"/></svg>
      </div>
      <div class="bond-card-info">
        <div class="bond-card-type">${label}</div>
        <div class="bond-card-name empty">Vaga livre</div>
      </div>`;
  }
  return div;
}

// ══════════════════════════════════════════
//  OPÇÕES DO PRÓPRIO CARD (ver perfil / desfazer)
// ══════════════════════════════════════════
// Armazena dados do card aberto para uso pelo botão de rompimento
let _booCurrentBond = null;

function _bondsOpenOwnOptions(partnerId, partnerName, partnerAv, bondId, bondType) {
  const modal  = document.getElementById('tav-bond-own-options');
  const avImg  = document.getElementById('boo-avatar');
  const nameEl = document.getElementById('boo-name');
  const viewBtn= document.getElementById('boo-view-btn');
  if (!modal) return;

  _booCurrentBond = { partnerId, partnerName, bondId, bondType };

  if (avImg)  avImg.src         = partnerAv || makeAvatar(partnerName || '?', 64);
  if (nameEl) nameEl.textContent = partnerName || '';

  if (viewBtn) viewBtn.onclick = () => {
    closeBondOwnOptions();
    closeBondsModal();
    openPlayerModalFor(partnerId, partnerName);
  };

  modal.style.display = 'flex';
}
function closeBondOwnOptions() {
  const m = document.getElementById('tav-bond-own-options');
  if (m) m.style.display = 'none';
}

// ══════════════════════════════════════════
//  DESFAZER LAÇO (Break Bond)
// ══════════════════════════════════════════

function _bondsShowBreakConfirm() {
  // Chamado pelo onclick do botão no modal de opções — usa _booCurrentBond
  const bond = _booCurrentBond;
  if (!bond) return;

  const modal   = document.getElementById('tav-bond-break-confirm');
  const textEl  = document.getElementById('bond-break-text');
  const warnEl  = document.getElementById('bond-break-warning');
  const yesBtn  = document.getElementById('bond-break-yes');
  if (!modal) return;

  if (textEl) textEl.textContent = `Tem certeza que deseja desfazer o laço com ${bond.partnerName}?`;
  if (warnEl) warnEl.textContent = 'Atenção: a intimidade de vocês retornará para 1000 e o progresso do laço será perdido.';
  if (yesBtn) yesBtn.onclick = _bondExecuteBreak;

  modal.style.display = 'flex';
}

function closeBondBreakConfirm() {
  const m = document.getElementById('tav-bond-break-confirm');
  if (m) m.style.display = 'none';
}

async function _bondExecuteBreak() {
  closeBondBreakConfirm();
  closeBondOwnOptions();

  const bond = _booCurrentBond;
  _booCurrentBond = null;
  if (!bond?.bondId) { showToast('Laço não identificado.'); return; }

  const sb = getSB();
  if (!sb) { showToast('Sem conexão.'); return; }

  try {
    const { data, error } = await sb.rpc('break_bond', { p_bond_id: bond.bondId });
    if (error) throw error;

    if (data?.success) {
      await _bondsClearCache(PLAYER.id);
      if (bond.partnerId) await _bondsClearCache(bond.partnerId);
      showToast(`Laço com ${bond.partnerName} foi desfeito.`);
      closeBondsModal();
      setTimeout(() => openBondsModal(PLAYER.id, true), 700);
    } else {
      const errMap = {
        'bond_not_found': 'Laço não encontrado (pode já ter sido desfeito).',
      };
      showToast(errMap[data?.error] || 'Não foi possível desfazer o laço.');
    }
  } catch(e) {
    console.warn('break_bond:', e);
    showToast('Erro ao desfazer laço.');
  }
}

// ══════════════════════════════════════════
//  PICKER DE ELEGÍVEIS
// ══════════════════════════════════════════
let _bondEligibleType = 'friend';

async function _bondsOpenEligiblePicker(bondType) {
  _bondEligibleType = bondType;
  const modal   = document.getElementById('tav-bond-eligible-modal');
  const titleEl = document.getElementById('tav-bond-eligible-title');
  const listEl  = document.getElementById('tav-bond-eligible-list');
  if (!modal || !listEl) return;

  const label = bondType === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
  if (titleEl) titleEl.textContent = `Convidar para ${label}`;
  listEl.innerHTML = '<div class="tav-notif-empty">Carregando...</div>';
  modal.classList.add('open');

  const sb = getSB();
  if (!sb) { listEl.innerHTML = '<div class="tav-notif-empty">Sem conexão.</div>'; return; }

  try {
    const { data, error } = await sb.rpc('get_bond_eligible', {
      p_player_id: PLAYER.id,
      p_bond_type: bondType
    });
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) {
      listEl.innerHTML = '<div class="tav-notif-empty">Nenhum amigo elegível encontrado.<br><small style="font-size:0.7em;color:var(--text-muted);">É preciso ter 1000 de intimidade com seguidores mútuos sem laço já formado.</small></div>';
      return;
    }
    listEl.innerHTML = '';
    rows.forEach(r => {
      const av  = r.avatar_url || makeAvatar(r.name || '?', 44);
      const row = document.createElement('div');
      row.className = 'bond-eligible-row';
      row.innerHTML = `
        <div class="bond-eligible-av"><img src="${esc(av)}" onerror="this.src='${makeAvatar(r.name||'?',44)}'"></div>
        <div class="bond-eligible-info">
          <div class="bond-eligible-name">${esc(r.name)}</div>
          <div class="bond-eligible-intimacy">Intimidade: ${(r.intimacy||0).toLocaleString()}</div>
        </div>
        <div class="bond-eligible-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></div>`;
      row.onclick = () => _bondsAskConfirm(r.id, r.name, bondType);
      listEl.appendChild(row);
    });
  } catch(e) {
    console.warn('get_bond_eligible:', e);
    listEl.innerHTML = '<div class="tav-notif-empty">Erro ao carregar.</div>';
  }
}

function closeBondEligibleModal() {
  document.getElementById('tav-bond-eligible-modal')?.classList.remove('open');
}

// ══════════════════════════════════════════
//  CONFIRMAÇÃO DE CONVITE
// ══════════════════════════════════════════
let _bondConfirmPending = null;

function _bondsAskConfirm(toId, toName, bondType) {
  const modal   = document.getElementById('tav-bond-invite-confirm');
  const textEl  = document.getElementById('bond-confirm-text');
  const yesBtn  = document.getElementById('bond-confirm-yes');
  if (!modal) return;

  const label = bondType === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
  if (textEl) textEl.textContent = `Deseja convidar ${toName} para ser seu ${label}?`;

  _bondConfirmPending = { toId, toName, bondType };

  if (yesBtn) yesBtn.onclick = _bondsSendInvite;

  modal.style.display = 'flex';
}

function closeBondInviteConfirm() {
  const m = document.getElementById('tav-bond-invite-confirm');
  if (m) m.style.display = 'none';
  _bondConfirmPending = null;
}

// ══════════════════════════════════════════
//  ENVIAR CONVITE
// ══════════════════════════════════════════
async function _bondsSendInvite() {
  const p = _bondConfirmPending;   // ← salva ANTES de fechar (closeBondInviteConfirm zera a variável)
  _bondConfirmPending = null;
  closeBondInviteConfirm();
  if (!p) return;

  const sb = getSB();
  if (!sb) { showToast('Sem conexão.'); return; }

  try {
    const { data, error } = await sb.rpc('send_bond_invite', {
      p_to_id:    p.toId,
      p_bond_type: p.bondType
    });
    if (error) throw error;

    if (data?.success) {
      // Sucesso — invalida cache do próprio jogador
      await _bondsClearCache(PLAYER.id);
      closeBondEligibleModal();
      const expiresAt = data.expires_at;
      _bondsShowResult(true, `Convite enviado para ${p.toName}!`, expiresAt);

      // Atualiza dados locais e re-abre modal de laços
      setTimeout(() => openBondsModal(PLAYER.id, true), 1400);
    } else {
      const errMap = {
        'caller_couple_full':   'Você já tem um Casal.',
        'caller_friends_full':  'Você já tem 5 Amigos(as).',
        'target_couple_full':   `${p.toName} já tem um Casal.`,
        'target_friends_full':  `${p.toName} já tem 5 Amigos(as).`,
        'invite_already_pending': 'Já existe um convite pendente entre vocês.',
        'already_bonded':       'Vocês já têm um laço deste tipo.',
        'intimacy_too_low':     'Intimidade insuficiente (mínimo 1000).',
        'not_mutual_friends':   'Vocês precisam se seguir mutuamente.',
      };
      const msg = errMap[data?.error] || 'Não foi possível enviar o convite.';
      _bondsShowResult(false, msg, null);
    }
  } catch(e) {
    console.warn('send_bond_invite:', e);
    _bondsShowResult(false, 'Erro ao enviar convite.', null);
  }
}

function _bondsShowResult(success, msg, expiresAt) {
  const modal   = document.getElementById('tav-bond-invite-result');
  const iconEl  = document.getElementById('bond-result-icon');
  const textEl  = document.getElementById('bond-result-text');
  const timerEl = document.getElementById('bond-result-timer');
  if (!modal) return;

  if (iconEl)  iconEl.textContent  = success ? '✅' : '❌';
  if (textEl)  textEl.textContent  = msg;
  if (timerEl) {
    if (success && expiresAt) {
      timerEl.textContent = `O convite expira em: ${_bondsTimeLeft(expiresAt)}`;
      timerEl.style.display = 'block';
    } else {
      timerEl.style.display = 'none';
    }
  }
  modal.style.display = 'flex';
}

function closeBondInviteResult() {
  const m = document.getElementById('tav-bond-invite-result');
  if (m) m.style.display = 'none';
}

// ══════════════════════════════════════════
//  RECEBER CONVITE (notificação bond_invite)
// ══════════════════════════════════════════
function _bondsShowInviteReceived(notif) {
  const modal   = document.getElementById('tav-bond-invite-received');
  const avImg   = document.getElementById('bir-avatar');
  const textEl  = document.getElementById('bir-text');
  const bondImg = document.getElementById('bir-bond-img');
  const decBtn  = document.getElementById('bir-decline-btn');
  const accBtn  = document.getElementById('bir-accept-btn');
  if (!modal) return;

  const bondLabel = notif.bondType === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
  const imgUrl    = notif.bondType === 'couple'
    ? 'https://aden-rpg.pages.dev/assets/laco_casal1.webp'
    : 'https://aden-rpg.pages.dev/assets/laco_amigo1.webp';

  if (avImg)   avImg.src         = notif.fromAvatar || makeAvatar(notif.fromName || '?', 70);
  if (textEl)  textEl.textContent = `${notif.fromName} está te convidando para ser ${bondLabel}!`;
  if (bondImg) { bondImg.src = imgUrl; bondImg.style.display = 'block'; }

  if (decBtn) decBtn.onclick = async () => {
    modal.style.display = 'none';
    await _bondsRespondInvite(notif.inviteId, false, notif.fromName, notif);
  };
  if (accBtn) accBtn.onclick = async () => {
    modal.style.display = 'none';
    await _bondsRespondInvite(notif.inviteId, true, notif.fromName, notif);
  };

  modal.style.display = 'flex';
}

async function _bondsRespondInvite(inviteId, accept, fromName, notif) {
  const sb = getSB();
  if (!sb) { showToast('Sem conexão.'); return; }
  try {
    const { data, error } = await sb.rpc('respond_bond_invite', {
      p_invite_id: inviteId,
      p_accept:    accept
    });
    if (error) throw error;

    if (accept && data?.success) {
      // Invalida cache de ambos os jogadores
      await _bondsClearCache(PLAYER.id);
      if (notif.fromId) await _bondsClearCache(notif.fromId);
      showToast(`Laço formado com ${fromName}! ❤`);
      _tavRemoveBondNotif(inviteId);
      _tavUpdateNotifDot();
    } else if (!accept) {
      showToast('Convite recusado.');
      _tavRemoveBondNotif(inviteId);
      _tavUpdateNotifDot();
    } else {
      const errMap = {
        'no_slot_available': 'Não há mais vaga disponível.',
        'invite_expired':    'Este convite expirou.',
      };
      showToast(errMap[data?.error] || 'Não foi possível responder ao convite.');
    }
  } catch(e) {
    console.warn('respond_bond_invite:', e);
    showToast('Erro ao responder convite.');
  }
}

function _tavRemoveBondNotif(inviteId) {
  try {
    let notifs = _tavGetNotifications();
    notifs = notifs.filter(n => !(n.type === 'bond_invite' && n.inviteId === inviteId));
    _tavSaveNotifications(notifs);
  } catch(_) {}
}

// ══════════════════════════════════════════
//  FETCH AUTÔNOMO DE NOTIFICAÇÕES DE LAÇO
//  Chama get_pending_bond_notifications() separadamente,
//  sem sobrescrever _tavFetchPendingNotifications.
// ══════════════════════════════════════════
async function _bondsFetchPendingNotifications() {
  // Chamada após initPlayer() — PLAYER.id e sessão Supabase garantidos
  if (!PLAYER.id) { console.warn('[bonds] PLAYER.id nulo, abortando'); return; }

  const sb = getSB();
  if (!sb) { console.warn('[bonds] getSB() retornou null'); return; }

  const notifs = _tavGetNotifications();
  let changed  = false;

  // ── 1. Convites recebidos: consulta player_bond_invites diretamente ──
  //  Função simples, sem JOIN em player_notifications, sem coluna meta.
  try {
    const { data: invites, error: invErr } = await sb.rpc('get_my_pending_bond_invites');
    if (invErr) {
      console.warn('[bonds] get_my_pending_bond_invites erro:', invErr);
    } else {
      console.log('[bonds] convites recebidos:', invites?.length ?? 0, invites);
      (invites || []).forEach(n => {
        if (!n.invite_id) return;
        if (notifs.find(x => x.type === 'bond_invite' && x.inviteId === n.invite_id)) return;
        const at = new Date(n.created_at).getTime();
        notifs.unshift({
          id:         'bi_' + n.invite_id + '_' + at,
          type:       'bond_invite',
          fromId:     n.from_id,
          fromName:   n.from_name  || '',
          fromAvatar: n.from_avatar || ownersCache[n.from_id]?.avatar_url || '',
          bondType:   n.bond_type,
          inviteId:   n.invite_id,
          expiresAt:  n.expires_at,
          readAt:     null,
          at
        });
        changed = true;
      });
    }
  } catch(e) { console.warn('[bonds] exceção em get_my_pending_bond_invites:', e); }

  // ── 2. Respostas a convites enviados ──
  //  Função separada, sem coluna meta.
  try {
    const { data: responses, error: respErr } = await sb.rpc('get_and_clear_bond_responses');
    if (respErr) {
      console.warn('[bonds] get_and_clear_bond_responses erro:', respErr);
    } else {
      console.log('[bonds] respostas recebidas:', responses?.length ?? 0, responses);
      (responses || []).forEach(n => {
        if (notifs.find(x => x.type === 'bond_response' && x.notifId === n.notif_id)) return;
        const at = new Date(n.created_at).getTime();
        notifs.unshift({
          id:         'br_' + n.notif_id + '_' + at,
          type:       'bond_response',
          notifId:    n.notif_id,
          fromId:     n.from_id,
          fromName:   n.from_name  || '',
          fromAvatar: n.from_avatar || ownersCache[n.from_id]?.avatar_url || '',
          bondType:   n.bond_type,
          accepted:   n.accepted,
          readAt:     null,
          at
        });
        changed = true;
      });
    }
  } catch(e) { console.warn('[bonds] exceção em get_and_clear_bond_responses:', e); }

  // ── 3. Rompimentos de laço recebidos (bond_break) ────────────
  try {
    const { data: breaks, error: breakErr } = await sb.rpc('get_and_clear_bond_break_notifications');
    if (breakErr) {
      console.warn('[bonds] get_and_clear_bond_break_notifications erro:', breakErr);
    } else {
      (breaks || []).forEach(n => {
        if (notifs.find(x => x.type === 'bond_break' && x.notifId === n.notif_id)) return;
        const at = new Date(n.created_at).getTime();
        notifs.unshift({
          id:         'bb_' + n.notif_id + '_' + at,
          type:       'bond_break',
          notifId:    n.notif_id,
          fromId:     n.from_id,
          fromName:   n.from_name  || '',
          fromAvatar: n.from_avatar || ownersCache[n.from_id]?.avatar_url || '',
          bondType:   n.bond_type,
          readAt:     null,
          at
        });
        changed = true;
      });
    }
  } catch(e) { console.warn('[bonds] exceção em get_and_clear_bond_break_notifications:', e); }

  if (changed) {
    _tavSaveNotifications(notifs.slice(0, 50));
    _tavUpdateNotifDot();
  }
}


// Sobrescreve _tavRenderNotifs para incluir bond_invite
const _origRenderNotifs = _tavRenderNotifs;
_tavRenderNotifs = function() {
  const listEl = document.getElementById('tav-notif-list');
  if (!listEl) return;
  const notifs = _tavGetNotifications();
  if (!notifs.length) { listEl.innerHTML = '<div class="tav-notif-empty">Nenhuma notificação.</div>'; return; }
  listEl.innerHTML = '';

  notifs.forEach(n => {
    if (n.type === 'follow') {
      const av  = n.fromAvatar || makeAvatar(n.fromName || '?', 40);
      const row = document.createElement('div');
      row.className = 'tav-notif-row' + (n.readAt ? '' : ' unread');
      row.innerHTML = `
        <div class="tav-notif-av"><img src="${esc(av)}" onerror="this.src='${makeAvatar(n.fromName||'?',40)}'"></div>
        <div class="tav-notif-text">
          <strong>${esc(n.fromName)}</strong> começou a te seguir.
          <div class="tav-notif-time">${_tavTimeAgo(n.at)}</div>
        </div>`;
      row.onclick = () => { closeNotifModal(); openPlayerModalFor(n.fromId, n.fromName); };
      listEl.appendChild(row);

    } else if (n.type === 'bond_invite') {
      // Verifica se expirou
      const expired = n.expiresAt && new Date(n.expiresAt).getTime() < Date.now();
      const bondLabel = n.bondType === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
      const av  = n.fromAvatar || makeAvatar(n.fromName || '?', 40);
      const row = document.createElement('div');
      row.className = 'tav-notif-row' + (n.readAt ? '' : ' unread');
      row.innerHTML = `
        <div class="tav-notif-av" style="border-color:${n.bondType==='couple'?'rgba(255,130,180,0.7)':'var(--border-mid)'};">
          <img src="${esc(av)}" onerror="this.src='${makeAvatar(n.fromName||'?',40)}'">
        </div>
        <div class="tav-notif-text">
          <strong>${esc(n.fromName)}</strong> — Convite de relacionamento!
          <div class="tav-notif-time">${expired ? '❌ Expirado' : `Expira em: ${_bondsTimeLeft(n.expiresAt)} · ${_tavTimeAgo(n.at)}`}</div>
        </div>`;
      if (!expired) {
        row.onclick = () => {
          closeNotifModal();
          _bondsShowInviteReceived(n);
        };
      }
      listEl.appendChild(row);

    } else if (n.type === 'bond_break') {
      const bondLabel = n.bondType === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
      const av  = n.fromAvatar || makeAvatar(n.fromName || '?', 40);
      const row = document.createElement('div');
      row.className = 'tav-notif-row' + (n.readAt ? '' : ' unread');
      row.innerHTML = `
        <div class="tav-notif-av" style="border-color:rgba(220,80,80,0.55);">
          <img src="${esc(av)}" onerror="this.src='${makeAvatar(n.fromName||'?',40)}'">
        </div>
        <div class="tav-notif-text">
          💔 <strong>${esc(n.fromName)}</strong> desfez o laço de <strong>${bondLabel}</strong> com você.
          <div class="tav-notif-time">${_tavTimeAgo(n.at)}</div>
        </div>`;
      row.onclick = () => { closeNotifModal(); openPlayerModalFor(n.fromId, n.fromName); };
      listEl.appendChild(row);

    } else if (n.type === 'bond_response') {
      const bondLabel = n.bondType === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
      const av  = n.fromAvatar || makeAvatar(n.fromName || '?', 40);
      const row = document.createElement('div');
      row.className = 'tav-notif-row' + (n.readAt ? '' : ' unread');
      const icon   = n.accepted ? '💚' : '💔';
      const result = n.accepted
        ? `aceitou seu convite de <strong>${bondLabel}</strong>!`
        : `recusou seu convite de <strong>${bondLabel}</strong>.`;
      row.innerHTML = `
        <div class="tav-notif-av" style="border-color:${n.bondType==='couple'?'rgba(255,130,180,0.7)':'var(--border-mid)'};">
          <img src="${esc(av)}" onerror="this.src='${makeAvatar(n.fromName||'?',40)}'">
        </div>
        <div class="tav-notif-text">
          ${icon} <strong>${esc(n.fromName)}</strong> ${result}
          <div class="tav-notif-time">${_tavTimeAgo(n.at)}</div>
        </div>`;
      row.onclick = () => { closeNotifModal(); openPlayerModalFor(n.fromId, n.fromName); };
      listEl.appendChild(row);
    }
  });
};

// Nota: openNotifModal() já chama _tavRenderNotifs() internamente,
// portanto a substituição acima de _tavRenderNotifs é suficiente.
