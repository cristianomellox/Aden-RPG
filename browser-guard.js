
(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // CONFIGURAÇÃO
  // ─────────────────────────────────────────────
  const APK_UA_TOKEN   = 'aden2712';
  const DOWNLOAD_URL   = '/download.html';
  const SESSION_KEY    = 'aden_browser_warning_shown';
  const INTRO_LS_KEY   = 'aden_intro_seen_v32';   // mesmo do script.js

  const BLOCKED_PAGES  = [
    'capital.html', 'zion.html', 'elendor.html', 'mitrar.html',
    'tandra.html',  'astrax.html', 'duratar.html', 'guild.html'
  ];

  // ─────────────────────────────────────────────
  // DETECÇÃO DE PLATAFORMA
  // ─────────────────────────────────────────────
  const isAPK = navigator.userAgent.includes(APK_UA_TOKEN);
  if (isAPK) return; // Dentro do APK → sem restrições

  const currentPage = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const isBlockedPage = BLOCKED_PAGES.includes(currentPage);
  const isIndex       = currentPage === 'index.html' || currentPage === '';

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
    `;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────
  // FÁBRICA DE MODAL GENÉRICO
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
             src="https://aden-rpg.pages.dev/assets/sobre.webp"
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
  // 1. PÁGINAS BLOQUEADAS ─ acesso direto via URL
  // ─────────────────────────────────────────────
  if (isBlockedPage) {
    const run = () =>
      showModal(
        'O acesso a essa página está bloqueado na versão de navegador. Por favor baixe o app.',
        'Entendi',
        () => { window.location.href = '/index.html'; }
      );

    if (document.body) run();
    else document.addEventListener('DOMContentLoaded', run);
    return; // Não executa o restante nas páginas bloqueadas
  }

  // ─────────────────────────────────────────────
  // A partir daqui, tudo se aplica ao index.html
  // ─────────────────────────────────────────────
  if (!isIndex) return;

  // ─────────────────────────────────────────────
  // 2. AVISO DE NAVEGADOR (modal no index)
  // ─────────────────────────────────────────────
  function showBrowserWarning() {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, '1');

    showModal(
      `Você está acessando o jogo pelo navegador. O acesso a algumas funções e
       páginas será limitado nessa versão. Por favor, baixe o app Aden RPG Online
       para ter uma experiência completa do jogo,
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
  // 3. INTERCEPTAR NAVEGAÇÃO PARA PÁGINAS BLOQUEADAS
  // ─────────────────────────────────────────────
  function showBlockedNavModal() {
    showModal(
      'O acesso a essa página está bloqueado na versão de navegador. Por favor baixe o app.',
      'Entendi',
      null
    );
  }

  /** Verifica se uma string de texto contém referência a uma página bloqueada */
  function refersToBlockedPage(text) {
    if (!text) return false;
    return BLOCKED_PAGES.some(p => text.toLowerCase().includes(p));
  }

  function setupNavInterceptors() {
    // ─── Sobrescreve guildBtn (tem onclick inline) ───
    const guildBtn = document.getElementById('guildBtn');
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

      // ── Aba de Vídeo: bloqueada ──
      if (tab === 'shop-video') {
        e.preventDefault();
        e.stopImmediatePropagation();
        showModal(
          'O recurso "Assistir Vídeo" está bloqueado na versão de navegador. Por favor baixe o app.',
          'Entendi',
          null
        );
        return;
      }

      // ── Aba de Recarga: injetar conteúdo do navegador ──
      if (tab === 'shop-recharge') {
        // Deixa o handler original trocar a aba, depois injetamos
        setTimeout(injectBrowserRechargeContent, 80);
      }
    }, true);

    // Também injeta se o shopModal abrir já com a aba Recarga ativa
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

    soonEls.forEach(span => {
      if (span.dataset.bgGuardDone) return;
      span.dataset.bgGuardDone = '1';

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
        'Pix com Whatsapp'
      );

      // ── Card PayPal ──
      const paypalCard = buildPaymentCard(
        'https://aden-rpg.pages.dev/assets/paypalbtn.webp',
        'PayPal'
      );

      wrapper.appendChild(pixCard);
      wrapper.appendChild(paypalCard);

      // Insere antes do span e oculta o span original
      span.parentNode.insertBefore(wrapper, span);
      span.style.display = 'none';
    });
  }

  /**
   * Cria um card 120×120px com botão de 80×80px e label abaixo.
   */
  function buildPaymentCard(imgSrc, label) {
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

    const img = document.createElement('img');
    img.src   = imgSrc;
    img.alt   = label;
    img.style.cssText = 'width:80px; height:80px; object-fit:contain; display:block;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:.92em; color:#ccc; text-align:center; line-height:1.2; text-shadow: none;';

    card.appendChild(img);
    card.appendChild(lbl);
    return card;
  }

  // ─────────────────────────────────────────────
  // INICIALIZAÇÃO DAS INTERCEPTAÇÕES DA LOJA
  // ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', setupShopInterceptors);

})();
