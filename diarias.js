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
const WARN_AT_S = 180;                                     // aviso: restam 3 min
const END_AT_S = 60;                                       // ENCERRAR: resta 1 min
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
};
const friendly = (m) => ERR[String(m || '').trim()] || 'Algo deu errado. Tente novamente.';

function showDebug(title, text) {
    $('errTitle').textContent = title || 'Algo deu errado';
    $('errText').textContent = String(text || '(sem detalhes)');
    openOv('errModal');
}

const S = {
    uid: null, offset: 0, state: null, scenes: {}, poll: null, tick: null,
    view: 'lobby', busy: false, adv: null,
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

function renderLobby() {
    const st = S.state; if (!st) return;
    const my = st.my_slot, ev = st.event;
    const bg = $('lobbyBg');
    paintScene(bg, ev?.scene || '');

    if (my && my.status === 'reserved') {
        renderCard(`
            <span class="chip ok">Vaga garantida</span>
            <h2>Sua aventura começa em</h2>
            <div class="big-timer" data-role="t-start">--:--</div>
            <p class="hint" data-role="t-hint"></p>
            <button class="btn-epic" id="btnStart" disabled>Entrar na aventura</button>`);
        $('btnStart').onclick = () => openOv('briefModal');
    } else if (my && my.status === 'completed') {
        renderCard(`
            <div class="qc-icon">✦</div>
            <span class="chip ok">Aventura concluída</span>
            <h2>Volte amanhã, herói</h2>
            <p>Sua nota foi <b style="color:#fff3cf">${my.score_total ?? 0}</b> e você recebeu
               <b style="color:#fff3cf">${nf(my.reward_xp)} XP</b> e <b style="color:#fff3cf">${nf(my.reward_crystals)} cristais</b>.</p>
            ${my.chronicle ? `<div class="chronicle"><h4>Crônica do dia</h4>${esc(my.chronicle)}</div>` : ''}
            <p class="hint">O Mestre aparece de novo amanhã.</p>`);
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
            <p>${my.status === 'no_show' ? 'A vaga passou para outro herói.' : 'Sem conclusão, não há recompensa.'} Uma nova chance surge amanhã.</p>`);
    } else if (ev && ev.open_slots > 0) {
        const gems = [0, 1, 2].map((i) => `<div class="slot-gem ${i < ev.open_slots ? 'free' : ''}"></div>`).join('');
        renderCard(`
            <span class="chip live">● O Mestre apareceu</span>
            <h2>${esc(ev.title)}</h2>
            <p class="qc-place">✧ ${esc(sceneLabel(ev.scene))} ✧</p>
            <div class="slots">${gems}</div>
            <p><b style="color:#fff3cf">${ev.open_slots}</b> ${ev.open_slots === 1 ? 'vaga restante' : 'vagas restantes'} · encerra em <span data-role="t-close">--:--</span></p>
            <button class="btn-epic" id="btnJoin">Aceitar o chamado</button>`);
        $('btnJoin').onclick = joinEvent;
    } else if (ev) {
        renderCard(`
            <span class="chip bad">Vagas esgotadas</span>
            <h2>${esc(ev.title)}</h2>
            <p>Os três heróis já foram escolhidos. Fique atento: o Mestre voltará a aparecer.</p>`);
    } else {
        renderCard(`
            <div class="qc-icon">☾</div>
            <h2>O Mestre está longe…</h2>
            <p>As lendas dizem que ele surge em locais aleatórios ao longo do dia e chama apenas três heróis por vez.</p>
            <p class="hint">Ative as notificações para ser avisado.</p>
            <button class="btn-epic" disabled>Aguardando o Mestre</button>`);
    }
    tickLobby();
}

function tickLobby() {
    const st = S.state; if (!st || S.view !== 'lobby' || S.adv) return;
    const now = serverNow();
    const my = st.my_slot, ev = st.event;
    const q = (r) => $('questCard').querySelector(`[data-role="${r}"]`);

    if (my && my.status === 'reserved') {
        const start = new Date(my.scheduled_start).getTime(), dead = new Date(my.start_deadline).getTime();
        const tStart = q('t-start'), hint = q('t-hint'), btn = $('btnStart');
        if (now < start - 20000) {
            tStart.textContent = mmss(start - now);
            hint.textContent = 'Fique nesta tela. Quando o relógio zerar, o botão será liberado.';
            if (btn) btn.disabled = true;
        } else if (now <= dead) {
            tStart.textContent = '00:00';
            hint.textContent = `Entre agora! Tolerância: ${mmss(dead - now)}`;
            if (btn) btn.disabled = false;
        } else {
            refreshState();
        }
    } else if (ev && q('t-close')) {
        q('t-close').textContent = mmss(new Date(ev.closes_at).getTime() - now);
    }
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

async function startAdventure() {
    const my = S.state?.my_slot; if (!my || my.status !== 'reserved') return;
    closeOv('briefModal');
    busy(true, 'Preparando o microfone…');

    let A = null, ctx = null;
    try {
        A = await initAudio();                                   // 1º: microfone (se negar, a vaga não é gasta)
        A.headphones = $('chkPhones').checked;
        busy(true, 'Invocando o Mestre…');
        ctx = await callFn('mission-token', { slot_id: my.id });
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
            onmessage: (m) => { adv.gotMsg = true; onLiveMessage(m).catch((e) => console.error('[diarias] msg:', e)); },
            onerror: (e) => { adv.lastErr = String(e?.message || e?.error?.message || 'erro de conexão'); console.warn('[diarias] ws erro:', adv.lastErr); },
            onclose: (e) => { adv.lastClose = `código ${e?.code ?? '?'} ${e?.reason || ''}`.trim(); onLiveClosed(); },
        },
    });

    if (!isRetry) {
        sendText('[SISTEMA] INICIAR. Siga a abertura: set_scene, boas-vindas e pergunte o nome do jogador.');
    }
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
    if (adv.reconnects < 3 && left > 0) {
        adv.reconnects++;
        setMasterState('thinking', 'Reconectando…');
        setTimeout(() => { if (S.adv === adv && !adv.finished) connectLive(true).catch(() => onLiveClosed()); }, 900 * adv.reconnects);
    } else if (!adv.finished) {
        toast('Conexão perdida com o Mestre.', true);
        finishAdventure(null, true);
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
            if (adv.newTurn) { adv.masterBuf = ''; adv.youBuf = ''; $('capYou').textContent = ''; adv.newTurn = false; }
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
    critical_success: 'Sucesso crítico! Narre um triunfo extraordinário, com um benefício extra.',
    success: 'Sucesso. Narre o êxito e faça a história avançar.',
    failure: 'Falha. Narre a falha e as consequências, e ofereça 2 ou 3 alternativas ao jogador. Não trave a história.',
    critical_failure: 'Falha crítica! Narre uma complicação séria, mas mantenha saídas e alternativas para o jogador.',
};

async function onToolCall(calls) {
    const adv = S.adv;
    const responses = [];
    for (const c of calls) {
        let out = { ok: true };
        try {
            if (c.name === 'set_scene') {
                setScene(String(c.args?.scene || ''));
            } else if (c.name === 'offer_choices') {
                showChoices(Array.isArray(c.args?.choices) ? c.args.choices : []);
            } else if (c.name === 'roll_check') {
                out = await doRoll(c.args || {});
            } else if (c.name === 'end_adventure') {
                adv.endPayload = c.args || {};
                out = { ok: true };
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
    $('d20Num').textContent = r.roll;
    d.className = 'd20 settle' + (r.result === 'critical_success' ? ' crit-s' : r.result === 'critical_failure' ? ' crit-f' : '');
    const good = r.result === 'success' || r.result === 'critical_success';
    const label = { critical_success: 'Sucesso crítico!', success: 'Sucesso', failure: 'Falha', critical_failure: 'Falha crítica!' }[r.result];
    $('diceResult').textContent = label; $('diceResult').className = 'dice-result ' + (good ? 's' : 'f');
    $('diceMath').textContent = `d20 ${r.roll} ${r.modifier >= 0 ? '+' : '−'} ${Math.abs(r.modifier)} = ${r.total}  ·  CD ${r.dc}`;
    await sleep(1900);
    closeOv('diceOverlay');
    setMasterState('listening');
    return { resultado: r.result, dado: r.roll, modificador: r.modifier, total: r.total, instrucao: ROLL_HINT[r.result] };
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

function showChoices(list) {
    const box = $('choices'); box.innerHTML = '';
    list.slice(0, 3).forEach((txt, i) => {
        const b = document.createElement('button');
        b.className = 'choice-btn'; b.style.animationDelay = i * 0.08 + 's';
        b.textContent = String(txt).slice(0, 80);
        b.onclick = () => { box.innerHTML = ''; sendText(`O jogador escolheu: ${txt}`); };
        box.appendChild(b);
    });
    // some quando o mestre voltar a falar após a escolha
    setTimeout(() => { if (box.children.length) box.innerHTML = ''; }, 45000);
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
    $('capMaster').textContent = ''; $('capYou').textContent = ''; $('choices').innerHTML = '';
    $('hudRolls').textContent = '0';
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

    if (!adv.warned && left <= WARN_AT_S * 1000) {
        adv.warned = true;
        sendText('[SISTEMA] Restam 3 minutos. Conduza a história para o clímax e o desfecho.');
    }
    if (!adv.forced && left <= END_AT_S * 1000) {
        adv.forced = true;
        sendText('[SISTEMA] ENCERRAR. Narre o desfecho agora (30 a 60 segundos), resuma o desempenho do jogador e chame end_adventure.');
    }
    if (left <= -GIVEUP_AFTER_S * 1000) finishAdventure(null, true);   // o mestre não encerrou: envia nota neutra
}

// ----- encerramento -----
function teardown() {
    const adv = S.adv; if (!adv) return;
    adv.closing = true;
    clearInterval(adv.timer); cancelAnimationFrame(adv.raf);
    try { adv.session?.close(); } catch (_) { /* ok */ }
    try { adv.A.node.port.onmessage = null; adv.A.stream.getTracks().forEach((t) => t.stop()); adv.A.ctx.close(); } catch (_) { /* ok */ }
    try { adv.wake?.release(); } catch (_) { /* ok */ }
    window.removeEventListener('beforeunload', guardUnload);
}

const pendKey = (slot) => 'aden_daily_pending_' + slot;
const readPending = (slot) => { try { return JSON.parse(localStorage.getItem(pendKey(slot)) || 'null'); } catch (_) { return null; } };

async function finishAdventure(payload, fallback) {
    const adv = S.adv; if (!adv || adv.finished) return;
    adv.finished = true;
    if (!fallback) await drainPlayback(adv.A);                    // deixa o mestre terminar a última frase
    const slotId = adv.slotId, sceneId = adv.scene;
    teardown(); S.adv = null; closeOv('diceOverlay');

    const p = payload || { courage: 12, creativity: 12, resolution: 12, roleplay: 12, outcome: 'vitoria_parcial', chronicle: '' };
    const pending = { slot_id: slotId, detail: { courage: p.courage, creativity: p.creativity, resolution: p.resolution, roleplay: p.roleplay }, outcome: p.outcome, chronicle: p.chronicle, scene: sceneId };
    localStorage.setItem(pendKey(slotId), JSON.stringify(pending));   // garante o envio mesmo se a página fechar
    await submitFinish(pending);
}

async function submitFinish(pending) {
    busy(true, 'O Mestre pesa seus feitos…');
    try {
        const out = await callFn('mission-finish', { slot_id: pending.slot_id, detail: pending.detail, outcome: pending.outcome, chronicle: pending.chronicle });
        localStorage.removeItem(pendKey(pending.slot_id));
        busy(false);
        showResult(out.result, pending.scene);
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
function showResult(r, sceneId) {
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
        <p class="res-note">Você jogou ${r.minutes_played ?? '—'} min · ${r.reward_pct ?? 0}% da recompensa máxima${r.concluded ? ' · história concluída' : ''}</p>
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
    $('briefGo').onclick = startAdventure;
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
        teardown(); S.adv = null; closeOv('diceOverlay');
        toast('Você abandonou a aventura.', true);
        showView('lobby');
        await refreshState();
    };
    document.addEventListener('click', (e) => { if (e.target.classList?.contains('overlay') && e.target.id !== 'busyOverlay' && e.target.id !== 'diceOverlay' && e.target.id !== 'errModal') closeOv(e.target.id); });
}

async function boot() {
    buildMenu();
    bindUI();
    const { data } = await supabase.auth.getSession();
    if (!data?.session) { location.href = 'index.html'; return; }
    S.uid = data.session.user.id;
    await loadSceneLabels();
    await refreshState();
    S.poll = setInterval(() => { if (S.view === 'lobby') refreshState(); }, POLL_MS);
    S.tick = setInterval(tickLobby, 1000);
}
boot();
