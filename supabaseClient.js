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

(function() {
    console.log("🛡️ Monitor de Egress Supabase Iniciado (Fetch + WebSocket)");

    // --- CONFIGURAÇÃO ---
    const LOG_TABLE = 'rpc_logs'; // Nome da sua tabela de logs
    const IGNORE_URLS = [LOG_TABLE, 'intake.supabase.co']; // URLs para ignorar (evita loop infinito)

    // ---------------------------------------------------------
    // 1. MONITOR DE HTTP (REST, Auth, Selects, RPCs)
    // ---------------------------------------------------------
    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
        const [resource, config] = args;
        const urlStr = resource.toString();

        // 🛑 EVITA LOOP INFINITO: Não monitora as requisições de log
        if (IGNORE_URLS.some(x => urlStr.includes(x))) {
            return originalFetch(...args);
        }

        let response;
        try {
            response = await originalFetch(...args);
        } catch (error) {
            return Promise.reject(error);
        }

        // Clona a resposta para ler o tamanho sem "consumir" o original para a aplicação
        const clone = response.clone();
        
        clone.blob().then(blob => {
            const size = blob.size; // Tamanho exato em bytes do body
            const method = config?.method || 'GET';
            
            // Tenta extrair um nome útil da URL (ex: tabela ou função)
            // Ex URL: https://xyz.supabase.co/rest/v1/minha_tabela?select=*
            let functionName = "unknown";
            try {
                const urlObj = new URL(urlStr);
                const pathParts = urlObj.pathname.split('/');
                functionName = pathParts[pathParts.length - 1] || "root";
                
                // Se for query params, adiciona para contexto
                if (urlObj.search) functionName += ` (query)`;
            } catch (e) {}

            console.log(`📡 [HTTP] ${method} ${functionName} - ${size} bytes`);

            // Envia para o Supabase (sem usar await para não travar a UI)
            logToSupabase(`http_${method}_${functionName}`, size);
        }).catch(err => console.error("⚠️ Erro ao calcular tamanho do fetch:", err));

        return response;
    };

    // ---------------------------------------------------------
    // 2. MONITOR DE WEBSOCKET (Realtime / Subscriptions)
    // ---------------------------------------------------------
    const OriginalWebSocket = window.WebSocket;

    window.WebSocket = class extends OriginalWebSocket {
        constructor(url, protocols) {
            super(url, protocols);
            
            // Verifica se é um socket do Supabase Realtime
            if (url.toString().includes('supabase') || url.toString().includes('realtime')) {
                this.addEventListener('message', (event) => {
                    // O tamanho do payload recebido via socket
                    const size = new Blob([event.data]).size;
                    
                    //console.log(`⚡ [WS] Realtime Msg - ${size} bytes`);
                    
                    // Opcional: Logar agrupado para não spammar o banco
                    // Aqui estamos logando cada mensagem, cuidado com volume!
                    logToSupabase('realtime_msg', size);
                });
            }
        }
    };

    // ---------------------------------------------------------
    // 3. FUNÇÃO AUXILIAR DE LOG (Segura)
    // ---------------------------------------------------------
    async function logToSupabase(name, bytes) {
        // Usa o cliente supabase global se disponível, ou faz um fetch manual
        // Fazendo fetch manual para garantir que usa a tabela correta e cabeçalhos mínimos
        
        if (typeof supabase === 'undefined') {
            console.warn("⚠️ Cliente 'supabase' não encontrado no escopo global.");
            return;
        }

        try {
            // Importante: Isso vai passar pelo nosso 'fetch' override, 
            // mas cairá no filtro IGNORE_URLS, evitando loop.
            await supabase.from(LOG_TABLE).insert({
                function_name: name,
                size_bytes: bytes
            });
        } catch (e) {
            console.error("❌ Falha ao salvar log de egress:", e);
        }
    }

})();