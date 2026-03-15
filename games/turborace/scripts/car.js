import { THREE } from './three.js';
import { createCarVisual, getOpponentCarModels, getPlayerCarModel } from './car-model.js';
import { state } from './state.js';
import { fmtT } from './util.js';
import { announce } from './audio.js';
import { buildGearboxForCar, rpmFromSpeed } from './data/gearboxes.js';


function nearestPointOnSegment(px,pz,ax,az,bx,bz){
  const abx=bx-ax, abz=bz-az;
  const apx=px-ax, apz=pz-az;
  const ab2=abx*abx+abz*abz||1;
  const t=Math.max(0,Math.min(1,(apx*abx+apz*abz)/ab2));
  return {x:ax+abx*t,z:az+abz*t};
}

function nearestWallPoint(px,pz,walls){
  if(!walls||!walls.length) return null;
  let best=null;
  let bestD2=Infinity;
  for(const w of walls){
    const pt=nearestPointOnSegment(px,pz,w.x0,w.z0,w.x1,w.z1);
    const d2=(px-pt.x)*(px-pt.x)+(pz-pt.z)*(pz-pt.z);
    if(d2<bestD2){
      bestD2=d2;
      best=pt;
    }
  }
  return best;
}

class Car {
  constructor(data, pos, hdg, isPlayer, scene) {
    this.data = data; this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.hdg = hdg; this.spd = 0; this.gear = 1;
    this.gearbox = buildGearboxForCar(this.data);
    this.redlineRpm = this.gearbox.redlineRpm;
    this.shiftWarnRpm = Math.round(this.redlineRpm * 0.78);
    this.rpm = this.gearbox.idleRpm;
    this.lap = 0; this.lastCP = 0; this.cpPassed = 0;
    this.totalProg = 0; this.finished = false; this.finTime = 0; this.lapStart = 0;
    this.tl = []; this.wh = [];
    this.prevGear = 1; this.rpmDrop = 0; // for gear-shift RPM dip
    this.stuckTimer = 0;               // for boundary recovery
    this.isReversing = false; this.revSpd = 0; this.reverseTimer = 0;
    const visual = createCarVisual(this.data);
    this.mesh = visual.mesh; this.tl = visual.tailLights; this.wh = visual.wheels;
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.hdg;
    scene.add(this.mesh);
  }

  // ── Physics update ───────────────────────────────────
  update(inp, dt) {
    if (this.finished) return;
    const { thr, brk, str } = inp;

    // ── Reverse gear: hold brake while stopped (player only) ──
    if (this.isPlayer && this.spd < 0.3 && brk > 0.5 && thr < 0.1 && !this.isReversing) {
      this.reverseTimer = (this.reverseTimer || 0) + dt;
      if (this.reverseTimer > 0.3) this.isReversing = true;
    } else if (thr > 0.1) {
      this.isReversing = false; this.reverseTimer = 0;
    }
    if (this.isReversing && this.spd < 0.3 && brk < 0.1) this.isReversing = false;

    if (this.isReversing) {
      // Reverse: brake input drives backward, gear shows R
      this.gear = 0; // 0 = reverse
      const revCeil = Math.max(2800, Math.round(this.redlineRpm * 0.45));
      this.rpm = Math.max(this.gearbox.idleRpm, Math.min(revCeil, this.gearbox.idleRpm + this.revSpd * 260));
      const revAccel = brk * this.data.accel * 0.4;
      const revDrag = this.revSpd * this.revSpd * 0.01 + this.revSpd * 0.2;
      this.revSpd = Math.max(0, Math.min(8, this.revSpd + (revAccel - revDrag) * dt));
      if (thr > 0.1) { this.revSpd = Math.max(0, this.revSpd - this.data.brake * 0.5 * dt); }
      this.spd = 0;
      // Steer reversed
      const sf = Math.max(.5, 1 - this.revSpd / 8 * .4);
      if (this.revSpd > 0.3) this.hdg -= str * this.data.hdl * 1.8 * sf * dt;
      const fwd = new THREE.Vector3(Math.sin(this.hdg), 0, Math.cos(this.hdg));
      this.pos.addScaledVector(fwd, -this.revSpd * dt);
    } else {
      this.revSpd = 0;
      // Auto gearbox — ratio-linked RPM + adaptive redline
      const gb = this.gearbox;
      const nGears = gb.gearRatios.length;
      if (this.gear < 1) this.gear = 1;
      let gearRpm = rpmFromSpeed(this.spd, gb, this.gear);
      const canUpshift = this.gear < nGears && thr > 0.20;
      if (canUpshift && gearRpm >= gb.upshiftRpm) {
        this.gear = Math.min(nGears, this.gear + 1);
        gearRpm = rpmFromSpeed(this.spd, gb, this.gear);
      } else if (this.gear > 1 && gearRpm <= gb.downshiftRpm) {
        const downRpm = rpmFromSpeed(this.spd, gb, this.gear - 1);
        if (downRpm < gb.redlineRpm * 0.985) {
          this.gear = Math.max(1, this.gear - 1);
          gearRpm = downRpm;
        }
      }
      this.rpm = Math.max(gb.idleRpm, Math.min(gb.redlineRpm, gearRpm + (thr > .1 ? thr * 180 : 0)));
      // Forces — drag tuned per car so full throttle reaches exactly maxSpd
      const thrust = thr * this.data.accel;
      const rollCoeff = 0.08;
      const dragCoeff = (this.data.accel - this.data.maxSpd * rollCoeff) / (this.data.maxSpd * this.data.maxSpd);
      const drag = this.spd * this.spd * dragCoeff;
      const roll = this.spd * rollCoeff;
      const bForce = brk * this.data.brake;
      this.spd = Math.max(0, Math.min(this.data.maxSpd, this.spd + (thrust - drag - roll - bForce) * dt));
      // Steering
      const sf = Math.max(.28, 1 - this.spd / this.data.maxSpd * .60);
      if (this.spd > .5) this.hdg += str * this.data.hdl * 2.2 * sf * dt;
      // Move forward
      const fwd = new THREE.Vector3(Math.sin(this.hdg), 0, Math.cos(this.hdg));
      this.pos.addScaledVector(fwd, this.spd * dt);
    }

    this.pos.y = this.groundY();
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.hdg;
    // Wheel spin & steer
    const wr = (this.isReversing ? -this.revSpd : this.spd) * dt * 2.2;
    for (const w of this.wh) w.children[0].rotation.x += wr;
    if (this.wh[0]) this.wh[0].rotation.y = str * .40;
    if (this.wh[1]) this.wh[1].rotation.y = str * .40;
    // Brake lights (on during braking or reversing)
    const bOn = brk > .1 || this.isReversing;
    const bc = bOn ? 0xee1100 : 0x440500, be = bOn ? 0x881100 : 0x100100;
    for (const t of this.tl) { t.material.color.set(bc); t.material.emissive.set(be); }
    this.boundary(dt); this.progress();
  }

  groundY() {
    if (!state.trkPts || !state.trkPts.length) return this.data.gndOff;
    let md = Infinity, ny = 0;
    for (const p of state.trkPts) { const d = (this.pos.x - p.x) ** 2 + (this.pos.z - p.z) **2; if (d < md) { md = d; ny = p.y; } }
    return ny + this.data.gndOff;
  }

  boundary(dt) {
    if (!state.trkPts || !state.trkPts.length) return;

    // ── City tracks: use grid corridors ──
    if (state.cityCorridors && state.cityCorridors.length) {
      const px = this.pos.x, pz = this.pos.z;
      let inside = false;
      for (const c of state.cityCorridors) {
        if (px > c.x - c.hw && px < c.x + c.hw && pz > c.z - c.hd && pz < c.z + c.hd) { inside = true; break; }
      }
      if (!inside) {
        // Find nearest corridor edge and push back
        let bestDist = Infinity, bestPx = px, bestPz = pz;
        for (const c of state.cityCorridors) {
          const cx = Math.max(c.x - c.hw, Math.min(c.x + c.hw, px));
          const cz = Math.max(c.z - c.hd, Math.min(c.z + c.hd, pz));
          const d = (px - cx) ** 2 + (pz - cz) ** 2;
          if (d < bestDist) { bestDist = d; bestPx = cx; bestPz = cz; }
        }
        this.pos.x = bestPx; this.pos.z = bestPz;
        this.spd *= 0.4;
        if (this.isReversing) this.revSpd *= 0.3;
        this.stuckTimer += dt;
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - 0.04);
      }
      return;
    }

    // ── Spline-based boundary for normal tracks ──
    let md = Infinity, ni = 0;
    for (let i = 0; i < state.trkPts.length; i++) {
      const d = (this.pos.x - state.trkPts[i].x) ** 2 + (this.pos.z - state.trkPts[i].z) ** 2;
      if (d < md) { md = d; ni = i; }
    }
    const np = state.trkPts[ni];
    const nxt = state.trkPts[(ni + 1) % state.trkPts.length];
    const prv = state.trkPts[(ni + state.trkPts.length - 1) % state.trkPts.length];
    const tx = nxt.x - prv.x, tz = nxt.z - prv.z;
    const tLen = Math.hypot(tx, tz) || 1;
    const nx = -tz / tLen, nz = tx / tLen;
    const sideSign = ((this.pos.x - np.x) * nx + (this.pos.z - np.z) * nz) >= 0 ? 1 : -1;
    const targetWalls = sideSign > 0 ? state.trkWallRight : state.trkWallLeft;
    const wallPt = nearestWallPoint(this.pos.x, this.pos.z, targetWalls);

    if (wallPt) {
      const toWallX = wallPt.x - this.pos.x;
      const toWallZ = wallPt.z - this.pos.z;
      const wallDist = Math.hypot(toWallX, toWallZ);
      if (wallDist < 0.6) {
        const pushLen = wallDist || 1;
        const pushBack = 0.6 - wallDist;
        this.pos.x -= (toWallX / pushLen) * pushBack;
        this.pos.z -= (toWallZ / pushLen) * pushBack;
        this.spd *= 0.38;
        if (this.isReversing) this.revSpd *= 0.4;
        const trkHdg = Math.atan2(tx, tz);
        const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const targetHdg = this.isReversing ? trkHdg + Math.PI : trkHdg;
        const hdgErr = wrapPi(targetHdg - this.hdg);
        const maxCorrection = Math.PI / 16;
        const correction = Math.max(-maxCorrection, Math.min(maxCorrection, hdgErr * 0.8));
        this.hdg += correction;
        this.stuckTimer += dt;
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - 0.032);
      }
      return;
    }

    const dist = Math.sqrt(md), maxD = state.trkData.rw * .5 + 1.0;
    if (dist > maxD) {
      const px = np.x - this.pos.x, pz = np.z - this.pos.z, pl = Math.sqrt(px * px + pz * pz) || 1;
      this.pos.x += px / pl * (dist - maxD + 0.5);
      this.pos.z += pz / pl * (dist - maxD + 0.5);
      this.spd *= 0.45;
      const trkHdg = Math.atan2(tx, tz);
      const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const targetHdg = this.isReversing ? trkHdg + Math.PI : trkHdg;
      const hdgErr = wrapPi(targetHdg - this.hdg);
      const maxCorrection = Math.PI / 18;
      const correction = Math.max(-maxCorrection, Math.min(maxCorrection, hdgErr * 0.75));
      this.hdg += correction;
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - 0.032);
    }
  }

  progress() {
    if (!state.trkData) return;
    const wps = state.trkData.wp, n = wps.length, cr = 22;
    for (let i = 0; i < n; i++) {
      const w = wps[i];
      const d = Math.sqrt((this.pos.x - w[0]) ** 2 + (this.pos.z - w[2]) ** 2);
      if (d < cr && i !== this.lastCP) {
        const exp = (this.lastCP + 1 + n) % n;
        if (i === exp) {
          this.lastCP = i; this.cpPassed++;
          if (i === 0 && this.cpPassed >= n) {
            this.cpPassed = 0; this.lap++;
            const lt = state.raceTime - this.lapStart; this.lapStart = state.raceTime;
            if (this.isPlayer) {
              const startingFinal = this.lap === state.trkData.laps - 1;
              const fmt = fmtT || ((secs)=>secs.toFixed(2)+'s');
              if (typeof globalThis.notify === 'function') {
                globalThis.notify('LAP ' + this.lap + '/' + state.trkData.laps + (this.lap > 1 ? ' · ' + fmt(lt) : ''));
              }
              if (startingFinal) announce('Final lap! Push it to the limit!');
              else if (this.lap > 1) announce('Lap ' + (this.lap) + '. ' + fmt(lt));
            }
            if (this.lap >= state.trkData.laps) {
              this.finished = true;
              this.finTime = state.raceTime;
              if (this.isPlayer && typeof globalThis.endRace === 'function') globalThis.endRace();
            }
          }
        }
      }
    }
    const ni = (this.lastCP + 1 + n) % n, nw = state.trkData.wp[ni];
    const dd = Math.sqrt((this.pos.x - nw[0]) ** 2 + (this.pos.z - nw[2]) ** 2);
    this.totalProg = this.lap * n + this.cpPassed + Math.max(0, 1 - dd / 35);
  }
}

function buildRaceGrid(trackPoints){
  const n=trackPoints.length;
  if(!n)return Array(5).fill({pos:new THREE.Vector3(0,0,0),hdg:0});
  const grid=[];
  const rows=[1,1,2,2,3];
  const cols=[-1,1,-1,1,0];
  const rowStep=16;
  const sideOff=2.6;
  for(let slot=0;slot<5;slot++){
    const idx=((n - rows[slot]*rowStep) % n + n) % n;
    const pt=trackPoints[idx];
    const ptF=trackPoints[(idx+5)%n];
    const hdg=Math.atan2(ptF.x-pt.x, ptF.z-pt.z);
    const right=new THREE.Vector3(Math.cos(hdg),0,-Math.sin(hdg));
    const pos=pt.clone().addScaledVector(right,cols[slot]*sideOff);
    grid.push({pos,hdg});
  }
  return grid;
}

export function instantiateRaceCars({ trackPoints, cars, selectedCarIndex, scene, createAIController, aiCount=4 }){
  const grid=buildRaceGrid(trackPoints);
  const playerCar=new Car(getPlayerCarModel(cars, selectedCarIndex),grid[0].pos,grid[0].hdg,true,scene);

  const aiCars=[];
  const aiControllers=[];
  const count=Math.max(0,Math.min(4,Math.floor(aiCount)||0));
  const aiModels=getOpponentCarModels(cars, selectedCarIndex,count);
  for(let i=0;i<count;i++){
    const aiCar=new Car(aiModels[i],grid[i+1].pos,grid[i+1].hdg,false,scene);
    aiCar.aiAgg=.86+i*.04;
    aiCars.push(aiCar);
    aiControllers.push(createAIController(aiCar,i));
  }

  return { playerCar, aiCars, aiControllers, allCars:[playerCar,...aiCars] };
}

export { Car };
