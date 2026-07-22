import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { formatMigrationDirName, writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { ContractIR } from '@prisma-next/migration-tools/refs';
import { writeRef } from '@prisma-next/migration-tools/refs';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  writeRefPaired: vi.fn(),
}));

vi.mock('@prisma-next/config-loader', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('@prisma-next/migration-tools/refs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma-next/migration-tools/refs')>();
  return {
    ...actual,
    writeRefPaired: mocks.writeRefPaired,
  };
});

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const HASH_C = `${'c'.repeat(64)}`;
const HASH_FLOAT = `${'f'.repeat(64)}`;
const PROFILE_HASH = `${'p'.repeat(64)}`;

function createTableOp(table: string): MigrationPlanOperation {
  return {
    id: `table.${table}`,
    label: `Create table "${table}"`,
    operationClass: 'additive',
  };
}

function contractIRForHash(storageHash: string): ContractIR {
  return {
    contract: {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: PROFILE_HASH,
      storage: { storageHash },
      models: {
        User: {
          fields: {
            id: {
              nullable: false,
              type: { kind: 'scalar', codecId: 'sql/int4@1' },
            },
          },
          relations: {},
          storage: { namespaceId: '__unbound__', table: 'users', namespace: 'public' },
        },
      },
      roots: {},
    },
    contractDts: 'export type Contract = unknown;\n',
  };
}

async function writeEndContract(packageDir: string, storageHash: string): Promise<void> {
  const ir = contractIRForHash(storageHash);
  await writeFile(
    join(packageDir, 'end-contract.json'),
    `${JSON.stringify(ir.contract, null, 2)}\n`,
    'utf-8',
  );
  await writeFile(join(packageDir, 'end-contract.d.ts'), ir.contractDts, 'utf-8');
}

async function writeAttestedMigration(
  appMigrationsDir: string,
  opts: {
    from: string | null;
    to: string;
    ops: MigrationPlanOperation[];
    timestamp: Date;
    slug: string;
    withEndContract?: boolean;
  },
): Promise<{ dirName: string; packageDir: string }> {
  const dirName = formatMigrationDirName(opts.timestamp, opts.slug);
  const packageDir = join(appMigrationsDir, dirName);
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
    from: opts.from,
    to: opts.to,
    providedInvariants: [],
    createdAt: opts.timestamp.toISOString(),
  };
  const migrationHash = computeMigrationHash(baseMetadata, opts.ops);
  const metadata: MigrationMetadata = { ...baseMetadata, migrationHash };
  await writeMigrationPackage(packageDir, metadata, opts.ops);
  if (opts.withEndContract !== false) {
    await writeEndContract(packageDir, opts.to);
  }
  return { dirName, packageDir };
}

function refPointerPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

function snapshotJsonPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.json`);
}

function snapshotDtsPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.d.ts`);
}

describe('ref commands snapshot integration', { timeout: timeouts.databaseOperation }, () => {
  let tempDir: string;
  let configPath: string;
  let appMigrationsDir: string;
  let refsDir: string;

  beforeEach(async () => {
    mocks.loadConfig.mockReset();
    mocks.writeRefPaired.mockReset();
    const { writeRefPaired: realWriteRefPaired } = await vi.importActual<
      typeof import('@prisma-next/migration-tools/refs')
    >('@prisma-next/migration-tools/refs');
    mocks.writeRefPaired.mockImplementation(realWriteRefPaired);

    tempDir = join(tmpdir(), `ref-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    appMigrationsDir = join(tempDir, 'migrations', 'app');
    refsDir = join(appMigrationsDir, 'refs');
    await mkdir(refsDir, { recursive: true });
    configPath = join(tempDir, 'prisma-next.config.ts');
    await writeFile(
      join(tempDir, 'contract.json'),
      JSON.stringify({
        storage: { storageHash: HASH_A },
        schemaVersion: '1.0.0',
        target: 'postgres',
        targetFamily: 'sql',
      }),
    );
    mocks.loadConfig.mockResolvedValue({
      family: {
        familyId: 'sql',
        create: vi.fn().mockReturnValue({
          deserializeContract: (json: unknown) => json,
        }),
      },
      target: {
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        kind: 'target',
        migrations: {},
      },
      contract: { output: join(tempDir, 'contract.json') },
      migrations: { dir: 'migrations' },
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function seedLinearGraph(): Promise<{
    hashA: string;
    hashB: string;
    hashC: string;
    firstDirName: string;
    secondDirName: string;
  }> {
    const first = await writeAttestedMigration(appMigrationsDir, {
      from: null,
      to: HASH_A,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });
    const second = await writeAttestedMigration(appMigrationsDir, {
      from: HASH_A,
      to: HASH_B,
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });
    await writeAttestedMigration(appMigrationsDir, {
      from: HASH_B,
      to: HASH_C,
      ops: [createTableOp('comment')],
      timestamp: new Date(2026, 0, 3, 10, 0),
      slug: 'add_comment',
    });
    return {
      hashA: HASH_A,
      hashB: HASH_B,
      hashC: HASH_C,
      firstDirName: first.dirName,
      secondDirName: second.dirName,
    };
  }

  it('sets a ref to a graph-node hash with paired snapshot files', async () => {
    const { hashB } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', hashB, { config: configPath });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.hash).toBe(hashB);
      expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(true);
      expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(true);
      expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });

  it('refuses a hash that is not a graph node', async () => {
    await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', HASH_FLOAT, { config: configPath });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const envelope = result.failure.toEnvelope();
      expect(envelope.meta?.['code']).toBe('MIGRATION.HASH_NOT_IN_GRAPH');
      expect(envelope.meta?.['resolvedHash']).toBe(HASH_FLOAT);
      expect(envelope.meta?.['reachableHashes']).toEqual(
        expect.arrayContaining([HASH_A, HASH_B, HASH_C]),
      );
    } finally {
      process.chdir(prev);
    }
  });

  it('refuses when the migration graph is empty', async () => {
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', HASH_A, { config: configPath });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const envelope = result.failure.toEnvelope();
      expect(envelope.meta?.['code']).toBe('MIGRATION.HASH_NOT_IN_GRAPH');
      expect(envelope.why).toContain('empty');
      expect(envelope.fix).toContain('migration plan');
    } finally {
      process.chdir(prev);
    }
  });

  it('refuses the empty-database sentinel hash', async () => {
    await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', EMPTY_CONTRACT_HASH, {
        config: configPath,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const envelope = result.failure.toEnvelope();
      expect(envelope.meta?.['code']).toBe('MIGRATION.REF_SET_EMPTY_SENTINEL');
    } finally {
      process.chdir(prev);
    }
  });

  it('resolves another ref name and writes the paired snapshot', async () => {
    const { hashC } = await seedLinearGraph();
    await writeRef(refsDir, 'production', { hash: hashC, invariants: [] });
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', 'production', { config: configPath });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.hash).toBe(hashC);
      expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });

  it('resolves a migration bundle directory to its destination hash', async () => {
    const { hashA, firstDirName } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', firstDirName, { config: configPath });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.hash).toBe(hashA);
    } finally {
      process.chdir(prev);
    }
  });

  it('resolves a migration bundle directory with ^ to its source hash', async () => {
    const { hashA, secondDirName } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', `${secondDirName}^`, {
        config: configPath,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.hash).toBe(hashA);
    } finally {
      process.chdir(prev);
    }
  });

  it('refuses an invalid ref name', async () => {
    await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('../evil', HASH_A, { config: configPath });
      expect(result.ok).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });

  it('overwrites an existing ref atomically via writeRefPaired', async () => {
    const { hashA, hashB } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const first = await executeRefSetCommand('staging', hashA, { config: configPath });
      expect(first.ok).toBe(true);
      const second = await executeRefSetCommand('staging', hashB, { config: configPath });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const pointer = JSON.parse(await readFile(refPointerPath(refsDir, 'staging'), 'utf-8'));
      expect(pointer.hash).toBe(hashB);
      expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });

  it('refuses when the matching bundle end-contract.json is missing', async () => {
    await writeAttestedMigration(appMigrationsDir, {
      from: null,
      to: HASH_A,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
      withEndContract: false,
    });
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', HASH_A, { config: configPath });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.toEnvelope().summary).toContain('File not found');
    } finally {
      process.chdir(prev);
    }
  });

  it('cleans up when writeRefPaired fails mid-write', async () => {
    const { hashA } = await seedLinearGraph();
    mocks.writeRefPaired.mockRejectedValueOnce(new Error('simulated writeRefPaired failure'));
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand } = await import('../../src/commands/ref');
      const result = await executeRefSetCommand('staging', hashA, { config: configPath });
      expect(result.ok).toBe(false);
      expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
      expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });

  it('deletes pointer and paired snapshot files', async () => {
    const { hashA } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand, executeRefDeleteCommand } = await import(
        '../../src/commands/ref'
      );
      await executeRefSetCommand('staging', hashA, { config: configPath });
      const result = await executeRefDeleteCommand('staging', { config: configPath });
      expect(result.ok).toBe(true);
      expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
      expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
      expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });

  it('deletes the db ref without special casing', async () => {
    const { hashA } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand, executeRefDeleteCommand } = await import(
        '../../src/commands/ref'
      );
      await executeRefSetCommand('db', hashA, { config: configPath });
      const result = await executeRefDeleteCommand('db', { config: configPath });
      expect(result.ok).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });

  it('heals an orphan snapshot when the pointer is missing', async () => {
    const { hashA } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand, executeRefDeleteCommand } = await import(
        '../../src/commands/ref'
      );
      await executeRefSetCommand('staging', hashA, { config: configPath });
      await unlink(refPointerPath(refsDir, 'staging'));
      const result = await executeRefDeleteCommand('staging', { config: configPath });
      expect(result.ok).toBe(true);
      expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });

  it('deletes the pointer when the snapshot is missing', async () => {
    const { hashA } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand, executeRefDeleteCommand } = await import(
        '../../src/commands/ref'
      );
      await executeRefSetCommand('staging', hashA, { config: configPath });
      await unlink(snapshotJsonPath(refsDir, 'staging'));
      await unlink(snapshotDtsPath(refsDir, 'staging'));
      const result = await executeRefDeleteCommand('staging', { config: configPath });
      expect(result.ok).toBe(true);
      expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });

  it('refuses delete when neither pointer nor snapshot exists', async () => {
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefDeleteCommand } = await import('../../src/commands/ref');
      const result = await executeRefDeleteCommand('missing', { config: configPath });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.toEnvelope().meta?.['code']).toBe('MIGRATION.UNKNOWN_REF');
    } finally {
      process.chdir(prev);
    }
  });

  it('refuses delete for an invalid ref name', async () => {
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefDeleteCommand } = await import('../../src/commands/ref');
      const result = await executeRefDeleteCommand('bad/name', { config: configPath });
      expect(result.ok).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });

  it('lists only pointer refs when paired snapshot files exist', async () => {
    const { hashA, hashB } = await seedLinearGraph();
    const prev = process.cwd();
    process.chdir(tempDir);
    try {
      const { executeRefSetCommand, executeRefListCommand } = await import(
        '../../src/commands/ref'
      );
      await executeRefSetCommand('db', hashA, { config: configPath });
      await executeRefSetCommand('staging', hashB, { config: configPath });
      const result = await executeRefListCommand({ config: configPath });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Object.keys(result.value.refs).sort()).toEqual(['db', 'staging']);
    } finally {
      process.chdir(prev);
    }
  });
});
