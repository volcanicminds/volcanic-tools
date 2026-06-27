// Volcanic AI API
export { createModel } from './model.js'
export { createAgent } from './agent.js'
export { ConcurrencyGuard, ConcurrencyQueueError } from './concurrency.js'
export { createEmbedder, embedText, embedTexts } from './embeddings.js'
export { PgVectorStore } from './vector-store.js'
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

// Mastra Re-exports
// Users should import directly from @mastra/core as it is a peer dependency
// export * from '@mastra/core'
