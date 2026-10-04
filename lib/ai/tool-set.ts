import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Tool } from 'ai'
import { assertUniqueNames, bindCaller, runTool, type ApiCaller, type ToolDefinition } from './tool.js'

// A type alias, not an interface: the SDK wants a tool context assignable to Record<string, unknown>.
export type CallerContext = { caller: ApiCaller }

type InputOf<D> = D extends ToolDefinition<string, infer INPUT, unknown> ? INPUT : never
type OutputOf<D> = D extends ToolDefinition<string, unknown, infer OUTPUT> ? OUTPUT : never

export type AiTools<DEFS extends readonly ToolDefinition[]> = {
  [D in DEFS[number] as D['name']]: Tool<InputOf<D>, OutputOf<D>, CallerContext>
}

export type AiCallerContext<DEFS extends readonly ToolDefinition[]> = {
  [D in DEFS[number] as D['name']]: CallerContext
}

export function hasCaller(value: unknown): value is CallerContext {
  return typeof (value as Partial<CallerContext> | undefined)?.caller === 'function'
}

// The SDK validates a tool's context before running it, so a call that forgot the caller runs no
// tool instead of reaching the API as nobody. Never sent to the model, so no JSON Schema.
const callerContextSchema: StandardSchemaV1<CallerContext> = {
  '~standard': {
    version: 1,
    vendor: 'volcanicminds',
    validate: (value) =>
      hasCaller(value)
        ? { value }
        : { issues: [{ message: 'No caller: pass callerContext(tools, caller) as the toolsContext of the call' }] }
  }
}

/**
 * The tools as an AI SDK tool set, built once. The caller arrives with each call, as its
 * `toolsContext` (`callerContext`), so an agent shared between requests holds nobody's credential.
 */
export function toAiTools<const DEFS extends readonly ToolDefinition[]>(definitions: DEFS): AiTools<DEFS> {
  assertUniqueNames(definitions)
  const tools: Record<string, Tool<unknown, unknown, CallerContext>> = {}
  for (const definition of definitions) {
    tools[definition.name] = {
      description: definition.description,
      inputSchema: definition.input,
      contextSchema: callerContextSchema,
      execute: (input, { context }) => runTool(definition, input, bindCaller(context.caller))
    }
  }
  return tools as AiTools<DEFS>
}

/** The `toolsContext` of one call: every tool acts as `caller`. */
export function callerContext<const DEFS extends readonly ToolDefinition[]>(
  definitions: DEFS,
  caller: ApiCaller
): AiCallerContext<DEFS> {
  return Object.fromEntries(definitions.map(({ name }) => [name, { caller }])) as AiCallerContext<DEFS>
}
