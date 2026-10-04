import type { LanguageModel, ToolLoopAgent, ToolLoopAgentSettings, ToolSet } from 'ai'
import type { AgentConfig, CallerAgentConfig, ModelConfig, NoTools } from './types.js'
import type { ToolDefinition } from './tool.js'
import { callerContext, hasCaller, toAiTools, type AiTools, type CallerContext } from './tool-set.js'
import { createModel } from './model.js'
import { ensureTelemetry } from './telemetry.js'

// Written by `createAgent` for tools from `defineTool`; one set by the application would be lost.
const CALLER_WIRING = ['toolsContext', 'callOptionsSchema', 'prepareCall'] as const

// A model has a `provider` too (`openai.chat`), so only the specification version tells them apart.
function isModelConfig(model: LanguageModel | ModelConfig): model is ModelConfig {
  return typeof model === 'object' && !('specificationVersion' in model)
}

/**
 * The AI SDK's `ToolLoopAgent`, wired the Volcanic way and returned as it is: the model from a
 * config or the environment (`createModel`), and the agent's name as the `functionId` of its
 * telemetry, so its spans are grouped by agent. Every other setting is the SDK's own.
 *
 * With tools from `defineTool` the agent is built once and acts for the caller of each call,
 * `agent.generate({ prompt, options: { caller } })`, so an agent shared between requests holds
 * nobody's credential.
 */
export async function createAgent<const DEFS extends readonly ToolDefinition[]>(
  config: CallerAgentConfig<DEFS>
): Promise<ToolLoopAgent<CallerContext, AiTools<DEFS>>>
export async function createAgent<CALL_OPTIONS = never, TOOLS extends ToolSet = NoTools>(
  config: AgentConfig<CALL_OPTIONS, TOOLS>
): Promise<ToolLoopAgent<CALL_OPTIONS, TOOLS>>
export async function createAgent(
  config: AgentConfig<unknown, ToolSet> | CallerAgentConfig<readonly ToolDefinition[]>
): Promise<unknown> {
  await ensureTelemetry()
  const { ToolLoopAgent } = await import('ai')
  const { name, model, telemetry, ...settings } = config
  const resolved = isModelConfig(model) ? await createModel(model) : model
  const agentSettings = { ...settings, id: name, model: resolved, telemetry: { functionId: name, ...telemetry } }
  // `toolsContext` is a conditional type on TOOLS, which TypeScript cannot resolve inside a generic
  // body; the caller's config is checked against it with TOOLS known.
  if (!Array.isArray(settings.tools)) return new ToolLoopAgent(agentSettings as ToolLoopAgentSettings<unknown, ToolSet>)

  const definitions = settings.tools as readonly ToolDefinition[]
  const taken = CALLER_WIRING.filter((key) => (settings as Record<string, unknown>)[key] !== undefined)
  if (taken.length) {
    throw new Error(`Agent '${name}': ${taken.join(', ')} carry the caller of tools from defineTool, so createAgent writes them`)
  }
  return new ToolLoopAgent({
    ...agentSettings,
    tools: toAiTools(definitions),
    // The SDK checks call options only when a call passes some, so the check is here: a call
    // without a caller fails before the model runs.
    prepareCall: ({ options, ...call }) => {
      if (!hasCaller(options)) throw new Error(`Agent '${name}': no caller, pass options: { caller } with the call`)
      return { ...call, toolsContext: callerContext(definitions, options.caller) }
    }
  } as ToolLoopAgentSettings<unknown, ToolSet>)
}
