// pwa-install.js
// Lógica de instalação do PWA à tela inicial.
// Requer platform.js incluído ANTES deste arquivo.
// Uso: AdenInstall.trigger()  -> chame isso no onclick do botão "Instalar" / "Versão Web".

(function () {
  'use strict';

  let deferredPrompt = null;

  // Captura o evento cedo — Android/Chrome/Edge/Desktop.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.dispatchEvent(new CustomEvent('adenpwa:installavailable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.dispatchEvent(new CustomEvent('adenpwa:installed'));
  });

  // ─────────────────────────────────────────────
  // Estilos do modal (mesma linguagem visual do browser-guard)
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('adenpwa-styles')) return;
    const style = document.createElement('style');
    style.id = 'adenpwa-styles';
    style.textContent = `
      #adenpwa-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,.88);
        display: flex; align-items: center; justify-content: center;
        font-family: Arial, sans-serif;
        animation: adenpwaFadeIn .2s ease;
        padding: 16px; box-sizing: border-box;
      }
      @keyframes adenpwaFadeIn { from { opacity: 0; } to { opacity: 1; } }
      #adenpwa-box {
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
      #adenpwa-box h3 {
        margin: 0 0 14px; font-size: 1.15em; color: #FFD700; letter-spacing: .3px;
      }
      #adenpwa-box p { font-size: .92em; line-height: 1.6; color: #ddd; margin: 0 0 14px; }
      .adenpwa-steps { text-align: left; margin: 0 0 18px; padding: 0; list-style: none; }
      .adenpwa-steps li {
        display: flex; align-items: flex-start; gap: 10px;
        font-size: .9em; line-height: 1.5; color: #ddd; margin-bottom: 12px;
      }
      .adenpwa-steps li .num {
        flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%;
        background: linear-gradient(to top, #7a4e00, #c98c1a);
        color: #fff; font-weight: bold; font-size: .85em;
        display: flex; align-items: center; justify-content: center;
      }
      .adenpwa-share-icon {
        display: inline-block; width: 18px; height: 18px; vertical-align: middle;
        margin: 0 3px;
      }
      #adenpwa-btn {
        background: linear-gradient(to top, #7a4e00, #c98c1a);
        color: #fff; border: none; border-radius: 8px;
        padding: 11px 0; font-size: 1em; font-weight: bold;
        width: 100%; cursor: pointer; letter-spacing: .3px;
        transition: filter .2s;
      }
      #adenpwa-btn:hover { filter: brightness(1.12); }
    `;
    document.head.appendChild(style);
  }

  function showModal(titleHtml, bodyHtml, buttonLabel, onClose) {
    injectStyles();
    const old = document.getElementById('adenpwa-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'adenpwa-overlay';
    overlay.innerHTML = `
      <div id="adenpwa-box">
        <h3>${titleHtml}</h3>
        ${bodyHtml}
        <button id="adenpwa-btn">${buttonLabel}</button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); } });
    document.getElementById('adenpwa-btn').addEventListener('click', () => {
      overlay.remove();
      if (onClose) onClose();
    });
  }

  // ─────────────────────────────────────────────
  // Tutorial iOS (Safari não expõe beforeinstallprompt — instalação é manual)
  // ─────────────────────────────────────────────
  function showIOSTutorial() {
    showModal(
      'Instalar na Tela de Início',
      `<p>No iPhone/iPad, a instalação é feita manualmente pelo Safari:</p>
       <ul class="adenpwa-steps">
         <li><span class="num">1</span><span>Toque no ícone de <strong>Compartilhar</strong> (o quadrado com a seta para cima) na barra do Safari.</span></li>
         <li><span class="num">2</span><span>Role para baixo e toque em <strong>"Adicionar à Tela de Início"</strong>.</span></li>
         <li><span class="num">3</span><span>Toque em <strong>"Adicionar"</strong> no canto superior direito.</span></li>
       </ul>
       <p>Pronto! O ícone de Aden RPG Online vai aparecer na sua tela de início, como um app normal.</p>`,
      'Entendi',
      null
    );
  }

  function showIOSWrongBrowser() {
    showModal(
      'Abra no Safari',
      `<p>Para instalar o app no iPhone/iPad, esse passo só funciona pelo navegador <strong>Safari</strong>.</p>
       <p>Copie o link e abra no Safari, depois toque em Compartilhar → "Adicionar à Tela de Início".</p>`,
      'Entendi',
      null
    );
  }

  function showFallbackManual() {
    showModal(
      'Instalar o app',
      `<p>Seu navegador não ofereceu a instalação automática (isso pode acontecer se o app já estiver instalado, ou se o navegador não for compatível).</p>
       <p>Tente pelo <strong>Chrome</strong> ou <strong>Edge</strong>: toque no menu (⋮) e escolha <strong>"Instalar app"</strong> ou <strong>"Adicionar à tela inicial"</strong>.</p>`,
      'Entendi',
      null
    );
  }

  function showAlreadyInstalled() {
    showModal(
      'Você já está no app!',
      `<p>Você já está jogando pela versão instalada. Aproveite! 🎮</p>`,
      'Fechar',
      null
    );
  }

  // ─────────────────────────────────────────────
  // API pública
  // ─────────────────────────────────────────────
  async function trigger() {
    const platform = window.AdenPlatform;

    if (platform && platform.isApp) {
      showAlreadyInstalled();
      return;
    }

    if (platform && platform.isIOS) {
      if (platform.isIOSSafari) showIOSTutorial();
      else showIOSWrongBrowser();
      return;
    }

    // Android / Desktop
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch (_) {}
      deferredPrompt = null;
      return;
    }

    showFallbackManual();
  }

  window.AdenInstall = {
    trigger,
    isAvailable: () => !!deferredPrompt
  };
})();
