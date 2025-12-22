import { Entity, RigidBodyType, ColliderShape, World } from 'hytopia';
import { WATER_LEVEL, BUBBLE_RADIUS } from '../config/settings';

export enum SharkState { CIRCLING, RAMMING }

export class Shark {
    public entity?: Entity;
    public fin?: Entity;
    public ai = { state: SharkState.CIRCLING, timer: 0, target: null as { x: number; z: number } | null };

    constructor(private world: World) { }

    public spawn(center: { x: number; z: number }) {
        this.entity?.isSpawned && this.entity.despawn();
        this.fin?.isSpawned && this.fin.despawn();

        const angle = Math.random() * Math.PI * 2;
        const spawnDist = BUBBLE_RADIUS - 5;
        const sx = center.x + Math.cos(angle) * spawnDist;
        const sz = center.z + Math.sin(angle) * spawnDist;

        this.entity = new Entity({
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
                    isSensor: true,
                }],
            },
        });

        this.fin = new Entity({
            tag: 'shark-fin',
            blockTextureUri: 'blocks/stone.png',
            blockHalfExtents: { x: 0.1, y: 0.3, z: 0.4 },
            rigidBodyOptions: { type: RigidBodyType.DYNAMIC, gravityScale: 0, colliders: [] },
        });

        this.entity.spawn(this.world, { x: sx, y: WATER_LEVEL - 0.5, z: sz });
        this.fin.spawn(this.world, { x: sx, y: WATER_LEVEL + 0.1, z: sz });
        this.fin.setParent(this.entity, undefined, { x: 0, y: 0.6, z: 0 });

        console.log('[SHARK] Spawned');
    }

    public update(playerPos: { x: number; z: number }, aliveRaft: Entity[]) {
        if (!this.entity || !this.entity.isSpawned) return;

        const pos = this.entity.position;

        if (this.ai.state === SharkState.CIRCLING) {
            if (aliveRaft.length > 0 && Math.random() < 0.02) {
                let nearest = aliveRaft[0];
                let nd = Infinity;
                aliveRaft.forEach(b => {
                    const d = (b.position.x - pos.x) ** 2 + (b.position.z - pos.z) ** 2;
                    if (d < nd) { nd = d; nearest = b; }
                });
                this.ai.state = SharkState.RAMMING;
                this.ai.target = { x: nearest.position.x, z: nearest.position.z };
                this.ai.timer = 120;
            } else {
                const radius = 15;
                const angle = (Date.now() / 1000) * 0.5;
                this.ai.target = { x: playerPos.x + Math.cos(angle) * radius, z: playerPos.z + Math.sin(angle) * radius };
            }
        } else if (this.ai.state === SharkState.RAMMING) {
            if (!this.ai.target || this.ai.timer <= 0 || aliveRaft.length === 0) {
                this.ai.state = SharkState.CIRCLING;
                this.ai.target = null;
            }
            this.ai.timer--;
        }

        if (this.ai.target) {
            const dx = this.ai.target.x - pos.x;
            const dz = this.ai.target.z - pos.z;
            const dist = Math.hypot(dx, dz);
            const speed = this.ai.state === SharkState.RAMMING ? 15 : 8;
            const vx = dist > 0.1 ? (dx / dist) * speed : 0;
            const vz = dist > 0.1 ? (dz / dist) * speed : 0;
            const targetY = WATER_LEVEL - 0.5;
            const vy = (targetY - pos.y) * 5;
            this.entity.setLinearVelocity({ x: vx, y: vy, z: vz });
            const yaw = Math.atan2(dx, dz);
            this.entity.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
        }

        if (this.ai.state === SharkState.RAMMING && this.ai.target) {
            const dist = Math.hypot(pos.x - this.ai.target.x, pos.z - this.ai.target.z);
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
                this.ai.state = SharkState.CIRCLING;
                this.ai.target = null;
                this.ai.timer = 0;
            }
        }
    }
}
