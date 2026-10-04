import type { LanguageModel, ToolLoopAgentSettings, ToolSet } from 'ai'
import type { ToolDefinition } from './tool.js'
import type { AiTools, CallerContext } from './tool-set.js'

export type ProviderName = 'openai' | 'mistral' | 'ollama' | 'google' | 'anthropic'

export interface ModelConfig {
  provider: ProviderName
  model: string              // e.g. 'gpt-4o', 'mistral-medium', 'llama3'
  apiKey?: string            // Per provider cloud (non serve per ollama)
  baseUrl?: string           // Per ollama o endpoint custom
}

// The SDK's own default for an agent's tools, so an agent without tools has the SDK's type.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NoTools = {}

// The settings of the SDK's `ToolLoopAgent`, with a name in place of `id` and a model that may
// be a config.
export type AgentConfig<CALL_OPTIONS = never, TOOLS extends ToolSet = NoTools> = Omit<
  ToolLoopAgentSettings<CALL_OPTIONS, TOOLS>,
  'id' | 'model'
> & {
  name: string
  model: LanguageModel | ModelConfig
}

// An agent whose tools come from `defineTool`. The caller is an option of each call, so the
// settings hold no identity; `createAgent` writes the wiring it takes out.
export type CallerAgentConfig<DEFS extends readonly ToolDefinition[]> = Omit<
  ToolLoopAgentSettings<CallerContext, AiTools<DEFS>>,
  'id' | 'model' | 'tools' | 'toolsContext' | 'callOptionsSchema' | 'prepareCall'
> & {
  name: string
  model: LanguageModel | ModelConfig
  tools: DEFS
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
