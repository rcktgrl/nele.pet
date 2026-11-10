/* the highway: heights and gaps along the viaduct */
GAME.enterFree();
const R = GAME.world.route('hwy'), n = R.count; let worst = [];
for (let i = 0; i < n; i++) { const d2 = (R.y[R.idx(i+1)] - 2*R.y[i] + R.y[R.idx(i-1)]) / (R.step*R.step); worst.push([Math.abs(d2), i]); }
worst.sort((a,b)=>b[0]-a[0]);
let sum = 0; for (const [v] of worst) sum += v*v;
const big = worst.filter(w=>w[0]>0.004).length;
let lift=0,mx=0; for(let i=0;i<n;i++){const h=R.y[i]-GAME.world.terrain.rawH(R.x[i],R.z[i]); lift+=h; mx=Math.max(mx,h);} return { lift:(lift/n).toFixed(1), mx:mx.toFixed(1), n, rms: Math.sqrt(sum/n).toFixed(5), over004: big, top: worst.slice(0,8).map(([v,i])=>[v.toFixed(4), Math.round(R.x[i]), Math.round(R.z[i]), R.y[i].toFixed(1)]) };
