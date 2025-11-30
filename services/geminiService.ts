// Re-export everything from Claude service for backwards compatibility
// The app was originally built for Gemini but now uses Claude

export {
  MODELS,
  generateStructure,
  generateWithThinking,
  generateAgentPlan,
  fastChat,
  searchWithGrounding,
  generateBehaviorScript,
  generateTexture,
  chatWithTools,
  isAIAvailable,
} from "./claudeService";

export type {
  ThinkingResponse,
  GroundedResponse,
  TextureResult,
  FunctionCallResult,
} from "./claudeService";

