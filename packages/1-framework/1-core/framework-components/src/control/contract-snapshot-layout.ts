import { InternalError } from '@prisma-next/utils/internal-error';

export const CONTRACT_SNAPSHOTS_DIRNAME = 'snapshots';

const STORAGE_HASH_PATTERN = /^sha256:([0-9a-f]{64})$/;

/** Strip the `sha256:` prefix from a storage hash for use as a directory name. */
export function storageHashHex(storageHash: string): string {
  if (!STORAGE_HASH_PATTERN.test(storageHash)) {
    throw new InternalError(
      `Invalid storage hash "${storageHash}": expected "sha256:" followed by 64 lowercase hex characters`,
    );
  }
  return storageHash.slice('sha256:'.length);
}

/** Module specifier for the store's `contract.json`, POSIX separators. */
export function contractSnapshotJsonSpecifier(
  snapshotsImportPath: string,
  storageHash: string,
): string {
  return `${snapshotsImportPath}/${storageHashHex(storageHash)}/contract.json`;
}

/** Type-only module specifier for the store's `contract.d.ts` (no extension). */
export function contractSnapshotTypesSpecifier(
  snapshotsImportPath: string,
  storageHash: string,
): string {
  return `${snapshotsImportPath}/${storageHashHex(storageHash)}/contract`;
}
