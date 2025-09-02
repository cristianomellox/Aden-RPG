function hideElementById(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function showElementById(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

function showOnly(idsToShow) {
    const all = [
        'authContainer', 'playerInfoDiv', 'afkContainer',
        'chatContainer', 'footerMenu', 'chatBubble', 'profileEditModal'
    ];
    all.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (idsToShow.includes(id)) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    // ✅ Mostrar loginHeader apenas na tela de login
    const loginHeader = document.getElementById('loginHeader');
    if (loginHeader) {
        if (idsToShow.includes('authContainer')) {
            loginHeader.style.display = 'block';
        } else {
            loginHeader.style.display = 'none';
        }
    }
}