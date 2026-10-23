/**
 * Diárias HUD Toggle — recolhe/expande a interface das Diárias (barra do topo,
 * saguão, HUD e controles da aventura, resultado), deixando só o skybox visível
 * para o jogador arrastar e olhar ao redor. Mesmo visual e comportamento do
 * guild_hud_toggle.js.
 *
 * A animação é feita por CSS (body.hud-hidden, em diarias.css), então vale para
 * qualquer tela (saguão, aventura, resultado) sem listar elementos aqui.
 * API: window.DiariasHud.{show, hide, toggle, isHidden}
 */
(function () {
  'use strict';

  const SVG_UP = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="18 15 12 9 6 15"/>
  </svg>`;

  const SVG_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9"/>
  </svg>`;

  const HIDDEN_CLASS = 'hud-hidden';

  function init() {
    if (document.getElementById('dailyHudToggleBtn')) return; // guard contra dupla inicialização

    const btn = document.createElement('button');
    btn.id = 'dailyHudToggleBtn';
    btn.className = 'hud-toggle-btn';
    btn.type = 'button';
    document.body.appendChild(btn);

    const isHidden = () => document.body.classList.contains(HIDDEN_CLASS);

    function render() {
      const hidden = isHidden();
      btn.innerHTML = hidden ? SVG_DOWN : SVG_UP;
      btn.title = hidden ? 'Mostrar interface' : 'Recolher interface';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-expanded', String(!hidden));
    }

    function setHidden(hidden) {
      document.body.classList.toggle(HIDDEN_CLASS, hidden);
      render();
    }

    btn.addEventListener('click', () => setHidden(!isHidden()));

    window.DiariasHud = {
      show: () => { if (isHidden()) setHidden(false); },
      hide: () => { if (!isHidden()) setHidden(true); },
      toggle: () => setHidden(!isHidden()),
      isHidden,
    };

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
