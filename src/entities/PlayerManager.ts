import { DefaultPlayerEntity, World } from 'hytopia';
import { SWIM_DRAIN_PER_TICK, SWIM_REFILL_PER_TICK, WATER_LEVEL } from '../config/settings';
import { isWaterId } from '../config/blocks';

export class PlayerManager {
    public mainPlayer?: DefaultPlayerEntity;
    public swimEnergy = 1;
    private lastSwimSend = -1;

    constructor(private world: World) { }

    public update(playerPos: { x: number; z: number }, raftBlocks: any[], bubbleRadius: number, tickCounter: number, respawnCallback: (p: any) => void) {
        if (!this.mainPlayer || !this.mainPlayer.isSpawned) return;

        const p = this.mainPlayer;
        const pos = p.position;
        const sampleY = Math.floor(pos.y - 0.5);
        const blockId = this.world.chunkLattice.getBlockId({
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

        const inWater = !onLand && !onRaft && blockId !== 0 && isWaterId(blockId) && pos.y <= WATER_LEVEL + 1.1;
        if (inWater) {
            this.swimEnergy = Math.max(0, this.swimEnergy - SWIM_DRAIN_PER_TICK);
        } else {
            this.swimEnergy = Math.min(1, this.swimEnergy + SWIM_REFILL_PER_TICK);
        }

        if (inWater && this.swimEnergy <= 0) {
            this.swimEnergy = 0;
            this.sendSwimState(p, true, true, tickCounter);
            respawnCallback(p);
            return;
        }

        this.sendSwimState(p, inWater, false, tickCounter);

        const dist = Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z);
        if (dist >= bubbleRadius - 0.25) {
            respawnCallback(p);
        }
    }

    public sendSwimState(p: any, inWater: boolean, force = false, tickCounter: number) {
        if (!p) return;
        const shouldSend = force || Math.abs(this.swimEnergy - this.lastSwimSend) > 0.01 || (tickCounter % 20 === 0);
        if (!shouldSend) return;
        this.lastSwimSend = this.swimEnergy;
        try {
            p.player.ui.sendData({ type: 'swim-energy', value: this.swimEnergy, inWater });
        } catch (err) {
            console.warn('[UI] swim-energy send failed', err);
        }
    }
}
