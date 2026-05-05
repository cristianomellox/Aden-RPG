/**
 * Cloudflare Pages Function — /compartilhar
 *
 * Serve uma página intermediária com OG meta tags dinâmicos do item.
 * Bots de redes sociais (WhatsApp, Telegram, Twitter, Facebook…) param aqui
 * e leem a og:image correta. Humanos são redirecionados instantaneamente
 * para /download via <meta http-equiv="refresh"> e window.location.replace.
 *
 * Query params esperados:
 *   acao     — "craft" | "level" | "refine"
 *   nome     — nome interno do item (usado no caminho da imagem)
 *   display  — nome de exibição (ex: "Espada do Dragão")
 *   estrelas — número de estrelas totais (ex: "5")
 *   nivel    — nível do item (só para acao=level)
 */
export async function onRequest(context) {
  const url      = new URL(context.request.url);
  const p        = url.searchParams;

  const acao     = p.get('acao')     || 'craft';
  const nome     = p.get('nome')     || 'item';      // nome interno → caminho da imagem
  const display  = p.get('display')  || nome;        // nome de exibição → textos
  const estrelas = p.get('estrelas') || '1';
  const nivel    = p.get('nivel')    || '';

  const BASE        = 'https://aden-rpg.pages.dev';
  const imageUrl    = `${BASE}/assets/itens/${nome}_${estrelas}estrelas.webp`;
  const downloadUrl = `${BASE}/download`;
  const siteUrl     = url.toString(); // URL canônica desta página (para og:url)

  // Monta título e descrição conforme a ação
  let titulo, descricao;
  if (acao === 'craft') {
    titulo    = `${display} criado! — Aden RPG`;
    descricao = `Acabei de criar ${display} em Aden RPG Online! Venha fazer parte dessa jornada! Baixe agora!`;
  } else if (acao === 'level') {
    titulo    = `${display} evoluído para Nível ${nivel}! — Aden RPG`;
    descricao = `Acabei de evoluir ${display} para o nível ${nivel} em Aden RPG Online! Venha fazer parte dessa jornada! Baixe agora!`;
  } else if (acao === 'refine') {
    titulo    = `${display} refinado para ${estrelas}★ — Aden RPG`;
    descricao = `Acabei de refinar ${display} para ${estrelas} ★ em Aden RPG Online! Venha fazer parte dessa jornada! Baixe agora!`;
  } else {
    titulo    = 'Aden RPG Online';
    descricao = 'Venha fazer parte dessa jornada em Aden RPG Online!';
  }

  // Escapa HTML para evitar injeção nos atributos dos meta tags
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${esc(titulo)}</title>

  <!-- ── Open Graph (WhatsApp, Facebook, Telegram, Discord…) ── -->
  <meta property="og:type"         content="website">
  <meta property="og:url"          content="${esc(siteUrl)}">
  <meta property="og:title"        content="${esc(titulo)}">
  <meta property="og:description"  content="${esc(descricao)}">
  <meta property="og:image"        content="${esc(imageUrl)}">
  <meta property="og:image:width"  content="512">
  <meta property="og:image:height" content="512">
  <meta property="og:site_name"    content="Aden RPG Online">
  <meta property="og:locale"       content="pt_BR">

  <!-- ── Twitter / X Card ── -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${esc(titulo)}">
  <meta name="twitter:description" content="${esc(descricao)}">
  <meta name="twitter:image"       content="${esc(imageUrl)}">

  <!-- ── Redirect imediato para humanos ── -->
  <meta http-equiv="refresh" content="0;url=${esc(downloadUrl)}">
</head>
<body>
  <script>window.location.replace('${downloadUrl}');</script>
  <p style="font-family:sans-serif;text-align:center;margin-top:40px">
    Redirecionando… <a href="${esc(downloadUrl)}">Clique aqui</a>
  </p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type':  'text/html;charset=UTF-8',
      // Cache curto: bots re-crawleiam raramente, mas não queremos dado obsoleto
      'Cache-Control': 'public, max-age=120, s-maxage=120',
    },
  });
}
