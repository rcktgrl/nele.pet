/* Fingerprint of everything the renderer built: per top-level scene object, how many meshes, triangles and
   instances it holds and a checksum of all vertex positions. Run before and after a rendering refactor and
   compare the output (diff the two); identical output = the same scenery. Cars and particles are left out.
   A few blinking props still differ from run to run (one 12-triangle mesh more or less in a group): run the
   same code twice to see that noise, then judge the real diff against it. */
const DETAIL = false; // true: also list every top-level scene object, to find which one changed
const skip = new Set(); for (const v of GAME.views.values()) if (v.root) skip.add(v.root);
const sum = (arr) => { let h = 2166136261; const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let i = 0; i < u.length; i += 1) h = Math.imul(h ^ u[i], 16777619); return (h >>> 0).toString(16); };
const out = {}; const total = { objects: 0, meshes: 0, tris: 0, inst: 0, checksum: 0 };
GAME.gfx.scene.children.forEach((top, i) => {
  if (skip.has(top)) return;
  let meshes = 0, tris = 0, inst = 0, h = 0;
  top.traverse((o) => {
    if (o.isPoints || !o.geometry || !o.geometry.attributes.position) return;
    const g = o.geometry, p = g.attributes.position;
    meshes++; tris += Math.round((g.index ? g.index.count : p.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    if (o.isInstancedMesh) { inst += o.count; h ^= parseInt(sum(o.instanceMatrix.array.subarray(0, o.count * 16)), 16); }
    h ^= parseInt(sum(p.array), 16);
  });
  if (!meshes) return;
  total.objects++; total.meshes += meshes; total.tris += tris; total.inst += inst; total.checksum = (Math.imul(total.checksum, 31) + (h >>> 0)) >>> 0;
  if (DETAIL) out[`${String(i).padStart(3, '0')} ${top.name || top.type}`] = `${meshes} meshes, ${tris} tris, ${inst} inst, ${(h >>> 0).toString(16)}`;
});
out.TOTAL = total; out.materials = (() => { const s = new Set(); GAME.gfx.scene.traverse((o) => { for (const m of [].concat(o.material || [])) s.add(m); }); return s.size; })();
return out;
