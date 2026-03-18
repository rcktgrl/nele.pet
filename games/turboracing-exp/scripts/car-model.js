import { THREE } from './three.js';
import { mat, matE, matT } from './render/materials.js';
import { CAR_MATERIALS } from '../data/cars.js';

function buildMaterialPalette(carData) {
  const palette = CAR_MATERIALS[carData.visual?.materialSet] || CAR_MATERIALS.sports;

  return {
    body: mat(carData.col),
    dark: mat(palette.dark),
    glass: matT(palette.glass.color, palette.glass.opacity),
    wheel: mat(palette.wheel),
    rim: mat(palette.rim),
    headlight: matE(palette.headlight.color, palette.headlight.emissive),
    taillight: matE(palette.taillight.color, palette.taillight.emissive),
  };
}

function applyTransform(mesh, position = [0, 0, 0], rotation = [0, 0, 0]) {
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  return mesh;
}

function createPart(part, materials) {
  const material = materials[part.material || 'body'];
  const geometry = part.shape === 'cylinder'
    ? new THREE.CylinderGeometry(part.radiusTop, part.radiusBottom, part.height, 12)
    : new THREE.BoxGeometry(part.width, part.height, part.depth);

  return applyTransform(new THREE.Mesh(geometry, material), part.position, part.rotation);
}

function createWheelGroup(wheelLayout, materials, [x, z]) {
  const group = new THREE.Group();
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(wheelLayout.wheelRadius, wheelLayout.wheelRadius, wheelLayout.wheelThickness, 12),
    materials.wheel,
  );
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(wheelLayout.innerRadius, wheelLayout.innerRadius, wheelLayout.innerThickness, 8),
    materials.rim,
  );

  wheel.rotation.z = Math.PI / 2;
  rim.rotation.z = Math.PI / 2;
  group.add(wheel, rim);
  group.position.set(x, wheelLayout.yOffset || 0, z);

  return group;
}

function buildLightMeshes(group, parts, materials) {
  const meshes = [];
  for (const part of parts || []) {
    const mesh = createPart(part, materials);
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

export function createCarVisual(carData) {
  const group = new THREE.Group();
  const materials = buildMaterialPalette(carData);
  const visual = carData.visual || {};

  for (const part of visual.parts || []) {
    group.add(createPart(part, materials));
  }

  const tailLights = buildLightMeshes(group, visual.taillights, materials);
  buildLightMeshes(group, visual.headlights, materials);

  const wheels = (visual.wheels?.positions || []).map((position) => {
    const wheelGroup = createWheelGroup(visual.wheels, materials, position);
    group.add(wheelGroup);
    return wheelGroup;
  });

  return { mesh: group, tailLights, wheels };
}
