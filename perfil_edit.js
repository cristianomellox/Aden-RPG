// perfil_edit.js

// =========================================================
// >>> ADEN GLOBAL DB (Para Atualização Local) <<<
// =========================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 6;
const PLAYER_STORE = 'player_store';
const AUTH_STORE = 'auth_store'; 

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    getAuth: async function() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(AUTH_STORE, 'readonly');
                const req = tx.objectStore(AUTH_STORE).get('current_session');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    },
    updatePlayerPartial: async function(changes) {
        try {
            const db = await this.open();
            const tx = db.transaction(PLAYER_STORE, 'readwrite');
            const store = tx.objectStore(PLAYER_STORE);
            const currentData = await new Promise(resolve => {
                const req = store.get('player_data');
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            });
            if (currentData) {
                const newData = { ...currentData, ...changes };
                store.put({ key: 'player_data', value: newData });
            }
        } catch(e) { console.warn("Erro update parcial no Perfil Edit", e); }
    }
};

// =========================================================
// >>> CLOUDINARY UPLOAD FUNCTION <<<
// =========================================================
async function uploadAvatarAoCloudinary(file) {
    const cloudName = 'dbrghqhqy';
    const uploadPreset = 'avatars_preset'; 
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/upload`, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Erro no upload');
    }

    const data = await response.json();

    // Prioriza transformação eager (webp otimizado) se existir
    if (data.eager && data.eager.length > 0) {
        return data.eager[0].secure_url; 
    }

    return data.secure_url;
}

// =========================================================

let originalProfileData = {};

document.addEventListener("DOMContentLoaded", () => {
    // Referências aos elementos do DOM
    const profileEditModal = document.getElementById("profileEditModal");
    const editPlayerNameInput = document.getElementById("editPlayerName");
    const lockedTitleIcon = document.getElementById("lockedTitleIcon"); 
    const editPlayerFactionSelect = document.getElementById("editPlayerFaction");
    const editPlayerGenderSelect = document.getElementById("editPlayerGender"); 
    const avatarGrid = document.getElementById("avatarSelection");
    
    // CAMPOS DE AVATAR
    const selectedAvatarUrlInput = document.getElementById("selectedAvatarUrl"); // Hidden p/ avatares padrão
    const customAvatarUrlInput = document.getElementById("editPlayerCustomAvatarUrl"); // Hidden p/ Cloudinary
    const avatarFileInput = document.getElementById("avatarFileInput"); // O input de arquivo novo
    const uploadStatusText = document.getElementById("uploadStatusText"); // Texto de status

    const saveProfileBtn = document.getElementById("saveProfileBtn");
    const closeProfileModalBtn = document.getElementById("closeProfileModalBtn");
    const editProfileIcon = document.getElementById("editProfileIcon");
    const profileEditMessage = document.getElementById('profileEditMessage');

    if (editPlayerNameInput) {
        editPlayerNameInput.maxLength = 13; 
    }

    const avatarUrls = [
        'https://aden-rpg.pages.dev/assets/avatar01.webp', 'https://aden-rpg.pages.dev/assets/avatar02.webp',
        'https://aden-rpg.pages.dev/assets/avatar03.webp', 'https://aden-rpg.pages.dev/assets/avatar04.webp',
        'https://aden-rpg.pages.dev/assets/avatar05.webp', 'https://aden-rpg.pages.dev/assets/avatar06.webp',
        'https://aden-rpg.pages.dev/assets/avatar07.webp', 'https://aden-rpg.pages.dev/assets/avatar08.webp',
        'https://aden-rpg.pages.dev/assets/avatar09.webp', 'https://aden-rpg.pages.dev/assets/avatar10.webp',
        'https://aden-rpg.pages.dev/assets/avatar11.webp', 'https://aden-rpg.pages.dev/assets/avatar12.webp',
        'https://aden-rpg.pages.dev/assets/avatar13.webp', 'https://aden-rpg.pages.dev/assets/avatar14.webp'
    ];

    // --- LÓGICA DE UPLOAD (Novo) ---
    if (avatarFileInput) {
        avatarFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Limpa seleção da grid de avatares padrão
            document.querySelectorAll('.avatar-option.selected').forEach(i => i.classList.remove('selected'));
            selectedAvatarUrlInput.value = '';

            // UI de Carregando
            uploadStatusText.textContent = "Enviando imagem...";
            uploadStatusText.className = "uploading-text";
            saveProfileBtn.disabled = true; // Impede salvar durante upload

            try {
                const uploadedUrl = await uploadAvatarAoCloudinary(file);
                
                // Sucesso
                customAvatarUrlInput.value = uploadedUrl; // Coloca a URL no input hidden
                uploadStatusText.textContent = "Imagem carregada com sucesso!";
                uploadStatusText.className = "";
                uploadStatusText.style.color = "#4CAF50"; // Verde
                
            } catch (error) {
                console.error("Erro upload:", error);
                uploadStatusText.textContent = "Erro ao enviar. Tente outra imagem.";
                uploadStatusText.style.color = "#ff5f5f"; // Vermelho
                customAvatarUrlInput.value = '';
            } finally {
                saveProfileBtn.disabled = false;
            }
        });
    }

    function renderAvatarOptions(selectedUrl = '') {
        if (!avatarGrid || !selectedAvatarUrlInput) return;

        avatarGrid.innerHTML = '';
        avatarUrls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.classList.add('avatar-option');
            img.title = "Clique para selecionar";
            
            // Verifica se é o selecionado
            if (selectedUrl === url) {
                 img.classList.add('selected');
            }
            
            img.onclick = () => {
                // Remove seleção visual
                document.querySelectorAll('.avatar-option').forEach(i => i.classList.remove('selected'));
                img.classList.add('selected');
                
                // Define valor no input de avatar padrão
                selectedAvatarUrlInput.value = url;
                
                // Limpa o custom avatar (Cloudinary)
                if(customAvatarUrlInput) customAvatarUrlInput.value = '';
                if(uploadStatusText) {
                    uploadStatusText.textContent = "Usando avatar padrão";
                    uploadStatusText.style.color = "#aaa";
                }
                if(avatarFileInput) avatarFileInput.value = ""; // Reseta o input file
            };
            avatarGrid.appendChild(img);
        });
        
        // Lógica inicial ao abrir modal
        const isCustom = selectedUrl && !avatarUrls.includes(selectedUrl);
        if (isCustom) {
            // Se já tem um custom (vindo do banco), preenche o hidden e avisa
            if(customAvatarUrlInput) customAvatarUrlInput.value = selectedUrl;
            if(selectedAvatarUrlInput) selectedAvatarUrlInput.value = '';
            if(uploadStatusText) uploadStatusText.textContent = "Avatar personalizado atual carregado.";
        } else {
             // Se é padrão
             if(customAvatarUrlInput) customAvatarUrlInput.value = '';
             if(selectedAvatarUrlInput) selectedAvatarUrlInput.value = selectedUrl || avatarUrls[0];
             if(uploadStatusText) uploadStatusText.textContent = "Nenhum arquivo.";
        }
    }

    // --- FUNÇÃO DE UPDATE DO MODAL ---
    window.updateProfileEditModal = (playerData) => {
        if (playerData) {
            let currentName = playerData.name;
            let iconPrefix = "";

            const icons = ['👑', '⚜️', '🤡', '🔰', '🛡️', '❤️'];
            for (const icon of icons) {
                if (currentName.startsWith(icon)) {
                    iconPrefix = icon;
                    currentName = currentName.substring(icon.length).trim();
                    break; 
                }
            }

            if (lockedTitleIcon) {
                if (iconPrefix) {
                    lockedTitleIcon.textContent = iconPrefix;
                    lockedTitleIcon.style.display = "block";
                    lockedTitleIcon.style.marginRight = "5px";
                } else {
                    lockedTitleIcon.textContent = "";
                    lockedTitleIcon.style.display = "none";
                }
            }
            
            if (editPlayerNameInput) editPlayerNameInput.value = currentName;
            if (editPlayerFactionSelect) editPlayerFactionSelect.value = playerData.faction;
            if (editPlayerGenderSelect) editPlayerGenderSelect.value = playerData.gender || "Masculino";

            renderAvatarOptions(playerData.avatar_url);
        }
    };

    if (editProfileIcon) {
        editProfileIcon.onclick = async () => {
            let userId = null;
            const globalAuth = await GlobalDB.getAuth();
            if (globalAuth && globalAuth.user) {
                userId = globalAuth.user.id;
            } else {
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (session && session.user) {
                    userId = session.user.id;
                }
            }

            if (userId) {
                const { data: playerData, error } = await supabaseClient
                    .from('players')
                    .select('name, faction, avatar_url, gender, nobless')
                    .eq('id', userId)
                    .single();
                
                if (playerData) {
                    if (profileEditMessage) profileEditMessage.textContent = ''; 
                    window.updateProfileEditModal(playerData);
                    profileEditModal.style.display = 'flex';
                }
            }
        };
    }

    if (closeProfileModalBtn) {
        closeProfileModalBtn.onclick = () => {
            profileEditModal.style.display = 'none';
        };
    }

    if (saveProfileBtn) {
        saveProfileBtn.onclick = async () => {
            if (profileEditMessage) profileEditMessage.textContent = ''; 

            const rawName = editPlayerNameInput.value.trim();
            const newFaction = editPlayerFactionSelect.value;
            const newGender = editPlayerGenderSelect ? editPlayerGenderSelect.value : "Masculino";
            
            // AQUI ESTÁ O SEGREDINHO:
            // O código pega ou do input hidden (preenchido pelo Cloudinary)
            // Ou do selected (preenchido pela Grid)
            const newAvatar = customAvatarUrlInput.value.trim() || selectedAvatarUrlInput.value;

            // Validações
            if (!rawName || rawName.length < 3) {
                 if(profileEditMessage) profileEditMessage.textContent = "O nome do jogador deve ter pelo menos 3 caracteres (sem contar o título).";
                 return;
            }
            if (!newAvatar) {
                 if(profileEditMessage) profileEditMessage.textContent = "Por favor, selecione um avatar ou envie uma imagem.";
                 return;
            }

            const regexEmoji = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/;
            if (regexEmoji.test(rawName)) {
                 if(profileEditMessage) profileEditMessage.textContent = "Por favor, remova os emojis do campo de texto. Seu título será adicionado automaticamente pelo sistema.";
                 return;
            }

            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = 'Salvando...';

            try {
                const { data, error } = await supabaseClient.rpc('update_player_profile', {
                    p_name: rawName,
                    p_faction: newFaction,
                    p_avatar_url: newAvatar,
                    p_gender: newGender
                });

                if (error) throw error;

                showFloatingMessage('Perfil atualizado com sucesso!');
                
                const finalName = (typeof data === 'string' && data.length > 0) ? data : rawName;

                await GlobalDB.updatePlayerPartial({
                    name: finalName,
                    faction: newFaction,
                    avatar_url: newAvatar,
                    gender: newGender
                });
                console.log("⚡ [Perfil] Dados atualizados no GlobalDB.");

                profileEditModal.style.display = 'none';
                
                if (typeof fetchAndDisplayPlayerInfo === 'function') {
                    fetchAndDisplayPlayerInfo(true); 
                }

            } catch (error) {
                console.error('Erro ao atualizar perfil:', error);
                if (profileEditMessage) {
                    let errorMessage = 'Ocorreu um erro ao atualizar o perfil.'; 
                    if (error.code === '23505' && error.message.includes('players_name_key')) {
                         errorMessage = "Esse nome já está em uso.";
                    } else if (error.message) {
                        errorMessage = error.message;
                    }
                    profileEditMessage.textContent = errorMessage;
                    profileEditMessage.style.color = '#ff9999';
                }
            } finally {
                saveProfileBtn.disabled = false;
                saveProfileBtn.textContent = 'Salvar Perfil';
            }
        };
    }
});