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
      const maxLook=Math.round(3+speedFrac*25);
      ti=ci;
      for(let step=1;step<=maxLook;step++){
        const si=(ci+step)%n;
        if(navCurv[si]>0.25){ ti=si; break; }
        ti=si;
      }
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
            const blend=Math.pow(1-wallMin/margin,2)*0.5;
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
    let str=Math.max(-1,Math.min(1,he*2.5));
    const ts=Math.abs(he);

    const scanDist=Math.round(20+speedFrac*80);
    let worstCurv=0, worstDist=Infinity;
    for(let k=1;k<scanDist;k++){
      const ki=(ci+k)%n;
      if(navCurv[ki]>worstCurv){worstCurv=navCurv[ki]; worstDist=k;}
    }
    const cornerSpeed=c.data.maxSpd*(0.25+0.75*(1-worstCurv));
    const speedOverTarget=c.spd-cornerSpeed;
    const ptSpacing=2;
    const distToCorner=worstDist*ptSpacing;
    let reqBrake=0;
    if(speedOverTarget>0&&distToCorner>0){
      const reqDecel=(c.spd*c.spd-cornerSpeed*cornerSpeed)/(2*distToCorner);
      reqBrake=Math.min(1,reqDecel/c.data.brake);
    }

    let thr=ts<.30?1:Math.max(.45,1-ts*0.8);
    let brk=Math.max(ts>.70?(ts-.70)*1.5:0, reqBrake);
    if(brk>0.2) thr=Math.min(thr,1-brk);

    if(!cityCorridors&&trackData){
      const edgeDist=Math.sqrt(md);
      const wallDist=trackData.rw*0.5;
      if(edgeDist>wallDist*0.5){
        const np=trackPoints[ci];
        const pullAngle=Math.atan2(np.x-c.pos.x,np.z-c.pos.z);
        let pullErr=((pullAngle-c.hdg+Math.PI*3)%(Math.PI*2))-Math.PI;
        const pushFactor=Math.min(1,(edgeDist-wallDist*0.5)/(wallDist*0.5));
        str=Math.max(-1,Math.min(1,str+pullErr*pushFactor*1.5));
      }
    }

    thr*=c.data.aiSpd*c.aiAgg;
    if(playerCar){const lead=c.totalProg-playerCar.totalProg;if(lead>8)thr*=.93;else if(lead<-8)thr=Math.min(1,thr*1.05);}
    c.update({thr,brk:Math.min(1,brk),str},dt);
  }
}
