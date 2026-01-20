// auto_translate.js — Versão Force Delete

const DEFAULT_LANG = "pt"; 

function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        includedLanguages: "pt,en,es,zh-CN,ja,ko,id,tl,ru,it,fr,hi,ms,vi,ar",
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false
    }, "google_translate_element");

    // Inicia a limpeza agressiva
    startAggressiveCleaner();
}

function startAggressiveCleaner() {
    const clean = () => {
        // 1. Remove a barra de topo e margem do body
        const frames = document.querySelectorAll('.goog-te-banner-frame, .goog-te-banner');
        frames.forEach(f => f.remove()); // .remove() é mais eficaz que display:none

        if (document.body.style.top !== '0px' || document.body.style.marginTop !== '0px') {
            document.body.style.top = '0px';
            document.body.style.marginTop = '0px';
        }

        // 2. Localiza o SPINNER (Loader redondo)
        // Tentamos por classe, por atributo e por tags de imagem comuns do Google
        const spinners = document.querySelectorAll([
            '.goog-te-spinner-pos',
            '.goog-te-spinner',
            '[id*="goog-te-spinner"]',
            '.sk-circle', // Algumas versões usam classes de animação específicas
            '#goog-gt-tt'  // Tooltip que as vezes trava o spinner
        ].join(','));
        
        spinners.forEach(s => {
            s.style.opacity = '0';
            s.style.pointerEvents = 'none';
            s.style.display = 'none';
        });
    };

    // Roda a cada 50ms para garantir que o loader não tenha tempo de aparecer
    setInterval(clean, 50);
}

// --- Funções de Cookie (Mantidas iguais) ---

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