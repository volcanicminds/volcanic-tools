/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { createModel } from '../../lib/ai/model.js'
import { createEmbedder } from '../../lib/ai/embeddings.js'

// The configured key and base URL must reach the provider's HTTP call: each SDK's default
// instance reads its own environment variable instead, so a key passed to it was silently
// dropped. `fetch` is stubbed: the request is recorded and refused, nothing leaves the process.
describe('AI provider wiring (config reaches the HTTP call)', () => {
  const seen: Array<{ url: string; headers: Headers }> = []
  const originalFetch = globalThis.fetch
  // Each SDK's own variable: set to another key, so a dropped config key shows.
  const SDK_ENV = ['OPENAI_API_KEY', 'MISTRAL_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'ANTHROPIC_API_KEY']
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    seen.length = 0
    for (const k of SDK_ENV) {
      saved[k] = process.env[k]
      process.env[k] = 'env-key'
    }
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const request = new Request(input, init)
      seen.push({ url: request.url, headers: request.headers })
      return new Response('{"error":{"message":"stub"}}', {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const k of SDK_ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  const prompt = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  const cases = [
    { provider: 'openai', header: 'authorization', value: 'Bearer cfg-key' },
    { provider: 'mistral', header: 'authorization', value: 'Bearer cfg-key' },
    { provider: 'google', header: 'x-goog-api-key', value: 'cfg-key' },
    { provider: 'anthropic', header: 'x-api-key', value: 'cfg-key' }
  ] as const

  for (const { provider, header, value } of cases) {
    it(`${provider}: the chat model calls the configured base URL with the configured key`, async () => {
      const model: any = await createModel({
        provider,
        model: 'm',
        apiKey: 'cfg-key',
        baseUrl: 'http://stub.invalid/v1'
      })
      await expect(model.doGenerate({ prompt })).rejects.toThrow()

      expect(seen).toHaveLength(1)
      expect(seen[0].url.startsWith('http://stub.invalid/v1/')).toBe(true)
      expect(seen[0].headers.get(header)).toBe(value)
    })
  }

  it('ollama: the chat model calls the configured base URL', async () => {
    const model: any = await createModel({ provider: 'ollama', model: 'llama3', baseUrl: 'http://stub.invalid:11434' })
    await expect(model.doGenerate({ prompt })).rejects.toThrow()

    expect(seen.map((s) => new URL(s.url).host)).toEqual(['stub.invalid:11434'])
  })

  it('the embedding model takes the same path', async () => {
    const model: any = await createEmbedder({
      provider: 'openai',
      model: 'e',
      apiKey: 'cfg-key',
      baseUrl: 'http://stub.invalid/v1'
    })
    await expect(model.doEmbed({ values: ['hi'] })).rejects.toThrow()

    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('http://stub.invalid/v1/embeddings')
    expect(seen[0].headers.get('authorization')).toBe('Bearer cfg-key')
  })
})
