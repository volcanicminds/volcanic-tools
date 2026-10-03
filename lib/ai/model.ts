import type { LanguageModel } from 'ai'
import type { ModelConfig, ProviderName } from './types.js'
import { loadProvider } from './provider.js'

// Default env variable mapping per provider
const ENV_KEYS: Record<ProviderName, { apiKey: string; model: string; baseUrl?: string }> = {
  openai: { apiKey: 'OPENAI_API_KEY', model: 'OPENAI_MODEL' },
  mistral: { apiKey: 'MISTRAL_API_KEY', model: 'MISTRAL_MODEL' },
  google: { apiKey: 'GOOGLE_API_KEY', model: 'GOOGLE_MODEL' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_MODEL' },
  ollama: { apiKey: '', model: 'OLLAMA_MODEL', baseUrl: 'OLLAMA_BASE_URL' }
}

/**
 * Creates a LanguageModel from explicit config or environment variables.
 * Uses dynamic import() for tree-shaking: only the selected provider SDK is loaded.
 */
export async function createModel(config?: ModelConfig): Promise<LanguageModel> {
  // If config is provided, prefer it. Otherwise, look for AI_PROVIDER in env.
  const provider = (config?.provider ?? process.env.AI_PROVIDER) as ProviderName

  if (!provider) {
    throw new Error('AI_PROVIDER is not set and no config provided')
  }

  const defaultKeys = ENV_KEYS[provider]
  if (!defaultKeys) {
    throw new Error(`Unsupported AI Provider: ${provider}`)
  }

  // Resolve values: Config > Env > Default
  const modelName = config?.model || process.env[defaultKeys.model]
  const apiKey = config?.apiKey || (defaultKeys.apiKey ? process.env[defaultKeys.apiKey] : undefined)
  const baseUrl = config?.baseUrl || (defaultKeys.baseUrl ? process.env[defaultKeys.baseUrl] : undefined)

  if (!modelName) {
    throw new Error(`Model name is required for provider ${provider}`)
  }

  return (await loadProvider(provider, { apiKey, baseUrl })).languageModel(modelName)
}
