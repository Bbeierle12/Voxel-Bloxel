/**
 * WorldMind - The Living World AI
 *
 * An embedded AI that IS the world - perceiving its state,
 * thinking about what should change, and evolving naturally.
 *
 * Architecture:
 * - Perception: Sample blocks around player, understand terrain
 * - Cognition: Decide what environmental changes should occur
 * - Action: Execute block changes through callbacks
 */

import { Vector3, ItemType } from '../../types';
import {
  EnvironmentRules,
  BlockChange,
  WorldPerception,
  createEnvironmentRules
} from './environmentRules';

// Configuration for the WorldMind
export interface WorldMindConfig {
  tickRate: number;              // ms between ticks (default 1000)
  perceptionRadius: number;      // blocks around player to perceive (default 32)
  maxChangesPerTick: number;     // performance cap (default 20)
  rules: {
    grassSpread: boolean;
    leafDecay: boolean;
    treeGrowth: boolean;
    waterFlow: boolean;
    fireSpread: boolean;
  };
}

// What the world remembers
export interface WorldMemory {
  totalGrassSpread: number;
  totalLeavesDecayed: number;
  totalTreesGrown: number;
  regionsVisited: Set<string>;
  lastPlayerPosition: Vector3;
  tickCount: number;
}

// Callbacks for the WorldMind to interact with the game
export interface WorldMindCallbacks {
  getPlayerPosition: () => Vector3;
  getBlockAt: (x: number, y: number, z: number) => number | null;
  getBlocksInArea: (center: Vector3, radius: number) => Array<{ position: Vector3; type: number }>;
  placeBlock: (x: number, y: number, z: number, type: number) => void;
  removeBlock: (x: number, y: number, z: number) => void;
  getTimeOfDay?: () => number; // 0-1, for day/night effects
  onWorldEvent?: (event: WorldEvent) => void;
}

// Events the world can emit
export interface WorldEvent {
  type: 'grass_spread' | 'leaf_decay' | 'tree_grow' | 'sapling_drop' | 'water_flow' | 'fire_spread';
  position: Vector3;
  message?: string;
}

// The state of the WorldMind
export interface WorldMindState {
  isActive: boolean;
  lastTickTime: number;
  perception: WorldPerception | null;
  memory: WorldMemory;
  pendingChanges: BlockChange[];
  config: WorldMindConfig;
}

const DEFAULT_CONFIG: WorldMindConfig = {
  tickRate: 1000,
  perceptionRadius: 32,
  maxChangesPerTick: 20,
  rules: {
    grassSpread: true,
    leafDecay: true,
    treeGrowth: true,   // Saplings grow into trees
    waterFlow: false,   // Phase 3
    fireSpread: false,  // Phase 3
  },
};

export class WorldMind {
  private state: WorldMindState;
  private callbacks: WorldMindCallbacks;
  private rules: EnvironmentRules;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(callbacks: WorldMindCallbacks, config: Partial<WorldMindConfig> = {}) {
    this.callbacks = callbacks;
    this.rules = createEnvironmentRules();

    this.state = {
      isActive: false,
      lastTickTime: 0,
      perception: null,
      memory: {
        totalGrassSpread: 0,
        totalLeavesDecayed: 0,
        totalTreesGrown: 0,
        regionsVisited: new Set(),
        lastPlayerPosition: { x: 0, y: 0, z: 0 },
        tickCount: 0,
      },
      pendingChanges: [],
      config: { ...DEFAULT_CONFIG, ...config },
    };
  }

  /**
   * Start the WorldMind's consciousness
   */
  start(): void {
    if (this.tickInterval) return;

    this.state.isActive = true;
    this.tickInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.tick();
      }
    }, this.state.config.tickRate);

    console.log('[WorldMind] Awakened. Tick rate:', this.state.config.tickRate, 'ms');
  }

  /**
   * Stop the WorldMind
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.state.isActive = false;
    console.log('[WorldMind] Dormant.');
  }

  /**
   * Get current state
   */
  getState(): WorldMindState {
    return { ...this.state };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<WorldMindConfig>): void {
    this.state.config = { ...this.state.config, ...config };

    // Restart if tick rate changed
    if (config.tickRate && this.tickInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Main tick - the world's heartbeat
   */
  private tick(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      this.state.tickCount++;

      // 1. PERCEIVE - What does the world see?
      const perception = this.perceive();
      this.state.perception = perception;

      // 2. THINK - What should change?
      const changes = this.think(perception);

      // 3. ACT - Make it happen
      this.act(changes);

      // 4. REMEMBER - Update memory
      this.remember(perception, changes);

      this.state.lastTickTime = now;
    } catch (error) {
      console.error('[WorldMind] Tick error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * PERCEPTION - The world observes itself
   */
  private perceive(): WorldPerception {
    const playerPos = this.callbacks.getPlayerPosition();
    const radius = this.state.config.perceptionRadius;

    // Get all blocks in perception radius
    const blocks = this.callbacks.getBlocksInArea(playerPos, radius);

    // Categorize blocks by type
    const blocksByType: Map<number, Array<{ position: Vector3; type: number }>> = new Map();

    for (const block of blocks) {
      const existing = blocksByType.get(block.type) || [];
      existing.push(block);
      blocksByType.set(block.type, existing);
    }

    // Extract specific block types we care about
    const grassBlocks = blocksByType.get(ItemType.GRASS) || [];
    const dirtBlocks = blocksByType.get(ItemType.DIRT) || [];
    const leafBlocks = blocksByType.get(ItemType.LEAF) || [];
    const woodBlocks = blocksByType.get(ItemType.WOOD) || [];
    const waterBlocks = blocksByType.get(ItemType.WATER) || [];
    const saplingBlocks = blocksByType.get(ItemType.SAPLING) || [];

    // Get time of day for day/night effects
    const timeOfDay = this.callbacks.getTimeOfDay?.() ?? 0.5;

    return {
      playerPosition: playerPos,
      radius,
      totalBlocks: blocks.length,
      grassBlocks,
      dirtBlocks,
      leafBlocks,
      woodBlocks,
      waterBlocks,
      saplingBlocks,
      allBlocks: blocks,
      timeOfDay,
      timestamp: Date.now(),
    };
  }

  /**
   * COGNITION - The world decides what should change
   */
  private think(perception: WorldPerception): BlockChange[] {
    const changes: BlockChange[] = [];
    const config = this.state.config;

    // Apply grass spread rule
    if (config.rules.grassSpread) {
      const grassChanges = this.rules.grassSpread(
        perception,
        (x, y, z) => this.callbacks.getBlockAt(x, y, z)
      );
      changes.push(...grassChanges);
    }

    // Apply leaf decay rule
    if (config.rules.leafDecay) {
      const decayChanges = this.rules.leafDecay(
        perception,
        (x, y, z) => this.callbacks.getBlockAt(x, y, z)
      );
      changes.push(...decayChanges);
    }

    // Apply tree growth rule
    if (config.rules.treeGrowth) {
      const growthChanges = this.rules.treeGrowth(
        perception,
        (x, y, z) => this.callbacks.getBlockAt(x, y, z)
      );
      changes.push(...growthChanges);
    }

    // TODO Phase 3: Water flow, fire spread

    // Limit changes per tick for performance
    if (changes.length > config.maxChangesPerTick) {
      // Shuffle and take max
      const shuffled = changes.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, config.maxChangesPerTick);
    }

    return changes;
  }

  /**
   * ACTION - The world transforms itself
   */
  private act(changes: BlockChange[]): void {
    for (const change of changes) {
      if (change.action === 'place') {
        this.callbacks.placeBlock(
          change.position.x,
          change.position.y,
          change.position.z,
          change.newType!
        );

        // Emit event
        if (this.callbacks.onWorldEvent) {
          this.callbacks.onWorldEvent({
            type: change.rule as WorldEvent['type'],
            position: change.position,
          });
        }
      } else if (change.action === 'remove') {
        this.callbacks.removeBlock(
          change.position.x,
          change.position.y,
          change.position.z
        );

        // Emit event
        if (this.callbacks.onWorldEvent) {
          this.callbacks.onWorldEvent({
            type: change.rule as WorldEvent['type'],
            position: change.position,
          });
        }
      }
    }

    this.state.pendingChanges = [];
  }

  /**
   * MEMORY - The world remembers what happened
   */
  private remember(perception: WorldPerception, changes: BlockChange[]): void {
    const memory = this.state.memory;

    // Update counters
    for (const change of changes) {
      if (change.rule === 'grass_spread') {
        memory.totalGrassSpread++;
      } else if (change.rule === 'leaf_decay') {
        memory.totalLeavesDecayed++;
      } else if (change.rule === 'tree_grow') {
        memory.totalTreesGrown++;
      }
    }

    // Track regions visited
    const regionKey = `${Math.floor(perception.playerPosition.x / 32)},${Math.floor(perception.playerPosition.z / 32)}`;
    memory.regionsVisited.add(regionKey);

    // Update last player position
    memory.lastPlayerPosition = perception.playerPosition;
    memory.tickCount = this.state.tickCount;
  }

  /**
   * Get statistics about the world's activity
   */
  getStats(): {
    tickCount: number;
    grassSpread: number;
    leavesDecayed: number;
    treesGrown: number;
    regionsExplored: number;
    isActive: boolean;
  } {
    return {
      tickCount: this.state.memory.tickCount,
      grassSpread: this.state.memory.totalGrassSpread,
      leavesDecayed: this.state.memory.totalLeavesDecayed,
      treesGrown: this.state.memory.totalTreesGrown,
      regionsExplored: this.state.memory.regionsVisited.size,
      isActive: this.state.isActive,
    };
  }
}

// Singleton instance
let worldMindInstance: WorldMind | null = null;

export function createWorldMind(
  callbacks: WorldMindCallbacks,
  config?: Partial<WorldMindConfig>
): WorldMind {
  worldMindInstance = new WorldMind(callbacks, config);
  return worldMindInstance;
}

export function getWorldMind(): WorldMind | null {
  return worldMindInstance;
}
