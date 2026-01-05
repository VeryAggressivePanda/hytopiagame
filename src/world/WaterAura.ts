import { World } from 'hytopia';
import { BUBBLE_RADIUS, WATER_LEVEL } from '../config/settings';
import { WATER_BLOCK_ID, WATER_BRIGHT_BLOCK_ID, WATER_MEDIUM_BLOCK_ID, WATER_SKY_BLOCK_ID, pickWaterBlock } from '../config/blocks';
import { noise2D } from '../utils/math';

export class WaterAura {
    public activeWater = new Map<string, number>();

    constructor(private world: World) { }

    public update(
        center: { x: number; z: number },
        isIslandBase: (x: number, z: number) => boolean,
        raftInfo?: { pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number; w: number }, width: number, speed: number },
        tick?: number
    ) {
        // Cull outside
        for (const [key] of this.activeWater) {
            const [x, z] = key.split(',').map(Number);
            if (Math.hypot(x - center.x, z - center.z) > BUBBLE_RADIUS) {
                this.world.chunkLattice.setBlock({ x, y: WATER_LEVEL, z }, 0);
                this.activeWater.delete(key);
            }
        }

        const startX = Math.floor(center.x - BUBBLE_RADIUS);
        const endX = Math.ceil(center.x + BUBBLE_RADIUS);
        const startZ = Math.floor(center.z - BUBBLE_RADIUS);
        const endZ = Math.ceil(center.z + BUBBLE_RADIUS);

        for (let x = startX; x < endX; x++) {
            for (let z = startZ; z < endZ; z++) {
                if (isIslandBase(x, z)) continue;
                const dist = Math.hypot(x - center.x, z - center.z);
                if (dist > BUBBLE_RADIUS) continue;

                const key = `${x},${z}`;
                let target = pickWaterBlock(dist);

                // Subtle blue wake trail logic
                if (raftInfo && raftInfo.speed > 0.5) {
                    const dx = x - raftInfo.pos.x;
                    const dz = z - raftInfo.pos.z;
                    const q = raftInfo.rot;

                    const tx = 2 * (q.y * dz - q.z * 0);
                    const ty = 2 * (q.z * dx - q.x * dz);
                    const tz = 2 * (q.x * 0 - q.y * dx);

                    const localX = dx + (-q.w * tx + (q.y * tz - q.z * ty));
                    const localZ = dz + (-q.w * tz + (q.x * ty - q.y * tx));

                    const trailLength = Math.max(0, raftInfo.speed * 1.8);
                    const rearOffset = 2.0;
                    if (localZ > rearOffset && localZ < trailLength + rearOffset) {
                        const spreadFactor = 0.22;
                        const halfWidth = (raftInfo.width / 2) + (localZ - rearOffset) * spreadFactor;
                        if (Math.abs(localX) < halfWidth) {
                            const slowTime = Math.floor((tick || 0) / 12);
                            const hash = noise2D(x + slowTime * 0.1, z + slowTime * 0.1);

                            // Use subtle blue variations instead of bright white
                            if (hash > 0.65) {
                                target = WATER_MEDIUM_BLOCK_ID; // Subtle blue ripple
                            } else if (hash > 0.3) {
                                target = WATER_SKY_BLOCK_ID; // Slightly lighter shimmer
                            }
                        }
                    }
                }

                if (this.activeWater.get(key) !== target) {
                    this.world.chunkLattice.setBlock({ x, y: WATER_LEVEL, z }, target);
                    this.activeWater.set(key, target);
                }
            }
        }
    }

    public sweep(center: { x: number; z: number }, isIslandBase: (x: number, z: number) => boolean) {
        const SWEEP_RADIUS = BUBBLE_RADIUS + 6;
        for (let x = Math.floor(center.x - SWEEP_RADIUS); x <= Math.ceil(center.x + SWEEP_RADIUS); x++) {
            for (let z = Math.floor(center.z - SWEEP_RADIUS); z <= Math.ceil(center.z + SWEEP_RADIUS); z++) {
                if (isIslandBase(x, z)) continue;
                const dist = Math.hypot(x - center.x, z - center.z);
                if (dist > BUBBLE_RADIUS + 1) {
                    const key = `${x},${z}`;
                    const id = this.world.chunkLattice.getBlockId({ x, y: WATER_LEVEL, z });
                    if ([WATER_BLOCK_ID, WATER_BRIGHT_BLOCK_ID, WATER_MEDIUM_BLOCK_ID, WATER_SKY_BLOCK_ID].includes(id)) {
                        this.world.chunkLattice.setBlock({ x, y: WATER_LEVEL, z }, 0);
                        this.activeWater.delete(key);
                    }
                }
            }
        }
    }
}
