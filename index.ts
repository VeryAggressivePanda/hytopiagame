import {
  BlockType,
  ColliderShape,
  DefaultPlayerEntity,
  Entity,
  PlayerEvent,
  PlayerUIEvent,
  RigidBodyType,
  WorldLoopEvent,
  startServer,
} from 'hytopia';

// Minimal rebuild: shallow water aura, raft beside player, shark only rams raft.

startServer(world => {
  // Basic guards
  process.on('uncaughtException', err => console.error('[CRITICAL] Uncaught:', err));
  process.on('unhandledRejection', reason => console.error('[CRITICAL] Unhandled:', reason));

  try {
    // ------------------------------------------------------------------
    // Block registration
    // ------------------------------------------------------------------
    const WATER_BLOCK_ID = 1;
    const WATER_BRIGHT_BLOCK_ID = 2;
    const WATER_MEDIUM_BLOCK_ID = 3;
    const WATER_SKY_BLOCK_ID = 4;
    const SAND_BLOCK_ID = 5;

    world.blockTypeRegistry.registerBlockType(new BlockType({
      id: WATER_BLOCK_ID,
      name: 'Water',
      textureUri: 'blocks/water.png',
      isLiquid: true,
    }));
    world.blockTypeRegistry.registerBlockType(new BlockType({
      id: WATER_BRIGHT_BLOCK_ID,
      name: 'Water Bright',
      textureUri: 'blocks/water_bright1.png',
      isLiquid: true,
    }));
    world.blockTypeRegistry.registerBlockType(new BlockType({
      id: WATER_MEDIUM_BLOCK_ID,
      name: 'Water Medium Bright',
      textureUri: 'blocks/water_bright2.png',
      isLiquid: true,
    }));
    world.blockTypeRegistry.registerBlockType(new BlockType({
      id: WATER_SKY_BLOCK_ID,
      name: 'Water Sky Bright',
      textureUri: 'blocks/water_bright2.png',
      isLiquid: true,
    }));
    world.blockTypeRegistry.registerBlockType(new BlockType({
      id: SAND_BLOCK_ID,
      name: 'Sand',
      textureUri: 'blocks/sand.png',
      isLiquid: false,
    }));

    // ------------------------------------------------------------------
    // Water aura (1-block shallow, always centered on player)
    // ------------------------------------------------------------------
    const waterLevel = 5;
    const BUBBLE_RADIUS = 15; // ~30 diameter for lighter per-tick updates
    const activeWater = new Map<string, number>();
    type Island = {
      center: { x: number; z: number };
      radius: number;
      blocks: { x: number; y: number; z: number }[];
      wedgesGeom: { x: number; y: number; z: number; rot: { x: number; y: number; z: number; w: number } }[];
      spawnedBlocks: Set<string>;
      spawnedWedges: Entity[];
    };
    const islandBaseKeys = new Set<string>(); // x,z at water level occupied by sand
    const islands: Island[] = [];
    const plannedIslands = new Map<string, { center: { x: number; z: number }; radius: number }>();
    const ISLAND_GRID = 20; // much tighter grid so islands can appear near player
    const ISLAND_MIN_DISTANCE = 8;
    const ISLAND_BUFFER_DISTANCE = BUBBLE_RADIUS + 4;
    const ISLAND_PLAYER_CLEAR_RADIUS = 9; // no island overlap with raft/player

    const pickWaterBlock = (dist: number) => {
      if (dist > 12) return WATER_SKY_BLOCK_ID;
      if (dist > 9) return WATER_MEDIUM_BLOCK_ID;
      if (dist > 6) return WATER_BRIGHT_BLOCK_ID;
      return WATER_BLOCK_ID;
    };

    const isIslandBase = (x: number, z: number) => islandBaseKeys.has(`${x},${z}`);

    const updateWaterAura = (center: { x: number; z: number }) => {
      // Cull outside
      for (const [key] of activeWater) {
        const [x, z] = key.split(',').map(Number);
        if (Math.hypot(x - center.x, z - center.z) > BUBBLE_RADIUS) {
          world.chunkLattice.setBlock({ x, y: waterLevel, z }, 0);
          activeWater.delete(key);
        }
      }

      const startX = Math.floor(center.x - BUBBLE_RADIUS);
      const endX = Math.ceil(center.x + BUBBLE_RADIUS);
      const startZ = Math.floor(center.z - BUBBLE_RADIUS);
      const endZ = Math.ceil(center.z + BUBBLE_RADIUS);

      for (let x = startX; x < endX; x++) {
        for (let z = startZ; z < endZ; z++) {
          if (isIslandBase(x, z)) continue; // islands displace water
          const dist = Math.hypot(x - center.x, z - center.z);
          if (dist > BUBBLE_RADIUS) continue;
          const key = `${x},${z}`;
          const target = pickWaterBlock(dist);
          if (activeWater.get(key) !== target) {
            world.chunkLattice.setBlock({ x, y: waterLevel, z }, target);
            activeWater.set(key, target);
          }
        }
      }
    };

    const quatYawPitch = (yaw: number, pitch: number) => {
      const cy = Math.cos(yaw / 2);
      const sy = Math.sin(yaw / 2);
      const cp = Math.cos(pitch / 2);
      const sp = Math.sin(pitch / 2);
      return {
        x: cy * sp,
        y: sy * cp,
        z: -sy * sp,
        w: cy * cp,
      };
    };

    const noise2D = (i: number, j: number) => {
      const s = Math.sin(i * 127.1 + j * 311.7 + 0.12345) * 43758.5453123;
      return s - Math.floor(s);
    };
    const rand2 = (x: number, z: number, salt = 0) => noise2D(x * 3.1 + salt, z * 3.3 - salt);

    const ensurePlannedIslandsAround = (center: { x: number; z: number }) => {
      const cx = Math.round(center.x / ISLAND_GRID);
      const cz = Math.round(center.z / ISLAND_GRID);
      const radiusCells = Math.ceil((BUBBLE_RADIUS + 12) / ISLAND_GRID) + 1;

      for (let ix = cx - radiusCells; ix <= cx + radiusCells; ix++) {
        for (let iz = cz - radiusCells; iz <= cz + radiusCells; iz++) {
          const key = `${ix},${iz}`;
          if (plannedIslands.has(key)) continue;
          const n = noise2D(ix, iz);
          if (n < 0.55) continue; // deterministic density filter

          // Size: broad spread, higher noise -> larger island
          const radius = n > 0.82
            ? 4.0 + (n - 0.82) * 8 // up to ~5.6
            : 1.6 + (n - 0.55) * 4; // ~1.6 - 2.7

          const centerPos = { x: ix * ISLAND_GRID + ISLAND_GRID * 0.5, z: iz * ISLAND_GRID + ISLAND_GRID * 0.5 };

          // Avoid dense clusters vs existing planned centers
          const tooClose = Array.from(plannedIslands.values()).some(p =>
            Math.hypot(p.center.x - centerPos.x, p.center.z - centerPos.z) < (p.radius + radius + ISLAND_MIN_DISTANCE)
          );
          if (tooClose) continue;

          plannedIslands.set(key, { center: centerPos, radius });
        }
      }

    };

    const buildIsland = (center: { x: number; z: number }, radius: number) => {
      const blocks: { x: number; y: number; z: number }[] = [];
      const wedgesGeom: { x: number; y: number; z: number; rot: { x: number; y: number; z: number; w: number } }[] = [];
      const roughness = 0.9;
      const maxHeight = 3; // gentle slope, 1–3 blocks tall
      const minX = Math.floor(center.x - radius - 2);
      const maxX = Math.ceil(center.x + radius + 2);
      const minZ = Math.floor(center.z - radius - 2);
      const maxZ = Math.ceil(center.z + radius + 2);

      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          const jitter = (rand2(x, z) - 0.5) * roughness;
          const dist = Math.hypot(x - center.x, z - center.z) + jitter;
          if (dist > radius + 1.2) continue;

          // Higher in the middle, falling off near the edge
          const heightFalloff = Math.max(0, radius - dist);
          const slopeNoise = (rand2(x + 17, z - 11) - 0.5) * 0.6;
          const height = Math.max(0, Math.min(maxHeight, Math.floor(heightFalloff * 0.9 + slopeNoise + 1)));

          for (let h = 0; h <= height; h++) {
            const y = waterLevel + h;
            blocks.push({ x, y, z });
          }

          // Rim wedge: only near edge and low height to mimic slope
          if (height <= 2 && dist > radius - 1.3 && dist <= radius + 0.6) {
            const dx = x - center.x;
            const dz = z - center.z;
            const yaw = Math.atan2(dx, dz);
            const tilt = -Math.PI / 4; // 45° down away from center
            const rot = quatYawPitch(yaw, tilt);
            wedgesGeom.push({
              x,
              y: waterLevel + height + 0.3,
              z,
              rot,
            });
          }
        }
      }

      islands.push({ center, radius, blocks, wedgesGeom, spawnedBlocks: new Set(), spawnedWedges: [] });
      console.log(`[ISLAND] Created at (${center.x.toFixed(1)}, ${center.z.toFixed(1)}) r=${radius.toFixed(2)}`);
    };

    const removeIsland = (island: Island) => {
      island.spawnedBlocks.forEach(key => {
        const [x, y, z] = key.split(',').map(Number);
        if (y === waterLevel) islandBaseKeys.delete(`${x},${z}`);
        world.chunkLattice.setBlock({ x, y, z }, 0);
      });
      island.spawnedBlocks.clear();
      island.spawnedWedges.forEach(w => w.isSpawned && w.despawn());
      island.spawnedWedges.length = 0;
    };

    const maintainIslands = (center: { x: number; z: number }) => {
      // Ensure plans exist around the player (deterministic sites)
      ensurePlannedIslandsAround(center);

      // Despawn active islands that leave the visible circle (but keep their plans)
      for (let i = islands.length - 1; i >= 0; i--) {
        const island = islands[i];
        const dist = Math.hypot(island.center.x - center.x, island.center.z - center.z);
        if (dist > ISLAND_BUFFER_DISTANCE) {
          removeIsland(island);
          islands.splice(i, 1);
        }
      }

      // Spawn planned islands that enter the circle, but never in the raft's forward path corridor
      const forwardDir = { x: driftDir.x, z: driftDir.z };
      const corridorHalfWidth = 6; // meters left/right of forward path
      const corridorAhead = 30; // only block ahead region
      for (const plan of plannedIslands.values()) {
        const dx = plan.center.x - center.x;
        const dz = plan.center.z - center.z;
        const dist = Math.hypot(dx, dz);
        if (dist > BUBBLE_RADIUS + 6) continue; // only near the bubble

        // Reject if inside forward corridor in front of raft
        const forwardDot = dx * forwardDir.x + dz * forwardDir.z;
        const lateral = Math.abs(dx * forwardDir.z - dz * forwardDir.x);
        if (forwardDot > 0 && forwardDot < corridorAhead && lateral < corridorHalfWidth) {
          continue; // skip spawning in the path corridor
        }

        const alreadyActive = islands.some(i => i.center.x === plan.center.x && i.center.z === plan.center.z);
        if (!alreadyActive) {
          buildIsland(plan.center, plan.radius);
        }
      }

      // Incremental reveal/hide for active islands (with hysteresis; allow passing through center)
      const revealRadius = BUBBLE_RADIUS + 0.5;
      const hideRadius = BUBBLE_RADIUS + 1.5;
      for (const island of islands) {
        island.blocks.forEach(({ x, y, z }) => {
          const key = `${x},${y},${z}`;
          const dist = Math.hypot(x - center.x, z - center.z);
          const isSpawned = island.spawnedBlocks.has(key);
          const withinReveal = dist <= revealRadius;
          const withinHide = dist <= hideRadius;
          const outsideHide = dist > hideRadius;

          // Do not spawn new blocks inside clear radius, but keep already spawned ones
          if (!isSpawned && dist < ISLAND_PLAYER_CLEAR_RADIUS) return;

          if (withinReveal && !isSpawned) {
            if (y === waterLevel) {
              islandBaseKeys.add(`${x},${z}`);
              activeWater.delete(`${x},${z}`);
            }
            world.chunkLattice.setBlock({ x, y, z }, SAND_BLOCK_ID);
            island.spawnedBlocks.add(key);
          } else if (outsideHide && isSpawned) {
            if (y === waterLevel) islandBaseKeys.delete(`${x},${z}`);
            world.chunkLattice.setBlock({ x, y, z }, 0);
            island.spawnedBlocks.delete(key);
          }
        });

        // Wedges spawn/despawn per visibility
        for (let i = 0; i < island.wedgesGeom.length; i++) {
          const wg = island.wedgesGeom[i];
          const dist = Math.hypot(wg.x - center.x, wg.z - center.z);
          const existing = island.spawnedWedges[i];
          const withinReveal = dist <= revealRadius;
          const outsideHide = dist > hideRadius;

          // Avoid spawning new wedges inside clear radius
          if (!existing && dist < ISLAND_PLAYER_CLEAR_RADIUS) continue;

          if (withinReveal && (!existing || !existing.isSpawned)) {
            const wedge = new Entity({
              tag: 'island-wedge',
              blockTextureUri: 'blocks/sand.png',
              blockHalfExtents: { x: 0.5, y: 0.2, z: 0.5 },
              rigidBodyOptions: {
                type: RigidBodyType.KINEMATIC_POSITION,
                colliders: [{
                  shape: ColliderShape.BLOCK,
                  halfExtents: { x: 0.5, y: 0.2, z: 0.5 },
                  friction: 0.8,
                }],
              },
            });
            wedge.spawn(world, { x: wg.x, y: wg.y, z: wg.z });
            wedge.setRotation(wg.rot);
            island.spawnedWedges[i] = wedge;
          } else if (outsideHide && existing && existing.isSpawned) {
            existing.despawn();
          }
        }
      }
    };

    let lastCenter = { x: 0, z: 0 };
    let mainPlayer: DefaultPlayerEntity | undefined;
    const getBubbleCenter = () => {
      const aliveRaft = raftBlocks.filter(b => b.isSpawned);
      if (aliveRaft.length > 0) {
        const center = aliveRaft.reduce((a, b) => ({ x: a.x + b.position.x, z: a.z + b.position.z }), { x: 0, z: 0 });
        center.x /= aliveRaft.length;
        center.z /= aliveRaft.length;
        lastCenter = center;
        return center;
      }
      const p = mainPlayer && mainPlayer.isSpawned
        ? mainPlayer
        : world.entityManager.getAllPlayerEntities().find(p => p.isSpawned);
      if (p) {
        lastCenter = { x: p.position.x, z: p.position.z };
      }
      return lastCenter;
    };

    // ------------------------------------------------------------------
    // Raft
    // ------------------------------------------------------------------
    const raftBlocks: Entity[] = [];
    const spacing = 1.1;
    const raftLength = 5;
    const raftOffsets: number[] = [];
    const foamPuffs: { e: Entity; ttl: number }[] = [];
    let lastFoamDir = { x: 0, z: -1 };
    let driftDir = { x: 0, z: -1 }; // current drift direction
    let driftTarget = { x: 0, z: -1 };
    let driftTimer = 0;
    let driftSpeed = 2; // meters per second, adjustable via UI
    const DRIFT_STEER_INTERVAL = 220; // ticks (~11s)
    const DRIFT_TURN_RATE = 0.03; // small nudge per tick toward target

    const spawnRaft = (pos: { x: number; z: number }, reason = 'manual') => {
      raftBlocks.forEach(b => b.isSpawned && b.despawn());
      raftBlocks.length = 0;
      raftOffsets.length = 0;
      for (let i = 0; i < 5; i++) {
        const block = new Entity({
          tag: 'raft-block',
          blockTextureUri: 'blocks/wood_beam.png',
          blockHalfExtents: { x: 0.5, y: 0.5, z: raftLength / 2 },
          rigidBodyOptions: {
            type: RigidBodyType.DYNAMIC,
            additionalMass: 5,
            linearDamping: 0.6,
            angularDamping: 0.6,
            enabledRotations: { x: true, y: true, z: true },
            colliders: [{
              shape: ColliderShape.BLOCK,
              halfExtents: { x: 0.5, y: 0.5, z: raftLength / 2 },
              friction: 0.15,
              bounciness: 0.0,
            }],
          },
        });
        const bx = pos.x + (i - 2) * spacing;
        const bz = pos.z;
        block.spawn(world, { x: bx, y: waterLevel + 2, z: bz });
        raftBlocks.push(block);
        raftOffsets.push((i - 2) * spacing);
      }
      lastCenter = { x: pos.x, z: pos.z };
      console.log(`[RAFT] Spawned (${reason}) at x=${pos.x.toFixed(1)} z=${pos.z.toFixed(1)}`);
    };

    // ------------------------------------------------------------------
    // Shark
    // ------------------------------------------------------------------
    let sharkEntity: Entity | undefined;
    let sharkFin: Entity | undefined;
    enum SharkState { CIRCLING, RAMMING }

    const spawnShark = (center: { x: number; z: number }) => {
      sharkEntity?.isSpawned && sharkEntity.despawn();
      sharkFin?.isSpawned && sharkFin.despawn();

      const angle = Math.random() * Math.PI * 2;
      const spawnDist = BUBBLE_RADIUS - 5;
      const sx = center.x + Math.cos(angle) * spawnDist;
      const sz = center.z + Math.sin(angle) * spawnDist;

      sharkEntity = new Entity({
        tag: 'shark',
        blockTextureUri: 'blocks/stone.png',
        blockHalfExtents: { x: 0.5, y: 0.5, z: 1.5 },
        rigidBodyOptions: {
          type: RigidBodyType.DYNAMIC,
          gravityScale: 0,
          additionalMass: 8,
          colliders: [{
            shape: ColliderShape.BLOCK,
            halfExtents: { x: 0.5, y: 0.5, z: 1.5 },
            isSensor: true, // no player knockback
          }],
        },
      });

      sharkFin = new Entity({
        tag: 'shark-fin',
        blockTextureUri: 'blocks/stone.png',
        blockHalfExtents: { x: 0.1, y: 0.3, z: 0.4 },
        rigidBodyOptions: { type: RigidBodyType.DYNAMIC, gravityScale: 0, colliders: [] },
      });

      sharkEntity.spawn(world, { x: sx, y: waterLevel - 0.5, z: sz });
      sharkFin.spawn(world, { x: sx, y: waterLevel + 0.1, z: sz });
      sharkFin.setParent(sharkEntity, undefined, { x: 0, y: 0.6, z: 0 });

      (sharkEntity as any).ai = { state: SharkState.CIRCLING, timer: 0, target: null as { x: number; z: number } | null };
      console.log('[SHARK] Spawned');
    };

    // ------------------------------------------------------------------
    // Physics params (raft buoyancy)
    // ------------------------------------------------------------------
    const SWIM_GRAVITY = 0.3;
    const SWIM_MAX_FALL_SPEED = -2.0;
    const TICK_DELTA = 1 / 20;
    let physicsParams = {
      targetHeight: 0.5,
      stiffness: 6.0,
      linearDamping: 5.0,
      angularDamping: 2.0,
    };

    // ------------------------------------------------------------------
    // Loop
    // ------------------------------------------------------------------
    let tickCounter = 0;

    world.loop.on(WorldLoopEvent.TICK_END, () => {
      tickCounter++;

      // Player ref (stable, prefers closest to last center)
      const playerPos = getBubbleCenter();

      // Islands are ephemeral and only appear inside the circle
      maintainIslands(playerPos);

      // Water aura every tick (small radius for perf)
      updateWaterAura(playerPos);

      // Game over if player reaches edge of bubble
      world.entityManager.getAllPlayerEntities().forEach(p => {
        if (!p.isSpawned) return;
        const dx = p.position.x - playerPos.x;
        const dz = p.position.z - playerPos.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= BUBBLE_RADIUS - 0.25) {
          world.chatManager.sendPlayerMessage(p.player, '💀 You drifted too far. Game over.', 'FF0000');
          p.setLinearVelocity({ x: 0, y: 0, z: 0 });
          p.setAngularVelocity?.({ x: 0, y: 0, z: 0 });
          p.despawn();
          p.spawn(world, { x: playerPos.x, y: waterLevel + 5, z: playerPos.z });
        }
      });

      // Cull stray player entities (single-player friendly)
      const m = mainPlayer;
      if (m) {
        world.entityManager.getAllPlayerEntities().forEach(p => {
          if (p !== m && p.isSpawned && p.player !== m.player) {
            p.despawn();
          }
        });
      }

      // Sweep stray water (surface only) every second
      if (tickCounter % 20 === 0) {
        const SWEEP_RADIUS = BUBBLE_RADIUS + 6;
        for (let x = Math.floor(playerPos.x - SWEEP_RADIUS); x <= Math.ceil(playerPos.x + SWEEP_RADIUS); x++) {
          for (let z = Math.floor(playerPos.z - SWEEP_RADIUS); z <= Math.ceil(playerPos.z + SWEEP_RADIUS); z++) {
            if (isIslandBase(x, z)) continue;
            const dist = Math.hypot(x - playerPos.x, z - playerPos.z);
            if (dist > BUBBLE_RADIUS + 1) {
              const key = `${x},${z}`;
              const id = world.chunkLattice.getBlockId({ x, y: waterLevel, z });
              if (id === WATER_BLOCK_ID || id === WATER_BRIGHT_BLOCK_ID || id === WATER_MEDIUM_BLOCK_ID || id === WATER_SKY_BLOCK_ID) {
                world.chunkLattice.setBlock({ x, y: waterLevel, z }, 0);
                activeWater.delete(key);
              }
            }
          }
        }
      }

      // Drift: slowly push raft in a persistent direction with gentle steering
      driftTimer++;
      if (driftTimer % DRIFT_STEER_INTERVAL === 0) {
        const ang = Math.atan2(driftDir.z, driftDir.x);
        const delta = (Math.random() - 0.5) * 0.25; // small heading change
        const targetAng = ang + delta;
        driftTarget = { x: Math.cos(targetAng), z: Math.sin(targetAng) };
      }
      // Nudge driftDir toward driftTarget
      const mix = DRIFT_TURN_RATE;
      driftDir = {
        x: driftDir.x * (1 - mix) + driftTarget.x * mix,
        z: driftDir.z * (1 - mix) + driftTarget.z * mix,
      };
      const dLen = Math.hypot(driftDir.x, driftDir.z) || 1;
      driftDir.x /= dLen; driftDir.z /= dLen;

      // Shark AI
      if (sharkEntity && sharkEntity.isSpawned) {
        const ai = (sharkEntity as any).ai;
        const pos = sharkEntity.position;
        const aliveRaft = raftBlocks.filter(b => b.isSpawned);

        if (ai.state === SharkState.CIRCLING) {
          if (aliveRaft.length > 0 && Math.random() < 0.02) {
            let nearest = aliveRaft[0];
            let nd = Infinity;
            aliveRaft.forEach(b => {
              const d = (b.position.x - pos.x) ** 2 + (b.position.z - pos.z) ** 2;
              if (d < nd) { nd = d; nearest = b; }
            });
            ai.state = SharkState.RAMMING;
            ai.target = { x: nearest.position.x, z: nearest.position.z };
            ai.timer = 120;
          } else {
            const radius = 15;
            const angle = (Date.now() / 1000) * 0.5;
            ai.target = { x: playerPos.x + Math.cos(angle) * radius, z: playerPos.z + Math.sin(angle) * radius };
          }
        } else if (ai.state === SharkState.RAMMING) {
          if (!ai.target || ai.timer <= 0 || aliveRaft.length === 0) {
            ai.state = SharkState.CIRCLING;
            ai.target = null;
          }
          ai.timer--;
        }

        if (ai.target) {
          const dx = ai.target.x - pos.x;
          const dz = ai.target.z - pos.z;
          const dist = Math.hypot(dx, dz);
          const speed = ai.state === SharkState.RAMMING ? 15 : 8;
          const vx = dist > 0.1 ? (dx / dist) * speed : 0;
          const vz = dist > 0.1 ? (dz / dist) * speed : 0;
          const targetY = waterLevel - 0.5;
          const vy = (targetY - pos.y) * 5;
          sharkEntity.setLinearVelocity({ x: vx, y: vy, z: vz });
          const yaw = Math.atan2(dx, dz);
          sharkEntity.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
        }

        if (ai.state === SharkState.RAMMING && ai.target) {
          const dist = Math.hypot(pos.x - ai.target.x, pos.z - ai.target.z);
          if (dist < 2.2) {
            aliveRaft.forEach(b => {
              const bp = b.position;
              const bd = Math.hypot(bp.x - pos.x, bp.z - pos.z);
              if (bd < 3.0) {
                b.applyImpulse({
                  x: (bp.x - pos.x) * 25,
                  y: 10,
                  z: (bp.z - pos.z) * 25,
                });
              }
            });
            ai.state = SharkState.CIRCLING;
            ai.target = null;
            ai.timer = 0;
          }
        }
      }

      // Raft buoyancy + drift cohesion
      raftBlocks.forEach(block => {
        if (!block.isSpawned) return;
        const pos = block.position;
        const vel = block.linearVelocity;
        const mass = block.mass;
        const halfHeight = block.blockHalfExtents?.y ?? 0.5;
        const blockBottom = pos.y - halfHeight;
        const waterSurface = waterLevel + 1;
        const targetCenterY = waterLevel + physicsParams.targetHeight;
        const isSubmerged = blockBottom < waterSurface + 0.25;

        if (isSubmerged) {
          const error = targetCenterY - pos.y;
          const springAccel = error * physicsParams.stiffness;
          const dampingAccel = -vel.y * physicsParams.linearDamping;
          const impulseY = (springAccel + dampingAccel) * mass * TICK_DELTA;
          const buoyancy = Math.max(0, Math.min(waterSurface - blockBottom, halfHeight * 2)) / (halfHeight * 2);
          const buoyancyImpulse = buoyancy * mass * 10 * TICK_DELTA;

          block.setGravityScale(SWIM_GRAVITY);
          if (vel.y < SWIM_MAX_FALL_SPEED) block.setLinearVelocity({ x: vel.x, y: SWIM_MAX_FALL_SPEED, z: vel.z });
          block.applyImpulse({ x: 0, y: impulseY + buoyancyImpulse, z: 0 });
          block.setLinearDamping(Math.max(physicsParams.linearDamping, 2));
          block.setAngularDamping(Math.max(physicsParams.angularDamping, 2));
          block.wakeUp();
          block.setRotation({ x: 0, y: block.rotation.y, z: 0, w: block.rotation.w });
        } else {
          block.setGravityScale(1.0);
          block.setLinearDamping(0.5);
          block.setAngularDamping(0.5);
        }

        // Apply slow drift velocity target
        const desiredVX = driftDir.x * driftSpeed;
        const desiredVZ = driftDir.z * driftSpeed;
        const corrX = (desiredVX - vel.x) * 4; // stronger to maintain speed
        const corrZ = (desiredVZ - vel.z) * 4;
        block.applyImpulse({ x: corrX * mass * TICK_DELTA, y: 0, z: corrZ * mass * TICK_DELTA });
      });

      // Raft cohesion: gentle spring toward formation to keep beams together
      if (raftBlocks.length > 0) {
        const center = raftBlocks.reduce((a, b) => ({ x: a.x + b.position.x, z: a.z + b.position.z }), { x: 0, z: 0 });
        center.x /= raftBlocks.length;
        center.z /= raftBlocks.length;
        const spring = 6.0;
        const damp = 1.2;
        raftBlocks.forEach((b, idx) => {
          if (!b.isSpawned) return;
          const pos = b.position;
          const vel = b.linearVelocity;
          const targetX = center.x + (raftOffsets[idx] ?? 0);
          const targetZ = center.z;
          const dx = targetX - pos.x;
          const dz = targetZ - pos.z;
          const fx = dx * spring - vel.x * damp;
          const fz = dz * spring - vel.z * damp;
          b.applyImpulse({ x: fx * b.mass * TICK_DELTA, y: 0, z: fz * b.mass * TICK_DELTA });
        });
      }

      // Foam puffs: continuous trickle behind raft; no upward impulse
      const aliveRaft = raftBlocks.filter(b => b.isSpawned);
      if (aliveRaft.length > 0) {
        const avgPos = aliveRaft.reduce((a, b) => ({ x: a.x + b.position.x, z: a.z + b.position.z }), { x: 0, z: 0 });
        avgPos.x /= aliveRaft.length;
        avgPos.z /= aliveRaft.length;

        lastFoamDir = driftDir;

        if (tickCounter % 2 === 0) { // spawn every ~0.1s at 20 tps
          const dir = lastFoamDir;
          const perp = { x: -dir.z, z: dir.x }; // sideways across raft
          const backOffset = raftLength * 0.6;
          const widthSpread = 3.0; // cover raft width
          const jitter = () => (Math.random() - 0.5) * 0.6;
          const lateral = (Math.random() - 0.5) * widthSpread;
          const spawnPos = {
            x: avgPos.x - dir.x * backOffset + perp.x * lateral + jitter(),
            y: waterLevel + 1,
            z: avgPos.z - dir.z * backOffset + perp.z * lateral + jitter(),
          };
          const foam = new Entity({
            tag: 'foam',
            blockTextureUri: 'blocks/water_sky.png',
            blockHalfExtents: { x: 0.12, y: 0.12, z: 0.12 },
            rigidBodyOptions: {
              type: RigidBodyType.DYNAMIC,
              gravityScale: 0,
              linearDamping: 4,
              angularDamping: 4,
              colliders: [],
            },
          });
          foam.spawn(world, spawnPos);
          // Match raft motion, slight backward drift, no upward impulse
          foam.setLinearVelocity({
            x: driftDir.x * driftSpeed * 0.5 - dir.x * 0.8 + jitter() * 0.2,
            y: 0,
            z: driftDir.z * driftSpeed * 0.5 - dir.z * 0.8 + jitter() * 0.2,
          });
          foamPuffs.push({ e: foam, ttl: 40 }); // ~2 seconds at 20 tps
        }
      }

      // Foam TTL cleanup
      for (let i = foamPuffs.length - 1; i >= 0; i--) {
        const puff = foamPuffs[i];
        puff.ttl -= 1;
        if (puff.ttl <= 0) {
          puff.e.isSpawned && puff.e.despawn();
          foamPuffs.splice(i, 1);
        }
      }

      // Stick players to raft/deck motion if standing on it
      world.entityManager.getAllPlayerEntities().forEach(p => {
        if (!p.isSpawned) return;
        const pp = p.position;
        const pv = p.linearVelocity;
        for (const b of raftBlocks) {
          if (!b.isSpawned) continue;
          const bp = b.position;
          if (Math.abs(pp.x - bp.x) < 0.8 && Math.abs(pp.z - bp.z) < 0.8 && Math.abs(pp.y - (bp.y + 0.5)) < 1.0) {
            // Match horizontal velocity to raft to avoid being pushed off
            const rv = b.linearVelocity;
            const blend = 1.0;
            p.setLinearVelocity({
              x: rv.x * blend + pv.x * (1 - blend),
              y: pv.y,
              z: rv.z * blend + pv.z * (1 - blend),
            });
            break;
          }
        }
      });

    });

    // ------------------------------------------------------------------
    // Player join/commands
    // ------------------------------------------------------------------
    world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
      // Cleanup any stale entities for this player (e.g., refresh without proper leave)
      world.entityManager.getPlayerEntitiesByPlayer(player).forEach(e => e.isSpawned && e.despawn());
      // Cull any other player entities to avoid ghost players (single-player friendly)
      world.entityManager.getAllPlayerEntities().forEach(e => {
        if (e.player !== player && e.isSpawned) e.despawn();
      });

      const pEnt = new DefaultPlayerEntity({ player, name: 'Player' });
      pEnt.spawn(world, { x: 0, y: waterLevel + 5, z: 0 });
      // Ensure platform sticking uses engine support (kinematic deck is treated as platform)
      const ctrl: any = pEnt.controller;
      if (ctrl && 'sticksToPlatforms' in ctrl) ctrl.sticksToPlatforms = true;
      mainPlayer = pEnt;
      player.ui.load('ui/index.html');
      world.chatManager.sendPlayerMessage(player, '🌊 /raft spawns beside you, /shark spawns a shark.', '00FFFF');

      spawnRaft({ x: pEnt.position.x + 3, z: pEnt.position.z }, 'join');

      world.chatManager.registerCommand('/raft', () => {
        const active = pEnt.isSpawned ? pEnt : world.entityManager.getPlayerEntitiesByPlayer(player)[0];
        const pos = active?.position ?? pEnt.position;
        spawnRaft({ x: pos.x + 3, z: pos.z }, 'command');
        world.chatManager.sendPlayerMessage(player, '🚤 Raft spawned', '00FF00');
      });

      world.chatManager.registerCommand('/shark', () => {
        const active = pEnt.isSpawned ? pEnt : world.entityManager.getPlayerEntitiesByPlayer(player)[0];
        const pos = active?.position ?? pEnt.position;
        spawnShark({ x: pos.x, z: pos.z });
        world.chatManager.sendPlayerMessage(player, '🦈 Shark spawned', 'FF0000');
      });

      player.ui.on(PlayerUIEvent.DATA, ({ data }) => {
        if (data.type !== 'physics-update') return;
        switch (data.param) {
          case 'raft-speed': driftSpeed = Math.max(0, Math.min(2, data.value)); break;
        }
      });
    });

    world.on(PlayerEvent.LEFT_WORLD, ({ player }) => {
      world.entityManager.getPlayerEntitiesByPlayer(player).forEach(e => e.despawn());
      if (mainPlayer && mainPlayer.player === player) {
        mainPlayer = undefined;
      }
    });
  } catch (err) {
    console.error('[CRITICAL] Startup error:', err);
  }
});

