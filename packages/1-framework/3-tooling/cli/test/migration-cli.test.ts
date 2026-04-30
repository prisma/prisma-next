/**
 * Unit tests for `MigrationCLI.run` (the migration-file CLI entrypoint).
 *
 * Test-doubles approach: `BufferStream` collects output written via
 * `write`/`end`; `argv` is injected explicitly. No `process.argv` /
 * `process.stdout` / `process.stderr` mutation, no `vi.spyOn` on
 * process globals — the public surface accepts an injectable
 * `{ argv, stdout, stderr }` so tests can capture in-process.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
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

/**
 * `node:stream.Writable` subclass that captures every chunk written to
 * it so assertions can use `.toContain(...)` / `.toMatch(...)` on the
 * accumulated text. Subclasses `Writable` (rather than implementing the
 * stream interface ad-hoc) because clipanion's `BaseContext.stdout` and
 * `BaseContext.stderr` are typed as `Writable`, and the migration-file
 * CLI forwards the injected streams into clipanion's context.
 */
class BufferStream extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    callback();
  }

  get text(): string {
    return this.chunks.join('');
  }
}

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

let workDir: string;
let migrationFile: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'migrationcli-test-'));
  migrationFile = join(workDir, 'migration.ts');
  // The serializer needs an actual file at the migration path so that
  // realpathSync resolves both sides identically when the entrypoint
  // guard compares `realpathSync(import.meta.url)` against
  // `realpathSync(argv[1])`.
  writeFileSync(migrationFile, '');
  loadConfigMock.mockReset();
  createControlStackMock.mockReset();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Returns the canonical "looks like an entrypoint invocation" argv
 * shape: `['node', migrationFile, ...extra]`. The entrypoint guard
 * compares `realpathSync(import.meta.url)` to `realpathSync(argv[1])`,
 * so pointing `argv[1]` at the temp file makes the guard fire and the
 * runner executes its body.
 */
function entrypointArgv(...extra: readonly string[]): readonly string[] {
  return ['node', migrationFile, ...extra];
}

const okConfig = {
  family: { familyId: 'sql' },
  target: { targetId: 'postgres' },
  adapter: { kind: 'adapter' },
  extensionPacks: [],
};

describe('MigrationCLI.run', () => {
  it('writes ops.json + migration.json under the migration directory on success', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    const ops = JSON.parse(readFileSync(join(workDir, 'ops.json'), 'utf-8'));
    expect(ops).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(workDir, 'migration.json'), 'utf-8'));
    expect(manifest).toMatchObject({ from: 'sha256:from', to: 'sha256:to' });
  });

  it('prints artifacts to stdout in --dry-run mode without writing files', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--dry-run'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(() => readFileSync(join(workDir, 'ops.json'))).toThrow();
    expect(stdout.text).toContain('--- migration.json ---');
    expect(stdout.text).toContain('--- ops.json ---');
  });

  it('emits PN-MIG-2006 with both target ids when migration target ≠ config target', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(
      pathToFileURL(migrationFile).href,
      WrongTargetMigration,
      { argv: entrypointArgv(), stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('"mongo"');
    expect(stderr.text).toContain('"postgres"');
    expect(stderr.text).toContain('Migration target does not match config target');
  });

  it('exits non-zero with the loader diagnostic when config is missing', async () => {
    loadConfigMock.mockRejectedValue(errorConfigFileNotFound('/path/to/prisma-next.config.ts'));
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toMatch(/config|prisma-next/i);
  });

  it('no-ops silently when the file is being imported (not the entrypoint)', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: ['node', '/some/other/file.js'],
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(() => readFileSync(join(workDir, 'ops.json'))).toThrow();
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe('');
  });

  // A `migration.ts` file may execute other code alongside `MigrationCLI.run`
  // — most realistically, an unhandled rejection or an explicit
  // `process.exitCode = N` somewhere upstream that signals a prior failure.
  // The CLI must not clobber that signal: a successful migration write
  // should not turn a previously-failing process into a successful one.
  it('preserves a pre-existing non-zero process.exitCode on success', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const originalExitCode = process.exitCode;
    process.exitCode = 7;
    try {
      const stdout = new BufferStream();
      const stderr = new BufferStream();
      const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
        argv: entrypointArgv(),
        stdout,
        stderr,
      });
      expect(exitCode).toBe(0);
      expect(process.exitCode).toBe(7);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  // A failure inside `MigrationCLI.run` must still set `process.exitCode`
  // for script-style callers that don't await the return value, even when
  // there's no prior non-zero status.
  it('sets process.exitCode on failure when no prior status was set', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const stdout = new BufferStream();
      const stderr = new BufferStream();
      const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
        argv: entrypointArgv('--frobnicate'),
        stdout,
        stderr,
      });
      expect(exitCode).toBe(2);
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it('renders --help to stdout and exits 0', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--help'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stdout.text).toContain('Usage');
  });

  it('routes --help output to stdout, never to stderr', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--help'),
      stdout,
      stderr,
    });

    // Regression guard for the corrected Style Guide rule 8: explicit
    // `--help` is data, so it must land on stdout. Help text on stderr
    // would break shell pipelines that consume it as data.
    expect(stderr.text).not.toContain('Usage');
  });

  it('forwards --config <path> to loadConfig', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config', '/explicit/config.ts'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).toHaveBeenCalledWith('/explicit/config.ts');
  });

  it('forwards --config=<path> (equals form) to loadConfig', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config=/equals/config.ts'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).toHaveBeenCalledWith('/equals/config.ts');
  });

  it('preserves contract bookends from a previously-scaffolded migration.json', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const existing = {
      from: 'sha256:from',
      to: 'sha256:to',
      migrationHash: null,
      fromContract: { storage: { storageHash: 'sha256:from' }, marker: 'preserved-from' },
      toContract: { storage: { storageHash: 'sha256:to' }, marker: 'preserved-to' },
      hints: { used: [], applied: [], plannerVersion: '2.0.0' },
      labels: ['scaffolded'],
      createdAt: '2026-01-15T10:00:00.000Z',
    };
    writeFileSync(join(workDir, 'migration.json'), JSON.stringify(existing, null, 2));

    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    const manifest = JSON.parse(readFileSync(join(workDir, 'migration.json'), 'utf-8'));
    expect(manifest.fromContract).toEqual(existing.fromContract);
    expect(manifest.toContract).toEqual(existing.toContract);
    expect(manifest.labels).toEqual(existing.labels);
    expect(manifest.createdAt).toBe(existing.createdAt);
    // Even though the on-disk fixture started with `migrationHash: null`,
    // MigrationCLI.run must rewrite it to a real `sha256:...` digest —
    // otherwise readMigrationPackage() would reject the package.
    expect(manifest.migrationHash).toMatch(/^sha256:/);
  });

  it('exits non-zero with MIGRATION.INVALID_JSON when migration.json is unparseable', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const malformed = '{ this is not json';
    writeFileSync(join(workDir, 'migration.json'), malformed);

    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Invalid JSON in migration file');
    expect(stderr.text).toContain(join(workDir, 'migration.json'));

    expect(() => readFileSync(join(workDir, 'ops.json'))).toThrow();

    const onDisk = readFileSync(join(workDir, 'migration.json'), 'utf-8');
    expect(onDisk).toBe(malformed);
  });

  it('rejects --config when followed by another flag with PN-CLI-4012 and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config', '--dry-run'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('PN-CLI-4012');
    expect(stderr.text).toContain('--config');
    expect(stderr.text).toContain('--dry-run');
  });

  it('rejects a bare trailing --config with PN-CLI-4012 and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('PN-CLI-4012');
    expect(stderr.text).toContain('--config');
  });

  // `--config=` (equals form, empty value) is a usage error: the user
  // expressed intent to override the config path but the override is
  // empty. Loader behaviour for an empty path is implementation-defined
  // and worse for the user than a structured PN-CLI-4012.
  it('rejects --config= (equals form, empty value) with PN-CLI-4012 and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config='),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('PN-CLI-4012');
  });

  // `--config ""` (separated form, empty string token) is the same kind
  // of usage error as `--config=`. Shells expand `""` into a real
  // (empty) argv token, so this is what an author hits in practice
  // when scripting `--config "$MAYBE_UNSET_VAR"`.
  it('rejects --config "" (separated form, empty string) with PN-CLI-4012 and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config', ''),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('PN-CLI-4012');
  });

  it('rejects target-mismatched migrations before any stack-driven construction', async () => {
    loadConfigMock.mockResolvedValue(okConfig);
    const adapterCreate = vi.fn(() => ({}));
    createControlStackMock.mockReturnValue({ adapter: { create: adapterCreate } });
    StackHungryWrongTargetMigration.stackUsed = false;

    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(
      pathToFileURL(migrationFile).href,
      StackHungryWrongTargetMigration,
      { argv: entrypointArgv(), stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(StackHungryWrongTargetMigration.stackUsed).toBe(false);
    expect(adapterCreate).not.toHaveBeenCalled();
  });

  it('rejects unknown flags with PN-CLI-4013 and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--frobnicate'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('PN-CLI-4013');
    expect(stderr.text).toContain('--frobnicate');
    // The known-flag list should be rendered for copy-pastability so
    // the user can spot the typo without `--help`.
    expect(stderr.text).toContain('--help');
    expect(stderr.text).toContain('--dry-run');
    expect(stderr.text).toContain('--config');
  });

  it('uses injected argv exclusively, never reading process.argv', async () => {
    // Regression guard for the stream-injection contract: when argv is
    // injected, the runner must not fall back to process.argv. In
    // vitest, process.argv[1] points at vitest's own binary — if the
    // implementation read it, the entrypoint guard
    // (realpathSync(argv[1]) === realpathSync(importMetaUrl)) would
    // not match and the runner would silently no-op, leaving
    // loadConfigMock uncalled. The injected argv points argv[1] at
    // migrationFile, so the guard fires and loadConfig is called.
    loadConfigMock.mockResolvedValue(okConfig);
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).toHaveBeenCalled();
  });
});
