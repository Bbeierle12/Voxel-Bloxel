/**
 * WorldAI - Local Gemma-powered intelligence for the WorldMind
 *
 * Uses Hugging Face Transformers.js to run AI locally in the browser.
 * No API keys needed - the model runs entirely on the client.
 *
 * The AI acts as the "consciousness" of the world, occasionally
 * making creative decisions about what should happen.
 */

import { pipeline, env } from '@huggingface/transformers';
import { Vector3, ItemType } from '../../types';
import { WorldPerception } from './environmentRules';

// Configure Transformers.js for browser use
env.allowLocalModels = false;
env.useBrowserCache = true;

// World event types the AI can trigger
export type WorldEventType =
  | 'spawn_water_spring'    // Create a water source
  | 'lightning_strike'      // Start a fire
  | 'plant_seeds'           // Scatter saplings
  | 'erosion'               // Convert stone to dirt
  | 'growth_surge'          // Boost tree growth
  | 'weather_change'        // Announce weather (cosmetic)
  | 'nothing';              // No action

export interface WorldAIDecision {
  event: WorldEventType;
  position?: Vector3;
  intensity?: number;  // 0-1, how strong the effect
  reason?: string;     // Why the AI made this decision
}

export interface WorldAIConfig {
  enabled: boolean;
  thinkInterval: number;  // How often AI thinks (ms)
  creativityLevel: number; // 0-1, how often to trigger events
  useLocalModel: boolean;  // Whether to use local AI model
  modelId: string;         // Hugging Face model ID
}

// Biome classification based on block composition
export type BiomeType = 'forest' | 'plains' | 'desert' | 'snow' | 'water' | 'mixed';

/**
 * Analyze the world perception and classify the biome
 */
export function classifyBiome(perception: WorldPerception): BiomeType {
  const total = perception.totalBlocks || 1;
  const treeBlocks = perception.woodBlocks.length + perception.leafBlocks.length;
  const waterBlocks = perception.waterBlocks.length;
  const grassBlocks = perception.grassBlocks.length;
  const sandBlocks = perception.allBlocks.filter(b => b.type === ItemType.SAND).length;
  const snowBlocks = perception.allBlocks.filter(b => b.type === ItemType.SNOW).length;

  // Calculate percentages
  const treePercent = treeBlocks / total;
  const waterPercent = waterBlocks / total;
  const sandPercent = sandBlocks / total;
  const snowPercent = snowBlocks / total;

  if (snowPercent > 0.3) return 'snow';
  if (waterPercent > 0.3) return 'water';
  if (sandPercent > 0.3) return 'desert';
  if (treePercent > 0.2) return 'forest';
  if (grassBlocks > total * 0.4) return 'plains';

  return 'mixed';
}

/**
 * Generate a world state summary for AI context
 */
export function generateWorldSummary(perception: WorldPerception): string {
  const biome = classifyBiome(perception);
  const timeStr = perception.timeOfDay < 0.25 ? 'night' :
                  perception.timeOfDay < 0.5 ? 'morning' :
                  perception.timeOfDay < 0.75 ? 'afternoon' : 'evening';

  return `Biome:${biome} Time:${timeStr} Trees:${perception.woodBlocks.length} Water:${perception.waterBlocks.length} Fire:${perception.fireBlocks.length}`;
}

/**
 * WorldAI - The thinking layer of the world
 * Uses Transformers.js for local AI inference - no API keys needed!
 */
export class WorldAI {
  private config: WorldAIConfig;
  private lastThinkTime: number = 0;
  private thinkCount: number = 0;
  private generator: unknown = null;
  private isModelLoading: boolean = false;
  private isModelReady: boolean = false;
  private loadProgress: number = 0;
  private loadError: string | null = null;
  private lastAIDecision: WorldAIDecision | null = null;

  constructor(config: Partial<WorldAIConfig> = {}) {
    this.config = {
      enabled: true,
      thinkInterval: 10000, // Think every 10 seconds
      creativityLevel: 0.3, // 30% chance to do something interesting
      useLocalModel: true,
      // Use a small model suitable for browser inference
      // Qwen2 0.5B is tiny (~500MB) and runs well in browser
      modelId: 'Qwen/Qwen2.5-0.5B-Instruct',
      ...config,
    };

    // Start loading the model in the background
    if (this.config.useLocalModel) {
      this.loadModel();
    }
  }

  /**
   * Load the AI model asynchronously in the background
   */
  private async loadModel(): Promise<void> {
    if (this.isModelLoading || this.isModelReady) return;

    this.isModelLoading = true;
    this.loadError = null;
    console.log('[WorldAI] 🧠 Loading local AI model:', this.config.modelId);
    console.log('[WorldAI] Model will be cached in browser after first download');

    try {
      // Create the text generation pipeline
      // Using a small model that works well in browser
      this.generator = await pipeline('text-generation', this.config.modelId, {
        dtype: 'q4',  // Use 4-bit quantization for smaller size
        progress_callback: (progress: { progress?: number; status?: string; file?: string }) => {
          if (progress.progress !== undefined) {
            this.loadProgress = progress.progress;
            if (progress.file) {
              console.log(`[WorldAI] Downloading ${progress.file}: ${(this.loadProgress * 100).toFixed(1)}%`);
            }
          }
        },
      });

      this.isModelReady = true;
      this.isModelLoading = false;
      console.log('[WorldAI] ✨ Local AI loaded! The world now thinks for itself.');
    } catch (error) {
      this.isModelLoading = false;
      this.loadError = String(error);
      console.warn('[WorldAI] Failed to load model, using rule-based intelligence:', error);
    }
  }

  /**
   * Should the AI think this tick?
   */
  shouldThink(): boolean {
    if (!this.config.enabled) return false;
    const now = Date.now();
    if (now - this.lastThinkTime < this.config.thinkInterval) return false;
    return true;
  }

  /**
   * Make a decision about what should happen in the world
   */
  think(perception: WorldPerception): WorldAIDecision {
    this.lastThinkTime = Date.now();
    this.thinkCount++;

    // If we have a pending AI decision from last cycle, use it
    if (this.lastAIDecision && this.lastAIDecision.event !== 'nothing') {
      const decision = this.lastAIDecision;
      this.lastAIDecision = null;
      return decision;
    }

    // If model is ready, start async inference for next cycle
    if (this.isModelReady && this.generator) {
      this.thinkWithLocalModel(perception);
    }

    // Return rule-based decision synchronously
    return this.thinkWithRules(perception);
  }

  /**
   * Async local model inference (runs in background, result used next cycle)
   */
  private async thinkWithLocalModel(perception: WorldPerception): Promise<void> {
    if (!this.generator) return;

    try {
      const worldSummary = generateWorldSummary(perception);

      // Simple, focused prompt for fast inference
      const prompt = `<|im_start|>system
You are a nature spirit. Given world state, pick ONE action: nothing, water, lightning, seeds, growth. Usually pick nothing.
<|im_end|>
<|im_start|>user
${worldSummary}
Action:<|im_end|>
<|im_start|>assistant
`;

      const result = await (this.generator as CallableFunction)(prompt, {
        max_new_tokens: 10,
        temperature: 0.7,
        do_sample: true,
        return_full_text: false,
      });

      // Parse the response
      const output = Array.isArray(result) ? result[0] : result;
      const text = ((output as { generated_text?: string }).generated_text || '').toLowerCase().trim();

      // Extract event from response
      const event = this.parseEvent(text);

      if (event !== 'nothing') {
        console.log(`[WorldAI/Local] 🌍 Decision: ${event}`);
        this.lastAIDecision = {
          event,
          position: this.findPositionForEvent(event, perception),
          intensity: 0.5,
          reason: `Local AI chose: ${text.slice(0, 30)}`,
        };
      }
    } catch (error) {
      // Silently fail - rule-based system will handle it
      console.debug('[WorldAI] Inference cycle skipped:', error);
    }
  }

  /**
   * Parse event from model output
   */
  private parseEvent(text: string): WorldEventType {
    const t = text.toLowerCase();

    if (t.includes('water') || t.includes('spring') || t.includes('rain')) return 'spawn_water_spring';
    if (t.includes('lightning') || t.includes('storm') || t.includes('thunder')) return 'lightning_strike';
    if (t.includes('seed') || t.includes('plant') || t.includes('sapling')) return 'plant_seeds';
    if (t.includes('grow') || t.includes('bloom') || t.includes('flourish')) return 'growth_surge';
    if (t.includes('erode') || t.includes('erosion') || t.includes('weather')) return 'erosion';

    return 'nothing';
  }

  /**
   * Find appropriate position for a given event type
   */
  private findPositionForEvent(event: WorldEventType, perception: WorldPerception): Vector3 {
    switch (event) {
      case 'spawn_water_spring':
        return this.findRandomPosition(perception, 'low_ground');
      case 'lightning_strike':
        return this.findRandomPosition(perception, 'near_tree');
      case 'plant_seeds':
        return this.findRandomPosition(perception, 'near_tree');
      case 'erosion':
        return this.findRandomPosition(perception, 'open_area');
      case 'growth_surge':
        return this.findRandomPosition(perception, 'near_tree');
      default:
        return perception.playerPosition;
    }
  }

  /**
   * Rule-based decision making (works while model loads or as fallback)
   */
  private thinkWithRules(perception: WorldPerception): WorldAIDecision {
    // Random chance to do nothing (keeps world calm most of the time)
    if (Math.random() > this.config.creativityLevel) {
      return { event: 'nothing', reason: 'World is peaceful' };
    }

    const biome = classifyBiome(perception);
    const isNight = perception.timeOfDay > 0.8 || perception.timeOfDay < 0.2;
    const hasFire = perception.fireBlocks.length > 0;
    const hasWater = perception.waterBlocks.length > 0;
    const hasTrees = perception.woodBlocks.length > 5;
    const hasSaplings = perception.saplingBlocks.length > 0;

    // Decision logic based on world state
    const decisions: Array<{ weight: number; decision: WorldAIDecision }> = [];

    // Night-time events
    if (isNight && !hasFire && Math.random() < 0.1) {
      decisions.push({
        weight: 0.1,
        decision: {
          event: 'lightning_strike',
          position: this.findRandomPosition(perception, 'near_tree'),
          intensity: 0.3,
          reason: 'A storm passes through the night',
        },
      });
    }

    // Dry areas could use water
    if (biome === 'plains' && !hasWater && Math.random() < 0.15) {
      decisions.push({
        weight: 0.15,
        decision: {
          event: 'spawn_water_spring',
          position: this.findRandomPosition(perception, 'low_ground'),
          intensity: 0.5,
          reason: 'A spring bubbles up from the ground',
        },
      });
    }

    // Forested areas spread seeds
    if (biome === 'forest' && hasTrees && !hasSaplings && Math.random() < 0.2) {
      decisions.push({
        weight: 0.2,
        decision: {
          event: 'plant_seeds',
          position: this.findRandomPosition(perception, 'near_tree'),
          intensity: 0.4,
          reason: 'Seeds scatter in the wind',
        },
      });
    }

    // Morning growth surge
    if (perception.timeOfDay > 0.2 && perception.timeOfDay < 0.4 && hasSaplings) {
      decisions.push({
        weight: 0.25,
        decision: {
          event: 'growth_surge',
          intensity: 0.7,
          reason: 'Morning light accelerates growth',
        },
      });
    }

    // Pick a decision based on weights
    if (decisions.length === 0) {
      return { event: 'nothing', reason: 'World observes quietly' };
    }

    // Weighted random selection
    const totalWeight = decisions.reduce((sum, d) => sum + d.weight, 0);
    let random = Math.random() * totalWeight;
    for (const d of decisions) {
      random -= d.weight;
      if (random <= 0) {
        return d.decision;
      }
    }

    return decisions[0].decision;
  }

  /**
   * Find a random position based on criteria
   */
  private findRandomPosition(
    perception: WorldPerception,
    criteria: 'near_tree' | 'low_ground' | 'open_area'
  ): Vector3 {
    const player = perception.playerPosition;

    switch (criteria) {
      case 'near_tree': {
        if (perception.woodBlocks.length > 0) {
          const tree = perception.woodBlocks[Math.floor(Math.random() * perception.woodBlocks.length)];
          return {
            x: tree.position.x + Math.floor(Math.random() * 5 - 2),
            y: tree.position.y,
            z: tree.position.z + Math.floor(Math.random() * 5 - 2),
          };
        }
        break;
      }
      case 'low_ground': {
        // Find lowest y position in grass/dirt blocks
        const groundBlocks = [...perception.grassBlocks, ...perception.dirtBlocks];
        if (groundBlocks.length > 0) {
          const sorted = groundBlocks.sort((a, b) => a.position.y - b.position.y);
          const low = sorted[Math.floor(Math.random() * Math.min(5, sorted.length))];
          return { ...low.position, y: low.position.y + 1 };
        }
        break;
      }
      case 'open_area': {
        // Random position near player
        return {
          x: player.x + Math.floor(Math.random() * 20 - 10),
          y: player.y,
          z: player.z + Math.floor(Math.random() * 20 - 10),
        };
      }
    }

    // Default: near player
    return {
      x: player.x + Math.floor(Math.random() * 16 - 8),
      y: 1,
      z: player.z + Math.floor(Math.random() * 16 - 8),
    };
  }

  /**
   * Get statistics and loading status
   */
  getStats(): {
    thinkCount: number;
    enabled: boolean;
    modelReady: boolean;
    modelLoading: boolean;
    loadProgress: number;
    modelId: string;
  } {
    return {
      thinkCount: this.thinkCount,
      enabled: this.config.enabled,
      modelReady: this.isModelReady,
      modelLoading: this.isModelLoading,
      loadProgress: this.loadProgress,
      modelId: this.config.modelId,
    };
  }

  /**
   * Check if the local model is ready
   */
  isLocalModelReady(): boolean {
    return this.isModelReady;
  }

  /**
   * Get model loading progress (0-1)
   */
  getLoadProgress(): number {
    return this.loadProgress;
  }

  /**
   * Enable/disable the AI
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}

// Singleton instance
let worldAIInstance: WorldAI | null = null;

export function createWorldAI(config?: Partial<WorldAIConfig>): WorldAI {
  worldAIInstance = new WorldAI(config);
  return worldAIInstance;
}

export function getWorldAI(): WorldAI | null {
  return worldAIInstance;
}