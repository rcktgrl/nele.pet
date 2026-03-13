const RITUAL_DEFS = {
  penta_ritual: {
    id: 'penta_ritual',
    centerTowerType: 'trio',
    resultTowerType: 'penta',

    unlock: {
      researchId: 'rituals',
      minBestRunScore: 500
    },

    cost: {
      gold: 0
    },

    selectionRules: {
      exactSelectionCount: 1,
      exactMatchRequired: true
    },

    consume: {
      center: true,
      selected: true
    },

    requirements: [
      {
        type: 'selected_tower_within_manhattan_distance',
        towerType: 'duo',
        maxDistance: 3
      }
    ]
  }
};

function getRitualDef(id) {
  return RITUAL_DEFS[id] || null;
}

function getRitualDefsArray() {
  return Object.values(RITUAL_DEFS);
}

function getRitualsForCenterTowerType(towerTypeId) {
  return getRitualDefsArray().filter(r => r.centerTowerType === towerTypeId);
}