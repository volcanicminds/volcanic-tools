import { expect } from 'expect'
import { PgVectorStore } from '../../lib/ai/vector-store.js'

// Integration test for the engine-agnostic vector store, backed by embedded
// PGlite + pgvector. Uses a deterministic local embedder (no network) so it
// runs anywhere. This is exactly how the store works on a real Postgres too —
// only the `query` executor differs.
describe('PgVectorStore (pgvector on PGlite)', () => {
  let pg: any
  let store: PgVectorStore

  // Tiny deterministic "embedder": 3 axes ~ [animal, vehicle, plant].
  const VECTORS: Record<string, number[]> = {
    cat: [1, 0, 0],
    dog: [0.9, 0.1, 0],
    car: [0, 1, 0],
    truck: [0.1, 0.9, 0],
    rose: [0, 0, 1]
  }

  before(async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const { vector } = await import('@electric-sql/pglite-pgvector')
    pg = await PGlite.create({ extensions: { vector } })

    store = new PgVectorStore({
      query: (sql: string, params?: unknown[]) => pg.query(sql, params),
      table: 'doc_embeddings',
      dimensions: 3,
      distance: 'cosine'
    })
    await store.init()
    await store.upsertMany(
      Object.entries(VECTORS).map(([content, embedding]) => ({
        id: content,
        content,
        embedding,
        metadata: { kind: content }
      }))
    )
  })

  after(async () => {
    if (pg) await pg.close()
  })

  it('persists all rows', async () => {
    expect(await store.count()).toBe(5)
  })

  it('returns the nearest neighbour first', async () => {
    const matches = await store.search([1, 0, 0], 2)
    expect(matches[0].id).toBe('cat')
    expect(matches[1].id).toBe('dog') // second-closest animal
    expect(matches[0].distance).toBeLessThanOrEqual(matches[1].distance)
  })

  it('groups semantically similar items (vehicles)', async () => {
    const matches = await store.search([0, 1, 0], 2)
    expect(matches.map((m) => m.id).sort()).toEqual(['car', 'truck'])
  })

  it('round-trips metadata', async () => {
    const [top] = await store.search([0, 0, 1], 1)
    expect(top.id).toBe('rose')
    expect(top.metadata).toEqual({ kind: 'rose' })
  })

  it('upsert updates an existing row in place', async () => {
    await store.upsert('cat', 'cat (updated)', [1, 0, 0], { kind: 'feline' })
    expect(await store.count()).toBe(5) // no duplicate
    const [top] = await store.search([1, 0, 0], 1)
    expect(top.content).toBe('cat (updated)')
    expect(top.metadata).toEqual({ kind: 'feline' })
  })

  it('delete removes a row', async () => {
    await store.delete('rose')
    expect(await store.count()).toBe(4)
  })

  it('honours a different distance metric (l2)', async () => {
    const l2 = new PgVectorStore({
      query: (sql: string, params?: unknown[]) => pg.query(sql, params),
      table: 'doc_embeddings',
      dimensions: 3,
      distance: 'l2'
    })
    const matches = await l2.search([1, 0, 0], 1)
    expect(matches[0].id).toBe('cat')
  })

  it('rejects vectors with the wrong dimensionality', async () => {
    await expect(store.search([1, 0])).rejects.toThrow(/dimensions/)
    await expect(store.upsert('x', 'x', [1, 2, 3, 4])).rejects.toThrow(/dimensions/)
  })

  it('isolates data per schema (multi-tenant)', async () => {
    const tenantStore = new PgVectorStore({
      query: (sql: string, params?: unknown[]) => pg.query(sql, params),
      table: 'doc_embeddings',
      dimensions: 3,
      schema: 'tenant_x'
    })
    await tenantStore.init()
    await tenantStore.upsert('only-here', 'tenant doc', [1, 1, 1])
    expect(await tenantStore.count()).toBe(1) // isolated from the public table (4 rows)
  })
})
