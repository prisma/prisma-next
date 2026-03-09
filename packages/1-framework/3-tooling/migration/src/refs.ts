import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { type } from 'arktype';
import { dirname, join } from 'pathe';
import { errorInvalidRefName, errorInvalidRefs, MigrationToolsError } from './errors';

export type Refs = Readonly<Record<string, string>>;

const REF_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function validateRefName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes('..')) return false;
  if (name.includes('//')) return false;
  if (name.startsWith('.')) return false;
  return REF_NAME_PATTERN.test(name);
}

const RefsSchema = type('Record<string, string>').narrow((refs, ctx) => {
  for (const key of Object.keys(refs)) {
    if (!validateRefName(key)) return ctx.mustBe(`valid ref names (invalid: "${key}")`);
  }
  return true;
});

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
    throw errorInvalidRefs(refsPath, 'Failed to parse as JSON');
  }

  const result = RefsSchema(parsed);
  if (result instanceof type.errors) {
    throw errorInvalidRefs(refsPath, result.summary);
  }

  return result;
}

export async function writeRefs(refsPath: string, refs: Refs): Promise<void> {
  for (const key of Object.keys(refs)) {
    if (!validateRefName(key)) {
      throw errorInvalidRefName(key);
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
    throw errorInvalidRefName(name);
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
