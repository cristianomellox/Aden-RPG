document.addEventListener("DOMContentLoaded", async () => {
  // --- Inicialização Supabase ---
  const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
  const supabase = window.supabase && window.supabase.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  if (!supabase) {
    console.error("Supabase não inicializado. Verifique se o script do supabase foi carregado.");
    return;
  }

  // --- Estado ---
  let userId = null;
  let userGuildId = null;
  let currentGuildData = null;

  // --- Elementos do DOM (com checagens) ---
  const tabButtons = document.querySelectorAll('#tabMenu .tab-btn') || [];
  const tabPanes = document.querySelectorAll('#tabContent .tab-pane') || [];
  const guildInfoContainer = document.getElementById('guildInfoContainer');
  const noGuildContainer = document.getElementById('noGuildContainer');
  const guildNameElement = document.getElementById('guildName');
  const guildMemberCountElement = document.getElementById('guildMemberCount');
  const guildLevelValueElement = document.getElementById('guildLevelValue');
  const guildXpFillElement = document.getElementById('guildXpFill');
  const guildMemberListElement = document.getElementById('guildMemberList');
  const guildRankingListElement = document.getElementById('guildRankingList');
  const refreshBtn = document.getElementById('refreshBtn');

  // Edit modal elements (podem ser nulos se o HTML não tiver)
  const editGuildBtn = document.getElementById('editGuildBtn');
  const editGuildModal = document.getElementById('editGuildModal');
  const editCloseBtn = editGuildModal ? editGuildModal.querySelector('.close-btn') : null;
  const editGuildName = document.getElementById('editGuildName');
  const editGuildDescription = document.getElementById('editGuildDescription');
  const editGuildFlagUrl = document.getElementById('editGuildFlagUrl');
  const saveGuildChangesBtn = document.getElementById('saveGuildChangesBtn');
  const editNameInfo = document.getElementById('editNameInfo');
  const manageMembersList = document.getElementById('manageMembersList');
  const guildRequestsList = document.getElementById('guildRequestsList');

  // Create modal elements
  const createGuildBtn = document.getElementById('createGuildBtn');
  const createGuildModal = document.getElementById('createGuildModal');
  const closeGuildModalBtn = createGuildModal ? createGuildModal.querySelector('.close-btn') : null;
  const newGuildNameInput = document.getElementById('newGuildNameInput');
  const confirmCreateGuildBtn = document.getElementById('confirmCreateGuildBtn');
  const createGuildMessage = document.getElementById('createGuildMessage');

  // Search modal elements
  const searchGuildBtn = document.getElementById('searchGuildBtn');
  const searchGuildModal = document.getElementById('searchGuildModal');
  const searchGuildCloseBtn = searchGuildModal ? searchGuildModal.querySelector('.close-btn') : null;
  const searchGuildInput = document.getElementById('searchGuildInput');
  const searchGuildConfirmBtn = document.getElementById('searchGuildConfirmBtn');
  const searchGuildResults = document.getElementById('searchGuildResults');

  // --- Utilidades simples ---
  function qs(id) { return document.getElementById(id); }
  function formatDateIso(d) { return d ? (new Date(d)).toISOString().split('T')[0] : ''; }

  // --- Sessão do usuário ---
  async function getUserSession() {
    try {
      const { data } = await supabase.auth.getSession();
      const session = data ? data.session : null;
      if (session) {
        userId = session.user.id;
        return true;
      } else {
        console.warn("Nenhuma sessão encontrada. Redirecionando para login.");
        window.location.href = "index.html";
        return false;
      }
    } catch (e) {
      console.error("Erro ao obter sessão:", e);
      return false;
    }
  }

  // --- Funções de líder (chamadas a RPCs) ---
  async function promoteToCoLeader(targetId) {
    try {
      const { error } = await supabase.rpc('promote_to_co_leader', {
        p_guild_id: userGuildId,
        p_requester_id: userId,
        p_target_id: targetId
      });
      if (error) throw error;
      alert("Membro promovido a Co-Líder com sucesso.");
      await loadGuildInfo(); // refresh
      if (editGuildModal) openEditGuildModal(currentGuildData);
    } catch (e) {
      alert("Erro ao promover: " + (e.message || e));
      console.error(e);
    }
  }

  async function transferLeadership(targetId) {
    if (!confirm("Tem certeza que quer transferir a liderança para este Co-Líder? Você continuará como Co-Líder.")) return;
    try {
      const { error } = await supabase.rpc('transfer_leadership', {
        p_guild_id: userGuildId,
        p_old_leader_id: userId,
        p_new_leader_id: targetId
      });
      if (error) throw error;
      alert("Liderança transferida com sucesso.");
      await loadGuildInfo();
      if (editGuildModal) editGuildModal.style.display = 'none';
    } catch (e) {
      alert("Erro ao transferir liderança: " + (e.message || e));
      console.error(e);
    }
  }

  async function expelMember(memberId) {
    if (!confirm("Tem certeza que deseja expulsar este membro?")) return;
    try {
      const { error } = await supabase.rpc('expel_member', {
        p_guild_id: userGuildId,
        p_requester_id: userId,
        p_member_id: memberId
      });
      if (error) throw error;
      alert("Membro expulso com sucesso.");
      await loadGuildInfo();
      if (editGuildModal) openEditGuildModal(currentGuildData);
    } catch (e) {
      alert("Erro ao expulsar membro: " + (e.message || e));
      console.error(e);
    }
  }

  async function acceptRequest(requestId) {
    try {
      const { error } = await supabase.rpc('accept_guild_join_request', {
        p_guild_id: userGuildId,
        p_request_id: requestId,
        p_requester_id: userId
      });
      if (error) throw error;
      alert("Solicitação aceita.");
      await loadGuildInfo();
      if (editGuildModal) openEditGuildModal(currentGuildData);
    } catch (e) {
      alert("Erro ao aceitar solicitação: " + (e.message || e));
      console.error(e);
    }
  }

  async function rejectRequest(requestId) {
    try {
      const { error } = await supabase.rpc('reject_guild_join_request', {
        p_request_id: requestId,
        p_requester_id: userId
      });
      if (error) throw error;
      alert("Solicitação rejeitada.");
      await loadGuildInfo();
      if (editGuildModal) openEditGuildModal(currentGuildData);
    } catch (e) {
      alert("Erro ao rejeitar solicitação: " + (e.message || e));
      console.error(e);
    }
  }

  // --- Carregar informações da guilda ---
  async function loadGuildInfo() {
    try {
      if (!userId) {
        console.error("ID do usuário não disponível.");
        if (guildInfoContainer) guildInfoContainer.style.display = 'none';
        if (noGuildContainer) noGuildContainer.style.display = 'block';
        return;
      }

      // Busca guild_id no player caso não saibamos
      if (!userGuildId) {
        const { data: playerData, error: playerError } = await supabase
          .from('players')
          .select('guild_id')
          .eq('id', userId)
          .single();

        if (playerError || !playerData || !playerData.guild_id) {
          if (guildInfoContainer) guildInfoContainer.style.display = 'none';
          if (noGuildContainer) noGuildContainer.style.display = 'block';
          return;
        }
        userGuildId = playerData.guild_id;
      }

      // Busca guild + membros
      const { data: guildData, error: guildError } = await supabase
        .from('guilds')
        .select('*, players!players_guild_id_fkey(*)')
        .eq('id', userGuildId)
        .single();

      if (guildError || !guildData) {
        console.error("Erro ao buscar dados da guilda:", guildError && guildError.message);
        if (guildInfoContainer) guildInfoContainer.style.display = 'none';
        if (noGuildContainer) noGuildContainer.style.display = 'block';
        return;
      }

      currentGuildData = guildData;
      // Render - bandeira + nome
      const flagUrl = guildData.flag_url || '/assets/default_guild_flag.png';
      if (guildNameElement) {
        guildNameElement.innerHTML = `<img src="${flagUrl}" alt="Bandeira" class="guild-flag" style="width:40px;height:40px;margin-right:8px;vertical-align:middle;border-radius:4px;"> <span id="guildNameText">${guildData.name}</span>`;
      }
      if (guildMemberCountElement) guildMemberCountElement.textContent = `Membros: ${guildData.players.length} / ${guildData.max_members || 50}`;
      if (guildLevelValueElement) guildLevelValueElement.textContent = guildData.level;

      const xpNeeded = guildData.xp_needed_for_level || (guildData.level * 1000);
      const xpPercentage = xpNeeded ? (guildData.experience / xpNeeded) * 100 : 0;
      if (guildXpFillElement) guildXpFillElement.style.width = `${Math.min(100, xpPercentage)}%`;

      // Membros
      const roles = ['leader', 'co-leader', 'member'];
      const sortedMembers = (guildData.players || []).slice().sort((a, b) => roles.indexOf(a.rank) - roles.indexOf(b.rank));
      const roleTranslations = { 'leader': 'Líder', 'co-leader': 'Co-Líder', 'member': 'Membro' };

      if (guildMemberListElement) {
        guildMemberListElement.innerHTML = '';
        sortedMembers.forEach(member => {
          const li = document.createElement('li');
          li.innerHTML = `
            <img src="${member.avatar_url || '/assets/default_avatar.png'}" alt="Avatar" class="member-avatar" style="width:36px;height:36px;border-radius:6px;margin-right:8px;">
            <span class="member-name">${member.name}</span>
            <span class="member-role" style="margin-left:8px">${roleTranslations[member.rank] || member.rank}</span>
          `;
          guildMemberListElement.appendChild(li);
        });
      }

      if (guildInfoContainer) guildInfoContainer.style.display = 'block';
      if (noGuildContainer) noGuildContainer.style.display = 'none';

      // Mostrar botão editar se for líder
      if (editGuildBtn) {
        if (guildData.leader_id === userId) {
          editGuildBtn.style.display = 'inline-block';
          editGuildBtn.onclick = () => openEditGuildModal(guildData);
        } else {
          editGuildBtn.style.display = 'none';
        }
      }

    } catch (e) {
      console.error("loadGuildInfo falhou:", e);
      if (guildInfoContainer) guildInfoContainer.style.display = 'none';
      if (noGuildContainer) noGuildContainer.style.display = 'block';
    }
  }

  // --- Ranking ---
  async function loadGuildRanking() {
    try {
      const { data: rankingData, error: rankingError } = await supabase.rpc('get_guild_ranking_by_power', { limit: 100 });
      if (rankingError) throw rankingError;
      if (guildRankingListElement) {
        guildRankingListElement.innerHTML = '';
        rankingData.forEach((guild, index) => {
          const li = document.createElement('li');
          li.innerHTML = `<span>#${index + 1}</span> <span class="ranking-guild-name">${guild.name}</span> <span>Poder: ${guild.total_power.toLocaleString()}</span>`;
          guildRankingListElement.appendChild(li);
        });
      }
    } catch (e) {
      console.error("Erro ao buscar ranking:", e);
    }
  }

  // --- Abrir modal de edição e popular ---
  async function openEditGuildModal(guildData) {
    try {
      if (!editGuildModal) return;
      editGuildName.value = guildData.name || '';
      editGuildDescription.value = guildData.description || '';
      editGuildFlagUrl.value = guildData.flag_url || '';

      // controle de mudança de nome (30 dias)
      editNameInfo.textContent = '';
      editGuildName.disabled = false;
      if (guildData.last_name_change) {
        const last = new Date(guildData.last_name_change);
        const diffMs = Date.now() - last.getTime();
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        if (diffMs < THIRTY_DAYS_MS) {
          const nextAllowed = new Date(last.getTime() + THIRTY_DAYS_MS);
          editGuildName.disabled = true;
          editNameInfo.textContent = `Nome só pode ser alterado novamente em ${formatDateIso(nextAllowed)}.`;
        }
      }

      // membros
      manageMembersList.innerHTML = '';
      const members = (guildData.players || []).slice().sort((a,b)=> a.rank === b.rank ? a.name.localeCompare(b.name) : (a.rank==='leader'?-1:(b.rank==='leader'?1:(a.rank==='co-leader'?-1:1))));
      members.forEach(m => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.padding = '6px 0';

        const left = document.createElement('div');
        left.innerHTML = `<strong>${m.name}</strong> <span style="margin-left:8px">${m.rank}</span>`;
        li.appendChild(left);

        const actions = document.createElement('div');

        if (m.id !== userId) {
          if (m.rank === 'member') {
            const promoBtn = document.createElement('button');
            promoBtn.textContent = 'Promover a Co-Líder';
            promoBtn.className = 'action-btn small';
            promoBtn.onclick = () => promoteToCoLeader(m.id);
            actions.appendChild(promoBtn);
          }
          if (m.rank === 'co-leader') {
            const transferBtn = document.createElement('button');
            transferBtn.textContent = 'Transferir Liderança';
            transferBtn.className = 'action-btn small';
            transferBtn.onclick = () => transferLeadership(m.id);
            actions.appendChild(transferBtn);
          }
          const expelBtn = document.createElement('button');
          expelBtn.textContent = 'Expulsar';
          expelBtn.className = 'action-btn small danger';
          expelBtn.onclick = () => expelMember(m.id);
          actions.appendChild(expelBtn);
        } else {
          const meSpan = document.createElement('span');
          meSpan.textContent = '(Você)';
          actions.appendChild(meSpan);
        }

        li.appendChild(actions);
        manageMembersList.appendChild(li);
      });

      // solicitações pendentes
      guildRequestsList.innerHTML = '';
      try {
        const { data: requests, error: reqErr } = await supabase
          .from('guild_join_requests')
          .select('*')
          .eq('guild_id', guildData.id)
          .order('created_at', { ascending: true });

        if (reqErr) throw reqErr;

        if (!requests || requests.length === 0) {
          guildRequestsList.innerHTML = '<li>Nenhuma solicitação pendente.</li>';
        } else {
          requests.forEach(r => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '6px 0';
            li.innerHTML = `<div><strong>${r.player_name}</strong> <div style="font-size:0.9em;color:#666">${r.message || ''}</div></div>`;

            const actions = document.createElement('div');
            const acceptBtn = document.createElement('button');
            acceptBtn.className = 'action-btn small';
            acceptBtn.textContent = 'Aceitar';
            acceptBtn.onclick = () => acceptRequest(r.id);

            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'action-btn small danger';
            rejectBtn.textContent = 'Rejeitar';
            rejectBtn.onclick = () => rejectRequest(r.id);

            actions.appendChild(acceptBtn);
            actions.appendChild(rejectBtn);
            li.appendChild(actions);
            guildRequestsList.appendChild(li);
          });
        }
      } catch (e) {
        guildRequestsList.innerHTML = '<li>Erro ao carregar solicitações.</li>';
        console.error(e);
      }

      editGuildModal.style.display = 'flex';
    } catch (e) {
      console.error("openEditGuildModal falhou:", e);
    }
  }

  // --- Salvar alterações da guilda ---
  if (saveGuildChangesBtn) {
    saveGuildChangesBtn.addEventListener('click', async () => {
      const newName = editGuildName.value.trim();
      const newDesc = editGuildDescription.value.trim();
      const newFlag = editGuildFlagUrl.value.trim();

      try {
        const { error } = await supabase.rpc('update_guild_info', {
          p_guild_id: userGuildId,
          p_player_id: userId,
          p_name: newName,
          p_description: newDesc,
          p_flag_url: newFlag
        });
        if (error) throw error;
        alert("Guilda atualizada com sucesso!");
        editGuildModal.style.display = 'none';
        await loadGuildInfo();
      } catch (e) {
        alert("Erro ao atualizar guilda: " + (e.message || e));
        console.error(e);
      }
    });
  }

  // --- Criar guilda (modal) ---
  if (createGuildBtn && createGuildModal) {
    createGuildBtn.addEventListener('click', () => {
      createGuildModal.style.display = 'flex';
    });
  }
  if (closeGuildModalBtn) {
    closeGuildModalBtn.addEventListener('click', () => {
      createGuildModal.style.display = 'none';
      if (createGuildMessage) { createGuildMessage.textContent = ''; }
      if (newGuildNameInput) { newGuildNameInput.value = ''; }
    });
  }

  if (confirmCreateGuildBtn) {
    confirmCreateGuildBtn.addEventListener('click', async () => {
      if (!newGuildNameInput) return;
      const guildName = newGuildNameInput.value.trim();
      if (createGuildMessage) { createGuildMessage.textContent = ''; createGuildMessage.classList.remove('success','error'); }

      if (!guildName) {
        if (createGuildMessage) { createGuildMessage.textContent = 'O nome da guilda não pode ser vazio.'; createGuildMessage.classList.add('error'); }
        return;
      }

      try {
        const { data, error } = await supabase.rpc('create_guild_for_player', {
          p_guild_name: guildName,
          p_player_id: userId
        });
        if (error) {
          const errorMessage = (error.message && (error.message.includes('unique constraint') || error.message.includes('Nome de guilda já'))) ? 'Nome de guilda já em uso. Tente outro.' : (error.message || 'Erro');
          if (createGuildMessage) { createGuildMessage.textContent = errorMessage; createGuildMessage.classList.add('error'); }
          console.error("Erro ao criar guilda:", error);
          return;
        }
        if (data && data.length > 0) userGuildId = data[0].created_guild_id;
        if (createGuildMessage) { createGuildMessage.textContent = `Guilda \"${guildName}\" criada com sucesso!`; createGuildMessage.classList.add('success'); }
        setTimeout(() => { createGuildModal.style.display = 'none'; loadGuildInfo(); }, 1400);
      } catch (e) {
        if (createGuildMessage) { createGuildMessage.textContent = 'Ocorreu um erro inesperado.'; createGuildMessage.classList.add('error'); }
        console.error("Erro inesperado:", e);
      }
    });
  }

  // --- Busca de guildas e solicitação ---
  if (searchGuildBtn && searchGuildModal) {
    searchGuildBtn.addEventListener('click', () => {
      searchGuildModal.style.display = 'flex';
      if (searchGuildResults) searchGuildResults.innerHTML = '';
      if (searchGuildInput) searchGuildInput.value = '';
    });
  }
  if (searchGuildCloseBtn) {
    searchGuildCloseBtn.addEventListener('click', () => {
      searchGuildModal.style.display = 'none';
    });
  }

  if (searchGuildConfirmBtn) {
    searchGuildConfirmBtn.addEventListener('click', async () => {
      if (!searchGuildInput) return;
      const query = searchGuildInput.value.trim();
      if (!query) {
        alert("Digite um nome para buscar.");
        return;
      }
      try {
        const { data, error } = await supabase.rpc('search_guilds', {
          p_query: query,
          p_limit: 20
        });
        if (error) throw error;
        if (!data || data.length === 0) {
          if (searchGuildResults) searchGuildResults.innerHTML = '<li>Nenhuma guilda encontrada.</li>';
          return;
        }
        if (searchGuildResults) searchGuildResults.innerHTML = '';
        data.forEach(g => {
          const li = document.createElement('li');
          li.style.display = 'flex';
          li.style.justifyContent = 'space-between';
          li.style.alignItems = 'center';
          li.style.padding = '8px 0';
          li.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <img src="${g.flag_url || '/assets/default_guild_flag.png'}" style="width:32px;height:32px;border-radius:4px;">
                <div>
                  <strong>${g.name}</strong>
                  <div style="font-size:0.9em;color:#666;">${g.description || ''}</div>
                  <div style="font-size:0.85em;">Membros: ${g.members_count}/${g.max_members}</div>
                </div>
            </div>
          `;
          const btn = document.createElement('button');
          btn.className = 'action-btn small';
          btn.textContent = 'Solicitar Entrada';
          btn.onclick = () => requestJoinGuild(g.id, g.name);
          li.appendChild(btn);
          searchGuildResults.appendChild(li);
        });
      } catch (e) {
        console.error("Erro ao buscar guildas:", e);
        if (searchGuildResults) searchGuildResults.innerHTML = '<li>Erro ao buscar guildas.</li>';
      }
    });
  }

  window.requestJoinGuild = async function(guildId, guildName) {
    try {
      const message = prompt(`Escreva uma mensagem para os líderes da guilda \"${guildName}\" (opcional):`) || '';
      const { error } = await supabase.rpc('create_guild_join_request', {
        p_guild_id: guildId,
        p_player_id: userId,
        p_message: message
      });
      if (error) throw error;
      alert("Solicitação enviada com sucesso!");
      if (searchGuildModal) searchGuildModal.style.display = 'none';
    } catch (e) {
      alert("Erro ao enviar solicitação: " + (e.message || e));
      console.error(e);
    }
  };

  // --- Fechar modais ao clicar fora (apenas uma vez) ---
  window.addEventListener('click', (event) => {
    try {
      if (event.target === createGuildModal) {
        createGuildModal.style.display = 'none';
        if (createGuildMessage) createGuildMessage.textContent = '';
        if (newGuildNameInput) newGuildNameInput.value = '';
      }
      if (editGuildModal && event.target === editGuildModal) {
        editGuildModal.style.display = 'none';
      }
      if (searchGuildModal && event.target === searchGuildModal) {
        searchGuildModal.style.display = 'none';
      }
    } catch (e) {
      // segurança
    }
  });

  // --- Inicialização final ---
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const activeTab = document.querySelector('.tab-btn.active') ? document.querySelector('.tab-btn.active').dataset.tab : 'guilda';
      if (activeTab === 'guilda') loadGuildInfo();
      else if (activeTab === 'ranking') loadGuildRanking();
    });
  }

  // Carrega sessão e info
  const ok = await getUserSession();
  if (ok) await loadGuildInfo();

});