export type { IRNode } from '../ir/ir-node';
export { freezeNode, IRNodeBase } from '../ir/ir-node';
export type { Namespace } from '../ir/namespace';
export { NamespaceBase, UNBOUND_NAMESPACE_ID } from '../ir/namespace';
export type { EntityCoordinate, Storage } from '../ir/storage';
export { elementCoordinates } from '../ir/storage';
export type { FlatStorageInput, StoragePlaneReservedKey } from '../ir/storage-plane-keys';
export {
  flatStorageInput,
  getStorageNamespace,
  isStoragePlaneReservedKey,
  STORAGE_PLANE_RESERVED_KEYS,
  storageNamespaceEntries,
  storageNamespaceValues,
} from '../ir/storage-plane-keys';
export type { StorageType } from '../ir/storage-type';
