/**
 * Unit tests for `MigrationCLI.run` (the migration-file CLI entrypoint).
 * Covers diagnostic surfaces (target mismatch, config not found) and the
 * dry-run / write paths via mocked `loadConfig` +
 * `createControlStack`. The heavier "full migration round-trips to disk"
 * path is exercised by the existing example-migration round-trip tests
 * (target-postgres).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { errorConfigFileNotFound } from '@prisma-next/errors/control';
import { Migration } from '@prisma-next/migration-tools/migration';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadConfigMock = vi.fn();
const createControlStackMock = vi.fn();

vi.mock('../src/config-loader', () => ({
  loadConfig: loadConfigMock,
}));

vi.mock('@prisma-next/framework-components/control', async () => {
  const actual = await vi.importActual<typeof import('@prisma-next/framework-components/control')>(
    '@prisma-next/framework-components/control',
  );
  return { ...actual, createControlStack: createControlStackMock };
});

const { MigrationCLI } = await import('../src/migration-cli');

class FakeMigration extends Migration {
  readonly targetId: string;
  constructor(stack: unknown, targetId = 'postgres') {
    super(stack as never);
    this.targetId = targetId;
  }
  override get operations() {
    return [];
  }
  override describe() {
    return { from: 'sha256:from', to: 'sha256:to' };
  }
}

class WrongTargetMigration extends Migration {
  readonly targetId = 'mongo' as const;
  constructor(stack: unknown) {
    super(stack as never);
  }
  override get operations() {
    return [];
  }
  override describe() {
    return { from: 'sha256:from', to: 'sha256:to' };
  }
}

/**
 * Mirrors `PostgresMigration`'s constructor side effect: when given a
 * stack, eagerly invokes `stack.adapter.create(stack)` to materialize a
 * control adapter. Used to assert that `MigrationCLI.run` never
 * constructs a wrong-target migration with the assembled stack — the
 * static `stackUsed` flag stays `false` when the target-mismatch guard
 * fires before stack construction.
 */
class StackHungryWrongTargetMigration extends Migration {
  readonly targetId = 'mongo' as const;
  static stackUsed = false;
  constructor(stack?: unknown) {
    super(stack as never);
    if (stack !== undefined) {
      StackHungryWrongTargetMigration.stackUsed = true;
      (stack as { adapter: { create: (s: unknown) => unknown } }).adapter.create(stack);
    }
  }
  override get operations() {
    return [];
  }
  override describe() {
    return { from: 'sha256:from', to: 'sha256:to' };
  }
}

let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let originalArgv: typeof process.argv;
let originalExitCode: typeof process.exitCode;
let workDir: string;
let migrationFile: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'migrationcli-test-'));
  migrationFile = join(workDir, 'migration.ts');
  originalArgv = process.argv;
  originalExitCode = process.exitCode;
  // The entrypoint guard compares `realpathSync(import.meta.url)` against
  // `realpathSync(process.argv[1])`; pointing both at the temp file makes
  // the guard fire so the runner actually executes its body.
  process.argv = ['node', migrationFile];
  // The serializer needs an actual file at the migration path so that
  // realpathSync resolves both sides identically.
  writeFileSync(migrationFile, '');
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  loadConfigMock.mockReset();
  createControlStackMock.mockReset();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  stderrSpy.mockRestore();
  stdoutSpy.mockRestore();
});

describe('MigrationCLI.run', () => {
  it('writes ops.json + migration.json under the migration directory on success', async () => {
    loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: { kind: 'adapter' },
      extensionPacks: [],
    });
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(process.exitCode).not.toBe(1);
    const ops = JSON.parse(readFileSync(join(workDir, 'ops.json'), 'utf-8'));
    expect(ops).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(workDir, 'migration.json'), 'utf-8'));
    expect(manifest).toMatchObject({ from: 'sha256:from', to: 'sha256:to' });
  });

  it('prints artifacts to stdout in --dry-run mode without writing files', async () => {
    loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: { kind: 'adapter' },
      extensionPacks: [],
    });
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    process.argv = ['node', migrationFile, '--dry-run'];

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(process.exitCode).not.toBe(1);
    expect(() => readFileSync(join(workDir, 'ops.json'))).toThrow();
    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stdoutCalls).toContain('--- migration.json ---');
    expect(stdoutCalls).toContain('--- ops.json ---');
  });

  it('emits PN-MIG-2006 with both target ids when migration target ≠ config target', async () => {
    loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: { kind: 'adapter' },
      extensionPacks: [],
    });
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    await MigrationCLI.run(pathToFileURL(migrationFile).href, WrongTargetMigration);

    expect(process.exitCode).toBe(1);
    const stderrText = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrText).toContain('"mongo"');
    expect(stderrText).toContain('"postgres"');
    expect(stderrText).toContain('Migration target does not match config target');
  });

  it('exits non-zero with the loader diagnostic when config is missing', async () => {
    loadConfigMock.mockRejectedValue(errorConfigFileNotFound('/path/to/prisma-next.config.ts'));

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(process.exitCode).toBe(1);
    const stderrText = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrText).toMatch(/config|prisma-next/i);
  });

  it('no-ops silently when the file is being imported (not the entrypoint)', async () => {
    process.argv = ['node', '/some/other/file.js'];

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(() => readFileSync(join(workDir, 'ops.json'))).toThrow();
  });

  it('prints help and exits cleanly on --help', async () => {
    process.argv = ['node', migrationFile, '--help'];

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(loadConfigMock).not.toHaveBeenCalled();
    const stdoutText = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stdoutText).toContain('Usage');
  });

  it('forwards --config <path> to loadConfig', async () => {
    loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: { kind: 'adapter' },
      extensionPacks: [],
    });
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    process.argv = ['node', migrationFile, '--config', '/explicit/config.ts'];

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(loadConfigMock).toHaveBeenCalledWith('/explicit/config.ts');
  });

  it('preserves contract bookends from a previously-scaffolded migration.json', async () => {
    loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: { kind: 'adapter' },
      extensionPacks: [],
    });
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const existing = {
      from: 'sha256:from',
      to: 'sha256:to',
      migrationId: null,
      kind: 'regular',
      fromContract: { storage: { storageHash: 'sha256:from' }, marker: 'preserved-from' },
      toContract: { storage: { storageHash: 'sha256:to' }, marker: 'preserved-to' },
      hints: { used: [], applied: [], plannerVersion: '2.0.0' },
      labels: ['scaffolded'],
      createdAt: '2026-01-15T10:00:00.000Z',
    };
    writeFileSync(join(workDir, 'migration.json'), JSON.stringify(existing, null, 2));

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    const manifest = JSON.parse(readFileSync(join(workDir, 'migration.json'), 'utf-8'));
    expect(manifest.fromContract).toEqual(existing.fromContract);
    expect(manifest.toContract).toEqual(existing.toContract);
    expect(manifest.labels).toEqual(existing.labels);
    expect(manifest.createdAt).toBe(existing.createdAt);
  });

  it('falls back to a synthesized manifest when the existing migration.json is unparseable', async () => {
    loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: { kind: 'adapter' },
      extensionPacks: [],
    });
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    writeFileSync(join(workDir, 'migration.json'), '{ this is not json');

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    const manifest = JSON.parse(readFileSync(join(workDir, 'migration.json'), 'utf-8'));
    expect(manifest.from).toBe('sha256:from');
    expect(manifest.to).toBe('sha256:to');
    expect(manifest.fromContract).toBeNull();
    expect(manifest.toContract).toEqual({ storage: { storageHash: 'sha256:to' } });
  });

  it('forwards --config=<path> (equals form) to loadConfig', async () => {
    loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: { kind: 'adapter' },
      extensionPacks: [],
    });
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    process.argv = ['node', migrationFile, '--config=/equals/config.ts'];

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(loadConfigMock).toHaveBeenCalledWith('/equals/config.ts');
  });

  it('rejects --config when followed by another flag instead of a path', async () => {
    process.argv = ['node', migrationFile, '--config', '--dry-run'];

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(process.exitCode).toBe(1);
    expect(loadConfigMock).not.toHaveBeenCalled();
    const stderrText = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrText).toContain('--config');
    expect(stderrText).toContain('--dry-run');
  });

  it('rejects a bare trailing --config with no path argument', async () => {
    process.argv = ['node', migrationFile, '--config'];

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration);

    expect(process.exitCode).toBe(1);
    expect(loadConfigMock).not.toHaveBeenCalled();
    const stderrText = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrText).toContain('--config');
  });

  it('rejects target-mismatched migrations before any stack-driven construction', async () => {
    loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: { kind: 'adapter' },
      extensionPacks: [],
    });
    const adapterCreate = vi.fn(() => ({}));
    createControlStackMock.mockReturnValue({ adapter: { create: adapterCreate } });
    StackHungryWrongTargetMigration.stackUsed = false;

    await MigrationCLI.run(pathToFileURL(migrationFile).href, StackHungryWrongTargetMigration);

    expect(process.exitCode).toBe(1);
    expect(StackHungryWrongTargetMigration.stackUsed).toBe(false);
    expect(adapterCreate).not.toHaveBeenCalled();
  });
});
