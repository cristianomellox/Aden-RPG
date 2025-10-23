// guild_pv.js - integração de mensagens privadas no modal da guilda
document.addEventListener("DOMContentLoaded", () => {
    const supabaseClient = window.supabaseClient || window.supabase;
    const showFloatingMessage = window.showFloatingMessage || console.log;
    const openChatView = window.openChatView;
    const pvModal = document.getElementById('pvModal');
    const playerModal = document.getElementById('playerModal');
    const chatWithName = document.getElementById('pv-chat-with-name');

    // Função principal
    async function startPrivateConversation(targetPlayerId, targetPlayerName) {
        try {
            const { data, error } = await supabaseClient.rpc('get_or_create_private_conversation', {
                target_player_id: targetPlayerId
            });
            if (error) throw error;

            const conversationId = String(data.conversation_id);
            if (playerModal) playerModal.style.display = 'none';
            if (pvModal) pvModal.style.display = 'flex';

            if (typeof openChatView === 'function') {
                openChatView(conversationId, targetPlayerName);
            } else if (chatWithName) {
                chatWithName.textContent = targetPlayerName;
            }

            showFloatingMessage(`Conversa com ${targetPlayerName} aberta`);
        } catch (err) {
            console.error("Erro ao iniciar PV:", err);
            showFloatingMessage(`Erro ao iniciar PV: ${err.message}`);
        }
    }

    // Espera até o botão #sendmp existir
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

    async function attachSendMpListener() {
        const sendMpButton = await waitForButton();
        if (!sendMpButton) return console.warn("Botão #sendmp não encontrado.");

        sendMpButton.addEventListener('click', async () => {
            const targetPlayerId = sendMpButton.getAttribute('data-player-id');
            const targetPlayerName = sendMpButton.getAttribute('data-player-name');

            if (!targetPlayerId || !targetPlayerName) {
                showFloatingMessage('Erro: dados do jogador não encontrados.');
                return;
            }

            await startPrivateConversation(targetPlayerId, targetPlayerName);
        });

        console.log('[guild_pv.js] Listener de #sendmp ativo');
    }

    // --- GARANTE QUE O MODAL PV POSSA SER FECHADO ---
    function setupCloseHandlers() {
        if (!pvModal) {
            console.warn('[guild_pv.js] pvModal não encontrado; handlers de fechar não foram anexados.');
            return;
        }

        // Tenta múltiplos seletores possíveis para o botão de fechar
        const closeBtnSelectors = [
            '#closePvModalBtn',           // id esperado
            '.close-pv',                  // alternativa
            '.pv-close',                  // alternativa
            '#pvModal .close-btn',        // estrutura comum
            '.modal#pvModal .close-btn'   // alternativa
        ];

        let closeBtn = null;
        for (const sel of closeBtnSelectors) {
            try {
                const found = document.querySelector(sel);
                if (found) { closeBtn = found; break; }
            } catch (e) {
                // ignore invalid selectors (safety)
            }
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                pvModal.style.display = 'none';
                console.log('[guild_pv.js] pvModal fechado pelo botão.');
            });
        } else {
            // Se não encontrou o botão, loga e continua (não é fatal)
            console.warn('[guild_pv.js] Botão de fechar do PV não encontrado; disponível apenas fechar por clique externo/Escape.');
        }

        // Fecha ao clicar fora do conteúdo (clicando no backdrop)
        pvModal.addEventListener('click', (ev) => {
            if (ev.target === pvModal) {
                pvModal.style.display = 'none';
                console.log('[guild_pv.js] pvModal fechado clicando no backdrop.');
            }
        });

        // Fecha com tecla Escape
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' || ev.key === 'Esc') {
                if (pvModal.style.display && pvModal.style.display !== 'none') {
                    pvModal.style.display = 'none';
                    console.log('[guild_pv.js] pvModal fechado pela tecla Escape.');
                }
            }
        });
    }

    // Inicializa listeners
    attachSendMpListener().catch(e => console.error('[guild_pv.js] erro ao anexar sendmp listener:', e));
    setupCloseHandlers();
});
