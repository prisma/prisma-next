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
  it('returns empty record for missing refs directory', async () => {
    const tempDir = await createTempDir('missing-refs');
    const refs = await readRefs(join(tempDir, 'refs'));
    expect(refs).toEqual({});
  });

  it('throws MigrationToolsError for malformed JSON in ref file', async () => {
    const tempDir = await createTempDir('bad-json');
    const refsDir = join(tempDir, 'refs');
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'staging.json'), '{ not valid json !!!');

    await expect(readRefs(refsDir)).rejects.toSatisfy((error: unknown) => {
      return (
        MigrationToolsError.is(error) &&
        error.code === 'MIGRATION.INVALID_REF_FILE' &&
        error.message.includes('Invalid ref file')
      );
    });
  });

  it('throws MigrationToolsError for invalid ref values in file', async () => {
    const tempDir = await createTempDir('bad-values');
    const refsDir = join(tempDir, 'refs');
    await mkdir(refsDir, { recursive: true });
    await writeFile(
      join(refsDir, 'staging.json'),
      JSON.stringify({ hash: 'not-a-hash', invariants: [] }),
    );

    await expect(readRefs(refsDir)).rejects.toSatisfy((error: unknown) => {
      return MigrationToolsError.is(error) && error.code === 'MIGRATION.INVALID_REF_FILE';
    });
  });
});
