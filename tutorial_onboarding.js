// tutorial_onboarding.js — Aden RPG Online
// ============================================================
// Tutorial de onboarding interativo (estilo spotlight).
// Persiste o progresso em localStorage.
// Funciona em: index.html (passos 1, 6, 7) e
//              inventory.html (passos 2, 3, 4, 5).
//
// INSTALAÇÃO:
//   Adicione ANTES do </body> em ambas as páginas:
//   <script src="tutorial_onboarding.js"></script>
//
//   Não é preciso chamar nada manualmente.
//   O perfil_edit.js chama window.AdenTutorial.startOnboarding()
//   automaticamente quando o novo jogador salva o perfil pela 1ª vez.
// ============================================================

(function () {
    'use strict';

    /* ─────────────────────────────────────────────────────────
       ESTADO (localStorage)
       Valores: '1'…'7' | 'done'
    ───────────────────────────────────────────────────────── */
    var KEY = 'aden_tutorial_step';
    var getStep = function () { return localStorage.getItem(KEY) || ''; };
    var setStep = function (v) { localStorage.setItem(KEY, v); };
    var isDone  = function () { return getStep() === 'done'; };

    /* ─────────────────────────────────────────────────────────
       HANDLES DE DOM
    ───────────────────────────────────────────────────────── */
    var _overlay   = null;
    var _arrow     = null;
    var _tooltip   = null;
    var _raised    = [];   // array de {el, origPos, origZ, isTarget}
    var _curClickH = null;
    var _curTarget = null;

    /* ─────────────────────────────────────────────────────────
       SVG DA SETA (pulsante, dourada, com glow)
    ───────────────────────────────────────────────────────── */
    var ARROW_SVG = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 84" width="54" height="84">',
        '  <defs>',
        '    <filter id="atglow" x="-60%" y="-60%" width="220%" height="220%">',
        '      <feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="blur"/>',
        '      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>',
        '    </filter>',
        '  </defs>',
        '  <!-- Haste -->',
        '  <line x1="27" y1="5" x2="27" y2="58"',
        '        stroke="#FFD700" stroke-width="6" stroke-linecap="round"',
        '        filter="url(#atglow)"/>',
        '  <!-- Ponta -->',
        '  <polyline points="8,42 27,66 46,42"',
        '            fill="none" stroke="#FFD700" stroke-width="6"',
        '            stroke-linecap="round" stroke-linejoin="round"',
        '            filter="url(#atglow)"/>',
        '  <!-- Brilho interno branco suave -->',
        '  <line x1="27" y1="5" x2="27" y2="58"',
        '        stroke="rgba(255,255,200,0.45)" stroke-width="2.5" stroke-linecap="round"/>',
        '</svg>'
    ].join('\n');

    /* ─────────────────────────────────────────────────────────
       INJEÇÃO DE CSS (única vez)
    ───────────────────────────────────────────────────────── */
    function injectCSS() {
        if (document.getElementById('aden-tut-css')) return;
        var s = document.createElement('style');
        s.id = 'aden-tut-css';
        s.textContent = [
            /* Fundo escuro geral */
            '#aden-tut-overlay {',
            '    position: fixed; inset: 0; z-index: 8900;',
            '    background: rgba(0,0,0,0.84);',
            '    pointer-events: all;',
            '}',

            /* Seta dourada pulsante */
            '#aden-tut-arrow {',
            '    position: fixed; z-index: 9200;',
            '    pointer-events: none;',
            '    animation: adenArrowBounce 0.95s ease-in-out infinite;',
            '    filter: drop-shadow(0 0 8px rgba(255,215,0,0.7));',
            '}',

            /* Tooltip dourado */
            '#aden-tut-tip {',
            '    position: fixed; z-index: 9200;',
            '    pointer-events: none;',
            '    max-width: 230px;',
            '    padding: 10px 14px;',
            '    background: linear-gradient(135deg, #1c1200 0%, #0a0700 100%);',
            '    border: 1.5px solid #FFD700;',
            '    border-radius: 10px;',
            '    color: #e8e0cc;',
            "    font-family: 'Cinzel', serif, sans-serif;",
            '    font-size: 0.83em;',
            '    line-height: 1.6;',
            '    text-align: center;',
            '    box-shadow: 0 0 28px rgba(255,215,0,0.35), 0 4px 16px rgba(0,0,0,0.6);',
            '}',

            /* Elemento-alvo elevado + borda pulsante */
            '.aden-tut-highlight {',
            '    position: relative !important;',
            '    z-index: 9100 !important;',
            '    border-radius: 10px;',
            '    outline: 3px solid rgba(255,215,0,0.9) !important;',
            '    outline-offset: 3px;',
            '    animation: adenTargetPulse 1.4s ease-in-out infinite;',
            '}',
            /* Ancestrais fixed elevados (não recebem o glow) */
            '.aden-tut-ancestor {',
            '    z-index: 9050 !important;',
            '}',

            '@keyframes adenArrowBounce {',
            '    0%,100% { transform: translateY(0px); }',
            '    50%      { transform: translateY(10px); }',
            '}',
            '@keyframes adenTargetPulse {',
            '    0%,100% { box-shadow: 0 0 0 3px rgba(255,215,0,0.5),  0 0 16px rgba(255,215,0,0.2); }',
            '    50%      { box-shadow: 0 0 0 7px rgba(255,215,0,0.85), 0 0 40px rgba(255,215,0,0.55); }',
            '}'
        ].join('\n');
        document.head.appendChild(s);
    }

    /* ─────────────────────────────────────────────────────────
       CRIA / GARANTE OS ELEMENTOS DO OVERLAY
    ───────────────────────────────────────────────────────── */
    function ensureDOM() {
        injectCSS();

        if (!_overlay) {
            _overlay = document.createElement('div');
            _overlay.id = 'aden-tut-overlay';
            // Bloqueia todos os cliques fora do alvo elevado
            _overlay.addEventListener('click',      blockEv, true);
            _overlay.addEventListener('touchstart', blockEv, { capture: true, passive: false });
            document.body.appendChild(_overlay);
        }

        if (!_arrow) {
            _arrow = document.createElement('div');
            _arrow.id = 'aden-tut-arrow';
            _arrow.innerHTML = ARROW_SVG;
            document.body.appendChild(_arrow);
        }

        if (!_tooltip) {
            _tooltip = document.createElement('div');
            _tooltip.id = 'aden-tut-tip';
            document.body.appendChild(_tooltip);
        }
    }

    function blockEv(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    /* ─────────────────────────────────────────────────────────
       ELEVA O ALVO (+ ANCESTRAIS FIXED/ABSOLUTE)
       Necessário para furar o overlay sem clip-path complexo.
    ───────────────────────────────────────────────────────── */
    function elevate(targetEl) {
        // Desfaz elevação anterior
        deflate();

        // Sobe o próprio target
        _raised.push({
            el: targetEl,
            origPos:   targetEl.style.position,
            origZ:     targetEl.style.zIndex,
            isTarget:  true
        });
        targetEl.classList.add('aden-tut-highlight');

        // Sobe ancestrais que criam contexto de empilhamento novo
        // (position: fixed | sticky | absolute com z-index explícito)
        var node = targetEl.parentElement;
        while (node && node !== document.documentElement) {
            var cs = window.getComputedStyle(node);
            if (cs.position === 'fixed' || cs.position === 'sticky' ||
               (cs.position === 'absolute' && cs.zIndex !== 'auto') ||
               (cs.position === 'relative' && cs.zIndex !== 'auto' && parseInt(cs.zIndex, 10) < 9000)) {

                _raised.push({
                    el: node,
                    origPos: node.style.position,
                    origZ:   node.style.zIndex,
                    isTarget: false
                });
                node.classList.add('aden-tut-ancestor');
                // Para submenus que ficam ocultos com display:none, não mexemos;
                // mas garantimos que, se estiverem visíveis, fiquem acima do overlay
            }
            node = node.parentElement;
        }
    }

    function deflate() {
        _raised.forEach(function (entry) {
            if (entry.isTarget) {
                entry.el.classList.remove('aden-tut-highlight');
            } else {
                entry.el.classList.remove('aden-tut-ancestor');
            }
            entry.el.style.position = entry.origPos;
            entry.el.style.zIndex   = entry.origZ;
        });
        _raised = [];
    }

    /* ─────────────────────────────────────────────────────────
       POSICIONA SETA E TOOLTIP RELATIVOS AO ALVO
    ───────────────────────────────────────────────────────── */
    function positionHints(targetEl) {
        var r   = targetEl.getBoundingClientRect();
        var vw  = window.innerWidth;
        var aw  = 54;   // arrow width
        var ah  = 84;   // arrow height
        var gap = 8;

        var cx = r.left + r.width / 2;

        var arrowTop, tipTop, flipArrow;

        // Tenta colocar seta acima do alvo (ponta apontando para baixo = para ele)
        if (r.top > ah + gap + 80) {
            arrowTop  = r.top - ah - gap;
            tipTop    = arrowTop - 80;
            flipArrow = false;
        } else {
            // Sem espaço acima → seta abaixo (inverte verticalmente)
            arrowTop  = r.bottom + gap;
            tipTop    = arrowTop + ah + gap;
            flipArrow = true;
        }

        // Seta
        var aLeft = Math.max(8, Math.min(vw - aw - 8, cx - aw / 2));
        _arrow.style.cssText += ';left:' + aLeft + 'px;top:' + arrowTop + 'px;' +
            'transform:' + (flipArrow ? 'scaleY(-1)' : 'none') + ';';

        // Tooltip (240px de largura interna, 230 max-width)
        var tLeft = Math.max(8, Math.min(vw - 248, cx - 115));
        _tooltip.style.cssText += ';left:' + tLeft + 'px;top:' + Math.max(8, tipTop) + 'px;';
    }

    /* ─────────────────────────────────────────────────────────
       API PÚBLICA: exibe um passo do tutorial
    ───────────────────────────────────────────────────────── */
    function showStep(targetEl, text, onClicked) {
        ensureDOM();

        // Remove listener do passo anterior
        if (_curClickH && _curTarget) {
            _curTarget.removeEventListener('click',    _curClickH, true);
            _curTarget.removeEventListener('touchend', _curClickH, true);
        }

        elevate(targetEl);
        _curTarget = targetEl;

        _tooltip.textContent = text;

        // Reset posições antes de recalcular
        _arrow.style.cssText   = 'position:fixed;z-index:9200;pointer-events:none;' +
                                  'animation:adenArrowBounce 0.95s ease-in-out infinite;' +
                                  'filter:drop-shadow(0 0 8px rgba(255,215,0,0.7));';
        _tooltip.style.cssText = 'position:fixed;z-index:9200;pointer-events:none;' +
                                  'max-width:230px;padding:10px 14px;' +
                                  'background:linear-gradient(135deg,#1c1200,#0a0700);' +
                                  'border:1.5px solid #FFD700;border-radius:10px;' +
                                  'color:#e8e0cc;font-family:Cinzel,serif;font-size:0.83em;' +
                                  'line-height:1.6;text-align:center;' +
                                  'box-shadow:0 0 28px rgba(255,215,0,0.35),0 4px 16px rgba(0,0,0,0.6);';

        positionHints(targetEl);

        _curClickH = function () {
            if (onClicked) onClicked();
        };
        targetEl.addEventListener('click',    _curClickH, true);
        targetEl.addEventListener('touchend', _curClickH, { capture: true, passive: true });
    }

    /* ─────────────────────────────────────────────────────────
       DESTRÓI TUDO
    ───────────────────────────────────────────────────────── */
    function destroy() {
        // Remove listeners
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
       UTILITÁRIOS ASSÍNCRONOS
    ───────────────────────────────────────────────────────── */

    /** Polling: tenta fn() a cada interval ms até retornar truthy ou timeout. */
    function poll(fn, interval, timeout) {
        interval = interval || 350;
        timeout  = timeout  || 12000;
        return new Promise(function (res, rej) {
            var t0 = Date.now();
            var tid = setInterval(function () {
                var r = fn();
                if (r) { clearInterval(tid); res(r); return; }
                if (Date.now() - t0 > timeout) { clearInterval(tid); rej(new Error('poll timeout')); }
            }, interval);
        });
    }

    /** Aguarda um seletor aparecer no DOM via MutationObserver. */
    function waitEl(selector, timeout) {
        timeout = timeout || 10000;
        return new Promise(function (res, rej) {
            var existing = document.querySelector(selector);
            if (existing) { res(existing); return; }
            var obs = new MutationObserver(function () {
                var el = document.querySelector(selector);
                if (el) { obs.disconnect(); res(el); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(function () { obs.disconnect(); rej(new Error('waitEl: ' + selector)); }, timeout);
        });
    }

    /* ═══════════════════════════════════════════════════════════
       PASSOS DO TUTORIAL
    ═══════════════════════════════════════════════════════════ */

    /* ── PASSO 1 (index.html) ─────────────────────────────────
       Aponta para o menu "Bolsa" no sideMenu lateral direito.   */
    function step1_Bolsa() {
        poll(function () {
            return document.querySelector('[data-modal="bolsaModal"]');
        }).then(function (el) {
            showStep(
                el,
                '⚔️ Você ganhou uma espada inicial! Abra sua Bolsa para equipá-la.',
                function () {
                    setStep('2');
                    destroy();
                    // O clique no item dispara window.location.href = "inventory.html" naturalmente
                }
            );
        }).catch(function () {});
    }

    /* ── PASSO 2 (inventory.html) ────────────────────────────
       Aponta para o card da Espada de Ferro (item_id = 1).      */
    function step2_Sword() {
        poll(function () {
            var grid = document.getElementById('bagItemsGrid');
            if (!grid || grid.children.length === 0) return null;

            // Estratégia 1: via lista global exposta por inventory.js
            if (window.allInventoryItems && window.allInventoryItems.length > 0) {
                var swordEntry = null;
                for (var i = 0; i < window.allInventoryItems.length; i++) {
                    var itm = window.allInventoryItems[i];
                    // item_id 1 = Espada de Ferro (definição no banco)
                    if (itm.item_id == 1) { swordEntry = itm; break; }
                }
                if (swordEntry) {
                    var card = grid.querySelector('[data-inventory-item-id="' + swordEntry.id + '"]');
                    if (card) return card;
                }
            }

            // Estratégia 2: imagem ou alt contém "espada"
            var cards = grid.querySelectorAll('.inventory-item');
            for (var j = 0; j < cards.length; j++) {
                var img = cards[j].querySelector('img');
                if (img) {
                    var haystack = (img.alt + img.src).toLowerCase();
                    if (haystack.indexOf('espada') !== -1 || haystack.indexOf('sword') !== -1) {
                        return cards[j];
                    }
                }
            }

            // Estratégia 3: primeiro card que aparecer (fallback)
            return grid.querySelector('.inventory-item') || null;
        }, 400, 14000).then(function (el) {
            showStep(
                el,
                '⚔️ Esta é sua Espada de Ferro! Toque nela para inspecioná-la.',
                function () {
                    setStep('3');
                    destroy();
                    setTimeout(step3_Equipar, 700);
                }
            );
        }).catch(function () {});
    }

    /* ── PASSO 3 (inventory.html) ────────────────────────────
       Aponta para o botão "Equipar" dentro do modal de detalhe. */
    function step3_Equipar() {
        poll(function () {
            var modal = document.getElementById('itemDetailsModal');
            if (!modal) return null;
            // Modal visível? (display flex ou block)
            var vis = modal.style.display;
            if (!vis || vis === 'none') return null;

            var btn = document.getElementById('equipBtnModal');
            if (!btn || btn.style.display === 'none' || btn.textContent.trim() === '') return null;
            return btn;
        }, 300, 12000).then(function (el) {
            showStep(
                el,
                '✅ Ótimo! Agora toque em "Equipar" para usar sua espada.',
                function () {
                    setStep('4');
                    destroy();
                    // Aguarda o clique de equipar processar antes de avançar
                    setTimeout(step4_Hamburger, 1400);
                }
            );
        }).catch(function () {});
    }

    /* ── PASSO 4 (inventory.html) ────────────────────────────
       Aponta para o botão hambúrguer (menu lateral esquerdo).   */
    function step4_Hamburger() {
        var btn = document.getElementById('menuToggleBtn');
        if (!btn) return;
        showStep(
            btn,
            '☰ Muito bem! Agora abra o menu lateral.',
            function () {
                setStep('5');
                destroy();
                setTimeout(step5_TelaInicial, 500);
            }
        );
    }

    /* ── PASSO 5 (inventory.html) ────────────────────────────
       Aponta para "Tela inicial" no menu lateral aberto.        */
    function step5_TelaInicial() {
        poll(function () {
            var menu = document.getElementById('leftSideMenu');
            if (!menu) return null;
            // Menu precisa estar aberto
            if (!menu.classList.contains('open')) return null;

            // Procura link "Tela inicial" na lista <ul> renderizada
            var links = menu.querySelectorAll('a, li, span');
            for (var i = 0; i < links.length; i++) {
                var txt = links[i].textContent.trim();
                if (txt === 'Tela inicial' || txt === 'Tela Inicial') {
                    // Sobe até o <li> para ter uma área clicável razoável
                    var target = links[i];
                    while (target && target.tagName !== 'LI' && target !== menu) {
                        target = target.parentElement;
                    }
                    return target || links[i];
                }
            }
            return null;
        }, 300, 8000).then(function (el) {
            showStep(
                el,
                '🏠 Perfeito! Toque em "Tela inicial" para voltar.',
                function () {
                    setStep('6');
                    destroy();
                    // Navegação para index.html acontece pelo clique natural
                }
            );
        }).catch(function () {});
    }

    /* ── PASSO 6 (index.html) ────────────────────────────────
       Aponta para o botão "Opções" no footer.                   */
    function step6_Opcoes() {
        poll(function () {
            var el = document.getElementById('maisBtnFooter');
            // Verifica que o footer está visível (pode estar display:none antes do login)
            if (!el || !el.offsetParent) return null;
            return el;
        }, 350, 10000).then(function (el) {
            showStep(
                el,
                '📋 Quase lá! Abra o menu de Opções.',
                function () {
                    setStep('7');
                    destroy();
                    // Aguarda o submenu abrir antes de apontar o Tutorial
                    setTimeout(step7_Tutorial, 600);
                }
            );
        }).catch(function () {});
    }

    /* ── PASSO 7 (index.html) ────────────────────────────────
       Aponta para o botão "Tutorial" dentro do #maisSubmenu.    */
    function step7_Tutorial() {
        poll(function () {
            var sub = document.getElementById('maisSubmenu');
            if (!sub) return null;
            // Submenu precisa estar visível
            if (sub.style.display === 'none' || sub.style.display === '') return null;

            var btns = sub.querySelectorAll('.footer-submenu-btn');
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].textContent.trim().indexOf('Tutorial') !== -1) {
                    return btns[i];
                }
            }
            return null;
        }, 300, 8000).then(function (el) {
            showStep(
                el,
                '📖 Aqui fica o Tutorial completo do jogo. Parabéns, Aventureiro(a)! 🎉',
                function () {
                    setStep('done');
                    destroy();
                    // O clique navega para tutorial.html naturalmente
                }
            );
        }).catch(function () {});
    }

    /* ═══════════════════════════════════════════════════════════
       BOOT — detecta a página e entra no passo correto
    ═══════════════════════════════════════════════════════════ */
    function boot() {
        if (isDone()) return;
        var step = getStep();
        if (!step) return;  // Tutorial ainda não iniciado

        var path = window.location.pathname;
        var onIndex     = path.endsWith('index.html') || path === '/' || /\/$/.test(path);
        var onInventory = path.indexOf('inventory.html') !== -1;

        if (onIndex) {
            if (step === '1') {
                // Aguarda o evento de player pronto (disparado por script.js)
                window.addEventListener('aden_player_ready', step1_Bolsa, { once: true });
                // Fallback se o evento já tiver disparado antes deste script carregar
                setTimeout(function () { if (!_overlay) step1_Bolsa(); }, 2800);
            }
            if (step === '6') {
                window.addEventListener('aden_player_ready', step6_Opcoes, { once: true });
                setTimeout(function () { if (!_overlay) step6_Opcoes(); }, 2800);
            }
        }

        if (onInventory) {
            var runners = {
                '2': step2_Sword,
                '3': step3_Equipar,
                '4': step4_Hamburger,
                '5': step5_TelaInicial
            };
            var run = runners[step];
            if (run) {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', function () {
                        setTimeout(run, 900);
                    });
                } else {
                    setTimeout(run, 900);
                }
            }
        }
    }

    /* ═══════════════════════════════════════════════════════════
       API PÚBLICA
       Chamada por perfil_edit.js após o primeiro save.
    ═══════════════════════════════════════════════════════════ */
    window.AdenTutorial = {
        /** Inicia o onboarding do zero (passo 1). */
        startOnboarding: function () {
            setStep('1');
            step1_Bolsa();
        },
        getStep:  getStep,
        setStep:  setStep,
        isDone:   isDone,
        /** Reseta o tutorial (útil para testes). */
        reset: function () {
            localStorage.removeItem(KEY);
            destroy();
        }
    };

    /* ─── Auto-boot ──────────────────────────────────────────── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
