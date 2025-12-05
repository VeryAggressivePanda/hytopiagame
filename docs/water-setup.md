// Pas deze imports aan naar jouw project / SDK:
/// <reference types="node" />
// import { World, WorldEvent, Entity, RigidBodyType, ColliderShape, BlockType } from '@hytopia/server';

const WATER_BLOCK_ID = 1;
const SAND_BLOCK_ID = 2;

const waterLevel = 5;
const oceanRadius = 20;

const raftSize = 5;
const spacing = 1.1;

const raftBlocks: Entity[] = [];

// ------------------------
// Block types registreren
// ------------------------
function registerBlocks(world: any) {
  console.log('[RAFT] registerBlocks');

  world.blockTypeRegistry.registerBlockType(new BlockType({
    id: WATER_BLOCK_ID,
    name: 'Water',
    textureUri: 'blocks/water.png',
    isLiquid: true,
    isMeshable: true,
  }));

  world.blockTypeRegistry.registerBlockType(new BlockType({
    id: SAND_BLOCK_ID,
    name: 'Sand',
    textureUri: 'blocks/sand.png',
    isLiquid: false,
    isMeshable: true,
  }));
}

// ------------------------
// Oceaan vullen
// ------------------------
function buildOcean(world: any) {
  console.log('[RAFT] buildOcean');

  for (let x = -oceanRadius; x <= oceanRadius; x++) {
    for (let z = -oceanRadius; z <= oceanRadius; z++) {
      world.chunkLattice.setBlock({ x, y: waterLevel,     z }, WATER_BLOCK_ID);
      world.chunkLattice.setBlock({ x, y: waterLevel - 1, z }, WATER_BLOCK_ID);
      world.chunkLattice.setBlock({ x, y: waterLevel - 2, z }, SAND_BLOCK_ID);
    }
  }
}

// ------------------------
// Raft spawnen (5x5 grid)
// ------------------------
function spawnRaft(world: any) {
  console.log('[RAFT] spawnRaft');

  // Oude blokken weg
  raftBlocks.forEach(b => b.isSpawned && b.despawn());
  raftBlocks.length = 0;

  for (let x = 0; x < raftSize; x++) {
    for (let z = 0; z < raftSize; z++) {
      const block = new Entity({
        blockTextureUri: 'blocks/stone-bricks.png',
        blockHalfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        rigidBodyOptions: {
          type: RigidBodyType.DYNAMIC,
          additionalMass: 1,
          linearDamping: 0.5,
          angularDamping: 0.5,
          enabledRotations: { x: true, y: true, z: true },
          colliders: [{
            shape: ColliderShape.BLOCK,
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
            friction: 0.5,
            restitution: 0.2,
          }]
        },
      });

      const posX = (x - 2) * spacing;
      const posZ = (z - 2) * spacing;

      // Start iets boven het water
      block.spawn(world, { x: posX, y: waterLevel + 2, z: posZ });
      raftBlocks.push(block);
    }
  }

  console.log('[RAFT] spawned blocks:', raftBlocks.length);
}

// ------------------------
// Liquid detectie helper
// ------------------------
type LiquidInfo = {
  isInLiquid: boolean;
  blockId: number | null;
};

function getLiquidInfo(world: any, pos: { x: number; y: number; z: number }): LiquidInfo {
  // Sample drie punten rond de Y van het blok (onder, midden, boven)
  const offsets = [-0.49, 0.0, 0.49];

  for (const off of offsets) {
    const sx = Math.floor(pos.x);
    const sy = Math.floor(pos.y + off);
    const sz = Math.floor(pos.z);

    const id = world.chunkLattice.getBlockId({ x: sx, y: sy, z: sz });
    const type = world.blockTypeRegistry.getBlockType(id);

    if (type?.isLiquid) {
      return { isInLiquid: true, blockId: id };
    }
  }

  return { isInLiquid: false, blockId: null };
}

// ------------------------
// Raft scene setup
// ------------------------
function setupRaftScene(world: any) {
  console.log('[RAFT] setupRaftScene');

  registerBlocks(world);
  buildOcean(world);
  spawnRaft(world);

  world.on(WorldEvent.TICK, (time: number) => {
    raftBlocks.forEach((block, i) => {
      if (!block.isSpawned || !block.rigidBody) return;

      const pos = block.position;
      const vel = block.linearVelocity;

      const liquidInfo = getLiquidInfo(world, pos);
      const isInLiquid = liquidInfo.isInLiquid;
      const sampledBlockId = liquidInfo.blockId ?? world.chunkLattice.getBlockId({
        x: Math.floor(pos.x),
        y: Math.floor(pos.y),
        z: Math.floor(pos.z),
      });

      // -----------------------------
      // Debug telemetry (block 0)
      // -----------------------------
      if (i === 0) {
        const msg = `Raft: y=${pos.y.toFixed(2)} vel.y=${vel.y.toFixed(2)} liquid=${isInLiquid} blockId=${sampledBlockId}`;
        console.log(msg);

        world.entityManager.getPlayerEntities().forEach((playerEntity: any) => {
          if (playerEntity.player) {
            playerEntity.player.ui.sendData({
              type: 'debug-info',
              y: pos.y.toFixed(2),
              vely: vel.y.toFixed(2),
              liquid: isInLiquid ? 'YES' : 'NO',
              blockId: sampledBlockId,
              gravity: block.rigidBody?.gravityScale?.toFixed(2) || '?'
            });
          }
        });
      }

      // -----------------------------
      // Buoyancy (jouw originele stijl)
      // -----------------------------
      if (isInLiquid) {
        // in water
        block.setGravityScale(0.01);

        const maxSinkSpeed = -1.0;
        if (vel.y < maxSinkSpeed) {
          block.setLinearVelocity({ x: vel.x, y: maxSinkSpeed, z: vel.z });
        }

        const targetY = waterLevel + 0.5;
        const error = targetY - pos.y;

        if (error > 0.1) {
          // onder target → omhoog duwen
          const upwardVel = Math.min(error * 5.0, 3.0);
          block.setLinearVelocity({ x: vel.x, y: upwardVel, z: vel.z });
        } else if (error < -0.1) {
          // boven target → rustig laten zakken
          block.setLinearVelocity({
            x: vel.x,
            y: Math.max(vel.y, -0.5),
            z: vel.z
          });
        } else {
          // in de “band” rond target
          block.setLinearVelocity({ x: vel.x, y: 0, z: vel.z });
        }

        // Veel demping en rechtop houden
        block.setLinearDamping(8.0);
        block.setAngularDamping(8.0);

        const rot = block.rotation;
        block.setRotation({ x: 0, y: rot.y, z: 0, w: rot.w });

      } else {
        // buiten water
        block.setGravityScale(1.0);
        block.setLinearDamping(0.5);
        block.setAngularDamping(0.5);
      }

      // -----------------------------
      // Cohesion tussen blokken (X/Z)
      // -----------------------------
      let forceX = 0;
      let forceZ = 0;

      raftBlocks.forEach((other, j) => {
        if (i === j || !other.isSpawned) return;

        const otherPos = other.position;
        const dx = otherPos.x - pos.x;
        const dz = otherPos.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 1.0 && dist < 2.5) {
          const pull = (dist - spacing) * 2.0;
          forceX += (dx / dist) * pull;
          forceZ += (dz / dist) * pull;
        }
      });

      if (forceX !== 0 || forceZ !== 0) {
        block.applyImpulse({ x: forceX * 0.1, y: 0, z: forceZ * 0.1 });
      }
    });
  });
}

// ------------------------
// HYTOPIA plugin entry
// ------------------------
export default function main(world: any) {
  console.log('[RAFT] main entry');
  setupRaftScene(world);
}
