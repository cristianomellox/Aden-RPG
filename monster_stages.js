// monster_stages.js

// Definição do array de URLs das imagens de monstros.
// Este array contém as 26 imagens únicas que você forneceu.
const monsterStageImages = [
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk01.webp', // 1
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk02.webp', // 2
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk03.webp', // 3
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk04.webp', // 4
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk05.webp', // 5
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk06.webp', // 6
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk07.webp', // 7
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk08.webp', // 8
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk09.webp', // 9
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk10.webp', // 10
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk11.webp', // 11
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk12.webp', // 12
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/goblin_afk.png',   // 13
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk13.webp', // 14
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk14.webp', // 15
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk15.webp', // 16
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk16.webp', // 17
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk17.webp', // 18
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk18.webp', // 19
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk19.webp', // 20
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk20.webp', // 21
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk21.webp', // 22
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk22.webp', // 23
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk23.webp', // 24
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk24.webp', // 25
    'https://raw.githubusercontent.com/cristianomellox/Aden-RPG/af1d554b94da04899b557b5747ca040a9c4ccda3/monster_afk25.webp'  // 26
];

// Função para atualizar a imagem do monstro com base no estágio
function updateMonsterImageByStage() {
    const monsterImageElement = document.getElementById('monsterImage');
    // currentAfkStage é uma variável definida em afk_script.js, assumimos que está disponível
    if (monsterImageElement && typeof currentAfkStage !== 'undefined') {
        // Usa o operador módulo (%) para ciclar pelas imagens no array.
        // O estágio 1 corresponde ao índice 0.
        // Se currentAfkStage for 1, (1 - 1) % 26 = 0 (primeira imagem).
        // Se currentAfkStage for 26, (26 - 1) % 26 = 25 (última imagem).
        // Se currentAfkStage for 27, (27 - 1) % 26 = 0 (volta para a primeira imagem, repetindo o ciclo).
        const imageIndex = (currentAfkStage - 1) % monsterStageImages.length;
        monsterImageElement.src = monsterStageImages[imageIndex];
        console.log(`Imagem do monstro atualizada para o estágio ${currentAfkStage}: ${monsterImageElement.src}`);
    } else {
        console.error('Elemento "monsterImage" não encontrado ou "currentAfkStage" não definido.');
    }
}

// Adicionar um listener para o evento de início da aventura (acionado pelo botão)
document.addEventListener('DOMContentLoaded', () => {
    const startAdventureBtn = document.getElementById('startAdventureBtn');
    if (startAdventureBtn) {
        startAdventureBtn.addEventListener('click', updateMonsterImageByStage);
        console.log('Listener adicionado ao botão "Iniciar Aventura" para atualizar a imagem do monstro.');
    } else {
        console.error('Botão "Iniciar Aventura" não encontrado.');
    }
});

// Também podemos tentar atualizar a imagem quando as informações do jogador são carregadas (após login)
// para garantir que a imagem correta apareça se o AFK já estiver visível.
document.addEventListener('DOMContentLoaded', () => {
    // Sobrescreve a função original onPlayerInfoLoadedForAfk do script.js
    // para que a imagem do monstro seja atualizada depois que o jogador carregar.
    if (window.onPlayerInfoLoadedForAfk) {
        const originalOnPlayerInfoLoadedForAfk = window.onPlayerInfoLoadedForAfk;
        window.onPlayerInfoLoadedForAfk = (player) => {
            originalOnPlayerInfoLoadedForAfk(player); // Chama a função original
            // Se o jogador já estiver na tela AFK ou for para ela, atualiza a imagem inicial
            // Adicione um pequeno atraso para garantir que a visibilidade da tela tenha sido aplicada
            setTimeout(() => {
                if (document.getElementById('afkContainer').style.display === 'block' || document.getElementById('combatArea').style.display === 'block') {
                    updateMonsterImageByStage();
                }
            }, 100);
        };
    }
});

// Adiciona um observer para quando a seção de combate se torna visível (quando se muda de tela)
// Isso é uma redundância para garantir que a imagem seja atualizada,
// caso o 'click' do botão 'Iniciar Aventura' não a capture (e.g. se for acionado por outro script).
const observer = new MutationObserver((mutationsList, observer) => {
    for (const mutation of mutationsList) {
        if (mutation.type === 'style' && mutation.target.id === 'combatArea' && mutation.target.style.display === 'block') {
            updateMonsterImageByStage();
            // observer.disconnect(); // Descomente esta linha se você quiser que o observer só funcione uma vez
            break;
        }
    }
});

const combatAreaElement = document.getElementById('combatArea');
if (combatAreaElement) {
    observer.observe(combatAreaElement, { attributes: true, attributeFilter: ['style'] });
} else {
    console.error('Elemento "combatArea" não encontrado para observar.');
}