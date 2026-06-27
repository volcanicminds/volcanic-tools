import type { VectorStoreConfig, VectorDistance, VectorMatch } from './types.js'

const DISTANCE_OP: Record<VectorDistance, string> = {
  l2: '<->',
  cosine: '<=>',
  ip: '<#>'
}

// pgvector accepts a vector literal in the form '[1,2,3]'.
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Engine-agnostic pgvector store.
 *
 * Works against ANY pg-compatible executor — a TypeORM `dataSource.query`, an
 * embedded PGlite instance's `query`, or a node-postgres pool's `query` — so the
 * same code runs on a real Postgres server and on PGlite. Everything is
 * parametrizable via config: table name, vector dimensions, distance metric and
 * (optionally) a schema for multi-tenant isolation.
 */
export class PgVectorStore {
  private readonly query: VectorStoreConfig['query']
  private readonly table: string
  private readonly dimensions: number
  private readonly distance: VectorDistance
  private readonly schema?: string

  constructor(config: VectorStoreConfig) {
    if (!config?.query) throw new Error('PgVectorStore: a `query` executor is required')
    if (!config.dimensions || config.dimensions < 1) {
      throw new Error('PgVectorStore: `dimensions` must be a positive integer')
    }
    this.query = config.query
    this.table = config.table ?? 'embeddings'
    this.dimensions = config.dimensions
    this.distance = config.distance ?? 'cosine'
    this.schema = config.schema
  }

  private get ref(): string {
    return this.schema ? `"${this.schema}"."${this.table}"` : `"${this.table}"`
  }

  // Normalizes the different result shapes (TypeORM returns an array,
  // pg/PGlite return `{ rows }`).
  private async run(sql: string, params?: unknown[]): Promise<any[]> {
    const res = await this.query(sql, params)
    if (Array.isArray(res)) return res
    if (res && Array.isArray(res.rows)) return res.rows
    return []
  }

  /**
   * Enables the extension and creates the table if missing. Idempotent.
   */
  async init(): Promise<void> {
    await this.run('CREATE EXTENSION IF NOT EXISTS vector')
    if (this.schema) {
      await this.run(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`)
    }
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${this.ref} (
         id text PRIMARY KEY,
         content text NOT NULL,
         metadata jsonb,
         embedding vector(${this.dimensions}) NOT NULL
       )`
    )
  }

  /**
   * Inserts or updates one embedding row.
   */
  async upsert(
    id: string,
    content: string,
    embedding: number[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.assertDim(embedding)
    await this.run(
      `INSERT INTO ${this.ref} (id, content, metadata, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT (id) DO UPDATE
         SET content = EXCLUDED.content,
             metadata = EXCLUDED.metadata,
             embedding = EXCLUDED.embedding`,
      [id, content, metadata ? JSON.stringify(metadata) : null, toVectorLiteral(embedding)]
    )
  }

  /**
   * Batch upsert.
   */
  async upsertMany(
    rows: Array<{ id: string; content: string; embedding: number[]; metadata?: Record<string, unknown> }>
  ): Promise<void> {
    for (const r of rows) {
      await this.upsert(r.id, r.content, r.embedding, r.metadata)
    }
  }

  /**
   * Returns the `k` nearest rows to the query vector, closest first.
   */
  async search(embedding: number[], k = 5): Promise<VectorMatch[]> {
    this.assertDim(embedding)
    const op = DISTANCE_OP[this.distance]
    const rows = await this.run(
      `SELECT id, content, metadata, embedding ${op} $1::vector AS distance
       FROM ${this.ref}
       ORDER BY distance ASC
       LIMIT ${Number(k)}`,
      [toVectorLiteral(embedding)]
    )
    return rows.map((r: any) => ({
      id: r.id,
      content: r.content,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata ?? null),
      distance: Number(r.distance)
    }))
  }

  async delete(id: string): Promise<void> {
    await this.run(`DELETE FROM ${this.ref} WHERE id = $1`, [id])
  }

  async count(): Promise<number> {
    const rows = await this.run(`SELECT count(*)::int AS c FROM ${this.ref}`)
    return rows[0]?.c ?? 0
  }

  private assertDim(embedding: number[]): void {
    if (!Array.isArray(embedding) || embedding.length !== this.dimensions) {
      throw new Error(
        `PgVectorStore: embedding length ${embedding?.length} does not match configured dimensions ${this.dimensions}`
      )
    }
  }
}
