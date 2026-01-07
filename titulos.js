// Importa a instância centralizada do Supabase
import { supabase } from './supabaseClient.js';

// --- Configuração das Cidades ---
const CITIES_DATA = [
    { id: 1, name: "Capital", img: "https://aden-rpg.pages.dev/assets/capital.webp" },
    { id: 2, name: "Zion", img: "https://aden-rpg.pages.dev/assets/zion.webp" },
    { id: 3, name: "Elendor", img: "https://aden-rpg.pages.dev/assets/elendor.webp" },
    { id: 4, name: "Mitrar", img: "https://aden-rpg.pages.dev/assets/mitrar.webp" },
    { id: 5, name: "Tandra", img: "https://aden-rpg.pages.dev/assets/tandra.webp" },
    { id: 6, name: "Astrax", img: "https://aden-rpg.pages.dev/assets/astrax.webp" },
    { id: 7, name: "Duratar", img: "https://aden-rpg.pages.dev/assets/duratar.webp" }
];

// Elementos DOM
const container = document.getElementById('citiesContainer');
const modal = document.getElementById('editModal');
const playerInput = document.getElementById('playerInput');
const btnSave = document.getElementById('btnSaveTitle');
const modalStatus = document.getElementById('modalStatus');

// Estado
let currentUser = null;
let currentCityData = []; 
let activeEdit = null; 

// --- Função para ler Auth do IndexedDB (Lê o banco global 'aden_global_db') ---
// Essa função continua necessária para evitar chamadas de rede desnecessárias ao verificar a sessão
async function getLocalAuth() {
    return new Promise((resolve) => {
        const req = indexedDB.open('aden_global_db', 2); 
        req.onerror = () => resolve(null);
        req.onsuccess = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('auth_store')) {
                resolve(null);
                return;
            }
            const tx = db.transaction('auth_store', 'readonly');
            const store = tx.objectStore('auth_store');
            const getReq = store.get('current_session');
            getReq.onsuccess = () => {
                if (getReq.result && getReq.result.value && getReq.result.value.user) {
                    resolve(getReq.result.value.user);
                } else {
                    resolve(null);
                }
            };
            getReq.onerror = () => resolve(null);
        };
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Tenta recuperar usuário do IndexedDB (Zero Network)
    currentUser = await getLocalAuth();

    // 2. Fallback: Se não achou no DB local, tenta via SDK
    if (!currentUser) {
        const { data } = await supabase.auth.getSession();
        if (data.session) currentUser = data.session.user;
    }

    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }
    
    // 3. Busca dados extras de permissão do usuário (Líder/Co-Líder)
    const { data: userData } = await supabase
        .from('players')
        .select('guild_id, is_leader, is_co_leader')
        .eq('id', currentUser.id)
        .single();
    
    if (userData) {
        currentUser = { ...currentUser, ...userData };
    }

    await loadData();
});

async function loadData() {
    // 1. Buscar Cidades
    const { data: citiesDb, error: errC } = await supabase
        .from('guild_battle_cities')
        .select('id, owner, last_title_update'); 

    if (errC) {
        console.error("Erro ao carregar cidades:", errC);
        container.innerHTML = '<p class="intro-text" style="color:#d44">Erro de conexão com o reino.</p>';
        return;
    }

    if (!citiesDb || citiesDb.length === 0) {
        container.innerHTML = '<p class="intro-text">Nenhuma cidade conquistada ainda.</p>';
        return;
    }

    // 2. Buscar TODOS os Nobres (Economia: Trazemos apenas o necessário)
    const { data: nobles } = await supabase
        .from('players')
        .select('id, name, gender, nobless')
        .not('nobless', 'is', null);

    // 3. Buscar Líderes das Guildas Donas
    const ownerGuildIds = citiesDb.map(c => c.owner).filter(Boolean);
    let leadersMap = {}; 

    if (ownerGuildIds.length > 0) {
        const { data: guildData } = await supabase
            .from('guilds')
            .select('id, leader_id')
            .in('id', ownerGuildIds);

        if (guildData && guildData.length > 0) {
            const leaderIds = guildData.map(g => g.leader_id).filter(Boolean);
            if(leaderIds.length > 0) {
                const { data: leadersPlayers } = await supabase
                    .from('players')
                    .select('id, name, gender')
                    .in('id', leaderIds);
                
                guildData.forEach(g => {
                    const p = leadersPlayers ? leadersPlayers.find(lp => lp.id === g.leader_id) : null;
                    if (p) leadersMap[g.id] = p;
                });
            }
        }
    }

    // 4. Montar Dados Visuais
    const fullData = citiesDb.map(dbCity => {
        const staticCity = CITIES_DATA.find(c => c.id === dbCity.id) || { name: "Desconhecida", img: "" };
        const leader = leadersMap[dbCity.owner];
        
        // Filtra quais nobres pertencem a ESTA cidade
        const cityNobles = nobles ? nobles.filter(n => {
            if (dbCity.id === 1) { 
                return [101, 102, 103].includes(n.nobless);
            } else { 
                const start = dbCity.id * 100;
                return (n.nobless === start + 1 || n.nobless === start + 2);
            }
        }) : [];

        return {
            ...staticCity,
            ownerGuildId: dbCity.owner,
            lastUpdate: dbCity.last_title_update,
            leader: leader, 
            nobles: cityNobles
        };
    });

    currentCityData = fullData;
    renderCities(fullData);
}

function renderCities(cities) {
    container.innerHTML = '';
    
    cities.forEach(city => {
        const card = document.createElement('div');
        card.className = 'city-card';
        
        // Permissões
        const isOwnerGuild = currentUser.guild_id === city.ownerGuildId;
        const hasPerms = currentUser.is_leader || currentUser.is_co_leader;
        const canEdit = isOwnerGuild && hasPerms;

        // Header
        let leaderTitle = "Líder";
        let leaderName = "Cidade Sem Dono";
        let leaderGender = "Masculino";

        if (city.leader) {
            leaderName = city.leader.name;
            leaderGender = city.leader.gender || "Masculino";
            if (city.id === 1) { 
                leaderTitle = (leaderGender === 'Masculino') ? 'Rei' : 'Rainha';
            } else {
                leaderTitle = (leaderGender === 'Masculino') ? 'Lord' : 'Lady';
            }
        } else if (city.ownerGuildId) {
             leaderName = "Líder da Guilda";
        }

        const headerHtml = `
            <div class="city-header">
                <img src="${city.img}" class="city-img" alt="${city.name}">
                <div class="city-info">
                    <h2>${city.name}</h2>
                    <span class="city-owner">${leaderTitle}: ${leaderName}</span>
                </div>
            </div>
        `;

        // Grid de Títulos
        let gridHtml = '<div class="titles-grid">';
        let slots = [];

        if (city.id === 1) { // Capital
            const isKing = (leaderGender === 'Masculino');
            slots.push({ id: 101, icon: '❤️', titles: { m: 'Rei', f: 'Rainha' }, defaultLabel: isKing ? 'Rainha' : 'Rei', count: 1 });
            slots.push({ id: 102, icon: '⚔️', titles: { m: 'Príncipe', f: 'Princesa' }, defaultLabel: 'Herdeiro(a)', count: 2 });
            slots.push({ id: 103, icon: '🤡', titles: { m: 'Bobo da Corte', f: 'Boba da Corte' }, defaultLabel: 'Bobo(a)', count: 1 });
        } else { // Outras
            const baseId = city.id * 100;
            const isLord = (leaderGender === 'Masculino');
            slots.push({ id: baseId + 1, icon: '❤️', titles: { m: 'Lord', f: 'Lady' }, defaultLabel: isLord ? 'Lady' : 'Lord', count: 1 });
            slots.push({ id: baseId + 2, icon: '🛡️', titles: { m: 'Nobre', f: 'Nobre' }, defaultLabel: 'Nobre', count: 1 });
        }

        slots.forEach(slot => {
            const playersInSlot = city.nobles.filter(n => n.nobless === slot.id);
            
            for (let i = 0; i < slot.count; i++) {
                const p = playersInSlot[i];
                let currentRoleName = slot.defaultLabel;
                if (p) currentRoleName = (p.gender === 'Masculino') ? slot.titles.m : slot.titles.f;

                let editBtn = '';
                if (canEdit && !p) {
                    editBtn = `
                    <button class="edit-btn" onclick="openEditModal(${city.id}, ${slot.id}, '${currentRoleName}')">
                        <svg class="edit-svg" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    </button>`;
                }

                gridHtml += `
                    <div class="title-card">
                        ${editBtn}
                        <div class="title-icon">${slot.icon}</div>
                        <div class="title-role">${currentRoleName}</div>
                        <div class="player-name ${p ? '' : 'empty-slot'}">
                            ${p ? p.name : 'Vago'}
                        </div>
                    </div>
                `;
            }
        });

        gridHtml += '</div>';
        card.innerHTML = headerHtml + gridHtml;
        container.appendChild(card);
    });
}

// --- Funções do Modal ---

// Necessário expor a função window.openEditModal pois 'module' isola o escopo
window.openEditModal = (cityId, noblessId, roleName) => {
    activeEdit = { cityId, noblessId };
    document.getElementById('modalTitle').innerText = `Nomear: ${roleName}`;
    playerInput.value = '';
    modalStatus.innerText = '';
    modalStatus.className = '';
    modal.style.display = 'flex';
    playerInput.focus();
};

document.querySelector('.close-modal').onclick = () => {
    modal.style.display = 'none';
};

window.onclick = (e) => {
    if (e.target == modal) modal.style.display = 'none';
};

btnSave.onclick = async () => {
    const name = playerInput.value.trim();
    if (!name) return;

    modalStatus.innerText = "Decretando...";
    modalStatus.className = '';
    btnSave.disabled = true;

    // Busca exata via RPC
    const { data, error } = await supabase.rpc('set_city_title', {
        target_player_name: name,
        title_id: activeEdit.noblessId,
        city_id: activeEdit.cityId
    });

    btnSave.disabled = false;

    if (error) {
        modalStatus.innerText = "Erro de conexão.";
        modalStatus.className = 'status-error';
        console.error(error);
        return;
    }

    if (!data.success) {
        modalStatus.innerText = data.message;
        modalStatus.className = 'status-error';
    } else {
        modalStatus.innerText = data.message;
        modalStatus.className = 'status-success';
        
        setTimeout(() => {
            modal.style.display = 'none';
            loadData(); 
        }, 1500);
    }
};