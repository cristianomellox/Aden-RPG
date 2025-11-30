// auto_translate.js — versão 2025 totalmente funcional

const DEFAULT_LANG = "pt"; // idioma original do jogo

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
    
    // >>> CHAMADA PARA REMOVER A BARRA APÓS A INICIALIZAÇÃO <<<
    // Usamos um pequeno atraso para garantir que a barra tenha tempo de ser renderizada.
    setTimeout(removeTranslateBar, 500);
}

// ======================================================================
// 2. Função para remover o iframe da barra de tradução e o margin-top
// ======================================================================
function removeTranslateBar() {
    // 1. Remove o iframe principal da barra (goog-te-banner-frame)
    const topBar = document.querySelector('.goog-te-banner-frame');
    if (topBar) {
        topBar.style.display = 'none';
        topBar.style.visibility = 'hidden';
        console.log("Topbar do Google Translate removida via JavaScript.");
    }
    
    // 2. Remove o margin-top que a barra adiciona à tag <body>
    document.body.style.marginTop = '0px';
    document.body.style.top = '0px';
    
    // 3. Remove a barra de rolagem horizontal que às vezes aparece
    document.body.style.overflowX = 'hidden';
}

// ======================================================================
// 3. Lê o cookie "googtrans" para saber o idioma atual
// ... (o restante do seu código JavaScript permanece o mesmo)