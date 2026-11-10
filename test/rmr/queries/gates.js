/* heights of the river race gates */
GAME.enterFree(); GAME.story.mode = 'free'; await wait(800); const W = GAME.world, T = W.terrain, R = W.route('river'), out = [];
const nG = Math.max(4, Math.round(R.length / 320)), S = []; for (let i = 1; i < nG; i++) S.push(R.length * i / nG); S.push(2, R.length - 40);
for (const s of S) { const p = R.posAt(s, {}); out.push(`s${s.toFixed(0)} (${p.x.toFixed(0)},${p.z.toFixed(0)}) h ${T.height(p.x, p.z).toFixed(1)} h-1 ${T.probe(-1, () => T.height(p.x, p.z)).toFixed(1)} water ${T.waterY(p.x, p.z).toFixed(1)} tun ${T.riverTunAt(p.x, p.z) ? 'Y' : '-'} wet ${T.riverTunWet(p.x, p.z) ? 'Y' : '-'}`); }
out.push('ceil ' + RIVER.tunnel.ceil + ' hw ' + RIVER.tunnel.hw + ' len ' + R.length.toFixed(0));
return out.join('\n');
