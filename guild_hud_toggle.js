/**
 * Guild HUD Toggle — recolhe/expande a interface da guilda (topbar + menu
 * de abas + conteúdo) pra cima, deixando só o skybox visível.
 * Mesmo padrão visual do hud-toggle.js (Vale Arcano), adaptado pra
 * recolher vários elementos juntos em vez de um #huntingHud único.
 */
(function () {
  'use strict';

  const SVG_UP = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>`;

  const SVG_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>`;

  const TRANSITION = '0.35s cubic-bezier(.4,0,.2,1)';

  function init() {
    const topbar  = document.getElementById('playerTopBar');
    const main    = document.getElementById('mainContainer');
    const tabMenu = document.getElementById('tabMenu');
    if (!topbar || !main || !tabMenu) return;
    if (document.getElementById('guildHudToggleBtn')) return; // guard contra dupla inicialização

    const btn = document.createElement('button');
    btn.id = 'guildHudToggleBtn';
    btn.innerHTML = SVG_UP;
    btn.title = 'Recolher interface';

    Object.assign(btn.style, {
      position       : 'fixed',
      left           : '50%',
      transform      : 'translateX(-50%)',
      zIndex         : '1200',
      display        : 'flex',
      alignItems     : 'center',
      justifyContent : 'center',
      width          : '52px',
      height         : '26px',
      border         : '4px solid #c9a94a',
      borderTop      : 'none',
      borderRadius   : '0 0 12px 12px',
      color          : '#e8cf7a',
      cursor         : 'pointer',
      padding        : '0',
      transition     : `top ${TRANSITION}, background .2s`,
      pointerEvents  : 'auto',
    });
    btn.style.setProperty('background', '#000', 'important');
    document.body.appendChild(btn);

    const targets = [topbar, main];
    targets.forEach((el) => {
      el.style.transition = `transform ${TRANSITION}, opacity ${TRANSITION}`;
      el.style.transformOrigin = 'top center';
    });

    let collapsed = false;

    function snapToTabMenu() {
      if (collapsed) return;
      const rect = tabMenu.getBoundingClientRect();
      btn.style.top = rect.bottom + 'px';
    }
    snapToTabMenu();

    btn.addEventListener('mouseenter', () => btn.style.setProperty('background', '#241b08', 'important'));
    btn.addEventListener('mouseleave', () => btn.style.setProperty('background', '#000', 'important'));

    btn.addEventListener('click', () => {
      collapsed = !collapsed;

      if (collapsed) {
        targets.forEach((el) => {
          el.style.transform     = 'translateY(-120%)';
          el.style.opacity       = '0';
          el.style.pointerEvents = 'none';
        });
        btn.style.top = '0px';
        btn.innerHTML = SVG_DOWN;
        btn.title = 'Mostrar interface';
      } else {
        targets.forEach((el) => {
          el.style.transform     = '';
          el.style.opacity       = '1';
          el.style.pointerEvents = '';
        });
        btn.innerHTML = SVG_UP;
        btn.title = 'Recolher interface';
        setTimeout(snapToTabMenu, 360);
      }
    });

    window.addEventListener('resize', snapToTabMenu);

    // O conteúdo das abas muda de altura dinamicamente (dados carregando,
    // troca de aba etc.) — mantém o botão colado no rodapé do menu de abas.
    const mo = new MutationObserver(() => snapToTabMenu());
    mo.observe(main, { attributes: true, attributeFilter: ['style', 'class'] });
    mo.observe(tabMenu, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
