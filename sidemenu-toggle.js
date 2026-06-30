/**
 * Side Menu Toggle — recolhe/expande o #sideMenu para a direita.
 * Inclua nas páginas com o menu lateral: <script src="sidemenu-toggle.js"></script>
 */
(function () {
  'use strict';

  const SVG_RIGHT = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 6 15 12 9 18"/>
  </svg>`;

  const SVG_LEFT = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="15 6 9 12 15 18"/>
  </svg>`;

  const TRANSITION = '0.35s cubic-bezier(.4,0,.2,1)';

  function init() {
    const menu = document.getElementById('sideMenu');
    if (!menu) return;

    const btn = document.createElement('button');
    btn.id = 'sideMenuToggleBtn';
    btn.innerHTML = SVG_RIGHT;
    btn.title = 'Recolher menu';

    Object.assign(btn.style, {
      display        : 'none',
      position       : 'fixed',
      top            : '50%',
      transform      : 'translateY(-50%)',
      zIndex         : '1100',
      alignItems     : 'center',
      justifyContent : 'center',
      width          : '26px',
      height         : '52px',
      border         : '4px solid #3a6c3a',
      borderRight    : 'none',
      borderRadius   : '12px 0 0 12px',
      color          : '#8ec88e',
      cursor         : 'pointer',
      padding        : '0',
      transition     : `right ${TRANSITION}, background .2s`,
      pointerEvents  : 'auto',
    });

    btn.style.setProperty('background', '#000', 'important');

    document.body.appendChild(btn);

    menu.style.transition = `transform ${TRANSITION}, opacity ${TRANSITION}`;
    menu.style.transformOrigin = 'right center';

    let collapsed = false;

    function snapBtnToMenu() {
      const rect = menu.getBoundingClientRect();
      btn.style.right = (window.innerWidth - rect.left) + 'px';
    }

    btn.addEventListener('mouseenter', () => { btn.style.setProperty('background', '#1a2e1a', 'important'); });
    btn.addEventListener('mouseleave', () => { btn.style.setProperty('background', '#000',    'important'); });

    btn.addEventListener('click', () => {
      collapsed = !collapsed;

      if (collapsed) {
        menu.style.transform     = 'translateY(-50%) translateX(120%)';
        menu.style.opacity       = '0';
        menu.style.pointerEvents = 'none';
        btn.style.right          = '0px';
        btn.innerHTML = SVG_LEFT;
        btn.title = 'Expandir menu';
      } else {
        menu.style.transform     = 'translateY(-50%)';
        menu.style.opacity       = '1';
        menu.style.pointerEvents = '';
        btn.innerHTML = SVG_RIGHT;
        btn.title = 'Recolher menu';
        setTimeout(snapBtnToMenu, 360);
      }
    });

    function onMenuStyleChange() {
      const visible = menu.style.display !== 'none';
      btn.style.display = visible ? 'flex' : 'none';

      if (visible && !collapsed) {
        requestAnimationFrame(snapBtnToMenu);
      }

      if (!visible && collapsed) {
        collapsed = false;
        menu.style.transform     = 'translateY(-50%)';
        menu.style.opacity       = '1';
        menu.style.pointerEvents = '';
        btn.innerHTML = SVG_RIGHT;
        btn.title = 'Recolher menu';
      }
    }

    const observer = new MutationObserver(onMenuStyleChange);
    observer.observe(menu, { attributes: true, attributeFilter: ['style'] });

    // Estado inicial: menu visível por padrão (display não é 'none' via CSS)
    btn.style.display = 'flex';
    requestAnimationFrame(snapBtnToMenu);

    window.addEventListener('resize', () => {
      if (!collapsed) snapBtnToMenu();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
