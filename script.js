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
        return;
    }

    const { data: player, error: playerError } = await supabaseClient
        .from('players')
        .select('*')
        .eq('id', user.id)
        .single();
    if (playerError || !player) {
        updateUIVisibility(false);
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

    renderPlayerUI(playerWithEquips, preserveActiveContainer);

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
    if (session) fetchAndDisplayPlayerInfo();
    else updateUIVisibility(false);
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
    pvModal: "PV em breve!",
    tarefasModal: "Tarefas em breve!",
    conquistasModal: "Conquistas em breve!",
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
      
      if (key === "lojaModal") {
        openShopModal();
        return;
      }
      
      if (key === "bolsaModal") {
        window.location.href = "/inventory.html";
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
});

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
        .in('item_id', [41, 42]);

    if (error) {
        console.error("Erro ao buscar cartões:", error);
        return;
    }

    const commonCards = data.find(item => item.item_id === 41);
    const advancedCards = data.find(item => item.item_id === 42);

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

// ===============================================================
// === NOVA LÓGICA DE RECOMPENSA POR VÍDEO (SEGURA E EM MODAL) ===
// ===============================================================

// Adiciona um listener para o botão de fechar manual do novo modal de recompensa
if (document.getElementById('closeRewardVideoModalBtn')) {
    document.getElementById('closeRewardVideoModalBtn').addEventListener('click', () => {
        document.getElementById('rewardVideoModal').style.display = 'none';
        document.getElementById('rewardFrame').src = 'about:blank'; // Limpa o iframe para interromper a execução
    });
}

// Adiciona um listener global para receber mensagens do iframe de recompensa
window.addEventListener('message', (event) => {
    // Verificação de segurança: aceita mensagens apenas da sua própria origem
    if (event.origin !== window.location.origin) {
        return;
    }

    // Se a mensagem do iframe for para fechar, fecha o modal e atualiza a UI
    if (event.data === 'reward-claimed-and-close') {
        const rewardModal = document.getElementById('rewardVideoModal');
        if (rewardModal) {
            rewardModal.style.display = 'none';
        }
        document.getElementById('rewardFrame').src = 'about:blank';
        showFloatingMessage("Recompensa recebida com sucesso!");
        fetchAndDisplayPlayerInfo(true); // Atualiza as informações do jogador
    }
});

// Nova lógica para os botões de "Assistir Vídeo"
const watchVideoButtons = document.querySelectorAll('.watch-video-btn');

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

        const log = playerData.daily_rewards_log || {};
        const counts = (log && log.counts) ? log.counts : {};
        const logDateStr = log && log.date ? String(log.date) : null;

        // Converte a data do log para string YYYY-MM-DD (espera que o backend use UTC date)
        const todayUtc = new Date(new Date().toISOString().split('T')[0]).toISOString().split('T')[0];

        // Se não houver data ou for de outro dia, não bloqueia (reset diário ainda não aplicado no frontend)
        if (!logDateStr || String(logDateStr).split('T')[0] !== todayUtc) {
            // limpa estilos caso existam
            watchVideoButtons.forEach(btn => {
                btn.disabled = false;
                btn.style.filter = "";
                btn.style.pointerEvents = "";
                // restaura texto caso tenha sido alterado; cada botão tem label "Assistir" no HTML original
                if (btn.getAttribute('data-original-text')) {
                    btn.textContent = btn.getAttribute('data-original-text');
                } else {
                    // guarda o texto original para uso futuro
                    btn.setAttribute('data-original-text', btn.textContent);
                }
            });
            return;
        }

        // Aplica bloqueios de acordo com counts
        watchVideoButtons.forEach(btn => {
            const type = btn.getAttribute('data-reward');
            const count = counts && (counts[type] !== undefined) ? parseInt(counts[type], 10) : 0;
            if (isNaN(count) || count < 5) {
                // ainda disponível
                btn.disabled = false;
                btn.style.filter = "";
                btn.style.pointerEvents = "";
                if (!btn.getAttribute('data-original-text')) {
                    btn.setAttribute('data-original-text', btn.textContent);
                } else {
                    btn.textContent = btn.getAttribute('data-original-text');
                }
            } else {
                // limite atingido
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



// Handler atualizado para links de recompensa (âncoras go:). Previne a navegação imediata,
// gera token, carrega iframe/modal e só então tenta acionar o wrapper.
// Mantém o fluxo via iframe para não forçar o jogador a sair da loja.
document.querySelectorAll('.reward-link').forEach(link => {
    link.addEventListener('click', async (e) => {
        e.preventDefault(); // impede o comportamento padrão do <a href="go:...">
        const rewardType = link.dataset.type || link.getAttribute('data-type') || link.getAttribute('data-reward');
        const rewardUrl = link.getAttribute('data-url') || link.href || link.getAttribute('href');
        link.style.pointerEvents = 'none'; // evita múltiplos cliques rápidos
        const originalText = link.textContent;
        link.textContent = 'Abrindo...';
        try {
            // 1) Gera token no servidor (deve estar autenticado)
            const { data: token, error: rpcError } = await supabaseClient.rpc('generate_reward_token', {
                p_reward_type: rewardType
            });
            if (rpcError) {
                // Mensagem clara para limite diário
                if (rpcError.message && rpcError.message.toLowerCase().includes('limite')) {
                    link.textContent = 'Limite atingido';
                    link.style.filter = "grayscale(100%) brightness(60%)";
                    link.disabled = true;
                    showFloatingMessage('Limite diário atingido para esta recompensa.');
                    checkRewardLimit();
                } else {
                    showFloatingMessage(`Erro: ${rpcError.message}`);
                    link.textContent = originalText;
                }
                link.style.pointerEvents = '';
                return;
            }

            // 2) Salva token localmente como fallback
            try { localStorage.setItem('pending_reward_token', token); } catch(e){}

            // 3) Prepara URL com token (caso o wrapper abra a página sem querystring)
            let finalUrl = rewardUrl;
            // Se rewardUrl já for do tipo /reward_xxx.html ou for "go:ancr", converta para a página correta
            if (finalUrl.startsWith('go:')) {
                const map = { 'ancr':'/reward_cristais.html', 'anca':'/reward_cartaocomum.html', 'anfr':'/reward_fragsr.html', 'anpr':'/reward_pedra.html' };
                const key = finalUrl.split(':')[1];
                finalUrl = map[key] || '/reward_cristais.html';
            }
            // Anexa querystring do token
            if (finalUrl.indexOf('?') === -1) finalUrl += `?claim_token=${token}`;
            else finalUrl += `&claim_token=${token}`;

            // 4) Carrega no iframe/modal (mantém fluxo atual)
            const rewardModal = document.getElementById('rewardVideoModal');
            const rewardFrame = document.getElementById('rewardFrame');
            if (rewardFrame) rewardFrame.src = finalUrl;
            if (rewardModal) rewardModal.style.display = 'flex';

            // 5) Tenta acionar o wrapper via um anchor "go:" (melhor esforço).
            try {
                const goMap = { 'crystals': 'ancr', 'common_card': 'anca', 'sr_fragment': 'anfr', 'reforge_stone': 'anpr' };
                const goId = goMap[rewardType];
                if (goId) {
                    const fake = document.createElement('a');
                    fake.href = `go:${goId}`;
                    fake.style.display = 'none';
                    document.body.appendChild(fake);
                    // dispatch click after small delay (apos criar iframe)
                    setTimeout(() => {
                        try {
                            fake.click();
                        } catch(e) {
                            // fallback dispatch
                            const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                            fake.dispatchEvent(evt);
                        } finally {
                            try { document.body.removeChild(fake); } catch(e){}
                        }
                    }, 300);
                }
            } catch (err) {
                console.warn('Erro ao tentar disparar comando go:', err);
            }

            // Atualiza visual de limites após essa tentativa
            checkRewardLimit();

        } catch (err) {
            showFloatingMessage('Erro inesperado: ' + (err.message || err));
            link.textContent = originalText;
        } finally {
            link.style.pointerEvents = '';
            link.textContent = originalText;
        }
    });
});


// Ao carregar a loja, verifica quais botões devem estar bloqueados
// chamamos com um pequeno delay para garantir que a sessão/auth esteja inicializada
setTimeout(() => {
    checkRewardLimit();
}, 600);

// fim do arquivo
