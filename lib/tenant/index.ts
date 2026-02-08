// TenantEx Module - Multi-tenant utilities for Volcanic Backend
// Zero external dependencies - uses duck-typed interfaces

// Types
export type { DataSourceLike, QueryRunnerLike, RepositoryLike } from './types.js'

// Entity Interface & Provisioning
export {
  TenantEx,
  TenantStatus,
  ProvisionResult,
  validateSchemaName,
  createTenantSchema,
  syncTenantSchema,
  dropTenantSchema
} from './provisioner.js'

// Tenant Resolution
export { TenantResolverConfig, resolveTenant, extractTenantId, setSchemaContext } from './resolver.js'
