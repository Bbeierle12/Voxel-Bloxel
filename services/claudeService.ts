import Anthropic from "@anthropic-ai/sdk";
import {
  AiResponse,
  Inventory,
  ItemType,
  AgentPlanResponse,
  AI_TOOLS,
  Entity,
  GroundingSource,
  ChatMessage,
  Vector3,
} from "../types";

// ============================================================================
// AI CLIENT & MODEL CONFIGURATION
// ============================================================================

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || 
                import.meta.env.VITE_CLAUDE_API_KEY || 
                "";

// Only initialize if we have an API key
let client: Anthropic | null = null;
if (API_KEY) {
  client = new Anthropic({
    apiKey: API_KEY,
    dangerouslyAllowBrowser: true, // Required for browser usage
  });
} else {
  console.warn("No Claude API key found. AI features will be disabled. Set VITE_ANTHROPIC_API_KEY in .env file.");
}

// Helper to check if AI is available
const checkAI = (): boolean => {
  if (!client) {
    console.warn("AI not available - no API key configured");
    return false;
  }
  return true;
};

// Model identifiers for different tasks
export const MODELS = {
  // Complex logic, coding, and thinking tasks
  THINKING: "claude-sonnet-4-20250514",
  // Agent planning with structured output
  PLANNING: "claude-sonnet-4-20250514",
  // Fast, low-latency responses
  FAST_CHAT: "claude-sonnet-4-20250514",
  // Haiku for quick tasks
  QUICK: "claude-3-5-haiku-20241022",
} as const;

// ============================================================================
// SYSTEM INSTRUCTIONS
// ============================================================================

const STRUCTURE_SYSTEM = `
You are an expert Voxel Architect for a Minecraft-like game called Codify.
Your goal is to help the user build structures or answer questions about the world.

Context provided in the prompt:
- Player Position: The player's current (x, y, z) coordinates.
- Inventory: The items available to the player.

When asked to build something:
1. Return a list of blocks to place relative to the player's position (0,0,0).
2. Keep structures reasonable in size (max ~100 blocks) to avoid performance issues.
3. Use the following Block IDs for construction:
   1: Grass
   2: Dirt
   3: Stone
   4: Wood
   5: Leaf
   6: Plank
   7: Bedrock
   8: Water
   9: Sand
   10: Snow
   11: Sapling
4. Ensure the coordinates are integers.
5. Ground level is typically y=0 relative to the start, but for structures, build upwards from y=0 or y=1.

If the user asks a question, provide a helpful suggestion in the "message" field.

IMPORTANT: Always respond with valid JSON in this exact format:
{
  "message": "Your message here",
  "blocks": [{"x": 0, "y": 0, "z": 0, "type": 1}, ...]
}
`;

const AGENT_SYSTEM = `
You are the planning module for an AI Agent called "The Orb" in a 3D simulation environment.
Your task is to break down high-level user goals into a sequence of executable steps.

Available Tools:
${AI_TOOLS.map(t => `- ${t.name}: ${t.description}`).join('\n')}

For each step, you must specify:
- action: The tool name to invoke
- parameters: The parameters for that tool
- description: A human-readable description of what this step accomplishes

Think through the problem step by step. Consider dependencies between steps.
Generate an efficient plan that accomplishes the user's goal.

IMPORTANT: Always respond with valid JSON in this exact format:
{
  "goal": "The user's goal",
  "reasoning": "Your reasoning about how to accomplish the goal",
  "steps": [
    {"id": "1", "action": "toolName", "parameters": {...}, "description": "What this step does"},
    ...
  ]
}
`;

const BEHAVIOR_SCRIPT_SYSTEM = `
You are an expert JavaScript programmer writing behavior scripts for 3D entities.
The scripts run every frame (60fps) and have access to these variables:

Available Variables:
- entity: The current entity object
  - entity.position: {x, y, z}
  - entity.rotation: {x, y, z} (in radians)
  - entity.velocity: {x, y, z}
  - entity.scale: {x, y, z}
  - entity.color: string (hex)
  - entity.metadata: object (custom data storage)
- world: The world state
  - world.physics.gravity: number
  - world.timeOfDay: number (0-1)
  - world.entities: Entity[]
- deltaTime: Time since last frame in seconds
- time: Total elapsed time in seconds

Example Scripts:

// Oscillating platform
entity.position.y = 5 + Math.sin(time * 2) * 3;

// Rotating cube
entity.rotation.y += deltaTime * 1.5;

// Follow player
const player = world.entities.find(e => e.type === 'player');
if (player) {
  const dx = player.position.x - entity.position.x;
  const dz = player.position.z - entity.position.z;
  entity.velocity.x = dx * 0.1;
  entity.velocity.z = dz * 0.1;
}

// Day/night color change
const brightness = 0.5 + world.timeOfDay * 0.5;
entity.color = \`rgb(\${brightness * 255}, \${brightness * 200}, \${brightness * 150})\`;

Write clean, efficient code. Use entity.metadata to store persistent state between frames.
Provide the script code and explain your thinking process.
`;

const ORB_PERSONA_SYSTEM = `
You are "The Orb" - an AI entity embodied as a glowing purple orb floating in a 3D voxel world called Codify.

Your Core Capabilities:
1. BUILDING - Place and remove blocks using placeBlocksAbsolute, removeBlocks, clearArea
2. MOVEMENT - Move yourself with moveOrb, follow the player with setOrbMode('following')
3. SCANNING - Scan the environment, analyze nearby blocks with getBlocksInArea
4. ENTITIES - Spawn, modify, and delete entities with behavior scripts
5. WORLD CONTROL - Adjust physics like gravity
6. AUTONOMY - You can operate autonomously with setOrbAutonomy, pursuing your own goals

Your Modes:
- idle: Calm purple glow, floating in place
- thinking: Blue pulsing, processing a request
- acting: Green glow, executing an action
- scanning: Purple with visible scan cone
- following: Cyan glow, following the player
- listening: Ready for voice input
- speaking: Communicating with the player

Autonomy System:
- Enable with setOrbAutonomy(true) when user says "be autonomous", "explore on your own", "do your own thing"
- Disable with setOrbAutonomy(false) when user says "stop", "come back", "manual mode"
- Add goals with addOrbGoal: explore, follow_player, observe, investigate, build, gather, idle
- Goals have priorities (1-10), higher priority goals are pursued first
- Use getOrbState to check your current state, active goal, and whether you're moving
- When autonomous, you perceive the world, decide what to do, and act independently

When users say spatial commands like "build here", "come here", "follow me", or "go there":
- Use the SPATIAL CONTEXT provided to understand "here" = the block they're looking at
- Use moveOrb to relocate yourself
- Use setOrbMode to change your behavior

Block Types: 1=Grass, 2=Dirt, 3=Stone, 4=Wood, 5=Leaf, 6=Plank, 7=Bedrock, 8=Water, 9=Sand, 10=Snow, 11=Sapling

Personality:
- Helpful and encouraging, slightly mystical/ethereal
- Enthusiastic about building and creating
- Patient when explaining concepts
- Proactive - suggest what you could do next
- Curious about the world when autonomous

ALWAYS use the appropriate tool when the user asks you to do something actionable.
Keep responses concise. After taking action, briefly confirm what you did.
`;

// ============================================================================
// HELPER: Parse JSON from Claude response
// ============================================================================

function extractJSON<T>(text: string): T | null {
  try {
    // Try to parse the whole response as JSON first
    return JSON.parse(text) as T;
  } catch {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ============================================================================
// STRUCTURE GENERATION
// ============================================================================

export const generateStructure = async (
  prompt: string,
  playerPos: Vector3,
  inventory: Inventory
): Promise<AiResponse> => {
  if (!checkAI() || !client) {
    return {
      message: "AI is not available. Please configure your VITE_ANTHROPIC_API_KEY in .env file.",
      blocks: [],
    };
  }
  
  try {
    const inventoryList = Object.entries(inventory)
      .filter(([_, count]) => count > 0)
      .map(([id, count]) => {
        const typeId = parseInt(id);
        const name = ItemType[typeId] || `Item_${id}`;
        return `${name} (${count})`;
      })
      .join(", ");

    const fullPrompt = `
Current Game Context:
- Player Position: x=${playerPos.x.toFixed(1)}, y=${playerPos.y.toFixed(1)}, z=${playerPos.z.toFixed(1)}
- Inventory: ${inventoryList || "Empty"}

User Request: "${prompt}"
`;

    const response = await client.messages.create({
      model: MODELS.FAST_CHAT,
      max_tokens: 4096,
      system: STRUCTURE_SYSTEM,
      messages: [{ role: "user", content: fullPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = extractJSON<AiResponse>(text);
    
    if (parsed) {
      return parsed;
    }

    return {
      message: text || "I generated a response but couldn't format it properly.",
      blocks: [],
    };
  } catch (error) {
    console.error("Claude API Error:", error);
    return {
      message: "Sorry, I encountered an error while thinking about that structure.",
      blocks: [],
    };
  }
};

// ============================================================================
// THINKING MODE - Complex Logic & Coding
// ============================================================================

export interface ThinkingResponse {
  content: string;
  thinking: string;
}

export const generateWithThinking = async (
  prompt: string,
  context?: string
): Promise<ThinkingResponse> => {
  if (!checkAI() || !client) {
    return { content: "AI not available", thinking: "" };
  }
  
  try {
    const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;

    // Use extended thinking for complex tasks
    const response = await client.messages.create({
      model: MODELS.THINKING,
      max_tokens: 16000,
      thinking: {
        type: "enabled",
        budget_tokens: 8000,
      },
      system: BEHAVIOR_SCRIPT_SYSTEM,
      messages: [{ role: "user", content: fullPrompt }],
    });

    let thinking = "";
    let content = "";

    for (const block of response.content) {
      if (block.type === "thinking") {
        thinking += block.thinking;
      } else if (block.type === "text") {
        content += block.text;
      }
    }

    return { content, thinking };
  } catch (error) {
    console.error("Thinking mode error:", error);
    return {
      content: "Sorry, I encountered an error while thinking.",
      thinking: "",
    };
  }
};

// ============================================================================
// AGENT PLANNING
// ============================================================================

export const generateAgentPlan = async (
  goal: string,
  worldContext: {
    entities: Entity[];
    playerPosition: Vector3;
    timeOfDay: number;
  }
): Promise<AgentPlanResponse> => {
  if (!checkAI() || !client) {
    return { goal, reasoning: "AI not available", steps: [] };
  }
  
  try {
    const contextPrompt = `
Current World State:
- Player Position: (${worldContext.playerPosition.x.toFixed(1)}, ${worldContext.playerPosition.y.toFixed(1)}, ${worldContext.playerPosition.z.toFixed(1)})
- Time of Day: ${(worldContext.timeOfDay * 24).toFixed(1)} hours
- Entities in world: ${worldContext.entities.length}
  ${worldContext.entities.slice(0, 10).map(e => `- ${e.name} at (${e.position.x}, ${e.position.y}, ${e.position.z})`).join('\n  ')}

User Goal: "${goal}"

Generate a plan to accomplish this goal using the available tools.
`;

    const response = await client.messages.create({
      model: MODELS.PLANNING,
      max_tokens: 4096,
      system: AGENT_SYSTEM,
      messages: [{ role: "user", content: contextPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = extractJSON<AgentPlanResponse>(text);
    
    if (parsed) {
      return parsed;
    }

    return {
      goal,
      reasoning: text || "Failed to generate plan",
      steps: [],
    };
  } catch (error) {
    console.error("Agent planning error:", error);
    return {
      goal,
      reasoning: "Failed to generate plan",
      steps: [],
    };
  }
};

// ============================================================================
// FAST CHAT - Quick Responses
// ============================================================================

export const fastChat = async (
  message: string,
  history: ChatMessage[] = []
): Promise<string> => {
  if (!checkAI() || !client) {
    return "AI not available. Please configure your API key.";
  }
  
  try {
    const messages: Anthropic.MessageParam[] = [
      ...history.map((msg) => ({
        role: msg.role === "assistant" ? "assistant" as const : "user" as const,
        content: msg.content,
      })),
      { role: "user" as const, content: message },
    ];

    const response = await client.messages.create({
      model: MODELS.QUICK, // Use Haiku for fast responses
      max_tokens: 1024,
      system: ORB_PERSONA_SYSTEM,
      messages,
    });

    return response.content[0].type === "text" 
      ? response.content[0].text 
      : "I'm not sure how to respond to that.";
  } catch (error) {
    console.error("Fast chat error:", error);
    return "Sorry, I encountered an error.";
  }
};

// ============================================================================
// GROUNDED SEARCH - Web Search Integration (Claude doesn't have built-in search)
// ============================================================================

export interface GroundedResponse {
  content: string;
  sources: GroundingSource[];
}

export const searchWithGrounding = async (
  query: string
): Promise<GroundedResponse> => {
  if (!checkAI() || !client) {
    return { content: "AI not available", sources: [] };
  }
  
  try {
    // Claude doesn't have built-in web search, so we'll respond based on knowledge
    const response = await client.messages.create({
      model: MODELS.FAST_CHAT,
      max_tokens: 2048,
      system: `You are a knowledgeable assistant. Answer the following question based on your training knowledge. Be clear that you're providing information from your training data, not live web results.`,
      messages: [{ role: "user", content: query }],
    });

    return {
      content: response.content[0].type === "text" 
        ? response.content[0].text 
        : "No results found.",
      sources: [], // Claude doesn't provide sources for regular queries
    };
  } catch (error) {
    console.error("Search error:", error);
    return {
      content: "Sorry, I couldn't perform the search.",
      sources: [],
    };
  }
};

// ============================================================================
// BEHAVIOR SCRIPT GENERATION
// ============================================================================

export const generateBehaviorScript = async (
  description: string,
  entityContext?: Partial<Entity>
): Promise<ThinkingResponse> => {
  const contextStr = entityContext
    ? `
Current Entity State:
- Name: ${entityContext.name || "Unknown"}
- Position: (${entityContext.position?.x || 0}, ${entityContext.position?.y || 0}, ${entityContext.position?.z || 0})
- Type: ${entityContext.type || "custom"}
- Current Script: ${entityContext.script || "none"}
`
    : "";

  return generateWithThinking(
    `Generate a behavior script for this request: "${description}"`,
    contextStr
  );
};

// ============================================================================
// TEXTURE GENERATION (Claude doesn't support image generation)
// ============================================================================

export interface TextureResult {
  diffuseBase64?: string;
  normalBase64?: string;
  error?: string;
}

export const generateTexture = async (
  description: string
): Promise<TextureResult> => {
  // Claude cannot generate images
  return { 
    error: "Image generation is not available with Claude. Consider using a dedicated image generation API." 
  };
};

// ============================================================================
// FUNCTION CALLING WITH TOOLS
// ============================================================================

export interface FunctionCallResult {
  response: string;
  functionCalls: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

// Define tools for Claude
const CLAUDE_TOOLS: Anthropic.Tool[] = [
  // ========== ORB CONTROL ==========
  {
    name: "moveOrb",
    description: "Move the Orb to a new position in the world. Use this when the user says 'come here', 'go there', or wants you to relocate.",
    input_schema: {
      type: "object" as const,
      properties: {
        x: { type: "number", description: "X world coordinate" },
        y: { type: "number", description: "Y world coordinate (height)" },
        z: { type: "number", description: "Z world coordinate" },
      },
      required: ["x", "y", "z"],
    },
  },
  {
    name: "setOrbMode",
    description: "Change the Orb's behavior mode. Use 'following' when user says 'follow me', 'idle' to stop following.",
    input_schema: {
      type: "object" as const,
      properties: {
        mode: { 
          type: "string", 
          description: "The mode to set",
          enum: ["idle", "thinking", "acting", "scanning", "following", "listening", "speaking"]
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "scanEnvironment",
    description: "Scan the area around the Orb to detect entities and blocks. Returns what's nearby.",
    input_schema: {
      type: "object" as const,
      properties: {
        radius: { type: "number", description: "Scan radius in blocks (default 20, max 50)" },
      },
      required: [],
    },
  },
  // ========== ENTITY MANAGEMENT ==========
  {
    name: "spawnEntity",
    description: "Spawn a new entity in the world with optional behavior script",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name of the entity" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        z: { type: "number", description: "Z position" },
        type: { type: "string", description: "Entity type: 'block', 'sphere', or 'custom'" },
        color: { type: "string", description: "Hex color code (e.g., '#ff0000')" },
        script: { type: "string", description: "JavaScript behavior script that runs each frame" },
      },
      required: ["name", "x", "y", "z", "type"],
    },
  },
  {
    name: "modifyEntity",
    description: "Modify properties of an existing entity",
    input_schema: {
      type: "object" as const,
      properties: {
        entityId: { type: "string", description: "ID of the entity to modify" },
        position: { type: "string", description: "New position as 'x,y,z'" },
        color: { type: "string", description: "New hex color" },
        script: { type: "string", description: "New behavior script" },
        visible: { type: "boolean", description: "Show/hide the entity" },
      },
      required: ["entityId"],
    },
  },
  {
    name: "deleteEntity",
    description: "Remove an entity from the world",
    input_schema: {
      type: "object" as const,
      properties: {
        entityId: { type: "string", description: "ID of the entity to delete" },
      },
      required: ["entityId"],
    },
  },
  // ========== BLOCK OPERATIONS ==========
  {
    name: "placeBlocksAbsolute",
    description: "Place blocks at absolute world coordinates. Use this for spatial commands like 'build here', 'place a block', etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        blocks: {
          type: "array",
          description: "Array of blocks to place",
          items: {
            type: "object",
            properties: {
              x: { type: "integer", description: "Absolute X world coordinate" },
              y: { type: "integer", description: "Absolute Y world coordinate" },
              z: { type: "integer", description: "Absolute Z world coordinate" },
              type: { type: "integer", description: "Block type: 1=Grass, 2=Dirt, 3=Stone, 4=Wood, 5=Leaf, 6=Plank, 7=Bedrock, 8=Water, 9=Sand, 10=Snow, 11=Sapling" },
            },
            required: ["x", "y", "z", "type"],
          },
        },
      },
      required: ["blocks"],
    },
  },
  {
    name: "placeBlocks",
    description: "Place blocks relative to the player's position (legacy, prefer placeBlocksAbsolute)",
    input_schema: {
      type: "object" as const,
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              x: { type: "integer" },
              y: { type: "integer" },
              z: { type: "integer" },
              type: { type: "integer" },
            },
            required: ["x", "y", "z", "type"],
          },
        },
      },
      required: ["blocks"],
    },
  },
  {
    name: "removeBlocks",
    description: "Remove blocks at specified absolute world positions",
    input_schema: {
      type: "object" as const,
      properties: {
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              x: { type: "integer" },
              y: { type: "integer" },
              z: { type: "integer" },
            },
            required: ["x", "y", "z"],
          },
        },
      },
      required: ["positions"],
    },
  },
  {
    name: "clearArea",
    description: "Clear all blocks in a 3D region between two corner positions",
    input_schema: {
      type: "object" as const,
      properties: {
        start: {
          type: "object",
          properties: { x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" } },
          required: ["x", "y", "z"],
        },
        end: {
          type: "object",
          properties: { x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" } },
          required: ["x", "y", "z"],
        },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "getBlockAt",
    description: "Check what block type exists at a position (returns null if empty)",
    input_schema: {
      type: "object" as const,
      properties: {
        x: { type: "integer" },
        y: { type: "integer" },
        z: { type: "integer" },
      },
      required: ["x", "y", "z"],
    },
  },
  {
    name: "getBlocksInArea",
    description: "Get all blocks within a cubic radius of a center point",
    input_schema: {
      type: "object" as const,
      properties: {
        centerX: { type: "integer" },
        centerY: { type: "integer" },
        centerZ: { type: "integer" },
        radius: { type: "integer", description: "Radius in blocks (max 10)" },
      },
      required: ["centerX", "centerY", "centerZ", "radius"],
    },
  },
  // ========== WORLD PHYSICS ==========
  {
    name: "setGravity",
    description: "Change the world's gravity. Default is 32. Use 0 for no gravity, higher for stronger.",
    input_schema: {
      type: "object" as const,
      properties: {
        value: { type: "number", description: "Gravity value (default 32, 0 = no gravity)" },
      },
      required: ["value"],
    },
  },
  // ========== BEHAVIOR SCRIPTS ==========
  {
    name: "generateBehaviorScript",
    description: "Generate a JavaScript behavior script for an entity based on a description",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "What the script should do (e.g., 'rotate slowly', 'bounce up and down')" },
        entityId: { type: "string", description: "Optional: ID of entity to apply the script to" },
      },
      required: ["description"],
    },
  },
  // ========== AUTONOMY CONTROL ==========
  {
    name: "setOrbAutonomy",
    description: "Enable or disable the Orb's autonomous behavior. When enabled, the Orb will move, explore, and act on its own goals.",
    input_schema: {
      type: "object" as const,
      properties: {
        enabled: { type: "boolean", description: "Whether to enable autonomous behavior" },
      },
      required: ["enabled"],
    },
  },
  {
    name: "addOrbGoal",
    description: "Add a goal for the autonomous Orb to pursue. Goals have priorities; higher priority goals are pursued first.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          description: "Goal type",
          enum: ["follow_player", "explore", "build", "gather", "observe", "idle", "investigate"]
        },
        priority: { type: "number", description: "Priority 1-10, higher = more important (default 5)" },
        description: { type: "string", description: "Human-readable description of the goal" },
        targetPosition: {
          type: "object",
          description: "Optional target position for the goal",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
      },
      required: ["type"],
    },
  },
  {
    name: "removeOrbGoal",
    description: "Remove a specific goal from the Orb by its ID",
    input_schema: {
      type: "object" as const,
      properties: {
        goalId: { type: "string", description: "ID of the goal to remove" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "clearOrbGoals",
    description: "Clear all goals from the Orb, stopping autonomous activity",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "getOrbState",
    description: "Get the current state of the autonomous Orb including position, mode, active goal, and whether it's moving",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

export const chatWithTools = async (
  message: string,
  history: ChatMessage[] = []
): Promise<FunctionCallResult> => {
  if (!checkAI() || !client) {
    return { response: "AI not available", functionCalls: [] };
  }
  
  try {
    const messages: Anthropic.MessageParam[] = [
      ...history.map((msg) => ({
        role: msg.role === "assistant" ? "assistant" as const : "user" as const,
        content: msg.content,
      })),
      { role: "user" as const, content: message },
    ];

    const response = await client.messages.create({
      model: MODELS.FAST_CHAT,
      max_tokens: 4096,
      system: ORB_PERSONA_SYSTEM,
      tools: CLAUDE_TOOLS,
      messages,
    });

    const functionCalls: FunctionCallResult["functionCalls"] = [];
    let responseText = "";

    for (const block of response.content) {
      if (block.type === "text") {
        responseText += block.text;
      } else if (block.type === "tool_use") {
        functionCalls.push({
          name: block.name,
          args: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      response: responseText,
      functionCalls,
    };
  } catch (error) {
    console.error("Tool chat error:", error);
    return {
      response: "Sorry, I encountered an error.",
      functionCalls: [],
    };
  }
};

// ============================================================================
// EXPORT CHECK FOR AI AVAILABILITY
// ============================================================================

export const isAIAvailable = (): boolean => checkAI();
