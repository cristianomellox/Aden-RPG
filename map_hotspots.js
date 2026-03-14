(function() {
    const hotspots = [
        // Adicione novos locais aqui seguindo o padrão:
        { id: 'zion', name: 'Zion', top: 390, left: 80, width: 100, height: 90, url: '/zion.html', color: '#84e000' },
        { id: 'dg_ruinas', name: 'Ruínas Ancestrais', top: 230, left: 85, width: 100, height: 100, url: '/dg_ruinas.html', color: '#b7a5ff' },
        { id: 'solaris', name: 'Solaris', top: 315, left: 320, width: 100, height: 110, url: '/solaris.html', color: '#b7a5ff' },
        { id: 'floresta_mistica', name: 'Floresta Mística', top: 775, left: 130, width: 190, height: 180, url: '/floresta_mistica.html', color: '#ffc3c3' },
        { id: 'vale_arcano', name: 'Vale Arcano', top: 465, left: 340, width: 190, height: 120, url: '/vale_arcano.html', color: '#ffc3c3' },
        { id: 'penumbra_uivante', name: 'Penumbra Uivante', top: 325, left: 490, width: 190, height: 110, url: '/penumbra_uivante.html', color: '#ffc3c3' },
        { id: 'razar', name: 'Razar', top: 890, left: 530, width: 130, height: 60, url: '/razar.html', color: '#ffc3c3' },
        { id: 'desfiladeiro', name: 'Desfiladeiro do Sol Poente', top: 1230, left: 560, width: 130, height: 60, url: '/desfiladeiro.html', color: '#ffc3c3' },
        { id: 'covil_de_kelts', name: 'Covil de Kelts', top: 410, left: 855, width: 130, height: 100, url: '/covil_de_kelts.html', color: '#ffc3c3' },
        { id: 'queda_fontana', name: 'Queda Fontana', top: 700, left: 1055, width: 130, height: 60, url: '/queda_fontana.html', color: '#ffc3c3' },
        { id: 'enclave_etereo', name: 'Enclave Etéreo', top: 810, left: 1295, width: 130, height: 100, url: '/enclave_etereo.html', color: '#ffc3c3' },
        { id: 'pantano', name: 'Pântano de Molinar', top: 400, left: 1250, width: 160, height: 120, url: '/pantano_de_molinar.html', color: '#ffc3c3' },
        { id: 'duratar', name: 'Duratar', top: 260, left: 1180, width: 150, height: 100, url: '/duratar.html', color: '#84e000' },
        { id: 'astrax', name: 'Astrax', top: 1160, left: 1100, width: 150, height: 100, url: '/astrax.html', color: '#84e000' },
        { id: 'tandra', name: 'Tandra', top: 1090, left: 575, width: 150, height: 100, url: '/tandra.html', color: '#84e000' },
        { id: 'mitrar', name: 'Mitrar', top: 950, left: 490, width: 118, height: 75, url: '/mitrar.html', color: '#84e000' },
        { id: 'mina', name: 'Minas', top: 955, left: 685, width: 148, height: 85, url: '/mines.html', color: '#b7a5ff' },
        { id: 'elendor', name: 'Elendor', top: 780, left: 360, width: 148, height: 95, url: '/elendor.html', color: '#84e000' },
        { id: 'erbaria', name: 'Erbária', top: 780, left: 530, width: 118, height: 75, url: '/erbaria.html', color: '#ffc3c3' },
        { id: 'arena', name: 'Arena', top: 645, left: 220, width: 148, height: 120, url: '/arena.html', color: '#b7a5ff' },
        { id: 'tdd', name: 'Torre da Desolação', top: 1070, left: 146, width: 148, height: 180, url: '/tdd.html', color: '#b7a5ff' },
        { id: 'capital', name: 'Capital', top: 515, left: 667, width: 220, height: 140, url: '/capital.html', color: '#84e000' },
        // EXEMPLO DE NOVO LOCAL:
        // { id: 'nova_regiao', name: 'Nova Região', top: 500, left: 500, width: 100, height: 100, url: '/nova.html', color: 'blue' },
    ];

    // ── Mapeamento: REGION_NAME (gravado no ACTIVITY_KEY) → URL da página ──────
    // A chave deve bater EXATAMENTE com o valor de REGION_NAME de cada arquivo .js
    const REGION_NAME_TO_URL = {
        'Covil de Kelts'            : '/covil_de_kelts.html',
        'Desfiladeiro do Sol Poente': '/desfiladeiro.html',
        'Enclave Etéreo'            : '/enclave_etereo.html',
        'Erbaria'                   : '/erbaria.html',
        'Floresta Mística'          : '/floresta_mistica.html',
        'Pântano de Molinar'        : '/pantano_de_molinar.html',
        'Penumbra Uivante'          : '/penumbra_uivante.html',
        'Queda Fontana'             : '/queda_fontana.html',
        'Razar'                     : '/razar.html',
        'Vale Arcano'               : '/vale_arcano.html',
    };

    const ACTIVITY_KEY = 'aden_activity_state';
    const GPS_BADGE_ID = 'hunting-gps-badge';

    // ── Injeta CSS do badge uma única vez ────────────────────────────────────────
    if (!document.getElementById('gps-badge-style')) {
        const style = document.createElement('style');
        style.id = 'gps-badge-style';
        style.innerHTML = `
            #${GPS_BADGE_ID} {
                position: absolute;
                top: 12px;
                left: 12px;
                z-index: 20;
                display: flex;
                align-items: center;
                gap: 6px;
                background: rgba(0, 0, 0, 0.72);
                border: 1px solid rgba(255, 195, 195, 0.5);
                border-radius: 8px;
                padding: 5px 10px 5px 6px;
                text-decoration: none;
                cursor: pointer;
                backdrop-filter: blur(4px);
                transition: background 0.2s, border-color 0.2s;
                pointer-events: all;
            }
            #${GPS_BADGE_ID}:hover {
                background: rgba(255, 195, 195, 0.18);
                border-color: rgba(255, 195, 195, 0.9);
            }
            #${GPS_BADGE_ID} .gps-label {
                color: #ffc3c3;
                font-size: 11px;
                font-weight: bold;
                white-space: nowrap;
                pointer-events: none;
                line-height: 1.2;
                text-shadow: 0 1px 3px rgba(0,0,0,0.8);
            }
            #${GPS_BADGE_ID} .gps-label span {
                display: block;
                font-size: 9px;
                font-weight: normal;
                color: #ccc;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            @keyframes gps-pulse {
                0%   { opacity: 1; transform: scale(1); }
                50%  { opacity: 0.55; transform: scale(0.88); }
                100% { opacity: 1; transform: scale(1); }
            }
            #${GPS_BADGE_ID} .gps-dot {
                animation: gps-pulse 1.6s ease-in-out infinite;
            }
        `;
        document.head.appendChild(style);
    }

    // ── SVG do ícone GPS (30×30 px) ──────────────────────────────────────────────
    function criarSvgGPS() {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none">
            <!-- Sombra do pino -->
            <ellipse cx="15" cy="26.5" rx="4" ry="1.5" fill="rgba(0,0,0,0.35)"/>
            <!-- Corpo do pino -->
            <path d="M15 2C10.58 2 7 5.58 7 10c0 6.63 8 17 8 17s8-10.37 8-17C23 5.58 19.42 2 15 2z"
                  fill="#ff6b6b" stroke="#ff9898" stroke-width="0.8"/>
            <!-- Círculo interno branco (buraco do pino) -->
            <circle cx="15" cy="10" r="3.2" fill="white" opacity="0.92"/>
            <!-- Ponto pulsante no centro -->
            <circle class="gps-dot" cx="15" cy="10" r="1.6" fill="#ff3b3b"/>
            <!-- Cruz de GPS (linhas cardeais) -->
            <line x1="15" y1="3" x2="15" y2="5.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
            <line x1="15" y1="14.5" x2="15" y2="17" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
            <line x1="8" y1="10" x2="10.5" y2="10" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
            <line x1="19.5" y1="10" x2="22" y2="10" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
        </svg>`;
    }

    // ── Lê o estado de atividade do localStorage ─────────────────────────────────
    function lerAtividadeAtual() {
        try {
            const raw = localStorage.getItem(ACTIVITY_KEY);
            if (!raw) return null;
            const a = JSON.parse(raw);
            // Valida: deve ser hunting e não ter expirado (6h máx, igual à lógica dos JS de região)
            if (a && a.type === 'hunting' && a.region) {
                const started = a.started_at || 0;
                if (Date.now() - started > 6 * 60 * 60 * 1000) return null; // expirado
                return a;
            }
        } catch (e) {}
        return null;
    }

    // ── Cria ou atualiza o badge de GPS no mapa ───────────────────────────────────
    function atualizarBadgeGPS(mapImage) {
        const atividade = lerAtividadeAtual();

        // Remove badge anterior se existir
        const badgeAntigo = mapImage.querySelector('#' + GPS_BADGE_ID);
        if (badgeAntigo) badgeAntigo.remove();

        if (!atividade) return; // não está caçando — nada a exibir

        const regionName = atividade.region;
        const url = REGION_NAME_TO_URL[regionName];
        if (!url) return; // região desconhecida — não exibe

        const badge = document.createElement('a');
        badge.id = GPS_BADGE_ID;
        badge.href = url;

        badge.innerHTML = criarSvgGPS() +
            `<div class="gps-label">
                <span>Você está</span>
                Caçando em ${regionName}
            </div>`;

        mapImage.appendChild(badge);
    }

    let hotspotsInjetados = false;

    function adicionarHotspotsAoMapa() {
        const mapImage = document.getElementById('mapImage');
        if (!mapImage) {
            setTimeout(adicionarHotspotsAoMapa, 100);
            return;
        }

        if (hotspotsInjetados && mapImage.querySelector('.map-hotspot')) {
            // Hotspots já existem — apenas atualiza o badge (estado pode ter mudado)
            atualizarBadgeGPS(mapImage);
            return;
        }

        mapImage.querySelectorAll('.map-hotspot').forEach(el => el.remove());

        hotspots.forEach(spot => {
            const hotspotEl = document.createElement('a');
            hotspotEl.id = spot.id;
            hotspotEl.className = 'map-hotspot';
            hotspotEl.href = spot.url;

            Object.assign(hotspotEl.style, {
                position: 'absolute',
                top: `${spot.top}px`,
                left: `${spot.left}px`,
                width: `${spot.width}px`,
                height: `${spot.height}px`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
                border: `2px solid ${spot.color || 'white'}`
            });

            const label = document.createElement('span');
            label.innerText = spot.name;
            label.className = 'hotspot-label';
            label.style.color = spot.color || 'white';
            label.style.fontWeight = 'bold';
            label.style.pointerEvents = 'none';

            hotspotEl.appendChild(label);
            mapImage.appendChild(hotspotEl);
        });

        hotspotsInjetados = true;

        // Badge de localização do jogador
        atualizarBadgeGPS(mapImage);
    }

    // Mantém a lógica original de integração com a UI do jogo
    const originalRenderPlayerUI = window.renderPlayerUI;
    if (typeof originalRenderPlayerUI === 'function') {
        window.renderPlayerUI = function(player, preserveActiveContainer) {
            originalRenderPlayerUI(player, preserveActiveContainer);
            setTimeout(adicionarHotspotsAoMapa, 100);
        };
    } else {
        document.addEventListener('DOMContentLoaded', adicionarHotspotsAoMapa);
    }
})();
