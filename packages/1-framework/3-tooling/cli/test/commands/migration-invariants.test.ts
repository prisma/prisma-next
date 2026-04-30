import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createContract } from '@prisma-next/contract/testing';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { writeRef } from '@prisma-next/migration-tools/refs';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, getExitCode, setupCommandMocks } from '../utils/test-helpers';

/**
 * Integration coverage for the UNKNOWN_INVARIANT pre-check in
 * `migration apply --ref` and `migration status --ref` — the only
 * invariant-routing diagnostic reachable without a real DB connection.
 * Marker-subtraction and NO_INVARIANT_PATH live in the journey suite.
 */

const mocks = vi.hoisted(() => {
  const readMarkerMock = vi.fn();
  const connectMock = vi.fn().mockResolvedValue(undefined);
  const closeMock = vi.fn().mockResolvedValue(undefined);
  return {
    loadConfig: vi.fn(),
    readMarkerMock,
    connectMock,
    closeMock,
    createControlClientMock: vi.fn(() => ({
      connect: connectMock,
      readMarker: readMarkerMock,
      close: closeMock,
    })),
  };
});

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../../src/control-api/client', () => ({
  createControlClient: mocks.createControlClientMock,
}));

const FROM_HASH = 'sha256:empty';
const TO_HASH = `sha256:${'a'.repeat(64)}`;
const SCHEMA_VERSION = '1.0.0';
const TARGET = 'mock';
const TARGET_FAMILY = 'mock';
const CREATED_AT = '2026-02-25T14:30:00.000Z';

const ORIGINAL_OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.users', label: 'Create table users', operationClass: 'additive' },
];

function dataOp(invariantId: string): MigrationPlanOperation {
  return {
    id: `data.${invariantId}`,
    label: `data ${invariantId}`,
    operationClass: 'data',
    invariantId,
  } as unknown as MigrationPlanOperation;
}

interface InvariantFixture {
  readonly cwd: string;
}

async function writeAttestedPackage(
  packageDir: string,
  metadataBase: Omit<MigrationMetadata, 'migrationHash'>,
  ops: readonly MigrationPlanOperation[],
): Promise<void> {
  const metadata: MigrationMetadata = {
    ...metadataBase,
    migrationHash: computeMigrationHash(metadataBase, ops),
  };
  await writeMigrationPackage(packageDir, metadata, ops);
}

function setupConfigMock(): void {
  mocks.loadConfig.mockResolvedValue({
    family: { familyId: TARGET_FAMILY, create: vi.fn().mockReturnValue({}) },
    target: {
      id: TARGET,
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      kind: 'target',
      migrations: {},
    },
    adapter: { kind: 'adapter', familyId: TARGET_FAMILY, targetId: TARGET },
    driver: { kind: 'driver' },
    db: { connection: 'postgres://localhost/invariant-test' },
  });
}

async function setupFixture(opts: {
  refInvariants: readonly string[];
  edgeInvariants?: readonly string[];
  selfEdgeInvariant?: string;
}): Promise<InvariantFixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'cli-invariant-'));

  const migrationsDir = join(cwd, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  const packageDir = join(migrationsDir, '00001_create_users');
  const edgeInvariants = [...(opts.edgeInvariants ?? [])].sort();
  const ops: readonly MigrationPlanOperation[] = [...ORIGINAL_OPS, ...edgeInvariants.map(dataOp)];
  await writeAttestedPackage(
    packageDir,
    {
      from: FROM_HASH,
      to: TO_HASH,
      kind: 'regular',
      fromContract: null,
      toContract: createContract(),
      hints: { used: [], applied: ['additive_only'], plannerVersion: '0.0.1' },
      labels: [],
      providedInvariants: edgeInvariants,
      createdAt: CREATED_AT,
    },
    ops,
  );

  if (opts.selfEdgeInvariant) {
    const selfEdgeDir = join(migrationsDir, '00002_self_edge');
    await writeAttestedPackage(
      selfEdgeDir,
      {
        from: TO_HASH,
        to: TO_HASH,
        kind: 'regular',
        fromContract: createContract(),
        toContract: createContract(),
        hints: { used: [], applied: ['additive_only'], plannerVersion: '0.0.1' },
        labels: [],
        providedInvariants: [opts.selfEdgeInvariant],
        createdAt: CREATED_AT,
      },
      [dataOp(opts.selfEdgeInvariant)],
    );
  }

  // Ref pointing at the only attested migration's destination, declaring the
  // ref-side invariants.
  const refsDir = join(migrationsDir, 'refs');
  await writeRef(refsDir, 'prod', { hash: TO_HASH, invariants: opts.refInvariants });

  // contract.json — apply reads the contract envelope when no --ref is given.
  const contractDir = join(cwd, 'src', 'prisma');
  await mkdir(contractDir, { recursive: true });
  await writeFile(
    join(contractDir, 'contract.json'),
    JSON.stringify({
      storage: { storageHash: TO_HASH },
      schemaVersion: SCHEMA_VERSION,
      target: TARGET,
      targetFamily: TARGET_FAMILY,
    }),
  );

  return { cwd };
}

async function runAndCaptureExit(invoke: () => Promise<number>): Promise<number> {
  try {
    return await invoke();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'process.exit called') {
      throw error;
    }
    return getExitCode() ?? 0;
  }
}

describe(
  'migration apply / status — invariant-routing pre-checks',
  { timeout: timeouts.typeScriptCompilation },
  () => {
    let consoleOutput: string[];
    let consoleErrors: string[];
    let cleanupMocks: () => void;
    const originalCwd = process.cwd();
    let tempDirs: string[];

    beforeEach(() => {
      vi.resetModules();
      const commandMocks = setupCommandMocks();
      consoleOutput = commandMocks.consoleOutput;
      consoleErrors = commandMocks.consoleErrors;
      cleanupMocks = commandMocks.cleanup;
      tempDirs = [];
      setupConfigMock();
    });

    afterEach(async () => {
      process.chdir(originalCwd);
      cleanupMocks();
      for (const dir of tempDirs) {
        await rm(dir, { recursive: true, force: true });
      }
      vi.clearAllMocks();
    });

    afterAll(() => {
      vi.doUnmock('../../src/config-loader');
      vi.doUnmock('../../src/control-api/client');
      vi.resetModules();
    });

    it('migration apply --ref fails with UNKNOWN_INVARIANT when ref names an undeclared invariant', async () => {
      const { createMigrationApplyCommand } = await import('../../src/commands/migration-apply');
      const fixture = await setupFixture({
        refInvariants: ['typo-id'],
        edgeInvariants: ['real-id'],
      });
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrationApplyCommand(), ['--ref', 'prod', '--json']),
      );

      expect(exitCode).not.toBe(0);
      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const envelope = JSON.parse(jsonLine!) as {
        meta?: { code?: string; unknown?: string[]; declared?: string[] };
      };
      expect(envelope.meta?.code).toBe('MIGRATION.UNKNOWN_INVARIANT');
      expect(envelope.meta?.unknown).toEqual(['typo-id']);
      expect(envelope.meta?.declared).toEqual(['real-id']);
    });

    it('migration status --ref fails with UNKNOWN_INVARIANT (parity with apply, not a warning)', async () => {
      const { createMigrationStatusCommand } = await import('../../src/commands/migration-status');
      const fixture = await setupFixture({
        refInvariants: ['typo-id'],
        edgeInvariants: ['real-id'],
      });
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrationStatusCommand(), ['--ref', 'prod', '--json']),
      );

      expect(exitCode).not.toBe(0);
      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const envelope = JSON.parse(jsonLine!) as { meta?: { code?: string } };
      expect(envelope.meta?.code).toBe('MIGRATION.UNKNOWN_INVARIANT');
    });

    it('migration status --ref reports INVARIANTS_PENDING when marker matches target but is missing required invariants', async () => {
      const { createMigrationStatusCommand } = await import('../../src/commands/migration-status');
      const fixture = await setupFixture({
        refInvariants: ['real-id'],
        edgeInvariants: [],
        selfEdgeInvariant: 'real-id',
      });
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      mocks.readMarkerMock.mockResolvedValueOnce({
        storageHash: TO_HASH,
        profileHash: TO_HASH,
        contractJson: null,
        canonicalVersion: null,
        updatedAt: new Date(CREATED_AT),
        appTag: null,
        meta: {},
        invariants: [],
      });

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrationStatusCommand(), ['--ref', 'prod', '--json']),
      );

      expect(exitCode).toBe(0);
      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const envelope = JSON.parse(jsonLine!) as {
        ok: boolean;
        mode: string;
        summary: string;
        diagnostics: Array<{ code: string; severity: string; message: string }>;
        requiredInvariants: readonly string[];
        appliedInvariants?: readonly string[];
        missingInvariants?: readonly string[];
      };
      expect(envelope.ok).toBe(true);
      expect(envelope.mode).toBe('online');
      expect(envelope.requiredInvariants).toEqual(['real-id']);
      expect(envelope.appliedInvariants).toEqual([]);
      expect(envelope.missingInvariants).toEqual(['real-id']);
      expect(envelope.summary).toMatch(/missing invariant\(s\): real-id/i);
      // No spurious UP_TO_DATE — pending invariant work means not up to date.
      expect(envelope.diagnostics.map((d) => d.code)).not.toContain('MIGRATION.UP_TO_DATE');
      expect(envelope.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'MIGRATION.INVARIANTS_PENDING',
            severity: 'info',
            message: 'Missing required invariant(s): real-id',
          }),
        ]),
      );
    });

    it('migration apply --ref does not fire UNKNOWN_INVARIANT when the ref invariant list is empty', async () => {
      // A ref with no invariants must not trip the pre-check. The command
      // continues to its next failure mode (driver no-op connect in this
      // mock setup); we just assert the error code is NOT UNKNOWN_INVARIANT.
      const { createMigrationApplyCommand } = await import('../../src/commands/migration-apply');
      const fixture = await setupFixture({
        refInvariants: [],
        edgeInvariants: ['real-id'],
      });
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrationApplyCommand(), ['--ref', 'prod', '--json']),
      );

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      // Either the command succeeded (exit 0, no JSON envelope), or it failed
      // for a *later* reason (driver/runner) — but never with UNKNOWN_INVARIANT.
      if (jsonLine !== undefined && exitCode !== 0) {
        const envelope = JSON.parse(jsonLine) as { meta?: { code?: string } };
        expect(envelope.meta?.code).not.toBe('MIGRATION.UNKNOWN_INVARIANT');
      }
      expect(consoleErrors.join('\n')).not.toContain('MIGRATION.UNKNOWN_INVARIANT');
    });
  },
);
