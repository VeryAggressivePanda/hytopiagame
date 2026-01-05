import { Entity, ColliderShape, RigidBodyType, World } from 'hytopia';
import { BUBBLE_RADIUS, WATER_LEVEL } from '../config/settings';

type CoinInstance = {
  e: Entity | null;
  pos: { x: number; y: number; z: number };
  spin: number;
  respawnTick: number;
  visible: boolean;
};

export class CoinField {
  private coins: CoinInstance[] = [];
  private readonly count = 1;
  private readonly collectRange = 3.0;
  private readonly minRadius = Math.max(1, BUBBLE_RADIUS + 6);
  private readonly maxRadius = BUBBLE_RADIUS + 12;
  private tick = 0;

  constructor(private world: World) {}

  private randomSpawn(center: { x: number; z: number }) {
    const ang = Math.random() * Math.PI * 2;
    const r = this.minRadius + Math.random() * (this.maxRadius - this.minRadius);
    return {
      x: center.x + Math.cos(ang) * r,
      y: WATER_LEVEL + 1.8,
      z: center.z + Math.sin(ang) * r,
    };
  }

  private spawnCoin(coin: CoinInstance, center: { x: number; z: number }, onCollect?: () => void) {
    coin.pos = this.randomSpawn(center);
    coin.spin = Math.random() * Math.PI * 2;
    const entity = new Entity({
      tag: 'coin',
      name: 'Coin',
      modelUri: 'environment/gameplay/coin.gltf',
      modelScale: 0.8,
      modelPreferredShape: ColliderShape.NONE,
      isEnvironmental: true,
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_POSITION,
        colliders: [
          {
            shape: ColliderShape.BLOCK,
            halfExtents: { x: 0.35, y: 0.5, z: 0.35 },
            isSensor: true,
            tag: 'coin-sensor',
            onCollision: (other: any, started: boolean) => {
              if (!started || !entity.isSpawned || !coin.visible) return;
              if (!other || typeof other !== 'object') return;
              const tag = (other.tag || other.parent?.tag || '').toString();
              if (other.player || tag.includes('player') || tag === 'raft-master') {
                this.collectCoin(coin, onCollect);
              }
            },
          },
        ],
      },
    });
    entity.spawn(this.world, coin.pos);
    entity.setOpacity?.(0);
    coin.visible = false;
    coin.e = entity;
  }

  private collectCoin(coin: CoinInstance, onCollect?: () => void) {
    if (coin.e?.isSpawned) coin.e.despawn();
    coin.e = null;
    coin.visible = false;
    coin.respawnTick = this.tick + 120;
    if (onCollect) onCollect();
  }

  public update(
    center: { x: number; z: number },
    collectorPos: { x: number; z: number } | null,
    onCollect?: () => void
  ) {
    this.tick++;
    while (this.coins.length < this.count) {
      this.coins.push({
        e: null,
        pos: { x: 0, y: 0, z: 0 },
        spin: 0,
        respawnTick: 0,
        visible: false,
      });
    }

    for (const coin of this.coins) {
      if (!coin.e || !coin.e.isSpawned) {
        if (this.tick < coin.respawnTick) continue;
        this.spawnCoin(coin, center, onCollect);
        continue;
      }

      const dx = coin.pos.x - center.x;
      const dz = coin.pos.z - center.z;
      if (Math.hypot(dx, dz) > BUBBLE_RADIUS + 40) {
        coin.e.despawn();
        coin.e = null;
        coin.visible = false;
        continue;
      }

      const distToCenter = Math.hypot(dx, dz);
      const shouldShow = distToCenter <= BUBBLE_RADIUS;
      if (shouldShow !== coin.visible) {
        coin.e.setOpacity?.(shouldShow ? 1 : 0);
        coin.e.colliders?.forEach(c => c.setEnabled?.(shouldShow));
        coin.visible = shouldShow;
      }

      if (collectorPos && coin.visible) {
        const cx = coin.pos.x - collectorPos.x;
        const cz = coin.pos.z - collectorPos.z;
        if (cx * cx + cz * cz <= this.collectRange * this.collectRange) {
          this.collectCoin(coin, onCollect);
          continue;
        }
      }

      coin.spin += 0.08;
      coin.e.setRotation({ x: 0, y: Math.sin(coin.spin / 2), z: 0, w: Math.cos(coin.spin / 2) });
      coin.e.setPosition(coin.pos);
    }
  }
}
