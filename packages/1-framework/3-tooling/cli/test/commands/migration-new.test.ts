import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import {
  formatMigrationDirName,
  readMigrationPackage,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { describe, expect, it } from 'vitest';

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-new-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('migration new — scaffold', () => {
  it('creates a draft migration package', async () => {
    const tempDir = await createTempDir('scaffold');
    const dirName = formatMigrationDirName(new Date(), 'add_users');
    const packageDir = join(tempDir, dirName);

    const emptyContract = {
      schemaVersion: '1',
      targetFamily: '',
      target: '',
      models: {},
      relations: {},
      storage: { tables: {} },
      extensionPacks: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: EMPTY_CONTRACT_HASH,
      edgeId: null,
      kind: 'regular',
      fromContract: null,
      toContract: emptyContract,
      hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'manual' },
      labels: [],
      createdAt: new Date().toISOString(),
    };

    await writeMigrationPackage(packageDir, manifest, []);

    const pkg = await readMigrationPackage(packageDir);

    expect(pkg.manifest.edgeId).toBeNull();
    expect(pkg.manifest.from).toBe(EMPTY_CONTRACT_HASH);
    expect(pkg.manifest.to).toBe(EMPTY_CONTRACT_HASH);
    expect(pkg.manifest.kind).toBe('regular');
    expect(pkg.ops).toHaveLength(0);
    expect(pkg.dirName).toBe(dirName);
  });

  it('formats directory name correctly', () => {
    const timestamp = new Date(Date.UTC(2026, 1, 25, 14, 30));
    const dirName = formatMigrationDirName(timestamp, 'Add Users Table');

    expect(dirName).toBe('20260225T1430_add_users_table');
  });

  it('rejects empty slug', () => {
    expect(() => formatMigrationDirName(new Date(), '---')).toThrow();
  });
});
