// =====================================================================
// diarias.js — Missões Diárias do Mestre (Aden RPG)
// Fluxo: lobby (inscrição/espera) → palco (Gemini Live por voz) → resultado.
// O servidor (Edge Functions + RPCs) decide dados, tempo e recompensas.
// =====================================================================
import { supabase } from './supabaseClient.js';

const ASSETS = 'https://aden-rpg.pages.dev/assets/';
const GENAI_URL = 'https://cdn.jsdelivr.net/npm/@google/genai/+esm';
const POLL_MS = 20000;
const SEND_CHUNK = 1280;                                   // 80 ms de áudio a 16 kHz
const WARN_AT_S = 120;                                     // aviso: restam 2 min → cenas finais
const END_AT_S = 60;                                       // ENCERRAR: resta 1 min
const EARLY_END_GUARD_S = 60;                              // end_adventure só é aceito quando resta 1 min ou menos (exceto se o herói cair)
// Voz do jogador: sensibilidade baixa evita que ruído/eco/respiração corte o Mestre no meio da frase
const VAD_CFG = { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', prefixPaddingMs: 120, silenceDurationMs: 800 } };
const EXTRA_COST_FALLBACK = 25;
const VIP_COST_FALLBACK = 5;                               // custo (ouro) das aventuras VIP; o servidor é quem cobra (mission_config.vip_cost_gold)
const COIN_IMG = '/assets/goldcoin.webp';
const BAG_SIZE = 8;
const HEAL_POTION = 20;                                    // % de HP da poção de cura
const BOSS_MAX_HIT = 25;                                   // dano máximo (%) por golpe em chefe (luta longa)
const PLAYER_MAX_HIT = 35;                                 // dano máximo (%) por evento no herói
const MIN_HIT_COMMON = 25;                                 // dano mínimo (%) de um golpe em criatura comum (morre em até 4 golpes)
const ENEMY_IMG = ASSETS + 'mission_ene.webp';
// O jogo põe um emoji antes do nome de quem vence batalhas de guilda; ele é removido antes de qualquer uso.
const EMOJI_RE = /[\p{Extended_Pictographic}\p{So}\p{Regional_Indicator}\u200D\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu;
const stripEmoji = (t) => String(t ?? '').replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
const DEFAULT_AVATAR = 'https://aden-rpg.pages.dev/avatar01.webp';
const GLOBAL_DB_NAME = 'aden_global_db', GLOBAL_DB_VERSION = 8;
// marcos de ritmo enviados ao Mestre (segundos desde o início da sessão)
const MARKS = [
    { at: 300, text: '[SISTEMA] MARCO (5 min de 30), NÃO responda falando agora; aplique na sua próxima fala: se o herói ainda não recebeu a missão, entregue-a agora e inicie a JORNADA (viagem, estalagens, NPCs, pistas).' },
    { at: 900, text: '[SISTEMA] MARCO (15 min de 30), NÃO responda falando agora; aplique na sua próxima fala: a partir de agora o herói se aproxima do lugar do objetivo e o CHEFE pode finalmente aparecer. Gere tensão e prepare a luta, que deve ser longa e emocionante.' },
    { at: 1260, text: '[SISTEMA] MARCO (21 min de 30), NÃO responda falando agora; aplique na sua próxima fala: se o chefe ainda não apareceu, ele deve entrar em cena AGORA, para o confronto caber no tempo que resta.' },
];
// marcos para aventuras SEM chefe/combate (Salão do Amor)
const MARKS_SOCIAL = [
    { at: 300, text: '[SISTEMA] MARCO (5 min), NÃO responda falando agora; aplique na sua próxima fala: as apresentações já devem ter acontecido; faça o herói circular pelos cômodos e conhecer os convidados mais de perto.' },
    { at: 900, text: '[SISTEMA] MARCO (15 min), NÃO responda falando agora; aplique na sua próxima fala: o clima do salão esquenta; se o herói ainda não está conquistando ninguém, os convidados o procuram, puxam conversa e criam oportunidades de aproximação.' },
    { at: 1260, text: '[SISTEMA] MARCO (21 min), NÃO responda falando agora; aplique na sua próxima fala: a noite avança; se ninguém foi conquistado ainda, o convidado mais próximo do herói se declara interessado e dá a última chance de conquista; para o epílogo caber no tempo.' },
];
const BOSS_MIN_S = 15 * 60;                                // chefe derrotado só dá recompensa máxima com pelo menos 15 min de sessão
const END_OK_S = 20 * 60;                                  // a partir daqui o Mestre pode encerrar quando o jogador escolher concluir
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
    wrong_password: 'Senha incorreta.',
    too_many_attempts: 'Muitas tentativas. Aguarde alguns minutos.',
    invalid_prompt: 'Prompt inválido. Escreva o roteiro do Modo Privado.',
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
    invalid_type: 'Tipo de aventura inválido. Escolha novamente.',
    extra_limit: 'Você já usou todas as aventuras extras de hoje.',
    extra_pending: 'Você já tem uma aventura extra esperando por você.',
    master_busy: 'O Mestre está ocupado com outros aventureiros. Tente novamente em alguns minutos.',
    gemini_unavailable: 'O Mestre está indisponível no momento. Tente novamente em alguns minutos.',
    gemini_auth: 'O Mestre está em manutenção. Tente novamente mais tarde.',
    server_not_configured: 'O Mestre está em manutenção. Tente novamente mais tarde.',
    prepare_failed: 'Não foi possível preparar a aventura. Tente novamente.',
    no_connection: 'Sem conexão com o servidor. Verifique a sua internet e tente novamente.',
};
const BUSY_MSG = ERR.master_busy;

// Classifica o texto de um erro vindo do Gemini / da rede (códigos HTTP, status gRPC e códigos de fechamento do WebSocket)
function geminiKind(text) {
    const t = String(text || '');
    if (/failed to send|failed to fetch|networkerror|network request failed|load failed/i.test(t)) return 'no_connection';
    if (/\b429\b|quota|resource[_ ]?exhaust|rate.?limit|too many|overload|exceed/i.test(t)) return 'master_busy';
    if (/\b40[13]\b|unauthenticated|permission[_ ]denied|api key|token.*(expired|invalid)|expired/i.test(t)) return 'gemini_auth';
    if (/\b50[0-4]\b|internal|unavailable|deadline|time-?out|\b101[13]\b/i.test(t)) return 'gemini_unavailable';
    return null;
}
const friendly = (m) => {
    const k = String(m || '').trim();
    return ERR[k] || ERR[geminiKind(k)] || 'Algo deu errado. Tente novamente.';
};

function showDebug(title, text) {
    $('errTitle').textContent = title || 'Algo deu errado';
    $('errText').textContent = String(text || '(sem detalhes)');
    openOv('errModal');
}

const S = {
    uid: null, offset: 0, state: null, scenes: {}, poll: null, tick: null,
    view: 'lobby', busy: false, adv: null, hero: null, bag: [],
    advType: null, vipOwned: new Set(), vipPending: null, privatePass: null, privatePrompt: '',
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
    const changed = S.view !== v;
    S.view = v;
    ['Lobby', 'Stage', 'Result'].forEach((n) => $('view' + n).classList.toggle('active', n.toLowerCase() === v));
    if (changed) window.DiariasHud?.show();                    // trocou de tela: mostra a interface de novo
    if (v === 'lobby') paintScene('');                         // saguão = /assets/diarias.png (idempotente)
}
const sceneLabel = (id) => S.scenes[id] || String(id || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

async function callFn(name, body) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
        let msg = error.message, detail = '', retryAt = null;
        try { const j = await error.context.json(); msg = j.error || msg; detail = j.detail || ''; retryAt = j.retry_at || null; } catch (_) { /* ignora */ }
        const err = new Error(msg); err.detail = detail; err.retry_at = retryAt;
        throw err;
    }
    if (data && data.error) throw new Error(data.error);
    return data;
}

// Cenário 360°: /assets/missions/<id>.png vira skybox (diarias_skybox.js), com crossfade e rotação lenta.
// Sem imagem (ou se falhar ao carregar), o skybox usa este degradê temático [centro, bordas].
const LOBBY_SCENE = 'diarias';                              // /assets/missions/diarias.png: tela inicial
const FALLBACK_SKY = {
    floresta: ['#1d3d27', '#07130b'],
    caverna: ['#2b2347', '#0a0814'],
    ruinas: ['#4a3b27', '#120d08'],
    vila: ['#4a3317', '#140d06'],
    montanha: ['#2a3f57', '#070b12'],
    pantano: ['#25402f', '#08110c'],
    penumbra: ['#1a1f33', '#04050a'],
    torre: ['#3a3358', '#0b0916'],
    taverna: ['#5a3a1c', '#170d05'],
    desfiladeiro: ['#6a3a1f', '#1a0c05'],
    zion: ['#4a4a2a', '#12120a'],
    capital: ['#3d3a4a', '#0d0c12'],
    elendor: ['#1f4a3a', '#06140f'],
    vila_neve: ['#51657a', '#0c121a'],
};
function paintScene(sceneId) {
    const id = sceneId || LOBBY_SCENE;
    window.DiariasSkybox?.show(id, FALLBACK_SKY[id]);
    updateColdWeather(sceneId);
}

// Clima gelado (neve + névoa + geada + color grade, como em solaris.html): terreno ABERTO em tempo de frio.
//  - cenários de neve/gelo (vila_neve etc.) sempre nevam;
//  - na aventura "Inverno intenso" (frio), qualquer cenário externo neva (taverna e salão são internos).
const INDOOR_SCENES = new Set(['taverna', 'salao_amor']);
const SNOWY_SCENE_RE = /neve|gelo|solaris|razar|inverno|nevasca/i;
function updateColdWeather(sceneId) {
    const adv = S.adv;
    let on = false;
    if (adv && sceneId) {
        on = SNOWY_SCENE_RE.test(sceneId) || (adv.advType === 'frio' && !INDOOR_SCENES.has(sceneId) && sceneId !== LOBBY_SCENE);
    }
    window.__weatherWant = on;
    window.DiariasWeather?.set(on);
}

// ---------------------------------------------------------------------
// MENU LATERAL (mesmo padrão da Mineração)
// ---------------------------------------------------------------------
function buildMenu() {
    const CURRENT = 'diarias.html';
    const A = ASSETS;
    const items = [
        { name: 'Tela inicial', url: 'index.html', icon: A + 'homeic.webp' },
        {
            name: 'Aventura', icon: A + 'expm.webp', isDropdown: true, notifKeys: ['afk', 'diarias'], subItems: [
                { name: 'Aventura AFK', url: 'afk.html', key: 'afk' },
                { name: 'Mestre das Lendas', url: 'diarias.html', key: 'diarias' },
            ],
        },
        { name: 'Mineração', url: 'mines.html', icon: A + 'recursos.webp' },
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
        { name: 'Arena PvP', url: 'arena.html', icon: A + 'pvp.webp', key: 'arena' },
        { name: 'Chefe Mundial', url: 'solo_boss.html', icon: A + 'bossm.webp', key: 'boss' },
        { name: 'Guilda', url: 'guild.html', icon: A + 'guilda.webp', key: 'guild' },
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

    // --- NOTIFICAÇÕES (chave compartilhada: aden_daily_actions_status) ---
    const KEY_STATUS = 'aden_daily_actions_status';
    const readStatus = () => { try { return JSON.parse(localStorage.getItem(KEY_STATUS) || '{}'); } catch (e) { return {}; } };

    // Reset das Missões Diárias: todo dia às 03:00 UTC
    const ensureDiariasDailyReset = () => {
        try {
            const KEY_MARK = 'aden_last_diarias_reset_utc';
            const period = new Date(Date.now() - 3 * 3600 * 1000).toISOString().split('T')[0];
            if (localStorage.getItem(KEY_MARK) !== period) {
                const st = readStatus();
                st.diarias = true;
                localStorage.setItem(KEY_STATUS, JSON.stringify(st));
                localStorage.setItem(KEY_MARK, period);
            }
        } catch (e) {}
    };

    const clearNotification = (key) => {
        if (!key) return;
        if (key === 'diarias') return;                    // só some quando o jogador INICIA a aventura
        const st = readStatus();
        if (st[key] === true) { st[key] = false; localStorage.setItem(KEY_STATUS, JSON.stringify(st)); }
        if (key === 'guild') {
            const now = new Date(), day = now.getUTCDay(), h = now.getUTCHours(), m = now.getUTCMinutes();
            if (day === 6) localStorage.setItem('aden_guild_notif_seen_saturday', 'true');
            if (day === 0 && h === 23 && m >= 30) localStorage.setItem('aden_guild_notif_seen_sunday', 'true');
        }
    };

    const renderNotifications = () => {
        ensureDiariasDailyReset();
        const st = readStatus();
        const now = new Date(), day = now.getUTCDay(), h = now.getUTCHours(), m = now.getUTCMinutes();
        const KEY_SAT = 'aden_guild_notif_seen_saturday', KEY_SUN = 'aden_guild_notif_seen_sunday';
        if (day === 1) { localStorage.removeItem(KEY_SAT); localStorage.removeItem(KEY_SUN); }
        let guildDot = false;
        if (day === 6 && !localStorage.getItem(KEY_SAT)) guildDot = true;
        if (day === 0 && h === 23 && m >= 30 && !localStorage.getItem(KEY_SUN)) guildDot = true;

        list.querySelectorAll('.menu-link').forEach((link) => {
            const key = link.dataset.menuKey, pk = link.dataset.menuKeys;
            const show = (key && st[key] === true)
                || (key === 'guild' && guildDot)
                || (pk && pk.split(',').some((k) => st[k] === true));
            link.querySelector('.menu-notification-dot')?.remove();
            if (show) {
                const d = document.createElement('div');
                d.className = 'menu-notification-dot';
                if (link.classList.contains('submenu-link')) { d.style.left = 'auto'; d.style.right = '18px'; }
                link.appendChild(d);
            }
        });
    };

    ensureDiariasDailyReset();
    list.innerHTML = '';
    items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'menu-item';
        if (item.isDropdown) {
            const active = item.subItems.some((s) => s.url === CURRENT);
            const a = document.createElement('a');
            a.className = 'menu-link dropdown-toggle'; a.style.cursor = 'pointer'; a.style.position = 'relative';
            if (item.notifKeys) a.dataset.menuKeys = item.notifKeys.join(',');
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
                sa.className = 'menu-link submenu-link'; sa.style.position = 'relative';
                sa.innerHTML = `<span>${sub.name}</span>`;
                if (sub.key) sa.dataset.menuKey = sub.key;
                if (match) {
                    if (sub.key) clearNotification(sub.key);   // já está na página = "abriu"
                    sa.style.cursor = 'default'; sa.style.pointerEvents = 'none';
                } else {
                    sa.href = sub.url;
                    sa.addEventListener('click', () => {
                        if (sub.key) { clearNotification(sub.key); renderNotifications(); }
                        setTimeout(closeMenu, 100);
                    });
                }
                sl.appendChild(sa); ul.appendChild(sl);
            });
            li.appendChild(a); li.appendChild(ul);
        } else {
            const a = document.createElement('a');
            a.className = 'menu-link'; a.style.position = 'relative';
            if (item.key) a.dataset.menuKey = item.key;
            a.innerHTML = `<img src="${item.icon}" class="menu-icon" alt="" onerror="this.style.display='none'"><span>${item.name}</span>`;
            a.href = item.url;
            a.addEventListener('click', () => { if (item.key) { clearNotification(item.key); a.querySelector('.menu-notification-dot')?.remove(); } });
            li.appendChild(a);
        }
        list.appendChild(li);
    });

    renderNotifications();
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
    if (error) {
        if (/not_authenticated|jwt|401/i.test(error.message || '')) {   // id local pode estar velho: confere a sessão de verdade
            const { data: sd } = await supabase.auth.getSession();
            if (!sd?.session) { location.href = 'index.html'; return; }
        }
        renderCard('<p class="hint">Não foi possível consultar o Mestre agora.</p>'); return;
    }
    S.state = data;
    S.offset = new Date(data.now).getTime() - Date.now();
    await maybeSendPending();
    renderLobby();
}

function renderCard(html) { $('questCard').innerHTML = html; }

const TIP = 'Dica: conduza a história e realize mais ações para ter um desempenho melhor nas recompensas. Derrote o chefe depois de 15 minutos de aventura (e antes de acabar o tempo) para ganhar a recompensa máxima.';

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

// Botão de iniciar em modo espera: cronômetro no lugar do texto, cinza e desabilitado. label=null restaura.
function setStartWait(btn, label) {
    if (!btn) return;
    if (label) {
        btn.disabled = true;
        btn.dataset.waiting = '1';
        btn.style.filter = 'grayscale(1)';
        btn.style.cursor = 'not-allowed';
        if (btn.textContent !== label) btn.textContent = label;
    } else if (btn.dataset.waiting) {
        delete btn.dataset.waiting;
        btn.style.filter = ''; btn.style.cursor = '';
        btn.textContent = 'Entrar na aventura';
    }
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
    if ($('typeModal').classList.contains('open') && my?.status === 'reserved') {
        const left = new Date(my.start_deadline).getTime() - now;
        $('typeTimer').textContent = left > 0 ? `Tempo para começar: ${mmss(left)}` : 'O tempo de tolerância acabou.';
        if (left <= 0) { closeOv('vipModal'); closeOv('privPassModal'); closeOv('privPromptModal'); closeOv('typeModal'); }
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
            const wait = S.busyFor === my.id ? S.busyUntil - now : 0;   // lotado: espera a próxima vaga abrir
            if (wait > 0) {
                if (hint) hint.textContent = 'Todas as vagas do Mestre estão ocupadas. O botão libera quando uma vaga abrir. Sua vaga continua garantida.';
                setStartWait(btn, mmss(wait));
            } else {
                if (S.busyFor === my.id) { S.busyUntil = 0; S.busyFor = null; }
                setStartWait(btn, null);                                // volta ao texto normal
                if (hint) hint.textContent = `Entre agora! Tolerância: ${mmss(dead - now)}`;
                if (btn) btn.disabled = false;
            }
        } else {
            refreshState();
        }
    } else if (ev && q('t-close')) {
        q('t-close').textContent = mmss(new Date(ev.closes_at).getTime() - now);
    }
}

async function openBrief() {
    if (!(await window.AdenMic?.precheck?.())) return;          // microfone bloqueado: modal com tutorial e NÃO inicia
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
    S.hero = { name: stripEmoji(h.name), avatar: h.avatar };
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

const _spiral = (cx, cy, turns, rmax) => Array.from({ length: 61 }, (_, i) => {
    const t = i / 60, a = t * turns * 2 * Math.PI, r = t * rmax;
    return (i ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1);
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
    { id: 'enc_critico', name: 'Encantamento de dano crítico', desc: 'O próximo ataque bem-sucedido causa o dobro de dano. Se errar, continua válido.',
      svg: _svg(`<polygon points="${_star(24, 24, 8, 21, 12)}" fill="#c0262f" stroke="#ffd27a" stroke-width="2"/><polygon points="${_star(24, 24, 8, 16, 9, -67.5)}" fill="#e8454f" stroke="none"/><text x="24" y="30" text-anchor="middle" font-size="15" font-weight="bold" font-family="sans-serif" fill="#fff" stroke="none">×2</text>`) },
    { id: 'enc_controle', name: 'Encantamento de controle mental', desc: 'Chance de controlar a mente de um animal ou ser vivo para uma ação.',
      svg: _svg(`<circle cx="24" cy="24" r="18" fill="#2a1740" stroke="#c77dff" stroke-width="2"/><path d="${_spiral(24, 24, 2.6, 13.5)}" stroke="#e8c4ff" stroke-width="2"/><circle cx="24" cy="24" r="2" fill="#fff" stroke="none"/><path d="M24 6V2M9.5 10L7 7.5M38.5 10L41 7.5" stroke="#c77dff" stroke-width="2"/>`) },
    { id: 'enc_verdade', name: 'Encantamento da verdade', desc: 'Chance de forçar uma pessoa a dizer apenas a verdade.',
      svg: _svg('<path d="M24 8v31M14 41h20" stroke="#e6c27a" stroke-width="3"/><path d="M9 14l15-4 15 4" stroke="#e6c27a" stroke-width="2.6"/><path d="M9 14L4 26a5 4 0 0 0 10 0zM39 14L34 26a5 4 0 0 0 10 0z" fill="#f4e3b0" stroke="#a88235" stroke-width="1.6"/><circle cx="24" cy="7" r="3.2" fill="#ffe27a" stroke="#a88235" stroke-width="1.4"/>') },
    { id: 'enc_furtividade', name: 'Encantamento da furtividade', desc: 'Chance de ficar invisível por instantes.',
      svg: _svg('<path d="M3 24s8-13 21-13 21 13 21 13-8 13-21 13S3 24 3 24z" fill="#1a2230" stroke="#8fb4d9" stroke-width="2"/><circle cx="24" cy="24" r="7" fill="#5a86b3" stroke="#cfe3f5" stroke-width="1.6"/><circle cx="24" cy="24" r="3" fill="#0b1018" stroke="none"/><path d="M8 41L40 7" stroke="#e6c27a" stroke-width="3"/>') },
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

const bagCounts = () => S.bag.reduce((o, id) => { o[id] = (o[id] || 0) + 1; return o; }, {});

function openLoadout() {
    closeOv('briefModal');
    S.bag = [];
    S.advType = null; S.vipOwned = new Set(); S.vipPending = null; S.privatePass = null; S.privatePrompt = '';
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
// TIPO DE AVENTURA: escolhido depois da bolsa. Comum e Abrigo do frio são grátis; as demais são VIP (ouro).
// Os ids precisam ser os mesmos de ADVENTURE_TYPES no mission-token.ts e da lista no 06_mission_prepare_start.sql.
// ---------------------------------------------------------------------
const _sword = (rot) => `<g transform="rotate(${rot} 24 24)"><path d="M24 2l3.6 4.5V28h-7.2V6.5z" fill="#d7dde3" stroke="#8793a0" stroke-width="1.5"/><path d="M24 5v22" stroke="#8793a0" stroke-width="1"/><rect x="14.5" y="28" width="19" height="4" rx="1.6" fill="#e6c27a" stroke="#a88235" stroke-width="1.3"/><path d="M24 32v8" stroke="#6b4a1c" stroke-width="4"/><circle cx="24" cy="42" r="2.5" fill="#e6c27a" stroke="#a88235" stroke-width="1.2"/></g>`;
const ADV_TYPES = [
    { id: 'comum', vip: false, name: 'Aventura comum', desc: 'Uma jornada clássica: aceite uma missão, viaje, enfrente inimigos e derrote o chefe.',
      svg: _svg(_sword(45) + _sword(-45) + '<circle cx="24" cy="24" r="3" fill="#e6c27a" stroke="#a88235" stroke-width="1.2"/>') },
    { id: 'frio', vip: false, name: 'Abrigo do frio', desc: 'Um inverno mágico cai sobre a região. Sobreviva 3 dias num abrigo cheio de medo, fome e criaturas.',
      svg: _svg('<path d="M24 4v40M6.7 14l34.6 20M6.7 34l34.6-20" stroke="#9fe3ff" stroke-width="2.8"/><path d="M19 8l5 4 5-4M19 40l5-4 5 4M8 19.5l6 .5-1.5-5.8M40 28.5l-6-.5 1.5 5.8M8 28.5l6-.5-1.5 5.8M40 19.5l-6 .5 1.5-5.8" stroke="#d8f6ff" stroke-width="2"/><circle cx="24" cy="24" r="4.2" fill="#d8f6ff" stroke="#6fb8d9" stroke-width="1.4"/>') },
    { id: 'assassino', vip: true, name: 'Quem é o assassino?', desc: 'Um crime abalou o lugar. Interrogue suspeitos, siga pistas e desmascare o culpado.',
      svg: _svg('<circle cx="20" cy="20" r="13" fill="#1c2330" stroke="#e6c27a" stroke-width="3"/><path d="M29.5 29.5L42 42" stroke="#6b4a1c" stroke-width="5.5"/><path d="M29.5 29.5L42 42" stroke="#c9a45c" stroke-width="2" stroke-dasharray="2 4"/><path d="M20 10c3.2 5 6.6 8.2 6.6 11.6a6.6 6.6 0 0 1-13.2 0C13.4 18.2 16.8 15 20 10z" fill="#c0262f" stroke="#ffb3b8" stroke-width="1.4"/><circle cx="17.6" cy="22.4" r="1.8" fill="#ff8c96" stroke="none"/>') },
    { id: 'intriga', vip: true, name: 'Intriga social', desc: 'Banquetes, segredos e alianças. Use lábia e astúcia num jogo de aparências.',
      svg: _svg('<path d="M5 15c6-4.5 13-5.5 19-2.5 6-3 13-2 19 2.5 0 13-6.5 21-19 21S5 28 5 15z" fill="#5b3fa8" stroke="#d9c8ff" stroke-width="2"/><path d="M11.5 19.5c3.2-2.2 7-1.5 9.2 2-3.4 3.2-7.2 3.2-9.2-2zM36.5 19.5c-3.2-2.2-7-1.5-9.2 2 3.4 3.2 7.2 3.2 9.2-2z" fill="#0b0814" stroke="#ffe27a" stroke-width="1.4"/><path d="M17.5 30c4 3.8 9 3.8 13 0" stroke="#ffe27a" stroke-width="2"/><path d="M24 7l1.6 3.4 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#ffe27a" stroke="none"/>') },
    { id: 'infiltracao', vip: true, name: 'Infiltração', desc: 'Entre sem ser visto num lugar protegido para roubar, resgatar ou plantar algo.',
      svg: _svg('<path d="M15.5 22v-6.5a8.5 8.5 0 0 1 17 0V22" stroke="#cfe3f5" stroke-width="3.6"/><rect x="9" y="21" width="30" height="21" rx="4.5" fill="#2a2f3a" stroke="#8fb4d9" stroke-width="2"/><circle cx="24" cy="29.5" r="3.8" fill="#0b1018" stroke="none"/><path d="M22.2 32h3.6l1.2 6.5h-6z" fill="#0b1018" stroke="none"/><path d="M13 25h4" stroke="#5a86b3" stroke-width="1.6"/>') },
    { id: 'maldicao', vip: true, name: 'Maldição e assombração', desc: 'Um lugar assombrado guarda uma verdade trágica. Descubra a origem e liberte o espírito.',
      svg: _svg('<path d="M9 43V22a15 15 0 0 1 30 0v21l-5.4-4.2-4.8 4.2-4.8-4.2-4.8 4.2-4.8-4.2z" fill="#e8e4f5" stroke="#9b87d9" stroke-width="2"/><ellipse cx="18.6" cy="22" rx="2.7" ry="3.8" fill="#1c1030" stroke="none"/><ellipse cx="29.4" cy="22" rx="2.7" ry="3.8" fill="#1c1030" stroke="none"/><ellipse cx="24" cy="30.5" rx="2.5" ry="3.2" fill="#1c1030" stroke="none"/><circle cx="7" cy="9" r="1.6" fill="#cbb8ff" stroke="none"/><circle cx="42" cy="12" r="1.2" fill="#cbb8ff" stroke="none"/><circle cx="40" cy="5" r="1" fill="#cbb8ff" stroke="none"/>') },
    { id: 'salao_amor', vip: true, name: 'Salão do Amor', desc: 'Doze pessoas, um salão e uma noite para se conhecerem. Conquiste o coração de alguém e viva o romance.',
      svg: _svg(`<path d="M24 42C7 30 4.5 18.5 10.5 12 16 6.3 22.3 9 24 14.5 25.7 9 32 6.3 37.5 12 43.5 18.5 41 30 24 42z" fill="#e5334f" stroke="#ffb3c1" stroke-width="2"/><path d="M12.5 16c1.2-3 4.2-4 6.5-3" stroke="#fff" stroke-width="2" opacity=".75"/><polygon points="${_star(38, 9, 4, 4.5, 1.4)}" fill="#ffe27a" stroke="none"/><polygon points="${_star(8, 36, 4, 3.4, 1.1)}" fill="#ffe27a" stroke="none"/>`) },
    { id: 'fenda_temporal', vip: true, name: 'Fenda Temporal', desc: 'Uma fenda no tempo leva você a um grande evento da história. Aliado ou inimigo, a escolha é sua.',
      svg: _svg('<path d="M12 5h24M12 43h24" stroke="#e6c27a" stroke-width="3.2"/><path d="M14 5h20c0 11-10 13-10 19s10 8 10 19H14c0-11 10-13 10-19S14 16 14 5z" fill="#2a1740" stroke="#cbb8ff" stroke-width="2.2"/><path d="M19 10h10l-5 7z" fill="#ffd35a" stroke="none"/><path d="M17 41c2.2-6 5.4-8.6 7-8.6s4.8 2.6 7 8.6z" fill="#ffd35a" stroke="none"/><path d="M24 20v10" stroke="#ffd35a" stroke-width="1.4" stroke-dasharray="1.5 2.5"/><circle cx="40" cy="12" r="1.4" fill="#cbb8ff" stroke="none"/><circle cx="8" cy="30" r="1.2" fill="#cbb8ff" stroke="none"/>') },
    { id: 'privado', vip: false, private: true, name: 'Modo Privado', desc: 'Modo exclusivo para jogadores VIPs',
      svg: _svg(`<path d="M15.5 21v-5.5a8.5 8.5 0 0 1 17 0V21" stroke="#e6c27a" stroke-width="3.4"/><rect x="9" y="20" width="30" height="22" rx="4.5" fill="#2a1740" stroke="#cbb8ff" stroke-width="2"/><path d="M24 36.5c-5-3.4-6.6-6-5.2-8.2 1.2-1.7 3.7-1.5 5.2.5 1.5-2 4-2.2 5.2-.5 1.4 2.2-.2 4.8-5.2 8.2z" fill="#e5334f" stroke="#ffb3c1" stroke-width="1.2"/><polygon points="${_star(39, 9, 4, 4, 1.3)}" fill="#ffe27a" stroke="none"/><polygon points="${_star(8, 10, 4, 3.2, 1)}" fill="#ffe27a" stroke="none"/>`) },
];
const ADV_PRIVATE = 'privado';                           // Modo Privado: mesma mecânica do Salão do Amor, mas o roteiro é escrito pelo jogador (senha VIP, sem ouro)
const isSalao = (t) => t === 'salao_amor' || t === ADV_PRIVATE;
const ADV_BY_ID = Object.fromEntries(ADV_TYPES.map((t) => [t.id, t]));
const vipCost = () => S.state?.extra?.vip_cost ?? VIP_COST_FALLBACK;

function openTypes() {                                        // depois da bolsa: escolha do tipo de aventura
    closeOv('itemsModal');
    buildTypeGrid();
    openOv('typeModal');
}

function buildTypeGrid() {
    const g = $('typeGrid'); g.innerHTML = '';
    ADV_TYPES.forEach((t) => {
        const owned = S.vipOwned.has(t.id);
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'type-card' + (S.advType === t.id ? ' sel' : ''); b.dataset.id = t.id;
        const badge = t.private ? '<em class="vip-badge owned">🔒 VIP</em>' : !t.vip ? '' : owned
            ? '<em class="vip-badge owned">✓ VIP</em>'
            : `<em class="vip-badge"><img src="${COIN_IMG}" width="12" height="12" alt="">${vipCost()}</em>`;
        b.innerHTML = `${badge}<em class="tick">✓</em>${t.svg}<b>${esc(t.name)}</b><span class="desc">${esc(t.desc)}</span>`;
        b.onclick = () => onTypeClick(t);
        g.appendChild(b);
    });
    $('typeGo').disabled = !S.advType;
}

function onTypeClick(t) {
    if (t.private) { onPrivateClick(t); return; }                        // Modo Privado: senha + prompt, sem ouro
    if (t.vip && !S.vipOwned.has(t.id)) { openVipConfirm(t); return; }   // VIP ainda não adquirida: pede confirmação
    S.advType = S.advType === t.id ? null : t.id;                        // toggle: clicar de novo desmarca
    buildTypeGrid();
}

// ----- MODO PRIVADO: 1) senha VIP (validada no servidor)  2) prompt escrito pelo jogador -----
const PRIVATE_PROMPT_MIN = 10, PRIVATE_PROMPT_MAX = 1500;
function onPrivateClick(t) {
    if (S.advType === t.id) { S.advType = null; buildTypeGrid(); return; }   // toggle: clicar de novo desmarca
    if (S.privatePass) openPrivatePrompt(); else openPrivatePass();
}
function openPrivatePass() {
    $('privPass').value = ''; $('privPassErr').textContent = ''; $('privPassOk').disabled = false;
    openOv('privPassModal');
    setTimeout(() => $('privPass').focus(), 60);
}
async function submitPrivatePass() {
    const pass = $('privPass').value, my = S.state?.my_slot;
    if (!pass || !my) return;
    const ok = $('privPassOk'), err = $('privPassErr');
    ok.disabled = true; err.textContent = '';
    try {
        await callFn('mission-token', { slot_id: my.id, action: 'private_check', password: pass });   // só o servidor conhece a senha
        S.privatePass = pass; closeOv('privPassModal'); openPrivatePrompt();
    } catch (e) {
        err.textContent = ERR[e.message] || 'Não foi possível validar a senha.'; ok.disabled = false; $('privPass').select();
    }
}
function openPrivatePrompt() {
    const ta = $('privPrompt'); ta.value = S.privatePrompt || '';
    $('privPromptErr').textContent = ''; updatePrivCount();
    openOv('privPromptModal');
    setTimeout(() => ta.focus(), 60);
}
function updatePrivCount() { $('privPromptCount').textContent = `${$('privPrompt').value.length}/${PRIVATE_PROMPT_MAX}`; }
function confirmPrivatePrompt() {
    const txt = $('privPrompt').value.trim();
    if (txt.length < PRIVATE_PROMPT_MIN) { $('privPromptErr').textContent = `Escreva pelo menos ${PRIVATE_PROMPT_MIN} caracteres.`; return; }
    S.privatePrompt = txt.slice(0, PRIVATE_PROMPT_MAX); S.advType = ADV_PRIVATE;
    closeOv('privPromptModal'); buildTypeGrid();
}

function openVipConfirm(t) {
    S.vipPending = t;
    const cost = vipCost(), gold = S.state?.extra?.gold;
    $('vipName').textContent = t.name;
    $('vipCost').textContent = cost; $('vipCostTxt').textContent = cost;
    $('vipGold').textContent = nf(gold); $('vipGold').parentElement.style.display = gold == null ? 'none' : '';   // sem saldo no estado: esconde a linha
    $('vipConfirm').disabled = gold != null && Number(gold) < cost;      // o servidor confere de novo ao começar
    openOv('vipModal');
}

function confirmVip() {
    const t = S.vipPending; closeOv('vipModal'); if (!t) return;
    S.vipOwned.add(t.id); S.advType = t.id; S.vipPending = null;         // "adquirida": fica selecionada (o ouro é cobrado ao começar)
    buildTypeGrid();
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

// O navegador não lista quem usa o microfone, mas sinaliza quando outro app/ligação o ocupa:
// getUserMedia falha (NotReadableError/AbortError) ou a trilha nasce silenciada pelo sistema (muted).
async function micInUse(stream) {
    const tr = stream.getAudioTracks()[0];
    if (!tr || tr.readyState !== 'live') return true;
    await sleep(700);                                          // dá tempo de o sistema sinalizar o mute
    return tr.muted || tr.readyState !== 'live';
}

async function initAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    let stream = null;
    try {
        await ctx.resume();
        stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
        if (await micInUse(stream)) { const er = new Error('mic_busy'); er.name = 'MicBusyError'; throw er; }
    } catch (e) {
        try { stream?.getTracks().forEach((t) => t.stop()); } catch (_) { /* ok */ }
        try { await ctx.close(); } catch (_) { /* ok */ }
        throw e;
    }
    let lastMuteWarn = 0;                                      // microfone tomado por outro app durante o jogo
    stream.getAudioTracks()[0].addEventListener('mute', () => {
        if (S.adv && !S.adv.finished && Date.now() - lastMuteWarn > 20000) {
            lastMuteWarn = Date.now();
            toast('O microfone foi interrompido. Algum app ou ligação pode estar usando-o.', true);
        }
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

const elapsedS = (adv) => (adv.totalMs - (adv.endMs - serverNow())) / 1000;
const bossReady = (adv) => !!adv.bossDown && elapsedS(adv) >= BOSS_MIN_S;

const masterSpeaking = (A) => A.ctx.currentTime < A.nextTime + 0.5;

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

// Encerramento: espera o Mestre falar TUDO antes de sair da tela. O áudio chega mais rápido que o tempo real,
// então a fila de reprodução pode ter bem mais de 9 s. Só sai quando (a) o servidor sinalizou fim de turno e
// o áudio acabou, ou (b) ficou em silêncio por um tempo; teto de segurança de 75 s.
async function awaitMasterDone(adv, maxMs = 75000) {
    const t0 = Date.now();
    let quietSince = 0;
    while (Date.now() - t0 < maxMs) {
        const talking = masterSpeaking(adv.A);
        if (talking) quietSince = 0;
        else {
            quietSince = quietSince || Date.now();
            const needed = adv.turnDone ? 1200 : 5000;           // sem fim de turno: o Mestre ainda pode continuar após a ferramenta
            if (Date.now() - quietSince > needed) break;
        }
        await sleep(150);
    }
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
    if (why === BUSY_MSG) toast(why, true); else showDebug(why, detail);
    await refreshState();
}

// O idioma escolhido fica em players.language (set_player_language). Quem escolheu o idioma antes de logar
// só tem o cookie googtrans: sincronizamos aqui, sem bloquear o início se falhar.
const LANGS_OK = ['pt','en','es','zh-CN','ja','ko','id','tl','ru','it','fr','hi','ms','vi','ar'];
async function syncLanguage() {
    try {
        const m = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('googtrans='));
        const lang = m ? decodeURIComponent(m.split('=')[1] || '').split('/').pop() : 'pt';
        if (lang && LANGS_OK.includes(lang)) await supabase.rpc('set_player_language', { p_lang: lang });
    } catch (_) { /* best-effort */ }
}

async function startAdventure(loadout, advType) {
    if (S.starting) return;                                    // evita toque duplo
    S.starting = true;
    try { await _startAdventure(loadout, advType); } finally { S.starting = false; }
}

// Mestre das Lendas: a bolinha de notificação só some quando o jogador realmente INICIA a aventura
function clearDiariasDot() {
    try {
        const k = 'aden_daily_actions_status', st = JSON.parse(localStorage.getItem(k) || '{}');
        if (st.diarias === true) { st.diarias = false; localStorage.setItem(k, JSON.stringify(st)); }
        document.querySelectorAll('.menu-link[data-menu-key="diarias"] .menu-notification-dot').forEach((d) => d.remove());
    } catch (_) { /* ok */ }
}

async function _startAdventure(loadout, advType) {
    const my = S.state?.my_slot; if (!my || my.status !== 'reserved') return;
    closeOv('vipModal'); closeOv('privPassModal'); closeOv('privPromptModal'); closeOv('typeModal'); closeOv('itemsModal');
    busy(true, 'Preparando o microfone…');

    let A = null, ctx = null;
    try {
        A = await initAudio();                                   // 1º: microfone (se negar, a vaga não é gasta)
        A.headphones = $('chkPhones').checked;
        busy(true, 'Invocando o Mestre…');
        await syncLanguage();                                    // garante players.language = idioma escolhido (o Mestre fala nele)
        const body = { slot_id: my.id, loadout, adventure_type: advType || 'comum' };
        if (advType === ADV_PRIVATE) { body.private_password = S.privatePass; body.private_prompt = S.privatePrompt; }   // servidor revalida a senha e injeta o prompt no Mestre
        ctx = await callFn('mission-token', body);   // o cronômetro só começa aqui, depois da bolsa e do tipo
        clearDiariasDot();                                       // o Mestre atendeu: agora sim a bolinha do menu some
        S.busyUntil = 0; S.busyFor = null;                       // entrou: some qualquer espera anterior
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
        const micBusy = e && (e.name === 'MicBusyError' || e.name === 'NotReadableError' || e.name === 'AbortError' || e.name === 'TrackStartError');
        if (micBusy) { toast('O microfone está em uso por outro app ou site.', true); window.AdenMic?.showBusy?.(); }
        else if (denied) { toast('Permita o microfone para jogar.', true); window.AdenMic?.showBlocked?.(); }
        else if (e.message === 'master_busy' && e.retry_at) {    // todas as vagas do Mestre ocupadas: o botão vira cronômetro até abrir uma
            S.busyUntil = new Date(e.retry_at).getTime(); S.busyFor = my.id;
            toast('Todas as vagas do Mestre estão ocupadas. Sua vaga continua garantida.', true);
        }
        else if (friendly(e.message) === BUSY_MSG) toast(BUSY_MSG, true);   // lotado (cota do Gemini): aviso simples, a vaga continua sua
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
        heroFem: ctx.hero_gender === 'f',
        advType: ctx.adventure_type || 'comum', noCombat: !!ctx.no_combat,
        sceneKw: parseSceneKeywords(ctx.scenes), kwScanned: 0,
        long: null, chainTimer: null,
        epilogue: false, delivered: false, playerEnd: false, playerEndAt: 0, epilogueAt: 0, turnDone: true, toolBusy: false, lastPlayerAt: 0, notes: [], reconnecting: false, connected: false, pendingAudio: [],
        rolls: 0, masterBuf: '', youBuf: '', newTurn: true,
        timer: null, raf: null, wake: null,
        // vida, combate e bolsa (a verdade fica aqui; o Mestre só aplica pelas ferramentas)
        hp: 100, enemy: null, dead: false, deadTimer: null, marks: {}, progressAt: Date.now(), detourTurns: 0, detourNudges: 0, lastRoll: null, critArmed: false, hist: [], invStart: { ...(ctx.loadout || {}) },
        inv: { ...(ctx.loadout || {}) },
        hero: { name: stripEmoji(S.hero?.name || ctx.hero_name) || 'Herói', avatar: S.hero?.avatar || DEFAULT_AVATAR },
    };
}

async function connectLive(isRetry) {
    const adv = S.adv;
    const ai = new adv.sdk.GoogleGenAI({ apiKey: adv.token });
    const config = { responseModalities: [adv.sdk.Modality.AUDIO] };
    if (adv.handle) config.sessionResumption = { handle: adv.handle };
    if (adv.degraded) {                                          // o token não travou estes campos: enviamos aqui
        config.realtimeInputConfig = VAD_CFG;
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
            onclose: (e) => { adv.lastClose = `código ${e?.code ?? '?'} ${e?.reason || ''}`.trim(); adv.connected = false; onLiveClosed(); },
        },
    });

    adv.connected = true;
    if (isRetry) {
        // SEMPRE reenvia o estado: o handle de retomada nem sempre restaura o contexto (sem isto o Mestre recomeça a história).
        // Se o jogador falou durante a queda, o áudio guardado é reenviado primeiro e o Mestre responde a ele.
        const buf = adv.pendingAudio.splice(0);
        const speech = buf.some((c) => c.loud);
        if (speech) buf.forEach((c) => { try { adv.session.sendRealtimeInput({ audio: { data: c.b64, mimeType: 'audio/pcm;rate=16000' } }); } catch (_) { /* ok */ } });
        sendText(recapText(adv, speech));
    } else {
        sendText('[SISTEMA] INICIAR. Siga a abertura: set_scene, boas-vindas chamando o herói pelo nome real e comece o Ato 1 com um NPC em cena. Não pergunte o nome.');
    }
}

// Texto de retomada após reconexão: estado do jogo + últimas falas (o handle nem sempre restaura o contexto)
function recapText(adv, spoke = false) {
    const left = Math.max(0, adv.endMs - serverNow());
    const elapsedMin = Math.floor((adv.totalMs - left) / 60000);
    const bag = Object.entries(adv.inv).map(([id, q]) => `${ITEM_BY_ID[id]?.name || id} x${q}`).join(', ');
    const hist = adv.hist.slice(-14).map((h) => `${h.who}: ${h.text}`);
    if (adv.masterBuf) hist.push(`Mestre: ${adv.masterBuf.slice(-300)}`);
    if (adv.youBuf) hist.push(`Jogador: ${adv.youBuf.slice(-200)}`);
    return `[SISTEMA] RECONECTADO após queda de conexão. Continue a MESMA aventura, sem recomeçar e sem repetir a abertura. `
        + `Herói: ${adv.hero.name}, HP ${adv.hp}%. ` + (adv.enemy ? `EM COMBATE contra ${adv.enemy.name} (HP ${adv.enemy.hp}%${adv.enemy.boss ? ', chefe' : ''}; o combate só termina com a morte dele). ` : 'Sem combate no momento. ')
        + (adv.epilogue ? 'ESTAMOS NO EPÍLOGO: o objetivo da missão JÁ FOI CUMPRIDO' + (adv.bossDown ? ' e o chefe JÁ FOI DERROTADO' : '') + '. É PROIBIDO iniciar combate, chefe, emboscada ou qualquer inimigo; apenas diálogo, banquetes, festas e passeios até o jogador pedir para finalizar. ' + (adv.delivered ? 'O objetivo JÁ foi entregue ao NPC inicial. ' : 'Se o objetivo ainda não foi entregue ao NPC inicial, conduza a entrega e chame objective_delivered. ') + 'NÃO recomece a história. ' : '') + (adv.critArmed ? 'Encantamento de dano crítico ARMADO para o próximo ataque bem-sucedido. ' : '') + `Bolsa restante: ${bag || 'vazia'}. Cenário atual: ${adv.scene}. Tempo decorrido: ${elapsedMin} min de ${Math.round(adv.totalMs / 60000)}. `
        + (hist.length ? `Últimas falas: ${hist.join(' | ')}. ` : '')
        + (spoke ? 'O jogador acabou de falar durante a queda (você vai ouvi-lo agora): responda a ELE e continue a história; NÃO repita a abertura nem as opções antigas.'
            : adv.enemy ? 'Retome com UMA frase curta e pergunte o que o herói faz (sem listar opções, estamos em combate); depois espere o jogador.' : adv.epilogue ? 'Retome com UMA frase curta, voltando à conversa ou celebração de onde parou (sem listar opções); depois espere o jogador.' : 'Retome com UMA frase curta e diga novamente as 3 opções de ação em voz alta; depois espere o jogador.');
}

function sendText(text) {
    const s = S.adv?.session; if (!s) return;
    try { s.sendRealtimeInput({ text }); }
    catch (_) { try { s.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }); } catch (e) { console.warn(e); } }
}

// energia do trecho (PCM16): decide se o jogador falou durante a queda
function chunkLoud(b64) {
    try {
        const bin = atob(b64); let sum = 0, n = 0;
        for (let i = 0; i + 1 < bin.length; i += 8) { let v = bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8); if (v > 32767) v -= 65536; sum += v * v; n++; }
        return n > 0 && Math.sqrt(sum / n) > 700;
    } catch (_) { return false; }
}

function sendAudio(b64) {
    const adv = S.adv; const s = adv?.session; if (!s) return;
    if (adv.connected === false) {                                // conexão fora: guarda ~20 s de áudio para reenviar na volta
        if (adv.gotMsg) { adv.pendingAudio.push({ b64, loud: chunkLoud(b64) }); if (adv.pendingAudio.length > 80) adv.pendingAudio.shift(); }
        return;
    }
    try { s.sendRealtimeInput({ audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } }); }
    catch (_) { /* conexão fechando: ignora */ }
}

function onLiveClosed() {
    const adv = S.adv; if (!adv || adv.finished || adv.closing) return;
    if (!adv.gotMsg) {                                           // recusada logo na abertura (token/config/modelo)
        failStart(ERR[geminiKind(`${adv.lastClose || ''} ${adv.lastErr || ''}`)] || 'O Mestre recusou a conexão', `${adv.lastClose || ''}\n${adv.lastErr || ''}\nmodelo: ${adv.model}${adv.degraded ? ' (config enxuta)' : ''}`.trim());
        return;
    }
    const left = adv.endMs + GIVEUP_AFTER_S * 1000 - serverNow();
    if (adv.reconnects < 6 && left > 0) {
        adv.reconnects++;
        setMasterState('thinking', 'Reconectando…');
        setTimeout(() => { if (S.adv === adv && !adv.finished) connectLive(true).catch(() => onLiveClosed()); }, 900 * adv.reconnects);
    } else if (!adv.finished) {
        console.warn('[diarias] conexão perdida:', adv.lastClose, adv.lastErr);
        const k = geminiKind(`${adv.lastClose || ''} ${adv.lastErr || ''}`);
        toast(k === 'master_busy' ? 'O Mestre ficou ocupado e a conexão caiu.' : k === 'gemini_unavailable' ? 'O Mestre ficou indisponível e a conexão caiu.' : 'Conexão perdida com o Mestre.', true);
        finishAdventure(null, true, 'connection_lost');
    }
}

// Troca de conexão planejada (goAway): só fecha quando o Mestre está calado (ou no limite do aviso do servidor).
function softReconnect(adv, timeLeft) {
    if (adv.reconnecting) return;
    adv.reconnecting = true;
    const secs = parseFloat(String(timeLeft || '')) || 10;
    const deadline = Date.now() + clamp(secs * 1000 - 3000, 1000, 12000);
    const wait = () => {
        if (S.adv !== adv || adv.finished) return;
        const idle = adv.turnDone && !masterSpeaking(adv.A) && !adv.toolBusy && Date.now() - adv.lastPlayerAt > 2500;
        if (idle || Date.now() > deadline) { adv.reconnecting = false; try { adv.session.close(); } catch (_) { /* ok */ } return; }
        setTimeout(wait, 200);
    };
    wait();
}

// Avisos [SISTEMA]: um texto em tempo real faz o Gemini responder na hora (e corta a fala do Mestre).
// Por isso: os suaves vão junto da PRÓXIMA resposta de ferramenta; se não houver, saem quando o Mestre estiver calado
// e o jogador também; os urgentes (ENCERRAR) esperam o Mestre terminar a frase (no máximo 8 s).
function queueNote(adv, text, urgent) { adv.notes.push({ text, urgent: !!urgent, at: Date.now() }); }
function flushNotes(adv) {
    if (!adv.notes.length || adv.finished || !adv.session) return;
    const now = Date.now();
    const idle = adv.turnDone && !masterSpeaking(adv.A) && !adv.toolBusy && now - adv.lastPlayerAt > 1500;
    const urgent = adv.notes.some((n) => n.urgent);
    if (!idle) { if (!(urgent && now - adv.notes.find((n) => n.urgent).at > 8000)) return; }
    else if (!urgent && now - adv.notes[0].at < 40000) return;   // suave: dá 40 s para pegar carona numa ferramenta
    const text = adv.notes.map((n) => n.text).join(' ');
    adv.notes = [];
    sendText(text);
}

// ----- mensagens do Gemini -----
async function onLiveMessage(msg) {
    const adv = S.adv; if (!adv) return;

    if (msg.sessionResumptionUpdate?.newHandle && msg.sessionResumptionUpdate.resumable !== false) adv.handle = msg.sessionResumptionUpdate.newHandle;
    if (msg.goAway) softReconnect(adv, msg.goAway.timeLeft);   // espera o Mestre terminar a frase antes de trocar a conexão

    const sc = msg.serverContent;
    if (sc) {
        if (sc.interrupted) { if (!adv.ending && !adv.forced) flushPlayback(adv.A); adv.newTurn = true; adv.turnDone = true; }
        for (const p of sc.modelTurn?.parts || []) {
            if (p.inlineData?.data && String(p.inlineData.mimeType || '').startsWith('audio')) {
                if (adv.chainSentAt) { const l = Date.now() - adv.chainSentAt; adv.chainSentAt = 0; adv.chainLat = adv.chainLat ? adv.chainLat * 0.5 + l * 0.5 : l; }   // latência do CONTINUE
                adv.turnDone = false; playPcm24(adv.A, p.inlineData.data);
            }
        }
        if (sc.outputTranscription?.text) {
            if (adv.newTurn) {
                if (adv.masterBuf) adv.hist.push({ who: 'Mestre', text: adv.masterBuf.slice(-320) });
                if (adv.youBuf) { adv.hist.push({ who: 'Jogador', text: adv.youBuf.trim().slice(-200) }); adv.detourTurns = (adv.detourTurns || 0) + 1; }
                if (adv.hist.length > 24) adv.hist.splice(0, adv.hist.length - 24);
                adv.masterBuf = ''; adv.youBuf = ''; adv.kwScanned = 0; $('capYou').textContent = ''; adv.newTurn = false;
            }
            adv.masterBuf += sc.outputTranscription.text;
            sceneFromKeywords(adv);                                  // palavra-chave do cenário dita pelo Mestre troca o visual
            $('capMaster').textContent = adv.masterBuf.slice(-420);
            $('capMaster').scrollTop = 99999;
        }
        if (sc.inputTranscription?.text) {
            adv.turnDone = false; adv.lastPlayerAt = Date.now();      // o jogador falou: o Mestre agora deve uma resposta
            adv.youBuf += sc.inputTranscription.text;
            if (adv.long) onPlayerSpeechLong(adv);
            checkCheatCommand(adv);
            $('capYou').textContent = '“' + adv.youBuf.trim().slice(-200) + '”';
        }
        if (sc.turnComplete) {
            adv.newTurn = true; adv.turnDone = true; if (adv.long) scheduleLong(adv);
            if (adv.finishAfterBriga && adv.brigaFechoSent) { adv.finishAfterBriga = false; setTimeout(() => finalizeNow(adv), 2500); }   // fecho da briga dito: agora sim a despedida
        }
    }

    if (msg.toolCall?.functionCalls?.length) await onToolCall(msg.toolCall.functionCalls);
}

const ROLL_HINT = {
    critical_success: 'Sucesso crítico! Narre um triunfo extraordinário com benefício extra. Se foi um ataque, aplique dano maior ao inimigo com damage.',
    success: 'Sucesso. Narre o êxito. Se foi um ataque, aplique dano ao inimigo com damage.',
    failure: 'Falha. Narre a falha e as consequências; em combate o inimigo contra-ataca e você aplica dano ao herói com damage.',
    critical_failure: 'Falha crítica! Narre uma complicação séria (em combate, um golpe duro do inimigo aplicado com damage), mas mantenha saídas.',
};

const hpState = (adv) => ({
    hp_heroi_percent: adv.hp,
    encantamento_critico_armado: !!adv.critArmed,
    combate: adv.enemy ? { inimigo: adv.enemy.name, hp_inimigo_percent: adv.enemy.hp, chefe: adv.enemy.boss } : null,
});

// Fora de combate o Mestre dá 3 opções em voz; em combate, narra rápido e só pergunta o que o herói faz.
const nextStep = (adv) => adv.enemy
    ? 'Estamos em COMBATE: narre curto (2 a 3 frases), deixe o inimigo reagir e apenas pergunte o que o herói faz, SEM listar opções. Depois PARE e espere o jogador.'
    : 'Termine dizendo 3 opções de ação em voz alta e então PARE e espere o jogador responder.';

function toolStartCombat(adv, args) {
    if (adv.cheatX) return { ok: false, erro: 'MODO X ativo: não há combate nem dados. Continue a cena.' };
    if (adv.noCombat) return { ok: false, erro: 'Esta aventura NÃO tem combate: resolva tudo com conversa, charme e dados. Narre uma saída social, sem luta.' };
    if (adv.epilogue) return { ok: false, erro: 'Estamos no EPÍLOGO: a missão já foi cumprida. NÃO há mais combates, chefes nem inimigos. Conduza apenas diálogo e passeios até o jogador escolher concluir ou o sistema enviar ENCERRAR.', ...hpState(adv) };
    if (adv.dead) return { ok: false, erro: 'O herói já caiu. Narre a derrota e chame end_adventure com outcome "derrota".' };
    if (adv.enemy) return { ok: false, erro: `Já há um combate em andamento contra ${adv.enemy.name} (HP ${adv.enemy.hp}%). Ele só termina quando o HP do inimigo chegar a 0.`, ...hpState(adv) };
    const name = String(args.enemy_name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 28) || 'Inimigos';
    adv.enemy = { name, hp: 100, boss: !!args.is_boss };
    renderDuel();
    return { ok: true, ...hpState(adv), instrucao: 'Combate iniciado. Só termina com a morte do inimigo (HP 0%): fugir, negociar ou se esconder não funcionam mais. Descreva o inimigo, deixe-o falar em primeira pessoa e pergunte o que o herói faz, SEM listar opções durante o combate; depois PARE e espere o jogador.' };
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
        // Encantamento de dano crítico: dobra o próximo ataque BEM-SUCEDIDO; se o dado falhou, continua armado
        let encCrit = false;
        if (adv.critArmed && (!lr || lr.result === 'success' || lr.result === 'critical_success')) { f *= 2; crit = true; encCrit = true; adv.critArmed = false; }
        const extraInfo = encCrit ? { encantamento_critico_usado: true } : {};
        let pct = Math.round(base * f);
        if (boss) pct = clamp(pct, 3, finalPhase ? 45 : (encCrit ? 40 : BOSS_MAX_HIT));     // chefe: luta longa (exceto no final)
        else pct = clamp(pct, MIN_HIT_COMMON, 100);                        // criatura comum: nunca vira "mini-chefe"
        adv.enemy.hp = Math.max(0, adv.enemy.hp - pct);
        floatHp('Foe', (crit ? 'CRÍTICO −' : '−') + pct + '%', 'dmg'); setHp('Foe', adv.enemy.hp);
        const intensidade = crit ? 'critico' : f >= 1.2 ? 'forte' : f < 0.95 ? 'fraco' : 'normal';
        if (adv.enemy.hp <= 0) {
            const nome = adv.enemy.name, eraChefe = !!adv.enemy.boss; adv.enemy = null; defeatFoe(adv);
            if (eraChefe) {
                adv.bossDown = true; enterEpilogue(adv);                  // objetivo cumprido: sem mais combates
                return { ok: true, aplicado_percent: pct, intensidade, ...extraInfo, chefe_derrotado: nome, ...hpState(adv),
                    instrucao: `O chefe ${nome} foi derrotado! Narre a morte à altura do golpe (${intensidade}) e conduza o FINAL: retorno ao NPC inicial/ponto de partida (não deixe o herói parado onde lutou) e entrega do objetivo (chame objective_delivered quando entregar). Depois, se houver tempo, conduza momentos de descontração, comemoração e diálogo intenso com NPCs (banquete, taverna, festa, passeio ou uma conversa envolvente com ${adv.heroFem ? 'um homem adulto' : 'uma mulher adulta'}), com apenas UMA dica inicial de escolha e SEM listar 3 opções. NÃO chame end_adventure até o jogador pedir para finalizar (ou o sistema enviar FINALIZAR/ENCERRAR).` };
            }
            return { ok: true, aplicado_percent: pct, intensidade, ...extraInfo, inimigo_derrotado: nome, ...hpState(adv), instrucao: `${nome} foi derrotado(a). Narre a morte à altura do golpe (${intensidade}) e retome a história: diga 3 opções em voz alta e PARE para o jogador responder.` };
        }
        return { ok: true, aplicado_percent: pct, intensidade, ...extraInfo, ...hpState(adv), instrucao: `Golpe ${intensidade}. Narre à altura, deixe o inimigo reagir (pode falar em primeira pessoa) e apenas pergunte o que o herói faz, SEM listar opções (estamos em combate). PARE e espere o jogador.` };
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
    return { ok: true, aplicado_percent: pct, ...hpState(adv), instrucao: (adv.hp <= 25 ? 'O herói está muito ferido; narre isso. ' : 'Narre o dano. ') + nextStep(adv) };
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

function useHint(id, adv) {
    if (id === 'enc_critico') return 'Item gasto. O PRÓXIMO ataque bem-sucedido do herói causará o DOBRO de dano (o jogo aplica sozinho; se o ataque falhar, o encantamento continua válido). Narre o herói canalizando o poder, sem rolar dado agora. ' + nextStep(adv);
    if (id.startsWith('enc_') && id !== 'enc_fogo' && id !== 'enc_gelo') return 'Item gasto. Agora chame roll_check (facil ou normal; dificil contra alvos fortes) para decidir se o efeito funcionou.';
    return 'Item gasto. Narre o uso. ' + nextStep(adv);
}

function toolUseItem(adv, args) {
    if (adv.dead) return { ok: false, erro: 'O herói já caiu.' };
    const id = String(args.item || ''), it = ITEM_BY_ID[id];
    if (!it || !(id in adv.inv)) return { ok: false, erro: 'O herói NÃO levou este item na bolsa. Negue o uso, em personagem. ' + nextStep(adv), };
    if (adv.inv[id] <= 0) return { ok: false, erro: `O herói já usou todas as unidades de "${it.name}" que levou. Negue o uso, em personagem.`, restantes: 0 };
    let extra = {};
    if (id === 'pocao') {
        if (adv.hp >= 100) return { ok: false, erro: 'O HP do herói já está cheio; a poção NÃO foi gasta. Diga isso ao jogador.', restantes: adv.inv[id] };
        const before = adv.hp; adv.hp = Math.min(100, adv.hp + HEAL_POTION);
        setHp('You', adv.hp); floatHp('You', '+' + (adv.hp - before) + '%', 'heal');
        extra = { curou_percent: adv.hp - before };
    }
    if (id === 'enc_critico') {
        if (adv.critArmed) return { ok: false, erro: 'Um encantamento de dano crítico JÁ está armado para o próximo ataque bem-sucedido; o item NÃO foi gasto.', restantes: adv.inv[id] };
        adv.critArmed = true;
    }
    adv.inv[id]--;
    toast(`${it.name}: restam ${adv.inv[id]}`);
    updateBagBadge();
    return { ok: true, item: it.name, restantes: adv.inv[id], ...extra, ...hpState(adv),
        instrucao: useHint(id, adv) };
}

function toolStatus(adv) {
    return { ok: true, ...hpState(adv),
        bolsa: Object.entries(adv.inv).map(([id, q]) => ({ item: ITEM_BY_ID[id]?.name || id, restantes: q })),
        instrucao: 'Diga ao jogador a quantidade EXATA de cada item (inclusive os já consumidos, com zero).' };
}

// ===== CHEAT "MODO X": comando de voz abre modal de senha; a senha é validada só no servidor (mission-token) =====
const CHEAT_X_RE = /ativ[ea]\s+(o\s+)?modo\s+(x|xis|ks)\b/;
const normPt = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
function checkCheatCommand(adv) {
    if (!adv || adv.cheatX || adv.cheatModal || adv.finished) return;
    if (CHEAT_X_RE.test(normPt(adv.youBuf))) openCheatModal(adv);
}
function openCheatModal(adv) {
    adv.cheatModal = true;
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);padding:16px;';
    ov.innerHTML = '<div style="background:#1b1722;color:#f3eefc;border:1px solid #6b4fa3;border-radius:14px;padding:20px;max-width:340px;width:100%;font-family:inherit;box-shadow:0 10px 40px rgba(0,0,0,.6)">'
        + '<h3 style="margin:0 0 12px;font-size:1.05rem">Digite a senha para ativar esse cheat</h3>'
        + '<input id="cheatPass" type="password" inputmode="numeric" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #6b4fa3;background:#120f18;color:#fff;font-size:1rem">'
        + '<div id="cheatErr" style="color:#ff7b7b;font-size:.85rem;min-height:1.2em;margin-top:6px"></div>'
        + '<div style="display:flex;gap:10px;margin-top:10px"><button id="cheatCancel" style="flex:1;padding:10px;border-radius:8px;border:1px solid #6b4fa3;background:transparent;color:#f3eefc;cursor:pointer">Cancelar</button>'
        + '<button id="cheatOk" style="flex:1;padding:10px;border-radius:8px;border:0;background:#8a5cf0;color:#fff;font-weight:700;cursor:pointer">Ativar</button></div></div>';
    document.body.appendChild(ov);
    const inp = ov.querySelector('#cheatPass'), err = ov.querySelector('#cheatErr'), ok = ov.querySelector('#cheatOk');
    const close = () => { ov.remove(); adv.cheatModal = false; adv.youBuf = ''; };
    setTimeout(() => inp.focus(), 50);
    ov.querySelector('#cheatCancel').onclick = close;
    const submit = async () => {
        if (!inp.value) return;
        ok.disabled = true; err.textContent = '';
        try {
            const r = await callFn('mission-token', { slot_id: adv.slotId, action: 'cheat_x', password: inp.value });
            adv.cheatX = true; adv.cheatModal = false; ov.remove(); syncCheatUI();
            queueNote(adv, r.instrucao, true);
            flushNotes(adv);
        } catch (e) {
            err.textContent = ERR[e.message] || 'Não foi possível ativar.'; ok.disabled = false; inp.select();
        }
    };
    ok.onclick = submit;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function onToolCall(calls) {
    const adv = S.adv;
    adv.toolBusy = true;
    const responses = [];
    for (const c of calls) {
        let out = { ok: true };
        try {
            const a = c.args || {};
            if (c.name !== 'get_status') markProgress(adv);   // a história andou: zera o contador de desvio
            if (c.name === 'set_scene') {
                setScene(String(a.scene || ''));
            } else if (c.name === 'roll_check') {
                out = adv.dead ? { ok: false, erro: 'O herói já caiu.' } : adv.cheatX ? { ok: true, resultado: 'success', instrucao: 'MODO X ativo: não há dados. Narre o êxito, respeitando o decoro (sem cenas explícitas).' } : await doRoll(a);
            } else if (c.name === 'start_combat') {
                out = toolStartCombat(adv, a);
            } else if (c.name === 'damage') {
                out = toolDamage(adv, a);
            } else if (c.name === 'use_item') {
                out = toolUseItem(adv, a);
            } else if (c.name === 'objective_complete') {
                enterEpilogue(adv);
                out = { ok: true, instrucao: 'Epílogo iniciado: o objetivo foi cumprido. A partir de agora NÃO há mais combates nem chefes. Conduza o retorno ao NPC inicial e a entrega (chame objective_delivered ao entregar). Depois, conduza celebração e diálogo intenso com NPCs (banquete, taverna, festa, passeio, ' + (adv.heroFem ? 'um homem adulto' : 'uma mulher adulta') + ' envolvente), com apenas UMA dica inicial de escolha e SEM listar 3 opções.' };
            } else if (c.name === 'objective_delivered') {
                if (!adv.epilogue) out = { ok: false, erro: 'O objetivo ainda não foi cumprido. Só chame objective_delivered depois de objective_complete ou da queda do chefe.' };
                else {
                    adv.delivered = true; syncEpilogueUI();
                    out = { ok: true, instrucao: 'Entrega registrada (NÃO mencione nenhum botão). Se restar mais de 2 minutos, conduza celebração, banquete, festa, passeio ou conversa intensa com NPCs, com apenas UMA dica inicial de escolha (sem listar 3 opções). Só encerre quando o jogador pedir para finalizar, o sistema enviar FINALIZAR ou ENCERRAR.' };
                }
            } else if (c.name === 'modo_longo') {
                out = toolModoLongo(adv, a);
            } else if (c.name === 'get_status') {
                out = toolStatus(adv);
            } else if (c.name === 'end_adventure') {
                const left = adv.endMs - serverNow();
                if (!adv.dead && !adv.delivered && !adv.playerEnd && !bossReady(adv) && elapsedS(adv) < END_OK_S && left > EARLY_END_GUARD_S * 1000) {
                    out = { ok: false, erro: 'Ainda é cedo para encerrar. A história precisa de jornada, chefe, entrega e celebração. Só dá para encerrar depois que o objetivo for entregue (objective_delivered) e o jogador pedir para finalizar, quando o sistema enviar [SISTEMA] FINALIZAR ou [SISTEMA] ENCERRAR, ou se o herói cair.' };
                } else {
                    adv.endPayload = { ...a };
                    if (adv.dead) adv.endPayload.outcome = 'derrota';
                    out = { ok: true, aviso: 'Aventura encerrada e registrada. Termine a frase atual se estiver no meio dela; não inicie nada novo nem responda ao jogador.' };
                }
            }
        } catch (e) { out = { ok: false, erro: String(e.message || e) }; }
        responses.push({ id: c.id, name: c.name, response: out });
    }
    const soft = adv.notes.filter((n) => !n.urgent);
    if (soft.length && responses.length) {                        // carona: o Mestre lê o aviso na resposta da ferramenta, sem fala extra
        adv.notes = adv.notes.filter((n) => n.urgent);
        const last = responses[responses.length - 1];
        last.response = { ...last.response, aviso_sistema: soft.map((n) => n.text.replace('[SISTEMA] ', '')).join(' ') };
    }
    adv.toolBusy = false;
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
    return { resultado: r.result, dado: r.roll, precisava: r.dc, instrucao: ROLL_HINT[r.result] + ' ' + nextStep(adv) };
}

// ---------------------------------------------------------------------
// FALAS LONGAS (o Gemini Live responde curto): o JS envia "[SISTEMA] CONTINUE" a cada fim de turno para parecer UMA fala só.
//   sermao: pregação de Pantokrator aceita pelo jogador, mínimo 3 min (modos comuns)
//   briga : discussão de ciúmes no epílogo do Salão do Amor, mínimo 2 min
// Passado o mínimo, o JS manda o fecho. Nos outros momentos NÃO há continuação forçada.
// ---------------------------------------------------------------------
const LONG_MIN_MS = { sermao: 3 * 60 * 1000, briga: 2 * 60 * 1000 }, LONG_MAX_TURNS = 14;

function startLong(adv, kind) { clearTimeout(adv.chainTimer); adv.chainTimer = null; adv.long = { kind, startedAt: Date.now(), turns: 0 }; }
function stopLong(adv) { clearTimeout(adv.chainTimer); adv.chainTimer = null; adv.long = null; }

function toolModoLongo(adv, a) {
    const tipo = String(a.tipo || '');
    if (!adv.epilogue) return { ok: false, erro: 'Fala longa só existe no epílogo (depois de objective_complete).' };
    if (adv.long) return { ok: false, erro: 'Já há uma fala longa em andamento.' };
    if (tipo === 'briga') {
        if (!isSalao(adv.advType)) return { ok: false, erro: 'A discussão de ciúmes só existe no Salão do Amor.' };
        if (adv.brigaDone) return { ok: false, erro: 'A interrupção de ciúmes já aconteceu. Siga o romance.' };
        adv.brigaDone = true; startLong(adv, 'briga');
        return { ok: true, instrucao: 'Discussão LIGADA. Faça agora a ENTRADA do(a) outro(a) convidado(a) ciumento(a), que invade a cena e implica com o par, e comece a discussão engraçada; o par rebate à altura. NÃO conclua nem pergunte nada ao herói: o jogo enviará "[SISTEMA] CONTINUE" (mínimo 2 minutos) e mandará o fecho no final.' };
    }
    if (tipo === 'sermao') {
        if (isSalao(adv.advType)) return { ok: false, erro: 'Neste tipo de aventura não existe pregação. Siga o romance.' };
        startLong(adv, 'sermao');
        return { ok: true, instrucao: 'Pregação LIGADA. Escolha o tema, comece a pregação cristã adaptada a Aden (Pantokrator no papel de Jesus) e NÃO conclua nem pergunte nada: o jogo enviará "[SISTEMA] CONTINUE" várias vezes (mínimo 3 minutos) e mandará o fecho no final.' };
    }
    return { ok: false, erro: 'tipo inválido (use sermao ou briga).' };
}

function onPlayerSpeechLong(adv) {
    if (adv.long?.kind === 'sermao' && adv.youBuf.trim().length >= 8) stopLong(adv);   // o jogador interrompeu a pregação (ruído curto não conta); a briga continua
}

function scheduleLong(adv) {
    if (!adv.long || adv.chainTimer) return;
    adv.chainTimer = setTimeout(() => tryChain(adv, 0), 80);
}

function tryChain(adv, waited) {
    adv.chainTimer = null;
    const L = adv.long; if (!L || S.adv !== adv) return;
    if (adv.finished || adv.ending || adv.forced || adv.playerEnd || adv.dead || adv.endMs - serverNow() < 100000) { stopLong(adv); return; }   // reta final: o Mestre cuida da despedida
    // O áudio chega mais rápido que o tempo real: quando o turno termina no servidor, ainda há segundos de fala na fila.
    // Em vez de esperar a fila esvaziar (e só então pagar os 2 a 3 s de latência do modelo), envia o CONTINUE quando
    // restar apenas ~a latência medida; a resposta nova chega justo quando o áudio atual acaba e a fala fica contínua.
    const leadMs = Math.max(0, (adv.A.nextTime - adv.A.ctx.currentTime) * 1000);
    const lat = Math.min(5000, Math.max(1200, adv.chainLat || 2600));
    if (!adv.turnDone || leadMs > lat + 300 || adv.toolBusy || Date.now() - adv.lastPlayerAt < 1800) {
        if (waited < 60000) adv.chainTimer = setTimeout(() => tryChain(adv, waited + 250), 250);
        return;
    }
    adv.chainSentAt = Date.now();
    L.turns++;
    if (Date.now() - L.startedAt >= LONG_MIN_MS[L.kind] || L.turns > LONG_MAX_TURNS) {
        stopLong(adv);
        if (L.kind === 'briga') {
            adv.brigaFechoSent = true;
            sendText('[SISTEMA] CONTINUE (FECHO DA DISCUSSÃO). Encerre agora a discussão com um desfecho engraçado (o intruso sai bufando, é arrastado, fazem pazes forçadas, etc.) e devolva o clima ao par. '
                + (adv.finishAfterBriga ? 'NÃO pergunte nada: o herói vai finalizar a aventura em seguida.' : 'Em seguida pergunte ao herói o que ele faz e CALE-SE.'));
        } else {
            sendText('[SISTEMA] CONTINUE (FECHO DA PREGAÇÃO). Conclua agora a pregação com uma mensagem final comovente (graça, amor, perdão, fé, esperança), aplicada ao herói. Em seguida PERGUNTE se ele quer continuar ouvindo ou ouvir uma nova pregação, e então CALE-SE e espere a resposta dele.');
        }
        return;
    }
    if (L.kind === 'briga') {
        sendText('[SISTEMA] CONTINUE a discussão. Siga EXATAMENTE de onde parou, sem repetir, sem resumir, SEM concluir e sem perguntar nada ao herói: o(a) intruso(a) e o par continuam brigando de forma extremamente engraçada, falas curtas e rápidas alternando os dois (deixe claro quem fala), ciúmes, ofensas criativas, exageros, comparações absurdas, o par rebatendo à altura, o herói sendo puxado pelos dois; pode escalar para empurrões e tapas cômicos (sem ferir de verdade). 5 a 8 frases.');
    } else {
        sendText('[SISTEMA] CONTINUE a pregação. Siga EXATAMENTE de onde parou, sem repetir, sem resumir, sem perguntar nada e SEM concluir: aprofunde com ensinamentos, parábolas e exemplos de Aden, aplicando a lição à vida do herói, em tom caloroso e solene. 5 a 8 frases.');
    }
}

// ----- cenário por palavra-chave (mission_scenes.keywords, separadas por vírgula ou ponto e vírgula) -----
const _norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function parseSceneKeywords(scenes) {
    const out = [];
    for (const sc of scenes || []) {
        for (const raw of String(sc.keywords || '').split(/[,;\n]/)) {
            const k = _norm(raw).trim().replace(/\s+/g, ' ');
            if (k.length < 3) continue;
            const re = new RegExp('(^|[^a-z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+') + '(?![a-z0-9])', 'g');
            out.push({ id: sc.id, re });
        }
    }
    return out;
}
function sceneFromKeywords(adv) {
    if (!adv.sceneKw?.length || adv.finished) return;
    const txt = _norm(adv.masterBuf);
    let best = null;
    for (const k of adv.sceneKw) {
        k.re.lastIndex = 0;
        let m;
        while ((m = k.re.exec(txt))) {
            const end = m.index + m[0].length;
            if (end > adv.kwScanned && (!best || end > best.end)) best = { id: k.id, end };   // só vale palavra NOVA; vence a mais recente
            if (m.index === k.re.lastIndex) k.re.lastIndex++;
        }
    }
    adv.kwScanned = txt.length;
    if (best && best.id !== adv.scene) setScene(best.id);
}

// ----- cenário e escolhas -----
function setScene(id) {
    const adv = S.adv; if (!adv || !id) return;
    adv.scene = id;
    paintScene(id);                                            // crossfade para o novo skybox
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
    setScene(adv.scene);                                       // começa a trocar do saguão para o cenário da aventura
    $('btnPhones').setAttribute('aria-pressed', String(adv.A.headphones));
    $('btnMic').setAttribute('aria-pressed', 'false'); $('btnMic').classList.add('live');
    setMasterState('idle');
    syncEpilogueUI();

    // microfone → servidor (reduz 48/44,1 kHz para 16 kHz e envia blocos de 80 ms)
    const A = adv.A, ratio = A.ctx.sampleRate / 16000;
    A.node.port.onmessage = (e) => {
        if (A.micMuted || A.endMute || (!A.headphones && masterSpeaking(A))) return;       // sem eco: não ouve enquanto o mestre fala
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

// ----- epílogo: objetivo cumprido → some o "Sair"; entrega feita → aparece o botão "Finalizar aventura" -----
function enterEpilogue(adv) {
    if (adv.epilogue) return;
    adv.epilogue = true; adv.epilogueAt = Date.now();
    syncEpilogueUI();
}

function syncCheatUI() {
    const b = $('btnCheat'); if (!b) return;
    b.setAttribute('aria-pressed', String(!!S.adv?.cheatX));
}

function syncEpilogueUI() {
    const a = S.adv;
    const done = !!a && a.epilogue;
    syncCheatUI();
    const show = !!a && a.delivered && !a.playerEnd && !a.forced && !a.finished && !a.dead;
    $('duel').classList.toggle('finish-on', show);
    $('btnFinish').classList.toggle('show', show);
    $('btnFinish').style.pointerEvents = show ? 'auto' : '';   // o HUD do duelo pode ter pointer-events:none no CSS; o botão precisa receber o toque
    if (!show) closeOv('finishModal');
}

function openFinishConfirm() {
    const a = S.adv; if (!a || a.finished || a.playerEnd) return;
    $('finishEarly').style.display = elapsedS(a) < BOSS_MIN_S ? 'block' : 'none';
    openOv('finishModal');
}

function confirmFinish() {
    closeOv('finishModal');
    const a = S.adv; if (!a || a.finished || a.playerEnd) return;
    // Salão do Amor: mesmo que o jogador queira finalizar, a interrupção de ciúmes acontece antes (se ainda couber no tempo)
    if (isSalao(a.advType) && a.epilogue && !a.brigaDone && !a.finishAfterBriga && a.endMs - serverNow() > 200000) {
        a.finishAfterBriga = true;
        queueNote(a, '[SISTEMA] ANTES DE ENCERRAR: o jogador quer finalizar, mas agora acontece a INTERRUPÇÃO DE CIÚMES. Chame modo_longo com tipo "briga" e faça a entrada engraçada do(a) outro(a) convidado(a) ciumento(a) discutindo com o par, como combinado. Não faça despedida ainda.', true);
        setTimeout(() => { if (S.adv === a && a.finishAfterBriga && !a.brigaDone) { a.finishAfterBriga = false; finalizeNow(a); } }, 30000);   // o Mestre não atendeu: finaliza normalmente
        return;
    }
    finalizeNow(a);
}

function finalizeNow(a) {
    if (!a || a.finished || a.playerEnd) return;
    a.playerEnd = true; a.playerEndAt = Date.now(); a.A.endMute = true;   // ninguém interrompe a despedida
    syncEpilogueUI();
    queueNote(a, '[SISTEMA] FINALIZAR. O jogador escolheu finalizar a aventura. Faça agora a despedida em 30 a 45 segundos (um último momento com o NPC ou o cenário, a frase final da história e um resumo do desempenho do herói) e chame end_adventure. Não inicie nada novo nem faça perguntas.', true);
}

// ----- foco na missão: se a conversa lateral se arrasta, o jogo avisa o Mestre para o NPC interromper -----
// "Progresso" = o Mestre usou uma ferramenta da história (cena, dado, combate, dano, item). Sem progresso por
// DETOUR_AFTER_S e com pelo menos DETOUR_MIN_TURNS falas do jogador, o aviso sai (máx. 3 por trecho, cada vez mais firme).
const DETOUR_STEPS = [
    { s: 120, turns: 3, firm: false },
    { s: 210, turns: 5, firm: true },
    { s: 300, turns: 7, firm: true },
];
function markProgress(adv) { adv.progressAt = Date.now(); adv.detourTurns = 0; adv.detourNudges = 0; }
function checkDetour(adv) {
    if (adv.noCombat || adv.epilogue || adv.enemy || adv.dead || adv.warned || adv.playerEnd || adv.finished) return;   // no Salão do Amor, conversar com os convidados É a missão
    const step = DETOUR_STEPS[adv.detourNudges || 0];
    if (!step) return;
    if ((Date.now() - (adv.progressAt || Date.now())) / 1000 < step.s || (adv.detourTurns || 0) < step.turns) return;
    adv.detourNudges = (adv.detourNudges || 0) + 1;
    queueNote(adv, step.firm
        ? '[SISTEMA] FOCO NA MISSÃO (NÃO responda falando agora; aplique na sua PRÓXIMA fala, depois que o jogador falar). O herói segue numa conversa lateral há vários minutos e a missão principal está parada. AGORA o NPC com quem ele fala OU o NPC da missão interrompe de forma firme, em primeira pessoa, e encerra a conversa (vai embora, é chamado ou um evento da missão força o retorno). Mude a cena com set_scene se preciso e coloque o herói de volta no caminho do objetivo, com consequência se ele insistir em ficar. Se a conversa atual JÁ É a da missão (pista, aliado, informação), ignore este aviso.'
        : '[SISTEMA] FOCO NA MISSÃO (NÃO responda falando agora; aplique na sua PRÓXIMA fala, depois que o jogador falar). Se o herói está numa conversa lateral que não serve à missão principal, ela já passou do limite de cerca de 2 minutos: na sua próxima fala o NPC com quem ele conversa OU o NPC da missão deve interromper de forma natural, dentro do personagem, e devolver o herói à missão (o pedido segue de pé). Se a conversa atual JÁ É a da missão (pista, aliado, informação), ignore este aviso.',
        false);
}

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
        for (const m of (adv.noCombat ? MARKS_SOCIAL : MARKS)) if (!adv.marks[m.at] && elapsedS >= m.at && left > WARN_AT_S * 1000) { adv.marks[m.at] = true; if (!adv.epilogue) queueNote(adv, m.text, false); }
        if (!adv.warned && left <= WARN_AT_S * 1000) {
            adv.warned = true;
            queueNote(adv, '[SISTEMA] RESTAM 2 MINUTOS (NÃO responda falando agora; aplique na sua próxima fala). Leve a história às cenas finais: se o chefe ainda vive, conduza o confronto ao ápice e à derrota dele; se o objetivo já foi cumprido, vá à entrega (se ainda não houve) e feche a celebração com calor (sem novas jornadas). NÃO chame end_adventure ainda: só quando o jogador escolher concluir ou você receber [SISTEMA] ENCERRAR (resta 1 minuto). Não inicie novos combates.', false);
        }
        if (!adv.forced && left <= END_AT_S * 1000) {
            adv.forced = true; adv.A.endMute = true; syncEpilogueUI();                  // a partir do ENCERRAR o Mestre fala sem ser cortado
            queueNote(adv, '[SISTEMA] ENCERRAR. Resta 1 minuto. Se ainda não entregou o objetivo ao NPC, faça isso agora em poucas frases; depois narre a despedida (30 a 45 segundos), resuma o desempenho do jogador e chame end_adventure.', true);
        }
    }
    // rede de segurança: o Mestre esqueceu de chamar objective_delivered → libera o botão depois de 3 min de epílogo
    if (adv.epilogue && !adv.delivered && !adv.dead && adv.epilogueAt && Date.now() - adv.epilogueAt > 180000) { adv.delivered = true; syncEpilogueUI(); }
    // Salão do Amor: a interrupção de ciúmes é obrigatória; se ainda não aconteceu e o tempo está acabando, o Mestre é lembrado
    if (isSalao(adv.advType) && adv.epilogue && !adv.brigaDone && !adv.brigaNudged && !adv.long && !adv.playerEnd && left < 330000 && left > 200000) {
        adv.brigaNudged = true;
        queueNote(adv, '[SISTEMA] HORA DA INTERRUPÇÃO DE CIÚMES: ainda não aconteceu. Chame modo_longo com tipo "briga" e faça agora a entrada engraçada do(a) outro(a) convidado(a) ciumento(a) discutindo com o par.', true);
    }
    // o jogador tocou em Finalizar e o Mestre não encerrou: envia nota neutra
    if (adv.playerEnd && Date.now() - adv.playerEndAt > 75000) { finishAdventure(null, true, 'master_timeout'); return; }
    if (!adv.dead) checkDetour(adv);
    flushNotes(adv);
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
    closeOv('finishModal');
}

const pendKey = (slot) => 'aden_daily_pending_' + slot;
const readPending = (slot) => { try { return JSON.parse(localStorage.getItem(pendKey(slot)) || 'null'); } catch (_) { return null; } };

async function finishAdventure(payload, fallback, reason) {
    const adv = S.adv; if (!adv || adv.finished) return;
    adv.finished = true;
    if (!fallback) {
        adv.ending = true; adv.A.endMute = true;                  // ninguém interrompe o desfecho (nem ruído do microfone)
        await awaitMasterDone(adv);                               // deixa o mestre terminar TODA a fala
    }
    const slotId = adv.slotId, sceneId = adv.scene;
    const bossDown = !!adv.bossDown;
    const clientSeconds = adv.liveMs ? Math.round((Date.now() - adv.liveMs) / 1000) : null;
    teardown(); S.adv = null; closeOv('diceOverlay'); closeOv('bagViewModal');

    const p = payload || { courage: 12, creativity: 12, resolution: 12, roleplay: 12, outcome: adv.dead ? 'derrota' : 'vitoria_parcial', chronicle: '' };
    const pending = { slot_id: slotId, detail: { courage: p.courage, creativity: p.creativity, resolution: p.resolution, roleplay: p.roleplay }, outcome: p.outcome, chronicle: p.chronicle, title: p.title || '', scene: sceneId, client_seconds: clientSeconds, boss: bossDown, reason: reason || (fallback ? 'fallback' : 'master') };
    console.info('[diarias] encerrando aventura. motivo:', pending.reason);
    localStorage.setItem(pendKey(slotId), JSON.stringify(pending));   // garante o envio mesmo se a página fechar
    await submitFinish(pending);
}

async function submitFinish(pending) {
    busy(true, 'O Mestre pesa seus feitos…');
    try {
        const out = await callFn('mission-finish', { slot_id: pending.slot_id, detail: pending.detail, outcome: pending.outcome, chronicle: pending.chronicle, title: pending.title, client_seconds: pending.client_seconds, boss_defeated: !!pending.boss });
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
    if (sceneId) paintScene(sceneId);                          // sem id: mantém o skybox atual
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
    $('itemsGo').onclick = () => { if (S.bag.length === BAG_SIZE) openTypes(); };       // bolsa → tipo de aventura → começar
    $('typeCancel').onclick = () => { closeOv('vipModal'); closeOv('typeModal'); openOv('itemsModal'); };
    $('typeGo').onclick = () => { if (S.advType && S.bag.length === BAG_SIZE) startAdventure(bagCounts(), S.advType); };
    $('privPassCancel').onclick = () => closeOv('privPassModal');
    $('privPassOk').onclick = submitPrivatePass;
    $('privPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPrivatePass(); });
    $('privPromptCancel').onclick = () => closeOv('privPromptModal');
    $('privPromptOk').onclick = confirmPrivatePrompt;
    $('privPrompt').addEventListener('input', updatePrivCount);
    $('vipCancel').onclick = () => { S.vipPending = null; closeOv('vipModal'); };
    $('vipConfirm').onclick = confirmVip;
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
    $('btnCheat').onclick = () => {   // abre direto o modal de senha, pulando a etapa de "Ative o modo X" por voz
        const adv = S.adv; if (!adv || adv.finished) return;
        if (adv.cheatX) { toast('O Modo X já está ativo.'); return; }
        if (adv.cheatModal) return;
        openCheatModal(adv);
    };
    $('btnFinish').onclick = openFinishConfirm;
    $('finishCancel').onclick = () => closeOv('finishModal');
    $('finishConfirm').onclick = confirmFinish;
    document.addEventListener('click', (e) => { if (e.target.classList?.contains('overlay') && e.target.id !== 'busyOverlay' && e.target.id !== 'diceOverlay' && e.target.id !== 'errModal' && e.target.id !== 'itemsModal') closeOv(e.target.id); });
}

// --- AUTH OTIMISTA (ZERO EGRESS) — mesmo padrão da guilda ---
// Descobre o id do jogador localmente (IndexedDB global → cache do player → token do Supabase no
// localStorage) para não chamar auth.getSession() na rede a cada abertura da página.
async function getLocalUserId() {
    try {                                                      // 1. GlobalDB: { key:'current_session', value: <sessão> }
        const rec = await idbGet('auth_store', 'current_session');
        const v = rec?.value;
        const id = v?.user?.id || v?.value?.user?.id || v?.session?.user?.id;
        if (id) return id;
    } catch (_) { /* segue */ }
    try {                                                      // 2. cache do player
        const c = JSON.parse(localStorage.getItem('player_data_cache') || 'null');
        if (c?.data?.id && c.expires > Date.now()) return c.data.id;
    } catch (_) { /* segue */ }
    try {                                                      // 3. token interno do Supabase
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
                const sess = JSON.parse(localStorage.getItem(k));
                const id = sess?.user?.id || sess?.currentSession?.user?.id;
                if (id) return id;
            }
        }
    } catch (_) { /* segue */ }
    return null;
}

async function boot() {
    buildMenu();
    bindUI();
    let uid = await getLocalUserId();
    if (!uid) {                                                // fallback: só então pergunta ao Supabase
        const { data } = await supabase.auth.getSession();
        uid = data?.session?.user?.id || null;
    }
    if (!uid) { location.href = 'index.html'; return; }
    S.uid = uid;
    loadHeroProfile().catch(() => {});                          // IndexedDB: não bloqueia a tela
    await loadSceneLabels();
    await refreshState();
    S.poll = setInterval(() => { if (S.view === 'lobby') refreshState(); }, POLL_MS);
    S.tick = setInterval(tickLobby, 1000);
}
boot();
