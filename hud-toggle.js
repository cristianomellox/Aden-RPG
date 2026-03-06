/**
 * HUD Toggle — recolhe/expande o #huntingHud para cima.
 * Inclua nas páginas de caça: <script src="hud-toggle.js"></script>
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

  const TOPBAR_H  = 50;
  const TRANSITION = '0.35s cubic-bezier(.4,0,.2,1)';

  function init() {
    const hud = document.getElementById('huntingHud');
    if (!hud) return;

    const btn = document.createElement('button');
    btn.id = 'hudToggleBtn';
    btn.innerHTML = SVG_UP;
    btn.title = 'Recolher HUD';

    Object.assign(btn.style, {
      display        : 'none',
      position       : 'fixed',
      left           : '50%',
      transform      : 'translateX(-50%)',
      zIndex         : '1100',
      alignItems     : 'center',
      justifyContent : 'center',
      width          : '52px',
      height         : '26px',
      border         : '4px solid #3a6c3a',
      borderTop      : 'none',
      borderRadius   : '0 0 12px 12px',
      color          : '#8ec88e',
      cursor         : 'pointer',
      padding        : '0',
      transition     : `top ${TRANSITION}, background .2s`,
      pointerEvents  : 'auto',
    });

    btn.style.setProperty('background', '#000', 'important');

    document.body.appendChild(btn);

    hud.style.transition = `transform ${TRANSITION}, opacity ${TRANSITION}`;
    hud.style.transformOrigin = 'top center';

    let collapsed = false;

    function snapBtnToHud() {
      const rect = hud.getBoundingClientRect();
      btn.style.top = rect.bottom + 'px';
    }

    btn.addEventListener('mouseenter', () => { btn.style.setProperty('background', '#1a2e1a', 'important'); });
    btn.addEventListener('mouseleave', () => { btn.style.setProperty('background', '#000',    'important'); });

    btn.addEventListener('click', () => {
      collapsed = !collapsed;

      if (collapsed) {
        hud.style.transform     = 'translateY(-120%)';
        hud.style.opacity       = '0';
        hud.style.pointerEvents = 'none';
        btn.style.top           = TOPBAR_H + 'px';
        btn.innerHTML = SVG_DOWN;
        btn.title = 'Expandir HUD';
      } else {
        hud.style.transform     = '';
        hud.style.opacity       = '1';
        hud.style.pointerEvents = '';
        btn.innerHTML = SVG_UP;
        btn.title = 'Recolher HUD';
        setTimeout(snapBtnToHud, 360);
      }
    });

    function onHudStyleChange() {
      const visible = hud.style.display && hud.style.display !== 'none';
      btn.style.display = visible ? 'flex' : 'none';

      if (visible && !collapsed) {
        requestAnimationFrame(snapBtnToHud);
      }

      if (!visible && collapsed) {
        collapsed = false;
        hud.style.transform     = '';
        hud.style.opacity       = '1';
        hud.style.pointerEvents = '';
        btn.innerHTML = SVG_UP;
        btn.title = 'Recolher HUD';
      }
    }

    const observer = new MutationObserver(onHudStyleChange);
    observer.observe(hud, { attributes: true, attributeFilter: ['style'] });

    window.addEventListener('resize', () => {
      if (!collapsed) snapBtnToHud();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
