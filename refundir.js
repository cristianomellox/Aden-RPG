
// refundir.js
document.addEventListener('DOMContentLoaded', () => {
    // --- IMPLEMENTAÇÃO LOCAL DO MODAL DE ALERTA (Scope Fix) ---
    const showCustomAlert = (msg) => {
        const modal = document.getElementById('customAlertModal');
        const msgEl = document.getElementById('customAlertMessage');
        const okBtn = document.getElementById('customAlertOkBtn');

        if (modal && msgEl) {
            msgEl.textContent = msg;
            modal.style.display = 'flex';
            modal.style.zIndex = '10005'; // Garante que fique acima do modal de refund
            
            if (okBtn) {
                // Clona para remover listeners antigos
                const newBtn = okBtn.cloneNode(true);
                okBtn.parentNode.replaceChild(newBtn, okBtn);
                newBtn.onclick = () => {
                    modal.style.display = 'none';
                };
            }
        } else {
            alert(msg); // Fallback
        }
    };
    // -----------------------------------------------------------

    const reforgeBtn = document.getElementById('reforgeItemBtn');
    const closeReforgeModal = document.getElementById('closeReforgeModal');
    const reforgeModal = document.getElementById('reforgeModal');
    const reforgeBtnRoll = document.getElementById('reforgeBtn');
    const applyBtn = document.getElementById('applyReforgeBtn');
    const rolledContainer = document.getElementById('rolledAttributesContainer');
    const slotsContainer = document.getElementById('reforgeSlotsContainer');
    const reforgeMessage = document.getElementById('reforgeMessage');

    // Onde mostra o custo em pedras
    const costDisplay = document.createElement("div");
    costDisplay.id = "reforgeCostDisplay";
    costDisplay.style.display = "flex";
    costDisplay.style.alignItems = "center";
    costDisplay.style.justifyContent = "center";
    costDisplay.style.marginTop = "8px";
    
    // Evita duplicar o costDisplay se o script rodar 2x
    if (reforgeModal && !document.getElementById('reforgeCostDisplay')) {
       reforgeModal.querySelector(".modal-content").insertBefore(costDisplay, reforgeMessage);
    }

    let currentItem = null;
    let pendingRolls = [];

    // Abre o modal de refundição
    reforgeBtn?.addEventListener('click', async () => {
        // Pega o item mais atualizado da lista global para garantir que temos o quantity/pending_reforge certos
        const freshItem = allInventoryItems.find(i => i.id === selectedItem?.id);
        if (freshItem) {
            selectedItem = freshItem;
            // Se necessário, re-hidrata
            if (!selectedItem.items) {
                 selectedItem = window.hydrateItem ? window.hydrateItem(selectedItem) : selectedItem;
            }
        }
        
        if (!selectedItem) {
            showCustomAlert("Nenhum item selecionado para refundir.");
            return;
        }
        
        currentItem = selectedItem;
        const totalStars = (currentItem.items?.stars || 0) + (currentItem.refine_level || 0);

        if (totalStars < 4) {
            showCustomAlert("Você precisa refinar o item para pelo menos 4 estrelas para desbloquear refundição.");
            return;
        }

        slotsContainer.innerHTML = '';
        rolledContainer.innerHTML = '';
        reforgeMessage.textContent = "Use pedras para gerar novos atributos.";

        // Lógica para exibir os slots de reforge existentes
        displayExistingReforgeSlots(currentItem);

        // Determina custo de pedras
        const cost = totalStars === 4 ? 5 : 10;
        costDisplay.innerHTML = `
            <img src="https://aden-rpg.pages.dev/assets/itens/pedra_de_refundicao.webp"
                 style="width:30px;height:30px;margin-right:6px;" onerror="this.src='https://aden-rpg.pages.dev/assets/itens/unknown.webp'"> X${cost}
        `;

        // Carrega tentativa anterior (se existir)
        if (currentItem.pending_reforge && Array.isArray(currentItem.pending_reforge) && currentItem.pending_reforge.length > 0) {
            pendingRolls = currentItem.pending_reforge;
            showPendingRolls(pendingRolls);
            reforgeMessage.textContent = "Você tem uma refundição pendente. Clique em Aplicar para salvar ou role novamente.";
            applyBtn.style.display = 'inline-block';
        } else {
            applyBtn.style.display = 'none';
        }

        reforgeModal.style.display = 'flex';
    });

    closeReforgeModal?.addEventListener('click', () => {
        reforgeModal.style.display = 'none';
    });

    // Rola atributos chamando RPC
    reforgeBtnRoll?.addEventListener('click', async () => {
        if (!currentItem) return;

        try {
            // 1. Calcula o custo em pedras no cliente
            const totalStars = (currentItem.items?.stars || 0) + (currentItem.refine_level || 0);
            const stonesUsed = totalStars === 4 ? 5 : 10;
            const stoneId = 20; // ID do item "Pedra de Refundição"

            // Verifica se tem pedras antes de chamar o servidor
            const stoneItem = allInventoryItems.find(item => item.item_id === stoneId);
            if (!stoneItem || stoneItem.quantity < stonesUsed) {
                showCustomAlert("Você não tem Pedras de Refundição suficientes.");
                return;
            }

            // Loading state
            reforgeBtnRoll.disabled = true;
            reforgeBtnRoll.textContent = "...";

            const { data, error } = await supabase.rpc("refund_item", {
                p_inventory_item_id: currentItem.id,
                p_player_id: globalUser.id
            });

            reforgeBtnRoll.disabled = false;
            reforgeBtnRoll.textContent = "REFUNDIR";

            if (error) {
                console.error(error);
                showCustomAlert("Erro ao refundir: " + error.message);
                return;
            }
            if (data.error) {
                showCustomAlert(data.error);
                return;
            }

            // 2. Atualiza a quantidade de pedras de refundição LOCALMENTE
            // CORREÇÃO: Usando a assinatura correta de updateLocalInventoryState({ ... })
            if (typeof updateLocalInventoryState === 'function' && stoneItem) {
                await updateLocalInventoryState({
                    usedFragments: [{ id: stoneItem.id, qty: stonesUsed }]
                });
            }

            // Atualiza o currentItem com o pending_reforge retornado para persistência local temporária
            pendingRolls = data.rolls || [];
            currentItem.pending_reforge = pendingRolls;
            
            // Atualiza o item no array principal para caso feche o modal
            const idx = allInventoryItems.findIndex(i => i.id === currentItem.id);
            if (idx !== -1) {
                allInventoryItems[idx].pending_reforge = pendingRolls;
            }

            showPendingRolls(pendingRolls);
            reforgeMessage.textContent = "Clique em Aplicar para salvar ou role novamente.";
            applyBtn.style.display = 'inline-block';
            
        } catch (err) {
            console.error(err);
            reforgeBtnRoll.disabled = false;
            reforgeBtnRoll.textContent = "REFUNDIR";
            showCustomAlert("Erro inesperado ao tentar refundir.");
        }
    });

    // Aplica atributos chamando RPC
    applyBtn?.addEventListener('click', async () => {
        if (!currentItem) return;

        try {
            applyBtn.disabled = true;
            applyBtn.textContent = "...";

            const { data, error } = await supabase.rpc("apply_reforge", {
                p_inventory_item_id: currentItem.id,
                p_player_id: globalUser.id
            });

            applyBtn.disabled = false;
            applyBtn.textContent = "Aplicar Atributos";

            if (error) {
                console.error(error);
                showCustomAlert("Erro ao aplicar refundição: " + error.message);
                return;
            }

            if (data && data.success) {
                showCustomAlert("Atributos aplicados com sucesso!");
                applyBtn.style.display = 'none';
                reforgeModal.style.display = 'none';

                // --- ATUALIZAÇÃO LOCAL ---
                // Se o servidor retornou os dados atualizados (recomendado), usamos eles.
                // Caso contrário, usamos lógica local para não precisar de refresh.
                
                let statsToUpdate = null;
                let itemUpdates = {};

                if (data.new_item_data) {
                    // Se alteramos o SQL para retornar dados, usamos aqui
                    itemUpdates = data.new_item_data;
                    statsToUpdate = data.player_stats;
                } else {
                     // Fallback se o SQL não retornar (limpa pending)
                     itemUpdates = { pending_reforge: null }; 
                     // Nota: Os status numéricos não atualizarão visualmente no item sem refresh se o SQL não retornar
                     // Por isso, é importante atualizar o apply_reforge.sql também.
                }

                if (typeof updateLocalInventoryState === 'function') {
                    // CORREÇÃO: Passando objeto para updateLocalInventoryState
                    await updateLocalInventoryState({
                        updatedItemId: currentItem.id,
                        newItemData: itemUpdates,
                        newStats: statsToUpdate
                    });
                }
            } else {
                showCustomAlert(data?.error || "Erro desconhecido ao aplicar.");
            }

        } catch (err) {
            console.error(err);
            applyBtn.disabled = false;
            applyBtn.textContent = "Aplicar Atributos";
            showCustomAlert("Erro inesperado ao aplicar refundição.");
        }
    });

    // Renderiza atributos sorteados no modal
    function showPendingRolls(rolls) {
        rolledContainer.innerHTML = '';
        (rolls || []).forEach(r => {
            const div = document.createElement('div');
            div.className = 'shimmer'; // First show the effect
            div.style.padding = "6px";
            div.style.margin = "4px 0";
            div.style.borderRadius = "6px";
            rolledContainer.appendChild(div);

            // After ~0.5 second, switch to the real value and color
            setTimeout(() => {
                div.classList.remove('shimmer');
                let formattedValue = r.value;
                const formattedName = formatAttrName(r.attr);
                if (['TAXA CRIT', 'DANO CRIT', 'EVASÃO'].includes(formattedName)) {
                    formattedValue += '%';
                }
                div.textContent = `${formattedName} +${formattedValue}`;
                div.style.background = r.color;
                div.style.color = "black";
                div.style.fontWeight = "bold";
                div.style.textShadow = "0px 0px 2px rgba(255,255,255,0.5)";
            }, 500);
        });
    }

    // Renderiza os atributos de reforge existentes
    function displayExistingReforgeSlots(item) {
        slotsContainer.innerHTML = '';
        
        // Helper interno
        const createSlotDiv = (slotData, minStars, label) => {
            const div = document.createElement('div');
            div.className = 'refine-row';
            div.style.marginBottom = "8px";
            
            if (slotData) {
                div.innerHTML = `
                    <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Reforjado" class="refine-icon" style="width: 40px; height: 40px;">
                    <p style="margin:0; font-size:1.1em; font-weight:bold;">${formatAttrName(slotData.attr)} +${slotData.value}${['TAXA CRIT', 'DANO CRIT', 'EVASÃO'].includes(formatAttrName(slotData.attr)) ? '%' : ''}</p>
                `;
                div.style.background = slotData.color;
                div.style.color = "black";
                div.style.border = "1px solid rgba(0,0,0,0.3)";
            } else {
                div.innerHTML = `<p style="margin:0; opacity:0.7;">${label}</p>`;
                div.style.background = "rgba(0,0,0,0.2)";
                div.style.border = "1px dashed rgba(255,255,255,0.1)";
            }
            return div;
        };
        
        slotsContainer.appendChild(createSlotDiv(item.reforge_slot1, 4, "Slot 1 (4★)"));
        slotsContainer.appendChild(createSlotDiv(item.reforge_slot2, 5, "Slot 2 (5★)"));
    }

    // Converte nome do campo para nome visível
    function formatAttrName(attr) {
        switch (attr) {
            case "attack_bonus": return "ATK";
            case "min_attack_bonus": return "ATK Min"; // Caso exista
            case "defense_bonus": return "DEF";
            case "health_bonus": return "HP";
            case "crit_chance_bonus": return "TAXA CRIT";
            case "crit_damage_bonus": return "DANO CRIT";
            case "evasion_bonus": return "EVASÃO";
            default: return attr;
        }
    }
});