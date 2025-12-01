// ============================================================================
// CORE DATA TYPES
// ============================================================================

export interface BlockData {
  x: number;
  y: number;
  z: number;
  type: number; // 1-6
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface GameStats {
  fps: number;
  blockCount: number;
  entityCount: number;
  x: number;
  y: number;
  z: number;
}

// ============================================================================
// BLOCK & ITEM TYPES
// ============================================================================

export enum ItemType {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  STONE = 3,
  WOOD = 4,
  LEAF = 5,
  PLANK = 6,
  BEDROCK = 7,
  WATER = 8,
  SAND = 9,
  SNOW = 10,
  SAPLING = 11,
  FIRE = 12,
  STICK = 100,
  WOODEN_PICKAXE = 101,
  WOODEN_SWORD = 102,
  STONE_PICKAXE = 103,
  STONE_SWORD = 104,
}

// ============================================================================
// ENTITY SYSTEM
// ============================================================================

export enum EntityType {
  BLOCK = 'block',
  PLAYER = 'player',
  ORB = 'orb',
  CUSTOM = 'custom',
}

export interface PhysicsMaterial {
  mass: number;
  friction: number;
  restitution: number; // bounciness
  isStatic: boolean;
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  velocity: Vector3;
  physics: PhysicsMaterial;
  script: string; // JavaScript code executed each frame
  color: string;
  wireframe: boolean;
  visible: boolean;
  tags: string[];
  parentId?: string; // For hierarchical attachments (e.g., player limbs)
  metadata: Record<string, unknown>;
}

export const createDefaultEntity = (overrides: Partial<Entity> = {}): Entity => ({
  id: `entity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  name: 'New Entity',
  type: EntityType.CUSTOM,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  physics: {
    mass: 1,
    friction: 0.5,
    restitution: 0.3,
    isStatic: false,
  },
  script: '',
  color: '#4a90d9',
  wireframe: false,
  visible: true,
  tags: [],
  metadata: {},
  ...overrides,
});

// ============================================================================
// AI ORB STATE
// ============================================================================

export enum OrbMode {
  IDLE = 'idle',
  THINKING = 'thinking',
  ACTING = 'acting',
  SCANNING = 'scanning',
  LISTENING = 'listening',
  SPEAKING = 'speaking',
  FOLLOWING = 'following',
}

export interface OrbState {
  mode: OrbMode;
  position: Vector3;
  targetPosition?: Vector3;
  thinkingProgress: number; // 0-1 for visual feedback
  currentTask?: string;
  scanRadius: number;
  scanConeAngle: number; // degrees
}

export const createDefaultOrbState = (): OrbState => ({
  mode: OrbMode.IDLE,
  position: { x: 0, y: 5, z: 0 },
  thinkingProgress: 0,
  scanRadius: 20,
  scanConeAngle: 45,
});

// ============================================================================
// AUTONOMOUS AI ORB SYSTEM
// ============================================================================

/** AI Goal types */
export enum AIGoalType {
  FOLLOW_PLAYER = 'follow_player',
  EXPLORE = 'explore',
  BUILD = 'build',
  GATHER = 'gather',
  OBSERVE = 'observe',
  IDLE = 'idle',
  INVESTIGATE = 'investigate',
}

/** Orb mood affects behavior tendencies */
export type OrbMood = 'curious' | 'helpful' | 'playful' | 'contemplative';

/** What the Orb perceives in the world */
export interface OrbPerceptionData {
  nearbyBlocks: Array<{ position: Vector3; type: number; distance: number }>;
  nearbyEntities: Array<{ id: string; name: string; type: EntityType; position: Vector3; distance: number }>;
  playerPosition: Vector3;
  playerDistance: number;
  playerVisible: boolean;
  playerLookDirection: Vector3;
  terrainFeatures: Array<{ type: string; position: Vector3; description: string }>;
  timeOfDay: number;
  lastUpdated: number;
}

/** AI Goal with priority and lifecycle */
export interface AIGoal {
  id: string;
  type: AIGoalType;
  priority: number; // 0-10, higher = more important
  description: string;
  targetPosition?: Vector3;
  targetEntityId?: string;
  targetBlocks?: BlockData[];
  progress: number; // 0-1
  status: 'pending' | 'active' | 'completed' | 'failed' | 'suspended';
  createdAt: number;
  expiresAt?: number;
  metadata: Record<string, unknown>;
}

/** Orb's persistent memory */
export interface OrbMemory {
  visitedLocations: Map<string, { count: number; lastVisit: number }>;
  playerInteractions: Array<{ timestamp: number; type: string; content: string }>;
  learnedPatterns: Array<{ trigger: string; response: string; confidence: number }>;
  curiosityLevel: number; // 0-1
  energyLevel: number; // 0-1
  mood: OrbMood;
}

/** Pathfinding node for A* algorithm */
export interface PathNode {
  position: Vector3;
  g: number; // Cost from start
  h: number; // Heuristic to end
  f: number; // g + h
  parent?: PathNode;
}

/** Autonomous Orb State - extends basic OrbState with autonomy features */
export interface AutonomousOrbState extends OrbState {
  // Autonomy control
  autonomyEnabled: boolean;

  // Perception
  perception: OrbPerceptionData;

  // Goals
  goals: AIGoal[];
  activeGoal?: AIGoal;

  // Movement / Pathfinding
  path: Vector3[];
  pathIndex: number;
  isMoving: boolean;
  movementSpeed: number;

  // Memory & Learning
  memory: OrbMemory;

  // Timing
  lastDecisionTime: number;
  lastPerceptionTime: number;
  behaviorTickRate: number; // ms between AI ticks

  // Communication
  pendingUtterance?: string;
  lastSpokenTime: number;
}

/** World context passed to AI brain for decision making */
export interface WorldContext {
  entities: Entity[];
  playerPosition: Vector3;
  playerLookDirection: Vector3;
  timeOfDay: number;
  physics: WorldPhysics;
  hasBlockAt: (x: number, y: number, z: number) => boolean;
  getBlocksInArea: (center: Vector3, radius: number) => Array<{ position: Vector3; type: number }>;
}

/** Action types the AI can take */
export type AIAction =
  | { type: 'move'; target: Vector3; speed?: number }
  | { type: 'build'; blocks: BlockData[] }
  | { type: 'speak'; message: string }
  | { type: 'observe'; target: Vector3 | string }
  | { type: 'wait'; duration: number }
  | { type: 'setGoal'; goal: Partial<AIGoal> }
  | { type: 'none' };

/** Create default perception data */
export const createDefaultPerception = (): OrbPerceptionData => ({
  nearbyBlocks: [],
  nearbyEntities: [],
  playerPosition: { x: 0, y: 0, z: 0 },
  playerDistance: 0,
  playerVisible: false,
  playerLookDirection: { x: 0, y: 0, z: -1 },
  terrainFeatures: [],
  timeOfDay: 0.25,
  lastUpdated: 0,
});

/** Create default memory */
export const createDefaultMemory = (): OrbMemory => ({
  visitedLocations: new Map(),
  playerInteractions: [],
  learnedPatterns: [],
  curiosityLevel: 0.7,
  energyLevel: 1.0,
  mood: 'curious',
});

/** Create default autonomous orb state */
export const createDefaultAutonomousOrbState = (): AutonomousOrbState => ({
  ...createDefaultOrbState(),
  autonomyEnabled: true,
  perception: createDefaultPerception(),
  goals: [],
  activeGoal: undefined,
  path: [],
  pathIndex: 0,
  isMoving: false,
  movementSpeed: 5,
  memory: createDefaultMemory(),
  lastDecisionTime: 0,
  lastPerceptionTime: 0,
  behaviorTickRate: 500, // 500ms between AI decisions
  pendingUtterance: undefined,
  lastSpokenTime: 0,
});

// ============================================================================
// AGENT WORKFLOW SYSTEM
// ============================================================================

export enum AgentPhase {
  IDLE = 'idle',
  PLANNING = 'planning',
  EXECUTING = 'executing',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export enum AgentStepStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export interface AgentStep {
  id: string;
  action: string; // Tool name to invoke
  parameters: Record<string, unknown>;
  description: string;
  status: AgentStepStatus;
  result?: unknown;
  error?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  icon: string;
  category: string;
  createdAt: number;
}

export interface AgentWorkflow {
  phase: AgentPhase;
  goal: string;
  steps: AgentStep[];
  currentStepIndex: number;
  startedAt?: number;
  completedAt?: number;
  skills: Skill[];
}

export const createDefaultAgentWorkflow = (): AgentWorkflow => ({
  phase: AgentPhase.IDLE,
  goal: '',
  steps: [],
  currentStepIndex: -1,
  skills: [],
});

// ============================================================================
// WORLD STATE
// ============================================================================

export interface WorldPhysics {
  gravity: number;
  timeScale: number;
  airResistance: number;
}

export interface WorldState {
  physics: WorldPhysics;
  entities: Entity[];
  selectedEntityId?: string;
  timeOfDay: number; // 0-1 (0 = midnight, 0.5 = noon)
  dayDuration: number; // seconds for full cycle
}

export const createDefaultWorldState = (): WorldState => ({
  physics: {
    gravity: 32,
    timeScale: 1,
    airResistance: 0.02,
  },
  entities: [],
  timeOfDay: 0.25, // morning
  dayDuration: 120,
});

// ============================================================================
// SYSTEM STATE (DevOps Roleplay)
// ============================================================================

export enum SecurityStatus {
  SECURE = 'secure',
  WARNING = 'warning',
  BREACH = 'breach',
}

export interface SystemState {
  repoVersion: string;
  lastDeployment: number;
  securityStatus: SecurityStatus;
  serverLoad: number; // 0-100
  activeConnections: number;
  logs: SystemLog[];
}

export interface SystemLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'system' | 'ai';
  message: string;
  source: string;
  data?: Record<string, unknown>;
}

export const createDefaultSystemState = (): SystemState => ({
  repoVersion: '1.0.0',
  lastDeployment: Date.now(),
  securityStatus: SecurityStatus.SECURE,
  serverLoad: 15,
  activeConnections: 1,
  logs: [],
});

// ============================================================================
// AI RESPONSES
// ============================================================================

export interface AiResponse {
  message: string;
  blocks?: BlockData[];
  thinking?: string; // Thinking process from Gemini Thinking Mode
  groundingSources?: GroundingSource[];
}

export interface GroundingSource {
  title: string;
  url: string;
  snippet: string;
}

export interface AgentPlanResponse {
  goal: string;
  steps: Omit<AgentStep, 'status' | 'result' | 'error'>[];
  reasoning: string;
}

// ============================================================================
// CHAT SYSTEM
// ============================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  thinking?: string;
  groundingSources?: GroundingSource[];
  isStreaming?: boolean;
}

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

export const AI_TOOLS: ToolDefinition[] = [
  {
    name: 'spawnEntity',
    description: 'Spawn a new entity in the world at the specified position',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the entity' },
        type: { type: 'string', description: 'Entity type', enum: ['block', 'custom'] },
        x: { type: 'number', description: 'X position' },
        y: { type: 'number', description: 'Y position' },
        z: { type: 'number', description: 'Z position' },
        color: { type: 'string', description: 'Hex color for the entity' },
        script: { type: 'string', description: 'JavaScript behavior script' },
      },
      required: ['name', 'x', 'y', 'z'],
    },
  },
  {
    name: 'setGravity',
    description: 'Set the world gravity value',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Gravity value (default is 32)' },
      },
      required: ['value'],
    },
  },
  {
    name: 'scanEnvironment',
    description: 'Scan the environment around the orb to gather information about nearby entities',
    parameters: {
      type: 'object',
      properties: {
        radius: { type: 'number', description: 'Scan radius in blocks' },
      },
      required: ['radius'],
    },
  },
  {
    name: 'systemOperation',
    description: 'Perform a system operation for the DevOps roleplay',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Operation type', enum: ['deploy', 'rollback', 'scan', 'report'] },
        target: { type: 'string', description: 'Target of the operation' },
      },
      required: ['operation'],
    },
  },
  {
    name: 'modifyEntity',
    description: 'Modify properties of an existing entity',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'ID of the entity to modify' },
        position: { type: 'string', description: 'New position as "x,y,z"' },
        color: { type: 'string', description: 'New hex color' },
        script: { type: 'string', description: 'New behavior script' },
        visible: { type: 'boolean', description: 'Entity visibility' },
      },
      required: ['entityId'],
    },
  },
  {
    name: 'deleteEntity',
    description: 'Delete an entity from the world',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'ID of the entity to delete' },
      },
      required: ['entityId'],
    },
  },
];

// ============================================================================
// GAME ENGINE INTERFACE
// ============================================================================

export interface RaycastResult {
  hit: boolean;
  point: Vector3;           // World position of hit
  blockPosition: Vector3;   // Integer block coords
  normal: Vector3;          // Surface normal
  distance: number;
  isGround: boolean;
}

export interface GameEngineRef {
  // Existing methods
  placeBlocks: (blocks: BlockData[]) => void;  // Relative to player (5 units forward)
  getPlayerPosition: () => Vector3;
  getOrbPosition: () => Vector3;
  moveOrb: (x: number, y: number, z: number) => void;
  requestLock: () => void;

  // NEW: Spatial context
  getLookDirection: () => Vector3;
  raycast: (maxDistance?: number) => RaycastResult | null;  // Screen center raycast

  // NEW: Block operations
  placeBlocksAbsolute: (blocks: BlockData[]) => void;  // Absolute world coords
  removeBlockAt: (x: number, y: number, z: number) => boolean;
  getBlockAt: (x: number, y: number, z: number) => number | null;
  getBlocksInArea: (center: Vector3, radius: number) => Array<{ position: Vector3; type: number }>;
  clearArea: (start: Vector3, end: Vector3) => number;
}

// ============================================================================
// INVENTORY & CRAFTING
// ============================================================================

export type Inventory = Record<number, number>;

export interface Recipe {
  id: string;
  name: string;
  result: ItemType;
  resultCount: number;
  ingredients: { type: ItemType; count: number }[];
}

export const RECIPES: Recipe[] = [
  {
    id: 'planks',
    name: 'Wood Planks',
    result: ItemType.PLANK,
    resultCount: 4,
    ingredients: [{ type: ItemType.WOOD, count: 1 }],
  },
  {
    id: 'sticks',
    name: 'Sticks',
    result: ItemType.STICK,
    resultCount: 4,
    ingredients: [{ type: ItemType.PLANK, count: 2 }],
  },
  {
    id: 'wooden_pickaxe',
    name: 'Wooden Pickaxe',
    result: ItemType.WOODEN_PICKAXE,
    resultCount: 1,
    ingredients: [
      { type: ItemType.PLANK, count: 3 },
      { type: ItemType.STICK, count: 2 },
    ],
  },
  {
    id: 'wooden_sword',
    name: 'Wooden Sword',
    result: ItemType.WOODEN_SWORD,
    resultCount: 1,
    ingredients: [
      { type: ItemType.PLANK, count: 2 },
      { type: ItemType.STICK, count: 1 },
    ],
  },
  {
    id: 'stone_pickaxe',
    name: 'Stone Pickaxe',
    result: ItemType.STONE_PICKAXE,
    resultCount: 1,
    ingredients: [
      { type: ItemType.STONE, count: 3 },
      { type: ItemType.STICK, count: 2 },
    ],
  },
  {
    id: 'stone_sword',
    name: 'Stone Sword',
    result: ItemType.STONE_SWORD,
    resultCount: 1,
    ingredients: [
      { type: ItemType.STONE, count: 2 },
      { type: ItemType.STICK, count: 1 },
    ],
  },
];

// ============================================================================
// UI STATE
// ============================================================================

export type SidebarTab = 'chat' | 'agent' | 'inspector' | 'behavior';

export interface UIState {
  showStartScreen: boolean;
  showInventory: boolean;
  showChat: boolean;
  sidebarTab: SidebarTab;
  consoleFilter: SystemLog['level'] | 'all';
  isPointerLocked: boolean;
}