(function() {
    const hotspots = [
        // Adicione novos locais aqui seguindo o padrão:
        { id: 'zion', name: 'Zion', top: 390, left: 80, width: 100, height: 90, url: '/zion.html', color: '#84e000' },
        { id: 'masmorras', name: 'Masmorras', top: 270, left: 80, width: 100, height: 70, url: '/ruins.html', color: '#b7a5ff' },
        { id: 'solaris', name: 'Solaris', top: 315, left: 320, width: 100, height: 110, url: '/solaris.html', color: 'silver' },
        { id: 'duratar', name: 'Duratar', top: 260, left: 1180, width: 150, height: 100, url: '/duratar.html', color: '#84e000' },
        { id: 'astrax', name: 'Astrax', top: 1160, left: 1100, width: 150, height: 100, url: '/astrax.html', color: '#84e000' },
        { id: 'tandra', name: 'Tandra', top: 1090, left: 575, width: 150, height: 100, url: '/tandra.html', color: '#84e000' },
        { id: 'mitrar', name: 'Mitrar', top: 950, left: 490, width: 118, height: 75, url: '/mitrar.html', color: '#84e000' },
        { id: 'mina', name: 'Minas', top: 955, left: 690, width: 148, height: 85, url: '/mines.html', color: '#b7a5ff' },
        { id: 'elendor', name: 'Elendor', top: 780, left: 360, width: 148, height: 95, url: '/elendor.html', color: '#84e000' },
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