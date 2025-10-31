(function() {
    const hotspots = [
        {
            id: 'terras_amald',
            top: 290, 
            left: 490,
            width: 200,
            height: 50,
            url: '/terras_amald.html'
        },
        {
            id: 'zion',
            top: 370,
            left: 80,
            width: 100,
            height: 110,
            url: '/zion.html'
        },
        {
            id: 'duratar',
            top: 260,
            left: 1180,
            width: 150,
            height: 100,
            url: '/duratar.html'
        },
        {
            id: 'astrax',
            top: 1160,
            left: 1100,
            width: 150,
            height: 100,
            url: '/astrax.html'
        },
        {
            id: 'tandra',
            top: 1090,
            left: 575,
            width: 150,
            height: 100,
            url: '/tandra.html'
        },
        {
            id: 'mitrar',
            top: 950,
            left: 490,
            width: 118,
            height: 75,
            url: '/mitrar.html'
        },
        {
            id: 'mina',
            top: 955,
            left: 690,
            width: 148,
            height: 85,
            url: '/mines.html'
        },
        {
            id: 'elendor',
            top: 780,
            left: 360,
            width: 148,
            height: 95,
            url: '/elendor.html'
        },
        {
            id: 'arena',
            top: 645,
            left: 220,
            width: 148,
            height: 120,
            url: '/arena.html'
        },
        {
            id: 'tdd',
            top: 1070,
            left: 146,
            width: 148,
            height: 180,
            url: '/tdd.html'
        },
        {
            id: 'capital',
            top: 515,
            left: 667,
            width: 220,
            height: 140,
            url: '/capital.html'
        },
        
    ];

    let hotspotsInjetados = false;

    function adicionarHotspotsAoMapa() {
        const mapImage = document.getElementById('mapImage');
        
        if (!mapImage) {
            console.warn('[Hotspots] Mapa (#mapImage) não encontrado. Tentando novamente...');
            setTimeout(adicionarHotspotsAoMapa, 100);
            return;
        }

        if (hotspotsInjetados && mapImage.querySelector('.map-hotspot')) {
            return;
        }
        
        console.log('[Hotspots] Injetando regiões clicáveis no mapa...');

        mapImage.querySelectorAll('.map-hotspot').forEach(el => el.remove());

        hotspots.forEach(spot => {
            const hotspotEl = document.createElement('a');
            hotspotEl.id = spot.id;
            hotspotEl.className = 'map-hotspot';
            hotspotEl.href = spot.url; 
            hotspotEl.style.position = 'absolute';
            hotspotEl.style.top = `${spot.top}px`;
            hotspotEl.style.left = `${spot.left}px`;
            hotspotEl.style.width = `${spot.width}px`;
            hotspotEl.style.height = `${spot.height}px`;

            mapImage.appendChild(hotspotEl);
        });

        hotspotsInjetados = true;
        console.log(`[Hotspots] ${hotspots.length} regiões carregadas.`);
    }


    const originalRenderPlayerUI = window.renderPlayerUI;

    if (typeof originalRenderPlayerUI !== 'function') {
        console.error('[Hotspots] A função global window.renderPlayerUI não foi encontrada. Os hotspots não funcionarão.');
        
        document.addEventListener('DOMContentLoaded', adicionarHotspotsAoMapa);
        return;
    }

    window.renderPlayerUI = function(player, preserveActiveContainer) {
        
        originalRenderPlayerUI(player, preserveActiveContainer);
        
        setTimeout(adicionarHotspotsAoMapa, 100); 
    };

    console.log('[Hotspots] Script de hotspots carregado e aguardando renderização do mapa.');

})();