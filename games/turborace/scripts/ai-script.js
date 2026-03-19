import { state } from './state.js';

// Difficulty presets — only aggMult varies; braking/cornering physics are the same for all.
// Speed should not be artificially limited by difficulty — the AI drives at full pace and
// difficulty is expressed through how aggressively it accelerates and overtakes.
const DIFF = {
  easy:   { aggMult: 0.72 },
  medium: { aggMult: 1.00 },
  hard:   { aggMult: 1.15 },
};

export class AI {
  constructor(car,la,context){
    this.car=car;
    this.la=la||.055;
    this.slowTimer=0;
    this.prevPos=null;
    this.stuckCount=0;
    this.context=context;
  }

  update(dt){
    const { trackPoints, trackCurvature, cityAiPoints, cityCorridors, trackData, playerCar }=this.context();
    if(!trackPoints.length||this.car.finished)return;
    const c=this.car;

    if(!this.prevPos) this.prevPos={x:c.pos.x,z:c.pos.z};
    const moved=Math.sqrt((c.pos.x-this.prevPos.x)**2+(c.pos.z-this.prevPos.z)**2);
    this.prevPos.x=c.pos.x; this.prevPos.z=c.pos.z;
    if(moved<0.015*dt*60) this.slowTimer+=dt;
    else { this.slowTimer=Math.max(0,this.slowTimer-dt*3); this.stuckCount=0; }

    if(c.stuckTimer>1.5 || this.slowTimer>2.5){
      c.stuckTimer=0; this.slowTimer=0; this.stuckCount++;
      const navP=cityAiPoints?cityAiPoints.pts:trackPoints;
      let md2=Infinity,ri2=0;
      for(let i=0;i<navP.length;i++){const d=(c.pos.x-navP[i].x)**2+(c.pos.z-navP[i].z)**2;if(d<md2){md2=d;ri2=i;}}
      const ahead=5+this.stuckCount*5;
      const tp=navP[(ri2+ahead)%navP.length];
      const nxt=navP[(ri2+ahead+3)%navP.length];
      c.pos.x=tp.x; c.pos.z=tp.z;
      c.hdg=Math.atan2(nxt.x-tp.x,nxt.z-tp.z);
      c.spd=3; c.isReversing=false; c.revSpd=0;
      return;
    }

    const useCity=!!cityAiPoints;
    const navPts=useCity?cityAiPoints.pts:trackPoints;
    const navCurv=useCity?cityAiPoints.curv:trackCurvature;
    let md=Infinity,ci=0;
    for(let i=0;i<navPts.length;i++){const d=(c.pos.x-navPts[i].x)**2+(c.pos.z-navPts[i].z)**2;if(d<md){md=d;ci=i;}}
    const n=navPts.length;

    const speedFrac=c.spd/c.data.maxSpd;
    let ti;
    if(useCity){
      const look=Math.round(4+speedFrac*12);
      ti=(ci+look)%n;
    } else {
      // Stable fixed look-ahead proportional to speed — avoids oscillating target that caused
      // left/right steering wobble when the curvature-break target jumped around
      const look=Math.round(6+speedFrac*22);
      ti=(ci+look)%n;
    }

    let tgtX=navPts[ti].x, tgtZ=navPts[ti].z;

    if(cityCorridors&&cityCorridors.length){
      const px=c.pos.x,pz=c.pos.z;
      for(const cr of cityCorridors){
        if(px>cr.x-cr.hw&&px<cr.x+cr.hw&&pz>cr.z-cr.hd&&pz<cr.z+cr.hd){
          const dL=px-(cr.x-cr.hw), dR=(cr.x+cr.hw)-px;
          const dB=pz-(cr.z-cr.hd), dT=(cr.z+cr.hd)-pz;
          const wallMin=Math.min(dL,dR,dB,dT);
          const margin=4.0;
          if(wallMin<margin){
            // Increased wall blend: was *0.5, now *0.8 for stronger avoidance
            const blend=Math.pow(1-wallMin/margin,2)*0.8;
            tgtX=tgtX*(1-blend)+cr.x*blend;
            tgtZ=tgtZ*(1-blend)+cr.z*blend;
          }
          break;
        }
      }
    }

    const dx=tgtX-c.pos.x,dz=tgtZ-c.pos.z;
    const dh=Math.atan2(dx,dz);
    let he=((dh-c.hdg+Math.PI*3)%(Math.PI*2))-Math.PI;
    let str=Math.max(-1,Math.min(1,he*1.8));
    const ts=Math.abs(he);

    const diff=DIFF[state.aiDifficulty]||DIFF.medium;
    // Scan every corner ahead and take the worst required braking across all of them.
    // Fixes high-speed crashes: previously only the single worst-curvature point was used,
    // meaning a close tight corner could be ignored if a gentler curve was farther away.
    const ptSpacing=2;
    const scanDist=Math.round(16+speedFrac*90);
    let reqBrake=0;
    for(let k=1;k<scanDist;k++){
      const ki=(ci+k)%n;
      const curv=navCurv[ki];
      if(curv<0.03)continue; // lower threshold so gentle chicane turns aren't skipped
      const cornerSpd=c.data.maxSpd*c.data.hdl*(0.18+0.77*(1-curv));
      // Shrink effective distance so AI treats the corner as closer → brakes earlier
      const dist=k*ptSpacing*0.42;
      const speedOver=c.spd-cornerSpd;
      if(speedOver>0&&dist>0){
        const decel=(c.spd*c.spd-cornerSpd*cornerSpd)/(2*dist);
        const brake=Math.min(1,decel/c.data.brake*1.25);
        if(brake>reqBrake)reqBrake=brake;
      }
    }

    // Throttle/brake driven purely by corner speed — not by heading error.
    // Steering-based penalties were the root cause of slowing to a crawl and stopping.
    let thr=1.0;
    let brk=reqBrake;
    if(brk>0.05) thr=Math.min(thr,1-brk);

    if(!cityCorridors&&trackData){
      const edgeDist=Math.sqrt(md);
      const wallDist=trackData.rw*0.5;
      if(edgeDist>wallDist*0.5){
        const np=trackPoints[ci];
        const pullAngle=Math.atan2(np.x-c.pos.x,np.z-c.pos.z);
        let pullErr=((pullAngle-c.hdg+Math.PI*3)%(Math.PI*2))-Math.PI;
        // Double the pull strength when on gravel so AI actively steers back to track
        const gravelBoost=c.onGravel?2.2:1.0;
        const pushFactor=Math.min(1,(edgeDist-wallDist*0.5)/(wallDist*0.5));
        str=Math.max(-1,Math.min(1,str+pullErr*pushFactor*1.5*gravelBoost));
      }
    }
    // Gravel recovery: reduce throttle and steer back even when not near wall edge
    if(c.onGravel){
      thr=Math.min(thr,0.7);
    }

    thr*=c.data.aiSpd*c.aiAgg*diff.aggMult;
    thr=Math.min(1,thr);
    if(playerCar){const lead=c.totalProg-playerCar.totalProg;if(lead>8)thr*=.93;else if(lead<-8)thr=Math.min(1,thr*1.05);}
    c.update({thr,brk:Math.min(1,brk),str},dt);
  }
}
