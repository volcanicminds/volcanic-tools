import type { DataSourceLike, RepositoryLike } from './types.js'
import type { TenantEx } from './provisioner.js'

export interface TenantResolverConfig<T extends TenantEx> {
  dataSource: DataSourceLike
  tenantRepository: RepositoryLike<T>
  headerName?: string
  subdomainEnabled?: boolean
  baseDomain?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Resolves a tenant by ID or slug.
 */
export async function resolveTenant<T extends TenantEx>(
  repository: RepositoryLike<T>,
  tenantIdOrSlug: string
): Promise<T | null> {
  const where = UUID_RE.test(tenantIdOrSlug) ? { id: tenantIdOrSlug } : { slug: tenantIdOrSlug }
  return repository.findOne({ where })
}

/**
 * Extracts tenant identifier from request headers or subdomain.
 */
export function extractTenantId(
  headers: Record<string, string | string[] | undefined>,
  host: string | undefined,
  config: { headerName?: string; subdomainEnabled?: boolean; baseDomain?: string }
): string | null {
  // 1. Try header
  const headerName = config.headerName || 'x-tenant-id'
  const fromHeader = headers[headerName]
  if (fromHeader && typeof fromHeader === 'string') return fromHeader

  // 2. Try subdomain
  if (config.subdomainEnabled && config.baseDomain && host) {
    if (host.endsWith(config.baseDomain)) {
      const subdomain = host.replace(`.${config.baseDomain}`, '').split('.')[0]
      if (subdomain && subdomain !== 'www') return subdomain
    }
  }

  return null
}

/**
 * Sets the PostgreSQL search_path for a tenant schema.
 * Returns a cleanup function to reset to public.
 */
export async function setSchemaContext(dataSource: DataSourceLike, schemaName: string): Promise<() => Promise<void>> {
  const qr = dataSource.createQueryRunner()
  await qr.connect()
  await qr.query(`SET search_path TO "${schemaName}", "public"`)

  return async () => {
    await qr.query(`SET search_path TO "public"`)
    await qr.release()
  }
}
