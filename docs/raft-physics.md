world.on(WorldEvent.TICK, () => {
  raftBlocks.forEach((block, i) => {
    if (!block.isSpawned || !block.rigidBody) return;

    const pos = block.position;
    const vel = block.linearVelocity;

    const liquidInfo = isBlockInLiquid(world, pos);
    const inLiquid = liquidInfo.inLiquid;

    if (inLiquid) {
      // ----------------------------------------------------
      // DRAGENDE WATERKRACHT
      // ----------------------------------------------------

      // Zoek de water-blocklaag exact
      const sampleY = Math.floor(pos.y - 0.45);
      const waterBlockTop = sampleY + 1; // blok top

      // Hier wil de raft boven drijven
      const floatHeight = waterBlockTop + 0.2;

      const error = floatHeight - pos.y;
      const buoyancyStrength = 6.0;

      // Vereenvoudigde spring-damper buoyancy
      const upwardForce = error * buoyancyStrength;

      block.applyImpulse({ x: 0, y: upwardForce * block.mass, z: 0 });

      // ----------------------------------------------------
      // WEERSTAND / SLOW DOWN IN WATER
      // ----------------------------------------------------
      const drag = 2.0;
      block.setLinearDamping(drag);
      block.setAngularDamping(drag);

      // Gravity reduceren, maar niet uitschakelen
      block.setGravityScale(0.15);

      // ----------------------------------------------------
      // ROTATIE STABILISATIE
      // ----------------------------------------------------
      const rot = block.rotation;
      block.setRotation({ x: 0, y: rot.y, z: 0, w: rot.w });

    } else {
      // Normale physics
      block.setGravityScale(1.0);
      block.setLinearDamping(0.5);
      block.setAngularDamping(0.5);
    }

    // ----------------------------------------------------
    // COHESION EQUAL TO YOUR VERSION
    // ----------------------------------------------------
    let fx = 0, fz = 0;
    raftBlocks.forEach((other, j) => {
      if (i === j || !other.isSpawned) return;

      const op = other.position;
      const dx = op.x - pos.x;
      const dz = op.z - pos.z;
      const dist = Math.sqrt(dx*dx + dz*dz);

      if (dist > 1.0 && dist < 2.5) {
        const pull = (dist - 1.1) * 2.0;
        fx += (dx / dist) * pull;
        fz += (dz / dist) * pull;
      }
    });

    if (fx !== 0 || fz !== 0) {
      block.applyImpulse({ x: fx * 0.1, y: 0, z: fz * 0.1 });
    }

  });
});
