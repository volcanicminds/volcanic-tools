import type { LanguageModel } from 'ai'
import type { ModelConfig, ProviderName } from './types.js'

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
 * Uses dynamic import() for tree-shaking — only the selected provider SDK is loaded.
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

  switch (provider) {
    case 'openai': {
      if (!apiKey) throw new Error(`Missing API Key for ${provider}`)
      // @ts-expect-error dynamic import
      const { openai } = await import('@ai-sdk/openai')
      return openai(modelName, { apiKey }) as LanguageModel
    }

    case 'mistral': {
      if (!apiKey) throw new Error(`Missing API Key for ${provider}`)
      const { createMistral } = await import('@ai-sdk/mistral')
      console.log('DEBUG: createMistral factory loaded', !!createMistral)
      const mistral = createMistral({ apiKey })
      console.log('DEBUG: mistral provider created', !!mistral)
      return mistral(modelName) as LanguageModel
    }

    case 'ollama': {
      const { ollama } = await import('ai-sdk-ollama')
      // Ollama behaves differently if baseUrl is provided
      if (baseUrl) {
        // Need to configure the provider if custom URL is used
        // However, the standard `ollama(model)` call usually respects OLLAMA_BASE_URL env var if set
        // Or we might need to instantiate a custom Ollama provider.
        // For simplicity with the standard library wrapper:
        process.env.OLLAMA_BASE_URL = baseUrl // Force env var for the library
      }
      return ollama(modelName) as LanguageModel
    }

    case 'google': {
      if (!apiKey) throw new Error(`Missing API Key for ${provider}`)
      // @ts-expect-error dynamic import
      const { google } = await import('@ai-sdk/google')
      return google(modelName, { apiKey }) as LanguageModel
    }

    case 'anthropic': {
      if (!apiKey) throw new Error(`Missing API Key for ${provider}`)
      // @ts-expect-error dynamic import
      const { anthropic } = await import('@ai-sdk/anthropic')
      return anthropic(modelName, { apiKey }) as LanguageModel
    }

    default:
      throw new Error(`Provider ${provider} implementation mapping missing`)
  }
}
