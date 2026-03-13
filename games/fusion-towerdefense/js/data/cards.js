const CARD_SLOT_UNLOCK_COSTS = [1000, 10000, 25000];

const CARD_DEFS = {
  basic_overclock_i: {
    id: 'basic_overclock_i',
    name: 'Basic Overclock I',
    towerTypeId: 'basic',
    rarity: 'common',

    unlockScore: 0,
    buyCost: 500,

    description: 'Basic macht 30% mehr Schaden.',
    effect: {
      type: 'tower_stat_multiplier',
      stat: 'damage',
      multiplier: 1.3
    }
  },

  basic_flat_core: {
    id: 'basic_flat_core',
    name: 'Basic: Flat Core',
    towerTypeId: 'basic',
    rarity: 'common',
    unlockScore: 2000,
    buyCost: 1500,
    description: 'Basic erhält +3 Grundschaden.',
    effect: {
      type: 'tower_stat_flat',
      stat: 'damage',
      amount: 3
    }
  },
  basic_percent_core: {
    id: 'basic_percent_core',
    name: 'Basic: Overclock 20%',
    towerTypeId: 'basic',
    rarity: 'common',
    unlockScore: 4000,
    buyCost: 2500,
    description: 'Basic erhält +20% Schaden.',
    effect: {
      type: 'tower_stat_multiplier',
      stat: 'damage',
      multiplier: 1.2
    }
  },

  sniper_chain_trigger: {
    id: 'sniper_chain_trigger',
    name: 'Sniper Chain Trigger',
    towerTypeId: 'sniper',
    rarity: 'rare',
    unlockScore: 5000,
    buyCost: 4000,
    description: 'Nach einem Kill lädt der nächste Schuss 75% schneller nach.',
    effect: {
      type: 'sniper_kill_haste',
      cooldownMultiplierAfterKill: 0.25
    }
  },
  rapid_mag_booster: {
    id: 'rapid_mag_booster',
    name: 'Rapid: Ammo Matrix',
    towerTypeId: 'rapid',
    rarity: 'rare',
    unlockScore: 10000,
    buyCost: 7000,
    description: '+200% Ammo und +100% Reload Speed für Rapid.',
    effect: {
      type: 'rapid_ammo_reload_boost',
      ammoMultiplier: 3,
      reloadSpeedMultiplier: 2
    }
  },

  extra_start_money: {
    id: 'extra_start_money',
    name: 'Extra Start Money',
    towerTypeId: null,
    rarity: 'rare',
    unlockScore: 10000,
    buyCost: 10000,
    description: '+100 Startgeld zu Beginn eines Runs.',
    effect: {
      type: 'start_money_bonus',
      amount: 100
    }
  },

  laser_overtuned_lense: {
    id: 'laser_overtuned_lense',
    name: 'Overtuned Lense',
    towerTypeId: 'laser',
    rarity: 'epic',
    unlockScore: 15000,
    buyCost: 12000,
    description: 'Laser zielt auf First. Nah wenig Schaden, weit entfernt sehr viel Schaden.',
    effect: {
      type: 'laser_overtuned_lense',
      targetingMode: 'first',
      damageFalloffValues: [4, 12, 30, 75],
      damageFalloffDistances: [60, 130, 200, 250]
    }
  }
};

function getCardDefsArray() {
  return Object.values(CARD_DEFS);
}

function getCardDef(cardId) {
  return CARD_DEFS[cardId] || null;
}

function getCardRarityColor(rarity) {
  const colors = {
    common: '#8bb5ff',
    rare: '#b27dff',
    epic: '#ff7acc',
    legendary: '#ffb347'
  };

  return colors[rarity] || '#8bb5ff';
}
