/* ═══════════════════════════════════════════
   TAVERNAS — Aden RPG Online  |  tavernas.js
   Ably pub/sub (chat + presence) + WebRTC voice
   v2 — Fixes: avatar real, presença real na lista,
        mic auto ao sentar, desconexão ao voltar,
        sem rewind de mensagens.
═══════════════════════════════════════════ */

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
  if (sbClient) return sbClient;
  try {
    // Reutiliza cliente do script.js se disponível na mesma tab
    if (window.supabaseClient) { sbClient = window.supabaseClient; return sbClient; }
    if (window.supabase?.createClient) {
      sbClient = window.supabase.createClient(SB_URL, SB_KEY);
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
const GLOBAL_DB_VERSION = 6;
const PLAYER_STORE      = 'player_store';
const OWNERS_STORE      = 'owners_store';
const OWNERS_CACHE_TTL  = 24 * 60 * 60 * 1000; // 24h

function openGlobalDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('auth_store'))   db.createObjectStore('auth_store',   { keyPath: 'key' });
      if (!db.objectStoreNames.contains(PLAYER_STORE))   db.createObjectStore(PLAYER_STORE,   { keyPath: 'key' });
      if (!db.objectStoreNames.contains(OWNERS_STORE))   db.createObjectStore(OWNERS_STORE,   { keyPath: 'id'  });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
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
    list.forEach(o => {
      const id = o.id || o.i;
      if (id) st.put({ id, name: o.name || o.n, avatar_url: o.avatar_url || o.a, guild_id: o.guild_id || o.g, timestamp: now });
    });
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

// ── Player — carregado de forma assíncrona do GlobalDB ──
let PLAYER = {
  id:         localStorage.getItem('aden_pid')  || localStorage.getItem('player_id')   || ('p_' + Math.random().toString(36).slice(2, 9)),
  name:       localStorage.getItem('aden_name') || localStorage.getItem('player_name') || 'Jogador',
  role:       localStorage.getItem('aden_role') || 'member',
  guild:      localStorage.getItem('aden_guild')|| '',
  avatar_url: null,
  nobless:    0
};

async function initPlayer() {
  // 1. Garante ID correto via auth_store (zero egress, evita ID stale do localStorage)
  const auth = await getAuthFromDB();
  if (auth?.user?.id) {
    PLAYER.id = auth.user.id;
    localStorage.setItem('aden_pid', PLAYER.id);
  }

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
      if (rows) {
        PLAYER.avatar_url = rows.avatar_url || PLAYER.avatar_url;
        PLAYER.name       = rows.name       || PLAYER.name;
        PLAYER.guild      = rows.guild_id   || PLAYER.guild;
        PLAYER.nobless    = rows.nobless     || 0;
        if (rows.rank) PLAYER.role = rows.rank;
        await dbSaveOwners([{ id: PLAYER.id, name: PLAYER.name, avatar_url: PLAYER.avatar_url, guild_id: PLAYER.guild }]);
        ownersCache[PLAYER.id] = { id: PLAYER.id, name: PLAYER.name, avatar_url: PLAYER.avatar_url };
      }
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
let   _proxTicker        = null;            // setInterval do checker
let   _heartsTicker      = null;            // setInterval dos corações

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

function initAbly() {
  if (typeof Ably === 'undefined') { setTimeout(initAbly, 2000); return; }
  setConnDot('connecting');
  ablyClient = new Ably.Realtime({
    key:          ABLY_KEY,
    clientId:     PLAYER.id,
    echoMessages: false,
    recover:      (_, cb) => cb(true)
  });
  ablyClient.connection.on('connected',    () => { ablyReady = true;  setConnDot('on');  joinGlobalPresence(); });
  ablyClient.connection.on('disconnected', () => { ablyReady = false; setConnDot('off'); });
  ablyClient.connection.on('failed',       () => { ablyReady = false; setConnDot('err'); });
  ablyClient.connection.on('connecting',   () => setConnDot('connecting'));
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
  const doFullRefresh = () => {
    globalChannel.presence.get((err, members) => {
      if (err || !members) return;
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
    });
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

  currentRoom = null;
  micOn = false; micMuted = false; audioMuted = false;
  updateMicBtn();
  document.getElementById('btn-audio-mute')?.classList.remove('audio-off');

  // Limpa estado de proximidade
  Object.keys(_proxPairs).forEach(k => {
    const p = _proxPairs[k];
    renderAura(p.seatA, p.seatB, false);
    delete _proxPairs[k];
  });
  if (_proxTicker)   { clearInterval(_proxTicker);   _proxTicker   = null; }
  if (_heartsTicker) { clearInterval(_heartsTicker); _heartsTicker = null; }

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
  const doGetMembers = () => {
    roomChannel.presence.get((err, members) => {
      // Sempre atualiza o contador, mesmo em erro (mostra pelo menos o próprio)
      if (err || !members) { updateOnlineCount(); return; }
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
    });
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
  } else {
    fr.style.backgroundImage  = '';
    fr.style.display          = 'none';
    sh.style.display          = 'none';
    if (av) av.style.border   = '';
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
    <div class="c-av" onclick="onNameClick('${esc(name)}')">
      <img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
    </div>
    <div class="c-body" style="${isMine ? 'align-items:flex-end;' : 'align-items:flex-start;'}">
      <div class="c-name" onclick="onNameClick('${esc(name)}')">${esc(name)}</div>
      <div class="c-text" style="${textStyle}">${esc(text)}</div>
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
}

function onNameClick(name) {
  if (name === PLAYER.name) return;
  const entry = Object.entries(roomMembers).find(([, v]) => v.name === name);
  if (!entry) return;
  const [id, data] = entry;
  openPlayerModalFor(id, data.name);
}

// ══════════════════════════════════════════
//  PLAYER PROFILE MODAL
// ══════════════════════════════════════════
// Abre o modal de perfil do jogador (mesmo padrão da guilda e ranking)
function openPlayerModalFor(playerId, name) {
  const modal = document.getElementById('playerModal');
  if (!modal) { showToast('Perfil de ' + (name || '?')); return; }
  // Reseta skin anterior imediatamente
  if (typeof window._tavModalResetSkin === 'function') window._tavModalResetSkin();
  modal.style.display = 'flex';
  if (typeof window.clearModalContent === 'function') window.clearModalContent();
  if (typeof window.fetchPlayerData === 'function') {
    window._tavModalLastPid = playerId;
    window.fetchPlayerData(playerId);
  }
}

// ══════════════════════════════════════════
//  MODERATION
// ══════════════════════════════════════════
function buildOtherMenu(occupant, isAdmin) {
  const isMuted = occupant ? isLocallyMuted(occupant.id) : false;
  const items = [
    { icon: iconProfile(), label: 'Ver perfil', danger: false,
      action: () => openPlayerModalFor(occupant?.id, occupant?.name) },
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
    const recipSeatId = roomMembers[recipId]?.seatId;
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
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
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
      </div>
      <div class="seat-lbl">${label}</div>
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
      </div>
      <div class="seat-lbl">Mic ${i}</div>
      <div class="seat-nm vacant" id="seat-name-${i}">Vago</div>`;
    s.addEventListener('click', () => onSeatClick(String(i)));
    grid.appendChild(s);
  }
}

// ══════════════════════════════════════════
//  ICONS
// ══════════════════════════════════════════
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
function getProxDailyKey(pairKey) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `prox_daily_${today}_${pairKey}`;
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
        renderAura(String(a), String(b), true);
        broadcastAuras();
      }
    }
  });

  // Remove pares que não são mais adjacentes
  Object.keys(_proxPairs).forEach(key => {
    if (!activePairKeys.has(key)) {
      const p = _proxPairs[key];
      renderAura(p.seatA, p.seatB, false);
      clearProxStart(currentRoom?.id, key);
      delete _proxPairs[key];
      broadcastAuras();
    }
  });

  // Gerencia o ticker de verificação de intervalos
  const activePairs = Object.values(_proxPairs).filter(p => !p.done);
  if (activePairs.length > 0 && !_proxTicker) {
    _proxTicker = setInterval(checkProximityIntervals, 30 * 1000); // checa a cada 30s
    checkProximityIntervals(); // checa imediatamente ao iniciar
  }
  if (activePairs.length === 0 && _proxTicker) {
    clearInterval(_proxTicker); _proxTicker = null;
  }

  // Ticker de corações visuais (a cada 20s spawneia corações nos pares ativos)
  if (activePairs.length > 0 && !_heartsTicker) {
    _heartsTicker = setInterval(() => {
      Object.values(_proxPairs).forEach(p => {
        if (!p.done) spawnProxHearts(p.seatA, p.seatB);
      });
    }, 20 * 1000);
    // Spawneia imediatamente ao criar
    activePairs.forEach(p => spawnProxHearts(p.seatA, p.seatB));
  }
  if (activePairs.length === 0 && _heartsTicker) {
    clearInterval(_heartsTicker); _heartsTicker = null;
  }
}

// Verifica se algum par completou um novo intervalo de 5 minutos
async function checkProximityIntervals() {
  if (!currentRoom) return;
  const now = Date.now();

  for (const [key, pair] of Object.entries(_proxPairs)) {
    if (pair.done) continue;

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
        renderAura(pair.seatA, pair.seatB, false);
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
      renderAura(p.seatA, p.seatB, true);
      spawnProxHearts(p.seatA, p.seatB);

      // Inicia tickers se necessário
      updateProximityPairs();

    } else {
      // Sincroniza: usa o startTs mais antigo e o maior número de intervalos
      if (p.startTs < existing.startTs) existing.startTs = p.startTs;
      if (p.intervals > existing.intervals) existing.intervals = p.intervals;
    }
  });
}

// Aplica ou remove o efeito visual de aura nos dois assentos do par
function renderAura(seatA, seatB, active) {
  const btnA = document.getElementById('seat-btn-' + seatA);
  const btnB = document.getElementById('seat-btn-' + seatB);
  if (btnA) btnA.classList.toggle('intimacy-aura', active);
  if (btnB) btnB.classList.toggle('intimacy-aura', active);
}

// Spawnia corações flutuantes em ambos os assentos do par
function spawnProxHearts(seatA, seatB) {
  _spawnHeartsOnSeat(seatA);
  _spawnHeartsOnSeat(seatB);
}

function _spawnHeartsOnSeat(seatId) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn || !btn.classList.contains('intimacy-aura')) return;
  const count = 2 + Math.floor(Math.random() * 2); // 2 ou 3 corações
  for (let i = 0; i < count; i++) {
    const h = document.createElement('div');
    h.className = 'prox-heart';
    h.textContent = '♥';
    h.style.left         = (15 + Math.random() * 70) + '%';
    h.style.animationDelay = (i * 0.35) + 's';
    h.style.fontSize     = (9 + Math.random() * 7) + 'px';
    btn.appendChild(h);
    setTimeout(() => h.remove(), 1800 + i * 350);
  }
}
