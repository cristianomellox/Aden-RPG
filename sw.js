const CACHE_NAME = 'aden-rpg-assets-v8';
const ASSET_HOSTNAME = 'https://aden-rpg.pages.dev';
const ASSET_PREFIX = '/assets/';
const BLOCKED_PATHS = ['/assets/itens/'];

const ALLOWED_EXTENSIONS = [
    '.webp', '.webm', '.mp3', '.mp4',
    '.png', '.jpg', '.jpeg'
];

const ASSETS_TO_PRECACHE = [
    'https://aden-rpg.pages.dev/assets/aden.mp3',
    'https://aden-rpg.pages.dev/assets/aden_intro.webm',
    'https://aden-rpg.pages.dev/assets/solaris.mp4',
    'https://aden-rpg.pages.dev/assets/karintro.mp4',
    'https://aden-rpg.pages.dev/assets/karoutro.mp4',
    'https://aden-rpg.pages.dev/assets/karatk01.mp4',
    'https://aden-rpg.pages.dev/assets/karatk02.mp4',
    'https://aden-rpg.pages.dev/assets/karatk03.mp4',
    'https://aden-rpg.pages.dev/assets/karatk04.mp4',
    'https://aden-rpg.pages.dev/assets/karatk05.mp4',
    'https://aden-rpg.pages.dev/assets/karatk06.mp4',
    'https://aden-rpg.pages.dev/assets/goldcoin.webp',
    'https://aden-rpg.pages.dev/assets/cristais.webp',

    // TDD Boss
    'https://aden-rpg.pages.dev/assets/tddbossintro.webm',
    'https://aden-rpg.pages.dev/assets/tddbossoutro.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk01.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk02.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk03.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk04.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk05.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk06.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk07.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk08.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk09.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk10.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk11.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk12.webm',
    'https://aden-rpg.pages.dev/assets/tddbossatk13.webm'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('🔥 [SW] Iniciando pre-cache...');
            return Promise.allSettled(
                ASSETS_TO_PRECACHE.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`⚠️ Erro ao baixar: ${url}`, err)
                    )
                )
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

    const isAssetHost = url.hostname === ASSET_HOSTNAME;
    const isAssetPath = url.pathname.startsWith(ASSET_PREFIX);
    const isBlockedPath = BLOCKED_PATHS.some(path =>
        url.pathname.startsWith(path)
    );
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext =>
        url.pathname.toLowerCase().endsWith(ext)
    );

    if (
        isAssetHost &&
        isAssetPath &&
        hasValidExtension &&
        !isBlockedPath
    ) {
        event.respondWith(
            caches.match(request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;

                return fetch(request).then(networkResponse => {
                    if (networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, responseToCache).catch(() => {});
                        });
                    }
                    return networkResponse;
                });
            })
        );
    }
});
