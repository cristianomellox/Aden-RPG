// =====================================================================
// skin_system.js — Sistema de Skins, Aden RPG
// Adicione no HTML APÓS inventory.js:
//   <script type="module" src="skin_system.js"></script>
// =====================================================================

import { supabase } from './supabaseClient.js';

// ─── Constantes ──────────────────────────────────────────────────────
const SKIN_CACHE_KEY  = 'aden_skin_cache_v1';
const DEFAULT_VIDEO   = 'https://aden-rpg.pages.dev/assets/divbolsa.webm';
const DEFAULT_VIDEO_TYPE = 'video/webm';

// ─── Cache Local (localStorage) ──────────────────────────────────────
// Salva: { active_skin_inventory_id, active_skin: {...}, cache_time }
// É pequeno o suficiente para localStorage (< 1 KB).

function saveSkinCache(data) {
    try {
        localStorage.setItem(SKIN_CACHE_KEY, JSON.stringify({ ...data, cache_time: Date.now() }));
    } catch (e) {
        console.warn('[Skin] Erro ao salvar cache de skin:', e);
    }
}

function loadSkinCache() {
    try {
        const raw = localStorage.getItem(SKIN_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function clearSkinCache() {
    localStorage.removeItem(SKIN_CACHE_KEY);
}

// ─── Helpers de Tempo ────────────────────────────────────────────────

/**
 * Formato compacto para o badge da bolsa: "7d", "23h", "45m", "Expirado"
 * Exportado para inventory.js usar no badge do item.
 */
function formatExpiryTime(expiresAt) {
    if (!expiresAt) return null;
    const diffMs = new Date(expiresAt) - Date.now();
    if (diffMs <= 0) return 'Expirado';
    const mins  = Math.floor(diffMs / 60000);
    const hrs   = Math.floor(mins / 60);
    const days  = Math.floor(hrs / 24);
    if (days >= 1)  return `${days}d`;
    if (hrs  >= 1)  return `${hrs}h`;
    return `${mins}m`;
}

/**
 * Formato completo para modais: "⏰ Expira em: 3 dias e 5h"
 */
function formatExpiryFull(expiresAt, isPermanent) {
    if (isPermanent !== false) return '✨ Permanente';
    if (!expiresAt) return '✨ Permanente';
    const diffMs = new Date(expiresAt) - Date.now();
    if (diffMs <= 0) return '❌ Expirada';

    const mins    = Math.floor(diffMs / 60000);
    const hrs     = Math.floor(mins / 60);
    const days    = Math.floor(hrs / 24);
    const remHrs  = hrs % 24;
    const remMins = mins % 60;

    const parts = [];
    if (days   > 0) parts.push(`${days} dia${days > 1 ? 's' : ''}`);
    if (remHrs > 0) parts.push(`${remHrs}h`);
    if (remMins > 0 && days === 0) parts.push(`${remMins}min`);
    return `⏰ Expira em: ${parts.join(' e ')}`;
}

function isExpiredData(skinData) {
    if (!skinData) return true;
    if (skinData.is_permanent !== false) return false;
    if (!skinData.expires_at) return false;
    return new Date(skinData.expires_at) <= Date.now();
}

// ─── Aplicar / Remover Visual da Skin ────────────────────────────────

function applySkinUI(skinData) {
    const frameEl  = document.getElementById('avatarFrameOverlay');
    const videoEl  = document.getElementById('background-video');
    const avatarEl = document.getElementById('playerAvatarEquip');

    if (skinData?.frame_url && frameEl) {
        frameEl.src          = skinData.frame_url;
        frameEl.style.display = 'block';
        if (avatarEl) avatarEl.style.border = 'none';
    }

    if (skinData?.video_url && videoEl) {
        const source = videoEl.querySelector('source');
        if (source) {
            source.src  = skinData.video_url;
            source.type = DEFAULT_VIDEO_TYPE;
        }
        videoEl.load();
        videoEl.play().catch(() => {});
    }
}

function removeSkinUI() {
    const frameEl  = document.getElementById('avatarFrameOverlay');
    const videoEl  = document.getElementById('background-video');
    const avatarEl = document.getElementById('playerAvatarEquip');

    if (frameEl) { frameEl.src = ''; frameEl.style.display = 'none'; }
    if (avatarEl) avatarEl.style.border = '3px solid gold';

    if (videoEl) {
        const source = videoEl.querySelector('source');
        if (source) { source.src = DEFAULT_VIDEO; source.type = DEFAULT_VIDEO_TYPE; }
        videoEl.load();
        videoEl.play().catch(() => {});
    }
}

// ─── Verificação e Limpeza de Expiração ──────────────────────────────

function checkAndHandleExpiry() {
    const skinCache = loadSkinCache();
    if (!skinCache?.active_skin) return;
    if (!isExpiredData(skinCache.active_skin)) return;

    console.log('[Skin] Skin expirou. Removendo visual e limpando cache...');
    clearSkinCache();
    removeSkinUI();

    const user = window.globalUser;
    if (user) {
        supabase
            .rpc('cleanup_expired_skins', { p_player_id: user.id })
            .then(() => {
                // Força reload do inventário para remover o item expirado da IDB/UI
                window.loadPlayerAndItems?.(true);
            });
    }
}

let _expiryInterval = null;

function startExpiryChecker() {
    if (_expiryInterval) clearInterval(_expiryInterval);
    _expiryInterval = setInterval(checkAndHandleExpiry, 60_000); // verifica a cada 1 minuto
}

// ─── Reconciliação com Servidor ───────────────────────────────────────
// Chamada após fullDownload para garantir que o estado local bate com o servidor.

function reconcileWithServer(serverActiveSkinId) {
    const skinCache          = loadSkinCache();
    const localActiveSkinId  = skinCache?.active_skin_inventory_id ?? null;

    // Já em sincronia
    if (serverActiveSkinId === localActiveSkinId) return;

    if (!serverActiveSkinId) {
        // Servidor diz "sem skin ativa" — limpa tudo localmente
        clearSkinCache();
        removeSkinUI();
        return;
    }

    // Servidor tem uma skin ativa diferente da que está no cache.
    // Tenta encontrá-la nos itens já carregados em memória.
    const items    = window.allInventoryItems || [];
    const skinItem = items.find(i => i.id === serverActiveSkinId);
    if (!skinItem) return;

    const def = skinItem.items;
    if (!def) return;

    const newCache = {
        active_skin_inventory_id: serverActiveSkinId,
        active_skin: {
            inventory_item_id : serverActiveSkinId,
            frame_url         : def.skin_frame_url  || null,
            video_url         : def.skin_video_url  || null,
            expires_at        : skinItem.expires_at  || null,
            is_permanent      : skinItem.is_permanent !== false,
            display_name      : def.display_name     || 'Skin'
        }
    };

    saveSkinCache(newCache);
    applySkinUI(newCache.active_skin);
}

// ─── Handlers de Ação ─────────────────────────────────────────────────

/**
 * Ativa a skin: move da bolsa → gerenciador + define como ativa.
 * Chamado pelo botão "Ativar" no modal de detalhes do item.
 */
async function handleActivateSkin(item) {
    const user = window.globalUser;
    if (!user) return;

    const { data, error } = await supabase.rpc('activate_skin', {
        p_inventory_item_id: item.id,
        p_player_id        : user.id
    });

    if (error) { window.showCustomAlert?.('Erro ao ativar skin: ' + error.message); return; }
    if (data?.error) { window.showCustomAlert?.(data.error); return; }

    // ── Atualiza IDB local: move equipped_slot para 'skin' ──
    // NOTA: manipulamos allInventoryItems diretamente porque updateLocalInventoryState
    // limparia TODOS os outros itens com equipped_slot='skin', o que removeria
    // outras skins do gerenciador. Para skins, o comportamento é diferente: 
    // múltiplas skins podem coexistir no gerenciador ao mesmo tempo.
    const items = window.allInventoryItems || [];
    const idx   = items.findIndex(i => i.id === item.id);
    if (idx > -1) {
        items[idx].equipped_slot = 'skin';
        window.allInventoryItems = items;
    }

    // Salva IDB
    const stats = window.playerBaseStats || {};
    await window.saveCache?.(items, stats, new Date().toISOString());

    // Salva skin no localStorage
    saveSkinCache({
        active_skin_inventory_id: item.id,
        active_skin: {
            inventory_item_id : item.id,
            frame_url         : data.frame_url   || null,
            video_url         : data.video_url   || null,
            expires_at        : data.expires_at  || null,
            is_permanent      : data.is_permanent !== false,
            display_name      : data.display_name || item.items?.display_name || 'Skin'
        }
    });

    applySkinUI(data);
    window.renderUI?.();

    document.getElementById('itemDetailsModal').style.display = 'none';
    window.showCustomAlert?.('✨ Skin ativada com sucesso!');
}

/**
 * Remove o visual ativo (restaura padrão).
 * Skin permanece no gerenciador e pode ser reativada.
 */
async function handleDeactivateSkin() {
    const user = window.globalUser;
    if (!user) return;

    const { data, error } = await supabase.rpc('deactivate_skin', { p_player_id: user.id });
    if (error || data?.error) { window.showCustomAlert?.('Erro ao desativar skin.'); return; }

    clearSkinCache();
    removeSkinUI();
    closeSkinManagerModal();
    window.showCustomAlert?.('Visual padrão restaurado.');
}

/**
 * Seleciona uma skin já no gerenciador como a ativa.
 * Chamado pelo botão "Selecionar" dentro do modal gerenciador.
 */
async function handleSelectSkin(inventoryItemId) {
    const user = window.globalUser;
    if (!user) return;

    const { data, error } = await supabase.rpc('select_skin', {
        p_inventory_item_id: inventoryItemId,
        p_player_id        : user.id
    });

    if (error || data?.error) { window.showCustomAlert?.(data?.error || 'Erro ao selecionar skin.'); return; }

    saveSkinCache({
        active_skin_inventory_id: inventoryItemId,
        active_skin: {
            inventory_item_id : inventoryItemId,
            frame_url         : data.frame_url   || null,
            video_url         : data.video_url   || null,
            expires_at        : data.expires_at  || null,
            is_permanent      : data.is_permanent !== false,
            display_name      : data.display_name || 'Skin'
        }
    });

    applySkinUI(data);
    openSkinManagerModal(); // atualiza o modal visualmente
}

// ─── Modal de Detalhes do Item (tipo 'skin') ─────────────────────────
// Chamado por inventory.js → showItemDetails quando item_type === 'skin'

function showSkinDetails(item) {
    const modal = document.getElementById('itemDetailsModal');
    if (!modal) return;

    const def = item.items || {};

    // Imagem (thumbnail da skin, sem sufixo de estrelas)
    const imgEl = document.getElementById('detailItemImage');
    if (imgEl) {
        imgEl.src = `https://aden-rpg.pages.dev/assets/itens/${def.name || 'unknown'}.webp`;
        imgEl.onerror = () => { imgEl.src = 'https://aden-rpg.pages.dev/assets/itens/unknown.webp'; };
    }

    const nameEl = document.getElementById('detailItemName');
    const rarityEl = document.getElementById('detailItemRarity');
    if (nameEl) nameEl.textContent = def.display_name || 'Skin';
    if (rarityEl) rarityEl.textContent = def.rarity || '';

    // Descrição
    const descEl = document.getElementById('itemDescription');
    if (descEl) descEl.textContent = def.description || 'Skin especial para personalizar seu visual.';

    // Expiração
    const expiryEl = document.getElementById('skinExpiryInfo');
    if (expiryEl) {
        const isPermanent = item.is_permanent !== false;
        expiryEl.textContent = formatExpiryFull(item.expires_at, isPermanent);
        expiryEl.style.display = 'block';
    }

    // Oculta seções exclusivas de equipamentos
    document.querySelector('.progress-bar-container')?.style.setProperty('display', 'none');
    document.getElementById('levelUpBtn')?.style.setProperty('display', 'none');
    document.getElementById('refineBtn')?.style.setProperty('display', 'none');
    document.getElementById('reforgeItemBtn')?.style.setProperty('display', 'none');
    document.getElementById('deconstructBtn')?.style.setProperty('display', 'none');
    const detailLevel = document.getElementById('detailItemLevel');
    if (detailLevel) detailLevel.textContent = '';
    document.getElementById('itemStats')?.style.setProperty('display', 'none');
    document.getElementById('itemRefineSection')?.style.setProperty('display', 'none');
    document.getElementById('equipBtnModal')?.style.setProperty('display', 'none');

    // Mostra #itemActions apenas com o botão Ativar
    const actionsDiv = document.getElementById('itemActions');
    if (actionsDiv) actionsDiv.style.display = 'flex';

    const activateBtn = document.getElementById('activateSkinBtn');
    if (activateBtn) {
        const skinCache = loadSkinCache();
        const isActive  = skinCache?.active_skin_inventory_id === item.id;

        activateBtn.style.display = 'block';
        activateBtn.textContent   = isActive ? '✅ Já está Ativa' : 'Ativar';
        activateBtn.disabled      = isActive;
        activateBtn.onclick       = isActive ? null : () => handleActivateSkin(item);
    }

    modal.style.display = 'flex';
}

// ─── Modal Gerenciador de Skins ───────────────────────────────────────

function openSkinManagerModal() {
    const modal = document.getElementById('skinManagerModal');
    if (!modal) return;

    const skinCache    = loadSkinCache();
    const activeSkinId = skinCache?.active_skin_inventory_id ?? null;
    const items        = window.allInventoryItems || [];

    // Skins no gerenciador (equipped_slot = 'skin')
    const ownedSkins = items.filter(i =>
        i.equipped_slot === 'skin' &&
        i.items?.item_type?.toLowerCase() === 'skin'
    );

    // ── Seção "skin ativa atualmente" ──
    const activeContainer = document.getElementById('skinManagerActiveSkin');
    const deactivateBtn   = document.getElementById('skinManagerDeactivateBtn');

    if (!activeSkinId || !skinCache?.active_skin) {
        if (activeContainer) activeContainer.innerHTML =
            '<p class="skin-manager-empty">Nenhuma skin ativa. Visual padrão.</p>';
        if (deactivateBtn) deactivateBtn.style.display = 'none';
    } else {
        const activeSkin  = skinCache.active_skin;
        const skinItem    = ownedSkins.find(i => i.id === activeSkinId);
        const imgName     = skinItem?.items?.name || 'unknown';
        const expiryText  = formatExpiryFull(activeSkin.expires_at, activeSkin.is_permanent !== false);

        if (activeContainer) {
            activeContainer.innerHTML = `
                <div class="skin-manager-item skin-manager-item--active">
                    <img src="https://aden-rpg.pages.dev/assets/itens/${imgName}.webp"
                         onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'"
                         class="skin-manager-thumb">
                    <div class="skin-manager-info">
                        <span class="skin-manager-name">${activeSkin.display_name || 'Skin'}</span>
                        <span class="skin-manager-expiry">${expiryText}</span>
                    </div>
                    <span class="skin-active-badge">ATIVA</span>
                </div>
            `;
        }
        if (deactivateBtn) deactivateBtn.style.display = 'block';
    }

    // ── Lista de todas as skins do gerenciador ──
    const listEl = document.getElementById('skinManagerList');
    if (!listEl) { modal.style.display = 'flex'; return; }

    if (ownedSkins.length === 0) {
        listEl.innerHTML = '<p class="skin-manager-empty">Nenhuma skin no gerenciador.<br>Ative skins pela bolsa.</p>';
    } else {
        listEl.innerHTML = '';
        ownedSkins.forEach(skinItem => {
            const def        = skinItem.items || {};
            const isActive   = skinItem.id === activeSkinId;
            const isPermanent = skinItem.is_permanent !== false;
            const expiryText = formatExpiryFull(skinItem.expires_at, isPermanent);

            const el = document.createElement('div');
            el.className = `skin-manager-item ${isActive ? 'skin-manager-item--active' : ''}`;
            el.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/itens/${def.name || 'unknown'}.webp"
                     onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'"
                     class="skin-manager-thumb">
                <div class="skin-manager-info">
                    <span class="skin-manager-name">${def.display_name || 'Skin'}</span>
                    <span class="skin-manager-expiry">${expiryText}</span>
                </div>
                ${isActive
                    ? '<span class="skin-active-badge">ATIVA</span>'
                    : `<button class="skin-select-btn" data-id="${skinItem.id}">Selecionar</button>`
                }
            `;
            listEl.appendChild(el);
        });

        listEl.querySelectorAll('.skin-select-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                handleSelectSkin(parseInt(btn.dataset.id, 10));
            });
        });
    }

    modal.style.display = 'flex';
}

function closeSkinManagerModal() {
    document.getElementById('skinManagerModal')?.style.setProperty('display', 'none');
}

// ─── Inicialização ────────────────────────────────────────────────────

function init() {
    // 1. Aplica skin do cache imediatamente (antes do server sync)
    checkAndHandleExpiry();

    const skinCache = loadSkinCache();
    if (skinCache?.active_skin && !isExpiredData(skinCache.active_skin)) {
        applySkinUI(skinCache.active_skin);
    }

    // 2. Inicia verificação periódica de expiração
    startExpiryChecker();

    // 3. Liga eventos dos botões da UI
    document.getElementById('skinConfigBtn')
        ?.addEventListener('click', openSkinManagerModal);
    document.getElementById('closeSkinManagerModal')
        ?.addEventListener('click', closeSkinManagerModal);
    document.getElementById('deactivateSkinBtn')
        ?.addEventListener('click', handleDeactivateSkin);
}

// ─── Exportações Globais ──────────────────────────────────────────────
// inventory.js acessa via window.skinSystem.*

window.skinSystem = {
    init,
    applySkinUI,
    removeSkinUI,
    showSkinDetails,
    reconcileWithServer,
    formatExpiryTime,
    openSkinManagerModal
};
