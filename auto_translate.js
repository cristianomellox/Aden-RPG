// auto_translate.js — Versão Final: Nuclear Style Injection

const DEFAULT_LANG = "pt"; 

// ======================================================================
// 1. INJEÇÃO DE CSS "NUCLEAR" (A Solução Definitiva)
// ======================================================================
// Criamos os estilos via JS para garantir que eles sejam aplicados
// independentemente de carregamento de arquivos CSS externos.
function injectNuclearStyles() {
    const style = document.createElement('style');
    style.id = 'google-translate-overrides';
    style.innerHTML = `
        /* Oculta o container do Spinner de carregamento */
        .goog-te-spinner-pos {
            display: none !important;
            visibility: hidden !important;
            width: 0 !important;
            height: 0 !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
        
        /* Oculta a imagem do spinner especificamente */
        .goog-te-spinner-pos img, 
        .goog-te-spinner-animation,
        img[src*="loading.gif"] { 
            display: none !important; 
        }

        /* Oculta a barra superior (Banner Frame) */
        .goog-te-banner-frame {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
        }

        /* Oculta tooltips/balões do Google */
        .goog-te-balloon-frame,
        #goog-gt-tt,
        .goog-tooltip {
            display: none !important;
            visibility: hidden !important;
            box-shadow: none !important;
        }

        /* Força o corpo da página a ficar no topo */
        body {
            top: 0 !important;
            margin-top: 0 !important;
            position: static !important;
        }
        
        /* Oculta o link "Sugerir uma tradução melhor" */
        .goog-text-highlight {
            background-color: transparent !important;
            box-shadow: none !important;
        }
    `;
    document.head.appendChild(style);
}

// ======================================================================
// 2. Inicialização do Google Translate
// ======================================================================
function googleTranslateElementInit() {
    // 1. Injeta os estilos antes de tudo
    injectNuclearStyles();

    // 2. Inicia o Widget
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        includedLanguages: "pt,en,es,zh-CN,ja,ko,id,tl,ru,it,fr,hi,ms,vi,ar",
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false
    }, "google_translate_element");

    syncSelectorWithCookie();
    
    // 3. Ativa o vigilante para casos extremos
    fixGoogleLayout(); 
}

// ======================================================================
// 3. Vigilância Ativa (MutationObserver)
// ======================================================================
function fixGoogleLayout() {
    const observer = new MutationObserver(() => {
        // Mesmo com o CSS, o Google tenta mudar o style inline do body.
        // O Observer garante que o margin-top volte a zero.
        if (document.body.style.marginTop !== '0px') {
            document.body.style.marginTop = '0px';
            document.body.style.top = '0px';
        }
    });

    observer.observe(document.body, { 
        attributes: true, 
        attributeFilter: ['style']
    });
}

// ======================================================================
// 4. Utilitários de Cookie e Idioma
// ======================================================================
function getCurrentLangFromCookie() {
    const cookies = document.cookie.split(";").map(c => c.trim());
    const googCookie = cookies.find(c => c.startsWith("googtrans="));
    if (!googCookie) return DEFAULT_LANG;
    const value = googCookie.replace("googtrans=", "").trim(); 
    const parts = value.split("/");
    return parts[parts.length - 1] || DEFAULT_LANG;
}

function syncSelectorWithCookie() {
    const selector = document.getElementById("languageSelector");
    if (!selector) return;
    const lang = getCurrentLangFromCookie();
    if (selector.querySelector(`option[value="${lang}"]`)) selector.value = lang;
    else selector.value = DEFAULT_LANG;
}

window.changeLanguage = function(lang) {
    if (lang === DEFAULT_LANG) {
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = `googtrans=; domain=.${window.location.hostname}; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    } else {
        const cookieValue = `/pt/${lang}`;
        document.cookie = `googtrans=${cookieValue}; path=/;`;
        document.cookie = `googtrans=${cookieValue}; domain=.${window.location.hostname}; path=/;`;
    }
    window.location.reload();
}

// ======================================================================
// 5. Eventos de Inicialização
// ======================================================================
document.addEventListener("DOMContentLoaded", () => {
    // Injeta estilos imediatamente ao carregar o DOM (segurança dupla)
    injectNuclearStyles();

    const selector = document.getElementById("languageSelector");
    if (selector) {
        selector.addEventListener("change", e => window.changeLanguage(e.target.value));
    }
    syncSelectorWithCookie();
});