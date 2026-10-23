// mic-permission.js
// Permissão de MICROFONE das Missões Diárias, no mesmo estilo do modal de notificações/instalação.
// Requer platform.js incluído ANTES deste arquivo. Expõe window.AdenMic:
//   AdenMic.precheck()    -> Promise<boolean>  (false = bloqueado: o modal já foi exibido; NÃO inicie a missão)
//   AdenMic.showBlocked() -> mostra o modal com o tutorial do aparelho (use também ao receber NotAllowedError)
//   AdenMic.getState()    -> 'granted' | 'prompt' | 'denied' | 'unknown'

(function () {
  'use strict';

  let statusObj = null;

  async function getState() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
      const s = await navigator.permissions.query({ name: 'microphone' });
      watch(s);
      return s.state;
    } catch (_) { return 'unknown'; }                 // Safari/iOS antigos não suportam a consulta
  }

  // Se o jogador liberar nas configurações e voltar, o modal fecha sozinho.
  function watch(s) {
    if (statusObj === s) return;
    statusObj = s;
    s.onchange = () => { if (s.state !== 'denied' && !busyOpen()) closeModal(true); };
  }

  // Cobre o caso mais comum: o jogador sai pras Configurações, libera e volta. Onde a consulta existe
  // (Chrome/Android/desktop) o modal fecha sozinho; no iOS (sem consulta) ele fica até o jogador tocar em "Tentar de novo".
  async function recheck() {
    if (!document.getElementById('adenmic-overlay') || busyOpen()) return;
    const st = await getState();
    if (st === 'granted' || st === 'prompt') closeModal(true);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheck(); });
  window.addEventListener('focus', recheck);

  // ─────────────────────────────────────────────
  // Variante do tutorial conforme o aparelho
  // ─────────────────────────────────────────────
  function variant() {
    const P = window.AdenPlatform || {};
    const ua = navigator.userAgent || '';
    const isIOS = !!P.isIOS || /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    if (isIOS) {
      if (P.isPWA) return 'ios-pwa';
      if (P.isIOSSafari) return 'ios-safari';
      return 'ios-other';
    }
    if (isAndroid) {
      if (P.isTWA || P.isLegacyApk) return 'android-twa';      // app real (Play Store / APK antigo): permissão nativa do Android
      if (P.isPWA) return 'android-pwa';                       // PWA: pode estar no Android OU no Chrome (por site)
      return 'android-browser';
    }
    return 'desktop';
  }

  const STEPS = {
    'ios-safari': [
      'Toque no botão <strong>“aA”</strong> (ou no ícone de página) na barra de endereço do Safari.',
      'Toque em <strong>“Ajustes do Site”</strong> (Website Settings).',
      'Em <strong>Microfone</strong>, escolha <strong>“Permitir”</strong>.',
      'Volte para o jogo e toque em <strong>“Tentar de novo”</strong>.',
    ],
    'ios-pwa': [
      'Abra o app <strong>Ajustes</strong> do iPhone/iPad.',
      'Vá em <strong>Safari → Microfone</strong> e escolha <strong>“Perguntar”</strong> ou <strong>“Permitir”</strong>.',
      'Feche o Aden RPG por completo e abra de novo.',
      'Quando o iOS perguntar, toque em <strong>“Permitir”</strong>.',
    ],
    'ios-other': [
      'Abra o app <strong>Ajustes</strong> do iPhone/iPad e procure o navegador que você usa (ex.: Chrome).',
      'Ative a chave de <strong>Microfone</strong>.',
      'Volte para o jogo e toque em <strong>“Tentar de novo”</strong>.',
      'Se não funcionar, abra o jogo pelo <strong>Safari</strong>.',
    ],
    'android-twa': [
      'Abra <strong>Configurações</strong> do celular.',
      'Vá em <strong>Apps</strong> → <strong>Aden RPG Online</strong> → <strong>Permissões</strong> → <strong>Microfone</strong>.',
      'Escolha <strong>“Permitir somente enquanto o app está em uso”</strong>.',
      'Volte ao jogo e toque em <strong>“Tentar de novo”</strong>.',
    ],
    'android-pwa': [
      'Tente primeiro pelas Configurações do celular: <strong>Configurações</strong> → <strong>Apps</strong> → <strong>Aden RPG Online</strong> → <strong>Permissões</strong> → <strong>Microfone</strong> → permita.',
      'Se continuar bloqueado, o Chrome guarda essa permissão separada, por site: abra o <strong>Chrome</strong> → menu (⋮) → <strong>Configurações</strong> → <strong>Configurações de site</strong> → <strong>Microfone</strong>.',
      'Procure <strong>aden-rpg.pages.dev</strong> na lista e mude para <strong>Permitir</strong>.',
      'Volte ao jogo: ao permitir por qualquer um dos caminhos, este aviso fecha sozinho.',
    ],
    'android-browser': [
      'Toque no <strong>ícone de cadeado</strong> (ou de ajustes) à esquerda do endereço, no topo do navegador.',
      'Toque em <strong>Permissões</strong> e depois em <strong>Microfone</strong>.',
      'Escolha <strong>“Permitir”</strong>.',
      'Volte ao jogo e toque em <strong>“Tentar de novo”</strong>.',
    ],
    'desktop': [
      'Clique no <strong>ícone de cadeado</strong> (ou de ajustes) à esquerda do endereço, no topo do navegador.',
      'Ao lado de <strong>Microfone</strong>, escolha <strong>“Permitir”</strong>.',
      'Se o navegador pedir, <strong>recarregue a página</strong>.',
      'Clique em <strong>“Tentar de novo”</strong>.',
    ],
  };

  // ─────────────────────────────────────────────
  // Modal (mesma linguagem visual do pwa-install.js)
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('adenmic-styles')) return;
    const st = document.createElement('style');
    st.id = 'adenmic-styles';
    st.textContent = `
      #adenmic-overlay { position: fixed; inset: 0; z-index: 2147483646; background: rgba(0,0,0,.88);
        display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif;
        animation: adenmicFade .2s ease; padding: 16px; box-sizing: border-box; }
      @keyframes adenmicFade { from { opacity: 0; } to { opacity: 1; } }
      #adenmic-box { background: #1a1a1a; border: 2px solid #8B6914; border-radius: 14px; padding: 26px 22px 22px;
        max-width: 380px; width: 100%; text-align: center; color: #e8e8e8; box-shadow: 0 0 40px rgba(139,105,20,.45);
        max-height: 90vh; overflow-y: auto; box-sizing: border-box; }
      #adenmic-box h3 { margin: 0 0 12px; font-size: 1.15em; color: #FFD700; letter-spacing: .3px; }
      #adenmic-box p { font-size: .92em; line-height: 1.6; color: #ddd; margin: 0 0 12px; text-align: left; }
      .adenmic-steps { text-align: left; margin: 0 0 18px; padding: 0; list-style: none; }
      .adenmic-steps li { display: flex; align-items: flex-start; gap: 10px; font-size: .9em; line-height: 1.5; color: #ddd; margin-bottom: 12px; }
      .adenmic-steps li .num { flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%;
        background: linear-gradient(to top, #7a4e00, #c98c1a); color: #fff; font-weight: bold; font-size: .85em;
        display: flex; align-items: center; justify-content: center; }
      .adenmic-btn { background: linear-gradient(to top, #7a4e00, #c98c1a); color: #fff; border: none; border-radius: 8px;
        padding: 11px 0; font-size: 1em; font-weight: bold; width: 100%; cursor: pointer; letter-spacing: .3px; transition: filter .2s; }
      .adenmic-btn:hover { filter: brightness(1.12); }
      .adenmic-btn.sec { background: transparent; color: #aaa; border: none; padding: 8px 0; font-size: .85em; font-weight: normal; text-decoration: underline; margin-top: 6px; }
    `;
    document.head.appendChild(st);
  }

  const busyOpen = () => document.getElementById('adenmic-overlay')?.dataset.kind === 'busy';

  // Testa se o microfone está livre. O navegador não diz QUEM o usa, mas sinaliza quando está ocupado:
  // getUserMedia falha (NotReadableError/AbortError) ou a trilha nasce silenciada pelo sistema (muted).
  // 'ok' | 'busy' | 'denied'
  async function probe() {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const n = e && e.name;
      if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'denied';
      if (n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError') return 'busy';
      return 'ok';                                       // sem microfone/outro erro: o início da missão trata
    }
    try {
      const tr = stream.getAudioTracks()[0];
      if (!tr || tr.readyState !== 'live') return 'busy';
      await new Promise((r) => setTimeout(r, 700));      // dá tempo de o sistema sinalizar o mute
      return (tr.muted || tr.readyState !== 'live') ? 'busy' : 'ok';
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  function closeModal(granted) {
    const o = document.getElementById('adenmic-overlay');
    if (o) o.remove();
    if (granted) document.dispatchEvent(new CustomEvent('adenmic:granted'));
  }

  function showBlocked() {
    injectStyles();
    closeModal(false);
    const steps = STEPS[variant()] || STEPS.desktop;
    const overlay = document.createElement('div');
    overlay.id = 'adenmic-overlay';
    overlay.innerHTML = `
      <div id="adenmic-box" role="dialog" aria-modal="true">
        <h3>🎙️ Microfone bloqueado</h3>
        <p>O Mestre conversa com você por <strong>voz</strong>, então a aventura só começa com o microfone liberado. Siga os passos para permitir:</p>
        <ol class="adenmic-steps" style="padding:0;list-style:none">
          ${steps.map((t, i) => `<li><span class="num">${i + 1}</span><span>${t}</span></li>`).join('')}
        </ol>
        <button class="adenmic-btn" id="adenmic-retry">Tentar de novo</button>
        <button class="adenmic-btn sec" id="adenmic-close">Fechar</button>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('adenmic-close').addEventListener('click', () => closeModal(false));
    document.getElementById('adenmic-retry').addEventListener('click', async () => {
      const st = await getState();
      if (st === 'granted' || st === 'prompt') { closeModal(true); return; }
      if (st === 'unknown') {                                  // sem consulta de permissão (ex.: iOS): testa de verdade
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
          closeModal(true);
        } catch (_) { /* continua bloqueado: mantém o modal */ }
        return;
      }
      const btn = document.getElementById('adenmic-retry');    // continua negado
      if (btn) { btn.textContent = 'Ainda bloqueado — confira os passos'; setTimeout(() => { if (btn.isConnected) btn.textContent = 'Tentar de novo'; }, 2200); }
    });
  }

  function showBusy() {
    injectStyles();
    closeModal(false);
    const overlay = document.createElement('div');
    overlay.id = 'adenmic-overlay';
    overlay.dataset.kind = 'busy';
    overlay.innerHTML = `
      <div id="adenmic-box" role="dialog" aria-modal="true">
        <h3>🎙️ Microfone em uso</h3>
        <p>O microfone está sendo usado por outro app, ligação ou site. Para a aventura não travar nem ser interrompida, ela só começa com o microfone livre.</p>
        <ol class="adenmic-steps" style="padding:0;list-style:none">
          <li><span class="num">1</span><span>Encerre <strong>ligações</strong>, chamadas de vídeo, gravadores de voz e assistentes de voz.</span></li>
          <li><span class="num">2</span><span>Feche <strong>outros apps e abas</strong> que usem o microfone.</span></li>
          <li><span class="num">3</span><span>Volte aqui e toque em <strong>“Tentar de novo”</strong>.</span></li>
        </ol>
        <button class="adenmic-btn" id="adenmic-retry">Tentar de novo</button>
        <button class="adenmic-btn sec" id="adenmic-close">Fechar</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('adenmic-close').addEventListener('click', () => closeModal(false));
    document.getElementById('adenmic-retry').addEventListener('click', async () => {
      const btn = document.getElementById('adenmic-retry');
      if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
      const r = await probe();
      if (r === 'ok') { closeModal(true); return; }
      if (r === 'denied') { showBlocked(); return; }
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Ainda em uso — tente de novo'; setTimeout(() => { if (btn.isConnected) btn.textContent = 'Tentar de novo'; }, 2200); }
    });
  }

  function showUnsupported() {
    injectStyles();
    closeModal(false);
    const overlay = document.createElement('div');
    overlay.id = 'adenmic-overlay';
    overlay.innerHTML = `
      <div id="adenmic-box">
        <h3>🎙️ Microfone indisponível</h3>
        <p>Este navegador não permite usar o microfone aqui (é preciso uma conexão segura e um navegador atual). Tente pelo <strong>Chrome</strong> ou <strong>Safari</strong> atualizado, ou pelo app instalado.</p>
        <button class="adenmic-btn" id="adenmic-close">Entendi</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('adenmic-close').addEventListener('click', () => closeModal(false));
  }

  // true = pode iniciar. false = bloqueado (modal já exibido).
  async function precheck() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showUnsupported(); return false; }
    const st = await getState();
    if (st === 'denied') { showBlocked(); return false; }
    if (st === 'granted') {                           // já liberado: dá para testar sem abrir pedido de permissão
      const r = await probe();
      if (r === 'denied') { showBlocked(); return false; }
      if (r === 'busy') { showBusy(); return false; }
    }
    return true;                                      // 'prompt'/'granted'/'unknown': o getUserMedia pede/valida na hora
  }

  window.AdenMic = { precheck, showBlocked, showBusy, getState };
})();
