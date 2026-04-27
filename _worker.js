export default {
  async fetch(request, env) {
    const ua = request.headers.get('User-Agent') || '';
    const isFacebookBot = ua.includes('facebookexternalhit') || ua.includes('Facebot');

    if (isFacebookBot) {
      // Serve HTML mínimo só com OG tags para o bot do Facebook
      return new Response(`<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://aden-rpg.pages.dev/download">
  <meta property="og:title" content="Download Aden RPG Online | Jogo Mobile Estratégico Grátis">
  <meta property="og:description" content="Baixe Aden RPG Online para Android. RPG estratégico com guerras de guildas, economia real e sem Pay-to-Win. Forje seu legado!">
  <meta property="og:image" content="https://aden-rpg.pages.dev/assets/aden_ini.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Aden RPG Online">
</head>
<body></body>
</html>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Usuários normais recebem a página original
    return env.ASSETS.fetch(request);
  }
};