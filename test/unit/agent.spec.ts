/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { createAgent } from '../../lib/ai/agent.js'

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
