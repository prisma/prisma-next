import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'pathe';
import { MigrationToolsError } from './errors';

export type Refs = Readonly<Record<string, string>>;

const REF_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function validateRefName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes('..')) return false;
  if (name.includes('//')) return false;
  if (name.startsWith('.')) return false;
  return REF_NAME_PATTERN.test(name);
}

export async function readRefs(refsPath: string): Promise<Refs> {
  let raw: string;
  try {
    raw = await readFile(refsPath, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MigrationToolsError('MIGRATION.INVALID_REFS', 'Invalid refs.json', {
      why: `Failed to parse "${refsPath}" as JSON.`,
      fix: 'Fix the JSON syntax in refs.json or delete it and recreate.',
      details: { path: refsPath },
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MigrationToolsError('MIGRATION.INVALID_REFS', 'Invalid refs.json', {
      why: `Expected refs.json to be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}.`,
      fix: 'Ensure refs.json is a flat object mapping ref names to contract hash strings.',
      details: { path: refsPath },
    });
  }

  const record = parsed as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      throw new MigrationToolsError('MIGRATION.INVALID_REFS', 'Invalid refs.json', {
        why: `Ref "${key}" has a non-string value. All ref values must be contract hash strings.`,
        fix: `Update the value of "${key}" in refs.json to a valid contract hash string.`,
        details: { path: refsPath, refName: key, valueType: typeof value },
      });
    }
    if (!validateRefName(key)) {
      throw new MigrationToolsError('MIGRATION.INVALID_REFS', 'Invalid refs.json', {
        why: `Ref name "${key}" is invalid. Names must be lowercase alphanumeric with hyphens or forward slashes, no path traversal.`,
        fix: `Rename "${key}" in refs.json to a valid ref name (e.g., "staging", "envs/production").`,
        details: { path: refsPath, refName: key },
      });
    }
  }

  return record as Refs;
}

export async function writeRefs(refsPath: string, refs: Refs): Promise<void> {
  for (const key of Object.keys(refs)) {
    if (!validateRefName(key)) {
      throw new MigrationToolsError('MIGRATION.INVALID_REF_NAME', 'Invalid ref name', {
        why: `Ref name "${key}" is invalid. Names must be lowercase alphanumeric with hyphens or forward slashes, no path traversal.`,
        fix: `Use a valid ref name (e.g., "staging", "envs/production").`,
        details: { refName: key },
      });
    }
  }

  const sorted = Object.fromEntries(Object.entries(refs).sort(([a], [b]) => a.localeCompare(b)));

  const dir = dirname(refsPath);
  await mkdir(dir, { recursive: true });

  const tmpPath = join(dir, `.refs.json.${Date.now()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(sorted, null, 2) + '\n');
  await rename(tmpPath, refsPath);
}

export function resolveRef(refs: Refs, name: string): string {
  if (!validateRefName(name)) {
    throw new MigrationToolsError('MIGRATION.INVALID_REF_NAME', 'Invalid ref name', {
      why: `Ref name "${name}" is invalid. Names must be lowercase alphanumeric with hyphens or forward slashes, no path traversal.`,
      fix: `Use a valid ref name (e.g., "staging", "envs/production").`,
      details: { refName: name },
    });
  }

  const hash = refs[name];
  if (hash === undefined) {
    throw new MigrationToolsError('MIGRATION.UNKNOWN_REF', `Unknown ref "${name}"`, {
      why: `No ref named "${name}" exists in refs.json.`,
      fix: `Available refs: ${Object.keys(refs).join(', ') || '(none)'}. Create a ref with: set the "${name}" key in migrations/refs.json.`,
      details: { refName: name, availableRefs: Object.keys(refs) },
    });
  }

  return hash;
}
