// playerModal.js
document.addEventListener("DOMContentLoaded", () => {
    const SUPABASE_URL = window.SUPABASE_URL || 'https://lqzlblvmkuwedcofmgfb.supabase.co';
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_le96thktqRYsYPeK4laasQ_xDmMAgPx';

    // Inicializa o client do Supabase de forma robusta (compatível com versões antigas e novas)
    let supabase = null;
    try {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            // cria client e expõe em window.supabaseClient para outros scripts (ex: guild_pv.js)
            window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            supabase = window.supabaseClient;
            console.log("[playerModal.js] Supabase client inicializado com sucesso.");
        } else {
            console.error("[playerModal.js] SDK Supabase não detectado no window.supabase.");
        }
    } catch (e) {
        console.error("[playerModal.js] Erro ao inicializar Supabase:", e);
    }

    if (!supabase) {
        // Se não conseguir inicializar, aborta (os outros scripts dependem do supabase)
        console.error("Supabase não iniciado — player modal ficará limitado.");
        // Mas continuamos declarando variáveis DOM para evitar erros em tempo de execução
    }

    // --- INÍCIO: FUNÇÕES DE CACHE ---
    /**
     * Armazena dados no localStorage com um tempo de expiração.
     * @param {string} key - A chave para o cache.
     * @param {any} data - Os dados a serem armazenados.
     * @param {number} ttl - Time-to-live em milissegundos.
     */
    function setCache(key, data, ttl) {
        const now = new Date();
        const item = {
            data: data,
            expiry: now.getTime() + ttl,
        };
        try {
            localStorage.setItem(key, JSON.stringify(item));
        } catch (e) {
            console.warn("[playerModal.js] Erro ao salvar no cache (localStorage cheio?):", e);
        }
    }

    /**
     * Recupera dados do localStorage se não estiverem expirados.
     * @param {string} key - A chave do cache.
     * @returns {any|null} - Os dados ou nulo se não existir ou estiver expirado.
     */
    function getCache(key) {
        const itemStr = localStorage.getItem(key);
        if (!itemStr) {
            return null;
        }
        try {
            const item = JSON.parse(itemStr);
            const now = new Date();
            if (now.getTime() > item.expiry) {
                localStorage.removeItem(key);
                return null;
            }
            return item.data;
        } catch (e) {
            console.error("[playerModal.js] Erro ao ler cache:", e);
            localStorage.removeItem(key); // Remove cache corrompido
            return null;
        }
    }
    // --- FIM: FUNÇÕES DE CACHE ---

    // Tempo de vida do cache (24 horas) - usado como fallback
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 86400000

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

    // NOVO: Referência ao botão de Enviar MP
    const sendMpButton = document.getElementById('sendmp');

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

    // fallback para formatNumberCompact se não existir em outro script
    const formatNumberCompact = window.formatNumberCompact || ((n) => {
        try {
            if (n === 0) return "0";
            if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
            if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
            if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
            return String(n);
        } catch (e) {
            return String(n);
        }
    });

    function clearModalContent() {
        if (playerNameEl) playerNameEl.textContent = 'Carregando...';
        if (playerLevelEl) playerLevelEl.textContent = '';
        if (playerGuildFlagImg) playerGuildFlagImg.setAttribute("src", "https://aden-rpg.pages.dev/assets/guildaflag.webp");
        if (playerGuildNameEl) playerGuildNameEl.textContent = '';
        if (playerAvatarEl) playerAvatarEl.src = 'https://via.placeholder.com/100';
        if (combatPowerEl) combatPowerEl.textContent = '';

        const statsElements = [
            playerAttackEl,
            playerDefenseEl,
            playerHealthEl,
            playerCritChanceEl,
            playerCritDamageEl,
            playerEvasionEl
        ];
        statsElements.forEach(el => {
            if (!el) return;
            el.textContent = '';
            el.classList.add('shimmer');
        });

        Object.values(equipmentSlots).forEach(slot => {
            if (slot) {
                slot.innerHTML = '';
                slot.classList.add('shimmer');
            }
        });

        // Esconde o botão de enviar MP até os dados serem carregados
        if (sendMpButton) {
            sendMpButton.style.display = 'none';
            sendMpButton.removeAttribute('data-player-id');
            sendMpButton.removeAttribute('data-player-name');
        }
    }

    // Soma atributos do player + itens
    function calcularAtributosTotais(baseStats = {}, items = []) {
        let totalStats = {
            attack: safeNum(baseStats.attack),
            min_attack: safeNum(baseStats.min_attack),
            health: safeNum(baseStats.health),
            defense: safeNum(baseStats.defense),
            crit_chance: safeNum(baseStats.crit_chance),
            crit_damage: safeNum(baseStats.crit_damage),
            evasion: safeNum(baseStats.evasion),
        };

        (items || []).forEach(invItem => {
            // stats embutidos no objeto items (tabela items)
            if (invItem.items) {
                totalStats.min_attack += safeNum(invItem.items.min_attack);
                totalStats.attack += safeNum(invItem.items.attack);
                totalStats.defense += safeNum(invItem.items.defense);
                totalStats.health += safeNum(invItem.items.health);
                totalStats.crit_chance += safeNum(invItem.items.crit_chance);
                totalStats.crit_damage += safeNum(invItem.items.crit_damage);
                totalStats.evasion += safeNum(invItem.items.evasion);
            }

            // bônus diretos do inventory_items
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

    // Busca Combat Power via RPC (prefere RPC, faz fallback local)
    async function fetchCombatPower(playerId, stats) {
        try {
            if (supabase && typeof supabase.rpc === 'function') {
                const { data, error } = await supabase.rpc('get_player_power', { p_player_id: playerId });
                if (error) {
                    // Log e continua para fallback
                    console.error("Erro RPC get_player_power:", error);
                } else if (data !== null && data !== undefined) {
                    return Math.floor(Number(data));
                }
            }
        } catch (e) {
            console.error("Erro inesperado RPC get_player_power:", e);
        }

        // fallback: cálculo local (mesma fórmula da versão antiga)
        try {
            const cpLocal = Math.floor(
                (safeNum(stats.attack) * 12.5) +
                (safeNum(stats.min_attack) * 1.5) +
                (safeNum(stats.crit_chance) * 5.35) +
                (safeNum(stats.crit_damage) * 6.5) +
                (safeNum(stats.defense) * 2) +
                (safeNum(stats.health) * 3.2625) +
                (safeNum(stats.evasion) * 1)
            );
            return cpLocal;
        } catch (e) {
            console.error("Erro no cálculo local de CP:", e);
            return 0;
        }
    }

    async function populateModal(player, equippedItems = [], guildData = null) {
        try {
            if (!player) return;

            // calcula atributos somando itens
            const stats = calcularAtributosTotais(player, equippedItems);

            // Preenche UI
            if (playerNameEl) playerNameEl.textContent = player.name || 'Jogador';
            if (playerLevelEl) playerLevelEl.textContent = `Nv. ${player.level || 1}`;

            if (playerGuildFlagImg) {
                playerGuildFlagImg.setAttribute("src",
                    guildData?.flag_url && guildData.flag_url.trim() !== ""
                        ? guildData.flag_url
                        : "https://aden-rpg.pages.dev/assets/guildaflag.webp"
                );
            }

            if (playerGuildNameEl) playerGuildNameEl.textContent = guildData?.name || '';

            if (playerAvatarEl) playerAvatarEl.src = player.avatar_url || 'https://via.placeholder.com/100';

            if (playerAttackEl) playerAttackEl.textContent = `${Math.floor(stats.min_attack)} - ${Math.floor(stats.attack)}`;
            if (playerDefenseEl) playerDefenseEl.textContent = `${Math.floor(stats.defense)}`;
            if (playerHealthEl) playerHealthEl.textContent = `${Math.floor(stats.health)}`;
            if (playerCritChanceEl) playerCritChanceEl.textContent = `${Math.floor(stats.crit_chance)}%`;
            if (playerCritDamageEl) playerCritDamageEl.textContent = `${Math.floor(stats.crit_damage)}%`;
            if (playerEvasionEl) playerEvasionEl.textContent = `${Math.floor(stats.evasion)}%`;

            // CP (RPC ou fallback)
            const cp = await fetchCombatPower(player.id, stats);
            if (combatPowerEl) combatPowerEl.textContent = `${formatNumberCompact(Number(cp) || 0)}`;

            // Remove shimmer
            const allShimmer = document.querySelectorAll('.shimmer');
            allShimmer.forEach(el => el.classList.remove('shimmer'));

            // Limpa slots e monta equipamentos
            Object.values(equipmentSlots).forEach(slot => {
                if (slot) slot.innerHTML = '';
            });

            (equippedItems || []).forEach(invItem => {
                const mapped = SLOT_MAP[invItem.equipped_slot] || invItem.equipped_slot;
                if (mapped && equipmentSlots[mapped]) {
                    const slotDiv = equipmentSlots[mapped];
                    if (!slotDiv) return;

                    const totalStars = (invItem.items?.stars || 0) + (invItem.refine_level || 0);
                    const safeName = invItem.items?.name || 'unknown';
                    const imgSrc = `https://aden-rpg.pages.dev/assets/itens/${safeName}_${totalStars}estrelas.webp`;

                    slotDiv.innerHTML = `<img src="${imgSrc}" alt="${invItem.items?.display_name || ''}">`;

                    if (invItem.level && invItem.level >= 1) {
                        const levelElement = document.createElement('div');
                        levelElement.className = 'item-level';
                        levelElement.textContent = `Nv. ${invItem.level}`;
                        slotDiv.appendChild(levelElement);
                    }
                }
            });

        } catch (e) {
            console.error('Erro ao popular modal:', e);
        }
    }

    // ----------------------------------------
    // fetchPlayerData: busca dados do jogador e atualiza modal
    // (Modificado para incluir cache persistente baseado em CP)
    // ----------------------------------------
    async function fetchPlayerData(playerId) {
        try {
            if (!supabase) {
                console.error("Supabase não inicializado — não é possível buscar dados do jogador.");
                return;
            }

            // --- Obtém o ID do jogador logado (quem está usando o app) ---
            let currentUserId = null;
            try {
                const { data: userData } = await supabase.auth.getUser();
                currentUserId = userData?.user?.id || null;
            } catch (e) {
                console.warn("[playerModal.js] Não foi possível obter usuário atual via supabase.auth.getUser():", e);
            }

            clearModalContent(); // Limpa e esconde o botão de MP antes da busca

            const cacheKey = `player_modal_data_${playerId}`;
            const cachedData = getCache(cacheKey);

            // --- Validação de Cache (Egress-light) ---
            // 1. Verifica se o cache existe (getCache já verifica o TTL)
            if (cachedData) {
                let validationFailed = false;
                let newCp = 0;
                let newProfileUpdate = null;
                let newGuildId = null;

                try {
                    // 2. Faz as duas checagens leves em paralelo
                    const [cpResult, profileResult] = await Promise.all([
                        supabase.rpc('get_player_power', { p_player_id: playerId }),
                        supabase.from('players').select('last_profile_update, guild_id').eq('id', playerId).single()
                    ]);

                    if (cpResult.error || profileResult.error) {
                        throw new Error(cpResult.error?.message || profileResult.error?.message);
                    }
                    
                    newCp = cpResult.data;
                    newProfileUpdate = profileResult.data.last_profile_update;
                    newGuildId = profileResult.data.guild_id;

                } catch (e) {
                    console.warn("[playerModal.js] Falha na verificação de staleness do cache. Forçando refresh.", e);
                    validationFailed = true;
                }

                // 3. Compara os dados leves
                if (!validationFailed &&
                    Number(newCp) === Number(cachedData.combatPower) &&
                    newProfileUpdate === cachedData.player.last_profile_update &&
                    newGuildId === cachedData.player.guild_id
                ) {
                    console.log(`[playerModal.js] Usando dados do cache (validados) para ${playerId}`);
                    
                    // Lógica do botão de MP (do cache)
                    if (sendMpButton) {
                        sendMpButton.setAttribute('data-player-id', cachedData.player.id);
                        sendMpButton.setAttribute('data-player-name', cachedData.player.name);
                        sendMpButton.style.display = (currentUserId && cachedData.player.id === currentUserId) ? 'none' : 'flex';
                    }
                    
                    await populateModal(cachedData.player, cachedData.items || [], cachedData.guildData);
                    return; // Cache hit, termina a função
                } else {
                     console.log(`[playerModal.js] Cache stale para ${playerId}. Buscando dados frescos.`);
                }
            }
            // --- Fim da Validação de Cache ---


            // --- Cache Miss, Expirado ou Stale: Busca Completa ---
            console.log(`[playerModal.js] Buscando dados frescos (sem cache ou stale) para ${playerId}`);

            const { data: player, error: playerError } = await supabase
                .from('players')
                .select(`id, name, level, avatar_url, attack, min_attack, defense, health, crit_chance, crit_damage, evasion, guild_id, last_profile_update`) // last_profile_update é necessário para o cache
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
                // continuamos sem itens
            }

            let guildData = null;
            if (player.guild_id) {
                try {
                    const { data: guild } = await supabase
                        .from('guilds')
                        .select('id, name, flag_url')
                        .eq('id', player.guild_id)
                        .single();
                    guildData = guild;
                } catch (e) {
                    console.warn("Erro ao buscar guilda:", e);
                }
            }

            // -----------------------------------------------------
            // --- Lógica do Botão de Mensagem Privada (PV) ---
            // -----------------------------------------------------
            if (sendMpButton) {
                sendMpButton.setAttribute('data-player-id', player.id);
                sendMpButton.setAttribute('data-player-name', player.name);
                sendMpButton.style.display = (currentUserId && player.id === currentUserId) ? 'none' : 'flex';
            }
            // -----------------------------------------------------

            // Popula o modal com os dados frescos
            await populateModal(player, items || [], guildData);

            // --- Salva os novos dados no cache ---
            try {
                // Precisamos do CP para salvar no cache. Re-calculamos ele.
                const totalStats = calcularAtributosTotais(player, items || []);
                const cp = await fetchCombatPower(player.id, totalStats);
                
                // Salva o conjunto completo de dados + o CP calculado
                setCache(cacheKey, { player, items: items || [], guildData, combatPower: cp }, CACHE_TTL_MS);
                console.log(`[playerModal.js] Novos dados e CP (${cp}) salvos no cache para ${playerId}`);
            } catch (e) {
                console.error("[playerModal.js] Erro ao salvar dados no cache:", e);
            }

        } catch (e) {
            console.error('Erro inesperado ao carregar dados do jogador', e);
        }
    }

    // Evento para fechar o modal
    closeBtn?.addEventListener('click', () => {
        if (playerModal) playerModal.style.display = 'none';
    });

    // Evento: clique no nome do jogador dentro da própria guilda
    const guildMemberList = document.getElementById('guildMemberList');
    if (guildMemberList) {
        guildMemberList.addEventListener('click', (e) => {
            const link = e.target.closest('.player-link');
            if (!link) return;
            const playerId = link.dataset.playerId;
            if (!playerId) return;

            if (playerModal) playerModal.style.display = 'flex';
            fetchPlayerData(playerId);
        });
    }

    // clique no nome do jogador dentro do modal de informações de guilda (view)
    const guildViewMemberList = document.getElementById('guildViewMemberList');
    if (guildViewMemberList) {
        guildViewMemberList.addEventListener('click', (e) => {
            const link = e.target.closest('.player-link');
            if (!link) return;
            const playerId = link.dataset.playerId;
            if (!playerId) return;

            if (playerModal) playerModal.style.display = 'flex';
            fetchPlayerData(playerId);
        });
    }

    // clique na lista de solicitações (aba de edição)
    const guildRequestsList = document.getElementById('guildRequestsList');
    if (guildRequestsList) {
        guildRequestsList.addEventListener('click', (e) => {
            const link = e.target.closest('.player-link');
            if (!link) return;
            const playerId = link.dataset.playerId;
            if (!playerId) return;
            if (playerModal) playerModal.style.display = 'flex';
            fetchPlayerData(playerId);
        });
    }

    // --- Expor funções globalmente (para uso externo / debugging) ---
    window.clearModalContent = clearModalContent;
    window.fetchPlayerData = fetchPlayerData;

    // Log para confirmar carregamento do script
    console.log("[playerModal.js] carregado.");
});