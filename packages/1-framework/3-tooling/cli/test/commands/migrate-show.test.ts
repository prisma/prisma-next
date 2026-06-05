import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import stripAnsi from 'strip-ansi';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, getExitCode, setupCommandMocks } from '../utils/test-helpers';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  createControlClient: vi.fn(),
  readAllMarkers: vi.fn(),
  runMigration: vi.fn(),
  graphWalkStrategy: vi.fn(),
}));

vi.mock('../../src/config-loader', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../../src/control-api/client', () => ({
  createControlClient: mocks.createControlClient,
}));
// Spy on graphWalkStrategy to assert it is the seam used for path computation.
vi.mock('@prisma-next/migration-tools/aggregate', async (importOriginal) => {
  const original = await importOriginal<typeof import('@prisma-next/migration-tools/aggregate')>();
  return {
    ...original,
    graphWalkStrategy: mocks.graphWalkStrategy.mockImplementation(original.graphWalkStrategy),
  };
});
// runMigration is the write boundary — if --show ever calls it, tests must fail.
vi.mock('../../src/control-api/operations/run-migration', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/control-api/operations/run-migration')>();
  return {
    ...original,
    runMigration: mocks.runMigration.mockImplementation(() => {
      throw new Error('runMigration must never be called by migrate --show (read-only violation)');
    }),
  };
});

afterAll(() => {
  vi.doUnmock('../../src/config-loader');
  vi.doUnmock('../../src/control-api/client');
  vi.doUnmock('@prisma-next/migration-tools/aggregate');
  vi.doUnmock('../../src/control-api/operations/run-migration');
  vi.resetModules();
});

const EMPTY = 'sha256:empty';
const C1 = `sha256:${'1'.repeat(64)}`;
const C2 = `sha256:${'2'.repeat(64)}`;
const TARGET = 'mock';
const TARGET_FAMILY = 'mock';

const OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.users', label: 'Create table users', operationClass: 'additive' },
];

function contractEnvelope(storageHash: string): Record<string, unknown> {
  return {
    storage: { storageHash, namespaces: {} },
    schemaVersion: '1.0.0',
    target: TARGET,
    targetFamily: TARGET_FAMILY,
  };
}

async function writePkg(
  dir: string,
  base: Omit<MigrationMetadata, 'migrationHash'>,
): Promise<{ dirName: string; migrationHash: string }> {
  const dirName = `20260101_100000_${base.to.slice(7, 13)}`;
  const pkgDir = join(dir, dirName);
  const migrationHash = computeMigrationHash(base, OPS as MigrationPlanOperation[]);
  const metadata: MigrationMetadata = { ...base, migrationHash };
  await writeMigrationPackage(pkgDir, metadata, OPS as MigrationPlanOperation[]);
  return { dirName, migrationHash };
}

const tempDirs: string[] = [];

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function buildFixture(): Promise<{ cwd: string; appDir: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'cli-migrate-show-'));
  tempDirs.push(cwd);
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(appDir, { recursive: true });
  // Linear chain: EMPTY → C1 → C2
  await writePkg(appDir, {
    from: EMPTY,
    to: C1,
    providedInvariants: [],
    createdAt: '2026-01-01T10:00:00.000Z',
  });
  await writePkg(appDir, {
    from: C1,
    to: C2,
    providedInvariants: [],
    createdAt: '2026-01-01T10:01:00.000Z',
  });
  await writeFile(join(cwd, 'contract.json'), JSON.stringify(contractEnvelope(C2)));
  return { cwd, appDir };
}

function setupConfigMock(): void {
  mocks.loadConfig.mockResolvedValue({
    family: {
      familyId: TARGET_FAMILY,
      create: vi.fn().mockReturnValue({ deserializeContract: (json: unknown) => json }),
    },
    target: {
      id: TARGET,
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      kind: 'target',
      migrations: {},
    },
    adapter: { kind: 'adapter', familyId: TARGET_FAMILY, targetId: TARGET },
    driver: { kind: 'driver', create: vi.fn() },
    contract: { output: 'contract.json' },
    migrations: { dir: 'migrations' },
  });
}

describe('migrate --show (read-only + faithfulness)', () => {
  let consoleOutput: string[];
  let cleanupMocks: () => void;
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const commandMocks = setupCommandMocks();
    consoleOutput = commandMocks.consoleOutput;
    cleanupMocks = commandMocks.cleanup;
    setupConfigMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupMocks();
  });

  it('read-only: never calls runMigration when --show is passed', async () => {
    const { cwd } = await buildFixture();
    process.chdir(cwd);

    const { createMigrateCommand } = await import('../../src/commands/migrate');

    try {
      await executeCommand(createMigrateCommand(), [
        '--show',
        '--from',
        'sha256:empty',
        '--no-color',
      ]);
    } catch {
      // process.exit on success
    }

    // The mock throws if runMigration is called — if we reach here, it was not called.
    expect(mocks.runMigration).not.toHaveBeenCalled();
  });

  it('faithfulness: path is computed via graphWalkStrategy (same seam as migrate)', async () => {
    const { cwd } = await buildFixture();
    process.chdir(cwd);

    const { createMigrateCommand } = await import('../../src/commands/migrate');

    try {
      await executeCommand(createMigrateCommand(), [
        '--show',
        '--from',
        'sha256:empty',
        '--no-color',
      ]);
    } catch {
      // process.exit on success
    }

    expect(mocks.graphWalkStrategy).toHaveBeenCalled();
  });

  it('prints the ordered list of migrations that will run', async () => {
    const { cwd } = await buildFixture();
    process.chdir(cwd);

    const { createMigrateCommand } = await import('../../src/commands/migrate');

    try {
      await executeCommand(createMigrateCommand(), [
        '--show',
        '--from',
        'sha256:empty',
        '--no-color',
      ]);
    } catch {
      // process.exit on success
    }

    expect(getExitCode()).toBe(0);
    const output = stripAnsi(consoleOutput.join('\n'));
    // Should show both migrations in order (EMPTY → C1 → C2)
    expect(output).toContain('20260101_100000_111111');
    expect(output).toContain('20260101_100000_222222');
    expect(output).toContain('Will run, in order:');
  });

  it('shows "nothing to run" when already at target', async () => {
    const { cwd } = await buildFixture();
    process.chdir(cwd);

    const { createMigrateCommand } = await import('../../src/commands/migrate');

    try {
      // From C2 to C2 — already at target
      await executeCommand(createMigrateCommand(), [
        '--show',
        '--from',
        C2.slice(7, 13),
        '--no-color',
      ]);
    } catch {
      // process.exit on success
    }

    expect(getExitCode()).toBe(0);
    const output = stripAnsi(consoleOutput.join('\n'));
    expect(output).toMatch(/nothing to run|already up to date|0 migrations/i);
  });

  it('errors gracefully when no path exists from-state → target', async () => {
    const { cwd } = await buildFixture();
    process.chdir(cwd);

    const { createMigrateCommand } = await import('../../src/commands/migrate');

    // From C2 to C1 — backwards, no path
    try {
      await executeCommand(createMigrateCommand(), [
        '--show',
        '--from',
        C2.slice(7, 13),
        '--to',
        C1.slice(7, 13),
        '--no-color',
      ]);
    } catch {
      // process.exit on failure
    }

    expect(getExitCode()).not.toBe(0);
  });

  it('requires --db when --from is omitted (live marker mode)', async () => {
    const { cwd } = await buildFixture();
    process.chdir(cwd);

    const { createMigrateCommand } = await import('../../src/commands/migrate');

    try {
      // No --from, no --db — should error requiring a DB connection
      await executeCommand(createMigrateCommand(), ['--show', '--no-color']);
    } catch {
      // process.exit on failure
    }

    expect(getExitCode()).not.toBe(0);
  });

  it('@db --from without --db connection returns a structured error', async () => {
    const { cwd } = await buildFixture();
    process.chdir(cwd);

    const { createMigrateCommand } = await import('../../src/commands/migrate');

    try {
      await executeCommand(createMigrateCommand(), ['--show', '--from', '@db', '--json']);
    } catch {
      // process.exit on failure
    }

    expect(getExitCode()).not.toBe(0);
    const jsonLine = consoleOutput.find((l) => l.trimStart().startsWith('{'));
    expect(jsonLine).toBeDefined();
    const envelope = JSON.parse(jsonLine!) as { code?: string; message?: string };
    // Should be a structured error — either connection-required or not-found
    expect(envelope.code).toBeTruthy();
  });

  it('graph visualization: DB one migration behind target (worked example snapshot)', async () => {
    // Fixture: linear chain EMPTY → C1 → C2; from-state = C1 (DB one migration behind).
    // Expected: C2 (@contract) at top, C1 (@db if using live marker - here explicit --from),
    // on-path edge (C1→C2) labelled, C2-migration row visible + annotated.
    // Off-path edges (EMPTY→C1 in this case) are unlabelled (dirName hidden).
    const { cwd } = await buildFixture();
    process.chdir(cwd);

    const { createMigrateCommand } = await import('../../src/commands/migrate');

    try {
      // from=C1 (DB one migration behind) to C2 (the current contract)
      await executeCommand(createMigrateCommand(), [
        '--show',
        '--from',
        C1.slice(7, 13), // hex prefix for C1
        '--no-color',
      ]);
    } catch {
      // process.exit on success
    }

    expect(getExitCode()).toBe(0);
    const output = stripAnsi(consoleOutput.join('\n'));

    // Graph should be present in the output
    // C2 node (target/contract) should appear
    expect(output).toContain(C2.slice(7, 13));
    // C1 node (from-state) should appear
    expect(output).toContain(C1.slice(7, 13));
    // The on-path migration (C1→C2) dirName should appear in the graph
    expect(output).toContain('20260101_100000_222222');
    // The off-path migration (EMPTY→C1) dirName should NOT appear — it's unlabelled
    expect(output).not.toContain('20260101_100000_111111');
    // The ordered list should appear
    expect(output).toContain('Will run, in order:');
    expect(output).toContain('1 migration will run');
  });
});
