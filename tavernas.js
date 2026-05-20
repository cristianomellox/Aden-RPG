/* ═══════════════════════════════════════════
   TAVERNAS — Aden RPG Online  |  tavernas.js
   Ably pub/sub (chat + presence) + WebRTC voice
═══════════════════════════════════════════ */

// ── Config ──
const ABLY_KEY      = '5kVVVQ.Gn1VBA:lN3zK-KKFTZOWm3iBe3FfbPmtwb-oxsMTco_W0A-AZw';
const ROOM_CAPACITY = 30;
const ICE_SERVERS   = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

// ── Player ──
// Lê os dados reais da sessão que o jogo armazena no localStorage.
// Se não encontrar, usa fallback visível para o jogador corrigir.
function loadPlayer() {
  const id    = localStorage.getItem('aden_pid')
             || localStorage.getItem('player_id')
             || ('p_' + Math.random().toString(36).slice(2, 9));
  const name  = localStorage.getItem('aden_name')
             || localStorage.getItem('player_name')
             || localStorage.getItem('playerName')
             || 'Jogador';
  const role  = localStorage.getItem('aden_role')  || 'member';
  const guild = localStorage.getItem('aden_guild') || localStorage.getItem('player_guild') || '';
  localStorage.setItem('aden_pid',  id);
  localStorage.setItem('aden_name', name);
  return { id, name, role, guild };
}
const PLAYER = loadPlayer();

// ── Runtime state ──
let ablyReady   = false;
let ablyClient  = null;
let roomChannel = null;
let sigChannel  = null;  // WebRTC signaling (canal pessoal)
let currentRoom = null;  // { id, name, tag }
let roomMembers = {};    // { clientId: { name, role, seatId, muted } }
let mySeats     = {};
let micOn       = false;
let micMuted    = false;
let audioMuted  = false;
let navDropOpen = false;
let localStream = null;
let peerConns   = {};
let audioCtx    = null;
let speakLastTs    = 0;
let speakLastState = false;
let selectedGiftRecipients = new Set();

// ══════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  buildSeatsGrid();
  bindTabs();
  bindInputs();
  initAbly();
  scaleFont();
});

function initAbly() {
  if (typeof Ably === 'undefined') {
    // SDK não carregou (sem internet?), tenta de novo em 2s
    setTimeout(initAbly, 2000);
    return;
  }
  setConnDot('connecting');
  ablyClient = new Ably.Realtime({
    key:          ABLY_KEY,
    clientId:     PLAYER.id,
    echoMessages: false,
    recover:      (_, cb) => cb(true)
  });
  ablyClient.connection.on('connected',    () => { ablyReady = true;  setConnDot('on');  });
  ablyClient.connection.on('disconnected', () => { ablyReady = false; setConnDot('off'); });
  ablyClient.connection.on('failed',       () => { ablyReady = false; setConnDot('err'); });
  ablyClient.connection.on('connecting',   () => setConnDot('connecting'));
}

function setConnDot(state) {
  const d = document.getElementById('conn-dot');
  if (d) d.className = 'conn-dot ' + state;
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

  const roomId  = slugify(name);
  currentRoom   = { id: roomId, name, tag };
  roomMembers   = {};
  mySeats       = {};

  document.getElementById('topbar-center').textContent    = '';
  document.getElementById('btn-back').style.visibility    = 'visible';
  document.getElementById('btn-create').style.display     = 'none';
  document.getElementById('conn-dot').style.display       = 'block';
  document.getElementById('room-header-name').textContent = name;
  document.getElementById('room-people-count').textContent = '–';

  document.getElementById('list-view').classList.remove('active');
  document.getElementById('room-view').classList.add('active', 'fade-in');

  resetSeats();
  clearChat();
  sysMsg('Bem-vindo a ' + name + ' · max ' + ROOM_CAPACITY + ' pessoas');
  sysMsg('Sente-se e ative o microfone para falar.');

  joinChannel(roomId);
}

function closeRoom() {
  leaveChannel();
  stopVoice();

  document.getElementById('topbar-center').textContent  = 'Tavernas';
  document.getElementById('btn-back').style.visibility  = 'hidden';
  document.getElementById('btn-create').style.display   = '';
  document.getElementById('conn-dot').style.display     = 'none';
  document.getElementById('room-view').classList.remove('active', 'fade-in');
  document.getElementById('list-view').classList.add('active', 'fade-in');

  currentRoom = null;
  micOn = false; micMuted = false; audioMuted = false;
  updateMicBtn();
  document.getElementById('btn-audio-mute')?.classList.remove('audio-off');
}

// ══════════════════════════════════════════
//  ABLY CHANNEL + PRESENCE
// ══════════════════════════════════════════
function joinChannel(roomId) {
  if (roomChannel) { try { roomChannel.detach(); } catch(_){} }
  if (sigChannel)  { try { sigChannel.detach();  } catch(_){} }

  // Rewind: entrega as últimas 20 msgs de chat ao conectar
  roomChannel = ablyClient.channels.get('taverna:' + roomId, { params: { rewind: '20' } });

  roomChannel.subscribe('msg',   onMsg);
  roomChannel.subscribe('seat',  onSeat);
  roomChannel.subscribe('mod',   onMod);
  roomChannel.subscribe('speak', onSpeak);

  // Canal de sinalização WebRTC (pessoal — só eu recebo)
  sigChannel = ablyClient.channels.get('sig:' + roomId + ':' + PLAYER.id);
  sigChannel.subscribe('offer',     (m) => handleOffer(m.clientId, m.data));
  sigChannel.subscribe('answer',    (m) => handleAnswer(m.clientId, m.data));
  sigChannel.subscribe('candidate', (m) => handleCandidate(m.clientId, m.data));

  // Presence
  roomChannel.presence.subscribe('enter',  (m) => onPresence('enter',  m));
  roomChannel.presence.subscribe('leave',  (m) => onPresence('leave',  m));
  roomChannel.presence.subscribe('update', (m) => onPresence('update', m));

  // Entra na sala
  roomChannel.presence.enter({
    name: PLAYER.name, role: PLAYER.role,
    guild: PLAYER.guild, seatId: null, muted: false
  });

  // Busca quem já está (entrada de jogadores anteriores)
  roomChannel.presence.get((err, members) => {
    if (err || !members) return;
    members.forEach(m => {
      if (m.clientId === PLAYER.id) return;
      const d = m.data || {};
      roomMembers[m.clientId] = {
        name: d.name || '?', role: d.role || 'member',
        seatId: d.seatId || null, muted: !!d.muted
      };
      if (d.seatId) renderSeat(m.clientId, d.seatId, d.name, d.muted);
    });
    updateOnlineCount();
    refreshPeopleModal();
  });
}

function leaveChannel() {
  try { roomChannel?.presence.leave(); } catch(_){}
  try { roomChannel?.detach(); }        catch(_){}
  try { sigChannel?.detach(); }         catch(_){}
  roomChannel = null; sigChannel = null;
  for (const pc of Object.values(peerConns)) { try { pc.close(); } catch(_){} }
  peerConns = {};
  document.querySelectorAll('.remote-audio').forEach(el => el.remove());
}

function onPresence(action, msg) {
  const id   = msg.clientId;
  const d    = msg.data || {};
  if (id === PLAYER.id) return;

  if (action === 'enter') {
    roomMembers[id] = { name: d.name || '?', role: d.role || 'member', seatId: d.seatId || null, muted: !!d.muted };
    sysMsg((d.name || '?') + ' entrou na taverna.');
    if (micOn && localStream) initiateCall(id);

  } else if (action === 'update') {
    const prev = roomMembers[id]?.seatId;
    roomMembers[id] = { name: d.name || '?', role: d.role || 'member', seatId: d.seatId || null, muted: !!d.muted };
    if (prev && prev !== d.seatId) clearSeat(prev);
    if (d.seatId) renderSeat(id, d.seatId, d.name, d.muted);

  } else if (action === 'leave') {
    const m = roomMembers[id];
    if (m) {
      if (m.seatId) clearSeat(m.seatId);
      sysMsg((m.name || '?') + ' saiu da taverna.');
    }
    delete roomMembers[id];
    peerConns[id]?.close(); delete peerConns[id];
    document.getElementById('audio-' + id)?.remove();
  }

  updateOnlineCount();
  refreshPeopleModal();
}

function onMsg(msg) {
  // echoMessages:false — só chega de outros; própria msg já foi adicionada localmente
  const d = msg.data || {};
  chatMsg(d.name || '?', d.text || '', false);
}

function onSeat(msg) {
  if (msg.clientId === PLAYER.id) return;
  const d = msg.data || {};
  const m = roomMembers[msg.clientId];
  if (m) {
    if (m.seatId && m.seatId !== d.seatId) clearSeat(m.seatId);
    m.seatId = d.seatId || null;
  }
  if (d.seatId) renderSeat(msg.clientId, d.seatId, d.name, false);
  else if (d.prevSeatId) clearSeat(d.prevSeatId);
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

function updateOnlineCount() {
  const n = Object.keys(roomMembers).length + 1; // +1 = eu
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
//  AVATAR / INITIALS CANVAS
// ══════════════════════════════════════════
const avatarCache = {};
function makeAvatar(name, size) {
  const key = name + '_' + size;
  if (avatarCache[key]) return avatarCache[key];
  const c  = document.createElement('canvas');
  c.width  = size; c.height = size;
  const cx = c.getContext('2d');
  // Background colour derived from name
  const hue = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  cx.fillStyle = `hsl(${hue},42%,26%)`;
  cx.beginPath(); cx.arc(size/2, size/2, size/2, 0, Math.PI*2); cx.fill();
  // Initials
  const initials = (name.match(/\S+/g)||['?']).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  cx.fillStyle = '#e8d08a';
  cx.font      = `bold ${Math.round(size*0.38)}px sans-serif`;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(initials, size/2, size/2 + 1);
  const url = c.toDataURL();
  avatarCache[key] = url;
  return url;
}

// ══════════════════════════════════════════
//  SEAT RENDERING
// ══════════════════════════════════════════
function renderSeat(clientId, seatId, name, muted) {
  const btn = document.getElementById('seat-btn-' + seatId);
  const nm  = document.getElementById('seat-name-' + seatId);
  if (!btn) return;
  btn.classList.add('taken');
  btn.classList.toggle('muted', !!muted);
  const img = btn.querySelector('.seat-avatar-img');
  if (img) img.src = makeAvatar(name || '?', 104);
  if (nm)  { nm.textContent = name || '?'; nm.classList.remove('vacant'); }
}

function clearSeat(seatId) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn) return;
  btn.className = 'seat-btn';
  const img = btn.querySelector('.seat-avatar-img');
  if (img) img.src = '';
  const nm = document.getElementById('seat-name-' + seatId);
  if (nm) { nm.textContent = 'Vago'; nm.classList.add('vacant'); }
}

function resetSeats() {
  mySeats = {};
  for (let i = 1; i <= 10; i++) clearSeat(String(i));
  clearSeat('t1'); clearSeat('t2');
}

function setSpeaking(seatId, on) {
  document.getElementById('seat-btn-' + seatId)?.classList.toggle('speaking', on);
}

// ══════════════════════════════════════════
//  SEAT CLICK / CLAIM
// ══════════════════════════════════════════
function onSeatClick(seatId) {
  const btn = document.getElementById('seat-btn-' + seatId);
  if (!btn) return;
  const isThrone   = seatId === 't1' || seatId === 't2';
  const isTaken    = btn.classList.contains('taken');
  const isMySeat   = !!mySeats[seatId];

  if (isThrone && !isTaken && PLAYER.role !== 'owner' && PLAYER.role !== 'admin') {
    showToast('Apenas o dono e administradores podem usar os tronos.');
    return;
  }
  if (!isTaken) { claimSeat(seatId); return; }

  const rect       = btn.getBoundingClientRect();
  const occupantId = Object.keys(roomMembers).find(id => roomMembers[id].seatId === seatId);
  const occupant   = occupantId ? { id: occupantId, ...roomMembers[occupantId] } : null;
  const isAdmin    = PLAYER.role === 'owner' || PLAYER.role === 'admin';

  if (isMySeat) {
    showCtxMenu(rect, [{ icon: iconLeave(), label: 'Sair do assento', danger:false, action: () => vacateMySeat(seatId) }]);
  } else {
    showCtxMenu(rect, buildOtherMenu(occupant, isAdmin));
  }
}

function claimSeat(seatId) {
  const total = Object.keys(roomMembers).length + 1;
  if (total >= ROOM_CAPACITY) { showToast('Sala cheia! Limite de ' + ROOM_CAPACITY + ' pessoas.'); return; }

  // Sai do assento anterior
  const prevId = Object.keys(mySeats)[0];
  if (prevId) {
    clearSeat(prevId);
    roomChannel?.publish('seat', { seatId: null, prevSeatId: prevId, name: PLAYER.name });
  }
  mySeats = {};

  // Senta
  renderSeat(PLAYER.id, seatId, PLAYER.name, micMuted);
  mySeats[seatId] = true;

  roomChannel?.publish('seat', { seatId, prevSeatId: prevId || null, name: PLAYER.name });
  roomChannel?.presence.update({ name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild, seatId, muted: micMuted });
  sysMsg('Voce ocupou o assento ' + seatId + '. Ative o microfone para falar.');
}

function vacateMySeat(seatId) {
  const prev = Object.keys(mySeats)[0];
  clearSeat(seatId);
  delete mySeats[seatId];
  roomChannel?.publish('seat', { seatId: null, prevSeatId: prev || null, name: PLAYER.name });
  roomChannel?.presence.update({ name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild, seatId: null, muted: micMuted });
  sysMsg('Voce saiu do assento.');
  if (micOn) stopVoice();
}

// ══════════════════════════════════════════
//  MIC / AUDIO
// ══════════════════════════════════════════
async function toggleMic() {
  if (Object.keys(mySeats).length === 0) {
    showToast('Sente-se em um assento antes de ativar o microfone.');
    return;
  }

  if (!micOn) {
    // Verificação se getUserMedia existe (Acode/WebView podem não ter)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Voz nao disponivel neste navegador. Use Chrome ou Firefox.');
      return;
    }
    showToast('Solicitando acesso ao microfone...');
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micOn    = true;
      micMuted = false;
      updateMicBtn();
      startSpeakDetect();
      for (const peerId of Object.keys(roomMembers)) initiateCall(peerId);
      const sid = Object.keys(mySeats)[0];
      roomChannel?.presence.update({ name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild, seatId: sid, muted: false });
      showToast('Microfone ativo!');
    } catch (e) {
      localStream = null;
      const msg = e.name === 'NotAllowedError'  ? 'Permissao de microfone negada.' :
                  e.name === 'NotFoundError'     ? 'Nenhum microfone encontrado.' :
                  e.name === 'NotReadableError'  ? 'Microfone em uso por outro app.' :
                  'Erro ao acessar microfone: ' + (e.message || e.name);
      showToast(msg);
      console.error('getUserMedia:', e);
    }
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
  roomChannel?.presence.update({ name: PLAYER.name, role: PLAYER.role, guild: PLAYER.guild, seatId: sid || null, muted: micMuted });
  showToast(micMuted ? 'Microfone mutado.' : 'Microfone ativo.');
}

function updateMicBtn() {
  const btn = document.getElementById('btn-mic-mute');
  if (!btn) return;
  const active = micOn && !micMuted;
  btn.classList.toggle('mic-on', active);
  btn.title = active ? 'Clique para mutar' : (micOn ? 'Clique para desmutar' : 'Ativar microfone');
}

function toggleAudio() {
  audioMuted = !audioMuted;
  document.getElementById('btn-audio-mute')?.classList.toggle('audio-off', audioMuted);
  document.querySelectorAll('.remote-audio').forEach(el => { el.muted = audioMuted; });
  showToast(audioMuted ? 'Audio mutado.' : 'Audio reativado.');
}

function stopVoice() {
  localStream?.getTracks().forEach(t => { try { t.stop(); } catch(_){} });
  localStream = null;
  micOn = false; micMuted = false;
  updateMicBtn();
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

// Speaking detection (AnalyserNode — client-side, sem custo de rede)
function startSpeakDetect() {
  if (!localStream) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(localStream);
    const anl = audioCtx.createAnalyser();
    anl.fftSize = 512;
    src.connect(anl);
    const buf = new Uint8Array(anl.frequencyBinCount);

    const tick = () => {
      if (!micOn || !localStream) return;
      anl.getByteFrequencyData(buf);
      const avg     = buf.reduce((a, b) => a + b, 0) / buf.length;
      const talking = avg > 16 && !micMuted;
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
  if (peerConns[peerId] || !localStream) return;
  const pc = makePeer(peerId);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(peerId, 'offer', offer);
  } catch (e) { console.error('initiateCall:', e); }
}

async function handleOffer(fromId, offer) {
  let pc = peerConns[fromId];
  if (!pc) pc = makePeer(fromId);
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  sendSignal(fromId, 'answer', ans);
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
      audio.id = 'audio-' + peerId;
      audio.className = 'remote-audio';
      audio.autoplay  = true;
      audio.muted     = audioMuted;
      document.body.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
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
  chatMsg(PLAYER.name, text, true);
  roomChannel.publish('msg', { name: PLAYER.name, text });
}

function chatMsg(name, text, isMine) {
  const c   = document.getElementById('chat-messages');
  if (!c) return;
  const m   = document.createElement('div');
  m.className = 'chat-msg';
  m.style.flexDirection = isMine ? 'row-reverse' : 'row';
  const av  = makeAvatar(name, 50);
  m.innerHTML = `
    <div class="c-av" onclick="onNameClick('${esc(name)}')">
      <img src="${av}" style="width:100%;height:100%;object-fit:cover;">
    </div>
    <div class="c-body" style="${isMine ? 'align-items:flex-end;' : ''}">
      <div class="c-name" onclick="onNameClick('${esc(name)}')" style="${isMine ? 'color:var(--blue-light);' : ''}">${esc(name)}</div>
      <div class="c-text" style="${isMine ? 'background:rgba(30,50,80,0.55);padding:3px 9px;border-radius:10px 2px 10px 10px;' : ''}">${esc(text)}</div>
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
  const isAdmin = PLAYER.role === 'owner' || PLAYER.role === 'admin';
  const rect = { bottom: 200, top: 160, left: 20, right: 200 };
  showCtxMenu(rect, buildOtherMenu({ id, ...data }, isAdmin));
}

// ══════════════════════════════════════════
//  MODERATION
// ══════════════════════════════════════════
function buildOtherMenu(occupant, isAdmin) {
  const items = [
    { icon: iconProfile(), label: 'Ver perfil', danger: false,
      action: () => showToast('Perfil de ' + (occupant?.name || '?')) }
  ];
  if (isAdmin && occupant) {
    const canMod = !(occupant.role === 'owner' || (PLAYER.role === 'admin' && occupant.role === 'admin'));
    if (canMod) {
      items.push({ icon: iconMuteUser(), label: 'Silenciar',          danger: false, action: () => modAction('mute', occupant) });
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
  refreshPeopleModal();
  document.getElementById('people-modal').classList.add('open');
}
function closePeopleModal() {
  document.getElementById('people-modal').classList.remove('open');
}

function refreshPeopleModal() {
  if (!document.getElementById('people-modal')?.classList.contains('open')) return;
  const list = document.getElementById('people-list');
  if (!list) return;
  list.innerHTML = '';

  const self = { id: PLAYER.id, name: PLAYER.name, role: PLAYER.role, seatId: Object.keys(mySeats)[0] || null, muted: micMuted };
  const all  = [self, ...Object.entries(roomMembers).map(([id, v]) => ({ id, ...v }))];
  const byRole = { owner:[], admin:[], member:[] };
  all.forEach(p => (byRole[p.role] ?? byRole.member).push(p));

  if (byRole.owner.length)  renderPeopleSection(list, 'Dono',           byRole.owner);
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
    const av      = makeAvatar(p.name, 76);
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
      if (!e.target.closest('.person-actions')) showToast('Perfil de ' + p.name);
    });
    container.appendChild(row);
  });
}

function roleLabel(r) { return r==='owner'?'Dono':r==='admin'?'Administrador':'Membro'; }

// ══════════════════════════════════════════
//  GIFT MODAL
// ══════════════════════════════════════════
const GIFTS = [
  { id:'g1', name:'Vela',   cost:50,    svg:gSvg(1) },
  { id:'g2', name:'Flor',   cost:100,   svg:gSvg(2) },
  { id:'g3', name:'Pocao',  cost:300,   svg:gSvg(3) },
  { id:'g4', name:'Calice', cost:500,   svg:gSvg(4) },
  { id:'g5', name:'Anel',   cost:1000,  svg:gSvg(5) },
  { id:'g6', name:'Espada', cost:2000,  svg:gSvg(6) },
  { id:'g7', name:'Coroa',  cost:5000,  svg:gSvg(7) },
  { id:'g8', name:'Dragao', cost:10000, svg:gSvg(8) },
];

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
  const inSeat = Object.entries(roomMembers).filter(([,v])=>v.seatId).map(([id,v])=>({id,...v}));
  if (!inSeat.length) {
    c.innerHTML = `<span style="font-family:'Cinzel',serif;font-size:0.7rem;color:var(--text-muted);font-style:italic;">Nenhum membro nos assentos.</span>`;
    return;
  }
  inSeat.forEach(m => {
    const item = document.createElement('div');
    item.className = 'gift-rec-item';
    const av = makeAvatar(m.name, 84);
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
  const g = document.createElement('div'); g.className = 'gift-grid';
  GIFTS.forEach(gift => {
    const card = document.createElement('div'); card.className = 'gift-card';
    card.innerHTML = `<div class="gift-icon">${gift.svg}</div><div class="gift-name">${gift.name}</div><div class="gift-cost"><svg viewBox="0 0 12 12" fill="none" style="width:10px;height:10px;"><circle cx="6" cy="6" r="5" stroke="var(--gold)" stroke-width="1.2"/><text x="6" y="9" text-anchor="middle" font-size="6" fill="var(--gold)" font-family="serif">O</text></svg>${gift.cost.toLocaleString()}</div>`;
    card.addEventListener('click', () => sendGift(gift));
    g.appendChild(card);
  });
  c.appendChild(g);
  document.getElementById('gift-grid-bolsa').innerHTML = `<div class="gift-empty">Sua bolsa esta vazia.</div>`;
}

function sendGift(gift) {
  if (!selectedGiftRecipients.size) { showToast('Selecione ao menos um destinatario.'); return; }
  const names = [...selectedGiftRecipients].map(id=>roomMembers[id]?.name||'?').join(', ');
  roomChannel?.publish('msg', { name:'[ Presente ]', text: PLAYER.name + ' enviou ' + gift.name + ' para ' + names + '!' });
  showToast('Presente enviado para ' + names + '!');
  closeGiftModal();
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
//  SEAT GRID (JS-built)
// ══════════════════════════════════════════
function buildSeatsGrid() {
  const grid = document.getElementById('seats-grid');
  if (!grid) return;
  for (let i = 1; i <= 10; i++) {
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
