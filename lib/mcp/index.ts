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

/**
 * An MCP server over Streamable HTTP, stateless, serving the given tools. The consumer mounts it
 * on one of its own authenticated routes and hands every request the caller it authenticated;
 * the server never sees a credential of its own.
 */
export async function createMcpHandler(config: McpHandlerConfig): Promise<McpHandler> {
  assertUniqueNames(config.tools)
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
    fetch: (request, { caller, parsedBody }) => callers.run(caller, () => handler.fetch(request, { parsedBody })),
    close: () => handler.close()
  }
}
