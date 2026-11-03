/* Battle rules for the ship card game (prototype).
   One round = 5 s of fighting between the two ships on the table, simulated in 0.5 s steps
   with Coriolis/Elite formulas: weapon falloff, damage types vs resistances, piercing vs hardness,
   WEP capacitor drain, shield regen limited by the SYS capacitor, broken shields (16 s + refill to 50 %).
   Pure logic: no DOM. Works in the browser (window.Battle) and in Node. */
(function (root) {
  'use strict';
  const ROUND = 5, DT = 0.5;
  const RANGES = { short: 500, medium: 1000, long: 1500 };
  const FSD_ROUNDS = 3;

  const sysResistance = sys => Math.pow(sys, 0.85) * 0.6 / Math.pow(4, 0.85);
  const sysRecharge = (pd, sys) => pd.sysrate * Math.pow(sys, 1.1) / Math.pow(4, 1.1);
  const wepRecharge = (pd, wep) => pd.weprate * Math.pow(wep / 4, 1.1);
  const pitchAt = (c, eng) => c.pitchMax * (1 - c.pipSpeed * (4 - eng));
  const speedAt = (c, eng) => c.speedMax * (eng / 4 + (c.minthrust / 100) * (1 - eng / 4));

  function validPips(p) { return Array.isArray(p) && p.length === 3 && p.every(x => Number.isInteger(x) && x >= 0 && x <= 4) && p[0] + p[1] + p[2] === 6; }
  const ALL_PIPS = []; for (let s = 0; s <= 4; s++) for (let e = 0; e <= 4; e++) { const w = 6 - s - e; if (w >= 0 && w <= 4) ALL_PIPS.push([s, e, w]); }

  function makeShip(card, owner) {
    const c = card.combat;
    return { id: owner + ':' + card.name, owner, card, c, shield: c.shield ? c.shield.max : 0, hull: c.armour.max,
      broken: !c.shield, brokenFor: 0, wepCap: c.pd.wepcap, sysCap: c.pd.syscap, status: 'ready', fsd: 0 };
  }
  function newGame(fleetA, fleetB) {
    return { ships: [...fleetA.map(c => makeShip(c, 'A')), ...fleetB.map(c => makeShip(c, 'B'))], round: 0, initiative: 'A',
      pair: null, range: 'medium', log: [], winner: null };
  }
  const alive = (g, owner) => g.ships.filter(s => s.owner === owner && s.status !== 'destroyed' && s.status !== 'jumped');

  // weapon damage per second at a range, split by type (before target resistances)
  function weaponOutput(c, metres) {
    const out = { A: 0, E: 0, K: 0, T: 0, perType: [] };
    for (const w of c.weapons) {
      let f = 1;
      if (w.falloff && metres > w.falloff) f = 1 - Math.min((metres - w.falloff) / Math.max(1, w.range - w.falloff), 1);
      else if (!w.falloff && metres > w.range) f = 0;
      const d = w.sdps * f;
      out.perType.push({ w, d });
      for (const t in w.dist) out[t] += d * w.dist[t];
    }
    return out;
  }

  // one 0.5 s step of `src` firing at `dst`; returns damage dealt {shield, hull}
  function fireStep(src, dst, srcPips, dstPips, metres) {
    const c = src.c;
    const eps = c.weapons.reduce((a, w) => a + w.eps, 0);
    if (!c.weapons.length) return { shield: 0, hull: 0 };
    const recharge = wepRecharge(c.pd, srcPips[2]);
    let frac = 1;
    if (eps > recharge) {
      if (src.wepCap <= 0) frac = recharge / eps;
      src.wepCap = Math.max(0, src.wepCap - (eps * frac - recharge) * DT);
    } else src.wepCap = Math.min(c.pd.wepcap, src.wepCap + (recharge - eps) * DT);
    const res = { shield: 0, hull: 0 };
    for (const { w, d } of weaponOutput(c, metres).perType) {
      const raw = d * frac * DT;
      if (!raw) continue;
      if (!dst.broken && dst.shield > 0) {
        let dmg = 0; const sysMul = 1 - sysResistance(dstPips[0]);
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
  // shield regeneration for one step (normal or broken), limited by the SYS capacitor
  function regenStep(s, sysPips) {
    const sh = s.c.shield; if (!sh) return;
    const rec = sysRecharge(s.c.pd, sysPips);
    let rate = 0;
    if (s.broken) { s.brokenFor += DT; if (s.brokenFor < 16) { s.sysCap = Math.min(s.c.pd.syscap, s.sysCap + rec * DT); return; } rate = sh.brokenregen; }
    else if (s.shield < sh.max) rate = sh.regen;
    else { s.sysCap = Math.min(s.c.pd.syscap, s.sysCap + rec * DT); return; }
    const need = rate * sh.distdraw;
    if (need > rec) { if (s.sysCap <= 0) rate = rec / sh.distdraw; s.sysCap = Math.max(0, s.sysCap - (rate * sh.distdraw - rec) * DT); }
    else s.sysCap = Math.min(s.c.pd.syscap, s.sysCap + (rec - need) * DT);
    s.shield = Math.min(sh.max, s.shield + rate * DT);
    if (s.broken && s.shield >= sh.max / 2) s.broken = false;
  }

  /* play a round.
     att = { shipId, range: 'short'|'medium'|'long', pips:[S,E,W], jump?:bool }
     def = { shipId, pips:[S,E,W], jump?:bool, newRange?: range chosen at round end (only if more manoeuvrable) } */
  function playRound(g, att, def) {
    const A = g.ships.find(s => s.id === att.shipId), D = g.ships.find(s => s.id === def.shipId);
    if (!A || !D || !validPips(att.pips) || !validPips(def.pips)) throw new Error('Invalid move');
    g.round++;
    const samePair = g.pair && g.pair[0] === A.id && g.pair[1] === D.id || g.pair && g.pair[0] === D.id && g.pair[1] === A.id;
    const mA = pitchAt(A.c, att.pips[1]), mD = pitchAt(D.c, def.pips[1]);
    const tieA = mA === mD ? speedAt(A.c, att.pips[1]) >= speedAt(D.c, def.pips[1]) : mA > mD;
    if (!samePair || tieA) g.range = att.range;      // a new pairing, or the attacker out-turns the defender: attacker sets range
    const metres = RANGES[g.range];
    if (att.jump && A.status !== 'charging') { A.status = 'charging'; A.fsd = FSD_ROUNDS; }
    if (def.jump && D.status !== 'charging') { D.status = 'charging'; D.fsd = FSD_ROUNDS; }
    const dealt = { A: { shield: 0, hull: 0 }, D: { shield: 0, hull: 0 } };
    for (let t = 0; t < ROUND - 1e-9; t += DT) {
      if (A.hull > 0 && D.hull > 0) {
        const a = fireStep(A, D, att.pips, def.pips, metres), d = fireStep(D, A, def.pips, att.pips, metres);
        dealt.A.shield += a.shield; dealt.A.hull += a.hull; dealt.D.shield += d.shield; dealt.D.hull += d.hull;
      }
      regenStep(A, att.pips[0]); regenStep(D, def.pips[0]);
    }
    // ships waiting in the hangar recover with balanced pips
    for (const s of g.ships) if (s !== A && s !== D && s.status === 'ready') { for (let t = 0; t < ROUND; t += DT) regenStep(s, 2); s.wepCap = s.c.pd.wepcap; }
    const ev = [];
    for (const s of [A, D]) {
      if (s.hull <= 0) { s.hull = 0; s.status = 'destroyed'; ev.push(s.card.name + ' is destroyed.'); }
      else if (s.status === 'charging') { s.fsd--; if (s.fsd <= 0) { s.status = 'jumped'; ev.push(s.card.name + ' jumps out.'); } else ev.push(s.card.name + ' FSD charging: ' + s.fsd + ' round' + (s.fsd > 1 ? 's' : '') + ' left.'); }
      if (s.broken && s.c.shield && s.hull > 0 && s.shield === 0) ev.push(s.card.name + ': shields down.');
    }
    // defender out-turns the attacker: may change the range at the end of the round
    let defenderMoved = false;
    if (!tieA && def.newRange && RANGES[def.newRange] && A.hull > 0 && D.hull > 0) { g.range = def.newRange; defenderMoved = true; }
    g.pair = [A.id, D.id];
    const entry = { round: g.round, attacker: { id: A.id, name: A.card.name, pips: att.pips, range: att.range }, defender: { id: D.id, name: D.card.name, pips: def.pips },
      range: metres, rangeBy: (!samePair || tieA) ? 'attacker' : 'kept', manoeuvre: { A: Math.round(mA * 10) / 10, D: Math.round(mD * 10) / 10 }, dealt, events: ev, defenderMoved, nextRange: g.range };
    g.log.push(entry);
    g.initiative = g.initiative === 'A' ? 'B' : 'A';
    const aliveA = alive(g, 'A').length, aliveB = alive(g, 'B').length;
    if (!aliveA || !aliveB) {
      const lostA = !g.ships.some(s => s.owner === 'A' && s.status !== 'destroyed');
      const lostB = !g.ships.some(s => s.owner === 'B' && s.status !== 'destroyed');
      g.winner = lostA && lostB ? 'draw' : lostA ? 'B' : lostB ? 'A' : (!aliveA ? 'B' : 'A');
      g.endReason = (lostA || lostB) ? 'destroyed' : 'jumped';
    }
    return entry;
  }

  // ---------- simple AI: tries every ship × pip split (× range when attacking) for one round and keeps the best trade ----------
  const clone = g => ({ ...g, ships: g.ships.map(s => ({ ...s })), log: [], pair: g.pair ? [...g.pair] : null });
  const hp = s => s.shield + s.hull;
  function score(g0, g1, me, foe) {
    const meS0 = g0.ships.find(s => s.id === me), meS1 = g1.ships.find(s => s.id === me);
    const foS0 = g0.ships.find(s => s.id === foe), foS1 = g1.ships.find(s => s.id === foe);
    const dealt = (hp(foS0) - hp(foS1)) / Math.max(1, foS0.c.armour.max + (foS0.c.shield ? foS0.c.shield.max : 0));
    const taken = (hp(meS0) - hp(meS1)) / Math.max(1, meS0.c.armour.max + (meS0.c.shield ? meS0.c.shield.max : 0));
    return dealt * 1.3 - taken + (foS1.status === 'destroyed' ? 1 : 0) - (meS1.status === 'destroyed' ? 1.2 : 0);
  }
  function aiDefend(g, owner, att) {
    const foe = att.shipId;
    const mine = alive(g, owner); const charging = mine.find(s => s.status === 'charging');
    let best = null;
    for (const s of charging ? [charging] : mine) for (const pips of ALL_PIPS) {
      const g1 = clone(g); playRound(g1, att, { shipId: s.id, pips });
      const sc = score(g, g1, s.id, foe);
      if (!best || sc > best.sc) best = { sc, move: { shipId: s.id, pips } };
    }
    const me = g.ships.find(s => s.id === best.move.shipId);
    if (me.hull < me.c.armour.max * 0.25 && me.status !== 'charging' && mine.length > 1) best.move.jump = true;
    // if it out-turns the attacker, pick the range where it out-damages them next round
    const foeShip = g.ships.find(s => s.id === foe);
    const out = r => weaponOutput(me.c, RANGES[r]); const inc = r => weaponOutput(foeShip.c, RANGES[r]);
    const tot = o => o.A + o.E + o.K + o.T;
    best.move.newRange = Object.keys(RANGES).sort((a, b) => (tot(out(b)) - tot(inc(b))) - (tot(out(a)) - tot(inc(a))))[0];
    return best.move;
  }
  function aiAttack(g, owner) {
    const foeOwner = owner === 'A' ? 'B' : 'A';
    const mine = alive(g, owner), foes = alive(g, foeOwner);
    const charging = mine.find(s => s.status === 'charging');
    let best = null;
    for (const s of charging ? [charging] : mine) for (const r of Object.keys(RANGES)) for (const pips of ALL_PIPS.filter((_, i) => i % 2 === 0 || pipsUseful(_))) {
      let worst = Infinity;
      for (const f of foes) { // assume the opponent answers with its strongest ship on balanced pips
        const g1 = clone(g); playRound(g1, { shipId: s.id, range: r, pips }, { shipId: f.id, pips: [2, 2, 2] });
        worst = Math.min(worst, score(g, g1, s.id, f.id));
      }
      if (!best || worst > best.sc) best = { sc: worst, move: { shipId: s.id, range: r, pips } };
    }
    return best.move;
  }
  const pipsUseful = p => p[2] >= 3 || p[0] >= 3;

  const api = { RANGES, ROUND, FSD_ROUNDS, ALL_PIPS, newGame, playRound, alive, validPips, pitchAt, speedAt, weaponOutput, aiAttack, aiDefend, sysResistance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Battle = api;
})(typeof window !== 'undefined' ? window : globalThis);
