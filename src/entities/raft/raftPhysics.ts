import type { Vector3Like } from 'hytopia';
import { TICK_DELTA, WATER_LEVEL } from '../../config/settings';
import { clamp, getPointVelocity, rotateVector } from './raftMath';
import { logRaftDebug } from './raftDebug';
import type { DriftDirection, PlayerOnRaft, RaftParams, RaftRuntimeState } from './types';

export function updateRaftPhysics(
  state: RaftRuntimeState,
  params: RaftParams,
  driftDir: DriftDirection,
  driftSpeed: number,
  playerOnRaft?: PlayerOnRaft
) {
  if (!state.master || !state.master.isSpawned) return;

  state.tickCounter++;
  for (let i = 0; i < state.debrisCooldown.length; i++) {
    if (state.debrisCooldown[i] > 0) state.debrisCooldown[i]--;
  }

  const pos = { ...state.master.position };
  const rot = { ...state.master.rotation };
  const vCM = { ...state.master.linearVelocity };
  const omega = { ...state.master.angularVelocity };
  const mass = state.master.mass;
  const localUp = rotateVector({ x: 0, y: 1, z: 0 }, rot);

  let totalImpulse = { x: 0, y: 0, z: 0 };
  let totalTorque = { x: 0, y: 0, z: 0 };

  const floaterOffsets: Vector3Like[] = [];
  const floaterZs = [-2.5, -1.25, 0, 1.25, 2.5];

  for (let i = 0; i < state.beamPositions.length; i++) {
    const x = state.beamPositions[i] - state.raftOriginX;
    for (const z of floaterZs) floaterOffsets.push({ x, y: 0, z });
  }

  if (floaterOffsets.length === 0) return;

  const massPerPoint = mass / floaterOffsets.length;
  const targetY = WATER_LEVEL + params.targetHeight;

  let weightFactors: number[] | null = null;
  let extraDownPerPoint = 0;
  const debugDepths: number[] = [];

  if (playerOnRaft) {
    const weight = playerOnRaft.weight ?? 85;

    const leftEdge = state.raftOriginX - state.controlHalfX;
    const rightEdge = state.raftOriginX + state.controlHalfX;
    const clampedX = clamp(playerOnRaft.localOffset.x, leftEdge, rightEdge);

    const local = {
      x: clampedX - state.raftOriginX,
      y: playerOnRaft.localOffset.y,
      z: playerOnRaft.localOffset.z,
    };

    const denom = Math.max(0.6, state.controlHalfX);
    const sideBias = clamp(local.x / denom, -1, 1);

    weightFactors = floaterOffsets.map(o => {
      const dx = local.x - o.x;
      const dz = local.z - o.z;
      const d2 = dx * dx + dz * dz + 0.25;
      const base = 1 / d2;
      const side = 1 + sideBias * (o.x / denom) * 0.8;
      return base * side;
    });

    const sum = weightFactors.reduce((a, b) => a + b, 0) || 1;
    weightFactors = weightFactors.map(w => w / sum);

    const intactCount = state.beamPositions.length;
    let tiltScale = 1.0;
    if (intactCount <= 2) tiltScale = 0.4;
    else if (intactCount === 3) tiltScale = 0.6;
    else if (intactCount === 4) tiltScale = 0.8;
    extraDownPerPoint = weight * 9.81 * 4 * tiltScale * TICK_DELTA;
  }

  for (let i = 0; i < floaterOffsets.length; i++) {
    const offset = floaterOffsets[i];
    const worldOffset = rotateVector(offset, rot);
    const worldPoint = { x: pos.x + worldOffset.x, y: pos.y + worldOffset.y, z: pos.z + worldOffset.z };

    const pointVel = getPointVelocity(vCM, omega, pos, worldPoint);
    const depth = targetY - worldPoint.y;
    debugDepths.push(depth);

    if (depth > -0.05) {
      const sub = Math.max(0, depth);
      const spring = sub * params.buoyancyStiffness * massPerPoint;
      const damp = -pointVel.y * params.buoyancyDamping * massPerPoint;
      const base = 9.81 * massPerPoint * 1.0;

      let impulseY = Math.max(0, (spring + damp + base) * TICK_DELTA);

      if (weightFactors) impulseY -= extraDownPerPoint * weightFactors[i];

      if (impulseY > 0) {
        totalImpulse.y += impulseY;
        totalTorque.x += -worldOffset.z * impulseY;
        totalTorque.z += worldOffset.x * impulseY;
      }
    }
  }

  if (playerOnRaft) {
    const denom = Math.max(0.6, state.controlHalfX);
    const leftEdge = state.raftOriginX - denom;
    const rightEdge = state.raftOriginX + denom;
    const clampedX = clamp(playerOnRaft.localOffset.x, leftEdge, rightEdge);

    const localX = clampedX - state.raftOriginX;
    const steer = clamp(localX / denom, -1, 1);

    if (Math.abs(steer) > 0.02) {
      const right = rotateVector({ x: 1, y: 0, z: 0 }, rot);

      const steerImpulse = steer * mass * 5.6 * TICK_DELTA;
      totalImpulse.x += right.x * steerImpulse;
      totalImpulse.z += right.z * steerImpulse;

      const yawImpulse = steer * mass * 1.2 * TICK_DELTA;
      totalTorque.x += localUp.x * yawImpulse;
      totalTorque.y += localUp.y * yawImpulse;
      totalTorque.z += localUp.z * yawImpulse;
    }
  }

  const accelX = (driftDir.x * driftSpeed - vCM.x) * mass * 2.6;
  const accelZ = (driftDir.z * driftSpeed - vCM.z) * mass * 2.6;
  totalImpulse.x += accelX * TICK_DELTA;
  totalImpulse.z += accelZ * TICK_DELTA;

  const forward = rotateVector({ x: 0, y: 0, z: 1 }, rot);
  const currentYaw = Math.atan2(forward.x, forward.z);
  const targetYaw = Math.atan2(driftDir.x, driftDir.z);
  let yawError = targetYaw - currentYaw;
  while (yawError > Math.PI) yawError -= Math.PI * 2;
  while (yawError < -Math.PI) yawError += Math.PI * 2;

  const torqueImpulseMag = (yawError * 6.0 * mass - omega.y * 4.0 * mass) * TICK_DELTA;
  totalTorque.x += localUp.x * torqueImpulseMag;
  totalTorque.z += localUp.z * torqueImpulseMag;
  totalTorque.y = 0;

  state.master.applyImpulse(totalImpulse);
  state.master.applyTorqueImpulse(totalTorque);
  state.master.wakeUp();

  const wigglePhase = state.tickCounter * 0.08;
  for (let i = 0; i < state.visualBlocks.length; i++) {
    const visual = state.visualBlocks[i];
    if (!visual || !visual.isSpawned || visual === state.master) continue;
    const wiggleY = Math.sin(wigglePhase + i * 1.3) * 0.08;
    visual.setParent(state.master, undefined, { x: state.beamPositions[i], y: wiggleY, z: 0 });
  }

  for (const d of state.debris) {
    if (!d || !d.isSpawned) continue;
    const dp = d.position;
    const dv = d.linearVelocity;

    const targetDebrisY = WATER_LEVEL + 0.5;
    const error = targetDebrisY - dp.y;
    if (error > -0.1) {
      const upImpulse = Math.max(0, error * 6.0 * d.mass * TICK_DELTA);
      if (upImpulse > 0) d.applyImpulse({ x: 0, y: upImpulse, z: 0 });
    }

    const targetVX = driftDir.x * driftSpeed * 0.4;
    const targetVZ = driftDir.z * driftSpeed * 0.4;
    d.applyImpulse({
      x: (targetVX - dv.x) * d.mass * 0.2 * TICK_DELTA,
      y: 0,
      z: (targetVZ - dv.z) * d.mass * 0.2 * TICK_DELTA,
    });
  }

  logRaftDebug(state, {
    pos,
    vCM,
    omega,
    totalImpulse,
    totalTorque,
    debugDepths,
  });
}
