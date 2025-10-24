// guild_pv.js - integração de mensagens privadas no modal da guilda
document.addEventListener("DOMContentLoaded", () => {
    const showFloatingMessage = window.showFloatingMessage || console.log;

    /**
     * Redireciona para a página principal (index.html) para iniciar uma conversa privada.
     * @param {string} targetPlayerId - O ID do jogador alvo.
     * @param {string} targetPlayerName - O nome do jogador alvo.
     */
    function startPrivateConversation(targetPlayerId, targetPlayerName) {
        if (!targetPlayerId || !targetPlayerName) {
            showFloatingMessage('Erro: dados do jogador-alvo ausentes.');
            return;
        }
        // Constrói a URL com os parâmetros necessários para o index.html lidar com a ação
        const url = `index.html?action=open_pv&target_id=${encodeURIComponent(targetPlayerId)}&target_name=${encodeURIComponent(targetPlayerName)}`;
        
        // Redireciona o usuário
        window.location.href = url;
    }

    // Espera até o botão #sendmp existir no DOM
    function waitForButton() {
        return new Promise(resolve => {
            const existing = document.getElementById('sendmp');
            if (existing) return resolve(existing);
            const observer = new MutationObserver(() => {
                const btn = document.getElementById('sendmp');
                if (btn) {
                    observer.disconnect();
                    resolve(btn);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    // Anexa o listener de clique ao botão #sendmp
    async function attachSendMpListener() {
        const sendMpButton = await waitForButton();
        if (!sendMpButton) return console.warn("Botão #sendmp não encontrado.");

        sendMpButton.addEventListener('click', () => {
            const targetPlayerId = sendMpButton.getAttribute('data-player-id');
            const targetPlayerName = sendMpButton.getAttribute('data-player-name');

            if (!targetPlayerId || !targetPlayerName) {
                showFloatingMessage('Erro: dados do jogador não encontrados.');
                return;
            }

            startPrivateConversation(targetPlayerId, targetPlayerName);
        });

        console.log('[guild_pv.js] Listener de #sendmp ativo para redirecionamento.');
    }

    // Inicializa o listener
    attachSendMpListener().catch(e => console.error('[guild_pv.js] erro ao anexar sendmp listener:', e));
});