import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { describe, expect, it } from 'vitest';

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-status-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('readRefs error surface (F01/F04)', () => {
  it('returns empty object for missing refs.json', async () => {
    const tempDir = await createTempDir('missing-refs');
    const refs = await readRefs(join(tempDir, 'refs.json'));
    expect(refs).toEqual({});
  });

  it('throws MigrationToolsError for malformed JSON', async () => {
    const tempDir = await createTempDir('bad-json');
    const refsPath = join(tempDir, 'refs.json');
    await writeFile(refsPath, '{ not valid json !!!');

    await expect(readRefs(refsPath)).rejects.toSatisfy((error: unknown) => {
      return (
        MigrationToolsError.is(error) &&
        error.code === 'MIGRATION.INVALID_REFS' &&
        error.message.includes('Invalid refs.json')
      );
    });
  });

  it('throws MigrationToolsError for invalid ref names', async () => {
    const tempDir = await createTempDir('bad-names');
    const refsPath = join(tempDir, 'refs.json');
    await writeFile(refsPath, JSON.stringify({ 'UPPER-CASE': 'sha256:empty' }));

    await expect(readRefs(refsPath)).rejects.toSatisfy((error: unknown) => {
      return MigrationToolsError.is(error) && error.code === 'MIGRATION.INVALID_REFS';
    });
  });

  it('throws MigrationToolsError for invalid ref values', async () => {
    const tempDir = await createTempDir('bad-values');
    const refsPath = join(tempDir, 'refs.json');
    await writeFile(refsPath, JSON.stringify({ staging: 'not-a-hash' }));

    await expect(readRefs(refsPath)).rejects.toSatisfy((error: unknown) => {
      return MigrationToolsError.is(error) && error.code === 'MIGRATION.INVALID_REFS';
    });
  });
});
