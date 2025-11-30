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
} from './types';
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