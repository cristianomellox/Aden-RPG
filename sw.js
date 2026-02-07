// sw.js

const CACHE_NAME = 'aden-rpg-assets-v12'; // Versão atualizada para forçar atualização
const ASSET_PREFIX = '/assets/';

// Domínio do Cloudinary para identificar as requisições
const CLOUDINARY_HOST = 'res.cloudinary.com';

// O que NÃO deve ser cacheado de jeito nenhum (apenas local)
const BLOCKED_PATHS = ['/assets/itens/'];

const ALLOWED_EXTENSIONS = [
    '.webp', '.webm', '.mp3', '.mp4',
    '.png', '.jpg', '.jpeg', '.gif', '.svg'
];

// Apenas arquivos essenciais de UI/Sons
const ASSETS_TO_PRECACHE = [
    '/assets/aden.mp3',
    '/assets/aden_intro.webm',
    '/assets/goldcoin.webp',
    '/assets/cristais.webp',
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('🔥 [SW] Precache de UI/Sons...');
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

    // =========================================================
    // >>> LÓGICA 1: CLOUDINARY (AVATARES/GUILDA) <<<
    // =========================================================
    // Verifica se a requisição é para o Cloudinary
    if (url.hostname === CLOUDINARY_HOST) {
        event.respondWith(
            caches.match(request).then(cachedResponse => {
                // Estratégia Cache-First: Se existe no cache, retorna imediatamente (economiza egress)
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(request).then(networkResponse => {
                    // Cloudinary retorna headers CORS, então o type será 'cors'
                    // Verificamos se o status é 200 (OK)
                    if (!networkResponse || networkResponse.status !== 200) {
                        return networkResponse;
                    }

                    // Clona a resposta e salva no cache
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseToCache);
                    });

                    return networkResponse;
                }).catch(err => {
                    console.warn("Erro ao buscar imagem no Cloudinary:", err);
                });
            })
        );
        return; // Interrompe para não processar lógica de Assets locais
    }

    // =========================================================
    // >>> LÓGICA 2: ASSETS LOCAIS (ADEN ASSETS) <<<
    // =========================================================

    // 1. Verifica se é um asset local
    const isAsset = url.pathname.includes(ASSET_PREFIX);

    // 2. VERIFICAÇÃO CRÍTICA: Se for da pasta itens, INTERROMPE.
    const isBlocked = BLOCKED_PATHS.some(blockedPath => url.pathname.includes(blockedPath));

    if (isBlocked) {
        return; 
    }

    // 3. Verifica extensão permitida
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => 
        url.pathname.toLowerCase().endsWith(ext)
    );

    // Se é Asset local, NÃO é bloqueado e tem extensão válida
    if (isAsset && hasValidExtension) {
        event.respondWith(
            caches.match(request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;

                return fetch(request).then(networkResponse => {
                    // Para assets locais, exigimos que seja 'basic' (mesma origem)
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                        return networkResponse;
                    }

                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseToCache);
                    });

                    return networkResponse;
                });
            })
        );
    }
});