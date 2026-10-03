import type { LanguageModel, ToolLoopAgent, ToolLoopAgentSettings, ToolSet } from 'ai'
import type { AgentConfig, ModelConfig, NoTools } from './types.js'
import { createModel } from './model.js'
import { ensureTelemetry } from './telemetry.js'

// A model has a `provider` too (`openai.chat`), so only the specification version tells them apart.
function isModelConfig(model: LanguageModel | ModelConfig): model is ModelConfig {
  return typeof model === 'object' && !('specificationVersion' in model)
}

/**
 * The AI SDK's `ToolLoopAgent`, wired the Volcanic way and returned as it is: the model from a
 * config or the environment (`createModel`), and the agent's name as the `functionId` of its
 * telemetry, so its spans are grouped by agent. Every other setting is the SDK's own.
 */
export async function createAgent<CALL_OPTIONS = never, TOOLS extends ToolSet = NoTools>(
  config: AgentConfig<CALL_OPTIONS, TOOLS>
): Promise<ToolLoopAgent<CALL_OPTIONS, TOOLS>> {
  await ensureTelemetry()
  const { ToolLoopAgent } = await import('ai')
  const { name, model, telemetry, ...settings } = config
  const resolved = isModelConfig(model) ? await createModel(model) : model
  return new ToolLoopAgent<CALL_OPTIONS, TOOLS>({
    ...settings,
    id: name,
    model: resolved,
    telemetry: { functionId: name, ...telemetry }
    // `toolsContext` is a conditional type on TOOLS, which TypeScript cannot resolve inside a
    // generic body; the caller's config is checked against it with TOOLS known.
  } as ToolLoopAgentSettings<CALL_OPTIONS, TOOLS>)
}
