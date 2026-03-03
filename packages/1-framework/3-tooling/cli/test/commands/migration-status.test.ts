import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import { findLeaf, findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { buildMigrationEntries } from '../../src/commands/migration-status';
import { parseGlobalFlags } from '../../src/utils/global-flags';
import { formatMigrationStatusOutput } from '../../src/utils/output';

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

function createOp(
  id: string,
  label: string,
  operationClass: 'additive' | 'widening' | 'destructive',
): MigrationPlanOperation {
  return { id, label, operationClass };
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-status-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function setupChain(migrationsDir: string) {
  const contractA = createTestContract({
    storage: {
      tables: {
        user: { columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } } },
      },
    },
  });
  const contractB = createTestContract({
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
        },
      },
    },
  });
  const contractC = createTestContract({
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
        },
        post: { columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } } },
      },
    },
  });

  const dir1 = formatMigrationDirName(new Date(2026, 0, 1, 10, 0), 'add_user');
  const path1 = join(migrationsDir, dir1);
  await writeMigrationPackage(
    path1,
    createManifest(EMPTY_CONTRACT_HASH, 'sha256:hash-a', contractA),
    [createOp('table.user', 'Create table "user"', 'additive')],
  );
  const edgeId1 = await attestMigration(path1);

  const dir2 = formatMigrationDirName(new Date(2026, 0, 2, 10, 0), 'add_email');
  const path2 = join(migrationsDir, dir2);
  await writeMigrationPackage(
    path2,
    createManifest('sha256:hash-a', 'sha256:hash-b', contractB, contractA, edgeId1),
    [createOp('column.user.email', 'Add column "email" on "user"', 'additive')],
  );
  const edgeId2 = await attestMigration(path2);

  const dir3 = formatMigrationDirName(new Date(2026, 0, 3, 10, 0), 'add_post');
  const path3 = join(migrationsDir, dir3);
  await writeMigrationPackage(
    path3,
    createManifest('sha256:hash-b', 'sha256:hash-c', contractC, contractB, edgeId2),
    [
      createOp('table.post', 'Create table "post"', 'additive'),
      createOp('column.post.legacy', 'Drop column "legacy" on "post"', 'destructive'),
    ],
  );
  await attestMigration(path3);

  return { dir1, dir2, dir3 };
}

describe('buildMigrationEntries', () => {
  it('builds entries for a linear chain (offline)', async () => {
    const tempDir = await createTempDir('offline');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await setupChain(migrationsDir);

    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages);
    const leaf = findLeaf(graph);
    const chain = findPath(graph, EMPTY_CONTRACT_HASH, leaf)!;

    const entries = buildMigrationEntries(chain, packages, undefined);

    expect(entries).toHaveLength(3);
    expect(entries[0]!.status).toBe('unknown');
    expect(entries[1]!.status).toBe('unknown');
    expect(entries[2]!.status).toBe('unknown');
  });

  it('marks applied/pending based on marker hash', async () => {
    const tempDir = await createTempDir('online');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await setupChain(migrationsDir);

    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages);
    const leaf = findLeaf(graph);
    const chain = findPath(graph, EMPTY_CONTRACT_HASH, leaf)!;

    const entries = buildMigrationEntries(chain, packages, 'sha256:hash-a');

    expect(entries[0]!.status).toBe('applied');
    expect(entries[1]!.status).toBe('pending');
    expect(entries[2]!.status).toBe('pending');
  });

  it('marks all applied when marker matches leaf', async () => {
    const tempDir = await createTempDir('up-to-date');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await setupChain(migrationsDir);

    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages);
    const leaf = findLeaf(graph);
    const chain = findPath(graph, EMPTY_CONTRACT_HASH, leaf)!;

    const entries = buildMigrationEntries(chain, packages, 'sha256:hash-c');

    expect(entries[0]!.status).toBe('applied');
    expect(entries[1]!.status).toBe('applied');
    expect(entries[2]!.status).toBe('applied');
  });

  it('marks all pending when marker is empty', async () => {
    const tempDir = await createTempDir('all-pending');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await setupChain(migrationsDir);

    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages);
    const leaf = findLeaf(graph);
    const chain = findPath(graph, EMPTY_CONTRACT_HASH, leaf)!;

    const entries = buildMigrationEntries(chain, packages, EMPTY_CONTRACT_HASH);

    expect(entries[0]!.status).toBe('pending');
    expect(entries[1]!.status).toBe('pending');
    expect(entries[2]!.status).toBe('pending');
  });

  it('marks all unknown when marker does not match any chain node', async () => {
    const tempDir = await createTempDir('unknown-marker');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await setupChain(migrationsDir);

    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages);
    const leaf = findLeaf(graph);
    const chain = findPath(graph, EMPTY_CONTRACT_HASH, leaf)!;

    const entries = buildMigrationEntries(chain, packages, 'sha256:totally-unknown');

    expect(entries[0]!.status).toBe('unknown');
    expect(entries[1]!.status).toBe('unknown');
    expect(entries[2]!.status).toBe('unknown');
  });

  it('includes operation summary and destructive flag', async () => {
    const tempDir = await createTempDir('ops-summary');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await setupChain(migrationsDir);

    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages);
    const leaf = findLeaf(graph);
    const chain = findPath(graph, EMPTY_CONTRACT_HASH, leaf)!;

    const entries = buildMigrationEntries(chain, packages, undefined);

    expect(entries[0]!.operationSummary).toBe('1 op (all additive)');
    expect(entries[0]!.hasDestructive).toBe(false);

    expect(entries[2]!.operationSummary).toBe('2 ops (1 destructive)');
    expect(entries[2]!.hasDestructive).toBe(true);
  });
});

describe('formatMigrationStatusOutput', () => {
  it('renders offline graph', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'offline',
        migrations: [
          {
            dirName: '20260101_100000_add_user',
            to: 'sha256:hash-a',
            edgeId: 'sha256:e1',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'unknown',
          },
          {
            dirName: '20260102_100000_add_email',
            to: 'sha256:hash-b',
            edgeId: 'sha256:e2',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'unknown',
          },
        ],
        leafHash: 'sha256:hash-b',
        contractHash: 'sha256:hash-b',
        summary: '2 migration(s) on disk',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('∅ (empty)');
    expect(stripped).toContain('20260101_100000_add_user');
    expect(stripped).toContain('20260102_100000_add_email');
    expect(stripped).toContain('→ sha256:hash-a');
    expect(stripped).toContain('2 migration(s) on disk');
    expect(stripped).not.toContain('Applied');
    expect(stripped).not.toContain('Pending');
  });

  it('renders online graph with applied/pending markers', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'online',
        migrations: [
          {
            dirName: '20260101_100000_add_user',
            to: 'sha256:hash-a',
            edgeId: 'sha256:e1',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'applied',
          },
          {
            dirName: '20260102_100000_add_email',
            to: 'sha256:hash-b',
            edgeId: 'sha256:e2',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'pending',
          },
        ],
        markerHash: 'sha256:hash-a',
        leafHash: 'sha256:hash-b',
        contractHash: 'sha256:hash-b',
        summary: "1 pending migration(s) — run 'prisma-next migration apply' to apply",
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Applied');
    expect(stripped).toContain('⧗ Pending');
    expect(stripped).toContain('◄ DB');
    expect(stripped).toContain('◄ Contract');
    expect(stripped).toContain('1 pending migration(s)');
  });

  it('renders online graph up to date', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'online',
        migrations: [
          {
            dirName: '20260101_100000_add_user',
            to: 'sha256:hash-a',
            edgeId: 'sha256:e1',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'applied',
          },
        ],
        markerHash: 'sha256:hash-a',
        leafHash: 'sha256:hash-a',
        contractHash: 'sha256:hash-a',
        summary: 'Database is up to date (1 migration applied)',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Applied');
    expect(stripped).toContain('◄ DB');
    expect(stripped).toContain('◄ Contract');
    expect(stripped).toContain('✔');
    expect(stripped).toContain('up to date');
  });

  it('renders online graph with unrecognized marker', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'online',
        migrations: [
          {
            dirName: '20260101_100000_add_user',
            to: 'sha256:hash-a',
            edgeId: 'sha256:e1',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'unknown',
          },
        ],
        markerHash: 'sha256:totally-different',
        leafHash: 'sha256:hash-a',
        contractHash: 'sha256:hash-a',
        summary:
          "Database marker does not match any migration — was the database managed with 'db update'?",
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('⚠');
    expect(stripped).toContain('db update');
    expect(stripped).not.toContain('Applied');
    expect(stripped).not.toContain('Pending');
  });

  it('renders contract-ahead hint when contract hash differs from leaf', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'offline',
        migrations: [
          {
            dirName: '20260101_100000_add_user',
            to: 'sha256:hash-a',
            edgeId: 'sha256:e1',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'unknown',
          },
        ],
        leafHash: 'sha256:hash-a',
        contractHash: 'sha256:hash-b',
        summary: '1 migration(s) on disk',
        diagnostics: [
          {
            code: 'CONTRACT.AHEAD',
            severity: 'warn',
            message: 'Contract has changed since the last migration was planned',
            hints: [
              "Run 'prisma-next migration plan' to generate a migration for the current contract",
            ],
          },
        ],
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('◄ Contract is ahead — run migration plan');
    expect(stripped).not.toContain('◄ Contract\n');
  });

  it('renders warn diagnostics with hints', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'offline',
        migrations: [
          {
            dirName: '20260101_100000_add_user',
            to: 'sha256:hash-a',
            edgeId: 'sha256:e1',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'unknown',
          },
        ],
        leafHash: 'sha256:hash-a',
        contractHash: 'sha256:hash-a',
        summary: '1 migration(s) on disk',
        diagnostics: [
          {
            code: 'CONTRACT.UNREADABLE',
            severity: 'warn',
            message: 'Could not read contract file — contract state unknown',
            hints: ["Run 'prisma-next contract emit' to generate a contract"],
          },
        ],
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('⚠ Could not read contract file');
    expect(stripped).toContain("Run 'prisma-next contract emit'");
  });

  it('does not render info diagnostics in human output', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'online',
        migrations: [
          {
            dirName: '20260101_100000_add_user',
            to: 'sha256:hash-a',
            edgeId: 'sha256:e1',
            operationSummary: '1 op (all additive)',
            hasDestructive: false,
            status: 'applied',
          },
        ],
        markerHash: 'sha256:hash-a',
        leafHash: 'sha256:hash-a',
        contractHash: 'sha256:hash-a',
        summary: 'Database is up to date (1 migration applied)',
        diagnostics: [
          {
            code: 'MIGRATION.UP_TO_DATE',
            severity: 'info',
            message: 'Database is up to date',
            hints: [],
          },
        ],
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('up to date');
    expect(stripped).not.toContain('MIGRATION.UP_TO_DATE');
  });

  it('highlights destructive operations in yellow', () => {
    const flags = parseGlobalFlags({ color: true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'offline',
        migrations: [
          {
            dirName: '20260101_100000_drop',
            to: 'sha256:hash-a',
            edgeId: 'sha256:e1',
            operationSummary: '1 op (1 destructive)',
            hasDestructive: true,
            status: 'unknown',
          },
        ],
        leafHash: 'sha256:hash-a',
        contractHash: 'sha256:hash-a',
        summary: '1 migration(s) on disk',
      },
      flags,
    );

    // The destructive summary should have yellow ANSI codes when color is enabled
    expect(output).toContain('1 op (1 destructive)');
  });

  it('renders empty state', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'offline',
        migrations: [],
        leafHash: EMPTY_CONTRACT_HASH,
        contractHash: EMPTY_CONTRACT_HASH,
        summary: 'No migrations found',
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('No migrations found');
    expect(stripped).not.toContain('∅');
  });

  it('returns empty string in quiet mode', () => {
    const flags = parseGlobalFlags({ quiet: true });
    const output = formatMigrationStatusOutput(
      {
        mode: 'offline',
        migrations: [],
        leafHash: EMPTY_CONTRACT_HASH,
        contractHash: EMPTY_CONTRACT_HASH,
        summary: 'No migrations found',
      },
      flags,
    );

    expect(output).toBe('');
  });
});
