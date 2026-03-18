import { mat, matE } from "./render/materials.js";
import { state, scene } from "./state.js";
import { THREE } from "./three.js";
import { addScenery, addCityScenery, applyPlacedAssets } from './track/scenery.js';

export const LATEST_TRACK_GENERATION_VERSION = 5;

let roadTex=null;

function hashScenerySeed(source){
  const str=String(source||'turborace-scenery');
  let h=2166136261;
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return (h>>>0)||1;
}

function createSeededRandom(seed){
  let s=(seed>>>0)||1;
  return ()=>{
    s=(Math.imul(1664525,s)+1013904223)>>>0;
    return s/4294967296;
  };
}

function withSeededRandom(seed,fn){
  const orig=Math.random;
  Math.random=createSeededRandom(seed);
  try{return fn();}
  finally{Math.random=orig;}
}

function ensureTrackScenerySeed(data){
  if(!data||typeof data!=='object') return hashScenerySeed('fallback');
  if(Number.isFinite(data.scenerySeed)) return data.scenerySeed>>>0;
  const source=(data.id||data.name||'track')+'|'+JSON.stringify(data.wp||[]);
  const seed=hashScenerySeed(source);
  data.scenerySeed=seed;
  return seed;
}

function addCheckpointFlags(data, runoffProfile){
  const wps=data.wp, n=wps.length, rw=data.rw||12;
  const poleMat=mat(0x222222);
  const flagMat=new THREE.MeshLambertMaterial({color:0xffcc00,side:THREE.DoubleSide});
  const splinePts=runoffProfile?runoffProfile.pts:null;
  const leftExpand=runoffProfile?runoffProfile.leftExpand:null;
  const rightExpand=runoffProfile?runoffProfile.rightExpand:null;
  for(let i=0;i<n;i++){
    const w=wps[i];
    // Use the actual spline tangent so flags align with the rendered track and walls.
    // Falling back to prev/next wp direction only when the spline isn't available.
    let tx, tz;
    if(state.trkCurve&&state.trkPts.length){
      const pts=state.trkPts, pn=pts.length;
      let bestDist=Infinity, bestIdx=0;
      for(let j=0;j<pn;j++){
        const dx=pts[j].x-w[0], dz=pts[j].z-w[2];
        const d=dx*dx+dz*dz;
        if(d<bestDist){bestDist=d; bestIdx=j;}
      }
      const tang=state.trkCurve.getTangentAt(bestIdx/pn);
      tx=tang.x; tz=tang.z;
    }else{
      const prev=wps[(i-1+n)%n], next=wps[(i+1)%n];
      tx=next[0]-prev[0]; tz=next[2]-prev[2];
    }
    const tl=Math.sqrt(tx*tx+tz*tz)||1;
    const nx=-tz/tl, nz=tx/tl; // right-side normal
    const ang=Math.atan2(tx,tz);
    // Find nearest spline point to get per-side wall expansion from gravel
    let expL=0, expR=0;
    if(splinePts){
      let bestDist=Infinity, bestIdx=0;
      for(let j=0;j<splinePts.length;j++){
        const dx=splinePts[j].x-w[0], dz=splinePts[j].z-w[2];
        const d=dx*dx+dz*dz;
        if(d<bestDist){bestDist=d; bestIdx=j;}
      }
      expL=leftExpand[bestIdx]||0;
      expR=rightExpand[bestIdx]||0;
    }
    for(const s of[-1,1]){
      // s=-1 = left side, s=1 = right side (matches barrier placement convention)
      const expand=s<0?expL:expR;
      const flagEdge=rw/2+1.75+expand;
      const fx=w[0]+nx*s*flagEdge, fz=w[2]+nz*s*flagEdge;
      const g=new THREE.Group();
      const pole=new THREE.Mesh(new THREE.BoxGeometry(0.09,2.8,0.09),poleMat);
      pole.position.set(0,1.4,0); g.add(pole);
      const flag=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.5),flagMat);
      // flag hangs from pole top, extends inward toward track center
      flag.position.set(0.45*-s,2.6,0);
      g.add(flag);
      g.rotation.y=ang;
      g.position.set(fx,w[1],fz);
      g.userData.trk=true; scene.add(g);
    }
  }
}

export function buildTrack(data){
  state.cityCorridors=null; state.cityAiPts=null; state.gravelProfile=null;
  state.sceneryExclusionZones=[];
  const rm=[]; scene.traverse(o=>{if(o.userData.trk)rm.push(o);}); rm.forEach(o=>scene.remove(o));
  // splinePts holds the full unthinned Bezier path (steepness baked in) and is the most
  // accurate source for track geometry. Fall back to editorNodes (raw control points, good
  // for Catmull-Rom) or wp (thinned checkpoints, last resort).
  const raw=Array.isArray(data.splinePts)&&data.splinePts.length>=3
    ? data.splinePts.map(w=>new THREE.Vector3(w[0],w[1]||0,w[2]))
    : Array.isArray(data.editorNodes)&&data.editorNodes.length>=3
      ? data.editorNodes.map(n=>new THREE.Vector3(+n.x||0,0,+n.z||0))
      : data.wp.map(w=>new THREE.Vector3(w[0],w[1],w[2]));
  const curve=new THREE.CatmullRomCurve3(raw,true,'centripetal',.5);
  state.trkCurve=curve; state.trkPts=curve.getSpacedPoints(500);
  state.trkWallLeft=[];
  state.trkWallRight=[];
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
  let runoffProfile=null;
  if(!isCity){
    addRibbon(curve,data.rw,900,0,0,0,.005,true,roadTex);
    addRibbon(curve,.30,300,0,0xffffff,0,.028,false);
    addKerbAdaptive(adaptKerb,data.rw,1);
    addKerbAdaptive(adaptKerb,data.rw,-1);
    runoffProfile=(data.enableRunoff===false)?null:buildRunoffProfile(adaptBarrier,data);
    addBarriersAdaptive(adaptBarrier,data.rw,runoffProfile);
    if(runoffProfile){ addGravelRunoff(runoffProfile); state.gravelProfile=runoffProfile; }
    addCheckpointFlags(data, runoffProfile);
  }
  // Ground plane
  const gndCol=isCity?data.gnd:0x1a3018;
  const gnd=new THREE.Mesh(new THREE.PlaneGeometry(1400,1400),new THREE.MeshLambertMaterial({color:gndCol}));
  gnd.rotation.x=-Math.PI/2; gnd.position.y=-.08; gnd.receiveShadow=true; gnd.userData.trk=true; scene.add(gnd);
  if(!isCity) addGantry(curve,data.rw);
  state.sceneryExclusionZones=getTrackSceneryExclusionZones(data);
  // Add gravel pit areas as scenery exclusion zones so trees/buildings don't spawn on them
  if(runoffProfile){
    const rw=data.rw||12;
    for(const node of runoffProfile.nodes){
      for(let j=node.start;j<=node.end;j+=5){
        const p=adaptBarrier[Math.min(j,adaptBarrier.length-1)];
        state.sceneryExclusionZones.push({x:p.x,z:p.z,r:rw/2+2+node.width});
      }
    }
  }
  buildTrackScenery(data);
  scene.background=new THREE.Color(data.sky);
  const defaultFogFar=isCity?420:1200;
  const fogFar=isCity?420:(Number.isFinite(data.fogDist)?data.fogDist:defaultFogFar);
  const fogNear=isCity?120:Math.round(fogFar*0.32);
  scene.fog=new THREE.Fog(data.sky,fogNear,fogFar);
  return curve;
}

export function buildTrackScenery(data){
  if(!state.trkCurve) return;
  const scenerySeed=ensureTrackScenerySeed(data);
  withSeededRandom(scenerySeed,()=>{
    if(data.type==='city') addCityScenery(state.trkCurve,data);
    else addScenery(state.trkCurve,data);
    applyPlacedAssets(data);
  });
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
    // Skip reversed segments — fold-back on tight inner corners creates a loop
    if((c1x-c0x)*(p1.x-p0.x)+(c1z-c0z)*(p1.z-p0.z)<=0) continue;
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

  const leftWalls=[];
  const rightWalls=[];

  function intrudesTrackInterior(px,pz,segIndex){
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
      const expand0=side<0?(leftExpand[i]||0):(rightExpand[i]||0);
      const expand1=side<0?(leftExpand[i+1]||0):(rightExpand[i+1]||0);
      const off0=side*(rw/2+1.75+expand0);
      const off1=side*(rw/2+1.75+expand1);
      const b0x=p0.x+r0.x*off0,b0z=p0.z+r0.z*off0;
      const b1x=p1.x+r1.x*off1,b1z=p1.z+r1.z*off1;
      // Skip reversed segments — fold-back on tight inner corners creates a loop
      if((b1x-b0x)*(p1.x-p0.x)+(b1z-b0z)*(p1.z-p0.z)<=0) continue;
      let intersects=false;
      for(let s=0;s<emitted.length-2;s++){
        const e=emitted[s];
        if(segmentsIntersect2D(b0x,b0z,b1x,b1z,e.x0,e.z0,e.x1,e.z1)){
          intersects=true;
          break;
        }
      }
      if(intersects) continue;

      if(intrudesTrackInterior(b0x,b0z,i)||intrudesTrackInterior(b1x,b1z,i)) continue;
      emitted.push({x0:b0x,z0:b0z,x1:b1x,z1:b1z});

      if(side<0) leftWalls.push({x0:b0x,z0:b0z,x1:b1x,z1:b1z});
      else rightWalls.push({x0:b0x,z0:b0z,x1:b1x,z1:b1z});

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

  state.trkWallLeft=leftWalls;
  state.trkWallRight=rightWalls;
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

function pointInZoneList(zones,px,pz,pad=0){
  return zones.some(z=>{ const dx=px-z.x,dz=pz-z.z,r=(z.r||18)+pad; return dx*dx+dz*dz<=r*r; });
}

export function getTrackSceneryExclusionZones(data){
  const zones=[];
  const sf=data&&Array.isArray(data.wp)&&data.wp[0]?data.wp[0]:null;
  if(sf) zones.push({x:sf[0],z:sf[2],r:18});
  if(Array.isArray(data?.wp)&&data.wp.length){
    const last=data.wp[data.wp.length-1];
    if(last) zones.push({x:last[0],z:last[2],r:16});
  }
  const noAuto=(data&&data.noAutoZones)||[];
  noAuto.forEach(z=>zones.push({x:z.x,z:z.z,r:z.r||18}));
  return zones;
}

function pointInsideSceneryExclusion(data,px,pz,pad=0){
  const zones=(state.sceneryExclusionZones&&state.sceneryExclusionZones.length)
    ? state.sceneryExclusionZones
    : getTrackSceneryExclusionZones(data);
  if(pointNearTrack(data,px,pz,pad)) return true;
  return pointInZoneList(zones,px,pz,pad);
}

export function canPlaceDecorAsset(data,px,pz,{exclusionPad=4,startBuffer=28}={}){
  if(pointInsideSceneryExclusion(data,px,pz,exclusionPad)) return false;
  const sf=data&&Array.isArray(data.wp)&&data.wp[0]
    ? data.wp[0]
    : null;
  if(!sf) return true;
  const dx=px-sf[0], dz=pz-sf[2];
  return dx*dx+dz*dz>=startBuffer*startBuffer;
}


function getEditorRunoffMultipliers(data,pts){
  const editorNodes=Array.isArray(data?.editorNodes)?data.editorNodes:[];
  if(!editorNodes.length||pts.length<2) return null;
  const multipliers=new Array(pts.length).fill(1);
  const nodeEntries=editorNodes.map(node=>({
    x:+node.x||0,
    z:+node.z||0,
    multiplier:Math.max(0,Math.min(4,(Number.isFinite(node.gravelPitSize)?(+node.gravelPitSize):100)/100))
  }));
  if(!nodeEntries.length) return null;
  for(let i=0;i<pts.length;i++){
    const p=pts[i];
    let bestDist2=Infinity;
    let bestMult=1;
    for(const node of nodeEntries){
      const dx=p.x-node.x;
      const dz=p.z-node.z;
      const dist2=dx*dx+dz*dz;
      if(dist2<bestDist2){
        bestDist2=dist2;
        bestMult=node.multiplier;
      }
    }
    multipliers[i]=bestMult;
  }
  return multipliers;
}

function getEditorRunoffAbsoluteSides(data,pts){
  const editorNodes=Array.isArray(data?.editorNodes)?data.editorNodes:[];
  if(!editorNodes.length||pts.length<2) return null;
  const leftSizes=new Array(pts.length).fill(0);
  const rightSizes=new Array(pts.length).fill(0);
  const nodeEntries=editorNodes.map(node=>({
    x:+node.x||0,
    z:+node.z||0,
    left:Math.max(0,Math.min(20,Number.isFinite(node.gravelLeft)?(+node.gravelLeft):0)),
    right:Math.max(0,Math.min(20,Number.isFinite(node.gravelRight)?(+node.gravelRight):0))
  }));
  for(let i=0;i<pts.length;i++){
    const p=pts[i];
    let bestDist2=Infinity, bestLeft=0, bestRight=0;
    for(const node of nodeEntries){
      const dx=p.x-node.x, dz=p.z-node.z;
      const dist2=dx*dx+dz*dz;
      if(dist2<bestDist2){ bestDist2=dist2; bestLeft=node.left; bestRight=node.right; }
    }
    leftSizes[i]=bestLeft;
    rightSizes[i]=bestRight;
  }
  return {leftSizes,rightSizes};
}

function buildRunoffProfile(pts,data){
  const n=pts.length;
  if(n<6) return null;
  const generationVersion=Number.isFinite(data?.trackGenerationVersion)
    ? Math.max(1,Math.floor(data.trackGenerationVersion))
    : 1;
  if(generationVersion<2) return null;
  // Only exclude start/finish area — noAutoZones are for scenery (trees/buildings) only,
  // not gravel. Including them would suppress gravel across the entire track on custom tracks.
  const zones=[];
  const sf=data&&Array.isArray(data.wp)&&data.wp[0]?data.wp[0]:null;
  if(sf) zones.push({x:sf[0],z:sf[2],r:28});
  const leftExpand=new Array(Math.max(0,n-1)).fill(0);
  const rightExpand=new Array(Math.max(0,n-1)).fill(0);
  const leftRunoff=new Array(Math.max(0,n-1)).fill(0);
  const rightRunoff=new Array(Math.max(0,n-1)).fill(0);
  const runoffNodes=[];
  const rw=Math.max(6,data.rw||12);
  const nodeRunoffMultipliers=getEditorRunoffMultipliers(data,pts);
  const absoluteSides=getEditorRunoffAbsoluteSides(data,pts);

  // Always generate a baseline gravel strip around the track. The strip widens
  // with local curvature, while node boosts below keep the larger "outside of
  // corner" behavior from before.
  for(let i=1;i<n-2;i++){
    const pPrev=pts[i-1], pCur=pts[i], pNext=pts[i+1];
    const inX=pCur.x-pPrev.x, inZ=pCur.z-pPrev.z;
    const outX=pNext.x-pCur.x, outZ=pNext.z-pCur.z;
    const inLen=Math.hypot(inX,inZ)||1, outLen=Math.hypot(outX,outZ)||1;
    const dot=(inX*outX+inZ*outZ)/(inLen*outLen);
    const curvature=Math.max(0,Math.min(1,(0.995-dot)/0.30));
    const easedCurvature=curvature*curvature*(3-2*curvature);
    const nodeMultiplier=nodeRunoffMultipliers?.[i]??1;
    const baseRunoff=rw*(0.14+easedCurvature*0.78)*nodeMultiplier;
    const baseExpand=baseRunoff;

    const p=pts[i];
    if(pointInZoneList(zones,p.x,p.z,10)) continue;
    // Apply absolute left/right meter sizes from node sliders
    const absLeft=absoluteSides?absoluteSides.leftSizes[i]:0;
    const absRight=absoluteSides?absoluteSides.rightSizes[i]:0;
    leftRunoff[i]=Math.max(leftRunoff[i],baseRunoff,absLeft);
    rightRunoff[i]=Math.max(rightRunoff[i],baseRunoff,absRight);
    leftExpand[i]=Math.max(leftExpand[i],baseExpand,absLeft);
    rightExpand[i]=Math.max(rightExpand[i],baseExpand,absRight);
  }

  // pts is ~900 densely spaced spline points; stride samples ~15 units apart
  // so corner angles are measurable (consecutive pts are only ~1 unit apart).
  // Threshold lowered to 0.97 (from 0.80) so gentler bends also get extra runoff.
  const CORNER_THRESHOLD=0.97;
  const stride=Math.max(1,Math.round(n/60));
  for(let i=stride;i<n-stride-1;i++){
    const pPrev=pts[i-stride], pCur=pts[i], pNext=pts[i+stride];
    const inX=pCur.x-pPrev.x, inZ=pCur.z-pPrev.z;
    const outX=pNext.x-pCur.x, outZ=pNext.z-pCur.z;
    const inLen=Math.hypot(inX,inZ)||1, outLen=Math.hypot(outX,outZ)||1;
    const dot=(inX*outX+inZ*outZ)/(inLen*outLen);
    if(dot>CORNER_THRESHOLD) continue;
    const turn=Math.sign(inX*outZ-inZ*outX)||1;
    const side=turn>0?-1:1;
    const sharp=Math.min(1,Math.max(0,(CORNER_THRESHOLD-dot)/(CORNER_THRESHOLD+1)));
    const nodeMultiplier=nodeRunoffMultipliers?.[i]??1;
    const width=Math.min(rw*2.8*nodeMultiplier,rw*(0.25+sharp*2.5)*nodeMultiplier);
    const cornerLen=Math.max(12,Math.min(50,Math.round(12+sharp*38)));
    const leadIn=Math.max(4,Math.round(cornerLen*0.3));
    const start=Math.max(1,Math.min(n-3,i-leadIn));
    const peak=Math.min(n-3,i+Math.round(cornerLen*0.2));
    const end=Math.min(n-2,start+cornerLen);
    runoffNodes.push({index:i,side,start,peak,end,width,sharp});
  }

  for(const node of runoffNodes){
    for(let j=node.start;j<=node.end;j++){
      const p=pts[j];
      if(pointInZoneList(zones,p.x,p.z,10)) continue;
      const riseLen=Math.max(1,node.peak-node.start);
      const fallLen=Math.max(1,node.end-node.peak);
      const riseT=Math.max(0,Math.min(1,(j-node.start)/riseLen));
      const fallT=Math.max(0,Math.min(1,(j-node.peak)/fallLen));
      // Smoother quintic easing for gradual thickness buildup
      const rampIn=riseT*riseT*riseT*(riseT*(riseT*6-15)+10);
      const rampOut=1-(fallT*fallT*fallT*(fallT*(fallT*6-15)+10));
      const blend=(j<=node.peak)?rampIn:rampOut;
      const runoffW=node.width*blend;
      const wallExpand=runoffW;
      if(node.side<0){
        leftRunoff[j]=Math.max(leftRunoff[j],runoffW);
        leftExpand[j]=Math.max(leftExpand[j],wallExpand);
      }else{
        rightRunoff[j]=Math.max(rightRunoff[j],runoffW);
        rightExpand[j]=Math.max(rightExpand[j],wallExpand);
      }
    }
  }

  // More smoothing passes for a gradual, natural thickness transition
  for(const arr of [leftRunoff,rightRunoff,leftExpand,rightExpand]){
    for(let pass=0;pass<8;pass++){
      for(let j=1;j<arr.length-1;j++) arr[j]=(arr[j-1]+arr[j]+arr[j+1])/3;
    }
  }

  const hasRunoff=leftRunoff.some(v=>v>0.05)||rightRunoff.some(v=>v>0.05);
  if(!hasRunoff) return null;
  return {pts,leftRunoff,rightRunoff,leftExpand,rightExpand,rw,nodes:runoffNodes};
}

function addGravelRunoff(profile){
  const {pts,rw,leftRunoff,rightRunoff}=profile;
  const n=pts.length;
  const verts=[]; const idx=[];
  let vi=0;
  const y=0.011;

  const appendSide=(side,widths)=>{
    for(let i=1;i<n-2;i++){
      const w0=widths[i]||0;
      const w1=widths[i+1]||0;
      if(w0<0.05&&w1<0.05) continue;
      const p0=pts[i], p1=pts[i+1];
      const t0=new THREE.Vector3().subVectors(pts[(i+1)%n],pts[(i-1+n)%n]).normalize();
      const t1=new THREE.Vector3().subVectors(pts[(i+2)%n],pts[i]).normalize();
      const r0=new THREE.Vector3(-t0.z,0,t0.x).normalize();
      const r1=new THREE.Vector3(-t1.z,0,t1.x).normalize();
      const inner=rw/2+1.75;
      const in0=new THREE.Vector3(p0.x+r0.x*side*inner,y,p0.z+r0.z*side*inner);
      const out0=new THREE.Vector3(p0.x+r0.x*side*(inner+w0),y,p0.z+r0.z*side*(inner+w0));
      const in1=new THREE.Vector3(p1.x+r1.x*side*inner,y,p1.z+r1.z*side*inner);
      const out1=new THREE.Vector3(p1.x+r1.x*side*(inner+w1),y,p1.z+r1.z*side*(inner+w1));
      if(segmentsIntersect2D(in0.x,in0.z,in1.x,in1.z,out0.x,out0.z,out1.x,out1.z)) continue;
      verts.push(in0.x,in0.y,in0.z, out0.x,out0.y,out0.z, out1.x,out1.y,out1.z, in1.x,in1.y,in1.z);
      idx.push(vi,vi+1,vi+2,vi,vi+2,vi+3);
      vi+=4;
    }
  };

  appendSide(-1,leftRunoff);
  appendSide(1,rightRunoff);
  if(!verts.length) return;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({color:0x6f6752,side:THREE.DoubleSide,fog:false}));
  mesh.userData.trk=true;
  mesh.receiveShadow=true;
  scene.add(mesh);
}

