import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { attestMigration, verifyMigration } from '@prisma-next/migration-tools/attestation';
import { formatMigrationDirName, writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { describe, expect, it } from 'vitest';

function createTestContract(): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    models: {},
    relations: {},
    storage: { tables: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
  };
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-verify-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('migration verify', () => {
  it('verifies attested package', async () => {
    const tempDir = await createTempDir('verified');
    const dirName = formatMigrationDirName(new Date(), 'test');
    const packageDir = join(tempDir, dirName);

    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:test',
      edgeId: null,
      parentEdgeId: null,
      kind: 'regular',
      fromContract: null,
      toContract: createTestContract(),
      hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'manual' },
      labels: [],
      createdAt: new Date().toISOString(),
    };

    await writeMigrationPackage(packageDir, manifest, []);
    await attestMigration(packageDir);

    const result = await verifyMigration(packageDir);
    expect(result.ok).toBe(true);
    expect(result.storedEdgeId).toBeDefined();
    expect(result.computedEdgeId).toBeDefined();
    expect(result.storedEdgeId).toBe(result.computedEdgeId);
  });

  it('detects tampered package', async () => {
    const tempDir = await createTempDir('tampered');
    const dirName = formatMigrationDirName(new Date(), 'test');
    const packageDir = join(tempDir, dirName);

    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:test',
      edgeId: null,
      parentEdgeId: null,
      kind: 'regular',
      fromContract: null,
      toContract: createTestContract(),
      hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'manual' },
      labels: [],
      createdAt: new Date().toISOString(),
    };

    await writeMigrationPackage(packageDir, manifest, []);
    await attestMigration(packageDir);

    // Tamper with ops.json (must still pass schema validation)
    await writeFile(
      join(packageDir, 'ops.json'),
      JSON.stringify(
        [{ id: 'tampered.fake', label: 'Tampered operation', operationClass: 'additive' }],
        null,
        2,
      ),
    );

    const result = await verifyMigration(packageDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
    expect(result.storedEdgeId).not.toBe(result.computedEdgeId);
  });

  it('attests draft package', async () => {
    const tempDir = await createTempDir('draft');
    const dirName = formatMigrationDirName(new Date(), 'test');
    const packageDir = join(tempDir, dirName);

    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:test',
      edgeId: null,
      parentEdgeId: null,
      kind: 'regular',
      fromContract: null,
      toContract: createTestContract(),
      hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'manual' },
      labels: [],
      createdAt: new Date().toISOString(),
    };

    await writeMigrationPackage(packageDir, manifest, []);

    // Verify returns draft
    const result = await verifyMigration(packageDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('draft');

    // Attest it
    const edgeId = await attestMigration(packageDir);
    expect(edgeId).toMatch(/^sha256:/);

    // Now verify again — passes
    const result2 = await verifyMigration(packageDir);
    expect(result2.ok).toBe(true);
  });
});
