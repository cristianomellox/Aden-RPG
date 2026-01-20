// auto_translate.js — Versão Nuclear (Anti-Spinner)

const DEFAULT_LANG = "pt"; 

// ======================================================================
// 1. Inicialização do Google Translate
// ======================================================================
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        includedLanguages: "pt,en,es,zh-CN,ja,ko,id,tl,ru,it,fr,hi,ms,vi,ar",
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false
    }, "google_translate_element");

    syncSelectorWithCookie();
    
    // Inicia a vigilância imediatamente após carregar
    startAggressiveCleanup();
}

// ======================================================================
// 2. Limpeza Agressiva (The Nuclear Option)
// ======================================================================
function startAggressiveCleanup() {
    
    // Função que aplica o estilo inline para garantir sumiço
    const nukeElement = (el) => {
        if (!el) return;
        el.style.display = 'none';
        el.style.visibility = 'hidden';
        el.style.opacity = '0';
        el.style.width = '0';
        el.style.height = '0';
        el.style.pointerEvents = 'none';
        el.style.position = 'absolute';
        el.style.top = '-9999px';
        el.style.zIndex = '-9999';
    };

    const cleanup = () => {
        // 1. Mata o Spinner
        const spinners = document.querySelectorAll('.goog-te-spinner-pos, .goog-te-spinner-animation');
        spinners.forEach(nukeElement);

        // 2. Mata o Banner Topo
        const frames = document.querySelectorAll('.goog-te-banner-frame, iframe[id^=":"]');
        frames.forEach(frame => {
            // Verifica se é frame do google pelo ID ou classe
            if (frame.classList.contains('goog-te-banner-frame') || (frame.id && frame.id.includes('.container'))) {
                nukeElement(frame);
            }
        });

        // 3. Reseta o Body
        if (document.body.style.marginTop && document.body.style.marginTop !== '0px') {
            document.body.style.marginTop = '0px';
            document.body.style.top = '0px';
        }
    };

    // EXECUÇÃO IMEDIATA
    cleanup();

    // LOOP RÁPIDO (A cada 50ms) - Para pegar assim que nasce
    // Roda intensamente nos primeiros 5 segundos
    let count = 0;
    const interval = setInterval(() => {
        cleanup();
        count++;
        if (count > 100) { // 100 * 50ms = 5 segundos
            clearInterval(interval);
            // Depois de 5s, muda para um observer mais leve
            startObserver(); 
        }
    }, 50);
}

// ======================================================================
// 3. Vigilância Constante (Observer) - Para mudanças tardias
// ======================================================================
function startObserver() {
    const observer = new MutationObserver((mutations) => {
        let needsClean = false;
        mutations.forEach(m => {
            if (m.type === 'childList' || (m.type === 'attributes' && m.attributeName === 'style')) {
                needsClean = true;
            }
        });
        if (needsClean) {
            // Re-aplica a lógica simples de limpeza
            const spinners = document.querySelectorAll('.goog-te-spinner-pos');
            if (spinners.length > 0) {
                spinners.forEach(el => {
                     el.style.display = 'none';
                     el.style.top = '-9999px';
                });
            }
            if (document.body.style.marginTop !== '0px') {
                document.body.style.marginTop = '0px';
                document.body.style.top = '0px';
            }
        }
    });

    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['style'],
        childList: true,
        subtree: true // Olha dentro de tudo
    });
}

// ======================================================================
// 4. Utilitários de Cookie e Idioma (Mantidos)
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
// 5. Inicializadores
// ======================================================================
document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("languageSelector");
    if (selector) {
        selector.addEventListener("change", e => window.changeLanguage(e.target.value));
    }
    syncSelectorWithCookie();
});

// Garante limpeza extra no window.onload
window.onload = function() {
    startAggressiveCleanup();
};