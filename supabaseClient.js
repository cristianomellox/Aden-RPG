// Usando CDN para evitar problemas de arquivos locais faltando
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx'

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  }
)

// =======================================================================
// INÍCIO: MONITOR DE EGRESS (CORRIGIDO)
// =======================================================================
(function() {
    console.log("🛡️ Monitor de Egress Supabase Iniciado (Corrigido para 'supabaseClient')");

    const LOG_TABLE = 'rpc_logs'; 
    const IGNORE_URLS = [LOG_TABLE, 'intake.supabase.co']; 

    // 1. MONITOR DE HTTP (REST, Auth, Selects, RPCs)
    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
        const [resource, config] = args;
        const urlStr = resource ? resource.toString() : "";

        // 🛑 EVITA LOOP INFINITO
        if (IGNORE_URLS.some(x => urlStr.includes(x))) {
            return originalFetch(...args);
        }

        let response;
        try {
            response = await originalFetch(...args);
        } catch (error) {
            return Promise.reject(error);
        }

        const clone = response.clone();
        
        clone.blob().then(blob => {
            const size = blob.size;
            const method = config?.method || 'GET';
            
            let functionName = "unknown";
            try {
                const urlObj = new URL(urlStr);
                const pathParts = urlObj.pathname.split('/');
                functionName = pathParts[pathParts.length - 1] || "root";
                if (urlObj.search) functionName += ` (query)`;
            } catch (e) {}

            console.log(`📡 [HTTP] ${method} ${functionName} - ${size} bytes`);
            logToSupabase(`http_${method}_${functionName}`, size);
        }).catch(err => console.error("⚠️ Erro ao calcular tamanho do fetch:", err));

        return response;
    };

    // 2. MONITOR DE WEBSOCKET (Realtime)
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class extends OriginalWebSocket {
        constructor(url, protocols) {
            super(url, protocols);
            if (url.toString().includes('supabase') || url.toString().includes('realtime')) {
                this.addEventListener('message', (event) => {
                    const size = new Blob([event.data]).size;
                    logToSupabase('realtime_msg', size);
                });
            }
        }
    };

    // 3. FUNÇÃO DE LOG (CORRIGIDA)
    async function logToSupabase(name, bytes) {
        // CORREÇÃO AQUI: Verifica se 'supabaseClient' existe (usado no script.js)
        // Se não, tenta 'supabase' (usado em módulos), mas verifica se tem o método .from
        const client = (typeof supabaseClient !== 'undefined') ? supabaseClient : 
                       ((typeof supabase !== 'undefined' && typeof supabase.from === 'function') ? supabase : null);

        if (!client) {
            console.warn("⚠️ Cliente Supabase (supabaseClient) não encontrado. O log não será salvo.");
            return;
        }

        try {
            await client.from(LOG_TABLE).insert({
                function_name: name,
                size_bytes: bytes
            });
        } catch (e) {
            console.error("❌ Falha ao salvar log de egress:", e);
        }
    }
})();
// =======================================================================
// FIM DO MONITOR
// =======================================================================