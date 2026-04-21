import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { type } from 'arktype';
import { basename, dirname, join } from 'pathe';
import {
  errorDirectoryExists,
  errorInvalidJson,
  errorInvalidManifest,
  errorInvalidSlug,
  errorMissingFile,
} from './errors';
import type { BaseMigrationBundle, MigrationManifest, MigrationOps } from './types';

const MANIFEST_FILE = 'migration.json';
const OPS_FILE = 'ops.json';
const MAX_SLUG_LENGTH = 64;

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

const MigrationHintsSchema = type({
  used: 'string[]',
  applied: 'string[]',
  plannerVersion: 'string',
  planningStrategy: 'string',
});

const MigrationManifestSchema = type({
  from: 'string',
  to: 'string',
  migrationId: 'string | null',
  kind: "'regular' | 'baseline'",
  fromContract: 'object | null',
  toContract: 'object',
  hints: MigrationHintsSchema,
  labels: 'string[]',
  'authorship?': type({
    'author?': 'string',
    'email?': 'string',
  }),
  'signature?': type({
    keyId: 'string',
    value: 'string',
  }).or('null'),
  createdAt: 'string',
});

const MigrationOpSchema = type({
  id: 'string',
  label: 'string',
  operationClass: "'additive' | 'widening' | 'destructive' | 'data'",
});

// Intentionally shallow: operation-specific payload validation is owned by planner/runner layers.
const MigrationOpsSchema = MigrationOpSchema.array();

export async function writeMigrationPackage(
  dir: string,
  manifest: MigrationManifest,
  ops: MigrationOps,
): Promise<void> {
  await mkdir(dirname(dir), { recursive: true });

  try {
    await mkdir(dir);
  } catch (error) {
    if (hasErrnoCode(error, 'EEXIST')) {
      throw errorDirectoryExists(dir);
    }
    throw error;
  }

  await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  await writeFile(join(dir, OPS_FILE), JSON.stringify(ops, null, 2), { flag: 'wx' });
}

/**
 * Copy a list of files into `destDir`, optionally renaming each one.
 *
 * The destination directory is created (with `recursive: true`) if it
 * does not already exist. Each source path is copied byte-for-byte into
 * `destDir/<destName>`; missing sources throw `ENOENT`. The helper is
 * intentionally generic: callers own the list of files (e.g. a contract
 * emitter's emitted output) and the naming convention (e.g. renaming
 * the destination contract to `contract.*` and the source contract to
 * `from-contract.*`).
 */
export async function copyFilesWithRename(
  destDir: string,
  files: readonly { readonly sourcePath: string; readonly destName: string }[],
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  for (const file of files) {
    await copyFile(file.sourcePath, join(destDir, file.destName));
  }
}

export async function writeMigrationManifest(
  dir: string,
  manifest: MigrationManifest,
): Promise<void> {
  await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function writeMigrationOps(dir: string, ops: MigrationOps): Promise<void> {
  await writeFile(join(dir, OPS_FILE), `${JSON.stringify(ops, null, 2)}\n`);
}

export async function readMigrationPackage(dir: string): Promise<BaseMigrationBundle> {
  const manifestPath = join(dir, MANIFEST_FILE);
  const opsPath = join(dir, OPS_FILE);

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile(MANIFEST_FILE, dir);
    }
    throw error;
  }

  let opsRaw: string;
  try {
    opsRaw = await readFile(opsPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile(OPS_FILE, dir);
    }
    throw error;
  }

  let manifest: MigrationManifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (e) {
    throw errorInvalidJson(manifestPath, e instanceof Error ? e.message : String(e));
  }

  let ops: MigrationOps;
  try {
    ops = JSON.parse(opsRaw);
  } catch (e) {
    throw errorInvalidJson(opsPath, e instanceof Error ? e.message : String(e));
  }

  validateManifest(manifest, manifestPath);
  validateOps(ops, opsPath);

  return {
    dirName: basename(dir),
    dirPath: dir,
    manifest,
    ops,
  };
}

function validateManifest(
  manifest: unknown,
  filePath: string,
): asserts manifest is MigrationManifest {
  const result = MigrationManifestSchema(manifest);
  if (result instanceof type.errors) {
    throw errorInvalidManifest(filePath, result.summary);
  }
}

function validateOps(ops: unknown, filePath: string): asserts ops is MigrationOps {
  const result = MigrationOpsSchema(ops);
  if (result instanceof type.errors) {
    throw errorInvalidManifest(filePath, result.summary);
  }
}

export async function readMigrationsDir(
  migrationsRoot: string,
): Promise<readonly BaseMigrationBundle[]> {
  let entries: string[];
  try {
    entries = await readdir(migrationsRoot);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }

  const packages: BaseMigrationBundle[] = [];

  for (const entry of entries.sort()) {
    const entryPath = join(migrationsRoot, entry);
    const entryStat = await stat(entryPath);
    if (!entryStat.isDirectory()) continue;

    const manifestPath = join(entryPath, MANIFEST_FILE);
    try {
      await stat(manifestPath);
    } catch {
      continue; // skip non-migration directories
    }

    packages.push(await readMigrationPackage(entryPath));
  }

  return packages;
}

export function formatMigrationDirName(timestamp: Date, slug: string): string {
  const sanitized = slug
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (sanitized.length === 0) {
    throw errorInvalidSlug(slug);
  }

  const truncated = sanitized.slice(0, MAX_SLUG_LENGTH);

  const y = timestamp.getUTCFullYear();
  const mo = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  const d = String(timestamp.getUTCDate()).padStart(2, '0');
  const h = String(timestamp.getUTCHours()).padStart(2, '0');
  const mi = String(timestamp.getUTCMinutes()).padStart(2, '0');

  return `${y}${mo}${d}T${h}${mi}_${truncated}`;
}
