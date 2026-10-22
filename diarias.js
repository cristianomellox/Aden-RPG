// =====================================================================
// diarias.js — Missões Diárias do Mestre (Aden RPG)
// Fluxo: lobby (inscrição/espera) → palco (Gemini Live por voz) → resultado.
// O servidor (Edge Functions + RPCs) decide dados, tempo e recompensas.
// =====================================================================
import { supabase } from './supabaseClient.js';

const ASSETS = 'https://aden-rpg.pages.dev/assets/';
const SCENE_BASE = ASSETS + 'missoes/';                    // <id do cenário>.webp
const GENAI_URL = 'https://cdn.jsdelivr.net/npm/@google/genai/+esm';
const POLL_MS = 20000;
const SEND_CHUNK = 1280;                                   // 80 ms de áudio a 16 kHz
const WARN_AT_S = 120;                                     // aviso: restam 2 min → cenas finais
const END_AT_S = 60;                                       // ENCERRAR: resta 1 min
const EARLY_END_GUARD_S = 150;                             // end_adventure é recusado antes disso (exceto se o herói cair)
const EXTRA_COST_FALLBACK = 25;
const BAG_SIZE = 8;
const HEAL_POTION = 20;                                    // % de HP da poção de cura
const BOSS_MAX_HIT = 25;                                   // dano máximo (%) por golpe em chefe (luta longa)
const PLAYER_MAX_HIT = 35;                                 // dano máximo (%) por evento no herói
const MIN_HIT_COMMON = 25;                                 // dano mínimo (%) de um golpe em criatura comum (morre em até 4 golpes)
const ENEMY_IMG = ASSETS + 'mission_ene.webp';
const DEFAULT_AVATAR = 'https://aden-rpg.pages.dev/avatar01.webp';
const GLOBAL_DB_NAME = 'aden_global_db', GLOBAL_DB_VERSION = 8;
// marcos de ritmo enviados ao Mestre (segundos desde o início da sessão)
const MARKS = [
    { at: 180, text: '[SISTEMA] MARCO (3 min de 15), NÃO responda falando agora; aplique na sua próxima fala: se o herói ainda não recebeu a missão, entregue-a agora e inicie a JORNADA (viagem, estalagens, NPCs, pistas).' },
    { at: 480, text: '[SISTEMA] MARCO (8 min de 15), NÃO responda falando agora; aplique na sua próxima fala: aproxime o herói do lugar do objetivo. Gere tensão e prepare o CHEFE, cuja luta deve ser longa e emocionante.' },
];
const GIVEUP_AFTER_S = 75;                                 // sem fim após 15:00 + 75 s → envia nota neutra

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const nf = (n) => Number(n || 0).toLocaleString('pt-BR');
const mmss = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

const ERR = {
    already_today: 'Você já realizou sua aventura de hoje.',
    event_closed: 'O Mestre já partiu deste lugar.',
    event_full: 'As três vagas já foram preenchidas.',
    too_early: 'Ainda não é a sua hora.',
    too_late: 'O tempo de tolerância acabou.',
    slot_not_reserved: 'Esta vaga não está mais disponível.',
    slot_not_active: 'A aventura já terminou.',
    not_allowed: 'Sua conta não pode participar.',
    gemini_token_failed: 'O Mestre não respondeu. Tente novamente em instantes.',
    unauthorized: 'Sessão expirada. Entre novamente no jogo.',
    free_not_used: 'Use primeiro a sua aventura gratuita de hoje.',
    extra_already_today: 'Você já usou a aventura extra de hoje.',
    not_enough_gold: 'Você não tem ouro suficiente.',
    no_theme: 'O Mestre ainda não tem aventuras preparadas.',
    invalid_loadout: 'Escolha exatamente 8 itens para a bolsa.',
    extra_limit: 'Você já usou todas as aventuras extras de hoje.',
    extra_pending: 'Você já tem uma aventura extra esperando por você.',
};
const friendly = (m) => ERR[String(m || '').trim()] || 'Algo deu errado. Tente novamente.';

function showDebug(title, text) {
    $('errTitle').textContent = title || 'Algo deu errado';
    $('errText').textContent = String(text || '(sem detalhes)');
    openOv('errModal');
}

const S = {
    uid: null, offset: 0, state: null, scenes: {}, poll: null, tick: null,
    view: 'lobby', busy: false, adv: null, hero: null, bag: [],
};
const serverNow = () => Date.now() + S.offset;

// ---------------------------------------------------------------------
// Utilidades de UI
// ---------------------------------------------------------------------
function toast(msg, isErr = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3600);
}
const openOv = (id) => { $(id).classList.add('open'); $(id).setAttribute('aria-hidden', 'false'); };
const closeOv = (id) => { $(id).classList.remove('open'); $(id).setAttribute('aria-hidden', 'true'); };
function busy(on, text) {
    S.busy = on;
    if (text) $('busyText').textContent = text;
    on ? openOv('busyOverlay') : closeOv('busyOverlay');
}
function showView(v) {
    S.view = v;
    ['Lobby', 'Stage', 'Result'].forEach((n) => $('view' + n).classList.toggle('active', n.toLowerCase() === v));
}
const sceneLabel = (id) => S.scenes[id] || String(id || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

async function callFn(name, body) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
        let msg = error.message, detail = '';
        try { const j = await error.context.json(); msg = j.error || msg; detail = j.detail || ''; } catch (_) { /* ignora */ }
        const err = new Error(msg); err.detail = detail;
        throw err;
    }
    if (data && data.error) throw new Error(data.error);
    return data;
}

// Cenário: tenta o asset; se não existir, usa um degradê temático
const FALLBACK_BG = {
    floresta: 'radial-gradient(ellipse at 50% 35%, #1d3d27, #07130b)',
    caverna: 'radial-gradient(ellipse at 50% 35%, #2b2347, #0a0814)',
    ruinas: 'radial-gradient(ellipse at 50% 35%, #4a3b27, #120d08)',
    vila: 'radial-gradient(ellipse at 50% 35%, #4a3317, #140d06)',
    montanha: 'radial-gradient(ellipse at 50% 35%, #2a3f57, #070b12)',
    pantano: 'radial-gradient(ellipse at 50% 35%, #25402f, #08110c)',
};
const _sceneOk = new Map();                                   // id → true/false (evita pedir a mesma imagem de novo)
function paintScene(el, sceneId) {
    if (!sceneId) { el.style.backgroundImage = ''; return; }
    const url = SCENE_BASE + encodeURIComponent(sceneId) + '.webp';
    const apply = (ok) => { el.style.backgroundImage = ok ? `url("${url}")` : (FALLBACK_BG[sceneId] || ''); };
    if (_sceneOk.has(sceneId)) return apply(_sceneOk.get(sceneId));
    const img = new Image();
    img.onload = () => { _sceneOk.set(sceneId, true); apply(true); };
    img.onerror = () => { _sceneOk.set(sceneId, false); apply(false); };
    img.src = url;
}

// ---------------------------------------------------------------------
// MENU LATERAL (mesmo padrão da Mineração)
// ---------------------------------------------------------------------
function buildMenu() {
    const CURRENT = 'diarias.html';
    const A = ASSETS;
    const items = [
        { name: 'Tela inicial', url: 'index.html', icon: A + 'homeic.webp' },
        { name: 'Aventura AFK', url: 'afk.html', icon: A + 'expm.webp' },
        { name: 'Mineração', url: 'mines.html', icon: A + 'recursos.webp' },
        { name: 'Missões', icon: A + 'iconmissao.webp', isDropdown: true, subItems: [{ name: 'Diárias', url: 'diarias.html' }] },
        {
            name: 'Áreas de Caça', icon: A + 'mapicon.webp', isDropdown: true, subItems: [
                { name: 'Covil de Kelts', url: 'covil_de_kelts.html' }, { name: 'Desfiladeiro', url: 'desfiladeiro.html' },
                { name: 'Enclave Etéreo', url: 'enclave_etereo.html' }, { name: 'Erbária', url: 'erbaria.html' },
                { name: 'Floresta Mística', url: 'floresta_mistica.html' }, { name: 'Pântano de Molinar', url: 'pantano_de_molinar.html' },
                { name: 'Penumbra Uivante', url: 'penumbra_uivante.html' }, { name: 'Queda Fontana', url: 'queda_fontana.html' },
                { name: 'Razar', url: 'razar.html' }, { name: 'Vale Arcano', url: 'vale_arcano.html' },
            ],
        },
        { name: 'Masmorras', icon: A + 'dgs.webp', isDropdown: true, subItems: [{ name: 'Ruínas Ancestrais', url: 'ruins.html' }] },
        { name: 'Arena PvP', url: 'arena.html', icon: A + 'pvp.webp' },
        { name: 'Chefe Mundial', url: 'solo_boss.html', icon: A + 'bossm.webp' },
        { name: 'Guilda', url: 'guild.html', icon: A + 'guilda.webp' },
        { name: 'Bolsa', url: 'inventory.html', icon: A + 'iconbolsa.webp' },
        { name: 'Ranking', url: 'ranking_cp.html', icon: A + 'iconranking.webp' },
        { name: 'Títulos', url: 'titulos.html', icon: A + 'icontitulos.webp' },
        {
            name: 'Cidades', icon: A + 'mapicon.webp', isDropdown: true, subItems: [
                { name: 'Capital', url: 'capital.html' }, { name: 'Astrax', url: 'astrax.html' }, { name: 'Duratar', url: 'duratar.html' },
                { name: 'Elendor', url: 'elendor.html' }, { name: 'Mitrar', url: 'mitrar.html' }, { name: 'Tandra', url: 'tandra.html' },
                { name: 'Zion', url: 'zion.html' },
            ],
        },
    ];

    const list = $('menuList'), side = $('leftSideMenu'), ov = $('sideMenuOverlay'), openBtn = $('menuToggleBtn'), closeBtn = $('closeMenuBtn');
    const hamburger = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';
    const chevron = '<svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    closeBtn.innerHTML = hamburger;

    const openMenu = () => {
        side.classList.add('open'); ov.style.display = 'block';
        openBtn.querySelector('svg')?.classList.add('icon-vertical');
        setTimeout(() => { ov.style.opacity = '1'; ov.style.pointerEvents = 'auto'; }, 10);
    };
    const closeMenu = () => {
        side.classList.remove('open'); ov.style.opacity = '0'; ov.style.pointerEvents = 'none';
        openBtn.querySelector('svg')?.classList.remove('icon-vertical');
        setTimeout(() => { ov.style.display = 'none'; }, 300);
    };

    list.innerHTML = '';
    items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'menu-item';
        if (item.isDropdown) {
            const active = item.subItems.some((s) => s.url === CURRENT);
            const a = document.createElement('a');
            a.className = 'menu-link dropdown-toggle'; a.style.cursor = 'pointer';
            a.innerHTML = `<img src="${item.icon}" class="menu-icon" alt="" onerror="this.style.display='none'"><span>${item.name}</span>${chevron}`;
            const ul = document.createElement('ul');
            ul.className = 'submenu-list' + (active ? ' open' : '');
            if (active) li.classList.add('dropdown-active');
            a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ul.classList.toggle('open'); li.classList.toggle('dropdown-active'); });
            item.subItems.forEach((sub) => {
                const match = sub.url === CURRENT;
                const sl = document.createElement('li');
                sl.className = 'menu-item' + (match ? ' active' : '');
                const sa = document.createElement('a');
                sa.className = 'menu-link submenu-link';
                sa.innerHTML = `<span>${sub.name}</span>`;
                if (match) { sa.style.cursor = 'default'; sa.style.pointerEvents = 'none'; }
                else { sa.href = sub.url; sa.addEventListener('click', () => setTimeout(closeMenu, 100)); }
                sl.appendChild(sa); ul.appendChild(sl);
            });
            li.appendChild(a); li.appendChild(ul);
        } else {
            const a = document.createElement('a');
            a.className = 'menu-link';
            a.innerHTML = `<img src="${item.icon}" class="menu-icon" alt="" onerror="this.style.display='none'"><span>${item.name}</span>`;
            a.href = item.url;
            li.appendChild(a);
        }
        list.appendChild(li);
    });

    openBtn.addEventListener('click', openMenu);
    closeBtn.addEventListener('click', closeMenu);
    ov.addEventListener('click', closeMenu);
}

// ---------------------------------------------------------------------
// SAGUÃO: estado, renderização e contadores
// ---------------------------------------------------------------------
async function loadSceneLabels() {
    try {
        const { data } = await supabase.from('mission_scenes').select('id,label');   // RLS: leitura liberada
        (data || []).forEach((r) => { S.scenes[r.id] = r.label; });
    } catch (_) { /* usa o fallback */ }
}

async function refreshState() {
    if (S.adv || S.busy) return;
    const { data, error } = await supabase.rpc('mission_get_state');
    if (error) { renderCard('<p class="hint">Não foi possível consultar o Mestre agora.</p>'); return; }
    S.state = data;
    S.offset = new Date(data.now).getTime() - Date.now();
    await maybeSendPending();
    renderLobby();
}

function renderCard(html) { $('questCard').innerHTML = html; }

const TIP = 'Dica: conduza a história e realize mais ações para ter um desempenho melhor nas recompensas, usando seus 15 minutos.';

function extraBlock(st) {
    const x = st.extra; if (!x) return '';
    const n = x.bought ?? 0, max = x.max ?? 3;
    if (x.available) return `<button class="btn-epic" id="btnExtra">Aventura extra · ${x.cost} de ouro</button>
        <p class="hint">Extras de hoje: ${n} de ${max}. Disponível a qualquer momento, sem disputar as vagas gratuitas. O ouro é cobrado ao entrar.</p>`;
    if (x.reason === 'not_enough_gold') return `<button class="btn-epic" disabled>Aventura extra · ${x.cost} de ouro</button>
        <p class="hint">Ouro insuficiente (você tem ${nf(x.gold)}). Extras de hoje: ${n} de ${max}.</p>`;
    if (x.reason === 'extra_limit') return `<p class="hint">Você já usou as ${max} aventuras extras de hoje.</p>`;
    return '';
}

function renderLobby() {
    const st = S.state; if (!st) return;
    const my = st.my_slot, ev = st.event;
    const paid = my?.kind === 'paid';
    paintScene($('lobbyBg'), ev?.scene || '');

    if (my && my.status === 'reserved') {
        renderCard(paid ? `
            <span class="chip ok">Aventura extra</span>
            <h2>O Mestre aguarda você</h2>
            <p>O custo de <b style="color:#fff3cf">${st.extra?.cost ?? EXTRA_COST_FALLBACK} de ouro</b> é cobrado ao entrar.</p>
            <p class="tip">${TIP}</p>
            <p class="hint" data-role="t-hint"></p>
            <button class="btn-epic" id="btnStart" disabled>Entrar na aventura</button>` : `
            <span class="chip ok">Vaga garantida</span>
            <h2>Sua aventura começa em</h2>
            <div class="big-timer" data-role="t-start">--:--</div>
            <p class="tip">${TIP}</p>
            <p class="hint" data-role="t-hint"></p>
            <button class="btn-epic" id="btnStart" disabled>Entrar na aventura</button>`);
        $('btnStart').onclick = openBrief;
    } else if (my && my.status === 'completed') {
        renderCard(`
            <div class="qc-icon">✦</div>
            <span class="chip ok">${paid ? 'Aventura extra concluída' : 'Aventura concluída'}</span>
            <h2>${paid ? 'Aventura encerrada' : 'Volte amanhã, herói'}</h2>
            ${my.adventure_title ? `<p class="qc-place">✧ ${esc(my.adventure_title)} ✧</p>` : ''}
            <p>Sua nota foi <b style="color:#fff3cf">${my.score_total ?? 0}</b> e você recebeu
               <b style="color:#fff3cf">${nf(my.reward_xp)} XP</b> e <b style="color:#fff3cf">${nf(my.reward_crystals)} cristais</b>.</p>
            ${my.chronicle ? `<div class="chronicle"><h4>Crônica do dia</h4>${esc(my.chronicle)}</div>` : ''}
            ${extraBlock(st) || '<p class="hint">O Mestre aparece de novo amanhã.</p>'}`);
    } else if (my && my.status === 'in_progress') {
        const pend = readPending(my.id);
        renderCard(`
            <span class="chip bad">Aventura interrompida</span>
            <h2>O Mestre aguardava você</h2>
            <p>Esta aventura foi iniciada e não pode ser retomada. ${pend ? 'Há um resultado pendente de envio.' : 'Ela será encerrada automaticamente.'}</p>
            ${pend ? '<button class="btn-epic" id="btnRetry">Enviar resultado</button>' : ''}`);
        if (pend) $('btnRetry').onclick = () => maybeSendPending(true);
    } else if (my && (my.status === 'no_show' || my.status === 'abandoned')) {
        renderCard(`
            <div class="qc-icon">☾</div>
            <span class="chip bad">${my.status === 'no_show' ? 'Chamado perdido' : 'Aventura abandonada'}</span>
            <h2>${my.status === 'no_show' ? 'Você não compareceu' : 'A história ficou inacabada'}</h2>
            <p>${my.status === 'no_show' ? 'A vaga passou para outro herói.' : 'Sem conclusão, não há recompensa.'}</p>
            ${extraBlock(st) || '<p class="hint">Uma nova chance surge amanhã.</p>'}`);
    } else if (ev && ev.open_slots > 0) {
        const gems = [0, 1, 2].map((i) => `<div class="slot-gem ${i < ev.open_slots ? 'free' : ''}"></div>`).join('');
        renderCard(`
            <span class="chip live">● O Mestre apareceu</span>
            <h2>Uma nova lenda aguarda</h2>
            <p class="qc-place">✧ O Mestre criará uma aventura só para você ✧</p>
            <div class="slots">${gems}</div>
            <p><b style="color:#fff3cf">${ev.open_slots}</b> ${ev.open_slots === 1 ? 'vaga restante' : 'vagas restantes'} · encerra em <span data-role="t-close">--:--</span></p>
            <p class="tip">${TIP}</p>
            <button class="btn-epic" id="btnJoin">Aceitar o chamado</button>`);
        $('btnJoin').onclick = joinEvent;
    } else if (ev) {
        renderCard(`
            <span class="chip bad">Vagas esgotadas</span>
            <h2>As vagas acabaram</h2>
            <p>Os três heróis já foram escolhidos. Fique atento: o Mestre voltará a aparecer.</p>`);
    } else {
        renderCard(`
            <div class="qc-icon">☾</div>
            <h2>O Mestre está longe…</h2>
            <p>As lendas dizem que ele surge em locais aleatórios ao longo do dia e chama apenas três heróis por vez.</p>
            <p class="hint">Ative as notificações para ser avisado.</p>
            <button class="btn-epic" disabled>Aguardando o Mestre</button>`);
    }
    const bx = $('btnExtra'); if (bx) bx.onclick = buyExtra;
    tickLobby();
}

function tickLobby() {
    const st = S.state; if (!st || S.view !== 'lobby' || S.adv) return;
    const now = serverNow();
    const my = st.my_slot, ev = st.event;
    const q = (r) => $('questCard').querySelector(`[data-role="${r}"]`);

    if ($('itemsModal').classList.contains('open') && my?.status === 'reserved') {     // tolerância correndo durante a escolha
        const left = new Date(my.start_deadline).getTime() - now;
        $('itemsTimer').textContent = left > 0 ? `Tempo para começar: ${mmss(left)}` : 'O tempo de tolerância acabou.';
        if (left <= 0) closeOv('itemsModal');
    }

    if (my && my.status === 'reserved') {
        const start = new Date(my.scheduled_start).getTime(), dead = new Date(my.start_deadline).getTime();
        const tStart = q('t-start'), hint = q('t-hint'), btn = $('btnStart');
        if (now < start) {                                        // só libera quando o relógio chega a zero
            if (tStart) tStart.textContent = mmss(start - now);
            if (hint) hint.textContent = 'Fique nesta tela. Quando o relógio zerar, o botão será liberado.';
            if (btn) btn.disabled = true;
        } else if (now <= dead) {
            if (tStart) tStart.textContent = '00:00';
            if (hint) hint.textContent = `Entre agora! Tolerância: ${mmss(dead - now)}`;
            if (btn) btn.disabled = false;
        } else {
            refreshState();
        }
    } else if (ev && q('t-close')) {
        q('t-close').textContent = mmss(new Date(ev.closes_at).getTime() - now);
    }
}

function openBrief() {
    const my = S.state?.my_slot, cost = S.state?.extra?.cost ?? EXTRA_COST_FALLBACK;
    const paid = my?.kind === 'paid';
    $('briefPaid').style.display = paid ? 'block' : 'none';
    $('briefPaid').textContent = `Aventura extra: ${cost} de ouro serão cobrados ao começar.`;
    openOv('briefModal');
}

function buyExtra() {                                          // abre o modal de confirmação
    const x = S.state?.extra || {};
    $('buyCost').textContent = x.cost ?? EXTRA_COST_FALLBACK;
    $('buyGold').textContent = nf(x.gold);
    $('buyCount').textContent = `${(x.bought ?? 0) + 1} de ${x.max ?? 3}`;
    openOv('buyModal');
}

async function confirmBuyExtra() {
    closeOv('buyModal');
    busy(true, 'Chamando o Mestre…');
    try {
        const { error } = await supabase.rpc('mission_buy_extra');
        if (error) throw new Error(error.message);
        toast('Aventura extra liberada! Entre quando quiser.');
    } catch (e) { toast(friendly(e.message), true); }
    busy(false);
    await refreshState();
}

async function joinEvent() {
    const ev = S.state?.event; if (!ev) return;
    busy(true, 'Aceitando o chamado…');
    try {
        const { error } = await supabase.rpc('mission_join', { p_event_id: ev.id });
        if (error) throw new Error(error.message);
        toast('Vaga garantida! Aguarde o seu horário.');
    } catch (e) { toast(friendly(e.message), true); }
    busy(false);
    await refreshState();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------
// PERFIL DO HERÓI: nome e avatar vêm do IndexedDB (owners_store → player_store) e só
// vão ao Supabase se faltar algo. O Mestre NÃO usa este nome: o servidor usa o do banco.
// ---------------------------------------------------------------------
function idbGet(store, key) {
    return new Promise((resolve) => {
        let req;
        try { req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION); } catch (_) { return resolve(null); }
        req.onupgradeneeded = (e) => {                           // mesmo schema do resto do jogo
            const db = e.target.result;
            ['auth_store', 'player_store', 'owners_store', 'bonds_store'].forEach((n) => {
                if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: (n === 'auth_store' || n === 'player_store') ? 'key' : 'id' });
            });
        };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
        req.onsuccess = () => {
            const db = req.result;
            try {
                const r = db.transaction(store, 'readonly').objectStore(store).get(key);
                r.onsuccess = () => { db.close(); resolve(r.result || null); };
                r.onerror = () => { db.close(); resolve(null); };
            } catch (_) { try { db.close(); } catch (__) { /* ok */ } resolve(null); }
        };
    });
}

// tolera { id, name, avatar_url } e também { key|id, value|data: { name, avatar_url } }
function pickProfile(rec) {
    if (!rec) return null;
    const d = rec.value || rec.data || rec;
    const name = d.name || d.player_name || d.nickname || d.username || '';
    const avatar = d.avatar_url || d.avatar || d.avatarUrl || '';
    return (name || avatar) ? { name: String(name), avatar: String(avatar) } : null;
}

async function loadHeroProfile() {
    let h = pickProfile(await idbGet('owners_store', S.uid)) || { name: '', avatar: '' };
    if (!h.name || !h.avatar) {
        const p = pickProfile(await idbGet('player_store', 'player_data'));
        if (p) h = { name: h.name || p.name, avatar: h.avatar || p.avatar };
    }
    if (!h.name || !h.avatar) {                                  // último recurso: rede
        try {
            const { data } = await supabase.from('players').select('name,avatar_url').eq('id', S.uid).single();
            if (data) h = { name: h.name || data.name || '', avatar: h.avatar || data.avatar_url || '' };
        } catch (_) { /* sem rede: segue com o que tem */ }
    }
    S.hero = h;
}

// ---------------------------------------------------------------------
// BOLSA: 11 itens possíveis, o jogador leva exatamente 8 (repetições permitidas)
// ---------------------------------------------------------------------
const _svg = (inner) => `<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const _star = (cx, cy, n, r1, r2, rot = -90) => Array.from({ length: n * 2 }, (_, i) => {
    const a = (rot + i * 180 / n) * Math.PI / 180, r = i % 2 ? r2 : r1;
    return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
}).join(' ');
const _rays = (cx, cy, n, r1, r2) => Array.from({ length: n }, (_, i) => {
    const a = (i * 360 / n) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    return `M${(cx + r1 * c).toFixed(1)} ${(cy + r1 * sn).toFixed(1)}L${(cx + r2 * c).toFixed(1)} ${(cy + r2 * sn).toFixed(1)}`;
}).join('');

const ITEMS = [
    { id: 'pocao', name: 'Poção de cura', desc: 'Cura 20% do seu HP.',
      svg: _svg('<path d="M19 6h10M21 6v10L11 35a5 5 0 0 0 4.4 7.4h17.2A5 5 0 0 0 37 35L27 16V6" fill="#1c1420" stroke="#e6c27a" stroke-width="2.2"/><path d="M14.2 31h19.6l3.1 5.2A3 3 0 0 1 34.3 41H13.7a3 3 0 0 1-2.6-4.8z" fill="#e5334f" stroke="none"/><path d="M24 25v7M20.5 28.5h7" stroke="#fff" stroke-width="2.4"/><circle cx="31" cy="23" r="1.6" fill="#ff9aa8" stroke="none"/>') },
    { id: 'faca', name: 'Pequena faca', desc: 'Lâmina curta: cortar, arremessar, forçar algo.',
      svg: _svg('<g transform="rotate(40 24 24)"><path d="M24 3l5 19-5 4-5-4z" fill="#d7dde3" stroke="#8793a0" stroke-width="1.6"/><path d="M24 5v19" stroke="#8793a0" stroke-width="1.2"/><rect x="15" y="26" width="18" height="4" rx="1.5" fill="#e6c27a" stroke="#a88235" stroke-width="1.4"/><rect x="21.5" y="30" width="5" height="11" rx="1.5" fill="#6b3f1d" stroke="#3b210d" stroke-width="1.4"/><circle cx="24" cy="43" r="2.6" fill="#e6c27a" stroke="#a88235" stroke-width="1.2"/></g>') },
    { id: 'corda', name: 'Corda', desc: 'Escalar, amarrar, atravessar vãos.',
      svg: _svg('<circle cx="22" cy="26" r="15" stroke="#c9a45c" stroke-width="6"/><circle cx="22" cy="26" r="15" stroke="#6b4a1c" stroke-width="6" stroke-dasharray="3 5"/><circle cx="22" cy="26" r="7.5" stroke="#c9a45c" stroke-width="5"/><circle cx="22" cy="26" r="7.5" stroke="#6b4a1c" stroke-width="5" stroke-dasharray="3 5"/><path d="M34 14c6-6 10 0 7 7" stroke="#c9a45c" stroke-width="4"/>') },
    { id: 'mapa', name: 'Mapa da região', desc: 'Revela caminhos, atalhos e perigos da região.',
      svg: _svg('<path d="M6 12l12-4 12 4 12-4v28l-12 4-12-4-12 4z" fill="#d9bf8a" stroke="#7a5a22" stroke-width="2"/><path d="M18 8v28M30 12v28" stroke="#9c7a3a" stroke-width="1.4"/><path d="M11 30c5-8 9 2 14-6s8 2 11-6" stroke="#b3361f" stroke-width="2" stroke-dasharray="2 3"/><path d="M34 28l5 5M39 28l-5 5" stroke="#b3361f" stroke-width="2.6"/>') },
    { id: 'enc_atordoamento', name: 'Encantamento de atordoamento', desc: 'Chance de deixar o inimigo atordoado.',
      svg: _svg(`<circle cx="24" cy="25" r="7" fill="#5b3fa8" stroke="#d9c8ff" stroke-width="1.6"/><ellipse cx="24" cy="25" rx="18" ry="7" stroke="#b89cff" stroke-width="2" stroke-dasharray="3 3"/><polygon points="${_star(10, 14, 4, 6, 2)}" fill="#ffe27a" stroke="#c9961b" stroke-width="1"/><polygon points="${_star(37, 11, 4, 5, 1.8)}" fill="#ffe27a" stroke="#c9961b" stroke-width="1"/><polygon points="${_star(30, 38, 4, 5.5, 2)}" fill="#ffe27a" stroke="#c9961b" stroke-width="1"/>`) },
    { id: 'enc_iluminacao', name: 'Encantamento de iluminação', desc: 'Chance de iluminar um ambiente escuro.',
      svg: _svg(`<path d="${_rays(24, 24, 8, 13, 20)}" stroke="#ffd35a" stroke-width="3"/><circle cx="24" cy="24" r="8.5" fill="#ffe27a" stroke="#f4b400" stroke-width="2"/><circle cx="21.5" cy="21.5" r="2.5" fill="#fff8d6" stroke="none"/>`) },
    { id: 'enc_explosao', name: 'Encantamento de explosão', desc: 'Chance de explodir uma pequena área.',
      svg: _svg(`<polygon points="${_star(24, 24, 9, 21, 10)}" fill="#ff8a1f" stroke="#ffd27a" stroke-width="2"/><polygon points="${_star(24, 24, 9, 12.5, 6, -70)}" fill="#ffe27a" stroke="none"/>`) },
    { id: 'enc_fogo', name: 'Encantamento de fogo', desc: 'Adiciona fogo ao próximo ataque (apenas um).',
      svg: _svg('<path d="M24 5c1 8 11 11 11 22a11 11 0 0 1-22 0c0-5 3-8 5-11 .5 4 2 6 4 6-2-6-1-11 2-17z" fill="#ff6a1a" stroke="#ffb35a" stroke-width="2"/><path d="M24 22c1 4 6 5 6 10a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3-1-3-1-5 1-7z" fill="#ffe27a" stroke="none"/>') },
    { id: 'enc_gelo', name: 'Encantamento de gelo', desc: 'Adiciona gelo ao próximo ataque (apenas um).',
      svg: _svg('<path d="M24 5v38M7.5 14.5l33 19M7.5 33.5l33-19" stroke="#9fe3ff" stroke-width="2.8"/><path d="M19 9l5 4 5-4M19 39l5-4 5 4M9 24l5 1 .5-5M39 24l-5 1-.5-5" stroke="#d8f6ff" stroke-width="2"/><circle cx="24" cy="24" r="4" fill="#d8f6ff" stroke="#9fe3ff" stroke-width="1.6"/>') },
    { id: 'enc_sombras', name: 'Encantamento de sombras', desc: 'Chance de escurecer o ambiente por instantes.',
      svg: _svg('<path d="M31 6a18 18 0 1 0 11 29A15 15 0 0 1 31 6z" fill="#3a2d63" stroke="#9b87d9" stroke-width="2"/><circle cx="14" cy="14" r="1.6" fill="#cbb8ff" stroke="none"/><circle cx="38" cy="12" r="1.2" fill="#cbb8ff" stroke="none"/><circle cx="40" cy="22" r="1.4" fill="#cbb8ff" stroke="none"/><path d="M15 31c3-3 6 0 9-3" stroke="#6f5bb3" stroke-width="2"/>') },
    { id: 'enc_furtividade', name: 'Encantamento da furtividade', desc: 'Chance de ficar invisível por instantes.',
      svg: _svg('<path d="M3 24s8-13 21-13 21 13 21 13-8 13-21 13S3 24 3 24z" fill="#1a2230" stroke="#8fb4d9" stroke-width="2"/><circle cx="24" cy="24" r="7" fill="#5a86b3" stroke="#cfe3f5" stroke-width="1.6"/><circle cx="24" cy="24" r="3" fill="#0b1018" stroke="none"/><path d="M8 41L40 7" stroke="#e6c27a" stroke-width="3"/>') },
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

const bagCounts = () => S.bag.reduce((o, id) => { o[id] = (o[id] || 0) + 1; return o; }, {});

function openLoadout() {
    closeOv('briefModal');
    S.bag = [];
    buildItemGrid();
    renderBag();
    openOv('itemsModal');
}

function buildItemGrid() {
    const g = $('itemGrid'); g.innerHTML = '';
    ITEMS.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'item-card'; b.dataset.id = it.id;
        b.innerHTML = `<em class="qty">0</em>${it.svg}<b>${esc(it.name)}</b><span>${esc(it.desc)}</span>`;
        b.onclick = () => {
            if (S.bag.length >= BAG_SIZE) { toast('Bolsa cheia. Toque num item da bolsa para removê-lo.', true); return; }
            S.bag.push(it.id); renderBag();
        };
        g.appendChild(b);
    });
}

function renderBag() {
    const slots = $('bagSlots'); slots.innerHTML = '';
    for (let i = 0; i < BAG_SIZE; i++) {
        const id = S.bag[i], d = document.createElement('div');
        if (id) {
            d.className = 'bag-slot filled'; d.title = ITEM_BY_ID[id].name + ' (toque para remover)';
            d.innerHTML = ITEM_BY_ID[id].svg;
            d.onclick = () => { S.bag.splice(i, 1); renderBag(); };
        } else d.className = 'bag-slot';
        slots.appendChild(d);
    }
    const n = S.bag.length, counts = bagCounts();
    $('bagCount').textContent = `${n}/${BAG_SIZE}`; $('bagCount').classList.toggle('full', n === BAG_SIZE);
    $('itemsGo').disabled = n !== BAG_SIZE;
    $('itemGrid').querySelectorAll('.item-card').forEach((c) => {
        const q = counts[c.dataset.id] || 0;
        c.classList.toggle('has', q > 0); c.classList.toggle('maxed', n >= BAG_SIZE);
        c.querySelector('.qty').textContent = q;
    });
}

// ---------------------------------------------------------------------
// DUELO: HP do herói (esquerda) e do inimigo (direita), sempre em %
// ---------------------------------------------------------------------
function setHp(side, pct) {
    pct = clamp(Math.round(pct), 0, 100);
    $('hp' + side + 'Fill').style.width = pct + '%';
    $('hp' + side + 'Text').textContent = pct + '%';
    if (side === 'You') { const b = $('hpYouBar'); b.classList.toggle('low', pct <= 25); b.classList.toggle('mid', pct > 25 && pct <= 50); }
}

function floatHp(side, text, kind) {                           // kind: 'dmg' | 'heal'
    const box = $('duel' + side);
    const f = document.createElement('span'); f.className = 'hp-float ' + kind; f.textContent = text;
    box.appendChild(f); setTimeout(() => f.remove(), 1400);
    if (kind === 'dmg') { box.classList.remove('hit'); void box.offsetWidth; box.classList.add('hit'); setTimeout(() => box.classList.remove('hit'), 450); }
    else { box.classList.add('healed'); setTimeout(() => box.classList.remove('healed'), 700); }
}

function renderDuel() {
    const a = S.adv; if (!a) return;
    $('duelYouName').textContent = a.hero.name;
    const img = $('duelYouImg'); img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR; };
    img.src = a.hero.avatar;
    $('duelFoeImg').onerror = () => { $('duelFoeImg').onerror = null; $('duelFoeImg').style.visibility = 'hidden'; };
    $('duelFoeImg').src = ENEMY_IMG;
    setHp('You', a.hp);
    const foe = $('duelFoe');
    if (a.enemy) {
        $('duelFoeName').textContent = a.enemy.name; setHp('Foe', a.enemy.hp);
        foe.classList.remove('dead'); foe.classList.add('show');
    } else foe.classList.remove('show', 'dead');
}

function defeatFoe(adv) {
    setHp('Foe', 0); $('duelFoe').classList.add('dead');
    setTimeout(() => { if (S.adv === adv && !adv.enemy) $('duelFoe').classList.remove('show', 'dead'); }, 2400);
}

// ---------------------------------------------------------------------
// ÁUDIO: captura (16 kHz PCM) e reprodução (24 kHz PCM)
// ---------------------------------------------------------------------
const WORKLET_SRC = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('pcm-capture', PcmCapture);`;

async function initAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    await ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    const silent = ctx.createGain(); silent.gain.value = 0;      // mantém o grafo ativo sem eco
    src.connect(node); node.connect(silent); silent.connect(ctx.destination);

    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    analyser.connect(ctx.destination);                           // fala do mestre: fontes → analyser → saída

    return { ctx, stream, node, analyser, nextTime: 0, sources: new Set(), acc: [], micMuted: false, headphones: false };
}

function b64FromFloats(arr) {
    const i16 = new Int16Array(arr.length);
    for (let i = 0; i < arr.length; i++) i16[i] = Math.round(clamp(arr[i], -1, 1) * 0x7fff);
    const bytes = new Uint8Array(i16.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

const masterSpeaking = (A) => A.ctx.currentTime < A.nextTime + 0.35;

function playPcm24(A, b64) {
    const bin = atob(b64), n = bin.length >> 1;
    const buf = A.ctx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
        let v = (bin.charCodeAt(2 * i + 1) << 8) | bin.charCodeAt(2 * i);
        if (v >= 0x8000) v -= 0x10000;
        ch[i] = v / 32768;
    }
    const s = A.ctx.createBufferSource();
    s.buffer = buf; s.connect(A.analyser);
    const t = Math.max(A.ctx.currentTime + 0.03, A.nextTime);
    s.start(t); A.nextTime = t + buf.duration;
    A.sources.add(s); s.onended = () => A.sources.delete(s);
}

function flushPlayback(A) {
    A.sources.forEach((s) => { try { s.stop(); } catch (_) { /* já parou */ } });
    A.sources.clear(); A.nextTime = A.ctx.currentTime;
}

async function drainPlayback(A, maxMs = 9000) {
    const t0 = Date.now();
    while (masterSpeaking(A) && Date.now() - t0 < maxMs) await sleep(150);
}

// ---------------------------------------------------------------------
// AVENTURA
// ---------------------------------------------------------------------
async function failStart(why, detail) {
    const adv = S.adv;
    const slot = adv?.slotId;
    if (adv) { adv.finished = true; teardown(); S.adv = null; }
    closeOv('diceOverlay'); busy(false);
    if (slot) { try { await callFn('mission-token', { slot_id: slot, action: 'revert' }); } catch (_) { /* ok */ } }
    showView('lobby');
    showDebug(why, detail);
    await refreshState();
}

async function startAdventure(loadout) {
    if (S.starting) return;                                    // evita toque duplo
    S.starting = true;
    try { await _startAdventure(loadout); } finally { S.starting = false; }
}

async function _startAdventure(loadout) {
    const my = S.state?.my_slot; if (!my || my.status !== 'reserved') return;
    closeOv('itemsModal');
    busy(true, 'Preparando o microfone…');

    let A = null, ctx = null;
    try {
        A = await initAudio();                                   // 1º: microfone (se negar, a vaga não é gasta)
        A.headphones = $('chkPhones').checked;
        busy(true, 'Invocando o Mestre…');
        ctx = await callFn('mission-token', { slot_id: my.id, loadout });   // o cronômetro só começa aqui, depois da bolsa
        const sdk = await import(GENAI_URL);
        S.adv = newAdv(my.id, ctx, A, sdk);
        await connectLive(false);
    } catch (e) {
        console.error('[diarias] falha ao iniciar:', e);
        if (S.adv) teardown();
        else if (A) { try { A.stream.getTracks().forEach((t) => t.stop()); A.ctx.close(); } catch (_) { /* ok */ } }
        if (ctx?.slot_id) { try { await callFn('mission-token', { slot_id: ctx.slot_id, action: 'revert' }); } catch (_) { /* ok */ } }
        S.adv = null;
        busy(false);
        const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        if (denied) toast('Permita o microfone para jogar.', true);
        else showDebug(friendly(e.message), `${e.message}\n${e.detail || ''}\n${e.stack ? String(e.stack).split('\n')[0] : ''}`.trim());
        await refreshState();
        return;
    }

    busy(false);
    enterStage();
}

function newAdv(slotId, ctx, A, sdk) {
    const startMs = new Date(ctx.ends_at).getTime() - (ctx.session_minutes + 2) * 60000;
    return {
        slotId, A, sdk, token: ctx.token, model: ctx.model, voice: ctx.voice, degraded: !!ctx.degraded, scene: ctx.scene,
        sceneNames: Object.fromEntries((ctx.scenes || []).map((s) => [s.id, s.label])),
        endMs: startMs + ctx.session_minutes * 60000, totalMs: ctx.session_minutes * 60000,
        session: null, handle: null, reconnects: 0, opened: false,
        warned: false, forced: false, finished: false, closing: false,
        rolls: 0, masterBuf: '', youBuf: '', newTurn: true, activeSceneLayer: 'A',
        timer: null, raf: null, wake: null,
        // vida, combate e bolsa (a verdade fica aqui; o Mestre só aplica pelas ferramentas)
        hp: 100, enemy: null, dead: false, deadTimer: null, marks: {}, lastRoll: null, hist: [], invStart: { ...(ctx.loadout || {}) },
        inv: { ...(ctx.loadout || {}) },
        hero: { name: S.hero?.name || ctx.hero_name || 'Herói', avatar: S.hero?.avatar || DEFAULT_AVATAR },
    };
}

async function connectLive(isRetry) {
    const adv = S.adv;
    const ai = new adv.sdk.GoogleGenAI({ apiKey: adv.token });
    const config = { responseModalities: [adv.sdk.Modality.AUDIO] };
    if (adv.handle) config.sessionResumption = { handle: adv.handle };
    if (adv.degraded) {                                          // o token não travou estes campos: enviamos aqui
        config.inputAudioTranscription = {};
        config.outputAudioTranscription = {};
        config.contextWindowCompression = { slidingWindow: {} };
        if (adv.voice) config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: adv.voice } } };
    }

    adv.session = await ai.live.connect({
        model: adv.model,
        config,
        callbacks: {
            onopen: () => { adv.opened = true; },
            onmessage: (m) => {
                if (!adv.gotMsg) {
                    adv.gotMsg = true; adv.liveMs = Date.now();
                    callFn('mission-token', { slot_id: adv.slotId, action: 'live' }).catch(() => {});
                }
                adv.reconnects = 0;                                   // conexão saudável: zera as tentativas
                onLiveMessage(m).catch((e) => console.error('[diarias] msg:', e));
            },
            onerror: (e) => { adv.lastErr = String(e?.message || e?.error?.message || 'erro de conexão'); console.warn('[diarias] ws erro:', adv.lastErr); },
            onclose: (e) => { adv.lastClose = `código ${e?.code ?? '?'} ${e?.reason || ''}`.trim(); onLiveClosed(); },
        },
    });

    if (isRetry) {
        sendText(recapText(adv));                                // o contexto pode não voltar com o handle: reenvia o estado
    } else {
        sendText('[SISTEMA] INICIAR. Siga a abertura: set_scene, boas-vindas chamando o herói pelo nome real e comece o Ato 1 com um NPC em cena. Não pergunte o nome.');
    }
}

// Texto de retomada após reconexão: estado do jogo + últimas falas (o handle nem sempre restaura o contexto)
function recapText(adv) {
    const left = Math.max(0, adv.endMs - serverNow());
    const elapsedMin = Math.floor((adv.totalMs - left) / 60000);
    const bag = Object.entries(adv.inv).map(([id, q]) => `${ITEM_BY_ID[id]?.name || id} x${q}`).join(', ');
    const hist = adv.hist.slice(-6).map((h) => `${h.who}: ${h.text}`);
    if (adv.masterBuf) hist.push(`Mestre: ${adv.masterBuf.slice(-300)}`);
    if (adv.youBuf) hist.push(`Jogador: ${adv.youBuf.slice(-200)}`);
    return `[SISTEMA] RECONECTADO após queda de conexão. Continue a MESMA aventura, sem recomeçar e sem repetir a abertura. `
        + `Herói: ${adv.hero.name}, HP ${adv.hp}%. ` + (adv.enemy ? `EM COMBATE contra ${adv.enemy.name} (HP ${adv.enemy.hp}%${adv.enemy.boss ? ', chefe' : ''}; o combate só termina com a morte dele). ` : 'Sem combate no momento. ')
        + `Bolsa restante: ${bag || 'vazia'}. Cenário atual: ${adv.scene}. Tempo decorrido: ${elapsedMin} min de ${Math.round(adv.totalMs / 60000)}. `
        + (hist.length ? `Últimas falas: ${hist.join(' | ')}. ` : '')
        + 'Retome com UMA frase curta e diga novamente as 3 opções de ação em voz alta; depois espere o jogador.';
}

function sendText(text) {
    const s = S.adv?.session; if (!s) return;
    try { s.sendRealtimeInput({ text }); }
    catch (_) { try { s.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }); } catch (e) { console.warn(e); } }
}

function sendAudio(b64) {
    const s = S.adv?.session; if (!s) return;
    try { s.sendRealtimeInput({ audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } }); }
    catch (_) { /* conexão fechando: ignora */ }
}

function onLiveClosed() {
    const adv = S.adv; if (!adv || adv.finished || adv.closing) return;
    if (!adv.gotMsg) {                                           // recusada logo na abertura (token/config/modelo)
        failStart('O Mestre recusou a conexão', `${adv.lastClose || ''}\n${adv.lastErr || ''}\nmodelo: ${adv.model}${adv.degraded ? ' (config enxuta)' : ''}`.trim());
        return;
    }
    const left = adv.endMs + GIVEUP_AFTER_S * 1000 - serverNow();
    if (adv.reconnects < 6 && left > 0) {
        adv.reconnects++;
        setMasterState('thinking', 'Reconectando…');
        setTimeout(() => { if (S.adv === adv && !adv.finished) connectLive(true).catch(() => onLiveClosed()); }, 900 * adv.reconnects);
    } else if (!adv.finished) {
        console.warn('[diarias] conexão perdida:', adv.lastClose, adv.lastErr);
        toast('Conexão perdida com o Mestre.', true);
        finishAdventure(null, true, 'connection_lost');
    }
}

// ----- mensagens do Gemini -----
async function onLiveMessage(msg) {
    const adv = S.adv; if (!adv) return;

    if (msg.sessionResumptionUpdate?.newHandle && msg.sessionResumptionUpdate.resumable !== false) adv.handle = msg.sessionResumptionUpdate.newHandle;
    if (msg.goAway) {
        // o servidor vai encerrar a conexão: reconecta usando o handle (mesmo token)
        try { adv.session.close(); } catch (_) { /* ok */ }
    }

    const sc = msg.serverContent;
    if (sc) {
        if (sc.interrupted) { flushPlayback(adv.A); adv.newTurn = true; }
        for (const p of sc.modelTurn?.parts || []) {
            if (p.inlineData?.data && String(p.inlineData.mimeType || '').startsWith('audio')) playPcm24(adv.A, p.inlineData.data);
        }
        if (sc.outputTranscription?.text) {
            if (adv.newTurn) {
                if (adv.masterBuf) adv.hist.push({ who: 'Mestre', text: adv.masterBuf.slice(-320) });
                if (adv.youBuf) adv.hist.push({ who: 'Jogador', text: adv.youBuf.trim().slice(-200) });
                if (adv.hist.length > 10) adv.hist.splice(0, adv.hist.length - 10);
                adv.masterBuf = ''; adv.youBuf = ''; $('capYou').textContent = ''; adv.newTurn = false;
            }
            adv.masterBuf += sc.outputTranscription.text;
            $('capMaster').textContent = adv.masterBuf.slice(-420);
            $('capMaster').scrollTop = 99999;
        }
        if (sc.inputTranscription?.text) {
            adv.youBuf += sc.inputTranscription.text;
            $('capYou').textContent = '“' + adv.youBuf.trim().slice(-200) + '”';
        }
        if (sc.turnComplete) adv.newTurn = true;
    }

    if (msg.toolCall?.functionCalls?.length) await onToolCall(msg.toolCall.functionCalls);
}

const ROLL_HINT = {
    critical_success: 'Sucesso crítico! Narre um triunfo extraordinário com benefício extra. Se foi um ataque, aplique dano maior ao inimigo com damage. Termine dizendo 3 opções em voz alta e então PARE e espere o jogador responder.',
    success: 'Sucesso. Narre o êxito. Se foi um ataque, aplique dano ao inimigo com damage. Termine dizendo 3 opções em voz alta e então PARE e espere o jogador responder.',
    failure: 'Falha. Narre a falha e as consequências; em combate o inimigo contra-ataca e você aplica dano ao herói com damage. Termine dizendo 3 opções em voz alta e então PARE e espere o jogador responder.',
    critical_failure: 'Falha crítica! Narre uma complicação séria (em combate, um golpe duro do inimigo aplicado com damage), mas mantenha saídas. Termine dizendo 3 opções em voz alta e então PARE e espere o jogador responder.',
};

const hpState = (adv) => ({
    hp_heroi_percent: adv.hp,
    combate: adv.enemy ? { inimigo: adv.enemy.name, hp_inimigo_percent: adv.enemy.hp, chefe: adv.enemy.boss } : null,
});

function toolStartCombat(adv, args) {
    if (adv.dead) return { ok: false, erro: 'O herói já caiu. Narre a derrota e chame end_adventure com outcome "derrota".' };
    if (adv.enemy) return { ok: false, erro: `Já há um combate em andamento contra ${adv.enemy.name} (HP ${adv.enemy.hp}%). Ele só termina quando o HP do inimigo chegar a 0.`, ...hpState(adv) };
    const name = String(args.enemy_name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 28) || 'Inimigos';
    adv.enemy = { name, hp: 100, boss: !!args.is_boss };
    renderDuel();
    return { ok: true, ...hpState(adv), instrucao: 'Combate iniciado. Só termina com a morte do inimigo (HP 0%): fugir, negociar ou se esconder não funcionam mais. Descreva o inimigo, deixe-o falar em primeira pessoa e diga 3 opções de combate em voz alta; depois PARE e espere o jogador.' };
}

// Dano real = base do Mestre × fator do dado. Maior dado → mais dano; 20 natural = crítico (×2);
// criatura comum às vezes leva crítico surpresa; chefe nunca (luta longa).
function takeLastRoll(adv) {
    const lr = adv.lastRoll && Date.now() - adv.lastRoll.t < 90000 ? adv.lastRoll : null;
    return lr;
}

function toolDamage(adv, args) {
    if (adv.dead) return { ok: false, erro: 'O herói já caiu. Narre a derrota e chame end_adventure com outcome "derrota".', ...hpState(adv) };
    const target = args.target === 'player' ? 'player' : 'enemy';
    const base = clamp(Math.round(Number(args.base_percent ?? args.percent) || 0), 1, 100);
    const finalPhase = adv.endMs - serverNow() <= WARN_AT_S * 1000;
    const lr = takeLastRoll(adv);

    if (target === 'enemy') {
        if (!adv.enemy) return { ok: false, erro: 'Não há inimigo em combate. Chame start_combat antes de aplicar dano.', ...hpState(adv) };
        const boss = adv.enemy.boss;
        let f = 1, crit = false;
        if (lr) {
            adv.lastRoll = null;                                           // cada rolagem vale para um golpe
            if (lr.result === 'critical_success') { f = 2; crit = true; }
            else if (lr.result === 'success') f = 0.6 + 0.04 * lr.roll;    // dado 8 → ×0,92 · 12 → ×1,08 · 16 → ×1,24 · 19 → ×1,36
            else f = 0.5;                                                  // dano após falha: raspão
        }
        if (!boss && !crit && lr?.result === 'success' && Math.random() < 0.15) { f *= 1.8; crit = true; }   // crítico surpresa
        let pct = Math.round(base * f);
        if (boss) pct = clamp(pct, 3, finalPhase ? 45 : BOSS_MAX_HIT);     // chefe: luta longa (exceto no final)
        else pct = clamp(pct, MIN_HIT_COMMON, 100);                        // criatura comum: nunca vira "mini-chefe"
        adv.enemy.hp = Math.max(0, adv.enemy.hp - pct);
        floatHp('Foe', (crit ? 'CRÍTICO −' : '−') + pct + '%', 'dmg'); setHp('Foe', adv.enemy.hp);
        const intensidade = crit ? 'critico' : f >= 1.2 ? 'forte' : f < 0.95 ? 'fraco' : 'normal';
        if (adv.enemy.hp <= 0) {
            const nome = adv.enemy.name; adv.enemy = null; defeatFoe(adv);
            return { ok: true, aplicado_percent: pct, intensidade, inimigo_derrotado: nome, ...hpState(adv), instrucao: `${nome} foi derrotado(a). Narre a morte à altura do golpe (${intensidade}) e retome a história: diga 3 opções em voz alta e PARE para o jogador responder.` };
        }
        return { ok: true, aplicado_percent: pct, intensidade, ...hpState(adv), instrucao: `Golpe ${intensidade}. Narre à altura, deixe o inimigo reagir (pode falar em primeira pessoa), diga 3 opções em voz alta e PARE para o jogador responder.` };
    }

    let f = 1;
    if (lr && (lr.result === 'critical_failure' || lr.result === 'failure')) {
        if (lr.result === 'critical_failure') f = 1.5;
        adv.lastRoll = null;
    }
    const pct = Math.min(Math.round(base * f), PLAYER_MAX_HIT);
    adv.hp = Math.max(0, adv.hp - pct);
    floatHp('You', '−' + pct + '%', 'dmg'); setHp('You', adv.hp);
    if (adv.hp <= 0) {
        adv.dead = true;
        clearTimeout(adv.deadTimer);
        adv.deadTimer = setTimeout(() => { if (S.adv === adv && !adv.finished) finishAdventure(null, true, 'dead_timeout'); }, 60000);   // rede de segurança
        return { ok: true, aplicado_percent: pct, ...hpState(adv), instrucao: 'O HP do herói chegou a 0%. A aventura termina agora: narre a queda do herói em tom épico (sem violência gráfica), faça um breve resumo e chame end_adventure com outcome "derrota".' };
    }
    return { ok: true, aplicado_percent: pct, ...hpState(adv), instrucao: adv.hp <= 25 ? 'O herói está muito ferido; narre isso, diga 3 opções em voz alta e PARE para o jogador responder.' : 'Narre o dano, diga 3 opções em voz alta e PARE para o jogador responder.' };
}

// ----- bolsa durante a aventura -----
function updateBagBadge() {
    const a = S.adv; if (!a) return;
    $('bagBadge').textContent = Object.values(a.inv).reduce((n, q) => n + q, 0);
}

function openBagView() {
    const a = S.adv; if (!a) return;
    $('bagViewList').innerHTML = Object.keys(a.invStart).map((id) => {
        const it = ITEM_BY_ID[id], left = a.inv[id] ?? 0, total = a.invStart[id];
        return `<div class="bagview-row ${left <= 0 ? 'empty' : ''}">${it.svg}<div><b>${esc(it.name)}</b><span>${esc(it.desc)}</span></div>`
             + `<div class="left">${left}<small>de ${total}</small></div></div>`;
    }).join('');
    openOv('bagViewModal');
}

function toolUseItem(adv, args) {
    if (adv.dead) return { ok: false, erro: 'O herói já caiu.' };
    const id = String(args.item || ''), it = ITEM_BY_ID[id];
    if (!it || !(id in adv.inv)) return { ok: false, erro: 'O herói NÃO levou este item na bolsa. Negue o uso, em personagem, e ofereça 3 opções válidas.' };
    if (adv.inv[id] <= 0) return { ok: false, erro: `O herói já usou todas as unidades de "${it.name}" que levou. Negue o uso, em personagem.`, restantes: 0 };
    let extra = {};
    if (id === 'pocao') {
        if (adv.hp >= 100) return { ok: false, erro: 'O HP do herói já está cheio; a poção NÃO foi gasta. Diga isso ao jogador.', restantes: adv.inv[id] };
        const before = adv.hp; adv.hp = Math.min(100, adv.hp + HEAL_POTION);
        setHp('You', adv.hp); floatHp('You', '+' + (adv.hp - before) + '%', 'heal');
        extra = { curou_percent: adv.hp - before };
    }
    adv.inv[id]--;
    toast(`${it.name}: restam ${adv.inv[id]}`);
    updateBagBadge();
    return { ok: true, item: it.name, restantes: adv.inv[id], ...extra, ...hpState(adv),
        instrucao: id.startsWith('enc_') && !['enc_fogo', 'enc_gelo'].includes(id) ? 'Item gasto. Agora chame roll_check (facil ou normal) para decidir se o efeito funcionou.' : 'Item gasto. Narre o uso.' };
}

function toolStatus(adv) {
    return { ok: true, ...hpState(adv),
        bolsa: Object.entries(adv.inv).map(([id, q]) => ({ item: ITEM_BY_ID[id]?.name || id, restantes: q })),
        instrucao: 'Diga ao jogador a quantidade EXATA de cada item (inclusive os já consumidos, com zero).' };
}

async function onToolCall(calls) {
    const adv = S.adv;
    const responses = [];
    for (const c of calls) {
        let out = { ok: true };
        try {
            const a = c.args || {};
            if (c.name === 'set_scene') {
                setScene(String(a.scene || ''));
            } else if (c.name === 'roll_check') {
                out = adv.dead ? { ok: false, erro: 'O herói já caiu.' } : await doRoll(a);
            } else if (c.name === 'start_combat') {
                out = toolStartCombat(adv, a);
            } else if (c.name === 'damage') {
                out = toolDamage(adv, a);
            } else if (c.name === 'use_item') {
                out = toolUseItem(adv, a);
            } else if (c.name === 'get_status') {
                out = toolStatus(adv);
            } else if (c.name === 'end_adventure') {
                const left = adv.endMs - serverNow();
                if (!adv.dead && left > EARLY_END_GUARD_S * 1000) {
                    out = { ok: false, erro: 'Ainda é cedo para encerrar. A história precisa de jornada, chefe e cenas finais. Continue a aventura e só encerre quando o sistema avisar que restam 2 minutos.' };
                } else {
                    adv.endPayload = { ...a };
                    if (adv.dead) adv.endPayload.outcome = 'derrota';
                }
            }
        } catch (e) { out = { ok: false, erro: String(e.message || e) }; }
        responses.push({ id: c.id, name: c.name, response: out });
    }
    try { adv.session.sendToolResponse({ functionResponses: responses }); } catch (e) { console.warn(e); }
    if (adv.endPayload && !adv.finished) finishAdventure(adv.endPayload, false);   // o epílogo já foi narrado antes da chamada
}

// ----- dados -----
async function doRoll(args) {
    const adv = S.adv;
    const diff = ['facil', 'normal', 'dificil', 'extremo'].includes(args.difficulty) ? args.difficulty : 'normal';
    const action = String(args.action || 'Ação do herói').slice(0, 140);
    setMasterState('thinking', 'Os dados rolam…');
    $('diceAction').textContent = action;
    $('diceResult').textContent = ''; $('diceResult').className = 'dice-result'; $('diceMath').textContent = '';
    const d = $('d20'); d.className = 'd20 rolling';
    openOv('diceOverlay');
    const spin = setInterval(() => { $('d20Num').textContent = 1 + Math.floor(Math.random() * 20); }, 70);

    const t0 = Date.now();
    let r = null;
    try { r = await callFn('mission-roll', { slot_id: adv.slotId, action, difficulty: diff }); } catch (e) { console.warn('[diarias] roll:', e.message); }
    await sleep(Math.max(0, 1500 - (Date.now() - t0)));
    clearInterval(spin);

    if (!r) { closeOv('diceOverlay'); setMasterState('listening'); return { erro: 'A rolagem falhou. Decida o resultado de forma equilibrada.' }; }

    adv.rolls++; $('hudRolls').textContent = adv.rolls;
    adv.lastRoll = { roll: r.roll, result: r.result, t: Date.now() };
    $('d20Num').textContent = r.roll;
    d.className = 'd20 settle' + (r.result === 'critical_success' ? ' crit-s' : r.result === 'critical_failure' ? ' crit-f' : '');
    const good = r.result === 'success' || r.result === 'critical_success';
    const label = { critical_success: 'Sucesso crítico!', success: 'Sucesso', failure: 'Falha', critical_failure: 'Falha crítica!' }[r.result];
    $('diceResult').textContent = label; $('diceResult').className = 'dice-result ' + (good ? 's' : 'f');
    $('diceMath').textContent = `d20: ${r.roll}  ·  precisa de ${r.dc} ou mais`;
    await sleep(1900);
    closeOv('diceOverlay');
    setMasterState('listening');
    return { resultado: r.result, dado: r.roll, precisava: r.dc, instrucao: ROLL_HINT[r.result] };
}

// ----- cenário e escolhas -----
function setScene(id) {
    const adv = S.adv; if (!adv || !id) return;
    adv.scene = id;
    const next = adv.activeSceneLayer === 'A' ? 'B' : 'A';
    const from = $('scene' + adv.activeSceneLayer), to = $('scene' + next);
    paintScene(to, id);
    setTimeout(() => { to.classList.add('show'); from.classList.remove('show'); }, 250);
    adv.activeSceneLayer = next;
    $('hudSceneName').textContent = adv.sceneNames[id] || sceneLabel(id);
}

// ----- palco -----
function setMasterState(state, label) {
    const m = $('master'); m.dataset.state = state;
    const names = { idle: 'O Mestre desperta…', speaking: 'O Mestre fala', listening: 'O Mestre ouve você', thinking: 'O Mestre pondera…', muted: 'Microfone silenciado' };
    $('masterState').textContent = label || names[state] || '';
}

function enterStage() {
    const adv = S.adv;
    showView('stage');
    $('capMaster').textContent = ''; $('capYou').textContent = '';
    $('hudRolls').textContent = '0';
    renderDuel(); updateBagBadge();
    $('sceneA').classList.remove('show'); $('sceneB').classList.remove('show');
    adv.activeSceneLayer = 'B'; setScene(adv.scene);
    $('btnPhones').setAttribute('aria-pressed', String(adv.A.headphones));
    $('btnMic').setAttribute('aria-pressed', 'false'); $('btnMic').classList.add('live');
    setMasterState('idle');

    // microfone → servidor (reduz 48/44,1 kHz para 16 kHz e envia blocos de 80 ms)
    const A = adv.A, ratio = A.ctx.sampleRate / 16000;
    A.node.port.onmessage = (e) => {
        if (A.micMuted || (!A.headphones && masterSpeaking(A))) return;       // sem eco: não ouve enquanto o mestre fala
        const f = e.data, outLen = Math.floor(f.length / ratio);
        for (let i = 0; i < outLen; i++) {
            const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
            let sum = 0; for (let j = a; j < b && j < f.length; j++) sum += f[j];
            A.acc.push(sum / (b - a));
        }
        while (A.acc.length >= SEND_CHUNK) sendAudio(b64FromFloats(A.acc.splice(0, SEND_CHUNK)));
    };

    // loop visual (nível de voz do mestre) e relógio da aventura
    const buf = new Uint8Array(A.analyser.fftSize);
    const loop = () => {
        if (!S.adv) return;
        A.analyser.getByteTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
        $('master').style.setProperty('--lvl', clamp(Math.sqrt(s / buf.length) * 3.2, 0, 1).toFixed(3));
        const speaking = masterSpeaking(A);
        const cur = $('master').dataset.state;
        if (cur !== 'thinking') {
            const want = A.micMuted ? 'muted' : speaking ? 'speaking' : 'listening';
            if (cur !== want) setMasterState(want);
        }
        adv.raf = requestAnimationFrame(loop);
    };
    loop();
    adv.timer = setInterval(advTick, 250);

    try { navigator.wakeLock?.request('screen').then((w) => { adv.wake = w; }).catch(() => {}); } catch (_) { /* ok */ }
    window.addEventListener('beforeunload', guardUnload);
}

function guardUnload(e) { if (S.adv && !S.adv.finished) { e.preventDefault(); e.returnValue = ''; } }

function advTick() {
    const adv = S.adv; if (!adv || adv.finished) return;
    const left = adv.endMs - serverNow();
    $('timerText').textContent = mmss(left);
    $('timerRing').style.strokeDashoffset = String(163.36 * (1 - clamp(left / adv.totalMs, 0, 1)));
    const t = $('hudTimer');
    t.classList.toggle('warn', left <= WARN_AT_S * 1000 && left > END_AT_S * 1000);
    t.classList.toggle('crit', left <= END_AT_S * 1000);

    if (!adv.dead) {
        const elapsedS = (adv.totalMs - left) / 1000;
        for (const m of MARKS) if (!adv.marks[m.at] && elapsedS >= m.at && left > WARN_AT_S * 1000) { adv.marks[m.at] = true; sendText(m.text); }
        if (!adv.warned && left <= WARN_AT_S * 1000) {
            adv.warned = true;
            sendText('[SISTEMA] RESTAM 2 MINUTOS (NÃO responda falando agora; aplique na sua próxima fala). Leve a história às cenas finais: se o chefe ainda vive, conduza o confronto ao ápice e à derrota dele; depois o objetivo e o desfecho. Não inicie novos combates.');
        }
        if (!adv.forced && left <= END_AT_S * 1000) {
            adv.forced = true;
            sendText('[SISTEMA] ENCERRAR. Narre o desfecho agora (30 a 60 segundos), resuma o desempenho do jogador e chame end_adventure.');
        }
    }
    if (left <= -GIVEUP_AFTER_S * 1000) finishAdventure(null, true, 'master_timeout');   // o mestre não encerrou: envia nota neutra
}

// ----- encerramento -----
function teardown() {
    const adv = S.adv; if (!adv) return;
    adv.closing = true;
    clearInterval(adv.timer); cancelAnimationFrame(adv.raf); clearTimeout(adv.deadTimer);
    try { adv.session?.close(); } catch (_) { /* ok */ }
    try { adv.A.node.port.onmessage = null; adv.A.stream.getTracks().forEach((t) => t.stop()); adv.A.ctx.close(); } catch (_) { /* ok */ }
    try { adv.wake?.release(); } catch (_) { /* ok */ }
    window.removeEventListener('beforeunload', guardUnload);
}

const pendKey = (slot) => 'aden_daily_pending_' + slot;
const readPending = (slot) => { try { return JSON.parse(localStorage.getItem(pendKey(slot)) || 'null'); } catch (_) { return null; } };

async function finishAdventure(payload, fallback, reason) {
    const adv = S.adv; if (!adv || adv.finished) return;
    adv.finished = true;
    if (!fallback) await drainPlayback(adv.A);                    // deixa o mestre terminar a última frase
    const slotId = adv.slotId, sceneId = adv.scene;
    const clientSeconds = adv.liveMs ? Math.round((Date.now() - adv.liveMs) / 1000) : null;
    teardown(); S.adv = null; closeOv('diceOverlay'); closeOv('bagViewModal');

    const p = payload || { courage: 12, creativity: 12, resolution: 12, roleplay: 12, outcome: adv.dead ? 'derrota' : 'vitoria_parcial', chronicle: '' };
    const pending = { slot_id: slotId, detail: { courage: p.courage, creativity: p.creativity, resolution: p.resolution, roleplay: p.roleplay }, outcome: p.outcome, chronicle: p.chronicle, title: p.title || '', scene: sceneId, client_seconds: clientSeconds, reason: reason || (fallback ? 'fallback' : 'master') };
    console.info('[diarias] encerrando aventura. motivo:', pending.reason);
    localStorage.setItem(pendKey(slotId), JSON.stringify(pending));   // garante o envio mesmo se a página fechar
    await submitFinish(pending);
}

async function submitFinish(pending) {
    busy(true, 'O Mestre pesa seus feitos…');
    try {
        const out = await callFn('mission-finish', { slot_id: pending.slot_id, detail: pending.detail, outcome: pending.outcome, chronicle: pending.chronicle, title: pending.title, client_seconds: pending.client_seconds });
        localStorage.removeItem(pendKey(pending.slot_id));
        busy(false);
        showResult(out.result, pending.scene, pending.reason);
    } catch (e) {
        busy(false);
        toast(friendly(e.message) + ' Seu resultado ficou guardado.', true);
        showView('lobby');
        await refreshState();
    }
}

async function maybeSendPending(force) {
    const my = S.state?.my_slot;
    if (!my || my.status !== 'in_progress' || S.adv) return;
    if (!force && S.pendTried) return;
    S.pendTried = true;
    const p = readPending(my.id);
    if (p) await submitFinish(p);
}

// ----- resultado -----
function showResult(r, sceneId, reason) {
    showView('result');
    paintScene($('resultBg'), sceneId || '');
    const d = r.detail || {};
    const names = { vitoria: 'Vitória', vitoria_parcial: 'Vitória parcial', fuga: 'Fuga', derrota: 'Derrota' };
    const bad = r.outcome === 'derrota' || r.outcome === 'fuga';
    const crit = [['courage', 'Coragem'], ['creativity', 'Criatividade'], ['resolution', 'Resolução'], ['roleplay', 'Imersão']];
    const C = 2 * Math.PI * 56;
    $('resultPanel').innerHTML = `
        <div class="res-eyebrow">Crônica encerrada</div>
        <h2 class="res-title ${bad ? 'bad' : ''}">${names[r.outcome] || 'Aventura concluída'}</h2>
        ${r.title ? `<p class="res-adv">✧ ${esc(r.title)} ✧</p>` : ''}
        <div class="score-ring">
            <svg viewBox="0 0 130 130" width="130" height="130">
                <circle cx="65" cy="65" r="56" fill="none" stroke="rgba(168,130,53,.25)" stroke-width="8"></circle>
                <circle id="scoreArc" cx="65" cy="65" r="56" fill="none" stroke="#e6c27a" stroke-width="8" stroke-linecap="round"
                        stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset 1.6s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 6px #e6c27a)"></circle>
            </svg>
            <div class="num"><span id="scoreNum">0</span><small>NOTA</small></div>
        </div>
        <div class="bars">${crit.map(([k, n]) => `<div class="bar-row"><span>${n}</span><div class="bar"><i data-w="${clamp((d[k] || 0) / 25 * 100, 0, 100)}"></i></div><span>${d[k] ?? 0}</span></div>`).join('')}</div>
        <div class="rewards">
            <div class="reward"><b id="rwXp">0</b><small>XP</small></div>
            <div class="reward"><b id="rwCr">0</b><small>Cristais</small></div>
        </div>
        ${r.leveled_up ? `<div class="levelup">▲ Subiu para o nível ${esc(r.new_level)}!</div>` : ''}
        ${r.chronicle ? `<div class="chronicle"><h4>Crônica do dia</h4>${esc(r.chronicle)}</div>` : ''}
        <p class="res-note">Você jogou ${fmtPlayed(r.seconds_played)} · ${r.reward_pct ?? 0}% da recompensa máxima${r.concluded ? ' · história concluída' : ''}</p>
        ${REASON_NOTE[reason] ? `<p class="res-note warn">${REASON_NOTE[reason]}</p>` : ''}
        <button class="btn-epic" id="btnBack">Voltar</button>`;
    $('btnBack').onclick = async () => { showView('lobby'); await refreshState(); };

    requestAnimationFrame(() => setTimeout(() => {
        document.querySelectorAll('#resultPanel .bar i').forEach((el) => { el.style.width = el.dataset.w + '%'; });
        $('scoreArc').style.strokeDashoffset = String(C * (1 - clamp((r.score_total || 0) / 100, 0, 1)));
        countUp($('scoreNum'), r.score_total || 0, 1600);
        countUp($('rwXp'), r.xp || 0, 1800);
        countUp($('rwCr'), r.crystals || 0, 2000);
    }, 250));
}

const REASON_NOTE = {
    connection_lost: 'A conexão com o Mestre caiu e não voltou. Nota neutra; a recompensa foi calculada pelo tempo jogado.',
    master_timeout: 'O Mestre não chegou a encerrar a história a tempo. Nota neutra; a recompensa foi calculada pelo tempo jogado.',
    dead_timeout: 'O herói caiu em combate.',
};

function fmtPlayed(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

function countUp(el, to, ms) {
    const t0 = performance.now();
    const step = (t) => {
        const k = clamp((t - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
        el.textContent = nf(Math.round(to * e));
        if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// ---------------------------------------------------------------------
// CONTROLES
// ---------------------------------------------------------------------
function bindUI() {
    $('howBtn').onclick = () => openOv('howModal');
    $('howClose').onclick = () => closeOv('howModal');
    $('briefCancel').onclick = () => closeOv('briefModal');
    $('briefGo').onclick = openLoadout;                        // 1º a bolsa; o Mestre e o cronômetro só começam depois
    $('itemsCancel').onclick = () => closeOv('itemsModal');
    $('itemsGo').onclick = () => { if (S.bag.length === BAG_SIZE) startAdventure(bagCounts()); };
    $('buyCancel').onclick = () => closeOv('buyModal');
    $('buyConfirm').onclick = confirmBuyExtra;
    $('errClose').onclick = () => closeOv('errModal');
    $('errCopy').onclick = async () => {
        try { await navigator.clipboard.writeText($('errText').textContent); toast('Texto copiado.'); }
        catch (_) { const r = document.createRange(); r.selectNodeContents($('errText')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selecionado: copie manualmente.'); }
    };

    $('btnMic').onclick = () => {
        const A = S.adv?.A; if (!A) return;
        A.micMuted = !A.micMuted;
        $('btnMic').setAttribute('aria-pressed', String(A.micMuted));
        $('btnMic').classList.toggle('live', !A.micMuted);
    };
    $('btnBag').onclick = openBagView;
    $('bagViewClose').onclick = () => closeOv('bagViewModal');
    $('btnPhones').onclick = () => {
        const A = S.adv?.A; if (!A) return;
        A.headphones = !A.headphones;
        $('btnPhones').setAttribute('aria-pressed', String(A.headphones));
        toast(A.headphones ? 'Modo fones: você pode interromper o Mestre.' : 'Modo alto-falante: o Mestre termina de falar antes de ouvir.');
    };
    $('btnLeave').onclick = async () => {
        const adv = S.adv; if (!adv) return;
        if (!confirm('Abandonar a aventura? Você perderá a recompensa e não poderá jogar de novo hoje.')) return;
        adv.finished = true;
        teardown(); S.adv = null; closeOv('diceOverlay'); closeOv('bagViewModal');
        toast('Você abandonou a aventura.', true);
        showView('lobby');
        await refreshState();
    };
    document.addEventListener('click', (e) => { if (e.target.classList?.contains('overlay') && e.target.id !== 'busyOverlay' && e.target.id !== 'diceOverlay' && e.target.id !== 'errModal' && e.target.id !== 'itemsModal') closeOv(e.target.id); });
}

async function boot() {
    buildMenu();
    bindUI();
    const { data } = await supabase.auth.getSession();
    if (!data?.session) { location.href = 'index.html'; return; }
    S.uid = data.session.user.id;
    loadHeroProfile().catch(() => {});                          // IndexedDB: não bloqueia a tela
    await loadSceneLabels();
    await refreshState();
    S.poll = setInterval(() => { if (S.view === 'lobby') refreshState(); }, POLL_MS);
    S.tick = setInterval(tickLobby, 1000);
}
boot();
