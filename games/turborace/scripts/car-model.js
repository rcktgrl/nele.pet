import { THREE } from './three.js';
import { mat, matE, matT } from './render/materials.js';

export function getPlayerCarModel(cars, selectedCarIndex){
  return cars[selectedCarIndex];
}

export function getOpponentCarModels(cars, selectedCarIndex, count=4){
  const aiIdx=[0,1,2,3].filter(i=>i!==selectedCarIndex);
  const models=[];
  for(let i=0;i<count;i++) models.push(cars[aiIdx[i%aiIdx.length]]);
  return models;
}

export function createCarVisual(data){
  const builder=new CarModelBuilder(data);
  const mesh=builder.buildMesh();
  return { mesh, tailLights:builder.tl, wheels:builder.wh };
}

class CarModelBuilder{
  constructor(data){
    this.data=data;
    this.tl=[];
    this.wh=[];
  }
  buildMesh(){
    switch(this.data.id){
      case 0: return this.buildWedgeMesh();
      case 2: return this.buildJeepMesh();
      case 3: return this.buildHatchMesh();
default: return this.buildSportsMesh();
    }
  }

  // ── Existing sports coupe (Thunder V8) ──────────────
  buildSportsMesh(){
    const g=new THREE.Group(), C=this.data.col;
    const Bm=mat(C), Dm=mat(0x111111), Gm=matT(0x7799bb,.55), Wm=mat(0x111111), Rm=mat(0x777777);
    const Lm=matE(0xffee88,0x443300), TLm=matE(0xee1100,0x220000);
    addB(g,1.8,.48,4.0,0,.44,0,Bm); addB(g,1.38,.48,1.78,0,.93,.08,Bm);
    addB(g,1.28,.42,.06,0,.93,.98,Gm,0.22,0,0); addB(g,1.28,.38,.06,0,.90,-.82,Gm,-.18,0,0);
    [-1,1].forEach(s=>addB(g,.1,.18,3.6,s*.95,.28,0,Dm));
    addB(g,1.9,.07,.42,0,.21,2.1,Dm); addB(g,1.72,.08,.44,0,1.1,-1.78,Dm);
    [-.62,.62].forEach(x=>addB(g,.08,.34,.08,x,.93,-1.78,Dm));
    [-.56,.56].forEach(x=>addB(g,.38,.13,.05,x,.54,2.02,Lm));
    this.tl=[];[-.56,.56].forEach(x=>{const m=matE(0xee1100,0x220000);const t=addB(g,.38,.11,.05,x,.54,-2.02,m);this.tl.push(t);});
    this.wh=wheels(g,Wm,Rm,.33,.20,.26,.28,[[-1,1.32],[1,1.32],[-1,-1.32],[1,-1.32]]);
    return g;
  }

  // ── Lamborghini-style low wedge (Viper GT) ──────────
  buildWedgeMesh(){
    const g=new THREE.Group(), C=this.data.col;
    const Bm=mat(C), Dm=mat(0x0e0e0e), Gm=matT(0x66aacc,.50), Wm=mat(0x0e0e0e), Rm=mat(0x666666);
    const Lm=matE(0xffffaa,0x554400), TLm=matE(0xff1100,0x330000);
    // Splitter / nosecone (very low)
    addB(g,1.75,.08,.9,0,.20,2.05,Dm);
    // Front hood – steps up in stages to create wedge profile
    addB(g,1.88,.16,1.0,0,.26,1.52,Bm);
    addB(g,1.92,.26,1.4,0,.34,.6,Bm);
    // Main body slab
    addB(g,2.0,.30,2.4,0,.40,-.2,Bm);
    // Rear haunches (wider)
    addB(g,2.06,.38,1.0,0,.40,-1.6,Bm);
    // Cabin – very low and flat
    addB(g,1.30,.22,1.65,0,.74,.05,Bm);
    addB(g,1.35,.07,1.72,0,.88,.05,Dm); // roof cap
    // Very raked windscreen
    const ws=addB(g,1.22,.35,.06,0,.80,.88,Gm,0.58,0,0);
    addB(g,1.22,.28,.06,0,.80,-.75,Gm,-.48,0,0); // rear glass
    // Side air intakes (scoops)
    [-1,1].forEach(s=>{addB(g,.12,.3,.75,s*1.02,.58,-.40,Dm); addB(g,.06,.3,.7,s*1.04,.58,-.40,Dm);});
    // Diffuser
    addB(g,2.0,.14,.55,0,.28,-2.1,Dm);
    // Rear wing + endplates
    addB(g,1.88,.06,.65,0,1.06,-1.88,Dm);
    [-.9,.9].forEach(x=>addB(g,.07,.38,.67,x,.87,-1.88,Dm));
    // Wing standoffs
    [-.6,.6].forEach(x=>addB(g,.06,.32,.06,x,.88,-1.88,Dm));
    // Hood vents
    [-0.4,0,0.4].forEach(x=>addB(g,.36,.04,.5,x,.50,1.0,Dm));
    // Side skirts
    [-1,1].forEach(s=>addB(g,.08,.14,3.4,s*1.02,.24,0,Dm));
    // Headlights – thin horizontal slits
    [-.58,.58].forEach(x=>{addB(g,.52,.07,.05,x,.38,2.01,Lm);});
    // LED strip headlight accent
    addB(g,1.4,.03,.05,0,.34,2.01,Lm);
    this.tl=[];
    [-.62,.62].forEach(x=>{const m=matE(0xff1100,0x330000);const t=addB(g,.5,.07,.05,x,.38,-2.01,m);this.tl.push(t);});
    // Wide LED strip tail
    addB(g,1.5,.03,.05,0,.34,-2.01,matE(0xff1100,0x220000));
    // Wheels – wide and low profile
    this.wh=wheels(g,Wm,Rm,.32,.24,.30,.32,[[-1.05,1.38],[1.05,1.38],[-1.05,-1.38],[1.05,-1.38]]);
    return g;
  }

  // ── Jeep / off-road (Rally Storm) ───────────────────
  buildJeepMesh(){
    const g=new THREE.Group(), C=this.data.col;
    const Bm=mat(C), Dm=mat(0x181818), Gm=matT(0x88aacc,.52), Wm=mat(0x181818), Rm=mat(0x555555);
    const Lm=matE(0xffffcc,0x443300), TLm=matE(0xff2200,0x330000);
    // High chassis body
    addB(g,1.88,.65,3.75,0,.82,0,Bm);
    // Tall boxy cabin
    addB(g,1.78,.92,2.35,0,1.60,-.04,Bm);
    // Separate flat hood with slight raise
    addB(g,1.76,.20,1.45,0,1.23,1.20,Bm);
    // Windscreen – upright
    addB(g,1.62,.72,.07,0,1.58,1.10,Gm,.06,0,0);
    addB(g,1.62,.62,.07,0,1.58,-1.10,Gm,-.06,0,0); // rear window
    // Side windows
    [-1,1].forEach(s=>addB(g,.07,.60,2.0,s*.90,1.62,-.04,Gm));
    // Roof rack frame
    addB(g,1.84,.06,2.4,0,2.09,-.04,Dm);
    [-.88,.88].forEach(x=>addB(g,.06,.06,2.3,x,2.09,-.04,Dm));
    [-0.9,0.9].forEach(z=>addB(g,1.8,.06,.07,0,2.09,z,Dm));
    // Bull bar
    addB(g,1.72,.54,.1,0,.90,1.97,Dm);
    [-.62,0,.62].forEach(x=>addB(g,.08,.64,.20,x,.86,1.88,Dm));
    // Horizontal bull-bar bars
    [.25,.65].forEach(y=>addB(g,1.6,.07,.07,0,y,1.93,Dm));
    // Side steps
    [-1,1].forEach(s=>addB(g,.16,.14,3.0,s*1.08,.50,0,Dm));
    // Fender flares
    [[-1,1.12],[1,1.12],[-1,-1.12],[1,-1.12]].forEach(([sx,sz])=>addB(g,.20,.32,.88,sx*1.04,.82,sz,Dm));
    // Snorkel (right side)
    addB(g,.11,1.25,.11,.92,1.6,1.1,Dm);
    addB(g,.22,.11,.11,.92,2.24,1.1,Dm); // elbow cap
    // Spare tire on rear
    const sp=new THREE.Mesh(new THREE.CylinderGeometry(.44,.44,.24,10),Wm);
    sp.rotation.z=Math.PI/2; sp.position.set(0,1.48,-2.06); g.add(sp);
    const sc=new THREE.Mesh(new THREE.CylinderGeometry(.30,.30,.26,8),Rm);
    sc.rotation.z=Math.PI/2; sc.position.set(0,1.48,-2.06); g.add(sc);
    // Headlights – square/round
    [-.56,.56].forEach(x=>addB(g,.40,.40,.06,x,1.06,1.93,Lm));
    this.tl=[];
    [-.56,.56].forEach(x=>{const m=matE(0xff2200,0x330000);const t=addB(g,.38,.30,.06,x,1.06,-1.93,m);this.tl.push(t);});
    // Extra brake lights strip
    addB(g,1.6,.07,.06,0,.80,-1.93,matE(0xff0000,0x220000));
    // Big off-road wheels
    this.wh=wheels(g,Wm,Rm,.48,.32,.30,.36,[[-1.04,1.12],[1.04,1.12],[-1.04,-1.12],[1.04,-1.12]],0.18);
    return g;
  }

  // ── Hatchback (Flash Hatch) ─────────────────────────
  buildHatchMesh(){
    const g=new THREE.Group(), C=this.data.col;
    const Bm=mat(C), Dm=mat(0x111111), Gm=matT(0x7799bb,.55), Wm=mat(0x111111), Rm=mat(0x666666);
    const Lm=matE(0xffee88,0x443300);
    // Main body — compact, short
    addB(g,1.65,.45,3.2,0,.48,0,Bm);
    // Cabin — taller, boxy hatchback shape
    addB(g,1.50,.50,1.8,0,.98,-.15,Bm);
    // Roof
    addB(g,1.48,.06,1.7,0,1.24,-.15,Dm);
    // Windscreen — moderately raked
    addB(g,1.38,.42,.06,0,.92,.78,Gm,0.30,0,0);
    // Rear hatch glass — steep angle (hatchback signature)
    addB(g,1.38,.45,.06,0,.92,-1.0,Gm,-.55,0,0);
    // Side windows
    [-1,1].forEach(s=>addB(g,.06,.38,1.5,s*.76,.98,-.15,Gm));
    // Hood
    addB(g,1.60,.10,1.0,0,.72,1.12,Bm);
    // Front bumper
    addB(g,1.68,.22,.35,0,.32,1.68,Dm);
    // Rear bumper
    addB(g,1.68,.22,.30,0,.32,-1.68,Dm);
    // Side skirts
    [-1,1].forEach(s=>addB(g,.06,.16,2.8,s*.84,.30,0,Dm));
    // Small rear spoiler
    addB(g,1.30,.06,.30,0,1.26,-1.0,Dm);
    // Headlights — round-ish
    [-.52,.52].forEach(x=>addB(g,.35,.18,.05,x,.52,1.62,Lm));
    // Taillights
    this.tl=[];
    [-.52,.52].forEach(x=>{const m=matE(0xee1100,0x220000);const t=addB(g,.30,.15,.05,x,.52,-1.62,m);this.tl.push(t);});
    // Wheels — small, sporty
    this.wh=wheels(g,Wm,Rm,.30,.18,.24,.26,[[-0.85,1.15],[0.85,1.15],[-0.85,-1.15],[0.85,-1.15]]);
    return g;
  }
}

function addB(g,w,h,d,x,y,z,m,rx,ry,rz){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);
  mesh.position.set(x,y,z);
  if(rx)mesh.rotation.x=rx;
  if(ry)mesh.rotation.y=ry;
  if(rz)mesh.rotation.z=rz;
  g.add(mesh); return mesh;
}
function addC(g,rTop,rBot,h,x,y,z,m,rx,ry,rz){
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(rTop,rBot,h,12),m);
  mesh.position.set(x,y,z);
  if(rx)mesh.rotation.x=rx;
  if(ry)mesh.rotation.y=ry;
  if(rz)mesh.rotation.z=rz;
  g.add(mesh); return mesh;
}
function wheels(g,Wm,Rm,wr,ir,wt,it,positions,yOff){
  yOff=yOff||0;
  const wg=new THREE.CylinderGeometry(wr,wr,wt,12);
  const ig=new THREE.CylinderGeometry(ir,ir,it,8);
  const res=[];
  for(const[wx,wz]of positions){
    const wgrp=new THREE.Group();
    const w=new THREE.Mesh(wg,Wm); w.rotation.z=Math.PI/2; wgrp.add(w);
    const wh=new THREE.Mesh(ig,Rm); wh.rotation.z=Math.PI/2; wgrp.add(wh);
    wgrp.position.set(wx,yOff,wz); g.add(wgrp); res.push(wgrp);
  }
  return res;
}
