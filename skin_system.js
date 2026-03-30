// =====================================================================
// skin_system.js — Sistema de Skins, Aden RPG (v2)
// Carregue APÓS inventory.js no HTML:
//   <script type="module" src="skin_system.js"></script>
// =====================================================================

import { supabase } from './supabaseClient.js';

// ─── Constantes ──────────────────────────────────────────────────────
const SKIN_CACHE_KEY     = 'aden_skin_cache_v2';
const DEFAULT_VIDEO      = 'https://aden-rpg.pages.dev/assets/divbolsa.webm';
const DEFAULT_VIDEO_TYPE = 'video/webm';
const VIDEO_TARGET_OPACITY = '0.9'; // opacidade final do vídeo

// ─── Cache Local (localStorage — < 1 KB) ────────────────────────────

function saveSkinCache(data) {
    try {
        localStorage.setItem(SKIN_CACHE_KEY, JSON.stringify({ ...data, cache_time: Date.now() }));
    } catch (e) {
        console.warn('[Skin] Erro ao salvar cache:', e);
    }
}

function loadSkinCache() {
    try {
        const raw = localStorage.getItem(SKIN_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function clearSkinCache() {
    localStorage.removeItem(SKIN_CACHE_KEY);
}

// ─── Helpers de Tempo ────────────────────────────────────────────────

/**
 * Badge compacto para a bolsa: "7d" / "23h" / "45m" / "Expirado"
 * Retorna null para skins permanentes (expires_at === null).
 * Exportado via window.skinSystem para inventory.js.
 */
function formatExpiryTime(expiresAt) {
    if (!expiresAt) return null;                       // permanente
    const diffMs = new Date(expiresAt) - Date.now();
    if (diffMs <= 0) return 'Expirado';
    const mins = Math.floor(diffMs / 60000);
    const hrs  = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (days >= 1) return `${days}d`;
    if (hrs  >= 1) return `${hrs}h`;
    return `${mins}m`;
}

/**
 * Texto longo para modais: "⏰ Expira em: 3 dias e 5h" ou "✨ Permanente"
 */
function formatExpiryFull(expiresAt) {
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

/** Verifica se a skin no cache local já expirou */
function isExpiredData(skinData) {
    if (!skinData) return true;
    if (!skinData.expires_at) return false;           // permanente
    return new Date(skinData.expires_at) <= Date.now();
}

// ─── Fade de Vídeo ───────────────────────────────────────────────────

const FADE_OUT_MS = 400;   // duração do fade-out (deve ser <= setTimeout abaixo)
const FADE_IN_MS  = 1500;  // duração do fade-in

/**
 * Troca o src do vídeo com fade-out → troca → fade-in.
 * skipFadeOut=true: vídeo já está em opacity 0 (boot),
 *   vai direto para o carregamento + fade-in.
 */
function _swapVideo(videoEl, newSrc, newType, skipFadeOut) {
    if (!videoEl) return;

    const doLoad = () => {
        // Vídeo já invisível — troca src
        const source = videoEl.querySelector('source');
        if (source) {
            source.src  = newSrc;
            source.type = newType || DEFAULT_VIDEO_TYPE;
        }
        videoEl.load();

        // Fade-in lento após o browser ter frames suficientes
        const fadeIn = () => {
            videoEl.style.transition = `opacity ${FADE_IN_MS}ms ease-in`;
            videoEl.style.opacity    = VIDEO_TARGET_OPACITY;
        };
        if (videoEl.readyState >= 3) {
            fadeIn();
        } else {
            videoEl.addEventListener('canplay',        fadeIn, { once: true });
            videoEl.addEventListener('canplaythrough', fadeIn, { once: true });
        }
        videoEl.play().catch(() => {});
    };

    if (skipFadeOut) {
        // Boot: vídeo já em opacity 0 pelo CSS, vai direto ao load
        doLoad();
    } else {
        // Fade-out rápido primeiro, garantindo que esteja 100% invisível
        // antes de trocar o src (elimina o flash do placeholder cinza)
        videoEl.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
        videoEl.style.opacity    = '0';
        setTimeout(doLoad, FADE_OUT_MS + 30); // +30ms de margem de segurança
    }
}

// ─── Aplicar / Remover Visual da Skin ────────────────────────────────

function applySkinUI(skinData, skipFadeOut) {
    const frameEl  = document.getElementById('avatarFrameOverlay');
    const videoEl  = document.getElementById('background-video');
    const avatarEl = document.getElementById('playerAvatarEquip');

    // Moldura
    if (skinData?.frame_url && frameEl) {
        frameEl.src           = skinData.frame_url;
        frameEl.style.display = 'block';
        if (avatarEl) avatarEl.style.border = 'none';
    }

    // Vídeo com fade (skipFadeOut=true no boot — vídeo já está em opacity 0)
    if (skinData?.video_url && videoEl) {
        _swapVideo(videoEl, skinData.video_url, DEFAULT_VIDEO_TYPE, skipFadeOut);
    }
}

function removeSkinUI(skipFadeOut) {
    const frameEl  = document.getElementById('avatarFrameOverlay');
    const videoEl  = document.getElementById('background-video');
    const avatarEl = document.getElementById('playerAvatarEquip');

    if (frameEl) { frameEl.src = ''; frameEl.style.display = 'none'; }
    if (avatarEl) avatarEl.style.border = '3px solid gold';

    if (videoEl) {
        _swapVideo(videoEl, DEFAULT_VIDEO, DEFAULT_VIDEO_TYPE, skipFadeOut);
    }
}

// ─── Expiração ───────────────────────────────────────────────────────

function checkAndHandleExpiry() {
    const skinCache = loadSkinCache();
    if (!skinCache?.active_skin) return;
    if (!isExpiredData(skinCache.active_skin)) return;

    console.log('[Skin] Skin expirou. Removendo visual...');
    clearSkinCache();
    removeSkinUI();

    const user = window.globalUser;
    if (user) {
        supabase
            .rpc('cleanup_expired_skins', { p_player_id: user.id })
            .then(() => window.loadPlayerAndItems?.(true));
    }
}

// Sem polling — verificação ocorre apenas no boot (init).
// A expiração é puramente local (lê localStorage), mas não há
// necessidade de checar com a página aberta: o timer do badge
// é visual e o servidor sempre valida na próxima ação.

// ─── Reconciliação com Servidor ───────────────────────────────────────

function reconcileWithServer(serverActiveSkinId) {
    const skinCache         = loadSkinCache();
    const localActiveSkinId = skinCache?.active_skin_inventory_id ?? null;

    if (serverActiveSkinId === localActiveSkinId) return;

    if (!serverActiveSkinId) {
        clearSkinCache();
        removeSkinUI();
        return;
    }

    const items    = window.allInventoryItems || [];
    const skinItem = items.find(i => i.id === serverActiveSkinId);
    if (!skinItem?.items) return;

    const def      = skinItem.items;
    const newCache = {
        active_skin_inventory_id: serverActiveSkinId,
        active_skin: {
            inventory_item_id : serverActiveSkinId,
            frame_url         : def.skin_frame_url || null,
            video_url         : def.skin_video_url || null,
            expires_at        : skinItem.expires_at || null,   // null = permanente
            display_name      : def.display_name    || 'Skin'
        }
    };

    saveSkinCache(newCache);
    applySkinUI(newCache.active_skin);
}

// ─── Handlers ─────────────────────────────────────────────────────────

/**
 * Ativa a skin da bolsa.
 * Com stacking: se mesma skin já estiver no gerenciador, soma a duração
 * e deleta o token ativado. O resultado_id pode ser diferente do ativado.
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

    // ── Atualiza IDB local ──────────────────────────────────────────
    const items = window.allInventoryItems || [];

    if (data.stacked) {
        // Stacking: token ativado foi consumido (deletar do IDB)
        const consumedIdx = items.findIndex(i => i.id === item.id);
        if (consumedIdx > -1) items.splice(consumedIdx, 1);

        // Atualiza expires_at da skin existente no gerenciador
        const existingIdx = items.findIndex(i => i.id === data.inventory_item_id);
        if (existingIdx > -1) {
            items[existingIdx].expires_at = data.expires_at;
        }
    } else {
        // Primeira ativação: move para gerenciador
        const idx = items.findIndex(i => i.id === item.id);
        if (idx > -1) {
            items[idx].equipped_slot = 'skin';
            items[idx].expires_at    = data.expires_at;   // timer resetado
        }
    }

    window.allInventoryItems = items;
    await window.saveCache?.(items, window.playerBaseStats || {}, new Date().toISOString());

    // ── Cache de skin ───────────────────────────────────────────────
    saveSkinCache({
        active_skin_inventory_id: data.inventory_item_id,
        active_skin: {
            inventory_item_id : data.inventory_item_id,
            frame_url         : data.frame_url  || null,
            video_url         : data.video_url  || null,
            expires_at        : data.expires_at || null,   // null = permanente
            display_name      : data.display_name || item.items?.display_name || 'Skin'
        }
    });

    applySkinUI(data);
    window.renderUI?.();

    document.getElementById('itemDetailsModal').style.display = 'none';

    const msg = data.stacked
        ? `✨ Duração acumulada! Novo prazo: ${formatExpiryFull(data.expires_at)}`
        : '✨ Skin ativada com sucesso!';
    window.showCustomAlert?.(msg);
}

/** Remove o visual ativo; skin continua no gerenciador. */
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

/** Seleciona uma skin já no gerenciador como a visualmente ativa. */
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
            frame_url         : data.frame_url  || null,
            video_url         : data.video_url  || null,
            expires_at        : data.expires_at || null,
            display_name      : data.display_name || 'Skin'
        }
    });

    applySkinUI(data);
    openSkinManagerModal(); // re-renderiza o modal com dados atualizados
}

// ─── Modal de Detalhes (tipo 'skin') ──────────────────────────────────

function showSkinDetails(item) {
    const modal = document.getElementById('itemDetailsModal');
    if (!modal) return;

    const def = item.items || {};

    const imgEl = document.getElementById('detailItemImage');
    if (imgEl) {
        imgEl.src = `https://aden-rpg.pages.dev/assets/itens/${def.name || 'unknown'}.webp`;
        imgEl.onerror = () => { imgEl.src = 'https://aden-rpg.pages.dev/assets/itens/unknown.webp'; };
    }

    const nameEl   = document.getElementById('detailItemName');
    const rarityEl = document.getElementById('detailItemRarity');
    if (nameEl)   nameEl.textContent   = def.display_name || 'Skin';
    if (rarityEl) rarityEl.textContent = def.rarity || '';

    // Expiração: expires_at null = permanente
    const expiryEl = document.getElementById('skinExpiryInfo');
    if (expiryEl) {
        expiryEl.textContent = formatExpiryFull(item.expires_at);
        expiryEl.style.display = 'block';
    }

    // Oculta seções de equipamentos
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

    // Descrição: lazy-load (não está no select "lite" de definições)
    // skin_duration_hours também é carregado aqui para exibir duração correta
    const descEl = document.getElementById('itemDescription');
    if (descEl) {
        if (def.description) {
            descEl.textContent = def.description;
        } else {
            descEl.textContent = 'Carregando...';
            supabase
                .from('items')
                .select('description, skin_duration_hours')
                .eq('item_id', item.item_id)
                .single()
                .then(({ data }) => {
                    if (data) {
                        def.description          = data.description;
                        def.skin_duration_hours  = data.skin_duration_hours;
                        // Persiste no mapa de definições para não buscar de novo
                        if (window.itemDefinitions) {
                            window.itemDefinitions.set(item.item_id, def);
                        }
                        descEl.textContent = data.description || '';
                    }
                });
        }
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

    const ownedSkins = items.filter(i =>
        i.equipped_slot === 'skin' &&
        i.items?.item_type?.toLowerCase() === 'skin'
    );

    const activeContainer = document.getElementById('skinManagerActiveSkin');
    const deactivateBtn   = document.getElementById('skinManagerDeactivateBtn');

    if (!activeSkinId || !skinCache?.active_skin) {
        if (activeContainer) activeContainer.innerHTML =
            '<p class="skin-manager-empty">Nenhuma skin ativa. Visual padrão.</p>';
        if (deactivateBtn) deactivateBtn.style.display = 'none';
    } else {
        const activeSkin = skinCache.active_skin;
        const skinItem   = ownedSkins.find(i => i.id === activeSkinId);
        const imgName    = skinItem?.items?.name || 'unknown';

        if (activeContainer) {
            activeContainer.innerHTML = `
                <div class="skin-manager-item skin-manager-item--active">
                    <img src="https://aden-rpg.pages.dev/assets/itens/${imgName}.webp"
                         onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'"
                         class="skin-manager-thumb">
                    <div class="skin-manager-info">
                        <span class="skin-manager-name">${activeSkin.display_name || 'Skin'}</span>
                        <span class="skin-manager-expiry">${formatExpiryFull(activeSkin.expires_at)}</span>
                    </div>
                    <span class="skin-active-badge">ATIVA</span>
                </div>
            `;
        }
        if (deactivateBtn) deactivateBtn.style.display = 'block';
    }

    const listEl = document.getElementById('skinManagerList');
    if (!listEl) { modal.style.display = 'flex'; return; }

    if (ownedSkins.length === 0) {
        listEl.innerHTML = '<p class="skin-manager-empty">Nenhuma skin no gerenciador.<br>Ative skins pela bolsa.</p>';
    } else {
        listEl.innerHTML = '';
        ownedSkins.forEach(skinItem => {
            const def      = skinItem.items || {};
            const isActive = skinItem.id === activeSkinId;

            const el = document.createElement('div');
            el.className = `skin-manager-item ${isActive ? 'skin-manager-item--active' : ''}`;
            el.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/itens/${def.name || 'unknown'}.webp"
                     onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'"
                     class="skin-manager-thumb">
                <div class="skin-manager-info">
                    <span class="skin-manager-name">${def.display_name || 'Skin'}</span>
                    <span class="skin-manager-expiry">${formatExpiryFull(skinItem.expires_at)}</span>
                </div>
                ${isActive
                    ? '<span class="skin-active-badge">ATIVA</span>'
                    : `<button class="skin-select-btn" data-id="${skinItem.id}">Selecionar</button>`
                }
            `;
            listEl.appendChild(el);
        });

        listEl.querySelectorAll('.skin-select-btn').forEach(btn => {
            btn.addEventListener('click', () =>
                handleSelectSkin(parseInt(btn.dataset.id, 10))
            );
        });
    }

    modal.style.display = 'flex';
}

function closeSkinManagerModal() {
    document.getElementById('skinManagerModal')?.style.setProperty('display', 'none');
}

// ─── Inicialização ────────────────────────────────────────────────────

function init() {
    // 1. Verifica expiração no cache local
    checkAndHandleExpiry();

    const skinCache  = loadSkinCache();
    const activeSkin = (skinCache?.active_skin && !isExpiredData(skinCache.active_skin))
        ? skinCache.active_skin
        : null;

    // 2. Inicializa o vídeo de fundo com o src correto ANTES do browser
    //    carregar o <source> padrão — evita load duplo e flash cinza.
    //    O vídeo está em opacity:0 (CSS), skipFadeOut=true → vai direto ao fade-in.
    const videoEl = document.getElementById('background-video');
    if (videoEl) {
        const targetSrc = activeSkin?.video_url || DEFAULT_VIDEO;
        _swapVideo(videoEl, targetSrc, DEFAULT_VIDEO_TYPE, /* skipFadeOut */ true);
    }

    // 3. Aplica moldura se houver skin ativa (vídeo já tratado acima)
    if (activeSkin?.frame_url) {
        const frameEl  = document.getElementById('avatarFrameOverlay');
        const avatarEl = document.getElementById('playerAvatarEquip');
        if (frameEl) { frameEl.src = activeSkin.frame_url; frameEl.style.display = 'block'; }
        if (avatarEl) avatarEl.style.border = 'none';
    }

    // 4. Eventos dos botões
    document.getElementById('skinConfigBtn')
        ?.addEventListener('click', openSkinManagerModal);
    document.getElementById('closeSkinManagerModal')
        ?.addEventListener('click', closeSkinManagerModal);
    document.getElementById('deactivateSkinBtn')
        ?.addEventListener('click', handleDeactivateSkin);
}

// ─── Exportações ──────────────────────────────────────────────────────
window.skinSystem = {
    init,
    applySkinUI,
    removeSkinUI,
    showSkinDetails,
    reconcileWithServer,
    formatExpiryTime,   // usado pelo badge da bolsa em inventory.js
    openSkinManagerModal
};
