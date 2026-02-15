import { Agent } from '@mastra/core/agent'
import type { LanguageModel } from 'ai'
import type { AgentConfig, ModelConfig } from './types.js'
import { createModel } from './model.js'

function isModelConfig(model: LanguageModel | ModelConfig): model is ModelConfig {
  return (model as ModelConfig).provider !== undefined
}

/**
 * Creates a Mastra Agent with Volcanic configuration patterns.
 * Automatically resolves the model from config or environment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createAgent(config: AgentConfig): Promise<any> {
  // Resolve the model: if it's a ModelConfig -> createModel(), otherwise use it directly
  const model = isModelConfig(config.model) ? await createModel(config.model) : config.model

  return new Agent({
    id: config.name, // Use name as ID for simplicity
    name: config.name,
    instructions: config.instructions,
    model: model as any,
    // Mastra tools type is generic Record<string, ToolAction<...>> but we use unknown here for flexibility
    // Consumers should ensure tools are valid Mastra tools
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: config.tools as any
  })
}
