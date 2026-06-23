document.addEventListener("DOMContentLoaded", async () => {
  const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
  const supabase = window.supabase && window.supabase.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  if (!supabase) { console.error("Supabase não iniciado"); return; }
  
  // =======================================================================
  // NOVO: ADEN GLOBAL DB (INTEGRAÇÃO ZERO EGRESS)
  // =======================================================================
  const GLOBAL_DB_NAME = 'aden_global_db';
  const GLOBAL_DB_VERSION = 7;
  const AUTH_STORE = 'auth_store';
  const PLAYER_STORE = 'player_store';
  
  const GlobalDB = {
      open: function() {
          return new Promise((resolve, reject) => {
              const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
              req.onupgradeneeded = (e) => {
                  const db = e.target.result;
                  if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE, { keyPath: 'key' });
                  if (!db.objectStoreNames.contains(PLAYER_STORE)) db.createObjectStore(PLAYER_STORE, { keyPath: 'key' });
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
      updatePlayerPartial: async function(changes) {
          try {
              const db = await this.open();
              const tx = db.transaction(PLAYER_STORE, 'readwrite');
              const store = tx.objectStore(PLAYER_STORE);
              const currentData = await new Promise(resolve => {
                  const req = store.get('player_data');
                  req.onsuccess = () => resolve(req.result ? req.result.value : null);
                  req.onerror = () => resolve(null);
              });
              if (currentData) {
                  const newData = { ...currentData, ...changes };
                  store.put({ key: 'player_data', value: newData });
              }
          } catch(e) { console.warn("Erro update parcial", e); }
      }
  };

  // --- INÍCIO: NOVAS FUNÇÕES DE CACHE ---
  function setCache(key, data, ttl) {
    const now = new Date();
    const item = {
      data: data,
      expiry: now.getTime() + ttl,
    };
    localStorage.setItem(key, JSON.stringify(item));
  }

  function getCache(key) {
    const itemStr = localStorage.getItem(key);
    if (!itemStr) {
      return null;
    }
    const item = JSON.parse(itemStr);
    const now = new Date();
    if (now.getTime() > item.expiry) {
      localStorage.removeItem(key);
      return null;
    }
    return item.data;
  }

  function getTtlUntilNextMonday() {
    const now = new Date();
    const day = now.getUTCDay(); // 0 (Dom) a 6 (Sáb)
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
  // --- FIM: NOVAS FUNÇÕES DE CACHE ---

  // =========================================================
  // >>> CLOUDINARY UPLOAD FUNCTION (NOVA) <<<
  // =========================================================
  async function uploadGuildFlagToCloudinary(file) {
      const cloudName = 'dbrghqhqy';
      const uploadPreset = 'flag_preset'; // Usando o mesmo preset de imagens otimizadas
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);

      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/upload`, {
          method: 'POST',
          body: formData
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Erro no upload');
      }

      const data = await response.json();
      // Prioriza transformação eager se existir, senão usa a padrão
      if (data.eager && data.eager.length > 0) {
          return data.eager[0].secure_url; 
      }
      return data.secure_url;
  }

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

  let userId = null;
  let userGuildId = null;
  let currentGuildData = null;
  let userRank = 'member'; // leader | co-leader | member

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // DOM references
  const guildNameElement = $('#guildName');
  const guildDescriptionEl = $('#guildDescription');
  const guildMemberListElement = $('#guildMemberList');
  const guildInfoContainer = $('#guildInfoContainer');
  const noGuildContainer = $('#noGuildContainer');
  const editGuildBtn = $('#editGuildBtn');
  const editGuildModal = $('#editGuildModal');
  const editGuildName = $('#editGuildName');
  const editNameInfo = $('#editNameInfo');
  const editGuildDescription = $('#editGuildDescription');
  
  // REFERÊNCIAS ATUALIZADAS PARA UPLOAD
  const editGuildFlagUrl = $('#editGuildFlagUrl'); // Agora Input Hidden
  const guildFlagFileInput = $('#guildFlagFileInput'); // Novo Input File
  const guildUploadStatusText = $('#guildUploadStatusText'); // Novo Texto de Status
  
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
  
  const viewGuildModal = $('#viewGuildModal');
  const viewGuildCloseBtn = $('#viewGuildCloseBtn');
  const guildViewContainer = $('#guildViewContainer');
  const guildViewName = $('#guildViewName');
  const guildViewPower = $('#guildViewPower');
  const guildViewDescription = $('#guildViewDescription');
  const guildViewLevelValue = $('#guildViewLevelValue');
  const guildViewMemberCountHeader = $('#guildViewMemberCountHeader');
  const guildViewMemberList = $('#guildViewMemberList');

  // --- LÓGICA DE UPLOAD DA BANDEIRA (EVENT LISTENER) ---
  if (guildFlagFileInput) {
      guildFlagFileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;

          // UI de Carregando
          if(guildUploadStatusText) {
              guildUploadStatusText.textContent = "Enviando bandeira...";
              guildUploadStatusText.className = "uploading-text";
          }
          if(saveGuildChangesBtn) saveGuildChangesBtn.disabled = true;

          try {
              const uploadedUrl = await uploadGuildFlagToCloudinary(file);
              
              // Sucesso
              if(editGuildFlagUrl) editGuildFlagUrl.value = uploadedUrl; // Preenche o hidden
              
              if(guildUploadStatusText) {
                  guildUploadStatusText.textContent = "Bandeira carregada!";
                  guildUploadStatusText.className = "";
                  guildUploadStatusText.style.color = "#4CAF50"; // Verde
              }
              
          } catch (error) {
              console.error("Erro upload guilda:", error);
              if(guildUploadStatusText) {
                  guildUploadStatusText.textContent = "Erro ao enviar.";
                  guildUploadStatusText.style.color = "#ff5f5f"; // Vermelho
              }
              if(editGuildFlagUrl) editGuildFlagUrl.value = '';
          } finally {
              if(saveGuildChangesBtn) saveGuildChangesBtn.disabled = false;
          }
      });
  }

  // --- Main tabs ---
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

  // --- Edit modal tabs ---
  function activateEditTab(tabId){
    $$('#editTabContent .edit-tab-pane').forEach(p => {
      p.style.display = (p.id === tabId) ? 'block' : 'none';
    });
    $$('#editTabMenu .edit-tab-btn, #editTabs .edit-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));

    markTabNotification(tabId, false);
    if (tabId === 'tab-requests' || tabId === 'tab-notice'){
      updateGuildNotifications(false);
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

  // --- HELPER DE AUTH OTIMISTA (ZERO EGRESS) ---
  async function getLocalUserId() {
    // 1. Tenta GlobalDB
    const globalAuth = await GlobalDB.getAuth();
    if (globalAuth && globalAuth.value && globalAuth.value.user) {
        return globalAuth.value.user.id;
    }

    // 2. Tenta pegar do cache personalizado
    try {
        const cached = localStorage.getItem('player_data_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.data && parsed.data.id && parsed.expires > Date.now()) {
                return parsed.data.id;
            }
        }
    } catch (e) {}

    // 3. Tenta pegar do cache interno do Supabase
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
    // 1. Otimização: Tenta obter ID localmente
    const localId = await getLocalUserId();
    if (localId) {
        userId = localId;
        return true;
    }
    
    // 2. Fallback: Se não achar local, pergunta ao Supabase
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session){ 
        userId = session.user.id; 
        return true; 
    }
    
    console.warn("Sessão não encontrada ou expirada. Redirecionando...");
    window.location.href = 'index.html';
    return false;
  }

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

      // OTIMIZAÇÃO: Cálculo de CP da Guilda via soma local (Zero Egress adicional)
      // Removemos a chamada RPC 'get_guild_power' e usamos a coluna combat_power carregada.
      const guildPowerValue = visiblePlayers.reduce((sum, p) => sum + (Number(p.combat_power) || 0), 0);
      
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
        // Otimização: Tenta pegar guild_id do GlobalDB antes de fazer fetch
        const cachedPlayer = await GlobalDB.getPlayer();
        if (cachedPlayer && cachedPlayer.guild_id) {
            userGuildId = cachedPlayer.guild_id;
        } else {
            const { data: playerData } = await supabase.from('players').select('guild_id').eq('id', userId).single();
            if (!playerData || !playerData.guild_id){
                if (guildInfoContainer) guildInfoContainer.style.display='none';
                if (noGuildContainer) noGuildContainer.style.display='block';
                return;
            }
            userGuildId = playerData.guild_id;
        }
      }
      
      const cacheKey = `guild_info_${userGuildId}`;
      const cachedData = getCache(cacheKey);
      if (cachedData) {
          console.log("Membros da guilda carregados do cache.");
          await renderGuildUI(cachedData);
          return;
      }

      console.log("Buscando dados frescos da guilda (sem cache).");
      const { data: guildData, error: guildError } = await supabase.from('guilds').select(`*, 
        players:players_guild_id_fkey (
            id, 
            name, 
            avatar_url, 
            rank, 
            level, 
            combat_power,
            last_active
        )
    `)
    .eq('id', userGuildId)
    .single();
      if (guildError || !guildData){
        console.error('Erro guildData', guildError);
        if (guildInfoContainer) guildInfoContainer.style.display='none';
        if (noGuildContainer) noGuildContainer.style.display='block';
        return;
      }
      
      setCache(cacheKey, guildData, 24 * 60 * 60 * 1000);
      await renderGuildUI(guildData);

    } catch(e){
      console.error('Erro loadGuildInfo', e);
    }
  }
  
  async function fetchAndDisplayGuildInfo(guildId) {
    if (!viewGuildModal) return;
    try {
        const cacheKey = `guild_view_public_${guildId}`;
        let guildData = getCache(cacheKey);

        if (!guildData) {
            console.log(`Buscando dados públicos da guilda ${guildId} (sem cache ou expirado)`);
            const { data, error: guildError } = await supabase
                .from('guilds')
                .select(`*, 
        players:players_guild_id_fkey (
            id, 
            name, 
            avatar_url, 
            rank, 
            level, 
            combat_power,
            last_active
        )
    `)
    .eq('id', guildId)
    .single();

            if (guildError || !data) {
                console.error('Erro ao buscar dados da guilda', guildError);
                return;
            }
            guildData = data;
            setCache(cacheKey, guildData, getTtlUntilNextMonday());
        }

        const allPlayersInGuild = guildData.players || [];
        const visiblePlayers = allPlayersInGuild.filter(p => p.rank !== 'admin');

        const flagUrl = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
        guildViewName.innerHTML = `<img src="${flagUrl}" style="width:140px;height:150px;margin-right:8px;border-radius:6px;border:vertical-align:4px; margin-left: 18px;"><br> <strong><span style="color: white;">${guildData.name}</span></strong>`;
        guildViewDescription.textContent = guildData.description || '';
        guildViewLevelValue.textContent = guildData.level || 1;
        guildViewMemberCountHeader.textContent = `${visiblePlayers.length} / ${guildData.max_members || getMaxMembers(guildData.level || 1)}`;
        
        // OTIMIZAÇÃO: Soma direta da coluna combat_power (evitando RPC ou iteração de itens)
        const guildPowerValue = visiblePlayers.reduce((sum, p) => sum + (Number(p.combat_power) || 0), 0);
        
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
      const cacheKey = `guild_ranking_weekly`;
      const cachedData = getCache(cacheKey);
      if (cachedData) {
          console.log("Ranking de guildas carregado do cache semanal.");
          renderGuildRanking(cachedData); 
          return;
      }
      
      console.log("Buscando dados frescos do ranking (sem cache ou expirado).");
      // Mantém a RPC, assumindo que o backend agora usa a coluna otimizada para agregar.
      const { data, error } = await supabase.rpc('get_guilds_ranking', { limit_count: 100 });
      if (error) throw error;
      
      setCache(cacheKey, data, getTtlUntilNextMonday());
      renderGuildRanking(data);

    } catch(e){
      console.error('Erro ao carregar ranking', e);
      if (guildRankingList) guildRankingList.innerHTML = '<li>Erro ao carregar ranking.</li>';
    }
  }

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
      
      // LÓGICA DA BANDEIRA ATUALIZADA
      if (editGuildFlagUrl) editGuildFlagUrl.value = guildData.flag_url || '';
      
      // Reseta o status visual do upload
      if (guildUploadStatusText) {
          if (guildData.flag_url) {
              guildUploadStatusText.textContent = "Bandeira atual mantida.";
              guildUploadStatusText.style.color = "#aaa";
          } else {
              guildUploadStatusText.textContent = "Nenhuma bandeira.";
          }
          guildUploadStatusText.className = ""; // Remove animação se houver
      }
      if (guildFlagFileInput) guildFlagFileInput.value = ""; // Reseta o input file

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
        localStorage.removeItem(`guild_info_${userGuildId}`); 
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
        localStorage.removeItem(`guild_info_${userGuildId}`);
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
        localStorage.removeItem(`guild_info_${userGuildId}`);
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
        localStorage.removeItem(`guild_info_${userGuildId}`);
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
      
      if (userGuildId) localStorage.removeItem(`guild_info_${userGuildId}`);
      
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
        localStorage.removeItem(`guild_info_${userGuildId}`);
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
        localStorage.removeItem(`guild_info_${userGuildId}`);
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
        if (data && data.length > 0) {
            userGuildId = data[0].created_guild_id;
            // Atualiza GlobalDB com o novo ID da guilda
            await GlobalDB.updatePlayerPartial({ guild_id: userGuildId });
        }
        if (createGuildMessage) createGuildMessage.textContent = 'Guilda criada';
        setTimeout(()=>{ createGuildModal.style.display = 'none'; loadGuildInfo(); }, 800);
      } catch(e){ if (createGuildMessage) createGuildMessage.textContent = 'Erro: ' + (e.message || e); console.error(e); }
    });
  }

  if (refreshBtn) refreshBtn.addEventListener('click', ()=> {
    if (userGuildId) {
        localStorage.removeItem(`guild_info_${userGuildId}`);
        const today = new Date().toISOString().split('T')[0];
        localStorage.removeItem(`guild_ranking_${today}`);
        localStorage.removeItem(`guild_ranking_weekly`);
    }
    loadGuildInfo();
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
          // Atualiza GlobalDB removendo o guild_id
          await GlobalDB.updatePlayerPartial({ guild_id: null });
          localStorage.removeItem(`guild_info_${userGuildId}`);
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
          // Atualiza GlobalDB removendo o guild_id
          await GlobalDB.updatePlayerPartial({ guild_id: null });
          localStorage.removeItem(`guild_info_${userGuildId}`); 
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

// ═══════════════════════════════════════════════════════════════
//  SOCIAL STATS + FOLLOW SYSTEM — Player Modal (guild.html)
// ═══════════════════════════════════════════════════════════════
(function() {
  const SB_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
  const SB_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';

  function getSBClient() {
    // Prioridade 1: cliente autenticado exposto pelo supabaseClient.js (mesmo padrão do tavernas.js)
    if (window.__guildAuthSB) return window.__guildAuthSB;
    if (window.__guildSB) return window.__guildSB;
    if (window.supabase?.createClient) {
      window.__guildSB = window.supabase.createClient(SB_URL, SB_KEY, {
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true }
      });
      return window.__guildSB;
    }
    return null;
  }

  // Compact number formatter
  function fmtCompact(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n/1e9).toFixed(1).replace(/\.0$/,'') + 'B';
    if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
    return String(n);
  }

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Avatar de fallback (iniciais coloridas), igual ao padrão das tavernas
  function avatarFallback(name) {
    const n = name || '?';
    // [...n][0] respeita surrogate pairs (emojis), ao contrário de charAt(0)
    const rawLetter = ([...n][0] || '?').toUpperCase();
    // Se for emoji ou caractere não-ASCII, usa '?' para não quebrar encodeURIComponent
    const letter = /^[\x00-\x7F]$/.test(rawLetter) ? rawLetter : '?';
    const hue = [...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="hsl(${hue},45%,35%)"/><text x="50%" y="56%" font-size="18" fill="#fff" text-anchor="middle" font-family="sans-serif" font-weight="bold">${letter}</text></svg>`;
    try { return `data:image/svg+xml,${encodeURIComponent(svg)}`; } catch(_) { return ''; }
  }

  // Current player ID (resolved after auth)
  let _guildMyId = null;
  async function getMyId() {
    if (_guildMyId) return _guildMyId;
    // GlobalDB
    const GLOBAL_DB_NAME = 'aden_global_db';
    try {
      const db = await new Promise((res,rej) => {
        const r = indexedDB.open(GLOBAL_DB_NAME, 6);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
      });
      const val = await new Promise(res => {
        const tx  = db.transaction('auth_store','readonly');
        const req = tx.objectStore('auth_store').get('current_session');
        req.onsuccess = () => res(req.result?.value || null);
        req.onerror   = () => res(null);
      });
      if (val?.user?.id) { _guildMyId = val.user.id; return _guildMyId; }
    } catch(e) {}
    // localStorage fallback
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
          const s = JSON.parse(localStorage.getItem(k));
          if (s?.user?.id) { _guildMyId = s.user.id; return _guildMyId; }
        }
      }
    } catch(e) {}
    return null;
  }

  // Following / Followers sets (session cache)
  let _gFollowingSet = null;
  let _gFollowersSet = null;
  const _gFollowCooldowns = {};
  const _FOLLOW_CD_MS = 30_000;

  async function ensureFollowSets() {
    const sb = getSBClient();
    const myId = await getMyId();
    if (!sb || !myId) return;
    if (_gFollowingSet === null) {
      _gFollowingSet = new Set();
      try {
        const { data } = await sb.rpc('get_following_ids', { p_player_id: myId });
        (data || []).forEach(r => _gFollowingSet.add(r.id));
      } catch(e) {}
    }
    if (_gFollowersSet === null) {
      _gFollowersSet = new Set();
      try {
        const { data } = await sb.from('player_follows').select('follower_id').eq('following_id', myId);
        (data || []).forEach(r => _gFollowersSet.add(r.follower_id));
      } catch(e) {}
    }
  }

  function updateFollowBtn(btn, targetId) {
    if (!btn) return;
    const isF      = _gFollowingSet?.has(targetId) ?? false;
    const followsMe= _gFollowersSet?.has(targetId) ?? false;
    const isMutual = isF && followsMe;
    if (isMutual) {
      btn.innerHTML = `<svg viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:14px;flex-shrink:0;"><path d="M1 7l3.5 3.5L9 3"/><path d="M8 7l3.5 3.5L16 3"/></svg>Amigos`;
      btn.style.background  = 'rgba(80,200,160,0.22)';
      btn.style.borderColor = 'rgba(80,200,160,0.65)';
      btn.style.color       = '#3fcfa8';
    } else if (isF) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px;flex-shrink:0;"><path d="M20 6L9 17l-5-5"/></svg>Seguindo`;
      btn.style.background  = 'rgba(122,184,255,0.22)';
      btn.style.borderColor = 'rgba(122,184,255,0.6)';
      btn.style.color       = '#7ab8ff';
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px;flex-shrink:0;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>Seguir`;
      btn.style.background  = 'rgba(122,184,255,0.08)';
      btn.style.borderColor = 'rgba(122,184,255,0.3)';
      btn.style.color       = '#7ab8ff';
    }
  }

  // ── Confirmação: deixar de seguir ──
  function showUnfollowConfirm(targetName) {
    return new Promise(resolve => {
      const modal  = document.getElementById('pm-unfollow-confirm');
      const txt    = document.getElementById('pm-unfollow-text');
      const yesBtn = document.getElementById('pm-unfollow-yes');
      const noBtn  = document.getElementById('pm-unfollow-no');
      if (!modal || !yesBtn || !noBtn) { resolve(true); return; }
      const name = targetName || document.getElementById('playerName')?.textContent || 'este jogador';
      txt.textContent = `Tem certeza que deseja deixar de seguir ${name}?`;
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

  async function toggleFollow(targetId, targetName) {
    const sb   = getSBClient();
    const myId = await getMyId();
    if (!sb || !myId || !targetId || targetId === myId) return;
    const now  = Date.now();
    const last = _gFollowCooldowns[targetId] || 0;
    if (now - last < _FOLLOW_CD_MS) return;

    await ensureFollowSets();
    const btn = document.getElementById('pm-follow-btn');
    const isF = _gFollowingSet?.has(targetId);

    if (isF) {
      const confirmed = await showUnfollowConfirm(targetName);
      if (!confirmed) return;
    }

    _gFollowCooldowns[targetId] = now;

    if (isF) {
      // ── RPC PRIMEIRO — só atualiza UI se o banco confirmar ──
      let ufRes = null;
      try {
        const { data, error } = await sb.rpc('unfollow_with_bond_check', { p_target_id: targetId });
        if (error) throw error;
        ufRes = data;
      } catch(e) {
        console.error('[unfollow] RPC falhou:', e);
        if (typeof showToast === 'function') showToast('Erro ao deixar de seguir. Tente novamente.');
        return;
      }
      _gFollowingSet.delete(targetId);
      updateFollowBtn(btn, targetId);
      if (ufRes?.had_bond) {
        const lbl = ufRes.bond_type === 'couple' ? 'Casal' : 'Melhor Amigo(a)';
        if (typeof showToast === 'function') showToast(`Laço de ${lbl} com ${targetName || 'jogador'} foi desfeito.`);
      }
    } else {
      _gFollowingSet.add(targetId);
      updateFollowBtn(btn, targetId);
      try { await sb.rpc('follow_player', { p_following_id: targetId }); } catch(e) {}
      // Registra notificação persistida (Supabase) para o alvo —
      // entregue quando ele entrar nas tavernas, mesmo offline agora
      try { await sb.rpc('register_follow_notification', { p_target_id: targetId }); } catch(e) {}
    }
    // Atualiza o contador de seguidores no modal
    const foEl = document.getElementById('pm-followers-val');
    if (foEl) {
      const cur = parseInt(foEl.textContent.replace(/\D/g,'')) || 0;
      foEl.textContent = fmtCompact(Math.max(0, isF ? cur - 1 : cur + 1));
    }
  }

  // Load social stats for a player
  async function loadSocialStats(playerId) {
    const sb = getSBClient();
    if (!sb || !playerId) return;

    const cacheKey = 'guild_sstats_' + playerId;
    let stats = { fame: 0, followers: 0, following: 0, gifts: 0 };
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { v, t } = JSON.parse(cached);
        if (Date.now() - t < 3 * 60_000) stats = v;
      }
      if (!stats.fame && !stats.followers && !stats.gifts) {
        const { data } = await sb.rpc('get_social_stats', { p_player_id: playerId });
        if (data) {
          stats = { fame: data.fame || 0, followers: data.followers || 0, following: data.following || 0, gifts: data.gifts || 0 };
          sessionStorage.setItem(cacheKey, JSON.stringify({ v: stats, t: Date.now() }));
        }
      }
    } catch(e) {}

    // Only update if this modal is still open for the same player
    if (window._guildModalLastPid !== playerId) return;
    const foEl  = document.getElementById('pm-followers-val');
    const figEl = document.getElementById('pm-following-val');
    const fmEl  = document.getElementById('pm-fame-val');
    const giEl  = document.getElementById('pm-gifts-val');
    if (foEl)  { foEl.textContent  = fmtCompact(stats.followers); foEl.style.opacity = '1'; }
    if (figEl) { figEl.textContent = fmtCompact(stats.following); figEl.style.opacity = '1'; }
    if (fmEl)  { fmEl.textContent  = fmtCompact(stats.fame);      fmEl.style.opacity  = '1'; }
    if (giEl)  { giEl.textContent  = fmtCompact(stats.gifts);     giEl.style.opacity  = '1'; }
  }

  // Reset social section to loading state
  function resetSocialSection() {
    ['pm-followers-val','pm-following-val','pm-fame-val','pm-gifts-val'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '—'; el.style.opacity = '0.4'; }
    });
  }

  // ══════════════════════════════════════════
  //  SOCIAL LIST MODAL (Seguidores / Seguindo)
  // ══════════════════════════════════════════
  const _psl = { type:'followers', pid:null, page:0, loading:false, exhausted:false };

  async function openSocialListModal(type, pid) {
    const modal   = document.getElementById('pm-social-list-modal');
    const titleEl = document.getElementById('psl-title');
    const listEl  = document.getElementById('psl-list');
    if (!modal || !listEl || !pid) return;

    Object.assign(_psl, { type, pid, page:0, loading:false, exhausted:false });
    if (titleEl) titleEl.textContent = type === 'following' ? 'Seguindo' : 'Seguidores';
    listEl.innerHTML = '<div class="pmx-empty">Carregando...</div>';
    modal.classList.add('open');

    listEl.onscroll = () => {
      if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 60) {
        loadSocialListPage(listEl);
      }
    };
    await loadSocialListPage(listEl, true);
  }

  async function loadSocialListPage(listEl, isFirst = false) {
    if (_psl.loading || _psl.exhausted) return;
    _psl.loading = true;

    const sb = getSBClient();
    if (!sb) {
      if (isFirst) listEl.innerHTML = '<div class="pmx-empty">Sem conexão.</div>';
      _psl.loading = false;
      return;
    }

    const rpc   = _psl.type === 'following' ? 'get_following' : 'get_followers';
    const empty = _psl.type === 'following' ? 'Não está seguindo ninguém.' : 'Nenhum seguidor.';

    try {
      const { data, error } = await sb.rpc(rpc, {
        p_player_id: _psl.pid,
        p_limit:     10,
        p_offset:    _psl.page * 10
      });
      if (error) throw error;

      if (isFirst) listEl.innerHTML = '';
      const rows = data || [];
      if (!rows.length && isFirst) {
        listEl.innerHTML = `<div class="pmx-empty">${empty}</div>`;
        _psl.exhausted = true;
        _psl.loading   = false;
        return;
      }
      if (rows.length < 10) _psl.exhausted = true;

      rows.forEach(p => {
        const av  = p.avatar_url || avatarFallback(p.name || '?');
        const row = document.createElement('div');
        row.className = 'pmx-row';
        row.innerHTML = `
          <div class="pmx-av"><img src="${escHtml(av)}" onerror="this.src='${avatarFallback(p.name||'?')}'"></div>
          <div class="pmx-text">
            <strong>${escHtml(p.name||'?')}</strong>
            <div class="pmx-time">${fmtCompact(p.combat_power||0)} CP</div>
          </div>`;
        row.onclick = () => {
          document.getElementById('pm-social-list-modal')?.classList.remove('open');
          openPlayerModalById(p.id);
        };
        listEl.appendChild(row);
      });

      _psl.page++;
    } catch(e) {
      console.warn('loadSocialListPage:', e);
      if (isFirst) listEl.innerHTML = '<div class="pmx-empty">Erro ao carregar.</div>';
    }
    _psl.loading = false;
  }

  // ══════════════════════════════════════════
  //  GIFTERS MODAL (Top Presenteadores)
  //  Top 10 — quem mais deu fama em presentes
  //  para o jogador alvo. Cache leve (3 min).
  // ══════════════════════════════════════════
  const _GIFTERS_CACHE_TTL = 3 * 60_000;

  async function openGiftersModal(pid) {
    const modal  = document.getElementById('pm-gifters-modal');
    const listEl = document.getElementById('pgf-list');
    if (!modal || !listEl || !pid) return;

    listEl.innerHTML = '<div class="pmx-empty">Carregando...</div>';
    modal.classList.add('open');

    const cacheKey = 'guild_gifters_' + pid;
    let rows = null;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { v, t } = JSON.parse(cached);
        if (Date.now() - t < _GIFTERS_CACHE_TTL) rows = v;
      }
    } catch(e) {}

    if (!rows) {
      const sb = getSBClient();
      if (!sb) {
        listEl.innerHTML = '<div class="pmx-empty">Sem conexão.</div>';
        return;
      }
      try {
        const { data, error } = await sb.rpc('get_tavern_gifters', { p_player_id: pid, p_limit: 10 });
        if (error) throw error;
        rows = data || [];
        sessionStorage.setItem(cacheKey, JSON.stringify({ v: rows, t: Date.now() }));
      } catch(e) {
        console.warn('get_tavern_gifters:', e);
        listEl.innerHTML = '<div class="pmx-empty">Erro ao carregar.</div>';
        return;
      }
    }

    if (!rows.length) {
      listEl.innerHTML = '<div class="pmx-empty">Nenhum presente recebido ainda.</div>';
      return;
    }

    listEl.innerHTML = '';
    rows.forEach((g, i) => {
      const pos = i + 1;
      const av  = g.avatar_url || avatarFallback(g.name || '?');
      const qty = g.total_qty || 0;
      const row = document.createElement('div');
      row.className = 'pmx-gifter-row' + (pos <= 3 ? ' top-' + pos : '');
      row.innerHTML = `
        <div class="pmx-gifter-pos">${pos}</div>
        <div class="pmx-gifter-av"><img src="${escHtml(av)}" onerror="this.src='${avatarFallback(g.name||'?')}'"></div>
        <div class="pmx-gifter-info">
          <span class="pmx-gifter-name">${escHtml(g.name || '?')}</span>
          <div class="pmx-gifter-sub">${fmtCompact(qty)} presente${qty === 1 ? '' : 's'} enviado${qty === 1 ? '' : 's'}</div>
        </div>
        <div class="pmx-gifter-fame">+${fmtCompact(g.total_fame || 0)}</div>`;
      row.onclick = () => {
        modal.classList.remove('open');
        openPlayerModalById(g.id);
      };
      listEl.appendChild(row);
    });
  }

  // ══════════════════════════════════════════
  //  GUILD INFO MODAL (clique na bandeira/nome da guilda do jogador)
  // ══════════════════════════════════════════
  async function openGuildInfoModal(guildId) {
    if (!guildId) return;
    const modal  = document.getElementById('pm-guild-info-modal');
    if (!modal) return;
    modal.classList.add('open');

    const nameEl  = document.getElementById('pgi-name');
    const descEl  = document.getElementById('pgi-desc');
    const lvlEl   = document.getElementById('pgi-level');
    const membEl  = document.getElementById('pgi-members');
    const flagEl  = document.getElementById('pgi-flag');
    const listEl  = document.getElementById('pgi-member-list');
    const joinRow = document.getElementById('pgi-join-row');
    const joinBtn = document.getElementById('pgi-join-btn');
    const titleEl = document.getElementById('pgi-title');

    if (nameEl)  nameEl.textContent = 'Carregando...';
    if (descEl)  descEl.textContent = '';
    if (listEl)  listEl.innerHTML   = '';
    // Esconde e reseta o botão para não herdar estado de outra guilda
    if (joinRow) joinRow.style.display = 'none';
    if (joinBtn) {
      joinBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Solicitar Entrada`;
      joinBtn.disabled = false;
      joinBtn.classList.remove('pgi-requested');
    }
    window._pgiGuildId = guildId;

    const cacheKey = 'tgm_guild_' + guildId;
    let guildData = null;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { v, t } = JSON.parse(cached);
        if (Date.now() - t < 10 * 60 * 1000) guildData = v;
      }
      if (!guildData) {
        const sb = getSBClient();
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

    const allMembers = (guildData.players || []).filter(p => p.rank !== 'admin');
    const maxM       = guildData.max_members || 30;

    if (flagEl) flagEl.src         = guildData.flag_url || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
    if (nameEl) nameEl.textContent = guildData.name || '';
    if (descEl) descEl.textContent = guildData.description || '';
    if (lvlEl)  lvlEl.textContent  = 'Nv. ' + (guildData.level || 1);
    if (membEl) membEl.textContent = allMembers.length + ' / ' + maxM + ' membros';
    if (titleEl) titleEl.textContent = guildData.name || 'Guilda';

    // Botão de solicitar entrada — mostra se o jogador atual não tem guilda
    try {
      const myId = await getMyId();
      let myGuildId = null;
      try {
        const cached = localStorage.getItem('player_data_cache');
        if (cached) myGuildId = JSON.parse(cached)?.data?.guild_id || null;
      } catch(e) {}
      if (!myGuildId && myId) {
        const sb = getSBClient();
        const { data } = await sb.from('players').select('guild_id').eq('id', myId).maybeSingle();
        myGuildId = data?.guild_id || null;
      }
      const isInThisGuild = myGuildId === guildId;
      if (joinRow && !myGuildId && !isInThisGuild) {
        joinRow.style.display = 'flex';
        // Verifica localStorage: já solicitou antes?
        try {
          const reqs = JSON.parse(localStorage.getItem('tav_guild_requests') || '{}');
          if (reqs[guildId]) {
            _pgiSetJoinRequested(document.getElementById('pgi-join-btn'));
            // Verifica se o líder já rejeitou (async, não bloqueia render)
            _pgiVerifyRequest(guildId, myId, getSBClient()).then(stillPending => {
              if (!stillPending) {
                try { const r = JSON.parse(localStorage.getItem('tav_guild_requests')||'{}'); delete r[guildId]; localStorage.setItem('tav_guild_requests', JSON.stringify(r)); } catch(_) {}
                const b = document.getElementById('pgi-join-btn');
                if (b) { b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Solicitar Entrada`; b.disabled = false; b.classList.remove('pgi-requested'); }
              }
            });
          }
        } catch(_) {}
      }
    } catch(e) {}

    // Lista de membros
    const ROLE_LABEL = { leader: 'Líder', 'co-leader': 'Co-Líder', member: 'Membro' };
    const ROLE_ORDER = { leader: 0, 'co-leader': 1, member: 2 };
    const sorted = allMembers.slice().sort((a,b) => (ROLE_ORDER[a.rank]??2) - (ROLE_ORDER[b.rank]??2));
    if (listEl) {
      sorted.forEach(m => {
        const av  = m.avatar_url || avatarFallback(m.name || '?');
        const row = document.createElement('div');
        row.className = 'pmx-row';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <div class="pmx-av"><img src="${escHtml(av)}" onerror="this.src='${avatarFallback(m.name||'?')}'"></div>
          <div class="pmx-text">
            <strong>${escHtml(m.name || '?')}</strong>
            <div class="pmx-time">Nv. ${m.level || 1} · PC ${fmtCompact(m.combat_power || 0)}</div>
          </div>
          <div class="pmx-member-role">${ROLE_LABEL[m.rank] || 'Membro'}</div>`;
        row.onclick = () => {
          modal.classList.remove('open');
          openPlayerModalById(m.id);
        };
        listEl.appendChild(row);
      });
    }
  }

  async function guildInfoJoinRequest() {
    const guildId = window._pgiGuildId;
    if (!guildId) return;
    const sb = getSBClient();
    const myId = await getMyId();
    if (!sb || !myId) return;
    const btn = document.getElementById('pgi-join-btn');
    if (btn) btn.disabled = true;
    try {
      const { error } = await sb.rpc('create_guild_join_request', {
        p_guild_id:  guildId,
        p_player_id: myId,
        p_message:   ''
      });
      if (error) throw error;
      // Persiste estado no localStorage compartilhado com tavernas/ranking
      try {
        const reqs = JSON.parse(localStorage.getItem('tav_guild_requests') || '{}');
        reqs[guildId] = true;
        localStorage.setItem('tav_guild_requests', JSON.stringify(reqs));
      } catch(_) {}
      _pgiSetJoinRequested(btn);
    } catch(e) {
      if (btn) btn.disabled = false;
      console.warn('guildInfoJoinRequest:', e);
    }
  }

  // ── Helpers de solicitação de guilda (compartilhados c/ tavernas/ranking) ──
  function _pgiSetJoinRequested(btn) {
    if (!btn) return;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><polyline points="20 6 9 17 4 12"/></svg> Solicitado`;
    btn.disabled = true;
    btn.classList.add('pgi-requested');
  }

  async function _pgiVerifyRequest(guildId, myId, sb) {
    try {
      if (!sb || !myId) return true;
      const { data } = await sb.from('guild_join_requests').select('id').eq('guild_id', guildId).eq('player_id', myId).maybeSingle();
      return !!data;
    } catch(_) { return true; }
  }

  // ══════════════════════════════════════════
  //  Abre o modal de perfil para outro jogador (a partir de uma lista)
  // ══════════════════════════════════════════
  function openPlayerModalById(pid) {
    if (!pid) return;
    const playerModal = document.getElementById('playerModal');
    if (playerModal) playerModal.style.display = 'flex';
    window._guildModalLastPid = pid;
    resetSocialSection();
    setupModalSocial(pid);
    if (typeof window.fetchPlayerData === 'function') window.fetchPlayerData(pid);
  }

  // ══════════════════════════════════════════
  //  Configura botão de seguir + stats sociais + link p/ guilda do jogador
  // ══════════════════════════════════════════
  async function setupModalSocial(playerId) {
    const myId = await getMyId();

    const followBtn = document.getElementById('pm-follow-btn');
    if (followBtn) {
      if (!myId || playerId === myId) {
        followBtn.style.display = 'none';
      } else {
        followBtn.style.display = 'flex';
        ensureFollowSets().then(() => updateFollowBtn(followBtn, playerId));
        followBtn.onclick = () => toggleFollow(playerId);
      }
    }

    // Seguidores / Seguindo → abre lista
    const followersWrap = document.getElementById('pm-followers-wrap');
    const followingWrap = document.getElementById('pm-following-wrap');
    if (followersWrap) followersWrap.onclick = () => openSocialListModal('followers', playerId);
    if (followingWrap) followingWrap.onclick = () => openSocialListModal('following', playerId);

    // Presentes → abre ranking de presenteadores
    const giftsWrap = document.getElementById('pm-gifts-wrap');
    if (giftsWrap) giftsWrap.onclick = () => openGiftersModal(playerId);

    // Bandeira/nome da guilda → abre modal de informações da guilda
    const guildFlagEl = document.getElementById('playerGuildFlag');
    const guildNameEl = document.getElementById('playerGuildName');
    const openGuild = () => {
      const gid = window._tavModalCurrentGuildId;
      if (gid) openGuildInfoModal(gid);
    };
    if (guildFlagEl) { guildFlagEl.onclick = openGuild; guildFlagEl.style.cursor = 'pointer'; }
    if (guildNameEl) { guildNameEl.onclick = openGuild; guildNameEl.style.cursor = 'pointer'; }

    setTimeout(() => {
      if (window._guildModalLastPid === playerId) loadSocialStats(playerId);
    }, 200);
  }

  // Expõe globalmente para o botão "Solicitar Entrada" do modal de guilda
  window.guildInfoJoinRequest = guildInfoJoinRequest;

  // Main: hook into player modal opens
  document.addEventListener('DOMContentLoaded', async () => {
    await getMyId();

    // Intercept every click that opens the player modal
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.player-link');
      if (!link) return;
      const playerId = link.dataset.playerId;
      if (!playerId) return;

      window._guildModalLastPid = playerId;
      resetSocialSection();
      setupModalSocial(playerId);
    });

    const joinBtn = document.getElementById('pgi-join-btn');
    if (joinBtn) joinBtn.onclick = guildInfoJoinRequest;
  });
})();