import { supabase } from './supabaseClient.js'
import { getDB, STORES } from './globalState.js'

document.addEventListener("DOMContentLoaded", async () => {
    
    // --- HELPER FUNCTIONS DO GLOBAL STATE (IDB) PARA GUILDA ---
    
    // Recupera dados de uma guilda específica do IDB
    async function getGuildState(guildId) {
        try {
            const db = await getDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORES.GUILD, "readonly");
                const req = tx.objectStore(STORES.GUILD).get(guildId);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) { console.error("Erro ao ler IDB Guild:", e); return null; }
    }

    // Salva dados de uma guilda no IDB
    async function saveGuildState(guildData) {
        if (!guildData || !guildData.id) return;
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORES.GUILD, "readwrite");
                const store = tx.objectStore(STORES.GUILD);
                guildData._last_updated = Date.now(); // Timestamp para controle de cache
                store.put(guildData);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) { console.error("Erro ao salvar IDB Guild:", e); }
    }

    // Remove uma guilda do cache (para forçar atualização após ações)
    async function invalidateGuildCache(guildId) {
        if(!guildId) return;
        try {
            const db = await getDB();
            const tx = db.transaction(STORES.GUILD, "readwrite");
            tx.objectStore(STORES.GUILD).delete(guildId);
            console.log(`Cache da guilda ${guildId} invalidado.`);
        } catch (e) { console.error("Erro ao invalidar cache:", e); }
    }

    // Recupera Ranking do Store META
    async function getRankingFromMeta() {
        try {
            const db = await getDB();
            return new Promise((resolve) => {
                const tx = db.transaction(STORES.META, "readonly");
                const req = tx.objectStore(STORES.META).get("guild_ranking_weekly");
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch (e) { return null; }
    }

    // Salva Ranking no Store META com expiração
    async function saveRankingToMeta(data, expirationTime) {
        try {
            const db = await getDB();
            const tx = db.transaction(STORES.META, "readwrite");
            const store = tx.objectStore(STORES.META);
            store.put({ key: "guild_ranking_weekly", value: data, expires: expirationTime });
        } catch (e) { console.error("Erro ao salvar Ranking Meta:", e); }
    }

    // --- FIM DOS HELPERS IDB ---

  // --- INÍCIO: LÓGICA DO MODAL DE INFORMAÇÕES (SUBSTITUTO DO ALERT) ---
  document.body.insertAdjacentHTML('beforeend', `
    <div id="infoModal" class="modal" style="display: none; z-index: 1500;">
      <div class="modal-content">
        <span class="close-btn">&times;</span>
        <p id="infoModalMessage" class="message"></p>
        <button id="infoModalOkBtn" class="action-btn">OK</button>
      </div>
    </div>
  `);
  const infoModal = document.getElementById('infoModal');
  const infoModalMessage = document.getElementById('infoModalMessage');
  const infoModalOkBtn = document.getElementById('infoModalOkBtn');
  const infoModalCloseBtn = infoModal.querySelector('.close-btn');
  const closeInfoModal = () => { infoModal.style.display = 'none'; };
  function showInfoModal(message, type = 'info') {
    infoModalMessage.textContent = message;
    infoModalMessage.className = 'message';
    if (type === 'success') { infoModalMessage.classList.add('success'); }
    else if (type === 'error') { infoModalMessage.classList.add('error'); }
    infoModal.style.display = 'flex';
    infoModalOkBtn.focus();
  }
  infoModalOkBtn.addEventListener('click', closeInfoModal);
  infoModalCloseBtn.addEventListener('click', closeInfoModal);
  infoModal.addEventListener('click', (event) => { if (event.target === infoModal) { closeInfoModal(); } });
  // --- FIM: LÓGICA DO MODAL DE INFORMAÇÕES ---

  // --- INÍCIO: LÓGICA DO MODAL DE CONFIRMAÇÃO (SUBSTITUTO DO CONFIRM) ---
  document.body.insertAdjacentHTML('beforeend', `
    <div id="confirmModal" class="modal" style="display: none; z-index: 1600; background: none!important;">
      <div class="modal-content">
        <span class="close-btn">&times;</span>
        <p id="confirmModalMessage"></p>
        <div class="confirm-modal-actions">
          <button id="confirmModalCancelBtn" class="action-btn">Cancelar</button>
          <button id="confirmModalConfirmBtn" class="action-btn">Confirmar</button>
        </div>
      </div>
    </div>
  `);
  const confirmModal = document.getElementById('confirmModal');
  const confirmModalMessage = document.getElementById('confirmModalMessage');
  let confirmModalConfirmBtn = document.getElementById('confirmModalConfirmBtn');
  const confirmModalCancelBtn = document.getElementById('confirmModalCancelBtn');
  const confirmModalCloseBtn = confirmModal.querySelector('.close-btn');
  const closeConfirmModal = () => { confirmModal.style.display = 'none'; };
  function showConfirmModal(message, onConfirm, withCooldown = false) {
    confirmModalMessage.textContent = message;
    const newConfirmBtn = confirmModalConfirmBtn.cloneNode(true);
    confirmModalConfirmBtn.parentNode.replaceChild(newConfirmBtn, confirmModalConfirmBtn);
    confirmModalConfirmBtn = newConfirmBtn;

    // limpar qualquer intervalo anterior salvo no botão
    if (confirmModalConfirmBtn._countdownInterval) {
        clearInterval(confirmModalConfirmBtn._countdownInterval);
        confirmModalConfirmBtn._countdownInterval = null;
    }

    if (withCooldown) {
        let timeLeft = 40;
        confirmModalConfirmBtn.disabled = true;
        confirmModalConfirmBtn.classList.add("disabled-btn");
        confirmModalConfirmBtn.textContent = `Aguarde ${timeLeft}s`;

        const interval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                confirmModalConfirmBtn.textContent = `Aguarde ${timeLeft}s`;
            } else {
                clearInterval(interval);
                confirmModalConfirmBtn.disabled = false;
                confirmModalConfirmBtn.classList.remove("disabled-btn");
                confirmModalConfirmBtn.textContent = "Confirmar";
            }
        }, 1000);

        confirmModalConfirmBtn._countdownInterval = interval;
    } else {
        confirmModalConfirmBtn.disabled = false;
        confirmModalConfirmBtn.classList.remove("disabled-btn");
        confirmModalConfirmBtn.textContent = "Confirmar";
    }

    confirmModalConfirmBtn.addEventListener(
        "click",
        () => {
            closeConfirmModal();
            if (confirmModalConfirmBtn._countdownInterval) {
                clearInterval(confirmModalConfirmBtn._countdownInterval);
                confirmModalConfirmBtn._countdownInterval = null;
            }
            onConfirm();
        },
        { once: true }
    );

    confirmModal.style.display = "flex";
    confirmModalConfirmBtn.focus();
}
  confirmModalCancelBtn.addEventListener('click', closeConfirmModal);
  confirmModalCloseBtn.addEventListener('click', closeConfirmModal);
  confirmModal.addEventListener('click', (event) => { if (event.target === infoModal) { closeConfirmModal(); } });
  // --- FIM: LÓGICA DO MODAL DE CONFIRMAÇÃO ---

  // --- INÍCIO: LÓGICA DO MODAL DE PROMPT (SUBSTITUTO DO PROMPT) ---
    document.body.insertAdjacentHTML('beforeend', `
    <div id="promptModal" class="modal" style="display: none; z-index: 1700;">
      <div class="modal-content">
        <span class="close-btn">&times;</span>
        <p id="promptModalMessage"></p>
        <textarea id="promptModalInput" rows="3" placeholder="Mensagem (opcional)"></textarea>
        <div class="prompt-modal-actions">
          <button id="promptModalCancelBtn" class="action-btn">Cancelar</button>
          <button id="promptModalConfirmBtn" class="action-btn">Enviar</button>
        </div>
      </div>
    </div>
  `);
  const promptModal = document.getElementById('promptModal');
  const promptModalMessage = document.getElementById('promptModalMessage');
  const promptModalInput = document.getElementById('promptModalInput');
  let promptModalConfirmBtn = document.getElementById('promptModalConfirmBtn');
  const promptModalCancelBtn = document.getElementById('promptModalCancelBtn');
  const promptModalCloseBtn = promptModal.querySelector('.close-btn');
  const closePromptModal = () => { promptModal.style.display = 'none'; };
  function showPromptModal(message, onConfirm) {
    promptModalMessage.textContent = message;
    promptModalInput.value = ''; // Limpa o campo de texto
    const newConfirmBtn = promptModalConfirmBtn.cloneNode(true);
    promptModalConfirmBtn.parentNode.replaceChild(newConfirmBtn, promptModalConfirmBtn);
    promptModalConfirmBtn = newConfirmBtn;
    promptModalConfirmBtn.addEventListener('click', () => {
      const inputValue = promptModalInput.value.trim();
      closePromptModal();
      onConfirm(inputValue); // Passa o valor do input para o callback
    }, { once: true });
    promptModal.style.display = 'flex';
    promptModalInput.focus();
  }
  promptModalCancelBtn.addEventListener('click', closePromptModal);
  promptModalCloseBtn.addEventListener('click', closePromptModal);
  promptModal.addEventListener('click', (event) => { if (event.target === promptModal) { closePromptModal(); } });
  // --- FIM: LÓGICA DO MODAL DE PROMPT ---
  
  // Função auxiliar de TTL (Mantida)
  function getTtlUntilNextMonday() {
    const now = new Date();
    const day = now.getUTCDay();
    let daysToAdd = (8 - day) % 7;
    if (daysToAdd === 0 && now.getUTCHours() >= 0) {
       daysToAdd = 7;
    }
    const nextMonday = new Date(now);
    nextMonday.setUTCDate(now.getUTCDate() + daysToAdd);
    nextMonday.setUTCHours(0, 0, 0, 0);
    const ttl = nextMonday.getTime() - now.getTime();
    return ttl > 0 ? ttl : 24 * 60 * 60 * 1000;
  }

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
    $$(`#tabMenu .tab-btn`).forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    $$('#tabContent .tab-pane').forEach(p => {
      p.style.display = (p.id === tabId) ? 'block' : 'none';
    });
  }

  const tabMenuEl = $('#tabMenu');
  if (tabMenuEl){
    const activeBtn = tabMenuEl.querySelector('.tab-btn.active') || tabMenuEl.querySelector('.tab-btn');
    if (activeBtn) activateMainTab(activeBtn.dataset.tab);

    tabMenuEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab-btn');
      if (!btn) return;
      const tab = btn.dataset.tab;
      if (!tab) return;
      activateMainTab(tab);
      if (tab === 'ranking') {
        loadGuildRanking();
      }
    });
  }

  // --- Edit modal tabs (supports #editTabMenu or legacy #editTabs) ---
  function activateEditTab(tabId){
    $$('#editTabContent .edit-tab-pane').forEach(p => {
      p.style.display = (p.id === tabId) ? 'block' : 'none';
    });
    $$('#editTabMenu .edit-tab-btn, #editTabs .edit-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));

    markTabNotification(tabId, false);
    if (tabId === 'tab-requests' || tabId === 'tab-notice'){
      updateGuildNotifications(false);
      // Mantendo localStorage para flags simples de UI (leituras)
      if (userGuildId) localStorage.setItem(`guild_${userGuildId}_${tabId}_read`, Date.now());
    }
  }

  const editTabMenuEl = $('#editTabMenu') || $('#editTabs');
  if (editTabMenuEl){
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

    if (guildData.last_notice_update) {
        const lastNoticeUpdate = new Date(guildData.last_notice_update).getTime();
        const lastReadNotice = readNotice ? parseInt(readNotice, 10) : 0;
        if (lastNoticeUpdate > lastReadNotice) {
            hasNotice = true;
        }
    }

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

  // =======================================================================
  // OTIMIZAÇÃO DE AUTH: Zero Egress Check
  // =======================================================================
  
  // --- HELPER DE AUTH OTIMISTA (ZERO EGRESS) ---
  function getLocalUserId() {
    try {
        const cached = localStorage.getItem('player_data_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.data && parsed.data.id && parsed.expires > Date.now()) {
                return parsed.data.id;
            }
        }
    } catch (e) {}

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
                const sessionStr = localStorage.getItem(k);
                const session = JSON.parse(sessionStr);
                if (session && session.user && session.user.id) {
                    return session.user.id;
                }
            }
        }
    } catch (e) {}

    return null;
  }

  async function getUserSession(){
    const localId = getLocalUserId();
    if (localId) {
        userId = localId;
        return true;
    }
    
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session){ 
        userId = session.user.id; 
        return true; 
    }
    
    console.warn("Sessão não encontrada ou expirada. Redirecionando...");
    window.location.href = 'index.html';
    return false;
  }

  // Função para renderizar a UI com os dados da guilda
  async function renderGuildUI(guildData) {
      currentGuildData = guildData;
      const deleteGuildBtn = document.getElementById('deleteguild');
      if (deleteGuildBtn) {
        deleteGuildBtn.style.display = (guildData.leader_id === userId) ? 'block' : 'none';
      }

      try{ if (typeof updateGuildXpBar==='function') updateGuildXpBar(currentGuildData); }catch(e){ console.error('updateGuildXpBar call failed', e); }
      
      const allPlayersInGuild = guildData.players || [];
      const me = allPlayersInGuild.find(p => p.id === userId);
      userRank = me ? me.rank : 'member';
      
      const visiblePlayers = allPlayersInGuild.filter(p => p.rank !== 'admin');

      const flagUrl = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
      if (guildNameElement) guildNameElement.innerHTML = `<img src="${flagUrl}" style="width:140px;height:155px;margin-right:8px;border-radius:6px; margin-top: 14px; margin-left: 18px;"><br> <strong><span style="color: white;">${guildData.name}</span></strong>`;
      if (guildDescriptionEl) guildDescriptionEl.textContent = guildData.description || '';

      // OTIMIZAÇÃO: Cálculo Local de CP (Sem RPC)
      let guildPowerValue = 0;
      if (visiblePlayers && visiblePlayers.length > 0) {
          guildPowerValue = visiblePlayers.reduce((sum, p) => sum + (Number(p.combat_power) || 0), 0);
      }
      // Se por acaso a lista de players estiver vazia mas houver um valor cacheado, usa ele
      if (guildPowerValue === 0 && guildData.cached_power) {
          guildPowerValue = guildData.cached_power;
      }

      const compactPower = formatNumberCompact(guildPowerValue);
      if (guildPowerEl) guildPowerEl.textContent = ` ${compactPower}`;

      if (guildMemberListElement){
        guildMemberListElement.innerHTML = '';
        const roles = ['leader','co-leader','member'];
        const sorted = visiblePlayers.slice().sort((a,b)=> roles.indexOf(a.rank) - roles.indexOf(b.rank));
        
        const eyeIcon = `
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="25" viewBox="0 0 24 24" fill="white" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-left: 6px; cursor: pointer; opacity: 0.9;">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" fill="black"/>
          </svg>
        `;

        sorted.forEach(m => {
          const li = document.createElement('li');
          li.innerHTML = `
            <img src="${m.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}"
                 style="width:38px;height:38px;border-radius:6px;margin-right:8px;">
            <div class="member-details">
              <span class="player-link" data-player-id="${m.id}" style="display:inline-flex; align-items:center;">
                ${m.name} ${eyeIcon}
              </span>
              <span class="member-level">Nv. ${m.level || 1}</span>
            </div>
            <small style="margin-left:8px;color:gold; margin-top: -20px">${traduzCargo(m.rank)}</small>`;
          guildMemberListElement.appendChild(li);
        });
      }

      if (guildInfoContainer) guildInfoContainer.style.display='block';
      if (noGuildContainer) noGuildContainer.style.display='none';
      
      try{
        const lvlEl = document.getElementById('guildLevelValue');
        const memberCountHeader = document.getElementById('guildMemberCountHeader');
        const membersFromPlayers = visiblePlayers.length;
        if (lvlEl) lvlEl.textContent = guildData.level || '1';
        if (memberCountHeader) {
            const currentMembers = guildData.members_count ?? membersFromPlayers;
            const maxMembers = guildData.max_members || getMaxMembers(guildData.level || 1);
            memberCountHeader.textContent = `${currentMembers} / ${maxMembers}`;
        }
      }catch(e){console.error('set guild counts', e)}

      if (editGuildBtn){
        editGuildBtn.style.display = 'inline-block';
        editGuildBtn.onclick = () => openEditGuildModal(currentGuildData);
      }

      if (editGuildBtn) checkGuildNotifications(guildData);
  }

  async function loadGuildInfo(){
    if (!userId) return;

    try {
      if (!userGuildId){
        // Tenta pegar o guild_id do cache do jogador se disponível (via globalState seria ideal, mas aqui usamos Supabase fallback leve)
        const { data: playerData } = await supabase.from('players').select('guild_id').eq('id', userId).single();
        if (!playerData || !playerData.guild_id){
          if (guildInfoContainer) guildInfoContainer.style.display='none';
          if (noGuildContainer) noGuildContainer.style.display='block';
          return;
        }
        userGuildId = playerData.guild_id;
      }
      
      // OTIMIZAÇÃO: IndexedDB
      // Tenta carregar do IDB Global primeiro (Cache de 1 hora)
      const cachedData = await getGuildState(userGuildId);
      const CACHE_DURATION = 60 * 60 * 1000; // 1 Hora

      if (cachedData && (Date.now() - (cachedData._last_updated || 0) < CACHE_DURATION)) {
          console.log("⚡ [Guild] Dados carregados via IndexedDB (Zero Egress).");
          await renderGuildUI(cachedData);
          return;
      }

      console.log("🌐 [Guild] Buscando dados atualizados do servidor...");
      const { data: guildData, error: guildError } = await supabase.from('guilds').select('*, players!players_guild_id_fkey(*)').eq('id', userGuildId).single();
      if (guildError || !guildData){
        console.error('Erro guildData', guildError);
        if (guildInfoContainer) guildInfoContainer.style.display='none';
        if (noGuildContainer) noGuildContainer.style.display='block';
        return;
      }
      
      // Salva no IndexedDB
      await saveGuildState(guildData);
      await renderGuildUI(guildData);

    } catch(e){
      console.error('Erro loadGuildInfo', e);
    }
  }
  
  async function fetchAndDisplayGuildInfo(guildId) {
    if (!viewGuildModal) return;
    try {
        // OTIMIZAÇÃO: IndexedDB para visualização pública
        let guildData = await getGuildState(guildId);
        // Cache público pode ser um pouco mais tolerante (ex: 24h ou até next monday se quiser)
        // Vamos usar 1 hora para consistência
        const CACHE_DURATION = 60 * 60 * 1000;

        if (!guildData || (Date.now() - (guildData._last_updated || 0) > CACHE_DURATION)) {
            console.log(`🌐 [GuildView] Buscando dados públicos da guilda ${guildId}`);
            const { data, error: guildError } = await supabase
                .from('guilds')
                .select('*, players!players_guild_id_fkey(*)')
                .eq('id', guildId)
                .single();

            if (guildError || !data) {
                console.error('Erro ao buscar dados da guilda', guildError);
                return;
            }
            guildData = data;
            
            // Salva no cache
            await saveGuildState(guildData);
        } else {
             console.log(`⚡ [GuildView] Dados da guilda ${guildId} carregados do cache.`);
        }

        const allPlayersInGuild = guildData.players || [];
        const visiblePlayers = allPlayersInGuild.filter(p => p.rank !== 'admin');

        const flagUrl = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
        guildViewName.innerHTML = `<img src="${flagUrl}" style="width:140px;height:150px;margin-right:8px;border-radius:6px;border:vertical-align:4px; margin-left: 18px;"><br> <strong><span style="color: white;">${guildData.name}</span></strong>`;
        guildViewDescription.textContent = guildData.description || '';
        guildViewLevelValue.textContent = guildData.level || 1;
        guildViewMemberCountHeader.textContent = `${visiblePlayers.length} / ${guildData.max_members || getMaxMembers(guildData.level || 1)}`;
        
        // Cálculo de CP Local
        let guildPowerValue = visiblePlayers.reduce((sum, p) => sum + (Number(p.combat_power) || 0), 0);
        const compactPower = formatNumberCompact(guildPowerValue);
        guildViewPower.textContent = compactPower;

        guildViewMemberList.innerHTML = '';
        const roles = ['leader', 'co-leader', 'member'];
        const sorted = visiblePlayers.slice().sort((a, b) => roles.indexOf(a.rank) - roles.indexOf(b.rank));
        
        sorted.forEach(m => {
          const navUrl = `index.html?action=open_pv&target_id=${m.id}&target_name=${encodeURIComponent(m.name)}`;
            const thisPaperPlaneIcon = `
              <svg onclick="event.stopPropagation(); window.location.href='${navUrl}'" 
                   xmlns="http://www.w3.org/2000/svg" width="22" height="20" viewBox="0 0 24 24" fill="none" stroke="gold" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" 
                   style="vertical-align: middle; margin-left: 6px; cursor: pointer; z-index: 10;">
                <line x1="22" x2="11" y1="2" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            `;

            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${m.avatar_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" 
                     style="width:38px;height:38px;border-radius:6px;margin-right:8px;">
                <div class="member-details">
                    <span style="display:flex; align-items:center;">${m.name} ${thisPaperPlaneIcon}</span>
                    <span class="member-level">Nv. ${m.level || 1}</span>
                </div>
                <div style="display:flex; flex-direction:column; align-items:end; margin-left: auto;">
                    <small style="color:gold; display:inline-flex; align-items:center;">
                        ${traduzCargo(m.rank)}
                    </small>
                </div>`;
            guildViewMemberList.appendChild(li);
        });

        viewGuildModal.style.display = 'flex';
    } catch (e) {
        console.error('Erro ao exibir modal da guilda', e);
    }
  }

  async function loadGuildRanking(){
    try {
      // OTIMIZAÇÃO: Ranking via META store do IDB
      const cachedRanking = await getRankingFromMeta();
      
      if (cachedRanking && cachedRanking.expires > Date.now()) {
          console.log("⚡ [Ranking] Carregado do IndexedDB META (Sem Egress).");
          renderGuildRanking(cachedRanking.value);
          return;
      }
      
      console.log("🌐 [Ranking] Buscando do servidor (Cache expirado ou inexistente).");
      const { data, error } = await supabase.rpc('get_guilds_ranking', { limit_count: 100 });
      if (error) throw error;
      
      // Salva no META com validade até próxima segunda
      const expiry = Date.now() + getTtlUntilNextMonday();
      // Estrutura salva: { value: data, expires: expiry } é tratado dentro de saveRankingToMeta mas aqui passamos os params separados
      await saveRankingToMeta({ value: data, expires: expiry }.value, expiry);
      
      renderGuildRanking(data);

    } catch(e){
      console.error('Erro ao carregar ranking', e);
      if (guildRankingList) guildRankingList.innerHTML = '<li>Erro ao carregar ranking.</li>';
    }
  }

  // Função separada para renderizar o ranking
  function renderGuildRanking(data) {
      const listEl = document.getElementById('guildRankingList');
      if (!listEl) return;

      listEl.innerHTML = '';
      data.forEach((g, idx)=>{
        if (!g.guild_id) {
          console.error('AVISO: Guilda com ID inválido no ranking.', g);
          return;
        }
        
        const power = Number(g.total_power || 0);
        const compactPower = formatNumberCompact(power);
        const li = document.createElement('li');
        
        li.className = 'ranking-item-clickable';
        li.dataset.guildId = g.guild_id;

        li.innerHTML = `
          <div class="ranking-item-content">
              <span class="ranking-position">${idx+1}º</span>
              <img src="${g.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" class="ranking-flag">
              <div class="ranking-info">
                  <div class="member-details">
                      <strong class="ranking-name">${g.name}</strong>
                      <div style="display:flex; align-items:center; gap:10px; margin-top:2px;">
                          <div style="display:flex; align-items:center; gap:4px;">
                              <img alt="poder" src="https://aden-rpg.pages.dev/assets/CPicon.webp" style="width:18px; height:24px; margin-top:-2px;">
                              <span style="color:orange; font-weight:bold; font-size:1.1em;">${compactPower}</span>
                          </div>
                          <span class="member-level" 
                                style="font-weight: bold; color: lightblue; padding-left:10px; border-left:2px solid #777; font-size: 0.8em;">
                              
                          </span>
                      </div>
                  </div>
              </div>
          </div>`;

        if (idx === 0) li.style.background = "linear-gradient(180deg, rgba(255,215,0,0.5), rgba(255,215,0,0.1))";
        else if (idx === 1) li.style.background = "linear-gradient(180deg, rgba(192,192,192,0.6), rgba(169,169,169,0.1))";
        else if (idx === 2) li.style.background = "linear-gradient(180deg, rgba(205,127,50,0.4), rgba(210,180,40,0.1))";
        
        listEl.appendChild(li);
      });

      listEl.addEventListener('click', (ev) => {
          const item = ev.target.closest('li');
          if (item && item.dataset.guildId) {
              fetchAndDisplayGuildInfo(item.dataset.guildId);
          }
      });
  }


  async function openEditGuildModal(guildData){
    if (!editGuildModal) return;

    const allPlayersInGuild = guildData.players || [];
    const isLeader = (guildData.leader_id === userId);
    const isCoLeader = (allPlayersInGuild.find(p => p.id === userId) || {}).rank === 'co-leader';

    $$('#editTabMenu .edit-tab-btn, #editTabs .edit-tab-btn').forEach(btn => {
      const tab = btn.dataset.tab;
      let display = 'none';
      if (tab === 'tab-notice' || tab === 'tab-chest' || tab === 'tab-logs') display = 'inline-block';
      if (tab === 'tab-requests' || tab === 'tab-manage') display = (isLeader || isCoLeader) ? 'inline-block' : 'none';
      if (tab === 'tab-edit') display = isLeader ? 'inline-block' : 'none';
      btn.style.display = display;
    });

    if (isLeader){
      if (editGuildName) editGuildName.value = guildData.name || '';
      if (editGuildDescription) editGuildDescription.value = guildData.description || '';
      if (editGuildFlagUrl) editGuildFlagUrl.value = guildData.flag_url || '';
      if (editNameInfo) editNameInfo.textContent = '';
      if (guildData.last_name_change && editGuildName){
        const last = new Date(guildData.last_name_change);
        const diff = Date.now() - last.getTime();
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        if (diff < thirtyDays){
          const next = new Date(last.getTime() + thirtyDays);
          editGuildName.disabled = true;
          if (editNameInfo) editNameInfo.textContent = 'Nome só pode ser alterado novamente em ' + next.toLocaleDateString();
        } else {
          editGuildName.disabled = false;
        }
      }
    }

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
            li.innerHTML = `
  <div class="request-info">
    <span class="player-link" data-player-id="${r.player_id}">${r.player_name || ''}</span>
    <div class="request-message">${r.message || ''}</div>
  </div>`;
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

    if (manageMembersList) manageMembersList.innerHTML = '';
    const members = allPlayersInGuild.filter(p => p.rank !== 'admin').slice().sort((a,b)=> a.rank === b.rank ? a.name.localeCompare(b.name) : (a.rank === 'leader' ? -1 : (b.rank === 'leader' ? 1 : (a.rank === 'co-leader' ? -1 : 1))));
    members.forEach(m => {
      if (!manageMembersList) return;
      const li = document.createElement('li');
      li.innerHTML = `<div class="member-info"><strong>${m.name}</strong> <small class="member-rank">${traduzCargo(m.rank)}</small></div>`;
      const actions = document.createElement('div');
      actions.className = 'member-actions';
      if (m.id !== userId){
        if (isLeader){
          if (m.rank === 'member'){
            const promImg = document.createElement('img');
            promImg.src = "https://aden-rpg.pages.dev/assets/promover.webp"; promImg.alt = "Promover";
            promImg.onclick = () => promoteToCoLeader(m.id, m.name);
            actions.appendChild(promImg);
          } else if (m.rank === 'co-leader'){
            const revokeImg = document.createElement('img');
            revokeImg.src = "https://aden-rpg.pages.dev/assets/rebaixar.webp"; revokeImg.alt = "Revogar";
            revokeImg.onclick = () => revokeCoLeader(m.id, m.name);
            const transferImg = document.createElement('img');
            transferImg.src = "https://aden-rpg.pages.dev/assets/transferlider.webp"; transferImg.alt = "Transferir";
            transferImg.onclick = () => transferLeadership(m.id, m.name);
            actions.appendChild(revokeImg);
            actions.appendChild(transferImg);
          }
          const expelImg = document.createElement('img');
          expelImg.src = "https://aden-rpg.pages.dev/assets/expulsar.webp"; expelImg.alt = "Expulsar";
          expelImg.onclick = () => expelMember(m.id);
          actions.appendChild(expelImg);
        } else if (isCoLeader && m.rank === 'member'){
          const expelImg = document.createElement('img');
          expelImg.src = "https://aden-rpg.pages.dev/assets/expulsar.webp"; expelImg.alt = "Expulsar";
          expelImg.onclick = () => expelMember(m.id);
          actions.appendChild(expelImg);
        }
      } else {
        const meSpan = document.createElement('span'); meSpan.textContent = '(Você)'; actions.appendChild(meSpan);
      }
      li.appendChild(actions); manageMembersList.appendChild(li);
    });

    if (guildNoticeEl) guildNoticeEl.textContent = guildData.notice || '(Nenhum aviso)';
    if (noticeInfoEl) noticeInfoEl.textContent = guildData.last_notice_update ? 'Última atualização: ' + formatDateTime(guildData.last_notice_update) : 'Aviso ainda não atualizado.';
    if (noticeEditor) noticeEditor.style.display = (isLeader || isCoLeader) ? 'block' : 'none';
    if (noticeEditor && editGuildNotice) editGuildNotice.value = '';

    if (guildLogsList) guildLogsList.innerHTML = '';
    try {
      const { data: logs, error } = await supabase.rpc('get_guild_logs', { p_guild_id: guildData.id, p_limit: 50 });
      if (error) throw error;
      if (!logs || logs.length === 0){
        if (guildLogsList) guildLogsList.innerHTML = '<li>Nenhum registro.</li>';
      } else {
        logs.forEach(l => {
          const li = document.createElement('li');
          const actor = l.actor_name || l.actor_id;
          const target = l.target_name || l.target_id;
          let text = `${l.action || ''} - ${l.message || ''} @ ${formatDateTime(l.created_at)}`;
          if (l.action === 'promote') text = `${actor} promoveu ${target} às ${formatDateTime(l.created_at)}`;
          else if (l.action === 'demote') text = `${actor} revogou ${target} às ${formatDateTime(l.created_at)}`;
          else if (l.action === 'expel') text = `${actor} expulsou ${target} às ${formatDateTime(l.created_at)}`;
          else if (l.action === 'join') text = `${target} entrou na guilda às ${formatDateTime(l.created_at)}`;
          else if (l.action === 'leave') text = `${target} saiu da guilda às ${formatDateTime(l.created_at)}`;
          else if (l.action === 'reject') text = `Solicitação de ${l.message} rejeitada por ${actor} às ${formatDateTime(l.created_at)}`;
          else if (l.action === 'notice') text = `Aviso atualizado por ${actor} às ${formatDateTime(l.created_at)}: ${l.message || ''}`;
          li.textContent = text;
          guildLogsList.appendChild(li);
        });
      }
    } catch(e){
      if (guildLogsList) guildLogsList.innerHTML = '<li>Erro ao carregar registros.</li>';
      console.error(e);
    }

    editGuildModal.style.display = 'flex';
    let defaultTab = 'tab-notice';
    if (isLeader) defaultTab = 'tab-edit';
    else if (isCoLeader) defaultTab = 'tab-manage';
    activateEditTab(defaultTab);
  }

  async function promoteToCoLeader(targetId, targetName){
    showConfirmModal(`Tem certeza que deseja promover ${targetName} para co-líder?`, async () => {
      try {
        const { error } = await supabase.rpc('promote_to_co_leader', { p_guild_id: userGuildId, p_requester_id: userId, p_target_id: targetId });
        if (error) throw error;
        await supabase.rpc('log_guild_action', { p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action: 'promote', p_message: null });
        showInfoModal('Promovido com sucesso!', 'success');
        
        // INVALIDA CACHE
        await invalidateGuildCache(userGuildId);
        
        await loadGuildInfo();
        openEditGuildModal(currentGuildData);
      } catch(e){ showInfoModal('Erro ao promover: ' + (e.message || e), 'error'); console.error(e); }
    });
  }

  async function revokeCoLeader(targetId, targetName){
    showConfirmModal(`Tem certeza que deseja revogar co-líder de ${targetName}?`, async () => {
      try {
        const { error } = await supabase.rpc('revoke_co_leader', { p_guild_id: userGuildId, p_requester_id: userId, p_target_id: targetId });
        if (error) throw error;
        await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action:'demote', p_message:null });
        showInfoModal('Cargo de Co-Líder revogado.', 'success');
        
        // INVALIDA CACHE
        await invalidateGuildCache(userGuildId);
        
        await loadGuildInfo();
        openEditGuildModal(currentGuildData);
      } catch(e){ showInfoModal('Erro ao revogar: ' + (e.message || e), 'error'); console.error(e); }
    });
  }

  async function transferLeadership(targetId, targetName){
    showConfirmModal(`Tem certeza que deseja transferir a liderança da guilda para ${targetName}? Esta ação é irreversível!`, async () => {
      try {
        const { error } = await supabase.rpc('transfer_leadership', { p_guild_id: userGuildId, p_old_leader_id: userId, p_new_leader_id: targetId });
        if (error) throw error;
        await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action:'promote', p_message:'transferred_leadership' });
        showInfoModal('Liderança transferida com sucesso!', 'success');
        
        // INVALIDA CACHE
        await invalidateGuildCache(userGuildId);
        
        await loadGuildInfo();
        editGuildModal.style.display = 'none';
      } catch(e){ showInfoModal('Erro ao transferir liderança: ' + (e.message || e), 'error'); console.error(e); }
    });
  }

  async function expelMember(targetId){
    showConfirmModal('Confirmar expulsão?', async () => {
      try {
        const { error } = await supabase.rpc('expel_member', { p_guild_id: userGuildId, p_requester_id: userId, p_member_id: targetId });
        if (error) throw error;
        await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: targetId, p_action:'expel', p_message:null });
        showInfoModal('Membro expulso.', 'success');
        
        // INVALIDA CACHE
        await invalidateGuildCache(userGuildId);
        
        await loadGuildInfo();
        openEditGuildModal(currentGuildData);
      } catch(e){ showInfoModal('Erro ao expulsar: ' + (e.message || e), 'error'); console.error(e); }
    });
  }

  async function acceptRequest(requestId){
    try {
      const { data: req, error: reqErr } = await supabase.from('guild_join_requests').select('player_id').eq('id', requestId).single();
      if (reqErr) throw reqErr;
      if (!req) throw new Error('Solicitação não encontrada');
      const { error } = await supabase.rpc('accept_guild_join_request', { p_guild_id: userGuildId, p_request_id: requestId, p_requester_id: userId });
      if (error) throw error;
      const { data: target } = await supabase.from('players').select('guild_id').eq('id', req.player_id).single();
      if (target && target.guild_id === userGuildId) {
        await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: req.player_id, p_action: 'join', p_message: null });
        showInfoModal('Solicitação aceita!', 'success');
      } else {
        await supabase.rpc('log_guild_action',{ p_guild_id: userGuildId, p_actor_id: userId, p_target_id: req.player_id, p_action: 'reject', p_message: 'Removida automaticamente (jogador já tinha guilda ou não existe).' });
        showInfoModal('Solicitação removida (jogador já está em outra guilda ou não existe).');
      }
      
      // INVALIDA CACHE
      await invalidateGuildCache(userGuildId);
      
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){
      showInfoModal('Erro ao aceitar: ' + (e.message || e), 'error');
      console.error(e);
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    }
  }

  async function rejectRequest(requestId){
    try {
      const { error } = await supabase.rpc('reject_guild_join_request', { p_request_id: requestId, p_requester_id: userId });
      if (error) throw error;
      showInfoModal('Solicitação rejeitada.', 'success');
      
      // Não precisa invalidar cache da guilda inteira, mas para garantir consistência de requests:
      // Como requests não ficam no objeto da guilda, apenas recarrega
      await loadGuildInfo();
      openEditGuildModal(currentGuildData);
    } catch(e){ showInfoModal('Erro ao rejeitar: ' + (e.message || e), 'error'); console.error(e); }
  }

  if (saveGuildChangesBtn){
    saveGuildChangesBtn.addEventListener('click', async () => {
      try {
        const newName = editGuildName ? editGuildName.value.trim() : null;
        const newDesc = editGuildDescription ? editGuildDescription.value.trim() : null;
        const newFlag = editGuildFlagUrl ? editGuildFlagUrl.value.trim() : null;
        const { error } = await supabase.rpc('update_guild_info', { p_guild_id: userGuildId, p_player_id: userId, p_name: newName, p_description: newDesc, p_flag_url: newFlag });
        if (error) throw error;
        showInfoModal('Guilda atualizada com sucesso!', 'success');
        
        // INVALIDA CACHE
        await invalidateGuildCache(userGuildId);
        
        await loadGuildInfo();
        editGuildModal.style.display = 'none';
      } catch(e){ showInfoModal('Erro ao atualizar a guilda: ' + (e.message || e), 'error'); console.error(e); }
    });
  }

  if (saveGuildNoticeBtn){
    saveGuildNoticeBtn.addEventListener('click', async () => {
      try {
        const notice = editGuildNotice ? editGuildNotice.value.trim() : '';
        const { error } = await supabase.rpc('update_guild_notice', { p_guild_id: userGuildId, p_player_id: userId, p_notice: notice });
        if (error) throw error;
        showInfoModal('Aviso da guilda atualizado!', 'success');
        
        // INVALIDA CACHE
        await invalidateGuildCache(userGuildId);
        
        await loadGuildInfo();
        openEditGuildModal(currentGuildData);
      } catch(e){ showInfoModal('Erro ao atualizar aviso: ' + (e.message || e), 'error'); console.error(e); }
    });
  }

  if (searchGuildBtn && searchGuildModal){
    searchGuildBtn.addEventListener('click', ()=>{ searchGuildModal.style.display = 'flex'; if (searchGuildResults) searchGuildResults.innerHTML = ''; if (searchGuildInput) searchGuildInput.value = ''; });
  }
  if (searchCloseBtn) searchCloseBtn.addEventListener('click', ()=> searchGuildModal.style.display = 'none');

  if (searchGuildConfirmBtn){
    searchGuildConfirmBtn.addEventListener('click', async ()=>{
      if (!searchGuildInput) return;
      const q = searchGuildInput.value.trim();
      if (!q){ showInfoModal('Digite um nome para buscar.'); return; }
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
          li.className = 'search-item-clickable';
          if (g.id) { li.dataset.guildId = g.id; }
          else { console.error('Guilda inválida nos resultados de busca:', g); return; }
          li.innerHTML = `<div style="display:flex;align-items:center;text-align: left;gap:8px;"><img src="${g.flag_url||'https://aden-rpg.pages.dev/assets/guildaflag.webp'}" style="width:100px;height:110px;border-radius:4px;"><div><br><strong>${g.name}</strong><div style="font-size:0.9em;color:white;">${g.description||''}</div><div style="font-size:0.85em; color: white;">Membros: ${g.members_count||0}/${g.max_members||0}</div></div></div>`;
          const btnImg = document.createElement('img');
          btnImg.src = "https://aden-rpg.pages.dev/assets/aceitar.webp";
          btnImg.alt = "Solicitar Entrada";
          btnImg.style.cssText = "width: 30px; height: 30px; vertical-align: -1px; margin-left: 5px; cursor: pointer;";
          btnImg.onclick = (e) => { e.stopPropagation(); requestJoinGuild(g.id, g.name); };
          li.appendChild(btnImg);
          searchGuildResults.appendChild(li);
        });
      } catch(e){ console.error('Erro search', e); if (searchGuildResults) searchGuildResults.innerHTML = '<li>Erro ao buscar guildas.</li>'; }
    });
  }
  
  if (searchGuildResults) {
    searchGuildResults.addEventListener('click', (ev) => {
        const item = ev.target.closest('li');
        if (item && item.dataset.guildId) {
            searchGuildModal.style.display = 'none';
            fetchAndDisplayGuildInfo(item.dataset.guildId);
        }
    });
  }

  window.requestJoinGuild = async function(guildId, guildName){
    showPromptModal(`Enviar solicitação para a guilda ${guildName}:`, async (message) => {
        try {
            const { error } = await supabase.rpc('create_guild_join_request', { p_guild_id: guildId, p_player_id: userId, p_message: message });
            if (error) throw error;
            showInfoModal('Solicitação enviada com sucesso!', 'success');
            if (searchGuildModal) searchGuildModal.style.display = 'none';
        } catch(e){ 
            showInfoModal('Erro ao enviar solicitação: ' + (e.message || e), 'error'); 
            console.error(e); 
        }
    });
  };

  if (editCloseBtn) editCloseBtn.addEventListener('click', ()=>{ if (editGuildModal) editGuildModal.style.display = 'none'; });
  if (viewGuildCloseBtn) viewGuildCloseBtn.addEventListener('click', () => { if (viewGuildModal) viewGuildModal.style.display = 'none'; });
  window.addEventListener('click', (ev) => {
    if (ev.target === editGuildModal) editGuildModal.style.display = 'none';
    if (ev.target === searchGuildModal) searchGuildModal.style.display = 'none';
    if (ev.target === createGuildModal) createGuildModal.style.display = 'none';
    if (ev.target === viewGuildModal) viewGuildModal.style.display = 'none';
  });

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

  if (refreshBtn) refreshBtn.addEventListener('click', ()=> {
    if (userGuildId) {
        // INVALIDA CACHE MANUALMENTE
        invalidateGuildCache(userGuildId);
    }
    // Remove cache de ranking do META para forçar atualização
    (async () => {
        const db = await getDB();
        const tx = db.transaction(STORES.META, "readwrite");
        tx.objectStore(STORES.META).delete("guild_ranking_weekly");
        tx.oncomplete = () => loadGuildInfo();
    })();
  });

  const deleteGuildBtn = document.getElementById('deleteguild');
  const leaveGuildBtn = document.getElementById('leaveguild');

  if (deleteGuildBtn) {
    deleteGuildBtn.addEventListener('click', (ev) => {
      ev?.preventDefault();
      if (!userGuildId) {
        showInfoModal('Erro: guilda não encontrada no contexto. Recarregue a página.', 'error');
        return;
      }
      showConfirmModal("Tem certeza que deseja deletar a guilda? Esta ação é irreversível. Todos os dados serão excluídos e você só poderá entrar em outra guilda após 24 horas.", async () => {
        try {
          const { error } = await supabase.rpc('delete_guild', { p_guild_id: userGuildId, p_player_id: userId });
          if (error) throw error;
          showInfoModal('Guilda deletada com sucesso.', 'success');
          
          await invalidateGuildCache(userGuildId);
          userGuildId = null;
          currentGuildData = null;
          await loadGuildInfo();
        } catch (e) {
          showInfoModal('Erro ao deletar guilda: ' + (e.message || e), 'error');
          console.error(e);
        }
      }, true);
    });
  }

  if (leaveGuildBtn) {
    leaveGuildBtn.addEventListener('click', (ev) => {
      ev?.preventDefault();
      showConfirmModal("Tem certeza que você quer sair da guilda? Esta ação é irreversível e você só poderá entrar em outra guilda após 24 horas.", async () => {
        try {
          const { error } = await supabase.rpc('leave_guild', { p_player_id: userId });
          if (error) throw error;
          showInfoModal('Você saiu da guilda.', 'success');
          
          await invalidateGuildCache(userGuildId);
          userGuildId = null;
          currentGuildData = null;
          await loadGuildInfo();
        } catch (e) {
          showInfoModal('Erro ao sair da guilda: ' + (e.message || e), 'error');
          console.error(e);
        }
      }, true);
    });
  }

  const ok = await getUserSession();
  if (ok) await loadGuildInfo();

});

// PUBLIC helpers
function updateGuildNotifications(show) {
    try {
        const editGuildBtn = document.getElementById('editGuildBtn');
        if (!editGuildBtn) return;
        const dot = editGuildBtn.nextElementSibling;
        if (show) {
            if (!dot || !dot.classList.contains('notif-dot-main')) {
                editGuildBtn.insertAdjacentHTML('afterend', '<span class="notif-dot-main"></span>');
            }
        } else {
            if (dot && dot.classList.contains('notif-dot-main')) {
                dot.remove();
            }
        }
    } catch (e) {
        console.error('Erro ao atualizar notificação', e);
    }
}

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

document.getElementById('guildRequestsBtn')?.addEventListener('click', () => {
    updateGuildNotifications(false);
});

document.getElementById('guildNoticeBtn')?.addEventListener('click', () => {
    updateGuildNotifications(false);
    const guildViewMemberListEl = document.getElementById('guildViewMemberList');
    if (guildViewMemberListEl) {
        guildViewMemberListEl.addEventListener('click', (e) => {
            const link = e.target.closest('.player-link');
            if (!link) return;
            const playerId = link.dataset.playerId;
            if (!playerId) return;
            const playerModal = document.getElementById('playerModal');
            if (playerModal) {
                playerModal.style.display = 'flex';
            }
            if (typeof clearModalContent === "function") clearModalContent();
            if (typeof fetchPlayerData === "function") fetchPlayerData(playerId);
        });
    }
});

// Guild Level System
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

function updateGuildXpBar(guildData){
  try {
    const xpFill = document.querySelector('.xp-bar-fill');
    const xpText = document.getElementById('guildXpFill');
    if (!xpFill || !xpText) return;
    const currentXp = Number(guildData?.experience || 0);
    const currentLevel = Number(guildData?.level || 1);
    const neededXp = calculateGuildXpNeeded(currentLevel);
    const percent = neededXp > 0 ? Math.max(0, Math.min(100, Math.floor((currentXp / neededXp) * 100))) : 0;
    xpFill.style.width = percent + '%';
    xpText.textContent = `${currentXp} / ${neededXp}`;
    xpText.setAttribute('aria-valuenow', currentXp);
    xpText.setAttribute('aria-valuemax', neededXp);
  } catch(e){ 
    console.error('updateGuildXpBar error', e); 
  }
}