// notifications.js
// Fluxo de opt-in de notificações push (Android + iOS/PWA).
// Requer platform.js e pwa-install.js incluídos ANTES deste arquivo, e roda
// depois que script.js dispara 'aden_player_ready'.
//
// O que este arquivo faz AGORA:
//   - Mostra o modal explicativo (com a recompensa) sempre que o jogador entra
//     no index sem ter decidido ainda sobre notificações.
//   - No iPhone, exige o PWA instalado antes de poder pedir a permissão.
//   - Detecta bloqueio e mostra tutorial rápido de como desbloquear.
//   - Dá 50 de ouro (uma única vez) quando a permissão é concedida.
//   - Se inscreve no Push Manager (fica pronto para quando os gatilhos reais
//     — mineração, PvP, mensagens — forem implementados no backend).
//
// O que ainda depende de configuração futura (fora do escopo deste arquivo):
//   - Gerar um par de chaves VAPID e colocar a pública em VAPID_PUBLIC_KEY.
//   - Rodar a migration SQL (notifications_migration.sql) no Supabase.
//   - Implementar os gatilhos reais (mineração concluída, PvP, mensagens)
//     que chamam a Web Push API do lado do servidor.

(function () {
  'use strict';

  // ⚠️ Troque pela chave pública VAPID real quando for gerá-la (veja o guia).
  const VAPID_PUBLIC_KEY = 'COLOQUE_SUA_VAPID_PUBLIC_KEY_AQUI';

  const REWARD_KEY_PREFIX = 'aden_notif_reward_given_';
  let modalShownThisPageLoad = false;
  let lastKnownPlayer = null;

  // ─────────────────────────────────────────────
  // Helpers de plataforma / suporte
  // ─────────────────────────────────────────────
  function supportsNotifications() {
    return 'Notification' in window;
  }

  function getPlatform() {
    return window.AdenPlatform || { isIOS: false, isApp: false, isBrowser: true };
  }

  // ─────────────────────────────────────────────
  // UI — mesma linguagem visual do pwa-install.js, namespaced à parte
  // pra não colidir com os estilos dele.
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('adennotif-styles')) return;
    const style = document.createElement('style');
    style.id = 'adennotif-styles';
    style.textContent = `
      #adennotif-overlay {
        position: fixed; inset: 0; z-index: 2147483646;
        background: rgba(0,0,0,.88);
        display: flex; align-items: center; justify-content: center;
        font-family: Arial, sans-serif;
        animation: adennotifFadeIn .2s ease;
        padding: 16px; box-sizing: border-box;
      }
      @keyframes adennotifFadeIn { from { opacity: 0; } to { opacity: 1; } }
      #adennotif-box {
        background: #1a1a1a;
        border: 2px solid #8B6914;
        border-radius: 14px;
        padding: 26px 22px 22px;
        max-width: 380px;
        width: 100%;
        text-align: center;
        color: #e8e8e8;
        box-shadow: 0 0 40px rgba(139,105,20,.45);
        max-height: 90vh;
        overflow-y: auto;
        box-sizing: border-box;
      }
      #adennotif-box h3 { margin: 0 0 14px; font-size: 1.15em; color: #FFD700; }
      #adennotif-box p { font-size: .92em; line-height: 1.6; color: #ddd; margin: 0 0 12px; text-align: left; }
      .adennotif-benefits { text-align: left; margin: 0 0 16px; padding-left: 20px; }
      .adennotif-benefits li { font-size: .9em; line-height: 1.55; color: #ddd; margin-bottom: 8px; }
      .adennotif-benefits li strong { color: #FFD700; }
      .adennotif-steps { text-align: left; margin: 0 0 16px; padding: 0; list-style: none; }
      .adennotif-steps li { display: flex; gap: 10px; font-size: .88em; line-height: 1.5; color: #ddd; margin-bottom: 10px; }
      .adennotif-steps li .num {
        flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
        background: linear-gradient(to top, #7a4e00, #c98c1a);
        color: #fff; font-weight: bold; font-size: .8em;
        display: flex; align-items: center; justify-content: center;
      }
      .adennotif-btn-row { display: flex; flex-direction: column; gap: 8px; }
      #adennotif-primary {
        background: linear-gradient(to top, #7a4e00, #c98c1a);
        color: #fff; border: none; border-radius: 8px;
        padding: 11px 0; font-size: 1em; font-weight: bold;
        width: 100%; cursor: pointer;
      }
      #adennotif-primary:hover { filter: brightness(1.12); }
      #adennotif-secondary {
        background: transparent; color: #aaa; border: none;
        padding: 8px 0; font-size: .85em; width: 100%; cursor: pointer;
        text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  }

  function showModal({ title, bodyHtml, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
    injectStyles();
    const old = document.getElementById('adennotif-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'adennotif-overlay';
    overlay.innerHTML = `
      <div id="adennotif-box">
        <h3>${title}</h3>
        ${bodyHtml}
        <div class="adennotif-btn-row">
          <button id="adennotif-primary">${primaryLabel}</button>
          ${secondaryLabel ? `<button id="adennotif-secondary">${secondaryLabel}</button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('adennotif-primary').addEventListener('click', () => {
      overlay.remove();
      if (onPrimary) onPrimary();
    });
    const secBtn = document.getElementById('adennotif-secondary');
    if (secBtn) {
      secBtn.addEventListener('click', () => {
        overlay.remove();
        if (onSecondary) onSecondary();
      });
    }
  }

  // ─────────────────────────────────────────────
  // Modais específicos
  // ─────────────────────────────────────────────
  function showExplainerModal() {
    showModal({
      title: 'Notificações',
      bodyHtml: `
        <p>Clique em permitir para receber notificações e tenha as seguintes vantagens:</p>
        <ul class="adennotif-benefits">
          <li>Receber avisos do progresso do seu personagem (tempo de mineração, chefe mundial, PvP entre outros sistemas).</li>
          <li>Aviso de mensagens privadas.</li>
          <li>Receba <strong>50 de ouro</strong> ao permitir (resgate único).</li>
        </ul>`,
      primaryLabel: 'Permitir Notificações',
      onPrimary: requestPermissionFlow,
      secondaryLabel: 'Agora não',
    });
  }

  function showIOSInstallFirstModal() {
    showModal({
      title: 'Notificações',
      bodyHtml: `
        <p>No iPhone, antes de ativar as notificações você precisa instalar o Aden RPG Online na sua tela de início.</p>
        <p>Depois de instalado, abra o jogo pelo ícone da tela de início — aí sim vai poder ativar e ganhar sua recompensa.</p>`,
      primaryLabel: 'Instalar agora',
      onPrimary: () => { if (window.AdenInstall) window.AdenInstall.trigger(); },
      secondaryLabel: 'Agora não',
    });
  }

  function showBlockedTutorialModal() {
    const platform = getPlatform();
    const steps = platform.isIOS
      ? [
          'Abra o app <strong>Ajustes</strong> do iPhone.',
          'Role até encontrar <strong>Notificações</strong> (ou procure "Aden RPG" direto na busca dos Ajustes).',
          'Toque em <strong>Aden RPG Online</strong> e ative <strong>Permitir Notificações</strong>.',
        ]
      : [
          'Abra <strong>Configurações</strong> do celular.',
          'Vá em <strong>Apps</strong> (ou "Aplicativos") → <strong>Aden RPG Online</strong>.',
          'Toque em <strong>Notificações</strong> e ative a permissão.',
        ];

    showModal({
      title: 'Notificações bloqueadas',
      bodyHtml: `
        <p>Parece que as notificações do jogo estão bloqueadas. Pra ativar e receber sua recompensa de 50 de ouro:</p>
        <ol class="adennotif-steps">
          ${steps.map((s, i) => `<li><span class="num">${i + 1}</span><span>${s}</span></li>`).join('')}
        </ol>`,
      primaryLabel: 'Entendi',
      onPrimary: null,
    });
  }

  function showGoldRewardModal(amount) {
    showModal({
      title: 'Recompensa!',
      bodyHtml: `<p style="text-align:center;">Você ativou as notificações e ganhou <strong style="color:#FFD700;">${amount} de ouro</strong>! 🪙</p>`,
      primaryLabel: 'Show!',
      onPrimary: null,
    });
  }

  // ─────────────────────────────────────────────
  // Pedido de permissão + recompensa + inscrição no push
  // ─────────────────────────────────────────────
  async function requestPermissionFlow() {
    if (!supportsNotifications()) return;
    let result;
    try {
      result = await Notification.requestPermission();
    } catch (e) {
      console.warn('[Notif] erro ao pedir permissão:', e);
      return;
    }

    if (result === 'granted') {
      await grantRewardIfFirstTime();
      subscribeToPush().catch(e => console.warn('[Notif] push subscribe falhou (normal se VAPID ainda não configurado):', e));
    }
    // Se negou ou fechou sem decidir: nada a fazer agora. Na próxima entrada
    // no index o fluxo roda de novo (mostra o tutorial de desbloqueio se negou).
  }

  async function grantRewardIfFirstTime() {
    const player = lastKnownPlayer || window.currentPlayerData || null;
    if (!player || !player.id) return;

    const localKey = REWARD_KEY_PREFIX + player.id;
    if (localStorage.getItem(localKey)) return; // já resgatado neste dispositivo

    if (typeof supabaseClient === 'undefined') {
      console.warn('[Notif] supabaseClient indisponível — recompensa não pôde ser processada.');
      return;
    }

    try {
      const { data, error } = await supabaseClient.rpc('give_notification_reward');
      if (error) {
        console.warn('[Notif] Erro na RPC give_notification_reward:', error.message);
        return;
      }

      localStorage.setItem(localKey, '1');

      if (data && data.success && !data.already_given) {
        // Atualiza o ouro localmente pra refletir na UI sem precisar recarregar
        if (typeof currentPlayerData !== 'undefined' && currentPlayerData) {
          currentPlayerData.gold = data.new_gold ?? (currentPlayerData.gold + 50);
        }
        const goldEl = document.getElementById('playerGold');
        if (goldEl && data.new_gold != null && typeof formatNumberCompact === 'function') {
          goldEl.textContent = formatNumberCompact(data.new_gold);
        }
        showGoldRewardModal(50);
      }
    } catch (e) {
      console.warn('[Notif] Erro inesperado ao resgatar recompensa:', e);
    }
  }

  // ─────────────────────────────────────────────
  // Web Push subscription (fica pronto pros gatilhos futuros)
  // ─────────────────────────────────────────────
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function bufferToBase64(buffer) {
    if (!buffer) return null;
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }

  async function subscribeToPush() {
    if (VAPID_PUBLIC_KEY.startsWith('COLOQUE_')) return; // chave ainda não configurada — sai em silêncio
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    if (typeof supabaseClient !== 'undefined') {
      const platform = getPlatform();
      await supabaseClient.rpc('save_push_subscription', {
        p_endpoint: sub.endpoint,
        p_p256dh: bufferToBase64(sub.getKey('p256dh')),
        p_auth: bufferToBase64(sub.getKey('auth')),
        p_device_type: platform.isIOS ? 'ios' : (platform.isTWA ? 'twa' : 'web'),
      });
    }
  }

  // ─────────────────────────────────────────────
  // Orquestração — decide qual modal (se algum) mostrar
  // ─────────────────────────────────────────────
  function maybeShowFlow() {
    if (modalShownThisPageLoad) return;
    const platform = getPlatform();

    if (!supportsNotifications()) {
      // iOS sem PWA instalado: a API nem existe ainda — orienta a instalar primeiro.
      if (platform.isIOS && !platform.isApp) {
        modalShownThisPageLoad = true;
        showIOSInstallFirstModal();
      }
      return; // outros navegadores sem suporte: não incomoda o jogador
    }

    const state = Notification.permission; // 'default' | 'granted' | 'denied'

    if (state === 'granted') {
      grantRewardIfFirstTime(); // silencioso — só garante que a recompensa foi dada
      return;
    }

    modalShownThisPageLoad = true;

    if (state === 'denied') {
      showBlockedTutorialModal();
      return;
    }

    // state === 'default'
    if (platform.isIOS && !platform.isApp) {
      showIOSInstallFirstModal();
    } else {
      showExplainerModal();
    }
  }

  // Roda depois que o jogador carrega (precisamos do id pra dar a recompensa)
  window.addEventListener('aden_player_ready', (e) => {
    lastKnownPlayer = e.detail || null;
    setTimeout(maybeShowFlow, 1500); // pequeno delay pra não brigar com outros modais de entrada (banimento, pacote inicial etc.)
  });

  window.AdenNotifications = { maybeShowFlow, requestPermissionFlow };
})();
