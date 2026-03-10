const TRACKS=[
  // ── Track 1: Monaco Streets ───────────────────────────
  {id:0,name:'Monaco Streets',desc:'Technical street circuit · 3 Laps',laps:3,rw:11,
   sky:0x0d1a2e,gnd:0x111122,
   wp:[
    [0,0,0],[140,0,5],[210,0,-20],[110,0,-80],[235,0,-155],
    [205,0,-215],[140,0,-245],[70,0,-315],[-20,0,-235],
    [-30,0,-205],[-55,0,-165],[-55,0,-110],[-35,0,-65],[-10,0,-30]
  ]},
  // ── Track 2: Spa-Francorchamps ────────────────────────
  {id:1,name:'Spa-Francorchamps',desc:'High-speed Ardennes circuit · 3 Laps',laps:3,rw:15,
   sky:0x0b1208,gnd:0x0d1a0a,
   wp:[
    // S/F heading south
    [-50,0,-70],[-70,0,-20],
    // Eau Rouge + Kemmel straight — long blast northeast
    [20,0,25],[80,0,70],[160,0,105],[260,0,120],
    // Les Combes chicane — right-left
    [310,0,105],[360,0,80],[360,0,50],
    // Rivage hairpin — tight right, exit heading southwest
    [330,0,50],
    // Downhill run southwest
    [215,0,95],[180,0,50],[150,0,10],
    // Pouhon double-apex left — sweeping south
    [100,0,20],[75,0,-50],
    // Stavelot right — turning north
    [280,0,-190],[250,0,-280],[100,0,-200],
    // Blanchimont fast left — heading northwest
    [150,0,-150],[70,0,-90],[-30,0,-100],
  ]},
  // ── Track 3: Monza ────────────────────────────────────
  {id:2,name:'Monza',desc:'Temple of Speed · 3 Laps',laps:3,rw:16,
   sky:0x110e06,gnd:0x1a1608,
   wp:[
    [0,0,0],[165,0,0],[240,0,-30],[205,0,-90],[275,0,-130],
    [195,0,-175],[135,0,-210],[65,0,-235],[-10,0,-238],
    [-65,0,-215],[-80,0,-160],[-60,0,-115],[-20,0,-128],
    [5,0,-100],[-18,0,-62],[-15,0,-28]
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