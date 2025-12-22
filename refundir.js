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
    if (reforgeModal) {
       reforgeModal.querySelector(".modal-content").insertBefore(costDisplay, reforgeMessage);
    }

    let currentItem = null;
    let pendingRolls = [];

    // Abre o modal de refundição
    reforgeBtn?.addEventListener('click', async () => {
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
            <img src="https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/pedra_de_refundicao.webp"
                 style="width:30px;height:30px;margin-right:6px;"> X${cost}
        `;

        // Carrega tentativa anterior (se existir)
        if (currentItem.pending_reforge) {
            showPendingRolls(currentItem.pending_reforge);
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
            // 1. Calcula o custo em pedras no cliente antes de chamar o servidor.
            const totalStars = (currentItem.items?.stars || 0) + (currentItem.refine_level || 0);
            const stonesUsed = totalStars === 4 ? 5 : 10;

            const { data, error } = await supabase.rpc("refund_item", {
                p_inventory_item_id: currentItem.id,
                p_player_id: globalUser.id
            });

            if (error) {
                console.error(error);
                showCustomAlert("Erro ao refundir: " + error.message);
                return;
            }
            if (data.error) {
                showCustomAlert(data.error);
                return;
            }

            // 2. Atualiza a quantidade de pedras de refundição na UI.
            const stoneId = 20; // ID do item "Pedra de Refundição"
            const stoneItem = allInventoryItems.find(item => item.item_id === stoneId);

            if (stoneItem) {
                // Subtrai a quantidade do item no inventário local
                stoneItem.quantity -= stonesUsed;

                // Atualiza o item no cache do IndexedDB para persistir a mudança
                await updateCacheItem(stoneItem);

                // Re-renderiza os itens na bolsa para refletir a nova quantidade.
                const currentTab = document.querySelector('.tab-button.active')?.id.replace('tab-', '') || 'all';
                loadItems(currentTab, allInventoryItems);
            }

            pendingRolls = data.rolls || [];
            showPendingRolls(pendingRolls);
            reforgeMessage.textContent = "Clique em Aplicar para salvar ou role novamente.";
            applyBtn.style.display = 'inline-block';
        } catch (err) {
            console.error(err);
            showCustomAlert("Erro inesperado ao tentar refundir.");
        }
    });

    // Aplica atributos chamando RPC
    applyBtn?.addEventListener('click', async () => {
        if (!currentItem) return;

        try {
            const { error } = await supabase.rpc("apply_reforge", {
                p_inventory_item_id: currentItem.id,
                p_player_id: globalUser.id
            });

            if (error) {
                console.error(error);
                showCustomAlert("Erro ao aplicar refundição: " + error.message);
                return;
            }

            showCustomAlert("Atributos aplicados com sucesso!");
            applyBtn.style.display = 'none';
            reforgeModal.style.display = 'none';

            // --- LÓGICA CORRIGIDA: BUSCA E ATUALIZA ---
            // 1. Busca o item atualizado do banco de dados
            const { data: updatedItemData, error: fetchError } = await supabase
                .from('inventory_items')
                .select(`*, items(*)`)
                .eq('id', currentItem.id)
                .single();

            if (fetchError) {
                console.error("Erro ao buscar item atualizado:", fetchError);
                return;
            }
            
            if (updatedItemData) {
                // 2. Encontra e atualiza o item na lista de inventário global
                const updatedItemIndex = allInventoryItems.findIndex(i => i.id === updatedItemData.id);
                if (updatedItemIndex !== -1) {
                    allInventoryItems[updatedItemIndex] = updatedItemData;
                    await updateCacheItem(updatedItemData);
                }

                // 3. Atualiza as referências globais
                selectedItem = updatedItemData;
                equippedItems = allInventoryItems.filter(invItem => invItem.equipped_slot !== null);

                // 4. Atualiza todas as exibições na UI
                calculatePlayerStats();
                renderEquippedItems();
                loadItems('all', allInventoryItems);
                showItemDetails(selectedItem);
            }
            // --- FIM DA LÓGICA CORRIGIDA ---

        } catch (err) {
            console.error(err);
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

            // After ~1 second, switch to the real value and color
            setTimeout(() => {
                div.classList.remove('shimmer');
                let formattedValue = r.value;
                const formattedName = formatAttrName(r.attr);
                if (formattedName === 'TAXA CRIT' || formattedName === 'DANO CRIT' || formattedName === 'EVASÃO') {
                    formattedValue += '%';
                }
                div.textContent = `${formattedName} +${formattedValue}`;
                div.style.background = r.color;
                div.style.color = "black";
            }, 1000);
        });
    }

    // Renderiza os atributos de reforge existentes
    function displayExistingReforgeSlots(item) {
        slotsContainer.innerHTML = '';
        
        // Verifica se o item tem um primeiro slot de reforge e o exibe
        if (item.reforge_slot1) {
            const slot1Div = document.createElement('div');
            slot1Div.className = 'refine-row';
            slot1Div.innerHTML = `
                <img src="https://raw.githubusercontent.com/cristianomellox/Aden-RPG/main/assets/refund.webp" alt="Reforjado" class="refine-icon" style="width: 55px; height: 55px;">
                <p>${formatAttrName(item.reforge_slot1.attr)} +${item.reforge_slot1.value}</p>
            `;
            slot1Div.style.background = item.reforge_slot1.color;
            slot1Div.style.color = "black";
            slotsContainer.appendChild(slot1Div);
        } else {
            // Se o slot 1 não estiver preenchido, exibe a mensagem de bloqueio
            const slot1Div = document.createElement('div');
            slot1Div.className = 'refine-row';
            slot1Div.innerHTML = `
                <p>Espaço de Refundição para 4 estrelas</p>
            `;
            slotsContainer.appendChild(slot1Div);
        }
        
        // Verifica se o item tem um segundo slot de reforge e o exibe
        if (item.reforge_slot2) {
            const slot2Div = document.createElement('div');
            slot2Div.className = 'refine-row';
            slot2Div.innerHTML = `
                <img src="https://raw.githubusercontent.com/cristianomellox/Aden-RPG/main/assets/refund.webp" alt="Reforjado" class="refine-icon" style="width: 55px; height: 55px;">
                <p>${formatAttrName(item.reforge_slot2.attr)} +${item.reforge_slot2.value}</p>
            `;
            slot2Div.style.background = item.reforge_slot2.color;
            slot2Div.style.color = "black";
            slotsContainer.appendChild(slot2Div);
        } else {
            // Se o slot 2 não estiver preenchido, exibe a mensagem de bloqueio
            const slot2Div = document.createElement('div');
            slot2Div.className = 'refine-row';
            slot2Div.innerHTML = `
                <p>Espaço de Refundição para 5 estrelas</p>
            `;
            slotsContainer.appendChild(slot2Div);
        }
    }

    // Converte nome do campo para nome visível
    function formatAttrName(attr) {
        switch (attr) {
            case "attack_bonus": return "ATK";
            case "defense_bonus": return "DEF";
            case "health_bonus": return "HP";
            case "crit_chance_bonus": return "TAXA CRIT";
            case "crit_damage_bonus": return "DANO CRIT";
            case "evasion_bonus": return "EVASÃO";
            default: return attr;
        }
    }
});