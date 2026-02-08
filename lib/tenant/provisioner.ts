import type { DataSourceLike } from './types.js'

export type TenantStatus = 'active' | 'suspended' | 'archived'

/**
 * Interface for multi-tenant entities.
 * Consumer entities should extend BaseEntity and implement this interface.
 *
 * @example
 * ```typescript
 * import { TenantEx } from "@volcanicminds/tools/tenant"
 * import { Entity, PrimaryGeneratedColumn, Column, ... } from "typeorm"
 *
 * @Entity({ name: "tenants", schema: "public" })
 * export class Tenant extends BaseEntity implements TenantEx {
 *   @PrimaryGeneratedColumn("uuid") id!: string
 *   @Column() name!: string
 *   // ...
 * }
 * ```
 */
export interface TenantEx {
  name: string
  slug: string
  schemaName: string
  status: TenantStatus
  config: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

export interface ProvisionResult {
  success: boolean
  schemaName: string
  error?: string
}

const SCHEMA_REGEX = /^[a-z][a-z0-9_]*$/

/**
 * Validates a schema name for PostgreSQL compatibility.
 */
export function validateSchemaName(name: string): boolean {
  return SCHEMA_REGEX.test(name)
}

/**
 * Creates a new PostgreSQL schema for a tenant.
 */
export async function createTenantSchema(dataSource: DataSourceLike, schemaName: string): Promise<ProvisionResult> {
  if (!validateSchemaName(schemaName)) {
    return { success: false, schemaName, error: 'Invalid schema name format' }
  }

  const qr = dataSource.createQueryRunner()
  await qr.connect()
  try {
    await qr.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)
    return { success: true, schemaName }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, schemaName, error: message }
  } finally {
    await qr.release()
  }
}

/**
 * Synchronizes TypeORM entities to a tenant schema.
 * WARNING: Use with caution in production. Prefer migrations.
 */
export async function syncTenantSchema(dataSource: DataSourceLike, schemaName: string): Promise<void> {
  const qr = dataSource.createQueryRunner()
  await qr.connect()
  try {
    await qr.query(`SET search_path TO "${schemaName}"`)
    await dataSource.synchronize()
    await qr.query(`SET search_path TO "public"`)
  } finally {
    await qr.release()
  }
}

/**
 * Drops a tenant schema and all its contents. DESTRUCTIVE.
 */
export async function dropTenantSchema(dataSource: DataSourceLike, schemaName: string): Promise<void> {
  const qr = dataSource.createQueryRunner()
  await qr.connect()
  try {
    await qr.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  } finally {
    await qr.release()
  }
}
