import { supabase } from './supabaseClient.js';

// =======================================================================
// CHANCELARIA — mostra os títulos da cidade sobre um mapa arrastável/com
// zoom próprio, dentro de um modal com topbar dedicada.
//
// Um único arquivo cuida de TODAS as cidades: a config abaixo (CITY_CONFIGS)
// é escolhida automaticamente pela variável global `window.MERCHANT_CITY`
// que cada página de cidade já define (ex.: window.MERCHANT_CITY = "Zion").
//
// A Capital tem um conjunto de títulos próprio (Rei/Rainha, Consorte,
// Príncipes/Princesas e Bobo(a) da Corte — nobless 101/102/103). As demais
// cidades usam Lord/Lady, Lord/Lady Consorte e Nobre (nobless <id>01/<id>02).
// =======================================================================

// Enquanto estiver posicionando o bloco de títulos no mapa de CADA cidade,
// deixe true para ver o contorno tracejado + a mira vermelha. Depois mude
// para false (afeta todas as cidades de uma vez, já que é um arquivo só).
const CHANC_DEBUG = false;

const ASSET_BASE = 'https://aden-rpg.pages.dev/assets/';

// --- Configuração por cidade -------------------------------------------
// id: mesmo id de guild_battle_cities / base do campo `nobless` (id*100)
// imgUrl: imagem do mapa da Chancelaria dessa cidade
// titlesHotspotTop: posição vertical (px) do bloco de títulos no mapa da
//   Chancelaria — ajuste aqui enquanto CHANC_DEBUG estiver true
// rulerTitles: título do líder regente (m/f)
// consortTitles: título do consorte (m/f)
// extraSlots: linhas adicionais de títulos, cada uma com o nobless, quantas
//   pessoas cabem nela (count) e os títulos m/f + rótulo padrão quando vago
const CITY_CONFIGS = {
    'Capital': {
        id: 1,
        imgUrl: ASSET_BASE + 'capital_chanc.png',
        titlesHotspotTop: 174,
        rulerTitles: { m: 'Rei', f: 'Rainha' },
        consortTitles: { m: 'Rei Consorte', f: 'Rainha' },
        extraSlots: [
            { nobless: 102, count: 2, titles: { m: 'Príncipe', f: 'Princesa' }, defaultLabel: 'Herdeiro(a)' },
            { nobless: 103, count: 1, titles: { m: 'Bobo da Corte', f: 'Boba da Corte' }, defaultLabel: 'Bobo(a) da Corte' }
        ]
    },
    'Zion': {
        id: 2,
        imgUrl: ASSET_BASE + 'zion_chanc.png',
        titlesHotspotTop: 350,
        rulerTitles: { m: 'Lord', f: 'Lady' },
        consortTitles: { m: 'Lord Consorte', f: 'Lady' },
        extraSlots: [
            { nobless: 202, count: 1, titles: { m: 'Nobre', f: 'Nobre' }, defaultLabel: 'Nobre' }
        ]
    },
    'Elendor': {
        id: 3,
        imgUrl: ASSET_BASE + 'elendor_chanc.png',
        titlesHotspotTop: 350,
        rulerTitles: { m: 'Lord', f: 'Lady' },
        consortTitles: { m: 'Lord Consorte', f: 'Lady' },
        extraSlots: [
            { nobless: 302, count: 1, titles: { m: 'Nobre', f: 'Nobre' }, defaultLabel: 'Nobre' }
        ]
    },
    'Mitrar': {
        id: 4,
        imgUrl: ASSET_BASE + 'mitrar_chanc.png',
        titlesHotspotTop: 350,
        rulerTitles: { m: 'Lord', f: 'Lady' },
        consortTitles: { m: 'Lord Consorte', f: 'Lady' },
        extraSlots: [
            { nobless: 402, count: 1, titles: { m: 'Nobre', f: 'Nobre' }, defaultLabel: 'Nobre' }
        ]
    },
    'Tandra': {
        id: 5,
        imgUrl: ASSET_BASE + 'tandra_chanc.png',
        titlesHotspotTop: 350,
        rulerTitles: { m: 'Lord', f: 'Lady' },
        consortTitles: { m: 'Lord Consorte', f: 'Lady' },
        extraSlots: [
            { nobless: 502, count: 1, titles: { m: 'Nobre', f: 'Nobre' }, defaultLabel: 'Nobre' }
        ]
    },
    'Astrax': {
        id: 6,
        imgUrl: ASSET_BASE + 'astrax_chanc.png',
        titlesHotspotTop: 350,
        rulerTitles: { m: 'Lord', f: 'Lady' },
        consortTitles: { m: 'Lord Consorte', f: 'Lady' },
        extraSlots: [
            { nobless: 602, count: 1, titles: { m: 'Nobre', f: 'Nobre' }, defaultLabel: 'Nobre' }
        ]
    },
    'Duratar': {
        id: 7,
        imgUrl: ASSET_BASE + 'duratar_chanc.png',
        titlesHotspotTop: 350,
        rulerTitles: { m: 'Lord', f: 'Lady' },
        consortTitles: { m: 'Lord Consorte', f: 'Lady' },
        extraSlots: [
            { nobless: 702, count: 1, titles: { m: 'Nobre', f: 'Nobre' }, defaultLabel: 'Nobre' }
        ]
    }
};

// Detecta a cidade atual pela variável global que cada página já define
// para o mercador (window.MERCHANT_CITY = "Zion", "Capital", etc).
const CITY = CITY_CONFIGS[window.MERCHANT_CITY] || null;
const CONSORT_NOBLESS = CITY ? CITY.id * 100 + 1 : null;

let chancMapInitialized = false;

// --- 1. Injeção de Estilos (mesmo padrão de mercador.js/oficina.js) ---
function injectStyles() {
    if (document.getElementById('chancelaria-style')) return;
    const style = document.createElement('style');
    style.id = 'chancelaria-style';
    style.textContent = `
        #chancelariaModal.chanc-modal {
            display: none;
            flex-direction: column;
            align-items: stretch;
            justify-content: flex-start;
            background-color: #121212;
            padding: 0;
            overflow: hidden;
        }

        #chancTopBar {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 50px;
            background-color: #333;
            color: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 10px;
            box-sizing: border-box;
            box-shadow: 0 2px 5px rgba(0,0,0,0.5);
            z-index: 3010;
        }
        #chancTopBar .chanc-back-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: inherit;
            padding: 0;
            display: flex;
            align-items: center;
        }
        #chancTopBar .chanc-page-title {
            color: #4CAF50;
            font-size: 1.2em;
            font-weight: bold;
            text-shadow: 1px 1px 2px #000;
            font-family: 'Cinzel', serif;
        }
        #chancTopBar .chanc-topbar-spacer {
            width: 28px;
            height: 28px;
        }

        #chancMapContainer {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            margin: 0;
            z-index: 1;
            background-color: #121212;
        }
        #chancMap {
            background-image: url('${CITY ? CITY.imgUrl : ''}');
            background-repeat: no-repeat;
            background-position: center center;
            background-size: cover;
            position: absolute;
            cursor: grab;
            transform-origin: top left;
            transition: transform 0.05s linear;
        }

        /* Debug: mesmo padrão visual dos demais hotspots da cidade */
        #chancMap.debug-hotspots .chanc-titles-hotspot {
            outline: 1px dashed rgba(255,255,255,0.35);
        }
        #chancMap.debug-hotspots .chanc-titles-hotspot::before,
        #chancMap.debug-hotspots .chanc-titles-hotspot::after {
            content: '';
            position: absolute;
            top: 0;
            left: 50%;
            background: rgba(255,0,0,0.85);
            transform: translateX(-50%);
            z-index: 30;
            pointer-events: none;
        }
        #chancMap.debug-hotspots .chanc-titles-hotspot::before { width: 16px; height: 2px; }
        #chancMap.debug-hotspots .chanc-titles-hotspot::after  { width: 2px; height: 16px; }

        .chanc-titles-hotspot {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 30px;
            z-index: 5;
            padding: 10px 20px;
        }
        .chanc-title-row {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            justify-content: center;
            gap: 70px; /* gap satisfatório entre os títulos da mesma linha */
        }
        .chanc-title-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            min-width: 110px;
        }
        .chanc-card-title {
            font-family: 'Cinzel', serif;
            font-weight: bold;
            font-size: 1.15em;
            color: #ffd700;
            text-shadow: 1px 1px 3px black, -1px -1px 3px black, 0 0 6px black;
            text-align: center;
            white-space: nowrap;
        }
        .chanc-card-avatar {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            border: 2px solid gold;
            object-fit: cover;
            box-shadow: 0 2px 8px rgba(0,0,0,0.7);
            background: #000;
            box-sizing: border-box;
        }
        .chanc-card-initial {
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffd700;
            font-weight: bold;
            font-size: 2em;
            font-family: 'Cinzel', serif;
            background: #2e2e2e;
        }
        .chanc-card-vago {
            display: flex;
            align-items: center;
            justify-content: center;
            color: #aaa;
            font-weight: bold;
            font-size: 0.95em;
            font-family: 'Cinzel', serif;
            background: rgba(0,0,0,0.5);
            border-style: dashed;
        }
        .chanc-card-name {
            font-family: 'Cinzel', serif;
            font-weight: bold;
            color: #e0dccc;
            font-size: 1em;
            text-shadow: 1px 1px 3px black, -1px -1px 3px black;
            text-align: center;
            max-width: 140px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-height: 1.2em;
        }
        .chanc-loading {
            color: #e0dccc;
            font-family: 'Cinzel', serif;
            font-size: 1.1em;
            text-shadow: 1px 1px 3px black;
            padding: 20px;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);
}

// --- 2. Mapa arrastável / com zoom (mesma técnica da página principal,
//         mas medindo a imagem em tempo real para não depender de um
//         tamanho fixo e garantir o ajuste automático sem áreas pretas) ---
function initChancMap() {
    if (chancMapInitialized || !CITY) return;
    chancMapInitialized = true;

    const mapContainer = document.getElementById('chancMapContainer');
    const map = document.getElementById('chancMap');
    if (!map || !mapContainer) return;

    const probe = new Image();
    probe.onload = () => {
        setupDragZoom(mapContainer, map, probe.naturalWidth, probe.naturalHeight);
    };
    probe.onerror = () => {
        // Fallback caso a imagem não carregue (mesmas proporções do mapa principal)
        setupDragZoom(mapContainer, map, 1500, 1700);
    };
    probe.src = CITY.imgUrl;
}

function setupDragZoom(mapContainer, map, naturalWidth, naturalHeight) {
    map.style.width = naturalWidth + 'px';
    map.style.height = naturalHeight + 'px';

    const MAX_SCALE = 3.0;
    let MIN_SCALE = 0.3;
    let cx = 0, cy = 0, currentScale = 1;

    // Inércia
    let vx = 0, vy = 0, lt = 0, aId = null;
    const FRICTION = 0.94;

    // Drag
    let drag = false, sx = 0, sy = 0;

    // Pinch
    let isPinching = false;
    let pinchStartDist = 0, pinchStartScale = 1;
    let pinchFocalX = 0, pinchFocalY = 0;
    let pinchStartTx = 0, pinchStartTy = 0;

    // Limites dinâmicos
    let minX = 0, maxX = 0, minY = 0, maxY = 0;

    function recalcLimits() {
        const cr = mapContainer.getBoundingClientRect();
        // Zoom-out mínimo: impede ver fundo preto além das bordas do mapa
        MIN_SCALE = Math.max(cr.width / naturalWidth, cr.height / naturalHeight);
        if (currentScale < MIN_SCALE) {
            currentScale = MIN_SCALE;
            map.style.transform = `translate(${cx}px,${cy}px) scale(${currentScale})`;
        }
        minX = Math.min(0, cr.width - naturalWidth * currentScale);
        minY = Math.min(0, cr.height - naturalHeight * currentScale);
        maxX = 0; maxY = 0;
    }

    // Ajuste automático inicial: começa já no MIN_SCALE (encaixado, sem
    // áreas pretas) e centralizado.
    recalcLimits();
    currentScale = MIN_SCALE;
    const cr0 = mapContainer.getBoundingClientRect();
    cx = Math.min(0, (cr0.width - naturalWidth * currentScale) / 2);
    cy = Math.min(0, (cr0.height - naturalHeight * currentScale) / 2);
    map.style.transform = `translate(${cx}px,${cy}px) scale(${currentScale})`;
    recalcLimits();

    window.addEventListener('resize', recalcLimits);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', recalcLimits);
    }

    map.style.touchAction = 'none';
    map.style.userSelect = 'none';

    function applyTransform(x, y, s) {
        s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
        const cr = mapContainer.getBoundingClientRect();
        const sw = naturalWidth * s, sh = naturalHeight * s;
        x = Math.max(Math.min(0, cr.width - sw), Math.min(0, x));
        y = Math.max(Math.min(0, cr.height - sh), Math.min(0, y));
        cx = x; cy = y; currentScale = s;
        map.style.transform = `translate(${x}px,${y}px) scale(${s})`;
        recalcLimits();
    }

    function setPos(x, y) {
        cx = Math.max(minX, Math.min(maxX, x));
        cy = Math.max(minY, Math.min(maxY, y));
        map.style.transform = `translate(${cx}px,${cy}px) scale(${currentScale})`;
    }

    function inertia() {
        cancelAnimationFrame(aId);
        if (drag) return;
        vx *= FRICTION; vy *= FRICTION;
        setPos(cx + vx, cy + vy);
        if (Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4)
            aId = requestAnimationFrame(inertia);
    }

    function touchDist(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    function touchMid(e) {
        return {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
    }

    function startDrag(e) {
        drag = true;
        map.style.cursor = 'grabbing';
        sx = e.clientX ?? e.touches[0].clientX;
        sy = e.clientY ?? e.touches[0].clientY;
        vx = vy = 0; lt = performance.now();
        cancelAnimationFrame(aId);
    }

    function onDrag(e) {
        if (!drag) return;
        e.preventDefault();
        const nx = e.clientX ?? e.touches[0].clientX;
        const ny = e.clientY ?? e.touches[0].clientY;
        const dt = performance.now() - lt;
        if (dt > 0) { vx = (nx - sx) / dt; vy = (ny - sy) / dt; }
        setPos(cx + (nx - sx), cy + (ny - sy));
        sx = nx; sy = ny; lt = performance.now();
    }

    function endDrag() {
        drag = false;
        map.style.cursor = 'grab';
        if (Math.abs(vx) > 0.2 || Math.abs(vy) > 0.2) { vx *= 10; vy *= 10; inertia(); }
    }

    function onTouchStart(e) {
        if (e.touches.length >= 2) {
            isPinching = true;
            drag = false;
            cancelAnimationFrame(aId);
            pinchStartDist  = touchDist(e);
            pinchStartScale = currentScale;
            const mid = touchMid(e);
            const cr  = mapContainer.getBoundingClientRect();
            pinchFocalX = mid.x - cr.left;
            pinchFocalY = mid.y - cr.top;
            pinchStartTx = cx;
            pinchStartTy = cy;
        } else if (e.touches.length === 1 && !isPinching) {
            startDrag(e);
        }
    }

    function onTouchMove(e) {
        if (e.touches.length >= 2 && isPinching) {
            e.preventDefault();
            const newScale  = pinchStartScale * (touchDist(e) / pinchStartDist);
            const mapPointX = (pinchFocalX - pinchStartTx) / pinchStartScale;
            const mapPointY = (pinchFocalY - pinchStartTy) / pinchStartScale;
            applyTransform(
                pinchFocalX - mapPointX * newScale,
                pinchFocalY - mapPointY * newScale,
                newScale
            );
        } else if (e.touches.length === 1 && !isPinching) {
            onDrag(e);
        }
    }

    function onTouchEnd(e) {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            vx = vy = 0;
            recalcLimits();
        }
        if (e.touches.length === 0) endDrag();
    }

    map.addEventListener('mousedown', startDrag, { passive: true });
    window.addEventListener('mousemove', onDrag,    { passive: false });
    window.addEventListener('mouseup',   endDrag,   { passive: true });

    map.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend',  onTouchEnd,  { passive: true });

    map.style.cursor = 'grab';
}

// --- 3. Dados dos títulos da cidade atual ---
async function fetchChancData() {
    if (!CITY) return { leader: null, nobles: [] };

    const { data: cityRow, error: cityErr } = await supabase
        .from('guild_battle_cities')
        .select('owner')
        .eq('id', CITY.id)
        .single();

    if (cityErr) throw cityErr;

    let leader = null;
    if (cityRow?.owner) {
        const { data: guildData } = await supabase
            .from('guilds')
            .select('leader_id, players!guilds_leader_id_fkey(id, name, gender, avatar_url)')
            .eq('id', cityRow.owner)
            .single();
        leader = guildData?.players || null;
    }

    // Consorte + todos os slots extras (Príncipes/Bobo da Corte na Capital,
    // Nobre nas demais cidades)
    const noblessIds = [CONSORT_NOBLESS, ...CITY.extraSlots.map(s => s.nobless)];

    const { data: nobles } = await supabase
        .from('players')
        .select('id, name, gender, avatar_url, nobless')
        .in('nobless', noblessIds);

    return { leader, nobles: nobles || [] };
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Constrói um card de título: título em cima, avatar 100x100 no meio
// (ou "Vago" se não houver titular) e nome embaixo.
function buildCardHtml(title, player) {
    const safeTitle = escapeHtml(title);

    if (player && player.name) {
        const safeName = escapeHtml(player.name);
        const initial = safeName.trim().charAt(0).toUpperCase() || '?';
        const avatarHtml = player.avatar_url
            ? `<img class="chanc-card-avatar" data-fallback-initial="${initial}" src="${player.avatar_url}" alt="${safeName}">`
            : `<div class="chanc-card-avatar chanc-card-initial">${initial}</div>`;

        return `
            <div class="chanc-title-card">
                <div class="chanc-card-title">${safeTitle}</div>
                ${avatarHtml}
                <div class="chanc-card-name">${safeName}</div>
            </div>
        `;
    }

    return `
        <div class="chanc-title-card">
            <div class="chanc-card-title">${safeTitle}</div>
            <div class="chanc-card-avatar chanc-card-vago">Vago</div>
            <div class="chanc-card-name"></div>
        </div>
    `;
}

function renderTitles(data) {
    const wrap = document.getElementById('chancTitlesHotspot');
    if (!wrap || !CITY) return;

    const leader = data.leader;
    // Sem líder definido: assume o título masculino como rótulo padrão
    // (não há gênero para consultar ainda)
    const leaderGender = leader?.gender || 'Masculino';
    const isRulerMale = leaderGender === 'Masculino';
    const rulerTitle = isRulerMale ? CITY.rulerTitles.m : CITY.rulerTitles.f;

    const consort = data.nobles.find(n => n.nobless === CONSORT_NOBLESS) || null;
    const consortTitle = consort
        ? (consort.gender === 'Masculino' ? CITY.consortTitles.m : CITY.consortTitles.f)
        : (isRulerMale ? CITY.consortTitles.f : CITY.consortTitles.m); // oposto do gênero do regente atual

    // Linha 1: regente + consorte
    let rowsHtml = `
        <div class="chanc-title-row">
            ${buildCardHtml(rulerTitle, leader)}
            ${buildCardHtml(consortTitle, consort)}
        </div>
    `;

    // Linhas seguintes: uma por slot extra da config da cidade (Príncipes +
    // Bobo da Corte na Capital / Nobre nas demais)
    CITY.extraSlots.forEach(slot => {
        const holders = data.nobles
            .filter(n => n.nobless === slot.nobless)
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));

        const cards = [];
        for (let i = 0; i < slot.count; i++) {
            const p = holders[i] || null;
            const title = p
                ? (p.gender === 'Masculino' ? slot.titles.m : slot.titles.f)
                : slot.defaultLabel;
            cards.push(buildCardHtml(title, p));
        }

        rowsHtml += `<div class="chanc-title-row">${cards.join('')}</div>`;
    });

    wrap.innerHTML = rowsHtml;

    // Fallback de avatar quebrado -> círculo com a inicial do nome
    wrap.querySelectorAll('img.chanc-card-avatar').forEach((img) => {
        img.addEventListener('error', () => {
            const div = document.createElement('div');
            div.className = 'chanc-card-avatar chanc-card-initial';
            div.textContent = img.dataset.fallbackInitial || '?';
            img.replaceWith(div);
        }, { once: true });
    });
}

// --- 4. Abertura / fechamento do modal ---
function openChancModal() {
    if (!CITY) return;
    const modal = document.getElementById('chancelariaModal');
    if (!modal) return;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    initChancMap();

    const wrap = document.getElementById('chancTitlesHotspot');
    if (wrap && !wrap.dataset.loaded) {
        wrap.innerHTML = '<div class="chanc-loading">Carregando títulos...</div>';
    }

    fetchChancData()
        .then((data) => {
            renderTitles(data);
            if (wrap) wrap.dataset.loaded = '1';
        })
        .catch((err) => {
            console.error('Chancelaria: erro ao buscar títulos', err);
            if (wrap) wrap.innerHTML = '<div class="chanc-loading">Erro ao carregar títulos.</div>';
        });
}

function closeChancModal() {
    const modal = document.getElementById('chancelariaModal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

// --- 5. Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    if (!CITY) {
        // Página sem MERCHANT_CITY reconhecido (ou sem Chancelaria configurada
        // ainda para essa cidade) — não faz nada.
        return;
    }

    injectStyles();

    const wrap = document.getElementById('chancTitlesHotspot');
    if (wrap) wrap.style.top = CITY.titlesHotspotTop + 'px';

    const chancMap = document.getElementById('chancMap');
    if (chancMap) chancMap.classList.toggle('debug-hotspots', CHANC_DEBUG);

    const openBtn = document.getElementById('btnChancelaria');
    const backBtn = document.getElementById('chancBackBtn');

    if (openBtn) openBtn.addEventListener('click', openChancModal);
    if (backBtn) backBtn.addEventListener('click', closeChancModal);

    // Fecha com Esc também, por conveniência
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('chancelariaModal');
        if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
            closeChancModal();
        }
    });
});
