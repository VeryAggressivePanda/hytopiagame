import { World, Entity } from 'hytopia';
import { WATER_LEVEL, BUBBLE_RADIUS, BANK_SEG_LEN, ZONE_LEN, ZONE_BLEND, ISLAND_MIN_DISTANCE } from '../config/settings';
import { SAND_BLOCK_ID } from '../config/blocks';
import { rand2, noise2D, smoothstep, lerp, computeHull, quatYawPitch } from '../utils/math';
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

            if (plan.zoneType === 'opensea') {
                if (spawned.size > 0) {
                    for (const fullKey of Array.from(spawned)) {
                        const [x, y, z] = fullKey.split(',').map(Number);
                        const key2D = `${x},${z}`;
                        this.islandBaseKeys.delete(key2D);
                        const dist = Math.hypot(x - center.x, z - center.z);
                        const waterId = pickWaterBlock(dist);
                        this.world.chunkLattice.setBlock({ x, y, z }, waterId);
                        activeWater.set(key2D, waterId);
                        spawned.delete(fullKey);
                    }
                }
                continue;
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

    private ensureBankPlansAround(center: { x: number; z: number }) {
        const rx = center.x - this.channelOrigin.x;
        const rz = center.z - this.channelOrigin.z;
        const centerT = rx * this.channelForward.x + rz * this.channelForward.z;

        const LAND_INNER = 12;
        const LAND_OUTER = 18;
        const SEG_LEN = BANK_SEG_LEN;
        const GAP_BLOCKS = 20;
        const gapSegs = Math.ceil(GAP_BLOCKS / SEG_LEN);
        const PLAN_RANGE = BUBBLE_RADIUS + 30;

        const startSeg = Math.floor((centerT - PLAN_RANGE) / SEG_LEN);
        const endSeg = Math.ceil((centerT + PLAN_RANGE) / SEG_LEN);

        for (let segIdx = startSeg; segIdx <= endSeg; segIdx++) {
            if (this.hasMidPlanNear(segIdx, gapSegs)) continue;
            for (const side of ['L', 'R'] as const) {
                const key = `${segIdx}:${side}`;
                if (this.bankPlans.has(key)) continue;

                const segStart = segIdx * SEG_LEN;
                const segEnd = segStart + SEG_LEN;
                const segMid = (segStart + segEnd) * 0.5;
                const zoneType = this.zoneForSeg(Math.floor(segMid / ZONE_LEN));

                const blocks: { x: number; y: number; z: number }[] = [];
                const widthBase = LAND_OUTER - LAND_INNER;
                const amp = 4;
                const phaseBase = segIdx * 0.6 + (side === 'L' ? 0 : Math.PI);
                const OUTER_PAD = 8;

                for (let t = Math.floor(segStart); t <= Math.ceil(segEnd); t++) {
                    const s = Math.sin(t * 0.15 + phaseBase);
                    const bandCenter = (LAND_INNER + LAND_OUTER) * 0.5 + s * amp;
                    const width = widthBase + Math.cos(t * 0.1 + phaseBase * 0.7) * 2;
                    const lStart = Math.max(1, bandCenter - width * 0.5);
                    const lEnd = bandCenter + width * 0.5 + OUTER_PAD;
                    for (let l = Math.floor(lStart); l <= Math.ceil(lEnd); l++) {
                        const signedL = side === 'L' ? l : -l;
                        const wx = this.channelOrigin.x + this.channelForward.x * t + this.channelPerp.x * signedL;
                        const wz = this.channelOrigin.z + this.channelForward.z * t + this.channelPerp.z * signedL;
                        blocks.push({ x: Math.round(wx), y: WATER_LEVEL, z: Math.round(wz) });
                    }
                }

                const uniq = new Map<string, { x: number; y: number; z: number }>();
                for (const b of blocks) { uniq.set(`${b.x},${b.y},${b.z}`, b); }
                this.bankPlans.set(key, { key, blocks: Array.from(uniq.values()), zoneType });
            }
        }
    }

    private ensureMidPlansAround(center: { x: number; z: number }) {
        const rx = center.x - this.channelOrigin.x;
        const rz = center.z - this.channelOrigin.z;
        const centerT = rx * this.channelForward.x + rz * this.channelForward.z;

        const SEG_LEN = BANK_SEG_LEN;
        const GAP_BLOCKS = 20;
        const gapSegs = Math.ceil(GAP_BLOCKS / SEG_LEN);
        const PLAN_RANGE = BUBBLE_RADIUS + 30;

        const startSeg = Math.floor((centerT - PLAN_RANGE) / SEG_LEN);
        const endSeg = Math.ceil((centerT + PLAN_RANGE) / SEG_LEN);

        for (let segIdx = startSeg; segIdx <= endSeg; segIdx++) {
            const key = `mid:${segIdx}`;
            if (this.midPlans.has(key)) continue;
            if (this.hasBankPlanNear(segIdx, gapSegs)) continue;

            const spawnNoise = noise2D(segIdx * 3.17, 441.92);
            if (spawnNoise < 0.55) continue;

            const segStart = segIdx * SEG_LEN;
            const segEnd = segStart + SEG_LEN;
            const segMid = (segStart + segEnd) * 0.5;

            const blocks: { x: number; y: number; z: number }[] = [];
            const BANK_INNER = 12;
            const MIN_WATER_GAP = 4;
            const length = 10 + Math.round((noise2D(segIdx * 6.1, 72.7) + 1) * 0.5 * 8);
            const halfLen = length * 0.5;
            const baseWidth = 1.5 + (noise2D(segIdx * 9.3, 12.2) + 1) * 0.5 * 1.5;
            const baseOffset = noise2D(segIdx * 7.7, 19.3) * 2.0;

            for (let dt = -halfLen; dt <= halfLen; dt += 1) {
                const t = segMid + dt;
                const edge = 1 - Math.min(1, Math.abs(dt) / halfLen);
                const widthNoise = noise2D(segIdx * 13.3, t * 0.2);
                const width = baseWidth * (0.5 + 0.5 * widthNoise) * (0.35 + 0.65 * edge);
                const widthCells = Math.max(1, Math.round(width));
                let lateralWiggle = baseOffset + noise2D(segIdx * 5.9, t * 0.18) * 1.2;
                const maxCenter = Math.max(0, BANK_INNER - MIN_WATER_GAP - widthCells);
                lateralWiggle = Math.max(-maxCenter, Math.min(maxCenter, lateralWiggle));

                const centerX = this.channelOrigin.x + this.channelForward.x * t + this.channelPerp.x * lateralWiggle;
                const centerZ = this.channelOrigin.z + this.channelForward.z * t + this.channelPerp.z * lateralWiggle;

                for (let l = -widthCells; l <= widthCells; l++) {
                    const wx = Math.round(centerX + this.channelPerp.x * l);
                    const wz = Math.round(centerZ + this.channelPerp.z * l);
                    blocks.push({ x: wx, y: WATER_LEVEL, z: wz });
                }
            }

            const uniq = new Map<string, { x: number; y: number; z: number }>();
            for (const b of blocks) { uniq.set(`${b.x},${b.y},${b.z}`, b); }
            this.midPlans.set(key, { key, blocks: Array.from(uniq.values()) });
        }
    }

    private zoneForSeg(segIdx: number): ZoneType {
        const n = noise2D(segIdx * 7.17, 999.123);
        return n > 0.55 ? 'opensea' : 'twisty';
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
        return false;
    }
}
