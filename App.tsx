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
  WorldState,
  OrbState,
  OrbMode,
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
  createDefaultOrbState,
  createDefaultAgentWorkflow,
  createDefaultSystemState,
  // Quantum types
  QuantumOrbState,
  QuantumPhase,
  OrbCopy,
  QuantumBuildPlan,
  createDefaultQuantumState,
  generateOrbCopyColor,
  calculateOrbCopyPositions,
} from './types';
import {
  generateAgentPlan,
  chatWithTools,
  generateBehaviorScript,
  generateQuantumBuildPlan,
  shouldUseQuantumSplit,
} from './services/geminiService';
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

  // AI Orb State
  const [orbState, setOrbState] = useState<OrbState>(createDefaultOrbState());

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

  // Quantum Orb State
  const [quantumState, setQuantumState] = useState<QuantumOrbState>(createDefaultQuantumState());

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

      // Update orb animation (floating)
      setOrbState((prev) => {
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
  // AI TOOL EXECUTION
  // ============================================================================

  const executeTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      addLog(logAI(`Executing tool: ${name}`, 'orb', args));

      switch (name) {
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

        case 'scanEnvironment': {
          const radius = (args.radius as number) || 20;
          setOrbState((prev) => ({ ...prev, mode: OrbMode.SCANNING, scanRadius: radius }));

          // Simulate scan
          const nearbyEntities = worldState.entities.filter((e) => {
            const dx = e.position.x - orbState.position.x;
            const dy = e.position.y - orbState.position.y;
            const dz = e.position.z - orbState.position.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz) < radius;
          });

          setTimeout(() => {
            setOrbState((prev) => ({ ...prev, mode: OrbMode.IDLE }));
          }, 2000);

          return {
            entitiesFound: nearbyEntities.length,
            entities: nearbyEntities.map((e) => ({
              id: e.id,
              name: e.name,
              position: e.position,
            })),
          };
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
  // QUANTUM ORB SYSTEM
  // ============================================================================

  // Initiate quantum split for complex building tasks
  const initiateQuantumSplit = useCallback(
    async (goal: string) => {
      const playerPos = engineRef.current?.getPlayerPosition() || { x: 0, y: 0, z: 0 };

      addLog(logAI('⚛️ Analyzing task for quantum parallelization...', 'quantum'));
      setOrbState((prev) => ({ ...prev, mode: OrbMode.THINKING, currentTask: goal }));
      setQuantumState((prev) => ({
        ...prev,
        phase: QuantumPhase.SPLITTING,
        originalOrbPosition: orbState.position,
      }));

      try {
        // Generate quantum build plan
        const plan = await generateQuantumBuildPlan(goal, playerPos, 4);

        if (!plan.chunks || plan.chunks.length === 0) {
          addLog(logWarn('Task not suitable for quantum split, using standard execution', 'quantum'));
          setQuantumState(createDefaultQuantumState());
          return false;
        }

        addLog(logAI(`⚛️ Quantum split initiated: ${plan.chunks.length} parallel copies`, 'quantum'));
        addLog(logSystem(`Plan: ${plan.reasoning}`, 'quantum'));

        // Calculate positions for orb copies
        const copyPositions = calculateOrbCopyPositions(orbState.position, plan.chunks.length, 5);

        // Create orb copies
        const copies: OrbCopy[] = plan.chunks.map((chunk, index) => ({
          id: `orb-copy-${index}-${Date.now()}`,
          index,
          position: { ...orbState.position }, // Start at center
          targetPosition: copyPositions[index],
          assignedChunk: chunk,
          progress: 0,
          status: 'idle',
          color: generateOrbCopyColor(index, plan.chunks.length),
          blocksPlaced: 0,
          currentBlockIndex: 0,
        }));

        setQuantumState({
          phase: QuantumPhase.SUPERPOSITION,
          isQuantumSplit: true,
          copies,
          masterPlan: plan,
          coherenceLevel: 1.0,
          coherenceDecayRate: 0.002, // Slower decay for building
          splitStartTime: Date.now(),
          collapseStartTime: null,
          totalBlocksPlaced: 0,
          originalOrbPosition: orbState.position,
        });

        // Start parallel execution
        executeQuantumBuild(copies, plan);
        return true;
      } catch (error) {
        addLog(logError(`Quantum split failed: ${error}`, 'quantum'));
        setQuantumState(createDefaultQuantumState());
        setOrbState((prev) => ({ ...prev, mode: OrbMode.IDLE }));
        return false;
      }
    },
    [orbState.position, addLog]
  );

  // Execute quantum parallel build
  const executeQuantumBuild = useCallback(
    async (copies: OrbCopy[], plan: QuantumBuildPlan) => {
      setOrbState((prev) => ({ ...prev, mode: OrbMode.ACTING }));

      // Function to check if chunk dependencies are satisfied
      const areDependenciesMet = (chunk: typeof plan.chunks[0], completedChunks: Set<string>) => {
        return chunk.dependencies.every((dep) => completedChunks.has(dep));
      };

      const completedChunks = new Set<string>();
      const blockDelay = 30; // ms between blocks

      // Execute all chunks in parallel
      const chunkPromises = copies.map(async (copy) => {
        const chunk = copy.assignedChunk;

        // Update copy status to working
        setQuantumState((prev) => ({
          ...prev,
          copies: prev.copies.map((c) =>
            c.id === copy.id ? { ...c, status: 'working' as const } : c
          ),
        }));

        // Wait for dependencies
        while (!areDependenciesMet(chunk, completedChunks)) {
          // Check coherence - abort if too low
          const currentState = quantumState;
          if (currentState.coherenceLevel < 0.1) {
            return { copyId: copy.id, success: false, reason: 'decoherence' };
          }

          setQuantumState((prev) => ({
            ...prev,
            copies: prev.copies.map((c) =>
              c.id === copy.id ? { ...c, status: 'blocked' as const } : c
            ),
          }));

          await new Promise((r) => setTimeout(r, 100));
        }

        // Set back to working
        setQuantumState((prev) => ({
          ...prev,
          copies: prev.copies.map((c) =>
            c.id === copy.id ? { ...c, status: 'working' as const } : c
          ),
        }));

        addLog(logAI(`⚛️ Copy ${copy.index + 1} building: ${chunk.name}`, 'quantum'));

        // Place blocks for this chunk
        const playerPos = engineRef.current?.getPlayerPosition() || { x: 0, y: 0, z: 0 };

        for (let i = 0; i < chunk.blocks.length; i++) {
          const block = chunk.blocks[i];

          // Place block (relative to player position)
          const absoluteBlock: BlockData = {
            x: Math.round(playerPos.x + block.x),
            y: Math.round(playerPos.y + block.y),
            z: Math.round(playerPos.z + block.z),
            type: block.type,
          };

          if (engineRef.current) {
            engineRef.current.placeBlocks([absoluteBlock]);
          }

          // Update copy progress and position
          const progress = ((i + 1) / chunk.blocks.length) * 100;
          setQuantumState((prev) => ({
            ...prev,
            copies: prev.copies.map((c) =>
              c.id === copy.id
                ? {
                    ...c,
                    progress,
                    blocksPlaced: i + 1,
                    currentBlockIndex: i,
                    position: {
                      x: absoluteBlock.x,
                      y: absoluteBlock.y + 2,
                      z: absoluteBlock.z,
                    },
                  }
                : c
            ),
            totalBlocksPlaced: prev.totalBlocksPlaced + 1,
          }));

          await new Promise((r) => setTimeout(r, blockDelay));
        }

        // Mark chunk as complete
        completedChunks.add(chunk.id);

        setQuantumState((prev) => ({
          ...prev,
          copies: prev.copies.map((c) =>
            c.id === copy.id ? { ...c, status: 'complete' as const, progress: 100 } : c
          ),
        }));

        addLog(logInfo(`✓ Copy ${copy.index + 1} completed: ${chunk.name} (${chunk.blocks.length} blocks)`, 'quantum'));
        return { copyId: copy.id, success: true };
      });

      // Wait for all chunks to complete
      await Promise.all(chunkPromises);

      // Collapse quantum state
      collapseQuantumState();
    },
    [quantumState.coherenceLevel, addLog]
  );

  // Collapse quantum state back to single orb
  const collapseQuantumState = useCallback(() => {
    addLog(logAI('⚛️ All copies complete. Collapsing quantum state...', 'quantum'));

    setQuantumState((prev) => ({
      ...prev,
      phase: QuantumPhase.COLLAPSING,
      collapseStartTime: Date.now(),
    }));

    // Animate collapse (copies fly back to center)
    setTimeout(() => {
      const totalBlocks = quantumState.totalBlocksPlaced;
      addLog(logSystem(`⚛️ Quantum coherence restored. Total blocks placed: ${totalBlocks}`, 'quantum'));

      setQuantumState(createDefaultQuantumState());
      setOrbState((prev) => ({
        ...prev,
        mode: OrbMode.IDLE,
        currentTask: undefined,
      }));
    }, 1500); // Collapse animation duration
  }, [quantumState.totalBlocksPlaced, addLog]);

  // Force collapse due to decoherence
  const forceQuantumCollapse = useCallback(() => {
    addLog(logWarn('⚠️ Quantum coherence lost! Emergency collapse...', 'quantum'));

    setQuantumState((prev) => ({
      ...prev,
      phase: QuantumPhase.DECOHERENT,
    }));

    setTimeout(() => {
      setQuantumState(createDefaultQuantumState());
      setOrbState((prev) => ({
        ...prev,
        mode: OrbMode.IDLE,
        currentTask: undefined,
      }));
    }, 1000);
  }, [addLog]);

  // Cancel quantum operation
  const cancelQuantumOperation = useCallback(() => {
    addLog(logWarn('⚛️ Quantum operation cancelled', 'quantum'));
    setQuantumState(createDefaultQuantumState());
    setOrbState((prev) => ({
      ...prev,
      mode: OrbMode.IDLE,
      currentTask: undefined,
    }));
  }, [addLog]);

  // Update coherence decay in game loop
  useEffect(() => {
    if (!quantumState.isQuantumSplit) return;

    const decayInterval = setInterval(() => {
      setQuantumState((prev) => {
        const newCoherence = Math.max(0, prev.coherenceLevel - prev.coherenceDecayRate);

        if (newCoherence <= 0.1 && prev.phase === QuantumPhase.SUPERPOSITION) {
          // Trigger emergency collapse
          forceQuantumCollapse();
          return prev;
        }

        return {
          ...prev,
          coherenceLevel: newCoherence,
        };
      });
    }, 1000);

    return () => clearInterval(decayInterval);
  }, [quantumState.isQuantumSplit, forceQuantumCollapse]);

  // Modified handleStartPlan to check for quantum split opportunity
  const handleStartPlanWithQuantum = useCallback(
    async (goal: string) => {
      // Check if this task should use quantum split
      if (shouldUseQuantumSplit(goal)) {
        addLog(logAI('⚛️ Complex task detected - initiating quantum split...', 'quantum'));
        const success = await initiateQuantumSplit(goal);
        if (success) return;
        // Fall through to standard execution if quantum split fails
      }

      // Standard execution
      handleStartPlan(goal);
    },
    [initiateQuantumSplit, handleStartPlan, addLog]
  );

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
        const result = await chatWithTools(message, chatHistory);

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
        quantumState={quantumState}
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
        onStartPlan={handleStartPlanWithQuantum}
        onExecuteStep={handleExecuteStep}
        onPauseExecution={handlePauseExecution}
        onResumeExecution={handleResumeExecution}
        onCancelExecution={handleCancelExecution}
        onSaveSkill={handleSaveSkill}
        onLoadSkill={handleLoadSkill}
        onDeleteSkill={handleDeleteSkill}
        isAgentProcessing={isAgentProcessing}
        // Quantum
        quantumState={quantumState}
        onCancelQuantum={cancelQuantumOperation}
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