/* gaps in the quay walls */
const zq = FLAT.z1 + 1.2, xq = FLAT.x1 + 1.2, S = GAME.world.scatter, gaps = [];
const has = (x, z) => (S.near(x, z) || []).some(o => o.type === 2 && o.kind === 'barrier' && o.r === 0.8 && Math.hypot((o.ax+o.bx)/2 - x, (o.az+o.bz)/2 - z) < 1);
for (let x = 4150; x < xq; x += 4) if (!has(x + 2, zq)) gaps.push(['S', x]);
for (let z = -760; z < zq; z += 4) if (!has(xq, z + 2)) gaps.push(['E', z]);
return { zq, xq, SLIP: [SLIP.x, SLIP.hw], gaps };
