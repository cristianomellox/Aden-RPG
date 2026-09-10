
import { supabase } from './supabaseClient.js';
import * as THREE from 'three';
import { initPostFX } from './postfx.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DE ROTAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

const CITIES = ['capital', 'elendor', 'zion', 'mitrar', 'tandra', 'astrax', 'duratar'];
const CITY_LABELS = {
    capital: 'Capital', elendor: 'Elendor', zion: 'Zion',
    mitrar: 'Mitrar', tandra: 'Tandra', astrax: 'Astrax', duratar: 'Duratar'
};

const EPOCH = new Date('2025-01-01T00:00:00Z').getTime();
const SLOT_MS = 24 * 60 * 60 * 1000; // 4 horas

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
    { id: 61,  name: 'Lápis-lazúli',       img: 'lapis_lazuli.webp'     },
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
    { id: 86,  name: 'Asa de Morcego',     img: 'asa_de_morcego.webp'    },
    { id: 87,  name: 'Emblema Vampírico',  img: 'emblema_vampirico.webp' },
    { id: 88,  name: 'Quitina',            img: 'quitina.webp'           },
    { id: 89,  name: 'Pedra Âmbar',        img: 'pedra_ambar.webp'       },
    { id: 90,  name: 'Lodo Mágico',        img: 'lodo_magico.webp'       },
    { id: 91,  name: 'Núcleo de Vinha',    img: 'nucleo_de_vinha.webp'   },
    { id: 92,  name: 'Totem Reptiliano',   img: 'totem_reptiliano.webp'  },
];

// PRNG e generateTradePairs removidos — escambo agora exibe todos os itens permanentemente.

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
// MODAL DE NOTIFICAÇÃO (substitui alert/floatingMessage)
// ─────────────────────────────────────────────────────────────────────────────
function ensureMsgModal() {
    if (document.getElementById('mercadorMsgModal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mercadorMsgModal';
    wrap.innerHTML = `
        <div id="mercadorMsgBox">
            <p id="mercadorMsgText"></p>
            <button id="mercadorMsgOk">OK</button>
        </div>`;
    document.body.appendChild(wrap);
    document.getElementById('mercadorMsgOk').addEventListener('click', () => {
        wrap.style.display = 'none';
    });
}

function showMsg(msg) {
    ensureMsgModal();
    document.getElementById('mercadorMsgText').textContent = msg;
    document.getElementById('mercadorMsgModal').style.display = 'flex';
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO DO MODAL
// ─────────────────────────────────────────────────────────────────────────────
const MOEDA_ID = 55;
const PEDRA_ID = 20;
const ESCUDO_ID = 85;
const AMPULHETA_ID = 99;
const MOEDA_IMG = 'https://aden-rpg.pages.dev/assets/itens/moeda_runica.webp';
const PEDRA_IMG = 'https://aden-rpg.pages.dev/assets/itens/pedra_de_refundicao.webp';
const CRYSTAL_IMG = 'https://aden-rpg.pages.dev/assets/cristais.webp';
const ESCUDO_IMG = 'https://aden-rpg.pages.dev/assets/itens/escudo_de_caca.webp';
const AMPULHETA_IMG = 'https://aden-rpg.pages.dev/assets/itens/ampulheta_de_caca.webp';
const RECEITA_FOICE_ID = 100;
const RECEITA_FOICE_IMG = 'https://aden-rpg.pages.dev/assets/itens/receita_de_fragmentos_de_foice_da_noite_eterna_60.webp';
const RECEITA_ARMADURA_ID = 104;
const RECEITA_ARMADURA_IMG = 'https://aden-rpg.pages.dev/assets/itens/receita_de_fragmentos_de_armadura_da_noite_eterna_60.webp';
const RECEITA_COLAR_ID = 112;
const RECEITA_COLAR_IMG = 'https://aden-rpg.pages.dev/assets/itens/receita_de_fragmentos_de_colar_da_noite_eterna_60.webp';
const RECEITA_ANEL_ID = 108;
const RECEITA_ANEL_IMG = 'https://aden-rpg.pages.dev/assets/itens/receita_de_fragmentos_de_anel_da_noite_eterna_60.webp';
const RECEITA_ASA_ID = 120;
const RECEITA_ASA_IMG = 'https://aden-rpg.pages.dev/assets/itens/receita_de_fragmentos_de_asa_da_noite_eterna_60.webp';
const RECEITA_ELMO_ID = 116;
const RECEITA_ELMO_IMG = 'https://aden-rpg.pages.dev/assets/itens/receita_de_fragmentos_de_elmo_da_noite_eterna_60.webp';
const GOLD_IMG = 'https://aden-rpg.pages.dev/assets/goldcoin.webp';

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
                <img src="${MC_NPC_IMAGE_URL}" class="mercador-absent-img" alt="Mercador">
                <p class="mercador-absent-text">Fui para a minha loja em <strong>${destLabel}</strong> e volto em breve.</p>
                <p class="mercador-absent-sub">Próxima parada: <strong>${nextLabel}</strong></p>
                <p class="mercador-absent-timer">Parte desta cidade em:<br> <span style="text-shadow: none;
  background: linear-gradient(to bottom, lightblue 0%, white 50%, blue 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent; font-size: 2em; font-weight: bold;" id="mercadorCountdown">--:--:--</span></p>
            </div>`;
        startCountdown(state.nextSlot);
        return;
    }

    // Mercador está aqui — carrega cache
    content.innerHTML = `<div class="mercador-loading">Carregando ofertas...</div>`;
    startCountdown(state.nextSlot);

    const allIds = [MOEDA_ID, PEDRA_ID, AMPULHETA_ID, RECEITA_FOICE_ID, RECEITA_ARMADURA_ID, RECEITA_COLAR_ID, RECEITA_ANEL_ID, RECEITA_ASA_ID, RECEITA_ELMO_ID, ...TRADE_ITEMS.map(i => i.id)];
    const qtys = await getAllItemsQtyFromCache(allIds);
    cachedMoedaQty = qtys[MOEDA_ID] || 0;
    cachedTradeQtys = qtys;

    // Inicializar qtys UI para todos os itens de escambo
    for (let i = 0; i < TRADE_ITEMS.length; i++) tradeQtys[i] = 1;

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
        <p class="mercador-timer-text">Mercador parte em:<br> <span id="mercadorCountdown" style="text-shadow: none;
  background: linear-gradient(to bottom, lightblue 0%, white 50%, blue 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent; font-size: 2em; font-weight:bold;">--:--:--</span></p>

        <!-- SEÇÃO VENDA -->
        <div class="mercador-section-title">⚙ Venda</div>
        <div class="mercador-section mercador-venda" id="mercadorVenda">
            ${renderVendaCard('pedra',         PEDRA_IMG,        'Pedra de Refundição',                        1,  MOEDA_IMG, 'pedra')}
            ${renderVendaCard('crystals',      CRYSTAL_IMG,      'Cristais',                                   50, MOEDA_IMG, 'crystals')}
            ${renderVendaCard('escudo',        ESCUDO_IMG,       'Escudo de Caça',                             1,  MOEDA_IMG, 'escudo',        100)}
            ${renderVendaCard('ampulheta',     AMPULHETA_IMG,    'Ampulheta de Caça',                          1,  MOEDA_IMG, 'ampulheta',     100)}
            ${renderVendaCard('receita_foice',    RECEITA_FOICE_IMG,    'Receita Fragmentos Foice da Noite Eterna (60%)',    1, MOEDA_IMG, 'receita_foice',    500)}
            ${renderVendaCard('receita_armadura', RECEITA_ARMADURA_IMG, 'Receita Fragmentos Armadura da Noite Eterna (60%)', 1, MOEDA_IMG, 'receita_armadura', 500)}
            ${renderVendaCard('receita_colar',    RECEITA_COLAR_IMG,    'Receita Fragmentos Colar da Noite Eterna (60%)',    1, MOEDA_IMG, 'receita_colar',    500)}
            ${renderVendaCard('receita_anel',     RECEITA_ANEL_IMG,     'Receita Fragmentos Anel da Noite Eterna (60%)',     1, MOEDA_IMG, 'receita_anel',     500)}
            ${renderVendaCard('receita_asa',      RECEITA_ASA_IMG,      'Receita Fragmentos Asa da Noite Eterna (60%)',      1, MOEDA_IMG, 'receita_asa',      500)}
            ${renderVendaCard('receita_elmo',     RECEITA_ELMO_IMG,     'Receita Fragmentos Elmo da Noite Eterna (60%)',     1, MOEDA_IMG, 'receita_elmo',     500)}
        </div>

        <!-- SEÇÃO ESCAMBO -->
        <div class="mercador-section-title">🔄 Escambo</div>
        <div class="mercador-section mercador-escambo" id="mercadorEscambo">
            ${TRADE_ITEMS.map((item, i) => renderEscamboCard(item, i)).join('')}
        </div>
    `;

    startCountdown(state.nextSlot);
    attachMercadorEvents();
}

function renderVendaCard(type, itemImg, itemLabel, receiveBaseQty, costImg, btnType, costPerPack = 1) {
    // receiveBaseQty: 3 para pedra, 50 para crystals, 1 para escudo (por pacote)
    // costPerPack: moedas gastas por pacote (1 para pedra/crystals, 150 para escudo)
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
                    <span class="mercador-trade-qty" id="vcost-qty-${type}">x${costPerPack}</span>
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
                Custo: <span id="vtot-moeda-${type}">${costPerPack}</span> Moeda(s)
                → Recebe: <span id="vtot-receive-${type}">${receiveBaseQty}</span> ${itemLabel.replace(/ x\d+$/, '')}
            </div>
            <button class="pm-buy-btn" id="vbuy-${type}">Comprar</button>
        </div>
    </div>`;
}

function renderEscamboCard(item, idx) {
    const giveImg = BASE_URL + item.img;
    return `
    <div class="mercador-card" id="escambo-card-${idx}">
        <div class="mercador-card-header">
            <div class="mercador-trade-icons">
                <div class="mercador-trade-side">
                    <img src="${MOEDA_IMG}" class="mercador-item-icon" alt="Moeda Rúnica">
                    <span class="mercador-trade-qty" id="get-qty-label-${idx}">x1</span>
                    <span class="mercador-item-name">Moeda Rúnica</span>
                </div>
                <div class="mercador-arrow">⟵</div>
                <div class="mercador-trade-side">
                    <img src="${giveImg}" class="mercador-item-icon" alt="${item.name}">
                    <span class="mercador-trade-qty give-qty-label" id="give-qty-label-${idx}">x1</span>
                    <span class="mercador-item-name">${item.name}</span>
                </div>
            </div>
            <div class="mercador-have">
                Você tem: <span id="give-have-${idx}">${fmt(cachedTradeQtys[item.id] || 0)}</span> ${item.name}
            </div>
        </div>
        <div class="mercador-controls">
            <div class="mercador-qty-row">
                <button class="pm-qty-btn minus" data-eidx="${idx}">-</button>
                <span class="pm-qty-val" id="eqty-${idx}">1</span>
                <button class="pm-qty-btn plus" data-eidx="${idx}">+</button>
            </div>
            <div class="mercador-total">Custo: <span id="etot-${idx}">1</span> ${item.name} → <span id="eget-${idx}">1</span> Moeda(s) Rúnica(s)</div>
            <button class="pm-buy-btn" id="ebuy-${idx}" data-eidx="${idx}">Trocar</button>
        </div>
    </div>`;
}

function attachMercadorEvents() {
    // Venda: qty selectors
    // receiveBaseQty per type
    const vendaReceiveBase = { pedra: 1, crystals: 50, escudo: 1, ampulheta: 1, receita_foice: 1, receita_armadura: 1, receita_colar: 1, receita_anel: 1, receita_asa: 1, receita_elmo: 1 };
    const vendaCostBase    = { pedra: 1, crystals:  1, escudo: 100, ampulheta: 100, receita_foice: 500, receita_armadura: 500, receita_colar: 500, receita_anel: 500, receita_asa: 500, receita_elmo: 500 };
    for (const type of ['pedra', 'crystals', 'escudo', 'ampulheta', 'receita_foice', 'receita_armadura', 'receita_colar', 'receita_anel', 'receita_asa', 'receita_elmo']) {
        const base = vendaReceiveBase[type];
        const cost = vendaCostBase[type];
        const getQtyEl = () => document.getElementById(`vqty-${type}`);
        document.querySelector(`.pm-qty-btn.plus[data-vtype="${type}"]`)?.addEventListener('click', () => {
            const cur = parseInt(getQtyEl()?.textContent || 1);
            const nv = Math.min(cur + 1, 99);
            if (getQtyEl()) getQtyEl().textContent = nv;
            const moedaEl = document.getElementById(`vtot-moeda-${type}`);
            const receiveEl = document.getElementById(`vtot-receive-${type}`);
            const receiveQtyLabel = document.getElementById(`vreceive-qty-${type}`);
            const costQtyLabel = document.getElementById(`vcost-qty-${type}`);
            if (moedaEl) moedaEl.textContent = nv * cost;
            if (receiveEl) receiveEl.textContent = nv * base;
            if (receiveQtyLabel) receiveQtyLabel.textContent = `x${nv * base}`;
            if (costQtyLabel) costQtyLabel.textContent = `x${nv * cost}`;
        });
        document.querySelector(`.pm-qty-btn.minus[data-vtype="${type}"]`)?.addEventListener('click', () => {
            const cur = parseInt(getQtyEl()?.textContent || 1);
            const nv = Math.max(cur - 1, 1);
            if (getQtyEl()) getQtyEl().textContent = nv;
            const moedaEl = document.getElementById(`vtot-moeda-${type}`);
            const receiveEl = document.getElementById(`vtot-receive-${type}`);
            const receiveQtyLabel = document.getElementById(`vreceive-qty-${type}`);
            const costQtyLabel = document.getElementById(`vcost-qty-${type}`);
            if (moedaEl) moedaEl.textContent = nv * cost;
            if (receiveEl) receiveEl.textContent = nv * base;
            if (receiveQtyLabel) receiveQtyLabel.textContent = `x${nv * base}`;
            if (costQtyLabel) costQtyLabel.textContent = `x${nv * cost}`;
        });
        document.getElementById(`vbuy-${type}`)?.addEventListener('click', () => {
            const qty = parseInt(document.getElementById(`vqty-${type}`)?.textContent || 1);
            buyVendaItem(type, qty);
        });
    }

    // Escambo: qty selectors para todos os TRADE_ITEMS
    for (let i = 0; i < TRADE_ITEMS.length; i++) {
        const idx = i;
        document.querySelector(`.pm-qty-btn.plus[data-eidx="${idx}"]`)?.addEventListener('click', () => updateEscamboQty(idx));
        document.querySelector(`.pm-qty-btn.minus[data-eidx="${idx}"]`)?.addEventListener('click', () => updateEscamboQty(idx, -1));
        document.getElementById(`ebuy-${idx}`)?.addEventListener('click', () => {
            const qty = parseInt(document.getElementById(`eqty-${idx}`)?.textContent || 1);
            doEscambo(TRADE_ITEMS[idx], idx, qty);
        });
    }
}

function updateEscamboQty(idx, delta = 1) {
    const el = document.getElementById(`eqty-${idx}`);
    if (!el) return;
    const cur = parseInt(el.textContent || 1);
    const nv = Math.max(1, Math.min(cur + delta, 99));
    el.textContent = nv;
    // labels do ícone — ambos os lados são 1:1
    const giveQtyLabel = document.getElementById(`give-qty-label-${idx}`);
    if (giveQtyLabel) giveQtyLabel.textContent = `x${nv}`;
    const getQtyLabel = document.getElementById(`get-qty-label-${idx}`);
    if (getQtyLabel) getQtyLabel.textContent = `x${nv}`;
    // texto resumo embaixo
    const totEl = document.getElementById(`etot-${idx}`);
    const getEl = document.getElementById(`eget-${idx}`);
    if (totEl) totEl.textContent = nv;
    if (getEl) getEl.textContent = nv;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSAÇÕES
// ─────────────────────────────────────────────────────────────────────────────

async function buyVendaItem(type, quantity) {
    const btn = document.getElementById(`vbuy-${type}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Comprando...'; }

    const vendaCostBase = { pedra: 1, crystals: 1, escudo: 100, ampulheta: 100, receita_foice: 500, receita_armadura: 500, receita_colar: 500, receita_anel: 500, receita_asa: 500, receita_elmo: 500 };
    const costPerPack   = vendaCostBase[type] ?? 1;
    const totalCost     = quantity * costPerPack;

    // Só bloqueia localmente se cache tem valor > 0 e é insuficiente.
    // Se cache = 0 pode ser miss — deixa o RPC validar no servidor.
    if (cachedMoedaQty > 0 && cachedMoedaQty < totalCost) {
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

        // Sincroniza moedas: usa valor retornado pelo servidor se disponível, senão desconta local
        const newMoedaQty = (data.new_moeda_qty != null)
            ? data.new_moeda_qty
            : Math.max(0, cachedMoedaQty - totalCost);
        cachedMoedaQty = newMoedaQty;

        const moedaEl = document.getElementById('mercadorMoedaQty');
        if (moedaEl) moedaEl.textContent = `x${fmt(cachedMoedaQty)}`;

        // Atualiza cache IDB com o delta correto
        await updateCacheQty(MOEDA_ID, -totalCost);

        if (type === 'pedra') {
            await updateCacheQty(PEDRA_ID, quantity * 1);
            showMsg(`Você recebeu ${quantity * 1}x Pedra de Refundição!`);
        } else if (type === 'escudo') {
            await updateCacheQty(ESCUDO_ID, quantity);
            showMsg(`Você recebeu ${quantity}x Escudo de Caça!`);
        } else if (type === 'ampulheta') {
            await updateCacheQty(AMPULHETA_ID, quantity);
            showMsg(`Você recebeu ${quantity}x Ampulheta de Caça!`);
        } else if (type === 'receita_foice') {
            await updateCacheQty(RECEITA_FOICE_ID, quantity);
            showMsg(`Você recebeu ${quantity}x Receita Fragmentos Foice da Noite Eterna (60%)!`);
        } else if (type === 'receita_armadura') {
            await updateCacheQty(RECEITA_ARMADURA_ID, quantity);
            showMsg(`Você recebeu ${quantity}x Receita Fragmentos Armadura da Noite Eterna (60%)!`);
        } else if (type === 'receita_colar') {
            await updateCacheQty(RECEITA_COLAR_ID, quantity);
            showMsg(`Você recebeu ${quantity}x Receita Fragmentos Colar da Noite Eterna (60%)!`);
        } else if (type === 'receita_anel') {
            await updateCacheQty(RECEITA_ANEL_ID, quantity);
            showMsg(`Você recebeu ${quantity}x Receita Fragmentos Anel da Noite Eterna (60%)!`);
        } else if (type === 'receita_asa') {
            await updateCacheQty(RECEITA_ASA_ID, quantity);
            showMsg(`Você recebeu ${quantity}x Receita Fragmentos Asa da Noite Eterna (60%)!`);
        } else if (type === 'receita_elmo') {
            await updateCacheQty(RECEITA_ELMO_ID, quantity);
            showMsg(`Você recebeu ${quantity}x Receita Fragmentos Elmo da Noite Eterna (60%)!`);
        } else {
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

async function doEscambo(item, idx, tradeQty) {
    const btn = document.getElementById(`ebuy-${idx}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Trocando...'; }

    const giveTotal = tradeQty; // 1:1
    const haveQty = cachedTradeQtys[item.id] || 0;

    // Só bloqueia localmente se cache > 0 e insuficiente. Cache=0 pode ser miss.
    if (haveQty > 0 && haveQty < giveTotal) {
        showMsg(`${item.name} insuficiente! Você tem ${haveQty}, precisa de ${giveTotal}.`);
        if (btn) { btn.disabled = false; btn.textContent = 'Trocar'; }
        return;
    }

    try {
        const { data, error } = await supabase.rpc('merchant_trade', {
            p_give_id:   item.id,
            p_trade_qty: tradeQty
        });
        if (error) throw error;
        if (!data.success) throw new Error(data.message);

        // Sincroniza cache do item entregue
        const newGiveQty = (data.new_give_qty != null)
            ? data.new_give_qty
            : Math.max(0, (cachedTradeQtys[item.id] || 0) - giveTotal);

        cachedTradeQtys[item.id] = newGiveQty;
        await updateCacheQty(item.id, -giveTotal);

        const haveEl = document.getElementById(`give-have-${idx}`);
        if (haveEl) haveEl.textContent = fmt(newGiveQty);

        // Atualiza Moedas Rúnicas
        const newMoedaQty = (data.new_moeda_qty != null)
            ? data.new_moeda_qty
            : cachedMoedaQty + tradeQty;
        cachedMoedaQty = newMoedaQty;
        await updateCacheQty(MOEDA_ID, tradeQty);

        const moedaEl = document.getElementById('mercadorMoedaQty');
        if (moedaEl) moedaEl.textContent = `x${fmt(cachedMoedaQty)}`;

        showMsg(`Troca realizada! Você recebeu ${tradeQty} Moeda(s) Rúnica(s).`);
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
        url('https://aden-rpg.pages.dev/assets/mercador.png');
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
.mercador-absent-img { width: 90px; height: 90px; border-radius: 50%; object-fit: contain; border: 2px solid #c9a94a; }
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
    background: linear-gradient(180deg, #2a2a2a, #1a1a1aA6);
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
/* ─── MODAL DE NOTIFICAÇÃO ─── */
#mercadorMsgModal {
    display: none;
    position: fixed; inset: 0;
    z-index: 9999;
    background: rgba(0,0,0,.65);
    align-items: center; justify-content: center;
}
#mercadorMsgBox {
    background: linear-gradient(160deg, #1e1e2e, #12121c);
    border: 1px solid #c9a94a;
    border-radius: 12px;
    padding: 28px 24px 20px;
    max-width: 340px; width: 88%;
    display: flex; flex-direction: column; align-items: center; gap: 18px;
    box-shadow: 0 8px 32px rgba(0,0,0,.8);
    font-family: 'Cinzel', serif;
}
#mercadorMsgText {
    color: #e0dccc;
    font-size: 1em;
    text-align: center;
    margin: 0;
    line-height: 1.5;
    text-shadow: 1px 1px 3px #000;
}
#mercadorMsgOk {
    background: linear-gradient(135deg, #b8860b, #8b6914);
    color: #fff;
    border: 1px solid #c9a94a;
    border-radius: 8px;
    padding: 8px 32px;
    font-family: 'Cinzel', serif;
    font-size: .95em;
    cursor: pointer;
    transition: background .2s;
}
#mercadorMsgOk:hover { background: linear-gradient(135deg, #d4a017, #a07820); }
`;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT: lê moedas rúnicas do IndexedDB e atualiza todos os displays da página
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê a quantidade de Moedas Rúnicas (item 55) do IndexedDB e:
 * 1. Atualiza a variável cachedMoedaQty (usada nas transações do mercador)
 * 2. Atualiza todos os elementos da página que exibem a quantidade de moedas
 *    (identificados pelos seletores abaixo)
 */
async function initRunicCoinsFromCache() {
    try {
        const qty = await getItemQtyFromCache(MOEDA_ID);
        cachedMoedaQty = qty;

        // Seletores dos elementos que exibem Moedas Rúnicas na página
        // (inclui o display dentro do modal e qualquer elemento no topbar/cidade)
        const DISPLAY_SELECTORS = [
            '#mercadorMoedaQty',      // display dentro do modal mercador
            '#playerMoedas',          // display no topbar (se existir)
            '#topbarRunicCoins',      // alias alternativo do topbar
            '[data-runic-coins]',     // atributo genérico usado por outros componentes
        ];

        const formatted = fmt(qty);
        for (const sel of DISPLAY_SELECTORS) {
            document.querySelectorAll(sel).forEach(el => {
                el.textContent = `x${formatted}`;
            });
        }
    } catch (e) {
        console.warn('mercador: falha ao inicializar moedas rúnicas no boot', e);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// MERCADOR — CENÁRIO 3D (skybox próprio + NPC clicável)
// Mesmo padrão do Mestre de Poções (ver mitrar.js): ao clicar no hotspot
// "Mercador" da cidade, se ele estiver presente nesta cidade agora, abre-se
// primeiro este "cômodo" 360° com o NPC dentro do mundo 3D — um sprite
// billboard (sempre de frente pra câmera, nunca entorta ao girar). Só ao
// clicar NELE é que a loja de fato (#mercadorModal, já existente no HTML de
// cada cidade) abre por cima. Se o Mercador NÃO estiver nesta cidade agora,
// mantém o comportamento antigo: abre direto o aviso de que ele está em
// outra cidade (agora com o avatar do NPC — ver MC_NPC_IMAGE_URL, também
// usado dentro do aviso de ausência em openMercadorModal()).
//
// Como mercador.js roda em TODAS as cidades (ele viaja entre elas), a cena
// e a imagem do NPC são as MESMAS em qualquer cidade — só a checagem de
// presença muda (getMerchantState() + window.MERCHANT_CITY, já existente
// acima). O cenário/modal/estilos são criados dinamicamente aqui (mesmo
// padrão de injectOficinaModal em oficina.js), então nenhum HTML precisa
// ser tocado nas 7 páginas de cidade.
// ════════════════════════════════════════════════════════════════════════════

const MC_SCENE_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/mercador.webp'; // mesma imagem do fundo do modal da loja
const MC_NPC_IMAGE_URL   = 'https://aden-rpg.pages.dev/assets/npc_mercador.webp';
const MC_TUTORIAL_KEY    = 'mcTutorialSeen'; // sem sufixo de cidade: o Mercador viaja, o tutorial é o mesmo em qualquer lugar
const MC_NPC_PROXY_ID    = 'mcNpcSpot'; // elemento DOM invisível — só recebe .click() sintético quando o raycaster acerta o sprite

// Onde o Mercador fica DENTRO do cenário 360° (mundo 3D, não a tela).
// CALIBRAÇÃO: abra a página com ?debugSpots=1, entre no cenário do Mercador
// (ele precisa estar presente nesta cidade no momento) e clique perto de
// onde ele deveria ficar — aparece um tooltip com yaw/pitch. Copie os
// números para cá.
const MC_NPC_SPOT = {
    yaw: 0, pitch: -54,
    distance: 250,
    heightFrac: 0.34,
};

const MC_INITIAL_YAW = 0, MC_INITIAL_PITCH = -6, MC_INITIAL_FOV = 110;
const MC_FOV_MIN = 75, MC_FOV_MAX = 110;
const MC_START_FOV = MC_FOV_MAX;
const MC_PITCH_LIMIT = 89;

let mcYaw = MC_INITIAL_YAW, mcPitch = MC_INITIAL_PITCH, mcFov = MC_START_FOV;

let _mcSky = null;
let _mcNpcSprite = null, _mcNpcMaterial = null;
let _mcNpcBaseScale = { x: 1, y: 1 };
let _mcNpcShadowSprite = null;
let _mercadorSceneActive = false; // true quando a loja foi aberta a partir do cenário 3D (Mercador presente)

// Mesmo efeito de "flash pra preto e volta" usado nas cidades ao sair de
// uma loja (ver instantFadeThenReveal em mitrar.js) — replicado aqui de
// forma independente porque #screenFade é um elemento comum a todas as
// páginas de cidade, então não precisamos tocar nos scripts delas.
function flashScreenFade() {
    const fade = document.getElementById('screenFade');
    if (!fade) return;
    fade.style.transition = 'none';
    fade.classList.add('active');
    requestAnimationFrame(() => {
        fade.style.transition = 'opacity .45s ease';
        requestAnimationFrame(() => fade.classList.remove('active'));
    });
}

function injectMercadorSceneStyles() {
    if (document.getElementById('mcSceneStyles')) return;
    const style = document.createElement('style');
    style.id = 'mcSceneStyles';
    style.textContent = `
#mercadorSceneModal {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 3000;
    background-color: #0d1a0d;
    overflow: hidden;
}
#mcSceneContainer { position: absolute; inset: 0; overflow: hidden; }
#mcSceneCanvas {
    position: absolute; top: 0; left: 0;
    width: 100%; height: 100%;
    display: block; outline: none; cursor: grab;
}
#mcSceneCanvas.dragging { cursor: grabbing; }
#mcSceneMap {
    position: absolute; top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none; user-select: none;
}
.mc-tutorial-overlay {
    position: absolute; inset: 0; z-index: 5;
    pointer-events: none; opacity: 0;
    transition: opacity .35s ease;
    background: radial-gradient(circle at var(--mc-spot-x, 50%) var(--mc-spot-y, 45%),
        rgba(0,0,0,0) 0%, rgba(0,0,0,0) var(--mc-spot-r, 18%),
        rgba(0,0,0,0.5) calc(var(--mc-spot-r, 18%) + 22%));
}
.mc-tutorial-overlay.active { opacity: 1; }
.mc-tutorial-text {
    position: absolute; top: 64px; right: 14px; z-index: 20;
    max-width: 220px; background: rgba(0,0,0,0.75);
    border: 1px solid #ffd77a; color: #ffe9b8;
    font-weight: bold; font-size: 0.95em; line-height: 1.35;
    padding: 10px 14px; border-radius: 10px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    opacity: 0; transform: translateY(-8px);
    transition: opacity .35s ease, transform .35s ease;
    pointer-events: none;
}
.mc-tutorial-text.active { opacity: 1; transform: translateY(0); }
.mc-scene-exit-btn {
    position: absolute; top: 14px; right: 14px; z-index: 30;
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55);
    border: 1px solid rgba(255,215,120,0.55);
    border-radius: 50%; cursor: pointer; color: #ffd77a;
    box-shadow: 0 2px 10px rgba(0,0,0,0.5);
}
.mc-scene-exit-btn:hover { background: rgba(0,0,0,0.75); }
.mc-scene-exit-btn svg { width: 20px; height: 20px; }
`;
    document.head.appendChild(style);
}

function injectMercadorSceneModal() {
    if (document.getElementById('mercadorSceneModal')) return;
    const div = document.createElement('div');
    div.id = 'mercadorSceneModal';
    div.innerHTML = `
        <div id="mcSceneContainer">
            <canvas id="mcSceneCanvas"></canvas>
            <div id="mcSceneMap">
                <div id="${MC_NPC_PROXY_ID}" style="display:none;" aria-hidden="true"></div>
            </div>
            <div id="mcSceneTutorialOverlay" class="mc-tutorial-overlay"></div>
            <div id="mcSceneTutorialText" class="mc-tutorial-text">👆 Clique no vendedor para negociar!</div>
            <div id="closeMercadorSceneBtn" class="mc-scene-exit-btn" title="Sair">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
            </div>
        </div>`;
    document.body.appendChild(div);
    document.getElementById('closeMercadorSceneBtn').addEventListener('click', closeMercadorScene);
}

function mcYawPitchToVector(yawDeg, pitchDeg, radius = 1) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    return new THREE.Vector3(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(yaw) * Math.cos(pitch)
    );
}

function updateMcCameraLook() {
    if (!_mcSky) return;
    mcPitch = Math.max(-MC_PITCH_LIMIT, Math.min(MC_PITCH_LIMIT, mcPitch));
    mcFov   = Math.max(MC_FOV_MIN, Math.min(MC_FOV_MAX, mcFov));
    _mcSky.camera.fov = mcFov;
    _mcSky.camera.updateProjectionMatrix();
    const dir = mcYawPitchToVector(mcYaw, mcPitch, 1);
    _mcSky.camera.lookAt(dir.x, dir.y, dir.z);
}

// Sombra de contato do NPC — mesma técnica usada no Mestre de Poções
// (ver createPmShadowTexture em mitrar.js): gradiente radial num <canvas>,
// aplicado como sprite (blend alfa padrão, não multiply).
function createMcShadowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.00, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.32, 'rgba(0,0,0,0.6)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    grad.addColorStop(0.78, 'rgba(0,0,0,0)');
    grad.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

function initMercadorSkybox() {
    const cont   = document.getElementById('mcSceneContainer');
    const canvas = document.getElementById('mcSceneCanvas');
    const map    = document.getElementById('mcSceneMap');
    if (!cont || !canvas || !map || _mcSky) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(mcFov, cont.clientWidth / cont.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cont.clientWidth, cont.clientHeight);

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // normais invertidas: textura visível de dentro
    const material = new THREE.MeshBasicMaterial({ color: 0x0d1a0d });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    new THREE.TextureLoader().load(
        MC_SCENE_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            material.map = tex;
            material.color.set(0xffffff);
            material.needsUpdate = true;
        },
        undefined,
        (err) => console.error('[Mercador] Falha ao carregar o skybox do cenário:', err)
    );

    _mcSky = { scene, camera, renderer, canvas, cont };

    // Mesmo pós-processamento (bloom, grading de cor, motion blur) do resto
    // do jogo — em try/catch: se falhar, a cena continua com render padrão.
    try {
        _mcSky.pfx = initPostFX({ scene, camera, renderer, cont, mapEl: map });
    } catch (e) {
        console.error('[PostFX] Falha ao iniciar pós-processamento no cenário do Mercador:', e);
        _mcSky.pfx = null;
    }

    updateMcCameraLook();

    window.addEventListener('resize', () => {
        if (!_mcSky || !cont.offsetParent) return;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (_mcSky.pfx) {
            try { _mcSky.pfx.resize(w, h); } catch (e) { console.error('[PostFX] Erro no resize:', e); }
        }
    });

    (function loop() {
        requestAnimationFrame(loop);
        if (!cont.offsetParent) return; // cenário fechado — não desperdiça frame
        if (_mcSky.pfx) {
            try {
                _mcSky.pfx.render(scene, camera);
            } catch (e) {
                console.error('[PostFX] Erro ao renderizar o cenário do Mercador, desativando efeitos:', e);
                _mcSky.pfx = null;
                renderer.render(scene, camera);
            }
        } else {
            renderer.render(scene, camera);
        }
        updateMcTutorialSpotlight();
    })();

    initMcNpcSprite();
    enableMcSceneInteraction();
    initMcNpcClickHandler();
}

// NPC como sprite 3D — sempre de frente pra câmera (billboard), nunca
// entorta ao girar, e continua fixo na posição dele dentro do cenário.
function initMcNpcSprite() {
    if (!_mcSky) return;
    new THREE.TextureLoader().load(
        MC_NPC_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            _mcNpcMaterial = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
            const sprite = new THREE.Sprite(_mcNpcMaterial);
            sprite.center.set(0.5, 0);

            const aspect = tex.image.width / tex.image.height;
            const fovRad = THREE.MathUtils.degToRad(MC_INITIAL_FOV);
            const worldHeight = 2 * MC_NPC_SPOT.distance * Math.tan(fovRad / 2) * MC_NPC_SPOT.heightFrac;
            const worldWidth = worldHeight * aspect;
            sprite.scale.set(worldWidth, worldHeight, 1);
            _mcNpcBaseScale = { x: worldWidth, y: worldHeight };

            sprite.position.copy(mcYawPitchToVector(MC_NPC_SPOT.yaw, MC_NPC_SPOT.pitch, MC_NPC_SPOT.distance));
            sprite.renderOrder = 999;

            _mcSky.scene.add(sprite);
            _mcNpcSprite = sprite;

            const shadowMaterial = new THREE.SpriteMaterial({
                map: createMcShadowTexture(),
                transparent: true,
                depthWrite: false,
                depthTest: false,
            });
            const shadowSprite = new THREE.Sprite(shadowMaterial);
            shadowSprite.center.set(0.5, 0.5);
            shadowSprite.scale.set(worldWidth * (86 / 125), worldHeight * (26 / 160), 1);
            shadowSprite.position.copy(sprite.position);
            shadowSprite.renderOrder = 998;
            _mcSky.scene.add(shadowSprite);
            _mcNpcShadowSprite = shadowSprite;

            initMcNpcBreathing();
        },
        undefined,
        (err) => console.error('[Mercador] Falha ao carregar o NPC:', err)
    );
}

// Clique no NPC (raycast) — abre a loja; fora dele, com ?debugSpots=1,
// mostra o yaw/pitch do clique pra calibrar MC_NPC_SPOT.
function initMcNpcClickHandler() {
    const canvas = document.getElementById('mcSceneCanvas');
    if (!canvas || canvas._mcClickBound) return;
    canvas._mcClickBound = true;

    let debugOn = false;
    try { debugOn = new URLSearchParams(location.search).get('debugSpots') === '1'; } catch {}

    const raycaster = new THREE.Raycaster();
    let downX = 0, downY = 0, moved = false;

    canvas.addEventListener('pointerdown', (e) => {
        downX = e.clientX; downY = e.clientY; moved = false;
    });
    canvas.addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) moved = true;
    });
    canvas.addEventListener('pointerup', (e) => {
        if (moved || !_mcSky) return;
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -(((e.clientY - rect.top) / rect.height) * 2 - 1)
        );
        raycaster.setFromCamera(ndc, _mcSky.camera);

        if (_mcNpcSprite) {
            const hit = raycaster.intersectObject(_mcNpcSprite)[0];
            if (hit) {
                const proxy = document.getElementById(MC_NPC_PROXY_ID);
                if (proxy) proxy.click();
                return;
            }
        }

        if (debugOn) {
            const dir = raycaster.ray.direction.clone().normalize();
            const yaw   = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
            const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
            const txt = `yaw: ${yaw.toFixed(1)}, pitch: ${pitch.toFixed(1)}`;
            console.log('[debugSpots][Mercador]', txt);

            const tip = document.createElement('div');
            tip.textContent = txt;
            tip.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;transform:translate(-50%,-130%);
                background:rgba(0,0,0,.85);color:#7f7;font:bold 12px monospace;padding:4px 8px;border:1px solid #0f0;
                border-radius:4px;z-index:99999;pointer-events:none;white-space:nowrap;`;
            document.body.appendChild(tip);
            setTimeout(() => tip.remove(), 2500);
        }
    });
}

// Vinheta do tutorial — segue a projeção do NPC na tela a cada frame.
function updateMcTutorialSpotlight() {
    const overlay = document.getElementById('mcSceneTutorialOverlay');
    if (!overlay || !overlay.classList.contains('active') || !_mcSky || !_mcNpcSprite) return;
    const { camera, cont } = _mcSky;
    const cw = cont.clientWidth, ch = cont.clientHeight;
    if (!cw || !ch) return;

    const worldPoint = _mcNpcSprite.position.clone();
    worldPoint.y += _mcNpcBaseScale.y * 0.55;
    const proj = worldPoint.project(camera);
    if (proj.z > 1) return;

    const sx = (proj.x * 0.5 + 0.5) * cw;
    const sy = (1 - (proj.y * 0.5 + 0.5)) * ch;
    overlay.style.setProperty('--mc-spot-x', ((sx / cw) * 100).toFixed(1) + '%');
    overlay.style.setProperty('--mc-spot-y', ((sy / ch) * 100).toFixed(1) + '%');
    overlay.style.setProperty('--mc-spot-r', '16%');
}

// DRAG / PINCH / WHEEL do cenário — livre nos dois eixos.
function enableMcSceneInteraction() {
    const cont   = document.getElementById('mcSceneContainer');
    const canvas = document.getElementById('mcSceneCanvas');
    if (!canvas || !cont || cont._interactionEnabled) return;
    cont._interactionEnabled = true;

    let vx = 0, vy = 0, lt = 0, aId = null;
    const FRICTION = 0.94;
    const DRAG_SENS = 1.0;

    let drag = false, sx = 0, sy = 0;
    let isPinching = false;
    let pinchStartDist = 0, pinchStartFov = mcFov;

    canvas.style.touchAction = 'none';
    canvas.style.userSelect  = 'none';

    function degPerPx() { return mcFov / (cont.clientHeight || window.innerHeight); }

    function applyDelta(dx, dy) {
        const dpp = degPerPx();
        mcYaw   += dx * dpp * DRAG_SENS;
        mcPitch += dy * dpp * DRAG_SENS;
        updateMcCameraLook();
    }

    function inertia() {
        cancelAnimationFrame(aId);
        if (drag) return;
        vx *= FRICTION; vy *= FRICTION;
        applyDelta(vx, vy);
        if (Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02)
            aId = requestAnimationFrame(inertia);
    }

    function touchDist(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function startDrag(e) {
        drag = true;
        canvas.classList.add('dragging');
        sx = e.clientX ?? e.touches[0].clientX;
        sy = e.clientY ?? e.touches[0].clientY;
        vx = vy = 0;
        lt = performance.now();
        cancelAnimationFrame(aId);
    }

    function onDrag(e) {
        if (!drag) return;
        e.preventDefault();
        const nx = e.clientX ?? e.touches[0].clientX;
        const ny = e.clientY ?? e.touches[0].clientY;
        const dt = performance.now() - lt;
        const dx = nx - sx, dy = ny - sy;
        if (dt > 0) { vx = dx / dt * 16; vy = dy / dt * 16; }
        applyDelta(dx, dy);
        sx = nx; sy = ny;
        lt = performance.now();
    }

    function endDrag() {
        drag = false;
        canvas.classList.remove('dragging');
        if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) inertia();
    }

    function onTouchStart(e) {
        if (e.touches.length >= 2) {
            isPinching = true;
            drag = false;
            cancelAnimationFrame(aId);
            pinchStartDist = touchDist(e);
            pinchStartFov  = mcFov;
        } else if (e.touches.length === 1 && !isPinching) {
            startDrag(e);
        }
    }

    function onTouchMove(e) {
        if (e.touches.length >= 2 && isPinching) {
            e.preventDefault();
            const ratio = touchDist(e) / pinchStartDist;
            mcFov = pinchStartFov / ratio;
            updateMcCameraLook();
        } else if (e.touches.length === 1 && !isPinching) {
            onDrag(e);
        }
    }

    function onTouchEnd(e) {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            vx = vy = 0;
        }
        if (e.touches.length === 0) endDrag();
    }

    function onWheel(e) {
        e.preventDefault();
        mcFov += e.deltaY * 0.05;
        updateMcCameraLook();
    }

    cont.addEventListener('mousedown', startDrag, { passive: true });
    window.addEventListener('mousemove', onDrag,    { passive: false });
    window.addEventListener('mouseup',   endDrag,   { passive: true });
    cont.addEventListener('wheel', onWheel, { passive: false });

    cont.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend',  onTouchEnd,  { passive: true });
}

// Respiração orgânica do NPC — mesma lógica do Mestre de Poções (ver
// initPmNpcBreathing em mitrar.js).
function initMcNpcBreathing() {
    if (!_mcNpcSprite || _mcNpcSprite._mcBreathingStarted) return;
    _mcNpcSprite._mcBreathingStarted = true;

    let breathPhase = Math.random() * Math.PI * 2;
    let swayPhase = Math.random() * Math.PI * 2;

    let breathSpeed = 1, breathDepth = 1, swaySpeed = 0.35;
    let targetBreathSpeed = breathSpeed, targetBreathDepth = breathDepth, targetSwaySpeed = swaySpeed;
    let nextDriftChange = 0;

    let nextDeepBreath = 4000 + Math.random() * 5000;
    let deepBreathBoost = 0, deepBreathTarget = 0, deepBreathHold = 0;

    let lastTime = performance.now();

    function pickNewDriftTargets() {
        targetBreathSpeed = 0.82 + Math.random() * 0.4;
        targetBreathDepth = 0.75 + Math.random() * 0.55;
        targetSwaySpeed = 0.25 + Math.random() * 0.25;
        nextDriftChange = 3000 + Math.random() * 5000;
    }
    pickNewDriftTargets();

    function tick(now) {
        const dt = Math.min(now - lastTime, 100);
        lastTime = now;

        if (document.hidden || !_mcSky || !_mcSky.cont.offsetParent) {
            requestAnimationFrame(tick);
            return;
        }

        nextDriftChange -= dt;
        if (nextDriftChange <= 0) pickNewDriftTargets();

        breathSpeed += (targetBreathSpeed - breathSpeed) * 0.0015 * dt;
        breathDepth += (targetBreathDepth - breathDepth) * 0.0015 * dt;
        swaySpeed += (targetSwaySpeed - swaySpeed) * 0.0015 * dt;

        nextDeepBreath -= dt;
        if (nextDeepBreath <= 0) {
            deepBreathTarget = 1;
            deepBreathHold = 900;
            nextDeepBreath = 7000 + Math.random() * 8000;
        }
        if (deepBreathTarget > 0) {
            deepBreathHold -= dt;
            if (deepBreathHold <= 0) deepBreathTarget = 0;
        }
        deepBreathBoost += (deepBreathTarget - deepBreathBoost) * 0.005 * dt;

        breathPhase += (dt / 1000) * breathSpeed * ((Math.PI * 2) / 4.2);
        swayPhase += (dt / 1000) * swaySpeed * (Math.PI * 2);

        const raw = Math.sin(breathPhase);
        const asym = raw >= 0 ? Math.pow(raw, 0.7) : -Math.pow(-raw, 1.4);

        const breathAmount = asym * 0.012 * breathDepth * (1 + deepBreathBoost * 0.9);
        const scaleY = 1 + breathAmount;
        const scaleX = 1 + breathAmount * 0.43;

        const sway = Math.sin(swayPhase) * 0.6 + Math.sin(swayPhase * 0.47 + 1.3) * 0.3;
        const rotateDeg = sway * 0.12;

        if (_mcNpcSprite) {
            _mcNpcSprite.scale.set(_mcNpcBaseScale.x * scaleX, _mcNpcBaseScale.y * scaleY, 1);
        }
        if (_mcNpcMaterial) {
            _mcNpcMaterial.rotation = THREE.MathUtils.degToRad(rotateDeg);
        }

        if (_mcNpcShadowSprite) {
            const shadowScale = 1 + Math.max(0, breathAmount) * 0.12;
            const shadowOpacity = 0.82 - Math.max(0, breathAmount) * 0.08;
            _mcNpcShadowSprite.scale.set(
                _mcNpcBaseScale.x * (86 / 125) * shadowScale,
                _mcNpcBaseScale.y * (26 / 160) * shadowScale,
                1
            );
            _mcNpcShadowSprite.material.opacity = Math.min(1, Math.max(0.35, shadowOpacity));
        }

        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

// Tutorial "clique no vendedor" — só na 1ª vez, nunca mais repete (chave
// global, sem sufixo de cidade, já que o Mercador viaja).
function mcShouldShowTutorial() {
    try { return localStorage.getItem(MC_TUTORIAL_KEY) !== '1'; } catch { return true; }
}
function mcMarkTutorialSeen() {
    try { localStorage.setItem(MC_TUTORIAL_KEY, '1'); } catch {}
}
function showMcTutorial() {
    const overlay = document.getElementById('mcSceneTutorialOverlay');
    const text = document.getElementById('mcSceneTutorialText');
    const cont = document.getElementById('mcSceneContainer');
    if (!overlay || !text || !cont) return;
    overlay.classList.add('active');
    text.classList.add('active');

    function dismiss() {
        overlay.classList.remove('active');
        text.classList.remove('active');
        mcMarkTutorialSeen();
    }
    cont.addEventListener('click', dismiss, { capture: true, once: true });
}

// Abrir / fechar o cenário 3D do Mercador.
function openMercadorScene() {
    injectMercadorSceneModal();
    const modal = document.getElementById('mercadorSceneModal');
    if (!modal) return;
    modal.style.display = 'block';
    if (!_mcSky) {
        initMercadorSkybox();
    } else {
        mcYaw = MC_INITIAL_YAW; mcPitch = MC_INITIAL_PITCH; mcFov = MC_START_FOV;
        updateMcCameraLook();
        const { camera, renderer, cont } = _mcSky;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    if (mcShouldShowTutorial()) showMcTutorial();
}

function closeMercadorScene() {
    const modal = document.getElementById('mercadorSceneModal');
    if (modal) modal.style.display = 'none';
    flashScreenFade(); // volta pra cidade — mesmo efeito do closePmSceneBtn
}

// Clique no hotspot da cidade: se o Mercador estiver aqui agora, abre o
// cenário 3D (o clique NO NPC dentro dele é que abre a loja de fato); se
// não estiver, mantém o comportamento antigo — abre direto o aviso de
// ausência dentro do próprio #mercadorModal.
function handleMercadorHotspotClick() {
    const state = getMerchantState();
    const thisCity = (window.MERCHANT_CITY || '').toLowerCase();
    if (state.currentCity !== thisCity) {
        _mercadorSceneActive = false;
        openMercadorModal();
    } else {
        openMercadorScene();
    }
}

// Delegação no document: funciona mesmo antes do proxy existir (ele só é
// criado na 1ª vez que o cenário abre, via injectMercadorSceneModal).
function initMercadorSceneNpcProxy() {
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === MC_NPC_PROXY_ID) {
            _mercadorSceneActive = true;
            openMercadorModal();
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    injectMercadorSceneStyles();
    initMercadorSceneNpcProxy();

    // Carrega a quantidade de Moedas Rúnicas do IDB logo no boot da página,
    // garantindo que qualquer display mostre o valor correto desde o início
    initRunicCoinsFromCache();

    const openBtn  = document.getElementById('btnMercador');
    const modal    = document.getElementById('mercadorModal');
    const closeBtn = document.getElementById('closeMercadorBtn');

    if (openBtn) {
        openBtn.addEventListener('click', () => handleMercadorHotspotClick());
    }
    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            if (countdownInterval) clearInterval(countdownInterval);
            if (_mercadorSceneActive) {
                // Veio do cenário 3D (Mercador presente) — volta pra ele,
                // sem flash, igual ao closePotionMasterBtn em mitrar.html.
                const sceneModal = document.getElementById('mercadorSceneModal');
                if (sceneModal) sceneModal.style.display = 'block';
            } else {
                // Aviso de ausência — fecha direto pra cidade, com flash.
                flashScreenFade();
            }
        });
    }
});
