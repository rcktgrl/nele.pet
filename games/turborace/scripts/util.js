export function fmtT(s){
  const m=Math.floor(s/60),sc=Math.floor(s%60),ms=Math.floor((s%1)*1000);
  return`${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}