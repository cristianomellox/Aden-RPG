export async function onRequestGet({ env }) {
  return Response.json({
    ok: true,
    temChave: Boolean(env.GEMINI_API_KEY)
  });
}
