// reward.js - SUBSTITUA TODO O CONTEÚDO DO ARQUIVO

document.addEventListener('DOMContentLoaded', async () => {
    const messageDiv = document.getElementById('reward-message');

    // Inicializa o Supabase Client
    const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Pega o token de resgate da URL
    const urlParams = new URLSearchParams(window.location.search);
    const claimToken = urlParams.get('claim_token');

    if (!claimToken) {
        messageDiv.textContent = 'Erro: Token de recompensa ausente. Feche esta janela e tente novamente.';
        return;
    }

    try {
        messageDiv.textContent = 'Processando sua recompensa...';
        
        // Chama a RPC para conceder a recompensa usando o token
        const { data: rpcData, error: rpcError } = await supabaseClient.rpc('grant_daily_reward', {
            p_claim_token: claimToken
        });

        if (rpcError) throw rpcError;

        messageDiv.innerHTML = `<h2>Recompensa Recebida!</h2><p>${rpcData}</p><p>Esta janela fechará em breve.</p>`;

        // Notifica a página principal (index.html) para fechar o modal e atualizar a UI
        setTimeout(() => {
            window.parent.postMessage('reward-claimed-and-close', window.location.origin);
        }, 3000); // Espera 3 segundos para o jogador ler a mensagem

    } catch (error) {
        messageDiv.textContent = `Ocorreu um erro: ${error.message}`;
    }
});

// Remove a função startRewardedVideo, pois ela não é mais necessária neste arquivo.