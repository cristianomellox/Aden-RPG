// tutorial_onboarding.js — Aden RPG Online  v2
// ============================================================
// Tutorial de onboarding interativo (estilo spotlight).
// Persiste o progresso em localStorage.
//
// INSTALAÇÃO (obrigatório em AMBAS as páginas):
//   Adicione ANTES do </body> em index.html E em inventory.html:
//   <script src="tutorial_onboarding.js"></script>
//
// O perfil_edit.js chama window.AdenTutorial.startOnboarding()
// automaticamente quando o novo jogador salva o perfil.
// ============================================================

(function () {
    'use strict';

    /* ─────────────────────────────────────────────────────────
       ESTADO (localStorage)
    ───────────────────────────────────────────────────────── */
    var LSKEY   = 'aden_tutorial_step';
    var getStep = function () { return localStorage.getItem(LSKEY) || ''; };
    var setStep = function (v) { localStorage.setItem(LSKEY, v); };
    var isDone  = function () { return getStep() === 'done'; };

    /* ─────────────────────────────────────────────────────────
       HANDLES GLOBAIS
    ───────────────────────────────────────────────────────── */
    var _overlay   = null;
    var _arrow     = null;
    var _tooltip   = null;
    var _raised    = [];
    var _curTarget = null;
    var _curClickH = null;
    var _observers = [];

    /*
       Z-INDEX do jogo (resumo):
         .modal-overlay (inventory): 1000
         #leftSideMenu:              9999
         #sideMenuOverlay:           9998
       Tutorial:
         overlay:    9980  (abaixo de leftSideMenu)
         destaque:  10010  (acima de tudo)
         seta/tip:  10020  (acima de tudo)
    */
    var Z_OV   = 9980;
    var Z_HI   = 10010;
    var Z_ARR  = 10020;

    /* ─────────────────────────────────────────────────────────
       SVG SETA DOURADA PULSANTE
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
        s.textContent = '#_atov{position:fixed;inset:0;z-index:' + Z_OV + ';background:rgba(0,0,0,.82);pointer-events:all}'
            + '#_atar{position:fixed;z-index:' + Z_ARR + ';pointer-events:none;animation:_atB .9s ease-in-out infinite;filter:drop-shadow(0 0 8px rgba(255,215,0,.75))}'
            + '#_atti{position:fixed;z-index:' + Z_ARR + ';pointer-events:none;max-width:220px;padding:10px 14px;background:linear-gradient(135deg,#1c1200,#0a0700);border:1.5px solid #FFD700;border-radius:10px;color:#e8e0cc;font-family:Cinzel,serif,sans-serif;font-size:.83em;line-height:1.6;text-align:center;box-shadow:0 0 28px rgba(255,215,0,.35),0 4px 16px rgba(0,0,0,.6);white-space:pre-line}'
            + '._athi{outline:3px solid rgba(255,215,0,.9)!important;outline-offset:3px;animation:_atP 1.4s ease-in-out infinite}'
            + '@keyframes _atB{0%,100%{transform:translateY(0)}50%{transform:translateY(10px)}}'
            + '@keyframes _atP{0%,100%{box-shadow:0 0 0 3px rgba(255,215,0,.5),0 0 16px rgba(255,215,0,.2)}50%{box-shadow:0 0 0 7px rgba(255,215,0,.85),0 0 40px rgba(255,215,0,.55)}}';
        document.head.appendChild(s);
    }

    /* ─────────────────────────────────────────────────────────
       DOM
    ───────────────────────────────────────────────────────── */
    function ensureDOM() {
        injectCSS();
        if (!_overlay) {
            _overlay = document.createElement('div');
            _overlay.id = '_atov';
            _overlay.addEventListener('click',      function (e) { e.preventDefault(); e.stopPropagation(); }, true);
            _overlay.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); }, { capture:true, passive:false });
            document.body.appendChild(_overlay);
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
    }

    function showOverlay() { if (_overlay) _overlay.style.display = 'block'; }
    function hideOverlay() { if (_overlay) _overlay.style.display = 'none';  }

    /* ─────────────────────────────────────────────────────────
       ELEVAÇÃO DO ALVO
    ───────────────────────────────────────────────────────── */
    function raise(el) {
        deflate();
        _raised.push({ el:el, origPos:el.style.position, origZ:el.style.zIndex });
        el.classList.add('_athi');
        if (!el.style.position) el.style.position = 'relative';
        el.style.zIndex = String(Z_HI);

        var node = el.parentElement;
        while (node && node !== document.documentElement) {
            var cs  = getComputedStyle(node);
            var pos = cs.position;
            var zi  = parseInt(cs.zIndex, 10) || 0;
            if ((pos==='fixed'||pos==='sticky'||pos==='absolute'||pos==='relative') && zi < Z_HI) {
                _raised.push({ el:node, origPos:node.style.position, origZ:node.style.zIndex });
                node.style.zIndex = String(Z_HI - 5);
            }
            node = node.parentElement;
        }
    }

    function deflate() {
        _raised.forEach(function (r) {
            r.el.classList.remove('_athi');
            r.el.style.position = r.origPos;
            r.el.style.zIndex   = r.origZ;
        });
        _raised = [];
    }

    /* ─────────────────────────────────────────────────────────
       POSICIONAMENTO
    ───────────────────────────────────────────────────────── */
    function positionHints(el) {
        var r   = el.getBoundingClientRect();
        var vw  = window.innerWidth;
        var vh  = window.innerHeight;
        var aw  = 54, ah = 84, gap = 10, tw = 220, th = 90;
        var cx  = r.left + r.width / 2;
        var arTop, tipTop, flip;

        if (r.top > ah + gap + th + 4) {
            arTop  = r.top - ah - gap;
            tipTop = arTop - th - gap;
            flip   = false;
        } else {
            arTop  = r.bottom + gap;
            tipTop = arTop + ah + gap;
            flip   = true;
        }

        _arrow.style.cssText += ';left:' + Math.max(8, Math.min(vw-aw-8, cx-aw/2)) + 'px;top:' + Math.max(4,arTop) + 'px;transform:' + (flip?'scaleY(-1)':'none');
        _tooltip.style.cssText += ';left:' + Math.max(8, Math.min(vw-tw-8, cx-tw/2)) + 'px;top:' + Math.max(4, Math.min(vh-th-4, tipTop)) + 'px';
    }

    /* ─────────────────────────────────────────────────────────
       MOSTRA UMA ETAPA
       opts.noOverlay: true = não usa o fundo escuro
                       (passo 3: o modal do jogo já cobre a tela;
                        passo 5: leftSideMenu já está acima do overlay)
    ───────────────────────────────────────────────────────── */
    function showStep(el, text, onClicked, opts) {
        opts = opts || {};
        ensureDOM();

        if (_curClickH && _curTarget) {
            _curTarget.removeEventListener('click',    _curClickH, true);
            _curTarget.removeEventListener('touchend', _curClickH, true);
        }

        if (opts.noOverlay) {
            hideOverlay();
        } else {
            showOverlay();
            raise(el);
        }

        _curTarget = el;
        _tooltip.textContent = text;

        // Reset inline antes de calcular posição
        _arrow.style.cssText   = 'position:fixed;z-index:' + Z_ARR + ';pointer-events:none;animation:_atB .9s ease-in-out infinite;filter:drop-shadow(0 0 8px rgba(255,215,0,.75))';
        _tooltip.style.cssText = 'position:fixed;z-index:' + Z_ARR + ';pointer-events:none;max-width:220px;padding:10px 14px;background:linear-gradient(135deg,#1c1200,#0a0700);border:1.5px solid #FFD700;border-radius:10px;color:#e8e0cc;font-family:Cinzel,serif,sans-serif;font-size:.83em;line-height:1.6;text-align:center;box-shadow:0 0 28px rgba(255,215,0,.35),0 4px 16px rgba(0,0,0,.6);white-space:pre-line';
        positionHints(el);

        _curClickH = function () { if (onClicked) onClicked(); };
        el.addEventListener('click',    _curClickH, { capture:true, once:true });
        el.addEventListener('touchend', _curClickH, { capture:true, once:true, passive:true });
    }

    /* ─────────────────────────────────────────────────────────
       DESTROY
    ───────────────────────────────────────────────────────── */
    function destroy() {
        cancelObs();
        if (_curClickH && _curTarget) {
            _curTarget.removeEventListener('click',    _curClickH, true);
            _curTarget.removeEventListener('touchend', _curClickH, true);
        }
        deflate();
        if (_overlay) { _overlay.remove(); _overlay = null; }
        if (_arrow)   { _arrow.remove();   _arrow   = null; }
        if (_tooltip) { _tooltip.remove(); _tooltip = null; }
        _curClickH = null;
        _curTarget = null;
    }

    /* ─────────────────────────────────────────────────────────
       OBSERVERS
    ───────────────────────────────────────────────────────── */
    function addObs(o)  { _observers.push(o); }
    function cancelObs() {
        _observers.forEach(function (o) { try { o.disconnect(); } catch(e) {} });
        _observers = [];
    }

    /* ─────────────────────────────────────────────────────────
       UTILITÁRIOS
    ───────────────────────────────────────────────────────── */
    function poll(fn, interval, timeout) {
        interval = interval || 350;
        timeout  = timeout  || 16000;
        return new Promise(function (res, rej) {
            var t0  = Date.now();
            var tid = setInterval(function () {
                var r = fn();
                if (r) { clearInterval(tid); res(r); return; }
                if (Date.now() - t0 > timeout) { clearInterval(tid); rej(); }
            }, interval);
        });
    }

    /* ═══════════════════════════════════════════════════════
       PASSOS — INDEX.HTML
    ═══════════════════════════════════════════════════════ */

    function step1_Bolsa() {
        poll(function () {
            var el = document.querySelector('[data-modal="bolsaModal"]');
            return (el && el.offsetParent) ? el : null;
        }).then(function (el) {
            showStep(el,
                '⚔️ Você ganhou uma espada inicial!\nAbra sua Bolsa para equipá-la.',
                function () { setStep('2'); destroy(); }
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
                function () { setStep('7'); destroy(); setTimeout(step7_Tutorial, 700); }
            );
        }).catch(function () {});
    }

    function step7_Tutorial() {
        poll(function () {
            var sub = document.getElementById('maisSubmenu');
            if (!sub) return null;
            var cs = getComputedStyle(sub);
            if (cs.display === 'none') return null;
            var btns = sub.querySelectorAll('.footer-submenu-btn');
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].textContent.indexOf('Tutorial') !== -1) return btns[i];
            }
            return null;
        }, 200, 8000).then(function (el) {
            showStep(el,
                '📖 Aqui fica o Tutorial completo!\nParabéns, Aventureiro(a)! 🎉',
                function () { setStep('done'); destroy(); }
            );
        }).catch(function () {});
    }

    /* ═══════════════════════════════════════════════════════
       PASSOS — INVENTORY.HTML
    ═══════════════════════════════════════════════════════ */

    /* Localiza o card da Espada de Ferro na bagItemsGrid */
    function findSwordCard() {
        var grid = document.getElementById('bagItemsGrid');
        if (!grid) return null;

        // Estratégia 1 — via allInventoryItems (item_id === 1, desequipada)
        var items = window.allInventoryItems;
        if (items && items.length > 0) {
            for (var i = 0; i < items.length; i++) {
                var itm = items[i];
                var defId = itm.item_id;
                // Tenta também via itm.items.id caso o formato mude
                if (!defId && itm.items) defId = itm.items.id;
                if ((defId == 1) && itm.equipped_slot === null && (itm.quantity||0) > 0) {
                    var card = grid.querySelector('[data-inventory-item-id="' + itm.id + '"]');
                    if (card) return card;
                }
            }
        }

        // Estratégia 2 — via src/alt da imagem dentro do card
        var cards = grid.querySelectorAll('.inventory-item[data-inventory-item-id]');
        for (var j = 0; j < cards.length; j++) {
            var img = cards[j].querySelector('img');
            if (!img) continue;
            var txt = ((img.src || '') + ' ' + (img.alt || '')).toLowerCase();
            if (txt.indexOf('espada') !== -1 || txt.indexOf('sword') !== -1) {
                return cards[j];
            }
        }

        // Estratégia 3 — primeiro card de equipamento na grade (fallback)
        return grid.querySelector('.inventory-item[data-inventory-item-id]') || null;
    }

    function step2_Sword() {
        function tryShow() {
            if (getStep() !== '2') return true; // sai do loop
            var card = findSwordCard();
            if (!card) return false;

            showStep(card,
                '⚔️ Esta é sua Espada de Ferro!\nToque nela para inspecioná-la.',
                function () {
                    setStep('3');
                    destroy();
                    // O clique no card abre o itemDetailsModal normalmente
                    setTimeout(step3_Equipar, 350);
                }
            );
            return true;
        }

        // Tenta já
        if (tryShow()) return;

        // Hook no window.renderUI (exposto em inventory.js linha 1524)
        // → dispara EXATAMENTE quando a grid é (re)populada
        var orig = window.renderUI;
        if (typeof orig === 'function') {
            window.renderUI = function () {
                var r = orig.apply(this, arguments);
                if (getStep() === '2') {
                    window.renderUI = orig; // restaura antes de tentar
                    setTimeout(tryShow, 30);
                }
                return r;
            };
        }

        // MutationObserver na grid (garante mesmo que renderUI não seja chamado de novo)
        var grid = document.getElementById('bagItemsGrid');
        if (grid) {
            var obs1 = new MutationObserver(function () {
                if (getStep() !== '2') { obs1.disconnect(); return; }
                if (tryShow()) obs1.disconnect();
            });
            obs1.observe(grid, { childList: true });
            addObs(obs1);
        }

        // Polling de segurança (15 s)
        var attempts = 0;
        var pid = setInterval(function () {
            if (getStep() !== '2' || attempts++ > 40) { clearInterval(pid); return; }
            if (tryShow()) clearInterval(pid);
        }, 375);
    }

    function step3_Equipar() {
        /*
         * #itemDetailsModal tem z-index 1000, que fica ABAIXO do nosso overlay (9980).
         * Por isso usamos { noOverlay: true } — o modal do jogo já bloqueia a tela.
         * Só mostramos a seta/tooltip apontando para o botão Equipar.
         */
        function tryShow() {
            if (getStep() !== '3') return true;
            var modal = document.getElementById('itemDetailsModal');
            if (!modal || getComputedStyle(modal).display === 'none') return false;
            var btn = document.getElementById('equipBtnModal');
            if (!btn || getComputedStyle(btn).display === 'none') return false;
            if (!btn.textContent.trim()) return false;

            showStep(btn,
                '✅ Agora toque em "Equipar"\npara usar sua espada!',
                function () {
                    setStep('4');
                    destroy();
                    // A ação de equipar dispara normalmente; aguarda confirmação
                    setTimeout(step4_Hamburger, 1200);
                },
                { noOverlay: true }
            );
            return true;
        }

        if (tryShow()) return;

        // Observa abertura do modal (mudança de display via style)
        var modal = document.getElementById('itemDetailsModal');
        if (modal) {
            var obs2 = new MutationObserver(function () {
                if (getStep() !== '3') { obs2.disconnect(); return; }
                if (tryShow()) obs2.disconnect();
            });
            obs2.observe(modal, { attributes: true, attributeFilter: ['style'] });
            addObs(obs2);
        }

        // Polling de segurança
        var pid3 = setInterval(function () {
            if (getStep() !== '3') { clearInterval(pid3); return; }
            if (tryShow()) clearInterval(pid3);
        }, 300);
    }

    function step4_Hamburger() {
        var btn = document.getElementById('menuToggleBtn');
        if (!btn) return;

        showStep(btn,
            '☰ Ótimo! Agora abra\no menu lateral.',
            function () {
                setStep('5');
                destroy();
                // openMenu() é chamado pelo handler original do jogo
                setTimeout(step5_TelaInicial, 400);
            }
        );
    }

    function step5_TelaInicial() {
        /*
         * #leftSideMenu tem z-index 9999 (acima do nosso overlay 9980).
         * Quando o menu abre ele fica visível naturalmente acima do overlay.
         * Usamos { noOverlay: true } para não criar confusão visual.
         * A seta/tooltip (10020) aparecem acima do menu (9999).
         * Detectamos o link via a[href="index.html"] dentro do menu.
         */
        function tryShow() {
            if (getStep() !== '5') return true;
            var menu = document.getElementById('leftSideMenu');
            if (!menu || !menu.classList.contains('open')) return false;
            var link = menu.querySelector('a[href="index.html"]');
            if (!link) return false;

            showStep(link,
                '🏠 Toque em "Tela inicial"\npara voltar.',
                function () {
                    setStep('6');
                    destroy();
                    // Navegação ocorre naturalmente
                },
                { noOverlay: true }
            );
            return true;
        }

        if (tryShow()) return;

        // Observa classe 'open' no leftSideMenu
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

    /* ═══════════════════════════════════════════════════════
       BOOT
    ═══════════════════════════════════════════════════════ */
    function boot() {
        if (isDone()) return;
        var step = getStep();
        if (!step) return;

        var path = window.location.pathname;

        // Detecta inventory pela URL OU por elementos exclusivos da página
        var onInventory = path.indexOf('inventory') !== -1
            || !!document.getElementById('bagSection')
            || !!document.getElementById('bagItemsGrid');

        // Detecta index pela URL OU pela presença do sideMenu lateral DIREITO
        var onIndex = !onInventory && (
            path === '/' || path.endsWith('index.html') || path.endsWith('/')
            || !!document.getElementById('footerMenu')
            || !!document.querySelector('[data-modal="bolsaModal"]')
        );

        if (onIndex) {
            var start = (step === '1') ? step1_Bolsa : (step === '6') ? step6_Opcoes : null;
            if (start) {
                var fired = false;
                function doStart() {
                    if (fired) return;
                    fired = true;
                    start();
                }
                // Escuta o evento que script.js dispara quando o jogador está pronto
                window.addEventListener('aden_player_ready', doStart, { once: true });
                // Fallback robusto: tenta em 3 s e de novo em 6 s
                setTimeout(doStart, 3000);
                setTimeout(doStart, 6000);
            }
        }

        if (onInventory) {
            var runners = { '2': step2_Sword, '3': step3_Equipar, '4': step4_Hamburger, '5': step5_TelaInicial };
            var run = runners[step];
            if (run) {
                // inventory.js é um módulo — aguarda DOM pronto + pequeno delay
                setTimeout(run, 800);
            }
        }
    }

    /* ═══════════════════════════════════════════════════════
       API PÚBLICA
    ═══════════════════════════════════════════════════════ */
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
