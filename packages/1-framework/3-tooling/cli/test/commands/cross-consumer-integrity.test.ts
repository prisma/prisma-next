import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, getExitCode, setupCommandMocks } from '../utils/test-helpers';

/**
 * Cross-consumer integrity matrix.
 *
 * A single on-disk project is planted with three independent faults — a
 * `from === to` self-edge (no data op), a hash-mismatched package, and an
 * orphan contract-space directory no extension declares — and every
 * contract-space consumer is driven against it. The assertions pin the
 * per-command-class behaviour the tolerant model promises (project spec §
 * behaviour matrix):
 *
 *   - **Read / render** (`migration show`, `migration status` render path):
 *     tolerate-and-render — the self-edge is shown, the command does not
 *     crash, exit 0.
 *   - **`migration check`** (report-all): renders the FULL violation set in
 *     one invocation — hash-mismatch (`PN-MIG-CHECK-001`), self-edge
 *     (`-007`), and orphan-dir (`-008`) all surface together.
 *   - **`migration status` pin**: refuses with the `PN-MIG-5002` integrity
 *     envelope on the package-corruption kinds (hash mismatch), while
 *     tolerating the self-edge and other non-corruption drift silently.
 *   - **apply** (`migrate`): refuses with the contract-space integrity
 *     envelope. Precedence is exercised with two fixtures — the all-three
 *     fixture refuses `PN-MIG-5001` (orphan / layout drift wins), and an
 *     integrity-only fixture (hash-mismatch, no orphan, extensions declared
 *     correctly) refuses `PN-MIG-5002` with `meta.violations[]`.
 *
 * `migrate`'s gate is a pure offline check that fires before
 * `client.connect()`, so the stub driver is never reached — the refusal is
 * the gate's, not a connection error's. `db verify` shares the identical
 * `mapIntegrityViolations` gate but runs it post-connect (it needs a live
 * marker first), so its `5001`/`5002` surface is pinned by the loader unit
 * test (`contract-space-aggregate-loader.ac15`) and the real-DB
 * `cli.db-verify.aggregate-schema` suite rather than re-driven offline here.
 *
 * `loadConfig` is mocked (a real `prisma-next.config.ts` would pull in
 * TypeScript transpilation + a target adapter); everything downstream runs
 * against the real on-disk fixture.
 */

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfig,
}));

const TARGET = 'mock';
const TARGET_FAMILY = 'mock';
const SCHEMA_VERSION = '1.0.0';
const CREATED_AT = '2026-02-25T14:30:00.000Z';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

const ADDITIVE_OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.users', label: 'Create table users', operationClass: 'additive' },
];

const TAMPERED_OPS: readonly MigrationPlanOperation[] = [
  ...ADDITIVE_OPS,
  { id: 'tamper.synthetic', label: 'Synthetic tamper op', operationClass: 'additive' },
];

function setupConfigMock(): void {
  // Pass-through `deserializeContract` keeps the contract read crossing the
  // family seam (TML-2536's invariant) while letting the skeletal contract
  // (`storage.storageHash` only) drive the post-read integrity gate.
  mocks.loadConfig.mockResolvedValue({
    family: {
      familyId: TARGET_FAMILY,
      create: vi.fn().mockReturnValue({
        deserializeContract: (json: unknown) => json,
      }),
    },
    target: {
      id: TARGET,
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      kind: 'target',
      migrations: {},
    },
    adapter: { kind: 'adapter', familyId: TARGET_FAMILY, targetId: TARGET },
    driver: { kind: 'driver' },
    db: { connection: 'postgres://localhost/cross-consumer-test' },
    contract: { output: 'src/prisma/contract.json' },
  });
}

interface PackageSpec {
  readonly dirName: string;
  readonly from: string | null;
  readonly to: string;
  readonly ops: readonly MigrationPlanOperation[];
  /** When set, `ops.json` is overwritten after attestation to force a hash mismatch. */
  readonly tamperedOps?: readonly MigrationPlanOperation[];
}

async function writePackage(spaceDir: string, spec: PackageSpec): Promise<void> {
  const metadataBase: Omit<MigrationMetadata, 'migrationHash'> = {
    from: spec.from,
    to: spec.to,
    hints: { used: [], applied: ['additive_only'], plannerVersion: '0.0.1' },
    labels: [],
    providedInvariants: [],
    createdAt: CREATED_AT,
  };
  const metadata: MigrationMetadata = {
    ...metadataBase,
    migrationHash: computeMigrationHash(metadataBase, spec.ops),
  };
  const packageDir = join(spaceDir, spec.dirName);
  await writeMigrationPackage(packageDir, metadata, spec.ops);
  if (spec.tamperedOps !== undefined) {
    await writeFile(join(packageDir, 'ops.json'), JSON.stringify(spec.tamperedOps, null, 2));
  }
}

async function writeContract(cwd: string, storageHash: string): Promise<void> {
  const contractDir = join(cwd, 'src', 'prisma');
  await mkdir(contractDir, { recursive: true });
  await writeFile(
    join(contractDir, 'contract.json'),
    JSON.stringify({
      storage: { storageHash },
      schemaVersion: SCHEMA_VERSION,
      target: TARGET,
      targetFamily: TARGET_FAMILY,
    }),
  );
}

/**
 * Write a self-consistent extension space dir that is an orphan only
 * because no extension declares it: a clean package (`null -> hash`), a
 * head ref pointing at that hash, and a valid contract. This isolates the
 * `orphanSpaceDir` signal from the incidental `headRefMissing` /
 * `contractUnreadable` an empty dir would also raise.
 */
async function writeCleanOrphanSpace(cwd: string, spaceId: string, hash: string): Promise<void> {
  const spaceDir = join(cwd, 'migrations', spaceId);
  await writePackage(spaceDir, {
    dirName: '00001_orphan_base',
    from: null,
    to: hash,
    ops: ADDITIVE_OPS,
  });
  await mkdir(join(spaceDir, 'refs'), { recursive: true });
  await writeFile(
    join(spaceDir, 'refs', 'head.json'),
    `${JSON.stringify({ hash, invariants: [] }, null, 2)}\n`,
  );
  await writeFile(
    join(spaceDir, 'contract.json'),
    JSON.stringify({
      storage: { storageHash: hash },
      schemaVersion: SCHEMA_VERSION,
      target: TARGET,
      targetFamily: TARGET_FAMILY,
    }),
  );
}

interface Fixture {
  readonly cwd: string;
  readonly selfEdgeRelDir: string;
}

/**
 * All-three fixture: a self-edge (`A -> A`, no data op), a hash-mismatched
 * package (`A -> B`, ops tampered post-attestation), and a clean orphan
 * space dir (`orphan_ext`). App head is `B`.
 */
async function setupAllThreeFixture(): Promise<Fixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'cross-consumer-all3-'));
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(appDir, { recursive: true });

  await writePackage(appDir, { dirName: '00001_base', from: null, to: HASH_A, ops: ADDITIVE_OPS });
  await writePackage(appDir, { dirName: '00002_selfedge', from: HASH_A, to: HASH_A, ops: [] });
  await writePackage(appDir, {
    dirName: '00003_tamper',
    from: HASH_A,
    to: HASH_B,
    ops: ADDITIVE_OPS,
    tamperedOps: TAMPERED_OPS,
  });

  await writeCleanOrphanSpace(cwd, 'orphan_ext', HASH_C);
  await writeContract(cwd, HASH_B);

  return { cwd, selfEdgeRelDir: join('migrations', 'app', '00002_selfedge') };
}

/**
 * Self-edge-only fixture: a base package plus a `A -> A` self-edge, no
 * tamper and no orphan. App head is `A`. Read / render commands must
 * tolerate this and render.
 */
async function setupSelfEdgeFixture(): Promise<Fixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'cross-consumer-selfedge-'));
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(appDir, { recursive: true });

  await writePackage(appDir, { dirName: '00001_base', from: null, to: HASH_A, ops: ADDITIVE_OPS });
  await writePackage(appDir, { dirName: '00002_selfedge', from: HASH_A, to: HASH_A, ops: [] });

  await writeContract(cwd, HASH_A);

  return { cwd, selfEdgeRelDir: join('migrations', 'app', '00002_selfedge') };
}

/**
 * Integrity-only fixture: a hash-mismatched package, no orphan, no
 * self-edge, no declared extensions. App head is `B`. apply must refuse
 * `PN-MIG-5002` (no layout drift to take precedence).
 */
async function setupIntegrityOnlyFixture(): Promise<Fixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'cross-consumer-integrity-'));
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(appDir, { recursive: true });

  await writePackage(appDir, { dirName: '00001_base', from: null, to: HASH_A, ops: ADDITIVE_OPS });
  await writePackage(appDir, {
    dirName: '00002_tamper',
    from: HASH_A,
    to: HASH_B,
    ops: ADDITIVE_OPS,
    tamperedOps: TAMPERED_OPS,
  });

  await writeContract(cwd, HASH_B);

  return { cwd, selfEdgeRelDir: join('migrations', 'app', '00001_base') };
}

interface CliErrorEnvelope {
  readonly summary: string;
  readonly code: string;
  readonly meta?: { readonly violations?: ReadonlyArray<Record<string, unknown>> };
}

interface CheckEnvelope {
  readonly ok: boolean;
  readonly failures?: ReadonlyArray<{ readonly pnCode: string }>;
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

function firstJsonLine<T>(consoleOutput: readonly string[]): T {
  const line = consoleOutput.find((l) => l.trimStart().startsWith('{'));
  if (!line) {
    throw new Error(`Expected a JSON object on stdout; got:\n${consoleOutput.join('\n')}`);
  }
  return JSON.parse(line) as T;
}

describe('cross-consumer contract-space integrity matrix', () => {
  let consoleOutput: string[];
  let cleanupMocks: () => void;
  const originalCwd = process.cwd();
  let tempDirs: string[];

  beforeEach(() => {
    vi.resetModules();
    const commandMocks = setupCommandMocks();
    consoleOutput = commandMocks.consoleOutput;
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
    // Repo-wide vitest runs with `isolate: false`, so the `vi.mock` leaks
    // into the next file in the same worker; unmock to restore it.
    vi.doUnmock('../../src/config-loader');
    vi.resetModules();
  });

  it(
    'migration check reports all three violations at once (hash-mismatch + self-edge + orphan-dir)',
    async () => {
      const { createMigrationCheckCommand } = await import('../../src/commands/migration-check');
      const fixture = await setupAllThreeFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      await runAndCaptureExit(() => executeCommand(createMigrationCheckCommand(), ['--json']));
      const envelope = firstJsonLine<CheckEnvelope>(consoleOutput);

      expect(envelope.ok).toBe(false);
      const codes = (envelope.failures ?? []).map((f) => f.pnCode);
      expect(codes).toContain('PN-MIG-CHECK-001'); // hash mismatch
      expect(codes).toContain('PN-MIG-CHECK-007'); // self-edge (sameSourceAndTarget)
      expect(codes).toContain('PN-MIG-CHECK-008'); // orphan space dir
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migrate refuses the all-three fixture with PN-MIG-5001 (orphan/layout precedence)',
    async () => {
      const { createMigrateCommand } = await import('../../src/commands/migrate');
      const fixture = await setupAllThreeFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrateCommand(), ['--json']),
      );
      const envelope = firstJsonLine<CliErrorEnvelope>(consoleOutput);

      expect(exitCode).not.toBe(0);
      expect(envelope.code).toBe('PN-MIG-5001');
      const violations = envelope.meta?.violations ?? [];
      expect(violations.some((v) => v['kind'] === 'orphanSpaceDir')).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migrate refuses the integrity-only fixture with PN-MIG-5002 + meta.violations',
    async () => {
      const { createMigrateCommand } = await import('../../src/commands/migrate');
      const fixture = await setupIntegrityOnlyFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrateCommand(), ['--json']),
      );
      const envelope = firstJsonLine<CliErrorEnvelope>(consoleOutput);

      expect(exitCode).not.toBe(0);
      expect(envelope.code).toBe('PN-MIG-5002');
      const violations = envelope.meta?.violations ?? [];
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v['kind'] === 'integrity' && v['spaceId'] === 'app')).toBe(
        true,
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migration status pin refuses PN-MIG-5002 on package corruption (hash mismatch)',
    async () => {
      const { createMigrationStatusCommand } = await import('../../src/commands/migration-status');
      const fixture = await setupAllThreeFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrationStatusCommand(), ['--json']),
      );
      const envelope = firstJsonLine<CliErrorEnvelope>(consoleOutput);

      expect(exitCode).not.toBe(0);
      expect(envelope.code).toBe('PN-MIG-5002');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migration status render path tolerates a self-edge and renders (exit 0, no refusal)',
    async () => {
      const { createMigrationStatusCommand } = await import('../../src/commands/migration-status');
      const fixture = await setupSelfEdgeFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrationStatusCommand(), ['--json']),
      );
      const envelope = firstJsonLine<{ ok?: boolean; code?: string }>(consoleOutput);

      expect(exitCode).toBe(0);
      expect(envelope.ok).toBe(true);
      expect(envelope.code).toBeUndefined();
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migration show renders a self-edge package and tolerates it (exit 0)',
    async () => {
      const { createMigrationShowCommand } = await import('../../src/commands/migration-show');
      const fixture = await setupSelfEdgeFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const exitCode = await runAndCaptureExit(() =>
        executeCommand(createMigrationShowCommand(), [fixture.selfEdgeRelDir, '--json']),
      );
      const envelope = firstJsonLine<Record<string, unknown>>(consoleOutput);

      expect(exitCode).toBe(0);
      // The rendered package carries the self-edge: from === to === HASH_A.
      expect(JSON.stringify(envelope)).toContain(HASH_A);
    },
    timeouts.typeScriptCompilation,
  );
});
