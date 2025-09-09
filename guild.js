document.addEventListener("DOMContentLoaded", async () => {
    // Inicialização do Supabase
    const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Variáveis de estado
    let userId = null;
    let userGuildId = null;

    // Elementos do DOM
    const tabButtons = document.querySelectorAll('#tabMenu .tab-btn');
    const tabPanes = document.querySelectorAll('#tabContent .tab-pane');
    const guildInfoContainer = document.getElementById('guildInfoContainer');
    const noGuildContainer = document.getElementById('noGuildContainer');
    const guildNameElement = document.getElementById('guildName');
    const guildMemberCountElement = document.getElementById('guildMemberCount');
    const guildLevelValueElement = document.getElementById('guildLevelValue');
    const guildXpFillElement = document.getElementById('guildXpFill');
    const guildMemberListElement = document.getElementById('guildMemberList');
    const guildRankingListElement = document.getElementById('guildRankingList');
    const refreshBtn = document.getElementById('refreshBtn');

    // Edit modal elements
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

    // Modal de criação
    const createGuildBtn = document.getElementById('createGuildBtn');
    const createGuildModal = document.getElementById('createGuildModal');
    const closeGuildModalBtn = createGuildModal.querySelector('.close-btn');
    const newGuildNameInput = document.getElementById('newGuildNameInput');
    const confirmCreateGuildBtn = document.getElementById('confirmCreateGuildBtn');
    const createGuildMessage = document.getElementById('createGuildMessage');

    // Event Listeners para o modal de criar
    createGuildBtn.addEventListener('click', () => {
        createGuildModal.style.display = 'flex';
    });

    closeGuildModalBtn.addEventListener('click', () => {
        createGuildModal.style.display = 'none';
        createGuildMessage.textContent = '';
        newGuildNameInput.value = '';
    });

    window.addEventListener('click', (event) => {
        if (event.target === createGuildModal) {
            createGuildModal.style.display = 'none';
            createGuildMessage.textContent = '';
            newGuildNameInput.value = '';
        }
        if (event.target === editGuildModal) {
            editGuildModal.style.display = 'none';
        }
    });

    // Event Listeners para o modal de editar
    if (editCloseBtn) {
        editCloseBtn.addEventListener('click', () => {
            editGuildModal.style.display = 'none';
        });
    }

    // Função de criação da guilda (mantive igual)
    confirmCreateGuildBtn.addEventListener('click', async () => {
        const guildName = newGuildNameInput.value.trim();
        createGuildMessage.textContent = '';
        createGuildMessage.classList.remove('success', 'error');

        if (!guildName) {
            createGuildMessage.textContent = 'O nome da guilda não pode ser vazio.';
            createGuildMessage.classList.add('error');
            return;
        }

        try {
            const { data, error } = await supabase.rpc('create_guild_for_player', {
                p_guild_name: guildName,
                p_player_id: userId
            });

            if (error) {
                const errorMessage = error.message.includes('unique constraint "guilds_name_key"') || error.message.includes('Nome de guilda já')
                    ? 'Nome de guilda já em uso. Tente outro.'
                    : error.message;
                createGuildMessage.textContent = errorMessage;
                createGuildMessage.classList.add('error');
                console.error("Erro ao criar guilda:", error);
                return;
            }

            if (data && data.length > 0) {
                userGuildId = data[0].created_guild_id;
            }

            createGuildMessage.textContent = `Guilda "${guildName}" criada com sucesso!`;
            createGuildMessage.classList.add('success');

            setTimeout(() => {
                createGuildModal.style.display = 'none';
                loadGuildInfo();
            }, 1400);

        } catch (e) {
            createGuildMessage.textContent = 'Ocorreu um erro inesperado.';
            createGuildMessage.classList.add('error');
            console.error("Erro inesperado:", e);
        }
    });

    // Controle das abas
    function showTab(tabId) {
        tabPanes.forEach(pane => pane.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');

        tabButtons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            }
        });
    }

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tab = button.dataset.tab;
            showTab(tab);
            if (tab === 'guilda') {
                loadGuildInfo();
            } else if (tab === 'ranking') {
                loadGuildRanking();
            }
        });
    });

    // Obter sessão
    async function getUserSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            userId = session.user.id;
        } else {
            console.warn("Nenhuma sessão encontrada. Redirecionando para login.");
            window.location.href = "index.html";
        }
    }

    // Funções auxiliares para ações de líder
    async function promoteToCoLeader(targetId) {
        try {
            const { error } = await supabase.rpc('promote_to_co_leader', {
                p_guild_id: userGuildId,
                p_requester_id: userId,
                p_target_id: targetId
            });
            if (error) throw error;
            alert("Membro promovido a Co-Líder com sucesso.");
            loadGuildInfo();
            openEditGuildModal(currentGuildData);
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
            // atualizar sessão/local state
            await loadGuildInfo();
            editGuildModal.style.display = 'none';
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
            loadGuildInfo();
            openEditGuildModal(currentGuildData);
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
            loadGuildInfo();
            openEditGuildModal(currentGuildData);
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
            loadGuildInfo();
            openEditGuildModal(currentGuildData);
        } catch (e) {
            alert("Erro ao rejeitar solicitação: " + (e.message || e));
            console.error(e);
        }
    }

    // Estado temporário para uso no modal
    let currentGuildData = null;

    // Carregar info da guilda
    async function loadGuildInfo() {
        if (!userId) {
            console.error("ID do usuário não disponível.");
            guildInfoContainer.style.display = 'none';
            noGuildContainer.style.display = 'block';
            return;
        }

        // Atualiza guild_id do jogador se ainda não temos em memória
        if (!userGuildId) {
            const { data: playerData, error: playerError } = await supabase
                .from('players')
                .select('guild_id')
                .eq('id', userId)
                .single();

            if (playerError || !playerData || !playerData.guild_id) {
                guildInfoContainer.style.display = 'none';
                noGuildContainer.style.display = 'block';
                return;
            }

            userGuildId = playerData.guild_id;
        }

        // Busca informações da guilda + membros (inclui last_name_change e flag_url)
        const { data: guildData, error: guildError } = await supabase
            .from('guilds')
            // usa nome da foreign key para evitar ambiguidade
            .select('*, players!players_guild_id_fkey(*)')
            .eq('id', userGuildId)
            .single();

        if (guildError || !guildData) {
            console.error("Erro ao buscar dados da guilda:", guildError?.message);
            guildInfoContainer.style.display = 'none';
            noGuildContainer.style.display = 'block';
            return;
        }

        currentGuildData = guildData; // guarda para usar em modais

        // Renderiza bandeira + nome
        const flagUrl = guildData.flag_url || '/assets/default_guild_flag.png';
        guildNameElement.innerHTML = `<img src="${flagUrl}" alt="Bandeira" class="guild-flag" style="width:40px;height:40px;margin-right:8px;vertical-align:middle;border-radius:4px;"> <span id="guildNameText">${guildData.name}</span>`;

        guildMemberCountElement.textContent = `Membros: ${guildData.players.length} / ${guildData.max_members || 50}`;
        guildLevelValueElement.textContent = guildData.level;

        // Ajuste de XP (compatível se xp_needed_for_level não existir)
        const xpNeeded = guildData.xp_needed_for_level || (guildData.level * 1000);
        const xpPercentage = xpNeeded ? (guildData.experience / xpNeeded) * 100 : 0;
        guildXpFillElement.style.width = `${Math.min(100, xpPercentage)}%`;

        // Ordena e renderiza membros
        const roles = ['leader', 'co-leader', 'member'];
        const sortedMembers = guildData.players.sort((a, b) => {
            return roles.indexOf(a.rank) - roles.indexOf(b.rank);
        });

        const roleTranslations = {
            'leader': 'Líder',
            'co-leader': 'Co-Líder',
            'member': 'Membro'
        };

        guildMemberListElement.innerHTML = '';
        sortedMembers.forEach(member => {
            const translatedRole = roleTranslations[member.rank] || member.rank;
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${member.avatar_url || '/assets/default_avatar.png'}" alt="Avatar" class="member-avatar" style="width:36px;height:36px;border-radius:6px;margin-right:8px;">
                <span class="member-name">${member.name}</span>
                <span class="member-role" style="margin-left:8px">${translatedRole}</span>
            `;
            guildMemberListElement.appendChild(li);
        });

        // Mostrar containers
        guildInfoContainer.style.display = 'block';
        noGuildContainer.style.display = 'none';

        // Mostrar botão editar se o usuário for líder
        if (guildData.leader_id === userId) {
            editGuildBtn.style.display = 'inline-block';
            editGuildBtn.onclick = () => openEditGuildModal(guildData);
        } else {
            editGuildBtn.style.display = 'none';
        }
    }

    // Carregar ranking
    async function loadGuildRanking() {
        const { data: rankingData, error: rankingError } = await supabase.rpc('get_guild_ranking_by_power', { limit: 100 });
        
        if (rankingError) {
            console.error("Erro ao buscar ranking:", rankingError.message);
            return;
        }

        guildRankingListElement.innerHTML = '';
        rankingData.forEach((guild, index) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>#${index + 1}</span>
                <span class="ranking-guild-name">${guild.name}</span>
                <span>Poder de Combate: ${guild.total_power.toLocaleString()}</span>
            `;
            guildRankingListElement.appendChild(li);
        });
    }

    // Abre modal de edição e popula campos e listas
    function formatDateIso(d) {
        return d ? (new Date(d)).toISOString().split('T')[0] : '';
    }

    async function openEditGuildModal(guildData) {
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

        // popula lista de membros com botões de gestão (apenas para líder)
        manageMembersList.innerHTML = '';
        const members = (guildData.players || []);
        members.sort((a,b)=> a.rank === b.rank ? a.name.localeCompare(b.name) : (a.rank==='leader'?-1:(b.rank==='leader'?1:(a.rank==='co-leader'?-1:1))));
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

            // Não mostrar ações para si mesmo (líder)
            if (m.id !== userId) {
                // Promover a co-líder (apenas se ainda não for)
                if (m.rank === 'member') {
                    const promoBtn = document.createElement('button');
                    promoBtn.textContent = 'Promover a Co-Líder';
                    promoBtn.className = 'action-btn small';
                    promoBtn.onclick = () => promoteToCoLeader(m.id);
                    actions.appendChild(promoBtn);
                }

                // Transferir liderança (apenas se for co-líder)
                if (m.rank === 'co-leader') {
                    const transferBtn = document.createElement('button');
                    transferBtn.textContent = 'Transferir Liderança';
                    transferBtn.className = 'action-btn small';
                    transferBtn.onclick = () => transferLeadership(m.id);
                    actions.appendChild(transferBtn);
                }

                // Expulsar (líder pode expulsar qualquer um exceto líder)
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

        // popula solicitações pendentes
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
    }

    // Salvar alterações da guilda (chama RPC update_guild_info)
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

    // Inicialização
    await getUserSession();
    await loadGuildInfo();

    refreshBtn.addEventListener('click', () => {
        const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
        if (activeTab === 'guilda') {
            loadGuildInfo();
        } else if (activeTab === 'ranking') {
            loadGuildRanking();
        }
    });
});
