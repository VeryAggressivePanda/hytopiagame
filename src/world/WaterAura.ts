import { World } from 'hytopia';
import { BUBBLE_RADIUS, WATER_LEVEL } from '../config/settings';
import { WATER_BLOCK_ID, WATER_BRIGHT_BLOCK_ID, WATER_MEDIUM_BLOCK_ID, WATER_SKY_BLOCK_ID, pickWaterBlock } from '../config/blocks';

export class WaterAura {
    private activeWater = new Map<string, number>();

    constructor(private world: World) { }

    public update(center: { x: number; z: number }, isIslandBase: (x: number, z: number) => boolean) {
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
                const target = pickWaterBlock(dist);
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
