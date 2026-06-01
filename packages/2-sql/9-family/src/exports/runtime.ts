import { sqlRuntimeFamilyDescriptor } from '../core/runtime-descriptor';

export {
  defaultDomainNamespaceIdForSqlTarget,
  defaultStorageNamespaceIdForSqlTarget,
  POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID,
  POSTGRES_DEFAULT_STORAGE_NAMESPACE_ID,
  type ResolveDomainModelOptions,
  type ResolvedDomainModel,
  type ResolvedStorageTable,
  type ResolveStorageTableOptions,
  resolveDomainModel,
  resolveStorageTable,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '../core/default-namespace';
export { timestampNowRuntimeGenerator } from '../core/timestamp-now-runtime-generator';

export default sqlRuntimeFamilyDescriptor;
