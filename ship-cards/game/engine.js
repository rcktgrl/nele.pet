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
    anacondamkii: { from: 'anaconda', name: 'Anaconda Mk II', mfr: 'Faulcon DeLacy', hull: { hullMass: 865 } }, // hull mass fitted to Inara's 54.82 ly jump (with exact engineering rolls)
    mediumtransport01: { from: 'type_8_transport', name: 'Lynx Highliner', mfr: 'Saud Kruger' }
  };
  const WEAPON_GROUPS = new Set(['pl', 'ul', 'bl', 'mc', 'c', 'fc', 'pa', 'rg', 'mr', 'tp', 'nl', 'axmc', 'axmr', 'ggc', 'gpc', 'gsc', 'rfl', 'rsl', 'pas', 'tbsc', 'tbrfl', 'tbem']);
  const MINING_GROUPS = new Set(['ml', 'mvr', 'abl', 'scl', 'sdm', 'mr_mining']);
  const ENGINEERABLE = /^(hpt_(?!.*(cargoscanner_|cloudscanner_|crimescanner_)|.*guardian)|int_(cargorack|shieldgenerator|hullreinforcement|shieldcellbank|powerplant|engine|hyperdrive|lifesupport|powerdistributor|sensors|fsdinterdictor|dronecontrol|detailedsurfacescanner|fueltransfer|refinery)|.*_armour_)/;

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
    cargorack_increasedcapacity: { cargo: 0.344 }, // G5: 64 t → 86 t, 32 t → 43 t (Coriolis, confirmed by Sam)
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
  function curve(mass, m, type) { // coriolis mass curve (shields, thrusters)
    const minM = m.minmass ?? m.genminmass, optM = m.optmass ?? m.genoptmass, maxM = m.maxmass ?? m.genmaxmass;
    const t = type || '';
    const minMul = m['minmul' + t] ?? m.minmul, optMul = m['optmul' + t] ?? m.optmul, maxMul = m['maxmul' + t] ?? m.maxmul;
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
  let USE_REAL = false; // true when db.eng (coriolis blueprint tables) is loaded: exact rolls replace the BP estimates
  function applyEng(m, eng, E) { // Coriolis Module rules: blueprint roll, then experimental on top
    const out = Object.assign({}, m);
    if (m.damagedist) out.damagedist = Object.assign({}, m.damagedist);
    const bp = {};
    const g = E.bp[lc(eng.BlueprintName)];
    if (g && g[String(eng.Level)]) {
      const q = eng.Quality == null ? 1 : +eng.Quality;
      for (const [k, r] of Object.entries(g[String(eng.Level)])) bp[k] = r[0] + q * (r[1] - r[0]);
    }
    const sp = (eng.ExperimentalEffect && E.sp[lc(eng.ExperimentalEffect)]) || {};
    const keys = new Set([...Object.keys(bp), ...Object.keys(sp)]);
    for (const k of keys) {
      const v = bp[k] || 0, x = sp[k];
      if (k === 'damagedist' && typeof x === 'object') { out.damagedist = Object.assign({}, x); continue; }
      if (typeof x === 'object') continue;
      const meth0 = E.method[k] || 'multiplicative';
      // Coriolis modifierActions store resistances and additive values in percent, the rest as fractions
      const s2 = typeof x !== 'number' ? 0 : (/res$/.test(k) || meth0 === 'additive') ? x / 100 : x;
      if (/res$/.test(k)) { // resistances scale with what is left: r = base + (1-base)·bp, then + exp·(1-r)
        const base = out[k] || 0; let r = base + (1 - base) * v; if (s2) r = r + s2 * (1 - r); out[k] = r; continue;
      }
      const meth = E.method[k] || 'multiplicative';
      const mod = meth === 'multiplicative' ? (1 + v) * (1 + s2) - 1 : v + s2;
      if (k === 'shieldboost' || k === 'hullboost') { out[k] = (1 + (out[k] || 0)) * (1 + mod) - 1; out['_' + k + 'mod'] = mod; }
      else if (k === 'rof') { if (out.fireint) out.fireint *= (1 + mod); }
      else if (k === 'optmul') { for (const y of ['minmul', 'optmul', 'maxmul', 'minmulspeed', 'optmulspeed', 'maxmulspeed', 'minmulrotation', 'optmulrotation', 'maxmulrotation']) if (out[y] != null) out[y] *= (1 + mod); }
      else if (k === 'optmass') { for (const y of ['optmass', 'minmass', 'maxmass']) if (out[y] != null && !(y !== 'optmass' && keys.has(y))) out[y] *= (1 + mod); }
      else if (meth === 'overwrite') out[k] = v || s2;
      else if (meth === 'additive') out[k] = (out[k] || 0) + mod;
      else if (typeof out[k] === 'number') out[k] *= (1 + mod);
    }
    return out;
  }
  function bpEffect(eng, key) {
    if (!eng || USE_REAL) return 0;
    let bp = lc(eng.BlueprintName);
    if (/^weapon_/.test(bp) || !BP[bp]) { const m = /_(overcharged|shortrange|rapidfire|efficient|highcapacity|longrange|focused|sturdy|lightweight)$/.exec(bp); if (m) bp = 'weapon_' + m[1]; }
    return ((BP[bp] || {})[key] || 0) * progress(eng);
  }
  function weaponDps(m) { // same as Coriolis Module.getDps: damage × rounds per shot × rate of fire
    if (!m.damage) return 0;
    if (!m.fireint) return m.damage; // beams: damage per second
    const burst = m.burst || 1, burstRof = m.burstrof || 1;
    const rof = burst / ((burst - 1) / burstRof + m.fireint + (m.charge || 0));
    return m.damage * (m.roundspershot || 1) * rof;
  }


  // ---------- engine ----------
  function build(loadout, db) {
    USE_REAL = !!db.eng;
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
    const abilities = [], slots = [], parts = [];

    for (const mod of mods) {
      const item = lc(mod.Item), eng = mod.Engineering || null;
      let m = db.modules[item];
      const size = sizeOf(item);
      if (!m) { // newer modules not in coriolis-data: fixed stand-ins
        if (/fighterbaymk2/.test(item)) { m = { grp: 'fh', mass: (db.modules['int_fighterbay_size' + size + '_class1'] || { mass: 20 }).mass / 2, bays: size >= 6 ? 2 : 1 }; }
        else if (/largecargorack/.test(item)) { m = { grp: 'cr', mass: 0, cargo: Math.pow(2, size) * 1.5 }; }
        else if (/mkii_passengercabin/.test(item)) { // Mk II cabins (Lynx Highliner): values from Coriolis, sent by Sam 2026-11-03
          const cls = +((/class(\d)/.exec(item) || [])[1] || 1);
          const known = { '3_1': [6, 5], '4_1': [12, 10], '5_1': [24, 20], '6_2': [24, 40] }[size + '_' + cls];
          if (known) m = { grp: 'pci', passengers: known[0], mass: known[1] };
          else { m = { grp: 'pci', mass: 0, passengers: 6 * Math.pow(2, size - 3) }; notes.push('Mk II cabin size ' + size + ' class ' + cls + ' capacity is a guess.'); }
        }
        else if (/mkiilargebuggybay/.test(item)) { m = { grp: 'pvr', mass: 16, bays: 2 }; }
        else if (/_armour_grade(\d)/.test(item)) { const g = +/_armour_grade(\d)/.exec(item)[1]; const b = hull.bulkheads[Math.min(g, hull.bulkheads.length) - 1] || hull.bulkheads[0]; m = { grp: 'bh', mass: b.mass, hullboost: b.hullboost, kinres: b.kinres, thermres: b.thermres, explres: b.explres }; }
        else { m = { grp: '?', mass: 0 }; notes.push('Unknown module ' + item + ' counted as empty.'); }
      }
      if (eng && USE_REAL) m = applyEng(m, eng, db.eng);
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
      if (g === 'cr' || g === 'crl') cargo += Math.floor((m.cargo || 0) * (1 + bpEffect(eng, 'cargo')) + 1e-6); // crl = Mk II cargo rack ("largecargorack" in the journal); normal racks can take Expanded Capacity
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
      parts.push({ item, g, m, priority: mod.Priority == null ? 1 : +mod.Priority, weapon: WEAPON_GROUPS.has(g), exp: eng && eng.ExperimentalEffect ? lc(eng.ExperimentalEffect) : null, size });
      slots.push({ slot: mod.Slot, item, grp: g, eng: eng ? { bp: eng.BlueprintName, grade: eng.Level, q: eng.Quality, exp: eng.ExperimentalEffect || null } : null, filled: !!mod.Filled });
    }
    // fuel in tank counts toward mass
    if (!fuelCap) fuelCap = 2;
    const unladen = mass + fuelCap;

    // shields
    let shield = 0;
    if (shieldGen) {
      const base = hull.shield * curve(hull.hullMass, shieldGen) * (1 + bpEffect(shieldGenEng, 'shield'));
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
    const speed = thr ? hull.speed * curve(unladen, thr, 'speed') * (1 + bpEffect(thrEng, 'speed')) : hull.speed;
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
      combat: combatProfile(parts, hull, unladen, jump, { cargo, passengers, mining: has.mining > 0 && (has.refinery > 0 || cargo > 0), scanner: has.dss > 0 || roles.some(r => r.id === 'explorer') }),
      stats: { dps: round1(totalDps), dpsSplit: { thermal: round1(dps.T), kinetic: round1(dps.K), explosive: round1(dps.E), absolute: round1(dps.A) }, shield: Math.round(shield), scb: Math.round(scb), hull: Math.round(hullPts), jump: round1(jump), speed: Math.round(speed), mass: Math.round(unladen), cargo, passengers, mines },
      bays: { fighter: fighterBays, srv: srvBays, rhino: rhinoBays },
      roles: roles.map(r => r.id), mainRole: main ? main.id : 'none', abilities, cost, slots, notes: [...new Set(notes)]
    };
  }
  // ---------- combat profile (Coriolis Calculations.js: shieldMetrics, armourMetrics, _weaponSustainedDps) ----------
  const DR_SH = (genMult, combined) => { const max = genMult * 0.7; return combined < max ? (max / 2) + (max - max / 2) * (combined / max) : combined; };
  const DR_AR = (...mults) => { const max = Math.min(0.7, ...mults); const comb = mults.reduce((a, v) => a * v, 1); const d = 0.35 + (max - 0.35) * (comb / max); return d < 0.7 ? d : comb; };
  function combatProfile(parts, hull, mass, jump, extra) {
    extra = extra || {};
    // power: if modules need more than the power plant makes, switch off by priority (5 first), like the game
    const pp = parts.find(p => p.g === 'pp');
    const pgen = pp ? (pp.m.pgen || 0) : 0;
    let draw = parts.reduce((a, p) => a + (p.m.power || 0), 0);
    const off = new Set(); const powerNotes = [];
    for (let pr = 5; pr >= 2 && pgen && draw > pgen + 1e-6; pr--) {
      const grp = parts.filter(p => p.priority === pr && p.g !== 'pp');
      if (!grp.length) continue;
      grp.forEach(p => off.add(p)); draw -= grp.reduce((a, p) => a + (p.m.power || 0), 0);
      powerNotes.push('Priority ' + pr + ' modules power down (' + grp.length + ').');
    }
    const on = parts.filter(p => !off.has(p));
    // shields
    const sgp = on.find(p => p.g === 'sg' || p.g === 'bsg' || p.g === 'psg');
    let shield = null;
    if (sgp) {
      const sg = sgp.m;
      const gen = hull.shield * curve(hull.hullMass, sg);
      let boost = 0; const bDmg = { K: 1, T: 1, E: 1 };
      for (const p of on.filter(p => p.g === 'sb')) { boost += p.m.shieldboost || 0; bDmg.K *= 1 - (p.m.kinres || 0); bDmg.T *= 1 - (p.m.thermres || 0); bDmg.E *= 1 - (p.m.explres || 0); }
      const add = on.filter(p => p.g === 'gsrp').reduce((a, p) => a + (p.m.shieldaddition || 0), 0);
      const mult = { A: 1 };
      for (const [t, r] of [['K', 'kinres'], ['T', 'thermres'], ['E', 'explres']]) { const g = 1 - (sg[r] || 0); mult[t] = DR_SH(g, g * bDmg[t]); }
      shield = { max: gen * (1 + boost) + add, regen: sg.regen || 1, brokenregen: sg.brokenregen || 1, distdraw: sg.distdraw || 0.6, mult };
    }
    // armour
    const bh = on.find(p => p.g === 'bh');
    const hrps = on.filter(p => p.g === 'hr' || p.g === 'ghrp' || p.g === 'mahr');
    const bhm = bh ? bh.m : { hullboost: 0.8, kinres: 0, thermres: 0, explres: 0 };
    let armourTotal = hull.armour * (1 + bhm.hullboost);
    for (const p of hrps) armourTotal += (p.m.hullreinforcement || 0) + hull.armour * (p.m._hullboostmod || 0);
    const amult = { A: 1 };
    for (const [t, r] of [['K', 'kinres'], ['T', 'thermres'], ['E', 'explres']]) amult[t] = DR_AR(1 - (bhm[r] || 0), ...hrps.map(p => 1 - (p.m[r] || 0)));
    // weapons
    const weapons = on.filter(p => p.weapon && p.m.damage).map(p => {
      const m = p.m;
      const burst = m.burst || 1, burstRof = m.burstrof || 1;
      const rof = m.fireint ? burst / ((burst - 1) / burstRof + m.fireint + (m.charge || 0)) : 1;
      const dps = m.damage * (m.roundspershot || 1) * rof;
      let sf = 1;
      if (m.clip && m.reload && m.fireint) { const clip = Math.ceil(m.clip); const over = (burst - 1) / burstRof; const srof = clip / ((clip - burst) / rof + over + m.reload); sf = srof / rof; }
      const eps = (m.distdraw || 0) * rof * (m.clip && m.reload && m.fireint ? sf : 1);
      const mount = /_turret/.test(p.item) ? 'turret' : /_gimbal/.test(p.item) ? 'gimbal' : 'fixed';
      const guided = /basicmissilerack|advancedtorppylon|_seeker|atmissile/.test(p.item); // seekers and torpedoes track their target
      return { item: p.item, sdps: dps * sf, eps, dist: m.damagedist || { K: 1 }, falloff: m.falloff || null, range: m.range || 3000, piercing: m.piercing || 0,
        shotspeed: guided ? null : (m.shotspeed || null), mount, guided,
        heal: p.exp === 'special_regeneration_sequence' ? 'regen' : p.exp === 'special_concordant_sequence' ? 'concordant' : null };
    });
    const pd = (on.find(p => p.g === 'pd') || { m: {} }).m;
    const thr = (on.find(p => p.g === 't') || { m: null }).m;
    const pitchMax = thr ? (hull.pitch || 30) * curve(mass, thr, 'rotation') : (hull.pitch || 30);
    const speedMax = thr ? hull.speed * curve(mass, thr, 'speed') : hull.speed;
    return {
      hardness: hull.hardness || 50, size: hull.size || 2, shield, armour: { max: armourTotal, mult: amult }, weapons,
      pd: { wepcap: pd.wepcap || 10, weprate: pd.weprate || 1, syscap: pd.syscap || 10, sysrate: pd.sysrate || 1 },
      pitchMax, pipSpeed: hull.pipSpeed || 0.05, speedMax, minthrust: hull.minthrust || 50, jump,
      repair: on.filter(p => p.g === 'rpl').reduce((a, p) => a + (p.size || 1), 0),
      repairRange: Math.max(0, ...on.filter(p => p.g === 'rpl').map(p => (p.m.range || 0) * 1000)), // limpet range from data (km → m)
      scanner: !!extra.scanner,
      vp: { cargo: extra.cargo || 0, passengers: extra.passengers || 0, mining: !!extra.mining },
      power: { gen: Math.round(pgen * 100) / 100, draw: Math.round(draw * 100) / 100, notes: powerNotes }
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
