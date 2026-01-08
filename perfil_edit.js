// perfil_edit.js

// =========================================================
// >>> ADEN GLOBAL DB (Para Atualização Local) <<<
// =========================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 2;
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

let originalProfileData = {};

document.addEventListener("DOMContentLoaded", () => {
    // Referências aos elementos do DOM
    const profileEditModal = document.getElementById("profileEditModal");
    const editPlayerNameInput = document.getElementById("editPlayerName");
    const lockedTitleIcon = document.getElementById("lockedTitleIcon"); 
    const editPlayerFactionSelect = document.getElementById("editPlayerFaction");
    const editPlayerGenderSelect = document.getElementById("editPlayerGender"); 
    const avatarGrid = document.getElementById("avatarSelection");
    const selectedAvatarUrlInput = document.getElementById("selectedAvatarUrl");
    const customAvatarUrlInput = document.getElementById("editPlayerCustomAvatarUrl");
    const saveProfileBtn = document.getElementById("saveProfileBtn");
    const closeProfileModalBtn = document.getElementById("closeProfileModalBtn");
    const editProfileIcon = document.getElementById("editProfileIcon");
    const profileEditMessage = document.getElementById('profileEditMessage');

    if (editPlayerNameInput) {
        editPlayerNameInput.maxLength = 13; // Ajustado para permitir nomes razoáveis
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

    function renderAvatarOptions(selectedUrl = '') {
        if (!avatarGrid || !selectedAvatarUrlInput) return;

        avatarGrid.innerHTML = '';
        avatarUrls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.classList.add('avatar-option');
            img.title = "Clique para selecionar";
            if (selectedUrl === url) {
                 img.classList.add('selected');
            }
            img.onclick = () => {
                document.querySelectorAll('.avatar-option').forEach(i => i.classList.remove('selected'));
                img.classList.add('selected');
                selectedAvatarUrlInput.value = url;
                if(customAvatarUrlInput) customAvatarUrlInput.value = '';
            };
            avatarGrid.appendChild(img);
        });
        
        const isCustom = selectedUrl && !avatarUrls.includes(selectedUrl);
        if (isCustom) {
            if(customAvatarUrlInput) customAvatarUrlInput.value = selectedUrl;
            selectedAvatarUrlInput.value = '';
        } else {
             if(customAvatarUrlInput) customAvatarUrlInput.value = '';
             selectedAvatarUrlInput.value = selectedUrl || avatarUrls[0];
        }
    }

    if (customAvatarUrlInput) {
        customAvatarUrlInput.addEventListener('input', () => {
            document.querySelectorAll('.avatar-option.selected').forEach(i => i.classList.remove('selected'));
            selectedAvatarUrlInput.value = '';
        });
    }

    // --- FUNÇÃO DE UPDATE DO MODAL (CORRIGIDA) ---
    window.updateProfileEditModal = (playerData) => {
        if (playerData) {
            let currentName = playerData.name;
            let iconPrefix = "";

            // Lógica robusta para separar ícone do nome no Frontend
            const icons = ['👑', '⚜️', '🤡', '🔰', '🛡️', '❤️'];
            
            // Verifica se o nome começa com algum dos ícones conhecidos
            for (const icon of icons) {
                if (currentName.startsWith(icon)) {
                    iconPrefix = icon;
                    // Remove o ícone e espaços vazios do início
                    currentName = currentName.substring(icon.length).trim();
                    break; 
                }
            }

            // Atualiza UI do ícone travado
            if (lockedTitleIcon) {
                if (iconPrefix) {
                    lockedTitleIcon.textContent = iconPrefix;
                    lockedTitleIcon.style.display = "block";
                    // Adiciona padding visual se tiver ícone
                    lockedTitleIcon.style.marginRight = "5px";
                } else {
                    lockedTitleIcon.textContent = "";
                    lockedTitleIcon.style.display = "none";
                }
            }
            
            // Define o nome LIMPO no input (o usuário edita apenas o texto)
            if (editPlayerNameInput) editPlayerNameInput.value = currentName;
            
            if (editPlayerFactionSelect) editPlayerFactionSelect.value = playerData.faction;
            if (editPlayerGenderSelect) editPlayerGenderSelect.value = playerData.gender || "Masculino";

            originalProfileData = {
                name: playerData.name,
                faction: playerData.faction,
                avatar_url: playerData.avatar_url,
                gender: playerData.gender
            };

            renderAvatarOptions(playerData.avatar_url);
        }
    };

    if (editProfileIcon) {
        editProfileIcon.onclick = async () => {
            let userId = null;

            // 1. Tenta recuperar sessão do GlobalDB primeiro
            const globalAuth = await GlobalDB.getAuth();
            if (globalAuth && globalAuth.user) {
                userId = globalAuth.user.id;
            } else {
                // 2. Fallback para Supabase (Rede)
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (session && session.user) {
                    userId = session.user.id;
                }
            }

            if (userId) {
                // Busca dados atualizados (incluindo gender e nobless)
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
            const newAvatar = customAvatarUrlInput.value.trim() || selectedAvatarUrlInput.value;

            // Validações
            if (!rawName || rawName.length < 3) {
                 if(profileEditMessage) profileEditMessage.textContent = "O nome do jogador deve ter pelo menos 3 caracteres (sem contar o título).";
                 return;
            }
            if (!newAvatar) {
                 if(profileEditMessage) profileEditMessage.textContent = "Por favor, selecione um avatar ou forneça uma URL.";
                 return;
            }

            // Verifica se o usuário tentou colar um emoji no input de texto
            const regexEmoji = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/;
            if (regexEmoji.test(rawName)) {
                 if(profileEditMessage) profileEditMessage.textContent = "Por favor, remova os emojis do campo de texto. Seu título será adicionado automaticamente pelo sistema.";
                 return;
            }

            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = 'Salvando...';

            try {
                // Envia APENAS o texto do nome. O SQL se encarrega de recolocar o ícone.
                const { data, error } = await supabaseClient.rpc('update_player_profile', {
                    p_name: rawName,
                    p_faction: newFaction,
                    p_avatar_url: newAvatar,
                    p_gender: newGender
                });

                if (error) {
                    throw error;
                }

                showFloatingMessage('Perfil atualizado com sucesso!');
                
                // O servidor retorna o nome completo (Ícone + Texto)
                const finalName = (typeof data === 'string' && data.length > 0) ? data : rawName;

                // === ATUALIZAÇÃO DO CACHE LOCAL (GLOBAL DB) ===
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