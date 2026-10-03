import type { Provider } from 'ai'
import type { ProviderName } from './types.js'

export interface ProviderCredentials {
  apiKey?: string
  baseUrl?: string
}

/**
 * The provider SDK for a name, configured with the given credentials, for chat and embedding
 * models alike. Imported on demand, so only the selected SDK loads.
 *
 * Always through the SDK's `create*` factory: its default instance (`openai`, `anthropic`, ...)
 * takes the model id only and reads its own environment variable, so a key passed to it is
 * silently ignored.
 */
export async function loadProvider(name: ProviderName, { apiKey, baseUrl }: ProviderCredentials): Promise<Provider> {
  if (name !== 'ollama' && !apiKey) throw new Error(`Missing API Key for ${name}`)

  switch (name) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey, baseURL: baseUrl })
    }
    case 'mistral': {
      const { createMistral } = await import('@ai-sdk/mistral')
      return createMistral({ apiKey, baseURL: baseUrl })
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl })
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey, baseURL: baseUrl })
    }
    case 'ollama': {
      const { createOllama } = await import('ai-sdk-ollama')
      return createOllama(baseUrl ? { baseURL: baseUrl } : {})
    }
    default: {
      const unknown: never = name
      throw new Error(`Unsupported AI Provider: ${unknown}`)
    }
  }
}
