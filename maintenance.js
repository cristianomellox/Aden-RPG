import { supabase } from './supabaseClient.js'

document.addEventListener("DOMContentLoaded", async () => {
    
    const CACHE_KEY = 'maintenance_status_cache';
    const CACHE_TTL = 3 * 60 * 1000; // 3 minutos de cache

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const isDev = urlParams.get('dev') === 'true';

        if (isDev) {
            console.log("Modo de desenvolvimento ativado. Manutenção ignorada.");
            return;
        }

        let data = null;

        // 1. Tenta pegar do Cache Local
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.timestamp < CACHE_TTL) {
                    data = parsed.data;
                    // Cache válido, não faz requisição
                }
            } catch (e) {
                localStorage.removeItem(CACHE_KEY);
            }
        }

        // 2. Se não tem cache, busca no Supabase
        if (!data) {
            const { data: serverData, error } = await supabase
                .from('app_status')
                .select('is_maintenance_mode, maintenance_message, scheduled_maintenance, schedule_time')
                .eq('id', 1)
                .single();

            if (error) {
                console.error("Erro ao verificar status de manutenção:", error);
                // Não retorna return aqui, deixa o fluxo seguir para não travar o app se a rede falhar
            } else {
                data = serverData;
                // Salva no cache
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                    data: data,
                    timestamp: Date.now()
                }));
            }
        }

        if (!data) return; // Se falhou tudo, sai.

        const maintenanceOverlay = document.getElementById('maintenance-overlay');
        const countdownBanner = document.getElementById('countdown-banner');

        // Caso já esteja em manutenção
        if (data.is_maintenance_mode) {
            if (maintenanceOverlay) {
                document.getElementById('maintenance-message').textContent = data.maintenance_message;
                maintenanceOverlay.style.display = 'flex';
            }
            // Se ativou manutenção, limpa caches sensíveis para o próximo load
            localStorage.removeItem('player_data_cache');
            return;
        }

        // Se há agendamento
        if (data.scheduled_maintenance && data.schedule_time) {
            const countdownDuration = 5 * 60 * 1000; // 5 minutos
            const scheduleTime = new Date(data.schedule_time).getTime();

            const initialTimeLeft = (scheduleTime + countdownDuration) - new Date().getTime();

            if (initialTimeLeft <= 0) {
                console.log("Tempo já expirado, tentando ativar manutenção...");
                
                // Limpa cache para forçar verificação no server na próxima vez
                localStorage.removeItem(CACHE_KEY);
                
                const { error: rpcError } = await supabase.rpc('activate_maintenance_mode_securely');

                if (!rpcError) {
                    console.log("Manutenção ativada. Recarregando...");
                    window.location.reload();
                } else {
                    console.warn("RPC falhou (provavelmente já ativada). Exibindo overlay direto.");
                    if (maintenanceOverlay) {
                        document.getElementById('maintenance-message').textContent = "O jogo está em manutenção. Por favor, aguarde.";
                        maintenanceOverlay.style.display = 'flex';
                    }
                }
                return;
            }

            if (countdownBanner) {
                let countdownInterval;

                const updateCountdown = async () => {
                    const now = new Date().getTime();
                    const timeLeft = Math.max(0, (scheduleTime + countdownDuration) - now);
                    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

                    document.getElementById('countdown-timer').textContent =
                        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    countdownBanner.style.display = 'block';

                    if (timeLeft <= 0) {
                        clearInterval(countdownInterval);
                        console.log("Contador zerado, tentando ativar manutenção...");
                        localStorage.removeItem(CACHE_KEY); // Limpa cache
                        
                        const { error: rpcError } = await supabase.rpc('activate_maintenance_mode_securely');

                        if (!rpcError) {
                            console.log("Manutenção ativada. Recarregando...");
                            window.location.reload();
                        } else {
                            console.warn("RPC falhou (provavelmente já ativada). Exibindo overlay direto.");
                            if (maintenanceOverlay) {
                                document.getElementById('maintenance-message').textContent = "O jogo está em manutenção. Por favor, aguarde.";
                                maintenanceOverlay.style.display = 'flex';
                            }
                        }
                    }
                };

                updateCountdown();
                countdownInterval = setInterval(updateCountdown, 1000);
            }
        }
    } catch (e) {
        console.error("Erro geral no script de manutenção:", e);
    }
});