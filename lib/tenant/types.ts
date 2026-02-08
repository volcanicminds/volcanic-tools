/**
 * Minimal type definitions for ORM compatibility.
 * These are duck-typed interfaces that match the methods we use.
 * Works with TypeORM or any ORM with compatible signatures.
 */

/**
 * Minimal QueryRunner interface.
 */
export interface QueryRunnerLike {
  connect(): Promise<void>
  query(query: string, parameters?: unknown[]): Promise<unknown>
  release(): Promise<void>
}

/**
 * Minimal DataSource interface.
 */
export interface DataSourceLike {
  createQueryRunner(): QueryRunnerLike
  synchronize(): Promise<void>
}

/**
 * Minimal Repository interface.
 */
export interface RepositoryLike<T> {
  findOne(options: { where: Record<string, unknown> }): Promise<T | null>
}
