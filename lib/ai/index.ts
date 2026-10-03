// Volcanic AI API
export { createModel } from './model.js'
export { createAgent } from './agent.js'
export { ConcurrencyGuard, ConcurrencyQueueError } from './concurrency.js'
export { createEmbedder, embedText, embedTexts } from './embeddings.js'
export { PgVectorStore } from './vector-store.js'
export { defineTool, ToolError, ToolCallError, isToolError } from './tool.js'
export { toAiTools, callerContext } from './tool-set.js'
export type { ApiCaller, ApiMethod, ApiRequest, ApiResponse, ToolContext, ToolDefinition, ToolInputSchema } from './tool.js'
export type { AiTools, AiCallerContext, CallerContext } from './tool-set.js'
export type {
  ModelConfig,
  AgentConfig,
  ProviderName,
  ConcurrencyConfig,
  EmbedderConfig,
  VectorDistance,
  VectorStoreConfig,
  VectorMatch
} from './types.js'
