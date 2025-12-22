import { Entity, RigidBodyType, ColliderShape, World } from 'hytopia';
import type { Vector3Like, QuaternionLike } from 'hytopia';
import { TICK_DELTA, WATER_LEVEL } from '../config/settings';
import { DEBUG_RAFT, DEBUG_RAFT_INTERVAL } from '../config/debug';

// Helper to rotate a local vector by a quaternion
function rotateVector(v: Vector3Like, q: QuaternionLike): Vector3Like {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
        x: v.x + q.w * tx + (q.y * tz - q.z * ty),
        y: v.y + q.w * ty + (q.z * tx - q.x * tz),
        z: v.z + q.w * tz + (q.x * ty - q.y * tx)
    };
}

// Helper for cross product
function cross(a: Vector3Like, b: Vector3Like): Vector3Like {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

export class Raft {
    public master: Entity | null = null;
    public visualBlocks: Entity[] = [];
    private spacing = 1.1;
    private length = 5;
    private debugTick = 0;

    public params = {
        mass: 280,            // base mass
        buoyancyStiffness: 26.0,
        buoyancyDamping: 7.0,
        linearDamping: 0.8,
        angularDamping: 2.0,
        targetHeight: 0.8,
    };

    constructor(private world: World) { }

    public spawn(pos: { x: number; z: number }, reason = 'manual') {
        this.master?.despawn();
        this.visualBlocks.forEach(b => b && b.isSpawned && b.despawn());
        this.visualBlocks = new Array(5);

        const colliders = [];
        for (let i = 0; i < 5; i++) {
            colliders.push({
                shape: ColliderShape.BLOCK,
                halfExtents: { x: 0.5, y: 0.5, z: this.length / 2 },
                relativePosition: { x: (i - 2) * this.spacing, y: 0, z: 0 },
                friction: 1.0,
                bounciness: 0.0,
                tag: `raft-collider-${i}`
            });
        }

        this.master = new Entity({
            tag: 'raft-master',
            blockTextureUri: 'blocks/wood_beam.png',
            blockHalfExtents: { x: 0.5, y: 0.5, z: this.length / 2 },
            rigidBodyOptions: {
                type: RigidBodyType.DYNAMIC,
                additionalMass: this.params.mass,
                gravityScale: 0.92,
                linearDamping: this.params.linearDamping,
                angularDamping: this.params.angularDamping,
                // Allow roll/pitch, lock yaw so the raft doesn't spin around its center
                enabledRotations: { x: true, y: false, z: true },
                colliders: colliders,
            },
        });

        const initialY = WATER_LEVEL + 1.2;
        this.master.spawn(this.world, { x: pos.x, y: initialY, z: pos.z });
        // Identity rotation to avoid initial yaw flip
        this.master.setRotation({ x: 0, y: 0, z: 0, w: 1 });

        this.visualBlocks[2] = this.master;

        for (let i = 0; i < 5; i++) {
            if (i === 2) continue;
            const visual = new Entity({
                tag: 'raft-visual-block',
                blockTextureUri: 'blocks/wood_beam.png',
                blockHalfExtents: { x: 0.5, y: 0.5, z: this.length / 2 },
            });
            visual.spawn(this.world, { x: pos.x, y: initialY, z: pos.z });
            visual.setParent(this.master, undefined, { x: (i - 2) * this.spacing, y: 0, z: 0 });
            this.visualBlocks[i] = visual;
        }
    }

    private getPointVelocity(vCM: Vector3Like, omega: Vector3Like, com: Vector3Like, pointWorld: Vector3Like): Vector3Like {
        const r = { x: pointWorld.x - com.x, y: pointWorld.y - com.y, z: pointWorld.z - com.z };
        const omegaCrossR = cross(omega, r);
        return {
            x: vCM.x + omegaCrossR.x,
            y: vCM.y + omegaCrossR.y,
            z: vCM.z + omegaCrossR.z,
        };
    }

    public updatePhysics(
        driftDir: { x: number; z: number },
        driftSpeed: number,
        playerOnRaft?: { localOffset: Vector3Like; weight?: number; steer?: number }
    ) {
        if (!this.master || !this.master.isSpawned) return;

        // CRITICAL: Access properties exactly once to avoid recursive borrow errors in Rust/WASM
        const pos = { ...this.master.position };
        const rot = { ...this.master.rotation };
        const vCM = { ...this.master.linearVelocity };
        const omega = { ...this.master.angularVelocity };
        const mass = this.master.mass;
        const localUp = rotateVector({ x: 0, y: 1, z: 0 }, rot);

        // Consolidate linear and angular impulses
        let totalImpulse = { x: 0, y: 0, z: 0 };
        let totalTorque = { x: 0, y: 0, z: 0 };

        // 2. FLOATER POINT BUOYANCY
        const floaterOffsets = [
            { x: -2.2, y: 0, z: -2.5 }, { x: 2.2, y: 0, z: -2.5 },
            { x: -2.2, y: 0, z: 2.5 }, { x: 2.2, y: 0, z: 2.5 }, { x: 0, y: 0, z: 0 },
        ];
        const massPerPoint = mass / floaterOffsets.length;
        const targetY = WATER_LEVEL + this.params.targetHeight;
        let weightFactors: number[] | null = null;
        let extraDownPerPoint = 0;
        const debugDepths: number[] = [];

        if (playerOnRaft) {
            const weight = playerOnRaft.weight ?? 85;
            const local = playerOnRaft.localOffset;
            weightFactors = floaterOffsets.map(o => {
                const dx = local.x - o.x;
                const dz = local.z - o.z;
                const d2 = dx * dx + dz * dz + 0.4;
                return 1 / d2;
            });
            const sum = weightFactors.reduce((a, b) => a + b, 0) || 1;
            weightFactors = weightFactors.map(w => w / sum);
            // Player weight contribution (tunable)
            extraDownPerPoint = weight * 9.81 * 2 * TICK_DELTA;
        }

        for (let i = 0; i < floaterOffsets.length; i++) {
            const offset = floaterOffsets[i];
            const worldOffset = rotateVector(offset, rot);
            const worldPoint = { x: pos.x + worldOffset.x, y: pos.y + worldOffset.y, z: pos.z + worldOffset.z };

            const pointVel = this.getPointVelocity(vCM, omega, pos, worldPoint);
            const depth = targetY - worldPoint.y;
            debugDepths.push(depth);
            // Only apply buoyancy when near/under surface; avoid upward push when clearly above
            if (depth > -0.05) {
                const sub = Math.max(0, depth); // only positive depth drives spring
                const spring = sub * this.params.buoyancyStiffness * massPerPoint;
                const damp = -pointVel.y * this.params.buoyancyDamping * massPerPoint;
                const base = 9.81 * massPerPoint * 1.0; // base lift slightly higher
                let impulseY = Math.max(0, (spring + damp + base) * TICK_DELTA);
                if (weightFactors) {
                    impulseY -= extraDownPerPoint * weightFactors[i];
                }
                if (impulseY > 0) {
                    totalImpulse.y += impulseY;
                    totalTorque.x += -worldOffset.z * impulseY;
                    totalTorque.z += worldOffset.x * impulseY;
                }
            }
        }

        // 3. PLAYER WEIGHT
        if (playerOnRaft) {
            const steer = playerOnRaft.steer ?? 0;
            if (Math.abs(steer) > 0.02) {
                const right = rotateVector({ x: 1, y: 0, z: 0 }, rot);
                const steerImpulse = steer * mass * 1.6 * TICK_DELTA;
                totalImpulse.x += right.x * steerImpulse;
                totalImpulse.z += right.z * steerImpulse;

                const yawImpulse = steer * mass * 1.2 * TICK_DELTA;
                totalTorque.x += localUp.x * yawImpulse;
                totalTorque.y += localUp.y * yawImpulse;
                totalTorque.z += localUp.z * yawImpulse;
            }
        }

        // 4. DRIFT CURRENT (Velocity Matching)
        const accelX = (driftDir.x * driftSpeed - vCM.x) * mass * 2.6;
        const accelZ = (driftDir.z * driftSpeed - vCM.z) * mass * 2.6;
        totalImpulse.x += accelX * TICK_DELTA;
        totalImpulse.z += accelZ * TICK_DELTA;

        // 5. YAW ALIGNMENT (Local Up)
        const forward = rotateVector({ x: 0, y: 0, z: 1 }, rot);
        const currentYaw = Math.atan2(forward.x, forward.z);
        const targetYaw = Math.atan2(driftDir.x, driftDir.z);
        let yawError = targetYaw - currentYaw;
        while (yawError > Math.PI) yawError -= Math.PI * 2;
        while (yawError < -Math.PI) yawError += Math.PI * 2;

        // Yaw alignment disabled (we lock yaw), so zero the Y component
        const torqueImpulseMag = (yawError * 6.0 * mass - omega.y * 4.0 * mass) * TICK_DELTA;
        totalTorque.x += localUp.x * torqueImpulseMag;
        totalTorque.z += localUp.z * torqueImpulseMag;
        totalTorque.y = 0;

        // 6. SINGLE APPLY CALLS
        this.master.applyImpulse(totalImpulse);
        this.master.applyTorqueImpulse(totalTorque);
        this.master.wakeUp();

        // 7. DEBUG LOGGING
        if (DEBUG_RAFT) {
            this.debugTick++;
            if (this.debugTick % DEBUG_RAFT_INTERVAL === 0) {
                const avgDepth = debugDepths.length ? debugDepths.reduce((a, b) => a + b, 0) / debugDepths.length : 0;
                console.log('[RAFT][DEBUG]', {
                    pos,
                    vel: vCM,
                    omega,
                    avgDepth: avgDepth.toFixed(3),
                    maxDepth: Math.max(...debugDepths.map(d => d || 0)),
                    totalImpulse,
                    totalTorque,
                    playerOnRaft: !!playerOnRaft,
                    weight: playerOnRaft?.weight,
                    depthSamples: debugDepths.map(d => Number(d.toFixed(3))).slice(0, 8),
                });
            }
        }
    }

    public getCenter() {
        return this.master?.isSpawned ? { x: this.master.position.x, z: this.master.position.z } : null;
    }

    public get blocks() {
        return this.visualBlocks;
    }
}
