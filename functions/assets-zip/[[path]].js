// functions/assets-zip/[[path]].js
//
// Proxy same-origin pros zips de assets hospedados no GitHub Releases.
//
// Por quê isso existe: os binários de Release do GitHub não enviam
// header Access-Control-Allow-Origin em NENHUM ponto da cadeia (nem no
// redirect de github.com, nem na resposta final do
// release-assets.githubusercontent.com). Isso significa que um fetch()
// direto do navegador pra essa URL é bloqueado pelo próprio navegador,
// mesmo que a requisição "funcione" do lado do servidor.
//
// A correção é fazer essa busca aqui no edge da Cloudflare (fetch
// servidor-pra-servidor não sofre CORS) e devolver o arquivo como se ele
// fosse servido pelo seu próprio domínio — pro navegador, é uma
// requisição same-origin, sem CORS envolvido.
//
// Rota: /assets-zip/{tag}/{filename}.zip  (capturado via [[path]], um
// único arquivo — evitamos pastas aninhadas com colchetes tipo
// assets-zip/[tag]/[filename].js, que quebrou o build da Cloudflare
// Pages e derrubou o site inteiro, não só essa rota).
// Ex:   /assets-zip/v1.0/sons.zip
//       -> busca https://github.com/cristianomellox/Aden-RPG/releases/download/v1.0/sons.zip

const GITHUB_OWNER = 'cristianomellox';
const GITHUB_REPO = 'Aden-RPG';

const TAG_PATTERN = /^v[0-9]+(\.[0-9]+){0,2}$/;
const FILENAME_PATTERN = /^[\w-]+\.zip$/;

export async function onRequestGet({ params }) {
    return handleRequest(params, 'GET');
}

// HEAD: usado pelo loading.js pra descobrir o tamanho total do download
// (Content-Length) ANTES de baixar de verdade — é o que alimenta o modal
// de confirmação ("Download de X MB necessário") e a barra de progresso
// geral, sem gastar banda nenhuma pra isso.
export async function onRequestHead({ params }) {
    return handleRequest(params, 'HEAD');
}

async function handleRequest(params, method) {
    // params.path vem como array de segmentos: ["v1.0", "sons.zip"]
    const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);

    if (segments.length !== 2) {
        return new Response('Requisição inválida.', { status: 400 });
    }

    const [tag, filename] = segments;

    if (!TAG_PATTERN.test(tag) || !FILENAME_PATTERN.test(filename)) {
        return new Response('Requisição inválida.', { status: 400 });
    }

    const githubUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/${filename}`;

    let upstreamResponse;
    try {
        upstreamResponse = await fetch(githubUrl, { method, redirect: 'follow' });
    } catch (err) {
        return new Response('Erro ao buscar o arquivo no GitHub.', { status: 502 });
    }

    if (!upstreamResponse.ok) {
        return new Response(`Arquivo não encontrado (${upstreamResponse.status}).`, {
            status: upstreamResponse.status === 404 ? 404 : 502
        });
    }

    const headers = new Headers();
    const contentLength = upstreamResponse.headers.get('Content-Length');
    const contentType = upstreamResponse.headers.get('Content-Type') || 'application/octet-stream';
    if (contentLength) headers.set('Content-Length', contentLength);
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    return new Response(method === 'HEAD' ? null : upstreamResponse.body, {
        status: 200,
        headers
    });
}
