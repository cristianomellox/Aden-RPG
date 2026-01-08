// perfil_edit.js

// =========================================================
// >>> ADEN GLOBAL DB (Para Atualização Local) <<<
// =========================================================
const GLOBAL_DB_NAME = 'aden_global_db';
const GLOBAL_DB_VERSION = 2;
const PLAYER_STORE = 'player_store';
const AUTH_STORE = 'auth_store'; // Necessário para getAuth

const GlobalDB = {
    open: function() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(GLOBAL_DB_NAME, GLOBAL_DB_VERSION);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    // Método getAuth adicionado para leitura de sessão otimizada
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
    const lockedTitleIcon = document.getElementById("lockedTitleIcon"); // NOVO: Referência ao ícone travado
    const editPlayerFactionSelect = document.getElementById("editPlayerFaction");
    const editPlayerGenderSelect = document.getElementById("editPlayerGender"); // NOVO: Referência ao select de gênero
    const avatarGrid = document.getElementById("avatarSelection");
    const selectedAvatarUrlInput = document.getElementById("selectedAvatarUrl");
    const customAvatarUrlInput = document.getElementById("editPlayerCustomAvatarUrl");
    const saveProfileBtn = document.getElementById("saveProfileBtn");
    const closeProfileModalBtn = document.getElementById("closeProfileModalBtn");
    const editProfileIcon = document.getElementById("editProfileIcon");
    const profileEditMessage = document.getElementById('profileEditMessage');

    if (editPlayerNameInput) {
        editPlayerNameInput.maxLength = 11;
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

    // --- FUNÇÃO DE UPDATE DO MODAL (ATUALIZADA) ---
    window.updateProfileEditModal = (playerData) => {
        if (playerData) {
            // 1. Lógica do Ícone Travado
            let currentName = playerData.name;
            let iconPrefix = "";

            // Se o jogador tiver nobless > 0, verificamos se há um ícone no início do nome
            if (playerData.nobless && playerData.nobless > 0) {
                // Converte para array para tratar emojis corretamente (surrogate pairs)
                const chars = Array.from(currentName);
                if (chars.length > 0) {
                    // Lista de ícones conhecidos usados no sistema de títulos
                    const knownIcons = ['❤️', '⚜️', '🤡', '🛡️'];
                    if (knownIcons.includes(chars[0])) {
                        iconPrefix = chars[0];
                        // Remove o ícone e o espaço subsequente (se houver) do nome editável
                        currentName = chars.slice(1).join('').trim();
                    }
                }
            }

            // Atualiza UI do ícone
            if (lockedTitleIcon) {
                if (iconPrefix) {
                    lockedTitleIcon.textContent = iconPrefix;
                    lockedTitleIcon.style.display = "block";
                } else {
                    lockedTitleIcon.textContent = "";
                    lockedTitleIcon.style.display = "none";
                }
            }
            
            // Define os valores nos inputs
            if (editPlayerNameInput) editPlayerNameInput.value = currentName;
            if (editPlayerFactionSelect) editPlayerFactionSelect.value = playerData.faction;
            if (editPlayerGenderSelect) editPlayerGenderSelect.value = playerData.gender || "Masculino";

            originalProfileData = {
                name: playerData.name,
                faction: playerData.faction,
                avatar_url: playerData.avatar_url,
                gender: playerData.gender // Salva gênero original para referência se necessário
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
            // Isso evita duplicação de ícones ou spoofing
            const regexEmoji = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/;
            if (regexEmoji.test(rawName)) {
                 if(profileEditMessage) profileEditMessage.textContent = "Por favor, remova os emojis do campo de texto. Seu título será adicionado automaticamente pelo sistema.";
                 return;
            }

            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = 'Salvando...';

            try {
                // A RPC 'update_player_profile' deve estar preparada para receber p_gender
                // e retornar o nome final (concatenado com ícone se necessário)
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
                
                // O retorno 'data' da RPC agora deve conter o nome final formatado pelo servidor
                // Caso a RPC antiga não retorne nada (void), usamos rawName como fallback, mas o ideal é a RPC retornar o nome completo
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