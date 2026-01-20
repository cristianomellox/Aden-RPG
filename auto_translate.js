// auto_translate.js — Versão Final "Silent Mode"

const DEFAULT_LANG = "pt"; 

// ======================================================================
// 1. Inicialização do Google Translate
// ======================================================================
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        includedLanguages: "pt,en,es,zh-CN,ja,ko,id,tl,ru,it,fr,hi,ms,vi,ar",
        // 'SIMPLE' gera menos HTML intrusivo que outros layouts
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE, 
        autoDisplay: false, // Tenta impedir o popup automático
        multilanguagePage: true
    }, "google_translate_element");

    syncSelectorWithCookie();
    fixBodyMargin();
}

// ======================================================================
// 2. Correção de Layout (Apenas Margem)
// ======================================================================
function fixBodyMargin() {
    // Remove apenas a margem do body, deixa o CSS lidar com a invisibilidade do spinner
    const removeMargin = () => {
        if (document.body.style.marginTop && document.body.style.marginTop !== '0px') {
            document.body.style.marginTop = '0px';
            document.body.style.top = '0px';
        }
        
        // Reforço para ocultar iframe de banner se ele existir
        const banner = document.querySelector('.goog-te-banner-frame');
        if (banner) banner.style.display = 'none';
    };

    removeMargin();

    // Monitora apenas mudanças de estilo no body para remover a margem teimosa
    const observer = new MutationObserver(() => {
        removeMargin();
    });

    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
}

// ======================================================================
// 3. Funções de Cookie e Idioma (Padrão)
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
// 4. Inicializadores
// ======================================================================
document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("languageSelector");
    if (selector) {
        selector.addEventListener("change", e => window.changeLanguage(e.target.value));
    }
    syncSelectorWithCookie();
    
    // Pequeno delay para garantir limpeza após scripts externos
    setTimeout(fixBodyMargin, 1000);
});