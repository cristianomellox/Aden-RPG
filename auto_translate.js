// auto_translate.js — Tradução única por reload (SEM tradução em tempo real)

const DEFAULT_LANG = "pt";

// ======================================================================
// 1. Inicialização do Google Translate (UMA VEZ)
// ======================================================================
function googleTranslateElementInit() {
    new google.translate.TranslateElement(
        {
            pageLanguage: DEFAULT_LANG,
            includedLanguages: "pt,en,es,zh-CN,ja,ko,id,tl,ru,it,fr,hi,ms,vi,ar",
            autoDisplay: false
        },
        "google_translate_element"
    );
}

// ======================================================================
// 2. Lê o idioma atual do cookie "googtrans"
// ======================================================================
function getCurrentLangFromCookie() {
    try {
        const cookies = document.cookie.split(";").map(c => c.trim());
        const goog = cookies.find(c => c.startsWith("googtrans="));
        if (!goog) return DEFAULT_LANG;

        const parts = goog.replace("googtrans=", "").split("/");
        return parts[parts.length - 1] || DEFAULT_LANG;
    } catch {
        return DEFAULT_LANG;
    }
}

// ======================================================================
// 3. Sincroniza selector (se existir na página)
// ======================================================================
function syncSelectorWithCookie() {
    const selector = document.getElementById("languageSelector");
    if (!selector) return;

    const lang = getCurrentLangFromCookie();
    if (selector.querySelector(`option[value="${lang}"]`)) {
        selector.value = lang;
    } else {
        selector.value = DEFAULT_LANG;
    }
}

// ======================================================================
// 4. Troca de idioma (cookie + reload)
// ======================================================================
window.changeLanguage = function (lang) {
    if (lang === DEFAULT_LANG) {
        // Remove tradução
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = `googtrans=; domain=.${location.hostname}; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    } else {
        const val = `/pt/${lang}`;
        document.cookie = `googtrans=${val}; path=/;`;
        document.cookie = `googtrans=${val}; domain=.${location.hostname}; path=/;`;
    }

    // Reload força tradução única
    location.reload();
};

// ======================================================================
// 5. Pós-load: remove barra e BLOQUEIA retradução
// ======================================================================
window.addEventListener("load", () => {
    syncSelectorWithCookie();

    setTimeout(() => {
        try {
            // Remove banner do Google
            document.querySelectorAll(".goog-te-banner-frame").forEach(f => f.remove());

            // Corrige deslocamento do body
            document.body.style.marginTop = "0";
            document.body.style.top = "0";

            // Mata tradução dinâmica
            document.documentElement.setAttribute("translate", "no");
            document.body.setAttribute("translate", "no");

            // Remove classe que ativa observer interno
            document.body.classList.remove("goog-te-enabled");
        } catch (e) {}
    }, 800);
});

// ======================================================================
// 6. DOM Ready
// ======================================================================
document.addEventListener("DOMContentLoaded", () => {
    syncSelectorWithCookie();
});
