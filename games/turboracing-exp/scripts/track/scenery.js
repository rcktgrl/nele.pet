import { mat, matE } from '../render/materials.js';
import { state, scene } from '../state.js';
import { THREE } from '../three.js';
import { canPlaceDecorAsset } from '../track-gen.js';

function distPointToSegment2(px,pz,ax,az,bx,bz){
  const abx=bx-ax, abz=bz-az;
  const apx=px-ax, apz=pz-az;
  const ab2=abx*abx+abz*abz||1;
  const t=Math.max(0,Math.min(1,(apx*abx+apz*abz)/ab2));
  const qx=ax+abx*t, qz=az+abz*t;
  return (px-qx)*(px-qx)+(pz-qz)*(pz-qz);
}

function pointNearTrack(data,px,pz,margin=0){
  const pts=(Array.isArray(data.splinePts)&&data.splinePts.length>=3)?data.splinePts:data.wp;
  const rw=(data.rw||12)/2+margin;
  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length];
    if(distPointToSegment2(px,pz,a[0],a[2],b[0],b[2])<=rw*rw) return true;
  }
  return false;
}

function pointInZoneList(zones,px,pz,pad=0){
  return (zones||[]).some(z=>((px-z.x)**2+(pz-z.z)**2)<=((z.r||0)+pad)*((z.r||0)+pad));
}


function pointInNoAutoZone(data,px,pz,pad=0){
  return pointInZoneList(data.noAutoZones,px,pz,pad);
}

function getTrackSceneryExclusionZones(data){
  const zones=[];
  if(Array.isArray(data.assets)) for(const a of data.assets){ if(a&&a.kind==='scenery-blocker') zones.push({x:+a.x||0,z:+a.z||0,r:Math.max(4,+a.radius||12)}); }
  if(Array.isArray(data.noAutoZones)) for(const z of data.noAutoZones){ if(z) zones.push({x:+z.x||0,z:+z.z||0,r:Math.max(4,+z.r||12)}); }
  return zones;
}

function addScenery(curve,data){
  const pts=curve.getSpacedPoints(100);
  const tmk=mat(0x4a2810),tlv=mat(0x1e4a1e);
  const bmk=mat(0x2a2a3a),bmk2=mat(0x3a3a4a),bmk3=mat(0x222238);
  const roofMat=mat(0x333344);
  const standMat=mat(0x444455),standSeat=mat(0x995522);
  const resCols=[0x8b4a3a,0xc4b090,0xd8d0c8,0xc8b870,0xa8bc98,0xa49898,0xb0886a,0xc8c0b0];
  const roofCols=[0x3a3028,0x5a3020,0x282820,0x3a2a20,0x4a3828,0x604030];
  const shopCols=[0xc8c0b0,0xb0a898,0xd8d0c0,0x888898,0xa8b0b8,0xb8c0a8];
  const minOff=data.rw/2+7.0;
  const placed=[];
  const exclusionZones=(state.sceneryExclusionZones&&state.sceneryExclusionZones.length)
    ? state.sceneryExclusionZones
    : getTrackSceneryExclusionZones(data);

  function onTrack(px,pz,margin){
    return pointNearTrack(data,px,pz,margin);
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
      if(!onTrack(tpos.x,tpos.z,2)&&!inExclusion(tpos.x,tpos.z,4)){
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
        if(!onTrack(tp2.x,tp2.z,2)&&!inExclusion(tp2.x,tp2.z,4)){
          tg2.position.set(tp2.x,p.y,tp2.z); tg2.rotation.y=Math.random()*Math.PI*2;
          tg2.userData.trk=true; scene.add(tg2);
        }
      }

      // ── Buildings (varied types) ──
      if(Math.random()<0.28){
        const bOff=s*(data.rw/2+16+Math.random()*14);
        const bpos=p.clone().addScaledVector(r,bOff);
        let bClose=false;
        for(const bl of placed){if((bpos.x-bl.x)**2+(bpos.z-bl.z)**2<144)bClose=true;}
        if(!bClose&&!onTrack(bpos.x,bpos.z,5)&&!inExclusion(bpos.x,bpos.z,6)){
          const bRot=Math.atan2(t.x,t.z)+Math.random()*0.3-0.15;
          const btype=Math.floor(Math.random()*6);
          if(btype<=1){
            // Residential house: box + pitched pyramid roof
            const bw=5+Math.random()*5, bd=4+Math.random()*4, bh=3+Math.random()*3.5;
            const bcol=resCols[Math.floor(Math.random()*resCols.length)];
            const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),mat(bcol));
            bld.position.set(bpos.x,p.y+bh/2,bpos.z); bld.rotation.y=bRot;
            bld.castShadow=true; bld.userData.trk=true; scene.add(bld);
            const roofH=bh*0.55, rcol=roofCols[Math.floor(Math.random()*roofCols.length)];
            const roof=new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(bw,bd)*0.55,roofH,4),mat(rcol));
            roof.position.set(bpos.x,p.y+bh+roofH/2,bpos.z); roof.rotation.y=bRot+Math.PI/4;
            roof.userData.trk=true; scene.add(roof);
          }else if(btype===2){
            // Terraced row house: narrow with pitched roof
            const bw=3.5+Math.random()*2.5, bd=4+Math.random()*3, bh=3.5+Math.random()*2.5;
            const bcol=resCols[Math.floor(Math.random()*resCols.length)];
            for(let u=0;u<2+Math.floor(Math.random()*3);u++){
              const off=new THREE.Vector3(-t.z,0,t.x).normalize().multiplyScalar(u*(bw+0.3)*s);
              const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),mat(bcol));
              bld.position.set(bpos.x+off.x,p.y+bh/2,bpos.z+off.z); bld.rotation.y=bRot;
              bld.castShadow=true; bld.userData.trk=true; scene.add(bld);
              const roofH=bh*0.45, rcol=roofCols[Math.floor(Math.random()*roofCols.length)];
              const roof=new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(bw,bd)*0.58,roofH,4),mat(rcol));
              roof.position.set(bpos.x+off.x,p.y+bh+roofH/2,bpos.z+off.z); roof.rotation.y=bRot+Math.PI/4;
              roof.userData.trk=true; scene.add(roof);
            }
          }else if(btype===3){
            // Corner shop / small commercial: wide flat
            const bw=8+Math.random()*6, bd=5+Math.random()*4, bh=3+Math.random()*2;
            const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),mat(shopCols[Math.floor(Math.random()*shopCols.length)]));
            bld.position.set(bpos.x,p.y+bh/2,bpos.z); bld.rotation.y=bRot;
            bld.castShadow=true; bld.userData.trk=true; scene.add(bld);
            const roof=new THREE.Mesh(new THREE.BoxGeometry(bw+0.5,0.22,bd+0.5),mat(0x555555));
            roof.position.set(bpos.x,p.y+bh+0.11,bpos.z); roof.userData.trk=true; scene.add(roof);
          }else if(btype===4){
            // Low garage / workshop
            const bw=7+Math.random()*5, bd=5+Math.random()*4, bh=2.5+Math.random()*1.5;
            const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),mat(0x909088));
            bld.position.set(bpos.x,p.y+bh/2,bpos.z); bld.rotation.y=bRot;
            bld.userData.trk=true; scene.add(bld);
            const roof=new THREE.Mesh(new THREE.BoxGeometry(bw+0.4,0.18,bd+0.4),mat(0x606060));
            roof.position.set(bpos.x,p.y+bh+0.09,bpos.z); roof.userData.trk=true; scene.add(roof);
          }else{
            // Industrial/office block (original style)
            const bw=4+Math.random()*6, bd=3+Math.random()*5, bh=4+Math.random()*8;
            const bm=[bmk,bmk2,bmk3][Math.floor(Math.random()*3)];
            const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),bm);
            bld.position.set(bpos.x,p.y+bh/2,bpos.z); bld.rotation.y=bRot;
            bld.castShadow=true; bld.userData.trk=true; scene.add(bld);
            const roof=new THREE.Mesh(new THREE.BoxGeometry(bw+0.3,0.3,bd+0.3),roofMat);
            roof.position.set(bpos.x,p.y+bh+0.15,bpos.z); roof.userData.trk=true; scene.add(roof);
          }
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
        stand.rotation.y=gang-Math.PI/2; stand.userData.trk=true; scene.add(stand);
        // Seat strips on slope
        const seatStrip=new THREE.Mesh(new THREE.BoxGeometry(gw,0.15,gd+0.1),standSeat);
        seatStrip.position.set(gpos.x-r.x*s*0.3,p.y+gh*0.45,gpos.z-r.z*s*0.3);
        seatStrip.rotation.y=gang-Math.PI/2;
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

  // ── 5. STREET LAMPS at checkpoint waypoints — one side, aligned with city walls ──
  // S/F exclusion zone — no lamps near start/finish
  const sfPt=curve.getPoint(0);
  const sfExclude=15;

  const wps=data.wp, nwp=wps.length;
  for(let i=0;i<nwp;i++){
    const w=wps[i];
    // Skip if near start/finish
    if(Math.hypot(w[0]-sfPt.x,w[2]-sfPt.z)<sfExclude)continue;
    const prev=wps[(i-1+nwp)%nwp],next=wps[(i+1)%nwp];
    const tx=next[0]-prev[0],tz=next[2]-prev[2];
    const tl=Math.sqrt(tx*tx+tz*tz)||1;
    const rx=-tz/tl, rz=tx/tl; // right-side normal
    // One side only, at wall edge
    const off=roadW/2+swW;
    const lx=w[0]+rx*off, lz=w[2]+rz*off;
    let inBld=false;
    for(const b of placed){if(Math.abs(lx-b.x)<b.w/2+1&&Math.abs(lz-b.z)<b.d/2+1){inBld=true;break;}}
    if(inBld)continue;
    // Pole on sidewalk at wall edge
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,6.5,5),poleMat);
    pole.position.set(lx,3.25,lz); pole.userData.trk=true; scene.add(pole);
    // Arm extends inward over road
    const armDx=-rx*2.0, armDz=-rz*2.0;
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.05,.05,2.8),poleMat);
    arm.position.set(lx+armDx*0.4,6.3,lz+armDz*0.4);
    arm.rotation.y=Math.atan2(rx,rz); arm.userData.trk=true; scene.add(arm);
    const bx2=lx+armDx, bz2=lz+armDz;
    const bulb=new THREE.Mesh(new THREE.BoxGeometry(.6,.12,.35),bulbMat);
    bulb.position.set(bx2,6.2,bz2); bulb.userData.trk=true; scene.add(bulb);
    // Yellow transparent pool on road surface
    const pool=new THREE.Mesh(poolGeo,poolMat);
    pool.rotation.x=-Math.PI/2;
    pool.position.set(w[0],0.06,w[2]);
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
    if(!canPlaceDecorAsset(data,asset.x,asset.z)) return;
    if(asset.type==='tree'){
      const g=new THREE.Group();
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.32,2.2,6),mat(0x5a3418)); trunk.position.y=1.1; g.add(trunk);
      const crown=new THREE.Mesh(new THREE.ConeGeometry(1.4,3.5,7),mat(0x2e6b34)); crown.position.y=3.5; g.add(crown);
      g.position.set(asset.x,0,asset.z); g.userData.trk=true; scene.add(g);
    }else if(asset.type==='park'){
      const park=new THREE.Mesh(new THREE.BoxGeometry(16,0.08,16),new THREE.MeshLambertMaterial({color:0x295a2b})); park.position.set(asset.x,0.04,asset.z); park.userData.trk=true; scene.add(park);
    }else if(asset.type==='stand'){
      const pts=state.trkPts;
      if(!pts||!pts.length) return;
      let nearIdx=0,nearDist=Infinity;
      for(let j=0;j<pts.length;j++){
        const dx=pts[j].x-asset.x,dz=pts[j].z-asset.z;
        const d=dx*dx+dz*dz;
        if(d<nearDist){nearDist=d;nearIdx=j;}
      }
      const n=pts.length;
      const tp=pts[nearIdx],tnx=pts[(nearIdx+1)%n];
      const tx=new THREE.Vector3().subVectors(tnx,tp).normalize();
      const tr=new THREE.Vector3(-tx.z,0,tx.x);
      const gang=Math.atan2(tx.x,tx.z);
      const dotR=(asset.x-tp.x)*tr.x+(asset.z-tp.z)*tr.z;
      const sSign=dotR>=0?1:-1;
      const trackSide=sSign>0?-1:1;
      const gw=12,gd=5,gh=5;
      const verts=new Float32Array([
        -gw/2,0,trackSide*gd/2,   gw/2,0,trackSide*gd/2,
        -gw/2,0.3,trackSide*gd/2, gw/2,0.3,trackSide*gd/2,
        -gw/2,0,-trackSide*gd/2,  gw/2,0,-trackSide*gd/2,
        -gw/2,gh,-trackSide*gd/2, gw/2,gh,-trackSide*gd/2,
      ]);
      const sidx=[0,1,3,0,3,2, 4,6,7,4,7,5, 2,3,7,2,7,6, 0,4,5,0,5,1, 0,2,6,0,6,4, 1,5,7,1,7,3];
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.BufferAttribute(verts,3));
      geo.setIndex(sidx); geo.computeVertexNormals();
      const stand=new THREE.Mesh(geo,mat(0x444455));
      stand.position.set(asset.x,0,asset.z);
      stand.rotation.y=gang-Math.PI/2; stand.userData.trk=true; scene.add(stand);
      const seatStrip=new THREE.Mesh(new THREE.BoxGeometry(gw,0.15,gd+0.1),mat(0x995522));
      seatStrip.position.set(asset.x-tr.x*sSign*0.3,gh*0.45,asset.z-tr.z*sSign*0.3);
      seatStrip.rotation.y=gang-Math.PI/2;
      seatStrip.rotation.x=trackSide*Math.atan2(gh-0.3,gd)*0.3;
      seatStrip.userData.trk=true; scene.add(seatStrip);
    }else{
      const h=8+((Math.abs(asset.x)+Math.abs(asset.z))%18);
      const b=new THREE.Mesh(new THREE.BoxGeometry(8,h,8),new THREE.MeshLambertMaterial({color:0x4a445d})); b.position.set(asset.x,h/2,asset.z); b.castShadow=true; b.userData.trk=true; scene.add(b);
      const roof=new THREE.Mesh(new THREE.BoxGeometry(8.5,0.35,8.5),new THREE.MeshLambertMaterial({color:0x22242a})); roof.position.set(asset.x,h+.18,asset.z); roof.userData.trk=true; scene.add(roof);
    }
  });
}

export { addScenery, addCityScenery, applyPlacedAssets };
