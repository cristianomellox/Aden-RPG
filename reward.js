// reward.js - VERSÃO FINAL COM REDIRECIONAMENTO AUTOMÁTICO

document.addEventListener('DOMContentLoaded', async () => {
    const messageDiv = document.getElementById('reward-message');
    // O botão de retorno manual não será mais o principal, mas o deixamos no HTML como fallback
    const returnBtn = document.getElementById('return-btn'); 
    returnBtn.style.display = 'none'; // Esconde por padrão

    const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let claimToken = localStorage.getItem('pending_reward_token');

    if (localStorage.getItem('pending_reward_token')) {
        localStorage.removeItem('pending_reward_token');
    }

    if (!claimToken) {
        messageDiv.textContent = 'Erro: Token de recompensa ausente. Você será redirecionado em breve.';
        setTimeout(() => {
            window.location.href = '/index.html';
        }, 3000);
        return;
    }

    try {
        messageDiv.textContent = 'Processando sua recompensa...';
        
        const { data: rpcData, error: rpcError } = await supabaseClient.rpc('grant_daily_reward', {
            p_claim_token: claimToken
        });

        if (rpcError) throw rpcError;

        messageDiv.innerHTML = `<h2>Recompensa Recebida!</h2><p>${rpcData}</p><p>Retornando à loja...</p>`;
        
        // SUCESSO: Redireciona de volta para a loja aberta na aba correta
        setTimeout(() => {
            window.location.href = '/index.html?action=openShopVideo';
        }, 2500); // Espera 2.5 segundos para o jogador ler

    } catch (error) {
        messageDiv.textContent = `Ocorreu um erro: ${error.message}. Você será redirecionado.`;
        // ERRO: Redireciona de volta mesmo assim, para não prender o jogador
        setTimeout(() => {
            window.location.href = '/index.html?action=openShopVideo';
        }, 3000);
    }
});