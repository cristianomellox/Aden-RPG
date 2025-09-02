// perfil_edit.js

let originalProfileData = {};

document.addEventListener("DOMContentLoaded", () => {
    const profileEditModal = document.getElementById("profileEditModal");
    const editPlayerNameInput = document.getElementById("editPlayerName");
    if (editPlayerNameInput) {
        editPlayerNameInput.maxLength = 13;
    }

    const editPlayerFactionSelect = document.getElementById("editPlayerFaction");
    const editPlayerAvatarInput = document.getElementById("selectedAvatarUrl");
    const avatarGrid = document.getElementById("avatarSelection");
    const saveProfileBtn = document.getElementById("saveProfileBtn");
    const closeProfileModalBtn = document.getElementById("closeProfileModalBtn");
    const editProfileIcon = document.getElementById("editProfileIcon");

    const messageModal = document.getElementById('messageModal');
    const messageContent = document.getElementById('messageContent');
    const closeMessageModalBtn = document.getElementById('closeMessageModalBtn');

    if (closeMessageModalBtn && messageModal) {
        closeMessageModalBtn.addEventListener('click', () => {
            messageModal.style.display = 'none';
        });
    }

    function showModal(message) {
        if (messageModal && messageContent) {
            messageContent.textContent = message;
            messageModal.style.display = 'flex';
        }
    }

    const avatarUrls = [
        'https://aden-rpg.pages.dev/assets/avatar01.webp',
        'https://aden-rpg.pages.dev/assets/avatar02.webp',
        'https://aden-rpg.pages.dev/assets/avatar03.webp',
        'https://aden-rpg.pages.dev/assets/avatar04.webp',
        'https://aden-rpg.pages.dev/assets/avatar05.webp',
        'https://aden-rpg.pages.dev/assets/avatar06.webp',
        'https://aden-rpg.pages.dev/assets/avatar07.webp',
        'https://aden-rpg.pages.dev/assets/avatar08.webp',
        'https://aden-rpg.pages.dev/assets/avatar09.webp',
        'https://aden-rpg.pages.dev/assets/avatar10.webp',
        'https://aden-rpg.pages.dev/assets/avatar11.webp',
        'https://aden-rpg.pages.dev/assets/avatar12.webp',
        'https://aden-rpg.pages.dev/assets/avatar13.webp',
        'https://aden-rpg.pages.dev/assets/avatar14.webp'
    ];

    function renderAvatarOptions(selectedUrl = '') {
        if (!avatarGrid || !editPlayerAvatarInput) return;

        avatarGrid.innerHTML = '';
        avatarUrls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.classList.add('avatar-option');
            img.title = "Clique para selecionar";
            if (selectedUrl === url) img.classList.add('selected');
            img.onclick = () => {
                document.querySelectorAll('.avatar-option').forEach(i => i.classList.remove('selected'));
                img.classList.add('selected');
                editPlayerAvatarInput.value = url;
            };
            avatarGrid.appendChild(img);
        });

        editPlayerAvatarInput.value = selectedUrl || avatarUrls[0];
    }

    window.updateProfileEditNameAndFaction = (playerData) => {
        const editPlayerNameInput = document.getElementById("editPlayerName");
        const editPlayerFactionSelect = document.getElementById("editPlayerFaction");
        const editPlayerAvatarInput = document.getElementById("selectedAvatarUrl");

        if (playerData && editPlayerNameInput && editPlayerFactionSelect && editPlayerAvatarInput) {
            editPlayerNameInput.value = playerData.name;
            editPlayerFactionSelect.value = playerData.faction;
            editPlayerAvatarInput.value = playerData.avatar_url;
            renderAvatarOptions(playerData.avatar_url);
        }
    };

    if (editProfileIcon) {
        editProfileIcon.onclick = () => {
            profileEditModal.style.display = 'flex';
            
            const playerNameText = document.getElementById('playerNameText').textContent.trim();
            const playerAvatarUrl = document.getElementById('playerAvatar').src;
            const playerFactionText = document.querySelector('#playerInfoDiv p:nth-child(2)').textContent.split(': ')[1].trim();

            const playerData = {
                name: playerNameText,
                avatar_url: playerAvatarUrl,
                faction: playerFactionText
            };
            
            window.updateProfileEditNameAndFaction(playerData);

            originalProfileData = {
                name: editPlayerNameInput.value,
                avatar: editPlayerAvatarInput.value,
                faction: editPlayerFactionSelect.value
            };
        };
    }

    if (closeProfileModalBtn) {
        closeProfileModalBtn.onclick = () => {
            profileEditModal.style.display = 'none';
        };
    }

    if (saveProfileBtn) {
        saveProfileBtn.onclick = async () => {
            const newName = editPlayerNameInput.value;
            const newAvatar = editPlayerAvatarInput.value;
            const newFaction = editPlayerFactionSelect.value;
            if (hasProfileChanged(newName, newAvatar, newFaction)) {
                const playerId = localStorage.getItem('player_id');
                const { error } = await supabase.from('players')
                    .update({ name: newName, avatar_url: newAvatar, faction: newFaction })
                    .eq('id', playerId);

                if (error) {
                    console.error('Erro ao atualizar perfil:', error);
                    showModal('Ocorreu um erro ao salvar as alterações.');
                } else {
                    showModal('Perfil atualizado com sucesso!');
                    profileEditModal.style.display = 'none';
                    getPlayerData(playerId);
                }
            } else {
                showModal('Nenhuma alteração para salvar.');
                profileEditModal.style.display = 'none';
            }
        };
    }

    function hasProfileChanged(newName, newAvatar, newFaction) {
        return newName !== originalProfileData.name ||
            newAvatar !== originalProfileData.avatar ||
            newFaction !== originalProfileData.faction;
    }
});