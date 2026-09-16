// sw.js

const CACHE_NAME = 'aden-rpg-assets-v55'; // Mude isso quando alterar a lista de precache (UI essencial)
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
        (async () => {
            const cache = await caches.open(CACHE_NAME);

            // 1) Assets críticos da tela offline: se QUALQUER um destes falhar,
            //    cancelamos a instalação inteira (deixamos o erro propagar).
            //    É proposital: é melhor manter o Service Worker anterior
            //    funcionando do que ativar uma versão nova sem offline.html.
            //    cache: 'reload' ignora qualquer cópia guardada no cache HTTP
            //    do navegador/CDN, forçando buscar os bytes atuais da rede.
            await Promise.all(
                CRITICAL_OFFLINE_ASSETS.map(async url => {
                    const response = await fetch(url, { cache: 'reload' });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status} ao buscar asset crítico: ${url}`);
                    }

                    // IMPORTANTE: se esse fetch passou por QUALQUER redirecionamento
                    // (normalização de URL, http->https, barra final, etc.), o Chrome
                    // marca a Response como "redirected". Uma Response redirecionada
                    // NÃO pode, depois, ser usada pra responder a uma NAVEGAÇÃO — o
                    // Chrome recusa com "a redirected response was used for a request
                    // whose redirect mode is not follow" e cai no erro padrão do
                    // navegador (era exatamente o nosso bug). Por isso reconstituímos
                    // a resposta do zero (mesmo corpo/status/headers, sem a marcação
                    // de redirecionamento) antes de guardar no cache.
                    const body = await response.blob();
                    const cacheableResponse = new Response(body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });

                    await cache.put(url, cacheableResponse);
                    console.log(
                        `✅ [SW] Offline asset cacheado: ${url}` +
                        (response.redirected ? ' (era redirecionado — normalizado antes de cachear)' : '')
                    );
                })
            );

            // 2) Demais arquivos essenciais de UI. Aqui sim, uma falha isolada
            //    NÃO derruba os outros nem cancela a instalação — não são
            //    críticos pra tela offline funcionar.
            await Promise.all(
                ASSETS_TO_PRECACHE.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`⚠️ [SW] Falha ao precachear ${url}:`, err)
                    )
                )
            );

            console.log('🔥 [SW] Precache concluído.');
        })().catch(err => {
            console.error('🚨 [SW] Instalação CANCELADA — asset crítico não pôde ser cacheado:', err);
            throw err; // propaga: SW novo fica "redundant", o anterior continua ativo
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
        event.respondWith((async () => {
            const showOfflinePage = async () => {
                const cache = await caches.open(CACHE_NAME);
                const offlinePage = await cache.match('/offline.html');
                if (!offlinePage) {
                    console.error('🚨 [SW] offline.html NÃO estava no cache! Verifique o precache no install.');
                }
                return offlinePage || new Response('Sem conexão com a internet.', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            };

            try {
                const response = await fetch(request);
                // Servidor respondeu, mas com erro (ex: 500/502/503) — trata
                // como "sem conexão" também, não só falha total de rede.
                if (response.status >= 500) {
                    console.warn(`📡 [SW] Servidor retornou ${response.status} na navegação.`);
                    return await showOfflinePage();
                }
                return response;
            } catch (err) {
                console.warn('📡 [SW] Navegação falhou (provavelmente offline):', err);
                return await showOfflinePage();
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
