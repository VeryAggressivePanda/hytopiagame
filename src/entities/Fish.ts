import { Entity, RigidBodyType, ColliderShape, World } from 'hytopia';
import { WATER_LEVEL, BUBBLE_RADIUS, FISH_COUNT, FISH_MODELS } from '../config/settings';

export class FishGroup {
    private fishLife: { e: Entity | null; ang: number; radius: number; height: number; speed: number; modelUri: string }[] = [];

    constructor(private world: World) { }

    public update(playerPos: { x: number; z: number }) {
        while (this.fishLife.length < FISH_COUNT) {
            this.fishLife.push({
                e: null,
                ang: Math.random() * Math.PI * 2,
                radius: 6 + Math.random() * 6,
                height: WATER_LEVEL - 0.5 + Math.random() * 1.5,
                speed: 0.3 + Math.random() * 0.4,
                modelUri: FISH_MODELS[Math.floor(Math.random() * FISH_MODELS.length)],
            });
        }

        this.fishLife.forEach(f => {
            f.ang += f.speed * 0.05;
            const x = playerPos.x + Math.cos(f.ang) * f.radius;
            const z = playerPos.z + Math.sin(f.ang) * f.radius;
            const pos = { x, y: f.height, z };

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
                fish.spawn(this.world, pos);
                f.e = fish;
            } else {
                f.e.setPosition(pos);
            }

            if (Math.hypot(x - playerPos.x, z - playerPos.z) > BUBBLE_RADIUS + 25) {
                f.e?.despawn();
                f.e = null;
                f.radius = 6 + Math.random() * 6;
                f.ang = Math.random() * Math.PI * 2;
            }
        });
    }
}
