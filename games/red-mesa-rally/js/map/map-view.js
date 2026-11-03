'use strict';
/* Red Mesa Rally · Game: minimap, big map and fast travel */

Object.assign(Game.prototype, {
  toggleMap(on) {
    if (on === undefined) on = this.state !== 'map';
    if (on) { if (!['free', 'race'].includes(this.state)) return; this.prevState = this.state; this.state = 'map'; $('mapInfo').classList.remove('on'); this.mapSel = null; this.screen('mapScreen', true); const v = this.mapView; if (v) this.mapViewSet(v.z, mapX(this.player.pos.x), mapZ(this.player.pos.z)); this.drawBigMap(); $('btnTravel').hidden = !!this.race; $('btnWaypoint').hidden = !!this.race; }
    else if (this.state === 'map') { this.state = this.prevState; this.screen('mapScreen', false); this.last = performance.now(); }
  },
  travelTo(spot) {
    if (this.player.spec.boat) this.spawnPlayer(this.landVehicle);
    const ev = spot.ev, at = ev.at && { ...ev.at, yaw: ev.at.yaw !== undefined ? ev.at.yaw : Math.atan2(ev.at.x - spot.x, ev.at.z - spot.z) }; // no yaw given: face the beacon
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
    for (const T of this.world.trains) for (const c of T.cars) { const [x, y] = toL(c.pose.x, c.pose.z); ctx.fillStyle = '#e8c22a'; ctx.beginPath(); ctx.arc(x, y, 2.6 / zoom, 0, TAU); ctx.fill(); }
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
  /* big map view: zoom z (1 = whole county) around (cx, cy) in map pixels, kept inside the map */
  mapViewSet(z, cx, cy) {
    const v = this.mapView || (this.mapView = { z: 1, cx: MAP_W / 2, cy: MAP_H / 2 });
    v.z = clamp(z, 1, 8);
    const hw = MAP_W / 2 / v.z, hh = MAP_H / 2 / v.z;
    v.cx = clamp(cx, hw, MAP_W - hw); v.cy = clamp(cy, hh, MAP_H - hh);
    this.mapComp = null; // the cached picture is for the old view
  },
  /* zoom by factor f keeping the map point under canvas pixel (px, py) where it is */
  mapZoomAt(f, px, py) {
    const v = this.mapView, mx = v.cx + (px - MAP_W / 2) / v.z, my = v.cy + (py - MAP_H / 2) / v.z, z = clamp(v.z * f, 1, 8);
    this.mapViewSet(z, mx - (px - MAP_W / 2) / z, my - (py - MAP_H / 2) / z);
  },
  /* the ground and the lines for the current view, redrawn only when the view changes */
  mapComposite() {
    if (this.mapComp) return this.mapComp;
    const v = this.mapView, c = this.mapCompCanvas || (this.mapCompCanvas = Object.assign(document.createElement('canvas'), { width: MAP_W, height: MAP_H })), g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, MAP_W, MAP_H);
    if (v.z === 1) g.drawImage(this.mapImg, 0, 0);
    else {
      g.setTransform(v.z, 0, 0, v.z, MAP_W / 2 - v.cx * v.z, MAP_H / 2 - v.cy * v.z);
      g.imageSmoothingEnabled = true; g.drawImage(this.mapImg.base, 0, 0);
      drawMapVectors(g, this.world, Math.pow(v.z, -0.6)); // lines grow a little as you zoom in, not in proportion
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    return (this.mapComp = c);
  },
  drawBigMap() {
    const ctx = this.bigmap, P = this.player;
    if (!this.mapView) this.mapViewSet(1, MAP_W / 2, MAP_H / 2);
    const v = this.mapView, sx = (x) => (mapX(x) - v.cx) * v.z + MAP_W / 2, sy = (z) => (mapZ(z) - v.cy) * v.z + MAP_H / 2;
    ctx.drawImage(this.mapComposite(), 0, 0);
    ctx.font = '700 20px "Saira Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(18,12,9,.85)'; ctx.lineWidth = 4;
    const label = (t, x, z, col) => { ctx.fillStyle = col || '#f2e6d3'; ctx.strokeText(t, sx(x), sy(z)); ctx.fillText(t, sx(x), sy(z)); };
    const lz = (dz) => dz / Math.sqrt(v.z); // offsets of labels from what they name shrink in metres as the map zooms in
    for (const r of REGIONS) label(r.name.toUpperCase(), r.lx ?? r.x, r.lz ?? r.z - lz(160), '#f2e6d3');
    label('FESTIVAL PADDOCK', HUB.x, HUB.z - lz(70), '#ffb36b');
    ctx.save(); ctx.font = '700 15px "Saira Condensed", sans-serif';
    for (const d of DISTRICT.districts) { const [x, z, ang] = d.label; ctx.save(); ctx.translate(sx(x), sy(z)); ctx.rotate(ang * Math.PI / 180); ctx.fillStyle = '#f2e6d3'; ctx.strokeText(d.name, 0, 0); ctx.fillText(d.name, 0, 0); ctx.restore(); }
    ctx.restore();
    label('EXIT 5', 3330, -300, '#f2c230');
    const tun = this.world.route('tunnel'), tm = tun.posAt(tun.length * 0.62, {}); label(this.world.tunnelGateClosed ? 'CALDER TUNNEL · CLOSED' : 'CALDER TUNNEL', tm.x, tm.z - lz(50), this.world.tunnelGateClosed ? '#ff5a3a' : '#ffd23f');
    if (this.world.tunnelGateClosed) { const gp = this.world.tunnelGatePose(), x = sx(gp.x), y = sy(gp.z); ctx.save(); ctx.strokeStyle = '#ff3a2a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke(); ctx.restore(); }
    for (const T of this.world.trains) for (const c of T.cars) { ctx.fillStyle = '#e8c22a'; ctx.beginPath(); ctx.arc(sx(c.pose.x), sy(c.pose.z), 3.5, 0, TAU); ctx.fill(); }
    for (const c of this.world.cars) { if (c === P || c.civilian || c.hidden) continue; ctx.fillStyle = '#' + new THREE.Color(c.color).getHexString(); ctx.beginPath(); ctx.arc(sx(c.pos.x), sy(c.pos.z), c.remote ? 7 : 4.5, 0, TAU); ctx.fill(); if (c.remote) { ctx.strokeStyle = '#6fb7d9'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 4; label(c.name, c.pos.x, c.pos.z - lz(40), '#9fd6ef'); } }
    for (const D of BOAT_DOCKS) { const x = sx(D.water.x), y = sy(D.water.z); ctx.fillStyle = '#6fb7d9'; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill(); ctx.strokeStyle = '#120c09'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 4; label('BOAT LAUNCH', D.water.x, D.water.z + lz(70), '#9fd6ef'); }
    // the DOM pins and the player's marker follow the view; whatever is off the edge is hidden (the player's marker sticks to the edge)
    const put = (el, x, z, keep) => {
      const px = sx(x), py = sy(z), out = px < 0 || py < 0 || px > MAP_W || py > MAP_H;
      el.style.display = out && !keep ? 'none' : '';
      el.style.left = (clamp(px, 0, MAP_W) / MAP_W * 100) + '%'; el.style.top = (clamp(py, 0, MAP_H) / MAP_H * 100) + '%';
    };
    for (const s of this.eventSpots) if (s.pin) put(s.pin, s.x, s.z, false);
    const me = this.mapMe, f = P.forward(new THREE.Vector3());
    put(me, P.pos.x, P.pos.z, true);
    me.children[1].style.transform = `rotate(${Math.atan2(f.x, -f.z)}rad)`;
    const zl = $('mapZoomLevel'); if (zl) zl.textContent = v.z < 1.05 ? '1×' : v.z.toFixed(1).replace(/\.0$/, '') + '×';
  },
});
