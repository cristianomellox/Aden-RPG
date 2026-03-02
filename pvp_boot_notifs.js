
(function () {

    // ── CSS ──────────────────────────────────────────────────────────────
    // Idêntico ao das páginas de região (que não foram enviadas aqui).
    // Injetado uma única vez no <head>.
    function _injectBannerCSS() {
        if (document.getElementById('_pvpBootBannerStyle')) return;
        const style = document.createElement('style');
        style.id = '_pvpBootBannerStyle';
        style.textContent = `
            #huntKillBanner {
                position: fixed;
                top: 16px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 99999;
                background: linear-gradient(135deg, rgba(15,10,30,0.97) 0%, rgba(30,15,50,0.97) 100%);
                border: 1px solid rgba(200,160,80,0.55);
                border-radius: 10px;
                padding: 9px 18px;
                font-size: 0.82em;
                color: #e8d9b0;
                max-width: min(92vw, 480px);
                text-align: center;
                box-shadow: 0 4px 24px rgba(0,0,0,0.7), 0 0 12px rgba(200,100,60,0.18);
                pointer-events: none;
                opacity: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #huntKillBanner.show {
                animation: _pvpBannerIn 4.2s ease forwards;
            }
            @keyframes _pvpBannerIn {
                0%   { opacity: 0; transform: translateX(-50%) translateY(-14px); }
                10%  { opacity: 1; transform: translateX(-50%) translateY(0); }
                75%  { opacity: 1; transform: translateX(-50%) translateY(0); }
                100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
            }
        `;
        document.head.appendChild(style);
    }

    // ── BANNER QUEUE ─────────────────────────────────────────────────────
    // Mesma implementação exata dos scripts de região.
    let _killBannerQueue   = [];
    let _killBannerShowing = false;

    function _createBannerEl() {
        let el = document.getElementById('huntKillBanner');
        if (!el) {
            el = document.createElement('div');
            el.id = 'huntKillBanner';
            document.body.appendChild(el);
        }
        return el;
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
        void el.offsetWidth;                    // force reflow
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
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── LÓGICA PRINCIPAL ─────────────────────────────────────────────────
    async function _runBootPvpNotifs(userId) {
        if (!userId) return;

        // Usa a mesma chave das regiões — eventos marcados aqui
        // serão ignorados quando o jogador abrir uma região.
        const seenKey = `hunt_pvp_seen_${userId}`;
        let seen;
        try { seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]')); }
        catch { seen = new Set(); }

        let events;
        try {
            // Busca exatamente igual às regiões: últimos 5 minutos
            const { data, error } = await supabaseClient.rpc('get_hunt_pvp_events', {
                p_since_minutes: 5
            });
            if (error || !data) return;
            events = data;
        } catch (e) {
            console.warn('[pvp_boot_notifs] Erro ao buscar eventos:', e);
            return;
        }

        if (!Array.isArray(events) || events.length === 0) return;

        let newSeen = false;
        const ALL_REGIONS = {
            floresta_mistica:  { name: 'Floresta Mística' },
            vale_arcano:       { name: 'Vale Arcano' },
            penumbra_uivante:  { name: 'Penumbra Uivante' }
        };

        events.forEach(ev => {
            if (seen.has(ev.id)) return;
            seen.add(ev.id);
            newSeen = true;

            // Mesmo template de texto dos scripts de região
            const regionName = (ALL_REGIONS[ev.region_name]?.name) || esc(ev.region_name);
            const regionLabel = `<span style="color:#8ff">${esc(regionName)}</span>`;

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
                    ? `. <span style="color:#8ff">${esc(ev.defender_name)}</span> já eliminou ` +
                      `<span style="color:#ff8">${ev.defender_kills}</span> hoje!`
                    : '.';
                pushKillNotif(
                    `<span style="color:#f88">${esc(ev.attacker_name)}</span> tentou atacar ` +
                    `<span style="color:#ff8">${esc(ev.defender_name)}</span> em ${regionLabel} e perdeu${dkTxt}`
                );
            }
        });

        // Persiste os IDs vistos — mesma lógica de slice(-200) das regiões
        if (newSeen) {
            try { localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-200))); }
            catch {}
        }
    }

    // ── BOOTSTRAP ────────────────────────────────────────────────────────
    // Aguarda o evento 'aden_player_ready' (disparado pelo script.js ao
    // carregar o jogador) para ter o userId disponível sem custo extra.
    function _init() {
        _injectBannerCSS();

        // Listener para quando o jogador estiver pronto
        window.addEventListener('aden_player_ready', function onReady(e) {
            window.removeEventListener('aden_player_ready', onReady);
            const userId = e.detail?.id;
            if (!userId) return;

            // Pequeno delay para não bloquear o render inicial
            setTimeout(() => {
                _createBannerEl();
                _runBootPvpNotifs(userId);
            }, 800);
        }, { once: true });

        // Fallback: se o player já estava pronto antes do script carregar
        // (cache via GlobalDB dispara o evento muito cedo)
        const existingId = window.currentPlayerData?.id
            || (function () {
                try {
                    const c = localStorage.getItem('player_data_cache');
                    if (c) { const p = JSON.parse(c); return p?.data?.id; }
                } catch {}
                return null;
            })();

        if (existingId) {
            setTimeout(() => {
                _createBannerEl();
                _runBootPvpNotifs(existingId);
            }, 800);
        }
    }

    // Inicia após o DOM estar pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();
