// =====================================================================
// skin_system.js — Sistema de Skins, Aden RPG (v3)
// Frame e vídeo de fundo são slots independentes.
// Carregue APÓS inventory.js no HTML:
//   <script type="module" src="skin_system.js"></script>
// =====================================================================

import { supabase } from './supabaseClient.js';

// ─── Constantes ──────────────────────────────────────────────────────
const SKIN_CACHE_KEY     = 'aden_skin_cache_v3';
const DEFAULT_VIDEO      = 'https://aden-rpg.pages.dev/assets/divbolsa.webm';
const DEFAULT_VIDEO_TYPE = 'video/webm';
const VIDEO_TARGET_OPACITY = '0.98';
const FADE_OUT_MS = 400;
const FADE_IN_MS  = 1500;

// ─── Cache Local (localStorage)
// Estrutura:
// {
//   active_frame: { inventory_item_id, frame_url, expires_at, display_name } | null,
//   active_video: { inventory_item_id, video_url, expires_at, display_name } | null,
//   cache_time: number
// }

function saveSkinCache(patch) {
    try {
        const current = loadSkinCache() || {};
        localStorage.setItem(SKIN_CACHE_KEY, JSON.stringify({
            ...current,
            ...patch,
            cache_time: Date.now()
        }));
    } catch (e) { console.warn('[Skin] Erro ao salvar cache:', e); }
}

function loadSkinCache() {
    try {
        const raw = localStorage.getItem(SKIN_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function clearSkinCache() { localStorage.removeItem(SKIN_CACHE_KEY); }

// Invalida o cache de moldura do tavernas.js (skin_modal_v1_<uuid>)
// para que o modal/taverna rebusque via RPC na próxima vez que abrir.
function _invalidateTavSkinCache(userId) {
    if (!userId) return;
    try { localStorage.removeItem('skin_modal_v1_' + userId); } catch(_) {}
}

// ─── Helpers de Tempo ────────────────────────────────────────────────

function formatExpiryTime(expiresAt) {
    if (!expiresAt) return null;
    const diffMs = new Date(expiresAt) - Date.now();
    if (diffMs <= 0) return 'Expirado';
    const mins = Math.floor(diffMs / 60000);
    const hrs  = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (days >= 1) return `${days}d`;
    if (hrs  >= 1) return `${hrs}h`;
    return `${mins}m`;
}

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

function isExpiredData(d) {
    if (!d) return true;
    if (!d.expires_at) return false;
    return new Date(d.expires_at) <= Date.now();
}

// ─── Fade de Vídeo ───────────────────────────────────────────────────

function _swapVideo(videoEl, newSrc, newType, skipFadeOut) {
    if (!videoEl) return;

    const doLoad = () => {
        const source = videoEl.querySelector('source');
        if (source) { source.src = newSrc; source.type = newType || DEFAULT_VIDEO_TYPE; }
        videoEl.load();

        const fadeIn = () => {
            videoEl.style.transition = `opacity ${FADE_IN_MS}ms ease-in`;
            videoEl.style.opacity    = VIDEO_TARGET_OPACITY;
        };
        if (videoEl.readyState >= 3) { fadeIn(); }
        else {
            videoEl.addEventListener('canplay',        fadeIn, { once: true });
            videoEl.addEventListener('canplaythrough', fadeIn, { once: true });
        }
        videoEl.play().catch(() => {});
    };

    if (skipFadeOut) {
        doLoad();
    } else {
        videoEl.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
        videoEl.style.opacity    = '0';
        setTimeout(doLoad, FADE_OUT_MS + 30);
    }
}

// ─── Aplicar / Remover Frame ─────────────────────────────────────────

function _applyFrame(frameUrl) {
    const frameEl  = document.getElementById('avatarFrameOverlay');
    const sheenEl  = document.getElementById('avatarFrameSheen');
    const avatarEl = document.getElementById('playerAvatarEquip');

    if (!frameEl) return;
    frameEl.src           = frameUrl;
    frameEl.style.display = 'block';
    if (avatarEl) avatarEl.style.border = 'none';
    if (sheenEl) {
        // Mascara o sheen com a própria imagem da moldura:
        // o brilho só aparece sobre os pixels opacos da arte da moldura.
        sheenEl.style.webkitMaskImage = `url('${frameUrl}')`;
        sheenEl.style.maskImage       = `url('${frameUrl}')`;
        sheenEl.style.display         = 'block';
    }
}

function _removeFrame() {
    const frameEl  = document.getElementById('avatarFrameOverlay');
    const sheenEl  = document.getElementById('avatarFrameSheen');
    const avatarEl = document.getElementById('playerAvatarEquip');

    if (frameEl)  { frameEl.src = ''; frameEl.style.display = 'none'; }
    if (sheenEl)  sheenEl.style.display = 'none';
    if (avatarEl) avatarEl.style.border = '3px solid gold';
}

// ─── Expiração ───────────────────────────────────────────────────────

function checkAndHandleExpiry() {
    const cache = loadSkinCache();
    if (!cache) return;

    let changed = false;

    if (cache.active_frame && isExpiredData(cache.active_frame)) {
        cache.active_frame = null;
        _removeFrame();
        changed = true;
    }
    if (cache.active_video && isExpiredData(cache.active_video)) {
        cache.active_video = null;
        _swapVideo(document.getElementById('background-video'), DEFAULT_VIDEO, DEFAULT_VIDEO_TYPE, true);
        changed = true;
    }

    if (changed) {
        saveSkinCache({ active_frame: cache.active_frame, active_video: cache.active_video });
        const user = window.globalUser;
        if (user) {
            supabase.rpc('cleanup_expired_skins', { p_player_id: user.id })
                    .then(() => window.loadPlayerAndItems?.(true));
        }
    }
}

// ─── Reconciliação com Servidor ───────────────────────────────────────

function reconcileWithServer(serverFrameId, serverVideoId) {
    const cache   = loadSkinCache() || {};
    const items   = window.allInventoryItems || [];

    const localFrameId = cache.active_frame?.inventory_item_id ?? null;
    const localVideoId = cache.active_video?.inventory_item_id ?? null;

    const frameChanged = serverFrameId !== localFrameId;
    const videoChanged = serverVideoId !== localVideoId;

    if (!frameChanged && !videoChanged) return;

    const newCache = { ...cache };

    if (frameChanged) {
        if (!serverFrameId) {
            newCache.active_frame = null;
            _removeFrame();
        } else {
            const skinItem = items.find(i => i.id === serverFrameId);
            if (skinItem?.items?.skin_frame_url) {
                newCache.active_frame = {
                    inventory_item_id : serverFrameId,
                    frame_url         : skinItem.items.skin_frame_url,
                    expires_at        : skinItem.expires_at || null,
                    display_name      : skinItem.items.display_name || 'Skin'
                };
                _applyFrame(skinItem.items.skin_frame_url);
            }
        }
    }

    if (videoChanged) {
        const videoEl = document.getElementById('background-video');
        if (!serverVideoId) {
            newCache.active_video = null;
            _swapVideo(videoEl, DEFAULT_VIDEO, DEFAULT_VIDEO_TYPE, false);
        } else {
            const skinItem = items.find(i => i.id === serverVideoId);
            if (skinItem?.items?.skin_video_url) {
                newCache.active_video = {
                    inventory_item_id : serverVideoId,
                    video_url         : skinItem.items.skin_video_url,
                    expires_at        : skinItem.expires_at || null,
                    display_name      : skinItem.items.display_name || 'Skin'
                };
                _swapVideo(videoEl, skinItem.items.skin_video_url, DEFAULT_VIDEO_TYPE, false);
            }
        }
    }

    saveSkinCache(newCache);
}

// ─── Handlers ─────────────────────────────────────────────────────────

async function handleActivateSkin(item) {
    const user = window.globalUser;
    if (!user) return;

    const { data, error } = await supabase.rpc('activate_skin', {
        p_inventory_item_id: item.id,
        p_player_id        : user.id
    });

    if (error) { window.showCustomAlert?.('Erro ao ativar: ' + error.message); return; }
    if (data?.error) { window.showCustomAlert?.(data.error); return; }

    // Skin permanente duplicada: token consumido no servidor, remove da bolsa local
    if (data?.duplicate_permanent) {
        const items = window.allInventoryItems || [];
        const consumedIdx = items.findIndex(i => i.id === item.id);
        if (consumedIdx > -1) items.splice(consumedIdx, 1);
        window.allInventoryItems = items;
        await window.saveCache?.(items, window.playerBaseStats || {}, new Date().toISOString());
        window.renderUI?.();
        document.getElementById('itemDetailsModal').style.display = 'none';
        window.showCustomAlert?.(data.message || '✨ Skin já estava ativa. Token duplicado consumido.');
        return;
    }

    // ── Atualiza IDB ──────────────────────────────────────────────
    const items = window.allInventoryItems || [];
    if (data.stacked) {
        const consumedIdx = items.findIndex(i => i.id === item.id);
        if (consumedIdx > -1) items.splice(consumedIdx, 1);
        const existingIdx = items.findIndex(i => i.id === data.inventory_item_id);
        if (existingIdx > -1) items[existingIdx].expires_at = data.expires_at;
    } else {
        const idx = items.findIndex(i => i.id === item.id);
        if (idx > -1) { items[idx].equipped_slot = 'skin'; items[idx].expires_at = data.expires_at; }
    }
    window.allInventoryItems = items;
    await window.saveCache?.(items, window.playerBaseStats || {}, new Date().toISOString());

    // ── Cache e UI ────────────────────────────────────────────────
    const patch = {};
    const def   = item.items || {};

    if (data.has_frame) {
        patch.active_frame = {
            inventory_item_id : data.inventory_item_id,
            frame_url         : data.frame_url,
            expires_at        : data.expires_at || null,
            display_name      : data.display_name || def.display_name || 'Skin'
        };
        _applyFrame(data.frame_url);
    }
    if (data.has_video) {
        patch.active_video = {
            inventory_item_id : data.inventory_item_id,
            video_url         : data.video_url,
            expires_at        : data.expires_at || null,
            display_name      : data.display_name || def.display_name || 'Skin'
        };
        _swapVideo(document.getElementById('background-video'), data.video_url, DEFAULT_VIDEO_TYPE, false);
    }
    saveSkinCache(patch);
    _invalidateTavSkinCache(user.id); // força rebusca no modal/taverna

    window.renderUI?.();
    document.getElementById('itemDetailsModal').style.display = 'none';

    const msg = data.stacked
        ? `✨ Duração acumulada! Novo prazo: ${formatExpiryFull(data.expires_at)}`
        : '✨ Skin ativada com sucesso!';
    window.showCustomAlert?.(msg);
}

// component: 'frame' | 'video' | 'both'
async function handleDeactivateSkin(component) {
    const user = window.globalUser;
    if (!user) return;

    const { data, error } = await supabase.rpc('deactivate_skin', {
        p_player_id: user.id,
        p_component: component
    });
    if (error || data?.error) { window.showCustomAlert?.('Erro ao desativar.'); return; }

    const patch = {};
    if (component === 'frame' || component === 'both') { patch.active_frame = null; _removeFrame(); }
    if (component === 'video' || component === 'both') {
        patch.active_video = null;
        _swapVideo(document.getElementById('background-video'), DEFAULT_VIDEO, DEFAULT_VIDEO_TYPE, false);
    }
    saveSkinCache(patch);
    _invalidateTavSkinCache(user.id); // força rebusca no modal/taverna
    openSkinManagerModal();
}

// component: 'frame' | 'video' | 'auto'
async function handleSelectSkin(inventoryItemId, component) {
    const user = window.globalUser;
    if (!user) return;

    const { data, error } = await supabase.rpc('select_skin', {
        p_inventory_item_id: inventoryItemId,
        p_player_id        : user.id,
        p_component        : component || 'auto'
    });
    if (error || data?.error) { window.showCustomAlert?.(data?.error || 'Erro ao selecionar.'); return; }

    const patch = {};
    const skinItem = (window.allInventoryItems || []).find(i => i.id === inventoryItemId);
    const displayName = data.display_name || skinItem?.items?.display_name || 'Skin';

    if (data.frame_url && (component === 'frame' || component === 'auto')) {
        patch.active_frame = { inventory_item_id: inventoryItemId, frame_url: data.frame_url, expires_at: data.expires_at || null, display_name: displayName };
        _applyFrame(data.frame_url);
    }
    if (data.video_url && (component === 'video' || component === 'auto')) {
        patch.active_video = { inventory_item_id: inventoryItemId, video_url: data.video_url, expires_at: data.expires_at || null, display_name: displayName };
        _swapVideo(document.getElementById('background-video'), data.video_url, DEFAULT_VIDEO_TYPE, false);
    }
    saveSkinCache(patch);
    _invalidateTavSkinCache(user.id); // força rebusca no modal/taverna
    openSkinManagerModal();
}

// ─── Modal de Detalhes ────────────────────────────────────────────────

function showSkinDetails(item) {
    const modal = document.getElementById('itemDetailsModal');
    if (!modal) return;

    const def = item.items || {};
    const hasFrame = !!def.skin_frame_url;
    const hasVideo = !!def.skin_video_url;

    const imgEl = document.getElementById('detailItemImage');
    if (imgEl) {
        imgEl.src = `https://aden-rpg.pages.dev/assets/itens/${def.name || 'unknown'}.webp`;
        imgEl.onerror = () => { imgEl.src = 'https://aden-rpg.pages.dev/assets/itens/unknown.webp'; };
    }

    const nameEl = document.getElementById('detailItemName');
    const rarityEl = document.getElementById('detailItemRarity');
    if (nameEl)   nameEl.textContent   = def.display_name || 'Skin';
    if (rarityEl) rarityEl.textContent = def.rarity || '';

    // Badge do tipo de skin
    const expiryEl = document.getElementById('skinExpiryInfo');
    if (expiryEl) {
        const typeTag = hasFrame && hasVideo ? '🖼️🎬 Moldura + Fundo' : hasFrame ? '🖼️ Moldura' : '🎬 Fundo';
        expiryEl.textContent = `${typeTag}  •  ${formatExpiryFull(item.expires_at)}`;
        expiryEl.style.display = 'block';
    }

    // Oculta seções de equipamentos normais
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

    // Verifica se esta skin (ou seus componentes) já está ativa.
    // IMPORTANTE: showSkinDetails só é chamado para itens na BOLSA (equipped_slot=null).
    // Itens na bolsa jamais estão ativos — a ativação move o item para o gerenciador
    // (equipped_slot='skin'). Se o cache aponta para este item mas ele está na bolsa,
    // o cache está obsoleto (ex: sessão anterior, skin desativada mas cache não limpo).
    const cache = loadSkinCache();
    const isInBag = (item.equipped_slot === null || item.equipped_slot === undefined);

    // Limpa cache obsoleto para evitar o botão "Já está Ativa" incorreto
    if (isInBag) {
        let staleCachePatch = {};
        if (cache?.active_frame?.inventory_item_id === item.id) staleCachePatch.active_frame = null;
        if (cache?.active_video?.inventory_item_id === item.id) staleCachePatch.active_video = null;
        if (Object.keys(staleCachePatch).length > 0) saveSkinCache(staleCachePatch);
    }

    const frameActive = !isInBag && (cache?.active_frame?.inventory_item_id === item.id);
    const videoActive = !isInBag && (cache?.active_video?.inventory_item_id === item.id);
    const fullyActive = (!hasFrame || frameActive) && (!hasVideo || videoActive);

    const activateBtn = document.getElementById('activateSkinBtn');
    if (activateBtn) {
        activateBtn.style.display = 'block';
        activateBtn.textContent   = fullyActive ? '✅ Já está Ativa' : 'Ativar';
        activateBtn.disabled      = fullyActive;
        activateBtn.onclick       = fullyActive ? null : () => handleActivateSkin(item);
    }

    // Descrição: lazy-load
    const descEl = document.getElementById('itemDescription');
    if (descEl) {
        if (def.description) {
            descEl.textContent = def.description;
        } else {
            descEl.textContent = 'Carregando...';
            supabase.from('items')
                .select('description, skin_duration_hours')
                .eq('item_id', item.item_id)
                .single()
                .then(({ data }) => {
                    if (data) {
                        def.description         = data.description;
                        def.skin_duration_hours = data.skin_duration_hours;
                        window.itemDefinitions?.set(item.item_id, def);
                        descEl.textContent = data.description || '';
                    }
                });
        }
    }

    modal.style.display = 'flex';
}

// ─── Modal Gerenciador ────────────────────────────────────────────────

function _buildSkinRow(skinItem, isActive, component) {
    const def = skinItem.items || {};
    const el  = document.createElement('div');
    el.className = `skin-manager-item${isActive ? ' skin-manager-item--active' : ''}`;
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
            : `<button class="skin-select-btn" data-id="${skinItem.id}" data-component="${component}">Selecionar</button>`
        }
    `;
    return el;
}

function openSkinManagerModal() {
    const modal = document.getElementById('skinManagerModal');
    if (!modal) return;

    const cache = loadSkinCache();
    const items = window.allInventoryItems || [];

    const ownedSkins = items.filter(i =>
        i.equipped_slot === 'skin' &&
        i.items?.item_type?.toLowerCase() === 'skin'
    );

    // ── Seção de Molduras ──────────────────────────────────────────
    const activeFrameId   = cache?.active_frame?.inventory_item_id ?? null;
    const frameContainer  = document.getElementById('skinManagerActiveFrame');
    const frameDeactBtn   = document.getElementById('skinManagerFrameDeactivateBtn');
    const frameList       = document.getElementById('skinManagerFrameList');
    const frameItems      = ownedSkins.filter(i => i.items?.skin_frame_url);

    if (frameContainer) {
        if (!activeFrameId || !cache?.active_frame) {
            frameContainer.innerHTML = '<p class="skin-manager-empty">Sem moldura ativa.</p>';
            if (frameDeactBtn) frameDeactBtn.style.display = 'none';
        } else {
            const fi = ownedSkins.find(i => i.id === activeFrameId);
            frameContainer.innerHTML = `
                <div class="skin-manager-item skin-manager-item--active">
                    <img src="https://aden-rpg.pages.dev/assets/itens/${fi?.items?.name || 'unknown'}.webp"
                         onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'"
                         class="skin-manager-thumb">
                    <div class="skin-manager-info">
                        <span class="skin-manager-name">${cache.active_frame.display_name}</span>
                        <span class="skin-manager-expiry">${formatExpiryFull(cache.active_frame.expires_at)}</span>
                    </div>
                    <span class="skin-active-badge">ATIVA</span>
                </div>`;
            if (frameDeactBtn) frameDeactBtn.style.display = 'block';
        }
    }

    if (frameList) {
        frameList.innerHTML = '';
        if (frameItems.length === 0) {
            frameList.innerHTML = '<p class="skin-manager-empty">Nenhuma moldura no gerenciador.</p>';
        } else {
            frameItems.forEach(si => {
                const isActive = si.id === activeFrameId;
                frameList.appendChild(_buildSkinRow(si, isActive, 'frame'));
            });
        }
    }

    // ── Seção de Fundos (Vídeo) ────────────────────────────────────
    const activeVideoId   = cache?.active_video?.inventory_item_id ?? null;
    const videoContainer  = document.getElementById('skinManagerActiveVideo');
    const videoDeactBtn   = document.getElementById('skinManagerVideoDeactivateBtn');
    const videoList       = document.getElementById('skinManagerVideoList');
    const videoItems      = ownedSkins.filter(i => i.items?.skin_video_url);

    if (videoContainer) {
        if (!activeVideoId || !cache?.active_video) {
            videoContainer.innerHTML = '<p class="skin-manager-empty">Sem fundo ativo. Usando padrão.</p>';
            if (videoDeactBtn) videoDeactBtn.style.display = 'none';
        } else {
            const vi = ownedSkins.find(i => i.id === activeVideoId);
            videoContainer.innerHTML = `
                <div class="skin-manager-item skin-manager-item--active">
                    <img src="https://aden-rpg.pages.dev/assets/itens/${vi?.items?.name || 'unknown'}.webp"
                         onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'"
                         class="skin-manager-thumb">
                    <div class="skin-manager-info">
                        <span class="skin-manager-name">${cache.active_video.display_name}</span>
                        <span class="skin-manager-expiry">${formatExpiryFull(cache.active_video.expires_at)}</span>
                    </div>
                    <span class="skin-active-badge">ATIVO</span>
                </div>`;
            if (videoDeactBtn) videoDeactBtn.style.display = 'block';
        }
    }

    if (videoList) {
        videoList.innerHTML = '';
        if (videoItems.length === 0) {
            videoList.innerHTML = '<p class="skin-manager-empty">Nenhum fundo no gerenciador.</p>';
        } else {
            videoItems.forEach(si => {
                const isActive = si.id === activeVideoId;
                videoList.appendChild(_buildSkinRow(si, isActive, 'video'));
            });
        }
    }

    // Liga os botões "Selecionar" depois de renderizar
    modal.querySelectorAll('.skin-select-btn').forEach(btn => {
        btn.addEventListener('click', () =>
            handleSelectSkin(parseInt(btn.dataset.id, 10), btn.dataset.component)
        );
    });

    modal.style.display = 'flex';
}

function closeSkinManagerModal() {
    document.getElementById('skinManagerModal')?.style.setProperty('display', 'none');
}

// ─── Inicialização ────────────────────────────────────────────────────

function init() {
    // 1. Verifica expiração do cache local no boot
    checkAndHandleExpiry();

    const cache = loadSkinCache() || {};

    // 2. Vídeo: define src correto ANTES do browser carregar o <source> padrão
    const videoEl = document.getElementById('background-video');
    const videoSrc = (cache.active_video && !isExpiredData(cache.active_video))
        ? cache.active_video.video_url
        : DEFAULT_VIDEO;
    _swapVideo(videoEl, videoSrc, DEFAULT_VIDEO_TYPE, /* skipFadeOut */ true);

    // 3. Moldura + sheen
    if (cache.active_frame && !isExpiredData(cache.active_frame)) {
        _applyFrame(cache.active_frame.frame_url);
    }

    // 4. Eventos
    document.getElementById('skinConfigBtn')
        ?.addEventListener('click', openSkinManagerModal);
    document.getElementById('closeSkinManagerModal')
        ?.addEventListener('click', closeSkinManagerModal);

    // Botões de desativação por componente
    document.getElementById('deactivateFrameBtn')
        ?.addEventListener('click', () => handleDeactivateSkin('frame'));
    document.getElementById('deactivateVideoBtn')
        ?.addEventListener('click', () => handleDeactivateSkin('video'));
}

// ─── Exportações ──────────────────────────────────────────────────────
window.skinSystem = {
    init,
    showSkinDetails,
    reconcileWithServer,
    formatExpiryTime,
    openSkinManagerModal
};
