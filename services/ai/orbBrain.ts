/**
 * Orb Brain - Core autonomous behavior system
 * Implements the Perception → Decision → Action loop
 */

import {
  Vector3,
  AIGoal,
  AIGoalType,
  AIAction,
  AutonomousOrbState,
  WorldContext,
  OrbMode,
  createDefaultAutonomousOrbState,
  createDefaultPerception,
} from '../../types';
import { getPathfinder, OrbPathfinder } from './orbPathfinding';
import { getPerception, OrbPerception } from './orbPerception';
import { GOAL_BEHAVIORS, evaluateGoals, getDefaultGoals, createGoal } from './orbGoals';

/** Calculate distance between two points */
function distance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export interface OrbBrainCallbacks {
  /** Called when the Orb wants to execute a tool (build, etc.) */
  onToolExecute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Called when the Orb wants to speak */
  onSpeak: (message: string) => void;
  /** Called when the Orb state changes */
  onStateChange: (state: AutonomousOrbState) => void;
  /** Get current world context */
  getWorldContext: () => WorldContext;
}

export class OrbBrain {
  private state: AutonomousOrbState;
  private callbacks: OrbBrainCallbacks;
  private pathfinder: OrbPathfinder;
  private perception: OrbPerception;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(callbacks: OrbBrainCallbacks, initialState?: Partial<AutonomousOrbState>) {
    this.state = {
      ...createDefaultAutonomousOrbState(),
      ...initialState,
    };
    this.callbacks = callbacks;
    this.pathfinder = getPathfinder();
    this.perception = getPerception();
  }

  /**
   * Start the autonomous behavior loop
   */
  start(): void {
    if (this.tickInterval) return;

    this.tickInterval = setInterval(() => {
      if (this.state.autonomyEnabled && !this.isProcessing) {
        this.tick();
      }
    }, this.state.behaviorTickRate);

    console.log('OrbBrain started with tick rate:', this.state.behaviorTickRate, 'ms');
  }

  /**
   * Stop the autonomous behavior loop
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    console.log('OrbBrain stopped');
  }

  /**
   * Enable or disable autonomy
   */
  setAutonomy(enabled: boolean): void {
    this.state.autonomyEnabled = enabled;
    if (!enabled) {
      // Clear current path when disabling
      this.state.path = [];
      this.state.isMoving = false;
    }
    this.notifyStateChange();
  }

  /**
   * Get current state
   */
  getState(): AutonomousOrbState {
    return { ...this.state };
  }

  /**
   * Update position (called externally from animation loop)
   */
  updatePosition(position: Vector3): void {
    this.state.position = position;
  }

  /**
   * Add a goal to the Orb's goal list
   */
  addGoal(goalParams: Partial<AIGoal> & { type: AIGoalType }): AIGoal {
    const goal = createGoal(goalParams);
    this.state.goals.push(goal);
    this.notifyStateChange();
    return goal;
  }

  /**
   * Remove a goal by ID
   */
  removeGoal(goalId: string): void {
    this.state.goals = this.state.goals.filter((g) => g.id !== goalId);
    if (this.state.activeGoal?.id === goalId) {
      this.state.activeGoal = undefined;
    }
    this.notifyStateChange();
  }

  /**
   * Clear all goals
   */
  clearGoals(): void {
    this.state.goals = [];
    this.state.activeGoal = undefined;
    this.state.path = [];
    this.state.isMoving = false;
    this.notifyStateChange();
  }

  /**
   * Main tick function - runs the perception → decision → action loop
   */
  private async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();

      // 1. PERCEIVE - Update perception
      await this.updatePerception();

      // 2. EVALUATE - Check and prioritize goals
      this.evaluateGoals();

      // 3. DECIDE - Select action based on active goal
      const action = this.selectAction();

      // 4. ACT - Execute the chosen action
      await this.executeAction(action);

      // 5. LEARN - Update memory and internal state
      this.updateInternalState();

      // Update timing
      this.state.lastDecisionTime = now;
      this.notifyStateChange();
    } catch (error) {
      console.error('OrbBrain tick error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Update perception data
   */
  private async updatePerception(): Promise<void> {
    const worldContext = this.callbacks.getWorldContext();
    this.state.perception = this.perception.perceive(this.state.position, worldContext);
    this.state.lastPerceptionTime = Date.now();
  }

  /**
   * Evaluate and prioritize goals
   */
  private evaluateGoals(): void {
    // Add default goals if none exist
    if (this.state.goals.length === 0) {
      this.state.goals = getDefaultGoals(this.state.memory);
    }

    // Evaluate and sort goals
    this.state.goals = evaluateGoals(
      this.state.goals,
      this.state.perception,
      this.state.memory
    );

    // Select highest priority actionable goal
    const newActiveGoal = this.state.goals.find(
      (g) => g.status === 'pending' || g.status === 'active'
    );

    // Handle goal transitions
    if (newActiveGoal && newActiveGoal.id !== this.state.activeGoal?.id) {
      // Deactivate old goal
      if (this.state.activeGoal) {
        const oldBehavior = GOAL_BEHAVIORS[this.state.activeGoal.type];
        oldBehavior.onDeactivate?.(this.state, false);
      }

      // Activate new goal
      this.state.activeGoal = newActiveGoal;
      this.state.activeGoal.status = 'active';

      const newBehavior = GOAL_BEHAVIORS[newActiveGoal.type];
      newBehavior.onActivate?.(this.state);

      // Update mode based on goal
      this.state.mode = this.getModeForGoal(newActiveGoal.type);
    }
  }

  /**
   * Select action based on active goal
   */
  private selectAction(): AIAction {
    if (!this.state.activeGoal) {
      return { type: 'none' };
    }

    const behavior = GOAL_BEHAVIORS[this.state.activeGoal.type];
    if (!behavior) {
      return { type: 'none' };
    }

    // Check if goal should continue
    if (!behavior.shouldContinue(this.state, this.state.perception)) {
      this.state.activeGoal.status = 'completed';
      this.state.activeGoal.progress = 1;
      behavior.onDeactivate?.(this.state, true);
      return { type: 'none' };
    }

    // Get action from behavior
    return behavior.tick(this.state, this.state.perception);
  }

  /**
   * Execute the chosen action
   */
  private async executeAction(action: AIAction): Promise<void> {
    switch (action.type) {
      case 'move':
        await this.handleMoveAction(action.target, action.speed);
        break;

      case 'build':
        await this.handleBuildAction(action.blocks);
        break;

      case 'speak':
        this.handleSpeakAction(action.message);
        break;

      case 'observe':
        this.handleObserveAction(action.target);
        break;

      case 'wait':
        // Just wait, do nothing
        break;

      case 'setGoal':
        this.handleSetGoalAction(action.goal);
        break;

      case 'none':
      default:
        break;
    }
  }

  /**
   * Handle move action - plan path and start moving
   */
  private async handleMoveAction(target: Vector3, speed?: number): Promise<void> {
    // Only replan if target changed significantly
    const currentTarget = this.state.path[this.state.path.length - 1];
    if (!currentTarget || distance(currentTarget, target) > 2) {
      // Plan new path
      const path = this.pathfinder.findPath(this.state.position, target);
      if (path.length > 0) {
        this.state.path = path;
        this.state.pathIndex = 0;
        this.state.isMoving = true;
        this.state.movementSpeed = speed || 5;
      } else {
        // No path found, try to move directly if close
        if (distance(this.state.position, target) < 10) {
          this.state.path = [target];
          this.state.pathIndex = 0;
          this.state.isMoving = true;
          this.state.movementSpeed = speed || 5;
        }
      }
    }

    this.state.mode = OrbMode.ACTING;
  }

  /**
   * Handle build action - place blocks
   */
  private async handleBuildAction(blocks: { x: number; y: number; z: number; type: number }[]): Promise<void> {
    this.state.mode = OrbMode.ACTING;

    try {
      await this.callbacks.onToolExecute('placeBlocksAbsolute', { blocks });

      // Update goal progress
      if (this.state.activeGoal?.targetBlocks) {
        const total = this.state.activeGoal.targetBlocks.length;
        const placed = Math.floor(this.state.activeGoal.progress * total) + blocks.length;
        this.state.activeGoal.progress = Math.min(1, placed / total);
      }
    } catch (error) {
      console.error('Build action failed:', error);
    }
  }

  /**
   * Handle speak action
   */
  private handleSpeakAction(message: string): void {
    this.state.mode = OrbMode.SPEAKING;
    this.state.pendingUtterance = message;
    this.state.lastSpokenTime = Date.now();
    this.callbacks.onSpeak(message);
  }

  /**
   * Handle observe action
   */
  private handleObserveAction(target: Vector3 | string): void {
    this.state.mode = OrbMode.SCANNING;

    if (typeof target !== 'string') {
      this.state.targetPosition = target;
    }
  }

  /**
   * Handle set goal action
   */
  private handleSetGoalAction(goalParams: Partial<AIGoal>): void {
    if (this.state.activeGoal && goalParams) {
      // Update existing active goal
      Object.assign(this.state.activeGoal, goalParams);
    }
  }

  /**
   * Update internal state (memory, mood, energy)
   */
  private updateInternalState(): void {
    const now = Date.now();

    // Update visited locations
    const currentRegion = `${Math.floor(this.state.position.x / 10)},${Math.floor(this.state.position.z / 10)}`;
    const existing = this.state.memory.visitedLocations.get(currentRegion);
    this.state.memory.visitedLocations.set(currentRegion, {
      count: (existing?.count || 0) + 1,
      lastVisit: now,
    });

    // Gradually adjust curiosity based on exploration
    if (this.state.activeGoal?.type === AIGoalType.EXPLORE) {
      // Curiosity decreases slowly while exploring
      this.state.memory.curiosityLevel = Math.max(
        0.1,
        this.state.memory.curiosityLevel - 0.01
      );
    } else {
      // Curiosity increases when not exploring
      this.state.memory.curiosityLevel = Math.min(
        1,
        this.state.memory.curiosityLevel + 0.005
      );
    }

    // Update mood based on activity
    if (this.state.perception.playerDistance < 10) {
      this.state.memory.mood = 'helpful';
    } else if (this.state.memory.curiosityLevel > 0.7) {
      this.state.memory.mood = 'curious';
    } else if (this.state.activeGoal?.type === AIGoalType.IDLE) {
      this.state.memory.mood = 'contemplative';
    }

    // Reset mode to idle if no active actions
    if (!this.state.isMoving && this.state.mode !== OrbMode.SPEAKING) {
      this.state.mode = OrbMode.IDLE;
    }
  }

  /**
   * Get appropriate orb mode for a goal type
   */
  private getModeForGoal(goalType: AIGoalType): OrbMode {
    switch (goalType) {
      case AIGoalType.FOLLOW_PLAYER:
        return OrbMode.FOLLOWING;
      case AIGoalType.EXPLORE:
      case AIGoalType.INVESTIGATE:
        return OrbMode.SCANNING;
      case AIGoalType.BUILD:
      case AIGoalType.GATHER:
        return OrbMode.ACTING;
      case AIGoalType.OBSERVE:
        return OrbMode.SCANNING;
      case AIGoalType.IDLE:
      default:
        return OrbMode.IDLE;
    }
  }

  /**
   * Notify callbacks of state change
   */
  private notifyStateChange(): void {
    this.callbacks.onStateChange({ ...this.state });
  }

  /**
   * Handle external events (player actions, etc.)
   */
  onPlayerAction(action: { type: string; position?: Vector3; data?: unknown }): void {
    // Record interaction
    this.state.memory.playerInteractions.push({
      timestamp: Date.now(),
      type: action.type,
      content: JSON.stringify(action),
    });

    // Keep only last 50 interactions
    if (this.state.memory.playerInteractions.length > 50) {
      this.state.memory.playerInteractions = this.state.memory.playerInteractions.slice(-50);
    }

    // React to certain player actions
    if (action.type === 'place_block' && this.state.perception.playerDistance < 20) {
      // Player is building nearby, become helpful
      if (!this.state.goals.some((g) => g.type === AIGoalType.OBSERVE)) {
        this.addGoal({
          type: AIGoalType.OBSERVE,
          priority: 6,
          description: 'Watching player build',
          expiresAt: Date.now() + 60000, // 1 minute
        });
      }
    }
  }

  /**
   * Move toward next waypoint (called from animation loop)
   * Returns new position and whether still moving
   */
  moveAlongPath(deltaTime: number): { position: Vector3; stillMoving: boolean } {
    if (!this.state.isMoving || this.state.path.length === 0) {
      return { position: this.state.position, stillMoving: false };
    }

    const target = this.state.path[this.state.pathIndex];
    if (!target) {
      this.state.isMoving = false;
      return { position: this.state.position, stillMoving: false };
    }

    const dist = distance(this.state.position, target);
    const moveAmount = this.state.movementSpeed * deltaTime;

    if (dist <= moveAmount) {
      // Reached waypoint
      this.state.position = { ...target };
      this.state.pathIndex++;

      if (this.state.pathIndex >= this.state.path.length) {
        // Reached end of path
        this.state.isMoving = false;
        this.state.path = [];
        return { position: this.state.position, stillMoving: false };
      }
    } else {
      // Move toward waypoint
      const dir = {
        x: (target.x - this.state.position.x) / dist,
        y: (target.y - this.state.position.y) / dist,
        z: (target.z - this.state.position.z) / dist,
      };

      this.state.position = {
        x: this.state.position.x + dir.x * moveAmount,
        y: this.state.position.y + dir.y * moveAmount,
        z: this.state.position.z + dir.z * moveAmount,
      };
    }

    return { position: this.state.position, stillMoving: true };
  }
}

// Singleton instance
let brainInstance: OrbBrain | null = null;

export function createOrbBrain(
  callbacks: OrbBrainCallbacks,
  initialState?: Partial<AutonomousOrbState>
): OrbBrain {
  brainInstance = new OrbBrain(callbacks, initialState);
  return brainInstance;
}

export function getOrbBrain(): OrbBrain | null {
  return brainInstance;
}
