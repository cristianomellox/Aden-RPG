// AUMENTE ESTE NÚMERO SEMPRE QUE FIZER UMA ATUALIZAÇÃO NO JOGO (V1 -> V2 -> V3...)
// Se você não mudar isso, os jogadores continuarão vendo a versão antiga!
const CACHE_NAME = "aden-static-v2";

// Arquivos vitais para o jogo abrir (App Shell)
const STATIC_FILES = [
  "/",
  "/index.html",
  "/afk.html",
  "/arena.html",
  "/guild.html",
  "/guild_battle.html",
  "/inventory.html",
  "/mines.html",
  "/politica_de_privacidade.html",
  "/termos_de_uso.html",
  "/tutorial.html",
  "/sobre.html",
  "/suporte.html",

  // Scripts
  "/script.js",
  "/arena.js",
  "/mines.js",
  "/guild.js",
  "/guild_battle.js",
  "/inventory.js",
  "/loading.js",
  "/loading2.js",
  "/auto_translate.js",
  "/number_format.js",
  "/perfil_edit.js",
  "/playerModal.js",
  "/map_hotspots.js",
  "/monster_stages.js",
  "/reward.js",
  "/visibility.js",
  "/supabaseClient.js",

  // Estilos
  "/style.css",
  "/arena.css",
  "/guild.css",
  "/inventory.css",
  "/mines.css",
  "/guild_battle.css"
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

  // 3. Todo o resto (chamadas externas desconhecidas, analytics, etc): Rede primeiro
  event.respondWith(fetch(request));
});