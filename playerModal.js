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

    // Referências DOM principais
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

        [playerAttackEl, playerDefenseEl, playerHealthEl, playerCritChanceEl, playerCritDamageEl, playerEvasionEl]
            .forEach(el => { el.textContent = ''; el.classList.add('shimmer'); });

        Object.values(equipmentSlots).forEach(slot => {
            if (slot) { slot.innerHTML = ''; slot.classList.add('shimmer'); }
        });
    }

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

    async function fetchCombatPower(playerId, stats) {
        try {
            const { data, error } = await supabase.rpc('get_player_power', { p_player_id: playerId });
            if (!error && data !== null) return Math.floor(Number(data));
        } catch (e) { console.error("Erro RPC CP:", e); }
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
        playerGuildFlagImg.setAttribute("src", guildData?.flag_url || "https://aden-rpg.pages.dev/assets/guildaflag.webp");
        playerGuildNameEl.textContent = guildData?.name || '';
        playerAvatarEl.src = player.avatar_url || 'https://via.placeholder.com/100';

        playerAttackEl.textContent = `${Math.floor(stats.min_attack)} - ${Math.floor(stats.attack)}`;
        playerDefenseEl.textContent = `${Math.floor(stats.defense)}`;
        playerHealthEl.textContent = `${Math.floor(stats.health)}`;
        playerCritChanceEl.textContent = `${Math.floor(stats.crit_chance)}%`;
        playerCritDamageEl.textContent = `${Math.floor(stats.crit_damage)}%`;
        playerEvasionEl.textContent = `${Math.floor(stats.evasion)}%`;

        const localCp = Math.floor(
            (safeNum(stats.attack) * 12.5) +
            (safeNum(stats.min_attack) * 1.5) +
            (safeNum(stats.crit_chance) * 5.35) +
            (safeNum(stats.crit_damage) * 6.5) +
            (safeNum(stats.defense) * 2) +
            (safeNum(stats.health) * 3.2625) +
            (safeNum(stats.evasion) * 1)
        );
        combatPowerEl.textContent = `${formatNumberCompact(localCp)}`;
        fetchCombatPower(player.id, stats).then(cp => {
            if (cp && cp !== localCp) combatPowerEl.textContent = `${formatNumberCompact(cp)}`;
        });

        document.querySelectorAll('.shimmer').forEach(el => el.classList.remove('shimmer'));
        Object.values(equipmentSlots).forEach(slot => { if (slot) slot.innerHTML = ''; });

        equippedItems.forEach(invItem => {
            const mapped = SLOT_MAP[invItem.equipped_slot] || invItem.equipped_slot;
            if (!mapped || !equipmentSlots[mapped]) return;
            const slotDiv = equipmentSlots[mapped];
            const totalStars = (invItem.items?.stars || 0) + (invItem.refine_level || 0);
            const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${invItem.items?.name}_${totalStars}estrelas.webp`;
            slotDiv.innerHTML = `<img src="${imgSrc}" alt="${invItem.items?.display_name || ''}">`;

            if (invItem.level && invItem.level >= 1) {
                const levelElement = document.createElement('div');
                levelElement.className = 'item-level';
                levelElement.textContent = `Nv. ${invItem.level}`;
                slotDiv.appendChild(levelElement);
            }

            // 🔹 Abrir modal de detalhes do item ao clicar
            slotDiv.addEventListener('click', () => {
                openPlayerItemModal(invItem);
            });
        });
    }

    async function fetchPlayerData(playerId) {
        try {
            const { data: player } = await supabase
                .from('players')
                .select('id, name, level, avatar_url, attack, min_attack, defense, health, crit_chance, crit_damage, evasion, guild_id')
                .eq('id', playerId).single();

            if (!player) return;

            const { data: items } = await supabase
                .from('inventory_items')
                .select(`id, equipped_slot, level, refine_level,
                         attack, min_attack, defense, health, crit_chance, crit_damage, evasion,
                         attack_bonus, min_attack_bonus, defense_bonus, health_bonus, crit_chance_bonus, crit_damage_bonus, evasion_bonus,
                         items (name, display_name, stars, rarity, attack, min_attack, defense, health, crit_chance, crit_damage, evasion)`)
                .eq('player_id', playerId)
                .not('equipped_slot', 'is', null);

            let guildData = null;
            if (player.guild_id) {
                const { data: guild } = await supabase.from('guilds').select('id, name, flag_url').eq('id', player.guild_id).single();
                guildData = guild;
            }

            clearModalContent();
            populateModal(player, items || [], guildData);
        } catch (e) {
            console.error('Erro ao carregar jogador:', e);
        }
    }

    // 🔹 Modal de detalhes do item
    function openPlayerItemModal(invItem) {
        const modal = document.getElementById('playerItemDetailsModal');
        if (!modal) return;

        const img = document.getElementById('playerDetailItemImage');
        const name = document.getElementById('playerDetailItemName');
        const rarity = document.getElementById('playerDetailItemRarity');
        const stars = document.getElementById('playerItemStars');
        const statsDiv = document.getElementById('playerItemStats');
        const refineRows = document.getElementById('playerItemRefineRows');

        modal.style.display = 'flex';
        img.src = `https://aden-rpg.pages.dev/assets/itens/${invItem.items?.name}_${(invItem.items?.stars || 0) + (invItem.refine_level || 0)}estrelas.webp`;
        name.textContent = invItem.items?.display_name || 'Item';
        
        stars.textContent = "★".repeat(invItem.items?.stars || 0);

        statsDiv.innerHTML = `
          <p>ATK Base: ${invItem.items?.min_attack || 0} - ${invItem.items?.attack || 0}</p>
          <p>Bônus ATK: +${invItem.attack_bonus || 0}</p>
          <p>Bônus DEF: +${invItem.defense_bonus || 0}</p>
          <p>Bônus HP: +${invItem.health_bonus || 0}</p>
          <p>Bônus CRIT: +${invItem.crit_chance_bonus || 0}%</p>
          <p>Dano CRIT: +${invItem.crit_damage_bonus || 0}%</p>
        `;
        refineRows.innerHTML = '';
if (invItem.reforges && Array.isArray(invItem.reforges)) {
    invItem.reforges.forEach(r => {
        refineRows.innerHTML += `<div class="refine-row">+${r.value} ${r.stat}</div>`;
    });
} else if (invItem.reforge1) {
    refineRows.innerHTML += `<div class="refine-row">${invItem.reforge1}</div>`;
}
if (invItem.reforge2) {
    refineRows.innerHTML += `<div class="refine-row">${invItem.reforge2}</div>`;
}
if (invItem.refine_level) {
    refineRows.innerHTML += `<div class="refine-row">+${invItem.refine_level} Refundição Geral</div>`;
}


        document.getElementById('closePlayerItemModal').onclick = () => { modal.style.display = 'none'; };
    }

    // Eventos para abrir modal principal
    closeBtn?.addEventListener('click', () => { playerModal.style.display = 'none'; });
    ['guildMemberList','guildViewMemberList','guildRequestsList'].forEach(listId => {
        const el = document.getElementById(listId);
        if (el) {
            el.addEventListener('click', (e) => {
                const link = e.target.closest('.player-link');
                if (!link) return;
                const playerId = link.dataset.playerId;
                if (!playerId) return;
                playerModal.style.display = 'flex';
                clearModalContent();
                fetchPlayerData(playerId);
            });
        }
    });

    window.clearModalContent = clearModalContent;
    window.fetchPlayerData = fetchPlayerData;
});

// Compactar números grandes
function formatNumberCompact(num) {
    if (num < 1000) return num;
    const units = ['', 'K', 'M', 'B', 'T'];
    const unitIndex = Math.floor(Math.log10(num) / 3);
    const compactValue = (num / Math.pow(1000, unitIndex)).toFixed(1);
    return compactValue + units[unitIndex];
}
