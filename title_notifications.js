import { supabase } from './supabaseClient.js';

// --- Configuração e Estado ---
const CHECK_INTERVAL = 300000; // Checa a cada 5 minutos
const LAST_CHECK_KEY = 'aden_titles_last_check'; // Guarda timestamps das cidades
const HOLDERS_KEY = 'aden_title_holders'; // Guarda cache de QUEM tem os títulos { cityId: { noblessId: playerName } }
const OWNERS_KEY = 'aden_city_owners'; // NOVO: Guarda cache de QUEM é dono da cidade { cityId: guildId }
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
    // Busca cidades que tiveram atualizações recentes
    const { data: cities, error } = await supabase
        .from('guild_battle_cities')
        .select('id, name, owner, last_title_update')
        .not('last_title_update', 'is', null);

    if (error || !cities) return;

    const localTimestamps = JSON.parse(localStorage.getItem(LAST_CHECK_KEY) || '{}');
    const updatesToProcess = [];

    for (const city of cities) {
        const lastSeenTime = localTimestamps[city.id];
        
        // Se a data do servidor for mais nova que a local OU se não tiver data local
        // (Nota: Usamos string comparison direta ISO8601 que funciona bem, ou new Date)
        if (!lastSeenTime || new Date(city.last_title_update) > new Date(lastSeenTime)) {
            updatesToProcess.push(city);
        }
    }

    if (updatesToProcess.length > 0) {
        await processUpdates(updatesToProcess, localTimestamps);
    }
}

// --- 3. Processamento de Dados (Com Diff) ---

async function processUpdates(cities, localTimestamps) {
    // Carrega o cache de QUEM tinha os títulos
    let storedHolders = JSON.parse(localStorage.getItem(HOLDERS_KEY) || '{}');
    // Carrega o cache de QUEM era o dono da cidade
    let storedOwners = JSON.parse(localStorage.getItem(OWNERS_KEY) || '{}');
    
    // Busca informações auxiliares (Líderes)
    // Para otimizar, pegamos todos os nobres relevantes de uma vez
    const { data: allNobles } = await supabase
        .from('players')
        .select('id, name, gender, nobless')
        .not('nobless', 'is', null);

    // Mapeia nobres para busca rápida
    // Mapa: noblessId -> Objeto Jogador
    const noblesMap = {};
    if (allNobles) {
        allNobles.forEach(p => noblesMap[p.nobless] = p);
    }

    let storageUpdated = false;

    for (const city of cities) {
        // Inicializa estrutura se não existir
        if (!storedHolders[city.id]) storedHolders[city.id] = {};
        
        // 1. Busca dados do Líder (Rei/Lord) da guilda dona
        // Fazemos isso individualmente pois donos mudam pouco e são poucos requests
        let leaderTitle = 'Líder';
        let leaderName = 'Desconhecido';

        if (city.owner) {
            const { data: guildData } = await supabase
                .from('guilds')
                .select('players!guilds_leader_id_fkey(name, gender)')
                .eq('id', city.owner)
                .single();
            
            if (guildData && guildData.players) {
                leaderName = guildData.players.name;
                const g = guildData.players.gender || 'Masculino';
                if (city.id === 1) leaderTitle = (g === 'Masculino') ? 'Rei' : 'Rainha';
                else leaderTitle = (g === 'Masculino') ? 'Lord' : 'Lady';
            }
        }

        // --- LÓGICA DE COROAÇÃO (RESTAURADA) ---
        // Verifica se a cidade é a Capital (ID 1) e se o dono mudou
        if (city.id === 1 && city.owner) {
            const previousOwner = storedOwners[city.id];
            
            // Se existia um dono anterior e ele é diferente do atual
            if (previousOwner && previousOwner !== city.owner) {
                queueNotification({
                    type: 'coronation', // Tipo especial
                    leaderTitle,
                    leaderName,
                    cityName: city.name
                });
            }
            
            // Atualiza o cache de donos
            if (storedOwners[city.id] !== city.owner) {
                storedOwners[city.id] = city.owner;
                storageUpdated = true;
            }
        } else {
             // Para outras cidades apenas atualizamos o cache sem notificar coroação (ou adicione aqui se quiser para Lords)
             if (storedOwners[city.id] !== city.owner) {
                storedOwners[city.id] = city.owner;
                storageUpdated = true;
            }
        }

        // 2. Verifica Nobres (Titulos)
        // Define o range de IDs para esta cidade
        let nobleIdsToCheck = [];
        if (city.id === 1) nobleIdsToCheck = [101, 102, 103]; // Capital
        else nobleIdsToCheck = [(city.id * 100) + 1, (city.id * 100) + 2]; // Outras

        for (const roleId of nobleIdsToCheck) {
            const currentPlayer = noblesMap[roleId];
            const previousHolderName = storedHolders[city.id][roleId];

            // Cenário: Existe um jogador atual para este cargo
            if (currentPlayer) {
                // Se o nome for diferente do armazenado, TEMOS UM NOVO TITULAR
                if (currentPlayer.name !== previousHolderName) {
                    
                    // Determina o nome do cargo
                    let roleName = 'Nobre';
                    if (city.id === 1 && TITLE_MAP[roleId]) {
                        roleName = (currentPlayer.gender === 'Masculino') ? TITLE_MAP[roleId].m : TITLE_MAP[roleId].f;
                    } else {
                        const suffix = roleId % 100; // 1 ou 2
                        const mapKey = (suffix === 1) ? 'x01' : 'x02';
                        roleName = (currentPlayer.gender === 'Masculino') ? TITLE_MAP[mapKey].m : TITLE_MAP[mapKey].f;
                    }

                    // Fila a notificação
                    queueNotification({
                        type: 'title_grant',
                        leaderTitle,
                        leaderName,
                        targetName: currentPlayer.name,
                        roleName,
                        cityName: city.name
                    });

                    // Atualiza o cache local com o novo dono
                    storedHolders[city.id][roleId] = currentPlayer.name;
                    storageUpdated = true;
                }
            } else {
                // Se não tem jogador agora, mas tinha antes (foi removido/exonerado)
                if (previousHolderName) {
                     // Opcional: Notificar "Fulano perdeu o título"
                     // Por enquanto, apenas removemos do cache para detectar quando alguém novo assumir
                     delete storedHolders[city.id][roleId];
                     storageUpdated = true;
                }
            }
        }

        // Atualiza o timestamp da cidade DEPOIS de processar
        localTimestamps[city.id] = city.last_title_update;
    }

    // Salva tudo no LocalStorage
    localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(localTimestamps));
    if (storageUpdated) {
        localStorage.setItem(HOLDERS_KEY, JSON.stringify(storedHolders));
        localStorage.setItem(OWNERS_KEY, JSON.stringify(storedOwners));
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

    // Reseta classes e garante visibilidade
    banner.className = '';
    banner.style.display = 'flex'; 

    // Lógica de Renderização Baseada no Tipo
    if (data.type === 'coronation') {
        // --- NOTIFICAÇÃO DE COROAÇÃO (Vida Longa ao Rei) ---
        banner.classList.add('royal-announcement');
        banner.innerHTML = `
            <div style="font-size: 2.2em;">👑</div>
            <div style="font-size: 1.2em; line-height: 1.2;">
                <span style="color: #ff4444; font-weight: bold; text-shadow: 1px 1px 2px black;">Vida Longa ao ${data.leaderTitle}!</span><br>
                <strong>${data.leaderName}</strong> conquistou a <span style="color: gold;">Capital</span>!
            </div>
        `;
    } else {
        // --- NOTIFICAÇÃO PADRÃO DE TÍTULOS ---
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

    const onAnimationEnd = () => {
        banner.classList.remove('show');
        banner.removeEventListener('animationend', onAnimationEnd);
        isDisplaying = false;
        // Pequeno delay entre notificações
        setTimeout(() => { processQueue(); }, 500);
    };

    banner.addEventListener('animationend', onAnimationEnd);
}

// --- Limpeza Semanal de Cache (Domingo/Segunda) ---
function checkSundayOwnerCacheReset() {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Domingo
    if (dayOfWeek === 0 || dayOfWeek === 1) {
        const key = 'aden_weekly_reset_check';
        const lastReset = localStorage.getItem(key);
        const todayStr = today.toDateString();

        if (lastReset !== todayStr) {
            console.log("🧹 [System] Limpeza semanal de cache de títulos...");
            // Limpa o cache de "quem tem o título" para forçar resincronização limpa se necessário
            // Mas cuidado: se limparmos tudo, o Diff vai achar que todos são novos. 
            // Melhor apenas marcar como checado e deixar o Diff trabalhar naturalmente.
            localStorage.setItem(key, todayStr);
        }
    }
}

// --- Inicialização ---
document.addEventListener("DOMContentLoaded", () => {
    injectStyles();
    checkSundayOwnerCacheReset();

    // Primeira verificação rápida após carregar
    setTimeout(checkTitleUpdates, 2000);
    
    // Loop de verificação
    setInterval(checkTitleUpdates, CHECK_INTERVAL);
});