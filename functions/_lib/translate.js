// functions/_lib/translate.js
//
// Módulo compartilhado de tradução — importado por _middleware.js e por
// compartilhar.js, pra existir UMA função só que sabe como chamar a
// Workers AI (mesmo modelo/formato que o worker de push já usa:
// @cf/meta/m2m100-1.2b, com source_lang: 'pt'). Assim, se um dia trocar de
// modelo/provedor, muda só aqui.
//
// Arquivos que começam com "_" dentro de functions/ não viram rota própria
// — só podem ser importados por outros arquivos de function. É por isso
// que este arquivo fica em functions/_lib/ e não responde a nenhuma URL.

export const SUPPORTED_LANGS = ["pt","en","es","zh-CN","ja","ko","id","tl","ru","it","fr","hi","ms","vi","ar"];
export const DEFAULT_LANG = "pt";

// Mesma exceção do worker de push: m2m100 não tem variante regional de
// chinês, só "zh".
const LANG_CODE_TO_M2M = {
  'zh-CN': 'zh',
};

export function isValidLang(lang) {
  return typeof lang === "string" && SUPPORTED_LANGS.includes(lang);
}

// Traduz UM texto. Em qualquer falha (binding ausente, timeout, resposta
// vazia), devolve null — quem chama decide o fallback (normalmente: manter
// o texto original em PT, tradução nunca pode quebrar o compartilhamento).
export async function translateText(text, targetLang, env) {
  if (!text) return null;
  if (!targetLang || targetLang === DEFAULT_LANG) return text;
  if (!env.AI) {
    console.warn("[translate] Binding AI não configurado nesta function — devolvendo texto em PT.");
    return null;
  }
  const m2mLang = LANG_CODE_TO_M2M[targetLang] || targetLang;
  try {
    const result = await env.AI.run('@cf/meta/m2m100-1.2b', {
      text,
      source_lang: 'pt',
      target_lang: m2mLang,
    });
    return (result && result.translated_text) || null;
  } catch (e) {
    console.warn(`[translate] Falha ao traduzir pra "${targetLang}":`, e);
    return null;
  }
}

// Traduz várias strings de uma vez (objeto { chave: textoPT }), em
// paralelo. Item que falhar cai pro texto original em PT — nunca lança.
export async function translateStrings(strings, targetLang, env) {
  if (!targetLang || targetLang === DEFAULT_LANG) return { ...strings };
  const keys = Object.keys(strings);
  const translations = await Promise.all(
    keys.map(key => translateText(strings[key], targetLang, env))
  );
  const result = {};
  keys.forEach((key, i) => {
    result[key] = translations[i] || strings[key];
  });
  return result;
}
