// functions/_middleware.js
//
// Roda em toda requisição do Cloudflare Pages. Sem KV — como o
// compartilhamento não é uma ação frequente, cada requisição que precisa
// de tradução simplesmente chama a Workers AI na hora. Se um dia notar
// volume alto (Analytics do Pages Functions) e quiser reduzir custo de
// neurons, dá pra reintroduzir cache com KV depois — por enquanto fica
// simples assim.
//
// Faz três coisas:
//
// 1) GET /api/share-meta?lang=xx
//    Retorna JSON { title, description, shareText } traduzidos — texto
//    FIXO do jogo (usado pelo modal de Compartilhar do menu Opções, que
//    aponta pra /download). Sem pastas duplicadas por idioma.
//
// 2) POST /api/translate  { text: "...", lang: "xx" }
//    Endpoint genérico pra traduzir texto DINÂMICO (ex.: "Meus amigos e eu
//    estamos na Taverna X" — o nome da sala é livre, não dá pra
//    pré-traduzir). Usado pelas tavernas.
//
// 3) Qualquer página HTML com "?lang=xx" na URL (ex.: /download?lang=es):
//    Reescreve <meta og:*>, <meta twitter:*> e <meta name="description">
//    da resposta ANTES de devolver ao navegador — é o que faz o preview
//    aparecer traduzido quando alguém abre o link no WhatsApp/Telegram/
//    Facebook/Twitter (esses bots não executam JS nem leem cookies, então
//    o Google Translate client-side nunca chegaria até eles).
//    IMPORTANTE: NÃO se aplica a /compartilhar — essa rota já é uma Pages
//    Function própria (compartilhar.js) que gera OG tags DINÂMICOS por
//    item (craft/level/refine) e já traduz sozinha internamente. Se esse
//    middleware também tentasse reescrever a resposta dela, sobrescreveria
//    o título/descrição certos do item pelos textos genéricos do jogo.
//
// ── CONFIGURAÇÃO NECESSÁRIA NO PAINEL DO CLOUDFLARE PAGES ──
//   Settings > Functions > Bindings > adicionar binding de Workers AI:
//     Variable name: AI
//   Isso é PRECISO fazer aqui mesmo já existindo no worker de push — cada
//   Worker/Pages Function é um serviço separado na Cloudflare, cada um
//   precisa do binding declarado nele. É o mesmo produto (Workers AI, sem
//   custo/conta extra), só precisa "plugar" neste projeto também.
//   Não precisa de KV.

import { SUPPORTED_LANGS, DEFAULT_LANG, isValidLang, translateText, translateStrings } from './_lib/translate.js';

// Rotas que têm sua própria lógica de OG tags dinâmicos e NÃO devem ser
// tocadas pela reescrita genérica da Rota 3.
const SKIP_META_REWRITE_PATHS = ['/compartilhar'];

// Textos-fonte em PT — copiados exatamente das meta tags de download.html,
// que é a página de fato compartilhada (ver DOWNLOAD_PAGE no index.html).
const SOURCE_STRINGS = {
  metaDescription: "Baixe Aden RPG Online para Android. Um RPG estratégico profundo com guerras de guildas, economia real, chefes mundiais e sem Pay-to-Win. Estilo old-school de navegador. Forje seu legado!",
  ogTitle: "Download Aden RPG Online | Jogo Mobile Estratégico Grátis",
  ogDescription: "Baixe Aden RPG Online para Android. RPG estratégico com guerras de guildas, economia real e sem Pay-to-Win.",
  twitterTitle: "Aden RPG Online – Download",
  twitterDescription: "Entre no continente de Aden. Forje seu legado em batalhas épicas, guildas e um mundo repleto de segredos.",
  shareText: "Entre no continente de Aden! Um RPG estratégico épico – sem Pay-to-Win. Forje seu legado!",
};

// Reescreve as meta tags do <head> pro idioma solicitado
class MetaTagRewriter {
  constructor(strings, baseUrl) {
    this.strings = strings;
    this.baseUrl = baseUrl;
  }
  element(el) {
    const name = el.getAttribute("name");
    const prop = el.getAttribute("property");

    if (name === "description") el.setAttribute("content", this.strings.metaDescription);
    if (prop === "og:title") el.setAttribute("content", this.strings.ogTitle);
    if (prop === "og:description") el.setAttribute("content", this.strings.ogDescription);
    if (prop === "og:url") el.setAttribute("content", this.baseUrl);
    if (name === "twitter:title") el.setAttribute("content", this.strings.twitterTitle);
    if (name === "twitter:description") el.setAttribute("content", this.strings.twitterDescription);
    if (name === "twitter:url") el.setAttribute("content", this.baseUrl);
  }
}
class HtmlLangRewriter {
  constructor(lang) { this.lang = lang; }
  element(el) { el.setAttribute("lang", this.lang); }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // ── Rota 1: texto fixo de compartilhamento do jogo (/download) ──
  if (url.pathname === "/api/share-meta") {
    const lang = url.searchParams.get("lang") || DEFAULT_LANG;
    if (!isValidLang(lang)) return jsonResponse({ error: "idioma_invalido" }, 400);

    const strings = await translateStrings(SOURCE_STRINGS, lang, env);
    return jsonResponse({
      title: strings.ogTitle,
      description: strings.ogDescription,
      shareText: strings.shareText,
    });
  }

  // ── Rota 2: tradução genérica de texto dinâmico (tavernas etc.) ──
  if (url.pathname === "/api/translate" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "json_invalido" }, 400); }

    const { text, lang } = body || {};
    if (!text || typeof text !== 'string') return jsonResponse({ error: "texto_ausente" }, 400);
    if (!isValidLang(lang)) return jsonResponse({ error: "idioma_invalido" }, 400);

    const translated = await translateText(text, lang, env);
    return jsonResponse({ translated: translated || text });
  }

  // ── Rota 3: qualquer página HTML com ?lang=xx → reescreve meta tags ──
  if (SKIP_META_REWRITE_PATHS.includes(url.pathname)) {
    return next();
  }

  const lang = url.searchParams.get("lang");
  const response = await next();

  const contentType = response.headers.get("content-type") || "";
  if (!lang || !isValidLang(lang) || lang === DEFAULT_LANG || !contentType.includes("text/html")) {
    return response;
  }

  const strings = await translateStrings(SOURCE_STRINGS, lang, env);
  const rewriter = new HTMLRewriter()
    .on("meta", new MetaTagRewriter(strings, url.toString()))
    .on("html", new HtmlLangRewriter(lang));

  return rewriter.transform(response);
}
