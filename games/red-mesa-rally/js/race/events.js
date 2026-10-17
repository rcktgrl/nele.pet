'use strict';
/* Red Mesa Rally · Events: every race, sprint and time attack, plus rival names and colours */

const EVENTS = [
  { id: 'canyon', name: 'Canyon Run', type: 'race', route: 'canyon', laps: 3, ai: 5, region: 'desert', blurb: 'Three laps through the north canyon. Four jumps and a mud trap below the spires.' },
  { id: 'mudbowl', name: 'Mud Bowl', type: 'race', route: 'mudbowl', laps: 4, ai: 5, region: 'desert', blurb: 'A short, filthy lakeside circuit. Heavy metal recommended.' },
  { id: 'sprint', name: 'Mesa Sprint', type: 'sprint', route: 'sprint', laps: 1, ai: 5, region: 'desert', blurb: 'Point to point from the festival to the north rim. Five big jumps.' },
  { id: 'ridge', name: 'Ridge Attack', type: 'time', route: 'ridge', laps: 3, ai: 0, region: 'desert', blurb: 'Solo time attack around the eastern ridge. Beat the medal times.', medals: [175, 190, 210] },
  { id: 'interstate', name: 'Interstate Loop', type: 'race', route: 'hwy', laps: 1, ai: 5, region: 'city', aiCars: ['kaze', 'ironside'], crew: true, blurb: 'One flat-out lap of the interstate against Calder\'s crew: up the valley, over the river, along the Port Calder viaduct and home by the coast. No crossings any more, just traffic.' },
  { id: 'harbour', name: 'Harbour Circuit', type: 'race', route: 'harbour', laps: 2, ai: 5, region: 'city', aiCars: ['kaze', 'ironside'], crew: true, blurb: 'Downtown Port Calder at full noise: eight right angles between the towers and the docks.' },
  { id: 'pass', name: 'Kestrel Pass', type: 'sprint', route: 'pass', laps: 1, ai: 5, finishBack: 220, region: 'city', aiCars: ['kaze', 'ironside'], crew: true, blurb: 'Up through the pines and back down to the valley. Narrow, fast and unforgiving.' },
  // side roads, the interchange and the metro
  { id: 'orchard', name: 'Orchard Dash', type: 'sprint', route: 'lane-orchard', laps: 1, ai: 5, region: 'city', blurb: 'A farm lane from the interstate down through the orchards to the Salt Coast. No shoulders, one level crossing, fruit stands on every bend.' },
  { id: 'dunes', name: 'Dune Loop', type: 'race', route: 'track-dunes', laps: 3, ai: 5, region: 'city', blurb: 'Three laps of loose sand and scrub behind the Salt Coast beach. Two jumps and one soft patch that swallows trucks.' },
  { id: 'kestrel', name: 'Kestrel Ridgeline', type: 'time', route: 'track-kestrel', laps: 1, ai: 0, region: 'city', medals: [55, 60, 66], blurb: 'Solo against the clock on the old ridge track: off Kestrel Pass, down through the pines, over the railway and onto the interstate.' },
  { id: 'express', name: 'Exit 5 Express', type: 'sprint', route: 'express', laps: 1, ai: 5, region: 'city', aiCars: ['kaze', 'ironside'], crew: true, blurb: "Out of the tunnel, up the interstate and along the viaduct, off at Calder Central and straight through downtown to the docks. His crew paved that ramp. They know every inch." },
  { id: 'metro', name: 'Metro Line', type: 'race', route: 'metro', laps: 2, ai: 5, region: 'city', aiCars: ['ironside', 'kaze'], crew: true, vic: true,
    at: (() => { const sp = metroSpurs()[0]; return { x: sp.x - sp.dx * 16, z: sp.z - sp.dz * 16, yaw: Math.atan2(-sp.dx, -sp.dz) }; })(),
    blurb: 'Two laps of the Calder Metro loop, under downtown, against Vic Calder and his crew. Start down the Kingsway ramp. No road down there, just two tracks: the stopping train runs your way, the express comes at you. Switch tracks to stay alive.' },
  { id: 'river', name: 'Calder River Run', type: 'sprint', route: 'river', laps: 1, ai: 5, region: 'city', boat: true, finishBack: 40,
    at: (() => { const q = RIVER.boatStart, dx = 2470 - q.x, dz = -610 - q.z, L = Math.hypot(dx, dz); return { x: q.x + dx / L * 48, z: q.z + dz / L * 48 }; })(),
    blurb: 'Skiffs from Millbrook down to the harbour. Left or right round the island, then the open channel under the bridges or the dark boat tunnel under the docks. Both ways are the same length.' },
  { id: 'finale', name: 'Coast to Canyon', type: 'sprint', route: 'finale', laps: 1, ai: 5, region: 'city', aiCars: ['ironside', 'kaze'], boss: true, locked: true, blurb: 'Vic Calder, his best crew and you. From the harbour, along the coast, through the tunnel and home to the festival. Winner keeps the valley.' },
];


const EVENT_COLORS = { canyon: 0xff6a1a, mudbowl: 0x9b5a2a, sprint: 0xf2c230, ridge: 0x6fb7d9, interstate: 0x8fb8ff, harbour: 0xff7ad0, pass: 0x6fd9a8, finale: 0xffd23f, orchard: 0xa8d94a, dunes: 0xe8c27a, kestrel: 0x3fae7a, express: 0xff9a3c, metro: 0x2ab3c8, river: 0x3fa9e0 };
const CREW_NAMES = ['Nico Brand', 'Lena Marsh', 'Ozzie Vale', 'Tess Kurata', 'Ray Dunmore', 'Juno Sato'];
const AI_NAMES = ['Kade Ruiz', 'Mina Okafor', 'Wes Tamura', 'Ilse Brandt', 'Tomas Reyes', 'June Halloran', 'Rook Abernathy', 'Sasha Petrov'];
const AI_COLORS = [0x1f4e79, 0xf0b50a, 0x2f6f53, 0xe9e2d6, 0x6b2d8c, 0x23262b, 0xc81e1e, 0x2a8c8c];

const CORE = { METRO, metroSpurs, MetroTrain, TAU, clamp, lerp, smooth, mulberry32, hash2, Noise, WORLD, WATER_Y, HUB, MESAS, LAKE, CITY, DOCKS, FLAT, REGIONS, EAST_POLY, eastSDF, boxMask, hillMask, eastWeight, desertHeight, eastHeight, biomeAt, cityCell, cityBlockKind, ROUTE_DEFS, Route, City, Terrain, Scatter, Props, VEHICLES, engineCurve, Car, Train, World, AIDriver, Race, EVENTS, coreInit, naturalHeight };


'use strict';
