import React, { useState, useRef, useCallback, useEffect } from 'react';
import VoxelEngine from './components/VoxelEngine';
import UIOverlay from './components/UIOverlay';
import {
  GameStats,
  GameEngineRef,
  BlockData,
  Inventory,
  ItemType,
  Recipe,
  Entity,
  EntityType,
  WorldState,
  OrbState,
  OrbMode,
  AutonomousOrbState,
  AIGoalType,
  WorldContext,
  AgentWorkflow,
  AgentPhase,
  AgentStep,
  AgentStepStatus,
  Skill,
  SystemState,
  SystemLog,
  ChatMessage,
  SidebarTab,
  Vector3,
  createDefaultEntity,
  createDefaultWorldState,
  createDefaultAutonomousOrbState,
  createDefaultAgentWorkflow,
  createDefaultSystemState,
} from './types';
import { createOrbBrain, OrbBrain, OrbBrainCallbacks } from './services/ai/orbBrain';
import { createWorldMind, WorldMind, WorldMindCallbacks } from './services/ai/worldMind';
import { generateAgentPlan, chatWithTools, generateBehaviorScript } from './services/geminiService';
import { logInfo, logSystem, logAI, logError, logWarn } from './components/ConsolePanel';

// ============================================================================
// MAIN APP COMPONENT - Codify / Trinity Engine
// ============================================================================

function App() {
  console.log('App component rendering...');
  
  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  // Game stats from 3D engine
  const [gameStats, setGameStats] = useState<GameStats>({
    fps: 0,
    blockCount: 0,
    entityCount: 0,
    x: 0,
    y: 0,
    z: 0,
  });

  // UI State
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chat');
  const [showSidebar, setShowSidebar] = useState(false);

  // Inventory
  const [inventory, setInventory] = useState<Inventory>({
    [ItemType.WOOD]: 10,
    [ItemType.STONE]: 5,
    [ItemType.DIRT]: 10,
    [ItemType.GRASS]: 5,
  });

  // World State (entities, physics)
  const [worldState, setWorldState] = useState<WorldState>(createDefaultWorldState());

  // AI Orb State (now with autonomy)
  const [orbState, setOrbState] = useState<AutonomousOrbState>(createDefaultAutonomousOrbState());
  const orbBrainRef = useRef<OrbBrain | null>(null);

  // WorldMind - Living Environment AI
  const worldMindRef = useRef<WorldMind | null>(null);
  const [worldMindStats, setWorldMindStats] = useState({
    isActive: false,
    grassSpread: 0,
    leavesDecayed: 0,
  });

  // Agent Workflow
  const [agentWorkflow, setAgentWorkflow] = useState<AgentWorkflow>(createDefaultAgentWorkflow());
  const [isAgentProcessing, setIsAgentProcessing] = useState(false);

  // System State (logs, DevOps)
  const [systemState, setSystemState] = useState<SystemState>(createDefaultSystemState());

  // Chat History
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isGeneratingTexture, setIsGeneratingTexture] = useState(false);

  // Selected Entity for Inspector
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Refs
  const engineRef = useRef<GameEngineRef>(null);
  const gameLoopRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const executeEntityScriptRef = useRef<(entity: Entity, deltaTime: number, elapsedTime: number) => Entity>(() => ({} as Entity));
  const simulatePhysicsRef = useRef<(entity: Entity, deltaTime: number) => Entity>(() => ({} as Entity));

  // ============================================================================
  // LOGGING HELPER
  // ============================================================================

  const addLog = useCallback((log: SystemLog) => {
    setSystemState((prev) => ({
      ...prev,
      logs: [...prev.logs.slice(-99), log], // Keep last 100 logs
    }));
  }, []);

  // ============================================================================
  // ORB POSITION UPDATE (from VoxelEngine animation loop)
  // ============================================================================

  const handleOrbPositionUpdate = useCallback((position: Vector3) => {
    // Update the brain's internal position tracking
    if (orbBrainRef.current) {
      orbBrainRef.current.updatePosition(position);
    }
    // Also update state for UI
    setOrbState((prev) => ({
      ...prev,
      position,
    }));
  }, []);

  // ============================================================================
  // ENTITY SCRIPT EXECUTION
  // ============================================================================

  const executeEntityScript = useCallback(
    (entity: Entity, deltaTime: number, elapsedTime: number) => {
      if (!entity.script || entity.script.trim() === '') return entity;

      try {
        // Create sandbox context
        const scriptFn = new Function(
          'entity',
          'world',
          'deltaTime',
          'time',
          entity.script
        );

        // Create mutable copy of entity for script to modify
        const mutableEntity = {
          ...entity,
          position: { ...entity.position },
          rotation: { ...entity.rotation },
          velocity: { ...entity.velocity },
          scale: { ...entity.scale },
          physics: { ...entity.physics },
          metadata: { ...entity.metadata },
        };

        // Execute script
        scriptFn(mutableEntity, worldState, deltaTime, elapsedTime);

        return mutableEntity as Entity;
      } catch (error) {
        addLog(logError(`Script error in ${entity.name}: ${error}`, 'script'));
        return entity;
      }
    },
    [worldState, addLog]
  );

  // ============================================================================
  // PHYSICS SIMULATION
  // ============================================================================

  const simulatePhysics = useCallback(
    (entity: Entity, deltaTime: number): Entity => {
      if (entity.physics.isStatic) return entity;

      const gravity = worldState.physics.gravity;
      const airResistance = worldState.physics.airResistance;

      // Apply gravity
      const newVelocity = {
        x: entity.velocity.x * (1 - airResistance),
        y: entity.velocity.y - gravity * deltaTime,
        z: entity.velocity.z * (1 - airResistance),
      };

      // Apply velocity to position
      const newPosition = {
        x: entity.position.x + newVelocity.x * deltaTime,
        y: entity.position.y + newVelocity.y * deltaTime,
        z: entity.position.z + newVelocity.z * deltaTime,
      };

      // Simple floor collision
      if (newPosition.y < 0 && entity.type !== 'orb') {
        newPosition.y = 0;
        newVelocity.y = -newVelocity.y * entity.physics.restitution;
        newVelocity.x *= entity.physics.friction;
        newVelocity.z *= entity.physics.friction;
      }

      return {
        ...entity,
        position: newPosition,
        velocity: newVelocity,
      };
    },
    [worldState.physics]
  );

  // ============================================================================
  // GAME LOOP
  // ============================================================================

  // Keep refs updated with latest callbacks
  useEffect(() => {
    executeEntityScriptRef.current = executeEntityScript;
  }, [executeEntityScript]);

  useEffect(() => {
    simulatePhysicsRef.current = simulatePhysics;
  }, [simulatePhysics]);

  useEffect(() => {
    let elapsedTime = 0;

    const gameLoop = (currentTime: number) => {
      const deltaTime = Math.min((currentTime - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = currentTime;
      elapsedTime += deltaTime;

      // Update world time of day
      setWorldState((prev) => {
        const timeScale = prev.physics.timeScale;
        const newTimeOfDay = (prev.timeOfDay + (deltaTime * timeScale) / prev.dayDuration) % 1;

        // Update entities with physics and scripts (using refs to avoid dependency issues)
        const updatedEntities = prev.entities.map((entity) => {
          let updated = executeEntityScriptRef.current(entity, deltaTime, elapsedTime);
          updated = simulatePhysicsRef.current(updated, deltaTime);
          return updated;
        });

        return {
          ...prev,
          timeOfDay: newTimeOfDay,
          entities: updatedEntities,
        };
      });

      // Update orb animation (floating) - only when autonomy is disabled
      setOrbState((prev) => {
        // Skip manual animation when autonomy is enabled (brain handles movement)
        if (prev.autonomyEnabled) {
          return prev;
        }
        // Manual floating animation for non-autonomous mode
        if (prev.mode === OrbMode.IDLE) {
          return {
            ...prev,
            position: {
              ...prev.position,
              y: 5 + Math.sin(elapsedTime * 2) * 0.5,
            },
          };
        }
        return prev;
      });

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    lastTimeRef.current = performance.now();
    gameLoopRef.current = requestAnimationFrame(gameLoop);

    addLog(logSystem('Trinity Engine initialized', 'core'));

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // ORB BRAIN INITIALIZATION
  // ============================================================================

  // Create world context provider for the brain
  const getWorldContext = useCallback((): WorldContext => {
    const playerPos = engineRef.current?.getPlayerPosition() || { x: 0, y: 0, z: 0 };
    const lookDir = engineRef.current?.getLookDirection() || { x: 0, y: 0, z: -1 };

    return {
      playerPosition: playerPos,
      playerLookDirection: lookDir,
      timeOfDay: worldState.timeOfDay,
      entities: worldState.entities.map(e => ({
        ...e,
        type: e.type as EntityType,
      })),
      getBlocksInArea: (center: Vector3, radius: number) => {
        return engineRef.current?.getBlocksInArea(center, radius) || [];
      },
    };
  }, [worldState.timeOfDay, worldState.entities]);

  // Store getWorldContext in a ref for the brain callbacks
  const getWorldContextRef = useRef(getWorldContext);
  useEffect(() => {
    getWorldContextRef.current = getWorldContext;
  }, [getWorldContext]);

  // Initialize OrbBrain
  useEffect(() => {
    // Create callbacks for the brain
    const callbacks: OrbBrainCallbacks = {
      onToolExecute: async (name: string, args: Record<string, unknown>) => {
        // Forward tool execution to executeTool
        // This will be set up after executeTool is defined
        return { success: true };
      },
      onSpeak: (message: string) => {
        addLog(logAI(`Orb says: ${message}`, 'orb'));
        // Could add speech synthesis here
      },
      onStateChange: (state: AutonomousOrbState) => {
        setOrbState(state);
      },
      getWorldContext: () => getWorldContextRef.current(),
    };

    // Create the brain
    const brain = createOrbBrain(callbacks, {
      position: orbState.position,
      autonomyEnabled: false, // Start disabled, user can enable
    });
    orbBrainRef.current = brain;

    // Start the brain's tick loop
    brain.start();
    addLog(logSystem('OrbBrain autonomous system initialized', 'ai'));

    return () => {
      brain.stop();
      addLog(logSystem('OrbBrain stopped', 'ai'));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update brain's tool execution callback when executeTool changes
  useEffect(() => {
    if (orbBrainRef.current) {
      // The brain's callbacks are set at construction, but we can
      // update the tool execution through the state change callback
      // which handles building actions
    }
  }, []);

  // ============================================================================
  // WORLDMIND INITIALIZATION - Living Environment AI
  // ============================================================================

  useEffect(() => {
    // Wait a bit for the engine to be ready
    const initTimer = setTimeout(() => {
      if (!engineRef.current) {
        console.log('[WorldMind] Engine not ready, skipping initialization');
        return;
      }

      // Create callbacks for the WorldMind
      const callbacks: WorldMindCallbacks = {
        getPlayerPosition: () => {
          return engineRef.current?.getPlayerPosition() || { x: 0, y: 0, z: 0 };
        },
        getBlockAt: (x: number, y: number, z: number) => {
          return engineRef.current?.getBlockAt(x, y, z) ?? null;
        },
        getBlocksInArea: (center, radius) => {
          return engineRef.current?.getBlocksInArea(center, radius) || [];
        },
        placeBlock: (x: number, y: number, z: number, type: number) => {
          if (engineRef.current) {
            engineRef.current.placeBlocksAbsolute([{ x, y, z, type }]);
          }
        },
        removeBlock: (x: number, y: number, z: number) => {
          if (engineRef.current) {
            engineRef.current.removeBlockAt(x, y, z);
          }
        },
        getTimeOfDay: () => {
          return worldState.timeOfDay;
        },
        onWorldEvent: (event) => {
          // Log world events occasionally (not every one to avoid spam)
          if (Math.random() < 0.15) {
            if (event.type === 'grass_spread') {
              addLog(logInfo(`🌱 Grass spread at (${event.position.x}, ${event.position.z})`, 'world'));
            } else if (event.type === 'leaf_decay') {
              addLog(logInfo(`🍂 Leaf decayed at (${event.position.x}, ${event.position.y}, ${event.position.z})`, 'world'));
            } else if (event.type === 'sapling_drop') {
              addLog(logInfo(`🌰 Sapling dropped at (${event.position.x}, ${event.position.z})`, 'world'));
            } else if (event.type === 'tree_grow') {
              addLog(logInfo(`🌳 Tree grew at (${event.position.x}, ${event.position.z})!`, 'world'));
            }
          }
          // Update stats
          setWorldMindStats((prev) => ({
            ...prev,
            grassSpread: prev.grassSpread + (event.type === 'grass_spread' ? 1 : 0),
            leavesDecayed: prev.leavesDecayed + (event.type === 'leaf_decay' ? 1 : 0),
          }));
        },
      };

      // Create and start the WorldMind
      const mind = createWorldMind(callbacks, {
        tickRate: 1000, // 1 second between ticks
        perceptionRadius: 32, // Perceive 32 blocks around player
        maxChangesPerTick: 15, // Max 15 block changes per tick
      });
      worldMindRef.current = mind;

      // Start the world's consciousness
      mind.start();
      setWorldMindStats((prev) => ({ ...prev, isActive: true }));
      addLog(logSystem('🌍 WorldMind awakened - the world is now alive', 'world'));
    }, 2000); // Wait 2 seconds for engine to initialize

    return () => {
      clearTimeout(initTimer);
      if (worldMindRef.current) {
        worldMindRef.current.stop();
        setWorldMindStats((prev) => ({ ...prev, isActive: false }));
        addLog(logSystem('🌍 WorldMind dormant', 'world'));
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // AI TOOL EXECUTION
  // ============================================================================

  const executeTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      addLog(logAI(`Executing tool: ${name}`, 'orb', args));

      switch (name) {
        // ========== ORB CONTROL ==========
        case 'moveOrb': {
          const x = (args.x as number) || 0;
          const y = (args.y as number) || 5;
          const z = (args.z as number) || 0;
          
          setOrbState((prev) => ({
            ...prev,
            position: { x, y, z },
            mode: OrbMode.ACTING,
          }));
          
          // Also move the 3D orb mesh
          if (engineRef.current) {
            engineRef.current.moveOrb(x, y, z);
          }
          
          // Return to idle after movement animation
          setTimeout(() => {
            setOrbState((prev) => ({ ...prev, mode: OrbMode.IDLE }));
          }, 1000);
          
          addLog(logInfo(`Orb moved to (${x}, ${y}, ${z})`, 'orb'));
          return { success: true, position: { x, y, z } };
        }

        case 'setOrbMode': {
          const mode = args.mode as string;
          const modeMap: Record<string, OrbMode> = {
            'idle': OrbMode.IDLE,
            'thinking': OrbMode.THINKING,
            'acting': OrbMode.ACTING,
            'scanning': OrbMode.SCANNING,
            'following': OrbMode.FOLLOWING,
            'listening': OrbMode.LISTENING,
            'speaking': OrbMode.SPEAKING,
          };
          
          const orbMode = modeMap[mode] || OrbMode.IDLE;
          setOrbState((prev) => ({ ...prev, mode: orbMode }));
          addLog(logInfo(`Orb mode set to: ${mode}`, 'orb'));
          return { success: true, mode };
        }

        case 'scanEnvironment': {
          const radius = Math.min((args.radius as number) || 20, 50);
          setOrbState((prev) => ({ ...prev, mode: OrbMode.SCANNING, scanRadius: radius }));

          // Get nearby blocks
          const orbPos = engineRef.current?.getOrbPosition() || orbState.position;
          const nearbyBlocks = engineRef.current?.getBlocksInArea(
            { x: Math.floor(orbPos.x), y: Math.floor(orbPos.y), z: Math.floor(orbPos.z) },
            Math.min(radius, 10)
          ) || [];

          // Get nearby entities
          const nearbyEntities = worldState.entities.filter((e) => {
            const dx = e.position.x - orbPos.x;
            const dy = e.position.y - orbPos.y;
            const dz = e.position.z - orbPos.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz) < radius;
          });

          setTimeout(() => {
            setOrbState((prev) => ({ ...prev, mode: OrbMode.IDLE }));
          }, 2000);

          addLog(logInfo(`Scanned area: ${nearbyBlocks.length} blocks, ${nearbyEntities.length} entities`, 'orb'));
          return {
            success: true,
            blocksFound: nearbyBlocks.length,
            entitiesFound: nearbyEntities.length,
            entities: nearbyEntities.map((e) => ({
              id: e.id,
              name: e.name,
              position: e.position,
            })),
            blockSummary: nearbyBlocks.reduce((acc, b) => {
              acc[b.type] = (acc[b.type] || 0) + 1;
              return acc;
            }, {} as Record<number, number>),
          };
        }

        case 'generateBehaviorScript': {
          const description = args.description as string;
          const entityId = args.entityId as string | undefined;
          
          setOrbState((prev) => ({ ...prev, mode: OrbMode.THINKING }));
          
          try {
            const result = await generateBehaviorScript(description);
            
            // If entityId provided, apply the script
            if (entityId && result.content) {
              // Extract code from the response (look for code blocks)
              const codeMatch = result.content.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
              const script = codeMatch ? codeMatch[1].trim() : result.content;
              
              setWorldState((prev) => ({
                ...prev,
                entities: prev.entities.map((e) =>
                  e.id === entityId ? { ...e, script } : e
                ),
              }));
              addLog(logInfo(`Applied behavior script to entity ${entityId}`, 'orb'));
            }
            
            return { success: true, script: result.content, thinking: result.thinking };
          } finally {
            setOrbState((prev) => ({ ...prev, mode: OrbMode.IDLE }));
          }
        }

        // ========== ENTITY MANAGEMENT ==========
        case 'spawnEntity': {
          const newEntity = createDefaultEntity({
            name: (args.name as string) || 'AI Entity',
            position: {
              x: (args.x as number) || 0,
              y: (args.y as number) || 0,
              z: (args.z as number) || 0,
            },
            color: (args.color as string) || '#9b59b6',
            script: (args.script as string) || '',
          });

          setWorldState((prev) => ({
            ...prev,
            entities: [...prev.entities, newEntity],
          }));

          addLog(logInfo(`Spawned entity: ${newEntity.name}`, 'world'));
          return { success: true, entityId: newEntity.id };
        }

        case 'setGravity': {
          const value = args.value as number;
          setWorldState((prev) => ({
            ...prev,
            physics: { ...prev.physics, gravity: value },
          }));
          addLog(logSystem(`Gravity set to ${value}`, 'physics'));
          return { success: true, gravity: value };
        }

        case 'modifyEntity': {
          const entityId = args.entityId as string;
          const updates: Partial<Entity> = {};

          if (args.position) {
            const [x, y, z] = (args.position as string).split(',').map(Number);
            updates.position = { x, y, z };
          }
          if (args.color) updates.color = args.color as string;
          if (args.script) updates.script = args.script as string;
          if (args.visible !== undefined) updates.visible = args.visible as boolean;

          setWorldState((prev) => ({
            ...prev,
            entities: prev.entities.map((e) =>
              e.id === entityId ? { ...e, ...updates } : e
            ),
          }));

          addLog(logInfo(`Modified entity: ${entityId}`, 'world'));
          return { success: true };
        }

        case 'deleteEntity': {
          const entityId = args.entityId as string;
          setWorldState((prev) => ({
            ...prev,
            entities: prev.entities.filter((e) => e.id !== entityId),
          }));
          addLog(logWarn(`Deleted entity: ${entityId}`, 'world'));
          return { success: true };
        }

        case 'systemOperation': {
          const operation = args.operation as string;
          addLog(logSystem(`System operation: ${operation}`, 'devops'));
          return { success: true, operation };
        }

        case 'placeBlocks': {
          const blocks = args.blocks as BlockData[];
          if (engineRef.current) {
            engineRef.current.placeBlocks(blocks);
          }
          addLog(logInfo(`Placed ${blocks.length} blocks via AI`, 'orb'));
          return { success: true, count: blocks.length };
        }

        case 'placeBlocksAbsolute': {
          const blocks = args.blocks as BlockData[];
          if (engineRef.current) {
            engineRef.current.placeBlocksAbsolute(blocks);
          }
          addLog(logInfo(`Placed ${blocks.length} blocks at absolute coords`, 'orb'));
          return { success: true, count: blocks.length };
        }

        case 'removeBlocks': {
          const positions = args.positions as Vector3[];
          let removed = 0;
          positions.forEach(pos => {
            if (engineRef.current?.removeBlockAt(pos.x, pos.y, pos.z)) removed++;
          });
          addLog(logInfo(`Removed ${removed} blocks`, 'orb'));
          return { success: true, removed };
        }

        case 'clearArea': {
          const start = args.start as Vector3;
          const end = args.end as Vector3;
          const cleared = engineRef.current?.clearArea(start, end) || 0;
          addLog(logInfo(`Cleared ${cleared} blocks from area`, 'orb'));
          return { success: true, cleared };
        }

        case 'getBlockAt': {
          const blockType = engineRef.current?.getBlockAt(
            args.x as number,
            args.y as number,
            args.z as number
          );
          return { success: true, blockType, empty: blockType === null };
        }

        case 'getBlocksInArea': {
          const center = { x: args.centerX as number, y: args.centerY as number, z: args.centerZ as number };
          const radius = Math.min(args.radius as number, 10); // Cap at 10 to prevent performance issues
          const blocks = engineRef.current?.getBlocksInArea(center, radius) || [];
          return { success: true, blocks, count: blocks.length };
        }

        // ========== AUTONOMY CONTROL ==========
        case 'setOrbAutonomy': {
          const enabled = args.enabled as boolean;
          if (orbBrainRef.current) {
            orbBrainRef.current.setAutonomy(enabled);
            addLog(logInfo(`Orb autonomy ${enabled ? 'enabled' : 'disabled'}`, 'ai'));
          }
          return { success: true, autonomyEnabled: enabled };
        }

        case 'addOrbGoal': {
          const goalType = args.type as string;
          const priority = (args.priority as number) || 5;
          const description = args.description as string;
          const targetPosition = args.targetPosition as Vector3 | undefined;

          const typeMap: Record<string, AIGoalType> = {
            'follow_player': AIGoalType.FOLLOW_PLAYER,
            'explore': AIGoalType.EXPLORE,
            'build': AIGoalType.BUILD,
            'gather': AIGoalType.GATHER,
            'observe': AIGoalType.OBSERVE,
            'idle': AIGoalType.IDLE,
            'investigate': AIGoalType.INVESTIGATE,
          };

          const aiGoalType = typeMap[goalType] || AIGoalType.IDLE;

          if (orbBrainRef.current) {
            const goal = orbBrainRef.current.addGoal({
              type: aiGoalType,
              priority,
              description,
              targetPosition,
            });
            addLog(logInfo(`Added goal: ${description || goalType}`, 'ai'));
            return { success: true, goalId: goal.id };
          }
          return { success: false, error: 'OrbBrain not initialized' };
        }

        case 'removeOrbGoal': {
          const goalId = args.goalId as string;
          if (orbBrainRef.current) {
            orbBrainRef.current.removeGoal(goalId);
            addLog(logInfo(`Removed goal: ${goalId}`, 'ai'));
            return { success: true };
          }
          return { success: false, error: 'OrbBrain not initialized' };
        }

        case 'clearOrbGoals': {
          if (orbBrainRef.current) {
            orbBrainRef.current.clearGoals();
            addLog(logInfo('Cleared all Orb goals', 'ai'));
            return { success: true };
          }
          return { success: false, error: 'OrbBrain not initialized' };
        }

        case 'getOrbState': {
          if (orbBrainRef.current) {
            const state = orbBrainRef.current.getState();
            return {
              success: true,
              position: state.position,
              mode: state.mode,
              autonomyEnabled: state.autonomyEnabled,
              activeGoal: state.activeGoal ? {
                type: state.activeGoal.type,
                description: state.activeGoal.description,
                progress: state.activeGoal.progress,
              } : null,
              goalsCount: state.goals.length,
              isMoving: state.isMoving,
            };
          }
          return { success: false, error: 'OrbBrain not initialized' };
        }

        default:
          addLog(logError(`Unknown tool: ${name}`, 'orb'));
          return { success: false, error: 'Unknown tool' };
      }
    },
    [worldState.entities, orbState.position, addLog]
  );

  // ============================================================================
  // AGENT WORKFLOW HANDLERS
  // ============================================================================

  const handleStartPlan = useCallback(
    async (goal: string) => {
      setIsAgentProcessing(true);
      setOrbState((prev) => ({ ...prev, mode: OrbMode.THINKING, currentTask: goal }));
      addLog(logAI(`Planning goal: ${goal}`, 'agent'));

      try {
        const playerPos = engineRef.current?.getPlayerPosition() || { x: 0, y: 0, z: 0 };

        const plan = await generateAgentPlan(goal, {
          entities: worldState.entities,
          playerPosition: playerPos,
          timeOfDay: worldState.timeOfDay,
        });

        const steps: AgentStep[] = plan.steps.map((step) => ({
          ...step,
          status: AgentStepStatus.PENDING,
        }));

        setAgentWorkflow({
          phase: AgentPhase.EXECUTING,
          goal: plan.goal,
          steps,
          currentStepIndex: 0,
          startedAt: Date.now(),
          skills: agentWorkflow.skills,
        });

        addLog(logAI(`Plan created with ${steps.length} steps`, 'agent'));

        // Auto-execute steps
        for (let i = 0; i < steps.length; i++) {
          setAgentWorkflow((prev) => ({
            ...prev,
            currentStepIndex: i,
            steps: prev.steps.map((s, idx) =>
              idx === i ? { ...s, status: AgentStepStatus.IN_PROGRESS } : s
            ),
          }));

          setOrbState((prev) => ({ ...prev, mode: OrbMode.ACTING }));

          try {
            const result = await executeTool(steps[i].action, steps[i].parameters);

            setAgentWorkflow((prev) => ({
              ...prev,
              steps: prev.steps.map((s, idx) =>
                idx === i ? { ...s, status: AgentStepStatus.COMPLETED, result } : s
              ),
            }));
          } catch (error) {
            setAgentWorkflow((prev) => ({
              ...prev,
              steps: prev.steps.map((s, idx) =>
                idx === i ? { ...s, status: AgentStepStatus.FAILED, error: String(error) } : s
              ),
            }));
          }

          // Small delay between steps
          await new Promise((r) => setTimeout(r, 500));
        }

        setAgentWorkflow((prev) => ({
          ...prev,
          phase: AgentPhase.COMPLETED,
          completedAt: Date.now(),
        }));
      } catch (error) {
        addLog(logError(`Planning failed: ${error}`, 'agent'));
        setAgentWorkflow((prev) => ({ ...prev, phase: AgentPhase.ERROR }));
      } finally {
        setIsAgentProcessing(false);
        setOrbState((prev) => ({ ...prev, mode: OrbMode.IDLE, currentTask: undefined }));
      }
    },
    [worldState, agentWorkflow.skills, executeTool, addLog]
  );

  const handleExecuteStep = useCallback(async (step: AgentStep) => {
    await executeTool(step.action, step.parameters);
  }, [executeTool]);

  const handlePauseExecution = useCallback(() => {
    setAgentWorkflow((prev) => ({ ...prev, phase: AgentPhase.PAUSED }));
    addLog(logSystem('Agent execution paused', 'agent'));
  }, [addLog]);

  const handleResumeExecution = useCallback(() => {
    setAgentWorkflow((prev) => ({ ...prev, phase: AgentPhase.EXECUTING }));
    addLog(logSystem('Agent execution resumed', 'agent'));
  }, [addLog]);

  const handleCancelExecution = useCallback(() => {
    setAgentWorkflow((prev) => ({
      ...prev,
      phase: AgentPhase.IDLE,
      steps: [],
      currentStepIndex: -1,
    }));
    setIsAgentProcessing(false);
    setOrbState((prev) => ({ ...prev, mode: OrbMode.IDLE }));
    addLog(logWarn('Agent execution cancelled', 'agent'));
  }, [addLog]);

  const handleSaveSkill = useCallback((skill: Omit<Skill, 'id' | 'createdAt'>) => {
    const newSkill: Skill = {
      ...skill,
      id: `skill-${Date.now()}`,
      createdAt: Date.now(),
    };
    setAgentWorkflow((prev) => ({
      ...prev,
      skills: [...prev.skills, newSkill],
    }));
    addLog(logInfo(`Skill saved: ${skill.name}`, 'agent'));
  }, [addLog]);

  const handleLoadSkill = useCallback((skill: Skill) => {
    handleStartPlan(skill.prompt);
  }, [handleStartPlan]);

  const handleDeleteSkill = useCallback((skillId: string) => {
    setAgentWorkflow((prev) => ({
      ...prev,
      skills: prev.skills.filter((s) => s.id !== skillId),
    }));
    addLog(logWarn('Skill deleted', 'agent'));
  }, [addLog]);

  // ============================================================================
  // ENTITY MANAGEMENT
  // ============================================================================

  const handleUpdateEntity = useCallback((id: string, updates: Partial<Entity>) => {
    setWorldState((prev) => ({
      ...prev,
      entities: prev.entities.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    }));
  }, []);

  const handleDeleteEntity = useCallback((id: string) => {
    setWorldState((prev) => ({
      ...prev,
      entities: prev.entities.filter((e) => e.id !== id),
    }));
    if (selectedEntityId === id) {
      setSelectedEntityId(null);
    }
    addLog(logWarn(`Entity deleted: ${id}`, 'world'));
  }, [selectedEntityId, addLog]);

  const handleGenerateTexture = useCallback(async (entityId: string, description: string) => {
    setIsGeneratingTexture(true);
    addLog(logAI(`Generating texture: ${description}`, 'orb'));
    // Placeholder - texture generation would go here
    setTimeout(() => {
      setIsGeneratingTexture(false);
      addLog(logInfo('Texture generation complete', 'orb'));
    }, 2000);
  }, [addLog]);

  // ============================================================================
  // CHAT HANDLERS
  // ============================================================================

  const handleChatMessage = useCallback(
    async (message: string) => {
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: Date.now(),
      };
      setChatHistory((prev) => [...prev, userMessage]);

      setOrbState((prev) => ({ ...prev, mode: OrbMode.THINKING }));

      try {
        // Build spatial context for vibe-coding
        const playerPos = engineRef.current?.getPlayerPosition() || { x: 0, y: 0, z: 0 };
        const lookDir = engineRef.current?.getLookDirection() || { x: 0, y: 0, z: -1 };
        const raycast = engineRef.current?.raycast(50); // 50 block range for vibe-coding

        // Get nearby blocks for environmental awareness (radius 5)
        const nearbyBlocks = engineRef.current?.getBlocksInArea(
          { x: Math.floor(playerPos.x), y: Math.floor(playerPos.y), z: Math.floor(playerPos.z) },
          5
        ) || [];

        // Summarize nearby blocks by type
        const blockCounts: Record<number, number> = {};
        nearbyBlocks.forEach(b => { blockCounts[b.type] = (blockCounts[b.type] || 0) + 1; });
        const blockTypeNames: Record<number, string> = { 1: 'Grass', 2: 'Dirt', 3: 'Stone', 4: 'Wood', 5: 'Leaf', 6: 'Plank' };
        const nearbyDescription = Object.entries(blockCounts)
          .map(([type, count]) => `${blockTypeNames[+type] || 'Unknown'}: ${count}`)
          .join(', ');

        const spatialContext = `[SPATIAL CONTEXT]
Player Position: (${playerPos.x}, ${playerPos.y}, ${playerPos.z})
Look Direction: (${lookDir.x.toFixed(2)}, ${lookDir.y.toFixed(2)}, ${lookDir.z.toFixed(2)})
${raycast?.hit
  ? `Looking At: Block at (${raycast.blockPosition.x}, ${raycast.blockPosition.y}, ${raycast.blockPosition.z})${raycast.isGround ? ' [ground]' : ''}, distance ${raycast.distance.toFixed(1)} blocks`
  : 'Looking At: Nothing (sky)'}
Nearby Blocks (radius 5): ${nearbyDescription || 'None'}

When the user says "here", "this spot", or "where I'm looking", use the block position above.
When placing blocks, use ABSOLUTE world coordinates via placeBlocksAbsolute tool.
Block types: 1=Grass, 2=Dirt, 3=Stone, 4=Wood, 5=Leaf, 6=Plank
`;

        const enrichedMessage = spatialContext + '\n\nUser command: ' + message;
        const result = await chatWithTools(enrichedMessage, chatHistory);

        // Execute any function calls
        for (const call of result.functionCalls) {
          await executeTool(call.name, call.args);
        }

        if (result.response) {
          const assistantMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: result.response,
            timestamp: Date.now(),
          };
          setChatHistory((prev) => [...prev, assistantMessage]);
        }
      } catch (error) {
        addLog(logError(`Chat error: ${error}`, 'orb'));
      } finally {
        setOrbState((prev) => ({ ...prev, mode: OrbMode.IDLE }));
      }
    },
    [chatHistory, executeTool, addLog]
  );

  // ============================================================================
  // BLOCK INTERACTION (Original functionality)
  // ============================================================================

  const handleStatsUpdate = useCallback((stats: GameStats) => {
    setGameStats({
      ...stats,
      entityCount: worldState.entities.length,
    });
  }, [worldState.entities.length]);

  const handleAiBlocks = useCallback((blocks: BlockData[]) => {
    if (engineRef.current) {
      engineRef.current.placeBlocks(blocks);
      addLog(logAI(`Placed ${blocks.length} blocks`, 'orb'));
    }
  }, [addLog]);

  const handleBlockBreak = useCallback((type: ItemType) => {
    setInventory((prev) => ({
      ...prev,
      [type]: (prev[type] || 0) + 1,
    }));
  }, []);

  const checkCanPlace = useCallback(
    (type: ItemType) => {
      return (inventory[type] || 0) > 0;
    },
    [inventory]
  );

  const handleBlockPlace = useCallback((type: ItemType) => {
    setInventory((prev) => ({
      ...prev,
      [type]: Math.max(0, (prev[type] || 0) - 1),
    }));
  }, []);

  const handleCraft = useCallback((recipe: Recipe) => {
    const canCraft = recipe.ingredients.every((ing) => (inventory[ing.type] || 0) >= ing.count);

    if (canCraft) {
      setInventory((prev) => {
        const next = { ...prev };
        recipe.ingredients.forEach((ing) => {
          next[ing.type] = (next[ing.type] || 0) - ing.count;
        });
        next[recipe.result] = (next[recipe.result] || 0) + recipe.resultCount;
        return next;
      });
      addLog(logInfo(`Crafted: ${recipe.name}`, 'crafting'));
    }
  }, [inventory, addLog]);

  const handleRequestLock = useCallback(() => {
    engineRef.current?.requestLock();
  }, []);

  const handleClearLogs = useCallback(() => {
    setSystemState((prev) => ({ ...prev, logs: [] }));
  }, []);

  // ============================================================================
  // GET SELECTED ENTITY
  // ============================================================================

  const selectedEntity = selectedEntityId
    ? worldState.entities.find((e) => e.id === selectedEntityId) || null
    : null;

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      {/* 3D Engine */}
      <VoxelEngine
        ref={engineRef}
        onStatsUpdate={handleStatsUpdate}
        onLockChange={setIsLocked}
        selectedBlockIndex={selectedSlot}
        onBlockBreak={handleBlockBreak}
        checkCanPlace={checkCanPlace}
        onBlockPlace={handleBlockPlace}
        orbState={orbState}
        entities={worldState.entities}
        onOrbPositionUpdate={handleOrbPositionUpdate}
      />

      {/* UI Overlay */}
      <UIOverlay
        stats={gameStats}
        selectedSlot={selectedSlot}
        isLocked={isLocked}
        inventory={inventory}
        onSlotSelect={setSelectedSlot}
        onAiResponse={handleAiBlocks}
        onCraft={handleCraft}
        onRequestLock={handleRequestLock}
        // New props for extended functionality
        showSidebar={showSidebar}
        onToggleSidebar={() => setShowSidebar(!showSidebar)}
        sidebarTab={sidebarTab}
        onSidebarTabChange={setSidebarTab}
        // World & Entities
        worldState={worldState}
        orbState={orbState}
        selectedEntity={selectedEntity}
        onSelectEntity={setSelectedEntityId}
        onUpdateEntity={handleUpdateEntity}
        onDeleteEntity={handleDeleteEntity}
        onGenerateTexture={handleGenerateTexture}
        isGeneratingTexture={isGeneratingTexture}
        // Agent
        agentWorkflow={agentWorkflow}
        onStartPlan={handleStartPlan}
        onExecuteStep={handleExecuteStep}
        onPauseExecution={handlePauseExecution}
        onResumeExecution={handleResumeExecution}
        onCancelExecution={handleCancelExecution}
        onSaveSkill={handleSaveSkill}
        onLoadSkill={handleLoadSkill}
        onDeleteSkill={handleDeleteSkill}
        isAgentProcessing={isAgentProcessing}
        // Chat
        chatHistory={chatHistory}
        onChatMessage={handleChatMessage}
        // Console
        logs={systemState.logs}
        onClearLogs={handleClearLogs}
      />
    </div>
  );
}

export default App;