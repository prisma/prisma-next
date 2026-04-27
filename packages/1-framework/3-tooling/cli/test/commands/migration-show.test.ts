import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContract, createSqlContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationId } from '@prisma-next/migration-tools/attestation';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest, MigrationPackage } from '@prisma-next/migration-tools/types';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { resolveByHashPrefix } from '../../src/commands/migration-show';
import { formatMigrationShowOutput } from '../../src/utils/formatters/migrations';
import { parseGlobalFlags } from '../../src/utils/global-flags';

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-show-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

function createOp(
  id: string,
  label: string,
  operationClass: 'additive' | 'widening' | 'destructive',
  sql?: string[],
): MigrationPlanOperation {
  const op: Record<string, unknown> = { id, label, operationClass };
  if (sql) {
    op['execute'] = sql.map((s) => ({ sql: s }));
  }
  return op as unknown as MigrationPlanOperation;
}

/**
 * Build a draft (un-attested) base manifest. The actual on-disk manifest
 * is attested inside `setupMigrationDir`, where the `migrationId` is
 * computed once we know the full ops list.
 */
function createManifest(
  from: string,
  to: string,
  toContract: Contract,
  fromContract: Contract | null = null,
): Omit<MigrationManifest, 'migrationId'> {
  return {
    from,
    to,
    kind: 'regular',
    fromContract,
    toContract,
    hints: { used: [], applied: [], plannerVersion: '1.0.0' },
    labels: [],
    createdAt: new Date().toISOString(),
  };
}

async function setupMigrationDir(
  migrationsDir: string,
  name: string,
  baseManifest: Omit<MigrationManifest, 'migrationId'>,
  ops: MigrationPlanOperation[],
  dateOffset = 0,
): Promise<string> {
  const date = new Date(2026, 0, 1 + dateOffset, 10, 0);
  const dirName = formatMigrationDirName(date, name);
  const packageDir = join(migrationsDir, dirName);
  const manifest: MigrationManifest = {
    ...baseManifest,
    migrationId: computeMigrationId(baseManifest, ops),
  };
  await writeMigrationPackage(packageDir, manifest, ops);
  return packageDir;
}

describe('resolveByHashPrefix', () => {
  it('resolves exact migrationId match', async () => {
    const tempDir = await createTempDir('exact');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contract = createSqlContract({
      storage: {
        tables: {
          user: { columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } } },
        },
      },
    });

    await setupMigrationDir(
      migrationsDir,
      'add-user',
      createManifest(EMPTY_CONTRACT_HASH, 'sha256:hash-a', contract),
      [createOp('table.user', 'Create table "user"', 'additive')],
    );

    const packages = await readMigrationsDir(migrationsDir);
    const pkg = packages[0]!;
    const migrationId = pkg.manifest.migrationId!;

    const result = resolveByHashPrefix(packages, migrationId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.migrationId).toBe(migrationId);
    }
  });

  it('resolves unique prefix', async () => {
    const tempDir = await createTempDir('prefix');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contract = createSqlContract({
      storage: {
        tables: {
          user: { columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } } },
        },
      },
    });

    await setupMigrationDir(
      migrationsDir,
      'add-user',
      createManifest(EMPTY_CONTRACT_HASH, 'sha256:hash-a', contract),
      [createOp('table.user', 'Create table "user"', 'additive')],
    );

    const packages = await readMigrationsDir(migrationsDir);
    const migrationId = packages[0]!.manifest.migrationId!;
    const prefix = migrationId.slice(0, 12);

    const result = resolveByHashPrefix(packages, prefix);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.migrationId).toBe(migrationId);
    }
  });

  it('returns error for no matches', () => {
    const packages: MigrationPackage[] = [
      {
        dirName: '20260101_100000_test',
        dirPath: '/tmp/test',
        manifest: {
          from: EMPTY_CONTRACT_HASH,
          to: 'sha256:hash-a',
          migrationId: 'sha256:abc123',
          kind: 'regular',
          fromContract: null,
          toContract: createContract(),
          hints: { used: [], applied: [], plannerVersion: '1.0.0' },
          labels: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'sha256:zzz');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('No migration found');
    }
  });

  it('returns error for ambiguous prefix', () => {
    const contract = createContract();
    const packages: MigrationPackage[] = [
      {
        dirName: '20260101_100000_first',
        dirPath: '/tmp/first',
        manifest: {
          from: EMPTY_CONTRACT_HASH,
          to: 'sha256:hash-a',
          migrationId: 'sha256:abc111',
          kind: 'regular',
          fromContract: null,
          toContract: contract,
          hints: { used: [], applied: [], plannerVersion: '1.0.0' },
          labels: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
      {
        dirName: '20260102_100000_second',
        dirPath: '/tmp/second',
        manifest: {
          from: 'sha256:hash-a',
          to: 'sha256:hash-b',
          migrationId: 'sha256:abc222',
          kind: 'regular',
          fromContract: contract,
          toContract: contract,
          hints: { used: [], applied: [], plannerVersion: '1.0.0' },
          labels: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'sha256:abc');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('Ambiguous');
    }
  });

  it('resolves prefix without sha256: scheme', () => {
    const packages: MigrationPackage[] = [
      {
        dirName: '20260101_100000_test',
        dirPath: '/tmp/test',
        manifest: {
          from: EMPTY_CONTRACT_HASH,
          to: 'sha256:hash-a',
          migrationId: 'sha256:abc123def456',
          kind: 'regular',
          fromContract: null,
          toContract: createContract(),
          hints: { used: [], applied: [], plannerVersion: '1.0.0' },
          labels: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'abc123');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.migrationId).toBe('sha256:abc123def456');
    }
  });

  it('returns no match when prefix matches nothing', () => {
    // After the draft state was collapsed, every package has a real
    // `migrationId` — there is no longer a "skip draft" branch. The
    // prefix lookup simply returns no-match if nothing in the chain
    // shares the requested prefix.
    const packages: MigrationPackage[] = [
      {
        dirName: '20260101_100000_only',
        dirPath: '/tmp/only',
        manifest: {
          from: EMPTY_CONTRACT_HASH,
          to: 'sha256:hash-a',
          migrationId: 'sha256:abc999000000',
          kind: 'regular',
          fromContract: null,
          toContract: createContract(),
          hints: { used: [], applied: [], plannerVersion: '1.0.0' },
          labels: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'sha256:zzz');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('No migration found');
    }
  });
});

describe('formatMigrationShowOutput', () => {
  it('shows migration metadata', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      {
        dirName: '20260101_100000_add_user',
        dirPath: 'migrations/20260101_100000_add_user',
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        migrationId: 'sha256:edge-abc',
        kind: 'regular',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
        ],
        sql: ['CREATE TABLE "user" (id int4 NOT NULL)'],
        summary: '1 operation(s)',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('20260101_100000_add_user');
    expect(stripped).toContain('kind: regular');
    expect(stripped).toContain(`from: ${EMPTY_CONTRACT_HASH}`);
    expect(stripped).toContain('to:   sha256:hash-a');
    expect(stripped).toContain('migrationId: sha256:edge-abc');
    expect(stripped).toContain('2026-01-01T10:00:00.000Z');
  });

  it('shows operations tree with class labels', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      {
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        migrationId: 'sha256:edge-abc',
        kind: 'regular',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
          {
            id: 'column.post.legacy',
            label: 'Drop column legacy on post',
            operationClass: 'destructive',
          },
        ],
        sql: [],
        summary: '2 operation(s)',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('├');
    expect(stripped).toContain('└');
    expect(stripped).toContain('[additive]');
    expect(stripped).toContain('[destructive]');
  });

  it('shows destructive warning when operations include destructive', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      {
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        migrationId: 'sha256:edge-abc',
        kind: 'regular',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          {
            id: 'column.post.legacy',
            label: 'Drop column legacy on post',
            operationClass: 'destructive',
          },
        ],
        sql: ['ALTER TABLE "post" DROP COLUMN "legacy"'],
        summary: '1 operation(s)',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('⚠');
    expect(stripped).toContain('destructive operations');
    expect(stripped).toContain('data loss');
  });

  it('omits destructive warning when all additive', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      {
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        migrationId: 'sha256:edge-abc',
        kind: 'regular',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
        ],
        sql: ['CREATE TABLE "user" (id int4 NOT NULL)'],
        summary: '1 operation(s)',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).not.toContain('⚠');
    expect(stripped).not.toContain('data loss');
  });

  it('shows DDL preview', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      {
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        migrationId: 'sha256:edge-abc',
        kind: 'regular',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
        ],
        sql: ['CREATE TABLE "user" (id int4 NOT NULL)'],
        summary: '1 operation(s)',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('DDL preview');
    expect(stripped).toContain('CREATE TABLE "user" (id int4 NOT NULL);');
  });

  it('returns empty string in quiet mode', () => {
    const flags = parseGlobalFlags({ quiet: true });
    const output = formatMigrationShowOutput(
      {
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        migrationId: 'sha256:edge-abc',
        kind: 'regular',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [],
        sql: [],
        summary: '0 operation(s)',
      },
      flags,
    );

    expect(output).toBe('');
  });
});
