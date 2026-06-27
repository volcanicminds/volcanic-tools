import { expect } from 'expect'
import { createEmbedder } from '../../lib/ai/embeddings.js'

// createEmbedder resolves provider/model/apiKey from config > env and validates
// before importing any provider SDK. We exercise validation only — no network.
describe('AI createEmbedder (config resolution / validation)', () => {
  const saved: Record<string, string | undefined> = {}
  const KEYS = ['AI_EMBEDDING_PROVIDER', 'AI_PROVIDER', 'OPENAI_EMBEDDING_MODEL', 'OPENAI_API_KEY']

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
    await expect(createEmbedder({})).rejects.toThrow(/is not set/)
  })

  it('throws on an unsupported provider', async () => {
    await expect(createEmbedder({ provider: 'nope' as never })).rejects.toThrow(/Unsupported AI Provider: nope/)
  })

  it('rejects anthropic (no embeddings API)', async () => {
    await expect(createEmbedder({ provider: 'anthropic' })).rejects.toThrow(/does not provide an embeddings API/)
  })

  it('throws when the model name is missing', async () => {
    await expect(createEmbedder({ provider: 'openai' })).rejects.toThrow(/Embedding model name is required/)
  })

  it('throws when the API key is missing for a key-based provider', async () => {
    await expect(createEmbedder({ provider: 'openai', model: 'text-embedding-3-small' })).rejects.toThrow(
      /Missing API Key/
    )
  })

  it('prefers AI_EMBEDDING_PROVIDER over AI_PROVIDER', async () => {
    process.env.AI_PROVIDER = 'openai'
    process.env.AI_EMBEDDING_PROVIDER = 'mistral'
    // model missing → fails at the model-name check, naming the embedding provider
    await expect(createEmbedder()).rejects.toThrow(/required for provider mistral/)
  })

  it('falls back to AI_PROVIDER when AI_EMBEDDING_PROVIDER is absent', async () => {
    process.env.AI_PROVIDER = 'openai'
    await expect(createEmbedder()).rejects.toThrow(/required for provider openai/)
  })
})
