import type { Vector3Like, QuaternionLike } from 'hytopia';

export function rotateVector(v: Vector3Like, q: QuaternionLike): Vector3Like {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function inverseRotateVector(v: Vector3Like, q: QuaternionLike): Vector3Like {
  return rotateVector(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
}

export function cross(a: Vector3Like, b: Vector3Like): Vector3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function getPointVelocity(
  vCM: Vector3Like,
  omega: Vector3Like,
  com: Vector3Like,
  pointWorld: Vector3Like
): Vector3Like {
  const r = { x: pointWorld.x - com.x, y: pointWorld.y - com.y, z: pointWorld.z - com.z };
  const omegaCrossR = cross(omega, r);
  return {
    x: vCM.x + omegaCrossR.x,
    y: vCM.y + omegaCrossR.y,
    z: vCM.z + omegaCrossR.z,
  };
}
