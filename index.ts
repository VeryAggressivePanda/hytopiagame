import {
  DefaultPlayerEntity,
  DefaultPlayerEntityController,
  Entity,
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
import { Raft } from './src/entities/raft/Raft';
import { Shark } from './src/entities/Shark';
import { FishGroup } from './src/entities/Fish';
import { PlayerManager } from './src/entities/PlayerManager';
import { FloatingDebrisField } from './src/world/FloatingDebrisField';
import { DEBUG_COLLIDERS, DEBUG_JUMP } from './src/config/debug';

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
    if (DEBUG_COLLIDERS) {
      world.simulation.enableDebugRendering(true);
    }

    const raft = new Raft(world);
    const debrisField = new FloatingDebrisField(world);
    const waterAura = new WaterAura(world);
    const terrain = new TerrainManager(world);
    const shark = new Shark(world);
    const fishGroup = new FishGroup(world);
    const playerManager = new PlayerManager(world);
    let courseGizmo: Entity[] = [];

    let driftDir = { x: 0, z: -1 };
    let driftTarget = { x: 0, z: -1 };
    let driftTimer = 0;
    let driftSpeed = 6;
    let tickCounter = 0;

    // Inertia Sync State
    let lastRaftVel = { x: 0, y: 0, z: 0 };
    let wasOnRaft = false;
    let onRaftGrace = 0;
    const ON_RAFT_GRACE_TICKS = 6;
    let lastLocalOffset: Vec3 = { x: 0, y: 0.8, z: 0 };
    let lastJumpPressed = false;
    let lastIsGrounded = false;
    let lastAppliedRaftVel: Vec3 = { x: 0, y: 0, z: 0 };
    let jumpCarryTicks = 0;
    let jumpCarryVel: Vec3 | null = null;
    let jumpFromRaftActive = false;
    let jumpFromRaftRelativeVel: Vec3 | null = null;
    let collectBuffer = 0;
    const COLLECT_BUFFER_TICKS = 6;

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
      const channelForward = terrain.getChannelForward();
      const cfLen = Math.hypot(channelForward.x, channelForward.z) || 1;
      driftDir.x = channelForward.x / cfLen;
      driftDir.z = channelForward.z / cfLen;

      const GIZMO_SEGMENTS = 25;
      const GIZMO_HALF_Z = 40.0;
      if (courseGizmo.length === 0) {
        for (let i = 0; i < GIZMO_SEGMENTS; i++) {
          const seg = new Entity({
            tag: 'raft-course-gizmo',
            blockTextureUri: 'blocks/wood_beam.png',
            blockHalfExtents: { x: 0.05, y: 0.05, z: GIZMO_HALF_Z },
            tintColor: { r: 255, g: 0, b: 0 },
            rigidBodyOptions: {
              type: RigidBodyType.KINEMATIC_POSITION,
              colliders: [{
                shape: ColliderShape.BLOCK,
                halfExtents: { x: 0.05, y: 0.05, z: GIZMO_HALF_Z },
                isSensor: true,
                enabled: false,
                collisionGroups: { belongsTo: [], collidesWith: [] },
              }],
            },
          });
          seg.spawn(world, { x: center.x, y: WATER_LEVEL + 3.0, z: center.z });
          seg.colliders.forEach(c => {
            c.setEnabled(false);
            c.setSensor(true);
            c.setCollisionGroups({ belongsTo: [], collidesWith: [] });
          });
          courseGizmo.push(seg);
        }
      }
      const desiredDir = terrain.getChannelForward();
      const gizmoYaw = Math.atan2(desiredDir.x, desiredDir.z);
      const origin = terrain.getChannelOrigin();
      const step = GIZMO_HALF_Z * 2;
      for (let i = 0; i < courseGizmo.length; i++) {
        const seg = courseGizmo[i];
        if (!seg.isSpawned) continue;
        const t = (i + 0.5) * step;
        seg.setPosition({
          x: origin.x + desiredDir.x * t,
          y: WATER_LEVEL + 3.0,
          z: origin.z + desiredDir.z * t,
        });
        seg.setRotation({ x: 0, y: Math.sin(gizmoYaw / 2), z: 0, w: Math.cos(gizmoYaw / 2) });
      }

      // Platform Detection (raft-local check)
      const playerOnRaft = (() => {
        if (!playerManager.mainPlayer || !playerManager.mainPlayer.isSpawned || !raft.master?.isSpawned) return null;
        const pp = playerManager.mainPlayer.position;
        const mp = raft.master.position;
        const rot = raft.master.rotation as Quat;
        const local = inverseRotateVector({ x: pp.x - mp.x, y: pp.y - mp.y, z: pp.z - mp.z }, rot);
        const margin = onRaftGrace > 0 ? 0.35 : 0.0;
        const maxX = 2.7 + margin;
        const maxZ = 2.6 + margin;
        if (Math.abs(local.x) > maxX || Math.abs(local.z) > maxZ) return null;
        const minY = -0.35;
        const maxY = 2.8;
        if (local.y < minY || local.y > maxY) return null;
        return {
          localOffset: { x: local.x, y: local.y, z: local.z },
          steer: clamp(local.x / 2.7, -1, 1),
          weight: 85,
        };
      })();

      // 5. Velocity Transfer / Current Sync (smooth carry with grace)
      if (playerManager.mainPlayer?.isSpawned && raft.master?.isSpawned) {
        const mainPlayer = playerManager.mainPlayer;
        const rv = raft.master.linearVelocity as Vec3;
        const pv = mainPlayer.linearVelocity as Vec3;
        const omega = raft.master.angularVelocity as Vec3;
        const wantAttach = !!playerOnRaft;
        if (wantAttach) {
          onRaftGrace = ON_RAFT_GRACE_TICKS;
          lastLocalOffset = playerOnRaft.localOffset as Vec3;
        } else {
          onRaftGrace = Math.max(0, onRaftGrace - 1);
        }

        const attached = wantAttach || onRaftGrace > 0;
        const isGrounded = (mainPlayer.controller as any)?.isGrounded ?? true;
        const jumpPressed = !!mainPlayer.player?.input?.sp;
        const jumpStarted = jumpPressed && !lastJumpPressed;
        const justLeftGround = lastIsGrounded && !isGrounded;
        if (DEBUG_JUMP && (jumpStarted || justLeftGround || lastIsGrounded !== isGrounded)) {
          console.log('[JUMP][DEBUG]', {
            tick: tickCounter,
            isGrounded,
            lastIsGrounded,
            jumpPressed,
            jumpStarted,
            justLeftGround,
            pvY: pv.y.toFixed(3),
            attached,
          });
        }
        if (DEBUG_JUMP && tickCounter % 20 === 0) {
          console.log('[JUMP][DEBUG][TICK]', {
            tick: tickCounter,
            isGrounded,
            jumpPressed,
            pvY: pv.y.toFixed(3),
            attached,
            onRaft: !!playerOnRaft,
          });
        }
        if (attached) {
          const rot = raft.master.rotation as Quat;
          const localOffset = (playerOnRaft?.localOffset as Vec3) ?? lastLocalOffset;
          const worldOffset = rotateVector(localOffset, rot);
          const omegaCrossR = cross(omega, worldOffset);
          const raftPointVel = {
            x: rv.x + omegaCrossR.x,
            y: rv.y + omegaCrossR.y,
            z: rv.z + omegaCrossR.z,
          };
          const relVel = {
            x: pv.x - raftPointVel.x,
            z: pv.z - raftPointVel.z,
          };

          if (jumpStarted && isGrounded) {
            const jumpY = Math.max(pv.y, 9.6);
            jumpFromRaftActive = true;
            jumpFromRaftRelativeVel = { x: relVel.x, y: 0, z: relVel.z };
            mainPlayer.setLinearVelocity({
              x: raftPointVel.x + relVel.x,
              y: jumpY,
              z: raftPointVel.z + relVel.z,
            });
            if (DEBUG_JUMP) {
              console.log('[JUMP][DEBUG][APPLY]', {
                tick: tickCounter,
                mode: 'jump-start',
                pv: { x: pv.x.toFixed(3), y: pv.y.toFixed(3), z: pv.z.toFixed(3) },
                raftPointVel: {
                  x: raftPointVel.x.toFixed(3),
                  y: raftPointVel.y.toFixed(3),
                  z: raftPointVel.z.toFixed(3),
                },
                relVel: {
                  x: relVel.x.toFixed(3),
                  y: '0.000',
                  z: relVel.z.toFixed(3),
                },
              });
            }
          } else if (justLeftGround && !jumpFromRaftActive) {
            jumpFromRaftActive = true;
            jumpFromRaftRelativeVel = { x: relVel.x, y: 0, z: relVel.z };
          }

          if (!isGrounded && jumpFromRaftActive && jumpFromRaftRelativeVel) {
            mainPlayer.setLinearVelocity({
              x: raftPointVel.x + jumpFromRaftRelativeVel.x,
              y: pv.y,
              z: raftPointVel.z + jumpFromRaftRelativeVel.z,
            });
            if (DEBUG_JUMP) {
              console.log('[JUMP][DEBUG][APPLY]', {
                tick: tickCounter,
                mode: 'jump-raft-carry',
                pv: { x: pv.x.toFixed(3), y: pv.y.toFixed(3), z: pv.z.toFixed(3) },
                raftPointVel: {
                  x: raftPointVel.x.toFixed(3),
                  y: raftPointVel.y.toFixed(3),
                  z: raftPointVel.z.toFixed(3),
                },
                relVel: {
                  x: jumpFromRaftRelativeVel.x.toFixed(3),
                  y: '0.000',
                  z: jumpFromRaftRelativeVel.z.toFixed(3),
                },
              });
            }
          } else if (isGrounded) {
            mainPlayer.setLinearVelocity({
              x: raftPointVel.x + relVel.x,
              y: pv.y,
              z: raftPointVel.z + relVel.z,
            });
            if (DEBUG_JUMP) {
              console.log('[JUMP][DEBUG][APPLY]', {
                tick: tickCounter,
                mode: 'raft-sync',
                pv: { x: pv.x.toFixed(3), y: pv.y.toFixed(3), z: pv.z.toFixed(3) },
                raftPointVel: {
                  x: raftPointVel.x.toFixed(3),
                  y: raftPointVel.y.toFixed(3),
                  z: raftPointVel.z.toFixed(3),
                },
                relVel: {
                  x: relVel.x.toFixed(3),
                  y: '0.000',
                  z: relVel.z.toFixed(3),
                },
              });
            }
          }
          lastAppliedRaftVel = { x: raftPointVel.x, y: 0, z: raftPointVel.z };
          wasOnRaft = true;
        } else {
          wasOnRaft = false;
          if (!isGrounded && jumpFromRaftActive && jumpFromRaftRelativeVel && raft.master?.isSpawned) {
            const rot = raft.master.rotation as Quat;
            const worldOffset = rotateVector(lastLocalOffset, rot);
            const omegaCrossR = cross(omega, worldOffset);
            const raftPointVel = {
              x: rv.x + omegaCrossR.x,
              y: rv.y + omegaCrossR.y,
              z: rv.z + omegaCrossR.z,
            };
            mainPlayer.setLinearVelocity({
              x: raftPointVel.x + jumpFromRaftRelativeVel.x,
              y: pv.y,
              z: raftPointVel.z + jumpFromRaftRelativeVel.z,
            });
            if (DEBUG_JUMP) {
              console.log('[JUMP][DEBUG][APPLY]', {
                tick: tickCounter,
                mode: 'jump-raft-carry-detached',
                pv: { x: pv.x.toFixed(3), y: pv.y.toFixed(3), z: pv.z.toFixed(3) },
                raftPointVel: {
                  x: raftPointVel.x.toFixed(3),
                  y: raftPointVel.y.toFixed(3),
                  z: raftPointVel.z.toFixed(3),
                },
                relVel: {
                  x: jumpFromRaftRelativeVel.x.toFixed(3),
                  y: '0.000',
                  z: jumpFromRaftRelativeVel.z.toFixed(3),
                },
              });
            }
          }
          lastAppliedRaftVel = { x: 0, y: 0, z: 0 };
        }
        if (isGrounded && !jumpPressed && !jumpStarted) {
          jumpCarryTicks = 0;
          jumpCarryVel = null;
          jumpFromRaftActive = false;
          jumpFromRaftRelativeVel = null;
        }
        lastJumpPressed = jumpPressed;
        lastIsGrounded = isGrounded;
      } else {
        wasOnRaft = false;
        onRaftGrace = 0;
        lastJumpPressed = false;
        lastIsGrounded = false;
        jumpCarryTicks = 0;
        jumpCarryVel = null;
        jumpFromRaftActive = false;
        jumpFromRaftRelativeVel = null;
        lastAppliedRaftVel = { x: 0, y: 0, z: 0 };
      }

      // Update Raft
      raft.updatePhysics(driftDir, driftSpeed, playerOnRaft ?? undefined);
      const mainPlayer = playerManager.mainPlayer;
      const pl = mainPlayer?.player;
      if (pl?.input?.ml) {
        collectBuffer = COLLECT_BUFFER_TICKS;
        pl.input.ml = false;
      }
      if (collectBuffer > 0) collectBuffer--;
      const collectorPos = mainPlayer?.isSpawned
        ? { x: mainPlayer.position.x, z: mainPlayer.position.z }
        : null;
      const collectorLocalOffset =
        mainPlayer?.isSpawned && raft.master?.isSpawned
          ? inverseRotateVector(
              {
                x: mainPlayer.position.x - raft.master.position.x,
                y: mainPlayer.position.y - raft.master.position.y,
                z: mainPlayer.position.z - raft.master.position.z,
              },
              raft.master.rotation as Quat
            )
          : null;
      const wantsCollect = collectBuffer > 0;
      debrisField.update(center, driftDir, driftSpeed, collectorPos, wantsCollect, beam =>
        raft.collectFloatingBeam(beam, collectorLocalOffset)
      );

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
      player.ui.on(PlayerUIEvent.DATA, ({ data }) => {
        console.log('[COLLECT][SERVER] ui data (player)', data);
        if (data?.type !== 'collect') return;
        collectBuffer = COLLECT_BUFFER_TICKS;
        player.ui.sendData({ type: 'collect-ack', tick: tickCounter });
      });
      player.ui.load('ui/index.html');
      raft.spawn({ x: pEnt.position.x + 3, z: pEnt.position.z }, 'join');

    });

    world.on(PlayerUIEvent.DATA, ({ playerUI, data }) => {
      console.log('[COLLECT][SERVER] ui data (world)', data);
      if (data?.type !== 'collect') return;
      if (playerUI.player !== playerManager.mainPlayer?.player) return;
      collectBuffer = COLLECT_BUFFER_TICKS;
      playerUI.sendData({ type: 'collect-ack', tick: tickCounter });
    });

    world.on(PlayerEvent.LEFT_WORLD, ({ player }) => {
      if (playerManager.mainPlayer?.player === player) playerManager.mainPlayer = undefined;
    });

  } catch (err) {
    console.error('[CRITICAL] Startup error:', err);
  }
});
