// functions/_middleware.js
//
// Roda em toda requisição do Cloudflare Pages. Sem KV — como o
// compartilhamento não é uma ação frequente, cada requisição que precisa
// de tradução simplesmente chama a Workers AI na hora (mesmo modelo já
// usado pelo worker de push: @cf/meta/m2m100-1.2b). Se você notar volume
// alto no futuro (Analytics do Pages Functions) e quiser reduzir custo de
// neurons, dá pra reintroduzir cache com KV depois — mas por enquanto fica
// simples assim.
//
// Faz duas coisas:
//
// 1) GET /api/share-meta?lang=xx
//    Retorna JSON { title, description, shareText } traduzidos.
//    Usado pelo modal de Compartilhar (index.html) pra montar o texto que
//    vai pro WhatsApp/Telegram/Twitter/Reddit no idioma do jogador — sem
//    nenhuma página duplicada por idioma.
//
// 2) Qualquer página HTML com "?lang=xx" na URL (ex.: /download?lang=es):
//    Reescreve as tags <meta og:*>, <meta twitter:*> e <meta name="description">
//    da resposta ANTES de devolver ao navegador. É isso que faz o preview
//    (imagem/título/descrição) aparecer traduzido quando alguém abre o link
//    compartilhado no WhatsApp/Telegram/Facebook/Twitter — esses apps
//    buscam a página com um bot que NÃO executa JavaScript nem lê cookies,
//    então a tradução via Google Translate (client-side) nunca chegaria
//    até eles. Fazer isso no edge é o único jeito sem duplicar HTML.
//
// ── CONFIGURAÇÃO NECESSÁRIA NO PAINEL DO CLOUDFLARE PAGES ──
//   Settings > Functions > Bindings > adicionar binding de Workers AI:
//     Variable name: AI
//   (o mesmo tipo de binding que o worker de push já usa — só precisa
//   habilitar aqui também, no projeto Pages, não tem custo/conta extra.)
//   Não precisa de KV nem de nenhuma outra configuração.

const SUPPORTED_LANGS = ["pt","en","es","zh-CN","ja","ko","id","tl","ru","it","fr","hi","ms","vi","ar"];
const DEFAULT_LANG = "pt";

// Mesma exceção usada no worker de push: m2m100 não tem variante regional
// de chinês, só "zh".
const LANG_CODE_TO_M2M = {
  'zh-CN': 'zh',
};

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

function isValidLang(lang) {
  return typeof lang === "string" && SUPPORTED_LANGS.includes(lang);
}

// Idêntica à função translateText() do worker de push — mesmo modelo,
// mesmo formato de chamada — só pra manter uma única "fonte da verdade"
// de como o site traduz texto em todo lugar.
async function translateText(text, targetLangM2M, env) {
  const result = await env.AI.run('@cf/meta/m2m100-1.2b', {
    text,
    source_lang: 'pt',
    target_lang: targetLangM2M,
  });
  return (result && result.translated_text) || null;
}

// Traduz todas as strings-fonte pro idioma pedido. Sem cache: chama a IA
// a cada request. Em qualquer falha (binding ausente, timeout, resposta
// incompleta), devolve o texto original em PT — tradução nunca pode
// quebrar o compartilhamento.
async function getTranslatedStrings(env, lang) {
  if (!lang || lang === DEFAULT_LANG) return SOURCE_STRINGS;
  if (!env.AI) {
    console.warn("[share-meta] Binding AI não configurado — devolvendo texto em PT.");
    return SOURCE_STRINGS;
  }

  const m2mLang = LANG_CODE_TO_M2M[lang] || lang;
  const keys = Object.keys(SOURCE_STRINGS);

  try {
    const translations = await Promise.all(
      keys.map(key => translateText(SOURCE_STRINGS[key], m2mLang, env))
    );
    const result = {};
    keys.forEach((key, i) => {
      result[key] = translations[i] || SOURCE_STRINGS[key]; // fallback item a item
    });
    return result;
  } catch (e) {
    console.warn(`[share-meta] Falha ao traduzir pra "${lang}", devolvendo PT:`, e);
    return SOURCE_STRINGS;
  }
}

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

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // ── Rota 1: API de texto de compartilhamento ──
  if (url.pathname === "/api/share-meta") {
    const lang = url.searchParams.get("lang") || DEFAULT_LANG;
    if (!isValidLang(lang)) {
      return new Response(JSON.stringify({ error: "idioma_invalido" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const strings = await getTranslatedStrings(env, lang);
    return new Response(JSON.stringify({
      title: strings.ogTitle,
      description: strings.ogDescription,
      shareText: strings.shareText,
    }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store", // sem KV — não faz sentido cachear no browser também
      },
    });
  }

  // ── Rota 2: qualquer página HTML com ?lang=xx → reescreve meta tags ──
  const lang = url.searchParams.get("lang");
  const response = await next();

  const contentType = response.headers.get("content-type") || "";
  if (!lang || !isValidLang(lang) || lang === DEFAULT_LANG || !contentType.includes("text/html")) {
    return response;
  }

  const strings = await getTranslatedStrings(env, lang);
  const rewriter = new HTMLRewriter()
    .on("meta", new MetaTagRewriter(strings, url.toString()))
    .on("html", new HtmlLangRewriter(lang));

  return rewriter.transform(response);
}
