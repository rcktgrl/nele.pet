/* Battle rules v2 for the ship card game (prototype).
   The table: each side has three rows, Front 500 m, Middle 1000 m, Back 1500 m. Two ships fight at the distance of
   whichever is further back. Players take turns: on your turn you deploy one ship, move ships one row, set pips,
   targets and special orders. Then every unit on the table fights for 5 s at the same time (0.5 s steps) with
   Coriolis/Elite formulas. Orders stay until their owner changes them.
   Victory: reach the VP target (trade, passengers, mining, scans, kills) or remove the whole enemy fleet.
   Numbers marked DESIGN are game rules, not Elite data. Pure logic: no DOM. Browser (window.Battle) and Node. */
(function (root) {
  'use strict';
  const ROUND = 3, DT = 0.5; // seconds per round (Sam: shorter rounds)
  const PER5 = ROUND / 5;    // per-round values below were set for 5 s rounds; scale them so the per-second rate stays the same
  const ROWS = { 1: 500, 2: 1000, 3: 1500, 4: 3500 }, ROW_NAME = { 1: 'Front', 2: 'Middle', 3: 'Back', 4: 'Standoff' };
  const STANDOFF = 4; // out of the fight: no enemy fire either way, but friendly beams and limpets can reach the Back row (Sam)
  const RANGES = { short: 500, medium: 1000, long: 1500 };
  const FSD_ROUNDS = 5;      // 15 s charge
  // DESIGN values
  const VP = { cargoPer: 200 / PER5, paxPer: 40 / PER5, mining: 2 * PER5, scan: 0.5 * PER5, killPerPoint: 1 };
  const SCAN_ROUNDS = 3, SCAN_HIT = 0.2;             // scanned targets are easier to hit
  const REPAIR_PER_CLASS = 15 * PER5;                       // hull per round per repair limpet controller class
  const REGEN_SEQ_HEAL = 1.0;                        // shield MJ restored per point of beam damage
  const CONCORDANT_REGEN = 2.0;                      // friendly shield regen multiplier while being hit
  const FIGHTER_RELAUNCH = 3;                        // rounds until a replacement fighter launches
  const HULL_SIZE = { 0: 15, 1: 40, 2: 70, 3: 130 }; // metres; 0 = fighter
  const MOUNT_TRACK = { fixed: 1, gimbal: 0.7, turret: 0.7 };

  const sysResistance = sys => Math.pow(sys, 0.85) * 0.6 / Math.pow(4, 0.85);
  const sysRecharge = (pd, sys) => pd.sysrate * Math.pow(sys, 1.1) / Math.pow(4, 1.1);
  const wepRecharge = (pd, wep) => pd.weprate * Math.pow(wep / 4, 1.1);
  const pitchAt = (c, eng) => c.pitchMax * (1 - c.pipSpeed * (4 - eng));
  const speedAt = (c, eng) => c.speedMax * (eng / 4 + (c.minthrust / 100) * (1 - eng / 4));
  function validPips(p) { return Array.isArray(p) && p.length === 3 && p.every(x => Number.isInteger(x) && x >= 0 && x <= 4) && p[0] + p[1] + p[2] === 6; }
  const ALL_PIPS = []; for (let s = 0; s <= 4; s++) for (let e = 0; e <= 4; e++) { const w = 6 - s - e; if (w >= 0 && w <= 4) ALL_PIPS.push([s, e, w]); }

  // ---------- fighters (DESIGN: Elite fighter stats are not in coriolis-data) ----------
  const FIGHTER_TYPES = {
    gu97: { name: 'GU-97', hull: 200, shield: 120, atk: 1.0, pitch: 110, speed: 480, dist: { K: 1 }, shotspeed: 1600 },
    condor: { name: 'F63 Condor', hull: 160, shield: 100, atk: 1.0, pitch: 130, speed: 520, dist: { K: 1 }, shotspeed: 1600 },
    taipan: { name: 'Taipan', hull: 240, shield: 120, atk: 1.15, pitch: 100, speed: 460, dist: { K: 1 }, shotspeed: 1600 },
    trident: { name: 'XG7 Trident', hull: 180, shield: 120, atk: 1.3, pitch: 110, speed: 480, dist: { A: 1 }, shotspeed: 1200 },
    javelin: { name: 'XG8 Javelin', hull: 180, shield: 120, atk: 1.1, pitch: 115, speed: 490, dist: { K: 1 }, shotspeed: 1100 },
    lance: { name: 'XG9 Lance', hull: 160, shield: 120, atk: 1.2, pitch: 125, speed: 510, dist: { T: 1 }, shotspeed: null }
  };
  let FIGHTER_DPS = 23; // set from data: one unengineered large gimballed multicannon (Sam's "size-3 weapon" rule)
  function fighterProfile(type) {
    const f = FIGHTER_TYPES[type] || FIGHTER_TYPES.gu97;
    return { hardness: 20, size: 0, shield: { max: f.shield, regen: 1, brokenregen: 2, distdraw: 0.4, mult: { K: 0.6, T: 1.2, E: 0.5, A: 1 } },
      armour: { max: f.hull, mult: { K: 1, T: 1, E: 1, A: 1 } }, pd: { wepcap: 20, weprate: 2, syscap: 10, sysrate: 1 },
      weapons: [{ item: 'fighter_' + type, sdps: FIGHTER_DPS * f.atk, eps: 0, dist: f.dist, falloff: 1000, range: 2000, piercing: 40, shotspeed: f.shotspeed, mount: 'gimbal' }],
      pitchMax: f.pitch, pipSpeed: 0, speedMax: f.speed, minthrust: 60, heal: {}, repair: 0, scanner: false, vp: {} };
  }

  // ---------- setup ----------
  let uid = 0;
  function makeUnit(card, owner, extra) {
    const c = card.combat;
    return Object.assign({ id: owner + ':' + (++uid), owner, card, c, kind: 'ship', status: 'reserve', row: 3,
      shield: c.shield ? c.shield.max : 0, hull: c.armour.max, broken: !c.shield, brokenFor: 0,
      wepCap: c.pd.wepcap, sysCap: c.pd.syscap, pips: [2, 2, 2], target: null, order: 'attack', fsd: 0,
      scannedBy: 0, fighters: null }, extra || {});
  }
  // fleet entries: card, or { card, fighter: 'gu97' } for carriers
  function newGame(fleetA, fleetB, opts) {
    uid = 0;
    const o = Object.assign({ vpTarget: 40 }, opts || {});
    if (o.fighterDps) FIGHTER_DPS = o.fighterDps;
    const g = { units: [], vp: { A: 0, B: 0 }, vpTarget: o.vpTarget, turn: 'A', round: 0, log: [], winner: null };
    for (const [owner, fl] of [['A', fleetA], ['B', fleetB]]) for (const e of fl) {
      const card = e.card || e; const u = makeUnit(card, owner);
      const bays = card.bays ? card.bays.fighter : 0;
      if (bays) u.fighters = { type: e.fighter || 'gu97', spare: bays, active: null, cooldown: 0 }; // one out at a time, the rest are replacements
      g.units.push(u);
    }
    return g;
  }
  const get = (g, id) => g.units.find(u => u.id === id);
  const onTable = u => u.status === 'deployed' || u.status === 'charging';
  const living = (g, owner) => g.units.filter(u => u.owner === owner && u.kind === 'ship' && u.status !== 'destroyed' && u.status !== 'jumped');
  const distance = (a, b) => (a.row === STANDOFF || b.row === STANDOFF) ? Infinity : ROWS[Math.max(a.row, b.row)]; // enemies
  const friendDistance = (a, b) => Math.max(500, Math.abs(ROWS[a.row] - ROWS[b.row]));

  // ---------- combat maths ----------
  function falloffFactor(w, metres) {
    if (w.falloff && metres > w.falloff) return 1 - Math.min((metres - w.falloff) / Math.max(1, w.range - w.falloff), 1);
    if (!w.falloff && metres > w.range) return 0;
    return 1;
  }
  const HITSCAN_TRACK = 15; // DESIGN: metres of 'aim error' per unit of target agility for instant weapons
  function hitChance(w, dst, metres) {
    if (w.guided) return 1;
    const c = dst.c, eng = dst.pips[1];
    const pitch = pitchAt(c, eng), agility = pitch / (pitch + 60);
    let drift = w.shotspeed
      ? speedAt(c, eng) * (metres / w.shotspeed) * agility * 0.5 * (MOUNT_TRACK[w.mount] || 1)   // projectiles: target moves while the shot flies
      : HITSCAN_TRACK * agility * (MOUNT_TRACK[w.mount] || 1);                                  // lasers/rails: keeping the aim on an agile target
    if (dst.scannedBy > 0) drift *= 1 - SCAN_HIT;
    const size = HULL_SIZE[c.size] ?? 70;
    return size / (size + drift);
  }
  function weaponDpsAt(c, metres) { return c.weapons.reduce((a, w) => a + w.sdps * falloffFactor(w, metres), 0); }

  // Fire all of src's weapons for one step. Hostile target: damage. Friendly target: only healing beams act.
  function fireStep(src, dst) {
    const c = src.c; if (!c.weapons.length || !dst) return { shield: 0, hull: 0, healed: 0 };
    const friendly = src.owner === dst.owner;
    const metres = friendly ? friendDistance(src, dst) : distance(src, dst);
    if (!isFinite(metres)) return { shield: 0, hull: 0, healed: 0 };
    const active = friendly ? c.weapons.filter(w => w.heal) : c.weapons;
    const eps = active.reduce((a, w) => a + w.eps, 0);
    const recharge = wepRecharge(c.pd, src.pips[2]);
    let frac = 1;
    if (eps > recharge) { if (src.wepCap <= 0) frac = recharge / eps; src.wepCap = Math.max(0, src.wepCap - (eps * frac - recharge) * DT); }
    else src.wepCap = Math.min(c.pd.wepcap, src.wepCap + (recharge - eps) * DT);
    const res = { shield: 0, hull: 0, healed: 0 };
    for (const w of active) {
      const raw = w.sdps * falloffFactor(w, metres) * frac * DT * (friendly ? 1 : hitChance(w, dst, metres));
      if (!raw) continue;
      if (friendly) {
        if (dst.broken || !dst.c.shield) continue;
        if (w.heal === 'regen') { const h = Math.min(raw * REGEN_SEQ_HEAL, dst.c.shield.max - dst.shield); dst.shield += h; res.healed += h; }
        if (w.heal === 'concordant') dst.concordant = true;
        continue;
      }
      if (!dst.broken && dst.shield > 0) {
        let dmg = 0; const sysMul = 1 - sysResistance(dst.pips[0]);
        for (const t in w.dist) dmg += raw * w.dist[t] * (dst.c.shield.mult[t] ?? 1) * sysMul;
        dst.shield -= dmg; res.shield += dmg;
        if (dst.shield <= 0) { dst.shield = 0; dst.broken = true; dst.brokenFor = 0; }
      } else {
        const hard = w.piercing >= dst.c.hardness ? 1 : w.piercing / dst.c.hardness;
        let dmg = 0; for (const t in w.dist) dmg += raw * w.dist[t] * (dst.c.armour.mult[t] ?? 1) * hard;
        dst.hull -= dmg; res.hull += dmg;
      }
    }
    return res;
  }
  function regenStep(u) {
    const sh = u.c.shield; if (!sh) return;
    const rec = sysRecharge(u.c.pd, u.pips[0]);
    let rate = 0;
    if (u.broken) { u.brokenFor += DT; if (u.brokenFor < 16) { u.sysCap = Math.min(u.c.pd.syscap, u.sysCap + rec * DT); return; } rate = sh.brokenregen; }
    else if (u.shield < sh.max) rate = sh.regen * (u.concordant ? CONCORDANT_REGEN : 1);
    else { u.sysCap = Math.min(u.c.pd.syscap, u.sysCap + rec * DT); return; }
    const need = rate * sh.distdraw;
    if (need > rec) { if (u.sysCap <= 0) rate = rec / sh.distdraw; u.sysCap = Math.max(0, u.sysCap - (rate * sh.distdraw - rec) * DT); }
    else u.sysCap = Math.min(u.c.pd.syscap, u.sysCap + (rec - need) * DT);
    u.shield = Math.min(sh.max, u.shield + rate * DT);
    if (u.broken && u.shield >= sh.max / 2) u.broken = false;
  }

  // ---------- orders ----------
  // orders = { deploy: { id, row } | null, units: { [id]: { row, pips, target, order: 'attack'|'heal'|'repair'|'scan', jump } } }
  function applyOrders(g, owner, orders) {
    const ev = [];
    if (orders.deploy) {
      const u = get(g, orders.deploy.id);
      if (u && u.owner === owner && u.status === 'reserve' && ROWS[orders.deploy.row]) { u.status = 'deployed'; u.row = orders.deploy.row; ev.push(`${name(u)} deploys to the ${ROW_NAME[u.row]} row.`); }
    }
    for (const [id, o] of Object.entries(orders.units || {})) {
      const u = get(g, id); if (!u || u.owner !== owner || !onTable(u)) continue;
      if (o.row && ROWS[o.row] && Math.abs(o.row - u.row) === 1 && u.status !== 'charging' && !(u.kind === 'fighter' && o.row === STANDOFF)) { u.row = o.row; ev.push(`${name(u)} moves to the ${ROW_NAME[u.row]} row.`); }
      if (o.pips && validPips(o.pips)) u.pips = o.pips.slice();
      if (o.order) u.order = o.order;
      if ('target' in o) u.target = o.target;
      if (o.retreat && u.kind === 'ship' && u.status === 'deployed') {
        if (u.row === STANDOFF) { u.retreating = true; ev.push(`${name(u)} disengages.`); }
        else ev.push(`${name(u)} can only disengage from the Standoff row.`);
      }
      if (o.jump && u.status === 'deployed' && u.kind === 'ship') { u.status = 'charging'; u.fsd = FSD_ROUNDS; ev.push(`${name(u)} starts charging its FSD.`); }
    }
    return ev;
  }
  const name = u => (u.kind === 'fighter' ? u.fname + ' (' + shortN(u.parentName) + ')' : shortN(u.card.name));
  const shortN = n => String(n).replace(/^EFS /, '');

  function validTarget(g, u) {
    const t = u.target && get(g, u.target);
    if (u.order === 'attack' && t && t.owner !== u.owner && onTable(t) && isFinite(distance(u, t))) return t;
    if (u.order === 'heal' && t && t.owner === u.owner && onTable(t) && t !== u) return t;
    if (u.order === 'repair' && t && t.owner === u.owner && onTable(t) && t !== u && friendDistance(u, t) <= (u.c.repairRange || 0)) return t;
    if (u.order === 'scan' && t && t.owner !== u.owner && onTable(t) && isFinite(distance(u, t))) return t;
    if (u.order !== 'attack' || u.row === STANDOFF) return null;
    // retarget: nearest enemy in reach, then weakest
    const foes = g.units.filter(x => x.owner !== u.owner && onTable(x) && isFinite(distance(u, x)));
    if (!foes.length) return null;
    foes.sort((a, b) => distance(u, a) - distance(u, b) || (a.shield + a.hull) - (b.shield + b.hull));
    u.target = foes[0].id; return foes[0];
  }

  // ---------- round ----------
  function endTurn(g, owner, orders) {
    if (g.winner) throw new Error('Game over');
    if (owner !== g.turn) throw new Error('Not your turn');
    g.round++;
    const ev = applyOrders(g, owner, orders || {});
    // fighters launch from deployed carriers
    for (const u of g.units.filter(x => x.fighters && onTable(x))) {
      const f = u.fighters;
      if (f.active && !onTable(get(g, f.active))) f.active = null;
      if (!f.active && f.cooldown > 0) f.cooldown--;
      else if (!f.active && f.spare > 0) {
        const fi = makeUnit({ name: FIGHTER_TYPES[f.type].name, type: 'Fighter', combat: fighterProfile(f.type) }, u.owner,
          { kind: 'fighter', status: 'deployed', row: Math.max(1, u.row - 1), fname: FIGHTER_TYPES[f.type].name, parent: u.id, parentName: u.card.name, target: u.target, pips: [2, 2, 2] });
        g.units.push(fi); f.active = fi.id; f.spare--; ev.push(`${shortN(u.card.name)} launches a ${fi.fname}.`);
      }
    }
    const table = g.units.filter(onTable);
    const stats = new Map(table.map(u => [u.id, { dealt: 0, healed: 0, taken: 0 }]));
    // scans and repairs act once per round
    for (const u of table) {
      const t = validTarget(g, u);
      if (u.order === 'scan' && t && u.c.scanner) { t.scannedBy = SCAN_ROUNDS; g.vp[u.owner] += VP.scan; ev.push(`${name(u)} scans ${name(t)}.`); }
      if (u.order === 'repair' && t && u.c.repair) { const h = Math.min(u.c.repair * REPAIR_PER_CLASS, t.c.armour.max - t.hull); t.hull += h; stats.get(u.id).healed += h; if (h) ev.push(`${name(u)} repairs ${Math.round(h)} hull on ${name(t)}.`); }
    }
    for (let t = 0; t < ROUND - 1e-9; t += DT) {
      for (const u of table) u.concordant = false;
      for (const u of table) {
        if (u.hull <= 0 || u.status === 'jumped') continue;
        if (u.order === 'hold') { u.wepCap = Math.min(u.c.pd.wepcap, u.wepCap + wepRecharge(u.c.pd, u.pips[2]) * DT); continue; } // weapons cold: capacitor refills
        const tg = validTarget(g, u);
        if (!tg || tg.hull <= 0 || u.order === 'scan' || u.order === 'repair') { u.wepCap = Math.min(u.c.pd.wepcap, u.wepCap + wepRecharge(u.c.pd, u.pips[2]) * DT); continue; }
        if (u.order === 'attack' || u.order === 'heal') {
          const r = fireStep(u, tg);
          stats.get(u.id).dealt += r.shield + r.hull; stats.get(u.id).healed += r.healed;
          if (stats.has(tg.id)) stats.get(tg.id).taken += r.shield + r.hull;
        }
      }
      for (const u of table) if (u.hull > 0) regenStep(u);
    }
    // reserve ships recover
    for (const u of g.units.filter(x => x.status === 'reserve')) { u.pips = [2, 2, 2]; for (let t = 0; t < ROUND; t += DT) regenStep(u); u.wepCap = u.c.pd.wepcap; }
    // outcomes
    for (const u of table) {
      if (u.hull <= 0) {
        u.hull = 0; u.status = 'destroyed'; ev.push(`${name(u)} is destroyed.`);
        if (u.kind === 'ship') { const foe = u.owner === 'A' ? 'B' : 'A'; g.vp[foe] += u.card.cost * VP.killPerPoint; }
        if (u.kind === 'fighter') { const p = get(g, u.parent); if (p && p.fighters) { p.fighters.active = null; p.fighters.cooldown = FIGHTER_RELAUNCH; } }
        if (u.fighters && u.fighters.active) { const f = get(g, u.fighters.active); if (f && onTable(f)) { f.status = 'destroyed'; ev.push(`${name(f)} is lost with its carrier.`); } }
      } else if (u.retreating) {
        u.retreating = false; u.status = 'reserve'; u.row = 3; ev.push(`${name(u)} returns to the reserve.`);
        if (u.fighters && u.fighters.active) { const f = get(g, u.fighters.active); if (f && onTable(f)) { f.status = 'jumped'; u.fighters.spare++; u.fighters.active = null; ev.push(`${name(f)} docks with its carrier.`); } }
      } else if (u.status === 'charging') {
        u.fsd--; if (u.fsd <= 0) { u.status = 'jumped'; ev.push(`${name(u)} jumps out.`);
          if (u.fighters && u.fighters.active) { const f = get(g, u.fighters.active); if (f) f.status = 'jumped'; } }
      }
      if (u.scannedBy > 0) u.scannedBy--;
    }
    // victory points from roles (ships on the table that survived the round)
    const vpEarned = { A: 0, B: 0 };
    for (const u of g.units.filter(x => x.kind === 'ship' && onTable(x))) {
      const v = u.c.vp; let p = 0;
      if (v.cargo) p += v.cargo / VP.cargoPer;
      if (v.passengers) p += v.passengers / VP.paxPer;
      if (v.mining) p += VP.mining;
      vpEarned[u.owner] += p;
    }
    g.vp.A += vpEarned.A; g.vp.B += vpEarned.B;
    const entry = { round: g.round, by: owner, events: ev, vp: { ...g.vp }, vpEarned,
      fights: table.map(u => ({ id: u.id, name: name(u), owner: u.owner, ...stats.get(u.id) })) };
    g.log.push(entry);
    // victory
    const out = o => !living(g, o).length;
    const reach = o => g.vp[o] >= g.vpTarget;
    if (out('A') || out('B') || reach('A') || reach('B')) {
      if (reach('A') && reach('B')) g.winner = g.vp.A === g.vp.B ? 'draw' : g.vp.A > g.vp.B ? 'A' : 'B';
      else if (reach('A') || out('B')) g.winner = out('A') && out('B') ? 'draw' : 'A';
      else g.winner = 'B';
      g.endReason = reach(g.winner) ? 'points' : 'fleet';
    }
    g.turn = owner === 'A' ? 'B' : 'A';
    return entry;
  }

  // ---------- AI (heuristic) ----------
  function bestRow(c) { let best = 2, v = -1; for (const r of [1, 2, 3]) { const d = weaponDpsAt(c, ROWS[r]); if (d > v + 1e-6) { v = d; best = r; } } return best; }
  function aiOrders(g, owner) {
    const orders = { deploy: null, units: {} };
    const mine = g.units.filter(u => u.owner === owner);
    const reserve = mine.filter(u => u.status === 'reserve' && u.kind === 'ship');
    const foes = g.units.filter(u => u.owner !== owner && onTable(u));
    if (reserve.length) {
      const pickU = reserve.sort((a, b) => (b.c.weapons.length ? 1 : 0) - (a.c.weapons.length ? 1 : 0) || b.card.cost - a.card.cost)[0];
      const combat = pickU.c.weapons.length && pickU.card.mainRole === 'combat';
      orders.deploy = { id: pickU.id, row: combat ? bestRow(pickU.c) : 3 };
    }
    for (const u of mine.filter(onTable)) {
      const o = {};
      const isCombat = u.c.weapons.length && (u.kind === 'fighter' || u.card.mainRole === 'combat');
      if (u.kind === 'ship' && u.status === 'deployed' && u.hull < u.c.armour.max * 0.35 && living(g, owner).length > 1) {
        if (u.row === STANDOFF) { o.retreat = true; o.order = 'hold'; orders.units[u.id] = o; continue; }
        o.row = u.row + 1; o.pips = [4, 2, 0]; orders.units[u.id] = o; continue;
      }
      if (isCombat) {
        const want = bestRow(u.c); if (want !== u.row) o.row = u.row + Math.sign(want - u.row);
        o.pips = u.broken && u.c.shield ? [4, 1, 1] : [2, 1, 3];
        o.order = 'attack';
        if (foes.length) { // prefer VP earners and weak ships in reach
          const score = f => (f.kind === 'fighter' ? 0.4 : 1) * (f.c.vp.cargo || f.c.vp.passengers || f.c.vp.mining ? 2 : 1) * weaponDpsAt(u.c, distance(u, f)) / Math.max(50, f.shield + f.hull);
          o.target = foes.slice().sort((a, b) => score(b) - score(a))[0].id;
        }
      } else {
        o.pips = [4, 2, 0];
        if (u.row < 3 && u.kind === 'ship') o.row = u.row + 1;
        const hurt = mine.filter(x => onTable(x) && x !== u && x.kind === 'ship').sort((a, b) => a.hull / a.c.armour.max - b.hull / b.c.armour.max)[0];
        if (u.c.repair && hurt && hurt.hull < hurt.c.armour.max) { o.order = 'repair'; o.target = hurt.id; }
        else if (u.c.scanner && foes.length) { o.order = 'scan'; o.target = foes.sort((a, b) => b.c.weapons.length - a.c.weapons.length)[0].id; }
        else o.order = 'attack';
      }
      const healer = u.c.weapons.some(w => w.heal);
      const lowShield = mine.filter(x => onTable(x) && x !== u && x.c.shield && !x.broken && x.shield < x.c.shield.max * 0.5)[0];
      if (healer && lowShield && !foes.some(f => distance(u, f) <= 1000)) { o.order = 'heal'; o.target = lowShield.id; }
      orders.units[u.id] = o;
    }
    return orders;
  }

  function stateHash(g) { // compact fingerprint so both players can check they computed the same round
    let h = 2166136261; const add = v => { const str = String(v); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    for (const u of g.units) { add(u.id); add(u.status); add(u.row); add(Math.round(u.shield * 10)); add(Math.round(u.hull * 10)); }
    add(Math.round(g.vp.A * 100)); add(Math.round(g.vp.B * 100)); add(g.round); return h.toString(16);
  }
  const api = { stateHash, STANDOFF, friendDistance, ROWS, ROW_NAME, RANGES, ROUND, FSD_ROUNDS, VP, FIGHTER_TYPES, ALL_PIPS, newGame, endTurn, aiOrders, living, onTable, distance, validPips,
    pitchAt, speedAt, hitChance, weaponDpsAt, sysResistance, get, name, setFighterDps: d => { FIGHTER_DPS = d; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Battle = api;
})(typeof window !== 'undefined' ? window : globalThis);
