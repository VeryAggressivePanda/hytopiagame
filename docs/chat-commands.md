# Commands & Player Messaging

## Join Flow
When a player enters the world we spawn them five blocks above the sea, load the physics UI, and send a chat hint explaining how to spawn the raft.

```197:204:index.ts
  world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
    const playerEntity = new DefaultPlayerEntity({ player, name: 'Player' });
    playerEntity.spawn(world, { x: 0, y: waterLevel + 5, z: 0 });

    player.ui.load('ui/index.html');
    world.chatManager.sendPlayerMessage(player, '🌊 Water loaded! Type /raft to spawn raft', '00FFFF');
```

## `/raft` Command
The chat command reuses `spawnRaft()` so every tester can respawn the buoyant platform on demand without restarting the server. A confirmation message is pushed back to the invoking player.

```204:208:index.ts
    world.chatManager.registerCommand('/raft', () => {
      spawnRaft();
      world.chatManager.sendPlayerMessage(player, '🚤 Raft spawned!', '00FF00');
    });
```

## UI → Server Parameter Updates
Slider changes arrive through `player.ui.onData`. We echo the new value to both console and player chat before mutating the shared `physicsParams` object so future spawns or calculations can read the latest tuning values.

```210:225:index.ts
    player.ui.onData = (data) => {
      if (data.type === 'physics-update') {
        console.log(`[Physics Update] ${data.param} -> ${data.value}`);
        world.chatManager.sendPlayerMessage(player, `Update: ${data.param} = ${data.value}`, '00FF00');

        switch(data.param) {
          case 'height': physicsParams.targetHeight = data.value; break;
          case 'stiffness': physicsParams.stiffness = data.value; break;
          case 'ldamp': physicsParams.linearDamping = data.value; break;
          case 'adamp': physicsParams.angularDamping = data.value; break;
          case 'wave': physicsParams.waveAmplitude = data.value; break;
        }
      }
    };
```
