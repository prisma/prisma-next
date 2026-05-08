import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type {
  MigrationMetadata,
  MigrationPackage,
} from '@prisma-next/framework-components/control';
import { type } from 'arktype';
import { basename, dirname, join } from 'pathe';
import { canonicalizeJson } from './canonicalize-json';
import {
  errorDirectoryExists,
  errorInvalidDestName,
  errorInvalidJson,
  errorInvalidManifest,
  errorInvalidSlug,
  errorMigrationHashMismatch,
  errorMissingFile,
  errorProvidedInvariantsMismatch,
} from './errors';
import { verifyMigrationHash } from './hash';
import { deriveProvidedInvariants } from './invariants';
import { MigrationOpsSchema } from './op-schema';
import type { MigrationOps, OnDiskMigrationPackage } from './package';

export const MANIFEST_FILE = 'migration.json';
const OPS_FILE = 'ops.json';
const MAX_SLUG_LENGTH = 64;

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

const MigrationHintsSchema = type({
  used: 'string[]',
  applied: 'string[]',
  plannerVersion: 'string',
});

const MigrationMetadataSchema = type({
  '+': 'reject',
  from: 'string > 0 | null',
  to: 'string',
  migrationHash: 'string',
  fromContract: 'object | null',
  toContract: 'object',
  hints: MigrationHintsSchema,
  labels: 'string[]',
  providedInvariants: 'string[]',
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

export async function writeMigrationPackage(
  dir: string,
  metadata: MigrationMetadata,
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

  await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(metadata, null, 2), {
    flag: 'wx',
  });
  await writeFile(join(dir, OPS_FILE), JSON.stringify(ops, null, 2), { flag: 'wx' });
}

/**
 * Materialise an in-memory {@link MigrationPackage} to a per-space
 * directory on disk.
 *
 * Writes three files under `<targetDir>/<pkg.dirName>/`:
 *
 * - `migration.json` — the manifest (pretty-printed, matches
 *   {@link writeMigrationPackage}'s output for byte-for-byte parity with
 *   app-space migrations).
 * - `ops.json` — the operation list (pretty-printed).
 * - `contract.json` — the canonical-JSON serialisation of
 *   `metadata.toContract`. This is the per-package post-state contract
 *   snapshot; the canonicalisation pass guarantees byte-determinism so
 *   re-emitting the same package across machines / runs produces an
 *   identical file.
 *
 * Distinct verb from the lower-level {@link writeMigrationPackage}
 * (which takes constituent `(metadata, ops)`): callers reading
 * `materialise…` know they are persisting a struct-typed package
 * including its contract-snapshot side car.
 *
 * The function fails (via `writeMigrationPackage`'s underlying check)
 * if the target directory already exists, mirroring the strictness of
 * the app-space emit path. Callers wanting "create-or-overwrite"
 * semantics handle that at a higher level (e.g. the pinned-artefact
 * emission step, which lives outside the per-package writer).
 *
 * @see specs/framework-mechanism.spec.md § 3 — Emission helper (T1.7).
 */
export async function materialiseMigrationPackage(
  targetDir: string,
  pkg: MigrationPackage,
): Promise<void> {
  const dir = join(targetDir, pkg.dirName);
  await writeMigrationPackage(dir, pkg.metadata, pkg.ops);
  await writeFile(join(dir, 'contract.json'), `${canonicalizeJson(pkg.metadata.toContract)}\n`, {
    flag: 'wx',
  });
}

/**
 * Copy a list of files into `destDir`, optionally renaming each one.
 *
 * The destination directory is created (with `recursive: true`) if it
 * does not already exist. Each source path is copied byte-for-byte into
 * `destDir/<destName>`; missing sources throw `ENOENT`. The helper is
 * intentionally generic: callers own the list of files (e.g. a contract
 * emitter's emitted output) and the naming convention (e.g. renaming
 * the destination contract to `end-contract.*` and the source contract
 * to `start-contract.*`).
 */
export async function copyFilesWithRename(
  destDir: string,
  files: readonly { readonly sourcePath: string; readonly destName: string }[],
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  for (const file of files) {
    if (basename(file.destName) !== file.destName) {
      throw errorInvalidDestName(file.destName);
    }
    await copyFile(file.sourcePath, join(destDir, file.destName));
  }
}

export async function writeMigrationMetadata(
  dir: string,
  metadata: MigrationMetadata,
): Promise<void> {
  await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function writeMigrationOps(dir: string, ops: MigrationOps): Promise<void> {
  await writeFile(join(dir, OPS_FILE), `${JSON.stringify(ops, null, 2)}\n`);
}

export async function readMigrationPackage(dir: string): Promise<OnDiskMigrationPackage> {
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

  let metadata: MigrationMetadata;
  try {
    metadata = JSON.parse(manifestRaw);
  } catch (e) {
    throw errorInvalidJson(manifestPath, e instanceof Error ? e.message : String(e));
  }

  let ops: MigrationOps;
  try {
    ops = JSON.parse(opsRaw);
  } catch (e) {
    throw errorInvalidJson(opsPath, e instanceof Error ? e.message : String(e));
  }

  validateMetadata(metadata, manifestPath);
  validateOps(ops, opsPath);

  // Re-derive before the hash check so format/duplicate diagnostics
  // fire with their dedicated codes rather than as a generic hash mismatch.
  const derivedInvariants = deriveProvidedInvariants(ops);
  if (!arraysEqual(metadata.providedInvariants, derivedInvariants)) {
    throw errorProvidedInvariantsMismatch(
      manifestPath,
      metadata.providedInvariants,
      derivedInvariants,
    );
  }

  const pkg: OnDiskMigrationPackage = {
    dirName: basename(dir),
    dirPath: dir,
    metadata,
    ops,
  };

  const verification = verifyMigrationHash(pkg);
  if (!verification.ok) {
    throw errorMigrationHashMismatch(dir, verification.storedHash, verification.computedHash);
  }

  return pkg;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function validateMetadata(
  metadata: unknown,
  filePath: string,
): asserts metadata is MigrationMetadata {
  const result = MigrationMetadataSchema(metadata);
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
): Promise<readonly OnDiskMigrationPackage[]> {
  let entries: string[];
  try {
    entries = await readdir(migrationsRoot);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }

  const packages: OnDiskMigrationPackage[] = [];

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
