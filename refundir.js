document.addEventListener('DOMContentLoaded', () => {
    const reforgeBtn = document.getElementById('reforgeItemBtn');
    const closeReforgeModal = document.getElementById('closeReforgeModal');
    const reforgeModal = document.getElementById('reforgeModal');
    const reforgeBtnRoll = document.getElementById('reforgeBtn');
    const applyBtn = document.getElementById('applyReforgeBtn');
    const rolledContainer = document.getElementById('rolledAttributesContainer');
    const slotsContainer = document.getElementById('reforgeSlotsContainer');
    const reforgeMessage = document.getElementById('reforgeMessage');

    const costDisplay = document.createElement("div");
    costDisplay.id = "reforgeCostDisplay";
    costDisplay.style.display = "flex";
    costDisplay.style.alignItems = "center";
    costDisplay.style.justifyContent = "center";
    costDisplay.style.marginTop = "8px";
    reforgeModal.querySelector(".modal-content").insertBefore(costDisplay, reforgeMessage);

    let currentItem = null;
    let pendingRolls = [];

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

        displayExistingReforgeSlots(currentItem);

        const cost = totalStars === 4 ? 5 : 10;
        costDisplay.innerHTML = `
            <img src="https://aden-rpg.pages.dev/assets/itens/pedra_de_refundicao.webp"
                 style="width:30px;height:30px;margin-right:6px;"> X${cost}
        `;

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

    reforgeBtnRoll?.addEventListener('click', async () => {
        if (!currentItem) return;

        try {
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

            // Atualização Local: Deduz pedras
            const stoneId = 20; 
            const stoneItem = allInventoryItems.find(item => item.item_id === stoneId);

            if (stoneItem) {
                stoneItem.quantity -= stonesUsed;
                // Usa a função global se disponível, senão atualiza manual
                if (window.adenUpdateInventoryItem) {
                    window.adenUpdateInventoryItem(stoneItem);
                }
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

    applyBtn?.addEventListener('click', async () => {
        if (!currentItem) return;

        try {
            const { data, error } = await supabase.rpc("apply_reforge", {
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

            // =======================================================
            // LÓGICA ZERO EGRESS CORRIGIDA
            // =======================================================
            if (data && data.updated_item && window.adenUpdateInventoryItem) {
                // Atualiza o item no cache global sem refresh
                await window.adenUpdateInventoryItem(data.updated_item);
                
                // Atualiza a referência local do modal de detalhes
                selectedItem = data.updated_item;
                showItemDetails(selectedItem);
            } else {
                // Fallback (não deve ocorrer com o novo SQL)
                loadPlayerAndItems(true);
            }

        } catch (err) {
            console.error(err);
            showCustomAlert("Erro inesperado ao aplicar refundição.");
        }
    });

    function showPendingRolls(rolls) {
        rolledContainer.innerHTML = '';
        (rolls || []).forEach(r => {
            const div = document.createElement('div');
            div.className = 'shimmer'; 
            div.style.padding = "6px";
            div.style.margin = "4px 0";
            div.style.borderRadius = "6px";
            rolledContainer.appendChild(div);

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

    function displayExistingReforgeSlots(item) {
        slotsContainer.innerHTML = '';
        
        if (item.reforge_slot1) {
            const slot1Div = document.createElement('div');
            slot1Div.className = 'refine-row';
            slot1Div.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Reforjado" class="refine-icon" style="width: 55px; height: 55px;">
                <p>${formatAttrName(item.reforge_slot1.attr)} +${item.reforge_slot1.value}</p>
            `;
            slot1Div.style.background = item.reforge_slot1.color;
            slot1Div.style.color = "black";
            slotsContainer.appendChild(slot1Div);
        } else {
            const slot1Div = document.createElement('div');
            slot1Div.className = 'refine-row';
            slot1Div.innerHTML = `
                <p>Espaço de Refundição para 4 estrelas</p>
            `;
            slotsContainer.appendChild(slot1Div);
        }
        
        if (item.reforge_slot2) {
            const slot2Div = document.createElement('div');
            slot2Div.className = 'refine-row';
            slot2Div.innerHTML = `
                <img src="https://aden-rpg.pages.dev/assets/refund.webp" alt="Reforjado" class="refine-icon" style="width: 55px; height: 55px;">
                <p>${formatAttrName(item.reforge_slot2.attr)} +${item.reforge_slot2.value}</p>
            `;
            slot2Div.style.background = item.reforge_slot2.color;
            slot2Div.style.color = "black";
            slotsContainer.appendChild(slot2Div);
        } else {
            const slot2Div = document.createElement('div');
            slot2Div.className = 'refine-row';
            slot2Div.innerHTML = `
                <p>Espaço de Refundição para 5 estrelas</p>
            `;
            slotsContainer.appendChild(slot2Div);
        }
    }

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