// no-zoom.js
// ------------------------------------------------------------------
// Reforço via JS pro bloqueio de zoom. O CSS (no-zoom.css / style.css)
// resolve a maioria dos casos, mas o Safari do iOS tem um comportamento
// próprio de pinça (eventos "gesture*") que às vezes ignora touch-action e
// o viewport meta. Esse arquivo é 100% independente — pode ser colocado em
// qualquer página, inclusive na taverna, sem precisar de mais nada.
// ------------------------------------------------------------------
(function () {
  'use strict';

  // iOS Safari: eventos de gesto (pinça) — não existem no Android/Chrome,
  // então isso é inofensivo lá (o listener simplesmente nunca dispara).
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (evt) {
    document.addEventListener(evt, function (e) { e.preventDefault(); }, { passive: false });
  });

  // Bloqueia o pinch-zoom em navegadores que usam touch events padrão
  // (mais de um dedo na tela = provável gesto de zoom).
  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // Bloqueia o "zoom por duplo toque rápido".
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false, capture: true });
})();
