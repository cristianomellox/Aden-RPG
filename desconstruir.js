// desconstruir.js — versão blindada (Validação interna na função)
(() => {
  const CRYSTAL_COST = 400;

  const ICONS = {
    crystal: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/cristais.webp",
    R: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_r.webp",
    SR: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_sr.webp",
    SSR: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_ssr.webp",
  };

  function ensureDeconstructModal() {
    let modal = document.getElementById("deconstructConfirmModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "deconstructConfirmModal";
      document.body.appendChild(modal);
    }
    modal.className = "modal-overlay";
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.background = "rgba(0,0,0,0.6)";
    modal.style.zIndex = "9999";
    modal.style.display = "none";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";

    modal.innerHTML = `
      <div class="modal-content" style="background: linear-gradient(180deg, rgba(150,50,50,0.95), rgba(100,30,30,0.95)); border:1px solid rgba(255,255,255,0.08); box-shadow: 0 10px 30px rgba(0,0,0,0.5); border-radius: 14px; padding: 16px; width: min(420px, 92vw); color: #eee;">
        <h3 style="margin:0 0 6px; text-align:center; font-weight:600;">Confirmar Desconstrução</h3>
        <p style="margin:0 0 10px; text-align:center; opacity:0.85;">Esta ação é <b>irreversível</b>.</p>
        <div id="deconstructCostRow" style="display:flex; align-items:center; justify-content:center; gap:8px; margin: 8px 0;">
          <span style="opacity:0.9;">Custo:</span>
          <img id="deconstructCostIcon" src="${ICONS.crystal}" width="28" height="28" alt="Cristal" />
          <span id="deconstructCostValue">x 400</span>
        </div>
        <div style="height:1px; background: rgba(255,255,255,0.12); margin: 6px 0 8px;"></div>
        <div style="text-align:center; margin-bottom:6px;">Retorno:</div>
        <div id="deconstructFragmentPreview" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; min-height:48px;"></div>
        <div style="display:flex; gap:1px; justify-content:center; margin-top:12px;">
          <button id="deconstructCancelBtn" class="action-btn">Cancelar</button>
          <button id="deconstructConfirmBtn" class="action-btn" style="background-image: none; background-color: grey; opacity: 0.8;">Confirmar</button>
        </div>
      </div>
    `;

    return {
      modal,
      preview: modal.querySelector("#deconstructFragmentPreview"),
      btnCancel: modal.querySelector("#deconstructCancelBtn"),
      btnConfirm: modal.querySelector("#deconstructConfirmBtn"),
    };
  }

  function showModal(modal) {
    modal.style.display = "flex";
  }
  function hideModal(modal) {
    modal.style.display = "none";
  }

  // 🔑 Chamado pelo botão "Desconstruir"
  async function handleDeconstruct(itemId) {
    const __client = (typeof supabase !== "undefined" ? supabase : (window.supabaseClient || null));
    if (!__client) { showCustomAlert("Erro: Supabase não inicializado."); return; }
    if (!itemId) { showCustomAlert("Item inválido."); return; }

    // --- NOVA VALIDAÇÃO DE SEGURANÇA LOCAL ---
    // Busca o item na lista global para verificar propriedades
    if (typeof allInventoryItems !== 'undefined') {
        const itemToCheck = allInventoryItems.find(i => i.id === itemId);
        // Se encontrou o item e ele tem equipped_slot preenchido
        if (itemToCheck && itemToCheck.equipped_slot) {
            showCustomAlert("Este item está equipado!\nDesequipe-o antes de tentar desconstruir.");
            return; // Interrompe a função aqui. O modal nem será criado.
        }
    }
    // -----------------------------------------

    const { modal, preview, btnCancel, btnConfirm } = ensureDeconstructModal();
    preview.innerHTML = "<p>Calculando retorno...</p>";
    showModal(modal);

    btnCancel.onclick = () => hideModal(modal);

    // Preview
    const { data, error } = await __client.rpc("deconstruct_preview", { p_inventory_item_id: itemId });
    if (error) {
      preview.innerHTML = "<p style='color:red;'>Erro ao calcular retorno.</p>";
      console.error(error);
      return;
    }
    if (data.error) {
      preview.innerHTML = `<p style='color:red;'>${data.error}</p>`;
      return;
    }

    const frags = data.fragments_returned || {};
    const spent = data.crystals_spent || CRYSTAL_COST;

    document.getElementById("deconstructCostValue").textContent = "x " + spent;
    preview.innerHTML = "";
    if (frags.R > 0) preview.innerHTML += `<div style="display:flex; align-items:center; justify-content:center; gap:8px;"><img src="${ICONS.R}" width="40" alt="R"/> <span>x ${frags.R}</span></div>`;
    if (frags.SR > 0) preview.innerHTML += `<div style="display:flex; align-items:center; justify-content:center; gap:8px;"><img src="${ICONS.SR}" width="40" alt="SR"/> <span>x ${frags.SR}</span></div>`;
    if (frags.SSR > 0) preview.innerHTML += `<div style="display:flex; align-items:center; justify-content:center; gap:8px;"><img src="${ICONS.SSR}" width="40" alt="SSR"/> <span>x ${frags.SSR}</span></div>`;

    // Confirmação
    btnConfirm.onclick = async () => {
      btnConfirm.disabled = true;
      const { data: execData, error: execErr } = await __client.rpc("deconstruct_item", { p_inventory_item_id: itemId });
      btnConfirm.disabled = false;

      if (execErr) { showCustomAlert("Erro: " + execErr.message); return; }
      if (execData.error) { showCustomAlert(execData.error); return; }

      hideModal(modal);
      const details = document.getElementById("itemDetailsModal");
      if (details) hideModal(details);

      try {
        // --- ATUALIZAÇÃO LOCAL (SEM DOWNLOAD) ---
        // 1. Remove o item desconstruído da lista local
        if (typeof allInventoryItems !== 'undefined') {
            const idx = allInventoryItems.findIndex(i => i.id === itemId);
            if (idx !== -1) {
                allInventoryItems.splice(idx, 1);
                // Também remove do cache IndexedDB
                if (typeof removeCacheItem === 'function') await removeCacheItem(itemId);
            }
        }

        // 2. Adiciona os fragmentos retornados à lista local (Busca no banco apenas os fragmentos para ter dados completos)
        const fragIdsToFetch = [];
        if (execData.fragments_returned.R > 0) fragIdsToFetch.push(19);
        if (execData.fragments_returned.SR > 0) fragIdsToFetch.push(21);
        if (execData.fragments_returned.SSR > 0) fragIdsToFetch.push(22);

        if (fragIdsToFetch.length > 0) {
            const { data: updatedFrags } = await __client
                .from("inventory_items")
                .select("*, items(*)")
                .eq("player_id", globalUser.id)
                .in("item_id", fragIdsToFetch);
            
            if (updatedFrags) {
                updatedFrags.forEach(fragData => {
                    const idx = allInventoryItems.findIndex(it => it.item_id === fragData.item_id);
                    if (idx !== -1) {
                        allInventoryItems[idx] = fragData; // Atualiza existente
                    } else {
                        allInventoryItems.push(fragData); // Adiciona novo
                    }
                });
            }
        }

        // 3. Atualiza cristais
        if (typeof playerBaseStats !== 'undefined') {
            playerBaseStats.crystals = (playerBaseStats.crystals || 0) - spent;
        }

        // 4. Salva Cache e Renderiza
        if (typeof updateCacheItem === 'function' && typeof saveCache === 'function') {
             // Re-salva tudo
             await saveCache(allInventoryItems, playerBaseStats, new Date().toISOString());
        }
        
        renderEquippedItems();
        loadItems("all", allInventoryItems);

        showCustomAlert(`Item desconstruído!\n\nRetorno:\nR: ${execData.fragments_returned.R}\nSR: ${execData.fragments_returned.SR}\nSSR: ${execData.fragments_returned.SSR}\nCristais gastos: ${execData.crystals_spent}`);
      } catch (err) {
        console.error("Erro pós-desconstrução:", err);
        showCustomAlert("Item desconstruído, mas houve falha ao atualizar a bolsa visualmente.");
      }
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("deconstructBtn");
    if (btn && !btn.dataset.boundDeconstruct) {
      btn.addEventListener("click", () => {
        const sel = (typeof selectedItem !== "undefined" && selectedItem) ? selectedItem : (window.selectedItem || null);
        
        if (!sel || !sel.id) { 
            showCustomAlert("Selecione um item para desconstruir."); 
            return; 
        }
        
        handleDeconstruct(sel.id);
      });
      btn.dataset.boundDeconstruct = "1";
    }
  });

  window.handleDeconstruct = handleDeconstruct;
})();