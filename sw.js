// AUMENTE ESTE NÚMERO SEMPRE QUE FIZER UMA ATUALIZAÇÃO NO JOGO (V1 -> V2 -> V3...)
// Se você não mudar isso, os jogadores continuarão vendo a versão antiga!
const CACHE_NAME = "aden-static-v12";

// Arquivos vitais para o jogo abrir (App Shell)
const STATIC_FILES = [
  "https://aden-rpg.pages.dev/",
  "https://aden-rpg.pages.dev/index.html",
  "https://aden-rpg.pages.dev/afk.html",
  "https://aden-rpg.pages.dev/arena.html",
  "https://aden-rpg.pages.dev/guild.html",
  "https://aden-rpg.pages.dev/guild_battle.html",
  "https://aden-rpg.pages.dev/inventory.html",
  "https://aden-rpg.pages.dev/mines.html",
  "https://aden-rpg.pages.dev/politica_de_privacidade.html",
  "https://aden-rpg.pages.dev/termos_de_uso.html",
  "https://aden-rpg.pages.dev/tutorial.html",
  "https://aden-rpg.pages.dev/sobre.html",
  "https://aden-rpg.pages.dev/suporte.html",

  // Scripts
  "https://aden-rpg.pages.dev/script.js",
  "https://aden-rpg.pages.dev/arena.js",
  "https://aden-rpg.pages.dev/mines.js",
  "https://aden-rpg.pages.dev/guild.js",
  "https://aden-rpg.pages.dev/guild_battle.js",
  "https://aden-rpg.pages.dev/inventory.js",
  "https://aden-rpg.pages.dev/loading.js",
  "https://aden-rpg.pages.dev/loading2.js",
  "https://aden-rpg.pages.dev/auto_translate.js",
  "https://aden-rpg.pages.dev/number_format.js",
  "https://aden-rpg.pages.dev/perfil_edit.js",
  "https://aden-rpg.pages.dev/playerModal.js",
  "https://aden-rpg.pages.dev/map_hotspots.js",
  "https://aden-rpg.pages.dev/monster_stages.js",
  "https://aden-rpg.pages.dev/reward.js",
  "https://aden-rpg.pages.dev/visibility.js",
  "https://aden-rpg.pages.dev/supabaseClient.js",

  // Estilos
  "https://aden-rpg.pages.dev/style.css",
  "https://aden-rpg.pages.dev/arena.css",
  "https://aden-rpg.pages.dev/guild.css",
  "https://aden-rpg.pages.dev/inventory.css",
  "https://aden-rpg.pages.dev/mines.css",
  "https://aden-rpg.pages.dev/guild_battle.css"
];

// Instalação: Baixa os arquivos essenciais imediatamente
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("[SW] Caching App Shell");
      return cache.addAll(STATIC_FILES);
    })
  );
  self.skipWaiting(); // Ativa o SW imediatamente, não espera fechar a aba
});

// Ativação: Limpa caches antigos (importante para updates)
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim(); // Assume controle de todas as abas abertas
});

// Interceptação de Requisições
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. REGRA DE OURO: IGNORAR SUPABASE COMPLETAMENTE
  // Deixe que seu GlobalDB (IndexedDB) cuide dos dados. O SW não deve se meter aqui.
  if (url.hostname.includes("supabase.co")) {
    return; // Passa direto para a rede
  }

  // 2. Cache First para Arquivos Estáticos (Imagens, Sons, Scripts do App)
  // Isso inclui seus arquivos locais e os assets hospedados em aden-rpg.pages.dev
  if (
    STATIC_FILES.includes(url.pathname) || 
    url.href.includes("aden-rpg.pages.dev/assets/") ||
    request.destination === "image" ||
    request.destination === "audio" ||
    request.destination === "video" ||
    request.destination === "font" ||
    request.destination === "script" ||
    request.destination === "style"
  ) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        // Se achou no cache, retorna rápido!
        if (cachedResponse) return cachedResponse;

        // Se não, baixa, salva no cache e retorna
        return fetch(request).then(networkResponse => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
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
    return;
  }

  // 3. o resto (chamadas externas desconhecidas, analytics, etc): Rede primeiro
  event.respondWith(fetch(request));
});