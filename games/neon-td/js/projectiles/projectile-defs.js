const PROJECTILE_DEFS = {
  basic_bullet: {
    id: 'basic_bullet',
    pipelineType: 'standard',
    pipeline: {
      renderType: 'orb',
      collisionType: 'circle_hit',
      pierceType: 'none',
      stats: {
        radius: 4,
        life: 2
      }
    },
    visuals: {
      colorMode: 'source_tower'
    }
  },

  rail_slug: {
    id: 'rail_slug',
    pipelineType: 'standard',
    pipeline: {
      renderType: 'rail_slug',
      collisionType: 'segment_hit',
      pierceType: 'count',
      stats: {
        radius: 5,
        life: 0.22
      },
      pierce: {
        count: 3
      }
    },
    visuals: {
      colorMode: 'source_tower'
    },
    effects: {
      stun: {
        duration: 0.25,
        applyOn: 'onDirectHit'
      }
    }
  },

  mortar_shell: {
    id: 'mortar_shell',
    pipelineType: 'mortar_shell',
    pipeline: {
      renderType: 'orb',
      arrivalRadius: 8,
      stats: {
        radius: 6,
        life: 1
      }
    },
    visuals: {
      colorMode: 'source_tower'
    },
    effects: {
      stun: {
        duration: 0.25,
        applyOn: 'onExplosionHit'
      }
    },
    special: {
      explosion: {
        radius: 100,
        damageMultiplier: 1
      }
    }
  },

  explosive_orb: {
    id: 'explosive_orb',
    pipelineType: 'standard',
    pipeline: {
      renderType: 'orb',
      collisionType: 'circle_hit',
      pierceType: 'none',
      stats: {
        radius: 5,
        life: 2.2
      }
    },
    visuals: {
      colorMode: 'source_tower'
    },
    special: {
      explosion: {
        radius: 52,
        damageMultiplier: 0.65
      }
    }
  },

  flame_piercer: {
    id: 'flame_piercer',
    pipelineType: 'standard',
    pipeline: {
      renderType: 'orb',
      collisionType: 'circle_hit',
      pierceType: 'count',
      stats: {
        radius: 10,
        life: 0.55
      },
      pierce: {
        count: 5
      }
    },
    visuals: {
      colorMode: 'source_tower'
    }
  },
tesla_arc: {
    id: 'tesla_arc',
    pipelineType: 'tesla_chain',
    pipeline: {
        renderType: 'beam_arc',
        chainCount: 3,
        chainDelay: 0.06,
        chainRange: 140,
        retargetMode: 'closest_unvisited',
        allowRepeatTargets: false,
        lingerTime: 0.12,
        stats: {
            life: 10
        }
    },
    visuals: {
      colorMode: 'source_tower'
    },
    effects: {}
  },
    laser_beam_projectile: {
    id: 'laser_beam_projectile',
    pipelineType: 'beam',
    pipeline: {
      renderType: 'beam_line',
      lingerTime: 0.08,
      lineWidth: 3,
      stats: {
        life: 0.08
      }
    },
    visuals: {
      colorMode: 'source_tower'
    },
    effects: {}
  },

  pulse_beam_projectile: {
    id: 'pulse_beam_projectile',
    pipelineType: 'beam',
    pipeline: {
      renderType: 'beam_line',
      lingerTime: 0.12,
      lineWidth: 4,
      stats: {
        life: 0.12
      }
    },
    visuals: {
      colorMode: 'source_tower'
    },
    effects: {}
  }
};