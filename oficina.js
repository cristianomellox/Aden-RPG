
import { supabase } from './supabaseClient.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DE ROTAÇÃO  (epoch +1h para não viajar junto com o mercador)
// ─────────────────────────────────────────────────────────────────────────────

const CITIES      = ['capital', 'elendor', 'zion', 'mitrar', 'tandra', 'astrax', 'duratar'];
const CITY_LABELS = {
    capital: 'Capital', elendor: 'Elendor', zion: 'Zion',
    mitrar: 'Mitrar', tandra: 'Tandra', astrax: 'Astrax', duratar: 'Duratar'
};

const EPOCH   = new Date('2025-01-01T01:00:00Z').getTime(); // +1h vs mercador
const SLOT_MS = 4 * 60 * 60 * 1000;                        // 4 horas

function getOficinaState() {
    const now       = Date.now();
    const slot      = Math.floor((now - EPOCH) / SLOT_MS);
    const cityIndex = ((slot % CITIES.length) + CITIES.length) % CITIES.length;
    const slotStart = EPOCH + slot * SLOT_MS;
    const nextSlot  = slotStart + SLOT_MS;
    return { slot, cityIndex, currentCity: CITIES[cityIndex], slotStart, nextSlot };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DE RECEITAS
// ─────────────────────────────────────────────────────────────────────────────
const BASE = 'https://aden-rpg.pages.dev/assets/itens/';

const RECIPES = [
    {
        id:     100,
        name:   'Receita: Foice da Noite Eterna',
        type:   'arma',
        chance: 60,
        img:    BASE + 'receita_de_fragmentos_de_foice_da_noite_eterna_60.webp',
        output: {
            id:   98,
            name: 'Fragmento de Foice da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_foice_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Foice da Noite Eterna',
            img:   BASE + 'foice_da_noite_eterna.webp',
            stats: [
                { label: 'ATK',          value: '50'  },
                { label: 'Evasão',       value: '6%'  },
                { label: 'Redução CRIT', value: '80%' },
            ],
        },
        materials: [
            { id: 100, name: 'Receita de Fragmentos de Foice da Noite Eterna (60%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_foice_da_noite_eterna_60.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comprando com o Mercador em alguma cidade.' },
            { id: 86,  name: 'Asa de Morcego',     qty: 67, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 58, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 49, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 43, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 80,  name: 'Carvão',              qty: 36, img: BASE + 'carvao.webp',
              source: '• Caçando Yeti em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 29, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 75,  name: 'Minério de Mithril',  qty: 24, img: BASE + 'minerio_de_mithril.webp',
              source: '• Caçando Aranha Ártica em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 65,  name: 'Reagente Ômega',      qty: 18, img: BASE + 'reagente_omega.webp',
              source: '• Caçando Larva Kelt em Ninho de Kelts.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 63,  name: 'Lubrificante',        qty: 15, img: BASE + 'lubrificante.webp',
              source: '• Caçando Pixie em Vale Arcano.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 74,  name: 'Galho Espiritual',    qty: 11, img: BASE + 'galho_espiritual.webp',
              source: '• Caçando Sátiro em Floresta Mística.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },
    {
        id:     101,
        name:   'Receita: Foice da Noite Eterna (100%)',
        type:   'arma',
        chance: 100,
        img:    BASE + 'receita_de_fragmentos_de_foice_da_noite_eterna_100.webp',
        output: {
            id:   98,
            name: 'Fragmento de Foice da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_foice_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Foice da Noite Eterna',
            img:   BASE + 'foice_da_noite_eterna.webp',
            stats: [
                { label: 'ATK',          value: '50'  },
                { label: 'Evasão',       value: '6%'  },
                { label: 'Redução CRIT', value: '80%' },
            ],
        },
        materials: [
            { id: 101, name: 'Receita de Fragmentos de Foice da Noite Eterna (100%)', qty: 11,
              img: BASE + 'receita_de_fragmentos_de_foice_da_noite_eterna_100.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 86,  name: 'Asa de Morcego',     qty: 77, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 68, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 59, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 53, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 80,  name: 'Carvão',              qty: 46, img: BASE + 'carvao.webp',
              source: '• Caçando Yeti em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 39, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 75,  name: 'Minério de Mithril',  qty: 34, img: BASE + 'minerio_de_mithril.webp',
              source: '• Caçando Aranha Ártica em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 65,  name: 'Reagente Ômega',      qty: 28, img: BASE + 'reagente_omega.webp',
              source: '• Caçando Larva Kelt em Ninho de Kelts.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 63,  name: 'Lubrificante',        qty: 25, img: BASE + 'lubrificante.webp',
              source: '• Caçando Pixie em Vale Arcano.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 74,  name: 'Galho Espiritual',    qty: 21, img: BASE + 'galho_espiritual.webp',
              source: '• Caçando Sátiro em Floresta Mística.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },
];

const FILTER_TYPES = ['Todos','Arma','Colar','Anel','Asa','Elmo','Armadura','Skin'];

const ENCOURAGING = [
    'A forja exige paciência. Os grandes ferreiros nunca desistiram na primeira tentativa!',
    'As chamas ainda guardam segredos para você. Tente novamente!',
    'A lâmina não cedeu desta vez, mas cada golpe te aproxima do sucesso.',
    'Os espíritos do metal não cooperaram... desta vez. Continue firme!',
    'Falhou, mas não fraquejou. O sucesso aguarda quem persiste.',
    'Nem os maiores artesãos do reino venceram na primeira tentativa. Sua hora chegará!',
];

// ─────────────────────────────────────────────────────────────────────────────
// INDEXEDDB — mesmo banco/store do mercador
// ─────────────────────────────────────────────────────────────────────────────
const IDB_NAME    = 'aden_inventory_db';
const IDB_STORE   = 'inventory_store';
const IDB_VERSION = 47;

function openIdb() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onerror   = () => rej(req.error);
        req.onsuccess = e  => res(e.target.result);
        req.onupgradeneeded = () => {};
    });
}

async function getAllQtysFromCache(ids) {
    try {
        const db = await openIdb();
        if (!db.objectStoreNames.contains(IDB_STORE)) return {};
        const tx  = db.transaction(IDB_STORE, 'readonly');
        const all = await new Promise((res, rej) => {
            const r = tx.objectStore(IDB_STORE).getAll();
            r.onsuccess = () => res(r.result);
            r.onerror   = () => rej(r.error);
        });
        const result = {};
        const set = new Set(ids);
        for (const inv of all) {
            const id = inv.items?.item_id;
            if (set.has(id)) result[id] = (result[id] || 0) + (inv.quantity || 0);
        }
        return result;
    } catch { return {}; }
}

async function updateCacheQty(itemId, delta) {
    try {
        const db = await openIdb();
        if (!db.objectStoreNames.contains(IDB_STORE)) return;
        const tx    = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const all   = await new Promise((res, rej) => {
            const r = store.getAll();
            r.onsuccess = () => res(r.result);
            r.onerror   = () => rej(r.error);
        });
        const matching = all.filter(i => i.items?.item_id === itemId);
        if (matching.length === 0) return;
        let remaining = Math.abs(delta);
        if (delta < 0) {
            for (const item of matching) {
                if (remaining <= 0) break;
                if (item.quantity >= remaining) {
                    item.quantity -= remaining; remaining = 0;
                    if (item.quantity <= 0) store.delete(item.id);
                    else store.put(item);
                } else {
                    remaining -= item.quantity;
                    store.delete(item.id);
                }
            }
        } else {
            const item = matching[0];
            item.quantity = (item.quantity || 0) + delta;
            store.put(item);
        }
    } catch (e) { console.warn('oficina: cache update fail', e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTDOWN
// ─────────────────────────────────────────────────────────────────────────────
let _countdownInterval = null;

function startCountdown(nextSlot) {
    const el = document.getElementById('oficinaCountdown');
    if (!el) return;
    if (_countdownInterval) clearInterval(_countdownInterval);
    const tick = () => {
        const diff = nextSlot - Date.now();
        if (diff <= 0) { el.textContent = 'Partindo...'; clearInterval(_countdownInterval); return; }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    };
    tick();
    _countdownInterval = setInterval(tick, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// MENSAGEM DE RESULTADO
// ─────────────────────────────────────────────────────────────────────────────
function showOficinaMsg(text, icon) {
    icon = icon || '⚒️';
    let el = document.getElementById('oficinaMsgOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'oficinaMsgOverlay';
        document.body.appendChild(el);
    }
    el.innerHTML =
        '<div id="oficinaMsgBox">' +
            '<span style="font-size:2.4em;line-height:1;">' + icon + '</span>' +
            '<p id="oficinaMsgText">' + text + '</p>' +
            '<button id="oficinaMsgOk">OK</button>' +
        '</div>';
    el.style.display = 'flex';
    document.getElementById('oficinaMsgOk').onclick = function() { el.style.display = 'none'; };
}

// ─────────────────────────────────────────────────────────────────────────────
// INJEÇÃO DO MODAL PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
function injectOficinaModal() {
    if (document.getElementById('oficinaModal')) return;
    const div = document.createElement('div');
    div.id = 'oficinaModal';
    div.className = 'modal-container';
    div.style.cssText = 'display:none; z-index: 3006;';
    div.innerHTML =
        '<div id="oficinaModalContent">' +
            '<span class="close-btn" id="closeOficinaBtn" style="position:fixed;top:12px;right:18px;z-index:10;">&times;</span>' +
            '<h3 class="pm-title" style="margin-top:40px;color:gold;text-shadow:0 0 12px #c9a94a88;">Oficina do Artesão</h3>' +
            '<div id="oficinaContent">Carregando...</div>' +
        '</div>';
    document.body.appendChild(div);
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DE UI
// ─────────────────────────────────────────────────────────────────────────────
let _activeFilter  = 'Todos';
let _myRecipesMode = false;
let _cachedQtys    = {};

// ─────────────────────────────────────────────────────────────────────────────
// ABRIR MODAL PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
async function openOficinaModal() {
    injectOficinaModal();
    injectOficinaStyles();

    const modal = document.getElementById('oficinaModal');
    modal.style.display = 'flex';

    var shopsSubmenu   = document.getElementById('shopsSubmenu');
    var merchantsModal = document.getElementById('merchantsModal');
    if (shopsSubmenu)   shopsSubmenu.style.display   = 'none';
    if (merchantsModal) merchantsModal.style.display = 'none';

    const content  = document.getElementById('oficinaContent');
    const state    = getOficinaState();
    const thisCity = (window.MERCHANT_CITY || '').toLowerCase();

    if (state.currentCity !== thisCity) {
        const destLabel = CITY_LABELS[state.currentCity] || state.currentCity;
        const nextLabel = CITY_LABELS[CITIES[(state.cityIndex + 1) % CITIES.length]] || '';
        content.innerHTML =
            '<div class="oficina-absent">' +
                '<img src="https://aden-rpg.pages.dev/assets/anao_oficina.webp" class="oficina-absent-img" alt="Artesão">' +
                '<p class="oficina-absent-text">Estou trabalhando na minha forja em <strong>' + destLabel + '</strong>. Volto em breve!</p>' +
                '<p class="oficina-absent-sub">Próxima parada: <strong>' + nextLabel + '</strong></p>' +
                '<p class="oficina-absent-timer">Parte desta cidade em:<br>' +
                    '<span id="oficinaCountdown" class="oficina-countdown-big">--:--:--</span>' +
                '</p>' +
            '</div>';
        startCountdown(state.nextSlot);
        return;
    }

    content.innerHTML = '<div class="oficina-loading">⚒ Aquecendo a forja...</div>';
    startCountdown(state.nextSlot);

    const allMatIds = [];
    const seen = {};
    for (const r of RECIPES) {
        if (!seen[r.output.id]) { allMatIds.push(r.output.id); seen[r.output.id] = 1; }
        for (const m of r.materials) {
            if (!seen[m.id]) { allMatIds.push(m.id); seen[m.id] = 1; }
        }
    }
    _cachedQtys = await getAllQtysFromCache(allMatIds);

    renderMainContent(content, state);
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
function renderMainContent(area, state) {
    var filterBtns = FILTER_TYPES.map(function(t) {
        return '<button class="oficina-filter-btn' + (t === _activeFilter ? ' active' : '') + '" data-filter="' + t + '">' + t + '</button>';
    }).join('');

    area.innerHTML =
        '<div class="oficina-timer-row">' +
            '<span class="oficina-timer-label">Artesão parte em:</span><br>' +
            '<span id="oficinaCountdown" class="oficina-countdown-big">--:--:--</span>' +
        '</div>' +
        '<div class="oficina-filters" id="oficinaFilters">' +
            filterBtns +
            '<button class="oficina-myrecipes-btn' + (_myRecipesMode ? ' active' : '') + '" id="oficinaBtnMyRecipes">📜 Minhas Receitas</button>' +
        '</div>' +
        '<div class="oficina-recipe-grid" id="oficinaRecipeGrid"></div>';

    startCountdown(state.nextSlot);
    renderRecipeGrid();
    attachFilterEvents(state);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRID DE RECEITAS
// ─────────────────────────────────────────────────────────────────────────────
function renderRecipeGrid() {
    const grid = document.getElementById('oficinaRecipeGrid');
    if (!grid) return;

    var visible = RECIPES.filter(function(r) {
        var typeMatch = _activeFilter === 'Todos' || r.type.toLowerCase() === _activeFilter.toLowerCase();
        if (_myRecipesMode) return typeMatch && (_cachedQtys[r.id] || 0) > 0;
        return typeMatch;
    });

    if (visible.length === 0) {
        grid.innerHTML = '<div class="oficina-empty">Nenhum item nesta seção.</div>';
        return;
    }

    grid.innerHTML = visible.map(function(r) {
        var haveRecipe = (_cachedQtys[r.id] || 0) > 0;
        return (
            '<div class="oficina-recipe-card' + (haveRecipe ? ' have' : '') + '" data-recipe-id="' + r.id + '">' +
                '<div class="oficina-recipe-badge">' + r.chance + '%</div>' +
                '<img src="' + r.img + '" class="oficina-recipe-img" alt="' + r.name + '" onerror="this.style.opacity=\'.3\'">' +
                '<div class="oficina-recipe-name">' + r.name + '</div>' +
                '<div class="oficina-recipe-output">' +
                    '<img src="' + r.output.img + '" style="width:22px;height:22px;object-fit:contain;vertical-align:middle;"> ' +
                    r.output.qty + 'x ' + r.output.name +
                '</div>' +
            '</div>'
        );
    }).join('');

    grid.querySelectorAll('.oficina-recipe-card').forEach(function(card) {
        card.addEventListener('click', function() {
            var recipeId = parseInt(card.dataset.recipeId);
            var recipe = RECIPES.find(function(r) { return r.id === recipeId; });
            if (recipe) openRecipeDetail(recipe);
        });
    });
}

function attachFilterEvents(state) {
    document.querySelectorAll('.oficina-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            _activeFilter = btn.dataset.filter;
            document.querySelectorAll('.oficina-filter-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            renderRecipeGrid();
        });
    });
    var myBtn = document.getElementById('oficinaBtnMyRecipes');
    if (myBtn) {
        myBtn.addEventListener('click', function() {
            _myRecipesMode = !_myRecipesMode;
            myBtn.classList.toggle('active', _myRecipesMode);
            renderRecipeGrid();
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DETALHE DA RECEITA
// ─────────────────────────────────────────────────────────────────────────────
function openRecipeDetail(recipe) {
    var overlay = document.getElementById('oficinaDetailOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'oficinaDetailOverlay';
        document.body.appendChild(overlay);
    }

    var fi = recipe.finalItem;

    var statsHtml = fi.stats.map(function(s) {
        return '<span class="oficina-stat-badge">' + s.label + ': <strong>' + s.value + '</strong></span>';
    }).join('');

    var matPreview = recipe.materials.map(function(m) {
        var have = _cachedQtys[m.id] || 0;
        var ok   = have >= m.qty;
        return (
            '<div class="oficina-mat-preview-item' + (ok ? '' : ' missing') + '" title="' + m.name + '" ' +
                'data-source="' + encodeURIComponent(m.source) + '" ' +
                'data-img="' + encodeURIComponent(m.img) + '" ' +
                'data-name="' + encodeURIComponent(m.name) + '">' +
                '<img src="' + m.img + '" alt="' + m.name + '">' +
                '<span>' + m.qty + '</span>' +
            '</div>'
        );
    }).join('');

    overlay.innerHTML =
        '<div class="oficina-detail-box">' +
            '<div class="oficina-detail-header">' +
                '<button class="oficina-detail-close" id="closeDetailOverlay">&times;</button>' +
            '</div>' +
            '<div class="oficina-detail-body">' +
            '<div class="oficina-chain">' +
                '<div class="oficina-chain-step">' +
                    '<div class="oficina-chain-label">Receita</div>' +
                    '<img src="' + recipe.img + '" class="oficina-chain-img" alt="' + recipe.name + '">' +
                    '<div class="oficina-chain-name">' + recipe.name + '</div>' +
                    '<div class="oficina-chain-chance">⚙ ' + recipe.chance + '% de sucesso</div>' +
                '</div>' +
                '<div class="oficina-chain-arrow">➜</div>' +
                '<div class="oficina-chain-step">' +
                    '<div class="oficina-chain-label">Resultado</div>' +
                    '<img src="' + recipe.output.img + '" class="oficina-chain-img" alt="' + recipe.output.name + '">' +
                    '<div class="oficina-chain-name">' + recipe.output.qty + 'x ' + recipe.output.name + '</div>' +
                '</div>' +
                '<div class="oficina-chain-arrow">➜</div>' +
                '<div class="oficina-chain-step final">' +
                    '<div class="oficina-chain-label">Item Final</div>' +
                    '<img src="' + fi.img + '" class="oficina-chain-img" alt="' + fi.name + '">' +
                    '<div class="oficina-chain-name">' + fi.name + '</div>' +
                    '<div class="oficina-chain-stats">' + statsHtml + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="oficina-mat-preview">' +
                '<div class="oficina-mat-preview-title">🧪 Materiais Necessários</div>' +
                '<div class="oficina-mat-preview-grid">' + matPreview + '</div>' +
            '</div>' +
            '<button class="oficina-btn-criar" id="oficinaBtnCriar">⚒ Criar Fragmentos</button>' +
            '</div>' + // fecha oficina-detail-body
        '</div>';

    overlay.style.display = 'flex';
    document.getElementById('closeDetailOverlay').onclick = function() { overlay.style.display = 'none'; };
    document.getElementById('oficinaBtnCriar').onclick    = function() {
        if (recipe.chance === 100) { openMaterialsModal(recipe); }
        else { openConfirmModal(recipe); }
    };

    // Clique nos materiais do preview → onde obter
    overlay.querySelectorAll('.oficina-mat-preview-item').forEach(function(item) {
        item.addEventListener('click', function() {
            openItemInfoModal({
                source: decodeURIComponent(item.dataset.source),
                img:    decodeURIComponent(item.dataset.img),
                name:   decodeURIComponent(item.dataset.name),
            });
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL DE CONFIRMAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
function openConfirmModal(recipe) {
    var modal = document.getElementById('oficinaConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'oficinaConfirmModal';
        document.body.appendChild(modal);
    }

    modal.innerHTML =
        '<div class="oficina-confirm-box">' +
            '<div class="oficina-confirm-icon">⚠️</div>' +
            '<h4 class="oficina-confirm-title">Confirmar Criação</h4>' +
            '<p class="oficina-confirm-text">' +
                'Você tentará criar <strong>' + recipe.output.qty + 'x ' + recipe.output.name + '</strong>.<br><br>' +
                'Esta tentativa tem <span class="oficina-chance-badge">' + recipe.chance + '% de chance</span> de sucesso.<br><br>' +
                'Em caso de falha, os materiais ainda serão consumidos.<br><br>' +
                'Deseja continuar?' +
            '</p>' +
            '<div class="oficina-confirm-btns">' +
                '<button class="oficina-btn-nao" id="oficinaBtnNao">Não</button>' +
                '<button class="oficina-btn-sim" id="oficinaBtnSim">Sim</button>' +
            '</div>' +
        '</div>';

    modal.style.display = 'flex';
    document.getElementById('oficinaBtnNao').onclick = function() { modal.style.display = 'none'; };
    document.getElementById('oficinaBtnSim').onclick = function() {
        modal.style.display = 'none';
        openMaterialsModal(recipe);
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL DE MATERIAIS
// ─────────────────────────────────────────────────────────────────────────────
function openMaterialsModal(recipe) {
    var modal = document.getElementById('oficinaMatsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'oficinaMatsModal';
        document.body.appendChild(modal);
    }

    var allOk = recipe.materials.every(function(m) { return (_cachedQtys[m.id] || 0) >= m.qty; });

    var matCards = recipe.materials.map(function(m) {
        var have = _cachedQtys[m.id] || 0;
        var ok   = have >= m.qty;
        return (
            '<div class="oficina-mat-card' + (ok ? '' : ' lacks') + '" ' +
                  'data-mat-id="' + m.id + '" ' +
                  'data-source="' + encodeURIComponent(m.source) + '" ' +
                  'data-img="' + encodeURIComponent(m.img) + '" ' +
                  'data-name="' + encodeURIComponent(m.name) + '">' +
                '<img src="' + m.img + '" class="oficina-mat-img' + (ok ? '' : ' grayscale') + '" alt="' + m.name + '">' +
                '<div class="oficina-mat-name">' + m.name + '</div>' +
                '<div class="oficina-mat-qty ' + (ok ? 'ok' : 'missing') + '">' + have + '/' + m.qty + '</div>' +
            '</div>'
        );
    }).join('');

    var forjarLabel = allOk ? '🔥 Forjar Agora' : '🔒 Materiais insuficientes';

    modal.innerHTML =
        '<div class="oficina-mats-box">' +
            '<div class="oficina-detail-header">' +
                '<button class="oficina-detail-close" id="closeMatsModal">&times;</button>' +
            '</div>' +
            '<div style="padding:0 18px 6px;display:flex;flex-direction:column;gap:14px;">' +
            '<h4 class="oficina-mats-title">🧪 Materiais para Forja</h4>' +
            '<div class="oficina-mats-grid">' + matCards + '</div>' +
            '<button class="oficina-btn-forjar' + (allOk ? '' : ' disabled') + '" id="oficinaBtnForjar"' + (allOk ? '' : ' disabled') + '>' +
                forjarLabel +
            '</button>' +
            '</div>' +
        '</div>';

    modal.style.display = 'flex';

    modal.querySelectorAll('.oficina-mat-card').forEach(function(card) {
        card.addEventListener('click', function() {
            openItemInfoModal({
                source: decodeURIComponent(card.dataset.source),
                img:    decodeURIComponent(card.dataset.img),
                name:   decodeURIComponent(card.dataset.name),
            });
        });
    });

    document.getElementById('closeMatsModal').onclick = function() { modal.style.display = 'none'; };

    if (allOk) {
        document.getElementById('oficinaBtnForjar').onclick = function() {
            modal.style.display = 'none';
            doCraft(recipe);
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MINI MODAL "ONDE CONSEGUIR"
// ─────────────────────────────────────────────────────────────────────────────
function openItemInfoModal(info) {
    var modal = document.getElementById('oficinaItemInfoModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'oficinaItemInfoModal';
        document.body.appendChild(modal);
    }
    modal.innerHTML =
        '<div class="oficina-iteminfo-box">' +
            '<div class="oficina-detail-header">' +
                '<button class="oficina-detail-close" id="closeItemInfo">&times;</button>' +
            '</div>' +
            '<div style="padding:0 22px 6px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;">' +
                '<img src="' + info.img + '" class="oficina-iteminfo-img" alt="' + info.name + '">' +
                '<h4 class="oficina-iteminfo-title">' + info.name + '</h4>' +
                '<p class="oficina-iteminfo-label">Como Obter</p>' +
                '<p class="oficina-iteminfo-text">' + info.source.replace(/\n/g, '<br>') + '</p>' +
            '</div>' +
        '</div>';
    modal.style.display = 'flex';
    document.getElementById('closeItemInfo').onclick = function() { modal.style.display = 'none'; };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORJAR — chamada RPC
// ─────────────────────────────────────────────────────────────────────────────
async function doCraft(recipe) {
    showOficinaMsg('⚒ Aquecendo a forja... Aguarde.', '🔥');

    try {
        const { data, error } = await supabase.rpc('workshop_craft', {
            p_recipe_id: recipe.id,
        });

        if (error) throw error;

        if (data.success) {
            for (const mat of recipe.materials) {
                await updateCacheQty(mat.id, -mat.qty);
                _cachedQtys[mat.id] = Math.max(0, (_cachedQtys[mat.id] || 0) - mat.qty);
            }
            await updateCacheQty(recipe.output.id, recipe.output.qty);
            _cachedQtys[recipe.output.id] = (_cachedQtys[recipe.output.id] || 0) + recipe.output.qty;

            showOficinaMsg(
                '✨ Sucesso! Você recebeu <strong>' + recipe.output.qty + 'x ' + recipe.output.name + '</strong>!<br><br>Verifique sua bolsa.',
                '✨'
            );
        } else {
            for (const mat of recipe.materials) {
                await updateCacheQty(mat.id, -mat.qty);
                _cachedQtys[mat.id] = Math.max(0, (_cachedQtys[mat.id] || 0) - mat.qty);
            }
            const phrase = ENCOURAGING[Math.floor(Math.random() * ENCOURAGING.length)];
            showOficinaMsg('<strong>A forja falhou desta vez...</strong><br><br>' + phrase, '💨');
        }
    } catch (err) {
        showOficinaMsg('Erro ao forjar: ' + (err.message || 'Falha desconhecida.'), '❌');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS INJETADO DINAMICAMENTE
// ─────────────────────────────────────────────────────────────────────────────
function injectOficinaStyles() {
    if (document.getElementById('oficinaStyles')) return;
    const style = document.createElement('style');
    style.id = 'oficinaStyles';
    style.textContent = `
/* ═══════════════════════════════════════════════════════════════════
   OFICINA — MODAL PRINCIPAL
═══════════════════════════════════════════════════════════════════ */
#oficinaModal {
    background-image:
        linear-gradient(rgba(0,0,10,.30), rgba(0,0,0,0)),
        url('https://aden-rpg.pages.dev/assets/anao_oficina.webp');
    background-size: cover;
    background-position: center top;
    background-repeat: no-repeat;
    align-items: flex-start;
    padding-top: 0;
}
#oficinaModalContent {
    width: 100% !important; height: 100% !important;
    max-width: 100% !important; max-height: 100vh !important;
    background: transparent !important;
    border: none !important; box-shadow: none !important;
    display: flex; flex-direction: column;
    align-items: center; overflow-y: auto;
    padding: 20px 10px 80px;
}
#oficinaContent {
    width: 100%; max-width: 680px;
    display: flex; flex-direction: column;
    align-items: center; gap: 14px;
    opacity: 0; animation: fadeCardIn 4s ease-out forwards;
}
/* ── AUSENTE ───────────────────────────────────────────────────── */
.oficina-absent {
    display: flex; flex-direction: column; align-items: center;
    gap: 16px; padding: 40px 20px; text-align: center;
    background: rgba(0,0,0,.65); border: 1px solid #c9a94a;
    border-radius: 12px; max-width: 460px; margin: auto;
    opacity: 0; animation: fadeCardIn 3s ease-out forwards;
}
.oficina-absent-img { width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 2px solid #c9a94a; }
.oficina-absent-text  { color: #e0dccc; font-size: 1.05em; margin: 0; }
.oficina-absent-sub   { color: #aaa; font-size: .9em; margin: 0; }
.oficina-absent-timer { color: #ddd; font-size: .9em; margin: 0; }
/* ── TIMER ─────────────────────────────────────────────────────── */
.oficina-timer-row { text-align: center; }
.oficina-timer-label { color: #ccc; font-size: .85em; }
.oficina-countdown-big {
    display: inline-block;
    background: linear-gradient(to bottom, #ffd700 0%, #fff 50%, #b8860b 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    font-size: 2em; font-weight: bold; letter-spacing: 2px;
}
.oficina-loading { color: #c9a94a; font-size: 1.1em; padding: 40px; text-align: center; animation: fadeCardIn 2s ease-out forwards; }
/* ── FILTROS ───────────────────────────────────────────────────── */
.oficina-filters {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;
    width: 95%; max-width: 640px;
    background: rgba(0,0,0,.55); border: 1px solid #c9a94a44;
    border-radius: 10px; padding: 8px 10px;
}
.oficina-filter-btn {
    background: rgba(255,255,255,.06); border: 1px solid #c9a94a55;
    color: #ccc; border-radius: 6px; padding: 5px 11px;
    font-family: 'Cinzel', serif; font-size: .78em; cursor: pointer;
    transition: background .18s, color .18s, border-color .18s;
}
.oficina-filter-btn:hover, .oficina-filter-btn.active {
    background: linear-gradient(135deg, #b8860b, #8b6914);
    border-color: #c9a94a; color: #fff;
}
.oficina-myrecipes-btn {
    background: rgba(255,215,0,.08); border: 1px solid #c9a94a66;
    color: #ffd700; border-radius: 6px; padding: 5px 11px;
    font-family: 'Cinzel', serif; font-size: .78em; cursor: pointer;
    transition: background .18s, color .18s; white-space: nowrap;
}
.oficina-myrecipes-btn:hover {
    background: rgba(255,215,0,.18); color: #fff;
}
.oficina-myrecipes-btn.active {
    background: linear-gradient(135deg, #b8860b, #8b6914);
    border-color: #c9a94a; color: #fff;
}
/* ── GRID DE RECEITAS ──────────────────────────────────────────── */
.oficina-recipe-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
    gap: 12px; width: 95%; max-width: 640px;
}
.oficina-empty { color: #888; font-size: .95em; text-align: center; padding: 30px; grid-column: 1/-1; }
.oficina-recipe-card {
    position: relative;
    background: linear-gradient(180deg, #2a2410, #1a1a1a);
    border: 1px solid #c9a94a66; border-radius: 10px;
    padding: 12px 8px 10px;
    display: flex; flex-direction: column; align-items: center; gap: 7px;
    cursor: pointer;
    transition: transform .18s, border-color .18s, box-shadow .18s;
    opacity: 0; animation: fadeCardIn 6s ease-out forwards;
}
.oficina-recipe-card:hover { transform: translateY(-3px); border-color: #c9a94a; box-shadow: 0 4px 18px rgba(201,169,74,.35); }
.oficina-recipe-card.have  { border-color: #4caf50aa; box-shadow: 0 0 8px rgba(76,175,80,.2); }
.oficina-recipe-badge {
    position: absolute; top: 6px; right: 6px;
    background: linear-gradient(135deg, #b8860b, #8b6914);
    color: #fff; font-size: .68em; border-radius: 4px; padding: 2px 5px; font-weight: bold;
}
.oficina-recipe-img  { width: 68px; height: 68px; object-fit: contain; }
.oficina-recipe-name { color: #e0dccc; font-size: .75em; text-align: center; line-height: 1.3; min-height: 2.6em; }
.oficina-recipe-output { color: #c9a94a; font-size: .72em; text-align: center; }
/* ═══════════════════════════════════════════════════════════════════
   DETALHE DA RECEITA
═══════════════════════════════════════════════════════════════════ */
#oficinaDetailOverlay {
    display: none; position: fixed; inset: 0; z-index: 4000;
    background: rgba(0,0,0,.78);
    align-items: center; justify-content: center; padding: 16px;
}
.oficina-detail-box {
    background: linear-gradient(160deg, #1c1c2e, #111118);
    border: 1px solid #c9a94a; border-radius: 14px;
    padding: 0 0 22px; max-width: 560px; width: 100%;
    max-height: 90vh; overflow-y: auto;
    display: flex; flex-direction: column; gap: 18px;
    box-shadow: 0 8px 40px rgba(0,0,0,.9);
}
.oficina-detail-header {
    display: flex; justify-content: flex-end; align-items: center;
    padding: 10px 14px 0; flex-shrink: 0;
}
.oficina-detail-body {
    display: flex; flex-direction: column; gap: 18px;
    padding: 0 20px 6px;
}
.oficina-detail-close {
    background: none; border: none; color: #aaa; font-size: 1.6em;
    cursor: pointer; line-height: 1; transition: color .15s; padding: 0;
}
.oficina-detail-close:hover { color: #fff; }
.oficina-chain { display: flex; align-items: flex-start; justify-content: center; gap: 10px; flex-wrap: wrap; }
.oficina-chain-step { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: 130px; text-align: center; }
.oficina-chain-step.final { opacity: .75; }
.oficina-chain-label { color: #c9a94a; font-size: .72em; text-transform: uppercase; letter-spacing: 1px; }
.oficina-chain-img   { width: 64px; height: 64px; object-fit: contain; }
.oficina-chain-name  { color: #e0dccc; font-size: .78em; line-height: 1.3; }
.oficina-chain-chance { color: #ffd700; font-size: .72em; }
.oficina-chain-arrow { color: #c9a94a; font-size: 1.6em; align-self: center; margin-top: 20px; }
.oficina-chain-stats { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; margin-top: 2px; }
.oficina-stat-badge { background: rgba(201,169,74,.15); border: 1px solid #c9a94a55; color: #e0dccc; font-size: .68em; padding: 2px 6px; border-radius: 4px; }
.oficina-mat-preview { width: 100%; }
.oficina-mat-preview-title { color: gold; font-size: .85em; margin-bottom: 8px; border-bottom: 1px solid #c9a94a33; padding-bottom: 4px; }
.oficina-mat-preview-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.oficina-mat-preview-item { display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; }
.oficina-mat-preview-item img { width: 36px; height: 36px; object-fit: contain; transition: transform .15s; }
.oficina-mat-preview-item:hover img { transform: scale(1.15); }
.oficina-mat-preview-item span { color: #c9a94a; font-size: .7em; }
.oficina-mat-preview-item.missing img  { filter: grayscale(1) opacity(.5); }
.oficina-mat-preview-item.missing span { color: #888; }
.oficina-btn-criar {
    background: linear-gradient(135deg, #b8860b, #8b6914); color: #fff;
    border: 1px solid #c9a94a; border-radius: 8px; padding: 10px 28px;
    font-family: 'Cinzel', serif; font-size: .95em; cursor: pointer; align-self: center;
    transition: background .2s, transform .15s;
}
.oficina-btn-criar:hover { background: linear-gradient(135deg, #d4a017, #a07820); transform: scale(1.03); }
/* ═══════════════════════════════════════════════════════════════════
   MODAL DE CONFIRMAÇÃO
═══════════════════════════════════════════════════════════════════ */
#oficinaConfirmModal {
    display: none; position: fixed; inset: 0; z-index: 4100;
    background: rgba(0,0,0,.80);
    align-items: center; justify-content: center; padding: 16px;
}
.oficina-confirm-box {
    background: linear-gradient(160deg, #1e1e2e, #12121c);
    border: 1px solid #c9a94a; border-radius: 14px; padding: 28px 24px 22px;
    max-width: 380px; width: 100%;
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    box-shadow: 0 8px 32px rgba(0,0,0,.9); text-align: center;
}
.oficina-confirm-icon  { font-size: 2.2em; }
.oficina-confirm-title { color: gold; font-size: 1.05em; margin: 0; }
.oficina-confirm-text  { color: #e0dccc; font-size: .88em; margin: 0; line-height: 1.6; }
.oficina-chance-badge  { background: linear-gradient(135deg, #b8860b, #8b6914); color: #fff; padding: 2px 8px; border-radius: 4px; font-weight: bold; }
.oficina-confirm-btns  { display: flex; gap: 14px; }
.oficina-btn-nao {
    background: rgba(255,255,255,.08); border: 1px solid #666; color: #ccc;
    padding: 9px 26px; border-radius: 8px; font-family: 'Cinzel', serif; font-size: .9em;
    cursor: pointer; transition: background .18s;
}
.oficina-btn-nao:hover { background: rgba(255,255,255,.15); }
.oficina-btn-sim {
    background: linear-gradient(135deg, #b8860b, #8b6914); border: 1px solid #c9a94a; color: #fff;
    padding: 9px 26px; border-radius: 8px; font-family: 'Cinzel', serif; font-size: .9em;
    cursor: pointer; transition: background .2s, transform .15s;
}
.oficina-btn-sim:hover { background: linear-gradient(135deg, #d4a017, #a07820); transform: scale(1.03); }
/* ═══════════════════════════════════════════════════════════════════
   MODAL DE MATERIAIS
═══════════════════════════════════════════════════════════════════ */
#oficinaMatsModal {
    display: none; position: fixed; inset: 0; z-index: 4200;
    background: rgba(0,0,0,.80);
    align-items: center; justify-content: center; padding: 16px;
}
.oficina-mats-box {
    background: linear-gradient(160deg, #1c1c2e, #111118);
    border: 1px solid #c9a94a; border-radius: 14px;
    padding: 0 0 22px; max-width: 500px; width: 100%;
    max-height: 88vh; overflow-y: auto;
    display: flex; flex-direction: column; gap: 14px;
    box-shadow: 0 8px 40px rgba(0,0,0,.9);
}
.oficina-mats-title { color: gold; font-size: 1em; text-align: center; margin: 0; }
.oficina-mats-grid  { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 10px; }
.oficina-mat-card {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    background: rgba(255,255,255,.04); border: 1px solid #c9a94a44;
    border-radius: 8px; padding: 8px 4px; cursor: pointer;
    transition: border-color .18s, background .18s;
}
.oficina-mat-card:hover { border-color: #c9a94a; background: rgba(201,169,74,.08); }
.oficina-mat-card.lacks { border-color: #ff444444; }
.oficina-mat-img { width: 44px; height: 44px; object-fit: contain; }
.grayscale { filter: grayscale(1) opacity(.45); }
.oficina-mat-name { color: #ccc; font-size: .65em; text-align: center; line-height: 1.3; }
.oficina-mat-qty  { font-size: .72em; font-weight: bold; }
.oficina-mat-qty.ok      { color: #4caf50; }
.oficina-mat-qty.missing { color: #f44336; }
.oficina-btn-forjar {
    background: linear-gradient(135deg, #b8860b, #7a4f00); color: #fff;
    border: 1px solid #c9a94a; border-radius: 8px; padding: 11px 30px;
    font-family: 'Cinzel', serif; font-size: .95em; cursor: pointer; align-self: center;
    transition: background .2s, transform .15s;
}
.oficina-btn-forjar:hover:not(.disabled) { background: linear-gradient(135deg, #d4a017, #a07820); transform: scale(1.04); }
.oficina-btn-forjar.disabled { opacity: .5; cursor: not-allowed; filter: grayscale(.6); }
/* ═══════════════════════════════════════════════════════════════════
   MINI MODAL "ONDE CONSEGUIR"
═══════════════════════════════════════════════════════════════════ */
#oficinaItemInfoModal {
    display: none; position: fixed; inset: 0; z-index: 4300;
    background: rgba(0,0,0,.75);
    align-items: center; justify-content: center; padding: 16px;
}
.oficina-iteminfo-box {
    background: linear-gradient(160deg, #1e1e2e, #12121c);
    border: 1px solid #c9a94a; border-radius: 12px;
    padding: 0 0 20px; max-width: 320px; width: 100%;
    display: flex; flex-direction: column; align-items: stretch; gap: 0;
    box-shadow: 0 8px 32px rgba(0,0,0,.9);
}
.oficina-iteminfo-img  { width: 72px; height: 72px; object-fit: contain; filter: drop-shadow(0 2px 6px #000); }
.oficina-iteminfo-title { color: gold; font-size: .95em; margin: 0; }
.oficina-iteminfo-label { color: #c9a94a; font-size: .72em; text-transform: uppercase; letter-spacing: 1px; margin: 0; }
.oficina-iteminfo-text  { color: #e0dccc; font-size: .88em; margin: 0; line-height: 1.6; }
/* ═══════════════════════════════════════════════════════════════════
   OVERLAY DE RESULTADO
═══════════════════════════════════════════════════════════════════ */
#oficinaMsgOverlay {
    display: none; position: fixed; inset: 0; z-index: 4400;
    background: rgba(0,0,0,.75);
    align-items: center; justify-content: center; padding: 16px;
}
#oficinaMsgBox {
    background: linear-gradient(160deg, #1e1e2e, #12121c);
    border: 1px solid #c9a94a; border-radius: 14px; padding: 28px 24px 22px;
    max-width: 360px; width: 100%;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
    box-shadow: 0 8px 36px rgba(0,0,0,.9); font-family: 'Cinzel', serif;
    text-align: center; animation: popIn .25s ease-out;
}
#oficinaMsgText { color: #e0dccc; font-size: .95em; margin: 0; line-height: 1.6; }
#oficinaMsgOk {
    background: linear-gradient(135deg, #b8860b, #8b6914); color: #fff;
    border: 1px solid #c9a94a; border-radius: 8px; padding: 8px 32px;
    font-family: 'Cinzel', serif; font-size: .95em; cursor: pointer; transition: background .2s;
}
#oficinaMsgOk:hover { background: linear-gradient(135deg, #d4a017, #a07820); }
@keyframes popIn { from { transform: scale(.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
`;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    injectOficinaStyles();

    var openBtn = document.getElementById('btnOficina');
    if (openBtn) {
        openBtn.addEventListener('click', function() { openOficinaModal(); });
    }

    // Fechar o modal principal (injetado dinamicamente)
    document.body.addEventListener('click', function(e) {
        if (e.target.id === 'closeOficinaBtn') {
            var m = document.getElementById('oficinaModal');
            if (m) m.style.display = 'none';
            if (_countdownInterval) clearInterval(_countdownInterval);
        }
    });
});
