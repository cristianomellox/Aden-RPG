// auto_translate.js — Versão Multi-Language + Fix TopBar + Fix Spinner

const DEFAULT_LANG = "pt"; 

// ======================================================================
// 1. Inicialização do Google Translate
// ======================================================================
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        // LISTA DE IDIOMAS
        includedLanguages: "pt,en,es,zh-CN,ja,ko,id,tl,ru,it,fr,hi,ms,vi,ar",
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false
    }, "google_translate_element");

    syncSelectorWithCookie();
    fixGoogleLayout(); 
}

// ======================================================================
// 2. Vigilância Ativa (MutationObserver) - ATUALIZADO
// ======================================================================
function fixGoogleLayout() {
    // Função para limpar elementos indesejados
    const cleanGoogleElements = () => {
        // Remove a barra do topo
        const frames = document.querySelectorAll('.goog-te-banner-frame');
        frames.forEach(frame => {
            frame.style.display = 'none';
            frame.style.visibility = 'hidden';
            frame.style.height = '0';
        });

        // Remove o Spinner/Loader redondo
        const spinners = document.querySelectorAll('.goog-te-spinner-pos');
        spinners.forEach(spinner => {
            spinner.style.display = 'none'; // Garante display none
            spinner.remove(); // Remove do DOM fisicamente
        });

        // Corrige margem do body
        if (document.body.style.marginTop !== '0px') {
            document.body.style.marginTop = '0px';
            document.body.style.top = '0px';
        }
    };

    // Executa imediatamente
    cleanGoogleElements();

    // Cria o observador
    const observer = new MutationObserver((mutations) => {
        let shouldClean = false;
        
        mutations.forEach((mutation) => {
            // Se mudou estilo do body (margem)
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                shouldClean = true;
            }
            // Se adicionou novos nós (como o spinner injetado)
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // É um elemento HTML
                        // Verifica se é o frame ou o spinner
                        if (node.classList && (node.classList.contains('goog-te-banner-frame') || node.classList.contains('goog-te-spinner-pos'))) {
                            shouldClean = true;
                        }
                    }
                });
            }
        });

        if (shouldClean) {
            cleanGoogleElements();
        }
    });

    // Configuração do observador: vigia atributos E novos elementos filhos
    observer.observe(document.body, { 
        attributes: true, 
        attributeFilter: ['style'], 
        childList: true, 
        subtree: false 
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
    
    // Fallback: Tenta limpar periodicamente nos primeiros segundos caso o Observer falhe
    let checkCount = 0;
    const interval = setInterval(() => {
        fixGoogleLayout();
        checkCount++;
        if (checkCount > 20) clearInterval(interval); // Para após 10 segundos (20 * 500ms)
    }, 500);

    window.onload = fixGoogleLayout;
});