
import { supabase } from './supabaseClient.js';
import * as THREE from 'three';
import { initPostFX } from './postfx.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DE ROTAÇÃO  (epoch +1h para não viajar junto com o mercador)
// ─────────────────────────────────────────────────────────────────────────────

const CITIES      = ['capital', 'elendor', 'zion', 'mitrar', 'tandra', 'astrax', 'duratar'];
const CITY_LABELS = {
    capital: 'Capital', elendor: 'Elendor', zion: 'Zion',
    mitrar: 'Mitrar', tandra: 'Tandra', astrax: 'Astrax', duratar: 'Duratar'
};

const EPOCH   = new Date('2025-01-01T01:00:00Z').getTime(); // +1h vs mercador
const SLOT_MS = 24 * 60 * 60 * 1000;                        // 4 horas

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
        name:   'Receita: Foice da Noite Eterna (60%)',
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
            { id: 101, name: 'Receita de Fragmentos de Foice da Noite Eterna (100%)', qty: 1,
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

    // ── ARMADURA DA NOITE ETERNA ──────────────────────────────────────────────
    {
        id:     104,
        name:   'Receita: Armadura da Noite Eterna (60%)',
        type:   'armadura',
        chance: 60,
        img:    BASE + 'receita_de_fragmentos_de_armadura_da_noite_eterna_60.webp',
        output: {
            id:   103,
            name: 'Fragmento de Armadura da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_armadura_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Armadura da Noite Eterna',
            img:   BASE + 'armadura_da_noite_eterna.webp',
            stats: [
                { label: 'HP',           value: '1000' },
                { label: 'Redução CRIT', value: '15%'  },
            ],
        },
        materials: [
            { id: 104, name: 'Receita de Fragmentos de Armadura da Noite Eterna (60%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_armadura_da_noite_eterna_60.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comprando com o Mercador em alguma cidade.' },
            { id: 86,  name: 'Asa de Morcego',      qty: 68, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 54, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 48, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 41, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 67,  name: 'Pele Animal',         qty: 37, img: BASE + 'pele_animal.webp',
              source: '• Caçando Tigre Nix em Floresta Mística.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 79,  name: 'Mithril Temperado',   qty: 29, img: BASE + 'mithril_temperado.webp',
              source: '• Caçando Golem de Gelo em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 25, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 82,  name: 'Fios de Fibra',       qty: 21, img: BASE + 'fios_de_fibra.webp',
              source: '• Caçando Tenente Kelt em Ninho de Kelts.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 78,  name: 'Linha Mágica',        qty: 16, img: BASE + 'linha_magica.webp',
              source: '• Caçando Serafim em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 77,  name: 'Couro Animal',        qty: 11, img: BASE + 'couro_animal.webp',
              source: '• Caçando Javali em Pântano de Molinar.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },
    {
        id:     105,
        name:   'Receita: Armadura da Noite Eterna (100%)',
        type:   'armadura',
        chance: 100,
        img:    BASE + 'receita_de_fragmentos_de_armadura_da_noite_eterna_100.webp',
        output: {
            id:   103,
            name: 'Fragmento de Armadura da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_armadura_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Armadura da Noite Eterna',
            img:   BASE + 'armadura_da_noite_eterna.webp',
            stats: [
                { label: 'HP',           value: '1000' },
                { label: 'Redução CRIT', value: '15%'  },
            ],
        },
        materials: [
            { id: 105, name: 'Receita de Fragmentos de Armadura da Noite Eterna (100%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_armadura_da_noite_eterna_100.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 86,  name: 'Asa de Morcego',      qty: 78, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 64, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 58, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 51, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 67,  name: 'Pele Animal',         qty: 47, img: BASE + 'pele_animal.webp',
              source: '• Caçando Tigre Nix em Floresta Mística.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 79,  name: 'Mithril Temperado',   qty: 39, img: BASE + 'mithril_temperado.webp',
              source: '• Caçando Golem de Gelo em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 35, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 82,  name: 'Fios de Fibra',       qty: 31, img: BASE + 'fios_de_fibra.webp',
              source: '• Caçando Tenente Kelt em Ninho de Kelts.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 78,  name: 'Linha Mágica',        qty: 26, img: BASE + 'linha_magica.webp',
              source: '• Caçando Serafim em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 77,  name: 'Couro Animal',        qty: 21, img: BASE + 'couro_animal.webp',
              source: '• Caçando Javali em Pântano de Molinar.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },

    // ── ANEL DA NOITE ETERNA ──────────────────────────────────────────────────
    {
        id:     108,
        name:   'Receita: Anel da Noite Eterna (60%)',
        type:   'anel',
        chance: 60,
        img:    BASE + 'receita_de_fragmentos_de_anel_da_noite_eterna_60.webp',
        output: {
            id:   107,
            name: 'Fragmento de Anel da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_anel_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Anel da Noite Eterna',
            img:   BASE + 'anel_da_noite_eterna.webp',
            stats: [
                { label: 'ATK',          value: '30'  },
                { label: 'Redução CRIT', value: '15%' },
            ],
        },
        materials: [
            { id: 108, name: 'Receita de Fragmentos de Anel da Noite Eterna (60%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_anel_da_noite_eterna_60.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comprando com o Mercador em alguma cidade.' },
            { id: 86,  name: 'Asa de Morcego',      qty: 68, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 54, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 48, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 41, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 59,  name: 'Safira',              qty: 37, img: BASE + 'safira.webp',
              source: '• Caçando Arcanjo em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 79,  name: 'Mithril Temperado',   qty: 29, img: BASE + 'mithril_temperado.webp',
              source: '• Caçando Golem de Gelo em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 25, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 61,  name: 'Lápis-lazúli',        qty: 21, img: BASE + 'lapis_lazuli.webp',
              source: '• Caçando Naga em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 89,  name: 'Pedra Âmbar',         qty: 16, img: BASE + 'pedra_ambar.webp',
              source: '• Caçando Daz-Fandra em Desfiladeiro do Sol Poente.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 71,  name: 'Lágrima de Fênix',    qty: 11, img: BASE + 'lagrima_de_fenix.webp',
              source: '• Caçando Fênix em Floresta Mística.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },
    {
        id:     109,
        name:   'Receita: Anel da Noite Eterna (100%)',
        type:   'anel',
        chance: 100,
        img:    BASE + 'receita_de_fragmentos_de_anel_da_noite_eterna_100.webp',
        output: {
            id:   107,
            name: 'Fragmento de Anel da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_anel_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Anel da Noite Eterna',
            img:   BASE + 'anel_da_noite_eterna.webp',
            stats: [
                { label: 'ATK',          value: '30'  },
                { label: 'Redução CRIT', value: '15%' },
            ],
        },
        materials: [
            { id: 109, name: 'Receita de Fragmentos de Anel da Noite Eterna (100%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_anel_da_noite_eterna_100.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 86,  name: 'Asa de Morcego',      qty: 78, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 64, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 58, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 51, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 59,  name: 'Safira',              qty: 47, img: BASE + 'safira.webp',
              source: '• Caçando Arcanjo em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 79,  name: 'Mithril Temperado',   qty: 39, img: BASE + 'mithril_temperado.webp',
              source: '• Caçando Golem de Gelo em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 35, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 61,  name: 'Lápis-lazúli',        qty: 31, img: BASE + 'lapis_lazuli.webp',
              source: '• Caçando Naga em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 89,  name: 'Pedra Âmbar',         qty: 26, img: BASE + 'pedra_ambar.webp',
              source: '• Caçando Daz-Fandra em Desfiladeiro do Sol Poente.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 71,  name: 'Lágrima de Fênix',    qty: 21, img: BASE + 'lagrima_de_fenix.webp',
              source: '• Caçando Fênix em Floresta Mística.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },

    // ── COLAR DA NOITE ETERNA ─────────────────────────────────────────────────
    {
        id:     112,
        name:   'Receita: Colar da Noite Eterna (60%)',
        type:   'colar',
        chance: 60,
        img:    BASE + 'receita_de_fragmentos_de_colar_da_noite_eterna_60.webp',
        output: {
            id:   111,
            name: 'Fragmento de Colar da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_colar_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Colar da Noite Eterna',
            img:   BASE + 'colar_da_noite_eterna.webp',
            stats: [
                { label: 'Dano Crítico', value: '4%'  },
                { label: 'Redução CRIT', value: '15%' },
            ],
        },
        materials: [
            { id: 112, name: 'Receita de Fragmentos de Colar da Noite Eterna (60%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_colar_da_noite_eterna_60.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comprando com o Mercador em alguma cidade.' },
            { id: 86,  name: 'Asa de Morcego',      qty: 48, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 74, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 38, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 51, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 59,  name: 'Safira',              qty: 27, img: BASE + 'safira.webp',
              source: '• Caçando Arcanjo em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 79,  name: 'Mithril Temperado',   qty: 39, img: BASE + 'mithril_temperado.webp',
              source: '• Caçando Golem de Gelo em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 25, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 61,  name: 'Lápis-lazúli',        qty: 21, img: BASE + 'lapis_lazuli.webp',
              source: '• Caçando Naga em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 89,  name: 'Pedra Âmbar',         qty: 16, img: BASE + 'pedra_ambar.webp',
              source: '• Caçando Daz-Fandra em Desfiladeiro do Sol Poente.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 71,  name: 'Lágrima de Fênix',    qty: 11, img: BASE + 'lagrima_de_fenix.webp',
              source: '• Caçando Fênix em Floresta Mística.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },
    {
        id:     113,
        name:   'Receita: Colar da Noite Eterna (100%)',
        type:   'colar',
        chance: 100,
        img:    BASE + 'receita_de_fragmentos_de_colar_da_noite_eterna_100.webp',
        output: {
            id:   111,
            name: 'Fragmento de Colar da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_colar_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Colar da Noite Eterna',
            img:   BASE + 'colar_da_noite_eterna.webp',
            stats: [
                { label: 'Dano Crítico', value: '4%'  },
                { label: 'Redução CRIT', value: '15%' },
            ],
        },
        materials: [
            { id: 113, name: 'Receita de Fragmentos de Colar da Noite Eterna (100%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_colar_da_noite_eterna_100.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 86,  name: 'Asa de Morcego',      qty: 58, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 84, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 48, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 61, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 59,  name: 'Safira',              qty: 37, img: BASE + 'safira.webp',
              source: '• Caçando Arcanjo em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 79,  name: 'Mithril Temperado',   qty: 49, img: BASE + 'mithril_temperado.webp',
              source: '• Caçando Golem de Gelo em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 35, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 61,  name: 'Lápis-lazúli',        qty: 31, img: BASE + 'lapis_lazuli.webp',
              source: '• Caçando Naga em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 89,  name: 'Pedra Âmbar',         qty: 26, img: BASE + 'pedra_ambar.webp',
              source: '• Caçando Daz-Fandra em Desfiladeiro do Sol Poente.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 71,  name: 'Lágrima de Fênix',    qty: 21, img: BASE + 'lagrima_de_fenix.webp',
              source: '• Caçando Fênix em Floresta Mística.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },

    // ── ELMO DA NOITE ETERNA ──────────────────────────────────────────────────
    {
        id:     116,
        name:   'Receita: Elmo da Noite Eterna (60%)',
        type:   'elmo',
        chance: 60,
        img:    BASE + 'receita_de_fragmentos_de_elmo_da_noite_eterna_60.webp',
        output: {
            id:   115,
            name: 'Fragmento de Elmo da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_elmo_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Elmo da Noite Eterna',
            img:   BASE + 'elmo_da_noite_eterna.webp',
            stats: [
                { label: 'Defesa',       value: '20'  },
                { label: 'Redução CRIT', value: '15%' },
            ],
        },
        materials: [
            { id: 116, name: 'Receita de Fragmentos de Elmo da Noite Eterna (60%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_elmo_da_noite_eterna_60.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comprando com o Mercador em alguma cidade.' },
            { id: 86,  name: 'Asa de Morcego',      qty: 48, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 74, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 38, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 51, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 59,  name: 'Safira',              qty: 27, img: BASE + 'safira.webp',
              source: '• Caçando Arcanjo em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 79,  name: 'Mithril Temperado',   qty: 39, img: BASE + 'mithril_temperado.webp',
              source: '• Caçando Golem de Gelo em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 25, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 61,  name: 'Lápis-lazúli',        qty: 21, img: BASE + 'lapis_lazuli.webp',
              source: '• Caçando Naga em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 89,  name: 'Pedra Âmbar',         qty: 16, img: BASE + 'pedra_ambar.webp',
              source: '• Caçando Daz-Fandra em Desfiladeiro do Sol Poente.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 65,  name: 'Reagente Ômega',      qty: 11, img: BASE + 'reagente_omega.webp',
              source: '• Caçando Larva Kelt em Covil de Kelts.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },
    {
        id:     117,
        name:   'Receita: Elmo da Noite Eterna (100%)',
        type:   'elmo',
        chance: 100,
        img:    BASE + 'receita_de_fragmentos_de_elmo_da_noite_eterna_100.webp',
        output: {
            id:   115,
            name: 'Fragmento de Elmo da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_elmo_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Elmo da Noite Eterna',
            img:   BASE + 'elmo_da_noite_eterna.webp',
            stats: [
                { label: 'Defesa',       value: '20'  },
                { label: 'Redução CRIT', value: '15%' },
            ],
        },
        materials: [
            { id: 117, name: 'Receita de Fragmentos de Elmo da Noite Eterna (100%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_elmo_da_noite_eterna_100.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 86,  name: 'Asa de Morcego',      qty: 58, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 84, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 48, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 61, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 59,  name: 'Safira',              qty: 37, img: BASE + 'safira.webp',
              source: '• Caçando Arcanjo em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 79,  name: 'Mithril Temperado',   qty: 49, img: BASE + 'mithril_temperado.webp',
              source: '• Caçando Golem de Gelo em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 81,  name: 'Minério de Ferro',    qty: 35, img: BASE + 'minerio_de_ferro.webp',
              source: '• Caçando Fenrir Montanhês em Razar.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 61,  name: 'Lápis-lazúli',        qty: 31, img: BASE + 'lapis_lazuli.webp',
              source: '• Caçando Naga em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 89,  name: 'Pedra Âmbar',         qty: 26, img: BASE + 'pedra_ambar.webp',
              source: '• Caçando Daz-Fandra em Desfiladeiro do Sol Poente.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 65,  name: 'Reagente Ômega',      qty: 21, img: BASE + 'reagente_omega.webp',
              source: '• Caçando Larva Kelt em Covil de Kelts.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },

    // ── ASA DA NOITE ETERNA ───────────────────────────────────────────────────
    {
        id:     120,
        name:   'Receita: Asa da Noite Eterna (60%)',
        type:   'asa',
        chance: 60,
        img:    BASE + 'receita_de_fragmentos_de_asa_da_noite_eterna_60.webp',
        output: {
            id:   119,
            name: 'Fragmento de Asa da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_asa_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Asa da Noite Eterna',
            img:   BASE + 'asa_da_noite_eterna.webp',
            stats: [
                { label: 'ATK',          value: '22'  },
                { label: 'Redução CRIT', value: '15%' },
            ],
        },
        materials: [
            { id: 120, name: 'Receita de Fragmentos de Asa da Noite Eterna (60%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_asa_da_noite_eterna_60.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comprando com o Mercador em alguma cidade.' },
            { id: 86,  name: 'Asa de Morcego',      qty: 78, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 54, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 28, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 51, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 63,  name: 'Lubrificante',        qty: 27, img: BASE + 'lubrificante.webp',
              source: '• Caçando Pixie em Vale Arcano.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 56,  name: 'Porífero',            qty: 39, img: BASE + 'porifero.webp',
              source: '• Caçando Líder Porífero em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 78,  name: 'Linha Mágica',        qty: 25, img: BASE + 'linha_magica.webp',
              source: '• Caçando Serafim em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 61,  name: 'Lápis-lazúli',        qty: 21, img: BASE + 'lapis_lazuli.webp',
              source: '• Caçando Naga em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 89,  name: 'Pedra Âmbar',         qty: 16, img: BASE + 'pedra_ambar.webp',
              source: '• Caçando Daz-Fandra em Desfiladeiro do Sol Poente.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 65,  name: 'Reagente Ômega',      qty: 11, img: BASE + 'reagente_omega.webp',
              source: '• Caçando Larva Kelt em Covil de Kelts.\n• Comércio entre jogadores (por mensagem privada).' },
        ],
    },
    {
        id:     121,
        name:   'Receita: Asa da Noite Eterna (100%)',
        type:   'asa',
        chance: 100,
        img:    BASE + 'receita_de_fragmentos_de_asa_da_noite_eterna_100.webp',
        output: {
            id:   119,
            name: 'Fragmento de Asa da Noite Eterna',
            qty:  30,
            img:  BASE + 'fragmento_de_asa_da_noite_eterna.webp',
        },
        finalItem: {
            name:  'Asa da Noite Eterna',
            img:   BASE + 'asa_da_noite_eterna.webp',
            stats: [
                { label: 'ATK',          value: '22'  },
                { label: 'Redução CRIT', value: '15%' },
            ],
        },
        materials: [
            { id: 121, name: 'Receita de Fragmentos de Asa da Noite Eterna (100%)', qty: 1,
              img: BASE + 'receita_de_fragmentos_de_asa_da_noite_eterna_100.webp',
              source: '• Chance de drop no Chefe Mundial.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 86,  name: 'Asa de Morcego',      qty: 88, img: BASE + 'asa_de_morcego.webp',
              source: '• Caçando Morcego em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 87,  name: 'Emblema Vampírico',   qty: 64, img: BASE + 'emblema_vampirico.webp',
              source: '• Caçando Vampiro em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 70,  name: 'Sal de Cobalto',      qty: 38, img: BASE + 'sal_de_cobalto.webp',
              source: '• Caçando Zumbi em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 76,  name: 'Pó Ósseo',            qty: 61, img: BASE + 'po_osseo.webp',
              source: '• Caçando Caveira em Penumbra Uivante.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 63,  name: 'Lubrificante',        qty: 37, img: BASE + 'lubrificante.webp',
              source: '• Caçando Pixie em Vale Arcano.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 56,  name: 'Porífero',            qty: 49, img: BASE + 'porifero.webp',
              source: '• Caçando Líder Porífero em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 78,  name: 'Linha Mágica',        qty: 35, img: BASE + 'linha_magica.webp',
              source: '• Caçando Serafim em Enclave Etéreo.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 61,  name: 'Lápis-lazúli',        qty: 31, img: BASE + 'lapis_lazuli.webp',
              source: '• Caçando Naga em Queda Fontana.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 89,  name: 'Pedra Âmbar',         qty: 26, img: BASE + 'pedra_ambar.webp',
              source: '• Caçando Daz-Fandra em Desfiladeiro do Sol Poente.\n• Comércio entre jogadores (por mensagem privada).' },
            { id: 65,  name: 'Reagente Ômega',      qty: 21, img: BASE + 'reagente_omega.webp',
              source: '• Caçando Larva Kelt em Covil de Kelts.\n• Comércio entre jogadores (por mensagem privada).' },
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
                '<img src="' + OF_NPC_IMAGE_URL + '" class="oficina-absent-img" alt="Artesão">' +
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
        url('https://aden-rpg.pages.dev/assets/anao_oficina.png');
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
@media (max-width: 480px) {
    .oficina-chain { flex-direction: column; align-items: center; }
    .oficina-chain-arrow { margin: 2px 0; transform: rotate(90deg); }
    .oficina-chain-step { max-width: 220px; }
}
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

// ════════════════════════════════════════════════════════════════════════════
// FERREIRO (OFICINA) — CENÁRIO 3D (skybox próprio + NPC clicável)
// Mesmo padrão do Mestre de Poções (ver mitrar.js) e do Mercador (ver
// mercador.js): ao clicar no hotspot "Ferreiro" da cidade, se o Artesão
// estiver presente nesta cidade agora, abre-se primeiro este "cômodo" 360°
// com o NPC dentro do mundo 3D — um sprite billboard (sempre de frente pra
// câmera, nunca entorta ao girar). Só ao clicar NELE é que a oficina de
// fato (#oficinaModal, injetado dinamicamente por injectOficinaModal) abre
// por cima. Se o Artesão NÃO estiver nesta cidade agora, mantém o
// comportamento antigo: abre direto o aviso de que ele está em outra
// cidade (agora com o avatar do NPC — ver OF_NPC_IMAGE_URL, também usado
// dentro do aviso de ausência em openOficinaModal()).
//
// Como oficina.js roda em TODAS as cidades (o Artesão viaja entre elas), a
// cena e a imagem do NPC são as MESMAS em qualquer cidade — só a checagem
// de presença muda (getOficinaState() + window.MERCHANT_CITY, já existente
// acima). O cenário/modal/estilos são criados dinamicamente aqui (mesmo
// padrão de injectOficinaModal), então nenhum HTML precisa ser tocado nas
// 7 páginas de cidade.
// ════════════════════════════════════════════════════════════════════════════

const OF_SCENE_IMAGE_URL = 'https://aden-rpg.pages.dev/assets/anao_oficina.webp'; // mesma imagem do fundo do modal da oficina
const OF_NPC_IMAGE_URL   = 'https://aden-rpg.pages.dev/assets/npc_ferreiro.webp';
const OF_TUTORIAL_KEY    = 'ofTutorialSeen'; // sem sufixo de cidade: o Artesão viaja, o tutorial é o mesmo em qualquer lugar
const OF_NPC_PROXY_ID    = 'ofNpcSpot'; // elemento DOM invisível — só recebe .click() sintético quando o raycaster acerta o sprite

// Onde o Artesão fica DENTRO do cenário 360° (mundo 3D, não a tela).
// CALIBRAÇÃO: abra a página com ?debugSpots=1, entre no cenário do Ferreiro
// (ele precisa estar presente nesta cidade no momento) e clique perto de
// onde ele deveria ficar — aparece um tooltip com yaw/pitch. Copie os
// números para cá.
const OF_NPC_SPOT = {
    yaw: 0, pitch: -54,
    distance: 250,
    heightFrac: 0.34,
};

const OF_INITIAL_YAW = 0, OF_INITIAL_PITCH = -6, OF_INITIAL_FOV = 110;
const OF_FOV_MIN = 75, OF_FOV_MAX = 110;
const OF_START_FOV = OF_FOV_MAX;
const OF_PITCH_LIMIT = 89;

let ofYaw = OF_INITIAL_YAW, ofPitch = OF_INITIAL_PITCH, ofFov = OF_START_FOV;

let _ofSky = null;
let _ofNpcSprite = null, _ofNpcMaterial = null;
let _ofNpcBaseScale = { x: 1, y: 1 };
let _ofNpcShadowSprite = null;
let _oficinaSceneActive = false; // true quando a oficina foi aberta a partir do cenário 3D (Artesão presente)

// Mesmo efeito de "flash pra preto e volta" usado nas cidades ao sair de
// uma loja (ver instantFadeThenReveal em mitrar.js) — replicado aqui de
// forma independente porque #screenFade é um elemento comum a todas as
// páginas de cidade, então não precisamos tocar nos scripts delas.
function ofFlashScreenFade() {
    const fade = document.getElementById('screenFade');
    if (!fade) return;
    fade.style.transition = 'none';
    fade.classList.add('active');
    requestAnimationFrame(() => {
        fade.style.transition = 'opacity .45s ease';
        requestAnimationFrame(() => fade.classList.remove('active'));
    });
}

function injectOficinaSceneStyles() {
    if (document.getElementById('ofSceneStyles')) return;
    const style = document.createElement('style');
    style.id = 'ofSceneStyles';
    style.textContent = `
#oficinaSceneModal {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 3000;
    background-color: #0d1a0d;
    overflow: hidden;
}
#ofSceneContainer { position: absolute; inset: 0; overflow: hidden; }
#ofSceneCanvas {
    position: absolute; top: 0; left: 0;
    width: 100%; height: 100%;
    display: block; outline: none; cursor: grab;
}
#ofSceneCanvas.dragging { cursor: grabbing; }
#ofSceneMap {
    position: absolute; top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none; user-select: none;
}
.of-tutorial-overlay {
    position: absolute; inset: 0; z-index: 5;
    pointer-events: none; opacity: 0;
    transition: opacity .35s ease;
    background: radial-gradient(circle at var(--of-spot-x, 50%) var(--of-spot-y, 45%),
        rgba(0,0,0,0) 0%, rgba(0,0,0,0) var(--of-spot-r, 18%),
        rgba(0,0,0,0.5) calc(var(--of-spot-r, 18%) + 22%));
}
.of-tutorial-overlay.active { opacity: 1; }
.of-tutorial-text {
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
.of-tutorial-text.active { opacity: 1; transform: translateY(0); }
.of-scene-exit-btn {
    position: absolute; top: 14px; right: 14px; z-index: 30;
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55);
    border: 1px solid rgba(255,215,120,0.55);
    border-radius: 50%; cursor: pointer; color: #ffd77a;
    box-shadow: 0 2px 10px rgba(0,0,0,0.5);
}
.of-scene-exit-btn:hover { background: rgba(0,0,0,0.75); }
.of-scene-exit-btn svg { width: 20px; height: 20px; }
`;
    document.head.appendChild(style);
}

function injectOficinaSceneModal() {
    if (document.getElementById('oficinaSceneModal')) return;
    const div = document.createElement('div');
    div.id = 'oficinaSceneModal';
    div.innerHTML = `
        <div id="ofSceneContainer">
            <canvas id="ofSceneCanvas"></canvas>
            <div id="ofSceneMap">
                <div id="${OF_NPC_PROXY_ID}" style="display:none;" aria-hidden="true"></div>
            </div>
            <div id="ofSceneTutorialOverlay" class="of-tutorial-overlay"></div>
            <div id="ofSceneTutorialText" class="of-tutorial-text">👆 Clique no ferreiro para forjar!</div>
            <div id="closeOficinaSceneBtn" class="of-scene-exit-btn" title="Sair">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
            </div>
        </div>`;
    document.body.appendChild(div);
    document.getElementById('closeOficinaSceneBtn').addEventListener('click', closeOficinaScene);
}

function ofYawPitchToVector(yawDeg, pitchDeg, radius = 1) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    return new THREE.Vector3(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(yaw) * Math.cos(pitch)
    );
}

function updateOfCameraLook() {
    if (!_ofSky) return;
    ofPitch = Math.max(-OF_PITCH_LIMIT, Math.min(OF_PITCH_LIMIT, ofPitch));
    ofFov   = Math.max(OF_FOV_MIN, Math.min(OF_FOV_MAX, ofFov));
    _ofSky.camera.fov = ofFov;
    _ofSky.camera.updateProjectionMatrix();
    const dir = ofYawPitchToVector(ofYaw, ofPitch, 1);
    _ofSky.camera.lookAt(dir.x, dir.y, dir.z);
}

// Sombra de contato do NPC — mesma técnica usada no Mestre de Poções
// (ver createPmShadowTexture em mitrar.js): gradiente radial num <canvas>,
// aplicado como sprite (blend alfa padrão, não multiply).
function createOfShadowTexture() {
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

function initOficinaSkybox() {
    const cont   = document.getElementById('ofSceneContainer');
    const canvas = document.getElementById('ofSceneCanvas');
    const map    = document.getElementById('ofSceneMap');
    if (!cont || !canvas || !map || _ofSky) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(ofFov, cont.clientWidth / cont.clientHeight, 0.1, 1000);
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
        OF_SCENE_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            material.map = tex;
            material.color.set(0xffffff);
            material.needsUpdate = true;
        },
        undefined,
        (err) => console.error('[Ferreiro] Falha ao carregar o skybox do cenário:', err)
    );

    _ofSky = { scene, camera, renderer, canvas, cont };

    // Mesmo pós-processamento (bloom, grading de cor, motion blur) do resto
    // do jogo — em try/catch: se falhar, a cena continua com render padrão.
    try {
        _ofSky.pfx = initPostFX({ scene, camera, renderer, cont, mapEl: map });
    } catch (e) {
        console.error('[PostFX] Falha ao iniciar pós-processamento no cenário do Ferreiro:', e);
        _ofSky.pfx = null;
    }

    updateOfCameraLook();

    window.addEventListener('resize', () => {
        if (!_ofSky || !cont.offsetParent) return;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (_ofSky.pfx) {
            try { _ofSky.pfx.resize(w, h); } catch (e) { console.error('[PostFX] Erro no resize:', e); }
        }
    });

    (function loop() {
        requestAnimationFrame(loop);
        if (!cont.offsetParent) return; // cenário fechado — não desperdiça frame
        if (_ofSky.pfx) {
            try {
                _ofSky.pfx.render(scene, camera);
            } catch (e) {
                console.error('[PostFX] Erro ao renderizar o cenário do Ferreiro, desativando efeitos:', e);
                _ofSky.pfx = null;
                renderer.render(scene, camera);
            }
        } else {
            renderer.render(scene, camera);
        }
        updateOfTutorialSpotlight();
    })();

    initOfNpcSprite();
    enableOfSceneInteraction();
    initOfNpcClickHandler();
}

// NPC como sprite 3D — sempre de frente pra câmera (billboard), nunca
// entorta ao girar, e continua fixo na posição dele dentro do cenário.
function initOfNpcSprite() {
    if (!_ofSky) return;
    new THREE.TextureLoader().load(
        OF_NPC_IMAGE_URL,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            _ofNpcMaterial = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
            const sprite = new THREE.Sprite(_ofNpcMaterial);
            sprite.center.set(0.5, 0);

            const aspect = tex.image.width / tex.image.height;
            const fovRad = THREE.MathUtils.degToRad(OF_INITIAL_FOV);
            const worldHeight = 2 * OF_NPC_SPOT.distance * Math.tan(fovRad / 2) * OF_NPC_SPOT.heightFrac;
            const worldWidth = worldHeight * aspect;
            sprite.scale.set(worldWidth, worldHeight, 1);
            _ofNpcBaseScale = { x: worldWidth, y: worldHeight };

            sprite.position.copy(ofYawPitchToVector(OF_NPC_SPOT.yaw, OF_NPC_SPOT.pitch, OF_NPC_SPOT.distance));
            sprite.renderOrder = 999;

            _ofSky.scene.add(sprite);
            _ofNpcSprite = sprite;

            const shadowMaterial = new THREE.SpriteMaterial({
                map: createOfShadowTexture(),
                transparent: true,
                depthWrite: false,
                depthTest: false,
            });
            const shadowSprite = new THREE.Sprite(shadowMaterial);
            shadowSprite.center.set(0.5, 0.5);
            shadowSprite.scale.set(worldWidth * (86 / 125), worldHeight * (26 / 160), 1);
            shadowSprite.position.copy(sprite.position);
            shadowSprite.renderOrder = 998;
            _ofSky.scene.add(shadowSprite);
            _ofNpcShadowSprite = shadowSprite;

            initOfNpcBreathing();
        },
        undefined,
        (err) => console.error('[Ferreiro] Falha ao carregar o NPC:', err)
    );
}

// Clique no NPC (raycast) — abre a oficina; fora dele, com ?debugSpots=1,
// mostra o yaw/pitch do clique pra calibrar OF_NPC_SPOT.
function initOfNpcClickHandler() {
    const canvas = document.getElementById('ofSceneCanvas');
    if (!canvas || canvas._ofClickBound) return;
    canvas._ofClickBound = true;

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
        if (moved || !_ofSky) return;
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -(((e.clientY - rect.top) / rect.height) * 2 - 1)
        );
        raycaster.setFromCamera(ndc, _ofSky.camera);

        if (_ofNpcSprite) {
            const hit = raycaster.intersectObject(_ofNpcSprite)[0];
            if (hit) {
                const proxy = document.getElementById(OF_NPC_PROXY_ID);
                if (proxy) proxy.click();
                return;
            }
        }

        if (debugOn) {
            const dir = raycaster.ray.direction.clone().normalize();
            const yaw   = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
            const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
            const txt = `yaw: ${yaw.toFixed(1)}, pitch: ${pitch.toFixed(1)}`;
            console.log('[debugSpots][Ferreiro]', txt);

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
function updateOfTutorialSpotlight() {
    const overlay = document.getElementById('ofSceneTutorialOverlay');
    if (!overlay || !overlay.classList.contains('active') || !_ofSky || !_ofNpcSprite) return;
    const { camera, cont } = _ofSky;
    const cw = cont.clientWidth, ch = cont.clientHeight;
    if (!cw || !ch) return;

    const worldPoint = _ofNpcSprite.position.clone();
    worldPoint.y += _ofNpcBaseScale.y * 0.55;
    const proj = worldPoint.project(camera);
    if (proj.z > 1) return;

    const sx = (proj.x * 0.5 + 0.5) * cw;
    const sy = (1 - (proj.y * 0.5 + 0.5)) * ch;
    overlay.style.setProperty('--of-spot-x', ((sx / cw) * 100).toFixed(1) + '%');
    overlay.style.setProperty('--of-spot-y', ((sy / ch) * 100).toFixed(1) + '%');
    overlay.style.setProperty('--of-spot-r', '16%');
}

// DRAG / PINCH / WHEEL do cenário — livre nos dois eixos.
function enableOfSceneInteraction() {
    const cont   = document.getElementById('ofSceneContainer');
    const canvas = document.getElementById('ofSceneCanvas');
    if (!canvas || !cont || cont._interactionEnabled) return;
    cont._interactionEnabled = true;

    let vx = 0, vy = 0, lt = 0, aId = null;
    const FRICTION = 0.94;
    const DRAG_SENS = 1.0;

    let drag = false, sx = 0, sy = 0;
    let isPinching = false;
    let pinchStartDist = 0, pinchStartFov = ofFov;

    canvas.style.touchAction = 'none';
    canvas.style.userSelect  = 'none';

    function degPerPx() { return ofFov / (cont.clientHeight || window.innerHeight); }

    function applyDelta(dx, dy) {
        const dpp = degPerPx();
        ofYaw   += dx * dpp * DRAG_SENS;
        ofPitch += dy * dpp * DRAG_SENS;
        updateOfCameraLook();
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
            pinchStartFov  = ofFov;
        } else if (e.touches.length === 1 && !isPinching) {
            startDrag(e);
        }
    }

    function onTouchMove(e) {
        if (e.touches.length >= 2 && isPinching) {
            e.preventDefault();
            const ratio = touchDist(e) / pinchStartDist;
            ofFov = pinchStartFov / ratio;
            updateOfCameraLook();
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
        ofFov += e.deltaY * 0.05;
        updateOfCameraLook();
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
function initOfNpcBreathing() {
    if (!_ofNpcSprite || _ofNpcSprite._ofBreathingStarted) return;
    _ofNpcSprite._ofBreathingStarted = true;

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

        if (document.hidden || !_ofSky || !_ofSky.cont.offsetParent) {
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

        if (_ofNpcSprite) {
            _ofNpcSprite.scale.set(_ofNpcBaseScale.x * scaleX, _ofNpcBaseScale.y * scaleY, 1);
        }
        if (_ofNpcMaterial) {
            _ofNpcMaterial.rotation = THREE.MathUtils.degToRad(rotateDeg);
        }

        if (_ofNpcShadowSprite) {
            const shadowScale = 1 + Math.max(0, breathAmount) * 0.12;
            const shadowOpacity = 0.82 - Math.max(0, breathAmount) * 0.08;
            _ofNpcShadowSprite.scale.set(
                _ofNpcBaseScale.x * (86 / 125) * shadowScale,
                _ofNpcBaseScale.y * (26 / 160) * shadowScale,
                1
            );
            _ofNpcShadowSprite.material.opacity = Math.min(1, Math.max(0.35, shadowOpacity));
        }

        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

// Tutorial "clique no ferreiro" — só na 1ª vez, nunca mais repete (chave
// global, sem sufixo de cidade, já que o Artesão viaja).
function ofShouldShowTutorial() {
    try { return localStorage.getItem(OF_TUTORIAL_KEY) !== '1'; } catch { return true; }
}
function ofMarkTutorialSeen() {
    try { localStorage.setItem(OF_TUTORIAL_KEY, '1'); } catch {}
}
function showOfTutorial() {
    const overlay = document.getElementById('ofSceneTutorialOverlay');
    const text = document.getElementById('ofSceneTutorialText');
    const cont = document.getElementById('ofSceneContainer');
    if (!overlay || !text || !cont) return;
    overlay.classList.add('active');
    text.classList.add('active');

    function dismiss() {
        overlay.classList.remove('active');
        text.classList.remove('active');
        ofMarkTutorialSeen();
    }
    cont.addEventListener('click', dismiss, { capture: true, once: true });
}

// Abrir / fechar o cenário 3D do Ferreiro.
function openOficinaScene() {
    injectOficinaSceneModal();
    const modal = document.getElementById('oficinaSceneModal');
    if (!modal) return;
    modal.style.display = 'block';
    if (!_ofSky) {
        initOficinaSkybox();
    } else {
        ofYaw = OF_INITIAL_YAW; ofPitch = OF_INITIAL_PITCH; ofFov = OF_START_FOV;
        updateOfCameraLook();
        const { camera, renderer, cont } = _ofSky;
        const w = cont.clientWidth, h = cont.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    if (ofShouldShowTutorial()) showOfTutorial();
}

function closeOficinaScene() {
    const modal = document.getElementById('oficinaSceneModal');
    if (modal) modal.style.display = 'none';
    ofFlashScreenFade(); // volta pra cidade — mesmo efeito do closePmSceneBtn
}

// Clique no hotspot da cidade: se o Artesão estiver aqui agora, abre o
// cenário 3D (o clique NO NPC dentro dele é que abre a oficina de fato);
// se não estiver, mantém o comportamento antigo — abre direto o aviso de
// ausência dentro do próprio #oficinaModal.
function handleOficinaHotspotClick() {
    const state = getOficinaState();
    const thisCity = (window.MERCHANT_CITY || '').toLowerCase();
    if (state.currentCity !== thisCity) {
        _oficinaSceneActive = false;
        openOficinaModal();
    } else {
        openOficinaScene();
    }
}

// Delegação no document: funciona mesmo antes do proxy existir (ele só é
// criado na 1ª vez que o cenário abre, via injectOficinaSceneModal).
function initOficinaSceneNpcProxy() {
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === OF_NPC_PROXY_ID) {
            _oficinaSceneActive = true;
            openOficinaModal();
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    injectOficinaStyles();
    injectOficinaSceneStyles();
    initOficinaSceneNpcProxy();

    var openBtn = document.getElementById('btnOficina');
    if (openBtn) {
        openBtn.addEventListener('click', function() { handleOficinaHotspotClick(); });
    }

    // Fechar o modal principal (injetado dinamicamente)
    document.body.addEventListener('click', function(e) {
        if (e.target.id === 'closeOficinaBtn') {
            var m = document.getElementById('oficinaModal');
            if (m) m.style.display = 'none';
            if (_countdownInterval) clearInterval(_countdownInterval);
            if (_oficinaSceneActive) {
                // Veio do cenário 3D (Artesão presente) — volta pra ele,
                // sem flash, igual ao closePotionMasterBtn em mitrar.html.
                var sceneModal = document.getElementById('oficinaSceneModal');
                if (sceneModal) sceneModal.style.display = 'block';
            } else {
                // Aviso de ausência — fecha direto pra cidade, com flash.
                ofFlashScreenFade();
            }
        }
    });
});
