import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createContract } from '@prisma-next/contract/testing';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, getExitCode, setupCommandMocks } from '../utils/test-helpers';

/**
 * End-to-end coverage for the `MIGRATION.HASH_MISMATCH` diagnostic. Each
 * tamper case lays down a valid migration package, surgically corrupts
 * `ops.json` after attestation, drives a real CLI command, and captures
 * the rendered diagnostic. T3.5 then asserts that all four commands
 * produce byte-equal user-visible diagnostics, pinning the spec's
 * "same human-readable diagnostic regardless of which command triggered
 * the load" acceptance criterion.
 *
 * `loadConfig` is mocked because resolving a real `prisma-next.config.ts`
 * would pull in TypeScript transpilation and a target adapter. Everything
 * downstream of `loadConfig` runs against real on-disk fixtures: the
 * tampered package and the contract.json. The `loadAllMigrationPackages` /
 * `readMigrationPackage` paths inside each command are exercised
 * unmocked, so the loader-boundary integrity check inside
 * `readMigrationPackage` is what actually fires the diagnostic.
 */

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfig,
}));

const PACKAGE_DIR_NAME = '00001_tamper_test';
const FROM_HASH = 'sha256:from';
const TO_HASH = 'sha256:to';
const SCHEMA_VERSION = '1.0.0';
const TARGET = 'mock';
const TARGET_FAMILY = 'mock';
const CREATED_AT = '2026-02-25T14:30:00.000Z';

const ORIGINAL_OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.users', label: 'Create table users', operationClass: 'additive' },
];

const TAMPERED_OPS: readonly MigrationPlanOperation[] = [
  ...ORIGINAL_OPS,
  { id: 'tamper.synthetic', label: 'Synthetic tamper op', operationClass: 'additive' },
];

interface CapturedDiagnostic {
  readonly exitCode: number;
  readonly envelope: CliErrorEnvelope;
  readonly humanText: string;
}

interface CliErrorEnvelope {
  readonly summary: string;
  readonly code: string;
  readonly why?: string;
  readonly fix?: string;
  readonly meta?: Record<string, unknown>;
  readonly where?: { readonly path?: string };
}

async function writeTestPackage(
  dir: string,
  metadataBase: Omit<MigrationMetadata, 'migrationHash'>,
  ops: readonly MigrationPlanOperation[],
): Promise<MigrationMetadata> {
  const metadata: MigrationMetadata = {
    ...metadataBase,
    migrationHash: computeMigrationHash(metadataBase, ops),
  };
  await writeMigrationPackage(dir, metadata, ops);
  return metadata;
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
    db: { connection: 'postgres://localhost/tamper-test' },
  });
}

interface TamperFixture {
  readonly cwd: string;
  readonly packageDir: string;
  readonly relativePackageDir: string;
}

async function setupTamperFixture(): Promise<TamperFixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'cli-tamper-'));

  const migrationsDir = join(cwd, 'migrations');
  await mkdir(migrationsDir, { recursive: true });
  const packageDir = join(migrationsDir, PACKAGE_DIR_NAME);

  await writeTestPackage(
    packageDir,
    {
      from: FROM_HASH,
      to: TO_HASH,
      kind: 'regular',
      fromContract: null,
      toContract: createContract(),
      hints: { used: [], applied: ['additive_only'], plannerVersion: '0.0.1' },
      labels: [],
      createdAt: CREATED_AT,
    },
    ORIGINAL_OPS,
  );

  // Tamper: append a synthetic op to ops.json after attestation. The metadata's
  // stored migrationHash now disagrees with the recomputed hash over the new op
  // list, which is exactly the failure mode `readMigrationPackage` flags via
  // `errorMigrationHashMismatch`.
  await writeFile(join(packageDir, 'ops.json'), JSON.stringify(TAMPERED_OPS, null, 2));

  // contract.json at the default location so commands that read the contract
  // (apply, plan, status) reach `loadAllMigrationPackages` without erroring earlier.
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

  return { cwd, packageDir, relativePackageDir: join('migrations', PACKAGE_DIR_NAME) };
}

/**
 * Replaces a fixture's per-test absolute path with a stable token so the
 * captured envelopes from different tempdirs are byte-comparable.
 *
 * The human-rendered `why`/`fix` paths are cwd-relative, so in practice
 * the rendered text is already identical across tests (each test chdirs
 * into its own tempdir before invoking the command, and uses the same
 * package dir name). This normalization is a defensive belt: it scrubs
 * the absolute `details.dir` in the JSON envelope and any future leakage
 * of an absolute path into the rendered surface.
 */
function normalizePaths(text: string, tempDir: string): string {
  return text.split(tempDir).join('<TMP_DIR>');
}

async function runAndCaptureExit(invoke: () => Promise<number>): Promise<number> {
  // `executeCommand` re-throws the synthetic "process.exit called" error
  // when the command exits non-zero (so callers can branch on it). We
  // pull the exit code out of the helper's mock immediately after the
  // throw so a subsequent invocation in the same test doesn't overwrite it.
  try {
    return await invoke();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'process.exit called') {
      throw error;
    }
    return getExitCode() ?? 0;
  }
}

async function captureDiagnostic(
  invokeJson: () => Promise<number>,
  invokeHuman: () => Promise<number>,
  consoleOutput: string[],
  consoleErrors: string[],
  tempDir: string,
): Promise<CapturedDiagnostic> {
  // --- JSON pass: structured envelope (used for the presence assertion).
  consoleOutput.length = 0;
  consoleErrors.length = 0;
  const exitCode = await runAndCaptureExit(invokeJson);
  const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
  if (!jsonLine) {
    throw new Error(
      `Expected a JSON envelope on stdout; got:\nstdout:\n${consoleOutput.join('\n')}\nstderr:\n${consoleErrors.join('\n')}`,
    );
  }
  const envelope = JSON.parse(jsonLine) as CliErrorEnvelope;

  // --- Human pass: rendered diagnostic (used for the uniformity assertion in T3.5).
  consoleOutput.length = 0;
  consoleErrors.length = 0;
  await runAndCaptureExit(invokeHuman);
  const humanText = normalizePaths(stripAnsi(consoleErrors.join('\n')), tempDir);

  return { exitCode, envelope, humanText };
}

const diagnostics: CapturedDiagnostic[] = [];

describe('migration tamper diagnostic uniformity (T3.1-T3.5, T3.8)', () => {
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
    // The repo-wide vitest config uses `isolate: false`, so the `vi.mock`
    // above leaks into the next test file in the same worker. Unmocking
    // restores `loadConfig` for downstream tests.
    vi.doUnmock('../../src/config-loader');
    vi.resetModules();
  });

  it(
    'migration apply surfaces MIGRATION.HASH_MISMATCH before connecting (T3.1)',
    async () => {
      const { createMigrationApplyCommand } = await import('../../src/commands/migration-apply');
      const fixture = await setupTamperFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const captured = await captureDiagnostic(
        () => executeCommand(createMigrationApplyCommand(), ['--json']),
        () => executeCommand(createMigrationApplyCommand(), ['--no-color', '--quiet']),
        consoleOutput,
        consoleErrors,
        fixture.cwd,
      );

      expect(captured.exitCode).not.toBe(0);
      expect(captured.envelope.meta?.['code']).toBe('MIGRATION.HASH_MISMATCH');
      expect(captured.humanText).toContain('Migration package is corrupt');

      diagnostics.push(captured);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migration plan surfaces MIGRATION.HASH_MISMATCH before planning work (T3.2)',
    async () => {
      const { createMigrationPlanCommand } = await import('../../src/commands/migration-plan');
      const fixture = await setupTamperFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const captured = await captureDiagnostic(
        () => executeCommand(createMigrationPlanCommand(), ['--json']),
        () => executeCommand(createMigrationPlanCommand(), ['--no-color', '--quiet']),
        consoleOutput,
        consoleErrors,
        fixture.cwd,
      );

      expect(captured.exitCode).not.toBe(0);
      expect(captured.envelope.meta?.['code']).toBe('MIGRATION.HASH_MISMATCH');
      expect(captured.humanText).toContain('Migration package is corrupt');

      diagnostics.push(captured);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migration status surfaces MIGRATION.HASH_MISMATCH (T3.3)',
    async () => {
      const { createMigrationStatusCommand } = await import('../../src/commands/migration-status');
      const fixture = await setupTamperFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const captured = await captureDiagnostic(
        () => executeCommand(createMigrationStatusCommand(), ['--json']),
        () => executeCommand(createMigrationStatusCommand(), ['--no-color', '--quiet']),
        consoleOutput,
        consoleErrors,
        fixture.cwd,
      );

      expect(captured.exitCode).not.toBe(0);
      expect(captured.envelope.meta?.['code']).toBe('MIGRATION.HASH_MISMATCH');
      expect(captured.humanText).toContain('Migration package is corrupt');

      diagnostics.push(captured);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migration show surfaces MIGRATION.HASH_MISMATCH via readMigrationPackage (T3.4)',
    async () => {
      // `migration show` calls `readMigrationPackage` directly when given an
      // explicit path argument, exercising the integrity check on the
      // single-package code path (distinct from `loadAllMigrationPackages` used
      // by apply/plan/status). Both paths funnel through the same loader, so
      // the diagnostic is uniform — that's exactly what T3.5 verifies.
      const { createMigrationShowCommand } = await import('../../src/commands/migration-show');
      const fixture = await setupTamperFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      // Pass a cwd-relative path so the rendered "where" matches the form
      // used by readMigrationsDir-driven commands (apply/plan/status). Both
      // paths reach the same `errorMigrationHashMismatch(dir, ...)` site;
      // the only observable difference would be how the `dir` argument was
      // resolved.
      const captured = await captureDiagnostic(
        () => executeCommand(createMigrationShowCommand(), [fixture.relativePackageDir, '--json']),
        () =>
          executeCommand(createMigrationShowCommand(), [
            fixture.relativePackageDir,
            '--no-color',
            '--quiet',
          ]),
        consoleOutput,
        consoleErrors,
        fixture.cwd,
      );

      expect(captured.exitCode).not.toBe(0);
      expect(captured.envelope.meta?.['code']).toBe('MIGRATION.HASH_MISMATCH');
      expect(captured.humanText).toContain('Migration package is corrupt');

      diagnostics.push(captured);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'migration new surfaces MIGRATION.HASH_MISMATCH for the existing on-disk migration (T3.8)',
    async () => {
      // `migration new` calls `readMigrationsDir` to compute the `from`
      // reference for the new migration. When an existing on-disk
      // package is tampered, the integrity check fires before any
      // scaffolding work — the user asks to *create* a new migration
      // and the diagnostic surfaces the **existing** corrupt package
      // verbatim, with no off-topic "couldn't generate new migration"
      // framing. T3.5's set-equality assertion automatically extends
      // to this fifth capture, pinning the unified-UX guarantee.
      const { createMigrationNewCommand } = await import('../../src/commands/migration-new');
      const fixture = await setupTamperFixture();
      tempDirs.push(fixture.cwd);
      process.chdir(fixture.cwd);

      const captured = await captureDiagnostic(
        () => executeCommand(createMigrationNewCommand(), ['--name', 'next', '--json']),
        () =>
          executeCommand(createMigrationNewCommand(), ['--name', 'next', '--no-color', '--quiet']),
        consoleOutput,
        consoleErrors,
        fixture.cwd,
      );

      expect(captured.exitCode).not.toBe(0);
      expect(captured.envelope.meta?.['code']).toBe('MIGRATION.HASH_MISMATCH');
      expect(captured.humanText).toContain('Migration package is corrupt');

      diagnostics.push(captured);
    },
    timeouts.typeScriptCompilation,
  );

  it('renders the same human diagnostic regardless of which command triggered the load (T3.5)', () => {
    expect(diagnostics).toHaveLength(5);

    const userVisible = diagnostics.map((d) => ({
      summary: d.envelope.summary,
      code: d.envelope.code,
      why: d.envelope.why,
      fix: d.envelope.fix,
      where: d.envelope.where?.path ?? null,
    }));

    // The user-visible portion of the envelope is what `formatErrorOutput`
    // renders at default verbosity (summary, code, why, fix, where). All
    // four commands map `MigrationToolsError` through `errorRuntime`, so a
    // divergence here would surface as a divergence in the human-rendered
    // diagnostic the user sees.
    // If this fails, vitest will print the array of distinct envelopes —
    // pass a JSON-formatted message so the divergence is human-readable.
    const canonical = userVisible.map((u) => JSON.stringify(u));
    expect(new Set(canonical).size, JSON.stringify(userVisible, null, 2)).toBe(1);

    // The rendered stderr text (clack-wrapped, ANSI-stripped, tempdir-normalized)
    // must also be uniform — this is the property the spec asserts directly.
    const renderedTexts = diagnostics.map((d) => d.humanText);
    expect(new Set(renderedTexts).size).toBe(1);

    // Machine-readable envelope shape: every command must carry the full
    // `details` payload from `errorMigrationHashMismatch` in `meta`. This
    // pins the F12 fix — `migration status` / `migration new` previously
    // dropped `dir` / `storedHash` / `computedHash`, surfacing only `code`.
    // After the shared `mapMigrationToolsError` helper landed, the envelope
    // shape is identical across all five commands.
    const metaKeys = diagnostics.map((d) =>
      Object.keys(d.envelope.meta ?? {})
        .sort()
        .join(','),
    );
    expect(new Set(metaKeys).size, JSON.stringify(metaKeys, null, 2)).toBe(1);
    for (const d of diagnostics) {
      expect(d.envelope.meta?.['code']).toBe('MIGRATION.HASH_MISMATCH');
      expect(typeof d.envelope.meta?.['dir']).toBe('string');
      expect(typeof d.envelope.meta?.['storedHash']).toBe('string');
      expect(typeof d.envelope.meta?.['computedHash']).toBe('string');
    }
  });
});
