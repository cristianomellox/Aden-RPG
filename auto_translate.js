// auto_translate.js — Versão Multi-Language + Fix TopBar

const DEFAULT_LANG = "pt"; 

// ======================================================================
// 1. Inicialização do Google Translate
// ======================================================================
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        // LISTA ATUALIZADA DE IDIOMAS SOLICITADOS
        includedLanguages: "pt,en,es,zh-CN,ja,ko,id,tl,ru,it,fr,hi,ms,vi,ar",
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

// Exposta globalmente para ser usada pelo Modal de Intro
window.changeLanguage = async function(lang) {
    if (lang === DEFAULT_LANG) {
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = `googtrans=; domain=.${window.location.hostname}; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    } else {
        const cookieValue = `/pt/${lang}`;
        document.cookie = `googtrans=${cookieValue}; path=/;`;
        document.cookie = `googtrans=${cookieValue}; domain=.${window.location.hostname}; path=/;`;
    }

    // Também salva o idioma no banco (players.language) — é o que o worker
    // de push usa pra traduzir as notificações, já que ele roda fora do
    // navegador e não tem acesso a cookie nenhum. IMPORTANTE: precisa
    // terminar ANTES do reload, senão o navegador cancela a requisição no
    // meio (é exatamente o que estava acontecendo). Best-effort: se o
    // jogador ainda não estiver logado, a página não tiver o
    // supabaseClient carregado, ou a gravação demorar mais que 2.5s, só
    // segue com o reload mesmo assim — a tradução da PÁGINA continua
    // funcionando via cookie de qualquer jeito, só as notificações ficam
    // sem sincronizar até uma próxima troca de idioma bem-sucedida.
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.rpc) {
            await withTimeout(supabaseClient.rpc('set_player_language', { p_lang: lang }), 2500);
        }
    } catch (_) { /* segue mesmo assim */ }

    window.location.reload();
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