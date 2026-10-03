import type { EmbeddingModel } from 'ai'
import type { EmbedderConfig, ProviderName } from './types.js'
import { loadProvider } from './provider.js'
import { ensureTelemetry } from './telemetry.js'

// Per-provider env mapping for embedding models (mirrors model.ts conventions).
const ENV_KEYS: Record<ProviderName, { apiKey: string; model: string; baseUrl?: string }> = {
  openai: { apiKey: 'OPENAI_API_KEY', model: 'OPENAI_EMBEDDING_MODEL' },
  mistral: { apiKey: 'MISTRAL_API_KEY', model: 'MISTRAL_EMBEDDING_MODEL' },
  google: { apiKey: 'GOOGLE_API_KEY', model: 'GOOGLE_EMBEDDING_MODEL' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_EMBEDDING_MODEL' },
  ollama: { apiKey: '', model: 'OLLAMA_EMBEDDING_MODEL', baseUrl: 'OLLAMA_BASE_URL' }
}

/**
 * Creates an embedding model from explicit config or environment variables.
 * Uses dynamic import() for tree-shaking: only the selected provider SDK loads.
 *
 * Resolution order: config > env. The embedding provider can differ from the
 * chat provider via AI_EMBEDDING_PROVIDER (falls back to AI_PROVIDER).
 */
export async function createEmbedder(config?: EmbedderConfig): Promise<EmbeddingModel> {
  await ensureTelemetry()
  const provider = (config?.provider ??
    process.env.AI_EMBEDDING_PROVIDER ??
    process.env.AI_PROVIDER) as ProviderName

  if (!provider) {
    throw new Error('AI_EMBEDDING_PROVIDER/AI_PROVIDER is not set and no config provided')
  }

  const defaultKeys = ENV_KEYS[provider]
  if (!defaultKeys) {
    throw new Error(`Unsupported AI Provider: ${provider}`)
  }

  if (provider === 'anthropic') {
    throw new Error('Anthropic does not provide an embeddings API; use openai, mistral, google or ollama')
  }

  const modelName = config?.model || process.env[defaultKeys.model]
  const apiKey = config?.apiKey || (defaultKeys.apiKey ? process.env[defaultKeys.apiKey] : undefined)
  const baseUrl = config?.baseUrl || (defaultKeys.baseUrl ? process.env[defaultKeys.baseUrl] : undefined)

  if (!modelName) {
    throw new Error(`Embedding model name is required for provider ${provider}`)
  }

  return (await loadProvider(provider, { apiKey, baseUrl })).embeddingModel(modelName)
}

/**
 * Embeds a single string into a vector. Accepts a ready EmbeddingModel or a
 * config (resolved via createEmbedder).
 */
export async function embedText(
  text: string,
  modelOrConfig?: EmbeddingModel | EmbedderConfig
): Promise<number[]> {
  const { embed } = await import('ai')
  const model = await toModel(modelOrConfig)
  const { embedding } = await embed({ model, value: text })
  return embedding
}

/**
 * Embeds many strings in one batched call.
 */
export async function embedTexts(
  texts: string[],
  modelOrConfig?: EmbeddingModel | EmbedderConfig
): Promise<number[][]> {
  const { embedMany } = await import('ai')
  const model = await toModel(modelOrConfig)
  const { embeddings } = await embedMany({ model, values: texts })
  return embeddings
}

async function toModel(
  modelOrConfig?: EmbeddingModel | EmbedderConfig
): Promise<EmbeddingModel> {
  await ensureTelemetry()
  // A ready EmbeddingModel is an object exposing specificationVersion/modelId;
  // anything else is treated as config.
  if (modelOrConfig && typeof (modelOrConfig as any).modelId === 'string') {
    return modelOrConfig as EmbeddingModel
  }
  return createEmbedder(modelOrConfig as EmbedderConfig | undefined)
}
