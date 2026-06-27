import type { LanguageModel } from 'ai'

export type ProviderName = 'openai' | 'mistral' | 'ollama' | 'google' | 'anthropic'

export interface ModelConfig {
  provider: ProviderName
  model: string              // e.g. 'gpt-4o', 'mistral-medium', 'llama3'
  apiKey?: string            // Per provider cloud (non serve per ollama)
  baseUrl?: string           // Per ollama o endpoint custom
}

export interface AgentConfig {
  name: string
  instructions: string
  model: LanguageModel | ModelConfig  // Flessibile: modello già creato o config
  tools?: Record<string, unknown>     // Mastra-compatible tools
}

export interface ConcurrencyConfig {
  [provider: string]: number   // e.g. { mistral: 10, ollama: 2 }
}

// --- Embeddings & vector search -------------------------------------------

export interface EmbedderConfig {
  provider?: ProviderName     // default: process.env.AI_EMBEDDING_PROVIDER ?? AI_PROVIDER
  model?: string             // default: per-provider env (e.g. OPENAI_EMBEDDING_MODEL)
  apiKey?: string
  baseUrl?: string
}

// Distance operators exposed by pgvector.
//   'l2'     -> '<->'  (Euclidean)
//   'cosine' -> '<=>'
//   'ip'     -> '<#>'  (negative inner product)
export type VectorDistance = 'l2' | 'cosine' | 'ip'

export interface VectorStoreConfig {
  // Any pg-compatible executor: TypeORM `dataSource.query`, a PGlite instance's
  // `query`, or a node-postgres pool's `query`. Keeps this layer engine-agnostic
  // (works the same on a real Postgres and on embedded PGlite).
  query: (sql: string, params?: unknown[]) => Promise<any>
  table?: string             // default 'embeddings'
  dimensions: number         // size of the embedding vectors (provider-dependent)
  distance?: VectorDistance  // default 'cosine'
  schema?: string            // optional schema qualifier (multi-tenant)
}

export interface VectorMatch {
  id: string
  content: string
  metadata: Record<string, unknown> | null
  distance: number
}
