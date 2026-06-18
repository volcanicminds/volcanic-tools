import { expect } from 'expect'
import { createModel } from '../../lib/ai/model.js'

// createModel resolves provider/model/apiKey from config > env and validates
// before dynamically importing any provider SDK. We exercise the validation
// paths only — no network and no SDK is loaded.
describe('AI createModel (config resolution / validation)', () => {
  const saved: Record<string, string | undefined> = {}
  const KEYS = ['AI_PROVIDER', 'OPENAI_MODEL', 'OPENAI_API_KEY']

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('throws when no provider is set (config nor env)', async () => {
    await expect(createModel({})).rejects.toThrow(/AI_PROVIDER is not set/)
  })

  it('throws on an unsupported provider', async () => {
    await expect(createModel({ provider: 'nope' as never })).rejects.toThrow(/Unsupported AI Provider: nope/)
  })

  it('throws when the model name is missing', async () => {
    await expect(createModel({ provider: 'openai' })).rejects.toThrow(/Model name is required/)
  })

  it('throws when the API key is missing for a key-based provider', async () => {
    await expect(createModel({ provider: 'openai', model: 'gpt-4o' })).rejects.toThrow(/Missing API Key/)
  })

  it('reads the provider from AI_PROVIDER env when config omits it', async () => {
    process.env.AI_PROVIDER = 'openai'
    // model still missing → should fail at the model-name check, proving env provider was picked up
    await expect(createModel()).rejects.toThrow(/Model name is required for provider openai/)
  })
})
