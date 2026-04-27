// --- START OF FILE security.js ---

(function() {
    // Apenas ative em produção (se você precisar debugar, comente a chamada deste arquivo no HTML)

    // 1. Limpa o console a cada 1 segundo e exibe uma mensagem de alerta
    setInterval(() => {
        console.clear();
        // Mensagem de estilo no console
        setTimeout(console.log.bind(console, 
            "%c⚠️ ATENÇÃO! ⚠️\n%cEsta área é restrita para desenvolvedores do Aden RPG. Injetar scripts ou tentar modificar o jogo resultará em BANIMENTO PERMANENTE da sua conta.", 
            "color: red; font-size: 30px; font-weight: bold; text-shadow: 2px 2px 0 #000;", 
            "color: white; font-size: 16px; background: #222; padding: 10px; border-radius: 5px;"
        ), 10);
    }, 1000);

    // 2. Loop de Debugger (A "Armadilha")
    // Se o DevTools (F12) for aberto, o navegador vai pausar a execução do jogo constantemente,
    // tornando impossível para o jogador inspecionar a rede ou rodar scripts.
    setInterval(() => {
        (function() {
            return false;
        }['constructor']('debugger')());
    }, 200); // Roda a cada 200ms

    // 3. Bloqueia atalhos comuns para abrir o Inspecionar Elemento e Código Fonte
    document.addEventListener('keydown', function(e) {
        if (
            e.key === 'F12' || // F12
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) || // Ctrl+Shift+I
            (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j')) || // Ctrl+Shift+J
            (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) || // Ctrl+Shift+C
            (e.ctrlKey && (e.key === 'U' || e.key === 'u')) // Ctrl+U (Ver código fonte)
        ) {
            e.preventDefault();
            return false;
        }
    });

    // 4. Bloqueia o clique direito do mouse (Menu de Contexto -> Inspecionar)
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });

    // 5. Opcional: Sobrescreve as funções de console para que o jogo não vaze informações
    // Se algum erro do Supabase ocorrer, ele não aparecerá para o jogador.
    /*
    const noop = () => {};
    console.warn = noop;
    console.error = noop;
    console.info = noop;
    */
})();