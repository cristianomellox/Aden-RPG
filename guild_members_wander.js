import * as TWEEN from '@tweenjs/tween.js';
import { supabase as _supabaseFallback } from './supabaseClient.js';

// ═══════════════════════════════════════════════════════════════════════
// MEMBROS DA GUILDA PASSEANDO PELO SKYBOX ────────────────────────────────
// Reaproveita a lista de membros já renderizada em #guildMemberList (com
// avatar_url e data-player-id) — não faz nenhuma chamada nova pra montar
// os avatares em si, só observa essa lista e "empresta" cada membro pra
// um avatar flutuante, projetado na esfera do skybox (ver registerOrbiter
// em guild_skybox.js).
//
// Cada avatar:
//   • usa a MESMA moldura (frame) do jogador, buscada via get_player_skin_urls
//     — mesmo cache de 24h (skin_modal_v1_${pid}) usado nas Áreas de Caça,
//     então uma moldura já cacheada em outra página aparece na hora aqui;
//   • tem classe .player-link + data-player-id, então um clique nele abre
//     o modal de perfil exatamente como um clique na lista de membros
//     (delegação global já existe em playerModal.js/guild.html — nada
//     precisa ser religado aqui);
//   • "passeia" sozinho por um pequeno arco de yaw/pitch, pausa, passeia de
//     novo — nunca sincronizado entre membros (delay inicial + duração
//     sorteados por avatar), no mesmo espírito do startWander do Vale
//     Arcano.
// ═══════════════════════════════════════════════════════════════════════

// ── Calibração da faixa onde os membros "pisam" no chão do salão ────────
// Ajuste conforme o horizonte real de guildhall.png (use ?debugGuildSky=1
// pra clicar na imagem e ver o yaw/pitch de qualquer ponto no console).
const MEMBER_PITCH_MIN   = -20;
const MEMBER_PITCH_MAX   = -6;
const MEMBER_RADIUS      = 380;
const MEMBER_ARC_DEG     = 80;    // até onde um passeio pode se afastar do ponto atual (yaw)

const WANDER_DEG_PER_SEC   = 3.2;   // velocidade angular do passeio (quanto menor, mais lento)
const WANDER_PAUSE_MS_MIN  = 6000;
const WANDER_PAUSE_MS_MAX  = 13000;
const WANDER_FIRST_DELAY_MAX = 4000;

const MAX_WANDERING_MEMBERS = 16; // limite pra não poluir demais a tela num salão cheio

const AVATAR_PX = 54;
const FRAME_PX  = 104;

function randBetween(min, max) { return min + Math.random() * (max - min); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ── Cliente Supabase — reaproveita o já autenticado exposto pelo próprio
// guild.html (window.__guildAuthSB); cai pro import direto se, por algum
// motivo de timing, ele ainda não tiver sido publicado. ──────────────────
function getSB() {
    return window.__guildAuthSB || _supabaseFallback;
}

// ── Cache de moldura (mesmo formato usado nas Áreas de Caça — skin_modal_v1_${pid}) ──
function _getFrameCache(pid) {
    try {
        const raw = localStorage.getItem(`skin_modal_v1_${pid}`);
        if (!raw) return undefined;
        const obj = JSON.parse(raw);
        if (!obj.e || Date.now() >= obj.e) { localStorage.removeItem(`skin_modal_v1_${pid}`); return undefined; }
        return obj.v;
    } catch (e) { return undefined; }
}
function _setFrameCache(pid, data) {
    try { localStorage.setItem(`skin_modal_v1_${pid}`, JSON.stringify({ v: data, e: Date.now() + 86400000 })); } catch (e) {}
}
async function fetchFrameUrl(pid) {
    const cached = _getFrameCache(pid);
    if (cached !== undefined) return cached?.frame_url || null;
    const sb = getSB();
    if (!sb) return null;
    try {
        const { data, error } = await sb.rpc('get_player_skin_urls', { p_player_id: pid });
        if (error) return null;
        _setFrameCache(pid, data || null);
        return data?.frame_url || null;
    } catch (e) { return null; }
}

// ── CSS (injetado uma vez) ───────────────────────────────────────────────
function injectCSS() {
    if (document.getElementById('gw-css')) return;
    const s = document.createElement('style');
    s.id = 'gw-css';
    s.textContent = `
        .gw-avatar { position: fixed; text-align: center; user-select: none; -webkit-user-select: none; cursor: pointer; pointer-events: auto !important; z-index: 1; }
        .gw-frame-wrap { position: relative; width: ${AVATAR_PX}px; height: ${AVATAR_PX}px; margin: 0 auto; }
        .gw-avatar-img {
            width: ${AVATAR_PX}px; height: ${AVATAR_PX}px; border-radius: 50%; object-fit: cover;
            border: 2px solid #6b5a2a; box-shadow: 0 2px 8px rgba(0,0,0,.7); display: block;
        }
        .gw-frame-ol, .gw-frame-sh {
            position: absolute; left: 50%; top: 50%; width: ${FRAME_PX}px; height: ${FRAME_PX}px;
            transform: translate(-50%, -50%); pointer-events: none;
            background-size: contain; background-repeat: no-repeat; background-position: center; display: none;
        }
        .gw-frame-sh {
            -webkit-mask-size: contain; mask-size: contain;
            -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
            -webkit-mask-position: center; mask-position: center; overflow: hidden;
        }
        .gw-frame-sh::after {
            content: ''; position: absolute; top: -20%; left: -130%; width: 55%; height: 140%;
            background: linear-gradient(108deg, transparent 0%, rgba(255,255,255,.04) 28%, rgba(255,255,255,.18) 42%, rgba(255,255,255,.52) 50%, rgba(255,255,255,.18) 58%, rgba(255,255,255,.04) 72%, transparent 100%);
            animation: gwSheen 6s ease-in-out infinite;
        }
        @keyframes gwSheen { 0%{left:-130%;opacity:0} 2%{opacity:1} 98%{left:155%;opacity:1} 99%{opacity:0;left:155%} 100%{left:155%;opacity:0} }
        .gw-name {
            margin-top: 4px; font-family: 'Cinzel', serif; font-size: 11px; font-weight: bold;
            color: #ffe9a8; text-shadow: 0 0 4px #000, 0 0 8px #000, 1px 1px 2px #000;
            white-space: nowrap; max-width: 130px; overflow: hidden; text-overflow: ellipsis;
        }
    `;
    document.head.appendChild(s);
}

function applyFrame(fr, sh, url) {
    if (url) {
        fr.style.backgroundImage = `url('${url}')`;
        fr.style.display = 'block';
        sh.style.webkitMaskImage = `url('${url}')`;
        sh.style.maskImage = `url('${url}')`;
        sh.style.display = 'block';
    } else {
        fr.style.display = 'none';
        sh.style.display = 'none';
    }
}

// Abre o modal de perfil do jogador. Mesma lógica de openPlayerModalById()
// do guild.js (usada pela lista de ranking, presenteadores etc.) — só que
// chamada diretamente aqui, sem depender de bubbling do evento de clique
// chegar até o listener global de .player-link (não temos acesso ao
// playerModal.js pra confirmar se ele exige algo além disso).
function openPlayerModal(pid) {
    if (!pid) return;
    const modal = document.getElementById('playerModal');
    if (modal) modal.style.display = 'flex';
    window._guildModalLastPid = pid;
    if (typeof window.fetchPlayerData === 'function') {
        window.fetchPlayerData(pid);
    } else {
        console.warn('[GuildMembersWander] window.fetchPlayerData não encontrado — o modal abriu mas pode não preencher os dados do jogador.');
    }
}

function buildAvatarEl(member) {
    const wrap = document.createElement('div');
    wrap.className = 'gw-avatar player-link';
    wrap.dataset.playerId = member.id;
    wrap.addEventListener('click', () => openPlayerModal(member.id));

    const frameWrap = document.createElement('div');
    frameWrap.className = 'gw-frame-wrap';

    const img = document.createElement('img');
    img.className = 'gw-avatar-img';
    img.src = member.avatar || 'https://aden-rpg.pages.dev/assets/guildaflag.webp';
    img.onerror = () => { img.src = 'https://aden-rpg.pages.dev/assets/guildaflag.webp'; };

    const fr = document.createElement('div');
    fr.className = 'gw-frame-ol';
    const sh = document.createElement('div');
    sh.className = 'gw-frame-sh';

    frameWrap.appendChild(img);
    frameWrap.appendChild(fr);
    frameWrap.appendChild(sh);
    wrap.appendChild(frameWrap);

    const nm = document.createElement('div');
    nm.className = 'gw-name';
    nm.textContent = member.name;
    wrap.appendChild(nm);

    fetchFrameUrl(member.id).then((url) => applyFrame(fr, sh, url));

    return wrap;
}

// ── Passeio (yaw/pitch derivando sozinho, com pausas) ────────────────────
function scheduleWander(state, delayMs) {
    setTimeout(moveStep, delayMs);
    function moveStep() {
        const targetYaw = state.yaw + randBetween(-MEMBER_ARC_DEG, MEMBER_ARC_DEG);
        const targetPitch = randBetween(MEMBER_PITCH_MIN, MEMBER_PITCH_MAX);
        const distDeg = Math.abs(targetYaw - state.yaw) + Math.abs(targetPitch - state.pitch);
        const durMs = Math.max(2200, (distDeg / WANDER_DEG_PER_SEC) * 1000);
        new TWEEN.Tween(state)
            .to({ yaw: targetYaw, pitch: targetPitch }, durMs)
            .easing(TWEEN.Easing.Quadratic.InOut)
            .onComplete(() => scheduleWander(state, randBetween(WANDER_PAUSE_MS_MIN, WANDER_PAUSE_MS_MAX)))
            .start();
    }
}

// ── Lê a lista de membros já renderizada em #guildMemberList ─────────────
function scrapeMembers() {
    const items = document.querySelectorAll('#guildMemberList li');
    const out = [];
    items.forEach((li) => {
        const link = li.querySelector('.player-link[data-player-id]');
        const img = li.querySelector('img');
        if (!link) return;
        const id = link.dataset.playerId;
        if (!id) return;
        const name = (link.textContent || '?').trim().replace(/\s+/g, ' ') || '?';
        const avatar = img ? img.getAttribute('src') : null;
        out.push({ id, name, avatar });
    });
    return out;
}

// ── Ciclo: derruba os avatares antigos e cria os novos ───────────────────
let _active = []; // [{ orbiterHandle, el }]

function teardown() {
    for (const a of _active) {
        try { window.GuildSkybox.unregisterOrbiter(a.orbiterHandle); } catch (e) {}
    }
    _active = [];
}

function rebuild() {
    teardown();
    let members = scrapeMembers();
    if (!members.length) return;

    // Amostra aleatória quando há muitos membros, pra não lotar a tela.
    if (members.length > MAX_WANDERING_MEMBERS) {
        members = members.slice().sort(() => Math.random() - 0.5).slice(0, MAX_WANDERING_MEMBERS);
    }

    injectCSS();

    members.forEach((member, i) => {
        const el = buildAvatarEl(member);
        const state = {
            yaw: randBetween(0, 360),
            pitch: randBetween(MEMBER_PITCH_MIN, MEMBER_PITCH_MAX),
        };
        const handle = window.GuildSkybox.registerOrbiter(el, state, MEMBER_RADIUS);
        _active.push({ orbiterHandle: handle, el });
        scheduleWander(state, i * 700 + Math.random() * WANDER_FIRST_DELAY_MAX);
    });

    console.log(`[GuildMembersWander] ${_active.length} membro(s) passeando pelo skybox.`);
}

// ── Observa mudanças na lista de membros (guild.js a repopula async) ─────
function watchMemberList() {
    const list = document.getElementById('guildMemberList');
    if (!list) { setTimeout(watchMemberList, 300); return; }

    let debounceTimer = null;
    const debouncedRebuild = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(rebuild, 250);
    };

    const mo = new MutationObserver(debouncedRebuild);
    mo.observe(list, { childList: true });

    debouncedRebuild(); // caso a lista já tenha sido preenchida antes de chegarmos aqui
}

function init() {
    window.GuildSkybox.onReady(() => {
        watchMemberList();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
