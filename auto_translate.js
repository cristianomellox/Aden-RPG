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
    
    // >>> INICIA O LOOP DE REMOÇÃO FORÇADA A CADA 500ms <<<
    // Chama a função imediatamente e depois a cada 500ms
    forceRemoveTranslateBar();
    setInterval(forceRemoveTranslateBar, 500); 
}

// ======================================================================
// 2. Função para remover o iframe da barra de tradução e o margin-top
//    (Chamada em loop para anular a reinjeção do Google)
// ======================================================================
function forceRemoveTranslateBar() {
    // 1. Oculta o iframe principal da barra
    const topBar = document.querySelector('.goog-te-banner-frame');
    if (topBar) {
        // Aplica estilos inline diretamente no iframe
        topBar.style.setProperty('display', 'none', 'important');
        topBar.style.setProperty('visibility', 'hidden', 'important');
    }
    
    // 2. Remove o margin-top que a barra adiciona à tag <body>
    document.body.style.setProperty('margin-top', '0px', 'important');
    document.body.style.setProperty('top', '0px', 'important');
}

// ======================================================================
// 3. Lê o cookie "googtrans" para saber o idioma atual
// ... (o restante do seu código JavaScript permanece o mesmo)