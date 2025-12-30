import type { Entity, Vector3Like } from 'hytopia';

export type DriftDirection = { x: number; z: number };
export type RaftSpawnPosition = { x: number; z: number };

export interface RaftParams {
  mass: number;
  buoyancyStiffness: number;
  buoyancyDamping: number;
  linearDamping: number;
  angularDamping: number;
  targetHeight: number;
}

export interface PlayerOnRaft {
  localOffset: Vector3Like;
  weight?: number;
}

export interface RaftRuntimeState {
  master: Entity | null;
  visualBlocks: Entity[];
  beamPositions: number[];
  maxBeams: number;
  debris: Array<Entity | null>;
  debrisCooldown: number[];
  deckCollider: any | null;
  raftOriginX: number;
  deckHalfX: number;
  controlHalfX: number;
  tickCounter: number;
  debugTick: number;
  spacing: number;
  length: number;
}
