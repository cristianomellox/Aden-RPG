document.addEventListener("DOMContentLoaded", () => {
    // Inicializa o Supabase (assumindo que as constantes já estão no window)
    const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    
    // Tenta usar o client global do script.js se existir, senão cria um novo
    const supabase = window.supabaseClient || supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    if (!supabase) {
        console.error("Redeem.js: Falha ao inicializar o Supabase client.");
        return;
    }

    // --- Referências do DOM ---
    const redeemModal = document.getElementById('redeemCodeModal');
    // const openRedeemButton = document.querySelector('.menu-item[data-modal="redeemCodeModal"]'); // <-- REMOVIDO
    const closeRedeemButton = document.getElementById('closeRedeemCodeModal');
    const confirmRedeemButton = document.getElementById('confirmRedeemCodeBtn');
    const redeemCodeInput = document.getElementById('redeemCodeInput');
    const redeemMessage = document.getElementById('redeemCodeMessage');

    // --- Abrir o modal ---
    // O bloco que estava aqui foi removido.
    // O script.js agora lida com a abertura do modal.

    // --- Fechar o modal ---
    if (closeRedeemButton) {
        closeRedeemButton.addEventListener('click', () => {
            if (redeemModal) {
                redeemModal.style.display = 'none';
            }
        });
    }

    // --- Lógica de Resgate ---
    if (confirmRedeemButton) {
        confirmRedeemButton.addEventListener('click', async () => {
            const code = redeemCodeInput.value.trim().toUpperCase(); // Normaliza o código

            if (!code) {
                redeemMessage.textContent = 'Por favor, digite um código.';
                redeemMessage.style.color = 'orange';
                return;
            }

            confirmRedeemButton.disabled = true;
            redeemMessage.textContent = 'Validando código...';
            redeemMessage.style.color = 'white';

            try {
                // Chama a função RPC criada no banco de dados
                const { data, error } = await supabase.rpc('redeem_promo_code', {
                    p_code: code
                });

                if (error) throw error;

                // A RPC retorna uma string com a mensagem
                const message = data;

                if (message.includes('sucesso')) {
                    redeemMessage.textContent = message;
                    redeemMessage.style.color = 'lime';
                    
                    // Atualiza os dados do jogador na UI (importante se o prêmio for gold/crystals)
                    if (typeof fetchAndDisplayPlayerInfo === 'function') {
                        // Força o refresh (true) e preserva o container (true)
                        fetchAndDisplayPlayerInfo(true, true); 
                    }
                    
                    // Fecha o modal após o sucesso
                    setTimeout(() => {
                        redeemModal.style.display = 'none';
                        confirmRedeemButton.disabled = false;
                    }, 2500);

                } else {
                    // Mensagens de erro da RPC (código expirado, já usado, etc.)
                    redeemMessage.textContent = message;
                    redeemMessage.style.color = 'orange';
                    confirmRedeemButton.disabled = false;
                }

            } catch (err) {
                console.error("Erro ao resgatar código:", err);
                redeemMessage.textContent = 'Erro de conexão. Tente novamente.';
                redeemMessage.style.color = 'red';
                confirmRedeemButton.disabled = false;
            }
        });
    }

    // Fecha o modal se clicar fora dele
    if (redeemModal) {
        redeemModal.addEventListener('click', (event) => {
            if (event.target === redeemModal) {
                redeemModal.style.display = 'none';
            }
        });
    }
});