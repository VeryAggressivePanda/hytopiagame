import { World, Entity } from 'hytopia';
import { WATER_LEVEL, BUBBLE_RADIUS, BANK_SEG_LEN, ZONE_LEN, ZONE_BLEND, ISLAND_MIN_DISTANCE } from '../config/settings';
import { SAND_BLOCK_ID } from '../config/blocks';
import { rand2, noise2D, smoothstep, lerp, computeHull, quatYawPitch, fbm } from '../utils/math';
import { pickWaterBlock } from '../config/blocks';

export type ZoneType = 'twisty' | 'opensea';

export class TerrainManager {
    public islandBaseKeys = new Set<string>();
    private bankPlans = new Map<string, any>();
    private bankSpawnedBlocks = new Map<string, Set<string>>();
    private midPlans = new Map<string, any>();
    private midSpawnedBlocks = new Map<string, Set<string>>();
    private channelBasisInitialized = false;
    private channelOrigin = { x: 0, z: 0 };
    private channelForward = { x: 0, z: -1 };
    private channelPerp = { x: 1, z: 0 };

    constructor(private world: World) { }

    public getChannelForward() {
        return { x: this.channelForward.x, z: this.channelForward.z };
    }

    public getChannelOrigin() {
        return { x: this.channelOrigin.x, z: this.channelOrigin.z };
    }

    public isIslandBase(x: number, z: number) {
        return this.islandBaseKeys.has(`${x},${z}`);
    }

    public initChannelBasis(center: { x: number; z: number }, driftDir: { x: number; z: number }) {
        if (this.channelBasisInitialized) return;
        this.channelPerp = { x: -driftDir.z, z: driftDir.x };
        const lenP = Math.hypot(this.channelPerp.x, this.channelPerp.z) || 1;
        this.channelPerp.x /= lenP; this.channelPerp.z /= lenP;
        this.channelForward = { x: driftDir.x, z: driftDir.z };
        const lenF = Math.hypot(this.channelForward.x, this.channelForward.z) || 1;
        this.channelForward.x /= lenF; this.channelForward.z /= lenF;
        this.channelOrigin = { x: center.x, z: center.z };
        this.channelBasisInitialized = true;
    }

    public maintain(center: { x: number; z: number }, driftDir: { x: number; z: number }, activeWater: Map<string, number>) {
        this.initChannelBasis(center, driftDir);
        this.ensureMidPlansAround(center);
        this.ensureBankPlansAround(center);

        const CLIP_SPAWN = BUBBLE_RADIUS;
        const CLIP_DESPAWN = BUBBLE_RADIUS;

        for (const plan of this.bankPlans.values()) {
            let spawned = this.bankSpawnedBlocks.get(plan.key);
            if (!spawned) {
                spawned = new Set<string>();
                this.bankSpawnedBlocks.set(plan.key, spawned);
            }

            for (const b of plan.blocks) {
                const fullKey = `${b.x},${b.y},${b.z}`;
                const key2D = `${b.x},${b.z}`;
                const dist = Math.hypot(b.x - center.x, b.z - center.z);
                const within = dist <= CLIP_SPAWN;
                const isSpawned = spawned.has(fullKey);

                if (within) {
                    if (!this.islandBaseKeys.has(key2D)) {
                        this.world.chunkLattice.setBlock({ x: b.x, y: b.y, z: b.z }, SAND_BLOCK_ID);
                        this.islandBaseKeys.add(key2D);
                        activeWater.delete(key2D);
                    }
                    spawned.add(fullKey);
                } else if (isSpawned && dist > CLIP_DESPAWN) {
                    spawned.delete(fullKey);
                    this.islandBaseKeys.delete(key2D);
                    const waterId = pickWaterBlock(dist);
                    this.world.chunkLattice.setBlock({ x: b.x, y: b.y, z: b.z }, waterId);
                    activeWater.set(key2D, waterId);
                }
            }
        }

        for (const plan of this.midPlans.values()) {
            let spawned = this.midSpawnedBlocks.get(plan.key);
            if (!spawned) {
                spawned = new Set<string>();
                this.midSpawnedBlocks.set(plan.key, spawned);
            }

            for (const b of plan.blocks) {
                const fullKey = `${b.x},${b.y},${b.z}`;
                const key2D = `${b.x},${b.z}`;
                const dist = Math.hypot(b.x - center.x, b.z - center.z);
                const within = dist <= CLIP_SPAWN;
                const isSpawned = spawned.has(fullKey);

                if (within) {
                    if (!this.islandBaseKeys.has(key2D)) {
                        this.world.chunkLattice.setBlock({ x: b.x, y: b.y, z: b.z }, SAND_BLOCK_ID);
                        this.islandBaseKeys.add(key2D);
                        activeWater.delete(key2D);
                    }
                    spawned.add(fullKey);
                } else if (isSpawned && dist > CLIP_DESPAWN) {
                    spawned.delete(fullKey);
                    this.islandBaseKeys.delete(key2D);
                    const waterId = pickWaterBlock(dist);
                    this.world.chunkLattice.setBlock({ x: b.x, y: b.y, z: b.z }, waterId);
                    activeWater.set(key2D, waterId);
                }
            }
        }
    }

    private getTerrainDensity(wx: number, wz: number, pathOffset: number, zoneType: ZoneType): number {
        const rx = wx - this.channelOrigin.x;
        const rz = wz - this.channelOrigin.z;
        const l = rx * this.channelPerp.x + rz * this.channelPerp.z;
        const l_relative = l - pathOffset;

        // 1. True Global Fractal Noise (reduced octaves for performance)
        let rawNoise = fbm(wx * 0.015, wz * 0.015, 4);

        // 2. Base Threshold (Shifted for opensea)
        const baseThreshold = zoneType === 'opensea' ? 0.53 : 0.43;

        // 3. High-Contrast Transform (Cellular/Blobby look)
        let density = smoothstep((rawNoise - baseThreshold) / 0.1);

        // 4. Robust River Mask (keeps a narrow central channel clear for the raft)
        const riverClearPath = 5;
        const riverMask = smoothstep((Math.abs(l_relative) - riverClearPath) / 8);

        return density * riverMask;
    }

    private ensureBankPlansAround(center: { x: number; z: number }) {
        const rx = center.x - this.channelOrigin.x;
        const rz = center.z - this.channelOrigin.z;
        const centerT = rx * this.channelForward.x + rz * this.channelForward.z;

        const SEG_LEN = BANK_SEG_LEN;
        const PLAN_RANGE = 75; // Reduced from 110 for performance

        const startSeg = Math.floor((centerT - PLAN_RANGE) / SEG_LEN);
        const endSeg = Math.ceil((centerT + PLAN_RANGE) / SEG_LEN);

        for (let segIdx = startSeg; segIdx <= endSeg; segIdx++) {
            for (const side of ['L', 'R'] as const) {
                const key = `${segIdx}:${side}`;
                if (this.bankPlans.has(key)) continue;

                const segMid = (segIdx + 0.5) * SEG_LEN;
                const zoneType = this.zoneForSeg(Math.floor(segMid / ZONE_LEN));

                const blocks: { x: number; y: number; z: number }[] = [];
                // Widened scan to handle the intense winding path (up to 75 units out)
                const innerScan = 0;
                const outerScan = 75;
                const innerLimit = 5; // Absolute minimum distance from centerline for banks

                for (let dt = 0; dt < SEG_LEN; dt++) {
                    const t = segIdx * SEG_LEN + dt;

                    // Pre-calculate path offset once per row
                    const pathWiggle = fbm(t * 0.012, 123.456, 3) - 0.5;
                    const pathOffset = pathWiggle * 50.0;

                    for (let lRel = innerScan; lRel <= outerScan; lRel++) {
                        const l = side === 'L' ? lRel : -lRel;
                        // Skip if it's too close to the absolute center, let midScan handle that
                        if (Math.abs(l) < innerLimit) continue;

                        const wx = Math.round(this.channelOrigin.x + this.channelForward.x * t + this.channelPerp.x * l);
                        const wz = Math.round(this.channelOrigin.z + this.channelForward.z * t + this.channelPerp.z * l);

                        const d = this.getTerrainDensity(wx, wz, pathOffset, zoneType);
                        if (d > 0.05) {
                            blocks.push({ x: wx, y: WATER_LEVEL, z: wz });
                        }
                    }
                }

                if (blocks.length > 0) {
                    const uniq = new Map<string, { x: number; y: number; z: number }>();
                    for (const b of blocks) { uniq.set(`${b.x},${b.y},${b.z}`, b); }
                    this.bankPlans.set(key, { key, blocks: Array.from(uniq.values()), zoneType });
                } else {
                    this.bankPlans.set(key, { key, blocks: [], zoneType });
                }
            }
        }
    }

    private ensureMidPlansAround(center: { x: number; z: number }) {
        const rx = center.x - this.channelOrigin.x;
        const rz = center.z - this.channelOrigin.z;
        const centerT = rx * this.channelForward.x + rz * this.channelForward.z;

        const SEG_LEN = BANK_SEG_LEN;
        const PLAN_RANGE = 75; // Reduced from 110 for performance

        const startSeg = Math.floor((centerT - PLAN_RANGE) / SEG_LEN);
        const endSeg = Math.ceil((centerT + PLAN_RANGE) / SEG_LEN);

        for (let segIdx = startSeg; segIdx <= endSeg; segIdx++) {
            const key = `mid:${segIdx}`;
            if (this.midPlans.has(key)) continue;

            const segMid = (segIdx + 0.5) * SEG_LEN;
            const zoneType = this.zoneForSeg(Math.floor(segMid / ZONE_LEN));

            const blocks: { x: number; y: number; z: number }[] = [];
            // Middle scan: widened to handle full potential path drift range (+/- 25 + margin)
            const midScanWidth = 35;

            for (let dt = 0; dt < SEG_LEN; dt++) {
                const t = segIdx * SEG_LEN + dt;

                // Pre-calculate path offset once per row
                const pathWiggle = fbm(t * 0.012, 123.456, 3) - 0.5;
                const pathOffset = pathWiggle * 50.0;

                for (let l = -midScanWidth; l <= midScanWidth; l++) {
                    const wx = Math.round(this.channelOrigin.x + this.channelForward.x * t + this.channelPerp.x * l);
                    const wz = Math.round(this.channelOrigin.z + this.channelForward.z * t + this.channelPerp.z * l);

                    const d = this.getTerrainDensity(wx, wz, pathOffset, zoneType);
                    // Mid islands use their own density check if needed
                    if (d > 0.2) {
                        blocks.push({ x: wx, y: WATER_LEVEL, z: wz });
                    }
                }
            }

            if (blocks.length > 0) {
                const uniq = new Map<string, { x: number; y: number; z: number }>();
                for (const b of blocks) { uniq.set(`${b.x},${b.y},${b.z}`, b); }
                this.midPlans.set(key, { key, blocks: Array.from(uniq.values()), zoneType });
            } else {
                this.midPlans.set(key, { key, blocks: [], zoneType });
            }
        }
    }

    private zoneForSeg(segIdx: number): ZoneType {
        const n = fbm(segIdx * 0.3, 999.1, 2);
        return n > 0.65 ? 'opensea' : 'twisty';
    }

    private hasMidPlanNear(segIdx: number, gapSegs: number) {
        for (let s = segIdx - gapSegs; s <= segIdx + gapSegs; s++) {
            if (this.midPlans.has(`mid:${s}`)) return true;
        }
        return false;
    }

    private hasBankPlanNear(segIdx: number, gapSegs: number) {
        for (let s = segIdx - gapSegs; s <= segIdx + gapSegs; s++) {
            if (this.bankPlans.has(`${s}:L`) || this.bankPlans.has(`${s}:R`)) return true;
        }
    }

    public getIslandPlanBlocks(center: { x: number, z: number }, range: number): { x: number, z: number }[] {
        const blocks2D: { x: number, z: number }[] = [];
        const rangeSq = range * range;

        const checkPlan = (plan: any) => {
            for (const b of plan.blocks) {
                const dx = b.x - center.x;
                const dz = b.z - center.z;
                if (dx * dx + dz * dz <= rangeSq) {
                    blocks2D.push({ x: b.x, z: b.z });
                }
            }
        };

        for (const plan of this.bankPlans.values()) checkPlan(plan);
        for (const plan of this.midPlans.values()) checkPlan(plan);

        return blocks2D;
    }
}
