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
    const BUBBLE_RADIUS = 48;
    const activeWater = new Map<string, number>();

    const pickWaterBlock = (dist: number) => {
      if (dist > 40) return WATER_SKY_BLOCK_ID;
      if (dist > 30) return WATER_MEDIUM_BLOCK_ID;
      if (dist > 22) return WATER_BRIGHT_BLOCK_ID;
      return WATER_BLOCK_ID;
    };

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

    // ------------------------------------------------------------------
    // Raft
    // ------------------------------------------------------------------
    const raftBlocks: Entity[] = [];
    const spacing = 1.1;
    const raftLength = 5;

    const spawnRaft = (pos: { x: number; z: number }, reason = 'manual') => {
      raftBlocks.forEach(b => b.isSpawned && b.despawn());
      raftBlocks.length = 0;

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
              friction: 0.6,
              bounciness: 0.1,
            }],
          },
        });
        const bx = pos.x + (i - 2) * spacing;
        const bz = pos.z;
        block.spawn(world, { x: bx, y: waterLevel + 2, z: bz });
        raftBlocks.push(block);
      }
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

    world.loop.on(WorldLoopEvent.TICK_START, () => {
      tickCounter++;

      // Player ref
      const players = world.entityManager.getAllPlayerEntities();
      const playerPos = players.length > 0 && players[0].isSpawned
        ? { x: players[0].position.x, z: players[0].position.z }
        : { x: 0, z: 0 };

      // Water aura every tick
      updateWaterAura(playerPos);

      // Sweep stray water (surface only) every second
      if (tickCounter % 20 === 0) {
        const SWEEP_RADIUS = BUBBLE_RADIUS + 6;
        for (let x = Math.floor(playerPos.x - SWEEP_RADIUS); x <= Math.ceil(playerPos.x + SWEEP_RADIUS); x++) {
          for (let z = Math.floor(playerPos.z - SWEEP_RADIUS); z <= Math.ceil(playerPos.z + SWEEP_RADIUS); z++) {
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

      // Raft buoyancy
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
      });

      // Stick players to raft motion if standing on it
      world.entityManager.getAllPlayerEntities().forEach(p => {
        if (!p.isSpawned) return;
        const pp = p.position;
        for (const b of raftBlocks) {
          if (!b.isSpawned) continue;
          const bp = b.position;
          if (Math.abs(pp.x - bp.x) < 0.8 && Math.abs(pp.z - bp.z) < 0.8 && Math.abs(pp.y - (bp.y + 0.5)) < 1.0) {
            // Do not impart impulses to players; let collisions handle any contact
            break;
          }
        }
      });
    });

    // ------------------------------------------------------------------
    // Player join/commands
    // ------------------------------------------------------------------
    world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
      const pEnt = new DefaultPlayerEntity({ player, name: 'Player' });
      pEnt.spawn(world, { x: 0, y: waterLevel + 5, z: 0 });
      player.ui.load('ui/index.html');
      world.chatManager.sendPlayerMessage(player, '🌊 /raft spawns beside you, /shark spawns a shark.', '00FFFF');

      spawnRaft({ x: pEnt.position.x + 3, z: pEnt.position.z }, 'join');

      world.chatManager.registerCommand('/raft', () => {
        const p = player.entity?.position ?? pEnt.position;
        spawnRaft({ x: p.x + 3, z: p.z }, 'command');
        world.chatManager.sendPlayerMessage(player, '🚤 Raft spawned', '00FF00');
      });

      world.chatManager.registerCommand('/shark', () => {
        const p = player.entity?.position ?? pEnt.position;
        spawnShark({ x: p.x, z: p.z });
        world.chatManager.sendPlayerMessage(player, '🦈 Shark spawned', 'FF0000');
      });

      player.ui.on(PlayerUIEvent.DATA, ({ data }) => {
        if (data.type !== 'physics-update') return;
        switch (data.param) {
          case 'height': physicsParams.targetHeight = data.value; break;
          case 'stiffness': physicsParams.stiffness = data.value; break;
          case 'ldamp': physicsParams.linearDamping = data.value; break;
          case 'adamp': physicsParams.angularDamping = data.value; break;
        }
      });
    });

    world.on(PlayerEvent.LEFT_WORLD, ({ player }) => {
      world.entityManager.getPlayerEntitiesByPlayer(player).forEach(e => e.despawn());
    });
  } catch (err) {
    console.error('[CRITICAL] Startup error:', err);
  }
});

