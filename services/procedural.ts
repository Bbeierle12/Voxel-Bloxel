import { BlockData, ItemType } from "../types";

// ============================================================================
// PROCEDURAL TERRAIN GENERATION
// Multi-octave noise for terrain height and biome determination
// ============================================================================

// ============================================================================
// NOISE FUNCTIONS
// ============================================================================

/**
 * Simple seeded random number generator
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number = 12345) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  reset(seed: number): void {
    this.seed = seed;
  }
}

/**
 * Hash function for deterministic noise
 */
function hash(x: number, z: number, seed: number = 0): number {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Smooth interpolation (smoothstep)
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Linear interpolation
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 2D Value Noise
 */
function valueNoise(x: number, z: number, seed: number = 0): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;

  const v00 = hash(xi, zi, seed);
  const v10 = hash(xi + 1, zi, seed);
  const v01 = hash(xi, zi + 1, seed);
  const v11 = hash(xi + 1, zi + 1, seed);

  const sx = smoothstep(xf);
  const sz = smoothstep(zf);

  const nx0 = lerp(v00, v10, sx);
  const nx1 = lerp(v01, v11, sx);

  return lerp(nx0, nx1, sz);
}

/**
 * Multi-octave fractal noise (fBm - fractional Brownian motion)
 */
function fractalNoise(
  x: number,
  z: number,
  octaves: number = 4,
  persistence: number = 0.5,
  lacunarity: number = 2.0,
  seed: number = 0
): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += valueNoise(x * frequency, z * frequency, seed + i * 1000) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxValue;
}

// ============================================================================
// BIOME SYSTEM
// ============================================================================

export enum Biome {
  OCEAN = "ocean",
  BEACH = "beach",
  PLAINS = "plains",
  FOREST = "forest",
  HILLS = "hills",
  MOUNTAINS = "mountains",
  SNOW = "snow",
}

interface BiomeConfig {
  baseHeight: number;
  heightVariation: number;
  surfaceBlock: ItemType;
  subsurfaceBlock: ItemType;
  treeChance: number;
  treeDensity: number;
}

const BIOME_CONFIGS: Record<Biome, BiomeConfig> = {
  [Biome.OCEAN]: {
    baseHeight: -5,
    heightVariation: 3,
    surfaceBlock: ItemType.SAND,
    subsurfaceBlock: ItemType.STONE,
    treeChance: 0,
    treeDensity: 0,
  },
  [Biome.BEACH]: {
    baseHeight: 0,
    heightVariation: 2,
    surfaceBlock: ItemType.SAND,
    subsurfaceBlock: ItemType.SAND,
    treeChance: 0.001,
    treeDensity: 0.1,
  },
  [Biome.PLAINS]: {
    baseHeight: 1,
    heightVariation: 3,
    surfaceBlock: ItemType.GRASS,
    subsurfaceBlock: ItemType.DIRT,
    treeChance: 0.005,
    treeDensity: 0.3,
  },
  [Biome.FOREST]: {
    baseHeight: 2,
    heightVariation: 5,
    surfaceBlock: ItemType.GRASS,
    subsurfaceBlock: ItemType.DIRT,
    treeChance: 0.03,
    treeDensity: 0.8,
  },
  [Biome.HILLS]: {
    baseHeight: 8,
    heightVariation: 12,
    surfaceBlock: ItemType.GRASS,
    subsurfaceBlock: ItemType.STONE,
    treeChance: 0.01,
    treeDensity: 0.4,
  },
  [Biome.MOUNTAINS]: {
    baseHeight: 20,
    heightVariation: 25,
    surfaceBlock: ItemType.STONE,
    subsurfaceBlock: ItemType.STONE,
    treeChance: 0.002,
    treeDensity: 0.1,
  },
  [Biome.SNOW]: {
    baseHeight: 25,
    heightVariation: 15,
    surfaceBlock: ItemType.SNOW,
    subsurfaceBlock: ItemType.STONE,
    treeChance: 0.005,
    treeDensity: 0.2,
  },
};

/**
 * Determine biome based on temperature and moisture
 */
function getBiome(temperature: number, moisture: number, elevation: number): Biome {
  if (elevation < -2) return Biome.OCEAN;
  if (elevation < 1 && moisture > 0.3) return Biome.BEACH;
  if (elevation > 25) return Biome.SNOW;
  if (elevation > 15) return Biome.MOUNTAINS;
  if (elevation > 8) return Biome.HILLS;
  if (moisture > 0.6 && temperature > 0.4) return Biome.FOREST;
  return Biome.PLAINS;
}

// ============================================================================
// TERRAIN GENERATION
// ============================================================================

export interface TerrainConfig {
  seed: number;
  size: number; // Size in blocks (square)
  centerFlat: boolean; // Flat area in center for spawning
  flatRadius: number; // Radius of flat spawn area
  waterLevel: number; // Y level for water
  generateTrees: boolean;
  generateCaves: boolean;
}

const DEFAULT_CONFIG: TerrainConfig = {
  seed: 42,
  size: 200,
  centerFlat: true,
  flatRadius: 30,
  waterLevel: 0,
  generateTrees: true,
  generateCaves: false,
};

/**
 * Generate height at a specific position
 */
export function getHeightAt(x: number, z: number, config: TerrainConfig = DEFAULT_CONFIG): number {
  const halfSize = config.size / 2;

  // Distance from center for flat spawn area
  const distFromCenter = Math.sqrt(x * x + z * z);

  if (config.centerFlat && distFromCenter < config.flatRadius) {
    // Flat spawn area with smooth transition
    const transitionStart = config.flatRadius * 0.7;
    if (distFromCenter < transitionStart) {
      return 0; // Perfectly flat
    }
    // Smooth transition to terrain
    const t = (distFromCenter - transitionStart) / (config.flatRadius - transitionStart);
    const terrainHeight = calculateTerrainHeight(x, z, config);
    return lerp(0, terrainHeight, smoothstep(t));
  }

  return calculateTerrainHeight(x, z, config);
}

function calculateTerrainHeight(x: number, z: number, config: TerrainConfig): number {
  // Large-scale terrain features
  const continentalNoise = fractalNoise(
    x * 0.002,
    z * 0.002,
    3,
    0.5,
    2.0,
    config.seed
  );

  // Medium-scale hills
  const hillNoise = fractalNoise(
    x * 0.01,
    z * 0.01,
    4,
    0.5,
    2.0,
    config.seed + 1000
  );

  // Small-scale details
  const detailNoise = fractalNoise(
    x * 0.05,
    z * 0.05,
    2,
    0.3,
    2.0,
    config.seed + 2000
  );

  // Combine noise layers
  const height =
    continentalNoise * 30 + // Large features: -15 to +15
    hillNoise * 15 + // Hills: -7.5 to +7.5
    detailNoise * 3 - // Details: -1.5 to +1.5
    10; // Base offset

  return Math.round(height);
}

/**
 * Get biome at a specific position
 */
export function getBiomeAt(x: number, z: number, config: TerrainConfig = DEFAULT_CONFIG): Biome {
  const temperature = fractalNoise(x * 0.005, z * 0.005, 2, 0.5, 2.0, config.seed + 5000);
  const moisture = fractalNoise(x * 0.004, z * 0.004, 2, 0.5, 2.0, config.seed + 6000);
  const elevation = getHeightAt(x, z, config);

  return getBiome(temperature, moisture, elevation);
}

/**
 * Generate a tree at the specified position
 */
function generateTree(
  x: number,
  baseY: number,
  z: number,
  random: SeededRandom
): BlockData[] {
  const blocks: BlockData[] = [];

  // Tree height (3-6 blocks)
  const height = 3 + Math.floor(random.next() * 4);

  // Trunk
  for (let y = 0; y < height; y++) {
    blocks.push({ x, y: baseY + y, z, type: ItemType.WOOD });
  }

  // Leaves (crown)
  const leafRadius = 2;
  const leafBaseY = baseY + height - 2;

  for (let ly = 0; ly < 3; ly++) {
    const currentRadius = ly === 2 ? 1 : leafRadius;
    for (let lx = -currentRadius; lx <= currentRadius; lx++) {
      for (let lz = -currentRadius; lz <= currentRadius; lz++) {
        // Skip corners for rounder shape
        if (Math.abs(lx) === currentRadius && Math.abs(lz) === currentRadius) {
          if (random.next() > 0.5) continue;
        }
        // Skip trunk position except top
        if (lx === 0 && lz === 0 && ly < 2) continue;

        blocks.push({
          x: x + lx,
          y: leafBaseY + ly,
          z: z + lz,
          type: ItemType.LEAF,
        });
      }
    }
  }

  return blocks;
}

/**
 * Generate terrain blocks for a chunk
 */
export function generateTerrain(config: Partial<TerrainConfig> = {}): BlockData[] {
  const fullConfig: TerrainConfig = { ...DEFAULT_CONFIG, ...config };
  const blocks: BlockData[] = [];
  const random = new SeededRandom(fullConfig.seed);
  const halfSize = fullConfig.size / 2;

  const treePositions: Array<{ x: number; y: number; z: number }> = [];

  // Generate terrain
  for (let x = -halfSize; x < halfSize; x++) {
    for (let z = -halfSize; z < halfSize; z++) {
      const height = getHeightAt(x, z, fullConfig);
      const biome = getBiomeAt(x, z, fullConfig);
      const biomeConfig = BIOME_CONFIGS[biome];

      // Generate column
      for (let y = -10; y <= height; y++) {
        let blockType: ItemType;

        if (y === height) {
          // Surface block
          if (y < fullConfig.waterLevel) {
            blockType = ItemType.SAND;
          } else {
            blockType = biomeConfig.surfaceBlock;
          }
        } else if (y >= height - 3) {
          // Subsurface
          blockType = biomeConfig.subsurfaceBlock;
        } else if (y <= -8) {
          // Bedrock layer
          blockType = ItemType.BEDROCK;
        } else {
          // Deep stone
          blockType = ItemType.STONE;
        }

        blocks.push({ x, y, z, type: blockType });
      }

      // Add water if below water level
      if (height < fullConfig.waterLevel) {
        for (let y = height + 1; y <= fullConfig.waterLevel; y++) {
          blocks.push({ x, y, z, type: ItemType.WATER });
        }
      }

      // Check for tree placement
      if (fullConfig.generateTrees && height > fullConfig.waterLevel) {
        random.reset(hash(x, z, fullConfig.seed) * 1000000);
        if (random.next() < biomeConfig.treeChance) {
          treePositions.push({ x, y: height + 1, z });
        }
      }
    }
  }

  // Generate trees
  for (const pos of treePositions) {
    random.reset(hash(pos.x, pos.z, fullConfig.seed + 9999) * 1000000);
    const treeBlocks = generateTree(pos.x, pos.y, pos.z, random);
    blocks.push(...treeBlocks);
  }

  return blocks;
}

// ============================================================================
// CHUNK-BASED GENERATION (for larger worlds)
// ============================================================================

export const CHUNK_SIZE = 16;

export interface Chunk {
  x: number;
  z: number;
  blocks: BlockData[];
  generated: boolean;
}

/**
 * Generate a single chunk
 */
export function generateChunk(
  chunkX: number,
  chunkZ: number,
  config: Partial<TerrainConfig> = {}
): Chunk {
  const fullConfig: TerrainConfig = { ...DEFAULT_CONFIG, ...config };
  const blocks: BlockData[] = [];
  const random = new SeededRandom(fullConfig.seed + chunkX * 10000 + chunkZ);

  const worldX = chunkX * CHUNK_SIZE;
  const worldZ = chunkZ * CHUNK_SIZE;

  const treePositions: Array<{ x: number; y: number; z: number }> = [];

  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const x = worldX + lx;
      const z = worldZ + lz;
      const height = getHeightAt(x, z, fullConfig);
      const biome = getBiomeAt(x, z, fullConfig);
      const biomeConfig = BIOME_CONFIGS[biome];

      for (let y = -10; y <= height; y++) {
        let blockType: ItemType;

        if (y === height) {
          if (y < fullConfig.waterLevel) {
            blockType = ItemType.SAND;
          } else {
            blockType = biomeConfig.surfaceBlock;
          }
        } else if (y >= height - 3) {
          blockType = biomeConfig.subsurfaceBlock;
        } else if (y <= -8) {
          blockType = ItemType.BEDROCK;
        } else {
          blockType = ItemType.STONE;
        }

        blocks.push({ x, y, z, type: blockType });
      }

      if (height < fullConfig.waterLevel) {
        for (let y = height + 1; y <= fullConfig.waterLevel; y++) {
          blocks.push({ x, y, z, type: ItemType.WATER });
        }
      }

      if (fullConfig.generateTrees && height > fullConfig.waterLevel) {
        random.reset(hash(x, z, fullConfig.seed) * 1000000);
        if (random.next() < biomeConfig.treeChance) {
          treePositions.push({ x, y: height + 1, z });
        }
      }
    }
  }

  for (const pos of treePositions) {
    random.reset(hash(pos.x, pos.z, fullConfig.seed + 9999) * 1000000);
    const treeBlocks = generateTree(pos.x, pos.y, pos.z, random);
    blocks.push(...treeBlocks);
  }

  return {
    x: chunkX,
    z: chunkZ,
    blocks,
    generated: true,
  };
}

// ============================================================================
// STRUCTURE GENERATION
// ============================================================================

export interface Structure {
  name: string;
  blocks: BlockData[];
  anchor: { x: number; y: number; z: number };
}

/**
 * Generate a simple house structure
 */
export function generateHouse(width: number = 7, depth: number = 7, height: number = 4): Structure {
  const blocks: BlockData[] = [];

  // Floor
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      blocks.push({ x, y: 0, z, type: ItemType.PLANK });
    }
  }

  // Walls
  for (let y = 1; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Front and back walls
      if (!(x === Math.floor(width / 2) && y < 3)) {
        // Door opening
        blocks.push({ x, y, z: 0, type: ItemType.PLANK });
      }
      blocks.push({ x, y, z: depth - 1, type: ItemType.PLANK });
    }
    for (let z = 1; z < depth - 1; z++) {
      blocks.push({ x: 0, y, z, type: ItemType.PLANK });
      blocks.push({ x: width - 1, y, z, type: ItemType.PLANK });
    }
  }

  // Roof
  for (let x = -1; x <= width; x++) {
    for (let z = -1; z <= depth; z++) {
      blocks.push({ x, y: height, z, type: ItemType.WOOD });
    }
  }

  return {
    name: "Simple House",
    blocks,
    anchor: { x: Math.floor(width / 2), y: 0, z: 0 },
  };
}

/**
 * Place a structure at a world position
 */
export function placeStructure(
  structure: Structure,
  worldX: number,
  worldY: number,
  worldZ: number
): BlockData[] {
  return structure.blocks.map((block) => ({
    x: worldX + block.x - structure.anchor.x,
    y: worldY + block.y - structure.anchor.y,
    z: worldZ + block.z - structure.anchor.z,
    type: block.type,
  }));
}
