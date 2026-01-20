// auto_translate.js — Versão "Hard Delete"
const DEFAULT_LANG = "pt"; 

function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        includedLanguages: "pt,en,es,zh-CN,ja,ko,id,tl,ru,it,fr,hi,ms,vi,ar",
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false
    }, "google_translate_element");

    // Inicia a limpeza imediata e contínua
    startGlobalCleaner();
}

function startGlobalCleaner() {
    const selectorToKill = [
        '.goog-te-spinner-pos',
        '.goog-te-spinner',
        '.goog-te-loader',
        '#goog-gt-tt',
        '.goog-te-banner-frame',
        '.goog-te-banner'
    ].join(',');

    const clean = () => {
        // 1. Remove fisicamente os elementos do HTML
        const elements = document.querySelectorAll(selectorToKill);
        elements.forEach(el => {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        });

        // 2. Reseta o Body (impede que a página "pule" para baixo)
        if (document.body.style.top !== '0px' || document.body.style.marginTop !== '0px') {
            document.body.style.top = '0px !important';
            document.body.style.marginTop = '0px !important';
            document.body.style.position = 'static !important';
        }
    };

    // Executa a cada 30ms (extremamente rápido para o olho humano não ver)
    const cleanerInterval = setInterval(clean, 30);

    // Para economizar memória, se após 10 segundos nada novo aparecer, 
    // diminuímos a frequência, mas não paramos.
    setTimeout(() => {
        clearInterval(cleanerInterval);
        setInterval(clean, 200);
    }, 10000);
}

// --- Funções de Sincronização e Cookie ---

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

document.addEventListener("DOMContentLoaded", () => {
    syncSelectorWithCookie();
});