# Car data guide

This folder contains the static gameplay data for TurboRacing Experimental.
Runtime logic should import from here instead of hiding content definitions inside `scripts/`.

## Adding a car

Every car entry in `cars.js` should contain:

- `id`: stable numeric id.
- `name`: player-facing car name.
- `desc`: short selection-screen description.
- `hex` / `col`: main body color in CSS and numeric Three.js form.
- `maxSpd`: top speed in m/s.
- `accel`: acceleration value used by the driving model.
- `brake`: braking strength.
- `hdl`: handling multiplier.
- `aiSpd`: AI pace multiplier.
- `gndOff`: visual ride height above sampled ground.
- `camH`: preferred chase/cockpit camera height.
- `stats`: normalized UI stats (`s`, `a`, `h`).
- `visual`: a reusable visual recipe.

## Designing the visual recipe

A `visual` object is assembled from declarative parts so new cars stay data-driven.

### Required sections

- `materialSet`: key into `CAR_MATERIALS`.
- `wheels`: wheel layout definition with radii, thickness, and wheel positions.
- `parts`: body parts rendered in order.
- `headlights`: emissive front light meshes.
- `taillights`: emissive rear light meshes used by brake-light updates.

### Supported part shapes

#### Box

```js
{
  shape: 'box',
  width: 1.5,
  height: 0.4,
  depth: 2.0,
  position: [0, 0.6, 0],
  material: 'body',
  rotation: [0, 0, 0],
}
```

#### Cylinder

```js
{
  shape: 'cylinder',
  radiusTop: 0.3,
  radiusBottom: 0.3,
  height: 0.2,
  position: [0, 1.0, -1.5],
  material: 'rim',
  rotation: [0, 0, Math.PI / 2],
}
```

## Available material aliases

- `body`
- `dark`
- `glass`
- `wheel`
- `rim`
- `headlight`
- `taillight`

## Good practices

- Keep stats and visuals for one car in the same object.
- Reuse wheel layouts and material sets when possible.
- Prefer multiple small parts over hidden procedural logic.
- If a new visual pattern repeats, extract a helper constant instead of duplicating arrays.
