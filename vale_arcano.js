import { supabase } from './supabaseClient.js';

// ═══════════════════════════════════════════════════════════
// CONFIGURAÇÃO DA REGIÃO — altere aqui para cada nova página
// ═══════════════════════════════════════════════════════════
const REGION_ID = 'vale_arcano';
const REGION_NAME = 'Vale Arcano';

// Catálogo de TODAS as regiões (para o modal de recompensas)
// Adicione aqui as outras regiões conforme criar as páginas
const ALL_REGIONS = {floresta_mistica: { name:'Floresta Mística' },
    vale_arcano: { name:'Vale Arcano' },
    penumbra_uivante: { name:'Penumbra Uivante' },
    
};

// Catálogo de TODOS os itens de drop de todas as regiões (para exibir no modal)
const ALL_DROPS = {
    84: { name:'Chifre de Unicórnio', img:'https://aden-rpg.pages.dev/assets/itens/chifre_de_unicornio.webp' },
    71: { name:'Lágrima de Fênix',    img:'https://aden-rpg.pages.dev/assets/itens/lagrima_de_fenix.webp'    },
    74: { name:'Galho Espiritual',    img:'https://aden-rpg.pages.dev/assets/itens/galho_espiritual.webp'    },
    67: { name:'Pele Animal',               img:'https://aden-rpg.pages.dev/assets/itens/pele_animal.webp'               },
    58: { name:'Verniz',               img:'https://aden-rpg.pages.dev/assets/itens/verniz.webp'               },
    63: { name:'Lubrificante',               img:'https://aden-rpg.pages.dev/assets/itens/lubrificante.webp'               },
    72: { name:'Pedaço de Freixo',               img:'https://aden-rpg.pages.dev/assets/itens/pedaco_de_freixo.webp'               },
    69: { name:'Lã',               img:'https://aden-rpg.pages.dev/assets/itens/la.webp'               },
    76: { name:'Pó Ósseo',               img:'https://aden-rpg.pages.dev/assets/itens/po_osseo.webp'               },
    70: { name:'Sal de Cobalto',               img:'https://aden-rpg.pages.dev/assets/itens/sal_de_cobalto.webp'               },
    86: { name:'Asa de Morcego',               img:'https://aden-rpg.pages.dev/assets/itens/asa_de_morcego.webp'               },
    87: { name:'Emblema Vampírico',               img:'https://aden-rpg.pages.dev/assets/itens/emblema_vampirico.webp'               },
    // adicione outros drops aqui
};

const SPOTS = [
    { id:'quar', name:'Quar',  top:260, left:190,  width:500, height:380,
      itemId:84, mobImg:'https://aden-rpg.pages.dev/assets/quar.webp', labelColor:'silver' },
    { id:'limut',    name:'Limut',       top:430, left:960, width:490, height:400,
      itemId:71, mobImg:'https://aden-rpg.pages.dev/assets/limut.webp',     labelColor:'lightgreen' },
    { id:'duende',   name:'Duende',      top:1050, left:30, width:480, height:390,
      itemId:74, mobImg:'https://aden-rpg.pages.dev/assets/duende.webp',    labelColor:'orange' },
    { id:'pixie', name:'Pixie',   top:1070, left:1080, width:380, height:370,
      itemId:51, mobImg:'https://aden-rpg.pages.dev/assets/pixie.webp', labelColor:'gray' },
];

const SHIELD_ITEM_ID = 85;
const SHIELD_IMG     = 'https://aden-rpg.pages.dev/assets/itens/escudo_de_caca.webp';
const DEFAULT_AVATAR = 'https://aden-rpg.pages.dev/assets/default_avatar.png';
const DAILY_LIMIT    = 10800; // 3h globais — mesmo valor do SQL
const SPOT_LOCK_MS   = 15 * 60 * 1000; // 15 minutos de lock por spot

// ── ADAPTIVE POLLING ───────────────────────────────────────────
const POLL_BASE = {
    hunting_with_others : 60_000,
    hunting_alone       : 90_000,
    paused_with_others  : 120_000,
    paused_alone        : 300_000,
    pvp_only            : 60_000,
};
const POLL_STEP     = 30_000;
const POLL_MAX_3MIN = 180_000;
const POLL_MAX_5MIN = 300_000;

// ── HUNT STATE BOOT CACHE (120s) ───────────────────────────────
const HUNT_CACHE_KEY  = () => `hunt_state_${userId}`;
const HUNT_CACHE_TTL  = 120_000;

// ── STATS CACHE (mesma chave do mines.js e afk_page.js) ───────
const STATS_CACHE_KEY       = () => `player_combat_stats_${userId}`;
const STATS_CACHE_DURATION  = 72 * 60 * 60 * 1000; // 72h

// ── GLOBAL IDB (mesmo banco do mines.js — owners_store) ───────
const _GDBNAME    = 'aden_global_db';
const _GDBVER     = 6;
const _OWN_STORE  = 'owners_store';
const _OWNERS_TTL = 24 * 60 * 60 * 1000; // 24h

let _gdb = null;
async function _openGlobalDb(){
    if(_gdb) return _gdb;
    return new Promise((res,rej)=>{
        const req=indexedDB.open(_GDBNAME,_GDBVER);
        req.onerror=()=>rej(req.error);
        req.onsuccess=e=>{_gdb=e.target.result;res(_gdb);};
        req.onupgradeneeded=e=>{
            const db=e.target.result;
            if(!db.objectStoreNames.contains(_OWN_STORE))
                db.createObjectStore(_OWN_STORE,{keyPath:'id'});
        };
    });
}
async function _idbGetAllOwners(){
    try{
        const db=await _openGlobalDb();
        return new Promise(res=>{
            const tx=db.transaction(_OWN_STORE,'readonly');
            const req=tx.objectStore(_OWN_STORE).getAll();
            req.onsuccess=()=>{
                const now=Date.now(),map={};
                (req.result||[]).forEach(o=>{
                    if(o.id&&o.timestamp&&(now-o.timestamp)<_OWNERS_TTL)map[o.id]=o;
                });
                res(map);
            };
            req.onerror=()=>res({});
        });
    }catch{return{};}
}
async function _idbSaveOwners(list){
    if(!list||!list.length)return;
    try{
        const db=await _openGlobalDb();
        // Faz merge: lê o registro existente antes de sobrescrever
        // para nunca destruir guild_id que a mina já gravou.
        const now=Date.now();
        for(const o of list){
            const id=o.id||o.i;
            if(!id)continue;
            await new Promise(res=>{
                const txR=db.transaction(_OWN_STORE,'readonly');
                const req=txR.objectStore(_OWN_STORE).get(id);
                req.onsuccess=()=>{
                    const existing=req.result||{};
                    const merged={
                        id,
                        name       : o.name||o.n||existing.name||'',
                        avatar_url : o.avatar_url||o.a||existing.avatar_url||'',
                        // Preserva guild_id existente se o novo não trouxer
                        guild_id   : o.guild_id||o.g||existing.guild_id||null,
                        timestamp  : now,
                    };
                    const txW=db.transaction(_OWN_STORE,'readwrite');
                    txW.objectStore(_OWN_STORE).put(merged);
                    txW.oncomplete=()=>res();
                    txW.onerror=()=>res();
                };
                req.onerror=()=>res();
            });
        }
    }catch(e){console.warn('[floresta] idb save',e);}
}
const ACTIVITY_KEY   = 'aden_activity_state';
// Chave dedicada ao lock de 15 min do spot — independente do ACTIVITY_KEY para
// sobreviver a navegações que sobrescrevem ACTIVITY_KEY (mercador, cidade, mina, etc.)
const SPOT_LOCK_KEY  = () => `hunt_spot_lock_${userId}`;

// ── ACTIVITY STATE (cache local compartilhado com mines.js) ─
function getActivity(){
    try{
        const a=JSON.parse(localStorage.getItem(ACTIVITY_KEY));
        if(!a)return null;
        // Penalidade de morte expirada: limpa automaticamente para não bloquear mineração
        // (cobre o caso de fechar o browser durante os 3 min de penalidade)
        if(a.pvp_dead&&a.dead_until&&Date.now()>a.dead_until){
            localStorage.removeItem(ACTIVITY_KEY);
            try{localStorage.removeItem(SPOT_LOCK_KEY());}catch{}
            return null;
        }
        // Mineração: expira quando a sessão termina (hora ímpar UTC + 110 min).
        // session_ends_at é gravado explicitamente por mines.js; se ausente (entradas antigas),
        // usa fallback de 2h (máximo teórico de uma sessão de mina).
        if(a.type==='mining'){
            const miningEndsAt=a.session_ends_at||null;
            if(miningEndsAt&&Date.now()>miningEndsAt){localStorage.removeItem(ACTIVITY_KEY);return null;}
            if(!miningEndsAt&&a.started_at&&(Date.now()-a.started_at)>2*60*60*1000){localStorage.removeItem(ACTIVITY_KEY);return null;}
        }
        // Caça: expira após 6 horas sem interação (previne bloqueio por crash)
        if(a.type==='hunting'&&a.started_at&&(Date.now()-a.started_at)>6*60*60*1000){localStorage.removeItem(ACTIVITY_KEY);return null;}
        return a;
    }catch{return null;}
}
function setActivityHunting(spotId, forceResetLock = false, pvpOnly = false){
    const cur=getActivity()||{};
    const keepTimer = !forceResetLock && cur.type==='hunting' && cur.spot_id===spotId;
    // Fallback: chave dedicada, sobrevive a ACTIVITY_KEY ser sobrescrita por outra página
    const savedLockTs = (!forceResetLock && !keepTimer) ? _getSpotLockTs(spotId) : null;
    const lockTs = keepTimer ? cur.spot_started_at : (savedLockTs ?? Date.now());
    // Persiste na chave dedicada apenas quando o lock é novo (não sobrescreve um válido)
    if(!keepTimer && !savedLockTs){
        try{localStorage.setItem(SPOT_LOCK_KEY(),JSON.stringify({spot_id:spotId,locked_at:lockTs}));}catch{}
    } else if(forceResetLock){
        // Reset explícito (vitória em PvP) → grava novo timestamp
        try{localStorage.setItem(SPOT_LOCK_KEY(),JSON.stringify({spot_id:spotId,locked_at:Date.now()}));}catch{}
    }
    // Timestamps precisos de expiração — permitem que mines.js libere o lock
    // sem precisar que o jogador retorne à página de caça.
    // hunt_ends_at:        quando as 3h diárias se esgotam (caça normal)
    // pvp_only_expires_at: quando os 15 min de PvP puro expiram
    const hunt_ends_at         = pvpOnly ? null : Date.now() + (localSecondsLeft * 1000);
    const pvp_only_expires_at  = pvpOnly ? Date.now() + (pvpOnlySecondsLeft * 1000) : null;
    localStorage.setItem(ACTIVITY_KEY,JSON.stringify({
        type:'hunting',region:REGION_NAME,spot_id:spotId,
        pvp_only: pvpOnly,
        spot_started_at: lockTs,
        started_at: Date.now(),
        hunt_ends_at,
        pvp_only_expires_at
    }));
}
function clearActivity(){
    localStorage.removeItem(ACTIVITY_KEY);
    try{localStorage.removeItem(SPOT_LOCK_KEY());}catch{}
}
function _getSpotLockTs(spotId){
    try{
        const raw=localStorage.getItem(SPOT_LOCK_KEY());
        if(!raw)return null;
        const o=JSON.parse(raw);
        return(o.spot_id===spotId&&o.locked_at)?o.locked_at:null;
    }catch{return null;}
}
function canSwitchSpot(){
    const a=getActivity();
    // Fonte primária: ACTIVITY_KEY (mais atualizado quando o jogador está na floresta)
    if(a&&a.type==='hunting'&&a.spot_started_at)return(Date.now()-a.spot_started_at)>=SPOT_LOCK_MS;
    // Fallback: chave dedicada (sobrevive quando ACTIVITY_KEY foi sobrescrito por outra página)
    try{
        const raw=localStorage.getItem(SPOT_LOCK_KEY());
        if(raw){const o=JSON.parse(raw);if(o.locked_at)return(Date.now()-o.locked_at)>=SPOT_LOCK_MS;}
    }catch{}
    return true;
}
function fmtLockTime(){
    const a=getActivity();
    let lockedAt=null;
    if(a&&a.type==='hunting'&&a.spot_started_at)lockedAt=a.spot_started_at;
    if(!lockedAt){
        try{
            const raw=localStorage.getItem(SPOT_LOCK_KEY());
            if(raw){const o=JSON.parse(raw);if(o.locked_at)lockedAt=o.locked_at;}
        }catch{}
    }
    if(!lockedAt)return'0:00';
    const ms=Math.max(0,SPOT_LOCK_MS-(Date.now()-lockedAt));
    const total=Math.ceil(ms/1000);
    const m=Math.floor(total/60),s=total%60;
    return`${m}:${String(s).padStart(2,'0')}`;
}

// ── ESTADO ─────────────────────────────────────────────────
let userId=null, playerData=null, currentSession=null;
let isHunting=false, isPvpOnly=false, currentSpotId=null, localSecondsLeft=DAILY_LIMIT;
let isHuntingElsewhere=false; // sessão ativa em outra região — timer roda, mas sem animações/RPC locais
let pvpOnlyExitTimer=null, pvpOnlySecondsLeft=900, pvpOnlyTimerInterval=null;
let eliminationModalShown=false;
function _elimAckKey(huntDate){return `elim_ack_${userId}_${huntDate||'today'}`;}
function isEliminationAcknowledged(huntDate){try{return localStorage.getItem(_elimAckKey(huntDate))==='1';}catch{return eliminationModalShown;}}
function setEliminationAcknowledged(huntDate){try{localStorage.setItem(_elimAckKey(huntDate),'1');}catch{}eliminationModalShown=true;}
function clearEliminationAcknowledged(huntDate){try{localStorage.removeItem(_elimAckKey(huntDate));}catch{}eliminationModalShown=false;}
let shieldUntil=null, cachedShieldQty=0;
let huntTimerInterval=null, shieldTimerInterval=null;
let otherPlayers=[], wanderTimers=[];

// ── GUILD NAME CACHE (localStorage, TTL 48h) ──────────────────
// Resolve guild_id (UUID) → guild name sem RPC repetida.
// Chave separada para não misturar com owners_store (que só tem UUID).
const _GUILD_CACHE_KEY = 'aden_guild_names_cache';
const _GUILD_CACHE_TTL = 48 * 60 * 60 * 1000; // 48h

function _guildCacheLoad(){
    try{
        const raw=localStorage.getItem(_GUILD_CACHE_KEY);
        if(!raw)return{};
        const obj=JSON.parse(raw);
        const now=Date.now();
        // Filtra entradas expiradas ao carregar
        const valid={};
        Object.entries(obj).forEach(([id,entry])=>{
            if(entry.ts&&(now-entry.ts)<_GUILD_CACHE_TTL)valid[id]=entry;
        });
        return valid;
    }catch{return{};}
}
function _guildCacheSave(map){
    try{localStorage.setItem(_GUILD_CACHE_KEY,JSON.stringify(map));}catch{}
}
function _guildCacheGet(guildId){
    return _guildNamesCache[guildId]?.name||null;
}

let _guildNamesCache = _guildCacheLoad(); // { [guildId]: {name, ts} }

// Resolve em batch os guild_ids que ainda não têm nome em cache.
// Chamado de forma lazy após render — não bloqueia UI.
async function _resolveGuildNames(guildIds){
    if(!guildIds||!guildIds.length)return;
    const missing=guildIds.filter(id=>id&&!_guildNamesCache[id]);
    if(!missing.length)return;
    try{
        const{data,error}=await supabase.from('guilds').select('id,name').in('id',missing);
        if(error||!data)return;
        const now=Date.now();
        data.forEach(g=>{_guildNamesCache[g.id]={name:g.name,ts:now};});
        _guildCacheSave(_guildNamesCache);
        // Re-renderiza apenas se houver jogadores visíveis com essas guilds
        const affected=otherPlayers.filter(p=>_ownersMap[p.id]?.guild_id&&missing.includes(_ownersMap[p.id].guild_id));
        if(affected.length)renderOtherPlayers(otherPlayers);
    }catch(e){console.warn('[floresta] guild resolve',e);}
}

// Busca guild_id de jogadores que ainda não têm no _ownersMap
// (ex: nunca foram donos de mina). Atualiza IDB + cache em memória.
async function _fetchMissingGuildIds(playerIds){
    if(!playerIds||!playerIds.length)return;
    // Filtra apenas quem não tem guild_id no mapa
    // Busca para qualquer jogador sem guild_id — inclusive os que ainda não estão no _ownersMap
    const missing=playerIds.filter(id=>id&&(!_ownersMap[id]||!_ownersMap[id].guild_id));
    if(!missing.length)return;
    try{
        const{data,error}=await supabase.from('players').select('id,guild_id').in('id',missing);
        if(error||!data)return;
        let needsRerender=false;
        const toSave=[];
        data.forEach(row=>{
            if(!row.guild_id)return; // sem guilda, não há o que salvar
            if(!_ownersMap[row.id])_ownersMap[row.id]={id:row.id};
            _ownersMap[row.id].guild_id=row.guild_id;
            toSave.push({id:row.id,guild_id:row.guild_id});
            needsRerender=true;
        });
        // Persiste no IDB com merge (preserva name/avatar)
        if(toSave.length)_idbSaveOwners(toSave).catch(()=>{});
        // Dispara _resolveGuildNames para os UUIDs recém obtidos
        const newGuildIds=[...new Set(toSave.map(o=>o.guild_id))];
        if(newGuildIds.length)await _resolveGuildNames(newGuildIds);
        // Re-render já é chamado dentro de _resolveGuildNames se houver nomes novos.
        // Mas se nenhum guild_id foi encontrado (todos sem guilda), needsRerender=false. Correto.
    }catch(e){console.warn('[floresta] fetch guild_ids',e);}
}
let _ownersMap = {}; // { [playerId]: {name, avatar_url, guild_id} }

// ── ADAPTIVE POLLING STATE ────────────────────────────────────
let _syncTimeout     = null;
let _currentPollMs   = 30_000;
let _lastPlayersHash = '';

// ── INACTIVITY GUARD ─────────────────────────────────────────
let _lastActivityMs    = Date.now();
let _inactivityCheckId = null;
let _inactivityPaused  = false;

// ── DEAD STATE (derrota em PvP — 3 minutos) ──────────────
let deadUntil=null; // timestamp ms
let deadTimer=null;
let deadOverlayInterval=null;
function isPlayerDead(){return deadUntil&&Date.now()<deadUntil;}

function _startDeadOverlay(){
    const overlay=document.getElementById('deadPenaltyOverlay');
    if(!overlay)return;
    const avImg=document.getElementById('deadPenaltyAvatar');
    if(avImg&&playerData)avImg.src=playerData.avatar_url||DEFAULT_AVATAR;
    overlay.style.display='flex';
    overlay.classList.add('active');
    const timerEl=document.getElementById('deadPenaltyTimer');
    clearInterval(deadOverlayInterval);
    const tick=()=>{
        const remaining=Math.max(0,Math.ceil((deadUntil-Date.now())/1000));
        const m=Math.floor(remaining/60),s=remaining%60;
        if(timerEl)timerEl.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        if(remaining<=0){
            clearInterval(deadOverlayInterval);deadOverlayInterval=null;
            overlay.style.display='none';overlay.classList.remove('active');
        }
    };
    tick();
    deadOverlayInterval=setInterval(tick,1000);
}

function setPlayerDead(){
    deadUntil=Date.now()+3*60*1000;
    // Morte zera o lock de spot — limpa chave dedicada antes de sobrescrever ACTIVITY_KEY
    try{localStorage.removeItem(SPOT_LOCK_KEY());}catch{}
    localStorage.setItem(ACTIVITY_KEY,JSON.stringify({
        type:'hunting',region:REGION_NAME,spot_id:currentSpotId||'__dead__',
        pvp_dead:true,dead_until:deadUntil,started_at:Date.now()
    }));
    clearTimeout(deadTimer);
    deadTimer=setTimeout(()=>{
        deadUntil=null;
        // Não interrompe se o jogador já re-entrou em modo pvp puro durante os 3 min
        if(!isPvpOnly){
            if(currentSpotId){isHunting=false;stopLocalTimer();removePlayerFromSpot();currentSpotId=null;}
            clearTimeout(pvpOnlyExitTimer);
            clearActivity(); // já limpa SPOT_LOCK_KEY via clearActivity
        }
        updateHuntingHUD();
    },3*60*1000);
    _startDeadOverlay();
}
function clearDeadState(){
    deadUntil=null;clearTimeout(deadTimer);deadTimer=null;
    clearInterval(deadOverlayInterval);deadOverlayInterval=null;
    const overlay=document.getElementById('deadPenaltyOverlay');
    if(overlay){overlay.style.display='none';overlay.classList.remove('active');}
}

// ── KILL BANNER QUEUE ─────────────────────────────────────
let _killBannerQueue=[];
let _killBannerShowing=false;
function createKillBannerUI(){
    let el=document.getElementById('huntKillBanner');
    if(!el){el=document.createElement('div');el.id='huntKillBanner';document.body.appendChild(el);}
}
function pushKillNotif(html){
    _killBannerQueue.push(html);
    if(!_killBannerShowing)_processKillQueue();
}
function _processKillQueue(){
    if(_killBannerShowing||_killBannerQueue.length===0)return;
    _killBannerShowing=true;
    const el=document.getElementById('huntKillBanner');
    if(!el){_killBannerShowing=false;return;}
    el.innerHTML=_killBannerQueue.shift();
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    const done=()=>{
        el.classList.remove('show');
        el.removeEventListener('animationend',done);
        _killBannerShowing=false;
        setTimeout(_processKillQueue,400);
    };
    el.addEventListener('animationend',done,{once:true});
}

// ── INDEXEDDB (mesmo do mercador.js) ───────────────────────
const IDB_NAME='aden_inventory_db',IDB_STORE='inventory_store',IDB_VERSION=47;
function openIdb(){return new Promise((res,rej)=>{const req=indexedDB.open(IDB_NAME,IDB_VERSION);req.onerror=()=>rej(req.error);req.onsuccess=e=>res(e.target.result);req.onupgradeneeded=()=>{};});}
async function getItemQtyFromCache(id){try{const db=await openIdb();if(!db.objectStoreNames.contains(IDB_STORE))return 0;const tx=db.transaction(IDB_STORE,'readonly');const all=await new Promise((res,rej)=>{const r=tx.objectStore(IDB_STORE).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return all.filter(i=>(i.items?.item_id===id)||(i.item_id===id)).reduce((s,i)=>s+(i.quantity||0),0);}catch{return 0;}}
async function updateCacheQty(id,delta){try{const db=await openIdb();if(!db.objectStoreNames.contains(IDB_STORE))return;const tx=db.transaction(IDB_STORE,'readwrite'),store=tx.objectStore(IDB_STORE);const all=await new Promise((res,rej)=>{const r=store.getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});const m=all.filter(i=>i.items?.item_id===id);if(!m.length)return;let rem=Math.abs(delta);if(delta<0){for(const item of m){if(rem<=0)break;if(item.quantity>=rem){item.quantity-=rem;rem=0;if(item.quantity<=0)store.delete(item.id);else store.put(item);}else{rem-=item.quantity;store.delete(item.id);}}}else{const item=m[0];item.quantity=(item.quantity||0)+delta;store.put(item);}}catch(e){console.warn('[floresta] IDB fail',e);}}

// ── ÁUDIO ───────────────────────────────────────────────────
const audioCtx=new(window.AudioContext||window.webkitAudioContext)();
const audioBufs={};
const SRC={normal:'https://aden-rpg.pages.dev/assets/normal_hit.mp3',critical:'https://aden-rpg.pages.dev/assets/critical_hit.mp3',evade:'https://aden-rpg.pages.dev/assets/evade.mp3',ambient:'https://aden-rpg.pages.dev/assets/floresta2.mp3'};
async function preload(n){try{const r=await fetch(SRC[n],{cache:'force-cache'});if(!r.ok)return;const ab=await r.arrayBuffer();audioBufs[n]=await new Promise((res,rej)=>audioCtx.decodeAudioData(ab,res,rej));}catch{}}
function playSound(n){try{if(audioCtx.state==='suspended')audioCtx.resume();}catch{}const buf=audioBufs[n];if(!buf)return;try{const gain=audioCtx.createGain();gain.gain.value=(n==='critical'?0.07:1);gain.connect(audioCtx.destination);const s=audioCtx.createBufferSource();s.buffer=buf;s.connect(gain);s.start(0);s.onended=()=>{try{s.disconnect();gain.disconnect();}catch{}};}catch{}}

// ── MOB HIT SOUNDS ───────────────────────────────────────────
const MOB_SOUND_URLS = {
    quar:   'https://aden-rpg.pages.dev/assets/quar.mp3',
    duende: 'https://aden-rpg.pages.dev/assets/duende.mp3',
    limut:  'https://aden-rpg.pages.dev/assets/limut.mp3',
    pixie:  'https://aden-rpg.pages.dev/assets/pixie.mp3',
};
async function preloadUrl(name, url) {
    try {
        const r = await fetch(url, {cache:'force-cache'});
        if (!r.ok) return;
        const ab = await r.arrayBuffer();
        audioBufs[name] = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej));
    } catch {}
}

// ── VOLUME ADAPTATIVO — baseado na posição VISUAL da câmera no mapa ──────────
function _getViewportCenter() {
    const map  = document.getElementById('map');
    const cont = document.getElementById('mapContainer');
    if (!map || !cont) return null;
    const t  = map.style.transform || '';
    const tm = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
    const sm = t.match(/scale\(([^)]+)\)/);
    const tx = tm ? parseFloat(tm[1]) : 0;
    const ty = tm ? parseFloat(tm[2]) : 0;
    const sc = sm ? parseFloat(sm[1]) : 1.1;
    const cw = cont.clientWidth  || window.innerWidth;
    const ch = cont.clientHeight || window.innerHeight;
    return { x: (cw / 2 - tx) / sc, y: (ch / 2 - ty) / sc };
}
function _spotVolume(spotId) {
    const vc   = _getViewportCenter();
    const spot = SPOTS.find(s => s.id === spotId);
    if (!vc || !spot) return 0.5;
    const cx   = spot.left + spot.width  / 2;
    const cy   = spot.top  + spot.height / 2;
    const dist = Math.hypot(vc.x - cx, vc.y - cy);
    return Math.max(0.02, Math.exp(-dist / 300));
}

const amb=new Audio(SRC.ambient);amb.volume=0.04;amb.loop=true;
document.addEventListener('click',()=>{try{if(audioCtx.state==='suspended')audioCtx.resume();}catch{}amb.play().catch(()=>{});},{once:true});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){if(!amb.paused){amb.pause();amb._was=true;}}else{if(amb._was){amb.play().catch(()=>{});amb._was=false;}}});

// ── AUTH ────────────────────────────────────────────────────
async function getUserId(){try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('sb-')&&k.endsWith('-auth-token')){const s=JSON.parse(localStorage.getItem(k));if(s?.user?.id)return s.user.id;}}}catch{}try{const c=localStorage.getItem('player_data_cache');if(c){const p=JSON.parse(c);if(p?.data?.id)return p.data.id;}}catch{}try{const{data}=await supabase.auth.getSession();return data?.session?.user?.id||null;}catch{return null;}}
async function getPlayerData(){
    // 1. Contexto global (index.html popula)
    try{if(window.currentPlayerData?.id)return window.currentPlayerData;}catch{}
    // 2. player_data_cache
    try{const c=localStorage.getItem('player_data_cache');if(c){const p=JSON.parse(c);if(p?.data)return p.data;}}catch{}
    // 3. Fallback: combat stats cache (mesma chave do mines.js/afk) — tem name + avatar_url
    try{
        if(userId){
            const raw=localStorage.getItem(STATS_CACHE_KEY());
            if(raw){const parsed=JSON.parse(raw);if(parsed?.data?.name)return parsed.data;}
        }
    }catch{}
    return null;
}

// ── HELPERS ─────────────────────────────────────────────────
function fmtTime(s){s=Math.max(0,Math.floor(s));return`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function esc(s){if(!s&&s!==0)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function showLoading(){document.getElementById('loadingOverlay').style.display='flex';}
function hideLoading(){document.getElementById('loadingOverlay').style.display='none';}
function showAlert(msg){return new Promise(r=>{const m=document.getElementById('alertModal'),el=document.getElementById('alertMessage'),btn=document.getElementById('alertOkBtn');el.innerHTML=msg;m.style.display='flex';const close=()=>{m.style.display='none';btn.onclick=null;r();};btn.onclick=close;m.addEventListener('click',e=>{if(e.target===m)close();},{once:true});});}
function showConfirm(title,msg){return new Promise(r=>{const m=document.getElementById('confirmModal');document.getElementById('confirmTitle').textContent=title;document.getElementById('confirmMsg').innerHTML=msg;m.style.display='flex';const yes=document.getElementById('confirmYesBtn'),no=document.getElementById('confirmNoBtn');const done=v=>{m.style.display='none';yes.onclick=null;no.onclick=null;r(v);};yes.onclick=()=>done(true);no.onclick=()=>done(false);m.addEventListener('click',e=>{if(e.target===m)done(false);},{once:true});});}

// Modal com cronômetro regressivo em tempo real (atualiza a cada segundo)
function showLiveCountdownAlert(msgFn){
    return new Promise(r=>{
        const m=document.getElementById('alertModal'),el=document.getElementById('alertMessage'),btn=document.getElementById('alertOkBtn');
        const tick=()=>{el.innerHTML=msgFn();};
        tick();
        m.style.display='flex';
        const iv=setInterval(tick,1000);
        const close=()=>{clearInterval(iv);m.style.display='none';btn.onclick=null;r();};
        btn.onclick=close;
        m.addEventListener('click',e=>{if(e.target===m)close();},{once:true});
    });
}

// ── ESCUDO (global — sem region_id) ─────────────────────────
async function initShieldFromCache(){cachedShieldQty=await getItemQtyFromCache(SHIELD_ITEM_ID);updateShieldBtn();}
function updateShieldBtn(){const btn=document.getElementById('activateShieldBtn');if(!btn)return;btn.textContent=`🛡 Ativar Escudo (x${cachedShieldQty})`;btn.disabled=cachedShieldQty<=0;}
function isShieldActive(){return shieldUntil&&shieldUntil>new Date();}
function startShieldTimer(){clearInterval(shieldTimerInterval);const row=document.getElementById('shieldHudRow'),txt=document.getElementById('shieldHudText');if(!row||!txt)return;const tick=()=>{const diff=Math.max(0,Math.floor((shieldUntil-new Date())/1000));if(diff<=0){clearInterval(shieldTimerInterval);row.style.display='none';updateMyShieldIcon(false);return;}row.style.display='flex';txt.textContent=`Protegido por ${fmtTime(diff)}`;};tick();shieldTimerInterval=setInterval(tick,1000);}
async function handleActivateShield(){
    if(cachedShieldQty<=0){await showAlert('Você não tem <strong>Escudo de Caça</strong> no inventário!');return;}
    const ok=await showConfirm('🛡 Escudo de Caça',`Ativar Escudo de Caça?<br><small style="color:#aab;">Protege de PvP por 1h. Máx. 3h acumuladas. Você tem <strong>${cachedShieldQty}</strong>.</small>`);
    if(!ok)return;
    cachedShieldQty--;updateShieldBtn();await updateCacheQty(SHIELD_ITEM_ID,-1);
    showLoading();
    try{
        // RPC activate_hunt_shield agora não precisa de p_region_id
        const{data,error}=await supabase.rpc('activate_hunt_shield',{p_player_id:userId});
        if(error)throw error;
        if(!data?.success){cachedShieldQty++;updateShieldBtn();await updateCacheQty(SHIELD_ITEM_ID,1);await showAlert(data?.message||'Erro.');return;}
        shieldUntil=new Date(data.shield_until);startShieldTimer();updateMyShieldIcon(true);
        await showAlert('🛡 <strong>Escudo ativado!</strong>');
    }catch(e){cachedShieldQty++;updateShieldBtn();await updateCacheQty(SHIELD_ITEM_ID,1);await showAlert('Erro: '+(e.message||''));}
    finally{hideLoading();}
}
function updateMyShieldIcon(active){const el=document.getElementById('myShieldIcon');if(el)el.style.display=active?'block':'none';}

// ── DRAG DO MAPA ─────────────────────────────────────────────
function enableMapInteraction(){const cont=document.getElementById('mapContainer'),map=document.getElementById('map');if(!map||!cont)return;let drag=false,sx,sy,cx=0,cy=0,vx=0,vy=0,lt=0,aId=null;const limits=()=>{const cr=cont.getBoundingClientRect(),m=map.style.transform.match(/scale\(([^)]+)\)/),sc=m?parseFloat(m[1]):1.1;return{minX:Math.min(0,cr.width-1500*sc),maxX:0,minY:Math.min(0,cr.height-1500*sc),maxY:0};};const setPos=(x,y)=>{const L=limits();cx=Math.max(L.minX,Math.min(x,L.maxX));cy=Math.max(L.minY,Math.min(y,L.maxY));const m=map.style.transform.match(/scale\(([^)]+)\)/);map.style.transform=`translate(${cx}px,${cy}px) ${m?`scale(${m[1]})`:'scale(1.1)'}`;};const inertia=()=>{cancelAnimationFrame(aId);if(drag)return;vx*=0.94;vy*=0.94;setPos(cx+vx,cy+vy);if(Math.abs(vx)>0.4||Math.abs(vy)>0.4)aId=requestAnimationFrame(inertia);};const startDrag=e=>{if(e.touches?.length>1)return;drag=true;try{if(audioCtx.state==='suspended')audioCtx.resume();}catch{}amb.play().catch(()=>{});map.style.cursor='grabbing';sx=e.clientX??e.touches[0].clientX;sy=e.clientY??e.touches[0].clientY;vx=vy=0;lt=performance.now();cancelAnimationFrame(aId);};const onDrag=e=>{if(!drag)return;e.preventDefault();const nx=e.clientX??e.touches[0].clientX,ny=e.clientY??e.touches[0].clientY,dt=performance.now()-lt;if(dt>0){vx=(nx-sx)/dt;vy=(ny-sy)/dt;}setPos(cx+(nx-sx),cy+(ny-sy));sx=nx;sy=ny;lt=performance.now();};const endDrag=()=>{drag=false;map.style.cursor='grab';if(Math.abs(vx)>0.2||Math.abs(vy)>0.2){vx*=10;vy*=10;inertia();}};map.addEventListener('mousedown',startDrag,{passive:true});window.addEventListener('mousemove',onDrag,{passive:false});window.addEventListener('mouseup',endDrag,{passive:true});map.addEventListener('touchstart',startDrag,{passive:true});window.addEventListener('touchmove',onDrag,{passive:false});window.addEventListener('touchend',endDrag,{passive:true});map.style.cursor='grab';}

// ── WANDER ───────────────────────────────────────────────────
function startWander(el,w,h,delay){const move=()=>{el.style.transition='left 3s ease-in-out,top 3s ease-in-out';el.style.left=Math.max(0,Math.random()*(w-70))+'px';el.style.top=Math.max(0,Math.random()*(h-90))+'px';wanderTimers.push(setTimeout(pause,3100+Math.random()*800));};const pause=()=>{wanderTimers.push(setTimeout(move,8000+Math.random()*5000));};wanderTimers.push(setTimeout(move,delay));}

// ── SPOTS + MOBS ─────────────────────────────────────────────
function renderSpots(){const map=document.getElementById('map');map.querySelectorAll('.hunt-spot').forEach(e=>e.remove());SPOTS.forEach(spot=>{const el=document.createElement('div');el.className='hunt-spot';el.id=`spot-${spot.id}`;Object.assign(el.style,{top:spot.top+'px',left:spot.left+'px',width:spot.width+'px',height:spot.height+'px'});const lbl=document.createElement('div');lbl.className='spot-label';lbl.textContent=spot.name;lbl.style.color=spot.labelColor||'#fff';el.appendChild(lbl);for(let i=0;i<5;i++){const col=i%3,row=Math.floor(i/3);const wrap=document.createElement('div');wrap.className='mob-wrapper';Object.assign(wrap.style,{left:Math.min(10+col*80+Math.random()*20,spot.width-70)+'px',top:Math.min(15+row*80+Math.random()*20,spot.height-90)+'px'});const nm=document.createElement('div');nm.className='mob-name';nm.textContent=spot.name;nm.style.color=spot.labelColor||'#fcc';const av=document.createElement('img');av.className='mob-avatar';av.src=spot.mobImg;av.onerror=()=>{av.src=DEFAULT_AVATAR;};av.style.animationDelay=`-${(Math.random()*3.2).toFixed(2)}s, -${(Math.random()*4.5).toFixed(2)}s`;wrap.appendChild(nm);wrap.appendChild(av);el.appendChild(wrap);startWander(wrap,spot.width,spot.height,i*1400+Math.random()*3000);}el.addEventListener('click',e=>{if(e.target.closest('.other-player-wrapper'))return;handleSpotClick(spot);});map.appendChild(el);});}

// ── AVATAR DO JOGADOR NO SPOT ────────────────────────────────
function renderPlayerOnSpot(spotId){
    document.querySelectorAll('.player-avatar-wrapper').forEach(e=>e.remove());
    if(!spotId||!playerData)return;
    const spotEl=document.getElementById(`spot-${spotId}`);if(!spotEl)return;
    const spot=SPOTS.find(s=>s.id===spotId);
    const wrap=document.createElement('div');wrap.className='player-avatar-wrapper';
    Object.assign(wrap.style,{right:'10px',bottom:'10px',left:'auto',top:'auto'});
    const si=document.createElement('img');si.id='myShieldIcon';si.className='player-shield-icon';si.src=SHIELD_IMG;si.style.display=isShieldActive()?'block':'none';wrap.appendChild(si);
    const nm=document.createElement('div');nm.className='player-name-label';nm.textContent=playerData.name||'Você';wrap.appendChild(nm);
    // Guild do próprio jogador (silver, 0.65em)
    const myGuildId=_ownersMap[userId]?.guild_id||null;
    const myGuildName=myGuildId?_guildCacheGet(myGuildId):null;
    if(myGuildName){
        const gb=document.createElement('div');
        gb.className='player-name-label';
        gb.style.cssText='font-size:0.65em;color:silver;margin-top:-3px;text-shadow:1px 1px 2px #000;white-space:nowrap;';
        gb.textContent=esc(myGuildName);
        wrap.appendChild(gb);
    }
    const av=document.createElement('img');av.className='player-spot-avatar';av.src=playerData.avatar_url||DEFAULT_AVATAR;av.onerror=()=>{av.src=DEFAULT_AVATAR;};wrap.appendChild(av);
    spotEl.appendChild(wrap);
    if(spot)startWander(wrap,spot.width,spot.height,800);
}
function removePlayerFromSpot(){stopCombatLoop();document.querySelectorAll('.player-avatar-wrapper').forEach(e=>e.remove());}

// ── OUTROS JOGADORES ─────────────────────────────────────────
// Estado "morto" (perdeu PvP, penalidade 3 min):
//   is_hunting === false  AND  current_spot SET  AND  pvp_only_entered_at NULL  AND  NOT is_eliminated
// Estado "PvP puro":  is_hunting === false AND pvp_only_entered_at SET
// Estado "pausado":   current_spot === null
function _isDeadPenalty(p){
    return !p.is_hunting && p.current_spot && !p.pvp_only_entered_at && !p.is_eliminated;
}
function renderOtherPlayers(players){
    stopAllOtherCombatLoops();
    _otherCombatBusy.clear();
    document.querySelectorAll('.other-player-wrapper').forEach(e=>e.remove());

    const guildIdsToResolve=[];
    const playerIdsWithoutGuild=[];

    players.forEach(p=>{
        if(!p.current_spot)return;
        const spotEl=document.getElementById(`spot-${p.current_spot}`);
        if(!spotEl)return;
        const spot=SPOTS.find(s=>s.id===p.current_spot);

        const cached      = _ownersMap[p.id];
        const displayName = p.name       || cached?.name       || '?';
        const displayAvatar= p.avatar_url|| cached?.avatar_url || DEFAULT_AVATAR;
        const guildId     = cached?.guild_id || null;
        const guildName   = guildId ? _guildCacheGet(guildId) : null;
        const isDead      = _isDeadPenalty(p);

        // Agenda resoluções lazy
        if(guildId && !guildName)          guildIdsToResolve.push(guildId);
        if(cached && !cached.guild_id)     playerIdsWithoutGuild.push(p.id);
        if(!cached)                        playerIdsWithoutGuild.push(p.id);

        const wrap=document.createElement('div');
        wrap.className='other-player-wrapper';
        wrap.dataset.playerId=p.id;
        Object.assign(wrap.style,{
            left:(10+Math.random()*Math.max(10,(spot?.width||120)-80))+'px',
            top :(10+Math.random()*Math.max(10,(spot?.height||120)-90))+'px',
        });

        // Escudo
        const shActive=p.shield_until&&new Date(p.shield_until)>new Date();
        if(shActive){const si=document.createElement('img');si.className='other-player-shield';si.src=SHIELD_IMG;wrap.appendChild(si);}

        // Nome — 0.75em  ← TAMANHO DO NOME: altere aqui
        const nm=document.createElement('div');
        nm.className='other-player-name';
        nm.style.fontSize='0.75em';
        nm.textContent=esc(displayName);
        wrap.appendChild(nm);

        // Nome da guilda — 0.65em, silver, sem colchetes  ← TAMANHO DA GUILDA: altere aqui
        if(guildName){
            const gb=document.createElement('div');
            gb.className='other-player-name';
            gb.style.cssText='font-size:0.65em;color:silver;margin-top:-3px;';
            gb.textContent=esc(guildName);
            wrap.appendChild(gb);
        }

        // Avatar
        const av=document.createElement('img');
        av.className='other-player-avatar';
        if(p.is_eliminated||isDead) av.classList.add('eliminated');
        av.src=displayAvatar;
        av.onerror=()=>{av.src=DEFAULT_AVATAR;};
        wrap.appendChild(av);

        if(p.is_eliminated){
            // Eliminado permanentemente hoje
            const lbl=document.createElement('div');lbl.className='other-eliminated-label';lbl.textContent='Eliminado';wrap.appendChild(lbl);
        } else if(isDead){
            // Penalidade de derrota: mostra caveira, sem clique de ataque
            const lbl=document.createElement('div');lbl.className='other-eliminated-label';
            lbl.textContent='💀 Derrota';lbl.style.color='#f88';wrap.appendChild(lbl);
        } else {
            wrap.addEventListener('click',e=>{e.stopPropagation();handleAttackPlayer(p);});
            if(spot)startWander(wrap,spot.width,spot.height,Math.random()*4000);
        }

        spotEl.appendChild(wrap);
    });

    if(players.some(p=>!p.is_eliminated&&!_isDeadPenalty(p)&&p.current_spot)){_ensureOtherCombatInterval();}

    // Resoluções lazy (não bloqueiam o render)
    if(guildIdsToResolve.length)_resolveGuildNames([...new Set(guildIdsToResolve)]).catch(()=>{});
    if(playerIdsWithoutGuild.length)_fetchMissingGuildIds([...new Set(playerIdsWithoutGuild)]).catch(()=>{});
}

// ── TIMER GLOBAL ─────────────────────────────────────────────
function updateTimerDisplay(){const el=document.getElementById('huntTimer');if(el)el.textContent=isPvpOnly?fmtTime(pvpOnlySecondsLeft):fmtTime(localSecondsLeft);}
function startLocalTimer(){clearInterval(huntTimerInterval);huntTimerInterval=setInterval(()=>{if(!isHunting&&!isHuntingElsewhere)return;if(localSecondsLeft<=0){localSecondsLeft=0;clearInterval(huntTimerInterval);updateTimerDisplay();if(isHunting)onHuntComplete();return;}localSecondsLeft--;updateTimerDisplay();},1000);if(isHunting)startCombatLoop();}
function stopLocalTimer(){clearInterval(huntTimerInterval);huntTimerInterval=null;stopCombatLoop();}

// ── TIMER PvP PURO (15 min) ───────────────────────────────
function startPvpOnlyTimer(resetToFull=true){
    clearInterval(pvpOnlyTimerInterval);
    if(resetToFull)pvpOnlySecondsLeft=900;
    updateTimerDisplay();
    pvpOnlyTimerInterval=setInterval(()=>{
        if(!isPvpOnly){clearInterval(pvpOnlyTimerInterval);return;}
        if(pvpOnlySecondsLeft<=0){clearInterval(pvpOnlyTimerInterval);exitPvpOnlyMode();return;}
        pvpOnlySecondsLeft--;updateTimerDisplay();
    },1000);
}
function stopPvpOnlyTimer(){clearInterval(pvpOnlyTimerInterval);pvpOnlyTimerInterval=null;}
function resetPvpOnlyTimer(){
    // Chamado após vitória em PvP — renova os 15 min
    pvpOnlySecondsLeft=900; // garante que o valor está no topo antes dos timeouts
    clearTimeout(pvpOnlyExitTimer);
    pvpOnlyExitTimer=setTimeout(exitPvpOnlyMode,pvpOnlySecondsLeft*1000);
    startPvpOnlyTimer(); // resetToFull=true implicitamente (já setamos acima)
    // Atualiza pvp_only_entered_at no servidor (fire and forget)
    supabase.rpc('start_pvp_only',{p_player_id:userId,p_region_id:REGION_ID,p_spot:currentSpotId}).catch(()=>{});
}

function updateHuntingHUD(){
    const hud=document.getElementById('huntingHud'),status=document.getElementById('huntStatus'),pauseBtn=document.getElementById('pauseHuntBtn');
    updateSpotStyles();
    if(currentSession?.rewards_claimed){hud.style.display='flex';status.textContent='✅ Recompensas coletadas hoje!';pauseBtn.style.display='none';return;}

    // Modo PvP puro (tempo esgotado, entrou só para pvp)
    if(isPvpOnly&&currentSpotId){
        hud.style.display='flex';pauseBtn.style.display='block';
        updateTimerDisplay();
        const spotName=SPOTS.find(s=>s.id===currentSpotId)?.name||currentSpotId;
        status.textContent=`⚔️ Modo PvP: ${spotName}`;
        pauseBtn.textContent='Sair';pauseBtn.disabled=false;
        return;
    }

    // Tempo esgotado com recompensas pendentes — mostra botão explícito.
    // O click dispara handlePauseHunt que detecta esse estado e chama onHuntComplete.
    if(localSecondsLeft<=0&&!isHunting){
        if(currentSession&&!currentSession.rewards_claimed){
            hud.style.display='flex';
            status.textContent='🎁 Caçada concluída! Colete suas recompensas.';
            pauseBtn.style.display='block';
            pauseBtn.textContent='Coletar Recompensas';
            pauseBtn.disabled=false;
        } else {
            hud.style.display='none';
        }
        return;
    }
    hud.style.display='flex';pauseBtn.style.display='block';updateTimerDisplay();
    if(isHunting&&currentSpotId){status.textContent=`⚔️ Caçando: ${SPOTS.find(s=>s.id===currentSpotId)?.name||currentSpotId}`;pauseBtn.textContent='Pausar';pauseBtn.disabled=false;}
    else{status.textContent='⏸️ Pausado — clique num spot para continuar';pauseBtn.textContent='Pausado';pauseBtn.disabled=true;}
}
function updateSpotStyles(){
    SPOTS.forEach(s=>{
        const el=document.getElementById(`spot-${s.id}`);
        if(!el)return;
        if((isHunting||isPvpOnly)&&currentSpotId===s.id)el.classList.add('active-spot');
        else el.classList.remove('active-spot');
    });
}

// ── CONCLUSÃO DO DIA (timer global zera) ─────────────────────
async function onHuntComplete(){
    isHunting=false;stopLocalTimer();
    // Libera a atividade imediatamente — o jogador não está mais caçando,
    // independentemente do resultado da RPC de recompensas.
    clearActivity();
    updateHuntingHUD();showLoading();
    try{
        const{data,error}=await supabase.rpc('finish_daily_hunt',{p_player_id:userId});
        if(error)throw error;
        if(data?.success){showRewardsModal(data);if(data.leveled_up)showLevelUpBalloon(data.new_level);} // showRewardsModal também chama clearActivity (redundante mas seguro)
        else await showAlert(data?.message||'Erro ao finalizar.');
    }catch(e){await showAlert('Erro ao finalizar. Tente novamente.');}
    finally{hideLoading();}
}

// ── CLICK NO SPOT ────────────────────────────────────────────
async function handleSpotClick(spot){

    // Guard de mineração — deve ser o PRIMEIRO check, antes de qualquer entrada em spot.
    // Cobre: caça normal, PvP puro por tempo esgotado, troca de spot em PvP.
    // (a mina seta type:'mining' ao conquistar via PvP também)
    const activity=getActivity();
    if(activity?.type==='mining'){
        await showAlert('⛏️ <strong>Você não é onipresente...</strong><br>No momento você está com uma mina ativa.<br>Aguarde o término da sessão de mineração.');
        return;
    }

    // Bloqueado por morte em PvP
    if(isPlayerDead()){
        await showLiveCountdownAlert(()=>{
            const secsLeft=Math.max(0,Math.ceil((deadUntil-Date.now())/1000));
            const m=Math.floor(secsLeft/60),s=secsLeft%60;
            return `💀 Você está no chão após a derrota.<br>Aguarde <strong>${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}</strong> para se recuperar.`;
        });
        return;
    }

    // Tempo de caça esgotado — oferece modo PvP puro (independente de rewards_claimed,
    // pois PvP é atividade separada das recompensas de caça)
    if(localSecondsLeft<=0&&!isPvpOnly){
        // Lock de 15 min vale mesmo vindo de outra região — SPOT_LOCK_KEY persiste no localStorage
        if(!canSwitchSpot()){
            await showLiveCountdownAlert(()=>`⏳ Você precisa aguardar mais <strong>${fmtLockTime()}</strong> antes de trocar de spot.`);
            return;
        }
        const ok=await showConfirm('⚔️ Modo PvP Puro',
            `Seu tempo de caçada terminou, mas você pode entrar no spot de <strong>${esc(spot.name)}</strong> exclusivamente para PvP.<br><small style="color:#fd8;">⏱ Você precisará ficar no spot por <strong>15 minutos</strong>. Vencer um ataque renova o tempo.</small>`);
        if(!ok)return;
        // Entra no modo PvP puro (sem RPC start_hunt — tempo já acabou)
        showLoading();
        try{
            const{data:pvpData,error:pvpErr}=await supabase.rpc('start_pvp_only',{p_player_id:userId,p_region_id:REGION_ID,p_spot:spot.id});
            if(pvpErr)throw pvpErr;
            if(!pvpData?.success){await showAlert(pvpData?.message||'Erro ao entrar no modo PvP.');return;}
            clearEliminationAcknowledged(currentSession?.hunt_date); // libera ack para próxima eliminação
            clearTimeout(pvpOnlyExitTimer);
            isPvpOnly=true;currentSpotId=spot.id;isHunting=false;
            clearTimeout(deadTimer);deadTimer=null;
            // Invalida boot cache para reloads dentro do TTL não carregarem estado desatualizado
            try{localStorage.removeItem(HUNT_CACHE_KEY());}catch{}
            setActivityHunting(spot.id, false, true); // pvpOnly=true — mina não limpa como stale
            renderPlayerOnSpot(spot.id);
            startPvpOnlyTimer();
            pvpOnlyExitTimer=setTimeout(exitPvpOnlyMode,SPOT_LOCK_MS);
            updateHuntingHUD();
            _resetPollInterval();scheduleNextSync();
        }catch(e){await showAlert('Erro: '+(e.message||''));}
        finally{hideLoading();}
        return;
    }

    // Já no mesmo spot (caça normal ou pvp puro) — nada a fazer
    if(currentSpotId===spot.id)return;

    // Tentativa de trocar de spot enquanto em modo pvp puro
    if(isPvpOnly){
        if(!canSwitchSpot()){
            await showLiveCountdownAlert(()=>`⏳ Você precisa aguardar mais <strong>${fmtLockTime()}</strong> antes de trocar de spot.`);return;
        }
        clearTimeout(pvpOnlyExitTimer);
        currentSpotId=spot.id;
        setActivityHunting(spot.id, false, true); // pvpOnly=true
        renderPlayerOnSpot(spot.id);updateHuntingHUD();
        startPvpOnlyTimer();
        pvpOnlyExitTimer=setTimeout(exitPvpOnlyMode,SPOT_LOCK_MS);
        supabase.rpc('start_pvp_only',{p_player_id:userId,p_region_id:REGION_ID,p_spot:spot.id}).catch(()=>{});
        updateHuntingHUD();
        return;
    }

    // Regra: lock de 15 minutos antes de trocar de spot
    // (inclui vir de outra região — SPOT_LOCK_KEY persiste no localStorage entre páginas)
    if(!canSwitchSpot()){
        await showLiveCountdownAlert(()=>`⏳ Você precisa aguardar mais <strong>${fmtLockTime()}</strong> antes de trocar de spot.`);
        return;
    }

    const ok=await showConfirm('Área de Caça',`Caçar na área de <strong>${esc(spot.name)}</strong>?`);
    if(!ok)return;
    showLoading();
    try{
        const{data,error}=await supabase.rpc('start_hunt',{p_player_id:userId,p_region_id:REGION_ID,p_spot:spot.id});
        if(error)throw error;
        if(!data?.success){await showAlert(data?.message||'Erro ao iniciar.');return;}
        localSecondsLeft=Math.max(0,DAILY_LIMIT-(data.total_seconds||0));
        clearEliminationAcknowledged(data.hunt_date); // ao entrar no spot, libera ack para próxima eliminação
        currentSpotId=spot.id;isHunting=true;isPvpOnly=false;
        if(!currentSession)currentSession={};
        currentSession.current_region=REGION_ID;currentSession.current_spot=spot.id;
        // Invalida boot cache — garante que reloads dentro de 180s não restaurem estado pré-caçada
        try{localStorage.removeItem(HUNT_CACHE_KEY());}catch{}
        setActivityHunting(spot.id);
        renderPlayerOnSpot(spot.id);updateHuntingHUD();startLocalTimer();amb.play().catch(()=>{});
        _resetPollInterval();scheduleNextSync();
    }catch(e){await showAlert('Erro: '+(e.message||''));}
    finally{hideLoading();}
}

function exitPvpOnlyMode(){
    isPvpOnly=false;currentSpotId=null;
    clearTimeout(pvpOnlyExitTimer);
    stopPvpOnlyTimer();
    clearActivity();removePlayerFromSpot();
    // updateHuntingHUD vai mostrar o botão "Coletar Recompensas" se localSecondsLeft=0
    // e rewards ainda pendentes — o player clica explicitamente, evitando fire-and-forget
    // que marcava rewards_claimed no banco sem o player ver o modal.
    updateHuntingHUD();
}

// ── PAUSAR / SAIR ────────────────────────────────────────────
async function handlePauseHunt(){
    // Recompensas pendentes — botão "Coletar Recompensas" usa este mesmo handler
    if(localSecondsLeft<=0&&!isHunting&&!isPvpOnly&&currentSession&&!currentSession.rewards_claimed){
        await onHuntComplete();
        return;
    }
    // Modo PvP puro — "Sair" é apenas local
    if(isPvpOnly){
        if(!canSwitchSpot()){
            await showLiveCountdownAlert(()=>`⏳ Você precisa aguardar mais <strong>${fmtLockTime()}</strong> antes de sair.`);return;
        }
        exitPvpOnlyMode();
        return;
    }
    if(!isHunting)return;
    // Penalidade de morte ativa?
    if(isPlayerDead()){
        await showLiveCountdownAlert(()=>{
            const secsLeft=Math.max(0,Math.ceil((deadUntil-Date.now())/1000));
            const m=Math.floor(secsLeft/60),s=secsLeft%60;
            return `💀 Você está no chão após a derrota.<br>Aguarde <strong>${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}</strong> para se recuperar.`;
        });
        return;
    }
    if(!canSwitchSpot()){
        await showLiveCountdownAlert(()=>`⏳ Você precisa aguardar mais <strong>${fmtLockTime()}</strong> antes de pausar.`);
        return;
    }
    showLoading();
    try{
        const{data,error}=await supabase.rpc('pause_hunt',{p_player_id:userId});
        if(error)throw error;
        isHunting=false;stopLocalTimer();
        if(data?.total_seconds!==undefined){localSecondsLeft=Math.max(0,DAILY_LIMIT-data.total_seconds);updateTimerDisplay();}
        currentSpotId=null; // permite re-entrar no mesmo spot após pausar
        // Invalida boot cache para reloads dentro do TTL não restaurarem sessão ativa erroneamente
        try{localStorage.removeItem(HUNT_CACHE_KEY());}catch{}
        clearActivity();
        removePlayerFromSpot();updateHuntingHUD();
        _resetPollInterval();scheduleNextSync();
    }catch(e){await showAlert('Erro ao pausar.');}
    finally{hideLoading();}
}

// ── PVP ──────────────────────────────────────────────────────
async function handleAttackPlayer(target){
    // Verifica se está morto (derrota recente)
    if(isPlayerDead()){
        await showLiveCountdownAlert(()=>{
            const secsLeft=Math.max(0,Math.ceil((deadUntil-Date.now())/1000));
            const m=Math.floor(secsLeft/60),s=secsLeft%60;
            return `💀 Você está no chão.<br>Aguarde <strong>${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}</strong> para se recuperar.`;
        });
        return;
    }
    // Bloqueia ataque em jogador que está em penalidade de derrota
    if(_isDeadPenalty(target)){
        await showAlert(`💀 <strong>${esc(target.name)}</strong> está derrotado. Aguarde ele se recuperar.`);return;
    }
    // Verifica mineração em outra aba
    const activity=getActivity();
    if(activity?.type==='mining'){
        await showAlert('⛏️ <strong>Você não é onipresente...</strong><br>No momento você está minerando.<br>Aguarde o término da mineração.');return;
    }
    // Só pode atacar se estiver caçando OU em modo PvP puro no mesmo spot
    if(!isHunting&&!isPvpOnly){
        await showAlert('⚔️ Você precisa estar em um spot para atacar outros jogadores.');return;
    }
    if(currentSpotId!==target.current_spot){
        await showAlert('⚔️ Você só pode atacar jogadores no mesmo spot que você.');return;
    }
    // Já eliminado localmente?
    if(target.is_eliminated){
        await showAlert(`💀 <strong>${esc(target.name)}</strong> já foi eliminado.`);return;
    }
    // ── Sync pré-ataque (fix: evita falso "não está caçando" por last_seen stale) ──
    // Atualiza nossa lista local antes de confirmar o ataque.
    await syncOtherPlayers().catch(()=>{});
    // Reavalia alvo após sync — pode ter saído do spot entre o clique e agora
    const freshTarget = otherPlayers.find(p=>p.id===target.id);
    if(!freshTarget){
        await showAlert(`⚔️ <strong>${esc(target.name)}</strong> não está mais neste spot.`);return;
    }
    if(_isDeadPenalty(freshTarget)){
        await showAlert(`💀 <strong>${esc(target.name)}</strong> está derrotado. Aguarde ele se recuperar.`);return;
    }
    // Usa objeto atualizado daqui em diante
    target = freshTarget;
    // Calcula aliados de guilda do defensor no mesmo spot (para aviso pré-ataque)
    const targetGuildId = _ownersMap[target.id]?.guild_id || null;
    let guildAlliesCount = 0;
    if(targetGuildId && target.current_spot){
        guildAlliesCount = otherPlayers.filter(p =>
            p.id !== target.id &&
            !p.is_eliminated &&
            p.current_spot === target.current_spot &&
            (_ownersMap[p.id]?.guild_id === targetGuildId)
        ).length;
    }
    const guildReductionPct = Math.min(20, guildAlliesCount * 5);
    const guildWarning = guildAlliesCount > 0
        ? `<br><small style="color:#adf;">🛡️ <strong>${esc(target.name)}</strong> está acompanhado de <strong>${guildAlliesCount}</strong> companheiro(s) de guilda — isso reduzirá <strong>${guildReductionPct}%</strong> do seu dano. Atacar mesmo assim?</small>`
        : '';
    // Escudo do atacante: avisar que perderá proteção
    if(isShieldActive()){
        const okShield=await showConfirm('⚠️ Escudo Ativo',
            `Tem certeza que deseja atacar <strong>${esc(target.name)}</strong>?<br><small style="color:#f88;">Essa ação fará você perder o Escudo de Caça.</small>${guildWarning}`);
        if(!okShield)return;
        // Remove escudo localmente
        shieldUntil=null;
        clearInterval(shieldTimerInterval);
        document.getElementById('shieldHudRow').style.display='none';
        updateMyShieldIcon(false);
    } else {
        const ok=await showConfirm('PvP',`Deseja atacar <strong>${esc(target.name)}</strong>?${guildWarning}`);if(!ok)return;
    }
    showLoading();
    let pvpData=null;
    try{
        const{data,error}=await supabase.rpc('attack_hunting_player',{p_attacker_id:userId,p_defender_id:target.id,p_region_id:REGION_ID});
        if(error)throw error;
        if(!data?.success){
            // Banco confirmou que defensor já estava morto — atualiza UI local
            if(data?.already_eliminated){
                otherPlayers=otherPlayers.map(p=>p.id===target.id
                    ?{...p,is_eliminated:true,eliminated_by_name:data.eliminated_by_name||'alguém'}
                    :p);
                renderOtherPlayers(otherPlayers);
                await showAlert(`💀 <strong>${esc(target.name)}</strong> já havia sido eliminado por <strong>${esc(data.eliminated_by_name||'alguém')}</strong>.`);
                return;
            }
            // [FIX 1] Jogador não está mais no spot — remove do mapa imediatamente
            if(data?.remove_from_map){
                otherPlayers=otherPlayers.filter(p=>p.id!==target.id);
                renderOtherPlayers(otherPlayers);
            }
            await showAlert(data?.message||'Erro no PvP.');return;
        }
        pvpData=data;
    }catch(e){await showAlert('Erro no PvP: '+(e.message||''));return;}
    finally{hideLoading();}

    // Anima com loading já escondido
    await runPvpAnimation(pvpData);

    const myName=playerData?.name||'Você';
    const regionNameDisplay=REGION_NAME;
    // [FIX 3] Exibe buff de guilda ativo na defesa, se houver
    if(pvpData.guild_allies_in_spot>0){
        const reduction=Math.round((pvpData.guild_damage_reduction||0)*100);
        pushKillNotif(`🛡️ <span style="color:#adf">${esc(pvpData.defender_name)}</span> tinha <strong>${pvpData.guild_allies_in_spot}</strong> aliado(s) de guilda no spot — bônus de defesa de <strong>${reduction}%</strong> aplicado!`);
    }
    if(pvpData.combat?.winner_id===userId){
        // VITÓRIA — banner otimista imediato (não espera o sync global)
        const kTxt=pvpData.attacker_daily_kills>0?`, eliminando um total de <span style="color:#ff8">${pvpData.attacker_daily_kills}</span> hoje!`:'!';
        pushKillNotif(
            `<span style="color:#ff8">${esc(myName)}</span> acabou de eliminar `+
            `<span style="color:#f88">${esc(pvpData.defender_name)}</span> em `+
            `<span style="color:#8ff">${esc(regionNameDisplay)}</span>${kTxt}`
        );
        // Pré-marca o evento como visto para o syncGlobal não duplicar
        if(pvpData.pvp_event_id){
            const seenKey=`hunt_pvp_seen_${userId}`;
            try{const seen=new Set(JSON.parse(localStorage.getItem(seenKey)||'[]'));seen.add(pvpData.pvp_event_id);localStorage.setItem(seenKey,JSON.stringify([...seen].slice(-200)));}catch{}
        }
        otherPlayers=otherPlayers.map(p=>p.id===target.id?{...p,is_eliminated:true,eliminated_by_name:myName}:p);
        renderOtherPlayers(otherPlayers);
        // Garante pvpOnlySecondsLeft=900 ANTES de gravar o pvp_only_expires_at na activity
        if(isPvpOnly)resetPvpOnlyTimer();
        // Reseta lock de 15 min — preserva pvp_only se estiver nesse modo
        if(currentSpotId)setActivityHunting(currentSpotId, true, isPvpOnly);
    } else {
        // DERROTA — fica morto 3 min
        isHunting=false;isPvpOnly=false;stopLocalTimer();stopPvpOnlyTimer();removePlayerFromSpot();
        clearTimeout(pvpOnlyExitTimer);
        if(currentSpotId)setActivityHunting(currentSpotId, true);
        currentSpotId=null;
        clearActivity();updateHuntingHUD();
        setPlayerDead();
    }
    // Sincroniza evento global imediatamente para todos verem
    syncGlobalPvpEvents();
    syncOtherPlayers();
}

async function runPvpAnimation(data){
    const modal=document.getElementById('pvpModal'),combat=data.combat||{},log=combat.battle_log||[];
    const pvpBgMusic=document.getElementById('pvpBgMusic');
    document.getElementById('pvpAttackerName').textContent=data.attacker_name||'Atacante';
    document.getElementById('pvpDefenderName').textContent=data.defender_name||'Defensor';
    const atkAv=document.getElementById('pvpAttackerAvatar'),defAv=document.getElementById('pvpDefenderAvatar');
    atkAv.src=data.attacker_avatar||playerData?.avatar_url||DEFAULT_AVATAR;defAv.src=data.defender_avatar||DEFAULT_AVATAR;
    atkAv.onerror=()=>{atkAv.src=DEFAULT_AVATAR;};defAv.onerror=()=>{defAv.src=DEFAULT_AVATAR;};
    const atkFill=document.getElementById('pvpAttackerHpFill'),defFill=document.getElementById('pvpDefenderHpFill');
    const atkTxt=document.getElementById('pvpAttackerHpText'),defTxt=document.getElementById('pvpDefenderHpText');
    const atkSide=document.getElementById('pvpAttackerSide'),defSide=document.getElementById('pvpDefenderSide');
    const cntdn=document.getElementById('pvpCountdown');
    const atkId=combat.attacker_id,defId=combat.defender_id;
    const dmgToDef=log.filter(t=>t.attacker_id===atkId).reduce((s,t)=>s+(t.damage||0),0);
    const dmgToAtk=log.filter(t=>t.attacker_id===defId).reduce((s,t)=>s+(t.damage||0),0);
    const defMaxHp=Math.max(1,(combat.defender_health_left||0)+dmgToDef);
    const atkMaxHp=Math.max(1,(combat.attacker_health_left||0)+dmgToAtk);
    let curAtk=atkMaxHp,curDef=defMaxHp;
    function updBars(){
        atkFill.style.width=Math.max(0,curAtk/atkMaxHp*100)+'%';
        defFill.style.width=Math.max(0,curDef/defMaxHp*100)+'%';
        atkTxt.textContent=Math.max(0,curAtk)+'/'+atkMaxHp;
        defTxt.textContent=Math.max(0,curDef)+'/'+defMaxHp;
    }
    updBars();modal.style.display='flex';cntdn.style.display='block';
    // Música de combate (estilo mina)
    try{if(audioCtx.state==='suspended')audioCtx.resume();}catch{}
    if(pvpBgMusic){pvpBgMusic.currentTime=0;pvpBgMusic.volume=0.15;pvpBgMusic.play().catch(()=>{});}
    for(let i=3;i>0;i--){cntdn.textContent='A batalha começa em '+i+'...';await new Promise(r=>setTimeout(r,1000));}
    cntdn.style.display='none';
    for(const turn of log){
        const isAtk=turn.attacker_id===atkId;
        const tgtSide=isAtk?defSide:atkSide,tgtAv=isAtk?defAv:atkAv;
        if(isAtk)curDef=Math.max(0,curDef-(turn.damage||0));
        else curAtk=Math.max(0,curAtk-(turn.damage||0));
        updBars();
        _showDmgOnSide(turn.damage,turn.critical,turn.evaded,tgtSide);
        if(turn.evaded)playSound('evade');
        else if(turn.critical)playSound('critical');
        else playSound('normal');
        tgtAv.classList.remove('shake-animation');void tgtAv.offsetWidth;tgtAv.classList.add('shake-animation');
        setTimeout(()=>tgtAv.classList.remove('shake-animation'),400);
        await new Promise(r=>setTimeout(r,1000));
    }
    await new Promise(r=>setTimeout(r,600));
    if(pvpBgMusic){pvpBgMusic.pause();pvpBgMusic.currentTime=0;}
    modal.style.display='none';
    if(combat.winner_id===userId)await showAlert('⚔️ <strong>VITÓRIA!</strong><br>'+esc(data.defender_name)+' foi eliminado!');
    else await showAlert('⚔️ <strong>DERROTA.</strong><br>'+esc(data.defender_name)+' sobreviveu!');
}
function _showDmgOnSide(dmg,crit,evaded,sideEl){
    const el=document.createElement('div');
    if(evaded){el.textContent='Desviou';el.className='evade-text';}
    else{el.textContent=Number(dmg).toLocaleString();el.className=crit?'crit-damage-number':'damage-number';}
    sideEl.style.position='relative';
    sideEl.appendChild(el);
    el.addEventListener('animationend',()=>el.remove(),{once:true});
}

// ── MODAL DE RECOMPENSAS — agrupa por região ─────────────────
function showRewardsModal(data){
    const modal=document.getElementById('rewardsModal'),content=document.getElementById('rewardsContent');
    const rewards=data.rewards||[]; // [{region_id, item_id, quantity}]
    const xpGained=data.xp_gained||0;

    // Agrupa por região
    const byRegion={};
    rewards.forEach(r=>{if(!byRegion[r.region_id])byRegion[r.region_id]=[];byRegion[r.region_id].push(r);});

    let html=`<div class="reward-xp-row"><span>✨ XP Total Ganho:</span><strong>+${xpGained}</strong></div>`;

    if(Object.keys(byRegion).length===0){
        html+='<p style="color:#aab;font-size:.82em;">Nenhuma recompensa (tempo insuficiente em qualquer região).</p>';
    } else {
        Object.entries(byRegion).forEach(([rid,items])=>{
            const regionName=ALL_REGIONS[rid]?.name||rid;
            html+=`<div class="region-rewards-block"><div class="region-rewards-title">📍 ${esc(regionName)}</div>`;
            items.forEach(g=>{
                const drop=ALL_DROPS[g.item_id];
                const img=drop?.img||DEFAULT_AVATAR;
                const name=drop?.name||`Item #${g.item_id}`;
                html+=`<div class="reward-item-row"><img src="${img}" alt="${esc(name)}" onerror="this.src='${DEFAULT_AVATAR}'"><div class="reward-item-info"><div class="reward-item-name">${esc(name)}</div><div class="reward-item-qty">x${g.quantity}</div></div></div>`;
            });
            html+='</div>';
        });
    }

    content.innerHTML=html;modal.style.display='flex';
    if(currentSession)currentSession.rewards_claimed=true;
    clearActivity();
    updateHuntingHUD();
}

// ── BANNERS GLOBAIS DE PVP ────────────────────────────────────
async function syncGlobalPvpEvents(){
    if(!userId)return false;
    let changed=false;
    try{
        const{data,error}=await supabase.rpc('get_hunt_pvp_events',{p_since_minutes:5});
        if(error||!data)return false;
        const seenKey=`hunt_pvp_seen_${userId}`;
        let seen;try{seen=new Set(JSON.parse(localStorage.getItem(seenKey)||'[]'));}catch{seen=new Set();}
        (data||[]).forEach(ev=>{
            if(seen.has(ev.id))return;
            seen.add(ev.id);changed=true;
            const regionLabel=`<span style="color:#8ff">${esc(ev.region_name)}</span>`;
            if(ev.attacker_won){
                const kTxt=ev.attacker_kills>0?`, eliminando um total de <span style="color:#ff8">${ev.attacker_kills}</span> hoje!`:'!';
                pushKillNotif(`<span style="color:#ff8">${esc(ev.attacker_name)}</span> acabou de eliminar <span style="color:#f88">${esc(ev.defender_name)}</span> em ${regionLabel}${kTxt}`);
            }else{
                const dkTxt=ev.defender_kills>0?`. <span style="color:#8ff">${esc(ev.defender_name)}</span> já eliminou <span style="color:#ff8">${ev.defender_kills}</span> hoje!`:'.';
                pushKillNotif(`<span style="color:#f88">${esc(ev.attacker_name)}</span> tentou atacar <span style="color:#ff8">${esc(ev.defender_name)}</span> em ${regionLabel} e perdeu${dkTxt}`);
            }
        });
        if(changed){try{localStorage.setItem(seenKey,JSON.stringify([...seen].slice(-200)));}catch{}}
    }catch(e){console.warn('[floresta] pvp events error',e);}
    return changed;
}

// ── ADAPTIVE POLL SCHEDULER ───────────────────────────────────
function _getBaseInterval(){
    const hasOthers=otherPlayers.some(p=>!p.is_eliminated&&
        (p.is_hunting||(p.pvp_only_entered_at&&new Date(p.pvp_only_entered_at)>new Date(Date.now()-15*60*1000))));
    if(isPvpOnly)              return POLL_BASE.pvp_only;
    if(isHunting&&hasOthers)   return POLL_BASE.hunting_with_others;
    if(isHunting&&!hasOthers)  return POLL_BASE.hunting_alone;
    if(!isHunting&&hasOthers)  return POLL_BASE.paused_with_others;
    return POLL_BASE.paused_alone;
}
function _getMaxInterval(){
    if(isPvpOnly)return POLL_MAX_3MIN;
    if(isHunting&&otherPlayers.some(p=>!p.is_eliminated))return POLL_MAX_3MIN;
    return POLL_MAX_5MIN;
}
function _resetPollInterval(){_currentPollMs=_getBaseInterval();}
function _stepBackoff(changed){
    if(changed){_currentPollMs=_getBaseInterval();}
    else{_currentPollMs=Math.min(_currentPollMs+POLL_STEP,_getMaxInterval());}
}

function scheduleNextSync(){
    clearTimeout(_syncTimeout);
    if(_inactivityPaused||document.visibilityState==='hidden')return;
    _syncTimeout=setTimeout(async()=>{
        const[playersChanged,pvpChanged]=await Promise.all([syncOtherPlayers(),syncGlobalPvpEvents()]);
        _stepBackoff(playersChanged||pvpChanged);
        scheduleNextSync();
    },_currentPollMs);
}
function stopAllPolling(){clearTimeout(_syncTimeout);_syncTimeout=null;}

// ── PAGE VISIBILITY ───────────────────────────────────────────
document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){stopAllPolling();}
    else if(!_inactivityPaused&&userId){
        // Relê inventário — pode ter mudado em outra aba (ex: compra no mercador).
        // Se o IDB retornar 0, consulta o servidor como fallback (garante que compras
        // no mercador aparecem sem precisar visitar o inventário).
        (async()=>{
            await initShieldFromCache();
            if(cachedShieldQty===0){
                try{
                    const{data}=await supabase.from('inventory_items')
                        .select('quantity')
                        .eq('player_id',userId)
                        .eq('item_id',SHIELD_ITEM_ID)
                        .is('equipped_slot',null);
                    const srvQty=(data||[]).reduce((s,i)=>s+(i.quantity||0),0);
                    if(srvQty>0){cachedShieldQty=srvQty;updateShieldBtn();}
                }catch{}
            }
        })();
        _currentPollMs=_getBaseInterval();
        Promise.all([syncOtherPlayers(),syncGlobalPvpEvents()]).then(()=>scheduleNextSync()).catch(()=>scheduleNextSync());
    }
});

// ── INACTIVITY GUARD ──────────────────────────────────────────
const _INACTIVITY_MS       = 3 * 60 * 1000;
const _INACTIVITY_CHECK_MS = 20_000;
function _resetActivity(){_lastActivityMs=Date.now();}
['touchstart','click','mousemove','keydown','scroll','pointerdown'].forEach(ev=>{
    document.addEventListener(ev,_resetActivity,{passive:true,capture:true});
});
function _startInactivityGuard(){
    clearInterval(_inactivityCheckId);
    _inactivityCheckId=setInterval(()=>{
        if(_inactivityPaused)return;
        if(Date.now()-_lastActivityMs>=_INACTIVITY_MS)_showInactivityModal();
    },_INACTIVITY_CHECK_MS);
}
function _showInactivityModal(){
    _inactivityPaused=true;stopAllPolling();
    const m=document.getElementById('inactivityModal');if(m)m.style.display='flex';
}

// ── SYNC ─────────────────────────────────────────────────────
// get_hunting_state faz UPDATE last_seen (heartbeat) + retorna estado completo.
// Retorna true se houve mudança (para o backoff saber que deve resetar).
async function syncOtherPlayers(){
    if(!userId)return false;
    let changed=false;
    try{
        const{data,error}=await supabase.rpc('get_hunting_state',{p_player_id:userId,p_region_id:REGION_ID});
        if(error||!data)return false;
        const own=data.own_session||{};
        const newPlayers=data.other_players||[];

        // Detecta mudança
        const newHash=newPlayers.map(p=>`${p.id}:${p.current_spot}:${p.is_hunting?1:0}:${p.is_eliminated?1:0}`).sort().join('|');
        if(newHash!==_lastPlayersHash){changed=true;_lastPlayersHash=newHash;}

        // Persiste jogadores no IDB owners (beneficia mines.js e outras páginas)
        const toSave=newPlayers.filter(p=>p.id&&p.name).map(p=>({id:p.id,name:p.name,avatar_url:p.avatar_url||''}));
        if(toSave.length){
            _idbSaveOwners(toSave).catch(()=>{});
            toSave.forEach(o=>{if(!_ownersMap[o.id]||changed)_ownersMap[o.id]={...(_ownersMap[o.id]||{}),...o};});
        }

        // Resolve guild names para todos os jogadores presentes (lazy, post-render)
        const guildIds=newPlayers.map(p=>_ownersMap[p.id]?.guild_id).filter(Boolean);
        if(guildIds.length)_resolveGuildNames([...new Set(guildIds)]).catch(()=>{});
        // Busca guild_id de jogadores que não têm no IDB (ex: nunca mineraram)
        const needsGuild=newPlayers.filter(p=>p.id&&(!_ownersMap[p.id]||!_ownersMap[p.id]?.guild_id)).map(p=>p.id);
        if(needsGuild.length)_fetchMissingGuildIds(needsGuild).catch(()=>{});

        // Banners de saída de spot
        otherPlayers.forEach(old=>{
            if(old.is_eliminated)return;
            const stillHere=newPlayers.find(np=>np.id===old.id);
            if(!stillHere&&old.is_hunting)
                pushKillNotif(`<span style="color:#ff8">${esc(old.name||_ownersMap[old.id]?.name||'?')}</span> deixou o spot em <span style="color:#8ff">${esc(REGION_NAME)}</span>.`);
        });
        otherPlayers=newPlayers;renderOtherPlayers(otherPlayers);

        // Eliminação detectada via own_session
        if(own.is_eliminated&&!isEliminationAcknowledged(currentSession?.hunt_date||own.hunt_date)){
            isHunting=false;isPvpOnly=false;stopLocalTimer();stopPvpOnlyTimer();
            clearTimeout(pvpOnlyExitTimer);
            removePlayerFromSpot();currentSpotId=null;
            // Limpa atividade imediatamente — não espera o clique no modal.
            // Garante que a mina não fica bloqueada se o jogador navegar sem fechar o modal.
            clearActivity();
            updateHuntingHUD();
            document.getElementById('eliminatedByName').textContent=own.eliminated_by_name||'alguém';
            document.getElementById('eliminatedModal').style.display='flex';
        }

        // Atualiza escudo se mudou no servidor
        if(own.shield_until){
            const srv=new Date(own.shield_until);
            if(!shieldUntil||Math.abs(srv.getTime()-shieldUntil.getTime())>2000){shieldUntil=srv;if(isShieldActive())startShieldTimer();}
        }

        // Persiste snapshot no boot cache
        try{localStorage.setItem(HUNT_CACHE_KEY(),JSON.stringify({ts:Date.now(),data}));}catch{}

        // Resync do timer se o jogador não estiver caçando — corrige drift de
        // sessões pausadas/finalizadas em outro dispositivo ou aba
        if(!isHunting&&!isPvpOnly&&own.total_seconds!==undefined){
            let _srvTotal=own.total_seconds||0;
            if(own.is_hunting&&own.hunt_started_at){
                const _el=Math.floor((Date.now()-new Date(own.hunt_started_at).getTime())/1000);
                _srvTotal=Math.min(DAILY_LIMIT,_srvTotal+_el);
            }
            const srvLeft=Math.max(0,DAILY_LIMIT-_srvTotal);
            if(Math.abs(srvLeft-localSecondsLeft)>5){localSecondsLeft=srvLeft;updateTimerDisplay();}
            if(srvLeft<=0&&!own.rewards_claimed&&!isPvpOnly){updateHuntingHUD();}
            // [FIX] Mantém isHuntingElsewhere sincronizado com o estado real do servidor
            const _newElsewhere=!!(own.is_hunting&&own.current_region!==REGION_ID&&!own.is_eliminated&&!own.rewards_claimed&&srvLeft>0);
            if(_newElsewhere!==isHuntingElsewhere){
                isHuntingElsewhere=_newElsewhere;
                if(isHuntingElsewhere&&!huntTimerInterval)startLocalTimer();
                else if(!isHuntingElsewhere&&huntTimerInterval){clearInterval(huntTimerInterval);huntTimerInterval=null;}
            }
        }
    }catch(e){console.warn('[floresta] sync error',e);}
    return changed;
}

// ── BOOT ─────────────────────────────────────────────────────
async function boot(){
    showLoading();
    createKillBannerUI();
    try{
        userId=await getUserId();if(!userId){location.href='index.html';return;}

        // ── Pré-carrega IDB owners (zero egress, melhora render imediato) ──
        _idbGetAllOwners().then(async map=>{
            _ownersMap=map;
            // Resolve guild names em batch para quem já está no IDB
            const gIds=[...new Set(Object.values(map).map(o=>o.guild_id).filter(Boolean))];
            if(gIds.length)_resolveGuildNames(gIds).catch(()=>{});
            // Garante que o próprio jogador está no mapa (para guild no próprio avatar)
            if(userId&&!_ownersMap[userId]?.guild_id){
                supabase.from('players').select('id,guild_id').eq('id',userId).single()
                    .then(({data})=>{
                        if(data?.guild_id){
                            if(!_ownersMap[userId])_ownersMap[userId]={id:userId};
                            _ownersMap[userId].guild_id=data.guild_id;
                            _idbSaveOwners([{id:userId,guild_id:data.guild_id}]).catch(()=>{});
                            _resolveGuildNames([data.guild_id]).then(()=>{
                                // Re-renderiza o próprio avatar com a guilda
                                if(currentSpotId)renderPlayerOnSpot(currentSpotId);
                            }).catch(()=>{});
                        }
                    }).catch(()=>{});
            }
        }).catch(()=>{});

        playerData=await getPlayerData();

        // Se ainda sem dados (primeiríssima sessão), tenta combat stats cache como last resort
        if(!playerData){
            try{
                const raw=localStorage.getItem(STATS_CACHE_KEY());
                if(raw){const p=JSON.parse(raw);if(p?.data?.name)playerData=p.data;}
            }catch{}
        }

        preload('normal');preload('critical');preload('evade');
        Object.entries(MOB_SOUND_URLS).forEach(([id, url]) => preloadUrl('mob_' + id, url));
        await initShieldFromCache();
        // Fallback servidor para o escudo: se IDB retornar 0 (ex: compra recente no mercador
        // que ainda não propagou para o IDB desta aba), consulta o banco uma vez.
        if(cachedShieldQty===0){
            try{
                const{data}=await supabase.from('inventory_items')
                    .select('quantity')
                    .eq('player_id',userId)
                    .eq('item_id',SHIELD_ITEM_ID)
                    .is('equipped_slot',null);
                const srvQty=(data||[]).reduce((s,i)=>s+(i.quantity||0),0);
                if(srvQty>0){cachedShieldQty=srvQty;updateShieldBtn();}
            }catch{}
        }

        // Restaura dead state
        const savedAct=getActivity();
        if(savedAct?.pvp_dead&&savedAct?.dead_until&&savedAct.dead_until>Date.now()){
            deadUntil=savedAct.dead_until;
            const remaining=deadUntil-Date.now();
            clearTimeout(deadTimer);
            deadTimer=setTimeout(()=>{
                deadUntil=null;if(currentSpotId){isHunting=false;stopLocalTimer();removePlayerFromSpot();currentSpotId=null;}
                clearActivity();updateHuntingHUD();
            },remaining);
            _startDeadOverlay();
        }

        // Lazy cleanup
        (async()=>{try{await supabase.rpc('cleanup_old_hunting_sessions');}catch{}})();
        renderSpots();

        // ── Boot cache (180s TTL) — restaura UI sem RPC após reloads frequentes ──
        let huntData=null;
        let bootFromCache=false;
        try{
            const raw=localStorage.getItem(HUNT_CACHE_KEY());
            if(raw){const cached=JSON.parse(raw);if(cached?.ts&&(Date.now()-cached.ts)<HUNT_CACHE_TTL&&cached.data){huntData=cached.data;bootFromCache=true;}}
        }catch{}

        if(!bootFromCache){
            const{data,error}=await supabase.rpc('get_hunting_state',{p_player_id:userId,p_region_id:REGION_ID});
            if(error)throw error;
            huntData=data;
            try{localStorage.setItem(HUNT_CACHE_KEY(),JSON.stringify({ts:Date.now(),data:huntData}));}catch{}
        }

        currentSession=huntData?.own_session||null;
        otherPlayers=huntData?.other_players||[];

        // Salva outros jogadores no IDB (enrichment cross-page)
        const playersToCache=(otherPlayers||[]).filter(p=>p.id&&p.name).map(p=>({id:p.id,name:p.name,avatar_url:p.avatar_url||''}));
        if(playersToCache.length){
            _idbSaveOwners(playersToCache).catch(()=>{});
            playersToCache.forEach(o=>{_ownersMap[o.id]={...(_ownersMap[o.id]||{}),...o};});
            // Resolve guild names em batch (fire-and-forget, re-renderiza se necessário)
            const gIds=[...new Set(playersToCache.map(o=>_ownersMap[o.id]?.guild_id).filter(Boolean))];
            if(gIds.length)_resolveGuildNames(gIds).catch(()=>{});
        }

        if(currentSession){
            const srvTotal=currentSession.total_seconds||0;
            let localTotal=srvTotal;
            if(currentSession.is_hunting&&currentSession.hunt_started_at){
                const elapsed=Math.floor((Date.now()-new Date(currentSession.hunt_started_at).getTime())/1000);
                localTotal=Math.min(DAILY_LIMIT,srvTotal+elapsed);
            }
            localSecondsLeft=Math.max(0,DAILY_LIMIT-localTotal);
            // currentSpotId só é restaurado se o jogador estiver ativamente caçando ou em PvP.
            // Caso contrário (ex: morreu no PvP e recarregou), spot fica null para permitir re-entrada.
            const _restoredSpot=(currentSession.current_region===REGION_ID)?currentSession.current_spot:null;
            if(currentSession.is_eliminated)currentSpotId=null;
            isHunting=currentSession.is_hunting
                &&currentSession.current_region===REGION_ID
                &&localSecondsLeft>0
                &&!currentSession.is_eliminated
                &&!currentSession.rewards_claimed;

            // [FIX] Timer conta regressivamente mesmo quando a sessão ativa é em outra região
            isHuntingElsewhere=!isHunting
                &&currentSession.is_hunting===true
                &&currentSession.current_region!==REGION_ID
                &&localSecondsLeft>0
                &&!currentSession.is_eliminated
                &&!currentSession.rewards_claimed;

            if(!isHunting&&currentSession.pvp_only_entered_at&&currentSession.current_region===REGION_ID&&!currentSession.is_eliminated){
                const pvpEnteredAt=new Date(currentSession.pvp_only_entered_at);
                const pvpElapsed=Math.floor((Date.now()-pvpEnteredAt.getTime())/1000);
                const pvpRemaining=900-pvpElapsed;
                if(pvpRemaining>0){isPvpOnly=true;pvpOnlySecondsLeft=pvpRemaining;}
            }

            // Só aplica currentSpotId se realmente vai usar o spot — evita "spot fantasma"
            // quando jogador está morto (is_hunting=false, pvp_only=null, mas current_spot ainda setado no DB)
            currentSpotId=(isHunting||isPvpOnly)?_restoredSpot:null;

            if(currentSession.shield_until){shieldUntil=new Date(currentSession.shield_until);if(isShieldActive())startShieldTimer();}
            if(isHunting&&currentSpotId){renderPlayerOnSpot(currentSpotId);startLocalTimer();amb.play().catch(()=>{});setActivityHunting(currentSpotId);}
            if(isPvpOnly&&currentSpotId){
                renderPlayerOnSpot(currentSpotId);
                // pvpOnly=true — mina e outras páginas não limpam como stale
                setActivityHunting(currentSpotId, false, true);
                startPvpOnlyTimer(false);
                // Restaura o setTimeout de saída com o tempo restante real (evita reset para 15 min após kill)
                clearTimeout(pvpOnlyExitTimer);
                pvpOnlyExitTimer=setTimeout(exitPvpOnlyMode,pvpOnlySecondsLeft*1000);
            }
            // [FIX] Sessão ativa em outra região: timer decrementando (sem animações nesta página)
            if(!isHunting&&!isPvpOnly&&isHuntingElsewhere)startLocalTimer();
            // ── Limpeza de atividade obsoleta no boot ──────────────────────────────────
            // Se o servidor confirma que não está caçando nem em PvP puro E não está na
            // penalidade de morte (deadUntil ainda ativo), o ACTIVITY_KEY deve ser limpo
            // para não bloquear a mineração. Cobre: pausa/fim de sessão feitos em outro
            // dispositivo, aba fechada sem pausar, sessão expirada naturalmente, etc.
            // IMPORTANTE: NÃO apaga SPOT_LOCK_KEY se o lock ainda está dentro dos 15 min
            // — o jogador pode ter vindo de outra região e o lock precisa sobreviver à navegação.
            // [FIX] isHuntingElsewhere adicionado: não apagar ACTIVITY_KEY quando há sessão ativa em outra região
            if(!isHunting&&!isPvpOnly&&!isHuntingElsewhere&&!isPlayerDead()&&!currentSession.pvp_only_entered_at){
                const _staleAct=getActivity();
                if(_staleAct&&_staleAct.type==='hunting'){
                    let _lockStillActive=false;
                    try{
                        const _lockRaw=localStorage.getItem(SPOT_LOCK_KEY());
                        if(_lockRaw){const _lo=JSON.parse(_lockRaw);if(_lo.locked_at&&(Date.now()-_lo.locked_at)<SPOT_LOCK_MS)_lockStillActive=true;}
                    }catch{}
                    localStorage.removeItem(ACTIVITY_KEY);
                    if(!_lockStillActive){try{localStorage.removeItem(SPOT_LOCK_KEY());}catch{}}
                }
            }

            // Usa localTotal (srvTotal + elapsed) porque o servidor só persiste total_seconds
            // no pause/finish — se o jogador saiu enquanto caçava, srvTotal ainda está abaixo
            // de DAILY_LIMIT mesmo que o tempo real já tenha esgotado.
            // Não chama onHuntComplete em PvP-only — recompensas são disparadas ao SAIR do
            // modo PvP (exitPvpOnlyMode), não enquanto o jogador ainda está nele.
            if(localSecondsLeft<=0&&!currentSession.rewards_claimed&&localTotal>=DAILY_LIMIT&&!isPvpOnly&&!currentSession.pvp_only_entered_at){isHunting=false;await onHuntComplete();}
            if(currentSession.is_eliminated&&!isEliminationAcknowledged(currentSession.hunt_date)){
                document.getElementById('eliminatedByName').textContent=currentSession.eliminated_by_name||'um inimigo';
                document.getElementById('eliminatedModal').style.display='flex';
            }
        }

        updateHuntingHUD();renderOtherPlayers(otherPlayers);
        await syncGlobalPvpEvents();

        // Inicia polling adaptativo + inactivity guard
        _currentPollMs=_getBaseInterval();
        // [FIX] Boot do cache: sync imediato em background para não mostrar jogadores obsoletos.
        // Cobre o caso em que outro jogador trocou de spot dentro do TTL de 120s do cache.
        if(bootFromCache)syncOtherPlayers().catch(()=>{});
        scheduleNextSync();
        _startInactivityGuard();

    }catch(e){console.error('[floresta] boot error',e);await showAlert('Erro ao carregar. Recarregue a página.');}
    finally{hideLoading();}
}

// ── COMBAT LOOP (mob attack animation — apenas caça normal, não pvp puro) ──────

// Own-player loop state
let _combatLoopActive = false;
let _combatLoopTimeout = null;

// ── Sound with controllable volume (uses GainNode) ────────────
function playSoundAt(name, volume){
    try{ if(audioCtx.state==='suspended') audioCtx.resume(); }catch{}
    const buf = audioBufs[name];
    if(!buf) return;
    try{
        const gain = audioCtx.createGain();
        gain.gain.value = volume;
        gain.connect(audioCtx.destination);
        const s = audioCtx.createBufferSource();
        s.buffer = buf;
        s.connect(gain);
        s.start(0);
        s.onended = ()=>{ try{ s.disconnect(); gain.disconnect(); }catch{} };
    }catch{}
}

// ── Own-player loop (full volume) ─────────────────────────────
function startCombatLoop(){
    if(_combatLoopActive) return;
    _combatLoopActive = true;
    _combatLoopTimeout = setTimeout(()=>_combatTick_own(), 2800 + Math.random()*1800);
}

function stopCombatLoop(){
    _combatLoopActive = false;
    clearTimeout(_combatLoopTimeout);
    _combatLoopTimeout = null;
    const pw = document.querySelector('.player-avatar-wrapper');
    if(pw){
        pw.classList.remove('player-lunging');
        pw.style.transition = 'left 0.7s ease, top 0.7s ease, right 0.5s, bottom 0.5s';
        pw.style.right = '10px'; pw.style.bottom = '10px';
        pw.style.left = 'auto'; pw.style.top = 'auto';
    }
}

async function _combatTick_own(){
    if(!_combatLoopActive || !isHunting || isPvpOnly || !currentSpotId){ _combatLoopActive=false; return; }
    const spotEl = document.getElementById(`spot-${currentSpotId}`);
    const playerWrap = spotEl?.querySelector('.player-avatar-wrapper');
    if(!spotEl || !playerWrap){ _scheduleOwn(); return; }
    const spot = SPOTS.find(s=>s.id===currentSpotId);
    if(!spot){ _scheduleOwn(); return; }

    const done = await _runAttackSequence(playerWrap, spotEl, spot, null, ()=>_combatLoopActive && isHunting && !isPvpOnly);
    if(!done) return;
    _scheduleOwn();
}

function _scheduleOwn(){
    if(!_combatLoopActive) return;
    _combatLoopTimeout = setTimeout(()=>_combatTick_own(), 2500 + Math.random()*1000);
}

// ── Other-players global combat interval ──────────────────────
let _otherCombatInterval = null;

function startOtherCombatLoop(playerId, spotId){
    // No-op per-player: global interval handles everything
}
function stopOtherCombatLoop(playerId){
    // No-op per-player
}
function stopAllOtherCombatLoops(){
    clearInterval(_otherCombatInterval);
    _otherCombatInterval = null;
}

// Kick global interval whenever renderOtherPlayers runs
function _ensureOtherCombatInterval(){
    if(_otherCombatInterval) return;
    _otherCombatInterval = setInterval(_otherCombatGlobalTick, 4000 + Math.random()*1000);
}

// One tick: pick a random non-busy other-player-wrapper and run one attack
let _otherCombatBusy = new Set(); // player-ids currently mid-animation

async function _otherCombatGlobalTick(){
    // Collect all visible, non-eliminated, non-busy other-player wrappers
    const allWrappers = [...document.querySelectorAll('.other-player-wrapper')]
        .filter(w => !w.querySelector('.other-eliminated-label') && !_otherCombatBusy.has(w.dataset.playerId));

    if(allWrappers.length === 0) return;

    // Pick one at random
    const playerWrap = allWrappers[Math.floor(Math.random() * allWrappers.length)];
    const spotEl = playerWrap.closest('.hunt-spot');
    if(!spotEl) return;

    const spotId = spotEl.id.replace('spot-', '');
    const spot = SPOTS.find(s => s.id === spotId);
    if(!spot) return;

    const pid = playerWrap.dataset.playerId;
    _otherCombatBusy.add(pid);

    await _runAttackSequence(playerWrap, spotEl, spot, 0.10, () => !!playerWrap.parentElement);

    // Rest period before this player can be picked again (2.5–5s)
    setTimeout(() => _otherCombatBusy.delete(pid), 100 + Math.random() * 500);
}

// ── Generic attack sequence (shared by own + others) ──────────
// soundVolume: null = full volume (own player), number = specific volume (others)
// isAlive: function returning bool — gates the await checkpoints
async function _runAttackSequence(playerWrap, spotEl, spot, soundVolume, isAlive){
    const isOwn = soundVolume === null; // own player uses null volume
    const mobs = [...spotEl.querySelectorAll('.mob-wrapper')].filter(m=>!m.classList.contains('mob-dying'));
    if(mobs.length === 0) return true;

    const targetMob = mobs[Math.floor(Math.random() * mobs.length)];
    const mobL = parseFloat(targetMob.style.left) || targetMob.offsetLeft;
    const mobT = parseFloat(targetMob.style.top)  || targetMob.offsetTop;
    const pW = 70, pH = 90;

    const rawLeft  = mobL - pW - 4 + (Math.random()*16 - 8);
    const rawTop   = mobT + (Math.random()*18 - 9);
    const destLeft = Math.max(4, Math.min(spot.width  - pW - 4, rawLeft));
    const destTop  = Math.max(4, Math.min(spot.height - pH - 4, rawTop));

    playerWrap.style.transition = 'left 0.55s cubic-bezier(0.22,1,0.36,1), top 0.55s cubic-bezier(0.22,1,0.36,1), right 0.1s, bottom 0.1s';
    playerWrap.style.right  = 'auto';
    playerWrap.style.bottom = 'auto';
    playerWrap.style.left   = destLeft + 'px';
    playerWrap.style.top    = destTop  + 'px';

    await _delay(580);
    if(!isAlive()) return false;

    // Lunge
    playerWrap.classList.remove('player-lunging');
    void playerWrap.offsetWidth;
    playerWrap.classList.add('player-lunging');
    setTimeout(()=>playerWrap.classList.remove('player-lunging'), 500);

    // Hit stats
    const isCrit  = Math.random() < 0.18;
    const isEvade = !isCrit && Math.random() < 0.10;
    const dmg     = isEvade ? 0 : Math.floor(isCrit ? 4000+Math.random()*4000 : 2000+Math.random()*2000);

    // Flash mob
    targetMob.classList.remove('mob-impact-flash');
    void targetMob.offsetWidth;
    targetMob.classList.add('mob-impact-flash');
    setTimeout(()=>targetMob.classList.remove('mob-impact-flash'), 320);

    // Damage number suppressed in spot animation — sounds and shake only
    // _showMobDmgNumber(targetMob, dmg, isCrit, isEvade);

    // Som de ataque primeiro, depois som do mob com delay
    const sndName = isEvade ? 'evade' : isCrit ? 'critical' : 'normal';
    const _vf = _spotVolume(spot.id);
    playSoundAt(sndName, (sndName === 'critical' ? 0.07 : 1.0) * _vf);
    if (!isEvade) { const _mn = 'mob_' + spot.id; if (audioBufs[_mn]) setTimeout(() => playSoundAt(_mn, 0.6 * _vf), 500); }

    // Shake mob avatar
    const mobAv = targetMob.querySelector('.mob-avatar');
    if(mobAv && !isEvade){
        mobAv.classList.remove('shake-animation');
        void mobAv.offsetWidth;
        mobAv.classList.add('shake-animation');
        setTimeout(()=>mobAv.classList.remove('shake-animation'), 400);
    }

    await _delay(750);
    if(!isAlive()) return false;

    // 40% chance of mob death
    if(!isEvade && !targetMob.classList.contains('mob-dying') && Math.random() < 0.40){
        _triggerMobDeath(targetMob, spot);
    }

    // Return to resting position — own player goes to fixed corner, others wander freely
    await _delay(300);
    if(!isAlive()) return false;

    let returnLeft, returnTop;
    if(isOwn){
        // Own player also wanders to a random position within the spot
        returnLeft = 10 + Math.random() * Math.max(10, spot.width  - pW - 20);
        returnTop  = 10 + Math.random() * Math.max(10, spot.height - pH - 20);
    } else {
        // Other players wander to a new random position within the spot
        returnLeft = 10 + Math.random() * Math.max(10, spot.width  - pW - 20);
        returnTop  = 10 + Math.random() * Math.max(10, spot.height - pH - 20);
    }
    playerWrap.style.transition = 'left 1.4s ease-in-out, top 1.4s ease-in-out';
    playerWrap.style.left = Math.max(4, Math.min(spot.width - pW - 4, returnLeft)) + 'px';
    playerWrap.style.top  = Math.max(4, Math.min(spot.height - pH - 4, returnTop)) + 'px';

    return true;
}

function _delay(ms){ return new Promise(r=>setTimeout(r, ms)); }

function _showMobDmgNumber(mobEl, dmg, crit, evaded){
    const el = document.createElement('div');
    if(evaded){ el.textContent = 'Desviou'; el.className = 'evade-text'; }
    else { el.textContent = Number(dmg).toLocaleString(); el.className = crit ? 'crit-damage-number' : 'damage-number'; }
    mobEl.style.position = 'absolute';
    el.style.position = 'absolute';
    el.style.top  = '10px';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.zIndex = '20';
    el.style.pointerEvents = 'none';
    mobEl.appendChild(el);
    el.addEventListener('animationend', ()=>el.remove(), {once:true});
}

function _triggerMobDeath(mobEl, spot){
    if(mobEl.classList.contains('mob-dying') || mobEl.classList.contains('mob-respawning')) return;
    mobEl.classList.add('mob-dying');

    setTimeout(()=>{
        if(!mobEl.parentElement) return;
        const newL = 8 + Math.random() * Math.max(10, spot.width  - 80);
        const newT = 8 + Math.random() * Math.max(10, spot.height - 95);
        mobEl.style.transition = 'none';
        mobEl.style.left = newL + 'px';
        mobEl.style.top  = newT + 'px';
        mobEl.classList.remove('mob-dying');
        mobEl.classList.add('mob-respawning');
        void mobEl.offsetWidth;
        setTimeout(()=>{ mobEl.classList.remove('mob-respawning'); }, 800);
    }, 9000);
}

document.addEventListener('DOMContentLoaded',async()=>{
    enableMapInteraction();
    document.getElementById('pauseHuntBtn').addEventListener('click',handlePauseHunt);
    document.getElementById('activateShieldBtn').addEventListener('click',handleActivateShield);
    document.getElementById('tutorialBtn').addEventListener('click',()=>{document.getElementById('huntInfoModal').style.display='flex';});
    document.getElementById('huntInfoClose').addEventListener('click',()=>{document.getElementById('huntInfoModal').style.display='none';});
    document.getElementById('huntInfoModal').addEventListener('click',e=>{if(e.target===document.getElementById('huntInfoModal'))document.getElementById('huntInfoModal').style.display='none';});
    document.getElementById('eliminatedCloseBtn').addEventListener('click',()=>{
        document.getElementById('eliminatedModal').style.display='none';
        setEliminationAcknowledged(currentSession?.hunt_date); // grava ack aqui, não ao mostrar
        isHunting=false;isPvpOnly=false;
        stopLocalTimer();stopPvpOnlyTimer();
        clearTimeout(pvpOnlyExitTimer);
        currentSpotId=null;
        removePlayerFromSpot();
        clearActivity();
        updateHuntingHUD();
    });
    document.getElementById('rewardsCloseBtn').addEventListener('click',()=>{document.getElementById('rewardsModal').style.display='none';});
    document.getElementById('inactivityOkBtn').addEventListener('click',()=>{location.reload();});
    await boot();
});

function showLevelUpBalloon(newLevel) {
    const balloon = document.getElementById('levelUpBalloon');
    const text = document.getElementById('levelUpBalloonText');
    if (balloon && text) {
        text.innerText = newLevel;
        balloon.style.display = 'flex';
        setTimeout(() => { balloon.style.display = 'none'; }, 6000);
    }
}
