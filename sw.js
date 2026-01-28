const CACHE_NAME = 'aden-rpg-assets-v11'; // Subi a versão para limpar o antigo
const ASSET_PREFIX = '/assets/';

// O que NÃO deve ser cacheado de jeito nenhum
const BLOCKED_PATHS = ['/assets/itens/'];

const ALLOWED_EXTENSIONS = [
    '.webp', '.webm', '.mp3', '.mp4',
    '.png', '.jpg', '.jpeg', '.gif', '.svg'
];

// Apenas arquivos essenciais de UI/Sons (NADA DA PASTA ITENS AQUI)
const ASSETS_TO_PRECACHE = [
    '/assets/aden.mp3',
    '/assets/aden_intro.webm',
    '/assets/goldcoin.webp',
    '/assets/cristais.webp',
    // Adicione outros elementos de Interface (botões, molduras, fundos) aqui
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('🔥 [SW] Precache de UI/Sons (Itens ignorados)...');
            return cache.addAll(ASSETS_TO_PRECACHE).catch(err => 
                console.warn('⚠️ Erro no precache:', err)
            );
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // 1. Verifica se é um asset
    const isAsset = url.pathname.includes(ASSET_PREFIX);

    // 2. VERIFICAÇÃO CRÍTICA: Se for da pasta itens, INTERROMPE e deixa a rede cuidar.
    // Usamos .some() para verificar se o caminho atual contém algum dos bloqueios.
    const isBlocked = BLOCKED_PATHS.some(blockedPath => url.pathname.includes(blockedPath));

    if (isBlocked) {
        // Se for item, não faz nada. O navegador baixa direto da rede toda vez.
        return; 
    }

    // 3. Verifica extensão permitida
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => 
        url.pathname.toLowerCase().endsWith(ext)
    );

    // Se é Asset, NÃO é bloqueado (não é item) e tem extensão válida: CACHE NELE!
    if (isAsset && hasValidExtension) {
        event.respondWith(
            caches.match(request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;

                return fetch(request).then(networkResponse => {
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                        return networkResponse;
                    }

                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseToCache);
                    });

                    return networkResponse;
                }).catch(() => {
                    // Opcional: Fallback apenas para UI, se necessário
                });
            })
        );
    }
});