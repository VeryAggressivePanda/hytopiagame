import { BlockType, World } from 'hytopia';

export const WATER_BLOCK_ID = 1;
export const WATER_BRIGHT_BLOCK_ID = 2;
export const WATER_MEDIUM_BLOCK_ID = 3;
export const WATER_SKY_BLOCK_ID = 4;
export const SAND_BLOCK_ID = 5;

export function registerBlocks(world: World) {
    world.blockTypeRegistry.registerBlockType(new BlockType({
        id: WATER_BLOCK_ID,
        name: 'Water',
        textureUri: 'blocks/water.png',
        isLiquid: true,
    }));
    world.blockTypeRegistry.registerBlockType(new BlockType({
        id: WATER_BRIGHT_BLOCK_ID,
        name: 'Water Bright',
        textureUri: 'blocks/water_bright1.png',
        isLiquid: true,
    }));
    world.blockTypeRegistry.registerBlockType(new BlockType({
        id: WATER_MEDIUM_BLOCK_ID,
        name: 'Water Medium Bright',
        textureUri: 'blocks/water_bright2.png',
        isLiquid: true,
    }));
    world.blockTypeRegistry.registerBlockType(new BlockType({
        id: WATER_SKY_BLOCK_ID,
        name: 'Water Sky Bright',
        textureUri: 'blocks/water_bright2.png',
        isLiquid: true,
    }));
    world.blockTypeRegistry.registerBlockType(new BlockType({
        id: SAND_BLOCK_ID,
        name: 'Sand',
        textureUri: 'blocks/sand.png',
        isLiquid: false,
    }));
}

export const isWaterId = (id: number) => (
    id === WATER_BLOCK_ID ||
    id === WATER_BRIGHT_BLOCK_ID ||
    id === WATER_MEDIUM_BLOCK_ID ||
    id === WATER_SKY_BLOCK_ID
);

export function pickWaterBlock(dist: number) {
    if (dist > 12) return WATER_SKY_BLOCK_ID;
    if (dist > 9) return WATER_MEDIUM_BLOCK_ID;
    if (dist > 6) return WATER_BRIGHT_BLOCK_ID;
    return WATER_BLOCK_ID;
}
