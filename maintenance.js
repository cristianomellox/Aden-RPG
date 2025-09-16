document.addEventListener("DOMContentLoaded", async () => {
    const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabase = window.supabase && window.supabase.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    if (!supabase) {
        console.error("Supabase não iniciado");
        return;
    }

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const isDev = urlParams.get('dev') === 'true';

        if (isDev) {
            console.log("Modo de desenvolvimento ativado. Manutenção ignorada.");
            return;
        }

        const { data, error } = await supabase
            .from('app_status')
            .select('is_maintenance_mode, maintenance_message, scheduled_maintenance, schedule_time')
            .eq('id', 1)
            .single();

        if (error) {
            console.error("Erro ao verificar status de manutenção:", error);
            return;
        }

        const maintenanceOverlay = document.getElementById('maintenance-overlay');
        const countdownBanner = document.getElementById('countdown-banner');

        // Caso já esteja em manutenção
        if (data && data.is_maintenance_mode) {
            if (maintenanceOverlay) {
                document.getElementById('maintenance-message').textContent = data.maintenance_message;
                maintenanceOverlay.style.display = 'flex';
            }
            return;
        }

        // Se há agendamento
        if (data && data.scheduled_maintenance && data.schedule_time) {
            const countdownDuration = 5 * 60 * 1000; // 5 minutos
            const scheduleTime = new Date(data.schedule_time).getTime();

            const initialTimeLeft = (scheduleTime + countdownDuration) - new Date().getTime();

            if (initialTimeLeft <= 0) {
                console.log("Tempo já expirado, tentando ativar manutenção...");
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
