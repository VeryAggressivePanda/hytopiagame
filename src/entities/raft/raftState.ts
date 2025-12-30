import { ColliderShape, Entity, RigidBodyType, World } from 'hytopia';
import type { QuaternionLike } from 'hytopia';
import type { RaftRuntimeState } from './types';
import { getPointVelocity, inverseRotateVector, rotateVector } from './raftMath';

function buildDefaultBeamPositions(maxBeams: number, spacing: number) {
  const positions: number[] = [];
  const half = (maxBeams - 1) / 2;
  for (let i = 0; i < maxBeams; i++) {
    positions.push((i - half) * spacing);
  }
  return positions;
}

function pickAttachSide(localX: number) {
  return localX < 0 ? 'left' : 'right';
}

function addBeamOnSide(state: RaftRuntimeState, side: 'left' | 'right') {
  if (state.beamPositions.length >= state.maxBeams) return false;

  let newX = 0;
  if (state.beamPositions.length > 0) {
    const minX = Math.min(...state.beamPositions);
    const maxX = Math.max(...state.beamPositions);
    newX = side === 'left' ? minX - state.spacing : maxX + state.spacing;
  }

  state.beamPositions = [...state.beamPositions, newX].sort((a, b) => a - b);
  return true;
}

function recenterBeamPositions(state: RaftRuntimeState) {
  if (state.beamPositions.length === 0) return;
  const minX = Math.min(...state.beamPositions);
  const maxX = Math.max(...state.beamPositions);
  const centerX = (minX + maxX) / 2;
  if (centerX === 0) return;
  state.beamPositions = state.beamPositions.map(x => x - centerX);
}

export function createRaftState(): RaftRuntimeState {
  const spacing = 1.1;
  const maxBeams = 5;
  return {
    master: null,
    visualBlocks: [],
    beamPositions: buildDefaultBeamPositions(maxBeams, spacing),
    maxBeams,
    debris: [null, null, null, null, null],
    debrisCooldown: [0, 0, 0, 0, 0],
    deckCollider: null,
    raftOriginX: 0,
    deckHalfX: 2.7,
    controlHalfX: 2.2,
    tickCounter: 0,
    debugTick: 0,
    spacing,
    length: 5,
  };
}

export function resetRaftForSpawn(state: RaftRuntimeState) {
  state.beamPositions = buildDefaultBeamPositions(state.maxBeams, state.spacing);
  recenterBeamPositions(state);

  state.debris.forEach(d => d && d.isSpawned && d.despawn());
  state.debris = [null, null, null, null, null];
  state.debrisCooldown = [0, 0, 0, 0, 0];

  state.raftOriginX = 0;
  state.deckHalfX = 2.7;
  state.controlHalfX = 2.2;
  state.deckCollider = null;
}

export function updateDeckCollider(state: RaftRuntimeState) {
  if (!state.deckCollider) return;

  if (state.beamPositions.length === 0) return;

  const minX = Math.min(...state.beamPositions);
  const maxX = Math.max(...state.beamPositions);

  const computedHalfX = (maxX - minX) / 2 + 0.5;
  const centerX = (minX + maxX) / 2;

  state.raftOriginX = centerX;
  state.deckHalfX = computedHalfX;

  const control = Math.max(...state.beamPositions.map(x => Math.abs(x - centerX)));
  state.controlHalfX = Math.max(0.6, control);

  state.deckCollider.setHalfExtents({ x: computedHalfX, y: 0.5, z: state.length / 2 });
  state.deckCollider.setRelativePosition({ x: centerX, y: 0, z: 0 });
}

export function syncBeamLayout(state: RaftRuntimeState, world: World) {
  if (!state.master || !state.master.isSpawned) return;

  state.beamPositions = [...state.beamPositions].sort((a, b) => a - b);
  recenterBeamPositions(state);

  state.visualBlocks.forEach(v => v && v !== state.master && v.isSpawned && v.despawn());
  state.visualBlocks = [];

  const hasCenterBeam = state.beamPositions.length % 2 === 1;
  let centerIndex = -1;
  if (hasCenterBeam) {
    let best = 0;
    let bestAbs = Infinity;
    for (let i = 0; i < state.beamPositions.length; i++) {
      const a = Math.abs(state.beamPositions[i]);
      if (a < bestAbs) {
        bestAbs = a;
        best = i;
      }
    }
    centerIndex = best;
  }

  if (hasCenterBeam) {
    state.master.setOpacity(1);
  } else {
    state.master.setOpacity(0);
  }

  for (let i = 0; i < state.beamPositions.length; i++) {
    if (i === centerIndex) {
      state.visualBlocks.push(state.master);
      continue;
    }
    const visual = new Entity({
      tag: 'raft-visual-block',
      blockTextureUri: 'blocks/wood_beam.png',
      blockHalfExtents: { x: 0.5, y: 0.5, z: state.length / 2 },
    });
    visual.spawn(world, { ...state.master.position }, { ...state.master.rotation });
    visual.setParent(state.master, undefined, { x: state.beamPositions[i], y: 0, z: 0 });
    state.visualBlocks.push(visual);
  }

  for (let i = 0; i < state.maxBeams; i++) {
    const sensor = state.master.getCollidersByTag(`raft-beam-sensor-${i}`);
    if (i < state.beamPositions.length) {
      sensor.forEach((c: any) => {
        c.setEnabled(true);
        c.setRelativePosition({ x: state.beamPositions[i], y: 0, z: 0 });
      });
    } else {
      sensor.forEach((c: any) => c.setEnabled(false));
    }
  }

  updateDeckCollider(state);
}

export function handleBeamSensorCollision(
  state: RaftRuntimeState,
  world: World,
  index: number,
  other: any,
  started: boolean
) {
  if (!started || !state.master?.isSpawned) return;
  if (index >= state.beamPositions.length) return;

  if (!other || typeof other !== 'object' || !('isLiquid' in other)) return;
  if (other.isLiquid) return;

  breakBeam(state, world, index);
}

export function collectFloatingBeam(
  state: RaftRuntimeState,
  world: World,
  beam: Entity,
  collectorLocalOffset?: { x: number; y: number; z: number } | null
): boolean {
  if (!state.master || !state.master.isSpawned) return false;
  if (state.beamPositions.length >= state.maxBeams) return false;

  const localX = collectorLocalOffset?.x ?? (() => {
    const rot = state.master.rotation as QuaternionLike;
    const local = inverseRotateVector(
      {
        x: beam.position.x - state.master.position.x,
        y: beam.position.y - state.master.position.y,
        z: beam.position.z - state.master.position.z,
      },
      rot
    );
    return local.x;
  })();

  const side = pickAttachSide(localX);
  const added = addBeamOnSide(state, side);
  if (!added) return false;

  if (beam.isSpawned) beam.despawn();
  syncBeamLayout(state, world);
  return true;
}

export function breakBeam(state: RaftRuntimeState, world: World, index: number) {
  if (!state.master || !state.master.isSpawned) return;
  if (index >= state.beamPositions.length) return;

  const beamX = state.beamPositions[index];
  state.beamPositions = state.beamPositions.filter((_, i) => i !== index);
  recenterBeamPositions(state);

  const mPos = { ...state.master.position };
  const mRot = { ...state.master.rotation };

  const worldOffset = rotateVector({ x: beamX, y: 0, z: 0 }, mRot);
  const worldPoint = { x: mPos.x + worldOffset.x, y: mPos.y + worldOffset.y, z: mPos.z + worldOffset.z };

  const pointVel = getPointVelocity(state.master.linearVelocity, state.master.angularVelocity, mPos, worldPoint);

  const debris = new Entity({
    tag: `raft-debris-${index}`,
    blockTextureUri: 'blocks/wood_beam.png',
    blockHalfExtents: { x: 0.5, y: 0.5, z: state.length / 2 },
    rigidBodyOptions: {
      type: RigidBodyType.DYNAMIC,
      additionalMass: 40,
      linearDamping: 1.2,
      angularDamping: 2.0,
      colliders: [
        {
          shape: ColliderShape.BLOCK,
          halfExtents: { x: 0.5, y: 0.5, z: state.length / 2 },
          friction: 0.9,
          bounciness: 0.0,
          tag: `raft-debris-${index}`,
          onCollision: (other: any, started: boolean) => {
            if (!started || state.debrisCooldown[index] > 0) return;
            if (!other || typeof other !== 'object') return;
            if (other.tag === 'raft-master') {
              const rot = state.master?.rotation as QuaternionLike;
              const local = inverseRotateVector(
                {
                  x: debris.position.x - state.master!.position.x,
                  y: debris.position.y - state.master!.position.y,
                  z: debris.position.z - state.master!.position.z,
                },
                rot
              );
              const side = pickAttachSide(local.x);
              const added = addBeamOnSide(state, side);
              if (added) {
                if (debris.isSpawned) debris.despawn();
                state.debris[index] = null;
                syncBeamLayout(state, world);
              }
            }
          },
        },
      ],
    },
  });

  debris.spawn(world, worldPoint, mRot);
  debris.setLinearVelocity(pointVel);
  debris.setAngularVelocity(state.master.angularVelocity);

  state.debris[index] = debris;
  state.debrisCooldown[index] = 20;

  syncBeamLayout(state, world);
}
