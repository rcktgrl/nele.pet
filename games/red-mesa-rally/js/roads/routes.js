'use strict';
/* Red Mesa Rally · Roads: street paths, every route definition and the Route spline */

/* ---------- Routes ---------- */
/* Turn grid corners into a street path that stays on the asphalt through right-angle turns. */
function streetPath(corners, closed) {
  const out = [], n = corners.length, R = 24;
  for (let k = 0; k < n; k++) {
    const p = corners[(k - 1 + n) % n], c = corners[k], q = corners[(k + 1) % n];
    const u = [c[0] - p[0], c[1] - p[1]], v = [q[0] - c[0], q[1] - c[1]];
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    out.push([c[0] - u[0] / lu * R, c[1] - u[1] / lu * R], [c[0] + v[0] / lv * R, c[1] + v[1] / lv * R]);
    out.push([c[0] + v[0] * 0.35, c[1] + v[1] * 0.35], [c[0] + v[0] * 0.65, c[1] + v[1] * 0.65]);
  }
  return out;
}
const CX = (i) => CITY.x0 + i * CITY.pitch, CZ = (j) => CITY.z0 + j * CITY.pitch;
const ROUTE_DEFS = [
  { id: 'canyon', closed: true, width: 17, jumps: 4, mud: 1, whoops: 1,
    pts: [[-60, 30], [80, -40], [215, -140], [268, -265], [235, -420], [255, -600], [170, -720], [10, -760], [-150, -700], [-240, -580], [-215, -430], [-195, -290], [-150, -190], [-130, -50]] },
  { id: 'mudbowl', closed: true, width: 15, jumps: 0, mud: 3, whoops: 2,
    pts: [[300, 500], [390, 430], [510, 430], [570, 510], [530, 600], [440, 610], [390, 670], [300, 700], [230, 640], [260, 560]] },
  { id: 'sprint', closed: false, width: 15, jumps: 5, mud: 1, whoops: 2,
    pts: [[-70, 230], [-230, 270], [-380, 190], [-480, 90], [-610, 60], [-700, -40], [-680, -200], [-620, -320], [-650, -480], [-560, -610], [-410, -650], [-300, -760]] },
  { id: 'ridge', closed: true, width: 15, jumps: 3, mud: 0, whoops: 2,
    pts: [[330, 60], [470, -30], [560, -130], [680, -150], [790, -80], [790, 60], [700, 140], [580, 130], [450, 150]] },
  { id: 'trail-east', closed: false, width: 9, trail: true, pts: [[60, 170], [160, 240], [240, 330], [290, 440]] },
  { id: 'trail-ridge', closed: false, width: 9, trail: true, pts: [[70, 110], [190, 80], [330, 60]] },
  { id: 'trail-lake', closed: false, width: 9, trail: true, pts: [[-20, 220], [-50, 400], [-10, 560], [-20, 700]] },
  { id: 'trail-north', closed: false, width: 9, trail: true, pts: [[-300, -760], [-150, -800], [10, -760]] },
  // ---- the east ----
  { id: 'tunnel', closed: false, width: 13, surface: 'asphalt', tunnel: true, lanes: 2, grade: 0.05,
    pts: [[792, 10], [850, 12], [1000, 16], [1250, 20], [1480, 18], [1600, 12], [1700, -10], [1760, -40]] },
  // the interstate: up the valley past Millbrook to the Kestrel Pass junction, through Port Calder on a viaduct, back west along the coast.
  // It flies over every road and railway that crosses it (viaduct), so you only get on at a junction or a ramp.
  { id: 'hwy', closed: true, width: 22, surface: 'asphalt', lanes: 4, rails: true, smoothWin: 40, grade: 0.06, viaduct: true,
    pts: [[1760, -40], [1690, -420], [1800, -820], [1990, -1060], [2160, -1120], [2380, -1390], [2720, -1440], [3021, -1390], [3150, -1330], [3400, -1180], [3640, -1060],
      [3870, -900], [3897, -640], [3897, -380], [3897, -120], [4022, 120], [4147, 380], [4120, 560], [3900, 560], [3600, 600], [3300, 640], [3150, 620], [2850, 585],
      [2550, 480], [2200, 320], [1900, 160]] },
  { id: 'coast', closed: false, width: 15, surface: 'asphalt', lanes: 2, rails: true, smoothWin: 30, grade: 0.08,
    pts: [[2350, 210], [2300, 500], [2450, 850], [2850, 1050], [3350, 1050], [3800, 905], [4000, 885], [4150, 850], [4262, 790], [4400, 772], [4650, 770], [4880, 768]] },
  { id: 'pass', closed: false, width: 11, surface: 'asphalt', lanes: 2, smoothWin: 25, grade: 0.11, rails: true,
    // ends sit on the highway centreline; the north face is too steep to drop straight down, so it switchbacks
    pts: [[3021, -1390], [3050, -1600], [2900, -1800], [3150, -1950], [3000, -2200], [2750, -2300], [2850, -2500], [2550, -2600], [2350, -2450], [2400, -2200],
      [2420, -2060], [2400, -1920], [2150, -1870], [1990, -1845], [1895, -1805], [1885, -1750], [1960, -1725], [2100, -1690], [2400, -1580], [2430, -1480], [2430, -1405]] },
  // ---- country roads: gravel tracks across the desert, farm lanes through the valley, logging roads in the pines ----
  { id: 'trail-west', closed: false, width: 10, trail: true, country: true, pts: [[-230, 270], [-380, 450], [-350, 650], [-180, 760], [-20, 700]] },
  { id: 'trail-mesa', closed: false, width: 10, trail: true, country: true, pts: [[-700, -40], [-560, -60], [-420, -30], [-260, -40], [-135, -60]] },
  { id: 'trail-spires', closed: false, width: 10, trail: true, country: true, pts: [[264, -302], [380, -235], [500, -180], [560, -130]] },
  { id: 'lane-valley', closed: false, width: 9, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[2430, -1405], [2470, -1340], [2600, -950], [2450, -600], [2650, -250], [2605, 175]] },
  { id: 'lane-farm', closed: false, width: 9, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[3060, -332], [3000, -420], [2800, -700], [2950, -1000], [3219, -1272]] },
  { id: 'track-pines', closed: false, width: 9, country: true, grade: 0.14, pts: [[2400, -1920], [2550, -1895], [2700, -1905], [2810, -1870], [2900, -1800]] },
  { id: 'track-logging', closed: false, width: 9, country: true, grade: 0.14, pts: [[2050, -1050], [2000, -1250], [2030, -1450], [2060, -1600], [2100, -1690]] },
  // ---- side roads: an orchard lane down to the coast, a dune loop by the beach, a ridge track over the pines, a mill lane across the valley ----
  { id: 'lane-orchard', closed: false, width: 10, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[2849, 148], [2880, 300], [3040, 420], [3150, 600], [3090, 790], [2960, 930], [2900, 1059]] },
  // the dune loop is a figure of eight: one pass goes over the other on a timber bridge in the middle
  { id: 'track-dunes', closed: true, width: 13, country: true, jumps: 2, whoops: 1, mud: 1, grade: 0.12, viaduct: true, crossover: true,
    pts: [[2020, 830], [2108, 936], [2183, 980], [2232, 936], [2250, 830], [2232, 724], [2183, 680], [2108, 724], [2020, 830], [1932, 936], [1857, 980], [1808, 936], [1790, 830], [1808, 724], [1857, 680], [1932, 724]] },
  { id: 'trail-dunes', closed: false, width: 10, trail: true, country: true, pts: [[2368, 731], [2310, 790], [2256, 830]] },
  { id: 'track-kestrel', closed: false, width: 10, country: true, grade: 0.13, jumps: 1,
    pts: [[3150, -1950], [3330, -1870], [3560, -1830], [3780, -1720], [3790, -1540], [3600, -1390], [3360, -1205]] },
  { id: 'lane-mill', closed: false, width: 9, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[1750, -650], [1950, -590], [2150, -640], [2300, -570], [2450, -600]] },
  // ---- links into Port Calder: Valley Rd runs on as Canal St, Mesa Blvd straight across town to Harbour Dr, North Rd along the foot of the Heights to Kingsway ----
  { id: 'valley-rd', closed: false, width: 13, surface: 'asphalt', lanes: 2, rails: true, smoothWin: 20, grade: 0.07,
    pts: [[2200, 320], [2350, 210], [2480, 192], [2605, 175], [2730, 160], [2849, 148], [2990, 160], [3150, 170], [3300, 175], [3460, 160], [3740, 140], [3960, 72], [4180, 130], [4296, 262]] },
  { id: 'mesa-blvd', closed: false, width: 12, surface: 'asphalt', lanes: 2, smoothWin: 20, grade: 0.08,
    pts: [[2627, -313], [2800, -315], [2960, -322], [3121, -339], [3300, -328], [3460, -332], [3700, -336], [3897, -340], [4100, -346], [4296, -350], [4500, -346], [4690, -326], [4900, -334], [5116, -346]] },
  { id: 'north-rd', closed: false, width: 11, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[2915, -925], [3020, -890], [3150, -860], [3300, -845], [3470, -888], [3650, -925], [3830, -936], [4050, -920], [4180, -890], [4300, -860]] },
  // ---- Kestrel high country: a scenic road from the ridge track over to the Heights, a gravel hairpin climb to the summit
  //      lookout, and a forest road down from the top of the pass through the pines to the Lodge ----
  { id: 'ridge-rd', closed: false, width: 10, surface: 'asphalt', lanes: 2, country: true, rails: true, smoothWin: 20, grade: 0.1,
    pts: [[3794, -1699], [3950, -1770], [4150, -1800], [4350, -1790], [4500, -1730], [4620, -1650], [4720, -1560], [4795, -1450], [4800, -1350]] },
  { id: 'summit', closed: false, width: 9, country: true, grade: 0.14,
    // found by a grade-limited search over the heightmap: east across the escarpment, one big hairpin, back west to the shoulder
    pts: [[3874, -1864], [3937, -1904], [4061, -1904], [4178, -1946], [4300, -1958], [4460, -1880], [4603, -1798], [4727, -1782], [4821, -1750], [4896, -1759],
      [4922, -1799], [4891, -1834], [4800, -1835], [4692, -1828], [4603, -1868], [4520, -1960], [4437, -2052], [4352, -2102], [4328, -2143]] },
  { id: 'forest-rd', closed: false, width: 10, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.1,
    pts: [[2577, -2601], [2700, -2648], [2860, -2630], [2980, -2530], [3060, -2420], [3200, -2380], [3330, -2290], [3400, -2180], [3447, -2164], [3469, -2044],
      [3596, -1895], [3693, -1876], [3756, -1836], [3874, -1864], [3927, -1812], [4000, -1815], [4076, -1794]] },
  // ---- interchanges: two-way slip roads off the viaduct down to the street grid ----
  { id: 'ramp-kestrel', closed: false, width: 10, surface: 'asphalt', lanes: 2, smoothWin: 12, grade: 0.07, viaduct: true, ramp: true,
    pts: [[3700, -1022], [3655, -1040], [3605, -1050], [3555, -1042], [3510, -1012], [3482, -960], [3472, -892]] },
  { id: 'ramp-central-w', closed: false, width: 10, surface: 'asphalt', lanes: 2, smoothWin: 12, grade: 0.07, viaduct: true, ramp: true,
    pts: [[3897, -730], [3893, -685], [3881, -640], [3868, -590], [3866, -520], [3866, -450], [3862, -380], [3852, -352], [3846, -338]] },
  { id: 'ramp-central-e', closed: false, width: 10, surface: 'asphalt', lanes: 2, smoothWin: 12, grade: 0.07, viaduct: true, ramp: true,
    pts: [[3912, -85], [3905, -125], [3912, -170], [3928, -220], [3930, -280], [3942, -318], [3950, -342]] },
  { id: 'ramp-port', closed: false, width: 10, surface: 'asphalt', lanes: 2, smoothWin: 12, grade: 0.07, viaduct: true, ramp: true,
    pts: [[3840, 566], [3795, 562], [3752, 548], [3724, 520], [3713, 482], [CX(2), CZ(11)]] },
  // the freight loop: round the valley and the coast, and out west through the rim mountains to circle the desert on a viaduct
  // (tunnels through the rim and the mesas, never at ground level out there)
  { id: 'rail', closed: true, width: 8, surface: 'rail', smoothWin: 70, passes: 6, grade: 0.03, noFeatures: true, sub: 6, lowland: 840,
    pts: [[4019, 620], [4044, 616], [4069, 612], [4094, 609], [4118, 607], [4143, 604], [4168, 603], [4193, 601], [4218, 600], [4243, 600], [4268, 600], [4293, 600], [4318, 601], [4343, 601], [4368, 602], [4393, 602], [4418, 602], [4443, 602], [4468, 602], [4493, 601], [4518, 600], [4543, 598], [4568, 593], [4592, 586], [4614, 574], [4631, 557], [4643, 534], [4649, 510], [4653, 486], [4655, 461], [4656, 436], [4656, 411], [4656, 386], [4655, 361], [4655, 336], [4655, 311], [4655, 285], [4654, 260], [4654, 235], [4654, 210], [4653, 185], [4653, 160], [4653, 135], [4652, 110], [4652, 85], [4652, 60], [4651, 35], [4651, 10], [4651, -15], [4651, -40], [4650, -65], [4650, -90], [4650, -115], [4650, -140], [4649, -165], [4649, -190], [4649, -215], [4649, -240], [4649, -265], [4649, -290], [4649, -315], [4649, -340], [4649, -365], [4649, -390], [4649, -415], [4649, -440], [4649, -465], [4649, -490], [4649, -515], [4649, -540], [4649, -565], [4649, -590], [4649, -615], [4649, -640], [4650, -665], [4650, -690], [4650, -715], [4650, -740], [4650, -765], [4650, -790], [4650, -815], [4651, -840], [4651, -865], [4651, -890], [4651, -915], [4651, -940], [4650, -965], [4649, -990], [4648, -1015], [4646, -1040], [4644, -1065], [4640, -1090], [4636, -1115], [4630, -1139], [4623, -1163], [4615, -1187], [4606, -1210], [4595, -1232], [4582, -1254], [4567, -1274], [4552, -1294], [4535, -1312], [4517, -1330], [4498, -1346], [4479, -1362], [4459, -1377], [4437, -1390], [4416, -1403], [4394, -1416], [4372, -1427], [4350, -1438], [4327, -1449], [4304, -1460], [4281, -1470], [4258, -1480], [4235, -1490], [4212, -1500], [4189, -1510], [4166, -1519], [4143, -1528], [4119, -1537], [4096, -1546], [4073, -1555], [4049, -1563], [4025, -1571], [4002, -1579], [3978, -1587], [3954, -1595], [3930, -1602], [3906, -1609], [3882, -1616], [3858, -1623], [3834, -1630], [3810, -1636], [3785, -1642], [3761, -1647], [3736, -1653], [3712, -1658], [3687, -1663], [3663, -1668], [3638, -1672], [3614, -1676], [3589, -1680], [3564, -1684], [3539, -1687], [3514, -1690], [3490, -1693], [3465, -1695], [3440, -1697], [3415, -1699], [3390, -1701], [3365, -1702], [3340, -1703], [3315, -1703], [3290, -1703], [3265, -1703], [3240, -1703], [3215, -1702], [3190, -1701], [3165, -1700], [3140, -1699], [3115, -1697], [3090, -1695], [3065, -1693], [3040, -1690], [3015, -1687], [2990, -1684], [2965, -1681], [2941, -1677], [2916, -1673], [2891, -1669], [2867, -1664], [2842, -1659], [2818, -1654], [2793, -1648], [2769, -1642], [2745, -1636], [2720, -1630], [2696, -1624], [2672, -1617], [2648, -1610], [2624, -1602], [2601, -1594], [2577, -1586], [2554, -1576], [2531, -1567], [2508, -1557], [2485, -1546], [2463, -1534], [2442, -1521], [2421, -1508], [2400, -1493], [2381, -1478], [2362, -1461], [2344, -1444], [2327, -1425], [2312, -1405], [2299, -1384], [2286, -1362], [2275, -1340], [2264, -1317], [2254, -1294], [2245, -1271], [2236, -1248], [2228, -1224], [2220, -1200], [2212, -1177], [2204, -1153], [2196, -1129], [2189, -1105], [2181, -1081], [2173, -1058], [2164, -1034], [2155, -1011], [2145, -988], [2134, -965], [2124, -943], [2113, -921], [2101, -899], [2089, -877], [2076, -856], [2062, -835], [2047, -814], [2032, -795], [2016, -775], [2000, -756], [1983, -738], [1965, -720], [1947, -703], [1928, -686], [1909, -671], [1889, -655], [1869, -640], [1848, -626], [1827, -613], [1806, -600], [1784, -588], [1762, -577], [1739, -567], [1716, -557], [1693, -548], [1669, -540], [1645, -532], [1621, -525], [1597, -519], [1572, -514], [1548, -510], [1523, -506], [1498, -504], [1473, -502], [1448, -500], [1423, -500], [1398, -500], [1373, -500], [1348, -500], [1323, -500], [1298, -500], [1273, -500], [1248, -500], [1223, -500], [1198, -500], [1173, -500], [1148, -500], [1123, -500], [1098, -500], [1073, -500], [1048, -500], [1023, -500], [998, -500], [973, -500], [948, -500], [923, -500], [898, -500], [873, -500], [848, -500], [823, -500], [798, -500], [773, -500], [748, -500], [723, -500], [698, -500], [673, -500], [648, -500], [623, -500], [598, -500], [573, -500], [548, -500], [523, -500], [498, -500], [473, -500], [448, -500], [423, -500], [398, -500], [373, -500], [348, -500], [323, -500], [298, -500], [273, -500], [248, -500], [223, -500], [198, -500], [173, -500], [148, -500], [123, -500], [98, -500], [73, -500], [48, -500], [23, -500], [-2, -500], [-27, -500], [-52, -500], [-77, -500], [-102, -500], [-127, -500], [-152, -500], [-177, -500], [-202, -500], [-227, -500], [-252, -500], [-277, -500], [-302, -500], [-327, -499], [-352, -497], [-376, -494], [-401, -489], [-425, -483], [-449, -476], [-473, -468], [-496, -459], [-519, -448], [-541, -436], [-562, -423], [-583, -409], [-603, -394], [-622, -378], [-640, -361], [-657, -343], [-674, -324], [-689, -304], [-704, -284], [-717, -263], [-729, -241], [-740, -218], [-750, -196], [-759, -172], [-766, -148], [-773, -124], [-778, -100], [-781, -75], [-784, -50], [-785, -25], [-785, 0], [-783, 25], [-781, 50], [-777, 74], [-771, 99], [-765, 123], [-757, 147], [-748, 170], [-738, 193], [-727, 215], [-714, 237], [-701, 258], [-686, 278], [-671, 298], [-654, 316], [-636, 334], [-618, 351], [-599, 367], [-579, 382], [-558, 396], [-536, 409], [-514, 420], [-491, 431], [-468, 440], [-445, 448], [-421, 455], [-396, 460], [-372, 465], [-347, 468], [-322, 469], [-297, 470], [-272, 470], [-247, 470], [-222, 470], [-197, 470], [-172, 470], [-147, 470], [-122, 470], [-97, 470], [-72, 470], [-47, 470], [-22, 470], [3, 470], [28, 470], [53, 470], [78, 470], [103, 470], [128, 470], [153, 470], [178, 470], [203, 470], [228, 470], [253, 470], [278, 470], [303, 470], [328, 470], [353, 470], [378, 470], [403, 470], [428, 470], [453, 470], [478, 470], [503, 470], [528, 470], [553, 470], [578, 470], [603, 470], [628, 470], [653, 470], [678, 470], [703, 470], [728, 470], [753, 470], [778, 470], [803, 470], [828, 470], [853, 470], [878, 470], [903, 470], [928, 470], [953, 470], [978, 470], [1003, 470], [1028, 470], [1053, 470], [1078, 470], [1103, 470], [1128, 470], [1153, 470], [1178, 470], [1203, 470], [1228, 470], [1253, 470], [1278, 470], [1303, 470], [1328, 470], [1353, 470], [1378, 470], [1403, 470], [1428, 470], [1453, 470], [1478, 470], [1503, 470], [1528, 470], [1553, 470], [1578, 470], [1603, 470], [1628, 470], [1653, 470], [1678, 470], [1703, 470], [1728, 470], [1753, 470], [1778, 470], [1803, 470], [1828, 470], [1853, 470], [1878, 470], [1903, 470], [1928, 470], [1953, 470], [1978, 470], [2003, 470], [2028, 470], [2053, 470], [2078, 470], [2103, 470], [2128, 470], [2153, 470], [2178, 470], [2203, 470], [2228, 470], [2253, 470], [2278, 470], [2303, 471], [2328, 473], [2353, 476], [2378, 480], [2402, 485], [2426, 491], [2451, 497], [2474, 505], [2498, 513], [2521, 522], [2544, 532], [2567, 543], [2599, 559], [2621, 571], [2643, 582], [2665, 594], [2688, 606], [2710, 617], [2732, 629], [2754, 640], [2777, 651], [2799, 662], [2822, 673], [2845, 683], [2867, 693], [2891, 703], [2914, 712], [2937, 721], [2961, 729], [2985, 736], [3009, 743], [3033, 749], [3058, 754], [3083, 758], [3107, 761], [3132, 763], [3157, 764], [3182, 764], [3207, 764], [3232, 763], [3257, 761], [3282, 759], [3307, 756], [3332, 753], [3357, 750], [3382, 746], [3406, 743], [3431, 738], [3456, 734], [3480, 730], [3505, 725], [3530, 721], [3554, 716], [3579, 711], [3603, 707], [3628, 702], [3653, 698], [3677, 694], [3702, 690], [3727, 686], [3751, 681], [3776, 677], [3800, 671], [3825, 666], [3849, 660], [3874, 655], [3898, 649], [3922, 643], [3947, 637], [3971, 631], [3995, 626]],
    bores: [[[4652, -945], [4235, -1488], 'HEIGHTS TUNNEL'], [[1693, -548], [808, -500], 'RIM TUNNEL NORTH'], [[808, 470], [1698, 470], 'RIM TUNNEL SOUTH'], [[-292, -500], [-622, -378], 'MESA TUNNEL'], [[568, -500], [248, -500], 'MESA TUNNEL'], [[-717, 233], [-505, 424], 'MESA TUNNEL'], [[-756, -182], [-784, -45], 'MESA TUNNEL']] },
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

class Route {
  constructor(def) {
    this.def = def; this.id = def.id; this.closed = def.closed; this.width = def.width;
    this.surface = def.surface || 'dirt';
    const P = def.pts, n = P.length, dense = [];
    const get = (i) => this.closed ? P[(i + n) % n] : P[clamp(i, 0, n - 1)];
    const segs = this.closed ? n : n - 1;
    const sub = def.sub || 40;
    for (let i = 0; i < segs; i++) for (let k = 0; k < sub; k++) dense.push(catmull(get(i - 1), get(i), get(i + 1), get(i + 2), k / sub));
    if (!this.closed) dense.push(P[n - 1].slice());
    const STEP = 2;
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    let total = cum[cum.length - 1];
    if (this.closed) total += Math.hypot(dense[0][0] - dense[dense.length - 1][0], dense[0][1] - dense[dense.length - 1][1]);
    const count = Math.floor(total / STEP);
    this.length = count * STEP; this.step = STEP; this.count = count;
    this.x = new Float32Array(count + 1); this.z = new Float32Array(count + 1); this.y = new Float32Array(count + 1);
    this.mud = new Uint8Array(count + 1); this.feature = new Float32Array(count + 1); this.curv = new Float32Array(count + 1);
    let j = 0;
    for (let i = 0; i <= count; i++) {
      const s = i * STEP * (total / this.length);
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      let ax, az, bx, bz, t;
      if (this.closed && s > cum[cum.length - 1]) { const a = dense[dense.length - 1], b = dense[0]; const seg = total - cum[cum.length - 1]; t = (s - cum[cum.length - 1]) / seg; ax = a[0]; az = a[1]; bx = b[0]; bz = b[1]; }
      else { const a = dense[j], b = dense[j + 1]; t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]); ax = a[0]; az = a[1]; bx = b[0]; bz = b[1]; }
      this.x[i] = lerp(ax, bx, clamp(t, 0, 1)); this.z[i] = lerp(az, bz, clamp(t, 0, 1));
    }
    if (this.closed) { this.x[count] = this.x[0]; this.z[count] = this.z[0]; }
    this.computeCurvature();
    if (this.closed && !def.keepStart) { // start/finish on the straightest stretch
      let best = 1e9, bi = 0; const span = 35;
      for (let i = 0; i < count; i++) { let m = 0; for (let j = -span; j <= span; j += 2) m = Math.max(m, Math.abs(this.curv[this.idx(i + j)])); if (m < best) { best = m; bi = i; } }
      const rot = (a) => { const b = new Float32Array(a.length); for (let i = 0; i < count; i++) b[i] = a[(i + bi) % count]; b[count] = b[0]; return b; };
      this.x = rot(this.x); this.z = rot(this.z); this.curv = rot(this.curv);
    }
  }
  computeCurvature() {
    const W = 6, count = this.count;
    for (let i = 0; i <= count; i++) {
      const a = this.idx(i - W), b = this.idx(i + W);
      const h1 = Math.atan2(this.x[i] - this.x[a], -(this.z[i] - this.z[a]));
      const h2 = Math.atan2(this.x[b] - this.x[i], -(this.z[b] - this.z[i]));
      let d = h2 - h1; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      this.curv[i] = d / (W * this.step);
    }
    if (!this.closed) for (let i = 0; i < W; i++) { this.curv[i] = this.curv[W]; this.curv[count - i] = this.curv[count - W]; }
  }
  idx(i) { const c = this.count; return this.closed ? ((i % c) + c) % c : clamp(i, 0, c); }
  wrapS(s) { return this.closed ? ((s % this.length) + this.length) % this.length : clamp(s, 0, this.length); }
  sample(arr, s) { s = this.wrapS(s); const f = s / this.step, i = Math.floor(f), t = f - i; return lerp(arr[this.idx(i)], arr[this.idx(i + 1)], t); }
  posAt(s, out) { out.x = this.sample(this.x, s); out.z = this.sample(this.z, s); out.y = this.sample(this.y, s); return out; }
  dirAt(s) { const a = this.wrapS(s - 2), b = this.wrapS(s + 2); const dx = this.sample(this.x, b) - this.sample(this.x, a), dz = this.sample(this.z, b) - this.sample(this.z, a); const l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; }
  curvAt(s) { return this.sample(this.curv, s); }
  project(x, z, sGuess, win) {
    let i0, i1;
    if (win < 0) { i0 = 0; i1 = this.count; } else { const c = Math.round(sGuess / this.step), w = Math.ceil(win / this.step); i0 = c - w; i1 = c + w; if (!this.closed) { i0 = Math.max(0, i0); i1 = Math.min(this.count, i1); } }
    let best = 1e18, bi = 0;
    for (let k = i0; k <= i1; k++) { const i = this.idx(k); const dx = x - this.x[i], dz = z - this.z[i]; const d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    const i = bi, j = this.idx(bi + 1), h = this.idx(bi - 1);
    let s = bi * this.step, bestD = best;
    for (const [a, b] of [[h, i], [i, j]]) {
      const ax = this.x[a], az = this.z[a], bx = this.x[b], bz = this.z[b];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
      const px = ax + vx * t, pz = az + vz * t, d = (x - px) ** 2 + (z - pz) ** 2;
      if (d <= bestD) { bestD = d; s = (a + t) * this.step; }
    }
    const [dx, dz] = this.dirAt(s);
    const lat = (x - this.sample(this.x, s)) * (-dz) + (z - this.sample(this.z, s)) * dx;
    return { s: this.wrapS(s), dist: Math.sqrt(bestD), lat };
  }
  /* corners worth warning about: where the heading swings by a fair angle within a short stretch */
  turns() {
    if (this._turns) return this._turns;
    const out = [], n = this.count, W = Math.round(30 / this.step);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.curv[i]); if (k < 0.012) continue;
      let peak = true; for (let j = -W; j <= W; j++) if (j && Math.abs(this.curv[this.idx(i + j)]) > k) { peak = false; break; }
      if (!peak || (!this.closed && (i < 5 || i > n - 5))) continue;
      let ang = 0; for (let j = -W; j <= W; j++) ang += this.curv[this.idx(i + j)] * this.step;
      if (Math.abs(ang) < 0.5) continue;
      const s = i * this.step;
      if (out.length && Math.abs(out[out.length - 1].s - s) < 45) continue;
      out.push({ s, ang, sharp: Math.abs(ang) > 1.15 || k > 0.06 });
    }
    return (this._turns = out);
  }
  /* walk along existing routes to build a point-to-point event route without re-carving */
  static compose(def, parts) {
    // sample each part, then fillet every junction with a quadratic curve around the corner
    const segs = parts.map(({ route: R, from, to, dir }) => {
      const s0 = R.project(from[0], from[1], 0, -1).s, s1 = R.project(to[0], to[1], 0, -1).s;
      let span = (s1 - s0) * dir; if (R.closed) span = ((span % R.length) + R.length) % R.length; else span = Math.abs(span);
      const out = []; for (let d = 0; d <= span; d += 8) { const s = R.wrapS(s0 + d * dir); out.push([R.sample(R.x, s), R.sample(R.z, s)]); }
      return out;
    });
    const FR = 34, pts = [];
    for (let k = 0; k < segs.length; k++) {
      let seg = segs[k];
      if (k > 0) { const c = segs[k - 1].corner; seg = seg.filter((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) > FR); }
      if (k < segs.length - 1) {
        const c = seg[seg.length - 1], nx = segs[k + 1][0];
        const corner = [(c[0] + nx[0]) / 2, (c[1] + nx[1]) / 2]; segs[k].corner = corner;
        seg = seg.filter((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) > FR);
        for (const p of seg) pts.push(p);
        // fillet from the trimmed end of this part to the trimmed start of the next
        const a = pts[pts.length - 1], nb = segs[k + 1].find((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) > FR) || nx;
        const L = Math.hypot(nb[0] - a[0], nb[1] - a[1]), n = Math.max(2, Math.ceil(L / 7));
        for (let i = 1; i < n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * corner[0] + t * t * nb[0], u * u * a[1] + 2 * u * t * corner[1] + t * t * nb[1]]); }
      } else for (const p of seg) pts.push(p);
    }
    const clean = [pts[0]];
    for (const p of pts) { const q = clean[clean.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 5) clean.push(p); }
    return new Route({ ...def, pts: clean, sub: 4 });
  }
}
