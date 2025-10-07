// guild_tavern.js
document.addEventListener('DOMContentLoaded', async () => {
  // tenta reutilizar SUPABASE_URL/KEY do window (compatível com guild.js)
  const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
  const supabase = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : (window.supabase ? window.supabase : null);

  if (!supabase) {
    console.error('Supabase não disponível em guild_tavern.js');
    return;
  }

  // DOM container
  const tavernaPane = document.getElementById('taverna');
  if (!tavernaPane) return;

  // elemento root
  tavernaPane.innerHTML = '';
  const container = document.createElement('div');
  container.id = 'tavernContainer';
  container.innerHTML = `
    <h3 id="tavernTitle"></h3>
    <div id="tavernControls" style="margin-bottom:8px;"></div>
    <div id="tavernSeats" class="tavern-seats"></div>
    <div id="tavernListeners"></div>
    <div id="tavernChat" class="tavern-chat"></div>
    <div id="tavernChatInput">
      <input type="text" id="tavernMessageInput" placeholder="Vamos conversar..." />
      <button id="tavernSendBtn">Enviar</button>
    </div>
  `;
  tavernaPane.appendChild(container);

  // estado
  let userId = null;
  let currentGuildId = null;
  let currentRoom = null; // object {id, name, is_open_to_all}
  let pollingIntervalId = null;
  let lastMessageTime = null;

  // helpers UI refs
  const tTitle = document.getElementById('tavernTitle');
  const tSeats = document.getElementById('tavernSeats');
  const tListeners = document.getElementById('tavernListeners');
  const tChat = document.getElementById('tavernChat');
  const tMessageInput = document.getElementById('tavernMessageInput');
  const tSendBtn = document.getElementById('tavernSendBtn');
  const tControls = document.getElementById('tavernControls');

  // render seats (15)
  function renderEmptySeats(){
    tSeats.innerHTML = '';
    for (let i=1;i<=15;i++){
      const el = document.createElement('div');
      el.className = 'tavern-seat empty';
      el.dataset.seat = i;
      el.innerHTML = `<div style="text-align:center;color:white">${i}</div><div class="seat-number">${i}</div>`;
      tSeats.appendChild(el);
    }
  }
  renderEmptySeats();

  // basic utility to get session user
  async function getUserSession(){
    try {
      const { data } = await supabase.auth.getSession();
      const session = data ? data.session : null;
      if (session && session.user) {
        userId = session.user.id;
        // try to detect guild id from existing players table (if present on page or cache)
        try {
          const { data: pl } = await supabase.from('players').select('guild_id, name, avatar_url').eq('id', userId).single();
          if (pl) currentGuildId = pl.guild_id;
        } catch(e) { /* ignore */ }
        return true;
      }
    } catch(e) { console.error('getSession', e); }
    // not logged, redirect
    window.location.href = 'index.html';
    return false;
  }

  // get or create taverna room for the guild
  async function ensureRoom() {
    if (!currentGuildId) return null;
    // tenta achar uma room existente para essa guild
    const { data: rooms, error } = await supabase.from('tavern_rooms').select('*').eq('guild_id', currentGuildId).limit(1);
    if (!error && rooms && rooms.length) {
      currentRoom = rooms[0];
      return currentRoom;
    }
    // cria uma default (nome = guilda)
    let guildName = 'Taverna';
    try {
      const { data: g } = await supabase.from('guilds').select('name').eq('id', currentGuildId).single();
      if (g && g.name) guildName = g.name;
    } catch(e){}
    const { data: created, error: createErr } = await supabase.rpc('create_tavern_room', { p_guild_id: currentGuildId, p_name: guildName || 'Taverna', p_open: false });
    if (!createErr && created && created.length) {
      currentRoom = created[0];
      return currentRoom;
    } else if (!createErr && created) {
      currentRoom = created;
      return currentRoom;
    } else {
      console.error('Erro criando room', createErr);
      return null;
    }
  }

  // render title + controls
  function renderControls(isLeaderOrColeader=false) {
    tControls.innerHTML = '';
    const openBtn = document.createElement('button');
    openBtn.className = 'action-btn';
    openBtn.textContent = currentRoom && currentRoom.is_open_to_all ? 'Aberta para Todos' : 'Somente Guilda';
    openBtn.onclick = async () => {
      if (!isLeaderOrColeader) return showInfo('Apenas Líder/Co-Líder pode alterar.');
      const newOpen = !(currentRoom.is_open_to_all);
      await supabase.rpc('toggle_tavern_room_open', { p_room_id: currentRoom.id, p_open: newOpen });
      currentRoom.is_open_to_all = newOpen;
      renderControls(isLeaderOrColeader);
    };
    tControls.appendChild(openBtn);

    // join/leave buttons
    const joinBtn = document.createElement('button');
    joinBtn.className = 'action-btn';
    joinBtn.textContent = 'Entrar na Taverna';
    joinBtn.onclick = () => joinRoom();
    tControls.appendChild(joinBtn);

    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'action-btn';
    leaveBtn.textContent = 'Sair';
    leaveBtn.onclick = () => leaveRoom();
    tControls.appendChild(leaveBtn);
  }

  // show small message modal (reuse info modal from guild.js if exists)
  function showInfo(msg) {
    // se existir showInfoModal do guild.js
    if (window.showInfoModal) return window.showInfoModal(msg);
    alert(msg);
  }

  // join room
  async function joinRoom(preferSeat=null) {
    if (!currentRoom) { await ensureRoom(); if(!currentRoom) return showInfo('Não foi possível acessar a taverna.'); }
    try {
      const { data, error } = await supabase.rpc('join_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId, p_prefer_seat: preferSeat });
      if (error) { console.error('join err', error); showInfo('Erro ao entrar.'); return; }
      // start polling
      lastMessageTime = null;
      startPolling();
      showInfo('Você entrou na Taverna.');
    } catch(e) { console.error(e); showInfo('Erro ao entrar.'); }
  }

  async function leaveRoom() {
    if (!currentRoom) return;
    try {
      await supabase.rpc('leave_tavern_room', { p_room_id: currentRoom.id, p_player_id: userId });
      stopPolling();
      renderEmptySeats();
      tListeners.innerHTML = '';
      tChat.innerHTML = '';
      showInfo('Você saiu da Taverna.');
    } catch(e) { console.error(e); showInfo('Erro ao sair.'); }
  }

  // poll functions
  async function fetchStateAndMessages() {
    if (!currentRoom) return;
    try {
      // membros / seats
      const { data: members } = await supabase.from('tavern_members').select('player_id, seat_number, is_muted, joined_at, last_active_at').eq('room_id', currentRoom.id);
      // mensagens desde lastMessageTime
      let messagesQuery = supabase.from('tavern_messages').select('id, player_id, player_name, player_avatar, message, created_at').eq('room_id', currentRoom.id).order('created_at', { ascending: true }).limit(200);
      if (lastMessageTime) messagesQuery = messagesQuery.gt('created_at', lastMessageTime);
      const { data: messages } = await messagesQuery;
      // render
      renderMembers(members || []);
      renderMessages(messages || []);
      if (messages && messages.length) {
        lastMessageTime = messages[messages.length-1].created_at;
      }
    } catch(e) {
      console.error('poll error', e);
    }
  }

  function renderMembers(members) {
    // map by seat
    const seatMap = {};
    const listeners = [];
    (members||[]).forEach(m => {
      if (m.seat_number && m.seat_number >=1 && m.seat_number <=15) seatMap[m.seat_number] = m;
      else listeners.push(m);
    });

    // update seats DOM
    const seatEls = Array.from(tSeats.children);
    seatEls.forEach(el => {
      const seat = parseInt(el.dataset.seat,10);
      const member = seatMap[seat];
      if (member) {
        el.classList.remove('empty');
        // get avatar + name from players table (async)
        (async()=>{
          try {
            const { data: p } = await supabase.from('players').select('name, avatar_url').eq('id', member.player_id).single();
            const avatar = (p && p.avatar_url) ? p.avatar_url : 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
            el.innerHTML = `<img src="${avatar}" alt="${p ? p.name : 'Player'}" /><div class="seat-number">${seat}</div>`;
            // if current user is leader show mod buttons
            if (await isUserLeaderOrColeader()) {
              // add mod buttons
              const modDiv = document.createElement('div');
              modDiv.className = 'mod-actions';
              modDiv.innerHTML = `<button data-action="kick" data-target="${member.player_id}">Kick</button><button data-action="mute" data-target="${member.player_id}">${member.is_muted ? 'Unmute' : 'Mute'}</button>`;
              // ensure not duplicate
              const existed = el.querySelector('.mod-actions');
              if (!existed) el.appendChild(modDiv);
              modDiv.addEventListener('click', async (ev) => {
                const btn = ev.target.closest('button');
                if (!btn) return;
                const action = btn.dataset.action;
                const target = btn.dataset.target;
                if (action === 'kick') {
                  if (!confirm('Remover esse membro do assento?')) return;
                  await supabase.rpc('kick_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: target });
                } else if (action === 'mute') {
                  const shouldMute = btn.textContent === 'Mute';
                  await supabase.rpc('mute_tavern_member', { p_room_id: currentRoom.id, p_target_player_id: target, p_mute: shouldMute });
                }
              });
            }
          } catch(e){ console.error('player fetch', e); }
        })();
      } else {
        // empty seat visual
        el.classList.add('empty');
        el.innerHTML = `<div style="text-align:center;color:white;padding-top:6px;">Livre</div><div class="seat-number">${seat}</div>`;
      }
    });

    // render listeners (get player info)
    tListeners.innerHTML = '';
    // for simplicity, we will show up to 20 listeners
    const listenerPlayers = listeners.slice(0, 40);
    listenerPlayers.forEach(async (l) => {
      try {
        const { data: p } = await supabase.from('players').select('name, avatar_url').eq('id', l.player_id).single();
        const avatar = (p && p.avatar_url) ? p.avatar_url : 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
        const div = document.createElement('div');
        div.className = 'tavern-listener';
        div.innerHTML = `<img src="${avatar}" alt="${p ? p.name : 'Player'}" /><div style="font-size:0.75em">${p ? p.name : 'Player'}</div>`;
        tListeners.appendChild(div);
      } catch(e){}
    });
  }

  function renderMessages(messages) {
    if (!messages || !messages.length) return;
    messages.forEach(m => {
      const div = document.createElement('div');
      div.className = 'tavern-message';
      const avatar = m.player_avatar || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
      const name = m.player_name || 'Player';
      div.innerHTML = `<img src="${avatar}" /><div><div style="font-weight:bold;font-size:0.8em;margin-bottom:3px">${name}</div><div class="bubble">${escapeHtml(m.message)}</div></div>`;
      tChat.appendChild(div);
      // scroll
      tChat.scrollTop = tChat.scrollHeight;
    });
  }

  // utility
  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"'`]/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[s]));
  }

  // send message
  tSendBtn.addEventListener('click', async () => {
    const txt = tMessageInput.value.trim();
    if (!txt) return;
    if (!currentRoom) return showInfo('Entre na taverna antes de enviar mensagens.');
    // get player meta
    const { data: p } = await supabase.from('players').select('name, avatar_url').eq('id', userId).single();
    const playerName = p ? p.name : 'Player';
    const avatar = p && p.avatar_url ? p.avatar_url : '';
    try {
      await supabase.rpc('post_tavern_message', { p_room_id: currentRoom.id, p_player_id: userId, p_player_name: playerName, p_player_avatar: avatar, p_message: txt });
      tMessageInput.value = '';
      // fetch immediately (so user sees message without waiting 30s)
      await fetchStateAndMessages();
    } catch(e){ console.error('send msg err', e); }
  });

  // simple seat click: if empty, join prefer seat; if occupied and is you, leave seat; if occupied by others, do nothing
  tSeats.addEventListener('click', async (ev) => {
    const seatEl = ev.target.closest('.tavern-seat');
    if (!seatEl) return;
    const seat = parseInt(seatEl.dataset.seat,10);
    // if user is already in seat -> leave (call join without seat? Ideally implement move)
    // for simplicity, attempt to join with preferSeat = seat
    await joinRoom(seat);
  });

  // polling control
  function startPolling(){
    if (pollingIntervalId) return;
    // immediate fetch
    fetchStateAndMessages();
    pollingIntervalId = setInterval(fetchStateAndMessages, 30 * 1000);
  }
  function stopPolling(){
    if (pollingIntervalId) { clearInterval(pollingIntervalId); pollingIntervalId = null; }
  }

  // check user is leader or co-leader (simple)
  async function isUserLeaderOrColeader(){
    if (!userId || !currentGuildId) return false;
    try {
      const { data: g } = await supabase.from('guilds').select('leader_id').eq('id', currentGuildId).single();
      if (g && g.leader_id === userId) return true;
      // check players table for rank
      const { data: p } = await supabase.from('players').select('rank').eq('id', userId).single();
      if (p && (p.rank === 'co-leader' || p.rank === 'leader')) return true;
    } catch(e){}
    return false;
  }

  // inicialização: pega sessão, room, render UI
  if (!(await getUserSession())) return;
  await ensureRoom();
  // set title to guild name
  try {
    const { data: g } = await supabase.from('guilds').select('name').eq('id', currentGuildId).single();
    tTitle.textContent = (g && g.name) ? g.name : 'Taverna';
  } catch(e){}
  // render controls with leader check
  const leaderFlag = await isUserLeaderOrColeader();
  renderControls(leaderFlag);

  // note: não começa polling até o usuário clicar em Entrar (joinRoom)
  // auto-join behavior: se preferir auto-entrar, chame joinRoom() aqui.

});
