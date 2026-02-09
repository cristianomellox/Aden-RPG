import { supabase } from './supabaseClient.js';

// --- Configuração e Estado ---
const CHECK_INTERVAL = 300000; // Checa a cada 5 minutos (mais rápido para resposta imediata)
const LAST_CHECK_KEY = 'aden_titles_last_check'; 
const HOLDERS_KEY = 'aden_title_holders'; 
let notificationQueue = [];
let isDisplaying = false;

// Mapeamento APENAS dos títulos nomeáveis (Nobless)
// O Rei/Lorde é tratado separadamente via Guilda
const TITLE_MAP = {
    101: { m: 'Rei Consorte', f: 'Rainha Consorte', type: 'consort' },
    102: { m: 'Príncipe', f: 'Princesa', type: 'heir' },
    103: { m: 'Bobo da Corte', f: 'Boba da Corte', type: 'jester' },
    // Outras cidades
    x01: { m: 'Lord Consorte', f: 'Lady Consorte', type: 'consort' },
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
            border-left: 4px solid #ff4444;
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
    // Busca cidades que tiveram atualizações recentes no timestamp
    const { data: cities, error } = await supabase
        .from('guild_battle_cities')
        .select('id, name, owner, last_title_update')
        .not('last_title_update', 'is', null);

    if (error || !cities) return;

    const localTimestamps = JSON.parse(localStorage.getItem(LAST_CHECK_KEY) || '{}');
    let hasUpdates = false;
    const updatesToProcess = [];

    for (const city of cities) {
        const lastSeenTime = localTimestamps[city.id];
        
        // Se a data mudou no servidor
        if (!lastSeenTime || new Date(city.last_title_update) > new Date(lastSeenTime)) {
            updatesToProcess.push(city);
            localTimestamps[city.id] = city.last_title_update;
            hasUpdates = true;
        }
    }

    if (hasUpdates) {
        localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(localTimestamps));
        await processUpdates(updatesToProcess);
    }
}

// --- 3. Processamento de Dados (Diff) ---

async function processUpdates(cities) {
    let storedHolders = JSON.parse(localStorage.getItem(HOLDERS_KEY) || '{}');
    let storageUpdated = false;

    // Busca todos os nobres relevantes (IDs 101, 102, 103...)
    // Não buscamos o 100 aqui, pois o Rei é tratado via Guilda
    const { data: allNobles } = await supabase
        .from('players')
        .select('id, name, gender, nobless')
        .gt('nobless', 0); // Pega qualquer um com nobless > 0

    const noblesMap = {};
    if (allNobles) {
        allNobles.forEach(p => noblesMap[p.nobless] = p);
    }

    for (const city of cities) {
        if (!storedHolders[city.id]) storedHolders[city.id] = {};
        
        let leaderTitle = 'Líder';
        let leaderName = 'Desconhecido';
        let guildName = '???';

        // 1. LÓGICA DO REI/LORDE (Baseada no Dono da Cidade)
        if (city.owner) {
            const { data: guildData } = await supabase
                .from('guilds')
                .select('name, players!guilds_leader_id_fkey(name, gender)')
                .eq('id', city.owner)
                .single();
            
            if (guildData) {
                guildName = guildData.name;
                if (guildData.players) {
                    leaderName = guildData.players.name;
                    const g = guildData.players.gender || 'Masculino';
                    if (city.id === 1) leaderTitle = (g === 'Masculino') ? 'Rei' : 'Rainha';
                    else leaderTitle = (g === 'Masculino') ? 'Lord' : 'Lady';
                }
            }
        }

        // Verifica se o Dono mudou (Coronation)
        // Usamos uma chave especial 'ruler' no storage
        const previousRuler = storedHolders[city.id]['ruler'];
        
        if (leaderName !== 'Desconhecido' && leaderName !== previousRuler) {
            // Se for Capital, mensagem de Rei
            if (city.id === 1) {
                queueNotification({
                    type: 'coronation',
                    leaderTitle,
                    leaderName,
                    guildName,
                    cityName: city.name
                });
            } else {
                // Outras cidades (Opcional, mas consistente)
                queueNotification({
                    type: 'conquest',
                    leaderTitle,
                    leaderName,
                    guildName,
                    cityName: city.name
                });
            }
            storedHolders[city.id]['ruler'] = leaderName;
            storageUpdated = true;
        }

        // 2. LÓGICA DOS TÍTULOS (101, 102, 103...)
        let nobleIdsToCheck = [];
        if (city.id === 1) nobleIdsToCheck = [101, 102, 103]; 
        else {
            const base = city.id * 100;
            nobleIdsToCheck = [base + 1, base + 2]; 
        }

        for (const roleId of nobleIdsToCheck) {
            const currentPlayer = noblesMap[roleId];
            const previousHolderName = storedHolders[city.id][roleId];

            if (currentPlayer) {
                // Se mudou a pessoa no cargo
                if (currentPlayer.name !== previousHolderName) {
                    
                    let roleName = 'Nobre';
                    let roleKey = roleId;
                    
                    if (city.id !== 1) {
                        const suffix = roleId % 100;
                        roleKey = (suffix === 1) ? 'x01' : 'x02';
                    }

                    if (TITLE_MAP[roleKey]) {
                        roleName = (currentPlayer.gender === 'Masculino') ? TITLE_MAP[roleKey].m : TITLE_MAP[roleKey].f;
                    }

                    queueNotification({
                        type: 'grant',
                        leaderTitle,
                        leaderName,
                        targetName: currentPlayer.name,
                        roleName,
                        cityName: city.name
                    });

                    storedHolders[city.id][roleId] = currentPlayer.name;
                    storageUpdated = true;
                }
            } else {
                // Se ficou vago
                if (previousHolderName) {
                     delete storedHolders[city.id][roleId];
                     storageUpdated = true;
                }
            }
        }
    }

    if (storageUpdated) {
        localStorage.setItem(HOLDERS_KEY, JSON.stringify(storedHolders));
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

    banner.className = '';
    banner.style.display = 'flex'; 

    // Define HTML baseado no tipo
    if (data.type === 'coronation') {
        // --- VIDA LONGA AO REI ---
        banner.classList.add('royal-announcement');
        banner.innerHTML = `
            <div style="font-size: 2em; margin-right: 10px;">👑</div>
            <div style="font-size: 1.1em; line-height: 1.3;">
                A guilda <strong style="color:white;">${data.guildName}</strong> venceu a batalha!<br>
                Vida longa ${data.leaderTitle === 'Rei' ? 'ao' : 'à'} <span style="color: #ffd700; font-weight: bold; text-transform: uppercase;">${data.leaderTitle} ${data.leaderName}</span>!
            </div>
        `;
    } else if (data.type === 'conquest') {
        // --- CONQUISTA DE CIDADE COMUM ---
        banner.classList.add('royal-announcement');
        banner.innerHTML = `
            <div style="font-size: 1.8em; margin-right: 10px;">🔰</div>
            <div style="font-size: 1.1em;">
                A guilda <strong>${data.guildName}</strong> conquistou ${data.cityName}!<br>
                Saudações ${data.leaderTitle === 'Lord' ? 'ao' : 'à'} <strong>${data.leaderTitle} ${data.leaderName}</strong>!
            </div>
        `;
    } else {
        // --- NOMEAÇÃO (GRANT) ---
        let icon = '📜'; 
        if (data.roleName.includes('Príncipe') || data.roleName.includes('Princesa')) icon = '⚜️';
        if (data.roleName.includes('Bobo') || data.roleName.includes('Boba')) icon = '🤡';
        if (data.roleName.includes('Consorte')) icon = '❤️';

        banner.innerHTML = `
            <div style="font-size: 1.8em;">${icon}</div>
            <div style="font-size: 1.1em;">
                <strong>${data.leaderTitle} ${data.leaderName}</strong> nomeou <br>
                <span class="highlight">${data.targetName}</span> como 
                <strong>${data.roleName}</strong>!
            </div>
        `;
    }

    banner.classList.add('show');

    // Tempo de exibição (Rei fica mais tempo)
    const duration = (data.type === 'coronation') ? 12000 : 8000;

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
    // Primeira verificação
    setTimeout(checkTitleUpdates, 1500);
    // Loop
    setInterval(checkTitleUpdates, CHECK_INTERVAL);
});