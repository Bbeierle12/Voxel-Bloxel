/**
 * Environment Rules - Natural world simulation logic
 *
 * These rules define how the world evolves naturally:
 * - Grass spreads to nearby dirt
 * - Leaves decay when not connected to wood
 * - Trees grow from saplings
 * - Water flows downhill
 * - Fire spreads to flammable blocks
 */

import { Vector3, ItemType } from '../../types';

// What the world perceives
export interface WorldPerception {
  playerPosition: Vector3;
  radius: number;
  totalBlocks: number;
  grassBlocks: Array<{ position: Vector3; type: number }>;
  dirtBlocks: Array<{ position: Vector3; type: number }>;
  leafBlocks: Array<{ position: Vector3; type: number }>;
  woodBlocks: Array<{ position: Vector3; type: number }>;
  waterBlocks: Array<{ position: Vector3; type: number }>;
  saplingBlocks: Array<{ position: Vector3; type: number }>;
  fireBlocks: Array<{ position: Vector3; type: number }>;
  allBlocks: Array<{ position: Vector3; type: number }>;
  timeOfDay: number; // 0-1, for day/night effects
  timestamp: number;
}

// A change to be made to the world
export interface BlockChange {
  position: Vector3;
  action: 'place' | 'remove';
  oldType?: number;
  newType?: number;
  rule: string;
}

// Type for block lookup callback
type GetBlockAt = (x: number, y: number, z: number) => number | null;

// Adjacent directions (6-connectivity: up, down, north, south, east, west)
const ADJACENT_DIRS: Vector3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
];

// Horizontal neighbors only (for grass spread)
const HORIZONTAL_DIRS: Vector3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 1, y: 0, z: 1 },
  { x: -1, y: 0, z: 1 },
  { x: 1, y: 0, z: -1 },
  { x: -1, y: 0, z: -1 },
];

export interface EnvironmentRules {
  grassSpread: (perception: WorldPerception, getBlockAt: GetBlockAt) => BlockChange[];
  leafDecay: (perception: WorldPerception, getBlockAt: GetBlockAt) => BlockChange[];
  treeGrowth: (perception: WorldPerception, getBlockAt: GetBlockAt) => BlockChange[];
  waterFlow: (perception: WorldPerception, getBlockAt: GetBlockAt) => BlockChange[];
  fireSpread: (perception: WorldPerception, getBlockAt: GetBlockAt) => BlockChange[];
}

/**
 * GRASS SPREAD RULE
 *
 * Dirt blocks adjacent to grass blocks (horizontally) have a chance
 * to convert to grass if:
 * - They have at least one grass neighbor
 * - There's no solid block directly above (needs light)
 * - Random chance succeeds (7% per tick)
 */
function grassSpread(perception: WorldPerception, getBlockAt: GetBlockAt): BlockChange[] {
  const changes: BlockChange[] = [];
  const SPREAD_CHANCE = 0.07; // 7% chance per eligible block per tick

  // Build a set of grass positions for fast lookup
  const grassPositions = new Set<string>();
  for (const grass of perception.grassBlocks) {
    grassPositions.add(`${grass.position.x},${grass.position.y},${grass.position.z}`);
  }

  // Check each dirt block
  for (const dirt of perception.dirtBlocks) {
    const pos = dirt.position;

    // Check if there's a block above (blocks light)
    const blockAbove = getBlockAt(pos.x, pos.y + 1, pos.z);
    if (blockAbove !== null && blockAbove !== ItemType.AIR) {
      continue; // No light, skip
    }

    // Check for adjacent grass (horizontal only)
    let hasGrassNeighbor = false;
    for (const dir of HORIZONTAL_DIRS) {
      const neighborKey = `${pos.x + dir.x},${pos.y + dir.y},${pos.z + dir.z}`;
      if (grassPositions.has(neighborKey)) {
        hasGrassNeighbor = true;
        break;
      }
      // Also check one block below (grass can spread up slopes)
      const belowKey = `${pos.x + dir.x},${pos.y - 1},${pos.z + dir.z}`;
      if (grassPositions.has(belowKey)) {
        hasGrassNeighbor = true;
        break;
      }
    }

    if (!hasGrassNeighbor) continue;

    // Random chance to spread
    if (Math.random() < SPREAD_CHANCE) {
      changes.push({
        position: { ...pos },
        action: 'place',
        oldType: ItemType.DIRT,
        newType: ItemType.GRASS,
        rule: 'grass_spread',
      });
    }
  }

  return changes;
}

/**
 * LEAF DECAY RULE
 *
 * Leaves that are not connected to wood within 4 blocks
 * have a chance to decay (disappear).
 *
 * Uses BFS to check for wood connectivity.
 */
function leafDecay(perception: WorldPerception, getBlockAt: GetBlockAt): BlockChange[] {
  const changes: BlockChange[] = [];
  const DECAY_CHANCE = 0.15; // 15% chance per disconnected leaf per tick
  const MAX_WOOD_DISTANCE = 4;

  // Build a set of wood positions for fast lookup
  const woodPositions = new Set<string>();
  for (const wood of perception.woodBlocks) {
    woodPositions.add(`${wood.position.x},${wood.position.y},${wood.position.z}`);
  }

  // Build a set of leaf positions
  const leafPositions = new Set<string>();
  for (const leaf of perception.leafBlocks) {
    leafPositions.add(`${leaf.position.x},${leaf.position.y},${leaf.position.z}`);
  }

  // Check each leaf block
  for (const leaf of perception.leafBlocks) {
    const pos = leaf.position;

    // BFS to find wood within MAX_WOOD_DISTANCE
    const visited = new Set<string>();
    const queue: Array<{ pos: Vector3; dist: number }> = [{ pos, dist: 0 }];
    let foundWood = false;

    while (queue.length > 0 && !foundWood) {
      const current = queue.shift()!;
      const key = `${current.pos.x},${current.pos.y},${current.pos.z}`;

      if (visited.has(key)) continue;
      visited.add(key);

      // Check if this is wood
      if (woodPositions.has(key)) {
        foundWood = true;
        break;
      }

      // Don't continue past max distance
      if (current.dist >= MAX_WOOD_DISTANCE) continue;

      // Add neighbors (only through leaves or wood)
      for (const dir of ADJACENT_DIRS) {
        const nx = current.pos.x + dir.x;
        const ny = current.pos.y + dir.y;
        const nz = current.pos.z + dir.z;
        const nKey = `${nx},${ny},${nz}`;

        if (visited.has(nKey)) continue;

        // Can only traverse through leaves or wood
        if (leafPositions.has(nKey) || woodPositions.has(nKey)) {
          queue.push({
            pos: { x: nx, y: ny, z: nz },
            dist: current.dist + 1,
          });
        }
      }
    }

    // If no wood found, leaf may decay
    if (!foundWood && Math.random() < DECAY_CHANCE) {
      changes.push({
        position: { ...pos },
        action: 'remove',
        oldType: ItemType.LEAF,
        rule: 'leaf_decay',
      });

      // 10% chance to drop a sapling when leaf decays
      if (Math.random() < 0.10) {
        // Find ground below the leaf to place sapling
        let groundY = pos.y - 1;
        while (groundY > 0) {
          const blockBelow = getBlockAt(pos.x, groundY, pos.z);
          if (blockBelow === ItemType.GRASS || blockBelow === ItemType.DIRT) {
            // Place sapling one above the ground
            changes.push({
              position: { x: pos.x, y: groundY + 1, z: pos.z },
              action: 'place',
              newType: ItemType.SAPLING,
              rule: 'sapling_drop',
            });
            break;
          } else if (blockBelow !== null && blockBelow !== ItemType.AIR && blockBelow !== ItemType.LEAF) {
            // Hit something that's not air or leaf, stop
            break;
          }
          groundY--;
        }
      }
    }
  }

  return changes;
}

/**
 * TREE GROWTH RULE (Phase 2)
 *
 * Saplings grow into trees over time if:
 * - They have space above (5+ blocks)
 * - They're on dirt or grass
 * - Random chance succeeds (higher during day)
 */
function treeGrowth(perception: WorldPerception, getBlockAt: GetBlockAt): BlockChange[] {
  const changes: BlockChange[] = [];

  // Growth chance is higher during daytime (0.25-0.75 is day)
  const isDay = perception.timeOfDay > 0.2 && perception.timeOfDay < 0.8;
  const GROWTH_CHANCE = isDay ? 0.03 : 0.005; // 3% day, 0.5% night
  const REQUIRED_SPACE = 6; // Need 6 blocks of air above

  for (const sapling of perception.saplingBlocks) {
    const pos = sapling.position;

    // Check if on grass or dirt
    const blockBelow = getBlockAt(pos.x, pos.y - 1, pos.z);
    if (blockBelow !== ItemType.GRASS && blockBelow !== ItemType.DIRT) {
      continue;
    }

    // Check for space above (need REQUIRED_SPACE blocks of air)
    let hasSpace = true;
    for (let dy = 1; dy <= REQUIRED_SPACE; dy++) {
      const above = getBlockAt(pos.x, pos.y + dy, pos.z);
      if (above !== null && above !== ItemType.AIR) {
        hasSpace = false;
        break;
      }
    }

    if (!hasSpace) continue;

    // Random chance to grow
    if (Math.random() < GROWTH_CHANCE) {
      // Remove the sapling
      changes.push({
        position: { ...pos },
        action: 'remove',
        oldType: ItemType.SAPLING,
        rule: 'tree_grow',
      });

      // Generate a tree!
      const treeBlocks = generateTree(pos.x, pos.y, pos.z);
      for (const block of treeBlocks) {
        changes.push({
          position: block.position,
          action: 'place',
          newType: block.type,
          rule: 'tree_grow',
        });
      }
    }
  }

  return changes;
}

/**
 * Generate tree blocks at the given position
 * Creates a simple oak-style tree
 */
function generateTree(x: number, y: number, z: number): Array<{ position: Vector3; type: number }> {
  const blocks: Array<{ position: Vector3; type: number }> = [];

  // Trunk height varies from 3-5
  const trunkHeight = 3 + Math.floor(Math.random() * 3);

  // Create trunk
  for (let dy = 0; dy < trunkHeight; dy++) {
    blocks.push({
      position: { x, y: y + dy, z },
      type: ItemType.WOOD,
    });
  }

  // Create leaves (sphere-ish shape around top of trunk)
  const leafStart = trunkHeight - 1;
  const leafRadius = 2;

  for (let dx = -leafRadius; dx <= leafRadius; dx++) {
    for (let dz = -leafRadius; dz <= leafRadius; dz++) {
      for (let dy = 0; dy <= 2; dy++) {
        // Skip corners to make it rounder
        const dist = Math.abs(dx) + Math.abs(dz);
        if (dist > leafRadius + 1) continue;

        // Don't replace trunk
        if (dx === 0 && dz === 0 && dy < 2) continue;

        // More leaves at the middle height
        if (dy === 0 && dist > leafRadius) continue;
        if (dy === 2 && dist > 1) continue;

        blocks.push({
          position: { x: x + dx, y: y + leafStart + dy, z: z + dz },
          type: ItemType.LEAF,
        });
      }
    }
  }

  return blocks;
}

/**
 * WATER FLOW RULE (Phase 3)
 *
 * Water spreads horizontally and flows downward.
 * - Water falls down if there's air below
 * - Water spreads horizontally to adjacent air blocks (with limit)
 * - Creates natural water pooling behavior
 */
function waterFlow(perception: WorldPerception, getBlockAt: GetBlockAt): BlockChange[] {
  const changes: BlockChange[] = [];
  const FLOW_CHANCE = 0.25; // 25% chance per water block per tick
  const MAX_SPREAD = 4; // Max horizontal spread from source

  // Track positions we're already changing to avoid duplicates
  const pendingPositions = new Set<string>();

  for (const water of perception.waterBlocks) {
    const pos = water.position;

    // Random chance to flow this tick
    if (Math.random() > FLOW_CHANCE) continue;

    // Priority 1: Flow downward
    const below = getBlockAt(pos.x, pos.y - 1, pos.z);
    if (below === null || below === ItemType.AIR) {
      const key = `${pos.x},${pos.y - 1},${pos.z}`;
      if (!pendingPositions.has(key)) {
        pendingPositions.add(key);
        changes.push({
          position: { x: pos.x, y: pos.y - 1, z: pos.z },
          action: 'place',
          newType: ItemType.WATER,
          rule: 'water_flow',
        });
      }
      continue; // Flowing down takes priority
    }

    // Priority 2: Spread horizontally (only if can't flow down)
    // Only spread if sitting on a solid block
    if (below !== null && below !== ItemType.AIR && below !== ItemType.WATER) {
      for (const dir of HORIZONTAL_DIRS.slice(0, 4)) { // Only cardinal directions
        const nx = pos.x + dir.x;
        const nz = pos.z + dir.z;
        const neighbor = getBlockAt(nx, pos.y, nz);

        if (neighbor === null || neighbor === ItemType.AIR) {
          const key = `${nx},${pos.y},${nz}`;
          if (!pendingPositions.has(key)) {
            pendingPositions.add(key);
            changes.push({
              position: { x: nx, y: pos.y, z: nz },
              action: 'place',
              newType: ItemType.WATER,
              rule: 'water_flow',
            });
          }
        }
      }
    }
  }

  return changes;
}

/**
 * FIRE SPREAD RULE (Phase 3)
 *
 * Fire spreads to adjacent flammable blocks (wood, leaf, plank).
 * Fire burns out over time.
 * Water extinguishes fire.
 */
function fireSpread(perception: WorldPerception, getBlockAt: GetBlockAt): BlockChange[] {
  const changes: BlockChange[] = [];
  const SPREAD_CHANCE = 0.15; // 15% chance to spread per adjacent flammable block
  const BURNOUT_CHANCE = 0.08; // 8% chance for fire to burn out per tick

  // Flammable block types
  const FLAMMABLE = new Set([ItemType.WOOD, ItemType.LEAF, ItemType.PLANK, ItemType.SAPLING]);

  // Track positions we're already changing
  const pendingPositions = new Set<string>();

  for (const fire of perception.fireBlocks) {
    const pos = fire.position;

    // Check if fire is touching water - extinguish immediately
    let touchingWater = false;
    for (const dir of ADJACENT_DIRS) {
      const neighbor = getBlockAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
      if (neighbor === ItemType.WATER) {
        touchingWater = true;
        break;
      }
    }

    if (touchingWater) {
      changes.push({
        position: { ...pos },
        action: 'remove',
        oldType: ItemType.FIRE,
        rule: 'fire_spread',
      });
      continue;
    }

    // Check for burnout
    if (Math.random() < BURNOUT_CHANCE) {
      changes.push({
        position: { ...pos },
        action: 'remove',
        oldType: ItemType.FIRE,
        rule: 'fire_spread',
      });
      continue;
    }

    // Try to spread to adjacent flammable blocks
    for (const dir of ADJACENT_DIRS) {
      const nx = pos.x + dir.x;
      const ny = pos.y + dir.y;
      const nz = pos.z + dir.z;
      const neighbor = getBlockAt(nx, ny, nz);

      if (neighbor !== null && FLAMMABLE.has(neighbor)) {
        if (Math.random() < SPREAD_CHANCE) {
          const key = `${nx},${ny},${nz}`;
          if (!pendingPositions.has(key)) {
            pendingPositions.add(key);
            // Remove the flammable block and replace with fire
            changes.push({
              position: { x: nx, y: ny, z: nz },
              action: 'remove',
              oldType: neighbor,
              rule: 'fire_spread',
            });
            changes.push({
              position: { x: nx, y: ny, z: nz },
              action: 'place',
              newType: ItemType.FIRE,
              rule: 'fire_spread',
            });
          }
        }
      }
    }
  }

  return changes;
}

/**
 * Create the environment rules object
 */
export function createEnvironmentRules(): EnvironmentRules {
  return {
    grassSpread,
    leafDecay,
    treeGrowth,
    waterFlow,
    fireSpread,
  };
}
