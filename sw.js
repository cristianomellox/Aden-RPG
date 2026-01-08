const CACHE_NAME = 'aden-rpg-assets-v1';
const ASSET_PATH = '/assets/';
const ALLOWED_EXTENSIONS = ['.webp', '.webm', '.mp3', '.png'];

self.addEventListener('install', (event) => {
    // Força o SW a se tornar ativo imediatamente
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Garante que o SW assuma o controle das abas abertas imediatamente
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Verifica se a requisição é para a pasta /assets/ 
    // E se termina com as extensões desejadas
    const isAssetPath = url.pathname.includes(ASSET_PATH);
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext));

    if (isAssetPath && hasValidExtension) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                // Se já estiver no cache, retorna imediatamente (Cache First)
                if (cachedResponse) {
                    return cachedResponse;
                }

                // Se não estiver no cache, busca na rede
                return fetch(event.request).then((networkResponse) => {
                    // Verifica se a resposta é válida antes de salvar
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                        // Para áudio/vídeo de outros domínios ou partial content, 
                        // retornamos sem cachear ou tratamos de forma especial.
                        // Como estão no seu domínio, o 'basic' funciona bem.
                        return networkResponse;
                    }

                    // Clona a resposta para salvar no cache e retornar ao navegador
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });

                    return networkResponse;
                });
            })
        );
    }
});