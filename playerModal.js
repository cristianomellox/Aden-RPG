document.addEventListener("DOMContentLoaded", () => {
    const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';
    const supabase = window.supabase && window.supabase.createClient
        ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
        : null;
    if (!supabase) {
        console.error("Supabase não iniciado");
        return;
    }

    // Referências DOM
    const playerModal = document.getElementById('playerModal');
    const closeBtn = document.getElementById('closePlayerModal');
    const playerNameEl = document.getElementById('playerName');
    const playerLevelEl = document.getElementById('playerLevel');
    const playerGuildFlagImg = document.getElementById('playerGuildFlag');
    const playerGuildNameEl = document.getElementById('playerGuildName');
    const playerAvatarEl = document.getElementById('playerAvatarEquip');
    const combatPowerEl = document.getElementById('playerCombatPower');

    const playerAttackEl = document.getElementById('playerAttack');
    const playerDefenseEl = document.getElementById('playerDefense');
    const playerHealthEl = document.getElementById('playerHealth');
    const playerCritChanceEl = document.getElementById('playerCritChance');
    const playerCritDamageEl = document.getElementById('playerCritDamage');
    const playerEvasionEl = document.getElementById('playerEvasion');

    // Slots de equipamentos
    const equipmentSlots = {
        weapon: document.getElementById('weapon-slot'),
        ring: document.getElementById('ring-slot'),
        helm: document.getElementById('helm-slot'),
        special1: document.getElementById('special1-slot'),
        amulet: document.getElementById('amulet-slot'),
        wing: document.getElementById('wing-slot'),
        armor: document.getElementById('armor-slot'),
        special2: document.getElementById('special2-slot')
    };

    // Tradução de slots
    const SLOT_MAP = {
        arma: 'weapon',
        anel: 'ring',
        elmo: 'helm',
        colar: 'amulet',
        asa: 'wing',
        armadura: 'armor'
    };

    const safeNum = v => Number(v) || 0;

    function clearModalContent() {
        playerNameEl.textContent = 'Carregando...';
        playerLevelEl.textContent = '';
        playerGuildFlagImg.setAttribute("src", "https://aden-rpg.pages.dev/assets/guildaflag.webp");
        playerGuildNameEl.textContent = '';
        playerAvatarEl.src = 'https://via.placeholder.com/100';
        combatPowerEl.textContent = '';

        const statsElements = [
            playerAttackEl,
            playerDefenseEl,
            playerHealthEl,
            playerCritChanceEl,
            playerCritDamageEl,
            playerEvasionEl
        ];
        statsElements.forEach(el => {
            el.textContent = '';
            el.classList.add('shimmer');
        });

        Object.values(equipmentSlots).forEach(slot => {
            if (slot) {
                slot.innerHTML = '';
                slot.classList.add('shimmer');
            }
        });
    }

    // Soma atributos do player + itens
    function calcularAtributosTotais(baseStats, items) {
        let totalStats = {
            attack: safeNum(baseStats.attack),
            min_attack: safeNum(baseStats.min_attack),
            health: safeNum(baseStats.health),
            defense: safeNum(baseStats.defense),
            crit_chance: safeNum(baseStats.crit_chance),
            crit_damage: safeNum(baseStats.crit_damage),
            evasion: safeNum(baseStats.evasion),
        };

        items.forEach(invItem => {
            if (invItem.items) {
                totalStats.min_attack += safeNum(invItem.items.min_attack);
                totalStats.attack += safeNum(invItem.items.attack);
                totalStats.defense += safeNum(invItem.items.defense);
                totalStats.health += safeNum(invItem.items.health);
                totalStats.crit_chance += safeNum(invItem.items.crit_chance);
                totalStats.crit_damage += safeNum(invItem.items.crit_damage);
                totalStats.evasion += safeNum(invItem.items.evasion);
            }

            totalStats.min_attack += safeNum(invItem.min_attack_bonus);
            totalStats.attack += safeNum(invItem.attack_bonus);
            totalStats.defense += safeNum(invItem.defense_bonus);
            totalStats.health += safeNum(invItem.health_bonus);
            totalStats.crit_chance += safeNum(invItem.crit_chance_bonus);
            totalStats.crit_damage += safeNum(invItem.crit_damage_bonus);
            totalStats.evasion += safeNum(invItem.evasion_bonus);
        });

        return totalStats;
    }

    // Busca Combat Power via RPC (igual guild.js) com fallback local
    async function fetchCombatPower(playerId, stats) {
        try {
            const { data, error } = await supabase.rpc('get_player_power', { p_player_id: playerId });
            if (error) {
                console.error("Erro RPC get_player_power:", error);
            } else if (data !== null && data !== undefined) {
                return Math.floor(Number(data));
            }
        } catch (e) {
            console.error("Erro inesperado RPC get_player_power:", e);
        }

        // fallback: cálculo local
        return Math.floor(
            (safeNum(stats.attack) * 12.5) +
            (safeNum(stats.min_attack) * 1.5) +
            (safeNum(stats.crit_chance) * 5.35) +
            (safeNum(stats.crit_damage) * 6.5) +
            (safeNum(stats.defense) * 2) +
            (safeNum(stats.health) * 3.2625) +
            (safeNum(stats.evasion) * 1)
        );
    }

    async function populateModal(player, equippedItems, guildData) {
        const stats = calcularAtributosTotais(player, equippedItems);

        playerNameEl.textContent = player.name;
        playerLevelEl.textContent = `Nv. ${player.level}`;

        playerGuildFlagImg.setAttribute("src", 
    guildData?.flag_url && guildData.flag_url.trim() !== "" 
        ? guildData.flag_url 
        : "https://aden-rpg.pages.dev/assets/guildaflag.webp"
);


        playerGuildNameEl.textContent = guildData?.name || '';

        playerAvatarEl.src = player.avatar_url || 'https://via.placeholder.com/100';

        playerAttackEl.textContent = `${Math.floor(stats.min_attack)} - ${Math.floor(stats.attack)}`;
        playerDefenseEl.textContent = `${Math.floor(stats.defense)}`;
        playerHealthEl.textContent = `${Math.floor(stats.health)}`;
        playerCritChanceEl.textContent = `${Math.floor(stats.crit_chance)}%`;
        playerCritDamageEl.textContent = `${Math.floor(stats.crit_damage)}%`;
        playerEvasionEl.textContent = `${Math.floor(stats.evasion)}%`;

        const cp = await fetchCombatPower(player.id, stats);
        combatPowerEl.textContent = `${formatNumberCompact(Number(cp) || 0)}`;

        const allShimmer = document.querySelectorAll('.shimmer');
        allShimmer.forEach(el => el.classList.remove('shimmer'));

        Object.values(equipmentSlots).forEach(slot => {
            if (slot) slot.innerHTML = '';
        });

        equippedItems.forEach(invItem => {
            const mapped = SLOT_MAP[invItem.equipped_slot] || invItem.equipped_slot;
            if (mapped && equipmentSlots[mapped]) {
                const slotDiv = equipmentSlots[mapped];
                if (!slotDiv) return;

                const totalStars = (invItem.items?.stars || 0) + (invItem.refine_level || 0);
                const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${invItem.items?.name}_${totalStars}estrelas.webp`;

                slotDiv.innerHTML = `<img src="${imgSrc}" alt="${invItem.items?.display_name || ''}">`;

                if (invItem.level && invItem.level >= 1) {
                    const levelElement = document.createElement('div');
                    levelElement.className = 'item-level';
                    levelElement.textContent = `Nv. ${invItem.level}`;
                    slotDiv.appendChild(levelElement);
                }
            }
        });
    }

    async function fetchPlayerData(playerId) {
        try {
            const { data: player, error: playerError } = await supabase
                .from('players')
                .select(`id, name, level, avatar_url, attack, min_attack, defense, health, crit_chance, crit_damage, evasion, guild_id`)
                .eq('id', playerId)
                .single();

            if (playerError || !player) {
                console.error('Erro ao buscar jogador', playerError);
                return;
            }

            const { data: items, error: itemsError } = await supabase
                .from('inventory_items')
                .select(`
                    id,
                    equipped_slot,
                    level,
                    refine_level,
                    attack, min_attack, defense, health, crit_chance, crit_damage, evasion,
                    attack_bonus, min_attack_bonus, defense_bonus, health_bonus, crit_chance_bonus, crit_damage_bonus, evasion_bonus,
                    items (name, display_name, stars, attack, min_attack, defense, health, crit_chance, crit_damage, evasion)
                `)
                .eq('player_id', playerId)
                .not('equipped_slot', 'is', null);

            if (itemsError) {
                console.error('Erro ao buscar itens equipados', itemsError);
                return;
            }

            let guildData = null;
            if (player.guild_id) {
                const { data: guild } = await supabase
                    .from('guilds')
                    .select('id, name, flag_url')
                    .eq('id', player.guild_id)
                    .single();
                guildData = guild;
            }

            clearModalContent();
            populateModal(player, items || [], guildData);
        } catch (e) {
            console.error('Erro inesperado ao carregar dados do jogador', e);
        }
    }

    // Evento para fechar o modal
    closeBtn?.addEventListener('click', () => {
        playerModal.style.display = 'none';
    });

    // Evento: clique no nome do jogador dentro da própria guilda
    const guildMemberList = document.getElementById('guildMemberList');
    if (guildMemberList) {
        guildMemberList.addEventListener('click', (e) => {
            const link = e.target.closest('.player-link');
            if (!link) return;
            const playerId = link.dataset.playerId;
            if (!playerId) return;

            playerModal.style.display = 'flex';
            clearModalContent();
            fetchPlayerData(playerId);
        });
    }

    // 🔹 NOVO: clique no nome do jogador dentro do modal de informações de guilda
    const guildViewMemberList = document.getElementById('guildViewMemberList');
    if (guildViewMemberList) {
        guildViewMemberList.addEventListener('click', (e) => {
            const link = e.target.closest('.player-link');
            if (!link) return;
            const playerId = link.dataset.playerId;
            if (!playerId) return;

            playerModal.style.display = 'flex';
            clearModalContent();
            fetchPlayerData(playerId);
        });
    }

    // --- Expor funções globalmente ---
    window.clearModalContent = clearModalContent;
    window.fetchPlayerData = fetchPlayerData;
});
