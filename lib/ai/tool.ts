import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'

// This module is the contract both adapters share (`toAiTools` here, `createMcpHandler` in
// `../mcp`), so it imports nothing at runtime: an MCP server must not need `ai` installed.

/**
 * A tool's input schema: one the AI SDK and the MCP SDK both take as it is, because it validates
 * (Standard Schema) and describes itself as JSON Schema (Standard JSON Schema). Zod 4.2 and later
 * is one; Zod 3 is not, as it has no JSON Schema of its own.
 */
export type ToolInputSchema<INPUT = unknown> = StandardSchemaV1<unknown, INPUT> & StandardJSONSchemaV1<unknown, INPUT>

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiRequest {
  method: ApiMethod
  path: string // an API path ('/vehicles'), never a URL
  query?: Record<string, string>
  body?: unknown
}

export interface ApiResponse {
  status: number
  body: unknown
}

/**
 * Calls the application's API with the end user's credential, which the consumer binds per
 * request (a session cookie or an integration token, forwarded to `server.inject` or `fetch`).
 * Never a service credential: a tool sees what the person using it would see.
 */
export type ApiCaller = (request: ApiRequest) => Promise<ApiResponse>

export interface ToolContext {
  /** The API as the caller: resolves with the body of a 2xx, throws a `ToolCallError` otherwise. */
  call: <T = unknown>(request: ApiRequest) => Promise<T>
}

export interface ToolDefinition<NAME extends string = string, INPUT = unknown, OUTPUT = unknown> {
  readonly name: NAME
  readonly description: string
  readonly input: ToolInputSchema<INPUT>
  // Method syntax on purpose: it keeps a typed tool assignable to `ToolDefinition`, the type of
  // a list of tools with different inputs.
  execute(input: INPUT, context: ToolContext): Promise<OUTPUT>
}

// Brand checked instead of `instanceof`: an application may load two copies of this package (its
// own and rag's), and a tool from one copy can throw into the adapter of the other.
const TOOL_ERROR = Symbol.for('volcanicminds.tools.ToolError')

/**
 * An error whose message the model or the MCP client may read. Any other error a tool throws
 * reaches them as "Tool '<name>' failed", with the original kept as `cause`.
 */
export class ToolError extends Error {
  readonly [TOOL_ERROR] = true

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ToolError'
  }
}

/** The API answered outside 2xx. The message carries the API's `code` (`STEP_UP_REQUIRED`). */
export class ToolCallError extends ToolError {
  readonly status: number
  readonly code: string | undefined

  constructor(response: ApiResponse) {
    const body = (response.body ?? {}) as { code?: unknown; message?: unknown }
    const code = typeof body.code === 'string' ? body.code : undefined
    const message = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`
    super(code ? `${code}: ${message}` : message)
    this.name = 'ToolCallError'
    this.status = response.status
    this.code = code
  }
}

export function isToolError(error: unknown): error is ToolError {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[TOOL_ERROR] === true
}

// The intersection of what OpenAI accepts for a function name and what MCP allows.
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * A tool defined once and served by both adapters: `toAiTools` for an agent, `createMcpHandler`
 * for an assistant over MCP. `execute` reaches the application only through `context.call`.
 */
export function defineTool<const NAME extends string, SCHEMA extends ToolInputSchema, OUTPUT>(definition: {
  name: NAME
  description: string
  input: SCHEMA
  execute: (input: StandardSchemaV1.InferOutput<SCHEMA>, context: ToolContext) => Promise<OUTPUT>
}): ToolDefinition<NAME, StandardSchemaV1.InferOutput<SCHEMA>, OUTPUT> {
  if (!TOOL_NAME.test(definition.name)) {
    throw new Error(`Tool name '${definition.name}' must match ${TOOL_NAME}`)
  }
  if (!definition.description.trim()) {
    throw new Error(`Tool '${definition.name}' needs a description: it is all the model knows of it`)
  }
  return Object.freeze({ ...definition })
}

export function assertUniqueNames(definitions: readonly ToolDefinition[]): void {
  const seen = new Set<string>()
  for (const { name } of definitions) {
    if (seen.has(name)) throw new Error(`Tool '${name}' is defined twice`)
    seen.add(name)
  }
}

const SENTINEL = 'http://api.invalid'

export function bindCaller(caller: ApiCaller): ToolContext {
  return {
    async call<T>(request: ApiRequest): Promise<T> {
      // The caller carries the end user's credential, so a path must not be able to name another
      // host: '//evil.example', '/\evil.example' and '/\t/evil.example' all resolve to one.
      if (!request.path.startsWith('/') || new URL(request.path, SENTINEL).origin !== SENTINEL) {
        throw new ToolError(`A tool calls an API path, not '${request.path}'`)
      }
      const response = await caller(request)
      if (response.status >= 200 && response.status < 300) return response.body as T
      throw new ToolCallError(response)
    }
  }
}

/** Runs a tool the same way for both adapters, so they fail with the same message. */
export async function runTool<OUTPUT>(
  definition: ToolDefinition<string, unknown, OUTPUT>,
  input: unknown,
  context: ToolContext
): Promise<OUTPUT> {
  try {
    return await definition.execute(input, context)
  } catch (error) {
    if (isToolError(error)) throw error
    throw new ToolError(`Tool '${definition.name}' failed`, { cause: error })
  }
}
