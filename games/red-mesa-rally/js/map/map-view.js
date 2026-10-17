'use strict';
/* Red Mesa Rally · Game: minimap, big map and fast travel */

Object.assign(Game.prototype, {
  toggleMap(on) {
    if (on === undefined) on = this.state !== 'map';
    if (on) { if (!['free', 'race'].includes(this.state)) return; this.prevState = this.state; this.state = 'map'; $('mapInfo').classList.remove('on'); this.mapSel = null; this.screen('mapScreen', true); this.drawBigMap(); $('btnTravel').hidden = !!this.race; $('btnWaypoint').hidden = !!this.race; }
    else if (this.state === 'map') { this.state = this.prevState; this.screen('mapScreen', false); this.last = performance.now(); }
  },
  travelTo(spot) {
    if (this.player.spec.boat) this.spawnPlayer(this.landVehicle);
    const at = spot.ev.at;
    if (at) { this.player.reset(at.x + Math.sin(at.yaw) * 4, at.z + Math.cos(at.yaw) * 4, at.yaw, this.world.terrain, 0.5); this.rig.snap(); this.toast('Fast travel', spot.ev.name); return; }
    const R = this.world.route(spot.ev.route);
    const p = R.posAt(R.closed ? R.length - 60 : 0, {}); const dx = spot.x - p.x, dz = spot.z - p.z;
    const x = spot.x - dx * 0.4, z = spot.z - dz * 0.4;
    this.player.reset(x, z, Math.atan2(-(dx), -(dz)), this.world.terrain, 0.5); this.rig.snap();
    this.toast('Fast travel', spot.ev.name);
  },
  drawMinimap() {
    const ctx = this.mm, S = 344, P = this.player, scale = MAP_W / WORLD.Sx; // map px per metre
    const zoom = 1.5 / scale * 0.42; // canvas px per map px
    ctx.save(); ctx.clearRect(0, 0, S, S);
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, TAU); ctx.clip();
    ctx.fillStyle = '#2a1a12'; ctx.fillRect(0, 0, S, S);
    const dir = this.gfx.camera.getWorldDirection(new THREE.Vector3()), yaw = Math.atan2(dir.x, dir.z);
    ctx.translate(S / 2, S / 2); ctx.rotate(yaw + Math.PI); ctx.scale(zoom, zoom);
    const px = mapX(P.pos.x), pz = mapZ(P.pos.z);
    ctx.drawImage(this.mapImg, -px, -pz);
    const toL = (x, z) => [mapX(x) - px, mapZ(z) - pz];
    if (this.race) {
      const R = this.race.route; ctx.beginPath();
      for (let i = 0; i <= R.count; i += 3) { const [x, y] = toL(R.x[i], R.z[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      if (R.closed) ctx.closePath(); ctx.strokeStyle = '#ff6a1a'; ctx.lineWidth = 3 / zoom; ctx.stroke();
    }
    for (const s of this.eventSpots) { if (this.race || s.hidden) continue; const [x, y] = toL(s.x, s.z); const w = 7 / zoom; ctx.fillStyle = '#' + new THREE.Color(EVENT_COLORS[s.ev.id]).getHexString(); ctx.fillRect(x - w / 2, y - w / 2, w, w); ctx.strokeStyle = '#120c09'; ctx.lineWidth = 1.4 / zoom; ctx.strokeRect(x - w / 2, y - w / 2, w, w); }
    // the train
    for (const c of this.world.train.cars) { const [x, y] = toL(c.pose.x, c.pose.z); ctx.fillStyle = '#e8c22a'; ctx.beginPath(); ctx.arc(x, y, 2.6 / zoom, 0, TAU); ctx.fill(); }
    if (this.world.tunnelGateClosed) { const gp = this.world.tunnelGatePose(), [x, y] = toL(gp.x, gp.z), r = 5 / zoom; ctx.strokeStyle = '#ff3a2a'; ctx.lineWidth = 2.5 / zoom; ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); }
    for (const c of this.world.cars) {
      if (c === P || c.hidden) continue; const [x, y] = toL(c.pos.x, c.pos.z);
      if (c.civilian) { ctx.fillStyle = 'rgba(232,226,214,.7)'; ctx.beginPath(); ctx.arc(x, y, 2 / zoom, 0, TAU); ctx.fill(); continue; }
      ctx.fillStyle = '#' + new THREE.Color(c.color).getHexString(); ctx.beginPath(); ctx.arc(x, y, (c.remote ? 4.4 : 3.2) / zoom, 0, TAU); ctx.fill(); ctx.strokeStyle = c.remote ? '#6fb7d9' : '#120c09'; ctx.lineWidth = (c.remote ? 2 : 1) / zoom; ctx.stroke(); // other players get a blue ring
    }
    ctx.restore();
    ctx.save(); ctx.translate(S / 2, S / 2);
    const fwd = P.forward(new THREE.Vector3()); const carYaw = Math.atan2(fwd.x, fwd.z);
    ctx.rotate(-(carYaw - yaw));
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath();
    ctx.fillStyle = '#f2e6d3'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#120c09'; ctx.stroke();
    ctx.restore();
  },
  drawBigMap() {
    const ctx = this.bigmap, P = this.player;
    ctx.drawImage(this.mapImg, 0, 0, MAP_W, MAP_H);
    ctx.font = '700 20px "Saira Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(18,12,9,.85)'; ctx.lineWidth = 4;
    const label = (t, x, z, col) => { ctx.fillStyle = col || '#f2e6d3'; ctx.strokeText(t, mapX(x), mapZ(z)); ctx.fillText(t, mapX(x), mapZ(z)); };
    for (const r of REGIONS) label(r.name.toUpperCase(), r.lx ?? r.x, r.lz ?? r.z - 160, '#f2e6d3');
    label('FESTIVAL PADDOCK', HUB.x, HUB.z - 70, '#ffb36b');
    label('CALDER METRO', CX(6), CZ(5) + 20, '#7fd0de');
    label('EXIT 5', 3330, -300, '#f2c230');
    const tun = this.world.route('tunnel'), tm = tun.posAt(tun.length * 0.62, {}); label(this.world.tunnelGateClosed ? 'CALDER TUNNEL · CLOSED' : 'CALDER TUNNEL', tm.x, tm.z - 50, this.world.tunnelGateClosed ? '#ff5a3a' : '#ffd23f');
    if (this.world.tunnelGateClosed) { const gp = this.world.tunnelGatePose(), x = mapX(gp.x), y = mapZ(gp.z); ctx.save(); ctx.strokeStyle = '#ff3a2a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke(); ctx.restore(); }
    for (const c of this.world.train.cars) { ctx.fillStyle = '#e8c22a'; ctx.beginPath(); ctx.arc(mapX(c.pose.x), mapZ(c.pose.z), 3.5, 0, TAU); ctx.fill(); }
    for (const c of this.world.cars) { if (c === P || c.civilian || c.hidden) continue; ctx.fillStyle = '#' + new THREE.Color(c.color).getHexString(); ctx.beginPath(); ctx.arc(mapX(c.pos.x), mapZ(c.pos.z), c.remote ? 7 : 4.5, 0, TAU); ctx.fill(); if (c.remote) { ctx.strokeStyle = '#6fb7d9'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 4; label(c.name, c.pos.x, c.pos.z - 40, '#9fd6ef'); } }
    for (const D of BOAT_DOCKS) { const x = mapX(D.water.x), y = mapZ(D.water.z); ctx.fillStyle = '#6fb7d9'; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill(); ctx.strokeStyle = '#120c09'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 4; label('BOAT LAUNCH', D.water.x, D.water.z + 70, '#9fd6ef'); }
    ctx.save(); ctx.translate(mapX(P.pos.x), mapZ(P.pos.z));
    const f = P.forward(new THREE.Vector3()); ctx.rotate(Math.atan2(f.x, -f.z));
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(11, 12); ctx.lineTo(0, 6); ctx.lineTo(-11, 12); ctx.closePath(); ctx.fillStyle = '#ff6a1a'; ctx.fill(); ctx.strokeStyle = '#120c09'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  },
});
