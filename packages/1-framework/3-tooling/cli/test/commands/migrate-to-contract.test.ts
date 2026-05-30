import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { join } from 'pathe';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeCommand,
  getExitCode,
  parseJsonObjectFromCliCapture,
  setupCommandMocks,
} from '../utils/test-helpers';

/**
 * `migrate --to <node>` verifies/applies against the TARGET bundle's
 * destination contract (its sibling `end-contract.json`), not the emitted
 * `contract.json`. This is what lets a rollback / arbitrary-target migrate
 * succeed without first re-emitting the target contract. With `--to` omitted,
 * the emitted contract stays the apply contract.
 *
 * The control client is mocked so the assertion is purely about *which*
 * contract `migrate` hands to `migrationApply` — path resolution and the real
 * apply are covered by the PGlite journey suite.
 */

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  createControlClient: vi.fn(),
  migrationApply: vi.fn(),
  readAllMarkers: vi.fn(),
}));

vi.mock('../../src/config-loader', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../../src/control-api/client', () => ({
  createControlClient: mocks.createControlClient,
}));

const EMPTY = 'sha256:empty';
const C1 = `sha256:${'1'.repeat(64)}`;
const C2 = `sha256:${'2'.repeat(64)}`;
const SCHEMA_VERSION = '1.0.0';
const TARGET = 'mock';
const TARGET_FAMILY = 'mock';

const OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.users', label: 'Create table users', operationClass: 'additive' },
];

function contractEnvelope(storageHash: string): Record<string, unknown> {
  return {
    storage: { storageHash },
    schemaVersion: SCHEMA_VERSION,
    target: TARGET,
    targetFamily: TARGET_FAMILY,
  };
}

async function writeBundle(
  dir: string,
  base: Omit<MigrationMetadata, 'migrationHash'>,
  endContractHash: string,
): Promise<void> {
  const metadata: MigrationMetadata = { ...base, migrationHash: computeMigrationHash(base, OPS) };
  await writeMigrationPackage(dir, metadata, OPS);
  await writeFile(
    join(dir, 'end-contract.json'),
    JSON.stringify(contractEnvelope(endContractHash)),
  );
}

/**
 * Linear two-migration applied state (EMPTY → C1 → C2). The emitted contract
 * is C2 (the current state); the DB marker sits at C2.
 */
async function setupAppliedState(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'cli-migrate-to-'));
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(join(appDir, 'refs'), { recursive: true });

  await writeBundle(
    join(appDir, '00001_init'),
    { from: EMPTY, to: C1, providedInvariants: [], createdAt: '2026-02-25T14:00:00.000Z' },
    C1,
  );
  await writeBundle(
    join(appDir, '00002_add_phone'),
    { from: C1, to: C2, providedInvariants: [], createdAt: '2026-02-25T14:01:00.000Z' },
    C2,
  );

  await writeFile(join(cwd, 'contract.json'), JSON.stringify(contractEnvelope(C2)));
  return cwd;
}

function setupConfigMock(): void {
  const familyInstance = { deserializeContract: (json: unknown) => json };
  mocks.loadConfig.mockResolvedValue({
    family: { familyId: TARGET_FAMILY, create: vi.fn().mockReturnValue(familyInstance) },
    target: {
      id: TARGET,
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      kind: 'target',
      migrations: {},
    },
    adapter: { kind: 'adapter', familyId: TARGET_FAMILY, targetId: TARGET },
    driver: { kind: 'driver', create: vi.fn() },
    db: { connection: 'postgres://localhost/migrate-to-test' },
    contract: { output: 'contract.json' },
  });
}

function capturedApplyContractHash(): string {
  const firstCall = mocks.migrationApply.mock.calls[0];
  expect(firstCall, 'migrationApply was invoked').toBeDefined();
  const arg = firstCall![0] as { contract: { storage: { storageHash: string } } };
  return arg.contract.storage.storageHash;
}

async function runAndCaptureExit(invoke: () => Promise<number>): Promise<number> {
  try {
    return await invoke();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'process.exit called') throw error;
    return getExitCode() ?? 0;
  }
}

describe('migrate --to verifies against the target bundle contract', () => {
  let cleanupMocks: () => void;
  let consoleOutput: string[];
  const originalCwd = process.cwd();
  let tempDirs: string[];

  beforeEach(() => {
    vi.resetModules();
    const commandMocks = setupCommandMocks();
    consoleOutput = commandMocks.consoleOutput;
    cleanupMocks = commandMocks.cleanup;
    tempDirs = [];

    setupConfigMock();
    mocks.readAllMarkers.mockResolvedValue(new Map([['app', { storageHash: C2, invariants: [] }]]));
    mocks.migrationApply.mockResolvedValue({
      ok: true,
      value: {
        migrationsApplied: 1,
        markerHash: C1,
        applied: [],
        summary: 'applied',
        perSpace: [],
      },
    });
    mocks.createControlClient.mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      readAllMarkers: mocks.readAllMarkers,
      migrationApply: mocks.migrationApply,
      close: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    cleanupMocks();
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.doUnmock('../../src/config-loader');
    vi.doUnmock('../../src/control-api/client');
    vi.resetModules();
  });

  it('applies the target bundle end-contract when --to names an older graph node', async () => {
    const { createMigrateCommand } = await import('../../src/commands/migrate');
    const cwd = await setupAppliedState();
    tempDirs.push(cwd);
    process.chdir(cwd);

    const exitCode = await runAndCaptureExit(() =>
      executeCommand(createMigrateCommand(), ['--to', C1, '--json']),
    );

    expect(exitCode).toBe(0);
    // Not the emitted contract (C2) — the resolved target's contract (C1).
    expect(capturedApplyContractHash()).toBe(C1);
  });

  it('applies the emitted contract when --to is omitted', async () => {
    const { createMigrateCommand } = await import('../../src/commands/migrate');
    const cwd = await setupAppliedState();
    tempDirs.push(cwd);
    process.chdir(cwd);

    const exitCode = await runAndCaptureExit(() =>
      executeCommand(createMigrateCommand(), ['--json']),
    );

    expect(exitCode).toBe(0);
    expect(capturedApplyContractHash()).toBe(C2);
  });

  it('reports contract validation failure naming corrupt target end-contract.json', async () => {
    const { createMigrateCommand } = await import('../../src/commands/migrate');
    const cwd = await setupAppliedState();
    tempDirs.push(cwd);
    const endContractRel = join('migrations', 'app', '00001_init', 'end-contract.json');
    await writeFile(join(cwd, endContractRel), '{ not json');
    process.chdir(cwd);

    const exitCode = await runAndCaptureExit(() =>
      executeCommand(createMigrateCommand(), ['--to', C1, '--json']),
    );

    expect(exitCode).not.toBe(0);
    const envelope = parseJsonObjectFromCliCapture(consoleOutput) as {
      code?: string;
      summary?: string;
      why?: string;
      where?: { path?: string };
    };
    expect(envelope.code).toBe('PN-CLI-4003');
    expect(envelope.summary).toContain('Contract validation failed');
    expect(envelope.where?.path).toContain(endContractRel);
    expect(envelope.why).toContain(endContractRel);
    expect(mocks.migrationApply).not.toHaveBeenCalled();
  });
});
