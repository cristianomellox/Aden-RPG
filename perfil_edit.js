// perfil_edit.js

let originalProfileData = {};

document.addEventListener("DOMContentLoaded", () => {
    // Referências aos elementos do DOM
    const profileEditModal = document.getElementById("profileEditModal");
    const editPlayerNameInput = document.getElementById("editPlayerName");
    const editPlayerFactionSelect = document.getElementById("editPlayerFaction");
    const avatarGrid = document.getElementById("avatarSelection");
    const selectedAvatarUrlInput = document.getElementById("selectedAvatarUrl");
    const customAvatarUrlInput = document.getElementById("editPlayerCustomAvatarUrl");
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

    window.updateProfileEditModal = (playerData) => {
        if (playerData && editPlayerNameInput && editPlayerFactionSelect) {
            editPlayerNameInput.value = playerData.name;
            editPlayerFactionSelect.value = playerData.faction;
            
            originalProfileData = {
                name: playerData.name,
                faction: playerData.faction,
                avatar_url: playerData.avatar_url,
            };

            renderAvatarOptions(playerData.avatar_url);
        }
    };

    if (editProfileIcon) {
        editProfileIcon.onclick = async () => {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user) {
                const { data: playerData, error } = await supabaseClient
                    .from('players')
                    .select('name, faction, avatar_url')
                    .eq('id', user.id)
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

            const newName = editPlayerNameInput.value.trim();
            const newFaction = editPlayerFactionSelect.value;
            const newAvatar = customAvatarUrlInput.value.trim() || selectedAvatarUrlInput.value;

            if (!newName || newName.length < 3) {
                 if(profileEditMessage) profileEditMessage.textContent = "O nome do jogador deve ter pelo menos 3 caracteres.";
                 return;
            }
            if (!newAvatar) {
                 if(profileEditMessage) profileEditMessage.textContent = "Por favor, selecione um avatar ou forneça uma URL.";
                 return;
            }

            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = 'Salvando...';

            try {
                const { error } = await supabaseClient.rpc('update_player_profile', {
                    p_name: newName,
                    p_faction: newFaction,
                    p_avatar_url: newAvatar
                });

                if (error) {
                    throw error;
                }

                showFloatingMessage('Perfil atualizado com sucesso!');
                profileEditModal.style.display = 'none';
                
                if (typeof fetchAndDisplayPlayerInfo === 'function') {
                    fetchAndDisplayPlayerInfo(true); 
                }

            } catch (error) {
                console.error('Erro ao atualizar perfil:', error);
                if (profileEditMessage) {
                    profileEditMessage.textContent = error.message;
                    profileEditMessage.style.color = '#ff9999';
                }
            } finally {
                saveProfileBtn.disabled = false;
                saveProfileBtn.textContent = 'Salvar Perfil';
            }
        };
    }
});