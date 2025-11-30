// auto_translate.js — versão 2025 totalmente funcional

const DEFAULT_LANG = "en"; // idioma original do jogo

// ======================================================================
// 1. Inicialização do Google Translate (widget oculto mas funcional)
// ======================================================================
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        includedLanguages: "pt,en,es",
        autoDisplay: false
    }, "google_translate_element");

    // Sincroniza o seletor com o cookie atual
    syncSelectorWithCookie();
}

// ======================================================================
// 2. Lê o cookie "googtrans" para saber o idioma atual
// ======================================================================
function getCurrentLangFromCookie() {
    const cookies = document.cookie.split(";").map(c => c.trim());

    const googCookie = cookies.find(c => c.startsWith("googtrans="));
    if (!googCookie) return DEFAULT_LANG;

    const value = googCookie.replace("googtrans=", "").trim(); // ex: "/pt/en"
    const parts = value.split("/");

    // A última parte contém o idioma de destino
    return parts[parts.length - 1] || DEFAULT_LANG;
}

// ======================================================================
// 3. Sincroniza o <select> com o idioma armazenado
// ======================================================================
function syncSelectorWithCookie() {
    const selector = document.getElementById("languageSelector");
    if (!selector) return;

    const lang = getCurrentLangFromCookie();

    if (selector.querySelector(`option[value="${lang}"]`))
        selector.value = lang;
    else
        selector.value = DEFAULT_LANG;
}

// ======================================================================
// 4. Trocar idioma via cookies (novo método oficial)
// ======================================================================
function changeLanguage(lang) {
    if (lang === DEFAULT_LANG) {
        // limpar cookies (voltar para o português)
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = `googtrans=; domain=.${window.location.hostname}; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    } else {
        const cookieValue = `/pt/${lang}`;

        // define cookies nas duas versões necessárias
        document.cookie = `googtrans=${cookieValue}; path=/;`;
        document.cookie = `googtrans=${cookieValue}; domain=.${window.location.hostname}; path=/;`;
    }

    // recarrega página para aplicar tradução
    window.location.reload();
}

// ======================================================================
// 5. Evento do seletor personalizado
// ======================================================================
document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("languageSelector");
    if (!selector) return;

    selector.addEventListener("change", e => {
        changeLanguage(e.target.value);
    });

    syncSelectorWithCookie();
});
