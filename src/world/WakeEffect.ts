import { Entity, RigidBodyType, World, ColliderShape } from 'hytopia';
import { WATER_LEVEL, TICK_DELTA } from '../config/settings';

interface WakeParticle {
    entity: Entity;
    life: number; // 0 to 1
    velocity: { x: number; y: number; z: number };
}

export class WakeEffect {
    private particles: WakeParticle[] = [];
    private spawnTimer = 0;

    constructor(private world: World) { }

    public update(
        raftPos: { x: number; y: number; z: number },
        raftRotation: { x: number; y: number; z: number; w: number },
        raftVelocity: { x: number; y: number; z: number },
        raftWidth: number,
        driftDir: { x: number; z: number },
        driftSpeed: number,
        tick?: number
    ) {
        // 1. Spawning
        const speedSq = raftVelocity.x * raftVelocity.x + raftVelocity.z * raftVelocity.z;
        const speed = Math.sqrt(speedSq);

        // Spawn more when moving faster
        if (speed > 0.5) {
            this.spawnTimer += speed * 0.2; // Spawn a bit more
            if (this.spawnTimer >= 1.0) {
                this.spawnTimer = 0;
                this.spawnBatch(raftPos, raftRotation, raftVelocity, raftWidth, tick);
            }
        }

        // 2. Update existing particles
        const decay = 0.02; // Fade out slightly faster
        this.particles = this.particles.filter((p, index) => {
            p.life -= decay;
            if (p.life <= 0) {
                if (p.entity.isSpawned) p.entity.despawn();
                return false;
            }

            const pos = p.entity.position;
            const targetY = WATER_LEVEL + 1.0 + Math.sin(p.life * 8 + index * 0.5) * 0.05;

            p.velocity.x *= 0.98;
            p.velocity.z *= 0.98;
            p.velocity.x += driftDir.x * driftSpeed * 0.02 * TICK_DELTA;
            p.velocity.z += driftDir.z * driftSpeed * 0.02 * TICK_DELTA;

            p.entity.setPosition({
                x: pos.x + p.velocity.x * TICK_DELTA,
                y: pos.y * 0.6 + targetY * 0.4,
                z: pos.z + p.velocity.z * TICK_DELTA,
            });

            p.entity.setOpacity(Math.min(1.0, p.life * 2.5)); // Restored to full opacity
            return true;
        });
    }

    private spawnBatch(
        raftPos: { x: number; y: number; z: number },
        raftRotation: { x: number; y: number; z: number; w: number },
        raftVelocity: { x: number; y: number; z: number },
        raftWidth: number,
        _tick?: number
    ) {
        const rearZOffset = 2.8;
        const raftWidthHalf = raftWidth / 2;

        [-1, 1].forEach(side => {
            const jitterX = (Math.random() - 0.5) * 0.4;
            const localX = side * raftWidthHalf + jitterX;
            const localZ = rearZOffset + Math.random() * 0.5;

            const worldOffset = this.rotateVector({ x: localX, y: 0, z: localZ }, raftRotation);
            const spawnPos = {
                x: raftPos.x + worldOffset.x,
                y: WATER_LEVEL + 1.0,
                z: raftPos.z + worldOffset.z
            };

            const size = 0.04 + Math.random() * 0.05;

            const entity = new Entity({
                tag: 'wake-foam',
                blockTextureUri: 'blocks/snow.png',
                blockHalfExtents: { x: size, y: size, z: size },
                rigidBodyOptions: {
                    type: RigidBodyType.KINEMATIC_POSITION,
                    colliders: [{
                        shape: ColliderShape.BLOCK,
                        halfExtents: { x: size, y: size, z: size },
                        isSensor: true,
                        enabled: false,
                        collisionGroups: { belongsTo: [], collidesWith: [] },
                    }],
                }
            });

            entity.spawn(this.world, spawnPos);
            entity.setOpacity(0.5);

            const speedSq = raftVelocity.x * raftVelocity.x + raftVelocity.z * raftVelocity.z;
            const speed = Math.sqrt(speedSq);
            const outwardPower = 0.8 * Math.min(1, speed / 5);
            const outwardVel = this.rotateVector({ x: side * outwardPower, y: 0, z: 0 }, raftRotation);

            this.particles.push({
                entity,
                life: 1.0,
                velocity: {
                    x: raftVelocity.x * 0.05 + outwardVel.x + (Math.random() - 0.5) * 0.1,
                    z: raftVelocity.z * 0.05 + outwardVel.z + (Math.random() - 0.5) * 0.1,
                    y: 0
                }
            });
        });
    }

    private rotateVector(v: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }) {
        const tx = 2 * (q.y * v.z - q.z * v.y);
        const ty = 2 * (q.z * v.x - q.x * v.z);
        const tz = 2 * (q.x * v.y - q.y * v.x);
        return {
            x: v.x + q.w * tx + (q.y * tz - q.z * ty),
            y: v.y + q.w * ty + (q.z * tx - q.x * tz),
            z: v.z + q.w * tz + (q.x * ty - q.y * tx)
        };
    }
}
