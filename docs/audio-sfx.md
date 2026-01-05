# Audio & SFX

Music and sound effects are a key piece to any enjoyable game. The `Audio`
class lets you create and control playback of both ambient and spatial audio
within your game.

## Playing Ambient Audio
Play a simple looping track that everyone hears in the world:

```ts
startServer(world => {
  // ... Rest of our game setup code

  const gameMusic = new Audio({
    uri: 'audio/music/ambience.mp3',
    loop: true, // Loop the music when it ends
    volume: 0.5, // Relative volume 0 to 1
  });

  gameMusic.play(world); // Play the music in our world

  // ... More game setup code, ordering doesn't matter for Audio
});
```

## Playing Spatial Audio
Spatial audio can originate from a point in 3D space or from an entity. In this
example, a looping siren plays from each player after they join.

```ts
startServer(world => {
  // ... Other game code

  world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
    const playerEntity = new PlayerEntity({
      player,
      modelUri: 'models/players/player.gltf', // resolves to assets/models/player.gltf
      modelLoopedAnimations: ['idle'],
      modelScale: 0.5,
    });

    const playerSirenAudio = new Audio({
      uri: 'audio/sfx/siren.mp3',
      loop: true, // Omit loop: true for a one-shot
      volume: 1, // 0 (silent) to 1 (max)
      attachedToEntity: playerEntity,
      // reference distance is the approximate block distance
      // a player can be to start hearing the audio, as they
      // get closer to the source it'll get louder, up to the
      // volume value.
      referenceDistance: 20,
      // Alternatively, emit from a fixed position:
      // position: { x: 1, y: 5, z: 4 }
    });

    playerSirenAudio.play(world);
  });

  // ... Other game code
});
```

## Controlling Playback & Effects
Most playback settings and effects can be controlled while audio is already
playing. Effects are interpolated by the client for smooth transitions, which
enables real-time changes like playback rate, distortion, detune, and volume.

Here is an example that continuously speeds up a looping track:

```ts
startServer(world => {
  // ... Rest of our game setup code

  const gameMusic = new Audio({
    uri: 'audio/music/ambience.mp3',
    loop: true, // Loop the music when it ends
    volume: 0.5, // Relative volume 0 to 1
  });

  gameMusic.play(world); // Play the music in our world

  setInterval(() => {
    gameMusic.setPlaybackRate(gameMusic.playbackRate + 0.1);
  }, 1000); // Every 1 second (1000 milliseconds), increase speed!

  // ... More game setup code, ordering doesn't matter for Audio
});
```
