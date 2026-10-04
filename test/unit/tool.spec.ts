/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { generateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { defineTool, ToolCallError, ToolError, bindCaller, type ApiCaller, type ApiRequest } from '../../lib/ai/tool.js'
import { toAiTools, callerContext, type AiCallerContext } from '../../lib/ai/tool-set.js'
import { createMcpHandler, type McpHandler } from '../../lib/mcp/index.js'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

/** An API that answers as `user`, and records every request it receives. */
function apiAs(user: string, requests: ApiRequest[] = []): ApiCaller {
  return async (request) => {
    requests.push(request)
    const { pathname } = new URL(request.path, 'http://app.test')
    if (pathname === '/me') return { status: 200, body: { user, tag: request.query?.tag } }
    if (pathname === '/payouts') {
      return { status: 403, body: { code: 'STEP_UP_REQUIRED', message: 'Recent authentication required' } }
    }
    return { status: 404, body: { code: 'NOT_FOUND', message: 'No such route' } }
  }
}

const whoami = defineTool({
  name: 'whoami',
  description: 'The user the assistant acts for',
  input: z.object({ tag: z.string() }),
  execute: (input, { call }) => call<{ user: string; tag: string }>({ method: 'GET', path: '/me', query: { tag: input.tag } })
})
const payouts = defineTool({
  name: 'payouts',
  description: 'Payouts, behind a recent authentication',
  input: z.object({}),
  execute: (_input, { call }) => call({ method: 'GET', path: '/payouts' })
})
const broken = defineTool({
  name: 'broken',
  description: 'Fails with an internal detail',
  input: z.object({}),
  execute: async () => {
    throw new Error('connection to 10.0.0.7 refused')
  }
})
const tools = [whoami, payouts, broken] as const
// Built once and shared by every call, like the tools of an agent serving many requests.
const aiTools = toAiTools(tools)

/** One tool call through the AI SDK loop; returns the tool's result or error part. */
// Typed on purpose: the type-check proves `generateText` takes what `callerContext` builds.
async function viaAi(name: string, input: object, toolsContext: AiCallerContext<typeof tools>) {
  const model = new MockLanguageModelV4({
    doGenerate: async () =>
      ({
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: name, input: JSON.stringify(input) }],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage
      }) as any
  })
  const result = await generateText({ model, tools: aiTools, toolsContext, prompt: 'go' })
  return result.steps[0].content.find((part: any) => part.type === 'tool-result' || part.type === 'tool-error') as any
}

async function mcpClient(handler: McpHandler, caller: ApiCaller, origin?: string) {
  const fetch = (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (origin) headers.set('origin', origin)
    return handler.fetch(new Request(url, { ...init, headers }), { caller })
  }
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('http://app.test/mcp'), { fetch }))
  return client
}

const text = (result: any) => result.content[0].text as string

describe('AI defineTool', () => {
  it('rejects a name a provider or MCP would refuse, and a missing description', () => {
    const base = { description: 'x', input: z.object({}), execute: async () => null }
    expect(() => defineTool({ ...base, name: 'has space' })).toThrow(/must match/)
    expect(() => defineTool({ ...base, name: 'x'.repeat(65) })).toThrow(/must match/)
    expect(() => defineTool({ ...base, name: 'ok', description: ' ' })).toThrow(/needs a description/)
    expect(Object.isFrozen(defineTool({ ...base, name: 'ok_name-1' }))).toBe(true)
  })

  it('reaches the API only by path: no URL, no host smuggled in a path', async () => {
    const requests: ApiRequest[] = []
    const { call } = bindCaller(apiAs('alice', requests))
    for (const path of ['http://evil.example/me', '//evil.example/me', '/\\evil.example/me', '/\t/evil.example/me', 'me']) {
      await expect(call({ method: 'GET', path })).rejects.toThrow(/calls an API path/)
    }
    expect(requests).toEqual([])
    await expect(call({ method: 'GET', path: '/me?next=//evil.example' })).resolves.toMatchObject({ user: 'alice' })
  })

  it('turns an answer outside 2xx into a ToolCallError carrying the API code', async () => {
    const { call } = bindCaller(apiAs('alice'))
    const error = await call({ method: 'GET', path: '/payouts' }).catch((e) => e)
    expect(error).toBeInstanceOf(ToolCallError)
    expect(error).toBeInstanceOf(ToolError)
    expect(error).toMatchObject({ status: 403, code: 'STEP_UP_REQUIRED', message: 'STEP_UP_REQUIRED: Recent authentication required' })
  })

  it('refuses two tools with the same name, in both adapters', async () => {
    expect(() => toAiTools([whoami, whoami])).toThrow(/defined twice/)
    await expect(createMcpHandler({ name: 't', version: '0', tools: [whoami, whoami], allowedOrigins: [] })).rejects.toThrow(/defined twice/)
  })
})

describe('MCP createMcpHandler checks the Origin', () => {
  const trusted = 'https://console.app.test'
  let handler: McpHandler

  before(async () => {
    handler = await createMcpHandler({ name: 'test', version: '0.0.0', tools, allowedOrigins: [trusted] })
  })
  after(() => handler.close())

  /** A tool call as a browser page on `origin` would send it, without the SDK client. */
  const callFrom = (origin: string, caller: ApiCaller) =>
    handler.fetch(
      new Request('http://app.test/mcp', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: { tag: 'x' } } })
      }),
      { caller }
    )

  it('answers 403 to a browser origin it does not list, before any tool runs', async () => {
    for (const origin of ['https://evil.test', 'null', `${trusted}:8443`,'http://console.app.test']) {
      const requests: ApiRequest[] = []
      const response = await callFrom(origin, apiAs('alice', requests))
      expect([origin, response.status]).toEqual([origin, 403])
      expect(await response.json()).toEqual({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' } })
      expect(requests).toEqual([])
    }
  })

  it('serves a listed origin, and a client that sends none', async () => {
    for (const origin of [trusted, undefined]) {
      const client = await mcpClient(handler, apiAs('alice'), origin)
      const result = await client.callTool({ name: 'whoami', arguments: { tag: 'o' } })
      await client.close()
      expect(JSON.parse(text(result))).toEqual({ user: 'alice', tag: 'o' })
    }
  })

  it('refuses an allowedOrigins entry that is not an origin', async () => {
    for (const entry of ['*', `${trusted}/`, `${trusted}/console`,'console.app.test', 'file:///tmp/page.html']) {
      await expect(createMcpHandler({ name: 't', version: '0', tools, allowedOrigins: [entry] })).rejects.toThrow(/is not an origin/)
    }
  })
})

describe('AI toAiTools and createMcpHandler serve the same tool', () => {
  let handler: McpHandler
  const failures: Array<[unknown, string]> = []

  before(async () => {
    handler = await createMcpHandler({
      name: 'test',
      version: '0.0.0',
      tools,
      allowedOrigins: [],
      onError: (e, tool) => void failures.push([e, tool])
    })
  })
  after(() => handler.close())

  it('lists the tools with their JSON Schema', async () => {
    const client = await mcpClient(handler, apiAs('alice'))
    const { tools: listed } = await client.listTools()
    expect(listed.map((t) => t.name)).toEqual(['whoami', 'payouts', 'broken'])
    expect(listed[0]).toMatchObject({
      description: 'The user the assistant acts for',
      inputSchema: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] }
    })
    await client.close()
  })

  it('gives the same result from both adapters', async () => {
    const ai = await viaAi('whoami', { tag: 't1' }, callerContext(tools, apiAs('alice')))
    const client = await mcpClient(handler, apiAs('alice'))
    const mcp = await client.callTool({ name: 'whoami', arguments: { tag: 't1' } })
    await client.close()

    expect(ai.type).toBe('tool-result')
    expect(ai.output).toEqual({ user: 'alice', tag: 't1' })
    expect(mcp.isError).toBeFalsy()
    expect(JSON.parse(text(mcp))).toEqual(ai.output)
  })

  it('gives the same error from both adapters, with the API code', async () => {
    const ai = await viaAi('payouts', {}, callerContext(tools, apiAs('alice')))
    const client = await mcpClient(handler, apiAs('alice'))
    const mcp = await client.callTool({ name: 'payouts', arguments: {} })
    await client.close()

    expect(ai.type).toBe('tool-error')
    expect(ai.error.message).toBe('STEP_UP_REQUIRED: Recent authentication required')
    expect(mcp.isError).toBe(true)
    expect(text(mcp)).toBe(ai.error.message)
  })

  it('hides an internal failure from the model and the client, and keeps it for the application', async () => {
    failures.length = 0
    const ai = await viaAi('broken', {}, callerContext(tools, apiAs('alice')))
    const client = await mcpClient(handler, apiAs('alice'))
    const mcp = await client.callTool({ name: 'broken', arguments: {} })
    await client.close()

    expect(ai.error.message).toBe("Tool 'broken' failed")
    expect(ai.error.cause.message).toBe('connection to 10.0.0.7 refused')
    expect(text(mcp)).toBe("Tool 'broken' failed")
    expect(failures.map(([e, tool]) => [(e as Error).message, tool])).toEqual([['connection to 10.0.0.7 refused', 'broken']])
  })

  it('acts as the caller of each request, also when two run at once', async () => {
    const [alice, bob] = await Promise.all([
      viaAi('whoami', { tag: 'a' }, callerContext(tools, apiAs('alice'))),
      viaAi('whoami', { tag: 'b' }, callerContext(tools, apiAs('bob')))
    ])
    expect([alice.output, bob.output]).toEqual([
      { user: 'alice', tag: 'a' },
      { user: 'bob', tag: 'b' }
    ])

    const [ca, cb] = await Promise.all([mcpClient(handler, apiAs('alice')), mcpClient(handler, apiAs('bob'))])
    const [ra, rb] = await Promise.all([
      ca.callTool({ name: 'whoami', arguments: { tag: 'a' } }),
      cb.callTool({ name: 'whoami', arguments: { tag: 'b' } })
    ])
    expect([JSON.parse(text(ra)), JSON.parse(text(rb))]).toEqual([
      { user: 'alice', tag: 'a' },
      { user: 'bob', tag: 'b' }
    ])
    await Promise.all([ca.close(), cb.close()])
  })

  it('runs no tool for an AI call that carries no caller', async () => {
    // The SDK's own check refuses the call before `execute`; without it, `execute` would run and
    // fail as "Tool 'whoami' failed" instead.
    const outcome = await viaAi('whoami', { tag: 'a' }, undefined as unknown as AiCallerContext<typeof tools>).catch((e) => e)
    expect(String(outcome?.error ?? outcome)).toMatch(/No caller/)
  })

  it('runs no tool on an input its schema refuses', async () => {
    const requests: ApiRequest[] = []
    const client = await mcpClient(handler, apiAs('alice', requests))
    const mcp = await client.callTool({ name: 'whoami', arguments: { tag: 42 } })
    await client.close()
    expect(mcp.isError).toBe(true)
    expect(requests).toEqual([])
  })
})
