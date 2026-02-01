import { supabase } from './supabaseClient.js';

// --- Configuração e Estado ---
const CHECK_INTERVAL = 300000; // Checa a cada 30 segundos
const STORAGE_KEY = 'aden_titles_last_check';
const OWNERS_KEY = 'aden_city_owners'; // NOVO: Para rastrear mudança de dono
let notificationQueue = [];
let isDisplaying = false;

// Mapeamento de Títulos
const TITLE_MAP = {
    101: { m: 'Rei Consorte', f: 'Rainha', type: 'consort' },
    102: { m: 'Príncipe', f: 'Princesa', type: 'heir' },
    103: { m: 'Bobo da Corte', f: 'Boba da Corte', type: 'jester' },
    x01: { m: 'Lord Consorte', f: 'Lady', type: 'consort' },
    x02: { m: 'Nobre', f: 'Nobre', type: 'noble' }
};

// --- 1. Injeção de Estilos ---
function injectStyles() {
    if (document.getElementById('title-notification-style')) return;
    const style = document.createElement('style');
    style.id = 'title-notification-style';
    style.textContent = `
        #titleNotificationBanner {
            position: fixed;
            top: 13%; 
            transform: translateX(120%);
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
            pointer-events: none;
            max-width: 90vw;
        }
        #titleNotificationBanner.show {
            animation: slideTitleBanner 10s linear forwards;
        }
        #titleNotificationBanner.royal-announcement {
            border-left: 4px solid #ff4444; /* Cor diferente para o Rei */
            background: linear-gradient(90deg, rgba(20,0,0,0.95) 0%, rgba(60,0,0,0.95) 100%);
        }
        #titleNotificationBanner strong { color: #d4af37; }
        #titleNotificationBanner span.highlight { color: #00bcd4; font-weight:bold; }
        
        @keyframes slideTitleBanner {
            0% { transform: translateX(120%); opacity: 0; }
            10% { transform: translateX(0); opacity: 1; }
            80% { transform: translateX(0); opacity: 1; }
            100% { transform: translateX(120%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    if (!document.getElementById('titleNotificationBanner')) {
        const banner = document.createElement('div');
        banner.id = 'titleNotificationBanner';
        document.body.appendChild(banner);
    }
}

// --- 2. Lógica Principal ---

async function checkTitleUpdates() {
    const { data: cities, error } = await supabase
        .from('guild_battle_cities')
        .select('id, name, owner, last_title_update')
        .not('last_title_update', 'is', null);

    if (error || !cities) return;

    const localTimestamps = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    let hasUpdates = false;
    const updatesToFetch = [];

    for (const city of cities) {
        const lastSeenTime = localTimestamps[city.id];
        
        // Se a data de atualização mudou, precisamos processar
        if (!lastSeenTime || new Date(city.last_title_update) > new Date(lastSeenTime)) {
            updatesToFetch.push(city);
            localTimestamps[city.id] = city.last_title_update; 
            hasUpdates = true;
        }
    }

    if (hasUpdates) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localTimestamps));
        await processUpdates(updatesToFetch);
    }
}

// --- 3. Processamento de Dados ---

async function processUpdates(cities) {
    // Carrega cache de donos anteriores
    const localOwners = JSON.parse(localStorage.getItem(OWNERS_KEY) || '{}');
    let ownersUpdated = false;

    for (const city of cities) {
        if (!city.owner) continue;

        // A. Busca o Líder da Guilda Regente
        const { data: guildData } = await supabase
            .from('guilds')
            .select('leader_id, players!guilds_leader_id_fkey(name, gender)')
            .eq('id', city.owner)
            .single();

        if (!guildData || !guildData.players) continue;

        const leaderName = guildData.players.name;
        const leaderGender = guildData.players.gender || 'Masculino';
        
        let leaderTitle = 'Líder';
        if (city.id === 1) leaderTitle = (leaderGender === 'Masculino') ? 'Rei' : 'Rainha';
        else leaderTitle = (leaderGender === 'Masculino') ? 'Lord' : 'Lady';

        // --- VERIFICAÇÃO DE NOVO REINADO (Coronation) ---
        const previousOwner = localOwners[city.id];
        
        // Se o dono mudou e é a Capital (ID 1)
        if (city.id === 1 && previousOwner !== city.owner) {
            queueNotification({
                type: 'coronation', // Tipo especial
                leaderTitle,
                leaderName,
                cityName: city.name
            });
            // Atualiza o dono local
            localOwners[city.id] = city.owner;
            ownersUpdated = true;
        } 
        // Lógica para outras cidades (opcional, se quiser anunciar novo Lord)
        else if (previousOwner !== city.owner) {
             localOwners[city.id] = city.owner;
             ownersUpdated = true;
        }

        // B. Busca Nobres (Títulos normais)
        // Só busca se NÃO for uma troca de dono imediata (para evitar spam se o rei limpar a mesa)
        // Ou busca sempre, mas geralmente na troca de dono os títulos são resetados.
        
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
                let roleName = 'Nobre';
                if (city.id === 1 && TITLE_MAP[noble.nobless]) {
                    roleName = (noble.gender === 'Masculino') ? TITLE_MAP[noble.nobless].m : TITLE_MAP[noble.nobless].f;
                } else {
                    const suffix = noble.nobless % 100;
                    const mapKey = (suffix === 1) ? 'x01' : 'x02';
                    const roleMap = TITLE_MAP[mapKey];
                    roleName = (noble.gender === 'Masculino') ? roleMap.m : roleMap.f;
                }

                queueNotification({
                    type: 'title_grant',
                    leaderTitle,
                    leaderName,
                    targetName: noble.name,
                    roleName,
                    cityName: city.name
                });
            });
        }
    }

    if (ownersUpdated) {
        localStorage.setItem(OWNERS_KEY, JSON.stringify(localOwners));
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
    const data = notificationQueue.shift();
    const banner = document.getElementById('titleNotificationBanner');

    // Reseta classes
    banner.className = '';

    if (data.type === 'coronation') {
        // --- ANÚNCIO DO REI/RAINHA ---
        banner.classList.add('royal-announcement'); // Classe CSS especial
        const crownIcon = '👑';
        
        banner.innerHTML = `
            <div style="font-size: 1.8em; filter: drop-shadow(0 0 5px gold);">${crownIcon}</div>
            <div style="font-size: 1.2em; line-height: 1.4;">
                Vida longa a <span style="color: #ffda44; font-weight: bold; text-transform: uppercase;">${data.leaderName}</span>,<br>
                ${data.leaderTitle === 'Rei' ? 'novo' : 'nova'} <strong>${data.leaderTitle}</strong> de Aden!
            </div>
        `;

    } else {
        // --- ANÚNCIO DE TÍTULOS (PADRÃO) ---
        let icon = '📜'; 
        if (data.roleName.includes('Rei') || data.roleName.includes('Rainha')) icon = '👑'
        if (data.roleName.includes('Príncipe') || data.roleName.includes('Princesa')) icon = '⚜️';
        if (data.roleName.includes('Bobo') || data.roleName.includes('Boba')) icon = '🤡';
        if (data.roleName.includes('Lord') || data.roleName.includes('Lady')) icon = '🔰';
        if (data.roleName.includes('Nobre')) icon = '🛡️';

        banner.innerHTML = `
            <div style="font-size: 1.8em;">${icon}</div>
            <div style="font-size: 1.2em;">
                <strong>${data.leaderTitle} ${data.leaderName}</strong> nomeou <br>
                <span class="highlight">${data.targetName}</span> como 
                <strong>${data.roleName}</strong>!
            </div>
        `;
    }

    banner.classList.add('show');

    // Tempo de exibição
    const displayTime = data.type === 'coronation' ? 14000 : 10000; // Rei fica um pouco mais

    const onAnimationEnd = () => {
        banner.classList.remove('show');
        banner.removeEventListener('animationend', onAnimationEnd);
        isDisplaying = false;
        setTimeout(() => { processQueue(); }, 500);
    };

    banner.addEventListener('animationend', onAnimationEnd);
}

// --- Inicialização ---
document.addEventListener("DOMContentLoaded", () => {
    injectStyles();
    setTimeout(checkTitleUpdates, 2000);
    setInterval(checkTitleUpdates, CHECK_INTERVAL);
});