// sw.js

const CACHE_NAME = 'aden-rpg-assets-v50'; // Mude isso quando alterar a lista de precache (UI essencial)
const CACHE_ZIP_ASSETS = 'aden-rpg-zip-assets-v1'; // CACHE BLINDADO: nunca mude esse nome, ele guarda os assets extraídos dos zips + os marcadores de versão de cada pacote

const ASSET_PREFIX = '/assets/';
const CLOUDINARY_HOST = 'res.cloudinary.com';

// Pastas/arquivos que NUNCA devem ser tratados por este SW (nem cache-forever, nem zip).
// Itens continuam sendo atualizados direto pelo repositório/Cloudflare Pages.
const BLOCKED_PATHS = ['/assets/itens/'];

const ALLOWED_EXTENSIONS = [
    '.webp', '.webm', '.mp3', '.mp4',
    '.png', '.jpg', '.jpeg', '.gif', '.svg'
];

// Assets da tela offline: são os MAIS importantes de todos. Cacheados
// separadamente e primeiro, pra garantir que entrem no cache mesmo que
// algum outro arquivo da lista abaixo falhe.
const CRITICAL_OFFLINE_ASSETS = [
    '/offline.html',
    '/assets/offline.webp',
];

// Demais arquivos essenciais de UI que continuam existindo no repositório (não são zipados).
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
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            // IMPORTANTE: usamos cache.add() individual (em Promise.all), e NÃO
            // cache.addAll(). O addAll() é tudo-ou-nada: se UM único arquivo da
            // lista falhar (404, redirect, timeout, CDN lento no deploy...), a
            // lista inteira falha e NADA é salvo no cache — inclusive o
            // offline.html, que é justamente o motivo desse mecanismo existir.
            // Cacheando um por um, uma falha isolada não derruba os outros.

            // 1) Primeiro os arquivos da tela offline (críticos).
            await Promise.all(
                CRITICAL_OFFLINE_ASSETS.map(url =>
                    cache.add(url).then(
                        () => console.log(`✅ [SW] Offline asset cacheado: ${url}`),
                        err => console.error(`🚨 [SW] FALHA AO CACHEAR ASSET CRÍTICO (${url}):`, err)
                    )
                )
            );

            // 2) Depois o resto da UI essencial.
            await Promise.all(
                ASSETS_TO_PRECACHE.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`⚠️ [SW] Falha ao precachear ${url}:`, err)
                    )
                )
            );

            console.log('🔥 [SW] Precache concluído.');
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.map(key => {
                    // PROTEÇÃO MÁXIMA: apaga caches velhos, mas nunca o atual nem o dos ZIPs/versões!
                    if (key !== CACHE_NAME && key !== CACHE_ZIP_ASSETS) {
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
        event.respondWith(
            fetch(request).catch(err => {
                console.warn('📡 [SW] Navegação falhou (provavelmente offline):', err);
                return caches.match('/offline.html', { ignoreSearch: true }).then(offlinePage => {
                    if (!offlinePage) {
                        console.error('🚨 [SW] offline.html NÃO estava no cache! Verifique o precache no install.');
                    }
                    return offlinePage || new Response('Sem conexão com a internet.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                });
            })
        );
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
