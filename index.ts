import {
  DefaultPlayerEntity,
  DefaultPlayerEntityController,
  PlayerEvent,
  PlayerUIEvent,
  WorldLoopEvent,
  startServer,
  ColliderShape,
  RigidBodyType,
} from 'hytopia';

import { registerBlocks, isWaterId } from './src/config/blocks';
import { WATER_LEVEL, BUBBLE_RADIUS, TICK_DELTA, DRIFT_STEER_INTERVAL, DRIFT_TURN_RATE } from './src/config/settings';
import { WaterAura } from './src/world/WaterAura';
import { TerrainManager } from './src/world/TerrainManager';
import { Raft } from './src/entities/Raft';
import { Shark } from './src/entities/Shark';
import { FishGroup } from './src/entities/Fish';
import { PlayerManager } from './src/entities/PlayerManager';

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

function rotateVector(v: Vec3, q: Quat): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx)
  };
}

function inverseRotateVector(v: Vec3, q: Quat): Vec3 {
  return rotateVector(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

startServer(world => {
  process.on('uncaughtException', err => console.error('[CRITICAL] Uncaught:', err));
  process.on('unhandledRejection', reason => console.error('[CRITICAL] Unhandled:', reason));

  try {
    registerBlocks(world);

    const raft = new Raft(world);
    const waterAura = new WaterAura(world);
    const terrain = new TerrainManager(world);
    const shark = new Shark(world);
    const fishGroup = new FishGroup(world);
    const playerManager = new PlayerManager(world);

    let driftDir = { x: 0, z: -1 };
    let driftTarget = { x: 0, z: -1 };
    let driftTimer = 0;
    let driftSpeed = 2;
    let tickCounter = 0;

    // Inertia Sync State
    let lastRaftVel = { x: 0, y: 0, z: 0 };
    let wasOnRaft = false;

    const respawnPlayer = (p: any) => {
      const center = raft.getCenter() || { x: 0, z: 0 };
      p.setLinearVelocity({ x: 0, y: 0, z: 0 });
      raft.spawn({ x: center.x, z: center.z }, 'respawn');
      p.setPosition?.({ x: center.x, y: WATER_LEVEL + 5, z: center.z });
      p.setRotation?.({ x: 0, y: 0, z: 0, w: 1 });
      playerManager.swimEnergy = 1;
      playerManager.sendSwimState(p, false, true, tickCounter);
      world.chatManager.sendPlayerMessage(p.player, 'Respawned. New game underway.', '00FF00');
    };

    world.loop.on(WorldLoopEvent.TICK_END, () => {
      tickCounter++;
      const center = raft.getCenter() || { x: 0, z: 0 };

      terrain.maintain(center, driftDir, (waterAura as any).activeWater);
      waterAura.update(center, (x, z) => terrain.isIslandBase(x, z));
      playerManager.update(center, raft.blocks, BUBBLE_RADIUS, tickCounter, respawnPlayer);

      if (tickCounter % 20 === 0) {
        waterAura.sweep(center, (x, z) => terrain.isIslandBase(x, z));
      }

      // Drift physics (direction over time)
      driftTimer++;
      if (driftTimer % DRIFT_STEER_INTERVAL === 0) {
        const ang = Math.atan2(driftDir.z, driftDir.x);
        const targetAng = ang + (Math.random() - 0.5) * 0.25;
        driftTarget = { x: Math.cos(targetAng), z: Math.sin(targetAng) };
      }
      driftDir = {
        x: driftDir.x * 0.97 + driftTarget.x * 0.03,
        z: driftDir.z * 0.97 + driftTarget.z * 0.03,
      };
      const dLen = Math.hypot(driftDir.x, driftDir.z) || 1;
      driftDir.x /= dLen; driftDir.z /= dLen;

      // Platform Detection (raft-local check)
      const playerOnRaft = (() => {
        if (!playerManager.mainPlayer || !playerManager.mainPlayer.isSpawned || !raft.master?.isSpawned) return null;
        const pp = playerManager.mainPlayer.position;
        const mp = raft.master.position;
        const rot = raft.master.rotation as Quat;
        const local = inverseRotateVector({ x: pp.x - mp.x, y: pp.y - mp.y, z: pp.z - mp.z }, rot);
        const maxX = 2.7;
        const maxZ = 2.6;
        if (Math.abs(local.x) > maxX || Math.abs(local.z) > maxZ) return null;
        // Widen vertical window so player counts as on-deck more reliably
        if (local.y < -0.2 || local.y > 2.6) return null;
        return {
          localOffset: { x: local.x, y: 0.5, z: local.z },
          steer: clamp(local.x / maxX, -1, 1),
          // Use a fixed effective weight so buoyancy sees a meaningful load
          weight: 85,
        };
      })();

      // 5. Velocity Transfer / Current Sync
      if (playerManager.mainPlayer && playerManager.mainPlayer.isSpawned && raft.master && raft.master.isSpawned) {
        const mainPlayer = playerManager.mainPlayer;
        const rv = raft.master.linearVelocity;
        const pv = mainPlayer.linearVelocity;
        const pp = mainPlayer.position;
        const omega = raft.master.angularVelocity;
        const isGrounded = (mainPlayer.controller as any)?.isGrounded ?? true;
        const onIsland = terrain.isIslandBase(pp.x, pp.z);

        if (playerOnRaft) {
          if (isGrounded) {
            const rot = raft.master.rotation as Quat;
            const worldOffset = rotateVector(playerOnRaft.localOffset, rot);
            const omegaCrossR = cross(omega as Vec3, worldOffset as Vec3);
            const raftPointVel = { x: rv.x + omegaCrossR.x, y: rv.y + omegaCrossR.y, z: rv.z + omegaCrossR.z };
            if (!wasOnRaft) {
              mainPlayer.setLinearVelocity({ x: raftPointVel.x, y: pv.y, z: raftPointVel.z });
              wasOnRaft = true;
            } else {
              const speed = Math.hypot(pv.x, pv.z);
              if (speed < 1.2) {
                mainPlayer.setLinearVelocity({ x: raftPointVel.x, y: pv.y, z: raftPointVel.z });
              }
            }
          } else { wasOnRaft = false; }
        } else {
          wasOnRaft = false;
        }
      } else { wasOnRaft = false; }

      // Update Raft
      raft.updatePhysics(driftDir, driftSpeed, playerOnRaft ?? undefined);

      // 6. DEBUG LOGGING
      if (tickCounter % 100 === 0 && playerManager.mainPlayer) {
        const mp = playerManager.mainPlayer;
        const rv = raft.master?.linearVelocity || { x: 0, z: 0 };
        const pv = mp.linearVelocity;
        const isG = (mp.controller as any)?.isGrounded;
        console.log(`[DEBUG] Tick:${tickCounter} | RaftVel:${rv.x.toFixed(2)},${rv.z.toFixed(2)} | PlayerVel:${pv.x.toFixed(2)},${pv.z.toFixed(2)} | Grounded:${isG} | wasOnRaft:${wasOnRaft}`);
      }

      // Store state for NEXT frame
      if (raft.master?.isSpawned) {
        lastRaftVel = { ...raft.master.linearVelocity };
      }
      shark.update(center, raft.visualBlocks.filter(b => b && b.isSpawned));
      fishGroup.update(center);

      // Minimap UI
      if (tickCounter % 5 === 0) {
        world.entityManager.getAllPlayerEntities().forEach(p => {
          if (!p.player) return;
          p.player.ui.sendData({
            type: 'minimap',
            center: { x: center.x, z: center.z },
            drift: { x: driftDir.x, z: driftDir.z },
            shark: shark.entity?.isSpawned ? { x: shark.entity.position.x, z: shark.entity.position.z } : null,
          });
        });
      }
    });

    world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
      const pEnt = new DefaultPlayerEntity({ player, name: 'Player' });
      pEnt.spawn(world, { x: 0, y: WATER_LEVEL + 5, z: 0 });
      player.camera.setAttachedToEntity?.(pEnt);
      playerManager.mainPlayer = pEnt;
      player.ui.load('ui/index.html');
      raft.spawn({ x: pEnt.position.x + 3, z: pEnt.position.z }, 'join');

    });

    world.on(PlayerEvent.LEFT_WORLD, ({ player }) => {
      if (playerManager.mainPlayer?.player === player) playerManager.mainPlayer = undefined;
    });

  } catch (err) {
    console.error('[CRITICAL] Startup error:', err);
  }
});
