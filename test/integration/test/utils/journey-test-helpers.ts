/**
 * Journey test helpers for CLI e2e scenario tests.
 *
 * Each journey is a single `it()` block that runs multiple CLI commands sequentially
 * against a shared database. These helpers encapsulate the command execution pattern
 * so journey tests stay concise and readable.
 */

import { execFile } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { promisify } from 'node:util';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { createContractInferCommand } from '@prisma-next/cli/commands/contract-infer';
import { createDbInitCommand } from '@prisma-next/cli/commands/db-init';
import { createDbSchemaCommand } from '@prisma-next/cli/commands/db-schema';
import { createDbSignCommand } from '@prisma-next/cli/commands/db-sign';
import { createDbUpdateCommand } from '@prisma-next/cli/commands/db-update';
import { createDbVerifyCommand } from '@prisma-next/cli/commands/db-verify';
import { createMigrationApplyCommand } from '@prisma-next/cli/commands/migration-apply';
import { createMigrationNewCommand } from '@prisma-next/cli/commands/migration-new';
import { createMigrationPlanCommand } from '@prisma-next/cli/commands/migration-plan';
import { createMigrationRefCommand } from '@prisma-next/cli/commands/migration-ref';
import { createMigrationShowCommand } from '@prisma-next/cli/commands/migration-show';
import { createMigrationStatusCommand } from '@prisma-next/cli/commands/migration-status';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import type { Command } from 'commander';
import { isAbsolute, join, resolve } from 'pathe';
import { afterAll, beforeAll } from 'vitest';

const execFileAsync = promisify(execFile);
const TSX_BIN = resolve(import.meta.dirname, '../../../../node_modules/.bin/tsx');

import { executeCommand, getExitCode, setupCommandMocks } from './cli-test-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a single CLI command execution within a journey step. */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Options for setting up a journey test directory. */
export interface JourneySetupOptions {
  /** Database connection string (from createDevDatabase). */
  connectionString?: string;
  /** Function to create a temp directory (from withTempDir). */
  createTempDir: () => string;
  /** Which contract source mode the config should use. */
  contractMode?: 'ts' | 'psl';
}

/** Context object returned by setupJourney and used by all run* helpers. */
export interface JourneyContext {
  testDir: string;
  configPath: string;
  outputDir: string;
}

// Re-export timeouts so journey tests can import from a single module.
export { timeouts };

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

/**
 * Registers `beforeAll` / `afterAll` hooks that create and tear down a dev database.
 * Returns a getter for the connection string (available after `beforeAll` runs).
 *
 * Optionally accepts an `onReady` callback that runs inside `beforeAll` with the
 * connection string — useful for seeding the database with tables / data.
 *
 * @example
 * ```ts
 * const db = useDevDatabase();
 * it('works', async () => {
 *   const ctx = setupJourney({ connectionString: db.connectionString, createTempDir });
 * });
 * ```
 *
 * @example
 * ```ts
 * const db = useDevDatabase({ onReady: (cs) => withClient(cs, c => c.query(SQL)) });
 * ```
 */
export function useDevDatabase(options?: {
  onReady?: (connectionString: string) => Promise<unknown>;
}): { readonly connectionString: string } {
  let connectionString = '';
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const db = await createDevDatabase();
    connectionString = db.connectionString;
    close = db.close;
    await options?.onReady?.(connectionString);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await close();
  });

  return {
    get connectionString() {
      return connectionString;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const JOURNEY_FIXTURES_DIR = join(
  __dirname,
  '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys',
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Sets up a journey test directory with the base contract and config.
 * The config's `{{DB_URL}}` placeholder is replaced with the connection string.
 */
export function setupJourney(options: JourneySetupOptions): JourneyContext {
  const { connectionString, createTempDir, contractMode = 'ts' } = options;

  const testDir = createTempDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });

  if (contractMode === 'psl') {
    copyFileSync(
      join(JOURNEY_FIXTURES_DIR, 'contract-base.prisma'),
      join(testDir, 'contract.prisma'),
    );
  } else {
    copyFileSync(join(JOURNEY_FIXTURES_DIR, 'contract-base.ts'), join(testDir, 'contract.ts'));
  }

  // Copy and process config
  const configFileName = connectionString
    ? contractMode === 'psl'
      ? 'prisma-next.config.with-db.psl.ts'
      : 'prisma-next.config.with-db.ts'
    : 'prisma-next.config.ts';
  let configContent = readFileSync(join(JOURNEY_FIXTURES_DIR, configFileName), 'utf-8');
  if (connectionString) {
    configContent = configContent.replace(/\{\{DB_URL\}\}/g, () => connectionString);
  }
  const configPath = join(testDir, 'prisma-next.config.ts');
  writeFileSync(configPath, configContent, 'utf-8');

  return { testDir, configPath, outputDir };
}

// ---------------------------------------------------------------------------
// Contract fixtures
// ---------------------------------------------------------------------------

/**
 * All available contract fixture files, keyed by variant name.
 * Add new fixtures here — `ContractVariant` and `swapContract` derive from this automatically.
 */
export const contractFixtures = {
  'contract-base': join(JOURNEY_FIXTURES_DIR, 'contract-base.ts'),
  'contract-additive': join(JOURNEY_FIXTURES_DIR, 'contract-additive.ts'),
  'contract-additive-required': join(JOURNEY_FIXTURES_DIR, 'contract-additive-required.ts'),
  'contract-additive-required-name': join(
    JOURNEY_FIXTURES_DIR,
    'contract-additive-required-name.ts',
  ),
  'contract-destructive': join(JOURNEY_FIXTURES_DIR, 'contract-destructive.ts'),
  'contract-add-table': join(JOURNEY_FIXTURES_DIR, 'contract-add-table.ts'),
  'contract-v3': join(JOURNEY_FIXTURES_DIR, 'contract-v3.ts'),
  'contract-phone': join(JOURNEY_FIXTURES_DIR, 'contract-phone.ts'),
  'contract-bio': join(JOURNEY_FIXTURES_DIR, 'contract-bio.ts'),
  'contract-phone-bio': join(JOURNEY_FIXTURES_DIR, 'contract-phone-bio.ts'),
  'contract-avatar': join(JOURNEY_FIXTURES_DIR, 'contract-avatar.ts'),
  'contract-all': join(JOURNEY_FIXTURES_DIR, 'contract-all.ts'),
  'contract-unique-email': join(JOURNEY_FIXTURES_DIR, 'contract-unique-email.ts'),
  'contract-typechange-text': join(JOURNEY_FIXTURES_DIR, 'contract-typechange-text.ts'),
  'contract-typechange-int': join(JOURNEY_FIXTURES_DIR, 'contract-typechange-int.ts'),
  'contract-nullable-name': join(JOURNEY_FIXTURES_DIR, 'contract-nullable-name.ts'),
  'contract-nullable-name-required': join(
    JOURNEY_FIXTURES_DIR,
    'contract-nullable-name-required.ts',
  ),
  'contract-status-enum': join(JOURNEY_FIXTURES_DIR, 'contract-status-enum.ts'),
  'contract-status-enum-shrunk': join(JOURNEY_FIXTURES_DIR, 'contract-status-enum-shrunk.ts'),
} as const;

export type ContractVariant = keyof typeof contractFixtures;

export const pslContractFixtures = {
  'contract-base': join(JOURNEY_FIXTURES_DIR, 'contract-base.prisma'),
  'contract-additive': join(JOURNEY_FIXTURES_DIR, 'contract-additive.prisma'),
} as const;

export type PslContractVariant = keyof typeof pslContractFixtures;

/**
 * Swaps the active contract in the test directory to a different variant.
 * Copies the variant file over `contract.ts` so the config picks it up on next emit.
 */
export function swapContract(ctx: JourneyContext, variant: ContractVariant): void {
  const src = contractFixtures[variant];
  const dest = join(ctx.testDir, 'contract.ts');
  copyFileSync(src, dest);
}

/**
 * Swaps the active PSL contract in the test directory to a different variant.
 * Copies the variant file over `contract.prisma` so the PSL-backed config picks it up.
 */
export function swapPslContract(ctx: JourneyContext, variant: PslContractVariant): void {
  const src = pslContractFixtures[variant];
  const dest = join(ctx.testDir, 'contract.prisma');
  copyFileSync(src, dest);
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/** Options for controlling the test environment when running a CLI command. */
export interface RunCommandOptions {
  /** Simulate piped stdout (isTTY=false) to test auto-JSON forwarding. Default: true (interactive). */
  readonly isTTY?: boolean;
}

/**
 * Core execution helper — all run* functions delegate to this.
 * Creates fresh mocks for each invocation so steps don't interfere.
 *
 * NOTE: Uses `process.chdir()`, which is process-global. This is safe because
 * `vitest.journeys.config.ts` uses `pool: 'forks'` (each file runs in its own
 * process) and tests within a file run sequentially. Do NOT switch to `pool: 'threads'`.
 */
async function runCommandCore(
  command: Command,
  testDir: string,
  args: readonly string[],
  options?: RunCommandOptions,
): Promise<CommandResult> {
  const mocks = setupCommandMocks({ isTTY: options?.isTTY });
  const originalCwd = process.cwd();
  try {
    process.chdir(testDir);
    try {
      await executeCommand(command, ['--no-color', ...args]);
      return {
        exitCode: 0,
        stdout: mocks.consoleOutput.join('\n'),
        stderr: mocks.consoleErrors.join('\n'),
      };
    } catch (error) {
      const exitCode = getExitCode();
      if (exitCode == null) throw error; // unexpected error, not a CLI exit
      return {
        exitCode,
        stdout: mocks.consoleOutput.join('\n'),
        stderr: mocks.consoleErrors.join('\n'),
      };
    }
  } finally {
    process.chdir(originalCwd);
    mocks.cleanup();
  }
}

/** Runs a CLI command with --config in the journey's test directory. */
async function runCommand(
  command: Command,
  ctx: JourneyContext,
  args: readonly string[],
  options?: RunCommandOptions,
): Promise<CommandResult> {
  return runCommandCore(command, ctx.testDir, ['--config', ctx.configPath, ...args], options);
}

/** Runs a CLI command without --config (for commands that don't need it, or error tests). */
async function runCommandRaw(
  command: Command,
  testDir: string,
  args: readonly string[],
  options?: RunCommandOptions,
): Promise<CommandResult> {
  return runCommandCore(command, testDir, args, options);
}

// ---------------------------------------------------------------------------
// Command runners (one per CLI command)
// ---------------------------------------------------------------------------

export async function runContractEmit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
  options?: RunCommandOptions,
): Promise<CommandResult> {
  return runCommand(createContractEmitCommand(), ctx, extraArgs, options);
}

export async function runContractInfer(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createContractInferCommand(), ctx, extraArgs);
}

export async function runDbInit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbInitCommand(), ctx, extraArgs);
}

export async function runDbUpdate(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbUpdateCommand(), ctx, extraArgs);
}

export async function runDbVerify(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbVerifyCommand(), ctx, extraArgs);
}

export async function runDbSign(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbSignCommand(), ctx, extraArgs);
}

export async function runDbSchema(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbSchemaCommand(), ctx, extraArgs);
}

export async function runMigrationPlan(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createMigrationPlanCommand(), ctx, extraArgs);
}

export async function runMigrationNew(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createMigrationNewCommand(), ctx, extraArgs);
}

export async function runMigrationApply(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createMigrationApplyCommand(), ctx, extraArgs);
}

export async function runMigrationStatus(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createMigrationStatusCommand(), ctx, extraArgs);
}

export async function runMigrationShow(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createMigrationShowCommand(), ctx, extraArgs);
}

/**
 * Self-emits a migration package by running its `migration.ts` directly with
 * `tsx`. The migration.ts invokes `Migration.run(import.meta.url, …)`, which
 * serializes the class's `operations` to `ops.json` and attests
 * `migration.json` in the package directory.
 *
 * Accepts a trailing `--dir <path>` pair (relative to `ctx.testDir`) to stay
 * source-compatible with the old `migration emit --dir` callsites. Any other
 * arguments are forwarded to the spawned process so tests can pass flags like
 * `--dry-run`.
 */
export async function runMigrationEmit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  const args = [...extraArgs];
  const dirIdx = args.indexOf('--dir');
  if (dirIdx < 0 || dirIdx === args.length - 1) {
    throw new Error(
      'runMigrationEmit requires `--dir <migration-dir>` so we know which migration.ts to execute',
    );
  }
  const dirArg = args[dirIdx + 1]!;
  args.splice(dirIdx, 2);

  const migrationTs = isAbsolute(dirArg)
    ? join(dirArg, 'migration.ts')
    : join(ctx.testDir, dirArg, 'migration.ts');
  try {
    const { stdout, stderr } = await execFileAsync(TSX_BIN, [migrationTs, ...args], {
      cwd: ctx.testDir,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/**
 * Runs `migration plan` and then self-emits the resulting draft `migration.ts`
 * via `tsx`. Mirrors the old `migration plan`-auto-emits behaviour that journey
 * tests relied on before the `migration emit` command was removed.
 *
 * Returns the original plan result (so JSON callers still see the plan's
 * stdout). If plan fails, emit is skipped. If emit fails, the returned result
 * carries the emit failure via `exitCode`/`stderr`.
 */
export async function runMigrationPlanAndEmit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  const planResult = await runMigrationPlan(ctx, extraArgs);
  if (planResult.exitCode !== 0) return planResult;
  const latest = getLatestMigrationDir(ctx);
  if (!latest) return planResult;
  const emitResult = await runMigrationEmit(ctx, ['--dir', `migrations/${latest}`]);
  if (emitResult.exitCode !== 0) {
    return {
      ...planResult,
      exitCode: emitResult.exitCode,
      stderr: `${planResult.stderr}\n[runMigrationPlanAndEmit] migration emit failed (exit ${emitResult.exitCode}):\n${emitResult.stderr}`,
    };
  }
  return planResult;
}

export async function runMigrationRef(
  ctx: JourneyContext,
  subcommandArgs: readonly string[],
): Promise<CommandResult> {
  const [subcommand, ...rest] = subcommandArgs;
  return runCommandRaw(createMigrationRefCommand(), ctx.testDir, [
    subcommand!,
    '--config',
    ctx.configPath,
    '--no-color',
    ...rest,
  ]);
}

/**
 * Runs a command with explicit config path (for error tests with custom configs).
 */
export async function runContractEmitWithConfig(
  testDir: string,
  configPath: string,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommandRaw(createContractEmitCommand(), testDir, [
    '--config',
    configPath,
    ...extraArgs,
  ]);
}

/**
 * Runs a command with explicit --db flag (for connection error tests).
 */
export async function runDbVerifyWithDb(
  ctx: JourneyContext,
  dbUrl: string,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbVerifyCommand(), ctx, ['--db', dbUrl, ...extraArgs]);
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

/**
 * Parses the JSON output from a --json command result.
 * Extracts the last valid JSON object from stdout (in case decoration preceded it).
 */
export function parseJsonOutput<T = Record<string, unknown>>(result: CommandResult): T {
  const output = result.stdout.trim();
  // JSON output goes to stdout. Try parsing the full output first.
  try {
    return JSON.parse(output) as T;
  } catch {
    // If mixed output, find the last JSON block
    const lines = output.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const candidate = lines.slice(i).join('\n').trim();
      try {
        return JSON.parse(candidate) as T;
      } catch {}
    }
    throw new Error(`Failed to parse JSON from command output:\n${output}`);
  }
}

// ---------------------------------------------------------------------------
// Migration directory helpers
// ---------------------------------------------------------------------------

/**
 * Returns sorted list of migration directory names in the journey's migrations/ dir.
 */
export function getMigrationDirs(ctx: JourneyContext): string[] {
  const migrationsDir = join(ctx.testDir, 'migrations');
  return readdirSync(migrationsDir)
    .filter((d) => !d.startsWith('.'))
    .sort();
}

/**
 * Returns the most recently created migration directory name (by mtime).
 *
 * Mtime-based selection is more robust than alphabetical sorting: two
 * migrations planned in the same minute share the `YYYYMMDDTHHMM_` prefix,
 * and alphabetical tie-break falls through to the slug. A newly-planned
 * migration whose slug sorts earlier than an existing sibling would be
 * mis-identified as "not the latest" if we just used `sort().at(-1)`. The
 * on-disk mtime always reflects the actual creation order.
 */
export function getLatestMigrationDir(ctx: JourneyContext): string | undefined {
  const dirs = getMigrationDirs(ctx);
  if (dirs.length === 0) return undefined;
  const migrationsDir = join(ctx.testDir, 'migrations');
  let newest = dirs[0]!;
  let newestMtime = statSync(join(migrationsDir, newest)).mtimeMs;
  for (let i = 1; i < dirs.length; i++) {
    const dir = dirs[i]!;
    const mtime = statSync(join(migrationsDir, dir)).mtimeMs;
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newest = dir;
    }
  }
  return newest;
}

// ---------------------------------------------------------------------------
// SQL helper
// ---------------------------------------------------------------------------

/**
 * Executes raw SQL against the journey's database using connect-execute-disconnect.
 * Respects PGlite's single-connection constraint.
 */
export async function sql(
  connectionString: string,
  query: string,
  params?: unknown[],
): Promise<{ rows: Record<string, unknown>[] }> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(query, params);
    return { rows: result.rows as Record<string, unknown>[] };
  });
}
