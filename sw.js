// sw.js

const CACHE_NAME = 'aden-rpg-assets-v25'; // v24: ícone da notificação pode vir do payload ("icon", ex: avatar de quem mandou a mensagem)
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
    '/manifest.json',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/assets/notification-icon-192.png',
    '/assets/badge-icon.png',
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

// =========================================================
// >>> PUSH NOTIFICATIONS <<<
// =========================================================
// Quando o backend enviar um push (mensagem privada, evento de horário
// marcado, etc.), este handler exibe a notificação.
//
// payload esperado (todos os campos com fallback, "image" e "icon" opcionais):
// { title, body, url, image, icon }
// "image" é o banner grande (tipo YouTube/jogos) — se ausente, a notificação
// aparece normalmente só com título + texto + ícone.
// "icon" é o ícone quadrado exibido no corpo da notificação (ex: avatar de
// quem mandou a mensagem privada) — se ausente, usa o ícone padrão do jogo.
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
        // Ícone maior exibido no corpo da notificação. Se o payload trouxer
        // um "icon" (ex: avatar de quem enviou a mensagem privada), usamos
        // ele; senão cai no ícone padrão do jogo.
        icon: payload.icon || '/assets/notification-icon-192.png',
        badge: '/assets/badge-icon.png',            // ícone pequeno da status bar (Android tinge de branco/tema)
        data: { url: payload.url || '/index.html' },
        vibrate: [200, 100, 200],

renotify: true,
        tag: payload.tag || 'aden-notification',
        timestamp: Date.now(),
        // requireInteraction: false 
        
};
    // Banner grande (proporção 2:1, ex: 1024x512), opcional por evento.
    if (payload.image) {
        options.image = payload.image;
    }

    event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Ao tocar na notificação, foca uma aba já aberta do jogo ou abre uma nova.
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
