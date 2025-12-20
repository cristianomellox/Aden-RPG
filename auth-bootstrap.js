// auth-bootstrap.js
(async () => {

  const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[AUTH] Supabase SDK não encontrado');
    return;
  }

  // =====================================================
  // 0️⃣ RESET LÓGICO VERSIONADO (ANTI TOKEN ZUMBI)
  // =====================================================
  const CACHE_SCHEMA_VERSION = 3; // ← incremente SEMPRE que mudar auth/cache
  const SCHEMA_KEY = 'aden_cache_schema_version';

  try {
    const currentVersion = Number(localStorage.getItem(SCHEMA_KEY) || 0);

    if (currentVersion !== CACHE_SCHEMA_VERSION) {
      console.warn('[AUTH] Mudança de schema detectada. Limpando caches antigos.');

      // Preserva dados importantes
      const preserved = {};
      [
        'googtrans',
        'aden_intro_seen_v31',
        'aden_intro_seen_v30'
      ].forEach(k => preserved[k] = localStorage.getItem(k));

      localStorage.clear();

      Object.entries(preserved).forEach(([k, v]) => {
        if (v !== null) localStorage.setItem(k, v);
      });

      localStorage.setItem(SCHEMA_KEY, CACHE_SCHEMA_VERSION);
    }
  } catch (e) {
    console.error('[AUTH] Falha no reset versionado', e);
  }

  // =====================================================
  // 1️⃣ Inicializa Supabase
  // =====================================================
  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  // =====================================================
  // 2️⃣ Resolver userId (FONTE ÚNICA DA VERDADE)
  // =====================================================
  async function resolveUserId() {

    // A) Cache do jogo (player_data_cache)
    try {
      const cached = JSON.parse(localStorage.getItem('player_data_cache'));
      if (cached?.data?.id && cached.expires > Date.now()) {
        return cached.data.id;
      }
    } catch {}

    // B) Cache interno do Supabase (sem rede)
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          const session = JSON.parse(localStorage.getItem(key));
          if (session?.user?.id) return session.user.id;
        }
      }
    } catch {}

    // C) Rede (último recurso)
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) return session.user.id;
    } catch {}

    return null;
  }

  // =====================================================
  // 3️⃣ Garantir player_data_cache
  // =====================================================
  async function ensurePlayerCache(userId) {
    if (!userId) return null;

    try {
      const existing = localStorage.getItem('player_data_cache');
      if (existing) {
        const parsed = JSON.parse(existing);
        if (parsed?.data?.id === userId && parsed.expires > Date.now()) {
          return parsed.data;
        }
      }
    } catch {}

    const { data, error } = await supabase
      .from('players')
      .select('id, xp, gold, level')
      .eq('id', userId)
      .single();

    if (error || !data) {
      console.error('[AUTH] Falha ao criar player_data_cache', error);
      return null;
    }

    const cachePayload = {
      data,
      expires: Date.now() + (24 * 60 * 60 * 1000) // 24h
    };

    localStorage.setItem(
      'player_data_cache',
      JSON.stringify(cachePayload)
    );

    return data;
  }

  // =====================================================
  // 4️⃣ Execução do Bootstrap
  // =====================================================
  const userId = await resolveUserId();

  if (!userId) {
    console.warn('[AUTH] Usuário não autenticado');
    window.__AUTH__ = {
      ready: false,
      userId: null,
      supabase
    };
    return;
  }

  const playerData = await ensurePlayerCache(userId);

  window.__AUTH__ = {
    ready: true,
    userId,
    playerData,
    supabase
  };

  console.log('[AUTH] Bootstrap concluído com sucesso:', userId);

})();
