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

console.log("🔧 Override supabase.rpc ativado!");

try {
    const rpcOriginal = supabase.rpc.bind(supabase);

    supabase.rpc = async (name, params) => {
        console.log("🔎 RPC chamada:", name, params);

        let res;
        try {
            res = await rpcOriginal(name, params);
        } catch (e) {
            console.error("❌ Erro ao executar RPC original:", name, e);
            throw e;
        }

        try {
            const size = JSON.stringify(res?.data ?? null).length;

            supabase
                .from('rpc_logs')
                .insert({
                    function_name: name,
                    size_bytes: size
                })
                .then(() => console.log("📘 [RPC LOG] registro inserido:", name))
                .catch((e) => console.error("❌ [RPC LOG] erro ao inserir:", e));

        } catch (e) {
            console.error("❌ Erro ao medir tamanho ou logar:", e);
        }

        return res;
    };

} catch (e) {
    console.error("❌ Falha ao aplicar override supabase.rpc:", e);
}

console.log("🔧 Override supabase.from().select() ativado!");

try {
    const fromOriginal = supabase.from.bind(supabase);

    supabase.from = (table_name) => {
        const fromObject = fromOriginal(table_name);
        const selectOriginal = fromObject.select.bind(fromObject);

        fromObject.select = (columns) => {
            const selectObject = selectOriginal(columns);
            const thenOriginal = selectObject.then.bind(selectObject);

            // Substitui o método .then() para interceptar o resultado da query
            selectObject.then = async (onFulfilled, onRejected) => {
                let res;
                try {
                    // Executa a query original
                    res = await thenOriginal(onFulfilled, onRejected);
                } catch (e) {
                    console.error("❌ Erro ao executar SELECT original:", table_name, e);
                    throw e;
                }

                try {
                    // Métrica de Egress: mede o tamanho da resposta
                    const size = JSON.stringify(res?.data ?? null).length;

                    // Registra a chamada na sua tabela de logs
                    supabase
                        .from('rpc_logs') // Usando a mesma tabela para simplificar
                        .insert({
                            function_name: `select_${table_name}`,
                            size_bytes: size
                        })
                        .then(() => console.log("📘 [SELECT LOG] registro inserido:", table_name))
                        .catch((e) => console.error("❌ [SELECT LOG] erro ao inserir:", e));

                } catch (e) {
                    console.error("❌ Erro ao medir tamanho ou logar o SELECT:", e);
                }

                return res;
            };

            return selectObject;
        };

        return fromObject;
    };

} catch (e) {
    console.error("❌ Falha ao aplicar override supabase.from():", e);
}