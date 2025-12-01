/**
 * A* Pathfinding for the AI Orb in a 3D voxel world
 * The Orb can fly, so only solid blocks are obstacles
 */

import { Vector3, PathNode } from '../../types';
import { getPhysicsSystem } from '../gpuPhysics';

/** Priority queue for A* open set */
class PriorityQueue<T> {
  private heap: { item: T; priority: number }[] = [];

  enqueue(item: T, priority: number): void {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.heap[0].item;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.heap[parent].priority <= this.heap[index].priority) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (left < length && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < length && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === index) break;

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}

/** Convert Vector3 to string key for map lookups */
function posKey(pos: Vector3): string {
  return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

/** Calculate Manhattan distance heuristic (3D) */
function heuristic(a: Vector3, b: Vector3): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

/** Calculate Euclidean distance */
function distance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 3D neighbors - 26 directions (all adjacent cubes including diagonals) */
const NEIGHBORS_3D: Vector3[] = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        NEIGHBORS_3D.push({ x: dx, y: dy, z: dz });
      }
    }
  }
}

/** 6-direction neighbors (cardinal only, no diagonals) - faster but less smooth paths */
const NEIGHBORS_CARDINAL: Vector3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export interface PathfindingOptions {
  maxIterations?: number;
  allowDiagonals?: boolean;
  smoothPath?: boolean;
  flyingMode?: boolean; // If true, ignores Y constraints
}

const DEFAULT_OPTIONS: PathfindingOptions = {
  maxIterations: 2000,
  allowDiagonals: true,
  smoothPath: true,
  flyingMode: true,
};

export class OrbPathfinder {
  private physicsSystem = getPhysicsSystem();

  /**
   * Check if a position is traversable (Orb can fly through it)
   */
  isTraversable(x: number, y: number, z: number): boolean {
    // Check if there's a solid block at this position
    const hasBlock = this.physicsSystem.hasBlock(
      Math.floor(x),
      Math.floor(y),
      Math.floor(z)
    );
    return !hasBlock;
  }

  /**
   * Check if a position is within world bounds
   */
  isInBounds(x: number, y: number, z: number): boolean {
    // World bounds: X/Z -128 to 128, Y -32 to 32
    return x >= -128 && x < 128 && y >= -32 && y < 32 && z >= -128 && z < 128;
  }

  /**
   * Find a path from start to end using A* algorithm
   * Returns array of waypoints, or empty array if no path found
   */
  findPath(start: Vector3, end: Vector3, options: PathfindingOptions = {}): Vector3[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const neighbors = opts.allowDiagonals ? NEIGHBORS_3D : NEIGHBORS_CARDINAL;

    // Round positions to grid
    const startGrid: Vector3 = {
      x: Math.floor(start.x),
      y: Math.floor(start.y),
      z: Math.floor(start.z),
    };
    const endGrid: Vector3 = {
      x: Math.floor(end.x),
      y: Math.floor(end.y),
      z: Math.floor(end.z),
    };

    // Quick check: if start or end is blocked, fail fast
    if (!this.isTraversable(startGrid.x, startGrid.y, startGrid.z)) {
      console.warn('Pathfinding: Start position is blocked');
      return [];
    }
    if (!this.isTraversable(endGrid.x, endGrid.y, endGrid.z)) {
      console.warn('Pathfinding: End position is blocked');
      return [];
    }

    // A* algorithm
    const openSet = new PriorityQueue<PathNode>();
    const closedSet = new Set<string>();
    const gScores = new Map<string, number>();
    const nodeMap = new Map<string, PathNode>();

    const startNode: PathNode = {
      position: startGrid,
      g: 0,
      h: heuristic(startGrid, endGrid),
      f: heuristic(startGrid, endGrid),
    };

    openSet.enqueue(startNode, startNode.f);
    gScores.set(posKey(startGrid), 0);
    nodeMap.set(posKey(startGrid), startNode);

    let iterations = 0;

    while (!openSet.isEmpty() && iterations < opts.maxIterations!) {
      iterations++;
      const current = openSet.dequeue()!;
      const currentKey = posKey(current.position);

      // Check if we reached the goal
      if (
        current.position.x === endGrid.x &&
        current.position.y === endGrid.y &&
        current.position.z === endGrid.z
      ) {
        // Reconstruct path
        const path = this.reconstructPath(current);
        return opts.smoothPath ? this.smoothPath(path) : path;
      }

      closedSet.add(currentKey);

      // Explore neighbors
      for (const dir of neighbors) {
        const neighborPos: Vector3 = {
          x: current.position.x + dir.x,
          y: current.position.y + dir.y,
          z: current.position.z + dir.z,
        };
        const neighborKey = posKey(neighborPos);

        // Skip if already evaluated
        if (closedSet.has(neighborKey)) continue;

        // Skip if out of bounds
        if (!this.isInBounds(neighborPos.x, neighborPos.y, neighborPos.z)) continue;

        // Skip if not traversable
        if (!this.isTraversable(neighborPos.x, neighborPos.y, neighborPos.z)) continue;

        // For diagonal moves, check that we can actually move diagonally
        // (no corner cutting through solid blocks)
        if (opts.allowDiagonals && (dir.x !== 0 || dir.z !== 0) && (dir.x !== 0 || dir.y !== 0) && (dir.y !== 0 || dir.z !== 0)) {
          // Check edge blocks for diagonal movement
          if (
            !this.isTraversable(current.position.x + dir.x, current.position.y, current.position.z) ||
            !this.isTraversable(current.position.x, current.position.y + dir.y, current.position.z) ||
            !this.isTraversable(current.position.x, current.position.y, current.position.z + dir.z)
          ) {
            continue; // Can't cut corners
          }
        }

        // Calculate movement cost (diagonal moves cost more)
        const moveCost = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        const tentativeG = current.g + moveCost;

        const existingG = gScores.get(neighborKey);
        if (existingG !== undefined && tentativeG >= existingG) continue;

        // This path is better
        const neighborNode: PathNode = {
          position: neighborPos,
          g: tentativeG,
          h: heuristic(neighborPos, endGrid),
          f: tentativeG + heuristic(neighborPos, endGrid),
          parent: current,
        };

        gScores.set(neighborKey, tentativeG);
        nodeMap.set(neighborKey, neighborNode);
        openSet.enqueue(neighborNode, neighborNode.f);
      }
    }

    // No path found
    console.warn(`Pathfinding: No path found after ${iterations} iterations`);
    return [];
  }

  /**
   * Reconstruct path from end node to start
   */
  private reconstructPath(endNode: PathNode): Vector3[] {
    const path: Vector3[] = [];
    let current: PathNode | undefined = endNode;

    while (current) {
      // Add 0.5 to center the position in the block
      path.unshift({
        x: current.position.x + 0.5,
        y: current.position.y + 0.5,
        z: current.position.z + 0.5,
      });
      current = current.parent;
    }

    return path;
  }

  /**
   * Smooth path by removing unnecessary waypoints using line-of-sight checks
   */
  smoothPath(path: Vector3[]): Vector3[] {
    if (path.length <= 2) return path;

    const smoothed: Vector3[] = [path[0]];
    let currentIndex = 0;

    while (currentIndex < path.length - 1) {
      // Find the furthest point we can see from current
      let furthest = currentIndex + 1;

      for (let i = path.length - 1; i > currentIndex + 1; i--) {
        if (this.hasLineOfSight(path[currentIndex], path[i])) {
          furthest = i;
          break;
        }
      }

      smoothed.push(path[furthest]);
      currentIndex = furthest;
    }

    return smoothed;
  }

  /**
   * Check if there's a clear line of sight between two points
   */
  hasLineOfSight(from: Vector3, to: Vector3): boolean {
    const dist = distance(from, to);
    const steps = Math.ceil(dist * 2); // Check every 0.5 units

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;

      if (!this.isTraversable(x, y, z)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Find the nearest traversable position to a blocked target
   */
  findNearestTraversable(target: Vector3, searchRadius: number = 5): Vector3 | null {
    const tx = Math.floor(target.x);
    const ty = Math.floor(target.y);
    const tz = Math.floor(target.z);

    // If target is already traversable, return it
    if (this.isTraversable(tx, ty, tz)) {
      return { x: tx + 0.5, y: ty + 0.5, z: tz + 0.5 };
    }

    // Search in expanding shells
    for (let r = 1; r <= searchRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            // Only check shell (not interior)
            if (Math.abs(dx) === r || Math.abs(dy) === r || Math.abs(dz) === r) {
              const x = tx + dx;
              const y = ty + dy;
              const z = tz + dz;

              if (this.isInBounds(x, y, z) && this.isTraversable(x, y, z)) {
                return { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if the current path is still valid (no new obstacles)
   */
  isPathValid(path: Vector3[]): boolean {
    for (const point of path) {
      if (!this.isTraversable(point.x, point.y, point.z)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get distance along a path
   */
  getPathLength(path: Vector3[]): number {
    let length = 0;
    for (let i = 1; i < path.length; i++) {
      length += distance(path[i - 1], path[i]);
    }
    return length;
  }
}

// Singleton instance
let pathfinderInstance: OrbPathfinder | null = null;

export function getPathfinder(): OrbPathfinder {
  if (!pathfinderInstance) {
    pathfinderInstance = new OrbPathfinder();
  }
  return pathfinderInstance;
}
