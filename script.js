if ('serviceWorker' in navigator) {
  try {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (let reg of registrations) {
        reg.unregister().then(success => {
          if (success) console.log('Service Worker removido:', reg);
        }).catch(()=>{});
      }
    }).catch(()=>{});
  } catch(e) {}
}

const SUPABASE_URL = 'https://lqzlblvmkuwedcofmgfb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =======================================================================
// DADOS DO JOGADOR E DEFINIÇÕES DE MISSÃO
// =======================================================================
let currentPlayerId = null; // Armazena o ID do usuário logado
let currentPlayerData = null; // Armazena todos os dados do jogador (com bônus)

// Definições das Missões de Progressão (Client-side para UI)
const mission_definitions = {
    level: [
        { req: 2, item_id: 2, qty: 10, desc: "Alcance nível 2.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_de_ferro.webp" },
        { req: 3, item_id: 2, qty: 10, desc: "Alcance nível 3.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_de_ferro.webp" },
        { req: 4, item_id: 2, qty: 10, desc: "Alcance nível 4.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_de_ferro.webp" },
        { req: 5, item_id: 26, qty: 5, desc: "Alcance nível 5.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 10, item_id: 26, qty: 5, desc: "Alcance nível 10.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 15, item_id: 26, qty: 5, desc: "Alcance nível 15.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 20, item_id: 26, qty: 5, desc: "Alcance nível 20.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 25, item_id: 26, qty: 5, desc: "Alcance nível 25.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" },
        { req: 30, item_id: 26, qty: 5, desc: "Alcance nível 30.", img: "https://aden-rpg.pages.dev/assets/itens/fragmento_de_espada_da_justica.webp" }
    ],
    afk: [
        { req: 5, crystals: 100, qty: 100, desc: "Alcance o estágio 5 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 10, crystals: 500, qty: 500, desc: "Alcance o estágio 10 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 15, crystals: 1500, qty: 1500, desc: "Alcance o estágio 15 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 20, crystals: 2500, qty: 2500, desc: "Alcance o estágio 20 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 25, crystals: 3000, qty: 3000, desc: "Alcance o estágio 25 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 30, crystals: 3000, qty: 3000, desc: "Alcance o estágio 30 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 35, crystals: 3000, qty: 3000, desc: "Alcance o estágio 35 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 40, crystals: 3000, qty: 3000, desc: "Alcance o estágio 40 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 50, item_id: 42, qty: 3, desc: "Alcance o estágio 50 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/itens/cartaoavancado.webp" },
        { req: 60, crystals: 3000, qty: 3000, desc: "Alcance o estágio 60 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 70, crystals: 3000, qty: 3000, desc: "Alcance o estágio 70 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 80, crystals: 3000, qty: 3000, desc: "Alcance o estágio 80 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 90, crystals: 3000, qty: 3000, desc: "Alcance o estágio 90 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req: 100, crystals: 5000, qty: 5000, desc: "Alcance o estágio 100 da Aventura AFK.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" }
    ],
    misc: [
        { req_type: "inventory", crystals: 200, qty: 200, desc: "Construa ou adquira um novo equipamento na bolsa.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req_type: "mine_attack", crystals: 500, qty: 500, desc: "Dispute uma mina de cristal.", img: "https://aden-rpg.pages.dev/assets/cristais.webp" },
        { req_type: "buy_raid_attack", gold: 10, qty: 10, desc: "Compre um ataque na Raid de guilda.", img: "https://aden-rpg.pages.dev/assets/goldcoin.webp" }
    ]
};

// =======================================================================
// FUNÇÃO PARA LIDAR COM AÇÕES NA URL (REABRIR LOJA OU ABRIR PV)
// =======================================================================
async function handleUrlActions() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    if (action === 'openShopVideo') {
        const shopModal = document.getElementById('shopModal');
        if (shopModal) {
            shopModal.style.display = 'flex';
        }
        const videoTabButton = document.querySelector('.shop-tab-btn[data-tab="shop-video"]');
        if (videoTabButton) {
            videoTabButton.click();
        }
        history.replaceState(null, '', window.location.pathname);

    } else if (action === 'open_pv') {
        const targetId = urlParams.get('target_id');
        const targetName = urlParams.get('target_name');

        if (targetId && targetName) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                showFloatingMessage("Você precisa estar logado para iniciar uma conversa.");
                return;
            }

            showFloatingMessage(`Abrindo conversa com ${targetName}...`);

            try {
                const { data, error } = await supabaseClient.rpc('get_or_create_private_conversation', {
                    target_player_id: targetId
                });

                if (error) throw error;

                const conversationId = data.conversation_id;
                const pvModal = document.getElementById('pvModal');
                
                if (pvModal) {
                    pvModal.style.display = 'flex';
                    if (window.openChatView) {
                        await window.openChatView(conversationId, targetName);
                    } else {
                        console.error('A função window.openChatView não está pronta.');
                        showFloatingMessage('Erro ao carregar o chat. Tente novamente.');
                    }
                }
            } catch (err) {
                console.error("Erro ao tentar abrir PV a partir da URL:", err);
                showFloatingMessage(`Erro ao abrir conversa: ${err.message}`);
            }

            history.replaceState(null, '', window.location.pathname);
        }
    }
}


// Cache de definições de itens para uso no Espiral e outras funcionalidades
let itemDefinitions = new Map();

// Elementos da UI
const authContainer = document.getElementById('authContainer');
const playerInfoDiv = document.getElementById('playerInfoDiv');
const authMessage = document.getElementById('authMessage');

const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');
const otpInputContainer = document.getElementById('otpInputContainer');
const otpInput = document.getElementById('otpInput');
const verifyOtpBtn = document.getElementById('verifyOtpBtn');

const profileEditModal = document.getElementById('profileEditModal');
const editPlayerNameInput = document.getElementById('editPlayerName');
const editPlayerFactionSelect = document.getElementById('editPlayerFaction');
const profileEditMessage = document.getElementById('profileEditMessage');

const welcomeContainer = document.getElementById('welcomeContainer');

const floatingMessageDiv = document.getElementById('floatingMessage');
const footerMenu = document.getElementById('footerMenu');
const homeBtn = document.getElementById('homeBtn');

// --- Elementos para recuperação de senha ---
const forgotPasswordLink = document.getElementById('forgotPasswordLink');
const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const forgotPasswordEmailInput = document.getElementById('forgotPasswordEmailInput');
const sendRecoveryCodeBtn = document.getElementById('sendRecoveryCodeBtn');
const closeForgotPasswordModalBtn = document.getElementById('closeForgotPasswordModalBtn');
const forgotPasswordMessage = document.getElementById('forgotPasswordMessage');

const verifyRecoveryModal = document.getElementById('verifyRecoveryModal');
const recoveryEmailDisplay = document.getElementById('recoveryEmailDisplay');
const recoveryCodeInput = document.getElementById('recoveryCodeInput');
const newPasswordInput = document.getElementById('newPasswordInput');
const updatePasswordBtn = document.getElementById('updatePasswordBtn');
const closeVerifyRecoveryModalBtn = document.getElementById('closeVerifyRecoveryModalBtn');
const verifyRecoveryMessage = document.getElementById('verifyRecoveryMessage');

// --- Elementos da Loja ---
const shopModal = document.getElementById('shopModal');
const shopMessage = document.getElementById('shopMessage');
const closeShopModalBtn = document.getElementById('closeShopModalBtn');

// --- Elementos do Modal de Confirmação de Compra ---
const purchaseConfirmModal = document.getElementById('purchaseConfirmModal');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmPurchaseFinalBtn = document.getElementById('confirmPurchaseFinalBtn');
const cancelPurchaseBtn = document.getElementById('cancelPurchaseBtn');


// Função para carregar definições de itens no cache local
async function loadItemDefinitions() {
    if (itemDefinitions.size > 0) return; // Já carregado

    const { data, error } = await supabaseClient.from('items').select('item_id, name');
    if (error) {
        console.error('Erro ao carregar definições de itens:', error);
        return;
    }
    for (const item of data) {
        itemDefinitions.set(item.item_id, item);
    }
    console.log('Definições de itens carregadas no cache.');
}

// Funções de Notificação Flutuante
function showFloatingMessage(message, duration = 5000) {
    if (!floatingMessageDiv) return;
    floatingMessageDiv.textContent = message;
    floatingMessageDiv.style.display = 'block';
    floatingMessageDiv.offsetWidth;
    floatingMessageDiv.style.opacity = '1';
    setTimeout(() => {
        floatingMessageDiv.style.opacity = '0';
        setTimeout(() => {
            floatingMessageDiv.style.display = 'none';
        }, 500);
    }, duration);
}
window.showFloatingMessage = showFloatingMessage; // Expor globalmente

// Funções de Autenticação
async function signIn() {
    const email = emailInput.value;
    const password = passwordInput.value;
    authMessage.textContent = 'Tentando entrar...';
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        authMessage.textContent = `Erro ao entrar: ${error.message}`;
    }
}

async function signUp() {
    const email = emailInput.value;
    const password = passwordInput.value;
    authMessage.textContent = 'Enviando código de confirmação...';

    const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: {
            emailRedirectTo: window.location.origin
        }
    });

    if (error) {
        authMessage.textContent = `Erro ao registrar: ${error.message}`;
    } else {
        authMessage.textContent = 'Código de confirmação enviado para seu e-mail! Verifique a caixa de spam, caso não receba.';
        signInBtn.style.display = 'none';
        signUpBtn.style.display = 'none';
        passwordInput.style.display = 'none';
        otpInputContainer.style.display = 'block';
    }
}

async function verifyOtp() {
    const email = emailInput.value;
    const token = otpInput.value;
    authMessage.textContent = 'Verificando código...';

    const { error } = await supabaseClient.auth.verifyOtp({
        email,
        token,
        type: 'email'
    });

    if (error) {
        authMessage.textContent = `Erro ao verificar código: ${error.message}`;
    }
}

async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Erro ao sair:', error.message);
    }
        window.location.reload();
}

// Função helper para renderizar a UI com os dados do jogador
function renderPlayerUI(player, preserveActiveContainer = false) {
    authContainer.style.display = 'none';
    playerInfoDiv.innerHTML = `
      <p>Olá, ${player.name}!</p>
      <p>Facção: ${player.faction}</p>
      <p>Ataque: ${player.min_attack} - ${player.attack}</p>
      <p>Defesa: ${player.defense}</p>
      <p>HP: ${player.health ?? 0}</p>
      <p>Taxa Crítica: ${player.crit_chance ?? 0}%</p>
      <p>Dano Crítico: ${player.crit_damage ?? 0}%</p>
      <p>Evasão: ${player.evasion ?? 0}%</p>
      <button id="editProfileBtn">Editar Perfil</button>
      <button id="signOutBtn">Deslogar</button>
    `;
    const editProfileBtn = playerInfoDiv.querySelector('#editProfileBtn');
    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', () => {
            document.getElementById('editProfileIcon').click();
        });
    }
    document.getElementById('playerAvatar').src = player.avatar_url || 'https://aden-rpg.pages.dev/avatar01.webp';
    document.getElementById('playerNameText').textContent = player.name;
    document.getElementById('playerLevel').textContent = `Nv. ${player.level}`;
    document.getElementById('playerPower').textContent = formatNumberCompact(player.combat_power);
    document.getElementById('playerGold').innerHTML = `<img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width: 22px; height: 17px; vertical-align: -4px;"> ${formatNumberCompact(player.gold)}`;
    document.getElementById('playerCrystals').innerHTML = `<img src="https://aden-rpg.pages.dev/assets/cristais.webp" style="width: 17px; height: 17px; vertical-align: -4px;"> ${formatNumberCompact(player.crystals)}`;
    const xpPercent = Math.min(100, Math.floor((player.xp / player.xp_needed_for_level) * 100));
    document.getElementById('xpBarContainer').style.display = 'flex';
    document.getElementById('xpBar').style.width = `${xpPercent}%`;
    document.getElementById('xpText').textContent = `${player.xp} / ${player.xp_needed_for_level}`;
    document.getElementById('playerTopBar').style.display = 'flex';
    if (welcomeContainer && player && player.name) {
        welcomeContainer.innerHTML = `
            <h3 style="color: white; text-align: center;">Saudações,<br><span style="background: linear-gradient(to bottom, lightblue 0%, white 50%, blue 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent; font-style: italic;">${player.name}</span>!</h3>
            <p>Prepare-se para novas aventuras em Aden!</p>
            <p>Clique nos botões do menu abaixo para explorar.</p>
        `;
    }
    if (!preserveActiveContainer) {
        updateUIVisibility(true, 'welcomeContainer');
    }
}

// Nova função auxiliar para aplicar os bônus dos itens aos atributos
function applyItemBonuses(player, equippedItems) {
    let combinedStats = { ...player };
    equippedItems.forEach(invItem => {
        if (invItem.items) {
            combinedStats.min_attack += invItem.items.min_attack || 0;
            combinedStats.attack += invItem.items.attack || 0;
            combinedStats.defense += invItem.items.defense || 0;
            combinedStats.health += invItem.items.health || 0;
            combinedStats.crit_chance += invItem.items.crit_chance || 0;
            combinedStats.crit_damage += invItem.items.crit_damage || 0;
            combinedStats.evasion += invItem.items.evasion || 0;
        }
        combinedStats.min_attack += invItem.min_attack_bonus || 0;
        combinedStats.attack += invItem.attack_bonus || 0;
        combinedStats.defense += invItem.defense_bonus || 0;
        combinedStats.health += invItem.health_bonus || 0;
        combinedStats.crit_chance += invItem.crit_chance_bonus || 0;
        combinedStats.crit_damage += invItem.crit_damage_bonus || 0;
        combinedStats.evasion += invItem.evasion_bonus || 0;
    });
    return combinedStats;
}

// Função principal para buscar e exibir as informações do jogador
async function fetchAndDisplayPlayerInfo(preserveActiveContainer = false) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        updateUIVisibility(false);
        currentPlayerData = null; // Limpa dados do jogador ao deslogar
        return;
    }
    
    currentPlayerId = user.id; // Armazena o ID do usuário

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('*') // Busca todas as colunas
        .eq('id', user.id)
        .single();
        
    if (playerError || !player) {
        updateUIVisibility(false);
        currentPlayerData = null; // Limpa dados em caso de erro
        return;
    }

    const { data: equippedItems, error: itemsError } = await supabaseClient
        .from('inventory_items')
        .select(`
            equipped_slot,
            min_attack_bonus,
            attack_bonus,
            defense_bonus,
            health_bonus,
            crit_chance_bonus,
            crit_damage_bonus,
            evasion_bonus,
            items (
                name,
                min_attack,
                attack,
                defense,
                health,
                crit_chance,
                crit_damage,
                evasion
            )
        `)
        .eq('player_id', user.id)
        .neq('equipped_slot', null);

    if (itemsError) {
        console.error('Erro ao buscar itens equipados:', itemsError.message);
    }

    const playerWithEquips = applyItemBonuses(player, equippedItems || []);
    playerWithEquips.combat_power = Math.floor(
        (playerWithEquips.attack * 12.5) +
        (playerWithEquips.min_attack * 1.5) +
        (playerWithEquips.crit_chance * 5.35) +
        (playerWithEquips.crit_damage * 6.5) +
        (playerWithEquips.defense * 2) +
        (playerWithEquips.health * 3.2625) +
        (playerWithEquips.evasion * 1)
    );

    // Armazena os dados completos do jogador (com bônus) globalmente
    currentPlayerData = playerWithEquips;

    renderPlayerUI(playerWithEquips, preserveActiveContainer);
    
    // Verifica notificações de progressão
    checkProgressionNotifications(playerWithEquips);

    if (playerWithEquips.name === 'Nome') {
        document.getElementById('editPlayerName').value = '';
        profileEditModal.style.display = 'flex';
    }
}

// --- Recuperação de senha com token ---
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', e => {
        e.preventDefault();
        forgotPasswordModal.style.display = 'flex';
        forgotPasswordMessage.textContent = '';
    });
}
if (closeForgotPasswordModalBtn) {
    closeForgotPasswordModalBtn.addEventListener('click', () => {
        forgotPasswordModal.style.display = 'none';
    });
}
if (sendRecoveryCodeBtn) {
    sendRecoveryCodeBtn.addEventListener('click', async () => {
        const email = forgotPasswordEmailInput.value;
        if (!email) {
            forgotPasswordMessage.textContent = 'Informe um e-mail válido.';
            return;
        }
        forgotPasswordMessage.textContent = 'Enviando código...';
        const { error } = await supabaseClient.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false }
        });
        if (error) {
            forgotPasswordMessage.textContent = `Erro: ${error.message}`;
        } else {
            forgotPasswordMessage.textContent = 'Código enviado! Verifique seu e-mail.';
            forgotPasswordModal.style.display = 'none';
            verifyRecoveryModal.style.display = 'flex';
            recoveryEmailDisplay.value = email;
        }
    });
}
if (closeVerifyRecoveryModalBtn) {
    closeVerifyRecoveryModalBtn.addEventListener('click', () => {
        verifyRecoveryModal.style.display = 'none';
    });
}
if (updatePasswordBtn) {
    updatePasswordBtn.addEventListener('click', async () => {
        const email = recoveryEmailDisplay.value;
        const token = recoveryCodeInput.value;
        const newPassword = newPasswordInput.value;
        if (!email || !token || !newPassword) {
            verifyRecoveryMessage.textContent = 'Preencha todos os campos.';
            return;
        }
        if (newPassword.length < 6) {
            verifyRecoveryMessage.textContent = 'A senha deve ter pelo menos 6 caracteres.';
            return;
        }
        const { error: verifyError } = await supabaseClient.auth.verifyOtp({
            email,
            token,
            type: 'recovery'
        });
        if (verifyError) {
            verifyRecoveryMessage.textContent = `Erro: ${verifyError.message}`;
            return;
        }
        const { error: updateError } = await supabaseClient.auth.updateUser({ password: newPassword });
        if (updateError) {
            verifyRecoveryMessage.textContent = `Erro: ${updateError.message}`;
            return;
        }
        verifyRecoveryMessage.textContent = 'Senha atualizada! Faça login novamente.';
        setTimeout(() => {
            verifyRecoveryModal.style.display = 'none';
            window.location.reload();
        }, 2500);
    });
}

// --- UI ---
window.updateUIVisibility = (isLoggedIn, activeContainerId = null) => {
    if (isLoggedIn) {
        authContainer.style.display = 'none';
        footerMenu.style.display = 'flex';
        welcomeContainer.style.display = 'block';
    } else {
        authContainer.style.display = 'block';
        welcomeContainer.style.display = 'none';
        footerMenu.style.display = 'none';
        signInBtn.style.display = 'block';
        signUpBtn.style.display = 'block';
        passwordInput.style.display = 'block';
        otpInputContainer.style.display = 'none';
        authMessage.textContent = '';
    }
};

// Eventos
signInBtn.addEventListener('click', signIn);
signUpBtn.addEventListener('click', signUp);
verifyOtpBtn.addEventListener('click', verifyOtp);
homeBtn.addEventListener('click', () => {
    updateUIVisibility(true, 'welcomeContainer');
    fetchAndDisplayPlayerInfo(true, true);
    showFloatingMessage("Você está na página inicial!");
});

// Sessão e inicialização
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        fetchAndDisplayPlayerInfo().then(() => {
            // Após o login e carregamento dos dados do jogador, processar as ações da URL.
            handleUrlActions();
        });
    } else {
        updateUIVisibility(false);
    }
});

// --- Modal de avatar ---
document.addEventListener('DOMContentLoaded', () => {
    const avatar = document.getElementById('playerAvatar');
    const modal = document.getElementById('playerInfoModal');
    const modalContent = document.getElementById('modalPlayerInfoContent');
    const closeBtn = document.getElementById('closePlayerInfoBtn');
    if (avatar && modal && closeBtn && modalContent && playerInfoDiv) {
        avatar.addEventListener('click', () => {
            modalContent.innerHTML = playerInfoDiv.innerHTML;
            modal.style.display = 'flex';
            const modalEditProfileBtn = modal.querySelector('#editProfileBtn');
            if (modalEditProfileBtn) {
                modalEditProfileBtn.onclick = () => {
                    modal.style.display = 'none';
                    document.getElementById('editProfileIcon').click();
                };
            }
            const modalSignOutBtn = modal.querySelector('#signOutBtn');
            if (modalSignOutBtn) {
                modalSignOutBtn.onclick = () => {
                    modal.style.display = 'none';
                    signOut();
                };
            }
        });
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
});
document.getElementById('editProfileIcon').onclick = () => {
    profileEditModal.style.display = 'flex';
};
const closeProfileModalBtn = document.getElementById('closeProfileModalBtn');
if (closeProfileModalBtn) {
    closeProfileModalBtn.onclick = () => {
        profileEditModal.style.display = 'none';
    };
}

// === MENU LATERAL (LOSANGOS) ===
document.addEventListener("DOMContentLoaded", () => {
  
  // Carrega as definições de itens ao iniciar a página.
  loadItemDefinitions();
    
  const missionsBtn = document.getElementById("missionsBtn");
  const missionsSub = document.getElementById("missionsSubmenu");
  const moreBtn = document.getElementById("moreBtn");
  const moreSub = document.getElementById("moreSubmenu");

  function toggleSubmenu(btn, submenu) {
    const isVisible = submenu.style.display === "flex";
    document.querySelectorAll("#sideMenu .submenu").forEach(s => s.style.display = "none");
    if (!isVisible) {
      submenu.style.display = "flex";
      const btnRect = btn.getBoundingClientRect();
      submenu.style.top = btn.offsetTop + btn.offsetHeight / 2 + "px";
    }
  }

  missionsBtn.addEventListener("click", () => toggleSubmenu(missionsBtn, missionsSub));
  moreBtn.addEventListener("click", () => toggleSubmenu(moreBtn, moreSub));

  document.addEventListener("click", e => {
    if (!e.target.closest("#sideMenu")) {
      document.querySelectorAll("#sideMenu .submenu").forEach(s => s.style.display = "none");
    }
  });

  const modal = document.getElementById("genericModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalMessage = document.getElementById("modalMessage");
  const closeModal = document.getElementById("closeGenericModal");

  const modalMessages = {
    tarefasModal: "Tarefas em breve!",
    // "progressaoModal" removido daqui
    comercioModal: "Comércio em breve!",
    rankingModal: "Ranking em breve!",
    petsModal: "Pets em breve!"
  };

  document.querySelectorAll("#sideMenu .menu-item[data-modal]").forEach(item => {
    item.addEventListener("click", () => {
      const key = item.getAttribute("data-modal");

      if (key === "espiralModal") {
        openSpiralModal();
        return;
      }
      
      // NOVA LÓGICA PARA PROGRESSÃO
      if (key === "progressaoModal") {
        openProgressionModal();
        return;
      }
      
      if (key === "lojaModal") {
        openShopModal();
        return;
      }
      
      if (key === "bolsaModal") {
        window.location.href = "/inventory.html";
        return;
      }
      if (key === "pvModal") {
        document.getElementById('pvModal').style.display = "flex";
        return;
      }

      if (modalMessages[key]) {
        modalTitle.textContent = item.querySelector("span").textContent;
        modalMessage.textContent = modalMessages[key];
        modal.style.display = "flex";
      }
    });
  });

  closeModal.addEventListener("click", () => {
    modal.style.display = "none";
  });
  
  // Listener para fechar o novo modal de progressão
  const closeProgressionBtn = document.getElementById('closeProgressionModalBtn');
  if (closeProgressionBtn) {
      closeProgressionBtn.addEventListener('click', closeProgressionModal);
  }
});


// ===============================================
// === LÓGICA DO SISTEMA DE PROGRESSÃO (NOVO) ===
// ===============================================

/**
 * Verifica se há missões de progressão resgatáveis (APENAS Level e AFK).
 * Isso é rápido e pode ser chamado após o login.
 */
function checkProgressionNotifications(player) {
    if (!player) return;

    const missionsDot = document.getElementById('missionsNotificationDot');
    const progressionDot = document.getElementById('progressionNotificationDot');
    if (!missionsDot || !progressionDot) return;

    let hasClaimable = false;
    const state = player.progression_state || { level: 0, afk: 0, misc: 0 };

    // 1. Checar Nível
    const levelIndex = state.level || 0;
    if (levelIndex < mission_definitions.level.length) {
        const currentMission = mission_definitions.level[levelIndex];
        if (player.level >= currentMission.req) {
            hasClaimable = true;
        }
    }

    // 2. Checar AFK (só checa se ainda não achou resgatável)
    if (!hasClaimable) {
        const afkIndex = state.afk || 0;
        if (afkIndex < mission_definitions.afk.length) {
            const currentMission = mission_definitions.afk[afkIndex];
            if (player.current_afk_stage >= currentMission.req) {
                hasClaimable = true;
            }
        }
    }
    
    // 3. Checar Misc (só checa se ainda não achou resgatável)
    // Vamos checar apenas os que não exigem busca no inventário (Misc 2 e 3)
     if (!hasClaimable) {
        const miscIndex = state.misc || 0;
        if (miscIndex === 1) { // Missão "Dispute uma mina"
             if (player.last_attack_time) {
                hasClaimable = true;
             }
        } else if (miscIndex === 2) { // Missão "Compre um ataque na Raid"
            if (player.raid_attacks_bought_count > 0) {
                hasClaimable = true;
            }
        }
    }


    missionsDot.style.display = hasClaimable ? 'block' : 'none';
    progressionDot.style.display = hasClaimable ? 'block' : 'none';
}

/**
 * Abre o modal de progressão e chama a renderização
 */
function openProgressionModal() {
    const modal = document.getElementById('progressionModal');
    if (modal) {
        modal.style.display = 'flex';
        renderProgressionModal();
    }
}

/**
 * Fecha o modal de progressão
 */
function closeProgressionModal() {
    const modal = document.getElementById('progressionModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Renderiza o conteúdo do modal de progressão
 */
async function renderProgressionModal() {
    const container = document.getElementById('progressionListContainer');
    if (!container) return;

    if (!currentPlayerData) {
        container.innerHTML = '<p>Erro ao carregar dados do jogador. Tente novamente.</p>';
        return;
    }
    
    container.innerHTML = ''; // Limpa o conteúdo
    const player = currentPlayerData;
    const state = player.progression_state || { level: 0, afk: 0, misc: 0 };

    // --- Categoria 1: Nível ---
    const levelIndex = state.level || 0;
    const levelCatDiv = document.createElement('div');
    levelCatDiv.className = 'progression-category';
    levelCatDiv.innerHTML = '<h3>Progresso de Nível</h3>';
    
    if (levelIndex >= mission_definitions.level.length) {
        levelCatDiv.innerHTML += '<p class="mission-complete-message">Missões dessa categoria completas!</p>';
    } else {
        const mission = mission_definitions.level[levelIndex];
        const canClaim = player.level >= mission.req;
        levelCatDiv.innerHTML += `
            <div class="mission-item">
                <div class="mission-reward">
                    <img src="${mission.img}" alt="Recompensa">
                    <span>x${mission.qty}</span>
                </div>
                <div class="mission-details">
                    <p>${mission.desc}</p>
                </div>
                <div class="mission-actions">
                    <button class="claim-btn" data-category="level" ${canClaim ? '' : 'disabled'}>
                        Resgatar
                    </button>
                </div>
            </div>
        `;
    }
    container.appendChild(levelCatDiv);

    // --- Categoria 2: AFK ---
    const afkIndex = state.afk || 0;
    const afkCatDiv = document.createElement('div');
    afkCatDiv.className = 'progression-category';
    afkCatDiv.innerHTML = '<h3>Progresso de Aventura (AFK)</h3>';

    if (afkIndex >= mission_definitions.afk.length) {
        afkCatDiv.innerHTML += '<p class="mission-complete-message">Missões dessa categoria completas!</p>';
    } else {
        const mission = mission_definitions.afk[afkIndex];
        const canClaim = player.current_afk_stage >= mission.req;
        afkCatDiv.innerHTML += `
            <div class="mission-item">
                <div class="mission-reward">
                    <img src="${mission.img}" alt="Recompensa">
                    <span>x${mission.qty}</span>
                </div>
                <div class="mission-details">
                    <p>${mission.desc}</p>
                </div>
                <div class="mission-actions">
                    <button class="claim-btn" data-category="afk" ${canClaim ? '' : 'disabled'}>
                        Resgatar
                    </button>
                </div>
            </div>
        `;
    }
    container.appendChild(afkCatDiv);

    // --- Categoria 3: Diversos ---
    const miscIndex = state.misc || 0;
    const miscCatDiv = document.createElement('div');
    miscCatDiv.className = 'progression-category';
    miscCatDiv.innerHTML = '<h3>Missões Diversas</h3>';

    if (miscIndex >= mission_definitions.misc.length) {
        miscCatDiv.innerHTML += '<p class="mission-complete-message">Missões dessa categoria completas!</p>';
    } else {
        const mission = mission_definitions.misc[miscIndex];
        // A verificação de "canClaim" para "misc" é assíncrona ou depende de dados variados
        const canClaim = await checkMiscRequirement(miscIndex, player);
        miscCatDiv.innerHTML += `
            <div class="mission-item">
                <div class="mission-reward">
                    <img src="${mission.img}" alt="Recompensa">
                    <span>x${mission.qty}</span>
                </div>
                <div class="mission-details">
                    <p>${mission.desc}</p>
                </div>
                <div class="mission-actions">
                    <button class="claim-btn" data-category="misc" ${canClaim ? '' : 'disabled'}>
                        Resgatar
                    </button>
                </div>
            </div>
        `;
    }
    container.appendChild(miscCatDiv);
    
    // Adiciona listeners aos botões de resgate
    container.querySelectorAll('.claim-btn').forEach(btn => {
        btn.addEventListener('click', handleProgressionClaim);
    });
}

/**
 * Verifica o requisito para a missão "misc" atual.
 */
async function checkMiscRequirement(missionIndex, player) {
    if (missionIndex === 0) {
        // "Construa ou adquira um novo equipamento na bolsa."
        try {
            // Tenta usar RPC (se você a criou)
             const { data, error: rpcError } = await supabaseClient
                .rpc('count_player_equipment', { p_player_id: player.id });

            if (rpcError) {
                 // Fallback para a query com JOIN (mais lenta)
                 console.warn("RPC count_player_equipment não encontrada, usando query com join.");
                 const { count: inventoryCount, error: inventoryError } = await supabaseClient
                    .from('inventory_items')
                    .select('items!inner(item_type)', { count: 'exact', head: true }) //
                    .eq('player_id', player.id)
                    .in('items.item_type', ['arma', 'armadura', 'anel', 'colar', 'elmo', 'asa']); //
                
                if(inventoryError) throw inventoryError;
                return (inventoryCount || 0) > 0;
            }
            
            return (data || 0) > 0;

        } catch (err) {
            console.error("Erro ao checar inventário para missão misc 0:", err);
            // Fallback 2 (caso a primeira query falhe por algum motivo)
             try {
                const { count: finalCount, error: finalError } = await supabaseClient
                    .from('inventory_items')
                    .select('items!inner(item_type)', { count: 'exact', head: true }) //
                    .eq('player_id', player.id)
                    .in('items.item_type', ['arma', 'armadura', 'anel', 'colar', 'elmo', 'asa']); //
                if (finalError) return false;
                return (finalCount || 0) > 0;
             } catch(e) { return false; }
        }
    } else if (missionIndex === 1) {
        // "Dispute uma mina de cristal."
        return !!player.last_attack_time; // Retorna true se last_attack_time não for null/undefined
    } else if (missionIndex === 2) {
        // "Compre um ataque na Raid de guilda."
        return (player.raid_attacks_bought_count || 0) > 0; //
    }
    return false;
}

/**
 * Lida com o clique no botão "Resgatar"
 */
async function handleProgressionClaim(event) {
    const button = event.target;
    const category = button.dataset.category;
    if (!category) return;

    button.disabled = true;
    button.textContent = "Aguarde...";

    try {
        // *** CORREÇÃO APLICADA AQUI ***
        // Removido o underscore "_" extra
        const { data, error } = await supabaseClient.rpc('claim_progression_reward', {
            p_category: category
        });

        if (error) throw new Error(error.message);

        showFloatingMessage(data.message || 'Recompensa resgatada com sucesso!');

        // Atualizar dados locais do jogador
        if (currentPlayerData) {
            if (!currentPlayerData.progression_state) {
                 currentPlayerData.progression_state = { level: 0, afk: 0, misc: 0 };
            }
            currentPlayerData.progression_state[category] = data.new_index;
            if (data.crystals_added > 0) {
                currentPlayerData.crystals = (currentPlayerData.crystals || 0) + data.crystals_added;
            }
            if (data.gold_added > 0) {
                currentPlayerData.gold = (currentPlayerData.gold || 0) + data.gold_added;
            }
            // Re-renderiza a barra superior e checa notificações
            renderPlayerUI(currentPlayerData, true);
            checkProgressionNotifications(currentPlayerData);
        }
        
        // Re-renderiza o modal de progressão
        await renderProgressionModal();

    } catch (error) {
        console.error(`Erro ao resgatar recompensa [${category}]:`, error);
        showFloatingMessage(`Erro: ${error.message.replace('Error: ', '')}`);
        // Re-habilita o botão em caso de erro
        button.disabled = false;
        button.textContent = "Resgatar";
    }
}


// ===============================================
// === LÓGICA DO SISTEMA DE ESPIRAL (Gacha) ===
// ===============================================

const spiralModal = document.getElementById('spiralModal');
const commonSpiralTab = document.querySelector('.tab-btn[data-tab="common"]');
const advancedSpiralTab = document.querySelector('.tab-btn[data-tab="advanced"]');
const commonSpiralContent = document.getElementById('common-spiral');
const advancedSpiralContent = document.getElementById('advanced-spiral');
const commonCardCountSpan = document.getElementById('commonCardCount');
const advancedCardCountSpan = document.getElementById('advancedCardCount');
const buyCommonCardBtn = document.getElementById('buyCommonCardBtn');
const drawCommonBtn = document.getElementById('drawCommonBtn');
const drawAdvancedBtn = document.getElementById('drawAdvancedBtn');

const buyCardsModal = document.getElementById('buyCardsModal');
const decreaseCardQtyBtn = document.getElementById('decreaseCardQtyBtn');
const increaseCardQtyBtn = document.getElementById('increaseCardQtyBtn');
const cardQtyToBuySpan = document.getElementById('cardQtyToBuy');
const totalCrystalCostSpan = document.getElementById('totalCrystalCost');
const confirmPurchaseBtn = document.getElementById('confirmPurchaseBtn');
const buyCardsMessage = document.getElementById('buyCardsMessage');

const drawConfirmModal = document.getElementById('drawConfirmModal');
const drawQuantityInput = document.getElementById('drawQuantityInput');
const confirmDrawBtn = document.getElementById('confirmDrawBtn');
const drawConfirmMessage = document.getElementById('drawConfirmMessage');
let currentDrawType = 'common';

const drawResultsModal = document.getElementById('drawResultsModal');
const drawResultsGrid = document.getElementById('drawResultsGrid');

async function updateCardCounts() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data, error } = await supabaseClient
        .from('inventory_items')
        .select('item_id, quantity')
        .eq('player_id', user.id)
        .in('item_id', [41, 42]); //

    if (error) {
        console.error("Erro ao buscar cartões:", error);
        return;
    }

    const commonCards = data.find(item => item.item_id === 41); //
    const advancedCards = data.find(item => item.item_id === 42); //

    commonCardCountSpan.textContent = `x ${commonCards ? commonCards.quantity : 0}`;
    advancedCardCountSpan.textContent = `x ${advancedCards ? advancedCards.quantity : 0}`;
}

function openSpiralModal() {
    updateCardCounts();
    spiralModal.style.display = 'flex';
}

commonSpiralTab.addEventListener('click', () => {
    commonSpiralTab.classList.add('active');
    advancedSpiralTab.classList.remove('active');
    commonSpiralContent.style.display = 'block';
    advancedSpiralContent.style.display = 'none';
});

advancedSpiralTab.addEventListener('click', () => {
    advancedSpiralTab.classList.add('active');
    commonSpiralTab.classList.remove('active');
    advancedSpiralContent.style.display = 'block';
    commonSpiralContent.style.display = 'none';
});

document.querySelector('.close-spiral-modal').addEventListener('click', () => spiralModal.style.display = 'none');
document.getElementById('closeBuyCardsModalBtn').addEventListener('click', () => buyCardsModal.style.display = 'none');
document.getElementById('closeDrawConfirmModalBtn').addEventListener('click', () => drawConfirmModal.style.display = 'none');
document.getElementById('closeDrawResultsModalBtn').addEventListener('click', () => drawResultsModal.style.display = 'none');

buyCommonCardBtn.addEventListener('click', () => {
    cardQtyToBuySpan.textContent = '1';
    totalCrystalCostSpan.textContent = '250';
    buyCardsMessage.textContent = '';
    buyCardsModal.style.display = 'flex';
});

increaseCardQtyBtn.addEventListener('click', () => {
    let qty = parseInt(cardQtyToBuySpan.textContent) + 1;
    cardQtyToBuySpan.textContent = qty;
    totalCrystalCostSpan.textContent = qty * 250;
});

decreaseCardQtyBtn.addEventListener('click', () => {
    let qty = parseInt(cardQtyToBuySpan.textContent);
    if (qty > 1) {
        qty--;
        cardQtyToBuySpan.textContent = qty;
        totalCrystalCostSpan.textContent = qty * 250;
    }
});

confirmPurchaseBtn.addEventListener('click', async () => {
    const quantity = parseInt(cardQtyToBuySpan.textContent);
    confirmPurchaseBtn.disabled = true;
    buyCardsMessage.textContent = 'Processando compra...';

    const { data, error } = await supabaseClient.rpc('buy_spiral_cards', { purchase_quantity: quantity });

    if (error) {
        buyCardsMessage.textContent = `Erro: ${error.message}`;
    } else {
        buyCardsMessage.textContent = data;
        await updateCardCounts();
        await fetchAndDisplayPlayerInfo(true);
        setTimeout(() => {
            buyCardsModal.style.display = 'none';
        }, 2000);
    }
    confirmPurchaseBtn.disabled = false;
});

function openDrawConfirmModal(type) {
    currentDrawType = type;
    drawQuantityInput.value = 1;
    drawConfirmMessage.textContent = '';
    drawConfirmModal.style.display = 'flex';
}

drawCommonBtn.addEventListener('click', () => openDrawConfirmModal('common'));
drawAdvancedBtn.addEventListener('click', () => openDrawConfirmModal('advanced'));

confirmDrawBtn.addEventListener('click', async () => {
    const quantity = parseInt(drawQuantityInput.value);
    if (isNaN(quantity) || quantity <= 0) {
        drawConfirmMessage.textContent = 'Por favor, insira uma quantidade válida.';
        return;
    }

    confirmDrawBtn.disabled = true;
    drawConfirmMessage.textContent = 'Sorteando...';

    const { data: wonItems, error } = await supabaseClient.rpc('perform_spiral_draw', {
        draw_type: currentDrawType,
        p_quantity: quantity
    });

    if (error) {
        drawConfirmMessage.textContent = `Erro: ${error.message}`;
    } else {
        drawConfirmModal.style.display = 'none';
        displayDrawResults(wonItems);
        await updateCardCounts();
    }
    confirmDrawBtn.disabled = false;
});

function displayDrawResults(items) {
    drawResultsGrid.innerHTML = '';
    if (Object.keys(items).length === 0) {
        drawResultsGrid.innerHTML = '<p>Nenhum item especial foi obtido desta vez.</p>';
    } else {
        for (const itemIdStr in items) {
            const itemId = parseInt(itemIdStr, 10);
            const quantity = items[itemId];
            const itemDef = itemDefinitions.get(itemId);

            if (!itemDef) {
                console.warn(`Definição não encontrada para o item ID: ${itemId}`);
                continue; 
            }
            
            const imageUrl = `https://aden-rpg.pages.dev/assets/itens/${itemDef.name}.webp`;

            const itemDiv = document.createElement('div');
            itemDiv.className = 'result-item';
            itemDiv.innerHTML = `
                <img src="${imageUrl}" alt="${itemDef.name}">
                <span>x${quantity}</span>
            `;
            drawResultsGrid.appendChild(itemDiv);
        }
    }
    drawResultsModal.style.display = 'flex';
}

// ===============================================
// === LÓGICA DO SISTEMA DE LOJA (Shop)      ===
// ===============================================

function openShopModal() {
    shopMessage.textContent = '';
    shopModal.style.display = 'flex';
}

if (closeShopModalBtn) {
    closeShopModalBtn.addEventListener('click', () => {
        shopModal.style.display = 'none';
    });
}

// Lógica para alternar entre as abas da loja
const shopTabs = document.querySelectorAll('.shop-tab-btn');
const shopContents = document.querySelectorAll('.shop-content');

shopTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        shopTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const targetContentId = tab.getAttribute('data-tab');
        shopContents.forEach(content => {
            if (content.id === targetContentId) {
                content.style.display = 'block';
            } else {
                content.style.display = 'none';
            }
        });
    });
});

// Lógica para os botões de compra com modal de confirmação
const buyButtons = document.querySelectorAll('.shop-buy-btn');
let purchaseHandler = null; // Variável para armazenar a função de compra

buyButtons.forEach(button => {
    button.addEventListener('click', () => {
        const packageId = button.getAttribute('data-package');
        const itemName = button.getAttribute('data-name');
        const itemCost = button.getAttribute('data-cost');

        // Prepara a mensagem do modal
        confirmModalMessage.innerHTML = `Tem certeza que deseja comprar <strong>${itemName}</strong> por <img src="https://aden-rpg.pages.dev/assets/goldcoin.webp" style="width:16px; height:16px; vertical-align: -2px;"> ${itemCost} de ouro?`;
        
        // Define o que o botão "Confirmar" fará
        purchaseHandler = async () => {
            purchaseConfirmModal.style.display = 'none'; // Esconde o modal de confirmação
            button.disabled = true;
            shopMessage.textContent = 'Processando sua compra...';

            try {
                const { data, error } = await supabaseClient.rpc('buy_shop_item', {
                    package_id: packageId
                });
                if (error) throw error;

                shopMessage.textContent = data;
                await fetchAndDisplayPlayerInfo(true);
            } catch (error) {
                shopMessage.textContent = `Erro: ${error.message}`;
            } finally {
                button.disabled = false;
            }
        };

        // Mostra o modal de confirmação
        purchaseConfirmModal.style.display = 'flex';
    });
});

// Listener para o botão de confirmação final
confirmPurchaseFinalBtn.addEventListener('click', () => {
    if (purchaseHandler) {
        purchaseHandler();
    }
});

// Listener para o botão de cancelar
cancelPurchaseBtn.addEventListener('click', () => {
    purchaseConfirmModal.style.display = 'none';
    purchaseHandler = null; // Limpa o handler
});

// =======================================================================
// === LÓGICA DE RECOMPENSA POR VÍDEO (INTEGRADA AO APPCREATOR24) ===
// =======================================================================

async function checkRewardLimit() {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return;

        const { data: playerData, error } = await supabaseClient
            .from('players')
            .select('daily_rewards_log')
            .eq('id', user.id)
            .single();

        if (error || !playerData) return;

        const log = playerData.daily_rewards_log || {}; //
        const counts = (log && log.counts) ? log.counts : {};
        const logDateStr = log && log.date ? String(log.date) : null;

        const todayUtc = new Date(new Date().toISOString().split('T')[0]).toISOString().split('T')[0];

        if (!logDateStr || String(logDateStr).split('T')[0] !== todayUtc) {
            watchVideoButtons.forEach(btn => {
                btn.disabled = false;
                btn.style.filter = "";
                btn.style.pointerEvents = "";
                if (btn.getAttribute('data-original-text')) {
                    btn.textContent = btn.getAttribute('data-original-text');
                } else {
                    btn.setAttribute('data-original-text', btn.textContent);
                }
            });
            return;
        }

        watchVideoButtons.forEach(btn => {
            const type = btn.getAttribute('data-reward');
            const count = counts && (counts[type] !== undefined) ? parseInt(counts[type], 10) : 0;
            if (isNaN(count) || count < 5) {
                btn.disabled = false;
                btn.style.filter = "";
                btn.style.pointerEvents = "";
                if (!btn.getAttribute('data-original-text')) {
                    btn.setAttribute('data-original-text', btn.textContent);
                } else {
                    btn.textContent = btn.getAttribute('data-original-text');
                }
            } else {
                btn.disabled = true;
                btn.style.filter = "grayscale(100%) brightness(60%)";
                btn.style.pointerEvents = "none";
                btn.setAttribute('data-original-text', btn.getAttribute('data-original-text') || btn.textContent);
                btn.textContent = "Limite atingido";
            }
        });
    } catch (e) {
        console.error("Erro ao verificar limites de vídeo:", e);
    }
}

const watchVideoButtons = document.querySelectorAll('.watch-video-btn');

watchVideoButtons.forEach(button => {
    button.addEventListener('click', async () => {
        const rewardType = button.getAttribute('data-reward');
        button.disabled = true;
        showFloatingMessage('Preparando sua recompensa...');

        try {
            const { data: token, error: rpcError } = await supabaseClient.rpc('generate_reward_token', {
                p_reward_type: rewardType
            });

            if (rpcError) {
                if (rpcError.message && rpcError.message.toLowerCase().includes('limite')) {
                    showFloatingMessage('Você já atingiu o limite diário para esta recompensa.');
                    checkRewardLimit();
                } else {
                    showFloatingMessage(`Erro: ${rpcError.message}`);
                }
                button.disabled = false;
                return;
            }

            localStorage.setItem('pending_reward_token', token); //

            const triggerId = `trigger-${rewardType}-ad`;
            const triggerLink = document.getElementById(triggerId);

            if (triggerLink) {
                triggerLink.click();
            } else {
                throw new Error(`Gatilho para recompensa '${rewardType}' não encontrado.`);
            }

        } catch (error) {
            showFloatingMessage(`Erro: ${error.message}`);
            localStorage.removeItem('pending_reward_token'); //
        } finally {
            setTimeout(() => { button.disabled = false; }, 3000);
        }
    });
});

setTimeout(() => {
    checkRewardLimit();
}, 600);

// fim do arquivo