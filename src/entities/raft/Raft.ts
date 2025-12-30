import { ColliderShape, Entity, RigidBodyType, World } from 'hytopia';
import { WATER_LEVEL } from '../../config/settings';
import { updateRaftPhysics } from './raftPhysics';
import {
  collectFloatingBeam as collectFloatingBeamFromState,
  createRaftState,
  handleBeamSensorCollision,
  resetRaftForSpawn,
  syncBeamLayout,
} from './raftState';
import type { DriftDirection, PlayerOnRaft, RaftParams, RaftSpawnPosition } from './types';

const DEFAULT_PARAMS: RaftParams = {
  mass: 280,
  buoyancyStiffness: 26.0,
  buoyancyDamping: 7.0,
  linearDamping: 0.8,
  angularDamping: 2.0,
  targetHeight: 1,
};

export class Raft {
  private state = createRaftState();
  public params: RaftParams = { ...DEFAULT_PARAMS };

  constructor(private world: World) {}

  public get master(): Entity | null {
    return this.state.master;
  }

  public set master(value: Entity | null) {
    this.state.master = value;
  }

  public get visualBlocks(): Entity[] {
    return this.state.visualBlocks;
  }

  public set visualBlocks(value: Entity[]) {
    this.state.visualBlocks = value;
  }

  public spawn(pos: RaftSpawnPosition, reason = 'manual') {
    this.master?.despawn();
    this.visualBlocks.forEach(b => b && b.isSpawned && b.despawn());
    this.visualBlocks = [];

    resetRaftForSpawn(this.state);

    const deckCollider = {
      shape: ColliderShape.BLOCK,
      halfExtents: { x: 2.7, y: 0.5, z: this.state.length / 2 },
      relativePosition: { x: 0, y: 0, z: 0 },
      friction: 1.0,
      bounciness: 0.0,
      tag: 'raft-collider',
    };

    const beamHalf = { x: 0.5, y: 0.5, z: this.state.length / 2 };
    const beamSensors = [];
    for (let i = 0; i < this.state.maxBeams; i++) {
      const x = this.state.beamPositions[i] ?? 0;
      beamSensors.push({
        shape: ColliderShape.BLOCK,
        halfExtents: beamHalf,
        relativePosition: { x, y: 0, z: 0 },
        isSensor: true,
        tag: `raft-beam-sensor-${i}`,
        onCollision: (other: any, started: boolean) => {
          handleBeamSensorCollision(this.state, this.world, i, other, started);
        },
      });
    }

    const colliders = [deckCollider, ...beamSensors];

    this.master = new Entity({
      tag: 'raft-master',
      blockTextureUri: 'blocks/wood_beam.png',
      blockHalfExtents: { x: 0.5, y: 0.5, z: this.state.length / 2 },
      rigidBodyOptions: {
        type: RigidBodyType.DYNAMIC,
        additionalMass: this.params.mass,
        gravityScale: 0.92,
        linearDamping: this.params.linearDamping,
        angularDamping: this.params.angularDamping,
        enabledRotations: { x: true, y: false, z: true },
        colliders: colliders,
      },
    });

    const initialY = WATER_LEVEL + 1.2;
    this.master.spawn(this.world, { x: pos.x, y: initialY, z: pos.z });
    this.master.setRotation({ x: 0, y: 0, z: 0, w: 1 });
    this.master.setOpacity(0);

    this.state.deckCollider = this.master.getCollidersByTag('raft-collider')[0] ?? null;
    syncBeamLayout(this.state, this.world);
  }

  public updatePhysics(driftDir: DriftDirection, driftSpeed: number, playerOnRaft?: PlayerOnRaft) {
    updateRaftPhysics(this.state, this.params, driftDir, driftSpeed, playerOnRaft);
  }

  public getCenter() {
    return this.master?.isSpawned ? { x: this.master.position.x, z: this.master.position.z } : null;
  }

  public get blocks() {
    return this.visualBlocks;
  }

  public collectFloatingBeam(beam: Entity, collectorLocalOffset?: { x: number; y: number; z: number } | null): boolean {
    return collectFloatingBeamFromState(this.state, this.world, beam, collectorLocalOffset);
  }
}
