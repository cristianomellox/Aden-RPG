
import { supabase } from './supabaseClient.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DE ROTAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

const CITIES = ['capital', 'elendor', 'zion', 'mitrar', 'tandra', 'astrax', 'duratar'];
const CITY_LABELS = {
    capital: 'Capital', elendor: 'Elendor', zion: 'Zion',
    mitrar: 'Mitrar', tandra: 'Tandra', astrax: 'Astrax', duratar: 'Duratar'
};

const EPOCH = new Date('2025-01-01T00:00:00Z').getTime();
const SLOT_MS = 4 * 60 * 60 * 1000; // 4 horas

function getMerchantState() {
    const now = Date.now();
    const slot = Math.floor((now - EPOCH) / SLOT_MS);
    const cityIndex = slot % CITIES.length;
    const slotStart = EPOCH + slot * SLOT_MS;
    const nextSlot  = slotStart + SLOT_MS;
    return { slot, cityIndex, currentCity: CITIES[cityIndex], slotStart, nextSlot };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DE ITENS 56-84
// ─────────────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://aden-rpg.pages.dev/assets/itens/';

const TRADE_ITEMS = [
    { id: 56,  name: 'Pórfero',           img: 'porifero.webp'         },
    { id: 57,  name: 'Tecido Alfa',        img: 'tecido_alfa.webp'      },
    { id: 58,  name: 'Verniz',             img: 'verniz.webp'           },
    { id: 59,  name: 'Safira',             img: 'safira.webp'           },
    { id: 60,  name: 'Pétala Orium',       img: 'petala_orium.webp'     },
    { id: 61,  name: 'Lápis Lazúli',       img: 'lapis_luzuli.webp'     },
    { id: 62,  name: 'Essência de Anjo',   img: 'essencia_de_anjo.webp' },
    { id: 63,  name: 'Lubrificante',       img: 'lubrificante.webp'     },
    { id: 64,  name: 'Garra de Dragão',    img: 'garra_de_dragao.webp'  },
    { id: 65,  name: 'Reagente Ômega',     img: 'reagente_omega.webp'   },
    { id: 66,  name: 'Núcleo de Dragão',   img: 'nucleo_de_dragao.webp' },
    { id: 67,  name: 'Pele Animal',        img: 'pele_animal.webp'      },
    { id: 68,  name: 'Pena de Harpia',     img: 'pena_de_harpia.webp'   },
    { id: 69,  name: 'Lã',                 img: 'la.webp'               },
    { id: 70,  name: 'Sal de Cobalto',     img: 'sal_de_cobalto.webp'   },
    { id: 71,  name: 'Lágrima de Fênix',   img: 'lagrima_de_fenix.webp' },
    { id: 72,  name: 'Pedaço de Freixo',   img: 'pedaco_de_freixo.webp' },
    { id: 73,  name: 'Presa de Kelts',     img: 'presa_de_kelts.webp'   },
    { id: 74,  name: 'Galho Espiritual',   img: 'galho_espiritual.webp' },
    { id: 75,  name: 'Minério de Mithril', img: 'minerio_de_mithril.webp'},
    { id: 76,  name: 'Pó Ósseo',           img: 'po_osseo.webp'         },
    { id: 77,  name: 'Couro Animal',       img: 'couro_animal.webp'     },
    { id: 78,  name: 'Linha Mágica',       img: 'linha_magica.webp'     },
    { id: 79,  name: 'Mithril Temperado',  img: 'mithril_temperado.webp'},
    { id: 80,  name: 'Carvão',             img: 'carvao.webp'           },
    { id: 81,  name: 'Minério de Ferro',   img: 'minerio_de_ferro.webp' },
    { id: 82,  name: 'Fios de Fibra',      img: 'fios_de_fibra.webp'    },
    { id: 83,  name: 'Escama de Dragão',   img: 'escama_de_dragao.webp' },
    { id: 84,  name: 'Chifre de Unicórnio',img: 'chifre_de_unicornio.webp'},
];

// ─────────────────────────────────────────────────────────────────────────────
// PRNG SIMPLES (LCG) — determinístico por slot
// ─────────────────────────────────────────────────────────────────────────────
function createPrng(seed) {
    let s = seed;
    return function() {
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (s >>> 0) / 0xFFFFFFFF;
    };
}

/**
 * Gera 3 pares de troca únicos para o slot dado.
 * Cada par: { giveItem, getItem } onde giveItem != getItem
 * Retorna array de 3 objetos { give: itemObj, get: itemObj }
 */
function generateTradePairs(slot) {
    const rand = createPrng(slot);
    const pool = [...TRADE_ITEMS]; // 29 itens
    const pairs = [];
    const usedIds = new Set();

    while (pairs.length < 3) {
        // Escolhe give
        let gi;
        do { gi = Math.floor(rand() * pool.length); } while (usedIds.has(pool[gi].id));
        const give = pool[gi];
        usedIds.add(give.id);

        // Escolhe get (diferente de give)
        let ri;
        do { ri = Math.floor(rand() * pool.length); } while (pool[ri].id === give.id || usedIds.has(pool[ri].id));
        const get = pool[ri];
        usedIds.add(get.id);

        pairs.push({ give, get });
    }
    return pairs;
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEXEDDB — lê inventário do cache local
// ─────────────────────────────────────────────────────────────────────────────
const IDB_NAME    = 'aden_inventory_db';
const IDB_STORE   = 'inventory_store';
const IDB_VERSION = 47;

function openIdb() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onerror = () => rej(req.error);
        req.onsuccess = e => res(e.target.result);
        req.onupgradeneeded = () => {}; // não modifica o schema
    });
}

async function getItemQtyFromCache(itemId) {
    try {
        const db = await openIdb();
        if (!db.objectStoreNames.contains(IDB_STORE)) return 0;
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const all = await new Promise((res, rej) => {
            const r = store.getAll();
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        return all.filter(i => i.items?.item_id === itemId).reduce((s, i) => s + (i.quantity || 0), 0);
    } catch { return 0; }
}

async function getAllItemsQtyFromCache(ids) {
    try {
        const db = await openIdb();
        if (!db.objectStoreNames.contains(IDB_STORE)) return {};
        const tx = db.transaction(IDB_STORE, 'readonly');
        const all = await new Promise((res, rej) => {
            const r = tx.objectStore(IDB_STORE).getAll();
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        const result = {};
        const idSet = new Set(ids);
        for (const inv of all) {
            const id = inv.items?.item_id;
            if (idSet.has(id)) result[id] = (result[id] || 0) + (inv.quantity || 0);
        }
        return result;
    } catch { return {}; }
}

async function updateCacheQty(itemId, delta) {
    // delta negativo = consumir, positivo = adicionar
    try {
        const db = await openIdb();
        if (!db.objectStoreNames.contains(IDB_STORE)) return;
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const all = await new Promise((res, rej) => {
            const r = store.getAll();
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        const matching = all.filter(i => i.items?.item_id === itemId);
        if (matching.length === 0) return;

        let remaining = Math.abs(delta);
        if (delta < 0) {
            // consumir
            for (const item of matching) {
                if (remaining <= 0) break;
                if (item.quantity >= remaining) {
                    item.quantity -= remaining;
                    remaining = 0;
                    if (item.quantity <= 0) store.delete(item.id);
                    else store.put(item);
                } else {
                    remaining -= item.quantity;
                    store.delete(item.id);
                }
            }
        } else {
            // adicionar ao primeiro stack
            const item = matching[0];
            item.quantity = (item.quantity || 0) + delta;
            store.put(item);
        }
    } catch (e) { console.warn('mercador: cache update fail', e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMER COUNTDOWN
// ─────────────────────────────────────────────────────────────────────────────
let countdownInterval = null;

function startCountdown(nextSlot) {
    const el = document.getElementById('mercadorCountdown');
    if (!el) return;
    if (countdownInterval) clearInterval(countdownInterval);
    const tick = () => {
        const diff = nextSlot - Date.now();
        if (diff <= 0) { el.textContent = 'Partindo...'; clearInterval(countdownInterval); return; }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    };
    tick();
    countdownInterval = setInterval(tick, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATAR NÚMEROS
// ─────────────────────────────────────────────────────────────────────────────
const fmt = n => new Intl.NumberFormat('pt-BR').format(n);

// ─────────────────────────────────────────────────────────────────────────────
// MENSAGEM FLUTUANTE
// ─────────────────────────────────────────────────────────────────────────────
function showMsg(msg) {
    const el = document.getElementById('floatingMessage');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
        el.style.opacity = '1';
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.style.display = 'none', 500); }, 3500);
    } else { alert(msg); }
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO DO MODAL
// ─────────────────────────────────────────────────────────────────────────────
const MOEDA_ID = 55;
const PEDRA_ID = 20;
const MOEDA_IMG = 'https://aden-rpg.pages.dev/assets/itens/moeda_runica.webp';
const PEDRA_IMG = 'https://aden-rpg.pages.dev/assets/itens/pedra_de_refundicao.webp';
const CRYSTAL_IMG = 'https://aden-rpg.pages.dev/assets/cristais.webp';

// Quantidades em cache (atualizado ao abrir modal)
let cachedMoedaQty = 0;
let cachedTradeQtys = {}; // { itemId: qty }

// Quantidades UI das trocas
const tradeQtys = {}; // { pairIndex: qty }

async function openMercadorModal() {
    const state = getMerchantState();
    const thisCity = (window.MERCHANT_CITY || '').toLowerCase();
    const modal = document.getElementById('mercadorModal');
    if (!modal) return;

    modal.style.display = 'flex';

    // Fechar submenus
    const shopsSubmenu = document.getElementById('shopsSubmenu');
    const merchantsModal = document.getElementById('merchantsModal');
    if (shopsSubmenu) shopsSubmenu.style.display = 'none';
    if (merchantsModal) merchantsModal.style.display = 'none';

    const content = document.getElementById('mercadorContent');
    if (!content) return;

    if (state.currentCity !== thisCity) {
        // Mercador não está aqui
        const destLabel = CITY_LABELS[state.currentCity] || state.currentCity;
        const nextLabel = CITY_LABELS[CITIES[(state.cityIndex + 1) % CITIES.length]] || '';
        const diff = state.nextSlot - Date.now();
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        content.innerHTML = `
            <div class="mercador-absent">
                <img src="https://aden-rpg.pages.dev/assets/mercador.webp" class="mercador-absent-img" alt="Mercador">
                <p class="mercador-absent-text">Fui para a minha loja em <strong>${destLabel}</strong> e volto em breve.</p>
                <p class="mercador-absent-sub">Próxima parada: <strong>${nextLabel}</strong></p>
                <p class="mercador-absent-timer">Parte desta cidade em: <span id="mercadorCountdown">--:--:--</span></p>
            </div>`;
        startCountdown(state.nextSlot);
        return;
    }

    // Mercador está aqui — carrega cache
    content.innerHTML = `<div class="mercador-loading">Carregando ofertas...</div>`;
    startCountdown(state.nextSlot);

    const allIds = [MOEDA_ID, PEDRA_ID, ...TRADE_ITEMS.map(i => i.id)];
    const qtys = await getAllItemsQtyFromCache(allIds);
    cachedMoedaQty = qtys[MOEDA_ID] || 0;
    cachedTradeQtys = qtys;

    const pairs = generateTradePairs(state.slot);

    // Inicializar qtys UI
    for (let i = 0; i < pairs.length; i++) tradeQtys[i] = 1;

    content.innerHTML = `
        <!-- RECURSOS TOPO -->
        <div class="mercador-resources" id="mercadorResources">
            <span style="color:gold; font-weight:bold; width:100%; text-align:center; display:block; margin-bottom:4px;">Você tem:</span>
            <div class="mercador-res-item">
                <img src="${MOEDA_IMG}" class="mercador-res-icon" alt="Moeda Rúnica">
                <span id="mercadorMoedaQty">x${fmt(cachedMoedaQty)}</span>
            </div>
        </div>

        <!-- TIMER -->
        <p class="mercador-timer-text">Mercador parte em: <span id="mercadorCountdown" style="color:#ffcc44; font-weight:bold;">--:--:--</span></p>

        <!-- SEÇÃO VENDA -->
        <div class="mercador-section-title">⚙ Venda</div>
        <div class="mercador-section mercador-venda" id="mercadorVenda">
            ${renderVendaCard('pedra',    PEDRA_IMG,   'Pedra de Refundição', 3,  MOEDA_IMG, 'pedra')}
            ${renderVendaCard('crystals', CRYSTAL_IMG, 'Cristais',            50, MOEDA_IMG, 'crystals')}
        </div>

        <!-- SEÇÃO ESCAMBO -->
        <div class="mercador-section-title">🔄 Escambo</div>
        <div class="mercador-section mercador-escambo" id="mercadorEscambo">
            ${pairs.map((p, i) => renderEscamboCard(p, i)).join('')}
        </div>
    `;

    startCountdown(state.nextSlot);
    attachMercadorEvents(pairs);
}

function renderVendaCard(type, itemImg, itemLabel, receiveBaseQty, costImg, btnType) {
    // receiveBaseQty: 3 para pedra, 50 para crystals (por 1 moeda)
    return `
    <div class="mercador-card" id="venda-card-${type}">
        <div class="mercador-card-header">
            <div class="mercador-trade-icons">
                <div class="mercador-trade-side">
                    <img src="${itemImg}" class="mercador-item-icon" alt="${itemLabel}">
                    <span class="mercador-trade-qty" id="vreceive-qty-${type}">x${receiveBaseQty}</span>
                    <span class="mercador-item-name">${itemLabel.replace(/ x\d+$/, '')}</span>
                </div>
                <div class="mercador-arrow">⟵</div>
                <div class="mercador-trade-side">
                    <img src="${costImg}" class="mercador-item-icon" alt="Moeda Rúnica">
                    <span class="mercador-trade-qty">x1</span>
                    <span class="mercador-item-name">Moeda Rúnica</span>
                </div>
            </div>
        </div>
        <div class="mercador-controls">
            <div class="mercador-qty-row">
                <button class="pm-qty-btn minus" data-vtype="${btnType}">-</button>
                <span class="pm-qty-val" id="vqty-${type}">1</span>
                <button class="pm-qty-btn plus" data-vtype="${btnType}">+</button>
            </div>
            <div class="mercador-total">
                Custo: <span id="vtot-moeda-${type}">1</span> Moeda(s)
                → Recebe: <span id="vtot-receive-${type}">${receiveBaseQty}</span> ${itemLabel.replace(/ x\d+$/, '')}
            </div>
            <button class="pm-buy-btn" id="vbuy-${type}">Comprar</button>
        </div>
    </div>`;
}

function renderEscamboCard(pair, idx) {
    const giveImg = BASE_URL + pair.give.img;
    const getImg  = BASE_URL + pair.get.img;
    return `
    <div class="mercador-card" id="escambo-card-${idx}">
        <div class="mercador-card-header">
            <div class="mercador-trade-icons">
                <div class="mercador-trade-side">
                    <img src="${getImg}" class="mercador-item-icon" alt="${pair.get.name}">
                    <span class="mercador-trade-qty">x1</span>
                    <span class="mercador-item-name">${pair.get.name}</span>
                </div>
                <div class="mercador-arrow">⟵</div>
                <div class="mercador-trade-side">
                    <img src="${giveImg}" class="mercador-item-icon" alt="${pair.give.name}">
                    <span class="mercador-trade-qty give-qty-label" id="give-qty-label-${idx}">x2</span>
                    <span class="mercador-item-name">${pair.give.name}</span>
                </div>
            </div>
            <div class="mercador-have">
                Você tem: <span id="give-have-${idx}">${fmt(cachedTradeQtys[pair.give.id] || 0)}</span> ${pair.give.name}
            </div>
        </div>
        <div class="mercador-controls">
            <div class="mercador-qty-row">
                <button class="pm-qty-btn minus" data-eidx="${idx}">-</button>
                <span class="pm-qty-val" id="eqty-${idx}">1</span>
                <button class="pm-qty-btn plus" data-eidx="${idx}">+</button>
            </div>
            <div class="mercador-total">Custo: <span id="etot-${idx}">2</span> ${pair.give.name} → <span id="eget-${idx}">1</span> ${pair.get.name}</div>
            <button class="pm-buy-btn" id="ebuy-${idx}" data-eidx="${idx}">Trocar</button>
        </div>
    </div>`;
}

function attachMercadorEvents(pairs) {
    // Venda: qty selectors
    // receiveBaseQty per type
    const vendaReceiveBase = { pedra: 3, crystals: 50 };
    for (const type of ['pedra', 'crystals']) {
        const base = vendaReceiveBase[type];
        const getQtyEl = () => document.getElementById(`vqty-${type}`);
        document.querySelector(`.pm-qty-btn.plus[data-vtype="${type}"]`)?.addEventListener('click', () => {
            const cur = parseInt(getQtyEl()?.textContent || 1);
            const nv = Math.min(cur + 1, 99);
            if (getQtyEl()) getQtyEl().textContent = nv;
            const moedaEl = document.getElementById(`vtot-moeda-${type}`);
            const receiveEl = document.getElementById(`vtot-receive-${type}`);
            const receiveQtyLabel = document.getElementById(`vreceive-qty-${type}`);
            if (moedaEl) moedaEl.textContent = nv;
            if (receiveEl) receiveEl.textContent = nv * base;
            if (receiveQtyLabel) receiveQtyLabel.textContent = `x${nv * base}`;
        });
        document.querySelector(`.pm-qty-btn.minus[data-vtype="${type}"]`)?.addEventListener('click', () => {
            const cur = parseInt(getQtyEl()?.textContent || 1);
            const nv = Math.max(cur - 1, 1);
            if (getQtyEl()) getQtyEl().textContent = nv;
            const moedaEl = document.getElementById(`vtot-moeda-${type}`);
            const receiveEl = document.getElementById(`vtot-receive-${type}`);
            const receiveQtyLabel = document.getElementById(`vreceive-qty-${type}`);
            if (moedaEl) moedaEl.textContent = nv;
            if (receiveEl) receiveEl.textContent = nv * base;
            if (receiveQtyLabel) receiveQtyLabel.textContent = `x${nv * base}`;
        });
        document.getElementById(`vbuy-${type}`)?.addEventListener('click', () => {
            const qty = parseInt(document.getElementById(`vqty-${type}`)?.textContent || 1);
            buyVendaItem(type, qty);
        });
    }

    // Escambo: qty selectors
    for (let i = 0; i < pairs.length; i++) {
        const idx = i;
        document.querySelector(`.pm-qty-btn.plus[data-eidx="${idx}"]`)?.addEventListener('click', () => updateEscamboQty(idx, 1, pairs));
        document.querySelector(`.pm-qty-btn.minus[data-eidx="${idx}"]`)?.addEventListener('click', () => updateEscamboQty(idx, -1, pairs));
        document.getElementById(`ebuy-${idx}`)?.addEventListener('click', () => {
            const qty = parseInt(document.getElementById(`eqty-${idx}`)?.textContent || 1);
            doEscambo(pairs[idx], idx, qty);
        });
    }
}

function updateEscamboQty(idx, delta, pairs) {
    const el = document.getElementById(`eqty-${idx}`);
    if (!el) return;
    const cur = parseInt(el.textContent || 1);
    const nv = Math.max(1, Math.min(cur + delta, 99));
    el.textContent = nv;
    document.getElementById(`etot-${idx}`).textContent = nv * 2; // custa 2x
    document.getElementById(`eget-${idx}`).textContent = nv;
    document.getElementById(`give-qty-label-${idx}`).textContent = `x${nv * 2}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSAÇÕES
// ─────────────────────────────────────────────────────────────────────────────

async function buyVendaItem(type, quantity) {
    const btn = document.getElementById(`vbuy-${type}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Comprando...'; }

    const totalCost = quantity; // 1 moeda por unidade de compra
    if (cachedMoedaQty < totalCost) {
        showMsg('Moedas Rúnicas insuficientes!');
        if (btn) { btn.disabled = false; btn.textContent = 'Comprar'; }
        return;
    }

    try {
        const { data, error } = await supabase.rpc('merchant_sell', {
            p_type: type,
            p_quantity: quantity
        });
        if (error) throw error;
        if (!data.success) throw new Error(data.message);

        cachedMoedaQty -= totalCost;
        const moedaEl = document.getElementById('mercadorMoedaQty');
        if (moedaEl) moedaEl.textContent = `x${fmt(cachedMoedaQty)}`;
        await updateCacheQty(MOEDA_ID, -totalCost);

        if (type === 'pedra') {
            await updateCacheQty(PEDRA_ID, quantity * 3);
            showMsg(`Você recebeu ${quantity * 3}x Pedra de Refundição!`);
        } else {
            // Atualizar crystals no cache do player
            try {
                const cStr = localStorage.getItem('player_data_cache');
                if (cStr) {
                    const c = JSON.parse(cStr);
                    if (c.data) { c.data.crystals = data.new_crystals; localStorage.setItem('player_data_cache', JSON.stringify(c)); }
                }
            } catch {}
            const cryEl = document.getElementById('playerCrystals');
            if (cryEl && data.new_crystals != null) cryEl.innerHTML = `<img src="${CRYSTAL_IMG}" style="width:17px;height:17px;vertical-align:-4px;"> ${fmt(data.new_crystals)}`;
            showMsg(`Você recebeu ${quantity * 50} Cristais!`);
        }
    } catch (err) {
        showMsg(`Erro: ${err.message || 'Falha na compra.'}`);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Comprar'; }
    }
}

async function doEscambo(pair, idx, tradeQty) {
    const btn = document.getElementById(`ebuy-${idx}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Trocando...'; }

    const giveTotal = tradeQty * 2;
    const haveQty = cachedTradeQtys[pair.give.id] || 0;

    if (haveQty < giveTotal) {
        showMsg(`${pair.give.name} insuficiente! Você tem ${haveQty}, precisa de ${giveTotal}.`);
        if (btn) { btn.disabled = false; btn.textContent = 'Trocar'; }
        return;
    }

    try {
        const { data, error } = await supabase.rpc('merchant_trade', {
            p_give_id: pair.give.id,
            p_get_id:  pair.get.id,
            p_trade_qty: tradeQty
        });
        if (error) throw error;
        if (!data.success) throw new Error(data.message);

        // Atualizar cache local
        cachedTradeQtys[pair.give.id] = Math.max(0, (cachedTradeQtys[pair.give.id] || 0) - giveTotal);
        cachedTradeQtys[pair.get.id]  = (cachedTradeQtys[pair.get.id] || 0) + tradeQty;

        await updateCacheQty(pair.give.id, -giveTotal);
        await updateCacheQty(pair.get.id, tradeQty);

        const haveEl = document.getElementById(`give-have-${idx}`);
        if (haveEl) haveEl.textContent = fmt(cachedTradeQtys[pair.give.id]);

        showMsg(`Troca realizada! Você recebeu ${tradeQty}x ${pair.get.name}.`);
    } catch (err) {
        showMsg(`Erro: ${err.message || 'Falha na troca.'}`);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Trocar'; }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS INJETADO DINAMICAMENTE
// ─────────────────────────────────────────────────────────────────────────────
function injectStyles() {
    if (document.getElementById('mercadorStyles')) return;
    const style = document.createElement('style');
    style.id = 'mercadorStyles';
    style.textContent = `
/* ─── MODAL MERCADOR ─── */
#mercadorModal {
    background-image: linear-gradient(rgba(0,0,30,.25), rgba(0,0,0,0)),
        url('https://aden-rpg.pages.dev/assets/mercador.webp');
    background-size: cover;
    background-position: center top;
    background-repeat: no-repeat;
    align-items: flex-start;
    padding-top: 0;
}
#mercadorModalContent {
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100vh !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow-y: auto;
    padding: 20px 10px 80px;
}
#mercadorContent {
    width: 100%;
    max-width: 680px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    opacity: 0;
    animation: fadeCardIn 4s ease-out forwards;
}
/* ─── AUSENTE ─── */
.mercador-absent {
    display: flex; flex-direction: column; align-items: center;
    gap: 16px; padding: 40px 20px; text-align: center;
    background: rgba(0,0,0,.65); border: 1px solid #c9a94a;
    border-radius: 12px; max-width: 460px; margin: auto;
    opacity: 0; animation: fadeCardIn 3s ease-out forwards;
}
.mercador-absent-img { width: 90px; height: 90px; border-radius: 50%; object-fit: cover; border: 2px solid #c9a94a; }
.mercador-absent-text { color: #e0dccc; font-size: 1.05em; margin: 0; }
.mercador-absent-sub  { color: #aaa; font-size: .9em; margin: 0; }
.mercador-absent-timer{ color: #ddd; font-size: .9em; margin: 0; }
/* ─── RECURSOS ─── */
.mercador-resources {
    display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
    gap: 12px; width: 90%; max-width: 600px;
    background: rgba(0,0,0,.55); border: 1px solid #c9a94a;
    border-radius: 8px; padding: 8px 12px; color: #e0dccc;
}
.mercador-res-item { display: flex; align-items: center; gap: 6px; }
.mercador-res-icon { width: 24px; height: 24px; object-fit: contain; }
.mercador-timer-text { color: #ccc; font-size: .85em; margin: 0; }
/* ─── SECTION TITLE ─── */
.mercador-section-title {
    color: gold; font-size: 1.1em; text-shadow: 1px 1px 3px #000;
    width: 90%; max-width: 600px;
    border-bottom: 1px solid #c9a94a55; padding-bottom: 4px; margin-top: 4px;
}
/* ─── SECTION ─── */
.mercador-section {
    display: flex; flex-direction: column; gap: 12px;
    width: 90%; max-width: 600px;
}
/* ─── CARD ─── */
.mercador-card {
    background: linear-gradient(180deg, #2a2a2abf, #1a1a1abf);
    border: 1px solid #c9a94a; border-radius: 10px;
    padding: 12px; display: flex; flex-direction: column; gap: 10px;
    opacity: 0; animation: fadeCardIn 6s ease-out forwards;
}
.mercador-card-header { display: flex; flex-direction: column; gap: 6px; }
.mercador-item-icon { width: 44px; height: 44px; object-fit: contain; filter: drop-shadow(1px 1px 2px #000); }
.mercador-card-info { display: flex; flex-direction: column; gap: 4px; }
.mercador-item-name { color: #e0dccc; font-size: .9em; }
.mercador-cost-row { display: flex; align-items: center; gap: 4px; color: #ccc; font-size: .85em; }
.mercador-cost-icon { width: 18px; height: 18px; }
/* ─── TRADE ─── */
.mercador-trade-icons { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; }
.mercador-trade-side {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    flex: 1; min-width: 0; /* permite shrink */
}
.mercador-trade-side .mercador-item-name {
    width: 100%; text-align: center;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mercador-trade-qty { color: gold; font-size: .9em; font-weight: bold; }
.mercador-arrow { color: #c9a94a; font-size: 1.3em; flex-shrink: 0; }
.mercador-have { color: #aaa; font-size: .8em; margin-top: 2px; text-align: center;
    width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ─── CONTROLS ─── */
.mercador-controls { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.mercador-qty-row { display: flex; align-items: center; gap: 10px; }
.mercador-total { color: #ccc; font-size: .82em; text-align: center; }
.mercador-loading { color: #aaa; padding: 40px; text-align: center; }
/* Garante que nomes fora do trade-side também truncam */
.mercador-card-info .mercador-item-name {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px;
}
`;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    injectStyles();

    const openBtn  = document.getElementById('btnMercador');
    const modal    = document.getElementById('mercadorModal');
    const closeBtn = document.getElementById('closeMercadorBtn');

    if (openBtn && modal) {
        openBtn.addEventListener('click', () => openMercadorModal());
    }
    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            if (countdownInterval) clearInterval(countdownInterval);
        });
    }
});
