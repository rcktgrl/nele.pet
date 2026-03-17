'use strict';
import { THREE } from './three.js';
import { state, dc, dctx, mmctx, keys } from './state.js';
import { fmtT } from './util.js';
import { getGyroSteering, getGyroVisualSteer } from './touch-controls.js';

// ═══════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════
const ords=['TH','ST','ND','RD'];
function getOrd(n){return n>=1&&n<=3?ords[n]:ords[0];}

export function updateHUD(){
  if(!state.pCar||state.gState!=='racing')return;
  document.getElementById('speedNum').textContent=Math.round((state.pCar.isReversing?state.pCar.revSpd:state.pCar.spd)*3.6);
  document.getElementById('gearNum').textContent=state.pCar.gear===0?'R':state.pCar.gear;
  document.getElementById('lapVal').textContent=`${Math.min(state.pCar.lap+1,state.trkData.laps)} / ${state.trkData.laps}`;
  const totalCp=state.trkData.wp.length;
  document.getElementById('cpVal').textContent=`${state.pCar.cpPassed} / ${totalCp}`;
  document.getElementById('timer').textContent=fmtT(state.raceTime);
  const lapTimesEl=document.getElementById('lapTimes');
  if(state.pCar.lapTimes&&state.pCar.lapTimes.length){
    lapTimesEl.innerHTML=state.pCar.lapTimes.map((t,i)=>`L${i+1} ${fmtT(t)}`).join('<br>');
  }else{
    lapTimesEl.textContent='';
  }
  const all=[state.pCar,...state.aiCars].sort((a,b)=>b.totalProg-a.totalProg);
  const p=all.indexOf(state.pCar)+1;
  document.getElementById('posNum').innerHTML=`${p}<sup style="font-size:18px">${getOrd(p)}</sup>`;
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD (cockpit)
// ═══════════════════════════════════════════════════════
export function resizeDC(){dc.width=window.innerWidth;dc.height=window.innerHeight;}

export function drawDash(){
  if(state.camMode!=='cockpit'||!state.pCar)return;
  const W=dc.width,H=dc.height,ctx=dctx,ph=H*.3,py=H-ph;
  ctx.clearRect(0,0,W,H);
  const pg=ctx.createLinearGradient(0,py,0,H);
  pg.addColorStop(0,'rgba(8,8,18,.94)'); pg.addColorStop(1,'rgba(2,2,6,.98)');
  ctx.fillStyle=pg; ctx.fillRect(0,py,W,ph);
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,py,W,2);
  // Steering wheel
  const wr=ph*.66,wx=W/2,wy=H-ph*.07;
  const gyroVisual=getGyroVisualSteer();
  const keySteer=(keys['ArrowLeft']||keys['KeyA'])?-1:(keys['ArrowRight']||keys['KeyD'])?1:0;
  // Use raw gamma-based visual steer for the indicator so it tracks physical tilt smoothly
  const sa=(Math.abs(gyroVisual)>0.01?gyroVisual:keySteer)*0.35;
  ctx.save(); ctx.translate(wx,wy); ctx.rotate(sa);
  ctx.beginPath(); ctx.arc(0,0,wr,0,Math.PI*2); ctx.strokeStyle='#1e1e2e'; ctx.lineWidth=wr*.22; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,wr,0,Math.PI*2); ctx.strokeStyle='#2a2a3e'; ctx.lineWidth=wr*.14; ctx.stroke();
  for(const a of[0,2.094,4.189]){
    ctx.beginPath(); ctx.moveTo(Math.cos(a)*wr*.14,Math.sin(a)*wr*.14); ctx.lineTo(Math.cos(a)*wr*.82,Math.sin(a)*wr*.82);
    ctx.strokeStyle='#1c1c2c'; ctx.lineWidth=wr*.13; ctx.stroke();
    ctx.strokeStyle='#323248'; ctx.lineWidth=wr*.07; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0,0,wr*.16,0,Math.PI*2);
  ctx.fillStyle='#12121e'; ctx.fill(); ctx.strokeStyle='#333'; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle='#ff5500'; ctx.font=`bold ${wr*.16}px Orbitron,monospace`;
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('TR',0,0);
  ctx.restore();
  // Gauges
  const gr=Math.min(W*.12,ph*.42);
  const redline=state.pCar.redlineRpm||8000;
  const warnRpm=state.pCar.shiftWarnRpm||Math.round(redline*0.78);
  drawGauge(ctx,W*.2,py+ph*.5,gr,state.pCar.rpm,0,redline,warnRpm,'#ff3300','RPM',v=>(v/1000).toFixed(1)+'k');
  const mxK=Math.round(state.pCar.data.maxSpd*3.6*1.08);
  drawGauge(ctx,W*.8,py+ph*.5,gr,state.pCar.spd*3.6,0,mxK,mxK*.82,'#ffaa00','KM/H',v=>Math.round(v));
  // Gear
  ctx.font=`bold ${ph*.52}px Orbitron,monospace`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='#ffd700'; ctx.shadowColor='rgba(255,215,0,.5)'; ctx.shadowBlur=22;
  ctx.fillText(state.pCar.gear===0?'R':state.pCar.gear,W/2,py+ph*.52); ctx.shadowBlur=0;
  ctx.font=`${ph*.11}px Rajdhani,sans-serif`; ctx.fillStyle='#334'; ctx.fillText('GEAR',W/2,py+ph*.8);
  // Rev bar
  const bw=W*.32,bh=ph*.055,bx=(W-bw)/2,by=py+ph*.12;
  ctx.fillStyle='#0a0a14'; ctx.fillRect(bx,by,bw,bh);
  const rf=state.pCar.rpm/redline,rl=warnRpm/redline;
  for(let i=0;i<20;i++){
    const f=(i+1)/20;
    if(f<=rf){
      ctx.fillStyle=f<rl*.7?'#00aa44':f<rl?'#aaaa00':'#ff2200';
      ctx.fillRect(bx+(i/20)*bw+2,by+2,bw/20-3,bh-4);
    }
  }
}

export function drawGauge(ctx,cx,cy,r,val,mn,mx,warn,wCol,lbl,fmt){
  const sa=Math.PI*.75,ea=Math.PI*2.25,rng=ea-sa;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle='#090912'; ctx.fill();
  ctx.strokeStyle='#1a1a2a'; ctx.lineWidth=r*.06; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,r*.82,sa,ea); ctx.strokeStyle='#111120'; ctx.lineWidth=r*.18; ctx.stroke();
  const vf=Math.max(0,Math.min(1,(val-mn)/(mx-mn)));
  const va=sa+vf*rng,wf=(warn-mn)/(mx-mn),wa=sa+wf*rng;
  if(vf>0){
    const ne=Math.min(va,wa);
    if(ne>sa){ctx.beginPath();ctx.arc(cx,cy,r*.82,sa,ne);ctx.strokeStyle='#00cc55';ctx.lineWidth=r*.18;ctx.stroke();}
    if(va>wa){ctx.beginPath();ctx.arc(cx,cy,r*.82,wa,va);ctx.strokeStyle=wCol;ctx.lineWidth=r*.18;ctx.stroke();}
  }
  for(let i=0;i<=10;i++){
    const a=sa+(i/10)*rng,mj=i%2===0,i2=r*(mj?.59:.67),o=r*.73;
    ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*i2,cy+Math.sin(a)*i2); ctx.lineTo(cx+Math.cos(a)*o,cy+Math.sin(a)*o);
    ctx.strokeStyle=mj?'#666':'#333'; ctx.lineWidth=mj?2:1; ctx.stroke();
  }
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(va);
  ctx.beginPath(); ctx.moveTo(-r*.07,0); ctx.lineTo(r*.70,0);
  ctx.strokeStyle='#ff6622'; ctx.lineWidth=r*.04; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,r*.08,0,Math.PI*2); ctx.fillStyle='#222'; ctx.fill(); ctx.restore();
  ctx.font=`bold ${r*.28}px Orbitron,monospace`; ctx.fillStyle='#ddd';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(fmt(val),cx,cy+r*.14);
  ctx.font=`${r*.17}px Rajdhani,sans-serif`; ctx.fillStyle='#444466'; ctx.fillText(lbl,cx,cy+r*.46);
}

// ═══════════════════════════════════════════════════════
//  MINIMAP
// ═══════════════════════════════════════════════════════
export function drawMinimap(){
  if(!state.trkPts.length||!state.pCar)return;
  const ctx=mmctx,W=150,H=150;
  ctx.clearRect(0,0,W,H); ctx.fillStyle='rgba(0,0,0,.72)'; ctx.fillRect(0,0,W,H);
  let mx=-Infinity,nx=Infinity,mz=-Infinity,nz=Infinity;
  for(const p of state.trkPts){if(p.x>mx)mx=p.x;if(p.x<nx)nx=p.x;if(p.z>mz)mz=p.z;if(p.z<nz)nz=p.z;}
  const sc=Math.min(W/(mx-nx+24),H/(mz-nz+24))*.88;
  const ox=W/2-(nx+(mx-nx)/2)*sc,oz=H/2-(nz+(mz-nz)/2)*sc;
  const toM=(x,z)=>[x*sc+ox,z*sc+oz];
  ctx.beginPath();
  const[sx,sz]=toM(state.trkPts[0].x,state.trkPts[0].z); ctx.moveTo(sx,sz);
  for(const p of state.trkPts){const[px,pz]=toM(p.x,p.z);ctx.lineTo(px,pz);}
  ctx.closePath(); ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=5; ctx.stroke();
  ctx.strokeStyle='#1a1a2e'; ctx.lineWidth=2; ctx.stroke();
  for(const c of state.aiCars){
    const[ex,ez]=toM(c.pos.x,c.pos.z);
    ctx.beginPath(); ctx.arc(ex,ez,3.5,0,Math.PI*2);
    ctx.fillStyle='#'+c.data.col.toString(16).padStart(6,'0'); ctx.fill();
  }
  const[px,pz]=toM(state.pCar.pos.x,state.pCar.pos.z);
  ctx.beginPath(); ctx.arc(px,pz,5.5,0,Math.PI*2);
  ctx.fillStyle='#ffd700'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
}
