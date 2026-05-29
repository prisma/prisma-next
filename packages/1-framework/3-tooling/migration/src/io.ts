import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type {
  MigrationMetadata,
  MigrationPackage,
} from '@prisma-next/framework-components/control';
import { type } from 'arktype';
import { basename, dirname, join, resolve } from 'pathe';
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

const MigrationMetadataSchema = type({
  '+': 'reject',
  from: 'string > 0 | null',
  to: 'string',
  migrationHash: 'string',
  providedInvariants: 'string[]',
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
 * Writes two files under `<targetDir>/<pkg.dirName>/`:
 *
 * - `migration.json` — the manifest (pretty-printed, matches
 *   {@link writeMigrationPackage}'s output for byte-for-byte parity with
 *   app-space migrations).
 * - `ops.json` — the operation list (pretty-printed).
 *
 * Distinct verb from the lower-level {@link writeMigrationPackage}
 * (which takes constituent `(metadata, ops)`): callers reading
 * `materialise…` know they are persisting a struct-typed package.
 *
 * Overwrite-idempotent: the per-package directory is cleared before
 * each emit, so re-running against the same `targetDir` produces
 * byte-identical contents and never leaves stale files behind. The
 * lower-level {@link writeMigrationPackage} stays strict because the
 * CLI authoring path (`migration plan` / `migration new`) deliberately
 * refuses to clobber an existing authored migration; this helper is
 * the re-emit path that is supposed to converge on a single canonical
 * on-disk shape.
 *
 * The per-space head contract lives at
 * `<projectMigrationsDir>/<spaceId>/contract.json` (written by
 * {@link import('./emit-contract-space-artefacts').emitContractSpaceArtefacts}),
 * not inside the per-package directory. The runner reads only
 * `migration.json` + `ops.json` from each package.
 */
export async function materialiseMigrationPackage(
  targetDir: string,
  pkg: MigrationPackage,
): Promise<void> {
  const dir = join(targetDir, pkg.dirName);
  await rm(dir, { recursive: true, force: true });
  await writeMigrationPackage(dir, pkg.metadata, pkg.ops);
}

/**
 * Idempotent variant of {@link materialiseMigrationPackage}: writes the
 * package only if `<targetDir>/<pkg.dirName>/` does not already exist on
 * disk as a directory; returns `{ written: false }` when the package
 * directory is present (no rewrite, no comparison — by-existence skip).
 *
 * Concretely:
 *   - existing directory → skip silently, return `{ written: false }`.
 *   - missing path → write three files via {@link materialiseMigrationPackage},
 *     return `{ written: true }`.
 *   - path exists but is not a directory (file/symlink) → treated as
 *     missing; {@link materialiseMigrationPackage} will attempt creation
 *     and fail with an appropriate OS error.
 *   - any other I/O error from `stat` → propagated unchanged.
 *
 * Used by the CLI's `runContractSpaceExtensionMigrationsPass` to
 * materialise extension migration packages into a project's
 * `migrations/<spaceId>/` directory, and by extension-package tests
 * that mirror the same idempotent-rematerialise property locally
 * without taking a CLI dependency.
 */
export async function materialiseExtensionMigrationPackageIfMissing(
  targetDir: string,
  pkg: MigrationPackage,
): Promise<{ readonly written: boolean }> {
  const pkgDir = join(targetDir, pkg.dirName);
  if (await directoryExists(pkgDir)) {
    return { written: false };
  }
  await materialiseMigrationPackage(targetDir, pkg);
  return { written: true };
}

async function directoryExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return false;
    throw error;
  }
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
  const absoluteDir = resolve(dir);
  const manifestPath = join(absoluteDir, MANIFEST_FILE);
  const opsPath = join(absoluteDir, OPS_FILE);

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile(MANIFEST_FILE, absoluteDir);
    }
    throw error;
  }

  let opsRaw: string;
  try {
    opsRaw = await readFile(opsPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile(OPS_FILE, absoluteDir);
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
    dirName: basename(absoluteDir),
    dirPath: absoluteDir,
    metadata,
    ops,
  };

  const verification = verifyMigrationHash(pkg);
  if (!verification.ok) {
    throw errorMigrationHashMismatch(
      absoluteDir,
      verification.storedHash,
      verification.computedHash,
    );
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
