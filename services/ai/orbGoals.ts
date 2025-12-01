/**
 * Orb Goal System
 * Defines behaviors for different goal types and manages goal lifecycle
 */

import {
  Vector3,
  AIGoal,
  AIGoalType,
  AIAction,
  AutonomousOrbState,
  OrbPerceptionData,
  OrbMemory,
  BlockData,
} from '../../types';
import { getPathfinder } from './orbPathfinding';

/** Calculate distance between two points */
function distance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Generate a unique ID */
function generateId(): string {
  return `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Goal behavior interface */
export interface GoalBehavior {
  /** Execute one tick of this goal's behavior */
  tick: (
    state: AutonomousOrbState,
    perception: OrbPerceptionData
  ) => AIAction;

  /** Check if this goal should continue */
  shouldContinue: (
    state: AutonomousOrbState,
    perception: OrbPerceptionData
  ) => boolean;

  /** Called when goal is first activated */
  onActivate?: (state: AutonomousOrbState) => void;

  /** Called when goal is completed or cancelled */
  onDeactivate?: (state: AutonomousOrbState, completed: boolean) => void;
}

/** Goal behavior implementations */
export const GOAL_BEHAVIORS: Record<AIGoalType, GoalBehavior> = {
  [AIGoalType.FOLLOW_PLAYER]: {
    tick: (state, perception) => {
      const playerPos = perception.playerPosition;
      const orbPos = state.position;
      const followDistance = 5; // Stay 5 blocks away

      // Calculate desired position behind/beside player
      const dirToPlayer = {
        x: playerPos.x - orbPos.x,
        y: 0,
        z: playerPos.z - orbPos.z,
      };
      const distToPlayer = Math.sqrt(dirToPlayer.x * dirToPlayer.x + dirToPlayer.z * dirToPlayer.z);

      if (distToPlayer > followDistance + 2) {
        // Too far, move closer
        const targetX = playerPos.x - (dirToPlayer.x / distToPlayer) * followDistance;
        const targetZ = playerPos.z - (dirToPlayer.z / distToPlayer) * followDistance;
        const targetY = playerPos.y + 2; // Float above player height

        return {
          type: 'move',
          target: { x: targetX, y: targetY, z: targetZ },
          speed: 6,
        };
      } else if (distToPlayer < followDistance - 1) {
        // Too close, back off a bit
        const targetX = playerPos.x - (dirToPlayer.x / distToPlayer) * followDistance;
        const targetZ = playerPos.z - (dirToPlayer.z / distToPlayer) * followDistance;
        const targetY = playerPos.y + 2;

        return {
          type: 'move',
          target: { x: targetX, y: targetY, z: targetZ },
          speed: 3,
        };
      }

      // Good distance, just hover
      return { type: 'none' };
    },

    shouldContinue: (state) => {
      return state.activeGoal?.type === AIGoalType.FOLLOW_PLAYER;
    },
  },

  [AIGoalType.EXPLORE]: {
    tick: (state, perception) => {
      const pathfinder = getPathfinder();

      // If we have a target and aren't there yet, keep moving
      if (state.activeGoal?.targetPosition) {
        const dist = distance(state.position, state.activeGoal.targetPosition);
        if (dist > 2) {
          return {
            type: 'move',
            target: state.activeGoal.targetPosition,
            speed: 4,
          };
        }
      }

      // Find a new unexplored direction
      const unexplored = findUnexploredDirection(state.position, state.memory);

      if (unexplored) {
        return {
          type: 'setGoal',
          goal: {
            targetPosition: unexplored,
          },
        };
      }

      // If no unexplored areas, pick a random direction
      const angle = Math.random() * Math.PI * 2;
      const dist = 15 + Math.random() * 15;
      const target: Vector3 = {
        x: state.position.x + Math.cos(angle) * dist,
        y: state.position.y + (Math.random() - 0.5) * 5,
        z: state.position.z + Math.sin(angle) * dist,
      };

      return {
        type: 'move',
        target,
        speed: 4,
      };
    },

    shouldContinue: (state, perception) => {
      // Continue exploring while curiosity is high
      return state.memory.curiosityLevel > 0.3;
    },

    onActivate: (state) => {
      // Boost curiosity when starting exploration
      state.memory.curiosityLevel = Math.min(1, state.memory.curiosityLevel + 0.1);
    },
  },

  [AIGoalType.BUILD]: {
    tick: (state, perception) => {
      const goal = state.activeGoal;
      if (!goal?.targetBlocks || goal.targetBlocks.length === 0) {
        return { type: 'none' };
      }

      // Find next block to place (simple sequential approach)
      const placedIndex = Math.floor(goal.progress * goal.targetBlocks.length);
      if (placedIndex >= goal.targetBlocks.length) {
        return { type: 'none' };
      }

      const nextBlock = goal.targetBlocks[placedIndex];
      const blockPos: Vector3 = { x: nextBlock.x, y: nextBlock.y, z: nextBlock.z };

      // Move close to placement position
      const distToBlock = distance(state.position, blockPos);
      if (distToBlock > 4) {
        return {
          type: 'move',
          target: { x: blockPos.x, y: blockPos.y + 2, z: blockPos.z },
          speed: 5,
        };
      }

      // Place the block
      return {
        type: 'build',
        blocks: [nextBlock],
      };
    },

    shouldContinue: (state) => {
      const goal = state.activeGoal;
      return goal?.progress !== undefined && goal.progress < 1;
    },
  },

  [AIGoalType.GATHER]: {
    tick: (state, perception) => {
      // Find nearest gatherable resource
      const resources = perception.nearbyBlocks.filter((b) =>
        [4, 5, 3].includes(b.type) // Wood, Leaf, Stone
      );

      if (resources.length === 0) {
        // No resources nearby, explore
        return {
          type: 'setGoal',
          goal: {
            type: AIGoalType.EXPLORE,
            description: 'Looking for resources',
            priority: 3,
          },
        };
      }

      const nearest = resources[0];
      const dist = distance(state.position, nearest.position);

      if (dist > 3) {
        return {
          type: 'move',
          target: nearest.position,
          speed: 5,
        };
      }

      // At resource, observe it (would need break tool in full implementation)
      return {
        type: 'observe',
        target: nearest.position,
      };
    },

    shouldContinue: (state) => {
      return state.activeGoal?.status === 'active';
    },
  },

  [AIGoalType.OBSERVE]: {
    tick: (state, perception) => {
      const playerPos = perception.playerPosition;
      const observeDistance = 8;

      // Position ourselves at a comfortable viewing distance
      const dist = perception.playerDistance;

      if (dist < observeDistance - 2) {
        // Too close, back up
        const dir = {
          x: state.position.x - playerPos.x,
          z: state.position.z - playerPos.z,
        };
        const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
        return {
          type: 'move',
          target: {
            x: playerPos.x + (dir.x / len) * observeDistance,
            y: playerPos.y + 3,
            z: playerPos.z + (dir.z / len) * observeDistance,
          },
          speed: 3,
        };
      } else if (dist > observeDistance + 3) {
        // Too far, get closer
        const dir = {
          x: playerPos.x - state.position.x,
          z: playerPos.z - state.position.z,
        };
        const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
        return {
          type: 'move',
          target: {
            x: state.position.x + (dir.x / len) * 5,
            y: playerPos.y + 3,
            z: state.position.z + (dir.z / len) * 5,
          },
          speed: 4,
        };
      }

      // Good position, just observe
      return {
        type: 'observe',
        target: playerPos,
      };
    },

    shouldContinue: (state) => {
      return state.activeGoal?.type === AIGoalType.OBSERVE;
    },
  },

  [AIGoalType.IDLE]: {
    tick: (state, perception) => {
      // Gentle floating behavior with occasional small movements
      if (Math.random() < 0.1) {
        // 10% chance to drift slightly
        const drift: Vector3 = {
          x: state.position.x + (Math.random() - 0.5) * 2,
          y: state.position.y + (Math.random() - 0.5) * 1,
          z: state.position.z + (Math.random() - 0.5) * 2,
        };
        return {
          type: 'move',
          target: drift,
          speed: 1,
        };
      }

      return { type: 'wait', duration: 1000 };
    },

    shouldContinue: () => true, // Idle continues until interrupted
  },

  [AIGoalType.INVESTIGATE]: {
    tick: (state, perception) => {
      const target = state.activeGoal?.targetPosition;
      if (!target) {
        return { type: 'none' };
      }

      const dist = distance(state.position, target);

      if (dist > 3) {
        return {
          type: 'move',
          target: { x: target.x, y: target.y + 2, z: target.z },
          speed: 5,
        };
      }

      // At investigation point, observe
      return {
        type: 'observe',
        target,
      };
    },

    shouldContinue: (state) => {
      if (!state.activeGoal?.targetPosition) return false;
      const dist = distance(state.position, state.activeGoal.targetPosition);
      return dist > 2; // Stop when we reach the target
    },

    onDeactivate: (state, completed) => {
      if (completed) {
        // Mark this location as visited
        const target = state.activeGoal?.targetPosition;
        if (target) {
          const key = `${Math.floor(target.x / 10)},${Math.floor(target.z / 10)}`;
          const existing = state.memory.visitedLocations.get(key);
          state.memory.visitedLocations.set(key, {
            count: (existing?.count || 0) + 1,
            lastVisit: Date.now(),
          });
        }
      }
    },
  },
};

/** Find an unexplored direction based on memory */
function findUnexploredDirection(
  position: Vector3,
  memory: OrbMemory
): Vector3 | null {
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

  let bestTarget: Vector3 | null = null;
  let lowestVisits = Infinity;

  for (const dir of directions) {
    const dist = 20;
    const target: Vector3 = {
      x: position.x + dir.x * dist,
      y: position.y,
      z: position.z + dir.z * dist,
    };

    const key = `${Math.floor(target.x / 10)},${Math.floor(target.z / 10)}`;
    const visits = memory.visitedLocations.get(key)?.count || 0;

    if (visits < lowestVisits) {
      lowestVisits = visits;
      bestTarget = target;
    }
  }

  return bestTarget;
}

/** Create a new goal with defaults */
export function createGoal(params: Partial<AIGoal> & { type: AIGoalType }): AIGoal {
  return {
    id: generateId(),
    type: params.type,
    priority: params.priority ?? 5,
    description: params.description ?? getDefaultDescription(params.type),
    targetPosition: params.targetPosition,
    targetEntityId: params.targetEntityId,
    targetBlocks: params.targetBlocks,
    progress: 0,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: params.expiresAt,
    metadata: params.metadata ?? {},
  };
}

/** Get default description for a goal type */
function getDefaultDescription(type: AIGoalType): string {
  switch (type) {
    case AIGoalType.FOLLOW_PLAYER:
      return 'Following the player';
    case AIGoalType.EXPLORE:
      return 'Exploring the world';
    case AIGoalType.BUILD:
      return 'Building something';
    case AIGoalType.GATHER:
      return 'Gathering resources';
    case AIGoalType.OBSERVE:
      return 'Observing the player';
    case AIGoalType.IDLE:
      return 'Resting peacefully';
    case AIGoalType.INVESTIGATE:
      return 'Investigating something interesting';
    default:
      return 'Unknown goal';
  }
}

/** Evaluate and prioritize goals based on context */
export function evaluateGoals(
  goals: AIGoal[],
  perception: OrbPerceptionData,
  memory: OrbMemory
): AIGoal[] {
  const now = Date.now();

  // Filter out expired and completed goals
  let activeGoals = goals.filter(
    (g) => g.status !== 'completed' && g.status !== 'failed' && (!g.expiresAt || g.expiresAt > now)
  );

  // Adjust priorities based on context
  for (const goal of activeGoals) {
    let priorityAdjust = 0;

    // Boost follow_player if player is moving away
    if (goal.type === AIGoalType.FOLLOW_PLAYER && perception.playerDistance > 15) {
      priorityAdjust += 2;
    }

    // Boost explore if curiosity is high
    if (goal.type === AIGoalType.EXPLORE && memory.curiosityLevel > 0.7) {
      priorityAdjust += 1;
    }

    // Boost observe if player is doing something interesting
    if (goal.type === AIGoalType.OBSERVE && perception.playerVisible) {
      priorityAdjust += 1;
    }

    // Reduce priority of idle when there's interesting stuff nearby
    if (goal.type === AIGoalType.IDLE && perception.terrainFeatures.length > 0) {
      priorityAdjust -= 2;
    }

    goal.priority = Math.max(0, Math.min(10, goal.priority + priorityAdjust));
  }

  // Sort by priority (highest first)
  activeGoals.sort((a, b) => b.priority - a.priority);

  return activeGoals;
}

/** Select default goals when none are active */
export function getDefaultGoals(memory: OrbMemory): AIGoal[] {
  const goals: AIGoal[] = [];

  // Always have idle as fallback
  goals.push(createGoal({
    type: AIGoalType.IDLE,
    priority: 1,
    description: 'Floating peacefully',
  }));

  // Add exploration if curious
  if (memory.curiosityLevel > 0.5) {
    goals.push(createGoal({
      type: AIGoalType.EXPLORE,
      priority: 3,
      description: 'Exploring the world',
    }));
  }

  // Add observation
  goals.push(createGoal({
    type: AIGoalType.OBSERVE,
    priority: 4,
    description: 'Watching the player',
  }));

  return goals;
}
