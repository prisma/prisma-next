import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import {
  CONTRACT_SNAPSHOTS_DIRNAME,
  storageHashHex,
} from '@prisma-next/framework-components/control';
import { canonicalizeJson } from '@prisma-next/framework-components/utils';
import { blindCast } from '@prisma-next/utils/casts';
import { join, relative } from 'pathe';
import {
  errorContractSnapshotHashMismatch,
  errorContractSnapshotMissing,
  errorInvalidJson,
} from './errors';

const CONTRACT_JSON_FILE = 'contract.json';
const CONTRACT_DTS_FILE = 'contract.d.ts';

function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    blindCast<
      { code?: string },
      'Node fs errors carry an errno string `code` absent from the Error type'
    >(error).code === code
  );
}

async function directoryExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return false;
    throw error;
  }
}

export function contractSnapshotDir(migrationsDir: string, storageHash: string): string {
  return join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME, storageHashHex(storageHash));
}

export interface ContractSnapshotInput {
  readonly contractJson: unknown;
  readonly contractDts: string;
}

export async function writeContractSnapshot(
  migrationsDir: string,
  storageHash: string,
  input: ContractSnapshotInput,
): Promise<{ readonly written: boolean; readonly dir: string }> {
  const dir = contractSnapshotDir(migrationsDir, storageHash);

  // contractJson is unknown JSON; only storage.storageHash is read, to check
  // it against the hash the snapshot is being written under.
  const contractStorage = blindCast<
    { storage?: { storageHash?: unknown } },
    'contractJson is unknown JSON; only the storage.storageHash field is read here'
  >(input.contractJson);
  const actualStorageHash = contractStorage.storage?.storageHash;
  if (actualStorageHash !== storageHash) {
    throw errorContractSnapshotHashMismatch(
      storageHash,
      typeof actualStorageHash === 'string' ? actualStorageHash : String(actualStorageHash),
      dir,
    );
  }

  if (await directoryExists(dir)) {
    return { written: false, dir };
  }

  await mkdir(dir, { recursive: true });
  const jsonContent = `${canonicalizeJson(input.contractJson)}\n`;
  const dtsContent = input.contractDts.endsWith('\n')
    ? input.contractDts
    : `${input.contractDts}\n`;
  await writeFile(join(dir, CONTRACT_JSON_FILE), jsonContent);
  await writeFile(join(dir, CONTRACT_DTS_FILE), dtsContent);

  return { written: true, dir };
}

export async function readContractSnapshotJson(
  migrationsDir: string,
  storageHash: string,
): Promise<unknown> {
  const jsonPath = join(contractSnapshotDir(migrationsDir, storageHash), CONTRACT_JSON_FILE);

  let raw: string;
  try {
    raw = await readFile(jsonPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorContractSnapshotMissing(storageHash, jsonPath);
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw errorInvalidJson(jsonPath, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Tolerant read: a missing store entry, unparseable `contract.json`, the
 * JSON literal `null`, or a `storageHash` that isn't a well-formed
 * `sha256:<64hex>` value all resolve to `undefined` rather than throwing —
 * parity with the catch-all tolerance of the pre-store `readEndContractJson`
 * (`io.ts`), which never validated the hash it was keyed by either.
 */
export async function readContractSnapshotJsonTolerant(
  migrationsDir: string,
  storageHash: string,
): Promise<unknown | undefined> {
  let jsonPath: string;
  try {
    jsonPath = join(contractSnapshotDir(migrationsDir, storageHash), CONTRACT_JSON_FILE);
  } catch {
    return undefined;
  }

  let raw: string;
  try {
    raw = await readFile(jsonPath, 'utf-8');
  } catch {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null ? undefined : parsed;
  } catch {
    return undefined;
  }
}

export async function readContractSnapshotDts(
  migrationsDir: string,
  storageHash: string,
): Promise<string> {
  const dtsPath = join(contractSnapshotDir(migrationsDir, storageHash), CONTRACT_DTS_FILE);

  try {
    return await readFile(dtsPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorContractSnapshotMissing(storageHash, dtsPath);
    }
    throw error;
  }
}

export function snapshotsImportPathFrom(packageDir: string, migrationsDir: string): string {
  const storeDir = join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME);
  return relative(packageDir, storeDir).split('\\').join('/');
}
