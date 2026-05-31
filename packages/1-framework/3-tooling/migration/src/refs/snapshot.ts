import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { canonicalizeJson } from '@prisma-next/framework-components/utils';
import { type } from 'arktype';
import { basename, dirname, join } from 'pathe';
import { errorInvalidRefFile, errorInvalidRefName, MigrationToolsError } from '../errors';
import { deleteRef, type RefEntry, validateRefName, writeRef } from '../refs';

export interface ContractIR {
  readonly contract: unknown;
  readonly contractDts: string;
}

const ContractIrSchema = type({
  targetFamily: 'string',
  target: 'string',
  profileHash: 'string',
  storage: type({
    storageHash: 'string',
  }),
  domain: type({
    namespaces: 'object',
  }),
});

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

function snapshotJsonPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.json`);
}

function snapshotDtsPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.d.ts`);
}

function tmpPathFor(finalPath: string): string {
  const dir = dirname(finalPath);
  const fileName = basename(finalPath);
  return join(dir, `.${fileName}.${Date.now()}-${randomBytes(4).toString('hex')}.tmp`);
}

async function atomicWriteFile(finalPath: string, content: string): Promise<void> {
  const dir = dirname(finalPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = tmpPathFor(finalPath);
  await writeFile(tmpPath, content);
  await rename(tmpPath, finalPath);
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return;
    throw error;
  }
}

function parseContractSnapshotJson(filePath: string, raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw errorInvalidRefFile(filePath, 'Failed to parse as JSON');
  }

  const result = ContractIrSchema(parsed);
  if (result instanceof type.errors) {
    throw errorInvalidRefFile(filePath, result.summary);
  }

  return result;
}

export async function writeRefSnapshot(
  refsDir: string,
  name: string,
  snapshot: ContractIR,
): Promise<void> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  const jsonPath = snapshotJsonPath(refsDir, name);
  const dtsPath = snapshotDtsPath(refsDir, name);
  const jsonContent = `${canonicalizeJson(snapshot.contract)}\n`;
  const dtsContent = snapshot.contractDts.endsWith('\n')
    ? snapshot.contractDts
    : `${snapshot.contractDts}\n`;

  try {
    await atomicWriteFile(jsonPath, jsonContent);
  } catch (error) {
    await unlinkIfExists(jsonPath);
    throw error;
  }

  try {
    await atomicWriteFile(dtsPath, dtsContent);
  } catch (error) {
    await unlinkIfExists(jsonPath);
    await unlinkIfExists(dtsPath);
    throw error;
  }
}

export async function readRefSnapshot(refsDir: string, name: string): Promise<ContractIR | null> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  const jsonPath = snapshotJsonPath(refsDir, name);
  const dtsPath = snapshotDtsPath(refsDir, name);

  let raw: string;
  try {
    raw = await readFile(jsonPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }

  const contract = parseContractSnapshotJson(jsonPath, raw);

  let contractDts: string;
  try {
    contractDts = await readFile(dtsPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorInvalidRefFile(dtsPath, 'Missing paired contract.d.ts snapshot file');
    }
    throw error;
  }

  return { contract, contractDts };
}

export async function deleteRefSnapshot(refsDir: string, name: string): Promise<void> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  await unlinkIfExists(snapshotJsonPath(refsDir, name));
  await unlinkIfExists(snapshotDtsPath(refsDir, name));
}

export async function writeRefPaired(
  refsDir: string,
  name: string,
  entry: RefEntry,
  snapshot: ContractIR,
): Promise<void> {
  await writeRefSnapshot(refsDir, name, snapshot);
  try {
    await writeRef(refsDir, name, entry);
  } catch (writeError) {
    try {
      await deleteRefSnapshot(refsDir, name);
    } catch {
      // Rollback failure is secondary; preserve the original writeRef error.
    }
    throw writeError;
  }
}

function isUnknownRefError(error: unknown): boolean {
  return MigrationToolsError.is(error) && error.code === 'MIGRATION.UNKNOWN_REF';
}

async function snapshotFilesExist(refsDir: string, name: string): Promise<boolean> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  const paths = [snapshotJsonPath(refsDir, name), snapshotDtsPath(refsDir, name)];
  const checks = await Promise.allSettled(paths.map((filePath) => access(filePath)));
  return checks.some((result) => result.status === 'fulfilled');
}

export async function deleteRefPaired(refsDir: string, name: string): Promise<void> {
  if (await snapshotFilesExist(refsDir, name)) {
    try {
      await deleteRef(refsDir, name);
    } catch (error) {
      if (!isUnknownRefError(error)) {
        throw error;
      }
    }
    await deleteRefSnapshot(refsDir, name);
    return;
  }

  await deleteRef(refsDir, name);
  await deleteRefSnapshot(refsDir, name);
}
