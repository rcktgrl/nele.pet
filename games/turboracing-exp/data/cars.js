const WHEEL_LAYOUTS = {
  sports: { wheelRadius: 0.33, innerRadius: 0.20, wheelThickness: 0.26, innerThickness: 0.28, positions: [[-1, 1.32], [1, 1.32], [-1, -1.32], [1, -1.32]] },
  wedge: { wheelRadius: 0.32, innerRadius: 0.24, wheelThickness: 0.30, innerThickness: 0.32, positions: [[-1.05, 1.38], [1.05, 1.38], [-1.05, -1.38], [1.05, -1.38]] },
  offroad: { wheelRadius: 0.48, innerRadius: 0.32, wheelThickness: 0.30, innerThickness: 0.36, positions: [[-1.04, 1.12], [1.04, 1.12], [-1.04, -1.12], [1.04, -1.12]], yOffset: 0.18 },
  hatch: { wheelRadius: 0.30, innerRadius: 0.18, wheelThickness: 0.24, innerThickness: 0.26, positions: [[-0.85, 1.15], [0.85, 1.15], [-0.85, -1.15], [0.85, -1.15]] },
};

const BODY_MATERIALS = {
  sports: { dark: 0x111111, glass: { color: 0x7799bb, opacity: 0.55 }, wheel: 0x111111, rim: 0x777777, headlight: { color: 0xffee88, emissive: 0x443300 }, taillight: { color: 0xee1100, emissive: 0x220000 } },
  wedge: { dark: 0x0e0e0e, glass: { color: 0x66aacc, opacity: 0.50 }, wheel: 0x0e0e0e, rim: 0x666666, headlight: { color: 0xffffaa, emissive: 0x554400 }, taillight: { color: 0xff1100, emissive: 0x330000 } },
  offroad: { dark: 0x181818, glass: { color: 0x88aacc, opacity: 0.52 }, wheel: 0x181818, rim: 0x555555, headlight: { color: 0xffffcc, emissive: 0x443300 }, taillight: { color: 0xff2200, emissive: 0x330000 } },
  hatch: { dark: 0x111111, glass: { color: 0x7799bb, opacity: 0.55 }, wheel: 0x111111, rim: 0x666666, headlight: { color: 0xffee88, emissive: 0x443300 }, taillight: { color: 0xee1100, emissive: 0x220000 } },
};

function box(width, height, depth, position, material = 'body', rotation) {
  return { shape: 'box', width, height, depth, position, material, rotation };
}

function cylinder(radiusTop, radiusBottom, height, position, material = 'dark', rotation) {
  return { shape: 'cylinder', radiusTop, radiusBottom, height, position, material, rotation };
}

const VISUALS = {
  sports: {
    materialSet: 'sports',
    wheels: WHEEL_LAYOUTS.sports,
    parts: [
      box(1.8, 0.48, 4.0, [0, 0.44, 0]),
      box(1.38, 0.48, 1.78, [0, 0.93, 0.08]),
      box(1.28, 0.42, 0.06, [0, 0.93, 0.98], 'glass', [0.22, 0, 0]),
      box(1.28, 0.38, 0.06, [0, 0.90, -0.82], 'glass', [-0.18, 0, 0]),
      box(0.1, 0.18, 3.6, [-0.95, 0.28, 0], 'dark'),
      box(0.1, 0.18, 3.6, [0.95, 0.28, 0], 'dark'),
      box(1.9, 0.07, 0.42, [0, 0.21, 2.1], 'dark'),
      box(1.72, 0.08, 0.44, [0, 1.1, -1.78], 'dark'),
      box(0.08, 0.34, 0.08, [-0.62, 0.93, -1.78], 'dark'),
      box(0.08, 0.34, 0.08, [0.62, 0.93, -1.78], 'dark'),
    ],
    headlights: [box(0.38, 0.13, 0.05, [-0.56, 0.54, 2.02], 'headlight'), box(0.38, 0.13, 0.05, [0.56, 0.54, 2.02], 'headlight')],
    taillights: [box(0.38, 0.11, 0.05, [-0.56, 0.54, -2.02], 'taillight'), box(0.38, 0.11, 0.05, [0.56, 0.54, -2.02], 'taillight')],
  },
  wedge: {
    materialSet: 'wedge',
    wheels: WHEEL_LAYOUTS.wedge,
    parts: [
      box(1.75, 0.08, 0.9, [0, 0.20, 2.05], 'dark'), box(1.88, 0.16, 1.0, [0, 0.26, 1.52]), box(1.92, 0.26, 1.4, [0, 0.34, 0.6]), box(2.0, 0.30, 2.4, [0, 0.40, -0.2]), box(2.06, 0.38, 1.0, [0, 0.40, -1.6]),
      box(1.30, 0.22, 1.65, [0, 0.74, 0.05]), box(1.35, 0.07, 1.72, [0, 0.88, 0.05], 'dark'),
      box(1.22, 0.35, 0.06, [0, 0.80, 0.88], 'glass', [0.58, 0, 0]), box(1.22, 0.28, 0.06, [0, 0.80, -0.75], 'glass', [-0.48, 0, 0]),
      box(0.12, 0.3, 0.75, [-1.02, 0.58, -0.40], 'dark'), box(0.06, 0.3, 0.7, [-1.04, 0.58, -0.40], 'dark'), box(0.12, 0.3, 0.75, [1.02, 0.58, -0.40], 'dark'), box(0.06, 0.3, 0.7, [1.04, 0.58, -0.40], 'dark'),
      box(2.0, 0.14, 0.55, [0, 0.28, -2.1], 'dark'), box(1.88, 0.06, 0.65, [0, 1.06, -1.88], 'dark'), box(0.07, 0.38, 0.67, [-0.9, 0.87, -1.88], 'dark'), box(0.07, 0.38, 0.67, [0.9, 0.87, -1.88], 'dark'),
      box(0.06, 0.32, 0.06, [-0.6, 0.88, -1.88], 'dark'), box(0.06, 0.32, 0.06, [0.6, 0.88, -1.88], 'dark'), box(0.36, 0.04, 0.5, [-0.4, 0.50, 1.0], 'dark'), box(0.36, 0.04, 0.5, [0, 0.50, 1.0], 'dark'), box(0.36, 0.04, 0.5, [0.4, 0.50, 1.0], 'dark'),
      box(0.08, 0.14, 3.4, [-1.02, 0.24, 0], 'dark'), box(0.08, 0.14, 3.4, [1.02, 0.24, 0], 'dark'),
      box(1.4, 0.03, 0.05, [0, 0.34, 2.01], 'headlight'), box(1.5, 0.03, 0.05, [0, 0.34, -2.01], 'taillight'),
    ],
    headlights: [box(0.52, 0.07, 0.05, [-0.58, 0.38, 2.01], 'headlight'), box(0.52, 0.07, 0.05, [0.58, 0.38, 2.01], 'headlight')],
    taillights: [box(0.5, 0.07, 0.05, [-0.62, 0.38, -2.01], 'taillight'), box(0.5, 0.07, 0.05, [0.62, 0.38, -2.01], 'taillight')],
  },
  offroad: {
    materialSet: 'offroad',
    wheels: WHEEL_LAYOUTS.offroad,
    parts: [
      box(1.88, 0.65, 3.75, [0, 0.82, 0]), box(1.78, 0.92, 2.35, [0, 1.60, -0.04]), box(1.76, 0.20, 1.45, [0, 1.23, 1.20]),
      box(1.62, 0.72, 0.07, [0, 1.58, 1.10], 'glass', [0.06, 0, 0]), box(1.62, 0.62, 0.07, [0, 1.58, -1.10], 'glass', [-0.06, 0, 0]), box(0.07, 0.60, 2.0, [-0.9, 1.62, -0.04], 'glass'), box(0.07, 0.60, 2.0, [0.9, 1.62, -0.04], 'glass'),
      box(1.84, 0.06, 2.4, [0, 2.09, -0.04], 'dark'), box(0.06, 0.06, 2.3, [-0.88, 2.09, -0.04], 'dark'), box(0.06, 0.06, 2.3, [0.88, 2.09, -0.04], 'dark'), box(1.8, 0.06, 0.07, [0, 2.09, -0.9], 'dark'), box(1.8, 0.06, 0.07, [0, 2.09, 0.9], 'dark'),
      box(1.72, 0.54, 0.1, [0, 0.90, 1.97], 'dark'), box(0.08, 0.64, 0.20, [-0.62, 0.86, 1.88], 'dark'), box(0.08, 0.64, 0.20, [0, 0.86, 1.88], 'dark'), box(0.08, 0.64, 0.20, [0.62, 0.86, 1.88], 'dark'), box(1.6, 0.07, 0.07, [0, 0.25, 1.93], 'dark'), box(1.6, 0.07, 0.07, [0, 0.65, 1.93], 'dark'),
      box(0.16, 0.14, 3.0, [-1.08, 0.50, 0], 'dark'), box(0.16, 0.14, 3.0, [1.08, 0.50, 0], 'dark'),
      box(0.20, 0.32, 0.88, [-1.04, 0.82, 1.12], 'dark'), box(0.20, 0.32, 0.88, [1.04, 0.82, 1.12], 'dark'), box(0.20, 0.32, 0.88, [-1.04, 0.82, -1.12], 'dark'), box(0.20, 0.32, 0.88, [1.04, 0.82, -1.12], 'dark'),
      box(0.11, 1.25, 0.11, [0.92, 1.6, 1.1], 'dark'), box(0.22, 0.11, 0.11, [0.92, 2.24, 1.1], 'dark'), cylinder(0.44, 0.44, 0.24, [0, 1.48, -2.06], 'wheel', [0, 0, Math.PI / 2]), cylinder(0.30, 0.30, 0.26, [0, 1.48, -2.06], 'rim', [0, 0, Math.PI / 2]),
      box(1.6, 0.07, 0.06, [0, 0.80, -1.93], 'taillight'),
    ],
    headlights: [box(0.40, 0.40, 0.06, [-0.56, 1.06, 1.93], 'headlight'), box(0.40, 0.40, 0.06, [0.56, 1.06, 1.93], 'headlight')],
    taillights: [box(0.38, 0.30, 0.06, [-0.56, 1.06, -1.93], 'taillight'), box(0.38, 0.30, 0.06, [0.56, 1.06, -1.93], 'taillight')],
  },
  hatch: {
    materialSet: 'hatch',
    wheels: WHEEL_LAYOUTS.hatch,
    parts: [
      box(1.65, 0.45, 3.2, [0, 0.48, 0]), box(1.50, 0.50, 1.8, [0, 0.98, -0.15]), box(1.48, 0.06, 1.7, [0, 1.24, -0.15], 'dark'),
      box(1.38, 0.42, 0.06, [0, 0.92, 0.78], 'glass', [0.30, 0, 0]), box(1.38, 0.45, 0.06, [0, 0.92, -1.0], 'glass', [-0.55, 0, 0]), box(0.06, 0.38, 1.5, [-0.76, 0.98, -0.15], 'glass'), box(0.06, 0.38, 1.5, [0.76, 0.98, -0.15], 'glass'),
      box(1.60, 0.10, 1.0, [0, 0.72, 1.12]), box(1.68, 0.22, 0.35, [0, 0.32, 1.68], 'dark'), box(1.68, 0.22, 0.30, [0, 0.32, -1.68], 'dark'), box(0.06, 0.16, 2.8, [-0.84, 0.30, 0], 'dark'), box(0.06, 0.16, 2.8, [0.84, 0.30, 0], 'dark'), box(1.30, 0.06, 0.30, [0, 1.26, -1.0], 'dark'),
    ],
    headlights: [box(0.35, 0.18, 0.05, [-0.52, 0.52, 1.62], 'headlight'), box(0.35, 0.18, 0.05, [0.52, 0.52, 1.62], 'headlight')],
    taillights: [box(0.30, 0.15, 0.05, [-0.52, 0.52, -1.62], 'taillight'), box(0.30, 0.15, 0.05, [0.52, 0.52, -1.62], 'taillight')],
  },
};

export const CARS = [
  { id: 0, name: 'Viper GT', desc: 'Low wedge supercar, razor sharp', hex: '#ff2222', col: 0xff2222, maxSpd: 61, accel: 9.0, brake: 21, hdl: 0.84, aiSpd: 1.00, gndOff: 0.32, camH: 1.50, stats: { s: 88, a: 82, h: 88 }, visual: VISUALS.wedge },
  { id: 1, name: 'Thunder V8', desc: 'Raw American muscle, brutal power', hex: '#2255ff', col: 0x2255ff, maxSpd: 75, accel: 9.0, brake: 20, hdl: 0.60, aiSpd: 0.96, gndOff: 0.33, camH: 1.80, stats: { s: 100, a: 70, h: 54 }, visual: VISUALS.sports },
  { id: 2, name: 'Rally Storm', desc: 'Off-road beast, unstoppable grip', hex: '#22cc44', col: 0x22cc44, maxSpd: 50, accel: 8.5, brake: 23, hdl: 0.90, aiSpd: 0.93, gndOff: 0.50, camH: 2.80, stats: { s: 68, a: 78, h: 98 }, visual: VISUALS.offroad },
  { id: 3, name: 'Flash Hatch', desc: 'Pocket rocket, explosive acceleration', hex: '#eecc22', col: 0xeecc22, maxSpd: 61, accel: 11.0, brake: 20, hdl: 0.70, aiSpd: 0.97, gndOff: 0.36, camH: 1.90, stats: { s: 68, a: 100, h: 54 }, visual: VISUALS.hatch },
];

export const CAR_SELECTION_ORDER = CARS.map(({ id }) => id);
export const CAR_MATERIALS = BODY_MATERIALS;
