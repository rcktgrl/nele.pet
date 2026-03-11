# TurboRace Car 3D Model Construction and Detail Upgrade Analysis

## How car models are currently made

The cars are procedurally assembled in `games/turborace/scripts/game.js` inside the `Car` class.

- `buildMesh()` chooses one of four mesh builders based on `data.id`:
  - `buildWedgeMesh()` (`id: 0`)
  - `buildSportsMesh()` (default)
  - `buildJeepMesh()` (`id: 2`)
  - `buildHatchMesh()` (`id: 3`)
- Each builder returns a `THREE.Group` populated with simple primitives.

### Primitive approach

Most body parts are created with `addB(...)`, which creates a `THREE.Mesh(new THREE.BoxGeometry(...), material)` and optionally rotates it. This means the bodywork is mostly made from box segments (flat faces / hard edges).

Wheels use `wheels(...)` with `THREE.CylinderGeometry` for tire and rim meshes (12 radial segments for tires, 8 for rims), duplicated at wheel anchor positions.

### Material setup

Materials are intentionally simple and lightweight:

- `mat(color)` → `THREE.MeshLambertMaterial` for opaque surfaces
- `matT(color, opacity)` → transparent Lambert for windows
- `matE(color, emissive)` → emissive Lambert for lights

This keeps rendering cost low for multiple vehicles and supports lower-end devices.

## Can we make the cars more detailed with slopes and curves?

Yes. The current architecture is suitable for adding detail, and there are two practical levels of upgrade.

### Level 1: Better slopes with low risk (recommended first)

You can noticeably improve shape quality while keeping performance predictable by extending the existing box-assembly style:

1. Replace some rectangular panels with `THREE.ExtrudeGeometry` side profiles (hood, roofline, rear hatch).
2. Use a few `THREE.CapsuleGeometry` or low-segment `THREE.SphereGeometry` pieces for fenders and rounded corners.
3. Add chamfer-like detail using thin intermediary box strips at edge transitions.
4. Increase wheel radial segments slightly (e.g., 12 → 18) only for player car.

This keeps the procedural workflow and avoids major tooling changes.

### Level 2: True curved bodywork (highest fidelity)

For more realistic automotive curves:

1. Build each car shell as `THREE.LatheGeometry`, `THREE.Shape` + `ExtrudeGeometry`, or imported glTF meshes authored in Blender.
2. Keep collision/physics dimensions unchanged by using an invisible simplified bounding representation.
3. Add LOD meshes:
   - LOD0 (player close-up)
   - LOD1 (mid-distance AI)
   - LOD2 (far-distance simplified)

This gives much smoother slopes and complex curvature, but introduces content pipeline overhead.

## Constraints and trade-offs in this codebase

- Cars are instantiated for player + AI, so polygon growth multiplies quickly.
- Dynamic shadows are enabled globally, so extra triangles affect both rasterization and shadow map pass.
- Current meshes are grouped from many sub-meshes; if detail is increased, geometry merging should be considered to reduce draw calls.

## Practical recommendation for this project

A staged approach is best:

1. **Short term**: Keep procedural builders but add 20–40% more shaped parts (extrusions/rounded inserts) and slight wheel tessellation increase for player car only.
2. **Mid term**: Introduce optional high-detail mesh path for selected camera mode (cockpit/chase near distances).
3. **Long term**: Move to authored glTF meshes with LOD and baked textures while preserving current physics parameters from `cars.js`.

This yields visibly better slopes/curves without risking large performance regressions all at once.
