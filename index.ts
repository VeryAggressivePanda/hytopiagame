import {
  BlockType,
  ColliderShape,
  DefaultPlayerEntity,
  DefaultPlayerEntityController,
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
    type IslandPlan = {
      center: { x: number; z: number };
      radius: number;
      yaw: number;
      halfLength: number;
      halfWidth: number;
    };
    type Island = IslandPlan & {
      blocks: { x: number; y: number; z: number }[];
      wedgesGeom: { x: number; y: number; z: number; rot: { x: number; y: number; z: number; w: number } }[];
      spawnedBlocks: Set<string>;
      spawnedWedges: Entity[];
      palm?: Entity | null;
      palmPos?: { x: number; y: number; z: number };
      palmModelUri?: string;
      palmScale?: number;
      hull?: { x: number; z: number }[]; // 2D outline at water level for minimap
      chest?: Entity | null;
      chestAnchorKey?: string;
      chestPos?: { x: number; y: number; z: number };
    };
    type Fish = {
      e: Entity | null;
      ang: number;
      radius: number;
      height: number;
      speed: number;
      modelUri: string;
    };
    type BankPlan = {
      key: string;
      center: { x: number; z: number };
      blocks: { x: number; y: number; z: number }[];
    };
    const islandBaseKeys = new Set<string>(); // x,z at water level occupied by sand
    const islands: Island[] = [];
    const plannedIslands = new Map<string, IslandPlan>();
    const BANK_SEG_LEN = 14; // length of each planned slice along forward axis
    const bankPlans = new Map<string, BankPlan>();
    const bankSpawnedBlocks = new Map<string, Set<string>>();
    const ISLAND_GRID = 20; // much tighter grid so islands can appear near player
    const ISLAND_MIN_DISTANCE = 8;
    const ISLAND_BUFFER_DISTANCE = BUBBLE_RADIUS + 20;
    const fishLife: Fish[] = [];
    const FISH_COUNT = 8;
    const FISH_MODELS = [
      'models/NPCs/anglerfish.gltf',
      'models/NPCs/catfish.gltf',
      'models/NPCs/clownfish.gltf',
      'models/NPCs/electric-catfish.gltf',
      'models/NPCs/flying-fish.gltf',
      'models/NPCs/lionfish.gltf',
      'models/NPCs/parrotfish.gltf',
      'models/NPCs/pufferfish.gltf',
      'models/NPCs/sailfish.gltf',
      'models/NPCs/swordfish.gltf',
    ];
    // Loot pool (exclude the chest itself)
    const CHESTS_ENABLED = false; // TEMP: disable chest/loot to stabilize build
    const LOOT_ITEMS = [
      'sword',
      'salmon-raw',
      'salmon-cooked',
      'potion-water',
      'potato',
      'paper',
      'milk',
      'golden-apple',
      'gold-ingot',
      'cookie',
      'cod-cooked',
      'carrot',
      'carrot-golden',
      'bread',
      'fishing-rod',
    ];
    const ISLAND_PLAYER_CLEAR_RADIUS = 9; // no island overlap with raft/player

    const pickWaterBlock = (dist: number) => {
      if (dist > 12) return WATER_SKY_BLOCK_ID;
      if (dist > 9) return WATER_MEDIUM_BLOCK_ID;
      if (dist > 6) return WATER_BRIGHT_BLOCK_ID;
      return WATER_BLOCK_ID;
    };

    const isIslandBase = (x: number, z: number) => islandBaseKeys.has(`${x},${z}`);
    const isWaterId = (id: number) => (
      id === WATER_BLOCK_ID ||
      id === WATER_BRIGHT_BLOCK_ID ||
      id === WATER_MEDIUM_BLOCK_ID ||
      id === WATER_SKY_BLOCK_ID
    );

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
      const radiusCells = Math.ceil((BUBBLE_RADIUS + 20) / ISLAND_GRID) + 1;
      const fwd = driftDir;
      const yaw = Math.atan2(fwd.x, fwd.z);
      const lateralDir = { x: -fwd.z, z: fwd.x };
      const latLen = Math.hypot(lateralDir.x, lateralDir.z) || 1;
      lateralDir.x /= latLen; lateralDir.z /= latLen;

      for (let ix = cx - radiusCells; ix <= cx + radiusCells; ix++) {
        for (let iz = cz - radiusCells; iz <= cz + radiusCells; iz++) {
          const key = `${ix},${iz}`;
          if (plannedIslands.has(key)) continue;
          const n = noise2D(ix, iz);
          if (n < 0.45) continue; // more sites: easier to find islands

          // Size: broad spread, higher noise -> larger island
          const radius = n > 0.82
            ? 4.0 + (n - 0.82) * 8 // up to ~5.6
            : 1.6 + (n - 0.55) * 4; // ~1.6 - 2.7

          // Elongated shape parameters (major axis follows raft forward direction)
          const halfLength = Math.min(BUBBLE_RADIUS * 0.95, radius * 3.8 + 3); // allow very long strips
          const halfWidth = Math.min(BUBBLE_RADIUS * 0.95, Math.max(1.4, radius * 1.6 + 4)); // broad platforms toward the edge
          const planRadius = Math.max(halfLength, halfWidth);

          const centerPos = { x: ix * ISLAND_GRID + ISLAND_GRID * 0.5, z: iz * ISLAND_GRID + ISLAND_GRID * 0.5 };

          const dx = centerPos.x - center.x;
          const dz = centerPos.z - center.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 8 || dist > BUBBLE_RADIUS + 25) continue; // keep near but not on top of player
          const adjustedCenter = centerPos;

          // Avoid dense clusters vs existing planned centers
          const tooClose = Array.from(plannedIslands.values()).some(p =>
            Math.hypot(p.center.x - adjustedCenter.x, p.center.z - adjustedCenter.z) < (p.radius + planRadius + ISLAND_MIN_DISTANCE)
          );
          if (tooClose) continue;

          plannedIslands.set(key, {
            center: adjustedCenter,
            radius: planRadius,
            yaw,
            halfLength,
            halfWidth,
          });
        }
      }

    };

    const computeHull = (pts: { x: number; z: number }[]) => {
      if (pts.length < 3) return pts;
      const sorted = [...pts].sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
      const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
      const lower: any[] = [];
      for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      const upper: any[] = [];
      for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      upper.pop();
      lower.pop();
      return lower.concat(upper);
    };

    const buildIsland = (plan: IslandPlan) => {
      const { center, radius, yaw, halfLength, halfWidth } = plan;
      const blocks: { x: number; y: number; z: number }[] = [];
      const wedgesGeom: { x: number; y: number; z: number; rot: { x: number; y: number; z: number; w: number } }[] = [];
      const roughness = 0.6;
      const maxHeight = 2.5; // gentle taper, low rim
      const pad = 3;
      const extent = Math.max(halfLength, halfWidth) + pad;
      const minX = Math.floor(center.x - extent);
      const maxX = Math.ceil(center.x + extent);
      const minZ = Math.floor(center.z - extent);
      const maxZ = Math.ceil(center.z + extent);
      const cosYaw = Math.cos(-yaw);
      const sinYaw = Math.sin(-yaw);

      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          const dx = x - center.x;
          const dz = z - center.z;
          const localX = dx * cosYaw - dz * sinYaw;
          const localZ = dx * sinYaw + dz * cosYaw;
          const jitter = (rand2(x, z) - 0.5) * roughness * 0.2;
          // Forward axis (raft drift) aligns with the long Z-axis of the local frame
          const ellipseNorm = Math.sqrt((localX / halfWidth) ** 2 + (localZ / halfLength) ** 2) + jitter;
          if (ellipseNorm > 1.08) continue;

          // Higher in the middle, falling off near the edge
          const t = Math.max(0, 1 - ellipseNorm);
          const slopeNoise = (rand2(x + 17, z - 11) - 0.5) * 0.2;
          let height: number;
          if (ellipseNorm > 0.9) {
            height = 0; // rim at water level
          } else if (ellipseNorm > 0.75) {
            const h = Math.max(0, t * maxHeight * 0.8 + slopeNoise);
            height = Math.min(1, Math.floor(h + 0.5)); // shallow shoulder
          } else {
            const h = t * maxHeight * 1.2 + slopeNoise + 0.3;
            height = Math.max(0, Math.min(maxHeight, Math.floor(h)));
          }

          for (let h = 0; h <= height; h++) {
            const y = waterLevel + h;
            blocks.push({ x, y, z });
          }

          // Rim wedge: only near edge and low height to mimic slope
          if (height <= 1 && ellipseNorm > 0.82 && ellipseNorm <= 1.08) {
            const rimYaw = Math.atan2(dx, dz);
            const tilt = -Math.PI / 4; // 45° down away from center
            const rot = quatYawPitch(rimYaw, tilt);
            wedgesGeom.push({
              x,
              y: waterLevel + height + 0.3,
              z,
              rot,
            });
          }
        }
      }

      // Pick a palm spot: highest point near the center region
      let palmPos: { x: number; y: number; z: number } | undefined;
      let palmModelUri: string | undefined;
      let palmScale: number | undefined;
      {
        let bestScore = -Infinity;
        const heightMap = new Map<string, number>();
        for (const b of blocks) {
          const key = `${b.x},${b.z}`;
          const y = heightMap.get(key);
          if (y === undefined || b.y > y) heightMap.set(key, b.y);
        }
        for (const [key, topY] of heightMap.entries()) {
          const [x, z] = key.split(',').map(Number);
          const dx = x - center.x;
          const dz = z - center.z;
          const localX = dx * cosYaw - dz * sinYaw;
          const localZ = dx * sinYaw + dz * cosYaw;
          const ellipseNorm = Math.sqrt((localX / halfWidth) ** 2 + (localZ / halfLength) ** 2);
          if (ellipseNorm > 0.65) continue; // keep palm near island center
          const score = topY - ellipseNorm * 2; // prefer higher, slightly biased to center
          if (score > bestScore) {
            bestScore = score;
            palmPos = { x, y: topY + 0.6, z };
          }
        }

        if (palmPos) {
          const variants = [
            'models/players/environment/palm-1.gltf',
            'models/players/environment/palm-2.gltf',
            'models/players/environment/palm-3.gltf',
            'models/players/environment/palm-4.gltf',
            'models/players/environment/palm-5.gltf',
            'models/players/environment/palm-bush.gltf',
          ];
          const pick = Math.floor(Math.abs(rand2(Math.floor(center.x), Math.floor(center.z))) * variants.length) % variants.length;
          palmModelUri = variants[pick];
          palmScale = 0.9 + rand2(Math.floor(center.x * 2), Math.floor(center.z * 2)) * 0.4; // 0.9 - 1.3
        }
      }

      const hull = computeHull(
        blocks
          .filter(b => b.y === waterLevel)
          .map(b => ({ x: b.x, z: b.z }))
      );

      islands.push({
        center,
        radius,
        yaw,
        halfLength,
        halfWidth,
        blocks,
        wedgesGeom,
        spawnedBlocks: new Set(),
        spawnedWedges: [],
        palm: null,
        palmPos,
        palmModelUri,
        palmScale,
        hull,
      });
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
      if (island.palm && island.palm.isSpawned) island.palm.despawn();
      island.palm = null;
      if (island.chest && island.chest.isSpawned) island.chest.despawn();
      island.chest = null;
      island.chestAnchorKey = undefined;
      island.chestPos = undefined;
    };

    const spawnChestForIsland = (island: Island, center: { x: number; z: number }) => {
      if (!CHESTS_ENABLED) return;
      if (island.chest) return;
      const candidates: { x: number; y: number; z: number; key: string; dist: number }[] = [];
      island.spawnedBlocks.forEach(key => {
        const [x, y, z] = key.split(',').map(Number);
        if (y !== waterLevel) return;
        const dist = Math.hypot(x - center.x, z - center.z);
        if (dist > BUBBLE_RADIUS) return;
        candidates.push({ x, y, z, key, dist });
      });
      if (!candidates.length) return;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const chest = new Entity({
        tag: 'treasure-chest',
        name: 'Treasure Chest',
        modelUri: 'items/wooden-loot-chest.gltf',
        modelScale: 0.9,
          modelPreferredShape: ColliderShape.BLOCK,
        rigidBodyOptions: {
          type: RigidBodyType.KINEMATIC_POSITION,
          colliders: [{
            shape: ColliderShape.BLOCK,
            halfExtents: { x: 0.45, y: 0.35, z: 0.45 },
            isSensor: true,
          }],
        },
      });
      chest.spawn(world, { x: pick.x, y: waterLevel + 0.6, z: pick.z });
      island.chest = chest;
      island.chestAnchorKey = pick.key;
      island.chestPos = { x: pick.x, y: waterLevel + 0.6, z: pick.z };
      console.log('[CHEST] Spawned on island at', pick);
    };

    const despawnChestIfAny = (island: Island) => {
      if (island.chest && island.chest.isSpawned) {
        island.chest.despawn();
      }
      island.chest = null;
      island.chestAnchorKey = undefined;
      island.chestPos = undefined;
    };

    const handleChestInteraction = (entity: DefaultPlayerEntity, target: Entity) => {
      if (!CHESTS_ENABLED) return;
      const island = islands.find(i => i.chest === target);
      if (!island) return;
      despawnChestIfAny(island);
      const itemId = LOOT_ITEMS[Math.floor(Math.random() * LOOT_ITEMS.length)];
      grantItemToPlayer(entity.player, itemId);
      console.log('[CHEST] Opened, granted', itemId);
    };

    class InteractionController extends DefaultPlayerEntityController {
      public override tickWithPlayerInput(entity: any, input: any, cameraOrientation: any, deltaTimeMs: number) {
        super.tickWithPlayerInput(entity, input, cameraOrientation, deltaTimeMs);
        if (!CHESTS_ENABLED) return;
        if (!input.ml) return;
        const worldRef = entity.world;
        if (!worldRef) return;
        const player = entity.player;
        const cam = player?.camera;
        if (!cam) return;
        const facing = cam.facingDirection ?? { x: 0, y: 0, z: 1 };
        const offset = cam.offset ?? { x: 0, y: 0, z: 0 };
        const forward = cam.forwardOffset ?? 0;
        const eyeHeight = (entity.height ?? 1.8) * 0.9;
        const origin = {
          x: entity.position.x + offset.x + facing.x * forward,
          y: entity.position.y + offset.y + eyeHeight + facing.y * forward,
          z: entity.position.z + offset.z + facing.z * forward,
        };
        const maxDistance = 8;
        const hit = worldRef.simulation.raycast(origin as any, facing as any, maxDistance);
        if (hit?.hitEntity) {
          handleChestInteraction(entity, hit.hitEntity);
        }
        input.ml = false;
      }
    }

    const initChannelBasis = (center: { x: number; z: number }) => {
      if (channelBasisInitialized) return;
      channelPerp = { x: -driftDir.z, z: driftDir.x };
      const lenP = Math.hypot(channelPerp.x, channelPerp.z) || 1;
      channelPerp.x /= lenP; channelPerp.z /= lenP;
      channelForward = { x: driftDir.x, z: driftDir.z };
      const lenF = Math.hypot(channelForward.x, channelForward.z) || 1;
      channelForward.x /= lenF; channelForward.z /= lenF;
      channelOrigin = { x: center.x, z: center.z };
      channelBasisInitialized = true;
    };

    const projectOntoChannel = (pt: { x: number; z: number }) => {
      const rx = pt.x - channelOrigin.x;
      const rz = pt.z - channelOrigin.z;
      return {
        t: rx * channelForward.x + rz * channelForward.z, // along-forward
        l: rx * channelPerp.x + rz * channelPerp.z,      // lateral
      };
    };

    const bankPlanKey = (segIdx: number, side: 'L' | 'R') => `${segIdx}:${side}`;

    const ensureBankPlansAround = (center: { x: number; z: number }) => {
      initChannelBasis(center);
      const { t: centerT } = projectOntoChannel(center);

      const LAND_INNER = 12;
      const LAND_OUTER = 18;
      const SEG_LEN = BANK_SEG_LEN; // length of each planned slice along forward axis
      const PLAN_RANGE = BUBBLE_RADIUS + 30; // plan well ahead/behind the bubble

      const startSeg = Math.floor((centerT - PLAN_RANGE) / SEG_LEN);
      const endSeg = Math.ceil((centerT + PLAN_RANGE) / SEG_LEN);

      for (let segIdx = startSeg; segIdx <= endSeg; segIdx++) {
        const segStart = segIdx * SEG_LEN;
        const segEnd = segStart + SEG_LEN;
        const segMid = (segStart + segEnd) * 0.5;
        for (const side of ['L', 'R'] as const) {
          const key = bankPlanKey(segIdx, side);
          if (bankPlans.has(key)) continue;

          const blocks: { x: number; y: number; z: number }[] = [];
          // sample integer t ranges; sinusoidal wiggle for shoreline
          const widthBase = LAND_OUTER - LAND_INNER;
          const amp = 4; // lateral amplitude
          const phaseBase = segIdx * 0.6 + (side === 'L' ? 0 : Math.PI);
          const OUTER_PAD = 8; // extra land thickness outward so banks aren't thin
          for (let t = Math.floor(segStart); t <= Math.ceil(segEnd); t++) {
            const s = Math.sin(t * 0.15 + phaseBase);
            const bandCenter = (LAND_INNER + LAND_OUTER) * 0.5 + s * amp;
            const width = widthBase + Math.cos(t * 0.1 + phaseBase * 0.7) * 2; // small width wobble
            const halfWidth = Math.max(1.5, width * 0.5);
            const lStart = Math.max(1, bandCenter - halfWidth);
            const lEnd = bandCenter + halfWidth + OUTER_PAD; // fill outward to keep land solid
            for (let l = Math.floor(lStart); l <= Math.ceil(lEnd); l++) {
              const signedL = side === 'L' ? l : -l;
              const wx = channelOrigin.x + channelForward.x * t + channelPerp.x * signedL;
              const wz = channelOrigin.z + channelForward.z * t + channelPerp.z * signedL;
              const ix = Math.round(wx);
              const iz = Math.round(wz);
              blocks.push({ x: ix, y: waterLevel, z: iz });
            }
          }

          // Deduplicate blocks
          const uniq = new Map<string, { x: number; y: number; z: number }>();
          for (const b of blocks) {
            uniq.set(`${b.x},${b.y},${b.z}`, b);
          }
          const finalBlocks = Array.from(uniq.values());

          const worldCenter = {
            x: channelOrigin.x + channelForward.x * segMid,
            z: channelOrigin.z + channelForward.z * segMid,
          };

          bankPlans.set(key, {
            key,
            center: worldCenter,
            blocks: finalBlocks,
          });
        }
      }
    };

    const maintainIslands = (center: { x: number; z: number }) => {
      // Legacy islands are fully disabled
      while (islands.length) removeIsland(islands.pop()!);
      plannedIslands.clear();

      ensureBankPlansAround(center);

      const CLIP_SPAWN = BUBBLE_RADIUS;       // allow right up to the circle
      const CLIP_DESPAWN = BUBBLE_RADIUS;     // no hysteresis; despawn at edge

      // For every planned bank, toggle each block by circle membership
      for (const plan of bankPlans.values()) {
        let spawned = bankSpawnedBlocks.get(plan.key);
        if (!spawned) {
          spawned = new Set<string>();
          bankSpawnedBlocks.set(plan.key, spawned);
        }

        for (const b of plan.blocks) {
          const fullKey = `${b.x},${b.y},${b.z}`;
          const key2D = `${b.x},${b.z}`;
          const dist = Math.hypot(b.x - center.x, b.z - center.z);
          const within = dist <= CLIP_SPAWN;
          const isSpawned = spawned.has(fullKey);

          if (within) {
            if (!islandBaseKeys.has(key2D)) {
              world.chunkLattice.setBlock({ x: b.x, y: b.y, z: b.z }, SAND_BLOCK_ID);
              islandBaseKeys.add(key2D);
              activeWater.delete(key2D);
            }
            spawned.add(fullKey);
          } else if (isSpawned && dist > CLIP_DESPAWN) {
            spawned.delete(fullKey);
            islandBaseKeys.delete(key2D);
            const waterId = pickWaterBlock(dist);
            world.chunkLattice.setBlock({ x: b.x, y: b.y, z: b.z }, waterId);
            activeWater.set(key2D, waterId);
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

    const applyCameraSettings = (player: any, entity: any) => {
      const cam = player?.camera;
      if (!cam || !entity?.isSpawned) return;
      try {
        cam.setAttachedToEntity?.(entity);
        cam.setOffset({ x: 0, y: 0, z: 0 }); // default
        cam.setFov?.(70); // near-default feel
        cam.setZoom?.(0.7); // user-requested zoom
      } catch (err) {
        console.warn('[CAM] apply settings failed', err);
      }
    };

    // ------------------------------------------------------------------
    // Channel debug markers (visualize wavy centerline)
    // ------------------------------------------------------------------
    const centerMarkers: Entity[] = [];
    const refreshCenterMarkers = (center: { x: number; z: number }) => {
      // Despawn old markers
      centerMarkers.forEach(m => m.isSpawned && m.despawn());
      centerMarkers.length = 0;
      if (!channelBasisInitialized) return;
      const rx = center.x - channelOrigin.x;
      const rz = center.z - channelOrigin.z;
      const centerT = rx * channelForward.x + rz * channelForward.z;
      const span = BUBBLE_RADIUS * 1.5;
      const count = 22;
      const lateralAt = centerlineLateral;
      for (let i = -Math.floor(count / 2); i <= Math.floor(count / 2); i++) {
        const t = centerT + (i / count) * span;
        const lateral = lateralAt(t);
        const wx = channelOrigin.x + channelForward.x * t + channelPerp.x * lateral;
        const wz = channelOrigin.z + channelForward.z * t + channelPerp.z * lateral;
        const marker = new Entity({
          tag: 'centerline-debug',
          blockTextureUri: 'blocks/water_sky.png',
          blockHalfExtents: { x: 0.2, y: 0.2, z: 0.2 },
          rigidBodyOptions: {
            type: RigidBodyType.KINEMATIC_POSITION,
            enabled: false, // no physics sim
            colliders: [],   // no colliders
          },
          isEnvironmental: true,
        });
        marker.spawn(world, { x: wx, y: waterLevel + 1.2, z: wz });
        centerMarkers.push(marker);
      }
    };

    const centerlineLateral = (t: number) => {
      // Continuous phase (no per-segment jumps)
      const AMP = 4;
      const FREQ = 0.15;
      const PHASE = 0.4;
      const phaseBase = (t / BANK_SEG_LEN) * 0.6; // smooth progression
      return Math.sin(t * FREQ + phaseBase + PHASE) * AMP;
    };

    // Lateral spring toward channel centerline (between banks)
    const channelCenterForce = (pos: { x: number; z: number }, mass: number) => {
      if (!channelBasisInitialized) return null;
      // Signed lateral offset relative to channel origin/basis
      const rx = pos.x - channelOrigin.x;
      const rz = pos.z - channelOrigin.z;
      const lateral = rx * channelPerp.x + rz * channelPerp.z;
      const t = rx * channelForward.x + rz * channelForward.z;
      const targetLateral = centerlineLateral(t);
      const delta = lateral - targetLateral;
      const gain = 35; // keep modest spring
      const fx = -channelPerp.x * delta * gain * mass * TICK_DELTA;
      const fz = -channelPerp.z * delta * gain * mass * TICK_DELTA;
      return { fx, fz };
    };

    // Wavy centerline tangent -> steer driftDir to match spline
    const updateDriftDirAlongSpline = (center: { x: number; z: number }) => {
      if (!channelBasisInitialized) return;
      const rx = center.x - channelOrigin.x;
      const rz = center.z - channelOrigin.z;
      const t = rx * channelForward.x + rz * channelForward.z;
      const AMP = 4;
      const FREQ = 0.15;
      const PHASE = 0.4;
      const phaseBase = (t / BANK_SEG_LEN) * 0.6; // match centerlineLateral
      const angle = t * FREQ + phaseBase + PHASE;
      const totalFreq = FREQ + 0.6 / BANK_SEG_LEN; // derivative of phaseBase term
      const dLat_dt = Math.cos(angle) * AMP * totalFreq; // derivative
      // Tangent = forward + dLat_dt * perp
      let tx = channelForward.x + channelPerp.x * dLat_dt;
      let tz = channelForward.z + channelPerp.z * dLat_dt;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len; tz /= len;
      driftDir = { x: tx, z: tz };
    };

    const respawnPlayer = (p: any, center: { x: number; z: number }) => {
      // Reset motion
      p.setLinearVelocity({ x: 0, y: 0, z: 0 });
      p.setAngularVelocity?.({ x: 0, y: 0, z: 0 });
      // Fresh raft at center
      spawnRaft({ x: center.x, z: center.z }, 'respawn');
      // Teleport player above water; keep camera on same entity
      p.setPosition?.({ x: center.x, y: waterLevel + 5, z: center.z });
      p.setRotation?.({ x: 0, y: 0, z: 0, w: 1 });
      mainPlayer = p;
      lastCenter = { x: center.x, z: center.z };
      applyCameraSettings(p.player, p);
      swimEnergy = 1;
      sendSwimState(p, false, true);
      world.chatManager.sendPlayerMessage(p.player, 'Respawned. New game underway.', '00FF00');
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
    let channelPerp = { x: 1, z: 0 }; // fixed once to avoid band morphing
    let channelForward = { x: 0, z: -1 }; // fixed once; defines along-channel axis
    let channelOrigin = { x: 0, z: 0 }; // where projections are measured from
    let channelBasisInitialized = false;
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
            angularDamping: 8,
            enabledRotations: { x: false, y: true, z: false }, // lock roll/pitch to keep level
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

    // Swim energy
    let swimEnergy = 1; // 0..1
    let lastSwimSend = -1;
    // Default world tick rate is 60 Hz (MCP says 60 ticks/s)
    // 15 seconds to empty => 15 * 60 = 900 ticks
    const SWIM_DRAIN_PER_TICK = 1 / 900;
    const SWIM_REFILL_PER_TICK = 0.04;          // faster refill on raft/land
    const uiReadyPlayers = new Set<any>();
    const playerInventories = new Map<any, string[]>(); // key: player object

    const sendSwimState = (p: any, inWater: boolean, force = false) => {
      if (!p) return;
      const shouldSend = force || Math.abs(swimEnergy - lastSwimSend) > 0.01 || (tickCounter % 20 === 0);
      if (!shouldSend) return;
      lastSwimSend = swimEnergy;
      try {
        p.player.ui.sendData({ type: 'swim-energy', value: swimEnergy, inWater });
        if (tickCounter % 20 === 0 || force) {
          console.log('[SERVER][swim-energy]', { value: swimEnergy.toFixed(2), inWater, force });
        }
      } catch (err) {
        console.warn('[UI] swim-energy send failed', err);
      }
    };

    const getInventory = (player: any) => {
      const inv = playerInventories.get(player);
      if (inv) return inv;
      const fresh: string[] = [];
      playerInventories.set(player, fresh);
      return fresh;
    };

    const sendInventoryUpdate = (player: any) => {
      const inv = getInventory(player);
      try {
        player.ui.sendData({ type: 'inventoryUpdate', items: inv });
      } catch (err) {
        console.warn('[UI] inventoryUpdate send failed', err);
      }
    };

    const grantItemToPlayer = (player: any, itemId: string) => {
      const inv = getInventory(player);
      inv.push(itemId);
      playerInventories.set(player, inv);
      sendInventoryUpdate(player);
      try {
        player.ui.sendData({ type: 'popup', message: `You received: ${itemId}` });
      } catch (err) {
        console.warn('[UI] popup send failed', err);
      }
      world.chatManager.sendPlayerMessage(player, `You received: ${itemId}`, '00FF00');
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
        // Swim energy handling only for main player
        if (p === mainPlayer) {
          const pos = p.position;
          // Water/raft detection (feet sample at y-0.5)
          const sampleY = Math.floor(pos.y - 0.5);
          const blockId = world.chunkLattice.getBlockId({
            x: Math.round(pos.x),
            y: sampleY,
            z: Math.round(pos.z),
          });
          const onLand = blockId !== 0 && !isWaterId(blockId);
          let onRaft = false;
          for (const b of raftBlocks) {
            if (!b.isSpawned) continue;
            const dx = Math.abs(b.position.x - pos.x);
            const dz = Math.abs(b.position.z - pos.z);
            const dy = Math.abs(b.position.y - pos.y);
            if (dx < 1.4 && dz < 1.4 && dy < 2.0) { onRaft = true; break; }
          }
          const inWater = !onLand && !onRaft && blockId !== 0 && isWaterId(blockId) && pos.y <= waterLevel + 1.1;
          if (inWater) {
            swimEnergy = Math.max(0, swimEnergy - SWIM_DRAIN_PER_TICK);
          } else {
            swimEnergy = Math.min(1, swimEnergy + SWIM_REFILL_PER_TICK);
          }
          if (inWater && swimEnergy <= 0) {
            swimEnergy = 0;
            sendSwimState(p, true, true);
            respawnPlayer(p, playerPos);
            return;
          }
          sendSwimState(p, inWater);
        }

        const dx = p.position.x - playerPos.x;
        const dz = p.position.z - playerPos.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= BUBBLE_RADIUS - 0.25) {
          respawnPlayer(p, playerPos);
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
      // Override driftDir to follow wavy centerline spline
      updateDriftDirAlongSpline(playerPos);

      // Debug: visualize centerline spline every 15 ticks
      if (tickCounter % 15 === 0) {
        refreshCenterMarkers(playerPos);
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

      // Raft buoyancy + drift cohesion
      raftBlocks.forEach(block => {
        if (!block.isSpawned) return;
        const pos = block.position;
        const vel = block.linearVelocity;
        const mass = block.mass;
        // Centerline spring to keep raft near spline
        const centerSpring = channelCenterForce(pos, mass);
        // Constant forward push to keep motion along drift
        const forwardForce = 10;
        const fxDrift = driftDir.x * forwardForce * mass * TICK_DELTA;
        const fzDrift = driftDir.z * forwardForce * mass * TICK_DELTA;
        const cx = centerSpring?.fx ?? 0;
        const cz = centerSpring?.fz ?? 0;
        block.applyImpulse({ x: cx + fxDrift, y: 0, z: cz + fzDrift });
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
          const buoyancyImpulse = buoyancy * mass * 16 * TICK_DELTA; // stronger lift to prevent sinking

          block.setGravityScale(SWIM_GRAVITY);
          if (vel.y < SWIM_MAX_FALL_SPEED) block.setLinearVelocity({ x: vel.x, y: SWIM_MAX_FALL_SPEED, z: vel.z });
          block.applyImpulse({ x: 0, y: impulseY + buoyancyImpulse, z: 0 });
          block.setLinearDamping(Math.max(physicsParams.linearDamping, 2));
          block.setAngularDamping(8); // high angular damping in water to avoid tilting
          block.wakeUp();
        } else {
          block.setGravityScale(1.0);
          block.setLinearDamping(0.5);
          block.setAngularDamping(2.0); // some damping above water to stay stable
        }

        // Apply slow drift velocity target
        const desiredVX = driftDir.x * driftSpeed;
        const desiredVZ = driftDir.z * driftSpeed;
        const corrX = (desiredVX - vel.x) * 2.5; // moderate, less jitter
        const corrZ = (desiredVZ - vel.z) * 2.5;
        block.applyImpulse({ x: corrX * mass * TICK_DELTA, y: 0, z: corrZ * mass * TICK_DELTA });
        // Don't force rotation; avoid squeezing/overlap
      });

      // Raft cohesion: gentle spring toward formation to keep beams together
      if (raftBlocks.length > 0) {
        const center = raftBlocks.reduce((a, b) => ({ x: a.x + b.position.x, z: a.z + b.position.z }), { x: 0, z: 0 });
        center.x /= raftBlocks.length;
        center.z /= raftBlocks.length;
        const spring = 3.5; // softer to prevent compression
        const damp = 0.9;
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

      // Ocean life: keep a few fish orbiting near the raft/player
      while (fishLife.length < FISH_COUNT) {
        fishLife.push({
          e: null,
          ang: Math.random() * Math.PI * 2,
          radius: 6 + Math.random() * 6,
          height: waterLevel - 0.5 + Math.random() * 1.5,
          speed: 0.3 + Math.random() * 0.4,
          modelUri: FISH_MODELS[Math.floor(Math.random() * FISH_MODELS.length)],
        });
      }

      const fishSpawnCenter = playerPos;
      fishLife.forEach(f => {
        // Drift angle forward
        f.ang += f.speed * 0.05;
        const x = fishSpawnCenter.x + Math.cos(f.ang) * f.radius;
        const z = fishSpawnCenter.z + Math.sin(f.ang) * f.radius;
        const pos = { x, y: f.height, z };

        // Spawn if missing
        if (!f.e || !f.e.isSpawned) {
          const fish = new Entity({
            tag: 'fish',
            name: 'Fish',
            modelUri: f.modelUri,
            modelScale: 0.9,
            modelPreferredShape: ColliderShape.NONE,
            isEnvironmental: true,
            rigidBodyOptions: {
              type: RigidBodyType.KINEMATIC_POSITION,
              colliders: [],
            },
          });
          fish.spawn(world, pos);
          f.e = fish;
        } else {
          f.e.setPosition(pos);
        }

        // Despawn if very far
        if (Math.hypot(x - playerPos.x, z - playerPos.z) > BUBBLE_RADIUS + 25) {
          f.e?.despawn();
          f.e = null;
          f.radius = 6 + Math.random() * 6;
          f.ang = Math.random() * Math.PI * 2;
        }
      });

      // Stick players to raft/deck motion if standing on it (simple lock to raft velocity)
      world.entityManager.getAllPlayerEntities().forEach(p => {
        if (!p.isSpawned) return;
        const pp = p.position;
        const pv = p.linearVelocity;
        const alive = raftBlocks.filter(b => b.isSpawned);
        if (!alive.length) return;

        // Check if player is standing on any raft block area
        let onDeck = false;
        for (const b of alive) {
          const bp = b.position;
          if (Math.abs(pp.y - (bp.y + 0.5)) > 1.1) continue;
          if (Math.abs(pp.x - bp.x) < 1.0 && Math.abs(pp.z - bp.z) < 1.0) {
            onDeck = true;
            break;
          }
        }
        if (!onDeck) return;

        const avgV = alive.reduce((a, b) => ({
          x: a.x + b.linearVelocity.x,
          y: a.y + b.linearVelocity.y,
          z: a.z + b.linearVelocity.z,
        }), { x: 0, y: 0, z: 0 });
        avgV.x /= alive.length; avgV.y /= alive.length; avgV.z /= alive.length;

        // Preserve player input while adding raft drift so you can still walk
        p.setLinearVelocity({ x: pv.x + avgV.x, y: pv.y, z: pv.z + avgV.z });
      });

      // Minimap telemetry (only currently spawned islands within view)
      if (tickCounter % 5 === 0) {
        const MINIMAP_RADIUS = 45;
        const miniIslands = islands
          .filter(i => Math.hypot(i.center.x - playerPos.x, i.center.z - playerPos.z) <= MINIMAP_RADIUS)
          .map(i => {
            const waterBlocks: { x: number; z: number }[] = [];
            i.spawnedBlocks.forEach(key => {
              const [x, y, z] = key.split(',').map(Number);
              if (y === waterLevel) waterBlocks.push({ x, z });
            });
            return {
              x: i.center.x,
              z: i.center.z,
              waterBlocks,
            };
          });
        const sharkPos = sharkEntity && sharkEntity.isSpawned ? { x: sharkEntity.position.x, z: sharkEntity.position.z } : undefined;
        const fishPos = fishLife
          .filter(f => f.e && f.e.isSpawned)
          .map(f => ({ x: f.e!.position.x, z: f.e!.position.z }));
        world.entityManager.getAllPlayerEntities().forEach(p => {
          if (!p.player) return;
          const payload = {
            type: 'minimap',
            center: { x: playerPos.x, z: playerPos.z },
            drift: { x: driftDir.x, z: driftDir.z },
            islands: miniIslands,
            shark: sharkPos ?? null,
            fish: fishPos,
          };
          if (tickCounter % 60 === 0) {
            console.log('[SERVER][minimap] sending', payload);
          }
          try {
            p.player.ui.sendData(payload);
          } catch (err) {
            console.error('[SERVER][minimap] send failed', err);
          }
        });
      }

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
      if (CHESTS_ENABLED) {
        pEnt.setController(new InteractionController());
      }
      pEnt.spawn(world, { x: 0, y: waterLevel + 5, z: 0 });
      applyCameraSettings(player, pEnt);
      if (CHESTS_ENABLED) {
        playerInventories.set(player, getInventory(player));
      }
      // Ensure platform sticking uses engine support (kinematic deck is treated as platform)
      const ctrl: any = pEnt.controller;
      if (ctrl && 'sticksToPlatforms' in ctrl) ctrl.sticksToPlatforms = true;
      mainPlayer = pEnt;
      player.ui.load('ui/index.html');
      if (CHESTS_ENABLED) sendInventoryUpdate(player);
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
        if (!data || !data.type) return;
        if (data.type === 'physics-update') {
          switch (data.param) {
            case 'raft-speed': driftSpeed = Math.max(0, Math.min(2, data.value)); break;
          }
          return;
        }
        if (data.type === 'ui-ready' && data.scope === 'swim') {
          uiReadyPlayers.add(player);
          // send immediate swim state
          const pos = pEnt.position;
          const blockId = world.chunkLattice.getBlockId({
            x: Math.round(pos.x),
            y: waterLevel,
            z: Math.round(pos.z),
          });
          const onLand = blockId !== 0 && !isWaterId(blockId);
          let onRaft = false;
          for (const b of raftBlocks) {
            if (!b.isSpawned) continue;
            const dx = Math.abs(b.position.x - pos.x);
            const dz = Math.abs(b.position.z - pos.z);
            const dy = Math.abs(b.position.y - pos.y);
            if (dx < 1.2 && dz < 1.2 && dy < 1.5) { onRaft = true; break; }
          }
          const inWater = pos.y < waterLevel + 0.35 && !onLand && !onRaft;
          sendSwimState(pEnt, inWater, true);
          return;
        }
      });
    });

    world.on(PlayerEvent.LEFT_WORLD, ({ player }) => {
      world.entityManager.getPlayerEntitiesByPlayer(player).forEach(e => e.despawn());
      if (mainPlayer && mainPlayer.player === player) {
        mainPlayer = undefined;
      }
      if (CHESTS_ENABLED) playerInventories.delete(player);
    });
  } catch (err) {
    console.error('[CRITICAL] Startup error:', err);
  }
});

