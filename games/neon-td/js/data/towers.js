const RAW_TOWER_DEFS = {
  basic: {
    id: 'basic',
    name: 'Basic',
    classes: ['physical'],
    tags: ['base', 'buyable'],
    unlock: {
      researchNodeId: null
    },
    acquire: {
      type: 'buy',
      buyable: true,
      buyCost: 60,
      fusionRecipes: [],
      ritualRecipes: []
    },
    stats: {
      cost: 60,
      range: 120,
      damage: 14,
      fireRate: 0.8,
      projectileSpeed: 520
    },
    visuals: {
      color: '#59f3ff'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'projectile',
      projectileTypeId: 'basic_bullet'
    },
    description: {
      text: 'Solider Allrounder mit Lead-Aim.'
    }
  },

  sniper: {
    id: 'sniper',
    name: 'Sniper',
    classes: ['physical', 'precise'],
    tags: ['base', 'buyable'],
    unlock: {
      researchNodeId: null
    },
    acquire: {
      type: 'buy',
      buyable: true,
      buyCost: 120,
      fusionRecipes: [],
      ritualRecipes: []
    },
    stats: {
      cost: 120,
      range: 240,
      damage: 38,
      fireRate: 1.7,
      projectileSpeed: 980
    },
    visuals: {
      color: '#ff5edc'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'projectile',
      projectileTypeId: 'basic_bullet',
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 5,
            life: 2.4
          }
        }
      }
    },
    description: {
      text: 'Große Reichweite mit prädiktivem Feuer.'
    }
  },

  rapid: {
    id: 'rapid',
    name: 'Rapid',
    classes: ['physical'],
    tags: ['base', 'buyable'],
    unlock: {
      researchNodeId: null
    },
    acquire: {
      type: 'buy',
      buyable: true,
      buyCost: 80,
      fusionRecipes: [],
      ritualRecipes: []
    },
    stats: {
      cost: 80,
      range: 95,
      damage: 8,
      fireRate: 0.07,
      projectileSpeed: 400
    },
    visuals: {
      color: '#a5ff68'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'projectile',
      projectileTypeId: 'basic_bullet',
      magSize: 20,
      reloadTime: 4.0
    },
    description: {
      text: 'Sehr schnell, lädt nach 20 Schüssen nach.'
    }
  },

  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    classes: ['physical'],
    tags: ['base', 'buyable'],
    unlock: {
      researchNodeId: null
    },
    acquire: {
      type: 'buy',
      buyable: true,
      buyCost: 95,
      fusionRecipes: [],
      ritualRecipes: []
    },
    stats: {
      cost: 95,
      range: 88,
      damage: 4,
      fireRate: 0.95,
      projectileSpeed: 420
    },
    visuals: {
      color: '#ffb86b'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'shotgun',
      projectileTypeId: 'basic_bullet',
      pelletCount: 10,
      spread: 0.72,
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 3,
            life: 0.24
          }
        }
      }
    },
    description: {
      text: '10 Schüsse im Kegel auf kurze Distanz.'
    }
  },

  tesla: {
    id: 'tesla',
    name: 'Tesla',
    classes: ['electrical'],
    tags: ['buyable', 'research-unlock'],
    unlock: {
      researchNodeId: 'tesla'
    },
    acquire: {
      type: 'buy',
      buyable: true,
      buyCost: 180,
      fusionRecipes: [],
      ritualRecipes: []
    },
    stats: {
      cost: 180,
      range: 175,
      damage: 34,
      fireRate: 1.45,
      projectileSpeed: 0
    },
    visuals: {
      color: '#9d8cff'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'tesla_chain',
      projectileTypeId: 'tesla_arc',
      projectileOverrides: {
        pipeline: {
          chainCount: 3,
          chainDelay: 0.06,
          chainRange: 120,
          lingerTime: 0.12,
          arcWidth: 3,
          retargetMode: 'closest_unvisited',
          allowRepeatTargets: false
        }
      }
    },
    description: {
      text: 'Gebuffter Hitscan mit Kettenblitzen.'
    }
  },
  flamethrower: {
    id: 'flamethrower',
    name: 'Flamethrower',
    classes: ['heat'],
    tags: ['base', 'buyable'],
    unlock: {
      researchNodeId: 'flamethrower'
    },
    acquire: {
      type: 'buy',
      buyable: true,
      buyCost: 200,
      fusionRecipes: [],
      ritualRecipes: []
    },
    stats: {
      cost: 200,
      range: 120,
      damage: 12,
      fireRate: 0.12,
      projectileSpeed: 460
    },
    visuals: {
      color: '#ff9a4d'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'flamethrower_pierce',
      projectileTypeId: 'flame_piercer',
      spreadRandom: Math.PI / 18,
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 10,
            life: 0.55
          },
          pierce: {
            count: 5
          }
        }
      }
    },
    description: {
      text: 'Große, leicht ungenaue Piercing-Schüsse. Jeder Gegner kann pro Schuss nur einmal getroffen werden.'
    }
  },
  bombus: {
    id: 'bombus',
    name: 'Bombus',
    classes: ['explosive'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'bombus'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['flamethrower', 'flamethrower']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 142,
      damage: 72,
      fireRate: 1.15,
      projectileSpeed: 430
    },
    visuals: {
      color: '#ff8f5a'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'explosive_projectile',
      projectileTypeId: 'explosive_orb',
      projectileOverrides: {
        special: {
          explosion: {
            radius: 52,
            damageMultiplier: 1
          }
        }
      }
    },
    description: {
      text: 'Explosive Schüsse mit hohem Schaden und mittlerer Feuerrate.'
    }
  },

  duo: {
    id: 'duo',
    name: 'Duo',
    classes: ['physical'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'duo'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['basic', 'basic']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 142,
      damage: 14,
      fireRate: 0.8,
      projectileSpeed: 520
    },
    visuals: {
      color: '#59f3ff'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'duo_burst',
      projectileTypeId: 'basic_bullet',
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 4,
            life: 2
          }
        }
      }
    },
    description: {
      text: 'Feuert zwei parallele Schüsse.'
    }
  },

  trio: {
    id: 'trio',
    name: 'Trio',
    classes: ['physical'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'trio'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['basic', 'shotgun']],
      ritualRecipes: ['penta_ritual']
    },
    stats: {
      cost: null,
      range: 128,
      damage: 14,
      fireRate: 0.8,
      projectileSpeed: 520
    },
    visuals: {
      color: '#7df0d0'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'trio_burst',
      projectileTypeId: 'basic_bullet',
      forwardAngles: [-0.24, 0, 0.24],
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 4,
            life: 2
          }
        }
      }
    },
    description: {
      text: '3 Schüsse: einer mittig, zwei leicht angewinkelt.'
    }
  },

  basesniper: {
    id: 'basesniper',
    name: 'Basesniper',
    classes: ['physical', 'precise'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'basesniper'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['basic', 'sniper']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 240,
      damage: 28,
      fireRate: 0.8,
      projectileSpeed: 980
    },
    visuals: {
      color: '#ff5edc'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'projectile',
      projectileTypeId: 'basic_bullet',
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 5,
            life: 2.4
          }
        }
      }
    },
    description: {
      text: '28 Schaden, Sniper-Reichweite mit Basic-Feuerrate.'
    }
  },

  snipegun: {
    id: 'snipegun',
    name: 'Snipegun',
    classes: ['physical', 'precise'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'snipegun'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['shotgun', 'sniper']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: Math.floor(88 * 1.5),
      damage: 7,
      fireRate: 0.95,
      projectileSpeed: 980
    },
    visuals: {
      color: '#ffe66b'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'shotgun',
      projectileTypeId: 'basic_bullet',
      pelletCount: 10,
      spread: 0.72 * 0.4,
      projectileLifeMultiplier: 1.5,
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 3,
            life: 0.36
          }
        }
      }
    },
    description: {
      text: '10 Projektile, kleinere Cone, +50% Range, +50% Lifetime, Lead-Aim.'
    }
  },

  spraysic: {
    id: 'spraysic',
    name: 'Spraysic',
    classes: ['physical'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'spraysic'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['basic', 'rapid']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 110,
      damage: 7,
      fireRate: 0.09,
      projectileSpeed: 400
    },
    visuals: {
      color: '#8fffa8'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'projectile',
      projectileTypeId: 'basic_bullet',
      spreadRandom: Math.PI / 6
    },
    description: {
      text: 'Wie Rapid ohne Nachladen, aber mit starkem 30° Front-Spread.'
    }
  },

  ring: {
    id: 'ring',
    name: 'Ring',
    classes: ['physical'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'ring'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['rapid', 'shotgun']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 95,
      damage: 8,
      fireRate: 1.5,
      projectileSpeed: 520
    },
    visuals: {
      color: '#ffd46b'
    },
    targeting: {
      fireCondition: 'enemy_in_range',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'omni_burst',
      projectileTypeId: 'basic_bullet',
      barrelCount: 24,
      baseAngle: 0,
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 3,
            life: 0.28
          }
        }
      }
    },
    description: {
      text: '24 Kanonen in alle Richtungen. Feuert periodisch rundum, wenn Gegner in der Nähe sind.'
    }
  },

  stormfork: {
    id: 'stormfork',
    name: 'Stormfork',
    classes: ['electrical'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'stormfork'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['duo', 'tesla']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 190,
      damage: 29,
      fireRate: 1.0,
      projectileSpeed: 0
    },
    visuals: {
      color: '#b39cff'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'random',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'stormfork_multi',
      multiHitCount: 5,
      noChain: true
    },
    description: {
      text: 'Nur auf Duo. 5 Ziele gleichzeitig, kein Chaining.'
    }
  },

  longsniper: {
    id: 'longsniper',
    name: 'Longsniper',
    classes: ['physical', 'precise'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'longsniper'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['sniper', 'sniper']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 5000,
      damage: 50,
      fireRate: 1.8,
      projectileSpeed: 2500
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'highest_hp',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    visuals: {
      color: '#ff8af0'
    },
    special: {
      attackType: 'projectile',
      projectileTypeId: 'basic_bullet',
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 5,
            life: 2.4
          }
        }
      }
    },
    description: {
      text: '50 Schaden, 1.8s Feuerrate, unendliche Reichweite, zielt auf meisten HP, 100% schnellere Projektile.'
    }
  },

  quicksniper: {
    id: 'quicksniper',
    name: 'Quicksniper',
    classes: ['physical', 'precise'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'quicksniper'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['rapid', 'basesniper']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 240,
      damage: 23,
      fireRate: 1.15,
      projectileSpeed: 980
    },
    visuals: {
      color: '#8cf0ff'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'projectile',
      projectileTypeId: 'basic_bullet',
      quickRamp: true,
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 5,
            life: 2.4
          }
        }
      }
    },
    description: {
      text: 'Nur auf Basesniper. Schüsse pro Sekunde steigen linear bis 9.0 an, Spindown doppelt so schnell.'
    }
  },

  railgun: {
    id: 'railgun',
    name: 'Railgun',
    classes: ['electrical', 'precise'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'railgun'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['longsniper', 'tesla']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 280,
      damage: 200,
      fireRate: 3.4,
      projectileSpeed: 4200
    },
    visuals: {
      color: '#ffffff'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'railgun',
      projectileTypeId: 'rail_slug',
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 5,
            life: 0.22
          },
          pierce: {
            count: 3
          }
        },
        effects: {
          stun: {
            duration: 0.25,
            applyOn: 'onDirectHit'
          }
        }
      }
    },
    description: {
      text: 'Instant-Piercing-Schuss, 200 Schaden, 0.25s Stun auf normale Gegner.'
    }
  },
    laser: {
    id: 'laser',
    name: 'Laser',
    classes: ['beam', 'electrical'],
    tags: ['fusion'],
    unlock: {
        researchNodeId: 'laser'
    },
    acquire: {
        type: 'fusion',
        buyable: false,
        buyCost: null,
        fusionRecipes: [['tesla', 'tesla']],
        ritualRecipes: []
    },
    stats: {
        cost: null,
        range: 320,
        damage: 7.5,
        fireRate: 0.05,
        projectileSpeed: 0
    },
    visuals: {
        color: '#80d8ff'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'closest',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'laser_beam',
      projectileTypeId: 'laser_beam_projectile',
      projectileOverrides: {
        pipeline: {
          lingerTime: 0.08,
          lineWidth: 3,
          stats: {
            life: 0.08
          }
        }
      },
      damageFalloffValues: [7.5, 5, 1.5, 0],
      damageFalloffDistances: [100, 160, 200, 320]
    },
    description: {
        text: 'Beam-Tower mit Closest-Targeting und Damage-Falloff über Distanz.'
    }
  },
    pulselaser: {
    id: 'pulselaser',
    name: 'Pulselaser',
    classes: ['electrical', 'beam', 'precise'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'pulselaser'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['laser', 'sniper']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 250,
      damage: 70,
      fireRate: 0.4,
      projectileSpeed: 0
    },
    visuals: {
      color: '#d7f3ff'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'direct'
    },
    special: {
      attackType: 'pulse_laser_beam',
      projectileTypeId: 'pulse_beam_projectile',
      projectileOverrides: {
        pipeline: {
          lingerTime: 0.12,
          lineWidth: 4,
          stats: {
            life: 0.12
          }
        }
      }
    },
    description: {
      text: 'Präziser Beam-Tower ohne Falloff. Zielt auf den vordersten Gegner.'
    }
  },
  inferno: {
  id: 'inferno',
  name: 'Inferno',
  classes: ['beam', 'heat'],
  tags: ['fusion'],
  unlock: {
    researchNodeId: 'inferno'
  },
  acquire: {
    type: 'fusion',
    buyable: false,
    buyCost: null,
    fusionRecipes: [['flamethrower', 'laser']],
    ritualRecipes: []
  },
  stats: {
    cost: null,
    range: 118,
    damage: 5,
    fireRate: 0.1,
    projectileSpeed: 0
  },
  visuals: {
    color: '#ff5a5a'
  },
  targeting: {
    fireCondition: 'target_required',
    targetingMode: 'last',
    retentionMode: 'sticky',
    rangePolicy: {
      requireInRangeToAcquire: true,
      requireInRangeToFire: true
    },
    aimingMode: 'direct'
  },
  special: {
    attackType: 'inferno_beam',
    baseAngle: -Math.PI / 2,
    runtimeDefaults: {
      infernoTargetId: null,
      infernoStacks: 0,
      infernoKillLock: false,
      infernoBeamTargetId: null
    },
    rampStages: [5, 10, 25, 50, 150],
    rampStageDuration: 1.0
  },
  description: {
    text: 'Sticky Beam. Bleibt auf einem Ziel, solange es in Reichweite ist. Schaden ramped über Zeit: 5 → 10 → 25 → 50 → 150.'
  }
},

  mortar: {
    id: 'mortar',
    name: 'Mortar',
    classes: ['physical', 'explosive'],
    tags: ['fusion'],
    unlock: {
      researchNodeId: 'mortar'
    },
    acquire: {
      type: 'fusion',
      buyable: false,
      buyCost: null,
      fusionRecipes: [['bombus', 'sniper']],
      ritualRecipes: []
    },
    stats: {
      cost: null,
      range: 300,
      damage: 500,
      fireRate: 5,
      projectileSpeed: 220
    },
    visuals: {
      color: '#ff8af0'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'mortar_target_point',
      projectileTypeId: 'mortar_shell',
      projectileOverrides: {
        special: {
          explosion: {
            radius: 120,
            damageMultiplier: 1
          }
        },
        effects: {
          stun: {
            duration: 0.5,
            applyOn: 'onExplosionHit'
          }
        }
      }
    },
    description: {
      text: 'Langsames Einschlagsprojektil mit 300 Flächenschaden und 0.25s Stun.'
    }
  },

  penta: {
    id: 'penta',
    name: 'Penta',
    classes: ['physical'],
    tags: ['ritual'],
    unlock: {
      researchNodeId: null
    },
    acquire: {
      type: 'ritual',
      buyable: false,
      buyCost: null,
      fusionRecipes: [],
      ritualRecipes: []
    },
    origin: {
      ritualId: 'penta_ritual',
      ritualCenter: 'trio',
      ritualInputs: ['duo']
    },
    stats: {
      cost: null,
      range: 152,
      damage: 20,
      fireRate: 0.7,
      projectileSpeed: 520
    },
    visuals: {
      color: '#7df0d0'
    },
    targeting: {
      fireCondition: 'target_required',
      targetingMode: 'first',
      retentionMode: 'none',
      rangePolicy: {
        requireInRangeToAcquire: true,
        requireInRangeToFire: true
      },
      aimingMode: 'predictive'
    },
    special: {
      attackType: 'penta_burst',
      projectileTypeId: 'basic_bullet',
      forwardAngles: [-0.24, 0, 0.24],
      rearDual: true,
      projectileOverrides: {
        pipeline: {
          stats: {
            radius: 4,
            life: 2
          }
        }
      }
    },
    description: {
      text: '3 Schüsse nach vorne wie Trio und 2 gleichzeitig nach hinten wie Duo.'
    }
  }
};

