import type { EmbeddingModel } from 'ai'
import type { EmbedderConfig, ProviderName } from './types.js'

// Per-provider env mapping for embedding models (mirrors model.ts conventions).
const ENV_KEYS: Record<ProviderName, { apiKey: string; model: string; baseUrl?: string }> = {
  openai: { apiKey: 'OPENAI_API_KEY', model: 'OPENAI_EMBEDDING_MODEL' },
  mistral: { apiKey: 'MISTRAL_API_KEY', model: 'MISTRAL_EMBEDDING_MODEL' },
  google: { apiKey: 'GOOGLE_API_KEY', model: 'GOOGLE_EMBEDDING_MODEL' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_EMBEDDING_MODEL' },
  ollama: { apiKey: '', model: 'OLLAMA_EMBEDDING_MODEL', baseUrl: 'OLLAMA_BASE_URL' }
}

// Different ai-sdk provider packages expose the embedding factory under slightly
// different names across versions — resolve whichever is present.
function resolveEmbeddingModel(providerFactory: any, modelName: string): EmbeddingModel {
  const fn =
    providerFactory?.textEmbeddingModel ?? providerFactory?.embedding ?? providerFactory?.textEmbedding
  if (typeof fn !== 'function') {
    throw new Error('Selected provider SDK does not expose a text-embedding factory')
  }
  return fn.call(providerFactory, modelName) as EmbeddingModel
}

/**
 * Creates an embedding model from explicit config or environment variables.
 * Uses dynamic import() for tree-shaking — only the selected provider SDK loads.
 *
 * Resolution order: config > env. The embedding provider can differ from the
 * chat provider via AI_EMBEDDING_PROVIDER (falls back to AI_PROVIDER).
 */
export async function createEmbedder(config?: EmbedderConfig): Promise<EmbeddingModel> {
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

  switch (provider) {
    case 'openai': {
      if (!apiKey) throw new Error(`Missing API Key for ${provider}`)
      // @ts-expect-error optional provider SDK (dynamic import)
      const { createOpenAI } = await import('@ai-sdk/openai')
      return resolveEmbeddingModel(createOpenAI({ apiKey }), modelName)
    }
    case 'mistral': {
      if (!apiKey) throw new Error(`Missing API Key for ${provider}`)
      const { createMistral } = await import('@ai-sdk/mistral')
      return resolveEmbeddingModel(createMistral({ apiKey }), modelName)
    }
    case 'google': {
      if (!apiKey) throw new Error(`Missing API Key for ${provider}`)
      // @ts-expect-error optional provider SDK (dynamic import)
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return resolveEmbeddingModel(createGoogleGenerativeAI({ apiKey }), modelName)
    }
    case 'ollama': {
      const { createOllama } = await import('ai-sdk-ollama')
      const factory = baseUrl ? createOllama({ baseURL: baseUrl }) : createOllama({})
      return resolveEmbeddingModel(factory, modelName)
    }
    default:
      throw new Error(`Provider ${provider} embedding implementation missing`)
  }
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
  // A ready EmbeddingModel is an object exposing specificationVersion/modelId;
  // anything else is treated as config.
  if (modelOrConfig && typeof (modelOrConfig as any).modelId === 'string') {
    return modelOrConfig as EmbeddingModel
  }
  return createEmbedder(modelOrConfig as EmbedderConfig | undefined)
}
