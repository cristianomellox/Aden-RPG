
(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // CONFIGURAÇÃO
  // ─────────────────────────────────────────────
  const DOWNLOAD_URL   = '/download.html';
  const SESSION_KEY    = 'aden_browser_warning_shown';
  const INTRO_LS_KEY   = 'aden_intro_seen_v32';   // mesmo do script.js

  // Páginas "pesadas" que exigem o app instalado (PWA ou TWA).
  const BLOCKED_PAGES  = [
    'capital2.html',
  ];

  // ── Alcance do redirecionamento pra /download.html no navegador comum ──
  // false (padrão) = só as páginas de BLOCKED_PAGES redirecionam pro download.
  // true  = QUALQUER página do jogo redireciona pro download se acessada por
  //         navegador comum (sem PWA/TWA instalado). Ajuste aqui se quiser esse
  //         comportamento mais restritivo.
  const REDIRECT_ALL_PAGES_IF_BROWSER = true;
  const PAGES_EXEMPT_FROM_REDIRECT = ['download.html']; // só usado se a flag acima for true

  // ─────────────────────────────────────────────
  // DETECÇÃO DE PLATAFORMA (definida em platform.js — inclua-o ANTES deste arquivo)
  // ─────────────────────────────────────────────
  const platform = window.AdenPlatform || {
    type: 'browser', isBrowser: true, isPWA: false, isTWA: false,
    isLegacyApk: false, isApp: false, showsStoreComingSoon: false
  };

  const currentPage   = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const isBlockedPage = BLOCKED_PAGES.includes(currentPage);
  const isIndex       = currentPage === 'index.html' || currentPage === '';

  // ─────────────────────────────────────────────
  // CONFIGURAÇÃO DE PAGAMENTOS
  // ─────────────────────────────────────────────

  const PACKAGES = [
    {
      label:          '140 Ouro',
      displayName:    'Ouro x140 — R$ 4,90',
      pixCode:        '00020126920014BR.GOV.BCB.PIX01365e1402f9-3921-4e3d-9af1-793ecd462fcf0230140 de ouro em Aden RPG Online52040000530398654044.905802BR5923CRISTIANO MELLO VARELLA6008MESQUITA62110507gold1406304E46B',
      paypalId:       'CCFYHGHQM9BQS',
      telegramLabel:  '140 Ouro (R$ 4,90)'
    },
    {
      label:          '450 Ouro',
      displayName:    'Ouro x420 + 30 Bônus — R$ 14,90',
      pixCode:        '00020126920014BR.GOV.BCB.PIX01365e1402f9-3921-4e3d-9af1-793ecd462fcf0230450 de ouro em Aden RPG Online520400005303986540514.905802BR5923CRISTIANO MELLO VARELLA6008MESQUITA62110507gold4506304ADB1',
      paypalId:       'U2CRRPZZZZUMG',
      telegramLabel:  '420 + 30 Bônus Ouro (R$ 14,90)'
    },
    {
      label:          '1250 Ouro',
      displayName:    'Ouro x1000 + 250 Bônus — R$ 37,90',
      pixCode:        '00020126930014BR.GOV.BCB.PIX01365e1402f9-3921-4e3d-9af1-793ecd462fcf02311250 de ouro em Aden RPG Online520400005303986540537.905802BR5923CRISTIANO MELLO VARELLA6008MESQUITA62120508gold12506304B076',
      paypalId:       '56D6MT9P6VNJJ',
      telegramLabel:  '1000 + 250 Bônus Ouro (R$ 37,90)'
    }
  ];

  // ─────────────────────────────────────────────
  // ESTILOS DO MODAL (injetados uma única vez)
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('bg-guard-styles')) return;
    const style = document.createElement('style');
    style.id    = 'bg-guard-styles';
    style.textContent = `
      #bg-guard-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,.88);
        display: flex; align-items: center; justify-content: center;
        font-family: Arial, sans-serif;
        animation: bgFadeIn .25s ease;
      }
      @keyframes bgFadeIn { from { opacity: 0; } to { opacity: 1; } }

      #bg-guard-box {
        background: #1a1a1a;
        border: 2px solid #8B6914;
        border-radius: 14px;
        padding: 28px 22px 22px;
        max-width: 360px;
        width: 90%;
        text-align: center;
        color: #e8e8e8;
        box-shadow: 0 0 40px rgba(139,105,20,.45);
      }
      #bg-guard-box .bg-guard-icon {
        width: 52px; height: 52px; margin-bottom: 12px;
      }
      #bg-guard-box p {
        font-size: .93em; line-height: 1.65;
        margin: 0 0 20px; color: #ddd;
      }
      #bg-guard-box p a {
        color: #FFD700; text-decoration: underline;
      }
      #bg-guard-btn {
        background: linear-gradient(to top, #7a4e00, #c98c1a);
        color: #fff; border: none; border-radius: 8px;
        padding: 11px 0; font-size: 1em; font-weight: bold;
        width: 100%; cursor: pointer; letter-spacing: .3px;
        transition: filter .2s;
      }
      #bg-guard-btn:hover { filter: brightness(1.12); }

      /* ── Estilos dos modais de pagamento ── */
      #pay-modal-overlay {
        position: fixed; inset: 0; z-index: 3500;
        background: rgba(0,0,0,.88);
        display: flex; align-items: center; justify-content: center;
        font-family: Arial, sans-serif;
        animation: bgFadeIn .2s ease;
      }
      #pay-modal-box {
        background: #1a1a1a;
        border: 2px solid #8B6914;
        border-radius: 14px;
        padding: 26px 20px 20px;
        max-width: 370px;
        width: 92%;
        text-align: center;
        color: #e8e8e8;
        box-shadow: 0 0 40px rgba(139,105,20,.45);
        max-height: 90vh;
        overflow-y: auto;
        box-sizing: border-box;
      }
      #pay-modal-box h3 {
        margin: 0 0 10px;
        font-size: 1.15em;
        color: #FFD700;
        letter-spacing: .3px;
      }
      #pay-modal-box .pay-desc {
        font-size: .9em;
        color: #ccc;
        line-height: 1.6;
        margin: 0 0 18px;
      }
      #pay-modal-box .pay-sub {
        font-size: .82em;
        color: #aaa;
        margin: 0 0 18px;
      }
      .pay-btn-row {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 4px;
      }
      .pay-btn {
        flex: 1;
        border: none;
        border-radius: 8px;
        padding: 11px 0;
        font-size: .95em;
        font-weight: bold;
        cursor: pointer;
        transition: filter .2s;
        letter-spacing: .3px;
      }
      .pay-btn:hover { filter: brightness(1.13); }
      .pay-btn-no {
        background: #333;
        color: #bbb;
        border: 1px solid #555;
      }
      .pay-btn-yes {
        background: linear-gradient(to top, #7a4e00, #c98c1a);
        color: #fff;
      }
      .pay-btn-copy {
        background: linear-gradient(to top, #1a4a1a, #2d8c2d);
        color: #fff;
        width: 100%;
        margin-bottom: 14px;
        font-size: .9em;
      }
      .pay-btn-send {
        background: linear-gradient(to top, #7a4e00, #c98c1a);
        color: #fff;
        width: 100%;
        margin-top: 14px;
      }
      .pay-btn-understood {
        background: linear-gradient(to top, #7a4e00, #c98c1a);
        color: #fff;
        width: 100%;
        margin-top: 6px;
      }
      .pay-gold-notice {
        color: #FFD700;
        font-weight: bold;
        font-size: .85em;
        margin: 14px 0 0;
        line-height: 1.5;
      }
      .pay-file-label {
        display: block;
        font-size: .84em;
        color: #bbb;
        margin-bottom: 8px;
        margin-top: 2px;
      }
      .pay-file-input {
        width: 100%;
        box-sizing: border-box;
        background: #252525;
        border: 1px solid #555;
        border-radius: 6px;
        color: #ddd;
        padding: 7px 8px;
        font-size: .83em;
        cursor: pointer;
      }
      .pay-file-input::-webkit-file-upload-button {
        background: #444;
        color: #ddd;
        border: none;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: .82em;
      }
      .pay-status {
        font-size: .85em;
        min-height: 18px;
        margin-top: 8px;
        font-weight: bold;
      }
      .pay-pix-code {
        background: #111;
        border: 1px dashed #8B6914;
        border-radius: 6px;
        padding: 10px;
        font-size: .7em;
        color: #aaa;
        word-break: break-all;
        text-align: left;
        margin-bottom: 12px;
        line-height: 1.5;
        user-select: all;
      }
      .pay-success-icon {
        font-size: 2.2em;
        margin-bottom: 8px;
        display: block;
      }
      .pay-status-badge {
        display: inline-block;
        background: rgba(139,105,20,.25);
        border: 1px solid #8B6914;
        border-radius: 20px;
        padding: 5px 18px;
        font-size: .9em;
        color: #FFD700;
        margin-bottom: 14px;
        font-weight: bold;
      }
      .pay-paypal-btn-wrap {
        margin-bottom: 12px;
      }
      .pay-paypal-btn-wrap a {
        display: inline-block;
        background: #003087;
        color: #fff;
        border-radius: 8px;
        padding: 11px 22px;
        font-weight: bold;
        font-size: .95em;
        text-decoration: none;
        letter-spacing: .3px;
        transition: background .2s;
      }
      .pay-paypal-btn-wrap a:hover { background: #0053b3; }
      .pay-paypal-btn-wrap a img {
        vertical-align: middle;
        margin-right: 8px;
        height: 18px;
      }
      .pay-divider {
        border: none;
        border-top: 1px solid #333;
        margin: 16px 0;
      }
    `;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────
  // FÁBRICA DE MODAL GENÉRICO (guard)
  // ─────────────────────────────────────────────
  function showModal(htmlMessage, buttonLabel, onClose) {
    injectStyles();
    const old = document.getElementById('bg-guard-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id    = 'bg-guard-overlay';

    overlay.innerHTML = `
      <div id="bg-guard-box">
        <img class="bg-guard-icon"
             src="https://aden-rpg.pages.dev/assets/alertax.webp"
             onerror="this.style.display='none'" alt="">
        <p>${htmlMessage}</p>
        <button id="bg-guard-btn">${buttonLabel}</button>
      </div>`;

    document.body.appendChild(overlay);

    document.getElementById('bg-guard-btn').addEventListener('click', () => {
      overlay.remove();
      if (typeof onClose === 'function') onClose();
    });
  }

  // ─────────────────────────────────────────────
  // MODAIS DE PAGAMENTO — Estado e Helpers
  // ─────────────────────────────────────────────
  let _payOverlay = null;

  function _removePayOverlay() {
    if (_payOverlay) { _payOverlay.remove(); _payOverlay = null; }
  }

  function _createPayOverlay(innerHtml) {
    injectStyles();
    _removePayOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'pay-modal-overlay';
    overlay.innerHTML = `<div id="pay-modal-box">${innerHtml}</div>`;
    document.body.appendChild(overlay);
    _payOverlay = overlay;
    return overlay;
  }

  // ─────────────────────────────────────────────
  // MODAL 1 — Confirmação de compra
  // ─────────────────────────────────────────────
  function showPayConfirmModal(pkgIndex, method) {
    const pkg       = PACKAGES[pkgIndex];
    const methodStr = method === 'pix' ? 'Pix' : 'PayPal';

    _createPayOverlay(`
      <h3>Compra com ${methodStr}</h3>
      <p class="pay-sub">${pkg.displayName}</p>
      <p class="pay-desc">
        Realize o pagamento, envie o comprovante e aguarde o envio do ouro
        diretamente para seu perfil.
      </p>
      <div class="pay-btn-row">
        <button class="pay-btn pay-btn-no"  id="pay-confirm-no">Não</button>
        <button class="pay-btn pay-btn-yes" id="pay-confirm-yes">Sim</button>
      </div>
    `);

    document.getElementById('pay-confirm-no').addEventListener('click', _removePayOverlay);
    document.getElementById('pay-confirm-yes').addEventListener('click', () => {
      if (method === 'pix') showPixPaymentModal(pkgIndex);
      else                  showPayPalPaymentModal(pkgIndex);
    });
  }

  // ─────────────────────────────────────────────
  // MODAL 2A — Pagamento via Pix
  // ─────────────────────────────────────────────
  function showPixPaymentModal(pkgIndex) {
    const pkg = PACKAGES[pkgIndex];

    _createPayOverlay(`
      <h3>Pagamento via Pix</h3>
      <p class="pay-sub">${pkg.displayName}</p>
      <p class="pay-desc">Copie o código Pix abaixo e realize o pagamento no seu banco.</p>

      <div class="pay-pix-code" id="pix-code-text">${pkg.pixCode}</div>
      <button class="pay-btn pay-btn-copy" id="pay-pix-copy">📋 Copiar código Pix</button>

      <hr class="pay-divider">

      <label class="pay-file-label">Anexar print do comprovante:</label>
      <input type="file" accept="image/*" class="pay-file-input" id="pix-comprovante-input">

      <p class="pay-gold-notice">
        Após realizar o pagamento, envia um print do comprovante acima para finalizar a compra.
      </p>

      <button class="pay-btn pay-btn-send" id="pay-pix-send">Enviar comprovante</button>
      <div class="pay-status" id="pay-pix-status"></div>
    `);

    // Copiar código Pix (botão)
    document.getElementById('pay-pix-copy').addEventListener('click', () => {
      const btn = document.getElementById('pay-pix-copy');
      navigator.clipboard.writeText(pkg.pixCode).then(() => {
        btn.textContent = '✅ Código copiado!';
        btn.style.background = 'linear-gradient(to top, #0d4d1e, #1a8c3d)';
        markPendingRecharge(pkgIndex, 'pix');
        setTimeout(() => {
          btn.textContent = '📋 Copiar código Pix';
          btn.style.background = '';
        }, 2500);
      }).catch(() => {
        // Fallback para browsers que não suportam clipboard API
        const el = document.getElementById('pix-code-text');
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = '✅ Seleccionado — Ctrl+C para copiar';
        setTimeout(() => { btn.textContent = '📋 Copiar código Pix'; }, 3000);
      });
    });

    // Copiar código Pix (seleção manual do texto + Ctrl+C, sem usar o botão)
    document.getElementById('pix-code-text').addEventListener('copy', () => {
      markPendingRecharge(pkgIndex, 'pix');
    });

    // Enviar comprovante
    document.getElementById('pay-pix-send').addEventListener('click', () => {
      const fileInput = document.getElementById('pix-comprovante-input');
      const statusEl  = document.getElementById('pay-pix-status');
      enviarComprovanteTelegram(fileInput, statusEl, pkg, 'Pix', () => {
        showPaySuccessModal();
      });
    });
  }

  // ─────────────────────────────────────────────
  // MODAL 2B — Pagamento via PayPal
  // ─────────────────────────────────────────────
  function showPayPalPaymentModal(pkgIndex) {
    const pkg = PACKAGES[pkgIndex];
    const paypalUrl = `https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=${pkg.paypalId}&currency_code=BRL`;

    _createPayOverlay(`
      <h3>Pagamento via PayPal</h3>
      <p class="pay-sub">${pkg.displayName}</p>
      <p class="pay-desc">Clique no botão abaixo para realizar o pagamento pelo PayPal. Após concluir, volte aqui e envie o comprovante.</p>

      <div class="pay-paypal-btn-wrap">
        <a href="${paypalUrl}" target="_blank" rel="noopener noreferrer" id="pay-paypal-goto-btn">
          <img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_37x23.jpg"
               onerror="this.style.display='none'" alt="PayPal">
          Pagar com PayPal
        </a>
      </div>

      <hr class="pay-divider">

      <label class="pay-file-label">Anexar print do comprovante:</label>
      <input type="file" accept="image/*" class="pay-file-input" id="paypal-comprovante-input">

      <p class="pay-gold-notice">
        Após realizar o pagamento, envia um print do comprovante acima para finalizar a compra.
      </p>

      <button class="pay-btn pay-btn-send" id="pay-paypal-send">Enviar comprovante</button>
      <div class="pay-status" id="pay-paypal-status"></div>
    `);

    // Clicou em "Pagar com PayPal" → trava até enviar comprovante
    document.getElementById('pay-paypal-goto-btn').addEventListener('click', () => {
      markPendingRecharge(pkgIndex, 'paypal');
    });

    // Enviar comprovante
    document.getElementById('pay-paypal-send').addEventListener('click', () => {
      const fileInput = document.getElementById('paypal-comprovante-input');
      const statusEl  = document.getElementById('pay-paypal-status');
      enviarComprovanteTelegram(fileInput, statusEl, pkg, 'PayPal', () => {
        showPaySuccessModal();
      });
    });
  }

  // ─────────────────────────────────────────────
  // MODAL 3 — Sucesso / Avaliação em curso
  // ─────────────────────────────────────────────
  function showPaySuccessModal() {
    _createPayOverlay(`
      <span class="pay-success-icon">✅</span>
      <h3>Comprovante enviado!</h3>
      <div class="pay-status-badge">Avaliação em curso</div>
      <p class="pay-desc" style="margin-bottom:4px;">
        Seu comprovante foi recebido com sucesso. Nossa equipe irá verificar o pagamento e creditar o ouro na sua conta.
      </p>
      <p class="pay-gold-notice">
        O prazo de finalização é dentro do horário do Brasil (GMT -3) das 08:00 às 22:00.
      </p>
      <button class="pay-btn pay-btn-understood" id="pay-success-ok">Entendido</button>
    `);

    document.getElementById('pay-success-ok').addEventListener('click', _removePayOverlay);
  }

  // ─────────────────────────────────────────────
  // CONTROLE DE RECARGA PENDENTE (comprovante não enviado)
  // ─────────────────────────────────────────────
  // Guarda no localStorage (sobrevive a fechar a aba/app) assim que o
  // jogador copia o código Pix (botão OU seleção manual + Ctrl+C) ou clica
  // em "Pagar com PayPal" — sinal de que ele SAIU pra pagar. Se ele voltar
  // sem ter enviado o comprovante, mostramos o lembrete na próxima vez que
  // o jogo abrir. Só é limpo quando: (a) o comprovante é enviado com
  // sucesso, ou (b) o jogador clica em "Eu não fiz recarga."
  const PENDING_RECHARGE_KEY = 'aden_pending_recharge';

  function markPendingRecharge(pkgIndex, method) {
    const pkg = PACKAGES[pkgIndex];
    try {
      localStorage.setItem(PENDING_RECHARGE_KEY, JSON.stringify({
        pkgIndex,
        method,               // 'pix' | 'paypal'
        displayName: pkg.displayName,
        telegramLabel: pkg.telegramLabel,
        ts: Date.now()
      }));
    } catch (_) { /* localStorage indisponível — a trava só não persiste entre sessões */ }
  }

  function getPendingRecharge() {
    try {
      const raw = localStorage.getItem(PENDING_RECHARGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearPendingRecharge() {
    try { localStorage.removeItem(PENDING_RECHARGE_KEY); } catch (_) {}
  }

  // ─────────────────────────────────────────────

  const SUPABASE_FN_URL = 'https://lqzlblvmkuwedcofmgfb.functions.supabase.co';

  async function enviarComprovanteTelegram(fileInput, statusEl, pkg, methodLabel, onSuccess) {
    statusEl.style.color = '#aaa';
    statusEl.textContent = '';

    // Validações
    if (!fileInput || fileInput.files.length === 0) {
      statusEl.style.color = '#e55';
      statusEl.textContent = '❌ Anexe o print do comprovante!';
      return;
    }

    const file = fileInput.files[0];

    // Valida tipo de arquivo — apenas PNG, JPG e JPEG
    const allowedTypes = ['image/png', 'image/jpeg'];
    if (!allowedTypes.includes(file.type)) {
      statusEl.style.color = '#e55';
      statusEl.textContent = '❌ Envie apenas PNG, JPG ou JPEG.';
      return;
    }

    // Valida tamanho (máx. 10 MB — limite do Telegram)
    if (file.size > 10 * 1024 * 1024) {
      statusEl.style.color = '#e55';
      statusEl.textContent = '❌ Imagem muito grande. Máximo 10 MB.';
      return;
    }

    statusEl.style.color = '#aaa';
    statusEl.textContent = '⏳ Enviando comprovante...';

    // Desabilita botão de envio para evitar duplo clique
    const sendBtn = statusEl.closest('#pay-modal-box')
      ? statusEl.closest('#pay-modal-box').querySelector('.pay-btn-send')
      : null;
    if (sendBtn) sendBtn.disabled = true;

    try {
      // supabaseClient/currentPlayerId vêm do script.js (mesma página)
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Sessão não encontrada — faça login novamente.');

      const formData = new FormData();
      formData.append('photo', file);
      formData.append('pkg', pkg.telegramLabel);
      formData.append('method', methodLabel);

      const response = await fetch(`${SUPABASE_FN_URL}/telegram-purchase-proof`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok && result.ok) {
        clearPendingRecharge(); // comprovante enviado — a trava não faz mais sentido
        onSuccess();
      } else {
        throw new Error(result.error || 'Resposta inválida do servidor');
      }
    } catch (err) {
      statusEl.style.color = '#e55';
      statusEl.textContent = '❌ Erro ao enviar. Tente novamente.';
      console.error('[Aden RPG] Purchase proof send error:', err);
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // ─────────────────────────────────────────────
  // 1. GATE DE ACESSO ─ navegador comum é redirecionado pro download
  // ─────────────────────────────────────────────
  // PWA e TWA (e o APK legado) nunca caem aqui — acesso total liberado.
  if (platform.isBrowser && currentPage !== 'download.html') {
    const mustRedirect = REDIRECT_ALL_PAGES_IF_BROWSER
      ? !PAGES_EXEMPT_FROM_REDIRECT.includes(currentPage)
      : isBlockedPage;

    if (mustRedirect) {
      window.location.replace(DOWNLOAD_URL);
      return; // Interrompe tudo — a página vai trocar
    }
  }

  // ─────────────────────────────────────────────
  // A partir daqui, o aviso de navegador / interceptação de loja
  // só fazem sentido no index.html (onde vivem os elementos correspondentes).
  // ─────────────────────────────────────────────
  if (!isIndex) return;

  // ─────────────────────────────────────────────
  // 2. AVISO DE NAVEGADOR (modal no index)
  // ─────────────────────────────────────────────
  function showBrowserWarning() {
    if (!platform.isBrowser) return; // PWA/TWA/app legado nunca veem esse aviso
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, '1');

    showModal(
      `Você está acessando o jogo pelo navegador. O acesso a algumas funções e
       áreas será limitado nessa versão. Instale o app Aden RPG Online na sua
       tela de início para ter a experiência completa do jogo,
       <a href="${DOWNLOAD_URL}">clicando aqui</a>.`,
      'Entendi',
      null
    );
  }

  /**
   * Observa quando o ecrã de login (authContainer) ou o menu (footerMenu)
   * fica visível e então exibe o aviso — mas só depois que o intro terminou.
   */
  function setupWarningTrigger() {
    // O aviso só faz sentido APÓS a intro ser vista (ou se já foi vista antes).
    // Durante a intro a página é recarregada, então na sessão com intro não mostramos ainda.
    if (!localStorage.getItem(INTRO_LS_KEY)) {
      // Primeiro acesso: a intro vai rodar → na recarga seguinte o aviso aparece.
      // Não fazemos nada agora.
      return;
    }

    const authEl   = document.getElementById('authContainer');
    const footerEl = document.getElementById('footerMenu');

    if (!authEl && !footerEl) return;

    let fired = false;

    function check() {
      if (fired) return;
      const authVisible   = authEl   && getComputedStyle(authEl).display   !== 'none';
      const footerVisible = footerEl && getComputedStyle(footerEl).display  === 'flex';

      if (authVisible || footerVisible) {
        fired = true;
        if (obs) obs.disconnect();
        // Pequeno delay para o layout estabilizar antes do modal
        setTimeout(showBrowserWarning, 600);
        // O lembrete de recarga pendente usa um overlay com z-index menor
        // (3500) que o do aviso de navegador (praticamente o máximo
        // possível) — se os dois disparam juntos, o aviso de navegador fica
        // por cima e some primeiro; o lembrete continua por baixo e vira
        // visível assim que o jogador fecha o aviso. Por isso não precisa
        // de nenhuma lógica extra de fila entre os dois.
        setTimeout(showPendingRechargeReminder, 800);
      }
    }

    // Polling via MutationObserver em atributos style
    const targets = [authEl, footerEl].filter(Boolean);
    const obs = new MutationObserver(check);
    targets.forEach(el =>
      obs.observe(el, { attributes: true, attributeFilter: ['style', 'class'] })
    );

    // Verificação imediata + fallback periódico
    check();
    const poll = setInterval(() => { if (fired) clearInterval(poll); else check(); }, 400);
    setTimeout(() => clearInterval(poll), 30000);
  }

  document.addEventListener('DOMContentLoaded', setupWarningTrigger);

  // ─────────────────────────────────────────────
  // 1B. LEMBRETE DE RECARGA PENDENTE (comprovante não enviado)
  // ─────────────────────────────────────────────
  function showPendingRechargeReminder() {
    const pending = getPendingRecharge();
    if (!pending) return;

    const methodStr = pending.method === 'pix' ? 'Pix' : 'PayPal';
    const pkg = PACKAGES[pending.pkgIndex] || { displayName: pending.displayName, telegramLabel: pending.telegramLabel };

    _createPayOverlay(`
      <h3>Comprovante pendente</h3>
      <p class="pay-sub">${pkg.displayName || pending.displayName}</p>
      <p class="pay-desc">
        Parece que você tentou fazer uma recarga via ${methodStr} mas não enviou
        o comprovante de pagamento. A recarga só é finalizada após o envio
        do print do comprovante.
      </p>

      <label class="pay-file-label">Anexar print do comprovante:</label>
      <input type="file" accept="image/*" class="pay-file-input" id="pending-comprovante-input">

      <button class="pay-btn pay-btn-send" id="pay-pending-send">Enviar comprovante</button>
      <div class="pay-status" id="pay-pending-status"></div>

      <p style="margin-top:16px;">
        <a href="#" id="pay-pending-not-made" style="color:#999; font-size:.82em; text-decoration:underline;">
          Eu não fiz recarga.
        </a>
      </p>
    `);

    document.getElementById('pay-pending-send').addEventListener('click', () => {
      const fileInput = document.getElementById('pending-comprovante-input');
      const statusEl  = document.getElementById('pay-pending-status');
      enviarComprovanteTelegram(fileInput, statusEl, pkg, methodStr, () => {
        showPaySuccessModal();
      });
    });

    document.getElementById('pay-pending-not-made').addEventListener('click', (e) => {
      e.preventDefault();
      clearPendingRecharge();
      _removePayOverlay();
    });
  }

  // ─────────────────────────────────────────────
  // 3. INTERCEPTAR NAVEGAÇÃO PARA PÁGINAS BLOQUEADAS
  // ─────────────────────────────────────────────
  function showBlockedNavModal() {
    showModal(
      'O acesso a essa área está bloqueado na versão de navegador. Instale o app para continuar.',
      'Instalar / Baixar',
      () => { window.location.href = DOWNLOAD_URL; }
    );
  }

  /** Verifica se uma string de texto contém referência a uma página bloqueada */
  function refersToBlockedPage(text) {
    if (!text) return false;
    return BLOCKED_PAGES.some(p => text.toLowerCase().includes(p));
  }

  function setupNavInterceptors() {
    // PWA/TWA/app legado têm acesso total — nada a interceptar.
    if (!platform.isBrowser) return;

    // ─── Sobrescreve guildBtn (tem onclick inline) ───
    const guildBtn = document.getElementById('guildBtn2');
    if (guildBtn) {
      guildBtn.onclick = null;
      guildBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        showBlockedNavModal();
      }, true);
    }

    // ─── Interceptador global de cliques ───
    // Captura qualquer clique que tente navegar para página bloqueada
    document.addEventListener('click', e => {
      const target = e.target.closest('a, button, [onclick], [data-modal]');
      if (!target) return;

      const href    = target.getAttribute('href')    || '';
      const onclick = target.getAttribute('onclick') || '';
      const dataUrl = target.getAttribute('data-url') || '';

      if (
        refersToBlockedPage(href)    ||
        refersToBlockedPage(onclick) ||
        refersToBlockedPage(dataUrl)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showBlockedNavModal();
      }
    }, true /* capture phase = antes de qualquer handler existente */);

    // ─── Intercepta window.location.href (para hotspots do mapa, etc.) ───
    // Alguns scripts fazem location.href = '...' programaticamente.
    // Usamos um proxy no setter de location.href.
    try {
      const locDesc = Object.getOwnPropertyDescriptor(window, 'location');
      // location é não-configurável em maioria dos browsers; interceptamos via history
      const origPushState    = history.pushState.bind(history);
      const origReplaceState = history.replaceState.bind(history);

      history.pushState = function (state, title, url) {
        if (url && refersToBlockedPage(String(url))) {
          showBlockedNavModal();
          return;
        }
        origPushState(state, title, url);
      };

      history.replaceState = function (state, title, url) {
        if (url && refersToBlockedPage(String(url))) {
          showBlockedNavModal();
          return;
        }
        origReplaceState(state, title, url);
      };

      // Captura beforeunload-style: se a página for trocar para bloqueada
      window.addEventListener('beforeunload', () => {
        // Não dá para cancelar de dentro aqui de forma confiável,
        // mas o click interceptor já cobre a maior parte dos casos.
      });

      // Polyfill leve: intercepta tentativas via onclick que chamem location.assign/replace
      const origAssign  = location.assign.bind(location);
      const origReplace = location.replace.bind(location);

      // Não podemos re-atribuir location.assign diretamente (read-only em maioria),
      // então o click interceptor cobre esses casos via bubbling.
    } catch (_) { /* Silencia erros de ambiente restrito */ }
  }

  document.addEventListener('DOMContentLoaded', setupNavInterceptors);

  // ─────────────────────────────────────────────
  // 4A. LOJA — Aba "Assistir Vídeo" BLOQUEADA
  // ─────────────────────────────────────────────
  function setupShopInterceptors() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.shop-tab-btn');
      if (!btn) return;

      const tab = btn.getAttribute('data-tab');

      // ── Aba de Vídeo: bloqueada só no navegador comum (PWA/TWA liberado) ──
      if (tab === 'shop-video') {
        if (platform.isBrowser) {
          e.preventDefault();
          e.stopImmediatePropagation();
          showModal(
            'O recurso "Assistir Vídeo" está bloqueado na versão de navegador. Instale o app para assistir.',
            'Entendi',
            null
          );
        }
        return;
      }

      // ── Aba de Recarga: Pix/PayPal no navegador e no PWA; TWA/app legado mantém "Em breve" ──
      if (tab === 'shop-recharge' && !platform.showsStoreComingSoon) {
        // Deixa o handler original trocar a aba, depois injetamos
        setTimeout(injectBrowserRechargeContent, 80);
      }
    }, true);

    // Também injeta se o shopModal abrir já com a aba Recarga ativa
    if (platform.showsStoreComingSoon) return; // TWA/app legado: mantém "Em breve" (Play Billing entra aqui no futuro)

    const shopModal = document.getElementById('shopModal');
    if (shopModal) {
      new MutationObserver(() => {
        if (shopModal.style.display === 'flex') {
          const rechargeDiv = document.getElementById('shop-recharge');
          if (rechargeDiv && rechargeDiv.style.display !== 'none') {
            injectBrowserRechargeContent();
          }
        }
      }).observe(shopModal, { attributes: true, attributeFilter: ['style'] });
    }
  }

  // ─────────────────────────────────────────────
  // 4B. LOJA — Recarga: substituir "Em breve" por botões de pagamento
  // ─────────────────────────────────────────────
  function injectBrowserRechargeContent() {
    const rechargeDiv = document.getElementById('shop-recharge');
    if (!rechargeDiv) return;

    // Seleciona todos os spans com id="soon" (IDs duplicados no HTML original)
    const soonEls = rechargeDiv.querySelectorAll('[id="soon"]');
    if (!soonEls.length) return; // Já foram substituídos ou não existem

    let pkgIndex = 0;

    soonEls.forEach(span => {
      if (span.dataset.bgGuardDone) { pkgIndex++; return; }
      span.dataset.bgGuardDone = '1';

      const currentIndex = pkgIndex; // captura por closure

      // Cria container dos cards de pagamento
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        display: flex;
        gap: 12px;
        justify-content: center;
        margin-top: 10px;
        flex-wrap: wrap;
      `;

      // ── Card Pix ──
      const pixCard = buildPaymentCard(
        'https://aden-rpg.pages.dev/assets/pixbtn.webp',
        'Pix',
        currentIndex,
        'pix'
      );

      // ── Card PayPal ──
      const paypalCard = buildPaymentCard(
        'https://aden-rpg.pages.dev/assets/paypalbtn.webp',
        'PayPal',
        currentIndex,
        'paypal'
      );

      wrapper.appendChild(pixCard);
      wrapper.appendChild(paypalCard);

      // Insere antes do span e oculta o span original
      span.parentNode.insertBefore(wrapper, span);
      span.style.display = 'none';

      pkgIndex++;
    });
  }

  /**
   * Cria um card 120×120px com botão de 80×80px e label abaixo.
   * Agora aceita pkgIndex e method para disparar o modal correto.
   */
  function buildPaymentCard(imgSrc, label, pkgIndex, method) {
    const card = document.createElement('div');
    card.style.cssText = `
      width: 120px;
      height: 120px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,.06);
      border: 1px solid #555;
      border-radius: 10px;
      cursor: pointer;
      gap: 6px;
      box-sizing: border-box;
      transition: border-color .2s, background .2s;
    `;

    card.onmouseenter = () => {
      card.style.borderColor = '#8B6914';
      card.style.background  = 'rgba(139,105,20,.15)';
    };
    card.onmouseleave = () => {
      card.style.borderColor = '#555';
      card.style.background  = 'rgba(255,255,255,.06)';
    };

    card.addEventListener('click', () => {
      showPayConfirmModal(pkgIndex, method);
    });

    const img = document.createElement('img');
    img.src   = imgSrc;
    img.alt   = label;
    img.style.cssText = 'width:80px; height:80px; object-fit:contain; display:block;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:1.3em; color:gold; text-align:center; line-height:1.2;';

    card.appendChild(img);
    card.appendChild(lbl);
    return card;
  }

  // ─────────────────────────────────────────────
  // INICIALIZAÇÃO DAS INTERCEPTAÇÕES DA LOJA
  // ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', setupShopInterceptors);

})();
