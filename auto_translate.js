// auto_translate.js — Versão Multi-Language + Fix TopBar + Spinner Fix

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
    
    // Função para remover a barra superior e corrigir margens
    const removeBar = () => {
        const frames = document.querySelectorAll('.goog-te-banner-frame');
        frames.forEach(frame => {
            frame.style.display = 'none';
            frame.style.visibility = 'hidden';
            frame.style.height = '0';
        });
        
        // Garante que o body não desça
        if (document.body.style.marginTop !== '0px') {
            document.body.style.marginTop = '0px';
            document.body.style.top = '0px';
            document.body.style.position = 'static';
        }
    };

    // Função específica para esconder o Loader/Spinner e Tooltips
    const hideSpinner = () => {
        // Seleciona o container do loader redondo
        const spinner = document.querySelector('.goog-te-spinner-pos');
        if (spinner) {
            spinner.style.display = 'none';
            spinner.style.visibility = 'hidden';
            spinner.style.width = '0';
            spinner.style.height = '0';
            spinner.style.zIndex = '-1000'; // Garante que não bloqueie cliques
        }

        // Opcional: Remove também o balão de tooltip se ele aparecer
        const balloon = document.querySelector('.goog-te-balloon-frame');
        if (balloon) {
            balloon.style.display = 'none';
        }
    };

    // Executa imediatamente na carga
    removeBar();
    hideSpinner();

    // Cria o vigilante
    const observer = new MutationObserver(() => {
        // Se algo mudar, forçamos a remoção novamente
        removeBar();
        hideSpinner();
    });

    // CONFIGURAÇÃO CRUCIAL:
    // 'attributes': detecta mudança no style (margin-top do body)
    // 'childList': detecta quando o Google INJETA o loader no HTML
    // 'subtree': garante que verifique elementos aninhados
    observer.observe(document.body, { 
        attributes: true, 
        attributeFilter: ['style'], 
        childList: true, 
        subtree: true 
    });
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
// 6. Eventos
// ======================================================================
document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("languageSelector");
    if (selector) {
        selector.addEventListener("change", e => window.changeLanguage(e.target.value));
    }
    syncSelectorWithCookie();
    
    // Garante que rode no load
    window.onload = fixGoogleLayout;
});