// =======================================================================
// PVP BOOT NOTIFICATIONS — pvp_boot_notifs.js
// Exibe banners de eventos PvP de caça no boot do index.
// CSS, animação, fila e chave de localStorage idênticos às regiões de caça.
// Eventos vistos aqui NÃO se repetirão nas regiões (mesma chave hunt_pvp_seen_<uid>).
// =======================================================================

(function () {

    // ── CSS IDÊNTICO AO DAS PÁGINAS DE REGIÃO ────────────────────────────
    function _injectBannerCSS() {
        if (document.getElementById('_pvpBootBannerStyle')) return;
        const style = document.createElement('style');
        style.id = '_pvpBootBannerStyle';
        style.textContent = [
            '#huntKillBanner{position:fixed;top:58px;right:0;background:linear-gradient(90deg,rgba(180,30,0,.92),rgba(180,80,0,.92));color:#fff;padding:9px 22px;border-radius:6px 0 0 6px;z-index:25000;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000;box-shadow:0 0 12px rgba(0,0,0,.6);opacity:0;transform:translateX(100%);transition:opacity .3s;}',
            '#huntKillBanner.show{opacity:1;animation:huntBannerSlide 26s linear forwards;}',
            '@keyframes huntBannerSlide{0%{transform:translateX(100%);}100%{transform:translateX(calc(-100% - 5px));}}'
        ].join('');
        document.head.appendChild(style);
    }

    // ── BANNER QUEUE — idêntica às regiões ───────────────────────────────
    let _killBannerQueue   = [];
    let _killBannerShowing = false;

    function _createBannerEl() {
        if (!document.getElementById('huntKillBanner')) {
            const el = document.createElement('div');
            el.id = 'huntKillBanner';
            document.body.appendChild(el);
        }
    }

    function pushKillNotif(html) {
        _killBannerQueue.push(html);
        if (!_killBannerShowing) _processKillQueue();
    }

    function _processKillQueue() {
        if (_killBannerShowing || _killBannerQueue.length === 0) return;
        _killBannerShowing = true;
        const el = document.getElementById('huntKillBanner');
        if (!el) { _killBannerShowing = false; return; }
        el.innerHTML = _killBannerQueue.shift();
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
        const done = () => {
            el.classList.remove('show');
            el.removeEventListener('animationend', done);
            _killBannerShowing = false;
            setTimeout(_processKillQueue, 400);
        };
        el.addEventListener('animationend', done, { once: true });
    }

    // ── ESCAPE HTML ──────────────────────────────────────────────────────
    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── LÓGICA DE EVENTOS — idêntica a syncGlobalPvpEvents() das regiões ─
    async function _runBootPvpNotifs(userId) {
        if (!userId) return;

        const seenKey = `hunt_pvp_seen_${userId}`;
        let seen;
        try { seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]')); }
        catch { seen = new Set(); }

        let events;
        try {
            const { data, error } = await supabaseClient.rpc('get_hunt_pvp_events', { p_since_minutes: 5 });
            if (error || !data) return;
            events = data;
        } catch (e) {
            console.warn('[pvp_boot_notifs] Erro ao buscar eventos:', e);
            return;
        }

        if (!Array.isArray(events) || events.length === 0) return;

        let changed = false;

        events.forEach(ev => {
            if (seen.has(ev.id)) return;
            seen.add(ev.id);
            changed = true;

            // Mesmo template de texto das regiões
            const regionLabel = `<span style="color:#8ff">${esc(ev.region_name)}</span>`;

            if (ev.attacker_won) {
                const kTxt = ev.attacker_kills > 0
                    ? `, eliminando um total de <span style="color:#ff8">${ev.attacker_kills}</span> hoje!`
                    : '!';
                pushKillNotif(
                    `<span style="color:#ff8">${esc(ev.attacker_name)}</span> acabou de eliminar ` +
                    `<span style="color:#f88">${esc(ev.defender_name)}</span> em ${regionLabel}${kTxt}`
                );
            } else {
                const dkTxt = ev.defender_kills > 0
                    ? `. <span style="color:#8ff">${esc(ev.defender_name)}</span> já eliminou <span style="color:#ff8">${ev.defender_kills}</span> hoje!`
                    : '.';
                pushKillNotif(
                    `<span style="color:#f88">${esc(ev.attacker_name)}</span> tentou atacar ` +
                    `<span style="color:#ff8">${esc(ev.defender_name)}</span> em ${regionLabel} e perdeu${dkTxt}`
                );
            }
        });

        if (changed) {
            try { localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-200))); } catch {}
        }
    }

    // ── BOOTSTRAP ────────────────────────────────────────────────────────
    function _boot(userId) {
        _injectBannerCSS();
        _createBannerEl();
        setTimeout(() => _runBootPvpNotifs(userId), 800);
    }

    function _init() {
        // Fallback: player já estava em cache antes do script carregar
        const earlyId = window.currentPlayerData?.id || (function () {
            try { const c = localStorage.getItem('player_data_cache'); if (c) { const p = JSON.parse(c); return p?.data?.id; } } catch {}
            return null;
        })();

        if (earlyId) {
            _boot(earlyId);
            return;
        }

        // Aguarda o evento disparado pelo script.js quando o jogador está pronto
        window.addEventListener('aden_player_ready', function onReady(e) {
            window.removeEventListener('aden_player_ready', onReady);
            const userId = e.detail?.id;
            if (userId) _boot(userId);
        }, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();
