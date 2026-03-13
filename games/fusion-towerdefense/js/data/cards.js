const CARD_SLOT_UNLOCK_COSTS = [1000, 10000, 25000];

const CARD_DEFS = {
  basic_overclock_i: {
    id: 'basic_overclock_i',
    name: 'Basic Overclock I',
    towerTypeId: 'basic',
    rarity: 'common',
    description: 'Basic macht 30% mehr Schaden.',
    effect: {
      type: 'tower_stat_multiplier',
      stat: 'damage',
      multiplier: 1.3
    }
  },
  sniper_chain_trigger: {
    id: 'sniper_chain_trigger',
    name: 'Sniper Chain Trigger',
    towerTypeId: 'sniper',
    rarity: 'rare',
    description: 'Nach jedem Kill schießt der nächste Sniper-Schuss mit 75% weniger Cooldown.',
    effect: {
      type: 'sniper_kill_haste',
      cooldownMultiplierAfterKill: 0.25
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
