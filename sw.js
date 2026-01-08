const CACHE_NAME = 'aden-rpg-assets-v1';
const ASSET_PATH = '/assets/';
const ALLOWED_EXTENSIONS = ['.webp', '.webm', '.mp3', '.png'];

self.addEventListener('install', event => {
    // Ativa o Service Worker imediatamente
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    // Remove caches antigos e assume controle das abas
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
    const request = event.request;

    // Só intercepta GET
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Apenas assets dentro de /assets/
    const isAssetPath = url.pathname.startsWith(ASSET_PATH);

    // Apenas extensões permitidas
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext =>
        url.pathname.toLowerCase().endsWith(ext)
    );

    if (!isAssetPath || !hasValidExtension) return;

    event.respondWith(
        caches.match(request).then(cachedResponse => {
            // Cache First
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request).then(networkResponse => {
                // Aceita 200 (normal) e 206 (partial content para áudio/vídeo)
                if (
                    !networkResponse ||
                    (networkResponse.status !== 200 && networkResponse.status !== 206)
                ) {
                    return networkResponse;
                }

                const responseToCache = networkResponse.clone();

                caches.open(CACHE_NAME).then(cache => {
                    cache.put(request, responseToCache).catch(() => {
                        // Pode falhar em alguns casos de range request — ignora silenciosamente
                    });
                });

                return networkResponse;
            }).catch(() => {
                // Se a rede falhar e não tiver cache, deixa falhar
                return cachedResponse;
            });
        })
    );
});
