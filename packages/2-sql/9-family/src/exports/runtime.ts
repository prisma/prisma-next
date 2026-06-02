import { sqlRuntimeFamilyDescriptor } from '../core/runtime-descriptor';

export {
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
