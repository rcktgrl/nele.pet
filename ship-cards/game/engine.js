/* Ship Card engine: turns an Elite Dangerous loadout (journal "Loadout" format,
   as exported by Inara → Coriolis) into a card with fixed, rule-based stats.
   Module and hull data: EDCD coriolis-data. Works in the browser (window.ShipCards)
   and in Node (module.exports). */
(function (root) {
  'use strict';

  // ---------- name tables ----------
  const SHIP_FILE = {
    sidewinder: 'sidewinder', eagle: 'eagle', hauler: 'hauler', adder: 'adder', viper: 'viper', cobramkiii: 'cobra_mk_iii',
    cobramkiv: 'cobra_mk_iv', cobramkv: 'cobramkv', diamondback: 'diamondback_scout', diamondbackxl: 'diamondback_explorer',
    asp: 'asp', asp_scout: 'asp_scout', vulture: 'vulture', type6: 'type_6_transporter', type7: 'type_7_transport',
    type8: 'type_8_transport', type9: 'type_9_heavy', type9_military: 'type_10_defender', lakonminer: 'type_11_prospector',
    dolphin: 'dolphin', orca: 'orca', belugaliner: 'beluga', ferdelance: 'fer_de_lance', mamba: 'mamba', python: 'python',
    python_nx: 'python_nx', krait_mkii: 'krait_mkii', krait_light: 'krait_phantom', mandalay: 'mandalay',
    explorer_nx: 'explorer_nx', panthermkii: 'panthermkii', anaconda: 'anaconda', federation_corvette: 'federal_corvette',
    federation_dropship: 'federal_dropship', federation_dropship_mkii: 'federal_assault_ship', federation_gunship: 'federal_gunship',
    cutter: 'imperial_cutter', empire_trader: 'imperial_clipper', empire_courier: 'imperial_courier', empire_eagle: 'imperial_eagle',
    typex: 'alliance_chieftain', typex_2: 'alliance_crusader', typex_3: 'alliance_challenger', independant_trader: 'keelback',
    viper_mkiv: 'viper_mk_iv', corsair: 'imperial_corsair', kestrel: 'kestrel'
  };
  // Ships missing from coriolis-data: base values copied from the closest ship and marked as estimates.
  const SHIP_ESTIMATE = {
    anacondamkii: { from: 'anaconda', name: 'Anaconda Mk II', mfr: 'Faulcon DeLacy', hull: { hullMass: 921 } }, // hull mass fitted to Inara's 54.82 ly jump
    mediumtransport01: { from: 'type_8_transport', name: 'Lynx Highliner', mfr: 'Saud Kruger' }
  };
  const WEAPON_GROUPS = new Set(['pl', 'ul', 'bl', 'mc', 'c', 'fc', 'pa', 'rg', 'mr', 'tp', 'nl', 'axmc', 'axmr', 'ggc', 'gpc', 'gsc', 'rfl', 'rsl', 'pas', 'tbsc', 'tbrfl', 'tbem']);
  const MINING_GROUPS = new Set(['ml', 'mvr', 'abl', 'scl', 'sdm', 'mr_mining']);
  const ENGINEERABLE = /^(hpt_(?!.*(cargoscanner_|cloudscanner_|crimescanner_)|.*guardian)|int_(shieldgenerator|hullreinforcement|shieldcellbank|powerplant|engine|hyperdrive|lifesupport|powerdistributor|sensors|fsdinterdictor|dronecontrol|detailedsurfacescanner|fueltransfer|refinery)|.*_armour_)/;

  // Engineering effect at full grade 5 (fraction). Scaled by grade progress. Approximate, fixed table.
  const BP = {
    shieldgenerator_reinforced: { shield: 0.40 }, shieldgenerator_thermic: { shield: 0.12 }, shieldgenerator_kinetic: { shield: 0.12 },
    shieldgenerator_optimised: { shield: 0.20 },
    shieldbooster_heavyduty: { boost: 0.60 }, shieldbooster_resistive: { boost: 0.15 }, shieldbooster_thermic: { boost: 0.12 },
    shieldbooster_kinetic: { boost: 0.12 }, shieldbooster_explosive: { boost: 0.12 },
    armour_heavyduty: { hullboost: 0.35 }, armour_advanced: { hullboost: 0.15 }, armour_kinetic: { hullboost: 0.12 },
    armour_thermic: { hullboost: 0.12 }, armour_explosive: { hullboost: 0.12 },
    hullreinforcement_heavyduty: { hrp: 0.60 }, hullreinforcement_advanced: { hrp: 0.25 }, hullreinforcement_thermic: { hrp: 0.15 },
    hullreinforcement_kinetic: { hrp: 0.15 }, hullreinforcement_explosive: { hrp: 0.15 },
    weapon_overcharged: { dps: 0.50 }, weapon_shortrange: { dps: 0.40 }, weapon_rapidfire: { dps: 0.25 }, weapon_efficient: { dps: 0.08 },
    weapon_highcapacity: { dps: 0.05 }, weapon_longrange: { dps: 0.0 }, weapon_focused: { dps: 0.0 }, weapon_sturdy: { dps: 0.0 }, weapon_lightweight: { dps: 0.0 },
    fsd_longrange: { optmass: 0.55 }, fsd_fastboot: {}, fsd_shielded: {},
    engine_dirty: { speed: 0.35 }, engine_tuned: { speed: 0.10 }, engine_reinforced: {},
    shieldcellbank_specialised: { scb: 0.30 }, shieldcellbank_rapid: { scb: 0.10 }
  };
  // Experimental effects → fixed ability text for the card (game effect is defined in the rules).
  const EXP = {
    thermal_shock: ['Thermal Shock', 'Hits add heat to the target.'],
    thermal_vent: ['Thermal Vent', 'Hits cool your own ship.'],
    corrosive_shell: ['Corrosive Shell', 'Target takes more hull damage this round.'],
    concordant_sequence: ['Concordant Sequence', 'Recharges a wing-mate\'s shield.'],
    regeneration_sequence: ['Regeneration Sequence', 'Recharges a friendly ship\'s shield.'],
    feedback_cascade_cooled: ['Feedback Cascade', 'Cancels an enemy shield cell bank.'],
    scramble_spectrum: ['Scramble Spectrum', 'Target\'s modules may malfunction.'],
    distortion_field: ['Distortion Field', 'Weakens the target\'s next attack.'],
    shieldbooster_chunky: ['Super Capacitors', '+Shield, slower recharge.'],
    shieldbooster_thermic: ['Thermo Block', 'Resists thermal damage.'],
    shieldbooster_fast: ['Fast Charge', 'Shields recharge faster.'],
    shield_fast: ['Fast Charge', 'Shields recharge faster.'],
    shield_resistive: ['Multi-weave', 'Resists all damage types a little.'],
    shield_thermic: ['Thermo Block', 'Resists thermal damage.'],
    powerplant_cooled: ['Thermal Spread', 'Runs cooler.'],
    powerplant_boosted: ['Monstered', 'Extra power.'],
    engine_overloaded: ['Drive Distributors', 'Faster.'], engine_haulage: ['Drag Drives', 'Agile while heavy.'],
    fsd_heavy: ['Mass Manager', 'Jumps a little further.'], fsd_fuelcapacity: ['Deep Charge', 'Jumps a little further.'],
    powerdistributor_fast: ['Super Conduits', 'Recharges systems faster.']
  };
  const EXPN = {}; for (const k in EXP) EXPN[k.replace(/^(weapon|shieldbooster|shield|armour|engine|fsd|powerplant|powerdistributor)_/, '').replace(/_/g, '')] = EXP[k];
  const FIGHTERS = {
    condor: { name: 'F63 Condor', maker: 'Federation', atk: 1.0, hull: 0.8, evade: 1.4 },
    gu97: { name: 'GU-97', maker: 'Empire', atk: 1.0, hull: 1.0, evade: 1.0, shield: 1.2 },
    taipan: { name: 'Taipan', maker: 'Faulcon DeLacy', atk: 1.15, hull: 1.2, evade: 0.8 },
    trident: { name: 'XG7 Trident', maker: 'Guardian', atk: 1.3, hull: 0.9, evade: 1.0 },
    javelin: { name: 'XG8 Javelin', maker: 'Guardian', atk: 1.1, hull: 0.9, evade: 1.1 },
    lance: { name: 'XG9 Lance', maker: 'Guardian', atk: 1.2, hull: 0.8, evade: 1.3 }
  };

  // ---------- helpers ----------
  const lc = s => String(s || '').toLowerCase();
  const sizeOf = item => +((/size(\d+)/.exec(item) || [])[1] || 0);
  function curve(mass, m) { // coriolis mass curve (shields, thrusters)
    const minM = m.minmass ?? m.genminmass, optM = m.optmass ?? m.genoptmass, maxM = m.maxmass ?? m.genmaxmass;
    const minMul = m.minmul, optMul = m.optmul, maxMul = m.maxmul;
    if (minM == null || maxMul == null) return 1;
    const xnorm = Math.min(1, (maxM - mass) / (maxM - minM));
    const exponent = Math.log((optMul - minMul) / (maxMul - minMul)) / Math.log(Math.min(1, (maxM - optM) / (maxM - minM)));
    const ynorm = Math.pow(Math.max(0, xnorm), exponent);
    return minMul + ynorm * (maxMul - minMul);
  }
  function progress(eng) { // 0..1 within grades 1..5
    if (!eng) return 0;
    const lvl = +eng.Level || 0, q = eng.Quality == null ? 1 : +eng.Quality;
    return Math.max(0, Math.min(1, ((lvl - 1) + q) / 5));
  }
  function bpEffect(eng, key) {
    if (!eng) return 0;
    let bp = lc(eng.BlueprintName);
    if (/^weapon_/.test(bp) || !BP[bp]) { const m = /_(overcharged|shortrange|rapidfire|efficient|highcapacity|longrange|focused|sturdy|lightweight)$/.exec(bp); if (m) bp = 'weapon_' + m[1]; }
    return ((BP[bp] || {})[key] || 0) * progress(eng);
  }
  function weaponDps(m) {
    if (!m.damage) return 0;
    if (!m.fireint) return m.damage; // beams: damage per second
    let rof = 1 / m.fireint;
    if (m.burst > 1 && m.burstrof) rof = m.burst / (m.fireint + (m.burst - 1) / m.burstrof);
    let dps = m.damage * rof;
    if (m.clip > 1 && m.reload) { const t = m.clip / rof; dps *= t / (t + m.reload); }
    else if (m.clip === 1 && m.reload) dps = m.damage / (m.fireint + m.reload);
    return dps;
  }

  // ---------- engine ----------
  function build(loadout, db) {
    const notes = [];
    const shipKey = lc(loadout.Ship);
    let hull, est = null;
    if (SHIP_FILE[shipKey] && db.ships[SHIP_FILE[shipKey]]) hull = db.ships[SHIP_FILE[shipKey]];
    else if (SHIP_ESTIMATE[shipKey]) { est = SHIP_ESTIMATE[shipKey]; hull = Object.assign({}, db.ships[est.from], { name: est.name, mfr: est.mfr }, est.hull || {}); notes.push('Base hull values are estimated (copied from ' + db.ships[est.from].name + ').'); }
    else { hull = { name: loadout.Ship, mfr: '?', hullMass: 100, speed: 250, boost: 350, shield: 100, armour: 100, bulkheads: [{ hullboost: 0.8, mass: 0 }] }; notes.push('Unknown ship type: base values are placeholders.'); }

    const mods = loadout.Modules || [];
    let mass = hull.hullMass, fuelCap = 0, cargo = 0, passengers = 0, dps = { T: 0, K: 0, E: 0, A: 0 }, mines = 0;
    let shieldGen = null, shieldGenEng = null, boosts = 0, shieldAdd = 0, scb = 0, hrp = 0, hullBoost = 0, armourEng = null;
    let fsd = null, fsdEng = null, jumpBoost = 0, thr = null, thrEng = null;
    const has = { scoop: 0, dss: 0, repair: 0, fuelLimpet: 0, collector: 0, prospector: 0, refinery: 0, mining: 0, interdictor: 0, decon: 0 };
    let fighterBays = 0, srvBays = 0, rhinoBays = 0;
    let engCount = 0, engScore = 0, engMax = 0, expCount = 0;
    const abilities = [], slots = [];

    for (const mod of mods) {
      const item = lc(mod.Item), eng = mod.Engineering || null;
      let m = db.modules[item];
      const size = sizeOf(item);
      if (!m) { // newer modules not in coriolis-data: fixed stand-ins
        if (/fighterbaymk2/.test(item)) { m = { grp: 'fh', mass: (db.modules['int_fighterbay_size' + size + '_class1'] || { mass: 20 }).mass / 2, bays: size >= 6 ? 2 : 1 }; }
        else if (/largecargorack/.test(item)) { m = { grp: 'cr', mass: 0, cargo: Math.pow(2, size) * 1.5 }; }
        else if (/mkii_passengercabin/.test(item)) { m = { grp: 'pci', mass: 0, passengers: [0, 1, 2, 3, 4, 6, 10, 16, 24][size] || 4 }; notes.push('Mk II cabin capacity estimated.'); }
        else if (/mkiilargebuggybay/.test(item)) { m = { grp: 'pvr', mass: 16, bays: 2 }; }
        else if (/_armour_grade(\d)/.test(item)) { const g = +/_armour_grade(\d)/.exec(item)[1]; const b = hull.bulkheads[Math.min(g, hull.bulkheads.length) - 1] || hull.bulkheads[0]; m = { grp: 'bh', mass: b.mass, hullboost: b.hullboost }; }
        else { m = { grp: '?', mass: 0 }; notes.push('Unknown module ' + item + ' counted as empty.'); }
      }
      mass += m.mass || 0;
      const g = m.grp;
      if (WEAPON_GROUPS.has(g)) { const d = weaponDps(m) * (1 + bpEffect(eng, 'dps')); const dist = m.damagedist || { K: 1 }; for (const k in dist) dps[k] = (dps[k] || 0) + d * dist[k]; if (g === 'nl') mines++; }
      else if (MINING_GROUPS.has(g) || /mining|abrblstr|subsurf|seismchrg/.test(item)) has.mining++;
      if (g === 'sg' || g === 'bsg' || g === 'psg') { shieldGen = m; shieldGenEng = eng; }
      if (g === 'sb') boosts += (m.shieldboost || 0) * (1 + bpEffect(eng, 'boost'));
      if (g === 'gsrp') shieldAdd += m.shieldaddition || 0;
      if (g === 'scb') scb += (m.shieldreinforcement || 0) * (1 + bpEffect(eng, 'scb'));
      if (g === 'hr' || g === 'ghrp' || g === 'mahr') hrp += (m.hullreinforcement || 0) * (1 + bpEffect(eng, 'hrp'));
      if (g === 'bh') { hullBoost = (m.hullboost || 0) + bpEffect(eng, 'hullboost'); armourEng = eng; }
      if (g === 'fsd') { fsd = m; fsdEng = eng; }
      if (g === 'gfsb') jumpBoost += m.jumpboost || 0;
      if (g === 't') { thr = m; thrEng = eng; }
      if (g === 'ft') fuelCap += m.fuel || Math.pow(2, size);
      if (g === 'cr' || g === 'crl') cargo += m.cargo || 0; // crl = large cargo rack (Panther Clipper Mk II, Anaconda Mk II)
      if (/^pc/.test(g)) passengers += m.passengers || 0;
      if (g === 'fs') has.scoop++;
      if (g === 'ss') has.dss++;
      if (g === 'rpl') has.repair++;
      if (g === 'fx') has.fuelLimpet++;
      if (g === 'cc') has.collector++;
      if (g === 'pc' && /prospector/.test(item)) has.prospector++;
      if (/prospector/.test(item)) has.prospector++;
      if (g === 'rf') has.refinery++;
      if (g === 'fi') has.interdictor++;
      if (g === 'fh') fighterBays += m.bays || 1;
      if (g === 'pv') srvBays += m.bays || 1;
      if (g === 'pvr') rhinoBays += m.bays || 2;
      if (/dronecontrol_decontamination/.test(item)) has.decon++;

      const engineerable = ENGINEERABLE.test(item) && !/guardian/.test(item);
      if (engineerable) { engMax += 5; if (eng) { engCount++; engScore += progress(eng) * 5; } }
      if (eng && eng.ExperimentalEffect) {
        expCount++;
        const key = lc(eng.ExperimentalEffect).replace(/^special_/, '');
        const a = EXP[key] || EXPN[key.replace(/^(weapon|shieldbooster|shield|armour|engine|fsd|powerplant|powerdistributor)_/, '').replace(/_/g, '')] || [key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), 'Special effect.'];
        if (!abilities.find(x => x[0] === a[0])) abilities.push(a);
      }
      slots.push({ slot: mod.Slot, item, grp: g, eng: eng ? { bp: eng.BlueprintName, grade: eng.Level, q: eng.Quality, exp: eng.ExperimentalEffect || null } : null, filled: !!mod.Filled });
    }
    // fuel in tank counts toward mass
    if (!fuelCap) fuelCap = 2;
    const unladen = mass + fuelCap;

    // shields
    let shield = 0;
    if (shieldGen) {
      const base = hull.shield * curve(unladen, shieldGen) * (1 + bpEffect(shieldGenEng, 'shield'));
      shield = base * (1 + boosts) + shieldAdd;
    }
    // hull
    const hullPts = hull.armour * (1 + hullBoost) + hrp;
    // jump
    let jump = 0;
    if (fsd) {
      const opt = fsd.optmass * (1 + bpEffect(fsdEng, 'optmass'));
      jump = opt / unladen * Math.pow((fsd.maxfuel || 1) / (fsd.fuelmul || 0.012), 1 / (fsd.fuelpower || 2.45)) + jumpBoost;
    }
    // speed
    const speed = thr ? hull.speed * curve(unladen, thr) * (1 + bpEffect(thrEng, 'speed')) : hull.speed;
    const totalDps = dps.T + dps.K + dps.E + dps.A;

    // roles (fixed rules)
    const roles = [];
    if (totalDps > 0) roles.push({ id: 'combat', level: totalDps });
    if (cargo >= 8) roles.push({ id: 'trader', level: cargo });
    if (passengers > 0) roles.push({ id: 'passenger', level: passengers });
    if (has.mining || has.refinery || has.prospector) roles.push({ id: 'miner', level: has.mining + has.refinery + has.prospector });
    if ((has.scoop && (has.dss || jumpBoost || jump >= 30)) || (jump >= 45 && (has.dss || jumpBoost))) roles.push({ id: 'explorer', level: jump });
    if (has.repair || has.fuelLimpet || has.decon || has.collector) roles.push({ id: 'support', level: has.repair + has.fuelLimpet + has.decon + has.collector });
    if (fighterBays) roles.push({ id: 'carrier', level: fighterBays });
    const main = roles.slice().sort((a, b) => roleWeight(b) - roleWeight(a))[0];

    // rarity: share of engineering potential used (grades + experimentals)
    const expMax = Math.max(1, engMax / 5);
    const score = engMax ? (engScore + expCount) / (engMax + expMax) : 0;
    const rarity = score >= 0.85 ? 'Legendary' : score >= 0.6 ? 'Epic' : score >= 0.35 ? 'Rare' : score >= 0.15 ? 'Uncommon' : 'Common';

    // points cost: fixed formula from the combat-relevant totals
    const cost = Math.max(1, Math.round(totalDps / 12 + (shield + hullPts) / 250 + cargo / 64 + passengers / 8 + jump / 20 + fighterBays * 2 + srvBays + rhinoBays));

    return {
      name: titleCase(loadout.ShipName || hull.name), ident: (loadout.ShipIdent || '').toUpperCase(), shipKey, type: hull.name, maker: hull.mfr,
      estimate: !!est, rarity, engScore: Math.round(score * 100), engineered: engCount, experimentals: expCount,
      stats: { dps: round1(totalDps), dpsSplit: { thermal: round1(dps.T), kinetic: round1(dps.K), explosive: round1(dps.E), absolute: round1(dps.A) }, shield: Math.round(shield), scb: Math.round(scb), hull: Math.round(hullPts), jump: round1(jump), speed: Math.round(speed), mass: Math.round(unladen), cargo, passengers, mines },
      bays: { fighter: fighterBays, srv: srvBays, rhino: rhinoBays },
      roles: roles.map(r => r.id), mainRole: main ? main.id : 'none', abilities, cost, slots, notes: [...new Set(notes)]
    };
  }
  function roleWeight(r) { return { combat: r.level / 5, trader: r.level / 40, passenger: r.level / 4, miner: r.level * 4, explorer: r.level / 8, support: r.level * 2, carrier: r.level * 3 }[r.id] || 0; }
  const round1 = x => Math.round(x * 10) / 10;
  const titleCase = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/^Efs\b|^E\.f\.s\./i, 'EFS');

  // Coriolis import link → loadout object
  async function fromCoriolisLink(url) {
    const m = /[?&]data=([^&\s]+)/.exec(url); if (!m) throw new Error('No data= part in the link.');
    const b64 = decodeURIComponent(m[1]);
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const ds = new DecompressionStream('gzip');
    const text = await new Response(new Blob([bin]).stream().pipeThrough(ds)).text();
    let j = JSON.parse(text); if (Array.isArray(j)) j = j[0];
    return j.data || j;
  }

  const api = { build, fromCoriolisLink, FIGHTERS, EXP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ShipCards = api;
})(typeof window !== 'undefined' ? window : globalThis);
