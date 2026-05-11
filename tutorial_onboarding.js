
(function () {
    'use strict';

    /* ─────────────────────────────────────────────────────────
       ESTADO
    ───────────────────────────────────────────────────────── */
    var LSKEY   = 'aden_tutorial_step';
    var getStep = function () { return localStorage.getItem(LSKEY) || ''; };
    var setStep = function (v) { localStorage.setItem(LSKEY, v); };
    var isDone  = function () { return getStep() === 'done'; };

    /* ─────────────────────────────────────────────────────────
       HANDLES GLOBAIS
    ───────────────────────────────────────────────────────── */
    var _panels    = [];   // 4 divs do spotlight
    var _arrow     = null;
    var _tooltip   = null;
    var _curTarget = null;
    var _curClickH = null;
    var _observers = [];
    var _resizeObs = null;

    /*
      Z do tutorial: bem alto para cobrir o jogo.
      Os painéis e seta ficam ACIMA de tudo,
      mas o buraco entre os painéis expõe o elemento original
      que é clicável no seu próprio z-index.

      Maior z-index do jogo:
        leftSideMenu: 9999
        sideMenuOverlay: 9998
      Tutorial: 10000 (painéis + seta + tooltip)
      Exceção — passos noOverlay (3, 5): painéis ocultos,
        seta/tooltip em 10000 mesmo assim.
    */
    var Z = 10000;

    /* ─────────────────────────────────────────────────────────
       SVG SETA DOURADA
    ───────────────────────────────────────────────────────── */
    var ARROW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 84" width="54" height="84">'
        + '<defs><filter id="ag" x="-60%" y="-60%" width="220%" height="220%">'
        + '<feGaussianBlur stdDeviation="2.5" result="b"/>'
        + '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
        + '</filter></defs>'
        + '<line x1="27" y1="4" x2="27" y2="57" stroke="#FFD700" stroke-width="6" stroke-linecap="round" filter="url(#ag)"/>'
        + '<polyline points="7,41 27,65 47,41" fill="none" stroke="#FFD700" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" filter="url(#ag)"/>'
        + '<line x1="27" y1="4" x2="27" y2="57" stroke="rgba(255,255,200,.4)" stroke-width="2.5" stroke-linecap="round"/>'
        + '</svg>';

    /* ─────────────────────────────────────────────────────────
       CSS
    ───────────────────────────────────────────────────────── */
    function injectCSS() {
        if (document.getElementById('_atcss')) return;
        var s = document.createElement('style');
        s.id = '_atcss';
        s.textContent = [
            /* Painéis bloqueadores — fundo escuro sem transparência de pointer */
            '._atp{',
            '  position:fixed;z-index:' + Z + ';',
            '  background:rgba(0,0,0,.82);',
            '  pointer-events:all;',
            '}',
            /* Seta */
            '#_atar{',
            '  position:fixed;z-index:' + (Z+1) + ';',
            '  pointer-events:none;',
            '  animation:_atB .9s ease-in-out infinite;',
            '  filter:drop-shadow(0 0 8px rgba(255,215,0,.8));',
            '}',
            /* Tooltip */
            '#_atti{',
            '  position:fixed;z-index:' + (Z+1) + ';',
            '  pointer-events:none;',
            '  max-width:220px;',
            '  padding:10px 14px;',
            '  background:linear-gradient(135deg,#1c1200,#0a0700);',
            '  border:1.5px solid #FFD700;',
            '  border-radius:10px;',
            '  color:#e8e0cc;',
            '  font-family:Cinzel,serif,sans-serif;',
            '  font-size:.83em;line-height:1.6;',
            '  text-align:center;',
            '  box-shadow:0 0 28px rgba(255,215,0,.35),0 4px 16px rgba(0,0,0,.6);',
            '  white-space:pre-line;',
            '}',
            /* Borda dourada pulsante no alvo — via ::after do painel de destaque */
            '#_at_ring{',
            '  position:fixed;z-index:' + (Z+1) + ';',
            '  pointer-events:none;',
            '  border:3px solid rgba(255,215,0,.9);',
            '  border-radius:10px;',
            '  animation:_atP 1.4s ease-in-out infinite;',
            '  box-sizing:border-box;',
            '}',
            '@keyframes _atB{0%,100%{transform:translateY(0)}50%{transform:translateY(10px)}}',
            '@keyframes _atP{',
            '  0%,100%{box-shadow:0 0 0 2px rgba(255,215,0,.4),0 0 14px rgba(255,215,0,.2)}',
            '  50%    {box-shadow:0 0 0 6px rgba(255,215,0,.8),0 0 36px rgba(255,215,0,.5)}',
            '}'
        ].join('\n');
        document.head.appendChild(s);
    }

    /* ─────────────────────────────────────────────────────────
       CRIA OS ELEMENTOS DO TUTORIAL
    ───────────────────────────────────────────────────────── */
    function ensureDOM() {
        injectCSS();

        // 4 painéis: top, bottom, left, right
        if (_panels.length === 0) {
            for (var i = 0; i < 4; i++) {
                var p = document.createElement('div');
                p.className = '_atp';
                // Bloqueia qualquer clique nos painéis
                p.addEventListener('click',      function (e) { e.preventDefault(); e.stopPropagation(); }, true);
                p.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); }, { capture: true, passive: false });
                document.body.appendChild(p);
                _panels.push(p);
            }
        }

        if (!_arrow) {
            _arrow = document.createElement('div');
            _arrow.id = '_atar';
            _arrow.innerHTML = ARROW_SVG;
            document.body.appendChild(_arrow);
        }

        if (!_tooltip) {
            _tooltip = document.createElement('div');
            _tooltip.id = '_atti';
            document.body.appendChild(_tooltip);
        }

        // Anel de destaque
        if (!document.getElementById('_at_ring')) {
            var ring = document.createElement('div');
            ring.id = '_at_ring';
            document.body.appendChild(ring);
        }
    }

    /* ─────────────────────────────────────────────────────────
       POSICIONA OS 4 PAINÉIS em volta do rect do alvo
       Cria um "buraco" exato sobre o elemento.
    ───────────────────────────────────────────────────────── */
    var PAD = 6; // padding extra ao redor do alvo (px)

    function layoutPanels(r) {
        // r = DOMRect do alvo
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var x1 = Math.max(0, r.left   - PAD);
        var y1 = Math.max(0, r.top    - PAD);
        var x2 = Math.min(vw, r.right  + PAD);
        var y2 = Math.min(vh, r.bottom + PAD);

        var s = _panels[0].style; // top
        s.left = '0'; s.top = '0'; s.width = vw + 'px'; s.height = y1 + 'px';

        s = _panels[1].style;     // bottom
        s.left = '0'; s.top = y2 + 'px'; s.width = vw + 'px'; s.height = (vh - y2) + 'px';

        s = _panels[2].style;     // left
        s.left = '0'; s.top = y1 + 'px'; s.width = x1 + 'px'; s.height = (y2 - y1) + 'px';

        s = _panels[3].style;     // right
        s.left = x2 + 'px'; s.top = y1 + 'px'; s.width = (vw - x2) + 'px'; s.height = (y2 - y1) + 'px';

        // Anel de destaque
        var ring = document.getElementById('_at_ring');
        if (ring) {
            ring.style.left   = x1 + 'px';
            ring.style.top    = y1 + 'px';
            ring.style.width  = (x2 - x1) + 'px';
            ring.style.height = (y2 - y1) + 'px';
        }
    }

    function showPanels()  { _panels.forEach(function (p) { p.style.display = 'block'; }); var r = document.getElementById('_at_ring'); if (r) r.style.display = 'block'; }
    function hidePanels()  { _panels.forEach(function (p) { p.style.display = 'none';  }); var r = document.getElementById('_at_ring'); if (r) r.style.display = 'none';  }

    /* ─────────────────────────────────────────────────────────
       POSICIONAMENTO DA SETA E TOOLTIP
    ───────────────────────────────────────────────────────── */
    function positionHints(r) {
        var vw  = window.innerWidth;
        var vh  = window.innerHeight;
        var aw  = 54, ah = 84, gap = 10, tw = 220, th = 90;
        var cx  = r.left + r.width / 2;
        var arTop, tipTop, flip;

        if (r.top > ah + gap + th + 4) {
            arTop  = r.top - ah - gap - PAD;
            tipTop = arTop - th - gap;
            flip   = false;
        } else {
            arTop  = r.bottom + gap + PAD;
            tipTop = arTop + ah + gap;
            flip   = true;
        }

        _arrow.style.left      = Math.max(8, Math.min(vw - aw - 8, cx - aw / 2)) + 'px';
        _arrow.style.top       = Math.max(4, arTop) + 'px';
        _arrow.style.transform = flip ? 'scaleY(-1)' : 'none';

        _tooltip.style.left = Math.max(8, Math.min(vw - tw - 8, cx - tw / 2)) + 'px';
        _tooltip.style.top  = Math.max(4, Math.min(vh - th - 4, tipTop)) + 'px';
    }

    /* ─────────────────────────────────────────────────────────
       RECALCULA posição quando a janela redimensiona / scroll
       — ignora se o elemento ficou fora da viewport (0x0)
    ───────────────────────────────────────────────────────── */
    function recalc() {
        if (!_curTarget) return;
        var r = _curTarget.getBoundingClientRect();
        // Elemento oculto ou fora da viewport → não reposiciona
        if (r.width === 0 && r.height === 0) return;
        layoutPanels(r);
        positionHints(r);
    }

    /* ─────────────────────────────────────────────────────────
       API CENTRAL — showStep
       opts.noOverlay: true → painéis ocultos
                       (passo 3: modal do jogo; passo 5: sidemenu já visível)
    ───────────────────────────────────────────────────────── */
    function showStep(el, text, onClicked, opts) {
        opts = opts || {};
        ensureDOM();

        // Remove listener anterior
        if (_curClickH && _curTarget) {
            _curTarget.removeEventListener('click',    _curClickH, true);
            _curTarget.removeEventListener('touchend', _curClickH, true);
        }
        // Para observador de resize anterior
        if (_resizeObs) { clearInterval(_resizeObs); _resizeObs = null; }

        _curTarget = el;
        _tooltip.textContent = text;

        var r = el.getBoundingClientRect();

        if (opts.noOverlay) {
            hidePanels();
        } else {
            layoutPanels(r);
            showPanels();
        }

        positionHints(r);

        // Recalcula periodicamente (para elementos que animam ou mudam de posição)
        _resizeObs = setInterval(recalc, 400);
        window.addEventListener('resize', recalc, { passive: true });
        window.addEventListener('scroll', recalc, { passive: true });

        _curClickH = function () {
            clearInterval(_resizeObs);
            window.removeEventListener('resize', recalc);
            window.removeEventListener('scroll', recalc);
            if (onClicked) onClicked();
        };
        el.addEventListener('click',    _curClickH, { capture: true, once: true });
        el.addEventListener('touchend', _curClickH, { capture: true, once: true, passive: true });
    }

    /* ─────────────────────────────────────────────────────────
       DESTROY
    ───────────────────────────────────────────────────────── */
    function destroy() {
        cancelObs();
        if (_resizeObs) { clearInterval(_resizeObs); _resizeObs = null; }
        window.removeEventListener('resize', recalc);
        window.removeEventListener('scroll', recalc);

        if (_curClickH && _curTarget) {
            _curTarget.removeEventListener('click',    _curClickH, true);
            _curTarget.removeEventListener('touchend', _curClickH, true);
        }

        _panels.forEach(function (p) { p.remove(); });
        _panels = [];
        var ring = document.getElementById('_at_ring');
        if (ring) ring.remove();
        if (_arrow)   { _arrow.remove();   _arrow   = null; }
        if (_tooltip) { _tooltip.remove(); _tooltip = null; }
        _curClickH = null;
        _curTarget = null;
    }

    /* ─────────────────────────────────────────────────────────
       OBSERVERS
    ───────────────────────────────────────────────────────── */
    function addObs(o)   { _observers.push(o); }
    function cancelObs() {
        _observers.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
        _observers = [];
    }

    /* ─────────────────────────────────────────────────────────
       POLL simples
    ───────────────────────────────────────────────────────── */
    function poll(fn, interval, timeout) {
        interval = interval || 350;
        timeout  = timeout  || 16000;
        return new Promise(function (res, rej) {
            var t0 = Date.now();
            var tid = setInterval(function () {
                var r = fn();
                if (r) { clearInterval(tid); res(r); return; }
                if (Date.now() - t0 > timeout) { clearInterval(tid); rej(); }
            }, interval);
        });
    }

    /* ═══════════════════════════════════════════════════════════
       PASSOS — index.html
    ═══════════════════════════════════════════════════════════ */

    function step1_Bolsa() {
        poll(function () {
            var el = document.querySelector('[data-modal="bolsaModal"]');
            // Verifica que é visível na tela (offsetParent ≠ null)
            return (el && el.offsetParent) ? el : null;
        }).then(function (el) {
            showStep(el,
                '⚔️ Você ganhou uma espada inicial!\nAbra sua Bolsa para equipá-la.',
                function () {
                    setStep('2');
                    destroy();
                    // O handler original do jogo navega para inventory.html
                }
            );
        }).catch(function () {});
    }

    function step6_Opcoes() {
        poll(function () {
            var el = document.getElementById('maisBtnFooter');
            return (el && el.offsetParent) ? el : null;
        }).then(function (el) {
            showStep(el,
                '📋 Quase lá! Abra o menu de Opções.',
                function () {
                    setStep('7');
                    destroy();
                    setTimeout(step7_Tutorial, 700);
                }
            );
        }).catch(function () {});
    }

    function step7_Tutorial() {
        poll(function () {
            var sub = document.getElementById('maisSubmenu');
            if (!sub) return null;
            if (getComputedStyle(sub).display === 'none') return null;
            var btns = sub.querySelectorAll('.footer-submenu-btn');
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].textContent.indexOf('Tutorial') !== -1) return btns[i];
            }
            return null;
        }, 200, 8000).then(function (el) {
            showStep(el,
                '📖 Aqui fica o Tutorial completo!\nParabéns, Aventureiro(a)! 🎉',
                function () {
                    setStep('done');
                    destroy();
                }
            );
        }).catch(function () {});
    }

    /* ═══════════════════════════════════════════════════════════
       PASSOS — inventory.html
    ═══════════════════════════════════════════════════════════ */

    /* Localiza o card da Espada de Ferro na bagItemsGrid */
    function findSwordCard() {
        var grid = document.getElementById('bagItemsGrid');
        if (!grid) return null;

        // 1. Via allInventoryItems global (item_id === 1, desequipada)
        var items = window.allInventoryItems;
        if (items && items.length > 0) {
            for (var i = 0; i < items.length; i++) {
                var itm  = items[i];
                var defId = itm.item_id;
                if (!defId && itm.items) defId = itm.items.id;
                if (defId == 1 && itm.equipped_slot === null && (itm.quantity || 0) > 0) {
                    var card = grid.querySelector('[data-inventory-item-id="' + itm.id + '"]');
                    if (card) return card;
                }
            }
        }

        // 2. Via src/alt da imagem do card
        var cards = grid.querySelectorAll('.inventory-item[data-inventory-item-id]');
        for (var j = 0; j < cards.length; j++) {
            var img = cards[j].querySelector('img');
            if (!img) continue;
            var txt = ((img.src || '') + ' ' + (img.alt || '')).toLowerCase();
            if (txt.indexOf('espada') !== -1 || txt.indexOf('sword') !== -1) return cards[j];
        }

        // 3. Primeiro card de equipamento (fallback)
        return grid.querySelector('.inventory-item[data-inventory-item-id]') || null;
    }

    function step2_Sword() {
        var _pid    = null;   // polling interval
        var _obs    = null;   // MutationObserver
        var _done   = false;  // garante que só exibe uma vez

        function stopAll(origRenderUI) {
            _done = true;
            if (_pid) { clearInterval(_pid); _pid = null; }
            if (_obs) { _obs.disconnect(); _obs = null; }
            // restaura renderUI ao original
            if (origRenderUI && window.renderUI !== origRenderUI) {
                window.renderUI = origRenderUI;
            }
        }

        function tryShow(origRenderUI) {
            if (_done || getStep() !== '2') { stopAll(origRenderUI); return true; }
            var card = findSwordCard();
            if (!card) return false;
            var r = card.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false; // ainda não visível

            stopAll(origRenderUI); // para todos os mecanismos de busca ANTES de exibir

            showStep(card,
                '⚔️ Esta é sua Espada de Ferro!\nToque nela para inspecioná-la.',
                function () {
                    setStep('3');
                    destroy();
                    setTimeout(step3_Equipar, 350);
                }
            );
            return true;
        }

        // Tentativa imediata
        if (tryShow(window.renderUI)) return;

        // Hook em window.renderUI (exposto pelo inventory.js linha 1524)
        var orig = window.renderUI;
        if (typeof orig === 'function') {
            window.renderUI = function () {
                var r = orig.apply(this, arguments);
                // Restaura antes de tentar para evitar recursão
                window.renderUI = orig;
                if (!_done && getStep() === '2') {
                    setTimeout(function () { tryShow(orig); }, 60);
                }
                return r;
            };
        }

        // MutationObserver na grid (detecta quando itens são inseridos)
        var grid = document.getElementById('bagItemsGrid');
        if (grid) {
            _obs = new MutationObserver(function () {
                if (tryShow(orig)) _obs && _obs.disconnect();
            });
            _obs.observe(grid, { childList: true });
            addObs(_obs);
        }

        // Polling de segurança (15 s)
        _pid = setInterval(function () {
            if (tryShow(orig)) clearInterval(_pid);
        }, 375);
    }

    function step3_Equipar() {
        /*
         * #itemDetailsModal z-index 1000 < nossos painéis (10000).
         * noOverlay: true — o modal do jogo já cobre a tela.
         */
        function tryShow() {
            if (getStep() !== '3') return true;
            var modal = document.getElementById('itemDetailsModal');
            if (!modal || getComputedStyle(modal).display === 'none') return false;
            var btn = document.getElementById('equipBtnModal');
            if (!btn || getComputedStyle(btn).display === 'none' || !btn.textContent.trim()) return false;

            showStep(btn,
                '✅ Agora toque em "Equipar"\npara usar sua espada!',
                function () {
                    setStep('4');
                    destroy();
                    // Após equipar, o jogo abre #customAlertModal ("Item equipado com sucesso.")
                    // Esperamos o jogador clicar OK nesse modal antes de avançar.
                    waitCustomAlertClose(step4_Hamburger);
                },
                { noOverlay: true }
            );
            return true;
        }

        if (tryShow()) return;

        var modal = document.getElementById('itemDetailsModal');
        if (modal) {
            var obs2 = new MutationObserver(function () {
                if (getStep() !== '3') { obs2.disconnect(); return; }
                if (tryShow()) obs2.disconnect();
            });
            obs2.observe(modal, { attributes: true, attributeFilter: ['style'] });
            addObs(obs2);
        }

        var pid3 = setInterval(function () {
            if (getStep() !== '3') { clearInterval(pid3); return; }
            if (tryShow()) clearInterval(pid3);
        }, 300);
    }

    /*
     * Aguarda o #customAlertModal ser fechado pelo jogador (clique em OK),
     * depois chama callback. Timeout de segurança: 30 s.
     */
    function waitCustomAlertClose(callback) {
        var alertModal = document.getElementById('customAlertModal');

        // Se o modal não existir ou já estiver fechado, avança imediatamente
        if (!alertModal || getComputedStyle(alertModal).display === 'none') {
            setTimeout(callback, 300);
            return;
        }

        // Observa o display do modal até ele fechar
        var obsAlert = new MutationObserver(function () {
            if (getComputedStyle(alertModal).display === 'none') {
                obsAlert.disconnect();
                clearTimeout(safetyTid);
                setTimeout(callback, 300);
            }
        });
        obsAlert.observe(alertModal, { attributes: true, attributeFilter: ['style'] });
        addObs(obsAlert);

        // Safety timeout: se o jogador demorar demais, avança mesmo assim
        var safetyTid = setTimeout(function () {
            obsAlert.disconnect();
            callback();
        }, 30000);
    }

    function step4_Hamburger() {
        var btn = document.getElementById('menuToggleBtn');
        if (!btn) return;

        showStep(btn,
            '☰ Ótimo! Agora abra\no menu lateral.',
            function () {
                setStep('5');
                destroy();
                setTimeout(step5_TelaInicial, 400);
            }
        );
    }

    function step5_TelaInicial() {
        /*
         * #leftSideMenu z-index 9999 < nossos painéis (10000).
         * noOverlay: true — o menu já cobre visualmente a tela.
         * Seta/tooltip (10001) ficam acima do menu.
         *
         * IMPORTANTE: a.href no DOM vira URL absoluta (https://aden-rpg.pages.dev/index.html),
         * então NÃO usamos [href="index.html"]. Buscamos pelo texto da <span>.
         */
        function findTelaInicialLink() {
            var menu = document.getElementById('leftSideMenu');
            if (!menu || !menu.classList.contains('open')) return null;

            var links = menu.querySelectorAll('a.menu-link');
            for (var i = 0; i < links.length; i++) {
                var span = links[i].querySelector('span');
                if (span && span.textContent.trim() === 'Tela inicial') {
                    return links[i];
                }
            }
            return null;
        }

        function tryShow() {
            if (getStep() !== '5') return true;
            var link = findTelaInicialLink();
            if (!link) return false;

            showStep(link,
                '🏠 Toque em "Tela inicial"\npara voltar.',
                function () {
                    setStep('6');
                    destroy();
                },
                { noOverlay: true }
            );
            return true;
        }

        if (tryShow()) return;

        var menu = document.getElementById('leftSideMenu');
        if (menu) {
            var obs5 = new MutationObserver(function () {
                if (getStep() !== '5') { obs5.disconnect(); return; }
                if (tryShow()) obs5.disconnect();
            });
            obs5.observe(menu, { attributes: true, attributeFilter: ['class'] });
            addObs(obs5);
        }

        var pid5 = setInterval(function () {
            if (getStep() !== '5') { clearInterval(pid5); return; }
            if (tryShow()) clearInterval(pid5);
        }, 200);
    }

    /* ═══════════════════════════════════════════════════════════
       BOOT
    ═══════════════════════════════════════════════════════════ */
    function boot() {
        if (isDone()) return;
        var step = getStep();
        if (!step) return;

        var path = window.location.pathname;

        var onInventory = path.indexOf('inventory') !== -1
            || !!document.getElementById('bagSection')
            || !!document.getElementById('bagItemsGrid');

        var onIndex = !onInventory && (
            path === '/' || path.endsWith('index.html') || path.endsWith('/')
            || !!document.getElementById('footerMenu')
            || !!document.querySelector('[data-modal="bolsaModal"]')
        );

        if (onIndex) {
            var start = step === '1' ? step1_Bolsa : step === '6' ? step6_Opcoes : null;
            if (start) {
                var fired = false;
                function doStart() { if (fired) return; fired = true; start(); }
                window.addEventListener('aden_player_ready', doStart, { once: true });
                setTimeout(doStart, 3000);
                setTimeout(doStart, 6000);
            }
        }

        if (onInventory) {
            var runners = { '2': step2_Sword, '3': step3_Equipar, '4': step4_Hamburger, '5': step5_TelaInicial };
            var run = runners[step];
            if (run) setTimeout(run, 800);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       API PÚBLICA
    ═══════════════════════════════════════════════════════════ */
    window.AdenTutorial = {
        startOnboarding: function () { setStep('1'); step1_Bolsa(); },
        getStep:  getStep,
        setStep:  setStep,
        isDone:   isDone,
        reset:    function () { localStorage.removeItem(LSKEY); destroy(); console.log('[AdenTutorial] resetado'); }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

})();
