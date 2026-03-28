import { supabase } from './supabaseClient.js'

// =========================================================
// >>> ADEN GLOBAL DB (Zero Egress Auth & Player) <<<
// =========================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 6;
const AUTH_STORE = 'auth_store';
const PLAYER_STORE = 'player_store';

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(AUTH_STORE, 'readonly');
                const req = tx.objectStore(AUTH_STORE).get('current_session');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    getPlayer: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(PLAYER_STORE, 'readonly');
                const req = tx.objectStore(PLAYER_STORE).get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }
};

// =========================================================
// >>> CATÁLOGO DE ITENS COMERCIALIZÁVEIS <<<
// =========================================================
const BASE_ITEM_URL = 'https://aden-rpg.pages.dev/assets/itens/';
const GOLD_IMG_URL  = 'https://aden-rpg.pages.dev/assets/goldcoin.webp';

const TRADEABLE_ITEMS = [
    { id: 56,  name: 'Pórfero',                img: 'porifero.webp',           minGold: 1  },
    { id: 57,  name: 'Tecido Alfa',             img: 'tecido_alfa.webp',        minGold: 1  },
    { id: 58,  name: 'Verniz',                  img: 'verniz.webp',             minGold: 1  },
    { id: 59,  name: 'Safira',                  img: 'safira.webp',             minGold: 1  },
    { id: 60,  name: 'Pétala Orium',            img: 'petala_orium.webp',       minGold: 1  },
    { id: 61,  name: 'Lápis-lazúli',            img: 'lapis_lazuli.webp',       minGold: 1  },
    { id: 62,  name: 'Essência de Anjo',        img: 'essencia_de_anjo.webp',   minGold: 1  },
    { id: 63,  name: 'Lubrificante',            img: 'lubrificante.webp',       minGold: 1  },
    { id: 64,  name: 'Garra de Dragão',         img: 'garra_de_dragao.webp',    minGold: 1  },
    { id: 65,  name: 'Reagente Ômega',          img: 'reagente_omega.webp',     minGold: 1  },
    { id: 66,  name: 'Núcleo de Dragão',        img: 'nucleo_de_dragao.webp',   minGold: 1  },
    { id: 67,  name: 'Pele Animal',             img: 'pele_animal.webp',        minGold: 1  },
    { id: 68,  name: 'Pena de Harpia',          img: 'pena_de_harpia.webp',     minGold: 1  },
    { id: 69,  name: 'Lã',                      img: 'la.webp',                 minGold: 1  },
    { id: 70,  name: 'Sal de Cobalto',          img: 'sal_de_cobalto.webp',     minGold: 1  },
    { id: 71,  name: 'Lágrima de Fênix',        img: 'lagrima_de_fenix.webp',   minGold: 1  },
    { id: 72,  name: 'Pedaço de Freixo',        img: 'pedaco_de_freixo.webp',   minGold: 1  },
    { id: 73,  name: 'Presa de Kelts',          img: 'presa_de_kelts.webp',     minGold: 1  },
    { id: 74,  name: 'Galho Espiritual',        img: 'galho_espiritual.webp',   minGold: 1  },
    { id: 75,  name: 'Minério de Mithril',      img: 'minerio_de_mithril.webp', minGold: 1  },
    { id: 76,  name: 'Pó Ósseo',               img: 'po_osseo.webp',           minGold: 1  },
    { id: 77,  name: 'Couro Animal',            img: 'couro_animal.webp',       minGold: 1  },
    { id: 78,  name: 'Linha Mágica',            img: 'linha_magica.webp',       minGold: 1  },
    { id: 79,  name: 'Mithril Temperado',       img: 'mithril_temperado.webp',  minGold: 1  },
    { id: 80,  name: 'Carvão',                  img: 'carvao.webp',             minGold: 1  },
    { id: 81,  name: 'Minério de Ferro',        img: 'minerio_de_ferro.webp',   minGold: 1  },
    { id: 82,  name: 'Fios de Fibra',           img: 'fios_de_fibra.webp',      minGold: 1  },
    { id: 83,  name: 'Escama de Dragão',        img: 'escama_de_dragao.webp',   minGold: 1  },
    { id: 84,  name: 'Chifre de Unicórnio',     img: 'chifre_de_unicornio.webp',minGold: 1  },
    { id: 85,  name: 'Escudo de Caça',          img: 'escudo_de_caca.webp',     minGold: 1  },
    { id: 86,  name: 'Asa de Morcego',          img: 'asa_de_morcego.webp',     minGold: 1  },
    { id: 87,  name: 'Emblema Vampírico',       img: 'emblema_vampirico.webp',  minGold: 1  },
    { id: 88,  name: 'Quitina',                 img: 'quitina.webp',            minGold: 1  },
    { id: 89,  name: 'Pedra Âmbar',             img: 'pedra_ambar.webp',        minGold: 1  },
    { id: 90,  name: 'Lodo Mágico',             img: 'lodo_magico.webp',        minGold: 1  },
    { id: 91,  name: 'Núcleo de Vinha',         img: 'nucleo_de_vinha.webp',    minGold: 1  },
    { id: 92,  name: 'Totem Reptiliano',        img: 'totem_reptiliano.webp',   minGold: 1  },
    { id: 101, name: 'Receita Foice 100%',      img: 'receita_de_fragmentos_de_foice_da_noite_eterna_100.webp',    minGold: 50 },
    { id: 105, name: 'Receita Armadura 100%',   img: 'receita_de_fragmentos_de_armadura_da_noite_eterna_100.webp', minGold: 50 },
    { id: 109, name: 'Receita Anel 100%',       img: 'receita_de_fragmentos_de_anel_da_noite_eterna_100.webp',    minGold: 50 },
    { id: 113, name: 'Receita Colar 100%',      img: 'receita_de_fragmentos_de_colar_da_noite_eterna_100.webp',   minGold: 50 },
    { id: 117, name: 'Receita Elmo 100%',       img: 'receita_de_fragmentos_de_elmo_da_noite_eterna_100.webp',    minGold: 50 },
    { id: 121, name: 'Receita Asa 100%',        img: 'receita_de_fragmentos_de_asa_da_noite_eterna_100.webp',     minGold: 50 },
];

const TRADEABLE_MAP = new Map(TRADEABLE_ITEMS.map(i => [i.id, i]));

// =========================================================
// >>> INDEXEDDB – INVENTÁRIO <<<
// =========================================================
const IDB_NAME    = 'aden_inventory_db';
const IDB_STORE   = 'inventory_store';
const IDB_VERSION = 47;

function openIdb() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onerror   = () => rej(req.error);
        req.onsuccess = e  => res(e.target.result);
        req.onupgradeneeded = () => {}; // não modifica schema
    });
}

async function getTradeableItemsFromIdb() {
    try {
        const db = await openIdb();
        if (!db.objectStoreNames.contains(IDB_STORE)) return [];
        const tx    = db.transaction(IDB_STORE, 'readonly');
        const all   = await new Promise((res, rej) => {
            const r = tx.objectStore(IDB_STORE).getAll();
            r.onsuccess = () => res(r.result);
            r.onerror   = () => rej(r.error);
        });
        // Agrupa por item_id somando quantidades
        const totals = {};
        for (const inv of all) {
            const id = inv.items?.item_id;
            if (!id || !TRADEABLE_MAP.has(id)) continue;
            totals[id] = (totals[id] || 0) + (inv.quantity || 0);
        }
        return Object.entries(totals)
            .filter(([, qty]) => qty > 0)
            .map(([idStr, qty]) => {
                const meta = TRADEABLE_MAP.get(Number(idStr));
                return { ...meta, qty };
            });
    } catch { return []; }
}

async function decrementIdbItem(itemId, amount) {
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
        let remaining  = amount;
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
    } catch (e) { console.warn('pv: idb decrement fail', e); }
}

async function incrementIdbItem(itemId, amount) {
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
        if (matching.length > 0) {
            const item = matching[0];
            item.quantity = (item.quantity || 0) + amount;
            store.put(item);
        }
        // Se não existe, o recalc do servidor vai sincronizar no próximo login
    } catch (e) { console.warn('pv: idb increment fail', e); }
}

// =========================================================
// >>> ESTILOS CSS DO SISTEMA DE COMÉRCIO <<<
// =========================================================
function injectTradeStyles() {
    if (document.getElementById('pvTradeStyles')) return;
    const s = document.createElement('style');
    s.id = 'pvTradeStyles';
    s.textContent = `
/* ── BOTÃO DE COMÉRCIO ── */
#pv-trade-btn {
    cursor: pointer;
    display: flex;
    align-items: center;
    margin-left: auto;
    margin-right: 4px;
    opacity: 0.9;
    transition: opacity .2s, transform .2s;
}
#pv-trade-btn:hover { opacity: 1; transform: scale(1.1); }
#pv-trade-btn img   { width: 45px; height: 45px; display: block;
margin-top: 8px;
}

/* ── MODAL DE SELEÇÃO DE ITENS ── */
#pvTradeModal {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.72);
    display: none; align-items: center; justify-content: center;
    z-index: 4500;
}
#pvTradeModal.active { display: flex; }
#pvTradeBox {
    background: linear-gradient(160deg, #1a0d2e 0%, #120920 100%);
    border: 1px solid #6a3fa0;
    border-radius: 14px;
    width: min(420px, 96vw);
    max-height: 90vh;
    display: flex; flex-direction: column;
    overflow: hidden;
    box-shadow: 0 0 40px rgba(120,60,200,.4);
}
#pvTradeBox h3 {
    margin: 0; padding: 14px 18px;
    background: linear-gradient(90deg, #3b1d6e, #1a0d2e);
    color: #d4b4ff;
    font-size: 1em; letter-spacing: .5px;
    border-bottom: 1px solid #4a2a7a;
    display: flex; align-items: center; gap: 8px;
}
#pvTradeBox h3 span.pv-trade-close {
    margin-left: auto; cursor: pointer; font-size: 1.3em;
    color: #a07ce0; line-height: 1;
}
#pvTradeBox h3 span.pv-trade-close:hover { color: #fff; }
#pvTradeItemList {
    overflow-y: auto; padding: 10px 14px;
    display: flex; flex-direction: column; gap: 8px;
    flex: 1;
}
#pvTradeItemList::-webkit-scrollbar { width: 4px; }
#pvTradeItemList::-webkit-scrollbar-thumb { background: #5a2d9a; border-radius: 2px; }
.pv-trade-item-row {
    display: flex; align-items: center; gap: 10px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(160,100,255,.15);
    border-radius: 8px; padding: 8px 10px;
    cursor: pointer; transition: background .15s, border-color .15s;
}
.pv-trade-item-row:hover, .pv-trade-item-row.selected {
    background: rgba(120,60,200,.2);
    border-color: #8a5ad0;
}
.pv-trade-item-row img { width: 36px; height: 36px; object-fit: contain; }
.pv-trade-item-info { flex: 1; }
.pv-trade-item-info strong { display: block; font-size: .85em; color: #e0ccff; }
.pv-trade-item-info small  { color: #9a7abf; font-size: .75em; }
.pv-trade-item-qty-badge {
    background: rgba(90,45,154,.6);
    border-radius: 6px; padding: 2px 8px;
    font-size: .8em; color: #c8aaff; font-weight: bold;
}
#pvTradeConfigArea {
    padding: 14px 18px;
    border-top: 1px solid rgba(100,60,180,.3);
    background: rgba(0,0,0,.2);
    display: flex; flex-direction: column; gap: 10px;
}
.pv-trade-selected-preview {
    display: flex; align-items: center; gap: 10px;
    background: rgba(80,40,140,.25);
    border-radius: 8px; padding: 8px 12px;
    border: 1px solid rgba(140,80,220,.3);
}
.pv-trade-selected-preview img { width: 40px; height: 40px; object-fit: contain; }
.pv-trade-selected-preview span { color: #d4b4ff; font-size: .9em; font-weight: bold; }
.pv-trade-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pv-trade-input-group { display: flex; flex-direction: column; gap: 4px; }
.pv-trade-input-group label { color: #9a7abf; font-size: .75em; text-transform: uppercase; letter-spacing: .4px; }
.pv-trade-input-group input {
    background: rgba(0,0,0,.4); border: 1px solid rgba(120,70,200,.5);
    border-radius: 6px; color: #e0ccff; padding: 6px 10px;
    font-size: .9em; width: 100%; box-sizing: border-box;
    outline: none; transition: border-color .2s;
}
.pv-trade-input-group input:focus { border-color: #9060e0; }
#pvTradeOfferBtn {
    background: linear-gradient(135deg, #6a2fa0, #3d1870);
    border: none; color: #f0e0ff;
    border-radius: 8px; padding: 10px;
    font-size: .9em; font-weight: bold; cursor: pointer;
    transition: opacity .2s, transform .1s;
    letter-spacing: .4px;
}
#pvTradeOfferBtn:hover   { opacity: .9; }
#pvTradeOfferBtn:active  { transform: scale(.97); }
#pvTradeOfferBtn:disabled { opacity: .45; cursor: not-allowed; }
.pv-trade-hint { color: #7a5caa; font-size: .73em; text-align: center; }

/* ── MENSAGEM DE TRADE NO CHAT ── */
.pv-trade-msg {
    width: 100%; max-width: 300px;
    min-width: 0;
    box-sizing: border-box;
    background: linear-gradient(140deg, #1a0d2e, #0e0720);
    border: 1px solid #5a3090;
    border-radius: 12px; overflow: hidden;
    box-shadow: 0 2px 16px rgba(80,30,160,.35);
    font-size: .85em;
}
.pv-trade-msg-header {
    background: linear-gradient(90deg, #2d1460, #1a0d2e);
    padding: 7px 12px;
    display: flex; align-items: center; gap: 6px;
    border-bottom: 1px solid rgba(120,60,200,.3);
    color: #b090e0; font-size: .78em; font-weight: bold;
    text-transform: uppercase; letter-spacing: .5px;
}
.pv-trade-msg-header img { width: 16px; height: 16px; }
.pv-trade-msg-body {
    padding: 10px 12px;
    display: flex; align-items: center; gap: 12px;
}
.pv-trade-msg-body img.pv-trade-item-icon {
    width: 52px; height: 52px; object-fit: contain;
    border-radius: 8px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(120,60,200,.2);
    padding: 2px;
}
.pv-trade-msg-info { flex: 1; }
.pv-trade-msg-info .pv-trade-msg-name {
    color: #e0ccff; font-weight: bold; font-size: .9em; margin-bottom: 3px;
}
.pv-trade-msg-info .pv-trade-msg-qty {
    color: #9a7abf; font-size: .8em;
}
.pv-trade-msg-price {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.pv-trade-msg-price img { width: 22px; height: 22px; }
.pv-trade-msg-price span {
    color: #ffd766; font-weight: bold; font-size: .95em;
}
.pv-trade-msg-footer {
    padding: 6px 12px 10px;
    display: flex; flex-direction: column; gap: 6px;
    box-sizing: border-box; width: 100%;
}
.pv-trade-msg-expiry {
    color: #7a5caa; font-size: .72em; text-align: center;
}
.pv-trade-msg-status {
    text-align: center; font-weight: bold; font-size: .82em;
    padding: 5px; border-radius: 6px; box-sizing: border-box; width: 100%;
}
.pv-trade-msg-status.status-accepted  { background: rgba(30,120,60,.3);  color: #60e090; border: 1px solid rgba(40,160,80,.3);  }
.pv-trade-msg-status.status-cancelled { background: rgba(120,30,30,.3);  color: #e06060; border: 1px solid rgba(180,40,40,.3);  }
.pv-trade-msg-status.status-declined  { background: rgba(120,60,20,.3);  color: #e09060; border: 1px solid rgba(180,80,30,.3);  }
.pv-trade-msg-status.status-expired   { background: rgba(60,60,60,.3);   color: #909090; border: 1px solid rgba(90,90,90,.3);   }
.pv-trade-msg-status.status-pending   { background: rgba(80,40,140,.25); color: #b090e0; border: 1px solid rgba(120,60,200,.3); }
.pv-trade-msg-actions { display: flex; gap: 8px; width: 100%; box-sizing: border-box; }
.pv-trade-action-btn {
    flex: 1 1 0;
    padding: 8px 6px; border: none; border-radius: 7px;
    font-size: .82em; font-weight: bold; cursor: pointer;
    transition: opacity .15s, transform .1s;
    box-sizing: border-box; text-align: center;
    white-space: normal; word-break: break-word;
    line-height: 1.2;
}
.pv-trade-action-btn:active { transform: scale(.96); }
.pv-trade-action-btn:disabled { opacity: .4; cursor: not-allowed; }
.pv-trade-btn-accept  { background: linear-gradient(135deg, #1d7040, #0e3d20); color: #80ffa0; }
.pv-trade-btn-decline { background: linear-gradient(135deg, #70200d, #3d0e07); color: #ffaa80; }
.pv-trade-btn-cancel  { background: linear-gradient(135deg, #4a2060, #251030); color: #c0a0e0; }
.pv-trade-btn-accept:hover  { opacity: .85; }
.pv-trade-btn-decline:hover { opacity: .85; }
.pv-trade-btn-cancel:hover  { opacity: .85; }
.chat-message .pv-trade-msg { max-width: 100%; }
`;
    document.head.appendChild(s);
}

// =========================================================
// >>> MÓDULO PRINCIPAL <<<
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
    injectTradeStyles();

    const showFloatingMessage = window.showFloatingMessage || console.log;

    // --- ELEMENTOS DA UI ---
    const pvMenuBtn            = document.querySelector('.menu-item[data-modal="pvModal"]');
    const pvModal              = document.getElementById('pvModal');
    const closePvModalBtn      = document.getElementById('closePvModalBtn');
    const pvNotificationDot    = document.getElementById('pvNotificationDot');
    const pvTabs               = document.querySelectorAll('.pv-tab-btn');
    const pvMessageContent     = document.getElementById('pv-messages');
    const pvSystemContent      = document.getElementById('pv-system');
    const conversationListDiv  = document.getElementById('pv-conversation-list');
    const chatViewDiv          = document.getElementById('pv-chat-view');
    const backToListBtn        = document.getElementById('pv-back-to-list-btn');
    const chatWithName         = document.getElementById('pv-chat-with-name');
    const deleteConvoBtn       = document.getElementById('pv-delete-convo-btn');
    const chatMessagesDiv      = document.getElementById('pv-chat-messages');
    const chatInput            = document.getElementById('pv-chat-input');
    const sendMessageBtn       = document.getElementById('pv-send-message-btn');
    const systemMessagesListDiv= document.getElementById('pv-system-messages-list');
    const systemMessageModal   = document.getElementById('systemMessageModal');
    const closeSystemMessageModalBtn = document.getElementById('closeSystemMessageModalBtn');
    const systemMessageTitle   = document.getElementById('systemMessageTitle');
    const systemMessageContent = document.getElementById('systemMessageContent');
    const systemMessageDate    = document.getElementById('systemMessageDate');
    const pvSystemTabBtn       = document.querySelector('.pv-tab-btn[data-tab="pv-system"]');
    const confirmModal         = document.getElementById('confirmModal');
    const confirmModalMessage  = document.getElementById('pvConfirmModalMessage');
    let   confirmModalConfirmBtn = document.getElementById('confirmModalConfirmBtn');
    const confirmModalCancelBtn  = document.getElementById('confirmModalCancelBtn');
    const confirmModalCloseBtn   = confirmModal ? confirmModal.querySelector('.close-btn') : null;

    // --- Botão de comércio (inserido dinamicamente no header do chat) ---
    let tradeBtnEl = null;

    const closeConfirmModal = () => { if (confirmModal) confirmModal.style.display = 'none'; };

    function showConfirmModal(message, onConfirm) {
        if (!confirmModal || !confirmModalMessage || !confirmModalConfirmBtn) {
            if (confirm(message)) onConfirm();
            return;
        }
        confirmModalMessage.textContent = message;
        const newBtn = confirmModalConfirmBtn.cloneNode(true);
        confirmModalConfirmBtn.parentNode.replaceChild(newBtn, confirmModalConfirmBtn);
        confirmModalConfirmBtn = newBtn;
        newBtn.addEventListener('click', () => { closeConfirmModal(); if (typeof onConfirm === 'function') onConfirm(); }, { once: true });
        confirmModal.style.display = 'flex';
        newBtn.focus();
    }

    if (confirmModal) {
        confirmModalCancelBtn.addEventListener('click', closeConfirmModal);
        confirmModalCloseBtn.addEventListener('click', closeConfirmModal);
        confirmModal.addEventListener('click', e => { if (e.target === confirmModal) closeConfirmModal(); });
    }

    function showSystemMessageModal(title, content, date) {
        if (!systemMessageModal) return;
        systemMessageTitle.textContent   = title;
        systemMessageContent.textContent = content;
        systemMessageDate.textContent    = `Enviada em: ${date}`;
        systemMessageModal.style.display = 'flex';
    }

    function closeSystemMessageModal() {
        if (systemMessageModal) {
            systemMessageModal.style.display  = 'none';
            systemMessageTitle.textContent    = '';
            systemMessageContent.textContent  = '';
            systemMessageDate.textContent     = '';
        }
    }

    if (closeSystemMessageModalBtn) closeSystemMessageModalBtn.onclick = closeSystemMessageModal;
    if (systemMessageModal) {
        systemMessageModal.addEventListener('click', e => { if (e.target === systemMessageModal) closeSystemMessageModal(); });
    }

    // --- ESTADO LOCAL ---
    let localConversations       = new Map();
    let localSystemMessages      = new Map();
    let currentPlayer            = null;
    let currentOpenConversationId = null;
    let currentOtherPlayerId      = null; // ID do outro jogador na conversa aberta
    let playerCache              = new Map();

    function loadNameCache() {
        try {
            const raw = localStorage.getItem('pv_player_names_cache');
            if (raw) playerCache = new Map(JSON.parse(raw));
        } catch (e) { playerCache = new Map(); }
    }

    function saveNameCache() {
        try { localStorage.setItem('pv_player_names_cache', JSON.stringify(Array.from(playerCache.entries()))); } catch(e) {}
    }

    // ============================================================
    // SISTEMA DE COMÉRCIO ENTRE JOGADORES
    // ============================================================

    // Cria e injeta o modal de seleção de itens para trade
    function ensureTradeModal() {
        if (document.getElementById('pvTradeModal')) return;
        const wrap = document.createElement('div');
        wrap.id = 'pvTradeModal';
        wrap.innerHTML = `
<div id="pvTradeBox">
  <h3>
    <img src="https://aden-rpg.pages.dev/assets/tradep.webp" style="width:20px;height:20px;">
    Comércio com Jogador
    <span class="pv-trade-close" id="pvTradeCloseBtn">&times;</span>
  </h3>
  <div id="pvTradeItemList"><p style="color:#7a5caa;padding:16px;text-align:center;">Carregando seu inventário...</p></div>
  <div id="pvTradeConfigArea" style="display:none;">
    <div class="pv-trade-selected-preview" id="pvTradePreview">
      <img id="pvTradePreviewImg" src="" alt="">
      <span id="pvTradePreviewName">Selecione um item</span>
    </div>
    <div class="pv-trade-inputs">
      <div class="pv-trade-input-group">
        <label>Quantidade</label>
        <input type="number" id="pvTradeQtyInput" min="1" max="9999" value="1" placeholder="Ex: 10">
      </div>
      <div class="pv-trade-input-group">
        <label>Ouro total</label>
        <input type="number" id="pvTradeGoldInput" min="1" value="1" placeholder="Ex: 50">
      </div>
    </div>
    <div class="pv-trade-hint" id="pvTradeHint"></div>
    <button id="pvTradeOfferBtn" disabled>Criar Oferta</button>
  </div>
</div>`;
        document.body.appendChild(wrap);

        document.getElementById('pvTradeCloseBtn').onclick = closeTradeModal;
        wrap.addEventListener('click', e => { if (e.target === wrap) closeTradeModal(); });

        document.getElementById('pvTradeQtyInput').addEventListener('input', validateTradeInputs);
        document.getElementById('pvTradeGoldInput').addEventListener('input', validateTradeInputs);

        document.getElementById('pvTradeOfferBtn').addEventListener('click', submitTradeOffer);
    }

    let selectedTradeItem = null; // { id, name, img, qty, minGold }

    function closeTradeModal() {
        const m = document.getElementById('pvTradeModal');
        if (m) m.classList.remove('active');
        selectedTradeItem = null;
    }

    async function openTradePanel() {
        ensureTradeModal();
        selectedTradeItem = null;

        const config = document.getElementById('pvTradeConfigArea');
        const offerBtn = document.getElementById('pvTradeOfferBtn');
        if (config) config.style.display = 'none';
        if (offerBtn) offerBtn.disabled = true;

        const listDiv = document.getElementById('pvTradeItemList');
        listDiv.innerHTML = '<p style="color:#7a5caa;padding:16px;text-align:center;">Carregando inventário...</p>';

        document.getElementById('pvTradeModal').classList.add('active');

        const items = await getTradeableItemsFromIdb();

        if (items.length === 0) {
            listDiv.innerHTML = '<p style="color:#7a5caa;padding:16px;text-align:center;">Nenhum item comercializável na bolsa.</p>';
            return;
        }

        listDiv.innerHTML = '';
        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'pv-trade-item-row';
            row.dataset.itemId = item.id;
            row.innerHTML = `
              <img src="${BASE_ITEM_URL}${item.img}" alt="${item.name}" loading="lazy">
              <div class="pv-trade-item-info">
                <strong>${item.name}</strong>
                <small>Mínimo: ${item.minGold} ouro${item.minGold >= 50 ? ' ✦' : ''}</small>
              </div>
              <span class="pv-trade-item-qty-badge">x${item.qty}</span>`;
            row.addEventListener('click', () => selectTradeItem(item, row));
            listDiv.appendChild(row);
        }
    }

    function selectTradeItem(item, rowEl) {
        // Deseleciona anterior
        document.querySelectorAll('.pv-trade-item-row.selected').forEach(r => r.classList.remove('selected'));
        rowEl.classList.add('selected');

        selectedTradeItem = item;

        const config   = document.getElementById('pvTradeConfigArea');
        const previewImg  = document.getElementById('pvTradePreviewImg');
        const previewName = document.getElementById('pvTradePreviewName');
        const qtyInput  = document.getElementById('pvTradeQtyInput');
        const goldInput = document.getElementById('pvTradeGoldInput');
        const hint      = document.getElementById('pvTradeHint');

        config.style.display = 'flex';
        previewImg.src       = `${BASE_ITEM_URL}${item.img}`;
        previewName.textContent = item.name;

        qtyInput.max   = item.qty;
        qtyInput.value = 1;
        goldInput.min  = item.minGold;   // qty 1 × minGold unitário
        goldInput.value = item.minGold;

        hint.textContent = `Mínimo: ${item.minGold} ouro (1 × ${item.minGold})${item.minGold >= 50 ? ' ✦' : ''}.`;
        validateTradeInputs();
    }

    function validateTradeInputs() {
        const offerBtn  = document.getElementById('pvTradeOfferBtn');
        const qtyInput  = document.getElementById('pvTradeQtyInput');
        const goldInput = document.getElementById('pvTradeGoldInput');
        const hint      = document.getElementById('pvTradeHint');
        if (!offerBtn || !selectedTradeItem) return;

        // Garantir que gold seja inteiro (sem decimais) antes de calcular
        if (goldInput.value.includes('.') || goldInput.value.includes(',')) {
            goldInput.value = Math.floor(parseFloat(goldInput.value.replace(',', '.'))) || 1;
        }

        const qty  = parseInt(qtyInput.value)  || 1;
        const gold = parseInt(goldInput.value) || 0;

        // Mínimo total = quantidade × preço unitário mínimo do item
        const minGoldTotal = qty * selectedTradeItem.minGold;

        // Atualiza o atributo min e trava o valor se ficar abaixo do mínimo
        goldInput.min = minGoldTotal;
        if (gold < minGoldTotal) {
            goldInput.value = minGoldTotal;
        }

        const goldFinal = parseInt(goldInput.value);
        const qtyOk  = qty >= 1 && qty <= selectedTradeItem.qty;
        const goldOk = goldFinal >= minGoldTotal;

        offerBtn.disabled = !(qtyOk && goldOk);

        // Atualiza hint dinamicamente com o mínimo calculado
        if (hint) {
            const isSpecial = selectedTradeItem.minGold >= 50;
            hint.textContent = `Mínimo: ${minGoldTotal} ouro (${qty} × ${selectedTradeItem.minGold})${isSpecial ? ' ✦' : ''}.`;
        }
    }

    async function submitTradeOffer() {
        if (!selectedTradeItem || !currentOpenConversationId || !currentOtherPlayerId) return;

        const qtyInput  = document.getElementById('pvTradeQtyInput');
        const goldInput = document.getElementById('pvTradeGoldInput');
        const offerBtn  = document.getElementById('pvTradeOfferBtn');

        const qty       = parseInt(qtyInput.value);
        const goldTotal = parseInt(goldInput.value);

        if (!qty || !goldTotal || qty < 1 || goldTotal < qty * selectedTradeItem.minGold) {
            showFloatingMessage('Verifique a quantidade e o preço.');
            return;
        }

        offerBtn.disabled = true;
        offerBtn.textContent = 'Criando oferta...';

        try {
            const { data, error } = await supabaseClient.rpc('create_player_trade', {
                p_conversation_id: parseInt(currentOpenConversationId),
                p_buyer_id:        currentOtherPlayerId,
                p_item_id:         selectedTradeItem.id,
                p_quantity:        qty,
                p_gold_price:      goldTotal
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.message);

            // Decrementa IDB imediatamente
            await decrementIdbItem(selectedTradeItem.id, qty);

            closeTradeModal();
            showFloatingMessage(`Oferta criada! Os itens foram reservados por 12 horas.`);

            // Força sincronização e re-render do chat
            await fetchAndSyncMessages(true);
            await openChatView(currentOpenConversationId);

        } catch (err) {
            showFloatingMessage(`Erro: ${err.message || 'Não foi possível criar a oferta.'}`);
            offerBtn.disabled = false;
            offerBtn.textContent = 'Criar Oferta';
        }
    }

    // Busca os status atuais de um array de trade_ids
    async function fetchTradeStatuses(tradeIds) {
        if (!tradeIds || tradeIds.length === 0) return {};
        try {
            const { data, error } = await supabaseClient.rpc('get_trade_statuses', {
                p_trade_ids: tradeIds
            });
            if (error || !data) return {};
            return data;
        } catch { return {}; }
    }

    async function handleAcceptTrade(tradeId, goldPrice, footerEl) {
        showConfirmModal(
            `Confirmar compra? Você vai gastar ${goldPrice} de ouro para receber estes itens.`,
            async () => {
                const btns = footerEl.querySelectorAll('.pv-trade-action-btn');
                btns.forEach(b => b.disabled = true);

                const { data, error } = await supabaseClient.rpc('accept_player_trade', { p_trade_id: tradeId });

                if (error || !data?.success) {
                    showFloatingMessage(`Erro: ${(data?.message) || error?.message || 'Falha.'}`);
                    btns.forEach(b => b.disabled = false);
                    return;
                }

                // Atualiza gold no localStorage/cache
                if (data.new_gold != null) {
                    try {
                        const c = JSON.parse(localStorage.getItem('player_data_cache') || '{}');
                        if (c.data) { c.data.gold = data.new_gold; localStorage.setItem('player_data_cache', JSON.stringify(c)); }
                        const goldEl = document.getElementById('playerGold');
                        if (goldEl) goldEl.textContent = data.new_gold;
                    } catch {}
                }
                // Adiciona ao IDB local
                await incrementIdbItem(data.item_id, data.items_received);

                // Re-renderiza a conversa para mostrar status atualizado
                await fetchAndSyncMessages(true);
                await openChatView(currentOpenConversationId);
                showFloatingMessage('Transação concluída! Itens adicionados ao inventário.');
            }
        );
    }

    async function handleCancelTrade(tradeId, itemId, qty, footerEl, isSeller) {
        const msg = isSeller
            ? 'Cancelar esta oferta? Os itens serão devolvidos para você.'
            : 'Recusar esta oferta? Os itens serão devolvidos ao vendedor.';

        showConfirmModal(msg, async () => {
            const btns = footerEl.querySelectorAll('.pv-trade-action-btn');
            btns.forEach(b => b.disabled = true);

            const { data, error } = await supabaseClient.rpc('cancel_player_trade', { p_trade_id: tradeId });

            if (error || !data?.success) {
                showFloatingMessage(`Erro: ${data?.message || error?.message || 'Falha.'}`);
                btns.forEach(b => b.disabled = false);
                return;
            }

            // Se for vendedor: devolve ao IDB
            if (isSeller) {
                await incrementIdbItem(data.item_id, data.quantity);
            }

            await fetchAndSyncMessages(true);
            await openChatView(currentOpenConversationId);
            showFloatingMessage(data.message || 'Oferta processada.');
        });
    }

    // ============================================================
    // MENSAGENS DO SISTEMA
    // ============================================================

    async function fetchAndRenderSystemMessages({ markAsRead = false, forceRefresh = false } = {}) {
        if (!currentPlayer || !systemMessagesListDiv) return;

        const SYS_CACHE_KEY = `pv_sys_msg_data_${currentPlayer.id}`;
        const SYS_TIME_KEY  = `pv_sys_msg_time_${currentPlayer.id}`;
        const TTL  = 24 * 60 * 60 * 1000;
        const now  = Date.now();
        const lastFetch = parseInt(localStorage.getItem(SYS_TIME_KEY) || '0');

        let dbMessages = null;

        if (!forceRefresh && !markAsRead && (now - lastFetch < TTL)) {
            try {
                const cached = localStorage.getItem(SYS_CACHE_KEY);
                if (cached) { dbMessages = JSON.parse(cached); }
            } catch(e) {}
        }

        if (!dbMessages) {
            systemMessagesListDiv.innerHTML = '<p>Carregando mensagens do sistema...</p>';
            const { data, error } = await supabaseClient
                .from('system_messages')
                .select('id, title, preview, created_at')
                .or(`target_player_id.is.null,target_player_id.eq.${currentPlayer.id}`)
                .order('created_at', { ascending: false });

            if (error) { systemMessagesListDiv.innerHTML = '<p>Erro ao carregar.</p>'; return; }
            dbMessages = data;
            localStorage.setItem(SYS_CACHE_KEY, JSON.stringify(dbMessages));
            localStorage.setItem(SYS_TIME_KEY, now.toString());
        }

        if (!dbMessages || dbMessages.length === 0) {
            systemMessagesListDiv.innerHTML = '<p>Nenhuma mensagem do sistema.</p>';
            checkUnreadStatus();
            return;
        }

        const lastReadId = parseInt(localStorage.getItem(`pv_system_last_read_${currentPlayer.id}`) || '0');
        let highestId = lastReadId;

        localSystemMessages = new Map();
        systemMessagesListDiv.innerHTML = '';
        let hasUnreadSystem = false;

        dbMessages.forEach(msg => {
            localSystemMessages.set(String(msg.id), msg);
            const msgDiv = document.createElement('div');
            msgDiv.className = 'system-message-item conversation-item';
            const numericId = parseInt(msg.id);
            let isUnread = numericId > lastReadId;
            if (isUnread) { msgDiv.classList.add('unread'); hasUnreadSystem = true; }
            if (numericId > highestId) highestId = numericId;

            const sentDate = new Date(msg.created_at);
            const formattedDate = `${sentDate.toLocaleDateString()} ${sentDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            msgDiv.innerHTML = `
                <p class="conversation-name">${msg.title || 'Mensagem do Sistema'}</p>
                <p class="conversation-preview">${msg.preview || 'Clique para ler.'}</p>
                <small class="system-message-date">${formattedDate}</small>`;
            msgDiv.addEventListener('click', async () => {
                const { data: fullMsg } = await supabaseClient.from('system_messages').select('content').eq('id', msg.id).single();
                if (fullMsg) showSystemMessageModal(msg.title || 'Mensagem do Sistema', fullMsg.content, formattedDate);
                if (isUnread) msgDiv.classList.remove('unread');
            });
            systemMessagesListDiv.appendChild(msgDiv);
        });

        if (markAsRead && highestId > lastReadId) {
            localStorage.setItem(`pv_system_last_read_${currentPlayer.id}`, highestId);
            hasUnreadSystem = false;
        }

        checkUnreadStatus(hasUnreadSystem);
    }

    function checkUnreadStatus(hasUnreadSystem) {
        const hasUnreadPv = [...localConversations.values()].some(c => c.is_unread && !c.is_server_deleted);
        let systemUnread = hasUnreadSystem;
        if (systemUnread === undefined) {
            const lastReadId = parseInt(localStorage.getItem(`pv_system_last_read_${currentPlayer.id}`) || '0');
            const newestMsg  = [...localSystemMessages.values()].reduce((max, msg) => Math.max(max, parseInt(msg.id)), 0);
            systemUnread = newestMsg > lastReadId;
        }
        if (pvSystemTabBtn) {
            systemUnread ? pvSystemTabBtn.classList.add('has-unread-system') : pvSystemTabBtn.classList.remove('has-unread-system');
        }
        const hasUnreadTotal = hasUnreadPv || systemUnread;
        if (pvNotificationDot) pvNotificationDot.style.display = hasUnreadTotal ? 'block' : 'none';
    }

    // ============================================================
    // MENSAGENS PRIVADAS
    // ============================================================

    async function fetchAndSyncMessages(forceRefresh = false) {
        if (!currentPlayer) return;

        const PV_SYNC_KEY  = `pv_meta_sync_time_${currentPlayer.id}`;
        const TTL_PV = 15 * 60 * 1000;
        const now    = Date.now();
        const lastSync = parseInt(localStorage.getItem(PV_SYNC_KEY) || '0');

        if (!forceRefresh && (now - lastSync < TTL_PV)) {
            renderConversationList();
            checkUnreadStatus();
            return;
        }

        if (currentPlayer.id && currentPlayer.name) playerCache.set(String(currentPlayer.id), currentPlayer.name);

        const STORAGE_KEY_CLEANUP = `aden_pv_cleanup_${currentPlayer.id}`;
        const todayStr = new Date().toISOString().split('T')[0];
        if (localStorage.getItem(STORAGE_KEY_CLEANUP) !== todayStr) {
            supabaseClient.rpc('cleanup_old_private_messages')
                .then(() => localStorage.setItem(STORAGE_KEY_CLEANUP, todayStr))
                .catch(err => console.warn('⚠️ Falha na limpeza de PV:', err));
        }

        const { data: dbConversations, error: convoError } = await supabaseClient
            .from('private_messages')
            .select('id, player_one_id, player_two_id, last_message, last_sender_id, updated_at, unread_by_player_one, unread_by_player_two')
            .or(`player_one_id.eq.${currentPlayer.id},player_two_id.eq.${currentPlayer.id}`);

        if (convoError) { renderConversationList(); checkUnreadStatus(); return; }

        localStorage.setItem(PV_SYNC_KEY, now.toString());

        const activeConvoIds = new Set();
        const allPlayerIdsToFetch = new Set();
        let namesChanged = false;

        dbConversations.forEach(dbConvo => {
            const convoId = String(dbConvo.id);
            activeConvoIds.add(convoId);
            const localConvo = localConversations.get(convoId) || { messages: [] };
            localConvo.id             = convoId;
            localConvo.player_one_id  = dbConvo.player_one_id;
            localConvo.player_two_id  = dbConvo.player_two_id;
            localConvo.last_sender_id = dbConvo.last_sender_id;
            localConvo.last_message   = dbConvo.last_message;
            const isPlayerOne = dbConvo.player_one_id === currentPlayer.id;
            localConvo.is_unread = isPlayerOne ? dbConvo.unread_by_player_one : dbConvo.unread_by_player_two;
            localConvo.is_server_deleted = false;
            localConversations.set(convoId, localConvo);
            const otherId = localConvo.player_one_id === currentPlayer.id ? localConvo.player_two_id : localConvo.player_one_id;
            allPlayerIdsToFetch.add(otherId);
        });

        localConversations.forEach((convo, convoId) => {
            if (!activeConvoIds.has(convoId) && convo.id) convo.is_server_deleted = true;
            if (convo.is_server_deleted) {
                const otherId = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
                allPlayerIdsToFetch.add(otherId);
            }
        });

        const idsToFetch = [...allPlayerIdsToFetch].filter(id => !playerCache.has(String(id)) && String(id) !== String(currentPlayer.id));
        if (idsToFetch.length > 0) {
            const { data: otherPlayersData, error: playersError } = await supabaseClient.from('players').select('id, name').in('id', idsToFetch);
            if (!playersError) {
                otherPlayersData.forEach(p => playerCache.set(String(p.id), p.name));
                namesChanged = true;
            }
        }

        if (namesChanged) saveNameCache();
        saveToLocalStorage();
        renderConversationList();
    }

    function loadFromLocalStorage() {
        try {
            const storedConvos = JSON.parse(localStorage.getItem('pv_conversations') || '{}');
            localConversations = new Map(Object.entries(storedConvos));
        } catch (e) { localConversations = new Map(); }
    }

    function saveToLocalStorage() {
        localStorage.setItem('pv_conversations', JSON.stringify(Object.fromEntries(localConversations)));
    }

    function getPlayerName(playerId) {
        return playerCache.get(String(playerId)) || 'Desconhecido';
    }

    async function renderConversationList() {
        if (!conversationListDiv) return;
        const convosToDisplay = [...localConversations.values()];
        if (convosToDisplay.length === 0) {
            conversationListDiv.innerHTML = '<p>Nenhuma mensagem ainda. Inicie uma conversa!</p>';
            return;
        }
        conversationListDiv.innerHTML = '';
        const sortedConversations = convosToDisplay.sort((a, b) => {
            const lastMsgA = a.messages[a.messages.length - 1]?.timestamp || 0;
            const lastMsgB = b.messages[b.messages.length - 1]?.timestamp || 0;
            return new Date(lastMsgB) - new Date(lastMsgA);
        });
        sortedConversations.forEach(convo => {
            const otherPlayerId   = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
            const otherPlayerName = getPlayerName(otherPlayerId);
            const item = document.createElement('div');
            item.className = 'conversation-item';
            item.dataset.conversationId = convo.id;

            // Preview: oculta texto de trade
            let previewText = convo.last_message || 'Nenhuma mensagem ainda.';
            if (previewText === '__TRADE__') previewText = '🛒 Oferta de comércio';

            if (convo.is_server_deleted) {
                item.classList.add('archived');
                item.innerHTML = `<p class="conversation-name">${otherPlayerName} <span class="archived-label">(ARQUIVADA)</span></p><p class="conversation-preview">${previewText}</p>`;
            } else {
                if (convo.is_unread) item.classList.add('unread');
                item.innerHTML = `<p class="conversation-name">${otherPlayerName}</p><p class="conversation-preview">${previewText}</p>`;
            }
            item.addEventListener('click', () => openChatView(convo.id, otherPlayerName));
            conversationListDiv.appendChild(item);
        });
    }

    async function openChatView(conversationId, targetPlayerName = null) {
        currentOpenConversationId = String(conversationId);
        let convo = localConversations.get(currentOpenConversationId);

        if (!convo) {
            await fetchAndSyncMessages(true);
            convo = localConversations.get(currentOpenConversationId);
            if (!convo) { showFloatingMessage('Não foi possível carregar a conversa.'); return; }
        }

        const otherPlayerId = convo.player_one_id === currentPlayer.id ? convo.player_two_id : convo.player_one_id;
        currentOtherPlayerId = otherPlayerId;

        let finalPlayerName = targetPlayerName;
        if (!finalPlayerName || finalPlayerName === 'Desconhecido') finalPlayerName = getPlayerName(otherPlayerId);
        chatWithName.textContent = finalPlayerName;

        // Adiciona/atualiza botão de comércio ao lado do delete
        _ensureTradeHeaderBtn(convo);

        if (!convo.is_server_deleted) {
            const { data: msgData } = await supabaseClient
                .from('private_messages')
                .select('messages')
                .eq('id', currentOpenConversationId)
                .single();

            if (msgData && msgData.messages) {
                const existingTimestamps = new Set(convo.messages.map(m => m.timestamp));
                msgData.messages.forEach(dbMsg => {
                    if (!existingTimestamps.has(dbMsg.timestamp)) convo.messages.push(dbMsg);
                });
                localConversations.set(currentOpenConversationId, convo);
                saveToLocalStorage();
            }
        }

        if (deleteConvoBtn) {
            deleteConvoBtn.style.display = 'block';
            deleteConvoBtn.title = convo.is_server_deleted ? 'Apagar Histórico Local' : 'Apagar Conversa';
        }

        if (convo.is_server_deleted) {
            showFloatingMessage('Esta conversa foi arquivada. Você pode apenas visualizar o histórico.');
            chatInput.disabled = true;
            chatInput.placeholder = 'Conversa arquivada - somente leitura.';
            sendMessageBtn.style.filter = 'grayscale(1)';
            if (tradeBtnEl) tradeBtnEl.style.display = 'none';
        } else {
            const isPlayerOne    = convo.player_one_id === currentPlayer.id;
            const unreadColumn   = isPlayerOne ? 'unread_by_player_one' : 'unread_by_player_two';

            if (convo.is_unread) {
                convo.is_unread = false;
                await supabaseClient.from('private_messages').update({ [unreadColumn]: false }).eq('id', currentOpenConversationId);
                saveToLocalStorage();
                renderConversationList();
                checkUnreadStatus();
            }

            if (convo.last_sender_id === currentPlayer.id) {
                chatInput.disabled = true;
                chatInput.placeholder = 'Aguardando resposta do outro jogador.';
                sendMessageBtn.style.filter = 'grayscale(1)';
            } else {
                chatInput.disabled = false;
                chatInput.placeholder = 'Digite sua mensagem...';
                sendMessageBtn.style.filter = '';
            }
            if (tradeBtnEl) tradeBtnEl.style.display = 'flex';
        }

        conversationListDiv.style.display = 'none';
        chatViewDiv.style.display = 'flex';
        await renderChatMessages(convo);
    }
    window.openChatView = openChatView;

    function _ensureTradeHeaderBtn(convo) {
        const chatHeader = chatViewDiv.querySelector('.chat-header');
        if (!chatHeader) return;

        // Remove botão antigo se existir
        const old = document.getElementById('pv-trade-btn');
        if (old) old.remove();

        if (convo.is_server_deleted) return;

        tradeBtnEl = document.createElement('div');
        tradeBtnEl.id = 'pv-trade-btn';
        tradeBtnEl.title = 'Comércio entre jogadores';
        tradeBtnEl.innerHTML = `<img src="https://aden-rpg.pages.dev/assets/tradep.webp" alt="Comércio">`;
        tradeBtnEl.addEventListener('click', openTradePanel);

        // Insere antes do botão de deletar
        chatHeader.insertBefore(tradeBtnEl, deleteConvoBtn);
    }

    async function renderChatMessages(convo) {
        chatMessagesDiv.innerHTML = '';
        const messages = convo.messages || [];

        // Coleta todos os trade_ids para buscar status em batch
        const tradeIds = messages
            .filter(m => m.text === '__TRADE__' && m.trade_id != null)
            .map(m => Number(m.trade_id));

        let tradeStatuses = {};
        if (tradeIds.length > 0) {
            tradeStatuses = await fetchTradeStatuses(tradeIds);
        }

        for (const msg of messages) {
            const msgDiv = document.createElement('div');
            msgDiv.className = 'chat-message';
            msgDiv.classList.add(msg.sender_id === currentPlayer.id ? 'sent' : 'received');

            if (msg.text === '__TRADE__' && msg.trade_id != null) {
                // Mensagem de trade — renderiza card especial
                const tradeHtml = await buildTradeMessageHtml(msg, tradeStatuses);
                msgDiv.innerHTML = tradeHtml;

                // Eventos dos botões de ação do trade
                const tradeId  = Number(msg.trade_id);
                const isSeller = msg.sender_id === currentPlayer.id;
                const footer   = msgDiv.querySelector('.pv-trade-msg-footer');

                const acceptBtn  = msgDiv.querySelector('.pv-trade-btn-accept');
                const declineBtn = msgDiv.querySelector('.pv-trade-btn-decline');
                const cancelBtn  = msgDiv.querySelector('.pv-trade-btn-cancel');

                if (acceptBtn && footer) {
                    acceptBtn.addEventListener('click', () => handleAcceptTrade(tradeId, Number(msg.trade_gold), footer));
                }
                if (declineBtn && footer) {
                    declineBtn.addEventListener('click', () => handleCancelTrade(tradeId, msg.trade_item_id, msg.trade_quantity, footer, false));
                }
                if (cancelBtn && footer) {
                    cancelBtn.addEventListener('click', () => handleCancelTrade(tradeId, msg.trade_item_id, msg.trade_quantity, footer, true));
                }
            } else {
                const sentDate     = new Date(msg.timestamp);
                const formattedDate = `${sentDate.toLocaleDateString()} ${sentDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                msgDiv.innerHTML   = `<p>${msg.text}</p><small>${formattedDate}</small>`;
            }

            chatMessagesDiv.appendChild(msgDiv);
        }

        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    }

    function buildTradeMessageHtml(msg, tradeStatuses) {
        const tradeId   = Number(msg.trade_id);
        const itemId    = Number(msg.trade_item_id);
        const qty       = Number(msg.trade_quantity);
        const gold      = Number(msg.trade_gold);
        const expiresAt = new Date(msg.trade_expires_at);
        const isSeller  = msg.sender_id === currentPlayer.id;

        const meta     = TRADEABLE_MAP.get(itemId);
        const imgUrl   = meta ? `${BASE_ITEM_URL}${meta.img}` : '';
        const itemName = meta ? meta.name : `Item #${itemId}`;

        // Status (do servidor ou inferido)
        const serverTrade = tradeStatuses[String(tradeId)];
        let status = serverTrade?.status || 'pending';
        const now  = Date.now();
        if (status === 'pending' && now > expiresAt.getTime()) status = 'expired';

        // Formata expiração
        const expiryStr = status === 'pending'
            ? `Expira em ${expiresAt.toLocaleDateString()} ${expiresAt.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
            : '';

        const statusLabels = {
            pending:   '⏳ Aguardando resposta',
            accepted:  '✅ Transação concluída',
            cancelled: '❌ Cancelada pelo vendedor',
            declined:  '🚫 Recusada',
            expired:   '⌛ Oferta expirada',
        };

        let actionsHtml = '';
        if (status === 'pending') {
            if (isSeller) {
                actionsHtml = `<div class="pv-trade-msg-actions"><button class="pv-trade-action-btn pv-trade-btn-cancel">Cancelar Oferta</button></div>`;
            } else {
                actionsHtml = `
                    <div class="pv-trade-msg-actions">
                        <button class="pv-trade-action-btn pv-trade-btn-accept">Aceitar</button>
                        <button class="pv-trade-action-btn pv-trade-btn-decline">Recusar</button>
                    </div>`;
            }
        }

        return `
<div class="pv-trade-msg">
  <div class="pv-trade-msg-header">
    <img src="https://aden-rpg.pages.dev/assets/tradep.webp" alt="">
    Oferta de Comércio
  </div>
  <div class="pv-trade-msg-body">
    <img class="pv-trade-item-icon" src="${imgUrl}" alt="${itemName}" loading="lazy">
    <div class="pv-trade-msg-info">
      <div class="pv-trade-msg-name">${itemName}</div>
      <div class="pv-trade-msg-qty">Quantidade: <strong>${qty}</strong></div>
    </div>
    <div class="pv-trade-msg-price">
      <img src="${GOLD_IMG_URL}" alt="Ouro">
      <span>${gold}</span>
    </div>
  </div>
  <div class="pv-trade-msg-footer">
    ${expiryStr ? `<div class="pv-trade-msg-expiry">${expiryStr}</div>` : ''}
    <div class="pv-trade-msg-status status-${status}">${statusLabels[status] || status}</div>
    ${actionsHtml}
  </div>
</div>`;
    }

    // ============================================================
    // INICIALIZAÇÃO & EVENTOS
    // ============================================================

    async function initializePV() {
        if (!supabaseClient) return;

        loadFromLocalStorage();
        loadNameCache();

        const waitForPlayer = async () => {
            if (window.currentPlayerData && window.currentPlayerData.id)
                return { id: window.currentPlayerData.id, name: window.currentPlayerData.name };
            try {
                const legacyCache = JSON.parse(localStorage.getItem('player_data_cache'));
                if (legacyCache && legacyCache.data && legacyCache.data.id)
                    return { id: legacyCache.data.id, name: legacyCache.data.name };
            } catch(e) {}
            const globalPlayer = await GlobalDB.getPlayer();
            if (globalPlayer && globalPlayer.id) return { id: globalPlayer.id, name: globalPlayer.name };
            return null;
        };

        currentPlayer = await waitForPlayer();

        if (!currentPlayer) {
            await new Promise(resolve => {
                const onPlayerReady = e => {
                    if (e.detail) { currentPlayer = { id: e.detail.id, name: e.detail.name }; resolve(); }
                };
                window.addEventListener('aden_player_ready', onPlayerReady, { once: true });
                const check = setInterval(async () => {
                    const p = await waitForPlayer();
                    if (p) {
                        currentPlayer = p;
                        window.removeEventListener('aden_player_ready', onPlayerReady);
                        clearInterval(check);
                        resolve();
                    }
                }, 500);
            });
        }

        if (!currentPlayer) return;

        await fetchAndSyncMessages();
        await fetchAndRenderSystemMessages({ markAsRead: false });
        setupEventListeners();
        checkUnreadStatus();
    }

    function setupEventListeners() {
        if (pvMenuBtn) pvMenuBtn.onclick = () => { pvModal.style.display = 'flex'; };
        if (closePvModalBtn) closePvModalBtn.onclick = () => pvModal.style.display = 'none';

        pvTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                pvTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                pvMessageContent.style.display = tab.dataset.tab === 'pv-messages' ? 'block' : 'none';
                pvSystemContent.style.display  = tab.dataset.tab === 'pv-system'   ? 'block' : 'none';
                if (tab.dataset.tab === 'pv-system') fetchAndRenderSystemMessages({ markAsRead: true, forceRefresh: true });
                else if (tab.dataset.tab === 'pv-messages') fetchAndSyncMessages(true);
            });
        });

        if (backToListBtn) {
            backToListBtn.onclick = () => {
                chatViewDiv.style.display         = 'none';
                conversationListDiv.style.display = 'flex';
                currentOpenConversationId         = null;
                currentOtherPlayerId              = null;
            };
        }

        const handleSendMessage = async () => {
            const messageText = chatInput.value.trim();
            if (!messageText || !currentOpenConversationId) return;

            const convo = localConversations.get(currentOpenConversationId);
            if (convo && convo.is_server_deleted) {
                showFloatingMessage('Não é possível enviar mensagens para uma conversa arquivada.');
                return;
            }

            sendMessageBtn.style.pointerEvents = 'none';
            chatInput.disabled = true;

            const { data, error } = await supabaseClient.rpc('send_private_message', {
                conversation_id: currentOpenConversationId,
                message_text:    messageText
            });

            if (error) {
                showFloatingMessage(`Erro: ${error.message}`);
                sendMessageBtn.style.pointerEvents = 'auto';
                chatInput.disabled = false;
            } else {
                chatInput.value = '';
                await fetchAndSyncMessages(true);
                const currentConvo = localConversations.get(currentOpenConversationId);
                if (currentConvo) {
                    await openChatView(currentOpenConversationId);
                    chatInput.placeholder = 'Aguardando resposta...';
                    sendMessageBtn.style.filter = 'grayscale(1)';
                } else {
                    backToListBtn.click();
                }
                sendMessageBtn.style.pointerEvents = 'auto';
            }
        };

        if (sendMessageBtn) sendMessageBtn.onclick = handleSendMessage;
        if (chatInput) chatInput.onkeydown = e => { if (e.key === 'Enter' && !chatInput.disabled) handleSendMessage(); };

        if (deleteConvoBtn) {
            deleteConvoBtn.onclick = () => {
                if (!currentOpenConversationId) return;
                const convo = localConversations.get(currentOpenConversationId);
                const message = convo && convo.is_server_deleted
                    ? 'Tem certeza que deseja apagar ESTE HISTÓRICO? Esta ação a removerá permanentemente do seu cache local.'
                    : 'Tem certeza que deseja apagar esta conversa? Esta ação é irreversível e só apagará para você.';
                showConfirmModal(message, () => {
                    localConversations.delete(currentOpenConversationId);
                    saveToLocalStorage();
                    renderConversationList();
                    backToListBtn.click();
                    showFloatingMessage('Conversa apagada.');
                });
            };
        }
    }

    window.pvInitializationPromise = new Promise(async resolve => {
        await initializePV();
        resolve();
    });
});
