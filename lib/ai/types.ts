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
