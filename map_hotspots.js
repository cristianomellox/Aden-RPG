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

    let hotspotsInjetados = false;

    function adicionarHotspotsAoMapa() {
        const mapImage = document.getElementById('mapImage');
        if (!mapImage) {
            setTimeout(adicionarHotspotsAoMapa, 100);
            return;
        }

        if (hotspotsInjetados && mapImage.querySelector('.map-hotspot')) return;
        
        mapImage.querySelectorAll('.map-hotspot').forEach(el => el.remove());

        hotspots.forEach(spot => {
            const hotspotEl = document.createElement('a');
            hotspotEl.id = spot.id;
            hotspotEl.className = 'map-hotspot';
            hotspotEl.href = spot.url;
            
            // Estilos de posicionamento e design
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
                // Borda colorida opcional para destacar a área
                border: `2px solid ${spot.color || 'white'}` 
            });

            const label = document.createElement('span');
            label.innerText = spot.name;
            label.className = 'hotspot-label';
            // Define a cor do texto baseada no que você escolheu no array
            label.style.color = spot.color || 'white'; 
            label.style.fontWeight = 'bold';
            
            label.style.pointerEvents = 'none'; 
            
            hotspotEl.appendChild(label);
            mapImage.appendChild(hotspotEl);
        });

        hotspotsInjetados = true;
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