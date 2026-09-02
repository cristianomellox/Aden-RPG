// auto_translate.js — Versão Multi-Language + Fix TopBar

const DEFAULT_LANG = "pt"; 
const SUPPORTED_LANGS = ["pt","en","es","zh-CN","ja","ko","id","tl","ru","it","fr","hi","ms","vi","ar"];

// ======================================================================
// 0. Suporte a link compartilhado com idioma (?lang=xx)
// ======================================================================
// Quando alguém compartilha o jogo (menu Opções > Compartilhar), o link
// pode vir com "?lang=xx" embutido (idioma que o jogador que compartilhou
// tinha selecionado). Se quem RECEBEU o link ainda não tem preferência de
// idioma salva no cookie, aplicamos esse idioma automaticamente ANTES do
// Google Translate inicializar, pra página já abrir traduzida — sem
// precisar de reload nem de páginas duplicadas por idioma.
// Isso roda uma única vez, no topo do arquivo, antes de qualquer outra
// coisa, porque o cookie precisa estar pronto quando googleTranslateElementInit()
// rodar (o script do Google carrega de forma assíncrona depois deste arquivo).
(function applyLangFromSharedLink() {
    try {
        const params = new URLSearchParams(window.location.search);
        const sharedLang = params.get('lang');
        if (!sharedLang || !SUPPORTED_LANGS.includes(sharedLang) || sharedLang === DEFAULT_LANG) return;

        const alreadyHasCookie = document.cookie.split(";").some(c => c.trim().startsWith("googtrans="));
        if (alreadyHasCookie) return; // não sobrescreve preferência de quem já jogou antes

        const cookieValue = `/${DEFAULT_LANG}/${sharedLang}`;
        document.cookie = `googtrans=${cookieValue}; path=/;`;
        document.cookie = `googtrans=${cookieValue}; domain=.${window.location.hostname}; path=/;`;
    } catch (e) {
        // best-effort — se der erro, a página só abre no idioma padrão
    }
})();

// ======================================================================
// 1. Inicialização do Google Translate
// ======================================================================
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        // LISTA ATUALIZADA DE IDIOMAS SOLICITADOS
        includedLanguages: SUPPORTED_LANGS.join(","),
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false
    }, "google_translate_element");

    syncSelectorWithCookie();
    fixGoogleLayout(); 
}

// ======================================================================
// 2. Vigilância Ativa (MutationObserver)
// ======================================================================
function fixGoogleLayout() {
    const removeBar = () => {
        const frames = document.querySelectorAll('.goog-te-banner-frame');
        frames.forEach(frame => {
            frame.style.display = 'none';
            frame.style.visibility = 'hidden';
            frame.style.height = '0';
        });
        if (document.body.style.marginTop !== '0px') {
            document.body.style.marginTop = '0px';
            document.body.style.top = '0px';
        }
    };
    removeBar();
    const observer = new MutationObserver(() => {
        if (document.body.style.marginTop && document.body.style.marginTop !== '0px') {
            removeBar();
        }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
}

// ======================================================================
// 3. Lê o cookie "googtrans"
// ======================================================================
function getCurrentLangFromCookie() {
    const cookies = document.cookie.split(";").map(c => c.trim());
    const googCookie = cookies.find(c => c.startsWith("googtrans="));
    if (!googCookie) return DEFAULT_LANG;
    const value = googCookie.replace("googtrans=", "").trim(); 
    const parts = value.split("/");
    return parts[parts.length - 1] || DEFAULT_LANG;
}

// ======================================================================
// 4. Sincroniza o seletor (se existir na página)
// ======================================================================
function syncSelectorWithCookie() {
    const selector = document.getElementById("languageSelector");
    if (!selector) return;
    const lang = getCurrentLangFromCookie();
    if (selector.querySelector(`option[value="${lang}"]`)) selector.value = lang;
    else selector.value = DEFAULT_LANG;
}

// ======================================================================
// 5. Trocar idioma via cookies
// ======================================================================
// Espera uma Promise, mas nunca por mais que `ms` — usado pra garantir que
// o reload sempre acontece, mesmo se a gravação no banco travar por algum
// motivo (rede lenta, etc).
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(resolve, ms)),
    ]);
}

// Exposta globalmente — usada tanto pelo seletor #languageSelector (se
// existir na página) quanto pelo Modal de Idioma em script.js
// (window.openLanguageModal, tanto no Intro quanto no botão "Idioma" do
// menu Opções). skipReload=true é usado pelo fluxo de Intro, que não
// recarrega a página (só inicia o vídeo de abertura) — mesmo assim o
// idioma precisa ser salvo no banco antes de prosseguir.
window.changeLanguage = async function(lang, skipReload) {
    if (lang === DEFAULT_LANG) {
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = `googtrans=; domain=.${window.location.hostname}; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    } else {
        const cookieValue = `/pt/${lang}`;
        document.cookie = `googtrans=${cookieValue}; path=/;`;
        document.cookie = `googtrans=${cookieValue}; domain=.${window.location.hostname}; path=/;`;
    }

    // Best-effort: tenta persistir o idioma no banco (usado pelo worker de
    // push pra traduzir notificações). Se o jogador não estiver logado, ou
    // se der erro de rede, apenas ignora — a troca de idioma da PÁGINA já
    // aconteceu via cookie e continua funcionando normalmente.
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.rpc) {
            await withTimeout(supabaseClient.rpc('set_player_language', { p_lang: lang }), 2500);
        }
    } catch (err) {
        console.warn('[auto_translate] Falha ao sincronizar idioma com o servidor:', err);
    }

    if (!skipReload) window.location.reload();
}

// ======================================================================
// 6. Eventos
// ======================================================================
document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("languageSelector");
    if (selector) {
        selector.addEventListener("change", e => window.changeLanguage(e.target.value));
    }
    syncSelectorWithCookie();
    window.onload = fixGoogleLayout;
});

// Exposto globalmente — usado pelo modal de Compartilhar (index.html) para
// montar o link com "?lang=xx" no idioma atual do jogador.
window.getCurrentLangFromCookie = getCurrentLangFromCookie;
window.ADEN_SUPPORTED_LANGS = SUPPORTED_LANGS;