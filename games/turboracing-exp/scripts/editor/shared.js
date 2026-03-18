import { state } from '../state.js';

export function getAllTracks(){ return [...state.folderTracks, ...state.editorTracks]; }
export function getTrackById(id){ return getAllTracks().find(t=>String(t.id)===String(id))||getAllTracks()[0]; }

export function hexNumToCss(n){ return '#'+((n||0)&0xffffff).toString(16).padStart(6,'0'); }
export function cssToHexNum(s){ return parseInt(String(s||'#000000').replace('#',''),16)||0; }
export function deepClone(v){ return JSON.parse(JSON.stringify(v)); }

export function makeTimeOfDayPreset(mode){
  if(mode==='night') return {sky:0x06060c,gnd:0x0a0a14,ambient:0x667788,ambientIntensity:0.35,sun:0x8899bb,sunIntensity:0.58,fill:0x334466,fillIntensity:0.2};
  if(mode==='sunset') return {sky:0x462414,gnd:0x3a2616,ambient:0xffc6a0,ambientIntensity:0.42,sun:0xffb066,sunIntensity:0.92,fill:0x884466,fillIntensity:0.24};
  return {sky:0x0d1a2e,gnd:0x1a3018,ambient:0xffffff,ambientIntensity:0.55,sun:0xffffff,sunIntensity:1.1,fill:0x5566bb,fillIntensity:0.3};
}

export function makeEditableTrackFromGameTrack(src){
  const tod=src.timeOfDay||(src.type==='city'?'night':'day');
  const sourceNodes=Array.isArray(src.editorNodes)&&src.editorNodes.length>=3
    ? src.editorNodes
    : (Array.isArray(src.nodes)&&src.nodes.length>=3 ? src.nodes : (src.wp||[]).map(p=>({x:p[0],z:p[2]})));
  const rawPts=sourceNodes.map((n,i)=>({
    x:+n.x||0,
    z:+n.z||0,
    steepness:typeof n.steepness==='number'?n.steepness:40,
    gravelPitSize:Number.isFinite(n.gravelPitSize)?Math.max(0,Math.min(400,+n.gravelPitSize||100)):100,
    type:n.type||(i===0?'start-finish':'no-auto')
  }));
  const pts=[];
  for(const node of rawPts){
    const last=pts[pts.length-1];
    if(last&&last.x===node.x&&last.z===node.z) continue;
    pts.push(node);
  }
  if(pts.length&&!pts.some(n=>n.type==='start-finish')) pts[0].type='start-finish';
  return {
    id:src.id,name:src.name,desc:src.desc||'',laps:src.laps||3,rw:src.rw||12,previewColor:src.previewColor||'#44aaff',
    useBezier:src.useBezier!==false,timeOfDay:tod,groundColor:hexNumToCss(src.gnd||makeTimeOfDayPreset(tod).gnd),skyColor:hexNumToCss(src.sky||makeTimeOfDayPreset(tod).sky),
    streetGrid:src.type==='city',gridSize:src.gridSize||70,enableRunoff:src.enableRunoff!==false,
    trackGenerationVersion:Number.isFinite(src.trackGenerationVersion)?Math.max(1,Math.floor(src.trackGenerationVersion)):1,
    nodes:pts,assets:deepClone(src.assets||[]),scenerySeed:Number.isFinite(src.scenerySeed)?(src.scenerySeed>>>0):null,source:src.id,builtin:!!src.builtin
  };
}
