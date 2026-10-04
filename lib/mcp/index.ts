import { AsyncLocalStorage } from 'node:async_hooks'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { assertUniqueNames, bindCaller, runTool, type ApiCaller, type ToolDefinition } from '../ai/tool.js'

// The contract, from here too: a server that has no agent need not import `./ai`.
export { defineTool, ToolError, ToolCallError, isToolError } from '../ai/tool.js'
export type { ApiCaller, ApiMethod, ApiRequest, ApiResponse, ToolContext, ToolDefinition, ToolInputSchema } from '../ai/tool.js'

export interface McpHandlerConfig {
  name: string // announced to the client at initialization
  version: string
  tools: readonly ToolDefinition[]
  /**
   * The browser origins that may reach the server (`https://console.example.com`). A request whose
   * `Origin` is not listed is answered 403 before any tool runs, as the MCP specification asks against
   * DNS rebinding; a request without one, from a client that is not a browser, passes. An empty list
   * admits no browser.
   */
  allowedOrigins: readonly string[]
  /** Receives what a tool threw before the client got "Tool '<name>' failed" in its place. */
  onError?: (error: unknown, tool: string) => void
}

export interface McpRequestOptions {
  /** The API as the person behind this request, never a service credential. */
  caller: ApiCaller
  /** The JSON body, when the framework has already read it from the request. */
  parsedBody?: unknown
}

/** Web-standard: the consumer turns its own request into a `Request` and sends back the `Response`. */
export interface McpHandler {
  fetch(request: Request, options: McpRequestOptions): Promise<Response>
  close(): Promise<void>
}

function toText(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output ?? null)
}

// Compared as the exact string a browser sends, so an entry must already be one: '*', a path or a
// trailing slash would never match and would admit less than its author meant, silently.
function originsOf(entries: readonly string[]): ReadonlySet<string> {
  for (const entry of entries) {
    let origin: string | undefined
    try {
      origin = new URL(entry).origin
    } catch {
      origin = undefined
    }
    // `URL.origin` is the string 'null' for a scheme without an origin, the same string an opaque
    // origin (a sandboxed frame, a file) sends: listing it would admit those.
    if (origin === undefined || origin === 'null' || origin !== entry) {
      throw new Error(`allowedOrigins: '${entry}' is not an origin, write it as scheme://host[:port]`)
    }
  }
  return new Set(entries)
}

// The MCP specification allows a JSON-RPC error with no id as the body of this 403.
const forbiddenOrigin = () =>
  Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' } }, { status: 403 })

/**
 * An MCP server over Streamable HTTP, stateless, serving the given tools. The consumer mounts it
 * on one of its own authenticated routes and hands every request the caller it authenticated;
 * the server never sees a credential of its own.
 */
export async function createMcpHandler(config: McpHandlerConfig): Promise<McpHandler> {
  assertUniqueNames(config.tools)
  const origins = originsOf(config.allowedOrigins)
  const sdk = await import('@modelcontextprotocol/server')
  // The SDK builds a server per request; the caller reaches its tools through the async context
  // of the `fetch` that serves the request, the same one a streamed response keeps.
  const callers = new AsyncLocalStorage<ApiCaller>()

  const handler = sdk.createMcpHandler(() => {
    const server = new sdk.McpServer({ name: config.name, version: config.version })
    for (const definition of config.tools) {
      server.registerTool(
        definition.name,
        { description: definition.description, inputSchema: definition.input },
        async (input: unknown): Promise<CallToolResult> => {
          const caller = callers.getStore()
          // Unreachable through `fetch`, which always runs the SDK inside `callers.run`.
          if (!caller) throw new Error(`Tool '${definition.name}' ran outside a request`)
          try {
            const output = await runTool(definition, input, bindCaller(caller))
            return { content: [{ type: 'text', text: toText(output) }] }
          } catch (error) {
            // runTool lets only a ToolError out; its cause is what the tool really threw.
            const failure = error as Error
            if (failure.cause !== undefined) config.onError?.(failure.cause, definition.name)
            return { isError: true, content: [{ type: 'text', text: failure.message }] }
          }
        }
      )
    }
    return server
  })

  return {
    fetch: async (request, { caller, parsedBody }) => {
      // The SDK entry validates no Origin by design: the server that mounts it has to.
      const origin = request.headers.get('origin')
      if (origin !== null && !origins.has(origin)) return forbiddenOrigin()
      return callers.run(caller, () => handler.fetch(request, { parsedBody }))
    },
    close: () => handler.close()
  }
}
