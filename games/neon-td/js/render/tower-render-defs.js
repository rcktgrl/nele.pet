const TOWER_RENDER_DEFS = {
  basic: {
    base: {
      bodyRadius: 20,
      bodyFill: { mode: 'towerBody' },
      coreRadius: 10,
      coreFill: '#08101f'
    },
    layers: [
      {
        rotationSpace: 'world',
        when: 'always',
        parts: [
          {
            type: 'ring',
            x: 0,
            y: 0,
            radius: 15,
            lineWidth: 1.5,
            stroke: 'rgba(89,243,255,.18)'
          }
        ]
      },
      {
        rotationSpace: 'turret',
        when: 'always',
        parts: [
          {
            type: 'roundRect',
            x: 0,
            y: -5,
            width: 24,
            height: 10,
            radius: 5,
            fill: 'rgba(234,250,255,.95)'
          },
          {
            type: 'roundRect',
            x: 14,
            y: -1.25,
            width: 8,
            height: 2.5,
            radius: 1.25,
            fill: { mode: 'towerColor' },
            glow: {
              color: 'rgba(89,243,255,.45)',
              blur: 6
            }
          }
        ]
      }
    ]
  },

  tesla: {
    base: {
        bodyRadius: 20,
        bodyFill: '#9d8cff',
        coreRadius: 10,
        coreFill: '#08101f'
    },
    layers: [
        {
        rotationSpace: 'turret',
        when: 'always',
        parts: [
            {
            type: 'roundRect',
            x: 0,
            y: -2,
            width: 18,
            height: 4,
            radius: 2,
            fill: '#bfc6d6'
            },
            {
            type: 'roundRect',
            x: 16,
            y: -4,
            width: 6,
            height: 8,
            radius: 2,
            fill: '#9aa3b6'
            },
            {
            type: 'circle',
            x: 22,
            y: 0,
            radius: 3,
            fill: '#ffffff',
            glow: {
                color: 'rgba(157,140,255,.8)',
                blur: 8
            }
            }
        ]
        }
    ]
    }
};