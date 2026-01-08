import { supabase } from './supabaseClient.js';

// --- Configuração e Estado ---
const CHECK_INTERVAL = 30000; // Checa a cada 30 segundos (ajuste conforme necessário)
const STORAGE_KEY = 'aden_titles_last_check';
let notificationQueue = [];
let isDisplaying = false;

// Mapeamento de Títulos (Baseado na lógica do titulos.js)
const TITLE_MAP = {
    101: { m: 'Rei Consorte', f: 'Rainha', type: 'consort' },
    102: { m: 'Príncipe', f: 'Princesa', type: 'heir' },
    103: { m: 'Bobo da Corte', f: 'Boba da Corte', type: 'jester' },
    // Genéricos para outras cidades (IDs gerados dinamicamente)
    x01: { m: 'Lord Consorte', f: 'Lady', type: 'consort' },
    x02: { m: 'Nobre', f: 'Nobre', type: 'noble' }
};

// --- 1. Injeção de Estilos (CSS da Batalha adaptado) ---
function injectStyles() {
    if (document.getElementById('title-notification-style')) return;
    const style = document.createElement('style');
    style.id = 'title-notification-style';
    style.textContent = `
        #titleNotificationBanner {
            position: fixed;
            top: 13%; /* Um pouco abaixo do topo para não cobrir menus */
            transform: translateX(120%); /* Começa fora da tela */
            right: 0;
            background: linear-gradient(90deg, rgba(0,0,0,0.9) 0%, rgba(46,46,46,0.95) 100%);
            border-left: 4px solid #d4af37;
            color: white;
            padding: 12px 25px;
            border-radius: 5px 0 0 5px;
            z-index: 99999;
            font-family: 'Cinzel', serif, sans-serif;
            font-size: 0.9em;
            box-shadow: 0 4px 15px rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            gap: 10px;
            pointer-events: none; /* Deixa clicar no que está atrás */
            max-width: 90vw;
        }
        #titleNotificationBanner.show {
            animation: slideTitleBanner 10s linear forwards; /* Duração do slide */
        }
        #titleNotificationBanner strong { color: #d4af37; }
        #titleNotificationBanner span.highlight { color: #00bcd4; font-weight:bold; }
        
        @keyframes slideTitleBanner {
            0% { transform: translateX(120%); opacity: 0; }
            10% { transform: translateX(0); opacity: 1; }
            80% { transform: translateX(0); opacity: 1; } /* Fica parado um tempo */
            100% { transform: translateX(120%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    // Cria o elemento DOM se não existir
    if (!document.getElementById('titleNotificationBanner')) {
        const banner = document.createElement('div');
        banner.id = 'titleNotificationBanner';
        document.body.appendChild(banner);
    }
}

// --- 2. Lógica Principal ---

async function checkTitleUpdates() {
    // 1. Busca leve: Apenas IDs e datas de atualização das cidades
    const { data: cities, error } = await supabase
        .from('guild_battle_cities')
        .select('id, name, owner, last_title_update')
        .not('last_title_update', 'is', null);

    if (error || !cities) return;

    // Recupera cache local
    const localData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    let hasUpdates = false;

    // 2. Filtra cidades que foram atualizadas desde a última checagem
    const updatesToFetch = [];

    for (const city of cities) {
        const lastSeen = localData[city.id];
        // Se não tem registro ou a data do banco é mais nova que a local
        if (!lastSeen || new Date(city.last_title_update) > new Date(lastSeen)) {
            updatesToFetch.push(city);
            localData[city.id] = city.last_title_update; // Atualiza o cache local imediatamente para evitar loop se der erro depois
            hasUpdates = true;
        }
    }

    if (hasUpdates) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localData));
        await processUpdates(updatesToFetch);
    }
}

// --- 3. Processamento de Dados (Cirúrgico) ---

async function processUpdates(cities) {
    for (const city of cities) {
        if (!city.owner) continue;

        // A. Busca o Líder (Quem nomeou)
        const { data: guildData } = await supabase
            .from('guilds')
            .select('leader_id, players!guilds_leader_id_fkey(name, gender)')
            .eq('id', city.owner)
            .single();

        if (!guildData || !guildData.players) continue;

        const leaderName = guildData.players.name;
        const leaderGender = guildData.players.gender || 'Masculino';
        
        // Determina título do líder (Rei/Rainha ou Lord/Lady)
        let leaderTitle = 'Líder';
        if (city.id === 1) leaderTitle = (leaderGender === 'Masculino') ? 'Rei' : 'Rainha';
        else leaderTitle = (leaderGender === 'Masculino') ? 'Lord' : 'Lady';

        // B. Busca os Nobres daquela cidade (Quem foi nomeado)
        // Filtro inteligente para pegar apenas nobres relevantes para o ID da cidade
        // Capital (1): 101, 102, 103 | Outras (Ex: 2): 201, 202
        let rangeStart, rangeEnd;
        if (city.id === 1) {
            rangeStart = 101; rangeEnd = 103;
        } else {
            rangeStart = city.id * 100 + 1;
            rangeEnd = city.id * 100 + 2;
        }

        const { data: nobles } = await supabase
            .from('players')
            .select('name, gender, nobless')
            .gte('nobless', rangeStart)
            .lte('nobless', rangeEnd);

        if (nobles && nobles.length > 0) {
            nobles.forEach(noble => {
                // Descobre o nome do cargo
                let roleName = 'Nobre';
                
                if (city.id === 1 && TITLE_MAP[noble.nobless]) {
                    roleName = (noble.gender === 'Masculino') ? TITLE_MAP[noble.nobless].m : TITLE_MAP[noble.nobless].f;
                } else {
                    // Lógica genérica para cidades (terminação 01 ou 02)
                    const suffix = noble.nobless % 100; // pega o 01 ou 02
                    const mapKey = (suffix === 1) ? 'x01' : 'x02';
                    const roleMap = TITLE_MAP[mapKey];
                    roleName = (noble.gender === 'Masculino') ? roleMap.m : roleMap.f;
                }

                // Adiciona à fila
                queueNotification({
                    leaderTitle,
                    leaderName,
                    targetName: noble.name,
                    roleName,
                    cityName: city.name
                });
            });
        }
    }
}

// --- 4. Sistema de Fila e Exibição ---

function queueNotification(data) {
    notificationQueue.push(data);
    processQueue();
}

function processQueue() {
    if (isDisplaying || notificationQueue.length === 0) return;

    isDisplaying = true;
    const data = notificationQueue.shift(); // Pega o primeiro
    const banner = document.getElementById('titleNotificationBanner');

    // Monta o HTML da mensagem
    // Ícone baseado no cargo (simples)
    let icon = '📜'; 
    if (data.roleName.includes('Rei') || data.roleName.includes('Rainha')) icon = '👑'
    if (data.roleName.includes('Príncipe') || data.roleName.includes('Princesa')) icon = '⚜️';
    if (data.roleName.includes('Bobo da Corte') || data.roleName.includes('Boba da Corte')) icon = '🤡';
    if (data.roleName.includes('Lord') || data.roleName.includes('Lady')) icon = '🔰';
    if (data.roleName.includes('Nobre')) icon = '🛡️';

    banner.innerHTML = `
        <div style="font-size: 1.8em;">${icon}</div>
        <div style="font-size: 1.2em;">
            <strong>${data.leaderTitle} ${data.leaderName}</strong> nomeou <br>
            <span class="highlight">${data.targetName}</span> como 
            <strong>${data.roleName}</strong> de Aden!
        </div>
    `;

    // Ativa animação
    banner.classList.add('show');

    // Limpa após a animação (10s definido no CSS) + pequeno buffer
    const onAnimationEnd = () => {
        banner.classList.remove('show');
        banner.removeEventListener('animationend', onAnimationEnd);
        isDisplaying = false;
        
        // Pequena pausa entre notificações para não ficar colado
        setTimeout(() => {
            processQueue();
        }, 500); 
    };

    banner.addEventListener('animationend', onAnimationEnd);
}

// --- Inicialização ---
document.addEventListener("DOMContentLoaded", () => {
    injectStyles();
    
    // Primeira verificação (Delay pequeno para não competir com load pesado da página)
    setTimeout(checkTitleUpdates, 2000);

    // Loop de verificação periódica
    setInterval(checkTitleUpdates, CHECK_INTERVAL);
});