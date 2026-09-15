// sw.js

const CACHE_NAME = 'aden-rpg-assets-v43'; // Mude isso quando alterar a lista de precache (UI essencial)
const CACHE_ZIP_ASSETS = 'aden-rpg-zip-assets-v1'; // CACHE BLINDADO: nunca mude esse nome, ele guarda os assets extraídos dos zips + os marcadores de versão de cada pacote
const DEBUG_LOG_CACHE = 'aden-rpg-debug-log'; // TEMPORÁRIO — só pra diagnosticar o problema da página offline, pode remover depois

const DEBUG_LOG_KEY = 'https://internal.local/debug-log';
const MAX_LOG_ENTRIES = 40;

async function logDebug(entry) {
    try {
        const cache = await caches.open(DEBUG_LOG_CACHE);
        const existingResp = await cache.match(DEBUG_LOG_KEY);
        let arr = [];
        if (existingResp) {
            try { arr = await existingResp.json(); } catch (e) { arr = []; }
        }
        arr.push({ t: new Date().toISOString(), ...entry });
        if (arr.length > MAX_LOG_ENTRIES) arr = arr.slice(-MAX_LOG_ENTRIES);
        await cache.put(DEBUG_LOG_KEY, new Response(JSON.stringify(arr), {
            headers: { 'Content-Type': 'application/json' }
        }));
    } catch (e) {
        // se até logar falhar, não tem o que fazer aqui dentro
    }
}

const ASSET_PREFIX = '/assets/';
const CLOUDINARY_HOST = 'res.cloudinary.com';

// Pastas/arquivos que NUNCA devem ser tratados por este SW (nem cache-forever, nem zip).
// Itens continuam sendo atualizados direto pelo repositório/Cloudflare Pages.
const BLOCKED_PATHS = ['/assets/itens/'];

const ALLOWED_EXTENSIONS = [
    '.webp', '.webm', '.mp3', '.mp4',
    '.png', '.jpg', '.jpeg', '.gif', '.svg'
];

// Apenas arquivos essenciais de UI que continuam existindo no repositório (não são zipados).
const ASSETS_TO_PRECACHE = [
    '/assets/goldcoin.webp',
    '/assets/cristais.webp',
    '/assets/botao.webp',
    '/assets/aden_ini.webp',
    '/manifest.json',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/assets/notification-icon-192.png',
    '/assets/badge-icon.png',
    '/offline.html',
    '/assets/offline.webp',
    '/debug-sw.html', // TEMPORÁRIO — só pra diagnosticar, pode remover depois
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('🔥 [SW] Precache de UI essencial...');
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
                keys.map(key => {
                    // PROTEÇÃO MÁXIMA: apaga caches velhos, mas nunca o atual nem o dos ZIPs/versões!
                    if (key !== CACHE_NAME && key !== CACHE_ZIP_ASSETS && key !== DEBUG_LOG_CACHE) {
                        console.log('🗑️ [SW] Apagando cache antigo:', key);
                        return caches.delete(key);
                    }
                })
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // =========================================================
    // >>> LÓGICA 0: NAVEGAÇÃO SEM INTERNET → PÁGINA OFFLINE <<<
    // =========================================================
    // "Navigate" = o navegador está carregando uma página HTML inteira
    // (abrir/recarregar o jogo, trocar de página no MPA). Se a rede falhar
    // (sem conexão), mostramos a offline.html pré-cacheada em vez do erro
    // padrão do navegador. A URL na barra de endereço continua sendo a
    // página que o jogador tentou abrir, então o botão "Recarregar" da
    // offline.html tenta essa mesma página de novo.
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            await logDebug({ evento: 'navigate-start', url: request.url });
            try {
                const resp = await fetch(request.url);
                await logDebug({ evento: 'navigate-fetch-ok', url: request.url, status: resp.status });
                return resp;
            } catch (fetchErr) {
                await logDebug({ evento: 'navigate-fetch-falhou', url: request.url, erro: String(fetchErr) });
                try {
                    const offlinePage = await caches.match('/offline.html');
                    await logDebug({ evento: 'offline-html-lookup', encontrado: !!offlinePage });
                    return offlinePage || new Response('Sem conexão com a internet.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                } catch (cacheErr) {
                    await logDebug({ evento: 'cache-match-falhou', erro: String(cacheErr) });
                    return new Response('Sem conexão com a internet.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                }
            }
        })());
        return;
    }

    // =========================================================
    // >>> LÓGICA 1: CLOUDINARY (AVATARES/GUILDA) <<<
    // =========================================================
    if (url.hostname === CLOUDINARY_HOST) {
        event.respondWith(
            caches.match(request).then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(request).then(networkResponse => {
                    if (!networkResponse || networkResponse.status !== 200) {
                        return networkResponse;
                    }
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
        return;
    }

    // =========================================================
    // >>> LÓGICA 2: ASSETS LOCAIS (precache + zips extraídos) <<<
    // =========================================================
    const isAsset = url.pathname.includes(ASSET_PREFIX);
    const isBlocked = BLOCKED_PATHS.some(blockedPath => url.pathname.includes(blockedPath));
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext));

    if (isAsset && !isBlocked && hasValidExtension) {
        event.respondWith(
            // Procura em TODOS os caches abertos (acha tanto o precache quanto os extraídos do zip)
            caches.match(request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;

                // Não achou no cache (ex: algo que ainda não foi baixado). Tenta buscar na origem.
                // Isso só funciona para arquivos que ainda existem no repositório/Cloudflare Pages —
                // arquivos movidos exclusivamente para os zips vão dar 404 aqui se pedidos cedo demais.
                return fetch(request).then(networkResponse => {
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

// =========================================================
// >>> PUSH NOTIFICATIONS <<<
// =========================================================
self.addEventListener('push', event => {
    let payload = { title: 'Aden RPG Online', body: 'Você tem uma novidade no jogo!', url: '/index.html' };

    if (event.data) {
        try {
            payload = { ...payload, ...event.data.json() };
        } catch (e) {
            payload.body = event.data.text() || payload.body;
        }
    }

    const options = {
        body: payload.body,
        icon: payload.icon || '/assets/notification-icon-192.png',
        badge: '/assets/badge-icon.png',
        data: { url: payload.url || '/index.html' },
        vibrate: [200, 100, 200],
        silent: false,
        requireInteraction: false,
    };

    if (payload.image) {
        options.image = payload.image;
    }

    event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/index.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes(targetUrl) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
