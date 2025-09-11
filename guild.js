
document.addEventListener("DOMContentLoaded", async () => {
  const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
  const supabase = window.supabase && window.supabase.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  if (!supabase) { console.error("Supabase não iniciado"); return; }

  let userId = null;
  let userGuildId = null;
  let currentGuildData = null;
  let userRank = 'member'; // leader | co-leader | member

  // DOM helpers
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // DOM references (may be null if not on page)
  const guildNameElement = $('#guildName');
  const guildDescriptionEl = $('#guildDescription');
  const guildMemberListElement = $('#guildMemberList');
  const guildInfoContainer = $('#guildInfoContainer');
  const noGuildContainer = $('#noGuildContainer');
  const editGuildBtn = $('#editGuildBtn');
  const editGuildModal = $('#editGuildModal');
  const editTabContent = $('#editTabContent');
  const editGuildName = $('#editGuildName');
  const editNameInfo = $('#editNameInfo');
  const editGuildDescription = $('#editGuildDescription');
  const editGuildFlagUrl = $('#editGuildFlagUrl');
  const saveGuildChangesBtn = $('#saveGuildChangesBtn');
  const manageMembersList = $('#manageMembersList');
  const guildRequestsList = $('#guildRequestsList');
  const guildNoticeEl = $('#guildNotice');
  const noticeInfoEl = $('#noticeInfo');
  const noticeEditor = $('#noticeEditor');
  const editGuildNotice = $('#editGuildNotice');
  const saveGuildNoticeBtn = $('#saveGuildNoticeBtn');
  const guildLogsList = $('#guildLogsList');
  const searchGuildBtn = $('#searchGuildBtn');
  const searchGuildModal = $('#searchGuildModal');
  const searchGuildInput = $('#searchGuildInput');
  const searchGuildConfirmBtn = $('#searchGuildConfirmBtn');
  const searchGuildResults = $('#searchGuildResults');
  const createGuildBtn = $('#createGuildBtn');
  const createGuildModal = $('#createGuildModal');
  const confirmCreateGuildBtn = $('#confirmCreateGuildBtn');
  const newGuildNameInput = $('#newGuildNameInput');
  const createGuildMessage = $('#createGuildMessage');
  const editCloseBtn = editGuildModal ? editGuildModal.querySelector('.close-btn') : null;
  const searchCloseBtn = searchGuildModal ? searchGuildModal.querySelector('.close-btn') : null;
  const refreshBtn = $('#refreshBtn');

  // --- Main tabs (tela inicial) ---
  function activateMainTab(tabId){
    // tabs
    $$(`#tabMenu .tab-btn`).forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    // panes
    $$('#tabContent .tab-pane').forEach(p => {
      if (p.id === tabId) {
        p.classList.add('active');
        p.style.display = ''; // let CSS decide (default)
      } else {
        p.classList.remove('active');
        p.style.display = 'none';
      }
    });
  }

  const tabMenuEl = $('#tabMenu');
  if (tabMenuEl){
    // Initialize default active if none
    const activeBtn = tabMenuEl.querySelector('.tab-btn.active') || tabMenuEl.querySelector('.tab-btn');
    if (activeBtn) activateMainTab(activeBtn.dataset.tab);

    // Event delegation: works for <span>, <button>, etc.
    tabMenuEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab-btn');
      if (!btn) return;
      const tab = btn.dataset.tab;
      if (!tab) return;
      activateMainTab(tab);
    });
  }

  // --- Edit modal tabs (supports #editTabMenu or legacy #editTabs) ---
  function activateEditTab(tabId){
    // panes
    $$('#editTabContent .edit-tab-pane').forEach(p => {
      p.style.display = (p.id === tabId) ? 'block' : 'none';
    });
    // buttons styling
    $$('#editTabMenu .edit-tab-btn, #editTabs .edit-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));

    // limpar notificação da aba ao abrir
    markTabNotification(tabId, false);
    // se abrir requests/notice, também remove o ponto no ícone principal
    if (tabId === 'tab-requests' || tabId === 'tab-notice'){
      updateGuildNotifications(false);
      if (userGuildId) localStorage.setItem(`guild_${userGuildId}_${tabId}_read`, Date.now());
    }
  }

  const editTabMenuEl = $('#editTabMenu') || $('#editTabs');
  if (editTabMenuEl){
    // set default if any already active
    const activeEditBtn = editTabMenuEl.querySelector('.edit-tab-btn.active') || editTabMenuEl.querySelector('.edit-tab-btn');
    if (activeEditBtn) activateEditTab(activeEditBtn.dataset.tab);

    editTabMenuEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.edit-tab-btn');
      if (!btn) return;
      const tab = btn.dataset.tab;
      if (!tab) return;
      activateEditTab(tab);
    });
  }

  function traduzCargo(rank){
    if (rank === 'leader') return 'Líder';
    if (rank === 'co-leader') return 'Co-Líder';
    return 'Membro';
  }

  function formatDateTime(dt){
    try { return new Date(dt).toLocaleString(); } catch(e){ return dt; }
  }

  async function checkGuildNotifications(guildData){
    if (!editGuildBtn) return;
    let hasRequests = false, hasNotice = false;

    try {
      const { data: reqs, error } = await supabase.from('guild_join_requests').select('id').eq('guild_id', guildData.id).limit(1);
      if (!error && reqs && reqs.length > 0) hasRequests = true;
    } catch(e){ console.error('check requests', e); }

    try {
      if (guildData.last_notice_update){
        const last = new Date(guildData.last_notice_update);
        const diffMs = Date.now() - last.getTime();
        if (diffMs < 24*3600*1000) hasNotice = true;
      }
    } catch(e){ console.error('check notice', e); }

    // verificar se já foi lido
    const readRequests = localStorage.getItem(`guild_${guildData.id}_tab-requests_read`);
    const readNotice   = localStorage.getItem(`guild_${guildData.id}_tab-notice_read`);

    if (hasRequests && !readRequests) markTabNotification('tab-requests', true);
    else markTabNotification('tab-requests', false);

    if (hasNotice && !readNotice) markTabNotification('tab-notice', true);
    else markTabNotification('tab-notice', false);

    updateGuildNotifications(((!readRequests && hasRequests) || (!readNotice && hasNotice)));
  }

  function markTabNotification(tabId, show){
    const tabBtn = document.querySelector(`#editTabMenu .edit-tab-btn[data-tab="${tabId}"]`);
    if (!tabBtn) return;
    let dot = tabBtn.querySelector('.notif-dot');
    if (show){
      if (!dot){
        tabBtn.insertAdjacentHTML('beforeend', '<span class="notif-dot"></span>');
      }
    } else {
      if (dot) dot.remove();
    }
  }

  // --- Session and main loading ---
  async function getUserSession(){
    try {
      const { data } = await supabase.auth.getSession();
      const session = data ? data.session : null;
      if (session){ userId = session.user.id; return true; }
    } catch(e){ console.error('getSession error', e); }
    // redirect to login if no session
    window.location.href = 'index.html';
    return false;
  }

  async function loadGuildInfo(){
    if (!userId) return;
    try {
      if (!userGuildId){
        const { data: playerData, error: playerError } = await supabase.from('players').select('guild_id').eq('id', userId).single();
        if (playerError || !playerData || !playerData.guild_id){
          if (guildInfoContainer) guildInfoContainer.style.display='none';
          if (noGuildContainer) noGuildContainer.style.display='block';
          return;
        }
        userGuildId = playerData.guild_id;
      }

      // fetch guild with players
      const { data: guildData, error: guildError } = await supabase.from('guilds').select('*, players!players_guild_id_fkey(*)').eq('id', userGuildId).single();
      if (guildError || !guildData){
        console.error('Erro guildData', guildError);
        if (guildInfoContainer) guildInfoContainer.style.display='none';
        if (noGuildContainer) noGuildContainer.style.display='block';
        return;
      }

      currentGuildData = guildData;
      const me = (guildData.players || []).find(p => p.id === userId);
      userRank = me ? me.rank : 'member';

      const flagUrl = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
      if (guildNameElement) guildNameElement.innerHTML = `<img src="${flagUrl}" style="width:150px;height:140px;margin-right:8px;border-radius:6px;border:vertical-align:4px;"><br> <strong><span style="color: white;">${guildData.name}</span></strong>`;
      if (guildDescriptionEl) guildDescriptionEl.textContent = guildData.description || '';

      if (guildMemberListElement){
        guildMemberListElement.innerHTML = '';
        const roles = ['leader','co-leader','member'];
        const sorted = (guildData.players || []).slice().sort((a,b)=> roles.indexOf(a.rank) - roles.indexOf(b.rank));
        sorted.forEach(m => {
          const li = document.createElement('li');
          li.innerHTML = '<img src="' + (m.avatar_url||'https://aden-rpg.pages.dev/assets/guildaflag.webp') + '" style="width:38px;height:38px;border-radius:6px;margin-right:8px;"> <span>' + m.name + '</span> <small style="margin-left:8px;color:gold">' + traduzCargo(m.rank) + '</small>';
          guildMemberListElement.appendChild(li);
        });
      }

      if (guildInfoContainer) guildInfoContainer.style.display='block';
      if (noGuildContainer) noGuildContainer.style.display='none';
      // update displayed guild level and member counts
      try{
        const lvlEl = document.getElementById('guildLevelValue');
        const memberCountEl = document.getElementById('guildMemberCount');
        const memberCountHeader = document.getElementById('guildMemberCountHeader');
        const membersFromPlayers = (guildData.players && guildData.players.length) ? guildData.players.length : 0;
        if (lvlEl) lvlEl.textContent = (guildData.level !== undefined && guildData.level !== null) ? guildData.level : (guildData.level || '1');
        if (memberCountEl) memberCountEl.textContent = (guildData.members_count !== undefined && guildData.members_count !== null) ? guildData.members_count : membersFromPlayers;
        if (memberCountHeader) memberCountHeader.textContent = (guildData.members_count !== undefined && guildData.members_count !== null) ? guildData.members_count : membersFromPlayers;
      }catch(e){console.error('set guild counts', e)}


      if (editGuildBtn){
        if (guildData.leader_id === userId){
          editGuildBtn.style.display = 'inline-block';
          editGuildBtn.onclick = () => openEditGuildModal(guildData);
        } else {
          editGuildBtn.style.display = 'none';
        }
      }

      // check notifications
      if (editGuildBtn) checkGuildNotifications(guildData);

    } catch(e){
      console.error('Erro loadGuildInfo', e);
    }
  }

  // --- Modal open / logic ---
  async function openEditGuildModal(guildData){
    if (!editGuildModal) return;
    const isLeader = (guildData.leader_id === userId);
    const isCoLeader = ((guildData.players || []).find(p => p.id === userId) || {}).rank === 'co-leader';

    // control which edit tabs are visible
    $$('#editTabMenu .edit-tab-btn, #editTabs .edit-tab-btn').forEach(btn => {
      const tab = btn.dataset.tab;
      if (tab === 'tab-edit') btn.style.display = isLeader ? 'inline-block' : 'none';
      if (tab === 'tab-requests' || tab === 'tab-manage') btn.style.display = (isLeader || isCoLeader) ? 'inline-block' : 'none';
      if (tab === 'tab-notice' || tab === 'tab-chest') btn.style.display = 'inline-block';
    });

    // populate edit fields if leader
    if (isLeader){
      if (editGuildName) editGuildName.value = guildData.name || '';
      if (editGuildDescription) editGuildDescription.value = guildData.description || '';
      if (editGuildFlagUrl) editGuildFlagUrl.value = guildData.flag_url || '';
      if (editNameInfo) editNameInfo.textContent = '';
      if (guildData.last_name_change && editGuildName){
        const last = new Date(guildData.last_name_change);
        const diff = Date.now() - last.getTime();
        if (diff < 30*24*60*60*1000){
          const next = new Date(last.getTime() + 30*24*60*60*1000);
          editGuildName.disabled = true;
          editNameInfo.textContent = 'Nome só pode ser alterado novamente em ' + next.toLocaleDateString();
        } else {
          editGuildName.disabled = false;
        }
      }
    }

    // requests (leader or co-leader)
    if (isLeader || isCoLeader){
      if (guildRequestsList) guildRequestsList.innerHTML = '';
      try {
        const { data: requests, error } = await supabase.from('guild_join_requests').select('*').eq('guild_id', guildData.id).order('created_at', { ascending: true });
        if (error) throw error;
        if (!requests || requests.length === 0){
          if (guildRequestsList) guildRequestsList.innerHTML = '<li>Nenhuma solicitação pendente.</li>';
        } else {
          requests.forEach(r => {
            const li = document.createElement('li');
            li.style.display = 'flex'; li.style.justifyContent='space-between'; li.style.alignItems='center'; li.style.padding='6px 0';
            li.innerHTML = '<div><strong>' + (r.player_name || '') + '</strong><div style="font-size:0.9em;color:#666">' + (r.message || '') + '</div></div>';
            const actions = document.createElement('div');
            const acceptBtn = document.createElement('button'); acceptBtn.className = 'action-btn small'; acceptBtn.textContent = 'Aceitar';
            acceptBtn.onclick = () => acceptRequest(r.id);
            const rejectBtn = document.createElement('button'); rejectBtn.className = 'action-btn small danger'; rejectBtn.textContent = 'Rejeitar';
            rejectBtn.onclick = () => rejectRequest(r.id);
            actions.appendChild(acceptBtn); actions.appendChild(rejectBtn); li.appendChild(actions);
            guildRequestsList.appendChild(li);
          });
        }
      } catch(e){
        if (guildRequestsList) guildRequestsList.innerHTML = '<li>Erro ao carregar solicitações.</li>';
        console.error(e);
      }
    }

    // manage members
    if (manageMembersList) manageMembersList.innerHTML = '';
    const members = (guildData.players || []).slice().sort((a,b)=> a.rank === b.rank ? a.name.localeCompare(b.name) : (a.rank === 'leader' ? -1 : (b.rank === 'leader' ? 1 : (a.rank === 'co-leader' ? -1 : 1))));
    members.forEach(m => {
      if (!manageMembersList) return;
      const li = document.createElement('li');
      li.style.display='flex'; li.style.justifyContent='space-between'; li.style.alignItems='center'; li.style.padding='6px 0';
      li.innerHTML = '<div><strong>' + m.name + '</strong> <small style="margin-left:8px;color:#666">' + traduzCargo(m.rank) + '</small></div>';
      const actions = document.createElement('div');
      if (m.id !== userId){
        if (isLeader){
          if (m.rank === 'member'){
            const promBtn = document.createElement('button'); promBtn.className = 'action-btn small'; promBtn.textContent = 'Promover a Co-Líder';
            promBtn.onclick = () => promoteToCoLeader(m.id);
            actions.appendChild(promBtn);
          } else if (m.rank === 'co-leader'){
            const revokeBtn = document.createElement('button'); revokeBtn.className = 'action-btn small'; revokeBtn.textContent = 'Revogar Co-Líder';
            revokeBtn.onclick = () => revokeCoLeader(m.id);
            actions.appendChild(revokeBtn);
            const transferBtn = document.createElement('button'); transferBtn.className = 'action-btn small'; transferBtn.textContent = 'Transferir Liderança';
            transferBtn.onclick = () => transferLeadership(m.id);
            actions.appendChild(transferBtn);
          }
          const expelBtn = document.createElement('button'); expelBtn.className = 'action-btn small danger'; expelBtn.textContent = 'Expulsar';
          expelBtn.onclick = () => expelMember(m.id);
          actions.appendChild(expelBtn);
        } else if (isCoLeader && m.rank === 'member'){
          const expelBtn = document.createElement('button'); expelBtn.className = 'action-btn small danger'; expelBtn.textContent = 'Expulsar';
          expelBtn.onclick = () => expelMember(m.id);
          actions.appendChild(expelBtn);
        }
      } else {
        const meSpan = document.createElement('span'); meSpan.textContent = '(Você)'; actions.appendChild(meSpan);
      }
      li.appendChild(actions); manageMembersList.appendChild(li);
    });

    // notice & logs
    if (guildNoticeEl) guildNoticeEl.textContent = guildData.notice || '(Nenhum aviso)';
    if (noticeInfoEl) noticeInfoEl.textContent = guildData.last_notice_update ? 'Última atualização: ' + formatDateTime(guildData.last_notice_update) : 'Aviso ainda não atualizado.';
    if (noticeEditor) noticeEditor.style.display = (isLeader || isCoLeader) ? 'block' : 'none';
    if (noticeEditor && editGuildNotice) editGuildNotice.value = '';

    // logs
    if (guildLogsList) guildLogsList.innerHTML = '';
    try {
      const { data: logs, error } = await supabase.rpc('get_guild_logs', { p_guild_id: guildData.id, p_limit: 50 });
      if (error) throw error;
      if (!logs || logs.length === 0){
        if (guildLogsList) guildLogsList.innerHTML = '<li>Nenhum registro.</li>';
      } else {
        logs.forEach(l => {
          const li = document.createElement('li');
          let actor = l.actor_name || l.actor_id;
          let target = l.target_name || l.target_id;
          let text = '';

          if (l.action === 'promote') text = actor + ' promoveu ' + target + ' às ' + formatDateTime(l.created_at);
          else if (l.action === 'demote') text = actor + ' revogou ' + target + ' às ' + formatDateTime(l.created_at);
          else if (l.action === 'expel') text = actor + ' expulsou ' + target + ' às ' + formatDateTime(l.created_at);
          else if (l.action === 'join') text = target + ' entrou na guilda às ' + formatDateTime(l.created_at);
          else if (l.action === 'leave') text = target + ' saiu da guilda às ' + formatDateTime(l.created_at);
          else if (l.action === 'reject') text = actor + ' rejeitou ' + target + ' às ' + formatDateTime(l.created_at);
          else if (l.action === 'notice') text = 'Aviso atualizado por ' + actor + ' às ' + formatDateTime(l.created_at) + ': ' + (l.message || '');
          else text = (l.action || '') + ' - ' + (l.message || '') + ' @ ' + formatDateTime(l.created_at);

          li.textContent = text;
          guildLogsList.appendChild(li);
        });
      }
    } catch(e){
      if (guildLogsList) guildLogsList.innerHTML = '<li>Erro ao carregar registros.</li>';
      console.error(e);
    }

    // show modal and set default tab based on role
    editGuildModal.style.display = 'flex';
    let defaultTab = 'tab-notice';
    if (isLeader) defaultTab = 'tab-edit';
    else if (isCoLeader) defaultTab = 'tab-manage';
    activateEditTab(defaultTab);
  }

  // --- Actions: promote/revoke/transfer/expel/accept/reject ---
  async function promoteToCoLeader(targetId){
    try {
      const { error } = await supabase.rpc('promote_to_co_leader', { p_guild_id: userGuildId, p_requester_id: userId, p_target_id: targetId });
      if (error) throw error;
      await supabase.rpc('log_guild_action', { p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action: 'promote', p_message: null });
      alert('Promovido');
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){ alert('Erro ao promover: ' + (e.message || e)); console.error(e); }
  }

  async function revokeCoLeader(targetId){
    try {
      const { error } = await supabase.from('players').update({ rank: 'member' }).eq('id', targetId);
      if (error) throw error;
      await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action:'demote', p_message:null });
      alert('Revogado');
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){ alert('Erro ao revogar: ' + (e.message || e)); console.error(e); }
  }

  async function transferLeadership(targetId){
    try {
      const { error } = await supabase.rpc('transfer_leadership', { p_guild_id: userGuildId, p_old_leader_id: userId, p_new_leader_id: targetId });
      if (error) throw error;
      await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action:'promote', p_message:'transferred_leadership' });
      alert('Transferida');
      await loadGuildInfo();
      editGuildModal.style.display = 'none';
    } catch(e){ alert('Erro: ' + (e.message || e)); console.error(e); }
  }

  async function expelMember(targetId){
    if (!confirm('Confirmar expulsão?')) return;
    try {
      const { error } = await supabase.rpc('expel_member', { p_guild_id: userGuildId, p_requester_id: userId, p_member_id: targetId });
      if (error) throw error;
      await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action:'expel', p_message:null });
      alert('Expulso');
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){ alert('Erro ao expulsar: ' + (e.message || e)); console.error(e); }
  }

  async function acceptRequest(requestId){
    try {
      // fetch the request to obtain the player id for logging
      const { data: req, error: reqErr } = await supabase.from('guild_join_requests').select('player_id').eq('id', requestId).single();
      if (reqErr) throw reqErr;
      if (!req) throw new Error('Solicitação não encontrada');

      const { error } = await supabase.rpc('accept_guild_join_request', { p_guild_id: userGuildId, p_request_id: requestId, p_requester_id: userId });
      if (error) throw error;

      // log with the actual target player id (fixes "Null entrou na guilda")
      await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: req.player_id, p_action: 'join', p_message: null });

      alert('Aceito');
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){ alert('Erro ao aceitar: ' + (e.message || e)); console.error(e); }
  }

  async function rejectRequest(requestId){
    try {
      const { error } = await supabase.rpc('reject_guild_join_request', { p_request_id: requestId, p_requester_id: userId });
      if (error) throw error;
      await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: null, p_action: 'reject', p_message: requestId });
      alert('Rejeitado');
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){ alert('Erro ao rejeitar: ' + (e.message || e)); console.error(e); }
  }

  // --- Save guild changes & notice handlers ---
  if (saveGuildChangesBtn){
    saveGuildChangesBtn.addEventListener('click', async () => {
      try {
        const newName = editGuildName ? editGuildName.value.trim() : null;
        const newDesc = editGuildDescription ? editGuildDescription.value.trim() : null;
        const newFlag = editGuildFlagUrl ? editGuildFlagUrl.value.trim() : null;
        const { error } = await supabase.rpc('update_guild_info', { p_guild_id: userGuildId, p_player_id: userId, p_name: newName, p_description: newDesc, p_flag_url: newFlag });
        if (error) throw error;
        alert('Guilda atualizada');
        await loadGuildInfo();
        editGuildModal.style.display = 'none';
      } catch(e){ alert('Erro: ' + (e.message || e)); console.error(e); }
    });
  }

  if (saveGuildNoticeBtn){
    saveGuildNoticeBtn.addEventListener('click', async () => {
      try {
        const notice = editGuildNotice ? editGuildNotice.value.trim() : '';
        const { error } = await supabase.rpc('update_guild_notice', { p_guild_id: userGuildId, p_player_id: userId, p_notice: notice });
        if (error) throw error;
        alert('Aviso atualizado');
        await loadGuildInfo();
        openEditGuildModal(currentGuildData);
      } catch(e){ alert('Erro ao atualizar aviso: ' + (e.message || e)); console.error(e); }
    });
  }

  // --- Search modal handlers ---
  if (searchGuildBtn && searchGuildModal){
    searchGuildBtn.addEventListener('click', ()=>{ searchGuildModal.style.display = 'flex'; if (searchGuildResults) searchGuildResults.innerHTML = ''; if (searchGuildInput) searchGuildInput.value = ''; });
  }
  if (searchCloseBtn) searchCloseBtn.addEventListener('click', ()=> searchGuildModal.style.display = 'none');

  if (searchGuildConfirmBtn){
    searchGuildConfirmBtn.addEventListener('click', async ()=>{
      if (!searchGuildInput) return;
      const q = searchGuildInput.value.trim();
      if (!q){ alert('Digite um nome para buscar.'); return; }
      try {
        let { data, error } = await supabase.rpc('search_guilds', { p_query: q, p_limit: 20 });
        if (error || !data || data.length === 0){
          const res = await supabase.from('guilds').select('id,name,description,flag_url,members_count,max_members').ilike('name', `%${q}%`).order('members_count', { ascending: false }).limit(20);
          if (res.error) throw res.error;
          data = res.data;
        }
        if (!data || data.length === 0){
          if (searchGuildResults) searchGuildResults.innerHTML = '<li>Nenhuma guilda encontrada.</li>';
          return;
        }
        if (searchGuildResults) searchGuildResults.innerHTML = '';
        data.forEach(g => {
          const li = document.createElement('li');
          li.style.display = 'flex'; li.style.justifyContent='space-between'; li.style.alignItems='center'; li.style.padding='8px 0';
          li.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><img src="' + (g.flag_url||'/assets/default_guild_flag.png') + '" style="width:100px;height:100px;border-radius:4px;"><div><br><strong>' + g.name + '</strong><div style="font-size:0.9em;color:white;">' + (g.description||'') + '</div><div style="font-size:0.85em; color: white;">Membros: ' + (g.members_count||0) + '/' + (g.max_members||0) + '</div></div></div>';
          const btn = document.createElement('button'); btn.className = 'action-btn small'; btn.textContent = 'Solicitar Entrada';
          btn.onclick = () => requestJoinGuild(g.id, g.name);
          li.appendChild(btn);
          searchGuildResults.appendChild(li);
        });
      } catch(e){ console.error('Erro search', e); if (searchGuildResults) searchGuildResults.innerHTML = '<li>Erro ao buscar guildas.</li>'; }
    });
  }

  window.requestJoinGuild = async function(guildId, guildName){
    try {
      const message = prompt('Mensagem para a guilda ' + guildName + ' (opcional):') || '';
      const { error } = await supabase.rpc('create_guild_join_request', { p_guild_id: guildId, p_player_id: userId, p_message: message });
      if (error) throw error;
      alert('Solicitação enviada');
      if (searchGuildModal) searchGuildModal.style.display = 'none';
    } catch(e){ alert('Erro ao enviar solicitação: ' + (e.message || e)); console.error(e); }
  };

  // close modal handlers (edit & create & search)
  if (editCloseBtn) editCloseBtn.addEventListener('click', ()=>{ if (editGuildModal) editGuildModal.style.display = 'none'; });
  window.addEventListener('click', (ev) => {
    if (ev.target === editGuildModal) editGuildModal.style.display = 'none';
    if (ev.target === searchGuildModal) searchGuildModal.style.display = 'none';
    if (ev.target === createGuildModal) createGuildModal.style.display = 'none';
  });

  // create guild simple handlers
  if (createGuildBtn && createGuildModal) createGuildBtn.addEventListener('click', ()=> createGuildModal.style.display = 'flex');
  if (confirmCreateGuildBtn){
    confirmCreateGuildBtn.addEventListener('click', async ()=>{
      if (!newGuildNameInput) return;
      const g = newGuildNameInput.value.trim();
      if (!g){ if (createGuildMessage) createGuildMessage.textContent = 'Nome vazio'; return; }
      try {
        const { data, error } = await supabase.rpc('create_guild_for_player', { p_guild_name: g, p_player_id: userId });
        if (error) throw error;
        if (data && data.length > 0) userGuildId = data[0].created_guild_id;
        if (createGuildMessage) createGuildMessage.textContent = 'Guilda criada';
        setTimeout(()=>{ createGuildModal.style.display = 'none'; loadGuildInfo(); }, 800);
      } catch(e){ if (createGuildMessage) createGuildMessage.textContent = 'Erro: ' + (e.message || e); console.error(e); }
    });
  }

  // refresh button
  if (refreshBtn) refreshBtn.addEventListener('click', ()=> loadGuildInfo());

  // initial load
  const ok = await getUserSession();
  if (ok) await loadGuildInfo();

}); // end DOMContentLoaded


// PUBLIC helpers (used by some inline handlers)
function updateGuildNotifications(show) {
    try {
        const editGuildBtn = document.getElementById('editGuildBtn');
        if (!editGuildBtn) return;

        if (show) {
            const next = editGuildBtn.nextElementSibling;
            if (!next || !next.classList || !next.classList.contains('notif-dot-main')) {
                editGuildBtn.insertAdjacentHTML('afterend', '<span class="notif-dot-main"></span>');
            }
        } else {
            if (editGuildBtn.nextElementSibling && editGuildBtn.nextElementSibling.classList && editGuildBtn.nextElementSibling.classList.contains('notif-dot-main')) {
                editGuildBtn.nextElementSibling.remove();
            }
        }
    } catch (e) {
        console.error('Erro ao atualizar notificação', e);
    }
}

// alternative global function in case page uses a different selector for tabs
function markTabNotificationGlobal(tabId, show){
  try {
    const tabBtn = document.querySelector(`#editTabMenu .edit-tab-btn[data-tab="${tabId}"]`);
    if (!tabBtn) return;
    let dot = tabBtn.querySelector('.notif-dot');
    if (show){
      if (!dot) tabBtn.insertAdjacentHTML('beforeend', '<span class="notif-dot"></span>');
    } else {
      if (dot) dot.remove();
    }
  } catch(e){ console.error(e); }
}

// Reset notifications when player opens requests or notices (legacy buttons)
document.getElementById('guildRequestsBtn')?.addEventListener('click', () => {
    updateGuildNotifications(false);
});
document.getElementById('guildNoticeBtn')?.addEventListener('click', () => {
    updateGuildNotifications(false);
});
