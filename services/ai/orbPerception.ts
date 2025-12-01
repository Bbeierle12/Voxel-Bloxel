/**
 * Orb Perception System
 * Gathers information about the world around the AI Orb
 */

import {
  Vector3,
  Entity,
  EntityType,
  OrbPerceptionData,
  WorldContext,
  createDefaultPerception,
} from '../../types';
import { getPhysicsSystem } from '../gpuPhysics';

/** Calculate distance between two points */
function distance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Normalize a vector */
function normalize(v: Vector3): Vector3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: -1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Dot product of two vectors */
function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export interface PerceptionConfig {
  perceptionRadius: number;
  blockSampleRate: number; // Sample every N blocks to reduce computation
  maxBlocksToTrack: number;
  lineOfSightChecks: boolean;
}

const DEFAULT_CONFIG: PerceptionConfig = {
  perceptionRadius: 30,
  blockSampleRate: 2, // Check every 2nd block
  maxBlocksToTrack: 100,
  lineOfSightChecks: true,
};

export class OrbPerception {
  private config: PerceptionConfig;
  private physicsSystem = getPhysicsSystem();

  constructor(config: Partial<PerceptionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update perception data based on current world state
   */
  perceive(orbPosition: Vector3, worldContext: WorldContext): OrbPerceptionData {
    const perception = createDefaultPerception();
    perception.lastUpdated = Date.now();

    // Perceive player
    perception.playerPosition = worldContext.playerPosition;
    perception.playerDistance = distance(orbPosition, worldContext.playerPosition);
    perception.playerLookDirection = worldContext.playerLookDirection;
    perception.playerVisible = this.checkLineOfSight(orbPosition, worldContext.playerPosition);
    perception.timeOfDay = worldContext.timeOfDay;

    // Perceive nearby blocks
    perception.nearbyBlocks = this.perceiveBlocks(orbPosition, worldContext);

    // Perceive nearby entities
    perception.nearbyEntities = this.perceiveEntities(orbPosition, worldContext);

    // Analyze terrain features
    perception.terrainFeatures = this.analyzeTerrainFeatures(orbPosition, perception.nearbyBlocks);

    return perception;
  }

  /**
   * Gather information about nearby blocks
   */
  private perceiveBlocks(
    orbPosition: Vector3,
    worldContext: WorldContext
  ): Array<{ position: Vector3; type: number; distance: number }> {
    const blocks = worldContext.getBlocksInArea(orbPosition, this.config.perceptionRadius);

    // Sort by distance and limit
    return blocks
      .map((b) => ({
        position: b.position,
        type: b.type,
        distance: distance(orbPosition, b.position),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.config.maxBlocksToTrack);
  }

  /**
   * Gather information about nearby entities
   */
  private perceiveEntities(
    orbPosition: Vector3,
    worldContext: WorldContext
  ): Array<{ id: string; name: string; type: EntityType; position: Vector3; distance: number }> {
    return worldContext.entities
      .filter((e) => e.type !== EntityType.ORB) // Don't perceive self
      .map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        position: e.position,
        distance: distance(orbPosition, e.position),
      }))
      .filter((e) => e.distance <= this.config.perceptionRadius)
      .sort((a, b) => a.distance - b.distance);
  }

  /**
   * Check line of sight between two points
   */
  checkLineOfSight(from: Vector3, to: Vector3): boolean {
    if (!this.config.lineOfSightChecks) return true;

    const dist = distance(from, to);
    const steps = Math.ceil(dist);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.floor(from.x + (to.x - from.x) * t);
      const y = Math.floor(from.y + (to.y - from.y) * t);
      const z = Math.floor(from.z + (to.z - from.z) * t);

      if (this.physicsSystem.hasBlock(x, y, z)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Analyze nearby blocks to identify terrain features
   */
  private analyzeTerrainFeatures(
    orbPosition: Vector3,
    nearbyBlocks: Array<{ position: Vector3; type: number; distance: number }>
  ): Array<{ type: string; position: Vector3; description: string }> {
    const features: Array<{ type: string; position: Vector3; description: string }> = [];

    // Group blocks by region to identify features
    const blocksByRegion = new Map<string, typeof nearbyBlocks>();

    for (const block of nearbyBlocks) {
      // Round to 5-block regions
      const regionKey = `${Math.floor(block.position.x / 5)},${Math.floor(block.position.z / 5)}`;
      if (!blocksByRegion.has(regionKey)) {
        blocksByRegion.set(regionKey, []);
      }
      blocksByRegion.get(regionKey)!.push(block);
    }

    // Analyze each region
    for (const [_, regionBlocks] of blocksByRegion) {
      if (regionBlocks.length === 0) continue;

      // Calculate average height in this region
      const heights = regionBlocks.map((b) => b.position.y);
      const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
      const maxHeight = Math.max(...heights);
      const minHeight = Math.min(...heights);
      const heightVariation = maxHeight - minHeight;

      // Get center position of region
      const centerX = regionBlocks.reduce((a, b) => a + b.position.x, 0) / regionBlocks.length;
      const centerZ = regionBlocks.reduce((a, b) => a + b.position.z, 0) / regionBlocks.length;
      const centerPos: Vector3 = { x: centerX, y: avgHeight, z: centerZ };

      // Identify feature type based on characteristics
      if (heightVariation > 10) {
        features.push({
          type: 'cliff',
          position: centerPos,
          description: `Steep terrain with ${Math.round(heightVariation)} block height variation`,
        });
      }

      // Check for water (type 8)
      const waterBlocks = regionBlocks.filter((b) => b.type === 8);
      if (waterBlocks.length > 3) {
        features.push({
          type: 'water',
          position: centerPos,
          description: 'Body of water',
        });
      }

      // Check for trees (wood type 4 + leaf type 5)
      const woodBlocks = regionBlocks.filter((b) => b.type === 4);
      const leafBlocks = regionBlocks.filter((b) => b.type === 5);
      if (woodBlocks.length > 0 && leafBlocks.length > 0) {
        features.push({
          type: 'tree',
          position: woodBlocks[0].position,
          description: 'Tree or forest area',
        });
      }

      // Check for flat areas good for building
      if (heightVariation < 2 && regionBlocks.length > 10) {
        features.push({
          type: 'flat_area',
          position: centerPos,
          description: 'Flat area suitable for building',
        });
      }
    }

    // Limit and sort by distance
    return features
      .map((f) => ({ ...f, dist: distance(orbPosition, f.position) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10)
      .map(({ dist, ...f }) => f);
  }

  /**
   * Find unexplored directions based on visited locations
   */
  findUnexploredDirection(
    orbPosition: Vector3,
    visitedLocations: Map<string, { count: number; lastVisit: number }>,
    preferredDistance: number = 20
  ): Vector3 | null {
    // Check 8 cardinal + diagonal directions
    const directions = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
      { x: 1, z: 1 },
      { x: 1, z: -1 },
      { x: -1, z: 1 },
      { x: -1, z: -1 },
    ];

    let bestDirection: Vector3 | null = null;
    let lowestVisitCount = Infinity;
    let oldestVisit = Infinity;

    for (const dir of directions) {
      // Calculate target position
      const target: Vector3 = {
        x: orbPosition.x + dir.x * preferredDistance,
        y: orbPosition.y,
        z: orbPosition.z + dir.z * preferredDistance,
      };

      // Check if this area has been visited
      const regionKey = `${Math.floor(target.x / 10)},${Math.floor(target.z / 10)}`;
      const visited = visitedLocations.get(regionKey);

      if (!visited) {
        // Never visited - high priority
        return target;
      }

      // Prefer less visited and older visits
      if (visited.count < lowestVisitCount ||
          (visited.count === lowestVisitCount && visited.lastVisit < oldestVisit)) {
        lowestVisitCount = visited.count;
        oldestVisit = visited.lastVisit;
        bestDirection = target;
      }
    }

    return bestDirection;
  }

  /**
   * Check if the Orb is near something interesting
   */
  isNearInterestingFeature(perception: OrbPerceptionData): {
    isInteresting: boolean;
    feature?: { type: string; position: Vector3; description: string };
  } {
    if (perception.terrainFeatures.length === 0) {
      return { isInteresting: false };
    }

    // Find closest interesting feature
    const interestingTypes = ['tree', 'water', 'cliff', 'structure'];
    const interesting = perception.terrainFeatures.find((f) =>
      interestingTypes.includes(f.type)
    );

    if (interesting) {
      return { isInteresting: true, feature: interesting };
    }

    return { isInteresting: false };
  }

  /**
   * Check if the player seems to be building something
   */
  detectPlayerBuilding(
    perception: OrbPerceptionData,
    recentPlayerActions: Array<{ timestamp: number; type: string; position?: Vector3 }>
  ): { isBuilding: boolean; buildArea?: Vector3 } {
    // Look for recent block placements
    const recentPlacements = recentPlayerActions.filter(
      (a) => a.type === 'place_block' && Date.now() - a.timestamp < 30000
    );

    if (recentPlacements.length >= 3) {
      // Calculate center of building activity
      const positions = recentPlacements
        .filter((p) => p.position)
        .map((p) => p.position!);

      if (positions.length > 0) {
        const center: Vector3 = {
          x: positions.reduce((a, p) => a + p.x, 0) / positions.length,
          y: positions.reduce((a, p) => a + p.y, 0) / positions.length,
          z: positions.reduce((a, p) => a + p.z, 0) / positions.length,
        };
        return { isBuilding: true, buildArea: center };
      }
    }

    return { isBuilding: false };
  }
}

// Singleton instance
let perceptionInstance: OrbPerception | null = null;

export function getPerception(): OrbPerception {
  if (!perceptionInstance) {
    perceptionInstance = new OrbPerception();
  }
  return perceptionInstance;
}
