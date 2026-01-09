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

// Modal de Adicionar/Editar
const modal = document.getElementById('editModal');
const playerInput = document.getElementById('playerInput');
const btnSave = document.getElementById('btnSaveTitle');
const modalStatus = document.getElementById('modalStatus');

// Modal de Remover (NOVO)
const removeModal = document.getElementById('removeModal');
const btnConfirmRemove = document.getElementById('btnConfirmRemove');

// Estado
let currentUser = null;
let currentCityData = []; 
let activeEdit = null; 
let activeRemove = null; // Estado para a remoção

// --- Inicialização ---
async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = 'index.html'; 
        return;
    }
    currentUser = user;
    loadDataAndCache();
}

// Carrega Guildas, Cidades e Jogadores
async function loadDataAndCache() {
    try {
        // 1. Guildas
        const { data: guilds } = await supabase.from('guilds').select('id, name');
        
        // 2. Cidades (Donos)
        const { data: cities } = await supabase.from('guild_battle_cities').select('*');
        
        // 3. Jogadores com títulos
        const { data: players } = await supabase
            .from('players')
            .select('id, name, guild_id, rank, nobless, gender')
            .not('nobless', 'is', null)
            .neq('nobless', 0);

        // 4. Dados do usuário atual (para saber se é líder)
        const { data: me } = await supabase
            .from('players')
            .select('guild_id, rank, gender')
            .eq('id', currentUser.id)
            .single();

        currentCityData = cities.map(c => {
            const ownerGuild = guilds.find(g => g.id === c.owner);
            
            // Encontra jogadores com títulos nesta cidade
            // Capital: 101, 102, 103 | Outras: 201, 202... 301, 302...
            const cityPlayers = players.filter(p => {
                if (c.id === 1) return p.nobless >= 100 && p.nobless < 200;
                // Fórmula para outras cidades: (CityID * 100) + 1 ou + 2
                const base = c.id * 100;
                return p.nobless === base + 1 || p.nobless === base + 2;
            });

            return {
                ...c,
                guildName: ownerGuild ? ownerGuild.name : 'Ninguém',
                holders: cityPlayers
            };
        });

        renderCities(me);

    } catch (err) {
        console.error("Erro ao carregar dados:", err);
        container.innerHTML = '<p style="text-align:center; color:red;">Erro ao carregar dados.</p>';
    }
}

// Renderiza a Interface
function renderCities(me) {
    container.innerHTML = '';

    CITIES_DATA.forEach(cityData => {
        const cityDb = currentCityData.find(c => c.id === cityData.id);
        if (!cityDb) return;

        // Verifica permissões
        const isOwnerGuild = (me.guild_id === cityDb.owner);
        const isLeader = (me.rank === 'leader');
        const canEdit = isOwnerGuild && isLeader;

        // Definir Slots baseados na cidade
        let slots = [];
        if (cityData.id === 1) { // Capital
            slots = [
                { id: 101, role: 'Consorte', icon: '👑', count: 1 },
                { id: 102, role: 'Príncipe/Princesa', icon: '⚜️', count: 2 },
                { id: 103, role: 'Bobo da Corte', icon: '🤡', count: 1 }
            ];
        } else { // Outras Cidades
            const base = cityData.id * 100;
            slots = [
                { id: base + 1, role: 'Consorte', icon: '🔰', count: 1 },
                { id: base + 2, role: 'Nobre', icon: '🛡️', count: 1 }
            ];
        }

        // HTML dos Slots
        let gridHtml = '';
        
        slots.forEach(slot => {
            // Filtra jogadores que têm esse título específico
            const holders = cityDb.holders.filter(h => h.nobless === slot.id);
            
            // Renderiza com base no "count" (vagas)
            for (let i = 0; i < slot.count; i++) {
                const p = holders[i] || null; // Jogador ou Vazio
                
                // Ajuste de nome do cargo por gênero (ex: Rei/Rainha)
                let currentRoleName = slot.role;
                if (slot.id === 101 || (slot.id % 100) === 1) {
                    // Lógica para Consorte
                    if (p) {
                        currentRoleName = (p.gender === 'Masculino') ? 
                            (cityData.id === 1 ? 'Rei Consorte' : 'Lord Consorte') : 
                            (cityData.id === 1 ? 'Rainha Consorte' : 'Lady Consorte');
                    } else {
                        // Se vazio, mostra genérico
                         currentRoleName = (cityData.id === 1 ? 'Rei/Rainha' : 'Lord/Lady');
                    }
                }

                // Lógica de Trava (Lock) - Apenas para adicionar
                const lockKey = `aden_title_lock_${cityData.id}_${slot.id}_idx${i}`;
                const lockTime = localStorage.getItem(lockKey);
                const isSlotLocked = (lockTime && new Date(lockTime) > new Date());

                // Botões de Ação e Estilo
                let actionsHtml = '';
                let cursorStyle = '';
                let clickAttr = '';

                if (canEdit) {
                    // Ação padrão do card (Adicionar/Substituir) se não estiver travado
                    if (!isSlotLocked) {
                        const editAction = `openEditModal(${cityData.id}, ${slot.id}, '${currentRoleName}', ${i})`;
                        cursorStyle = 'cursor: pointer;';
                        clickAttr = `onclick="${editAction}"`;

                        // Ícone de Lápis (Visual)
                        const editIcon = `
                        <div class="action-btn edit-btn" title="Nomear">
                            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                        </div>`;
                        
                        // Monta o HTML inicial das ações
                        actionsHtml = `<div class="card-actions">${editIcon}</div>`;
                    } else {
                        // Feedback visual se estiver travado
                        actionsHtml = `
                        <div class="card-actions">
                            <div class="action-btn locked-btn" title="Aguarde o reset (UTC)">
                               <svg viewBox="0 0 24 24"><path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6-9h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 1 1 6 0v2H9V6z"/></svg>
                            </div>
                        </div>`;
                    }

                    // Ícone de Lixeira (Remover) - Independente da trava de ADIÇÃO
                    // Só aparece se tiver um jogador ocupando a vaga
                    if (p) {
                        const removeAction = `event.stopPropagation(); openRemoveModal('${p.id}', '${p.name}', ${cityData.id})`;
                        const removeIcon = `
                        <div class="action-btn remove-btn" onclick="${removeAction}" title="Revogar Título">
                            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </div>`;
                        
                        // Se já tinha ações (lápis ou cadeado), anexa a lixeira. Se não, cria o container.
                        if (actionsHtml.includes('card-actions')) {
                            actionsHtml = actionsHtml.replace('</div>', `${removeIcon}</div>`);
                        } else {
                            actionsHtml = `<div class="card-actions">${removeIcon}</div>`;
                        }
                    }
                }

                gridHtml += `
                    <div class="title-card" style="${cursorStyle}" ${clickAttr}>
                        ${actionsHtml}
                        <div class="title-icon">${slot.icon}</div>
                        <div class="title-role">${currentRoleName}</div>
                        <div class="player-name ${p ? '' : 'empty-slot'}">
                            ${p ? p.name : 'Vago'}
                        </div>
                    </div>
                `;
            }
        });

        // HTML Final do Card da Cidade
        const card = document.createElement('div');
        card.className = 'city-card';
        card.innerHTML = `
            <div class="city-header" style="background-image: url('${cityData.img}');">
                <div class="city-name">${cityData.name}</div>
            </div>
            <div class="city-body">
                <div class="city-owner-box">
                    <span class="owner-title">Rei:</span>
                    <span class="owner-name">${cityDb.guildName}</span>
                </div>
                <div class="titles-grid">
                    ${gridHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Helper: Calcula próximo Meio-Dia UTC (Reset)
function getNextMidnightUTC() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0); // Próxima meia-noite UTC
    return next.toISOString();
}

// --- Lógica do Modal de Adicionar ---

window.openEditModal = (cityId, noblessId, roleName, slotIndex) => {
    activeEdit = { cityId, noblessId, slotIndex };
    document.getElementById('modalTitle').innerText = `Nomear ${roleName}`;
    modalStatus.innerText = '';
    modalStatus.className = '';
    playerInput.value = '';
    modal.style.display = 'flex';
    playerInput.focus();
};

document.querySelector('.close-modal').onclick = () => {
    modal.style.display = 'none';
};

// --- Lógica do Modal de Remover (NOVO) ---

window.openRemoveModal = (playerId, playerName, cityId) => {
    activeRemove = { playerId, cityId };
    
    // Limpa ícones do nome visualmente para o modal
    const cleanName = playerName.replace(/[👑⚜️🤡🔰🛡️]/g, '').trim();
    
    document.getElementById('removePlayerName').innerText = cleanName;
    document.getElementById('removeStatus').innerText = '';
    document.getElementById('removeStatus').className = '';
    
    removeModal.style.display = 'flex';
};

// Fechar Modal de Remoção
// Nota: Certifique-se de que o elemento X no HTML tenha a classe 'close-remove-modal'
const closeRemoveBtn = document.querySelector('.close-remove-modal');
if (closeRemoveBtn) {
    closeRemoveBtn.onclick = () => {
        removeModal.style.display = 'none';
    };
}

// Fechar modais ao clicar fora
window.onclick = (e) => {
    if (e.target == modal) modal.style.display = 'none';
    if (e.target == removeModal) removeModal.style.display = 'none';
};

// --- Botões de Confirmação ---

// 1. Salvar (Adicionar/Nomear)
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
        
        // Aplica a trava local no frontend
        const lockKey = `aden_title_lock_${activeEdit.cityId}_${activeEdit.noblessId}_idx${activeEdit.slotIndex}`;
        const nextReset = getNextMidnightUTC();
        localStorage.setItem(lockKey, nextReset);

        setTimeout(() => {
            modal.style.display = 'none';
            loadDataAndCache();
        }, 1500);
    }
};

// 2. Confirmar Remoção (NOVO)
btnConfirmRemove.onclick = async () => {
    if (!activeRemove) return;

    const statusEl = document.getElementById('removeStatus');
    statusEl.innerText = "Revogando...";
    btnConfirmRemove.disabled = true;

    // Chama a nova função RPC de remover
    const { data, error } = await supabase.rpc('remove_city_title', {
        target_player_id: activeRemove.playerId,
        city_id: activeRemove.cityId
    });

    btnConfirmRemove.disabled = false;

    if (error) {
        statusEl.innerText = "Erro ao remover.";
        statusEl.className = 'status-error';
        console.error(error);
        return;
    }

    if (!data.success) {
        statusEl.innerText = data.message;
        statusEl.className = 'status-error';
    } else {
        statusEl.innerText = "Removido!";
        statusEl.className = 'status-success';
        
        // Não aplica trava de tempo para remoção
        
        setTimeout(() => {
            removeModal.style.display = 'none';
            loadDataAndCache(); // Atualiza a tela
        }, 1000);
    }
};

// Inicializa
init();