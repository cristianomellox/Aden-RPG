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

// Elementos DOM Principais
const container = document.getElementById('citiesContainer');
const modal = document.getElementById('editModal');
const playerInput = document.getElementById('playerInput');
const btnSave = document.getElementById('btnSaveTitle');
const modalStatus = document.getElementById('modalStatus');

// Elementos DOM do Modal de Confirmação
const confirmModal = document.getElementById('confirmModal');
const confirmText = document.getElementById('confirmText');
const btnConfirmRemove = document.getElementById('btnConfirmRemove');
const btnCancelRemove = document.getElementById('btnCancelRemove');
const confirmStatus = document.getElementById('confirmStatus');

// Estado
let currentUser = null;
let currentCityData = []; 
let activeEdit = null; 

// --- Função Auxiliar: Próxima Meia-Noite UTC ---
function getNextMidnightUTC() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
    return next.getTime();
}

// --- Função Auth Local (Mantida) ---
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
    // 1. Tenta recuperar usuário
    currentUser = await getLocalAuth();
    if (!currentUser) {
        const { data } = await supabase.auth.getSession();
        if (data.session) currentUser = data.session.user;
    }

    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }
    
    // Busca 'rank'
    const { data: userData } = await supabase
        .from('players')
        .select('guild_id, rank') 
        .eq('id', currentUser.id)
        .single();
    
    if (userData) {
        currentUser = { ...currentUser, ...userData };
    }

    // 2. Carrega primeiro do CACHE LOCAL
    loadFromCache();

    // 3. Busca dados atualizados da rede
    await loadDataAndCache();
});

// --- Sistema de Cache ---
function loadFromCache() {
    const cached = localStorage.getItem('aden_titles_cache');
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            const sorted = sortCities(parsed);
            renderCities(sorted);
        } catch (e) {
            console.error("Erro ao ler cache", e);
        }
    }
}

function sortCities(data) {
    return data.sort((a, b) => {
        if (a.id === 1) return -1;
        if (b.id === 1) return 1;
        return a.id - b.id;
    });
}

async function loadDataAndCache() {
    const { data: citiesDb, error: errC } = await supabase
        .from('guild_battle_cities')
        .select('id, owner, last_title_update'); 

    if (errC) {
        console.error("Erro rede:", errC);
        return;
    }
    if (!citiesDb || citiesDb.length === 0) return;

    // Buscar Nobres
    const { data: nobles } = await supabase
        .from('players')
        .select('id, name, gender, nobless')
        .not('nobless', 'is', null);

    // Buscar Líderes das Guildas
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

    const fullData = citiesDb.map(dbCity => {
        const staticCity = CITIES_DATA.find(c => c.id === dbCity.id) || { name: "Desconhecida", img: "" };
        const leader = leadersMap[dbCity.owner];
        
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

    localStorage.setItem('aden_titles_cache', JSON.stringify(fullData));
    currentCityData = sortCities(fullData);
    renderCities(currentCityData);
}

// Verifica se um jogador específico está travado no localStorage
function isPlayerLocked(playerId) {
    if (!playerId) return false;
    const lockKey = `aden_lock_player_${playerId}`;
    const expiration = localStorage.getItem(lockKey);
    if (expiration) {
        const expiryTime = parseInt(expiration, 10);
        if (Date.now() < expiryTime) {
            return true;
        } else {
            localStorage.removeItem(lockKey); // Limpa trava expirada
        }
    }
    return false;
}

function renderCities(cities) {
    container.innerHTML = '';
    
    cities.forEach(city => {
        const card = document.createElement('div');
        card.className = 'city-card';
        
        const isOwnerGuild = currentUser.guild_id === city.ownerGuildId;
        const hasRole = currentUser.rank === 'leader'; 
        
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
                    <div class="city-owner-box">
                        <span class="owner-title">${leaderTitle}:</span>
                        <span class="owner-name">${leaderName}</span>
                    </div>
                </div>
            </div>
        `;

        let gridHtml = '<div class="titles-grid">';
        let slots = [];

        if (city.id === 1) { // Capital
            const isKing = (leaderGender === 'Masculino');
            slots.push({ 
                id: 101, 
                icon: '❤️', 
                titles: { m: 'Rei Consorte', f: 'Rainha' }, 
                defaultLabel: isKing ? 'Rainha' : 'Rei Consorte', 
                count: 1 
            });
            slots.push({ id: 102, icon: '⚜️', titles: { m: 'Príncipe', f: 'Princesa' }, defaultLabel: 'Herdeiro(a)', count: 2 });
            slots.push({ id: 103, icon: '🤡', titles: { m: 'Bobo da Corte', f: 'Boba da Corte' }, defaultLabel: 'Bobo(a) da Corte', count: 1 });
        } else { 
            const baseId = city.id * 100;
            const isLord = (leaderGender === 'Masculino');
            slots.push({ 
                id: baseId + 1, 
                icon: '❤️', 
                titles: { m: 'Lord Consorte', f: 'Lady' }, 
                defaultLabel: isLord ? 'Lady' : 'Lord Consorte', 
                count: 1 
            });
            slots.push({ id: baseId + 2, icon: '🛡️', titles: { m: 'Nobre', f: 'Nobre' }, defaultLabel: 'Nobre', count: 1 });
        }

        slots.forEach(slot => {
            // Pega jogadores e ORDENA por ID para garantir estabilidade visual
            let playersInSlot = city.nobles.filter(n => n.nobless === slot.id);
            playersInSlot.sort((a, b) => a.id.localeCompare(b.id)); 
            
            for (let i = 0; i < slot.count; i++) {
                const p = playersInSlot[i]; // i=0 pega o ID 'menor', i=1 o 'maior'
                let currentRoleName = slot.defaultLabel;
                
                if (p) {
                    currentRoleName = (p.gender === 'Masculino') ? slot.titles.m : slot.titles.f;
                }

                // TRAVA: Verifica pelo ID do JOGADOR, não pelo Slot visual
                const isLocked = p ? isPlayerLocked(p.id) : false;

                const canEdit = isOwnerGuild && hasRole && !isLocked;

                let editBtnHtml = '';
                let cursorStyle = '';
                let clickAttr = '';

                if (canEdit) {
                    const pId = p ? p.id : ''; 
                    const pName = p ? p.name.replace(/'/g, "\\'") : ''; 
                    // Passamos slotIndex apenas para referência se necessário, mas a trava será por PlayerID
                    const action = `openEditModal(${city.id}, ${slot.id}, '${currentRoleName}', ${i}, '${pId}', '${pName}')`;
                    
                    cursorStyle = 'cursor: pointer;';
                    clickAttr = `onclick="${action}"`;
                    
                    editBtnHtml = `
                    <div class="edit-btn">
                        <svg class="edit-svg" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    </div>`;
                } else if (isLocked && isOwnerGuild && hasRole) {
                    // Feedback visual de travado
                    editBtnHtml = `
                    <div class="edit-btn" style="opacity:0.3; cursor:not-allowed;" title="Aguarde o reset (UTC)">
                       <svg class="edit-svg" viewBox="0 0 24 24" fill="#888"><path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6-9h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 1 1 6 0v2H9V6z"/></svg>
                    </div>`;
                }

                gridHtml += `
                    <div class="title-card" style="${cursorStyle}" ${clickAttr}>
                        ${editBtnHtml}
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

// --- Funções do Modal de Edição ---

window.openEditModal = (cityId, noblessId, roleName, slotIndex = 0, currentHolderId = '', currentHolderName = '') => {
    activeEdit = { cityId, noblessId, slotIndex, currentHolderId, currentHolderName };
    document.getElementById('modalTitle').innerText = `Nomear: ${roleName}`;
    document.getElementById('modalDesc').innerHTML = `Digite o nome <b>EXATO</b> do jogador.<br><span style="font-size:0.8em;color:#d4af37">A alteração travará ESTE título até o reset (00:00 UTC).</span>`;
    
    playerInput.value = '';
    modalStatus.innerText = '';
    modalStatus.className = '';
    modal.style.display = 'flex';

    // Botão Exonerar
    const btnRemove = document.getElementById('btnRemoveTitle');
    if (currentHolderId && currentHolderId !== '') {
        btnRemove.style.display = 'inline-block';
        btnRemove.innerText = 'Exonerar';
    } else {
        btnRemove.style.display = 'none';
    }

    playerInput.focus();
};

window.onclick = (e) => {
    if (e.target == modal) modal.style.display = 'none';
    if (e.target == confirmModal) confirmModal.style.display = 'none';
};

// --- Botão Salvar (Nomear) ---
btnSave.onclick = async () => {
    const name = playerInput.value.trim();
    if (!name) return;

    modalStatus.innerText = "Decretando...";
    modalStatus.className = '';
    btnSave.disabled = true;

    // Se existe um titular atual, mandamos o ID para ser substituído
    const overwriteId = (activeEdit.currentHolderId && activeEdit.currentHolderId !== '') 
                        ? activeEdit.currentHolderId 
                        : null;

    // RPC atualizada recebendo overwrite_player_id
    const { data, error } = await supabase.rpc('set_city_title', {
        target_player_name: name,
        title_id: activeEdit.noblessId,
        city_id: activeEdit.cityId,
        overwrite_player_id: overwriteId
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
        
        // --- Atualiza e Trava pelo ID do Jogador ---
        if (data.target_id) {
            const lockKey = `aden_lock_player_${data.target_id}`;
            const nextReset = getNextMidnightUTC();
            localStorage.setItem(lockKey, nextReset);
        }

        // Fecha o modal e recarrega os dados com um leve delay
        setTimeout(async () => {
            modal.style.display = 'none';
            await loadDataAndCache(); 
        }, 1000);
    }
};

// --- Lógica do Botão "Exonerar" (Abre o Modal de Confirmação) ---
document.getElementById('btnRemoveTitle').onclick = () => {
    if (!activeEdit.currentHolderId) return;

    // Fecha o modal de edição e abre o de confirmação
    modal.style.display = 'none';
    
    confirmText.innerText = `Tem certeza que deseja remover o título de\n"${activeEdit.currentHolderName}"?\nEsta ação é imediata.`;
    confirmStatus.innerText = '';
    confirmStatus.className = '';
    confirmModal.style.display = 'flex';
};

// --- Botões do Modal de Confirmação ---
btnCancelRemove.onclick = () => {
    confirmModal.style.display = 'none';
    // Reabre o modal anterior? Não, melhor só fechar.
};

btnConfirmRemove.onclick = async () => {
    confirmStatus.innerText = "Removendo...";
    confirmStatus.className = '';
    btnConfirmRemove.disabled = true;

    const { data, error } = await supabase.rpc('remove_city_title', {
        target_player_id: activeEdit.currentHolderId,
        city_id: activeEdit.cityId
    });

    btnConfirmRemove.disabled = false;

    if (error) {
        confirmStatus.innerText = "Erro ao remover.";
        confirmStatus.className = 'status-error';
        console.error(error);
        return;
    }

    if (!data.success) {
        confirmStatus.innerText = data.message;
        confirmStatus.className = 'status-error';
    } else {
        confirmStatus.innerText = data.message;
        confirmStatus.className = 'status-success';

        // Sucesso: Fecha modal após 1s e recarrega
        setTimeout(() => {
            confirmModal.style.display = 'none';
            loadDataAndCache(); 
        }, 1000);
    }
};