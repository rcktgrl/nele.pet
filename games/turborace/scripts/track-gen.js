import { mat, matE } from "./render/materials.js";
import { state, scene } from "./state.js";
import { THREE } from "./three.js";

let roadTex=null;

export function buildTrack(data){
  state.cityCorridors=null; state.cityAiPts=null;
  const rm=[]; scene.traverse(o=>{if(o.userData.trk)rm.push(o);}); rm.forEach(o=>scene.remove(o));
  const raw=data.wp.map(w=>new THREE.Vector3(w[0],w[1],w[2]));
  const curve=new THREE.CatmullRomCurve3(raw,true,'centripetal',.5);
  state.trkCurve=curve; state.trkPts=curve.getSpacedPoints(500);
  // Precompute per-point curvature (0=straight, 1=very tight) for AI adaptive lookahead
  state.trkCurv=[];
  const N=state.trkPts.length;
  for(let i=0;i<N;i++){
    const a=state.trkPts[(i-2+N)%N],b=state.trkPts[i],c=state.trkPts[(i+2)%N];
    const ax=b.x-a.x,az=b.z-a.z,bx=c.x-b.x,bz=c.z-b.z;
    const la=Math.sqrt(ax*ax+az*az)||1,lb=Math.sqrt(bx*bx+bz*bz)||1;
    const dot=(ax*bx+az*bz)/(la*lb);
    state.trkCurv[i]=Math.max(0,1-Math.min(1,(dot+1)/2*1.2)); // 0=straight 1=hairpin
  }

  // ── Adaptive segment counts: more on curves, fewer on straights ──
  const isCity=data.type==='city';
  const smoothEdgePts=curve.getSpacedPoints(900);
  const adaptKerb=smoothEdgePts;
  const adaptBarrier=smoothEdgePts;

  if(!roadTex)roadTex=makeRoadTexture();
  if(!isCity){
    addRibbon(curve,data.rw,900,0,0,0,.005,true,roadTex);
    addRibbon(curve,.30,300,0,0xffffff,0,.028,false);
    addKerbAdaptive(adaptKerb,data.rw,1);
    addKerbAdaptive(adaptKerb,data.rw,-1);
    const runoffProfile=(data.enableRunoff===false)?null:buildRunoffProfile(adaptBarrier,data);
    addBarriersAdaptive(adaptBarrier,data.rw,runoffProfile);
    if(runoffProfile) addGravelRunoff(runoffProfile);
  }
  // Ground plane
  const gndCol=isCity?data.gnd:0x1a3018;
  const gnd=new THREE.Mesh(new THREE.PlaneGeometry(1400,1400),new THREE.MeshLambertMaterial({color:gndCol}));
  gnd.rotation.x=-Math.PI/2; gnd.position.y=-.08; gnd.receiveShadow=true; gnd.userData.trk=true; scene.add(gnd);
  if(!isCity) addGantry(curve,data.rw);
  if(isCity) addCityScenery(curve,data);
  else addScenery(curve,data);
  applyPlacedAssets(data);
  scene.background=new THREE.Color(data.sky);
  const fogNear=isCity?120:260, fogFar=isCity?420:680;
  scene.fog=new THREE.Fog(data.sky,fogNear,fogFar);
  return curve;
}

function makeRoadTexture(){
  const c=document.createElement('canvas'); c.width=512; c.height=512;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#1c1c1c'; ctx.fillRect(0,0,512,512);
  for(let i=0;i<14000;i++){
    const x=Math.random()*512,y=Math.random()*512,b=Math.floor(18+Math.random()*28);
    ctx.fillStyle=`rgb(${b},${b},${b})`; ctx.fillRect(x,y,1,1);
  }
  for(let i=0;i<300;i++){
    const x=Math.random()*512,y=Math.random()*512,r=.8+Math.random()*1.8,b=Math.floor(28+Math.random()*22);
    ctx.fillStyle=`rgb(${b},${b},${b})`; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  for(let i=0;i<18;i++){
    const x=Math.random()*512;
    ctx.strokeStyle=`rgba(55,55,55,${Math.random()*.18})`; ctx.lineWidth=Math.random()*2+.5;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+Math.random()*40-20,512); ctx.stroke();
  }
  const tex=new THREE.CanvasTexture(c);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(1,20);
  return tex;
}

function addRibbon(curve,width,segs,offset,color,yExtra,yBase,recv,tex){
  const pts=curve.getSpacedPoints(segs),verts=[],uvs=[],idx=[];
  for(let i=0;i<=segs;i++){
    const pt=pts[i],nx=pts[(i+1)%(segs+1)];
    const t=new THREE.Vector3().subVectors(nx,pt).normalize();
    const r=new THREE.Vector3(-t.z,0,t.x).normalize();
    const c=pt.clone().addScaledVector(r,offset);
    const l=c.clone().addScaledVector(r,-width/2),ri=c.clone().addScaledVector(r,width/2);
    verts.push(l.x,l.y+yBase+yExtra,l.z,ri.x,ri.y+yBase+yExtra,ri.z);
    const v=i/segs; uvs.push(0,v,1,v);
    if(i<segs){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  idx.push(segs*2,0,segs*2+1,segs*2+1,0,1);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m=tex?new THREE.MeshLambertMaterial({map:tex,side:THREE.DoubleSide}):new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geo,m); if(recv)mesh.receiveShadow=true;
  mesh.userData.trk=true; scene.add(mesh);
}

function addKerbAdaptive(pts,rw,side){
  const kw=1.6;
  const n=pts.length;
  const matR=new THREE.MeshLambertMaterial({color:0xdd1111,side:THREE.DoubleSide});
  const matW=new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide});
  const norms=[];
  for(let i=0;i<n;i++){
    const p=pts[(i-1+n)%n],q=pts[(i+1)%n];
    const tx=q.x-p.x,tz=q.z-p.z,l=Math.sqrt(tx*tx+tz*tz)||1;
    norms.push(new THREE.Vector3(-tz/l,0,tx/l));
  }
  const ko=side*(rw/2+kw/2+0.05);
  const STRIPE=4;
  // Batch into single geometry
  const allVerts=[],allIdx=[];let vi=0;
  const allVertsW=[],allIdxW=[];let viW=0;
  const emitted=[];
  for(let i=0;i<n-1;i++){
    const p0=pts[i],p1=pts[i+1],r0=norms[i],r1=norms[i+1];
    const c0x=p0.x+r0.x*ko,c0z=p0.z+r0.z*ko;
    const c1x=p1.x+r1.x*ko,c1z=p1.z+r1.z*ko;
    let intersects=false;
    for(let s=0;s<emitted.length-2;s++){
      const e=emitted[s];
      if(segmentsIntersect2D(c0x,c0z,c1x,c1z,e.x0,e.z0,e.x1,e.z1)){
        intersects=true;
        break;
      }
    }
    if(intersects) continue;
    emitted.push({x0:c0x,z0:c0z,x1:c1x,z1:c1z});

    const hw=kw/2;
    const isRed=Math.floor(i/STRIPE)%2===0;
    const v=isRed?allVerts:allVertsW, ix=isRed?allIdx:allIdxW;
    const base=isRed?vi:viW;
    v.push(c0x-r0.x*hw,.015,c0z-r0.z*hw, c0x+r0.x*hw,.015,c0z+r0.z*hw,
           c1x+r1.x*hw,.015,c1z+r1.z*hw, c1x-r1.x*hw,.015,c1z-r1.z*hw);
    ix.push(base,base+1,base+2,base,base+2,base+3);
    if(isRed)vi+=4;else viW+=4;
  }
  const mkGeo=(v,i)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);g.computeVertexNormals();return g;};
  if(allVerts.length){const m=new THREE.Mesh(mkGeo(allVerts,allIdx),matR);m.userData.trk=true;scene.add(m);}
  if(allVertsW.length){const m=new THREE.Mesh(mkGeo(allVertsW,allIdxW),matW);m.userData.trk=true;scene.add(m);}
}

function addBarriersAdaptive(pts,rw,runoffProfile){
  const n=pts.length;
  const norms=[];
  for(let i=0;i<n;i++){
    const p=pts[(i-1+n)%n],q=pts[(i+1)%n];
    const tx=q.x-p.x,tz=q.z-p.z,l=Math.sqrt(tx*tx+tz*tz)||1;
    norms.push(new THREE.Vector3(-tz/l,0,tx/l));
  }
  const leftExpand=(runoffProfile&&runoffProfile.leftExpand)||[];
  const rightExpand=(runoffProfile&&runoffProfile.rightExpand)||[];

  function intrudesTrackInterior(px,pz,segIndex){
    // Ignore nearby centerline segments and only test for self-overlap on very sharp corners.
    const localWindow=8;
    let best=Infinity;
    for(let j=0;j<n-1;j++){
      if(Math.abs(j-segIndex)<=localWindow) continue;
      const a=pts[j],b=pts[j+1];
      const d2=distPointToSegment2(px,pz,a.x,a.z,b.x,b.z);
      if(d2<best) best=d2;
    }
    const minTrackDist=(rw/2)+0.45;
    return best<(minTrackDist*minTrackDist);
  }

  for(const side of[-1,1]){
    const vL=[],vT=[],iL=[],iT=[]; let vi=0,ti=0;
    const emitted=[];
    const h=1.15;
    for(let i=0;i<n-1;i++){
      const p0=pts[i],p1=pts[i+1],r0=norms[i],r1=norms[i+1];
      const expand=side<0?(leftExpand[i]||0):(rightExpand[i]||0);
      const off=side*(rw/2+2.0+expand);
      const b0x=p0.x+r0.x*off,b0z=p0.z+r0.z*off;
      const b1x=p1.x+r1.x*off,b1z=p1.z+r1.z*off;

      let intersects=false;
      for(let s=0;s<emitted.length-2;s++){
        const e=emitted[s];
        if(segmentsIntersect2D(b0x,b0z,b1x,b1z,e.x0,e.z0,e.x1,e.z1)){
          intersects=true;
          break;
        }
      }
      if(intersects) continue;

      // Prevent barrier quads from being generated inside the track when the
      // inside edge of an extremely sharp corner intersects itself.
      if(intrudesTrackInterior(b0x,b0z,i)||intrudesTrackInterior(b1x,b1z,i)) continue;
      emitted.push({x0:b0x,z0:b0z,x1:b1x,z1:b1z});

      vL.push(b0x,p0.y,b0z, b1x,p1.y,b1z, b1x,p1.y+h,b1z, b0x,p0.y+h,b0z);
      iL.push(vi,vi+1,vi+2,vi,vi+2,vi+3); vi+=4;
      vT.push(b0x,p0.y+h,b0z, b1x,p1.y+h,b1z, b1x,p1.y+h+.16,b1z, b0x,p0.y+h+.16,b0z);
      iT.push(ti,ti+1,ti+2,ti,ti+2,ti+3); ti+=4;
    }
    const mkGeo=(v,i)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);g.computeVertexNormals();return g;};
    const bm=new THREE.Mesh(mkGeo(vL,iL),new THREE.MeshLambertMaterial({color:0x888888,side:THREE.DoubleSide}));
    bm.userData.trk=true; scene.add(bm);
    const tm=new THREE.Mesh(mkGeo(vT,iT),new THREE.MeshLambertMaterial({color:side===-1?0xff2211:0xffffff,side:THREE.DoubleSide}));
    tm.userData.trk=true; scene.add(tm);
  }
}

function addGantry(curve,rw){
  const sp=curve.getPoint(0),st=curve.getTangentAt(0.01);
  const sr=new THREE.Vector3(-st.z,0,st.x).normalize();
  const ang=Math.atan2(st.x,st.z);
  const pM=mat(0xdddddd),rM=matE(0xff2200,0x220000);
  [-1,1].forEach(s=>{
    const pole=new THREE.Mesh(new THREE.BoxGeometry(.26,5.5,.26),pM);
    pole.position.copy(sp).addScaledVector(sr,s*(rw/2+2.2)); pole.position.y=2.75; pole.userData.trk=true; scene.add(pole);
  });
  const ban=new THREE.Mesh(new THREE.BoxGeometry(rw+5,.4,.18),rM);
  ban.position.copy(sp); ban.position.y=5.6; ban.rotation.y=ang; ban.userData.trk=true; scene.add(ban);
  const ln=new THREE.Mesh(new THREE.BoxGeometry(rw,.07,1.3),mat(0xffffff));
  ln.position.copy(sp); ln.position.y=.07; ln.rotation.y=ang; ln.userData.trk=true; scene.add(ln);
}

function distPointToSegment2(px,pz,ax,az,bx,bz){
  const abx=bx-ax, abz=bz-az;
  const apx=px-ax, apz=pz-az;
  const ab2=abx*abx+abz*abz||1;
  const t=Math.max(0,Math.min(1,(apx*abx+apz*abz)/ab2));
  const cx=ax+abx*t, cz=az+abz*t;
  const dx=px-cx, dz=pz-cz;
  return dx*dx+dz*dz;
}

function segmentsIntersect2D(a0x,a0z,a1x,a1z,b0x,b0z,b1x,b1z){
  const orient=(px,pz,qx,qz,rx,rz)=>((qx-px)*(rz-pz)-(qz-pz)*(rx-px));
  const onSeg=(px,pz,qx,qz,rx,rz)=>
    Math.min(px,rx)-1e-6<=qx&&qx<=Math.max(px,rx)+1e-6&&
    Math.min(pz,rz)-1e-6<=qz&&qz<=Math.max(pz,rz)+1e-6;
  const o1=orient(a0x,a0z,a1x,a1z,b0x,b0z);
  const o2=orient(a0x,a0z,a1x,a1z,b1x,b1z);
  const o3=orient(b0x,b0z,b1x,b1z,a0x,a0z);
  const o4=orient(b0x,b0z,b1x,b1z,a1x,a1z);
  const s1=Math.sign(o1),s2=Math.sign(o2),s3=Math.sign(o3),s4=Math.sign(o4);
  if(s1!==s2&&s3!==s4) return true;
  if(Math.abs(o1)<1e-6&&onSeg(a0x,a0z,b0x,b0z,a1x,a1z)) return true;
  if(Math.abs(o2)<1e-6&&onSeg(a0x,a0z,b1x,b1z,a1x,a1z)) return true;
  if(Math.abs(o3)<1e-6&&onSeg(b0x,b0z,a0x,a0z,b1x,b1z)) return true;
  if(Math.abs(o4)<1e-6&&onSeg(b0x,b0z,a1x,a1z,b1x,b1z)) return true;
  return false;
}

export function pointNearTrack(data,px,pz,margin=0){
  if(!data||!Array.isArray(data.wp)||data.wp.length<2) return false;
  const maxD=((data.rw||12)/2+margin); const maxD2=maxD*maxD;
  for(let i=0;i<data.wp.length;i++){
    const a=data.wp[i],b=data.wp[(i+1)%data.wp.length];
    if(distPointToSegment2(px,pz,a[0],a[2],b[0],b[2])<=maxD2) return true;
  }
  return false;
}

function pointInNoAutoZone(data,px,pz,pad=0){
  const zones=(data&&data.noAutoZones)||[];
  return zones.some(z=>{ const dx=px-z.x,dz=pz-z.z,r=(z.r||18)+pad; return dx*dx+dz*dz<=r*r; });
}

function pointInZoneList(zones,px,pz,pad=0){
  return zones.some(z=>{ const dx=px-z.x,dz=pz-z.z,r=(z.r||18)+pad; return dx*dx+dz*dz<=r*r; });
}

function buildSceneryExclusionZones(curve,data){
  const zones=[];
  const sf=curve.getPoint(0);
  zones.push({x:sf.x,z:sf.z,r:18});
  if(Array.isArray(data?.wp)&&data.wp.length){
    const last=data.wp[data.wp.length-1];
    if(last) zones.push({x:last[0],z:last[2],r:16});
  }
  const noAuto=(data&&data.noAutoZones)||[];
  noAuto.forEach(z=>zones.push({x:z.x,z:z.z,r:z.r||18}));
  return zones;
}

function buildRunoffProfile(pts,data){
  const n=pts.length;
  if(n<6) return null;
  const curve=new THREE.CatmullRomCurve3(pts,true,'centripetal',.5);
  const zones=buildSceneryExclusionZones(curve,data);
  const leftExpand=new Array(Math.max(0,n-1)).fill(0);
  const rightExpand=new Array(Math.max(0,n-1)).fill(0);
  const slices=[];
  // pts is ~900 densely spaced spline points; stride samples ~15 units apart
  // so corner angles are measurable (consecutive pts are only ~1 unit apart)
  const stride=Math.max(1,Math.round(n/60));
  for(let i=stride;i<n-stride-1;i++){
    const pPrev=pts[i-stride], pCur=pts[i], pNext=pts[i+stride];
    const inX=pCur.x-pPrev.x, inZ=pCur.z-pPrev.z;
    const outX=pNext.x-pCur.x, outZ=pNext.z-pCur.z;
    const inLen=Math.hypot(inX,inZ)||1, outLen=Math.hypot(outX,outZ)||1;
    const dot=(inX*outX+inZ*outZ)/(inLen*outLen);
    if(dot>0.80) continue;
    const turn=Math.sign(inX*outZ-inZ*outX)||1;
    const side=turn>0?-1:1;
    const sharp=Math.min(1,Math.max(0,(0.80-dot)/1.80));
    const exitLen=Math.max(6,Math.min(24,Math.round(8+sharp*16)));
    const start=Math.min(n-3,i+1);
    const end=Math.min(n-2,start+exitLen);
    for(let j=start;j<=end;j++){
      const p=pts[j];
      if(pointInZoneList(zones,p.x,p.z,10)) continue;
      const extra=2.8+sharp*3.6;
      if(side<0) leftExpand[j]=Math.max(leftExpand[j],extra);
      else rightExpand[j]=Math.max(rightExpand[j],extra);
      if(j<n-2){
        const blend=Math.sin(((j-start+1)/(end-start+2))*Math.PI);
        slices.push({index:j,side,outerExtra:5.6+sharp*5.2*blend});
      }
    }
  }
  if(!slices.length) return null;
  return {pts,slices,leftExpand,rightExpand,rw:data.rw};
}

function addGravelRunoff(profile){
  const {pts,slices,rw}=profile;
  const n=pts.length;
  const verts=[]; const idx=[];
  let vi=0;
  const y=0.011;
  const used=new Set();
  for(const seg of slices){
    const i=seg.index;
    if(i<1||i>=n-2) continue;
    const key=`${i}:${seg.side}`;
    if(used.has(key)) continue;
    used.add(key);
    const p0=pts[i], p1=pts[i+1];
    const t0=new THREE.Vector3().subVectors(pts[(i+1)%n],pts[(i-1+n)%n]).normalize();
    const t1=new THREE.Vector3().subVectors(pts[(i+2)%n],pts[i]).normalize();
    const r0=new THREE.Vector3(-t0.z,0,t0.x).normalize();
    const r1=new THREE.Vector3(-t1.z,0,t1.x).normalize();
    const inner=rw/2+1.75;
    const outer=inner+seg.outerExtra;
    const s=seg.side;
    const in0=new THREE.Vector3(p0.x+r0.x*s*inner,y,p0.z+r0.z*s*inner);
    const out0=new THREE.Vector3(p0.x+r0.x*s*outer,y,p0.z+r0.z*s*outer);
    const in1=new THREE.Vector3(p1.x+r1.x*s*inner,y,p1.z+r1.z*s*inner);
    const out1=new THREE.Vector3(p1.x+r1.x*s*outer,y,p1.z+r1.z*s*outer);
    if(segmentsIntersect2D(in0.x,in0.z,in1.x,in1.z,out0.x,out0.z,out1.x,out1.z)) continue;
    verts.push(in0.x,in0.y,in0.z, out0.x,out0.y,out0.z, out1.x,out1.y,out1.z, in1.x,in1.y,in1.z);
    idx.push(vi,vi+1,vi+2,vi,vi+2,vi+3);
    vi+=4;
  }
  if(!verts.length) return;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({color:0x6f6752,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));
  mesh.userData.trk=true;
  mesh.receiveShadow=true;
  scene.add(mesh);
}

function addScenery(curve,data){
  const pts=curve.getSpacedPoints(100);
  const tmk=mat(0x4a2810),tlv=mat(0x1e4a1e);
  const bmk=mat(0x2a2a3a),bmk2=mat(0x3a3a4a),bmk3=mat(0x222238);
  const roofMat=mat(0x333344);
  const standMat=mat(0x444455),standSeat=mat(0x995522);
  const minOff=data.rw/2+7.0;
  const placed=[];
  const exclusionZones=buildSceneryExclusionZones(curve,data);

  function onTrack(px,pz,margin){
    const m2=(data.rw/2+margin)**2;
    for(let j=0;j<state.trkPts.length;j+=3){
      if((px-state.trkPts[j].x)**2+(pz-state.trkPts[j].z)**2<m2)return true;
    }
    return false;
  }
  function inExclusion(px,pz,pad=0){return pointInZoneList(exclusionZones,px,pz,pad);}

  for(let i=0;i<pts.length;i++){
    const p=pts[i],nx=pts[(i+1)%pts.length];
    const t=new THREE.Vector3().subVectors(nx,p).normalize();
    const r=new THREE.Vector3(-t.z,0,t.x).normalize();
    for(const s of[-1,1]){
      // ── Trees (dense, varied sizes) ──
      const treeOff=s*(minOff+2+Math.random()*6);
      const tpos=p.clone().addScaledVector(r,treeOff);
      if(!onTrack(tpos.x,tpos.z,6)&&!inExclusion(tpos.x,tpos.z,4)){
        const tg=new THREE.Group();
        const h=1.0+Math.random()*1.2;
        const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.15,.25,h,5),tmk);
        trunk.position.set(0,h/2,0); tg.add(trunk);
        const cr=0.8+Math.random()*1.2, ch=2.0+Math.random()*2.0;
        const cn=new THREE.Mesh(new THREE.ConeGeometry(cr,ch,6),tlv);
        cn.position.set(0,h+ch/2,0); tg.add(cn);
        tg.position.set(tpos.x,p.y,tpos.z); tg.rotation.y=Math.random()*Math.PI*2;
        tg.userData.trk=true; scene.add(tg);
      }

      // ── Second tree row further back ──
      if(Math.random()<0.6){
        const off2=s*(minOff+10+Math.random()*12);
        const tp2=p.clone().addScaledVector(r,off2);
        const tg2=new THREE.Group();
        const h2=1.2+Math.random()*1.5;
        const trunk2=new THREE.Mesh(new THREE.CylinderGeometry(.15,.28,h2,5),tmk);
        trunk2.position.set(0,h2/2,0); tg2.add(trunk2);
        const cn2=new THREE.Mesh(new THREE.ConeGeometry(1.2+Math.random(),2.5+Math.random()*2,6),tlv);
        cn2.position.set(0,h2+1.5,0); tg2.add(cn2);
        if(!inExclusion(tp2.x,tp2.z,4)){
          tg2.position.set(tp2.x,p.y,tp2.z); tg2.rotation.y=Math.random()*Math.PI*2;
          tg2.userData.trk=true; scene.add(tg2);
        }
      }

      // ── Buildings (varied, better quality) ──
      if(Math.random()<0.18){
        const bOff=s*(data.rw/2+16+Math.random()*14);
        const bpos=p.clone().addScaledVector(r,bOff);
        let bClose=false;
        for(const bl of placed){if((bpos.x-bl.x)**2+(bpos.z-bl.z)**2<144)bClose=true;}
        if(!bClose&&!onTrack(bpos.x,bpos.z,10)&&!inExclusion(bpos.x,bpos.z,6)){
          const bw=4+Math.random()*6, bd=3+Math.random()*5, bh=4+Math.random()*8;
          const bm=[bmk,bmk2,bmk3][Math.floor(Math.random()*3)];
          const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),bm);
          bld.position.set(bpos.x,p.y+bh/2,bpos.z);
          bld.rotation.y=Math.atan2(t.x,t.z)+Math.random()*0.3-0.15;
          bld.castShadow=true; bld.userData.trk=true; scene.add(bld);
          // Roof accent
          const roof=new THREE.Mesh(new THREE.BoxGeometry(bw+0.3,0.3,bd+0.3),roofMat);
          roof.position.set(bpos.x,p.y+bh+0.15,bpos.z); roof.userData.trk=true; scene.add(roof);
          placed.push({x:bpos.x,z:bpos.z});
        }
      }

      // ── Grandstands near track (wedge shape, slope facing track) ──
      if(i%12===0 && Math.random()<0.3 && !inExclusion(p.x,p.z,8)){
        const gOff=s*(data.rw/2+10);
        const gpos=p.clone().addScaledVector(r,gOff);
        const gang=Math.atan2(t.x,t.z);
        const gw=8+Math.random()*6, gd=5, gh=4+Math.random()*2;
        // Wedge: triangle cross-section — tall at back, slopes down to track side
        // 6 vertices: front-bottom-L, front-bottom-R, front-top-L, front-top-R, back-bottom-L, back-bottom-R
        // "front" = track side (low), "back" = away from track (tall)
        const trackSide=s>0?-1:1; // which local Z direction faces track
        const verts=new Float32Array([
          -gw/2,0,trackSide*gd/2,   gw/2,0,trackSide*gd/2,    // front bottom L,R (track side, ground)
          -gw/2,0.3,trackSide*gd/2, gw/2,0.3,trackSide*gd/2,  // front top L,R (track side, low edge)
          -gw/2,0,-trackSide*gd/2,  gw/2,0,-trackSide*gd/2,   // back bottom L,R
          -gw/2,gh,-trackSide*gd/2, gw/2,gh,-trackSide*gd/2,  // back top L,R
        ]);
        const idx=[
          0,1,3,0,3,2, // front face
          4,6,7,4,7,5, // back face
          2,3,7,2,7,6, // slope (top)
          0,4,5,0,5,1, // bottom
          0,2,6,0,6,4, // left side
          1,5,7,1,7,3, // right side
        ];
        const geo=new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.BufferAttribute(verts,3));
        geo.setIndex(idx); geo.computeVertexNormals();
        const stand=new THREE.Mesh(geo,standMat);
        stand.position.set(gpos.x,p.y,gpos.z);
        stand.rotation.y=gang; stand.userData.trk=true; scene.add(stand);
        // Seat strips on slope
        const seatStrip=new THREE.Mesh(new THREE.BoxGeometry(gw,0.15,gd+0.1),standSeat);
        seatStrip.position.set(gpos.x,p.y+gh*0.45,gpos.z-trackSide*0.3);
        seatStrip.rotation.y=gang;
        seatStrip.rotation.x=trackSide*Math.atan2(gh-0.3,gd)*0.3;
        seatStrip.userData.trk=true; scene.add(seatStrip);
      }
    }
  }
}

function addCityScenery(curve,data){
  const gs=data.gridSize||70;
  const roadW=data.rw;
  const swW=3;
  const corridorW=roadW+swW*2;
  const intZone=corridorW/2+1;

  // ── Materials ──
  const roadMat=new THREE.MeshLambertMaterial({color:0x1a1a1e,side:THREE.DoubleSide});
  const swMat=new THREE.MeshLambertMaterial({color:0x222230});
  const curbMat=new THREE.MeshLambertMaterial({color:0x2e2e38});
  const markMat=new THREE.MeshLambertMaterial({color:0x888855,emissive:0x111108});
  const brrMat=new THREE.MeshLambertMaterial({color:0x888888,side:THREE.DoubleSide});
  const brrTop=new THREE.MeshLambertMaterial({color:0xff2211,side:THREE.DoubleSide});
  const bCols=[0x14141e,0x18182a,0x1c1c28,0x121220,0x1a1a30,0x161622,0x20202c,0x0e0e18];
  const bMats=bCols.map(c=>new THREE.MeshLambertMaterial({color:c}));
  const litMats=[
    new THREE.MeshLambertMaterial({color:0x181828,emissive:0x0c0c18}),
    new THREE.MeshLambertMaterial({color:0x1a1a2e,emissive:0x0a0a15}),
    new THREE.MeshLambertMaterial({color:0x1e2030,emissive:0x0e1020}),
  ];
  const winMat=new THREE.MeshLambertMaterial({color:0x445566,emissive:0x223344,transparent:true,opacity:0.6});
  const warmWin=new THREE.MeshLambertMaterial({color:0x554422,emissive:0x332211});
  const neons=[matE(0xff2244,0x881122),matE(0x2244ff,0x112288),matE(0x22ff88,0x118844)];
  const poleMat=mat(0x444455);
  const bulbMat=matE(0xffeedd,0xaa8844);
  const poolMat=new THREE.MeshBasicMaterial({color:0xffcc44,transparent:true,opacity:0.15,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
  const poolGeo=new THREE.CircleGeometry(12,16);

  // ── Grid extents ──
  let mnX=Infinity,mxX=-Infinity,mnZ=Infinity,mxZ=-Infinity;
  for(const p of state.trkPts){
    if(p.x<mnX)mnX=p.x;if(p.x>mxX)mxX=p.x;if(p.z<mnZ)mnZ=p.z;if(p.z>mxZ)mxZ=p.z;
  }
  const gx0=Math.floor(mnX/gs)*gs-gs*2, gx1=Math.ceil(mxX/gs)*gs+gs*2;
  const gz0=Math.floor(mnZ/gs)*gs-gs*2, gz1=Math.ceil(mxZ/gs)*gs+gs*2;

  // ── Detect track road segments ──
  // H seg "x,z" = horizontal road at Z=z from X=x to X=x+gs
  // V seg "x,z" = vertical road at X=x from Z=z to Z=z+gs
  const trackH=new Set(), trackV=new Set(), trackInter=new Set();
  for(let i=0;i<state.trkPts.length;i++){
    const p=state.trkPts[i];
    const nearX=Math.round(p.x/gs)*gs, nearZ=Math.round(p.z/gs)*gs;
    // On a vertical road? (X near gridline, Z in mid-segment)
    if(Math.abs(p.x-nearX)<roadW*0.7){
      const segZ=Math.floor(p.z/gs)*gs;
      if(p.z>segZ+intZone && p.z<segZ+gs-intZone) trackV.add(nearX+','+segZ);
    }
    // On a horizontal road?
    if(Math.abs(p.z-nearZ)<roadW*0.7){
      const segX=Math.floor(p.x/gs)*gs;
      if(p.x>segX+intZone && p.x<segX+gs-intZone) trackH.add(segX+','+nearZ);
    }
    // Near an intersection?
    if(Math.abs(p.x-nearX)<corridorW && Math.abs(p.z-nearZ)<corridorW){
      trackInter.add(nearX+','+nearZ);
    }
  }
  // Intersection exit detection based on connected track segments
  const trackExits={};
  for(const key of trackInter){
    const[ix,iz]=key.split(',').map(Number);
    trackExits[key]={
      n: trackV.has(ix+','+iz),
      s: trackV.has(ix+','+(iz-gs)),
      e: trackH.has(ix+','+iz),
      w: trackH.has((ix-gs)+','+iz),
    };
  }

  // ── 1. BUILD ALL ROADS ──
  const swLen=gs-corridorW;
  for(let z=gz0;z<=gz1;z+=gs){
    for(let x=gx0;x<gx1;x+=gs){
      const cx=x+gs/2;
      const rd=new THREE.Mesh(new THREE.BoxGeometry(gs,0.04,roadW),roadMat);
      rd.position.set(cx,0.005,z); rd.receiveShadow=true; rd.userData.trk=true; scene.add(rd);
      if(swLen>2){
        for(const s of[-1,1]){
          const sw=new THREE.Mesh(new THREE.BoxGeometry(swLen,0.12,swW),swMat);
          sw.position.set(cx,0.06,z+s*(roadW/2+swW/2)); sw.userData.trk=true; scene.add(sw);
          const cb=new THREE.Mesh(new THREE.BoxGeometry(swLen,0.14,0.15),curbMat);
          cb.position.set(cx,0.07,z+s*roadW/2); cb.userData.trk=true; scene.add(cb);
        }
      }
      for(let dx=x+intZone+1;dx<x+gs-intZone;dx+=5){
        const dm=new THREE.Mesh(new THREE.BoxGeometry(2,0.02,0.15),markMat);
        dm.position.set(dx,0.05,z); dm.userData.trk=true; scene.add(dm);
      }
    }
  }
  for(let x=gx0;x<=gx1;x+=gs){
    for(let z=gz0;z<gz1;z+=gs){
      const cz=z+gs/2;
      const rd=new THREE.Mesh(new THREE.BoxGeometry(roadW,0.04,gs),roadMat);
      rd.position.set(x,0.005,cz); rd.receiveShadow=true; rd.userData.trk=true; scene.add(rd);
      if(swLen>2){
        for(const s of[-1,1]){
          const sw=new THREE.Mesh(new THREE.BoxGeometry(swW,0.12,swLen),swMat);
          sw.position.set(x+s*(roadW/2+swW/2),0.06,cz); sw.userData.trk=true; scene.add(sw);
          const cb=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.14,swLen),curbMat);
          cb.position.set(x+s*roadW/2,0.07,cz); cb.userData.trk=true; scene.add(cb);
        }
      }
      for(let dz=z+intZone+1;dz<z+gs-intZone;dz+=5){
        const dm=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.02,2),markMat);
        dm.position.set(x,0.05,dz); dm.userData.trk=true; scene.add(dm);
      }
    }
  }
  for(let x=gx0;x<=gx1;x+=gs){
    for(let z=gz0;z<=gz1;z+=gs){
      const ip=new THREE.Mesh(new THREE.BoxGeometry(corridorW,0.04,corridorW),roadMat);
      ip.position.set(x,0.004,z); ip.receiveShadow=true; ip.userData.trk=true; scene.add(ip);
    }
  }

  // ── 2. BARRIERS on track segment sidewalks only ──
  const bH=1.15;
  function addWall(cx,cy,cz,bw,bh,bd){
    const wall=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),brrMat);
    wall.position.set(cx,cy,cz); wall.userData.trk=true; scene.add(wall);
    const top=new THREE.Mesh(new THREE.BoxGeometry(bw,0.16,bd),brrTop);
    top.position.set(cx,cy+bh/2+0.08,cz); top.userData.trk=true; scene.add(top);
  }
  for(const key of trackH){
    const[sx,sz]=key.split(',').map(Number);
    const cx=sx+gs/2;
    addWall(cx, bH/2, sz+roadW/2+swW, swLen, bH, 0.35);
    addWall(cx, bH/2, sz-roadW/2-swW, swLen, bH, 0.35);
  }
  for(const key of trackV){
    const[sx,sz]=key.split(',').map(Number);
    const cz=sz+gs/2;
    addWall(sx+roadW/2+swW, bH/2, cz, 0.35, bH, swLen);
    addWall(sx-roadW/2-swW, bH/2, cz, 0.35, bH, swLen);
  }

  // ── 3. INTERSECTION CROSS-WALLS ──
  for(const key of trackInter){
    const[ix,iz]=key.split(',').map(Number);
    const ex=trackExits[key];
    const hw=corridorW/2;
    if(!ex.n) addWall(ix, bH/2, iz+hw, corridorW, bH, 0.4);
    if(!ex.s) addWall(ix, bH/2, iz-hw, corridorW, bH, 0.4);
    if(!ex.e) addWall(ix+hw, bH/2, iz, 0.4, bH, corridorW);
    if(!ex.w) addWall(ix-hw, bH/2, iz, 0.4, bH, corridorW);
  }

  // Start/finish gantry
  const sp=curve.getPoint(0),st=curve.getTangentAt(0.001);
  const sr=new THREE.Vector3(-st.z,0,st.x).normalize();
  const ang=Math.atan2(st.x,st.z);
  const gM=mat(0xdddddd),gR=matE(0xff2200,0x220000);
  [-1,1].forEach(s=>{
    const pole=new THREE.Mesh(new THREE.BoxGeometry(.26,5.5,.26),gM);
    pole.position.copy(sp).addScaledVector(sr,s*(roadW/2+swW+0.5)); pole.position.y=2.75; pole.userData.trk=true; scene.add(pole);
  });
  const ban=new THREE.Mesh(new THREE.BoxGeometry(corridorW+2,.4,.18),gR);
  ban.position.copy(sp); ban.position.y=5.6; ban.rotation.y=ang; ban.userData.trk=true; scene.add(ban);
  const sfLine=new THREE.Mesh(new THREE.BoxGeometry(roadW,.07,1.3),mat(0xffffff));
  sfLine.position.copy(sp); sfLine.position.y=.07; sfLine.rotation.y=ang; sfLine.userData.trk=true; scene.add(sfLine);

  // ── 4. BUILDINGS ──
  const blockInset=corridorW/2+0.5;
  const placed=[];
  for(let bx=gx0;bx<gx1;bx+=gs){
    for(let bz=gz0;bz<gz1;bz+=gs){
      const cx=bx+gs/2, cz=bz+gs/2;
      const blockW=gs-corridorW-1, blockD=gs-corridorW-1;
      if(blockW<4||blockD<4)continue;
      const nBld=1+Math.floor(Math.random()*2.5);
      for(let bi=0;bi<nBld;bi++){
        let bw,bd,px,pz;
        if(nBld===1){
          bw=blockW*(.7+Math.random()*.25); bd=blockD*(.7+Math.random()*.25);
          px=cx+(Math.random()-.5)*2; pz=cz+(Math.random()-.5)*2;
        } else {
          bw=blockW/nBld*(.8+Math.random()*.3); bd=blockD*(.6+Math.random()*.3);
          px=cx-blockW/2+bw/2+bi*(blockW/nBld)+(Math.random()-.5)*2;
          pz=cz+(Math.random()-.5)*(blockD-bd)*.4;
        }
        if(px-bw/2<bx+blockInset||px+bw/2>bx+gs-blockInset)continue;
        if(pz-bd/2<bz+blockInset||pz+bd/2>bz+gs-blockInset)continue;
        let md=Infinity;
        for(let j=0;j<state.trkPts.length;j+=5){const d=(px-state.trkPts[j].x)**2+(pz-state.trkPts[j].z)**2;if(d<md)md=d;}
        md=Math.sqrt(md); const near=md<50;
        if(pointInNoAutoZone(data,px,pz,10))continue;
        let bh=near?(28+Math.random()*50):(8+Math.random()*30);
        if(Math.random()<0.06)bh=Math.max(bh,55+Math.random()*30);
        const useLit=Math.random()<0.35;
        const m=useLit?litMats[Math.floor(Math.random()*litMats.length)]:bMats[Math.floor(Math.random()*bMats.length)];
        const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),m);
        bld.position.set(px,bh/2,pz); bld.castShadow=true; bld.userData.trk=true; scene.add(bld);
        placed.push({x:px,z:pz,w:bw,d:bd,h:bh});
        if(bh>25&&Math.random()<0.5){
          const wh=bh*0.55;
          const wMesh=new THREE.Mesh(new THREE.BoxGeometry(bw+.2,wh,bd+.2),winMat);
          wMesh.position.set(px,bh*0.35+wh/2,pz); wMesh.userData.trk=true; scene.add(wMesh);
        }
        if(bh>18&&Math.random()<0.4){
          const face=Math.floor(Math.random()*4);
          for(let f=1;f<Math.floor(bh/4.5);f++){
            if(Math.random()<0.5)continue;
            const fy=f*4.5+1; let wx,wz;
            if(face===0){wx=px+(Math.random()-.5)*bw*.5;wz=pz+bd/2+.08;}
            else if(face===1){wx=px+(Math.random()-.5)*bw*.5;wz=pz-bd/2-.08;}
            else if(face===2){wx=px+bw/2+.08;wz=pz+(Math.random()-.5)*bd*.5;}
            else{wx=px-bw/2-.08;wz=pz+(Math.random()-.5)*bd*.5;}
            const wn=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.8,.08),warmWin);
            wn.position.set(wx,fy,wz); if(face>=2)wn.rotation.y=Math.PI/2;
            wn.userData.trk=true; scene.add(wn);
          }
        }
        if(near&&bh>25&&Math.random()<0.15){
          const nm=neons[Math.floor(Math.random()*neons.length)];
          const ns=new THREE.Mesh(new THREE.BoxGeometry(bw*.6,.6,.08),nm);
          ns.position.set(px+(Math.abs(px-bx)<Math.abs(px-(bx+gs))?-1:1)*(bw/2+.1),bh*.5+Math.random()*bh*.2,pz);
          ns.rotation.y=Math.PI/2; ns.userData.trk=true; scene.add(ns);
        }
      }
    }
  }

  // ── 5. STREET LAMPS on sidewalks, yellow pools on road ──
  // S/F exclusion zone — no lamps near start/finish
  const sfPt=curve.getPoint(0);
  const sfExclude=15; // metres exclusion radius around S/F

  const lPts=curve.getSpacedPoints(120);
  for(let i=0;i<lPts.length;i+=4){
    const p=lPts[i],nx=lPts[(i+1)%lPts.length];
    // Skip if near start/finish
    if(Math.abs(p.x-sfPt.x)<sfExclude&&Math.abs(p.z-sfPt.z)<sfExclude)continue;
    if(pointInNoAutoZone(data,p.x,p.z,6))continue;
    const t=new THREE.Vector3().subVectors(nx,p).normalize();
    const r=new THREE.Vector3(-t.z,0,t.x).normalize();
    const side=(i%8<4)?-1:1;
    // Place on outer edge of sidewalk
    const off=side*(roadW/2+swW*0.8);
    const lx=p.x+r.x*off, lz=p.z+r.z*off;
    let inBld=false;
    for(const b of placed){if(Math.abs(lx-b.x)<b.w/2+1&&Math.abs(lz-b.z)<b.d/2+1){inBld=true;break;}}
    if(inBld)continue;
    // Pole on sidewalk
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,6.5,5),poleMat);
    pole.position.set(lx,3.25,lz); pole.userData.trk=true; scene.add(pole);
    // Arm extends over road
    const armDx=-r.x*side*2.0, armDz=-r.z*side*2.0;
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.05,.05,2.8),poleMat);
    arm.position.set(lx+armDx*0.4,6.3,lz+armDz*0.4);
    arm.rotation.y=Math.atan2(r.x,r.z); arm.userData.trk=true; scene.add(arm);
    const bx2=lx+armDx, bz2=lz+armDz;
    const bulb=new THREE.Mesh(new THREE.BoxGeometry(.6,.12,.35),bulbMat);
    bulb.position.set(bx2,6.2,bz2); bulb.userData.trk=true; scene.add(bulb);
    // Yellow transparent pool on road surface
    const pool=new THREE.Mesh(poolGeo,poolMat);
    pool.rotation.x=-Math.PI/2;
    pool.position.set(p.x,0.06,p.z);
    pool.userData.trk=true; scene.add(pool);
  }

  // ── 6. PARKS in empty blocks (no buildings placed) ──
  const tmk=mat(0x4a2810),tlv=mat(0x1e4a1e);
  const grassMat=new THREE.MeshLambertMaterial({color:0x1a3a1a});
  const pathMat=new THREE.MeshLambertMaterial({color:0x2a2a22});
  for(let bx=gx0;bx<gx1;bx+=gs){
    for(let bz=gz0;bz<gz1;bz+=gs){
      const cx=bx+gs/2, cz=bz+gs/2;
      const blockW=gs-corridorW-1, blockD=gs-corridorW-1;
      if(blockW<8||blockD<8)continue;
      // Check if this block has any buildings
      let hasBld=false;
      for(const b of placed){
        if(b.x>bx+blockInset&&b.x<bx+gs-blockInset&&b.z>bz+blockInset&&b.z<bz+gs-blockInset){
          hasBld=true;break;
        }
      }
      if(hasBld)continue;
      if(pointInNoAutoZone(data,cx,cz,12))continue;
      // This block is empty — make a park
      // Grass patch
      const grass=new THREE.Mesh(new THREE.BoxGeometry(blockW,0.06,blockD),grassMat);
      grass.position.set(cx,0.03,cz); grass.userData.trk=true; scene.add(grass);
      // Path through middle
      const pathH=new THREE.Mesh(new THREE.BoxGeometry(blockW,0.04,1.5),pathMat);
      pathH.position.set(cx,0.06,cz); pathH.userData.trk=true; scene.add(pathH);
      const pathV=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.04,blockD),pathMat);
      pathV.position.set(cx,0.06,cz); pathV.userData.trk=true; scene.add(pathV);
      // Trees scattered around
      const nTrees=6+Math.floor(Math.random()*8);
      for(let ti=0;ti<nTrees;ti++){
        const tx=cx+(Math.random()-.5)*blockW*0.85;
        const tz=cz+(Math.random()-.5)*blockD*0.85;
        // Skip if on path or near start/finish
        if(Math.abs(tx-cx)<1.5||Math.abs(tz-cz)<1.5)continue;
        if((tx-sfPt.x)*(tx-sfPt.x)+(tz-sfPt.z)*(tz-sfPt.z)<(sfExclude+10)*(sfExclude+10))continue;
        const tg=new THREE.Group();
        const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.15,.25,1.2+Math.random()*.5,5),tmk);
        trunk.position.set(0,.7,0); tg.add(trunk);
        const cn=new THREE.Mesh(new THREE.ConeGeometry(.9+Math.random()*.8,2.4+Math.random()*1.5,6),tlv);
        cn.position.set(0,2.5+Math.random()*.4,0); tg.add(cn);
        tg.position.set(tx,0,tz); tg.rotation.y=Math.random()*Math.PI*2;
        tg.userData.trk=true; scene.add(tg);
      }
    }
  }

  // ── 6. BUILD CITY CORRIDORS for boundary system ──
  // Each corridor is an axis-aligned rectangle the car can legally be in
  const corr=[];
  const hw=roadW/2+swW-0.3; // half-width of driveable area (wall to wall)
  // All track H segments
  for(const key of trackH){
    const[sx,sz]=key.split(',').map(Number);
    corr.push({x:sx+gs/2, z:sz, hw:gs/2, hd:hw});
  }
  // All track V segments
  for(const key of trackV){
    const[sx,sz]=key.split(',').map(Number);
    corr.push({x:sx, z:sz+gs/2, hw:hw, hd:gs/2});
  }
  // All track intersections (full square)
  for(const key of trackInter){
    const[ix,iz]=key.split(',').map(Number);
    corr.push({x:ix, z:iz, hw:hw, hd:hw});
  }
  state.cityCorridors=corr;

  // ── 7. CITY AI WAYPOINTS — follow grid roads exactly ──
  if(data.cityRoute){
    const route=data.cityRoute;
    const pts=[];
    const spacing=2; // metres between points
    for(let r=0;r<route.length;r++){
      const curr=route[r], next=route[(r+1)%route.length];
      const dx=next[0]-curr[0], dz=next[1]-curr[1];
      const len=Math.sqrt(dx*dx+dz*dz);
      const steps=Math.max(1,Math.round(len/spacing));
      // Add a small corner arc at this intersection before heading to next
      if(r>0||pts.length>0){
        const prev=route[(r-1+route.length)%route.length];
        // Direction arriving
        const ax=curr[0]-prev[0], az=curr[1]-prev[1];
        const al=Math.sqrt(ax*ax+az*az)||1;
        // Direction leaving
        const bx=next[0]-curr[0], bz=next[1]-curr[1];
        const bl=Math.sqrt(bx*bx+bz*bz)||1;
        // Add corner arc: 4 points rounding the inside
        const R=3.5; // corner radius
        for(let a=0;a<=3;a++){
          const t=a/3;
          const ix=curr[0]-ax/al*R*(1-t)+bx/bl*R*t;
          const iz=curr[1]-az/al*R*(1-t)+bz/bl*R*t;
          pts.push(new THREE.Vector3(ix,0,iz));
        }
      }
      // Straight segment from curr toward next
      for(let s=1;s<=steps;s++){
        const t=s/steps;
        pts.push(new THREE.Vector3(curr[0]+dx*t, 0, curr[1]+dz*t));
      }
    }
    // Compute curvature for city AI points
    const cn=pts.length;
    const cityAiCurv=[];
    for(let i=0;i<cn;i++){
      const a=pts[(i-2+cn)%cn],b=pts[i],c=pts[(i+2)%cn];
      const aax=b.x-a.x,aaz=b.z-a.z,bbx=c.x-b.x,bbz=c.z-b.z;
      const la2=Math.sqrt(aax*aax+aaz*aaz)||1,lb2=Math.sqrt(bbx*bbx+bbz*bbz)||1;
      const dot2=(aax*bbx+aaz*bbz)/(la2*lb2);
      cityAiCurv[i]=Math.max(0,1-Math.min(1,(dot2+1)/2*1.2));
    }
    state.cityAiPts={pts,curv:cityAiCurv};
  }
}

function applyPlacedAssets(data){
  if(!data||!Array.isArray(data.assets)) return;
  data.assets.forEach(asset=>{
    if(pointNearTrack(data,asset.x,asset.z,3)) return;
    const sf=data.wp&&data.wp[0]?new THREE.Vector3(data.wp[0][0],0,data.wp[0][2]):new THREE.Vector3();
    const dx=asset.x-sf.x, dz=asset.z-sf.z; if(dx*dx+dz*dz<28*28) return;
    if(asset.type==='tree'){
      const g=new THREE.Group();
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.32,2.2,6),mat(0x5a3418)); trunk.position.y=1.1; g.add(trunk);
      const crown=new THREE.Mesh(new THREE.ConeGeometry(1.4,3.5,7),mat(0x2e6b34)); crown.position.y=3.5; g.add(crown);
      g.position.set(asset.x,0,asset.z); g.userData.trk=true; scene.add(g);
    }else if(asset.type==='park'){
      const park=new THREE.Mesh(new THREE.BoxGeometry(16,0.08,16),new THREE.MeshLambertMaterial({color:0x295a2b})); park.position.set(asset.x,0.04,asset.z); park.userData.trk=true; scene.add(park);
    }else{
      const h=8+((Math.abs(asset.x)+Math.abs(asset.z))%18);
      const b=new THREE.Mesh(new THREE.BoxGeometry(8,h,8),new THREE.MeshLambertMaterial({color:0x4a445d})); b.position.set(asset.x,h/2,asset.z); b.castShadow=true; b.userData.trk=true; scene.add(b);
      const roof=new THREE.Mesh(new THREE.BoxGeometry(8.5,0.35,8.5),new THREE.MeshLambertMaterial({color:0x22242a})); roof.position.set(asset.x,h+.18,asset.z); roof.userData.trk=true; scene.add(roof);
    }
  });
}