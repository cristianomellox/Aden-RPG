// platform.js
// Módulo central de detecção de plataforma (Browser / PWA / TWA).
// Deve ser incluído ANTES de browser-guard.js e pwa-install.js em TODAS as páginas.
// Não depende de nada. Expõe window.AdenPlatform.

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // Compatibilidade com o app antigo (AppCreator24)
  // Enquanto o TWA novo não substitui 100% o parque de usuários do APK antigo,
  // mantemos esse UA como "app instalado" (mesmo comportamento de antes).
  // Quando o APK antigo for descontinuado, pode remover este bloco.
  // ─────────────────────────────────────────────
  const LEGACY_APK_UA_TOKEN = 'aden2712';
  const isLegacyApk = navigator.userAgent.includes(LEGACY_APK_UA_TOKEN);

  // ─────────────────────────────────────────────
  // TWA (Trusted Web Activity — app baixado na Play Store)
  // O Chrome/WebAPK abre a TWA com document.referrer = "android-app://<package>"
  // Isso só vem preenchido no primeiro carregamento, então persistimos em sessionStorage.
  // ─────────────────────────────────────────────
  const TWA_SESSION_KEY = 'aden_is_twa';
  try {
    if (document.referrer && document.referrer.indexOf('android-app://') === 0) {
      sessionStorage.setItem(TWA_SESSION_KEY, '1');
    }
  } catch (_) { /* sessionStorage indisponível (modo privado etc.) */ }

  let isTWA = false;
  try { isTWA = sessionStorage.getItem(TWA_SESSION_KEY) === '1'; } catch (_) {}

  // Também aceitamos um parâmetro de URL explícito (?source=twa), útil caso o
  // pacote gerado pelo PWABuilder seja configurado para abrir com essa query string.
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('source') === 'twa') {
      isTWA = true;
      sessionStorage.setItem(TWA_SESSION_KEY, '1');
    }
  } catch (_) {}

  // ─────────────────────────────────────────────
  // PWA instalado (Android / Desktop / iOS) rodando em modo standalone
  // ─────────────────────────────────────────────
  function isStandaloneDisplay() {
    try {
      if (window.matchMedia && (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches
      )) return true;
    } catch (_) {}
    // iOS Safari (legado, ainda válido em versões atuais)
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  const isPWA = !isTWA && !isLegacyApk && isStandaloneDisplay();

  // ─────────────────────────────────────────────
  // Detecção de dispositivo (usado pelo pwa-install.js)
  // ─────────────────────────────────────────────
  function detectIOS() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS 13+ manda UA de desktop (Macintosh), mas tem touch
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function detectIOSSafari() {
    const ua = navigator.userAgent;
    const isSafariEngine = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|Instagram|FBAN|FBAV|Line\//.test(ua);
    return detectIOS() && isSafariEngine;
  }

  // ─────────────────────────────────────────────
  // Resultado final
  // ─────────────────────────────────────────────
  const isApp = isTWA || isPWA || isLegacyApk; // "app instalado", em qualquer uma das formas
  const isBrowser = !isApp;

  let type = 'browser';
  if (isTWA) type = 'twa';
  else if (isLegacyApk) type = 'legacy_apk';
  else if (isPWA) type = 'pwa';

  window.AdenPlatform = {
    type,               // 'browser' | 'pwa' | 'twa' | 'legacy_apk'
    isBrowser,          // navegador comum, nada instalado
    isPWA,              // instalado via navegador (Android/iOS/Desktop)
    isTWA,              // baixado pela Google Play Store
    isLegacyApk,        // app antigo do AppCreator24 (compatibilidade)
    isApp,              // isPWA || isTWA || isLegacyApk
    isIOS: detectIOS(),
    isIOSSafari: detectIOSSafari(),
    // Loja: TWA (e o APK legado do AppCreator24) mostram "Em breve"
    // (Play Billing entra no futuro aqui). Navegador comum e PWA mostram Pix/PayPal.
    showsStoreComingSoon: isTWA || isLegacyApk
  };
})();
