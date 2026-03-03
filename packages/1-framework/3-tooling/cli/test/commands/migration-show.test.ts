import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest, MigrationPackage } from '@prisma-next/migration-tools/types';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { resolveByHashPrefix } from '../../src/commands/migration-show';
import { parseGlobalFlags } from '../../src/utils/global-flags';
import { formatMigrationShowOutput } from '../../src/utils/output';

function createTestContract(overrides?: Partial<ContractIR>): ContractIR {
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
    ...overrides,
  };
}

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

function createManifest(
  from: string,
  to: string,
  toContract: ContractIR,
  fromContract: ContractIR | null = null,
  parentEdgeId: string | null = null,
): MigrationManifest {
  return {
    from,
    to,
    edgeId: null,
    parentEdgeId,
    kind: 'regular',
    fromContract,
    toContract,
    hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'diff' },
    labels: [],
    createdAt: new Date().toISOString(),
  };
}

async function setupMigrationDir(
  migrationsDir: string,
  name: string,
  manifest: MigrationManifest,
  ops: MigrationPlanOperation[],
  dateOffset = 0,
): Promise<string> {
  const date = new Date(2026, 0, 1 + dateOffset, 10, 0);
  const dirName = formatMigrationDirName(date, name);
  const packageDir = join(migrationsDir, dirName);
  await writeMigrationPackage(packageDir, manifest, ops);
  await attestMigration(packageDir);
  return packageDir;
}

describe('resolveByHashPrefix', () => {
  it('resolves exact edgeId match', async () => {
    const tempDir = await createTempDir('exact');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contract = createTestContract({
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
    const edgeId = pkg.manifest.edgeId!;

    const result = resolveByHashPrefix(packages, edgeId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.edgeId).toBe(edgeId);
    }
  });

  it('resolves unique prefix', async () => {
    const tempDir = await createTempDir('prefix');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contract = createTestContract({
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
    const edgeId = packages[0]!.manifest.edgeId!;
    const prefix = edgeId.slice(0, 12);

    const result = resolveByHashPrefix(packages, prefix);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.edgeId).toBe(edgeId);
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
          edgeId: 'sha256:abc123',
          parentEdgeId: null,
          kind: 'regular',
          fromContract: null,
          toContract: createTestContract(),
          hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'diff' },
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
    const contract = createTestContract();
    const packages: MigrationPackage[] = [
      {
        dirName: '20260101_100000_first',
        dirPath: '/tmp/first',
        manifest: {
          from: EMPTY_CONTRACT_HASH,
          to: 'sha256:hash-a',
          edgeId: 'sha256:abc111',
          parentEdgeId: null,
          kind: 'regular',
          fromContract: null,
          toContract: contract,
          hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'diff' },
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
          edgeId: 'sha256:abc222',
          parentEdgeId: 'sha256:abc111',
          kind: 'regular',
          fromContract: contract,
          toContract: contract,
          hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'diff' },
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

  it('skips draft migrations (edgeId: null)', () => {
    const packages: MigrationPackage[] = [
      {
        dirName: '20260101_100000_draft',
        dirPath: '/tmp/draft',
        manifest: {
          from: EMPTY_CONTRACT_HASH,
          to: 'sha256:hash-a',
          edgeId: null,
          parentEdgeId: null,
          kind: 'regular',
          fromContract: null,
          toContract: createTestContract(),
          hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'diff' },
          labels: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'sha256:');
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
        edgeId: 'sha256:edge-abc',
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
    expect(stripped).toContain('edgeId: sha256:edge-abc');
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
        edgeId: 'sha256:edge-abc',
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
        edgeId: 'sha256:edge-abc',
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
        edgeId: 'sha256:edge-abc',
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
        edgeId: 'sha256:edge-abc',
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

  it('shows draft indicator when edgeId is null', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      {
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        edgeId: null,
        kind: 'regular',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [],
        sql: [],
        summary: '0 operation(s)',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('draft');
    expect(stripped).toContain('not yet attested');
  });

  it('returns empty string in quiet mode', () => {
    const flags = parseGlobalFlags({ quiet: true });
    const output = formatMigrationShowOutput(
      {
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        edgeId: null,
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
