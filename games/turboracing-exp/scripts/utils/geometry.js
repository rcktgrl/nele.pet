export function nearestPointOnSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const segmentLengthSquared = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / segmentLengthSquared));

  return { x: ax + abx * t, z: az + abz * t };
}

export function nearestWallPoint(px, pz, walls) {
  if (!walls?.length) return null;

  let bestPoint = null;
  let bestDistanceSquared = Infinity;

  for (const wall of walls) {
    const point = nearestPointOnSegment(px, pz, wall.x0, wall.z0, wall.x1, wall.z1);
    const distanceSquared = (px - point.x) ** 2 + (pz - point.z) ** 2;

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestPoint = point;
    }
  }

  return bestPoint;
}

export function wrapAngle(angle) {
  return ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}
