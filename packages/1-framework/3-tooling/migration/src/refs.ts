import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { type } from 'arktype';
import { dirname, join, relative } from 'pathe';
import {
  errorInvalidRefFile,
  errorInvalidRefName,
  errorInvalidRefValue,
  MigrationToolsError,
} from './errors';

export interface RefEntry {
  readonly hash: string;
  readonly invariants: readonly string[];
}

export type Refs = Readonly<Record<string, RefEntry>>;

const REF_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const REF_VALUE_PATTERN = /^sha256:(empty|[0-9a-f]{64})$/;

export function validateRefName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes('..')) return false;
  if (name.includes('//')) return false;
  if (name.startsWith('.')) return false;
  return REF_NAME_PATTERN.test(name);
}

export function validateRefValue(value: string): boolean {
  return REF_VALUE_PATTERN.test(value);
}

const RefEntrySchema = type({
  hash: 'string',
  invariants: 'string[]',
}).narrow((entry, ctx) => {
  if (!validateRefValue(entry.hash))
    return ctx.mustBe(`a valid contract hash (got "${entry.hash}")`);
  return true;
});

function refFilePath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

function refNameFromPath(refsDir: string, filePath: string): string {
  const rel = relative(refsDir, filePath);
  return rel.replace(/\.json$/, '');
}

export async function readRef(refsDir: string, name: string): Promise<RefEntry> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  const filePath = refFilePath(refsDir, name);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      throw new MigrationToolsError('MIGRATION.UNKNOWN_REF', `Unknown ref "${name}"`, {
        why: `No ref file found at "${filePath}".`,
        fix: `Create the ref with: prisma-next migration ref set ${name} <hash>`,
        details: { refName: name, filePath },
      });
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw errorInvalidRefFile(filePath, 'Failed to parse as JSON');
  }

  const result = RefEntrySchema(parsed);
  if (result instanceof type.errors) {
    throw errorInvalidRefFile(filePath, result.summary);
  }

  return result;
}

export async function readRefs(refsDir: string): Promise<Refs> {
  let entries: string[];
  try {
    entries = await readdir(refsDir, { recursive: true, encoding: 'utf-8' });
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  const jsonFiles = entries.filter((entry) => entry.endsWith('.json'));
  const refs: Record<string, RefEntry> = {};

  for (const jsonFile of jsonFiles) {
    const filePath = join(refsDir, jsonFile);
    const name = refNameFromPath(refsDir, filePath);

    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw errorInvalidRefFile(filePath, 'Failed to parse as JSON');
    }

    const result = RefEntrySchema(parsed);
    if (result instanceof type.errors) {
      throw errorInvalidRefFile(filePath, result.summary);
    }

    refs[name] = result;
  }

  return refs;
}

export async function writeRef(refsDir: string, name: string, entry: RefEntry): Promise<void> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }
  if (!validateRefValue(entry.hash)) {
    throw errorInvalidRefValue(entry.hash);
  }

  const filePath = refFilePath(refsDir, name);
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = join(dir, `.${name.split('/').pop()}.json.${Date.now()}.tmp`);
  await writeFile(
    tmpPath,
    `${JSON.stringify({ hash: entry.hash, invariants: [...entry.invariants] }, null, 2)}\n`,
  );
  await rename(tmpPath, filePath);
}

export async function deleteRef(refsDir: string, name: string): Promise<void> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  const filePath = refFilePath(refsDir, name);
  try {
    await unlink(filePath);
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      throw new MigrationToolsError('MIGRATION.UNKNOWN_REF', `Unknown ref "${name}"`, {
        why: `No ref file found at "${filePath}".`,
        fix: 'Run `prisma-next migration ref list` to see available refs.',
        details: { refName: name, filePath },
      });
    }
    throw error;
  }

  // Clean empty parent directories up to refsDir
  let dir = dirname(filePath);
  while (dir !== refsDir && dir.startsWith(refsDir)) {
    try {
      await rmdir(dir);
      dir = dirname(dir);
    } catch {
      break;
    }
  }
}

export function resolveRef(refs: Refs, name: string): RefEntry {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  const entry = refs[name];
  if (entry === undefined) {
    throw new MigrationToolsError('MIGRATION.UNKNOWN_REF', `Unknown ref "${name}"`, {
      why: `No ref named "${name}" exists.`,
      fix: `Available refs: ${Object.keys(refs).join(', ') || '(none)'}. Create a ref with: prisma-next migration ref set ${name} <hash>`,
      details: { refName: name, availableRefs: Object.keys(refs) },
    });
  }

  return entry;
}
