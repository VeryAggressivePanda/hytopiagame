import { Entity, RigidBodyType, ColliderShape, World } from 'hytopia';
import { WATER_LEVEL, TICK_DELTA } from '../config/settings';

type Vec2 = { x: number; z: number };

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export class FloatingDebrisField {
  private debris: Entity[] = [];
  private cooldown = 0;
  private collectArmed = false;
  private collectorPos: { x: number; z: number } | null = null;
  private readonly collectRange = 3.5;

  constructor(private world: World) {}

  public update(
    center: { x: number; z: number },
    driftDir: Vec2,
    driftSpeed: number,
    collectorPos: { x: number; z: number } | null,
    wantsCollect: boolean,
    onCollected: (beam: Entity) => boolean
  ) {
    this.collectorPos = collectorPos;
    this.collectArmed = wantsCollect;

    // Despawn debris that drifted too far away.
    this.debris = this.debris.filter(d => {
      if (!d.isSpawned) return false;
      const dx = d.position.x - center.x;
      const dz = d.position.z - center.z;
      if (dx * dx + dz * dz > 140 * 140) {
        d.despawn();
        return false;
      }
      return true;
    });

    const MAX = 1;
    if (this.cooldown > 0) this.cooldown--;

    if (this.debris.length < MAX && this.cooldown === 0) {
      if (Math.random() < 0.015) {
        this.spawnOne(center, driftDir, driftSpeed, onCollected);
        this.cooldown = 180;
      }
    }

    if (this.collectArmed && this.collectorPos) {
      for (const d of this.debris) {
        if (!d.isSpawned) continue;
        const dx = d.position.x - this.collectorPos.x;
        const dz = d.position.z - this.collectorPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > this.collectRange * this.collectRange) continue;
        const collected = onCollected(d);
        if (collected) {
          if (d.isSpawned) d.despawn();
          this.removeDebris(d);
        }
        break;
      }
    }

    for (const d of this.debris) {
      if (!d.isSpawned) continue;

      const targetY = WATER_LEVEL + 0.6;
      const error = targetY - d.position.y;
      if (error > -0.1) {
        const upImpulse = Math.max(0, error * 12.0 * d.mass * TICK_DELTA);
        if (upImpulse > 0) d.applyImpulse({ x: 0, y: upImpulse, z: 0 });
      }

      const targetVX = driftDir.x * driftSpeed * 0.35;
      const targetVZ = driftDir.z * driftSpeed * 0.35;
      const dv = d.linearVelocity;
      d.applyImpulse({
        x: (targetVX - dv.x) * d.mass * 0.18 * TICK_DELTA,
        y: 0,
        z: (targetVZ - dv.z) * d.mass * 0.18 * TICK_DELTA,
      });
      d.applyImpulse({ x: 0, y: (-dv.y) * d.mass * 0.6 * TICK_DELTA, z: 0 });
    }
  }

  private removeDebris(target: Entity) {
    this.debris = this.debris.filter(d => d !== target);
  }

  private spawnOne(
    center: { x: number; z: number },
    driftDir: Vec2,
    driftSpeed: number,
    onCollected: (beam: Entity) => boolean
  ) {
    const ahead = rand(18, 35);
    const side = rand(-8, 8);
    const jitter = rand(-4, 4);

    const len = Math.hypot(driftDir.x, driftDir.z) || 1;
    const f = { x: driftDir.x / len, z: driftDir.z / len };
    const r = { x: f.z, z: -f.x };

    const x = center.x + f.x * (ahead + jitter) + r.x * side;
    const z = center.z + f.z * (ahead + jitter) + r.z * side;

    const e = new Entity({
      tag: 'floating-beam',
      blockTextureUri: 'blocks/wood_beam.png',
      blockHalfExtents: { x: 0.5, y: 0.5, z: 2.5 },
      rigidBodyOptions: {
        type: RigidBodyType.DYNAMIC,
        additionalMass: 15,
        gravityScale: 0.2,
        linearDamping: 1.3,
        angularDamping: 2.2,
        colliders: [
          {
            shape: ColliderShape.BLOCK,
            halfExtents: { x: 0.5, y: 0.5, z: 2.5 },
            friction: 0.9,
            bounciness: 0,
            tag: 'floating-beam-col',
            onCollision: (other: any, started: boolean) => {
              if (!started || !e.isSpawned) return;
              if (!other || typeof other !== 'object') return;
              if (other.tag === 'raft-master') {
                if (!this.collectArmed || !this.collectorPos) return;
                const dx = e.position.x - this.collectorPos.x;
                const dz = e.position.z - this.collectorPos.z;
                const d2 = dx * dx + dz * dz;
                if (d2 > this.collectRange * this.collectRange) return;
                const collected = onCollected(e);
                if (collected) {
                  if (e.isSpawned) e.despawn();
                  this.removeDebris(e);
                }
              }
            },
          },
        ],
      },
    });

    e.spawn(this.world, { x, y: WATER_LEVEL + 0.5, z });
    e.setLinearVelocity({ x: f.x * driftSpeed * 0.25, y: 0, z: f.z * driftSpeed * 0.25 });

    this.debris.push(e);
  }
}
