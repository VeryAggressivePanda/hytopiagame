import type { Vector3Like } from 'hytopia';
import { DEBUG_RAFT, DEBUG_RAFT_INTERVAL } from '../../config/debug';
import type { RaftRuntimeState } from './types';

export interface RaftDebugSnapshot {
  pos: Vector3Like;
  vCM: Vector3Like;
  omega: Vector3Like;
  totalImpulse: Vector3Like;
  totalTorque: Vector3Like;
  debugDepths: number[];
}

export function logRaftDebug(state: RaftRuntimeState, snapshot: RaftDebugSnapshot) {
  if (!DEBUG_RAFT) return;

  state.debugTick++;
  if (state.debugTick % DEBUG_RAFT_INTERVAL !== 0) return;

  const avgDepth = snapshot.debugDepths.length
    ? snapshot.debugDepths.reduce((a, b) => a + b, 0) / snapshot.debugDepths.length
    : 0;

  console.log('[RAFT][DEBUG]', {
    pos: snapshot.pos,
    vel: snapshot.vCM,
    omega: snapshot.omega,
    avgDepth: avgDepth.toFixed(3),
    totalImpulse: snapshot.totalImpulse,
    totalTorque: snapshot.totalTorque,
    raftOriginX: state.raftOriginX,
    deckHalfX: state.deckHalfX,
    controlHalfX: state.controlHalfX,
    beamPositions: state.beamPositions,
  });
}
