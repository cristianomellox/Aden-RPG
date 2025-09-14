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
  const guildPowerEl = $('#guildPower');
  const guildRankingList = $('#guildRankingList');
  
  // Novas referências DOM para o modal de visualização de guilda
  const viewGuildModal = $('#viewGuildModal');
  const viewGuildCloseBtn = $('#viewGuildCloseBtn');
  const guildViewContainer = $('#guildViewContainer');
  const guildViewName = $('#guildViewName');
  const guildViewPower = $('#guildViewPower');
  const guildViewDescription = $('#guildViewDescription');
  const guildViewLevelValue = $('#guildViewLevelValue');
  const guildViewMemberCountHeader = $('#guildViewMemberCountHeader');
  const guildViewMemberList = $('#guildViewMemberList');
  const viewJoinGuildBtn = $('#viewJoinGuildBtn');

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
      // se abrir aba ranking, carregue o ranking
      if (tab === 'ranking') {
        loadGuildRanking();
      }
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

  function formatNumberCompact(num) {
    if (num < 1000) return num;
    const units = ['', 'K', 'M', 'B', 'T'];
    const unitIndex = Math.floor(Math.log10(num) / 3);
    const compactValue = (num / Math.pow(1000, unitIndex)).toFixed(1);
    return compactValue + units[unitIndex];
  }

  async function checkGuildNotifications(guildData){
    if (!editGuildBtn) return;
    let hasRequests = false, hasNotice = false;
    
    const readRequests = localStorage.getItem(`guild_${guildData.id}_tab-requests_read`);
    const readNotice = localStorage.getItem(`guild_${guildData.id}_tab-notice_read`);

    // Check for new notices
    if (guildData.last_notice_update) {
        const lastNoticeUpdate = new Date(guildData.last_notice_update).getTime();
        const lastReadNotice = readNotice ? parseInt(readNotice, 10) : 0;
        if (lastNoticeUpdate > lastReadNotice) {
            hasNotice = true;
        }
    }

    // Check for new requests
    try {
        const { data: mostRecentRequest, error } = await supabase.from('guild_join_requests')
            .select('created_at')
            .eq('guild_id', guildData.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!error && mostRecentRequest) {
            const lastRequestDate = new Date(mostRecentRequest.created_at).getTime();
            const lastReadRequests = readRequests ? parseInt(readRequests, 10) : 0;
            if (lastRequestDate > lastReadRequests) {
                hasRequests = true;
            }
        }
    } catch(e) {
        console.error('Erro ao checar solicitações recentes', e);
    }
    
    markTabNotification('tab-requests', hasRequests);
    markTabNotification('tab-notice', hasNotice);
    updateGuildNotifications(hasRequests || hasNotice);
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
    // 🔹 verifica se é líder para mostrar/ocultar o botão deletar guilda
    const deleteGuildBtn = document.getElementById('deleteguild');
    if (deleteGuildBtn) {
      if (guildData.leader_id === userId) {
        deleteGuildBtn.style.display = 'block';
      } else {
        deleteGuildBtn.style.display = 'none';
      }
    }

      
      // Update XP bar here
      try{ if (typeof updateGuildXpBar==='function') updateGuildXpBar(currentGuildData); }catch(e){ console.error('updateGuildXpBar call failed', e); }
      
      const me = (guildData.players || []).find(p => p.id === userId);
      userRank = me ? me.rank : 'member';

      const flagUrl = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
      if (guildNameElement) guildNameElement.innerHTML = `<img src="${flagUrl}" style="width:140px;height:140px;margin-right:8px;border-radius:6px;border:vertical-align:4px; margin-left: 18px;"><br> <strong><span style="color: white;">${guildData.name}</span></strong>`;
      if (guildDescriptionEl) guildDescriptionEl.textContent = guildData.description || '';

      // Novo: Calcular poder total da guilda via RPC (inclui equipamentos equipados)
      let guildPowerValue = null;
      try {
        const { data: powerData, error: powerError } = await supabase.rpc('get_guild_power', { p_guild_id: userGuildId });
        if (!powerError && powerData) {
          // supabase pode retornar array de rows ou objeto/valor direto
          if (Array.isArray(powerData) && powerData.length > 0 && powerData[0].total_power !== undefined) {
            guildPowerValue = Number(powerData[0].total_power);
          } else if (powerData.total_power !== undefined) {
            guildPowerValue = Number(powerData.total_power);
          } else if (typeof powerData === 'number' || typeof powerData === 'string') {
            guildPowerValue = Number(powerData);
          }
        }
      } catch(e){
        console.error('Erro ao chamar get_guild_power RPC', e);
      }

      // fallback: caso RPC não exista ou falhe, soma o campo combat_power (menos preciso)
      if (guildPowerValue === null) {
        try {
          guildPowerValue = (guildData.players || []).reduce((sum, p) => sum + (Number(p.combat_power) || 0), 0);
        } catch(e){ guildPowerValue = 0; }
      }

      // Aplica a formatação compacta ao valor do poder de combate na tela inicial
      const compactPower = formatNumberCompact(guildPowerValue);
      if (guildPowerEl) guildPowerEl.textContent = ` ${compactPower}`;

      if (guildMemberListElement){
        guildMemberListElement.innerHTML = '';
        const roles = ['leader','co-leader','member'];
        const sorted = (guildData.players || []).slice().sort((a,b)=> roles.indexOf(a.rank) - roles.indexOf(b.rank));
        sorted.forEach(m => {
          const li = document.createElement('li');
          li.innerHTML = `
  <img src="${m.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" 
       style="width:38px;height:38px;border-radius:6px;margin-right:8px;">
  <span>${m.name}</span> 
  <small style="margin-left:8px;color:lightblue">Nv. ${m.level || 1}</small>
  <small style="margin-left:8px;color:gold">${traduzCargo(m.rank)}</small>
`;
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
        if (memberCountHeader) {
  const currentMembers = (guildData.members_count !== undefined && guildData.members_count !== null) 
      ? guildData.members_count 
      : membersFromPlayers;
  const maxMembers = guildData.max_members || getMaxMembers(guildData.level || 1);
  memberCountHeader.textContent = `${currentMembers} / ${maxMembers}`;
}
      }catch(e){console.error('set guild counts', e)}


      if (editGuildBtn){
  editGuildBtn.style.display = 'inline-block';
  editGuildBtn.onclick = () => openEditGuildModal(guildData);
}


      // check notifications
      if (editGuildBtn) checkGuildNotifications(guildData);

    } catch(e){
      console.error('Erro loadGuildInfo', e);
    }
  }
  
  // Função para buscar e exibir os dados da guilda em um modal
  async function fetchAndDisplayGuildInfo(guildId) {
    if (!viewGuildModal) return;
    try {
        // Busca dados da guilda e membros
        const { data: guildData, error: guildError } = await supabase
            .from('guilds')
            .select('*, players!players_guild_id_fkey(*)')
            .eq('id', guildId)
            .single();

        if (guildError || !guildData) {
            console.error('Erro ao buscar dados da guilda', guildError);
            return;
        }

        // Popula o modal com as informações da guilda
        const flagUrl = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
        guildViewName.innerHTML = `<img src="${flagUrl}" style="width:140px;height:140px;margin-right:8px;border-radius:6px;border:vertical-align:4px; margin-left: 18px;"><br> <strong><span style="color: white;">${guildData.name}</span></strong>`;
        guildViewDescription.textContent = guildData.description || '';
        guildViewLevelValue.textContent = guildData.level || 1;
        guildViewMemberCountHeader.textContent = `${(guildData.players || []).length} / ${guildData.max_members || getMaxMembers(guildData.level || 1)}`;
        
        // --- NOVO: RECALCULA O PODER DA GUILDA USANDO O RPC ---
        let guildPowerValue = null;
        try {
          const { data: powerData, error: powerError } = await supabase.rpc('get_guild_power', { p_guild_id: guildId });
          if (!powerError && powerData) {
            if (Array.isArray(powerData) && powerData.length > 0 && powerData[0].total_power !== undefined) {
              guildPowerValue = Number(powerData[0].total_power);
            } else if (powerData.total_power !== undefined) {
              guildPowerValue = Number(powerData.total_power);
            } else if (typeof powerData === 'number' || typeof powerData === 'string') {
              guildPowerValue = Number(powerData);
            }
          }
        } catch(e){
          console.error('Erro ao chamar get_guild_power RPC para o modal', e);
        }

        // Fallback: se o RPC falhar, usa a soma do combat_power (menos preciso)
        if (guildPowerValue === null) {
          try {
            guildPowerValue = (guildData.players || []).reduce((sum, p) => sum + (Number(p.combat_power) || 0), 0);
          } catch(e){ guildPowerValue = 0; }
        }

        const compactPower = formatNumberCompact(guildPowerValue);
        guildViewPower.textContent = compactPower;

        // Lista de membros
        guildViewMemberList.innerHTML = '';
        const roles = ['leader', 'co-leader', 'member'];
        const sorted = (guildData.players || []).slice().sort((a, b) => roles.indexOf(a.rank) - roles.indexOf(b.rank));
        sorted.forEach(m => {
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${m.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" 
                     style="width:38px;height:38px;border-radius:6px;margin-right:8px;">
                <span>${m.name}</span> 
                <small style="margin-left:8px;color:lightblue">Nv. ${m.level || 1}</small>
                <small style="margin-left:8px;color:gold">${traduzCargo(m.rank)}</small>
            `;
            guildViewMemberList.appendChild(li);
        });

        // Exibe o modal
        viewGuildModal.style.display = 'flex';
    } catch (e) {
        console.error('Erro ao exibir modal da guilda', e);
    }
  }


  // --- Carregar Ranking ---
  async function loadGuildRanking(){
    try {
      const { data, error } = await supabase.rpc('get_guilds_ranking', { limit_count: 100 });
      if (error) throw error;

      const listEl = document.getElementById('guildRankingList');
      if (listEl){
        listEl.innerHTML = '';
        data.forEach((g, idx)=>{
          // AVISO: Se a guilda não tem um ID válido, o problema está na função do banco de dados (RPC).
          if (!g.guild_id) {
            console.error('AVISO: Guilda com ID inválido encontrada. O registro não será clicável. Por favor, verifique a função `get_guilds_ranking` no seu Supabase.', g);
          }
          
          const power = Number(g.total_power || 0);
          const compactPower = formatNumberCompact(power);
          const li = document.createElement('li');
          
          li.className = 'ranking-item-clickable';
          if (g.guild_id) {
              li.dataset.guildId = g.guild_id;
          }
          
          li.innerHTML = `
            <div class="ranking-item-content">
                <span class="ranking-position">${idx+1}º</span>
                <img src="${g.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" 
                     class="ranking-flag">
                <div class="ranking-info">
                    <strong class="ranking-name">${g.name}</strong>
                    <div class="ranking-power">
                        <img alt="poder" class="cp-icon" style="margin-top: -5px;" src="https://aden-rpg.pages.dev/assets/CPicon.webp"/>
                        <span class="power-value">${compactPower}</span>
                    </div>
                </div>
            </div>`;
          
          // 🔹 Estilos especiais para o Top 3
          if (idx === 0) {
            li.style.background = "linear-gradient(180deg, rgba(255,215,0,0.5), rgba(255,215,0,0.1))"; // dourado
          } else if (idx === 1) {
            li.style.background = "linear-gradient(180deg, rgba(192,192,192,0.6), rgba(169,169,169,0.1))"; // prata
          } else if (idx === 2) {
            li.style.background = "linear-gradient(180deg, rgba(205,127,50,0.4), rgba(210,180,40,0.1))"; // bronze
          }
          listEl.appendChild(li);
        });

      // Adicione o event listener após a lista ser carregada
      listEl.addEventListener('click', (ev) => {
          const item = ev.target.closest('li');
          if (item && item.dataset.guildId) {
              fetchAndDisplayGuildInfo(item.dataset.guildId);
          }
      });
      }
    } catch(e){
      console.error('Erro ao carregar ranking', e);
      if (guildRankingList) guildRankingList.innerHTML = '<li>Erro ao carregar ranking.</li>';
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
            li.className = 'request-item';
            li.innerHTML = '<div class="request-info"><strong>' + (r.player_name || '') + '</strong><div class="request-message">' + (r.message || '') + '</div></div>';
            const actions = document.createElement('div');
            actions.className = 'request-actions';
            const acceptImg = document.createElement('img');
            acceptImg.src = "https://aden-rpg.pages.dev/assets/aceitar.webp";
            acceptImg.alt = "Aceitar";
            acceptImg.onclick = () => acceptRequest(r.id);

            const rejectImg = document.createElement('img');
            rejectImg.src = "https://aden-rpg.pages.dev/assets/recusar.webp";
            rejectImg.alt = "Recusar";
            rejectImg.onclick = () => rejectRequest(r.id);

            actions.appendChild(acceptImg);
            actions.appendChild(rejectImg);
            li.appendChild(actions);
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
      li.innerHTML = '<div class="member-info"><strong>' + m.name + '</strong> <small class="member-rank">' + traduzCargo(m.rank) + '</small></div>';
      const actions = document.createElement('div');
      actions.className = 'member-actions';
      if (m.id !== userId){
        if (isLeader){
          if (m.rank === 'member'){
            const promImg = document.createElement('img');
            promImg.src = "https://aden-rpg.pages.dev/assets/promover.webp";
            promImg.alt = "Promover";
            promImg.onclick = () => promoteToCoLeader(m.id, m.name);
            actions.appendChild(promImg);
          } else if (m.rank === 'co-leader'){
            const revokeImg = document.createElement('img');
            revokeImg.src = "https://aden-rpg.pages.dev/assets/rebaixar.webp";
            revokeImg.alt = "Revogar";
            revokeImg.onclick = () => revokeCoLeader(m.id, m.name);

            const transferImg = document.createElement('img');
            transferImg.src = "https://aden-rpg.pages.dev/assets/transferlider.webp";
            transferImg.alt = "Transferir";
            transferImg.onclick = () => transferLeadership(m.id, m.name);

            actions.appendChild(revokeImg);
            actions.appendChild(transferImg);
          }
          const expelImg = document.createElement('img');
          expelImg.src = "https://aden-rpg.pages.dev/assets/expulsar.webp";
          expelImg.alt = "Expulsar";
          expelImg.onclick = () => expelMember(m.id);
          actions.appendChild(expelImg);
        } else if (isCoLeader && m.rank === 'member'){
          const expelImg = document.createElement('img');
          expelImg.src = "https://aden-rpg.pages.dev/assets/expulsar.webp";
          expelImg.alt = "Expulsar";
          expelImg.onclick = () => expelMember(m.id);
          actions.appendChild(expelImg);
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
  async function promoteToCoLeader(targetId, targetName){
    if (!confirm(`Tem certeza que deseja promover ${targetName} para co-líder?`)) return;
    try {
      const { error } = await supabase.rpc('promote_to_co_leader', { p_guild_id: userGuildId, p_requester_id: userId, p_target_id: targetId });
      if (error) throw error;
      await supabase.rpc('log_guild_action', { p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action: 'promote', p_message: null });
      alert('Promovido');
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){ alert('Erro ao promover: ' + (e.message || e)); console.error(e); }
  }

  async function revokeCoLeader(targetId, targetName){
    if (!confirm(`Tem certeza que deseja revogar co-líder de ${targetName}?`)) return;
    try {
      const { error } = await supabase.rpc('revoke_co_leader', { p_guild_id: userGuildId, p_requester_id: userId, p_target_id: targetId });
      if (error) throw error;
      await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action:'demote', p_message:null });
      alert('Revogado');
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){ alert('Erro ao revogar: ' + (e.message || e)); console.error(e); }
  }

  async function transferLeadership(targetId, targetName){
    if (!confirm(`Tem certeza que deseja transferir a liderança da guilda para ${targetName}? Esta ação é irreversível!`)) return;
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
      const { data: req, error: reqErr } = await supabase
        .from('guild_join_requests')
        .select('player_id')
        .eq('id', requestId)
        .single();
      if (reqErr) throw reqErr;
      if (!req) throw new Error('Solicitação não encontrada');

      // chama RPC
      const { error } = await supabase.rpc('accept_guild_join_request', {
        p_guild_id: userGuildId,
        p_request_id: requestId,
        p_requester_id: userId
      });
      if (error) throw error;

      // checa se o jogador realmente entrou na guilda
      const { data: target } = await supabase
        .from('players')
        .select('guild_id')
        .eq('id', req.player_id)
        .single();

      if (target && target.guild_id === userGuildId) {
        // entrou de verdade
        await supabase.rpc('log_guild_action',{
          p_guild_id: userGuildId,
          p_actor_id: userId,
          p_target_id: req.player_id,
          p_action: 'join',
          p_message: null
        });
        alert('Solicitação aceita');
      } else {
        // foi apenas excluída → registrar como rejeição
        await supabase.rpc('log_guild_action',{
          p_guild_id: userGuildId,
          p_actor_id: userId,
          p_target_id: req.player_id,
          p_action: 'reject',
          p_message: 'Removida automaticamente (jogador já tinha guilda ou não existe).'
        });
        alert('Solicitação removida (jogador já está em outra guilda ou não existe).');
      }

      await loadGuildInfo();
      openEditGuildModal(currentGuildData);

    } catch(e){
      alert('Erro ao aceitar: ' + (e.message || e));
      console.error(e);
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    }
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
          // Adicione o atributo de ID e a classe clicável
          li.className = 'search-item-clickable';
          if (g.id) {
            li.dataset.guildId = g.id;
          } else {
            console.error('Guilda inválida encontrada nos resultados de busca:', g);
            return;
          }
          li.innerHTML = '<div style="display:flex;align-items:center;text-align: left;gap:8px;"><img src="' + (g.flag_url||'https://aden-rpg.pages.dev/assets/guildaflag.webp') + '" style="width:100px;height:100px;border-radius:4px;"><div><br><strong>' + g.name + '</strong><div style="font-size:0.9em;color:white;">' + (g.description||'') + '</div><div style="font-size:0.85em; color: white;">Membros: ' + (g.members_count||0) + '/' + (g.max_members||0) + '</div></div></div>';
          
          const btnImg = document.createElement('img');
          btnImg.src = "https://aden-rpg.pages.dev/assets/aceitar.webp";
          btnImg.alt = "Solicitar Entrada";
          btnImg.style.cssText = "width: 30px; height: 30px; vertical-align: -1px; margin-left: 5px; cursor: pointer;";
          btnImg.onclick = () => requestJoinGuild(g.id, g.name);

          li.appendChild(btnImg);
          searchGuildResults.appendChild(li);
        });
      } catch(e){ console.error('Erro search', e); if (searchGuildResults) searchGuildResults.innerHTML = '<li>Erro ao buscar guildas.</li>'; }
    });
  }
  
  // Adicione o event listener para os resultados de busca
  if (searchGuildResults) {
    searchGuildResults.addEventListener('click', (ev) => {
        const item = ev.target.closest('li');
        if (item && item.dataset.guildId) {
            // Esconde o modal de busca
            searchGuildModal.style.display = 'none';
            // Abre o modal de visualização da guilda
            fetchAndDisplayGuildInfo(item.dataset.guildId);
        }
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

  // close modal handlers (edit & create & search & view)
  if (editCloseBtn) editCloseBtn.addEventListener('click', ()=>{ if (editGuildModal) editGuildModal.style.display = 'none'; });
  if (viewGuildCloseBtn) viewGuildCloseBtn.addEventListener('click', () => { viewGuildModal.style.display = 'none'; });
  window.addEventListener('click', (ev) => {
    if (ev.target === editGuildModal) editGuildModal.style.display = 'none';
    if (ev.target === searchGuildModal) searchGuildModal.style.display = 'none';
    if (ev.target === createGuildModal) createGuildModal.style.display = 'none';
    if (ev.target === viewGuildModal) viewGuildModal.style.display = 'none';
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


  // --- Botões: Deletar / Sair da guilda ---
  const deleteGuildBtn = document.getElementById('deleteguild');
  const leaveGuildBtn = document.getElementById('leaveguild');

  // Deletar guilda (apenas líder)
  if (deleteGuildBtn) {
    deleteGuildBtn.addEventListener('click', async (ev) => {
      ev?.preventDefault();
      if (!userGuildId) {
        alert('Erro: guilda não encontrada no contexto. Recarregue a página.');
        return;
      }
      if (!confirm("Tem certeza que deseja deletar a guilda? Esta ação é irreversível. Todos os dados da guilda serão excluídos! Você só poderá entrar em outra guilda após 24 horas.")) return;
      try {
        const res = await supabase.rpc('delete_guild', { p_guild_id: userGuildId, p_player_id: userId });
        if (res?.error) throw res.error;
        alert('Guilda deletada.');
        userGuildId = null;
        await loadGuildInfo();
      } catch(e) { alert('Erro: ' + (e.message || e)); console.error(e); }
    });
  }

  // Sair da guilda (membros, exceto líder)
  if (leaveGuildBtn) {
    leaveGuildBtn.addEventListener('click', async (ev) => {
      ev?.preventDefault();
      if (!confirm("Tem certeza que você quer sair da guilda? Esta ação é irreversível. Você só poderá entrar em outra guilda após 24 horas.")) return;
      try {
        const res = await supabase.rpc('leave_guild', { p_player_id: userId });
        if (res?.error) throw res.error;
        alert('Você saiu da guilda.');
        userGuildId = null;
        await loadGuildInfo();
      } catch(e) { alert('Erro: ' + (e.message || e)); console.error(e); }
    });
  }


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

// --- Guild Level System ---
function calculateGuildXpNeeded(level){
  return Math.floor(300 * Math.pow(level, 1.5));
}

function getMaxCoLeaders(level){
  if (level >= 8) return 3;
  if (level >= 5) return 2;
  return 1;
}

function getMaxMembers(level){
  return 10 + (level - 1) * 2;
}

// Atualizar barra de XP dinamicamente
function updateGuildXpBar(guildData){
  try {
    const xpFill = document.querySelector('.xp-bar-fill'); // barra verde
    const xpText = document.getElementById('guildXpFill'); // texto centralizado
    if (!xpFill || !xpText) return;

    const currentXp = Number((guildData && guildData.experience) ? guildData.experience : 0);
    const currentLevel = Number((guildData && guildData.level) ? guildData.level : 1);
    const neededXp = (typeof calculateGuildXpNeeded === 'function') 
        ? calculateGuildXpNeeded(currentLevel) 
        : Math.floor(300 * Math.pow(currentLevel, 1.5));

    const percent = (neededXp > 0 && !isNaN(neededXp)) 
        ? Math.max(0, Math.min(100, Math.floor((currentXp / neededXp) * 100))) 
        : 0;

    // Atualiza a largura da barra verde
    xpFill.style.width = percent + '%';

    // Atualiza o texto centralizado
    xpText.textContent = currentXp + ' / ' + neededXp;
    xpText.setAttribute('aria-valuenow', currentXp);
    xpText.setAttribute('aria-valuemax', neededXp);
  } catch(e){ 
    console.error('updateGuildXpBar error', e); 
  }
}