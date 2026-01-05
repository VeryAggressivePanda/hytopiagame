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
import { WATER_LEVEL, BUBBLE_RADIUS, TICK_DELTA, DRIFT_STEER_INTERVAL, DRIFT_TURN_RATE, RADAR_RANGE } from './src/config/settings';
import { WaterAura } from './src/world/WaterAura';
import { TerrainManager } from './src/world/TerrainManager';
import { Raft } from './src/entities/raft/Raft';
import { Shark } from './src/entities/Shark';
import { FishGroup } from './src/entities/Fish';
import { PlayerManager } from './src/entities/PlayerManager';
import { FloatingDebrisField } from './src/world/FloatingDebrisField';
import { CoinField } from './src/world/CoinField';
import { WakeEffect } from './src/world/WakeEffect';
import { DEBUG_COLLIDERS, DEBUG_JUMP } from './src/config/debug';

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };
const USE_RAFT_PLATFORM = false;
const JUMP_Y = 9.6;
const JUMP_GRAVITY = 9.81;
const JUMP_FORWARD_BOOST = 0.0;
const LANDING_EDGE_ZONE = 0.7;
const LANDING_SIDE_BOOST_VEL = 3.0;
const LANDING_SIDE_BOOST_TICKS = 10;
const LANDING_SIDE_BOOST_JOLT = 4.0;
class RaftJumpController extends DefaultPlayerEntityController {
  private lastJumpPressed = false;
  private raftOn = false;
  private raftVel: Vec3 = { x: 0, y: 0, z: 0 };
  private forward: Vec3 = { x: 0, y: 0, z: -1 };
  private boostTotal: Vec3 = { x: 0, y: 0, z: 0 };
  private boostTicksLeft = 0;
  private groundedInit = false;
  private wasGrounded = false;
  private jumpedThisAir = false;

  public setRaftContext(onRaft: boolean, raftVel: Vec3, forward: Vec3) {
    this.raftOn = onRaft;
    this.raftVel = raftVel;
    this.forward = forward;
  }

  public override tickWithPlayerInput(entity: any, input: any, orientation: any, delta: number) {
    super.tickWithPlayerInput(entity, input, orientation, delta);
    const jumpPressed = !!input?.sp;
    const jumpStarted = jumpPressed && !this.lastJumpPressed;
    if (jumpStarted && this.raftOn) {
      this.jumpedThisAir = true;
      const pv = entity.linearVelocity as Vec3;
      this.boostTotal = {
        x: this.raftVel.x + this.forward.x * JUMP_FORWARD_BOOST,
        y: 0,
        z: this.raftVel.z + this.forward.z * JUMP_FORWARD_BOOST,
      };
      const airtime = (2 * JUMP_Y) / JUMP_GRAVITY;
      this.boostTicksLeft = Math.max(1, Math.round(airtime / TICK_DELTA));
      entity.setLinearVelocity({
        x: pv.x,
        y: Math.max(pv.y, JUMP_Y),
        z: pv.z,
      });
    }
    if (this.boostTicksLeft > 0) {
      this.boostTicksLeft--;
      const pv = entity.linearVelocity as Vec3;
      entity.setLinearVelocity({
        x: pv.x + this.boostTotal.x,
        y: pv.y,
        z: pv.z + this.boostTotal.z,
      });
    }
    this.lastJumpPressed = jumpPressed;
  }

  public landedOnRaftThisTick(isGrounded: boolean, onRaft: boolean): boolean {
    if (!this.groundedInit) {
      this.groundedInit = true;
      this.wasGrounded = isGrounded;
      return false;
    }
    const landed = isGrounded && !this.wasGrounded;
    this.wasGrounded = isGrounded;
    if (!landed) return false;
    const shouldBoost = this.jumpedThisAir && onRaft;
    this.jumpedThisAir = false;
    return shouldBoost;
  }
}

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
    const raftPlatform = USE_RAFT_PLATFORM
      ? new Entity({
        tag: 'raft-platform',
        blockTextureUri: 'blocks/wood_beam.png',
        blockHalfExtents: { x: 2.7, y: 0.25, z: 2.6 },
        rigidBodyOptions: {
          type: RigidBodyType.KINEMATIC_POSITION,
          colliders: [{
            shape: ColliderShape.BLOCK,
            halfExtents: { x: 2.7, y: 0.25, z: 2.6 },
            isSensor: false,
            tag: 'raft-platform-collider',
          }],
        },
      })
      : null;
    if (raftPlatform) {
      raftPlatform.spawn(world, { x: 0, y: WATER_LEVEL + 2, z: 0 });
      raftPlatform.setOpacity(0);
    }
    const debrisField = new FloatingDebrisField(world);
    const coinField = new CoinField(world);
    const waterAura = new WaterAura(world);
    const wakeEffect = new WakeEffect(world);
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
    let raftSideBoostTicks = 0;
    let raftSideBoostDir = 0;
    let raftSideBoostStrength = 0;

    let collectBuffer = 0;
    const COLLECT_BUFFER_TICKS = 6;
    let raftLost = false;
    let coinCount = 0;
    let coinHud: Entity | null = null;
    let coinHudSpin = 0;
    const PLAYER_SPAWN_Y = WATER_LEVEL + 2.2;
    const RESPAWN_DELAY_MS = 2200;
    let respawnPending = false;
    let uiReady = false;
    let pendingDeathMessage: string | null = null;
    const deathPhrases = [
      'You slipped beneath the surface and never came back up.',
      'You died a slow, uncomfortable death in the freezing water.',
      'The sea pulled you under, quiet and cold.',
      'Salt filled your lungs as the waves swallowed your last breath.',
      'The current took you, and the water never let go.',
      'You drifted into the dark, alone in the endless water.',
    ];

    const doRespawnPlayer = (p: any) => {
      const center = { x: 0, z: 0 };
      p.setLinearVelocity({ x: 0, y: 0, z: 0 });
      raft.spawn({ x: center.x, z: center.z }, 'respawn');
      p.setPosition?.({ x: center.x, y: PLAYER_SPAWN_Y, z: center.z });
      p.setRotation?.({ x: 0, y: 0, z: 0, w: 1 });
      playerManager.swimEnergy = 1;
      playerManager.sendSwimState(p, false, true, tickCounter);
      world.chatManager.sendPlayerMessage(p.player, 'Respawned. New game underway.', '00FF00');
      raftLost = false;
    };

    const respawnPlayer = (p: any) => {
      if (respawnPending) return;
      respawnPending = true;
      const phrase = deathPhrases[Math.floor(Math.random() * deathPhrases.length)];
      if (uiReady) {
        p.player.ui.sendData({ type: 'death-screen', message: phrase });
      } else {
        pendingDeathMessage = phrase;
      }
      setTimeout(() => {
        try {
          if (uiReady) {
            p.player.ui.sendData({ type: 'death-screen', message: phrase });
          }
        } catch (err) {
          console.warn('[UI] death-screen send failed', err);
        }
      }, 150);
      setTimeout(() => {
        doRespawnPlayer(p);
        respawnPending = false;
      }, RESPAWN_DELAY_MS);
    };

    world.loop.on(WorldLoopEvent.TICK_END, () => {
      tickCounter++;
      const center = raft.getCenter() || { x: 0, z: 0 };

      const edges = raft.getBeamEdges();
      const currentWidth = edges ? (edges.max - edges.min + 1) : 5.4;

      const vel = raft.master?.linearVelocity || { x: 0, y: 0, z: 0 };
      const raftSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

      terrain.maintain(center, driftDir, (waterAura as any).activeWater);
      waterAura.update(center, (x, z) => terrain.isIslandBase(x, z), raft.master?.isSpawned ? {
        pos: raft.master.position,
        rot: raft.master.rotation as any,
        width: currentWidth,
        speed: raftSpeed
      } : undefined, tickCounter);
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

      const GIZMO_SEGMENTS = 28;
      const GIZMO_SEG_LEN = 0.3;
      const GIZMO_GAP = 2.8;
      const GIZMO_HALF_Z = GIZMO_SEG_LEN * 0.5;
      if (courseGizmo.length === 0) {
        for (let i = 0; i < GIZMO_SEGMENTS; i++) {
          const seg = new Entity({
            tag: 'raft-course-gizmo',
            blockTextureUri: 'blocks/water_medium.png',
            blockHalfExtents: { x: 0.12, y: 0.12, z: GIZMO_HALF_Z },
            tintColor: { r: 77, g: 152, b: 214 },
            rigidBodyOptions: {
              type: RigidBodyType.KINEMATIC_POSITION,
              colliders: [{
                shape: ColliderShape.BLOCK,
                halfExtents: { x: 0.12, y: 0.12, z: GIZMO_HALF_Z },
                isSensor: true,
                enabled: false,
                collisionGroups: { belongsTo: [], collidesWith: [] },
              }],
            },
          });
          seg.spawn(world, { x: center.x, y: WATER_LEVEL, z: center.z });
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
      const step = GIZMO_SEG_LEN + GIZMO_GAP;
      for (let i = 0; i < courseGizmo.length; i++) {
        const seg = courseGizmo[i];
        if (!seg.isSpawned) continue;
        const t = (i + 0.5) * step;
        seg.setPosition({
          x: origin.x + desiredDir.x * t,
          y: WATER_LEVEL + 1,
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
        const margin = 0.0;
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

      const controller = playerManager.mainPlayer?.controller as RaftJumpController | undefined;
      if (controller) {
        const raftVel = raft.master?.isSpawned ? (raft.master.linearVelocity as Vec3) : { x: 0, y: 0, z: 0 };
        controller.setRaftContext(!!playerOnRaft, raftVel, { x: driftDir.x, y: 0, z: driftDir.z });
        if (controller instanceof RaftJumpController) {
          const isGrounded = !!(controller as any).isGrounded;
          const landedOnRaft = controller.landedOnRaftThisTick(isGrounded, !!playerOnRaft);
          if (landedOnRaft && playerOnRaft && raft.master?.isSpawned) {
            const localX = playerOnRaft.localOffset.x;
            const edges = raft.getBeamEdges();
            const minEdge = edges?.min ?? -2.7;
            const maxEdge = edges?.max ?? 2.7;
            const leftZone = minEdge + LANDING_EDGE_ZONE;
            const rightZone = maxEdge - LANDING_EDGE_ZONE;
            let sideDir = 0;
            let edgeDist = 0;
            if (localX <= leftZone) {
              sideDir = -1;
              edgeDist = clamp((leftZone - localX) / LANDING_EDGE_ZONE, 0, 1);
            } else if (localX >= rightZone) {
              sideDir = 1;
              edgeDist = clamp((localX - rightZone) / LANDING_EDGE_ZONE, 0, 1);
            }
            if (sideDir !== 0 && edgeDist > 0) {
              raftSideBoostTicks = LANDING_SIDE_BOOST_TICKS;
              raftSideBoostDir = sideDir;
              raftSideBoostStrength = edgeDist;
            }
          }
        }
      }

      // Update Raft
      raft.updatePhysics(driftDir, driftSpeed, playerOnRaft ?? undefined);
      if (raftSideBoostTicks > 0 && raft.master?.isSpawned) {
        const right = rotateVector({ x: 1, y: 0, z: 0 }, raft.master.rotation as Quat);
        const rv = raft.master.linearVelocity as Vec3;
        const boost = LANDING_SIDE_BOOST_VEL * raftSideBoostStrength * raftSideBoostDir;
        const isFirstTick = raftSideBoostTicks === LANDING_SIDE_BOOST_TICKS;
        const jolt = isFirstTick ? LANDING_SIDE_BOOST_JOLT * raftSideBoostStrength * raftSideBoostDir : 0;
        raft.master.setLinearVelocity({
          x: rv.x + right.x * (boost + jolt),
          y: rv.y,
          z: rv.z + right.z * (boost + jolt),
        });
        raftSideBoostTicks--;
      }
      if (!raftLost && raft.blocks.length === 0 && playerManager.mainPlayer) {
        raftLost = true;
        respawnPlayer(playerManager.mainPlayer);
      }
      if (raft.master?.isSpawned && raftPlatform?.isSpawned) {
        const m = raft.master;
        raftPlatform.setPosition({ x: m.position.x, y: m.position.y + 0.6, z: m.position.z });
        raftPlatform.setRotation(m.rotation as any);
        raftPlatform.setLinearVelocity(m.linearVelocity as any);
      }
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

      if (raft.master?.isSpawned) {
        wakeEffect.update(
          raft.master.position,
          raft.master.rotation as any,
          raft.master.linearVelocity as any,
          currentWidth,
          driftDir,
          driftSpeed,
          tickCounter
        );
      }

      coinField.update(center, collectorPos, () => {
        coinCount++;
        world.entityManager.getAllPlayerEntities().forEach(p => {
          if (!p.player) return;
          p.player.ui.sendData({ type: 'coin-count', value: coinCount });
        });
      });

      const mainPlayerEntity = playerManager.mainPlayer;
      if (mainPlayerEntity?.isSpawned) {
        if (!coinHud || !coinHud.isSpawned) {
          coinHud = new Entity({
            tag: 'coin-hud',
            name: 'CoinHUD',
            modelUri: 'environment/gameplay/coin.gltf',
            modelScale: 0.6,
            modelPreferredShape: ColliderShape.NONE,
            isEnvironmental: true,
            rigidBodyOptions: {
              type: RigidBodyType.KINEMATIC_POSITION,
              colliders: [],
            },
          });
          coinHud.spawn(world, { ...mainPlayerEntity.position });
        }
        const offsetLocal = { x: -0.6, y: 1.4, z: 2.4 };
        const rotatedOffset = rotateVector(offsetLocal, mainPlayerEntity.rotation as Quat);
        coinHud.setPosition({
          x: mainPlayerEntity.position.x + rotatedOffset.x,
          y: mainPlayerEntity.position.y + rotatedOffset.y,
          z: mainPlayerEntity.position.z + rotatedOffset.z,
        });
        coinHudSpin += 0.08;
        coinHud.setRotation({ x: 0, y: Math.sin(coinHudSpin / 2), z: 0, w: Math.cos(coinHudSpin / 2) });
      } else if (coinHud?.isSpawned) {
        coinHud.despawn();
      }

      // 6. DEBUG LOGGING
      if (tickCounter % 100 === 0 && playerManager.mainPlayer) {
        const mp = playerManager.mainPlayer;
        const rv = raft.master?.linearVelocity || { x: 0, z: 0 };
        const pv = mp.linearVelocity;
        const isG = (mp.controller as any)?.isGrounded;
        console.log(`[DEBUG] Tick:${tickCounter} | RaftVel:${rv.x.toFixed(2)},${rv.z.toFixed(2)} | PlayerVel:${pv.x.toFixed(2)},${pv.z.toFixed(2)} | Grounded:${isG} | onRaft:${!!playerOnRaft}`);
      }
      shark.update(center, raft.visualBlocks.filter(b => b && b.isSpawned));
      fishGroup.update(center);

      // Minimap UI
      if (tickCounter % 5 === 0) {
        const islandBlocks = terrain.getIslandPlanBlocks(center, RADAR_RANGE);

        world.entityManager.getAllPlayerEntities().forEach(p => {
          if (!p.player) return;
          p.player.ui.sendData({
            type: 'minimap',
            center: { x: center.x, z: center.z },
            drift: { x: driftDir.x, z: driftDir.z },
            shark: shark.entity?.isSpawned ? { x: shark.entity.position.x, z: shark.entity.position.z } : null,
            islands: islandBlocks,
            range: RADAR_RANGE,
          });
        });
      }
    });

    world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
      const pEnt = new DefaultPlayerEntity({ player, name: 'Player', controller: new RaftJumpController() });
      raft.spawn({ x: 0, z: 0 }, 'join');
      const center = raft.getCenter() || { x: 0, z: 0 };
      pEnt.spawn(world, { x: center.x, y: PLAYER_SPAWN_Y, z: center.z });
      player.camera.setAttachedToEntity?.(pEnt);
      playerManager.mainPlayer = pEnt;
      player.ui.sendData({ type: 'coin-count', value: coinCount });
      player.ui.on(PlayerUIEvent.DATA, ({ data }) => {
        console.log('[COLLECT][SERVER] ui data (player)', data);
        if (data?.type !== 'collect') return;
        collectBuffer = COLLECT_BUFFER_TICKS;
        player.ui.sendData({ type: 'collect-ack', tick: tickCounter });
      });
      player.ui.load('ui/index.html');
    });

    world.on(PlayerUIEvent.DATA, ({ playerUI, data }) => {
      console.log('[COLLECT][SERVER] ui data (world)', data);
      if (data?.type === 'ui-ready') {
        uiReady = true;
        const main = playerManager.mainPlayer;
        if (main?.player === playerUI.player) {
          playerManager.sendSwimState(main, false, true, tickCounter);
          if (pendingDeathMessage) {
            playerUI.sendData({ type: 'death-screen', message: pendingDeathMessage });
            pendingDeathMessage = null;
          }
          playerUI.sendData({ type: 'coin-count', value: coinCount });
        }
        return;
      }
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
