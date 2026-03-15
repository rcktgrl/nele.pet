export const TRACKS=[
  // ── Track 1: Monaco Streets ───────────────────────────
  // Shape: S/F east → Sainte Devote right → climb to Casino → Mirabeau →
  //        Grand Hotel hairpin → Portier → tunnel → harbour chicane →
  //        swimming pools → Rascasse hairpin → Anthony Noghes → S/F
  {id:0,name:'Monaco Streets',desc:'Technical street circuit · 3 Laps',laps:3,rw:11,
   sky:0x0d1a2e,gnd:0x111122,
   noAutoZones:[
     {x:130,z:-33,r:20},   // Sainte Devote
     {x:166,z:-242,r:24},  // Grand Hotel hairpin
     {x:-15,z:-253,r:18},  // Nouvelle Chicane
     {x:-55,z:-196,r:20},  // Rascasse hairpin
   ],
   wp:[
    // S/F straight
    [0,0,0],[50,0,2],[90,0,2],
    // Sainte Devote (right)
    [115,0,-10],[130,0,-30],[128,0,-58],
    // Climb – Beau Rivage kink → Massenet
    [112,0,-88],[92,0,-118],
    // Casino Square (right–right)
    [80,0,-140],[90,0,-158],[112,0,-168],[130,0,-162],
    // Mirabeau descent
    [148,0,-172],[158,0,-190],[162,0,-210],
    // Grand Hotel hairpin (~180°)
    [165,0,-228],[166,0,-242],[160,0,-254],[142,0,-260],[122,0,-257],
    // Portier (right into tunnel)
    [102,0,-248],[82,0,-253],[64,0,-260],
    // Tunnel
    [42,0,-266],[18,0,-268],[-5,0,-266],
    // Nouvelle Chicane (left–right)
    [-18,0,-258],[-14,0,-248],[-4,0,-244],
    // Tabac → harbour / swimming pools (west)
    [-20,0,-240],[-35,0,-232],[-48,0,-220],
    // Rascasse hairpin (~180°)
    [-55,0,-205],[-58,0,-188],[-52,0,-172],[-38,0,-165],
    // Anthony Noghes → S/F return
    [-20,0,-145],[-15,0,-115],[-10,0,-85],[-8,0,-50],[-5,0,-22]
  ]},
  // ── Track 2: Spa-Francorchamps ────────────────────────
  // Shape: La Source hairpin → Raidillon/Eau Rouge → Kemmel straight →
  //        Les Combes chicane → Rivage hairpin → Pouhon left →
  //        Fagnes/Bus Stop chicane → return to La Source
  {id:1,name:'Spa-Francorchamps',desc:'High-speed Ardennes circuit · 3 Laps',laps:3,rw:15,
   sky:0x0b1208,gnd:0x0d1a0a,
   noAutoZones:[
     {x:-16,z:-55,r:22},   // La Source hairpin
     {x:348,z:-110,r:22},  // Les Combes chicane
     {x:258,z:-105,r:26},  // Rivage hairpin
     {x:162,z:-260,r:20},  // Bus Stop chicane
   ],
   wp:[
    // La Source hairpin exit → S/F straight
    [0,0,0],[50,0,-15],
    // Raidillon / Eau Rouge (fast compression, we flatten)
    [95,0,-38],[140,0,-68],[185,0,-95],
    // Kemmel straight
    [235,0,-115],[290,0,-130],
    // Les Combes chicane (right–left)
    [325,0,-130],[345,0,-118],[348,0,-102],[338,0,-88],
    // Approach to Rivage
    [318,0,-75],[298,0,-68],
    // Rivage hairpin (~180° right)
    [278,0,-75],[265,0,-88],[258,0,-105],[262,0,-122],[272,0,-138],
    // Post-hairpin descent toward Pouhon
    [265,0,-160],[250,0,-180],
    // Pouhon double-apex left
    [232,0,-195],[210,0,-202],[188,0,-198],[170,0,-185],
    // Fagnes curves
    [155,0,-178],[138,0,-185],[125,0,-200],[118,0,-220],[125,0,-238],[142,0,-248],
    // Bus Stop chicane (right–left)
    [162,0,-252],[170,0,-260],[165,0,-268],[148,0,-270],
    // Blanchimont / return to La Source
    [120,0,-262],[88,0,-248],[58,0,-228],[30,0,-205],[10,0,-178],
    [-5,0,-148],[-15,0,-112],[-18,0,-75],
    // La Source hairpin
    [-18,0,-45],[-12,0,-20]
  ]},
  // ── Track 3: Monza ────────────────────────────────────
  // Shape: Rettifilio straight → Variante del Rettifilio chicane →
  //        Curva Grande → Roggia chicane → Lesmo 1&2 →
  //        Ascari chicane → Curva Parabolica → S/F
  {id:2,name:'Monza',desc:'Temple of Speed · 3 Laps',laps:3,rw:16,
   sky:0x110e06,gnd:0x1a1608,
   noAutoZones:[
     {x:218,z:-20,r:20},  // Variante del Rettifilio chicane
     {x:250,z:-165,r:18}, // Roggia chicane
     {x:150,z:-235,r:18}, // Ascari chicane
   ],
   wp:[
    // Rettifilio main straight
    [0,0,0],[60,0,0],[120,0,-2],[180,0,-2],
    // Variante del Rettifilio (right–left chicane)
    [215,0,-8],[225,0,-20],[218,0,-32],[205,0,-38],
    // Post-chicane → Curva Grande entry
    [215,0,-50],[240,0,-65],
    // Curva Grande (fast right, sweeping south)
    [255,0,-88],[260,0,-112],[252,0,-135],
    // Roggia chicane (right–left)
    [248,0,-152],[255,0,-165],[248,0,-178],[235,0,-182],
    // Lesmo 1 (right)
    [215,0,-185],[200,0,-195],
    // Lesmo 2 (right)
    [188,0,-205],[180,0,-215],[178,0,-228],
    // Ascari chicane (right–left)
    [168,0,-235],[155,0,-238],[140,0,-235],[130,0,-228],
    // Curva Parabolica (long fast right, sweeping back north)
    [112,0,-232],[85,0,-230],[60,0,-220],[38,0,-200],
    [22,0,-172],[12,0,-140],[6,0,-105],[2,0,-68],[0,0,-35]
  ]},
  // ── Track 4: Downtown Sprint (City) ─────────────────
  // Grid-aligned to 70m blocks. 8R+4L = 360° each direction
  // Grid roads: X=0,-140,-210,-280,-350  Z=70,0,-70,-140,-210,-280
  {id:3,name:'Downtown Sprint',desc:'Night city streets · 3 Laps',laps:3,rw:10,type:'city',
   sky:0x06060c,gnd:0x0a0a14,gridSize:70,
   // Intersections the track visits in order (for AI grid-following)
   cityRoute:[[0,70],[0,-140],[-140,-140],[-140,-280],[-280,-280],[-280,-210],[-350,-210],[-350,-70],[-210,-70],[-210,0],[-140,0],[-140,70]],
   wp:[
    // S/F heading south on X=0
    [0,0,55],[0,0,-30],[0,0,-125],
    // R1 → west on Z=-140
    [-15,0,-140],[-70,0,-140],[-125,0,-140],
    // R2 → south on X=-140
    [-140,0,-155],[-140,0,-210],[-140,0,-265],
    // R3 → west on Z=-280
    [-155,0,-280],[-210,0,-280],[-265,0,-280],
    // R4 → north on X=-280
    [-280,0,-265],[-280,0,-225],
    // L1 → west on Z=-210
    [-295,0,-210],[-335,0,-210],
    // R5 → north on X=-350
    [-350,0,-195],[-350,0,-140],[-350,0,-85],
    // L2 → east on Z=-70
    [-335,0,-70],[-280,0,-70],[-225,0,-70],
    // L3 → north on X=-210
    [-210,0,-55],[-210,0,-15],
    // R6 → east on Z=0
    [-195,0,0],[-155,0,0],
    // L4 → north on X=-140
    [-140,0,15],[-140,0,55],
    // R7 → east on Z=70
    [-125,0,70],[-70,0,70],[-15,0,70],
    // R8 → south, back to start
    [0,0,60]
  ]},
];