/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { simulateReadableStream, tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { createAgent } from '../../lib/ai/agent.js'
import { defineTool, type ApiCaller, type ApiRequest } from '../../lib/ai/tool.js'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

/** A model that answers with the given steps, in order, and records the prompt of each call. */
function scripted(...steps: Array<{ content: any[]; finish: string }>) {
  const prompts: any[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options: any) => {
      prompts.push(options.prompt)
      const step = steps[prompts.length - 1]
      return { content: step.content, finishReason: { unified: step.finish, raw: undefined }, usage } as any
    }
  })
  return { model, prompts }
}

const weatherLoop = () =>
  scripted(
    {
      content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'weather', input: '{"city":"Rome"}' }],
      finish: 'tool-calls'
    },
    { content: [{ type: 'text', text: 'Sunny in Rome' }], finish: 'stop' }
  )

const weather = (calls: string[]) =>
  tool({
    description: 'The weather in a city',
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => {
      calls.push(city)
      return `sunny in ${city}`
    }
  })

describe('AI createAgent (AI SDK ToolLoopAgent)', () => {
  it('returns the SDK agent as it is, named, running the tool loop', async () => {
    const { model, prompts } = weatherLoop()
    const calls: string[] = []
    const agent = await createAgent({
      name: 'support',
      instructions: 'Answer briefly.',
      model,
      tools: { weather: weather(calls) }
    })

    // Mocha loads specs with require(), so under tsx this file's static imports of `ai` are a
    // CommonJS copy; the library's dynamic import, like this one, gets the ESM module.
    const { ToolLoopAgent } = await import('ai')
    expect(agent).toBeInstanceOf(ToolLoopAgent)
    expect(agent.id).toBe('support')

    const result = await agent.generate({ prompt: 'Weather in Rome?' })
    expect(calls).toEqual(['Rome'])
    expect(result.text).toBe('Sunny in Rome')
    // The second call carries the tool's result back to the model.
    expect(JSON.stringify(prompts[1])).toContain('sunny in Rome')
  })

  it('names its telemetry after the agent, unless the caller names it', async () => {
    const events: any[] = []
    const integrations = [{ onStart: (event: any) => void events.push(event) }]

    const named = await createAgent({ name: 'support', model: weatherLoop().model, telemetry: { integrations } })
    await named.generate({ prompt: 'hi' })
    const renamed = await createAgent({
      name: 'support',
      model: weatherLoop().model,
      telemetry: { integrations, functionId: 'support-v2' }
    })
    await renamed.generate({ prompt: 'hi' })

    expect(events.map((e) => e.functionId)).toEqual(['support', 'support-v2'])
  })
})

/** An API that answers as `user`, and records every request it receives. */
function apiAs(user: string, requests: ApiRequest[] = []): ApiCaller {
  return async (request) => {
    requests.push(request)
    return { status: 200, body: { user } }
  }
}

const whoami = defineTool({
  name: 'whoami',
  description: 'The user the agent acts for',
  input: z.object({}),
  execute: (_input, { call }) => call({ method: 'GET', path: '/me' })
})

/**
 * Stateless, so concurrent runs can share it: asks for `whoami`, then answers with the tool's
 * output. Counts the model calls.
 */
function whoamiModel() {
  const calls = { generate: 0, stream: 0 }
  const reply = (prompt: any[]) => {
    const last = prompt[prompt.length - 1]
    return last.role === 'tool'
      ? { text: JSON.stringify(last.content[0].output) }
      : { toolCall: { type: 'tool-call', toolCallId: 'c1', toolName: 'whoami', input: '{}' } }
  }
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }: any) => {
      calls.generate++
      const { text, toolCall } = reply(prompt)
      return {
        content: [toolCall ?? { type: 'text', text }],
        finishReason: { unified: toolCall ? 'tool-calls' : 'stop', raw: undefined },
        usage
      } as any
    },
    doStream: async ({ prompt }: any) => {
      calls.stream++
      const { text, toolCall } = reply(prompt)
      const parts = toolCall
        ? [toolCall]
        : [{ type: 'text-start', id: 't1' }, { type: 'text-delta', id: 't1', delta: text }, { type: 'text-end', id: 't1' }]
      const finish = { type: 'finish', finishReason: { unified: toolCall ? 'tool-calls' : 'stop', raw: undefined }, usage }
      return { stream: simulateReadableStream({ chunks: [...parts, finish] }) } as any
    }
  })
  return { model, calls }
}

describe('AI createAgent with tools from defineTool', () => {
  it('is built once and acts for the caller of each call, also when two run at once', async () => {
    const agent = await createAgent({ name: 'support', model: whoamiModel().model, tools: [whoami] })
    const [alice, bob] = await Promise.all([
      agent.generate({ prompt: 'Who am I?', options: { caller: apiAs('alice') } }),
      agent.generate({ prompt: 'Who am I?', options: { caller: apiAs('bob') } })
    ])
    const carol = await agent.generate({ prompt: 'Who am I?', options: { caller: apiAs('carol') } })

    expect([alice.text, bob.text, carol.text].map((text) => JSON.parse(text).value)).toEqual([
      { user: 'alice' },
      { user: 'bob' },
      { user: 'carol' }
    ])
  })

  it('acts for the caller of a streamed call too', async () => {
    const requests: ApiRequest[] = []
    const agent = await createAgent({ name: 'support', model: whoamiModel().model, tools: [whoami] })
    const result = await agent.stream({ prompt: 'Who am I?', options: { caller: apiAs('dave', requests) } })
    expect(JSON.parse(await result.text).value).toEqual({ user: 'dave' })
    expect(requests).toEqual([{ method: 'GET', path: '/me' }])
  })

  it('fails a call without a caller before the model runs', async () => {
    const { model, calls } = whoamiModel()
    const agent = await createAgent({ name: 'support', model, tools: [whoami] })
    for (const options of [undefined, {}, { caller: 'alice' }]) {
      await expect(agent.generate({ prompt: 'Who am I?', options } as any)).rejects.toThrow(/no caller/)
      await expect(agent.stream({ prompt: 'Who am I?', options } as any)).rejects.toThrow(/no caller/)
    }
    expect(calls).toEqual({ generate: 0, stream: 0 })
  })

  it('refuses settings that would carry a caller, as createAgent writes them', async () => {
    for (const key of ['toolsContext', 'callOptionsSchema', 'prepareCall']) {
      const config = { name: 'support', model: whoamiModel().model, tools: [whoami], [key]: {} }
      await expect(createAgent(config as any)).rejects.toThrow(new RegExp(`'support': ${key} carry`))
    }
  })
})
