import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'pathe';
import type { MigrationManifest, MigrationOps, MigrationPackage } from './types';

const MANIFEST_FILE = 'migration.json';
const OPS_FILE = 'ops.json';
const MAX_SLUG_LENGTH = 64;

export async function writeMigrationPackage(
  dir: string,
  manifest: MigrationManifest,
  ops: MigrationOps,
): Promise<void> {
  let exists = false;
  try {
    await stat(dir);
    exists = true;
  } catch {
    // directory doesn't exist, which is what we want
  }
  if (exists) {
    throw new Error(
      `Migration directory already exists: ${dir}. Use --name to pick a different name or delete the existing directory.`,
    );
  }

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  await writeFile(join(dir, OPS_FILE), JSON.stringify(ops, null, 2));
}

export async function readMigrationPackage(dir: string): Promise<MigrationPackage> {
  const manifestPath = join(dir, MANIFEST_FILE);
  const opsPath = join(dir, OPS_FILE);

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, 'utf-8');
  } catch {
    throw new Error(`Missing ${MANIFEST_FILE} in ${dir}`);
  }

  let opsRaw: string;
  try {
    opsRaw = await readFile(opsPath, 'utf-8');
  } catch {
    throw new Error(`Missing ${OPS_FILE} in ${dir}`);
  }

  let manifest: MigrationManifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${e instanceof Error ? e.message : e}`);
  }

  let ops: MigrationOps;
  try {
    ops = JSON.parse(opsRaw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${opsPath}: ${e instanceof Error ? e.message : e}`);
  }

  validateManifest(manifest, manifestPath);

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
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Invalid manifest in ${filePath}: expected an object`);
  }
  const m = manifest as Record<string, unknown>;
  const required = ['from', 'to', 'kind', 'toContract'] as const;
  for (const field of required) {
    if (!(field in m)) {
      throw new Error(`Invalid manifest in ${filePath}: missing required field "${field}"`);
    }
  }
  if (typeof m['from'] !== 'string') {
    throw new Error(`Invalid manifest in ${filePath}: "from" must be a string`);
  }
  if (typeof m['to'] !== 'string') {
    throw new Error(`Invalid manifest in ${filePath}: "to" must be a string`);
  }
  if (m['kind'] !== 'regular' && m['kind'] !== 'baseline') {
    throw new Error(`Invalid manifest in ${filePath}: "kind" must be "regular" or "baseline"`);
  }
}

export async function readMigrationsDir(
  migrationsRoot: string,
): Promise<readonly MigrationPackage[]> {
  let entries: string[];
  try {
    entries = await readdir(migrationsRoot);
  } catch {
    return [];
  }

  const packages: MigrationPackage[] = [];

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
    throw new Error(`Slug "${slug}" results in an empty string after sanitization`);
  }

  const truncated = sanitized.slice(0, MAX_SLUG_LENGTH);

  const y = timestamp.getUTCFullYear();
  const mo = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  const d = String(timestamp.getUTCDate()).padStart(2, '0');
  const h = String(timestamp.getUTCHours()).padStart(2, '0');
  const mi = String(timestamp.getUTCMinutes()).padStart(2, '0');

  return `${y}${mo}${d}T${h}${mi}_${truncated}`;
}
