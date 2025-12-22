// desconstruir.js — versão corrigida para exibir Modal
(() => {
  const CRYSTAL_COST = 400;

  const ICONS = {
    crystal: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/cristais.webp",
    R: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_r.webp",
    SR: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_sr.webp",
    SSR: "https://raw.githubusercontent.com/cristianomellox/Aden-RPG/refs/heads/main/assets/itens/fragmento_ssr.webp",
  };

  // --- CORREÇÃO AQUI ---
  // Esta função agora manipula diretamente o modal do HTML em vez de usar alert()
  function showAlert(msg) {
    // Tenta pegar os elementos do modal que já existem no inventory.html
    const modal = document.getElementById('customAlertModal');
    const msgEl = document.getElementById('customAlertMessage');
    const okBtn = document.getElementById('customAlertOkBtn');

    if (modal && msgEl) {
      msgEl.textContent = msg;
      modal.style.display = 'flex'; // Mostra o modal
      modal.style.zIndex = '10001'; // Garante que fique acima de outros modais

      if (okBtn) {
        // Usa onclick para fechar, garantindo que não duplique eventos
        okBtn.onclick = () => {
          modal.style.display = 'none';
        };
      }
    } else {
      // Caso algo dê errado com o HTML, usa o alert nativo como último recurso
      alert(msg);
    }
  }
  // ---------------------

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
        // 1) Remove o item destruído
        if (typeof allInventoryItems !== 'undefined') {
            allInventoryItems = allInventoryItems.filter(inv => inv.id !== itemId);
        }
        if (typeof removeCacheItem === 'function') {
            await removeCacheItem(itemId);
        }

        // 2) Atualiza fragmentos retornados
        const fragMap = { R: 19, SR: 21, SSR: 22 };
        for (const [rarity, qty] of Object.entries(execData.fragments_returned || {})) {
          if (qty > 0) {
            const fragId = fragMap[rarity];
            const { data: fragData } = await __client
              .from("inventory_items")
              .select("*, items(*)")
              .eq("player_id", globalUser.id)
              .eq("item_id", fragId)
              .single();

            if (fragData && typeof allInventoryItems !== 'undefined') {
              const idx = allInventoryItems.findIndex(it => it.item_id === fragId);
              if (idx !== -1) {
                allInventoryItems[idx].quantity = fragData.quantity;
              } else {
                allInventoryItems.push(fragData);
              }
              if (typeof updateCacheItem === 'function') await updateCacheItem(fragData);
            }
          }
        }

        // 3) Atualiza cristais do jogador
        const { data: updatedPlayer } = await __client
          .from("players")
          .select("crystals")
          .eq("id", globalUser.id)
          .single();

        if (updatedPlayer && typeof playerBaseStats !== 'undefined') {
          playerBaseStats.crystals = updatedPlayer.crystals;
        }

        // 4) Render UI
        if (typeof calculatePlayerStats === 'function') calculatePlayerStats();
        if (typeof renderEquippedItems === 'function') renderEquippedItems();
        if (typeof loadItems === 'function') loadItems("all", allInventoryItems);

        showAlert(`Item desconstruído!\n\nRetorno:\nR: ${execData.fragments_returned.R}\nSR: ${execData.fragments_returned.SR}\nSSR: ${execData.fragments_returned.SSR}\nCristais gastos: ${execData.crystals_spent}`);
      } catch (err) {
        console.error("Erro pós-desconstrução:", err);
        showAlert("Item desconstruído, mas houve falha ao atualizar a bolsa visualmente.");
      }
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("deconstructBtn");
    if (btn && !btn.dataset.boundDeconstruct) {
      btn.addEventListener("click", () => {
        const sel = (typeof selectedItem !== "undefined" && selectedItem) ? selectedItem : (window.selectedItem || null);
        
        // --- AQUI ESTÁ A LÓGICA MANTIDA, MAS AGORA USA O SHOWALERT NOVO ---
        if (!sel || !sel.id) { 
            showAlert("Retire o equipamento antes de desconstruir."); 
            return; 
        }
        
        handleDeconstruct(sel.id);
      });
      btn.dataset.boundDeconstruct = "1";
    }
  });

  window.handleDeconstruct = handleDeconstruct;
})();