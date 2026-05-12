
(function () {

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
    var _panels    = [];
    var _arrow     = null;
    var _tooltip   = null;
    var _ring      = null;
    var _curTarget = null;
    var _curClickH = null;
    var _observers = [];
    var _recalcTid = null;

    // Z-index: painéis + seta em 10000, acima de tudo no jogo
    var Z = 10000;
    var PAD = 6; // pixels de padding ao redor do alvo

    /* ─────────────────────────────────────────────────────────
       SVG SETA DOURADA PULSANTE
    ───────────────────────────────────────────────────────── */
    var ARROW_SVG = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 84" width="54" height="84">',
        '<defs><filter id="ag" x="-60%" y="-60%" width="220%" height="220%">',
        '<feGaussianBlur stdDeviation="2.5" result="b"/>',
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>',
        '</filter></defs>',
        '<line x1="27" y1="4" x2="27" y2="57" stroke="#FFD700" stroke-width="6"',
        ' stroke-linecap="round" filter="url(#ag)"/>',
        '<polyline points="7,41 27,65 47,41" fill="none" stroke="#FFD700" stroke-width="6"',
        ' stroke-linecap="round" stroke-linejoin="round" filter="url(#ag)"/>',
        '<line x1="27" y1="4" x2="27" y2="57" stroke="rgba(255,255,200,.4)"',
        ' stroke-width="2.5" stroke-linecap="round"/>',
        '</svg>'
    ].join('');

    /* ─────────────────────────────────────────────────────────
       CSS
    ───────────────────────────────────────────────────────── */
    function injectCSS() {
        if (document.getElementById('_atcss')) return;
        var s = document.createElement('style');
        s.id = '_atcss';
        s.textContent = [
            '._atp{position:fixed;z-index:' + Z + ';background:rgba(0,0,0,.82);pointer-events:all;touch-action:pan-y}',
            '#_atar{position:fixed;z-index:' + (Z+1) + ';pointer-events:none;',
            '  animation:_atB .9s ease-in-out infinite;',
            '  filter:drop-shadow(0 0 8px rgba(255,215,0,.8))}',
            '#_atti{position:fixed;z-index:' + (Z+1) + ';pointer-events:none;',
            '  max-width:220px;padding:10px 14px;white-space:pre-line;',
            '  background:linear-gradient(135deg,#1c1200,#0a0700);',
            '  border:1.5px solid #FFD700;border-radius:10px;',
            '  color:#e8e0cc;font-family:Cinzel,serif,sans-serif;',
            '  font-size:.83em;line-height:1.6;text-align:center;',
            '  box-shadow:0 0 28px rgba(255,215,0,.35),0 4px 16px rgba(0,0,0,.6)}',
            '#_atring{position:fixed;z-index:' + (Z+1) + ';pointer-events:none;',
            '  border:3px solid rgba(255,215,0,.9);border-radius:10px;box-sizing:border-box;',
            '  animation:_atP 1.4s ease-in-out infinite}',
            '@keyframes _atB{0%,100%{transform:translateY(0)}50%{transform:translateY(10px)}}',
            '@keyframes _atP{',
            '  0%,100%{box-shadow:0 0 0 2px rgba(255,215,0,.4),0 0 14px rgba(255,215,0,.2)}',
            '  50%    {box-shadow:0 0 0 6px rgba(255,215,0,.8),0 0 36px rgba(255,215,0,.5)}}'
        ].join('\n');
        document.head.appendChild(s);
    }

    /* ─────────────────────────────────────────────────────────
       CRIA ELEMENTOS NA DOM
    ───────────────────────────────────────────────────────── */
    function ensureDOM() {
        injectCSS();

        if (_panels.length === 0) {
            for (var i = 0; i < 4; i++) {
                var p = document.createElement('div');
                p.className = '_atp';
                p.addEventListener('click', blockEv, true);
                // NÃO bloqueia touchstart → permite scroll vertical nos painéis
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
        if (!_ring) {
            _ring = document.createElement('div');
            _ring.id = '_atring';
            document.body.appendChild(_ring);
        }
    }

    function blockEv(e) { e.preventDefault(); e.stopPropagation(); }

    /* ─────────────────────────────────────────────────────────
       4 PAINÉIS — cria o "buraco" em volta do alvo
    ───────────────────────────────────────────────────────── */
    function layoutPanels(r) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var x1 = Math.max(0, r.left   - PAD);
        var y1 = Math.max(0, r.top    - PAD);
        var x2 = Math.min(vw, r.right  + PAD);
        var y2 = Math.min(vh, r.bottom + PAD);

        // top
        setRect(_panels[0], 0, 0, vw, y1);
        // bottom
        setRect(_panels[1], 0, y2, vw, vh - y2);
        // left
        setRect(_panels[2], 0, y1, x1, y2 - y1);
        // right
        setRect(_panels[3], x2, y1, vw - x2, y2 - y1);

        // anel de destaque
        if (_ring) {
            _ring.style.left   = x1 + 'px';
            _ring.style.top    = y1 + 'px';
            _ring.style.width  = (x2 - x1) + 'px';
            _ring.style.height = (y2 - y1) + 'px';
        }
    }

    function setRect(el, left, top, width, height) {
        el.style.left   = left   + 'px';
        el.style.top    = top    + 'px';
        el.style.width  = width  + 'px';
        el.style.height = height + 'px';
    }

    function showPanels() {
        _panels.forEach(function (p) { p.style.display = 'block'; });
        if (_ring) _ring.style.display = 'block';
    }

    function hidePanels() {
        _panels.forEach(function (p) { p.style.display = 'none'; });
        if (_ring) _ring.style.display = 'none';
    }

    /* ─────────────────────────────────────────────────────────
       SETA + TOOLTIP
    ───────────────────────────────────────────────────────── */
    function positionHints(r) {
        var vw  = window.innerWidth;
        var vh  = window.innerHeight;
        var aw = 54, ah = 84, gap = 10, tw = 220, th = 90;
        var cx = r.left + r.width / 2;
        var arTop, tipTop, flip;

        if (r.top > ah + gap + th + 4) {
            arTop  = r.top  - ah - gap - PAD;
            tipTop = arTop  - th - gap;
            flip   = false;
        } else {
            arTop  = r.bottom + gap + PAD;
            tipTop = arTop + ah + gap;
            flip   = true;
        }

        if (_arrow) {
            _arrow.style.left      = Math.max(8, Math.min(vw - aw - 8, cx - aw/2)) + 'px';
            _arrow.style.top       = Math.max(4, arTop) + 'px';
            _arrow.style.transform = flip ? 'scaleY(-1)' : 'none';
        }
        if (_tooltip) {
            _tooltip.style.left = Math.max(8, Math.min(vw - tw - 8, cx - tw/2)) + 'px';
            _tooltip.style.top  = Math.max(4, Math.min(vh - th - 4, tipTop)) + 'px';
        }
    }

    /* ─────────────────────────────────────────────────────────
       RECALC (resize / scroll)
    ───────────────────────────────────────────────────────── */
    function recalc() {
        if (!_curTarget) return;
        var r = _curTarget.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // elemento oculto: não reposiciona
        var vh = window.innerHeight;
        var vw = window.innerWidth;
        // Se o alvo estiver completamente fora da viewport (ex: abaixo do fold),
        // não relayouta os painéis — evita o painel superior cobrir a tela toda.
        if (r.top > vh || r.bottom < 0 || r.left > vw || r.right < 0) return;
        layoutPanels(r);
        positionHints(r);
    }

    /* ─────────────────────────────────────────────────────────
       showStep — exibe uma etapa do tutorial
       opts.noOverlay: true = sem painéis bloqueadores
         (etapas onde modal/menu do jogo já cobre a tela)
    ───────────────────────────────────────────────────────── */
    function showStep(el, text, onClicked, opts) {
        opts = opts || {};
        ensureDOM();

        // Remove listener do passo anterior
        if (_curClickH && _curTarget) {
            _curTarget.removeEventListener('click',    _curClickH, true);
            _curTarget.removeEventListener('touchend', _curClickH, true);
        }
        if (_recalcTid) { clearInterval(_recalcTid); _recalcTid = null; }
        window.removeEventListener('resize', recalc);
        window.removeEventListener('scroll', recalc);

        _curTarget = el;
        if (_tooltip) _tooltip.textContent = text;

        var r = el.getBoundingClientRect();

        if (opts.noOverlay) {
            hidePanels();
        } else {
            layoutPanels(r);
            showPanels();
        }
        positionHints(r);

        // Recalcula periodicamente
        _recalcTid = setInterval(recalc, 500);
        window.addEventListener('resize', recalc, { passive: true });
        window.addEventListener('scroll', recalc, { passive: true });

        _curClickH = function () {
            clearInterval(_recalcTid);
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
        if (_recalcTid) { clearInterval(_recalcTid); _recalcTid = null; }
        window.removeEventListener('resize', recalc);
        window.removeEventListener('scroll', recalc);

        if (_curClickH && _curTarget) {
            _curTarget.removeEventListener('click',    _curClickH, true);
            _curTarget.removeEventListener('touchend', _curClickH, true);
        }

        _panels.forEach(function (p) { try { p.remove(); } catch(e) {} });
        _panels = [];
        if (_ring)    { try { _ring.remove();    } catch(e) {} _ring    = null; }
        if (_arrow)   { try { _arrow.remove();   } catch(e) {} _arrow   = null; }
        if (_tooltip) { try { _tooltip.remove(); } catch(e) {} _tooltip = null; }
        _curClickH = null;
        _curTarget = null;
    }

    /* ─────────────────────────────────────────────────────────
       OBSERVERS
    ───────────────────────────────────────────────────────── */
    function addObs(o) { _observers.push(o); }
    function cancelObs() {
        _observers.forEach(function (o) { try { o.disconnect(); } catch(e) {} });
        _observers = [];
    }

    /* ─────────────────────────────────────────────────────────
       POLL
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

    /* ─────────────────────────────────────────────────────────
       waitCustomAlertClose
       Aguarda o #customAlertModal fechar (jogador clicou OK)
       antes de disparar o callback.
    ───────────────────────────────────────────────────────── */
    function waitCustomAlertClose(callback) {
        var alertModal = document.getElementById('customAlertModal');
        if (!alertModal || getComputedStyle(alertModal).display === 'none') {
            setTimeout(callback, 300);
            return;
        }

        var safetyTid = null; // declarado antes de ser usado no observer

        var obsAlert = new MutationObserver(function () {
            if (getComputedStyle(alertModal).display === 'none') {
                obsAlert.disconnect();
                if (safetyTid) clearTimeout(safetyTid);
                setTimeout(callback, 300);
            }
        });
        obsAlert.observe(alertModal, { attributes: true, attributeFilter: ['style'] });
        addObs(obsAlert);

        safetyTid = setTimeout(function () {
            obsAlert.disconnect();
            callback();
        }, 30000);
    }

    /* ═══════════════════════════════════════════════════════════
       PASSOS — index.html
    ═══════════════════════════════════════════════════════════ */

    function step1_Bolsa() {
        poll(function () {
            var el = document.querySelector('[data-modal="bolsaModal"]');
            return (el && el.offsetParent) ? el : null;
        }).then(function (el) {
            showStep(
                el,
                '⚔️ Você ganhou uma espada inicial!\nAbra sua Bolsa para equipá-la.',
                function () {
                    setStep('2');
                    destroy();
                    // navegação para inventory.html ocorre pelo handler original do jogo
                }
            );
        }).catch(function () {});
    }

    function step6_Opcoes() {
        poll(function () {
            var el = document.getElementById('maisBtnFooter');
            return (el && el.offsetParent) ? el : null;
        }).then(function (el) {
            showStep(
                el,
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
            if (!sub || getComputedStyle(sub).display === 'none') return null;
            var btns = sub.querySelectorAll('.footer-submenu-btn');
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].textContent.indexOf('Tutorial') !== -1) return btns[i];
            }
            return null;
        }, 200, 8000).then(function (el) {
            showStep(
                el,
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

    function findSwordCard() {
        var grid = document.getElementById('bagItemsGrid');
        if (!grid) return null;

        // 1. Via allInventoryItems global (item_id === 1, desequipada)
        var items = window.allInventoryItems;
        if (items && items.length > 0) {
            for (var i = 0; i < items.length; i++) {
                var itm   = items[i];
                var defId = itm.item_id || (itm.items && itm.items.id);
                if (defId == 1 && itm.equipped_slot === null && (itm.quantity || 0) > 0) {
                    var card = grid.querySelector('[data-inventory-item-id="' + itm.id + '"]');
                    if (card) return card;
                }
            }
        }

        // 2. Via src/alt da imagem
        var cards = grid.querySelectorAll('.inventory-item[data-inventory-item-id]');
        for (var j = 0; j < cards.length; j++) {
            var img = cards[j].querySelector('img');
            if (!img) continue;
            var txt = ((img.src || '') + ' ' + (img.alt || '')).toLowerCase();
            if (txt.indexOf('espada') !== -1 || txt.indexOf('sword') !== -1) return cards[j];
        }

        // 3. Fallback: primeiro card
        return grid.querySelector('.inventory-item[data-inventory-item-id]') || null;
    }

    function step2_Sword() {
        var done = false;
        var pid  = null;
        var obsGrid = null;
        var obsModal = null;
        var origRenderUI = null;

        // Encerra TUDO. Chamado quando o usuário tocou a espada (modal abriu)
        // ou o passo mudou externamente.
        var cleanup = function () {
            if (done) return;
            done = true;
            if (pid) { clearInterval(pid); pid = null; }
            if (obsGrid)  { obsGrid.disconnect();  obsGrid  = null; }
            if (obsModal) { obsModal.disconnect(); obsModal = null; }
            if (origRenderUI && typeof origRenderUI === 'function') {
                window.renderUI = origRenderUI;
                origRenderUI = null;
            }
        };

        // Avança para o passo 3. Única saída de sucesso do step2.
        var advance = function () {
            if (done) return;
            cleanup();
            setStep('3');
            destroy();
            setTimeout(step3_Equipar, 150);
        };

        // ── Detector primário: itemDetailsModal abre ──────────────────────────
        // Independe de qual elemento exato o usuário tocou. Se o modal da espada
        // abre, é prova suficiente de que o usuário inspecionou o item.
        var checkModal = function () {
            if (done || getStep() !== '2') { cleanup(); return; }
            var modal = document.getElementById('itemDetailsModal');
            if (modal && getComputedStyle(modal).display !== 'none') {
                advance();
            }
        };

        var modal = document.getElementById('itemDetailsModal');
        if (modal) {
            obsModal = new MutationObserver(checkModal);
            obsModal.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
            addObs(obsModal);
        }

        // ── Spotlight visual: mostra onde está a espada ───────────────────────
        var stopPolling = function () {
            if (pid) { clearInterval(pid); pid = null; }
            if (obsGrid)  { obsGrid.disconnect();  obsGrid  = null; }
        };

        var tryShow = function () {
            if (done || getStep() !== '2') { cleanup(); return true; }

            // Antes de exibir o spotlight, já verifica se o modal abriu
            // (pode ter acontecido entre ciclos de polling)
            checkModal();
            if (done) return true;

            var card = findSwordCard();
            if (!card) return false;
            var r = card.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;

            stopPolling();

            // Listener de clique no card como reforço ao obsModal.
            // Se o card correto for encontrado e clicado, avança imediatamente
            // sem esperar o MutationObserver do modal.
            showStep(
                card,
                '⚔️ Esta é sua Espada de Ferro!\nToque nela para inspecioná-la.',
                function () { advance(); }
            );
            return true;
        };

        // Tentativa imediata
        if (tryShow()) return;

        // Hook em window.renderUI — sobrevive a re-renders do grid
        origRenderUI = window.renderUI;
        if (typeof origRenderUI === 'function') {
            window.renderUI = function () {
                var result = origRenderUI.apply(this, arguments);
                if (!done && getStep() === '2') setTimeout(tryShow, 60);
                return result;
            };
        }

        // MutationObserver no grid
        var grid = document.getElementById('bagItemsGrid');
        if (grid) {
            obsGrid = new MutationObserver(function () {
                if (!done && getStep() === '2') setTimeout(tryShow, 60);
            });
            obsGrid.observe(grid, { childList: true });
            addObs(obsGrid);
        }

        // Polling de segurança (16 s)
        pid = setInterval(function () {
            if (tryShow()) clearInterval(pid);
        }, 375);
    }

    function step3_Equipar() {
        var pid3 = null;
        var obs3 = null;

        var tryShow = function () {
            if (getStep() !== '3') {
                if (pid3) clearInterval(pid3);
                if (obs3) obs3.disconnect();
                return true;
            }
            var modal = document.getElementById('itemDetailsModal');
            if (!modal || getComputedStyle(modal).display === 'none') return false;
            var btn = document.getElementById('equipBtnModal');
            if (!btn || getComputedStyle(btn).display === 'none' || !btn.textContent.trim()) return false;

            if (pid3) clearInterval(pid3);
            if (obs3) obs3.disconnect();

            showStep(
                btn,
                '✅ Agora toque em "Equipar"\npara usar sua espada!',
                function () {
                    setStep('4');
                    destroy();
                    // Aguarda 600 ms para o jogo abrir o modal de sucesso antes de observá-lo.
                    // Sem esse delay, waitCustomAlertClose detecta o modal fechado prematuramente
                    // e avança o tutorial antes do modal aparecer, causando conflito de overlay.
                    setTimeout(function () {
                        waitCustomAlertClose(step4_Hamburger);
                    }, 600);
                },
                { noOverlay: true }
            );
            return true;
        };

        if (tryShow()) return;

        var modal = document.getElementById('itemDetailsModal');
        if (modal) {
            obs3 = new MutationObserver(function () {
                if (tryShow()) { if (obs3) obs3.disconnect(); }
            });
            obs3.observe(modal, { attributes: true, attributeFilter: ['style'] });
            addObs(obs3);
        }

        pid3 = setInterval(function () {
            if (tryShow()) clearInterval(pid3);
        }, 300);
    }

    function step4_Hamburger() {
        var btn = document.getElementById('menuToggleBtn');
        if (!btn) return;
        showStep(
            btn,
            '☰ Ótimo! Agora abra\no menu lateral.',
            function () {
                setStep('5');
                destroy();
                setTimeout(step5_TelaInicial, 400);
            }
        );
    }

    function step5_TelaInicial() {
        // Busca o link "Tela inicial" pelo texto da <span> (href resolves to full URL no browser)
        var findLink = function () {
            var menu = document.getElementById('leftSideMenu');
            if (!menu || !menu.classList.contains('open')) return null;
            var links = menu.querySelectorAll('a.menu-link');
            for (var i = 0; i < links.length; i++) {
                var span = links[i].querySelector('span');
                if (span && span.textContent.trim() === 'Tela inicial') return links[i];
            }
            return null;
        };

        var pid5 = null;
        var obs5 = null;

        var tryShow = function () {
            if (getStep() !== '5') {
                if (pid5) clearInterval(pid5);
                if (obs5) obs5.disconnect();
                return true;
            }
            var link = findLink();
            if (!link) return false;

            if (pid5) clearInterval(pid5);
            if (obs5) obs5.disconnect();

            showStep(
                link,
                '🏠 Toque em "Tela inicial"\npara voltar.',
                function () {
                    setStep('6');
                    destroy();
                }
                // Sem noOverlay: os painéis criam o "spotlight" em volta de "Tela inicial",
                // evitando que a seta apareça na posição visual do 3º item do menu.
            );
            return true;
        };

        if (tryShow()) return;

        var menu = document.getElementById('leftSideMenu');
        if (menu) {
            obs5 = new MutationObserver(function () {
                if (tryShow()) { if (obs5) obs5.disconnect(); }
            });
            obs5.observe(menu, { attributes: true, attributeFilter: ['class'] });
            addObs(obs5);
        }

        pid5 = setInterval(function () {
            if (tryShow()) clearInterval(pid5);
        }, 200);
    }

    /* ═══════════════════════════════════════════════════════════
       BOOT — detecta a página e entra no passo correto
    ═══════════════════════════════════════════════════════════ */
    function boot() {
        if (isDone()) return;
        var step = getStep();
        if (!step) return;

        // Detecta página pelo pathname + elementos de assinatura
        var path = window.location.pathname;
        var onInventory = (path.indexOf('inventory') !== -1)
                       || (!!document.getElementById('bagSection'))
                       || (!!document.getElementById('bagItemsGrid'));

        var onIndex = !onInventory && (
            path === '/' ||
            path.endsWith('index.html') ||
            path.endsWith('/') ||
            !!document.getElementById('footerMenu') ||
            !!document.querySelector('[data-modal="bolsaModal"]')
        );

        if (onIndex) {
            // IMPORTANTE: usar var + atribuição, NÃO function declaration dentro de bloco
            // (function declaration em bloco causa erro em Firefox com strict mode)
            var indexStep = null;
            if (step === '1') indexStep = step1_Bolsa;
            if (step === '6') indexStep = step6_Opcoes;

            if (indexStep) {
                var firedIndex = false;
                var doIndexStep = function () {
                    if (firedIndex) return;
                    firedIndex = true;
                    indexStep();
                };
                // Escuta evento disparado pelo script.js quando o player está pronto
                window.addEventListener('aden_player_ready', doIndexStep, { once: true });
                // Fallbacks escalonados caso o evento já tenha disparado
                setTimeout(doIndexStep, 3000);
                setTimeout(doIndexStep, 7000);
            }
        }

        if (onInventory) {
            var invStep = null;
            if (step === '2') invStep = step2_Sword;
            if (step === '3') invStep = step3_Equipar;
            if (step === '4') invStep = step4_Hamburger;
            if (step === '5') invStep = step5_TelaInicial;

            if (invStep) {
                // Delay para auth + cache do inventário inicializarem
                setTimeout(invStep, 800);
            }
        }
    }

    /* ═══════════════════════════════════════════════════════════
       API PÚBLICA
    ═══════════════════════════════════════════════════════════ */
    window.AdenTutorial = {
        /** Chamado pelo perfil_edit.js após o primeiro save. */
        startOnboarding: function () {
            setStep('1');
            step1_Bolsa();
        },
        getStep: getStep,
        setStep: setStep,
        isDone:  isDone,
        /** Reseta o tutorial (use no console para testar). */
        reset: function () {
            localStorage.removeItem(LSKEY);
            destroy();
            console.log('[AdenTutorial] resetado. Chame AdenTutorial.startOnboarding() para reiniciar.');
        }
    };

    /* ─────────────────────────────────────────────────────────
       AUTO-BOOT
    ───────────────────────────────────────────────────────── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

})();
