export const WATER_LEVEL = 5;
export const BUBBLE_RADIUS = 15;
export const TICK_DELTA = 1 / 20;
export const RADAR_RANGE = 45; // Easy to adjust centrally

export const PHYSICS_SETTINGS = {
    targetHeight: 0.5,
    stiffness: 6.0,
    linearDamping: 5.0,
    angularDamping: 2.0,
};

export const SWIM_GRAVITY = 0.3;
export const SWIM_MAX_FALL_SPEED = -2.0;
export const SWIM_DRAIN_PER_TICK = 1 / 900;
export const SWIM_REFILL_PER_TICK = 0.04;

export const DRIFT_STEER_INTERVAL = 220;
export const DRIFT_TURN_RATE = 0.03;

export const ISLAND_GRID = 20;
export const ISLAND_MIN_DISTANCE = 8;
export const BANK_SEG_LEN = 14;
export const ZONE_LEN = 80;
export const ZONE_BLEND = 24;

export const FISH_COUNT = 8;
export const FISH_MODELS = [
    'models/NPCs/anglerfish.gltf',
    'models/NPCs/catfish.gltf',
    'models/NPCs/clownfish.gltf',
    'models/NPCs/electric-catfish.gltf',
    'models/NPCs/flying-fish.gltf',
    'models/NPCs/lionfish.gltf',
    'models/NPCs/parrotfish.gltf',
    'models/NPCs/pufferfish.gltf',
    'models/NPCs/sailfish.gltf',
    'models/NPCs/swordfish.gltf',
];

export const PALM_VARIANTS = [
    'models/players/environment/palm-1.gltf',
    'models/players/environment/palm-2.gltf',
    'models/players/environment/palm-3.gltf',
    'models/players/environment/palm-4.gltf',
    'models/players/environment/palm-5.gltf',
    'models/players/environment/palm-bush.gltf',
];
