// Remova o setInterval e deixe apenas o setTimeout
function googleTranslateElementInit() {
    new google.translate.TranslateElement({
        pageLanguage: DEFAULT_LANG,
        includedLanguages: "pt,en,es",
        autoDisplay: false
    }, "google_translate_element");

    syncSelectorWithCookie();
    
    // Mantenha apenas o setTimeout - 500ms é um bom ponto de partida
    setTimeout(removeTranslateBar, 500);
}

// Mantenha esta função em auto_translate.js
function removeTranslateBar() {
    const topBar = document.querySelector('.goog-te-banner-frame');
    if (topBar) {
        // Use setProperty para ser agressivo
        topBar.style.setProperty('display', 'none', 'important');
        topBar.style.setProperty('visibility', 'hidden', 'important');
    }
    
    // Remova o margin-top
    document.body.style.setProperty('margin-top', '0px', 'important');
    document.body.style.setProperty('top', '0px', 'important');
}

// ... o restante do seu código (getCurrentLangFromCookie, etc.)