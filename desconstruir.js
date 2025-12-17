// desconstruir.js — versão com cache incremental (preview + execução)
(() => {
  const CRYSTAL_COST = 400;

  const ICONS = {
    crystal: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/cristais.webp",
    R: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_r.webp",
    SR: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_sr.webp",
    SSR: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_ssr.webp",
  };

  function showAlert(msg) {
    if (typeof window.showCustomAlert === "function") return window.showCustomAlert(msg);
    alert(msg);
  }

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
    if (!__client) { showAlert("Erro: Supabase não inicializado."); return; }
    if (!itemId) { showAlert("Item inválido."); return; }

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

      if (execErr) { showAlert("Erro: " + execErr.message); return; }
      if (execData.error) { showAlert(execData.error); return; }

      hideModal(modal);
      const details = document.getElementById("itemDetailsModal");
      if (details) hideModal(details);

      try {
        // =======================================================
        // LÓGICA ZERO EGRESS ATUALIZADA
        // =======================================================
        
        // 1) Remove o item destruído do cache local
        if (typeof removeCacheItem === 'function' && Array.isArray(allInventoryItems)) {
             allInventoryItems = allInventoryItems.filter(inv => inv.id !== itemId);
             await removeCacheItem(itemId);
        }

        // 2) Adiciona/Atualiza os fragmentos retornados
        if (execData.new_inventory_items && window.adenUpdateInventoryItem) {
            await window.adenUpdateInventoryItem(execData.new_inventory_items);
        }

        // 3) Atualiza cristais do jogador (playerBaseStats)
        if (typeof playerBaseStats !== 'undefined' && execData.crystals_spent) {
            playerBaseStats.crystals = Math.max(0, (playerBaseStats.crystals || 0) - execData.crystals_spent);
            if (typeof saveCache === 'function') saveCache(allInventoryItems); // Salva stats
        }
        
        // 4) Atualiza UI
        if (typeof calculatePlayerStats === 'function') calculatePlayerStats();
        if (typeof renderEquippedItems === 'function') renderEquippedItems();
        if (typeof loadItems === 'function') loadItems("all");

        showAlert(`Item desconstruído!\n\nRetorno:\nR: ${execData.fragments_returned.R}\nSR: ${execData.fragments_returned.SR}\nSSR: ${execData.fragments_returned.SSR}\nCristais gastos: ${execData.crystals_spent}`);
      } catch (err) {
        console.error("Erro pós-desconstrução:", err);
        showAlert("Item desconstruído, mas houve falha ao atualizar a visualização.");
      }
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("deconstructBtn");
    if (btn && !btn.dataset.boundDeconstruct) {
      btn.addEventListener("click", () => {
        const sel = (typeof selectedItem !== "undefined" && selectedItem) ? selectedItem : (window.selectedItem || null);
        if (!sel || !sel.id) { showAlert("Selecione um item antes de desconstruir."); return; }
        handleDeconstruct(sel.id);
      });
      btn.dataset.boundDeconstruct = "1";
    }
  });

  window.handleDeconstruct = handleDeconstruct;
})();