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

    // >>> DEBUG TEMPORÁRIO — mostra na tela o resultado real da chamada,
    // já que não dá pra abrir o console no celular. Remover depois de
    // descobrir o problema (ver comentário mais abaixo, antes do reload).
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.rpc) {
            const result = await withTimeout(supabaseClient.rpc('set_player_language', { p_lang: lang }), 2500);
            alert('DEBUG set_player_language:\n' + JSON.stringify(result, null, 2));
        } else {
            alert('DEBUG: supabaseClient não está definido nesta página (typeof = ' + typeof supabaseClient + ')');
        }
    } catch (err) {
        alert('DEBUG: erro ao chamar set_player_language:\n' + (err && err.message ? err.message : String(err)));
    }
    // >>> FIM DO DEBUG TEMPORÁRIO <<<

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