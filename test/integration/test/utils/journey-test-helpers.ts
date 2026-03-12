/**
 * Journey test helpers for CLI e2e scenario tests.
 *
 * Each journey is a single `it()` block that runs multiple CLI commands sequentially
 * against a shared database. These helpers encapsulate the command execution pattern
 * so journey tests stay concise and readable.
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { createDbInitCommand } from '@prisma-next/cli/commands/db-init';
import { createDbIntrospectCommand } from '@prisma-next/cli/commands/db-introspect';
import { createDbSchemaVerifyCommand } from '@prisma-next/cli/commands/db-schema-verify';
import { createDbSignCommand } from '@prisma-next/cli/commands/db-sign';
import { createDbUpdateCommand } from '@prisma-next/cli/commands/db-update';
import { createDbVerifyCommand } from '@prisma-next/cli/commands/db-verify';
import { createMigrationApplyCommand } from '@prisma-next/cli/commands/migration-apply';
import { createMigrationPlanCommand } from '@prisma-next/cli/commands/migration-plan';
import { createMigrationRefCommand } from '@prisma-next/cli/commands/migration-ref';
import { createMigrationShowCommand } from '@prisma-next/cli/commands/migration-show';
import { createMigrationStatusCommand } from '@prisma-next/cli/commands/migration-status';
import { createMigrationVerifyCommand } from '@prisma-next/cli/commands/migration-verify';
import type { Command } from 'commander';
import { join } from 'pathe';
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
}

/** Context object returned by setupJourney and used by all run* helpers. */
export interface JourneyContext {
  testDir: string;
  configPath: string;
  outputDir: string;
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
  const { connectionString, createTempDir } = options;

  const testDir = createTempDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });

  // Copy base contract
  copyFileSync(join(JOURNEY_FIXTURES_DIR, 'contract-base.ts'), join(testDir, 'contract.ts'));

  // Copy and process config
  const configFileName = connectionString
    ? 'prisma-next.config.with-db.ts'
    : 'prisma-next.config.ts';
  let configContent = readFileSync(join(JOURNEY_FIXTURES_DIR, configFileName), 'utf-8');
  if (connectionString) {
    configContent = configContent.replace(/\{\{DB_URL\}\}/g, () => connectionString);
  }
  const configPath = join(testDir, 'prisma-next.config.ts');
  writeFileSync(configPath, configContent, 'utf-8');

  return { testDir, configPath, outputDir };
}

/**
 * Sets up a journey test directory without a database connection (for help/config-error tests).
 * Uses the no-driver config.
 */
export function setupJourneyNoDb(createTempDir: () => string): JourneyContext {
  const testDir = createTempDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });

  // Copy base contract
  copyFileSync(join(JOURNEY_FIXTURES_DIR, 'contract-base.ts'), join(testDir, 'contract.ts'));

  // Copy no-db config (no driver, no connection)
  const configContent = readFileSync(join(JOURNEY_FIXTURES_DIR, 'prisma-next.config.ts'), 'utf-8');
  const configPath = join(testDir, 'prisma-next.config.ts');
  writeFileSync(configPath, configContent, 'utf-8');

  return { testDir, configPath, outputDir };
}

// ---------------------------------------------------------------------------
// Contract swapping
// ---------------------------------------------------------------------------

type ContractVariant =
  | 'contract-base'
  | 'contract-additive'
  | 'contract-additive-required'
  | 'contract-destructive'
  | 'contract-add-table'
  | 'contract-v3'
  | 'contract-phone'
  | 'contract-bio'
  | 'contract-phone-bio';

/**
 * Swaps the active contract in the test directory to a different variant.
 * Copies the variant file over `contract.ts` so the config picks it up on next emit.
 */
export function swapContract(ctx: JourneyContext, variant: ContractVariant): void {
  const src = join(JOURNEY_FIXTURES_DIR, `${variant}.ts`);
  const dest = join(ctx.testDir, 'contract.ts');
  copyFileSync(src, dest);
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/**
 * Runs a CLI command in the journey's test directory.
 * Returns a CommandResult with exit code, stdout, and stderr.
 *
 * This is the core execution helper — all run* functions delegate to it.
 * It creates fresh mocks for each invocation so steps don't interfere.
 */
async function runCommand(
  command: Command,
  ctx: JourneyContext,
  args: readonly string[],
): Promise<CommandResult> {
  const mocks = setupCommandMocks();
  const originalCwd = process.cwd();
  try {
    process.chdir(ctx.testDir);
    try {
      await executeCommand(command, ['--config', ctx.configPath, '--no-color', ...args]);
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

/**
 * Runs a CLI command without --config (for commands that don't need it, or error tests).
 */
async function runCommandRaw(
  command: Command,
  testDir: string,
  args: readonly string[],
): Promise<CommandResult> {
  const mocks = setupCommandMocks();
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

// ---------------------------------------------------------------------------
// Command runners (one per CLI command)
// ---------------------------------------------------------------------------

export async function runContractEmit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createContractEmitCommand(), ctx, extraArgs);
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

export async function runDbSchemaVerify(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbSchemaVerifyCommand(), ctx, extraArgs);
}

export async function runDbSign(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbSignCommand(), ctx, extraArgs);
}

export async function runDbIntrospect(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createDbIntrospectCommand(), ctx, extraArgs);
}

export async function runMigrationPlan(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(createMigrationPlanCommand(), ctx, extraArgs);
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

export async function runMigrationVerify(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<CommandResult> {
  // migration verify doesn't support --config, use runCommandRaw
  return runCommandRaw(createMigrationVerifyCommand(), ctx.testDir, extraArgs);
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
 * Returns the latest (last sorted) migration directory name.
 */
export function getLatestMigrationDir(ctx: JourneyContext): string | undefined {
  const dirs = getMigrationDirs(ctx);
  return dirs[dirs.length - 1];
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
  const { withClient } = await import('@prisma-next/test-utils');
  return withClient(connectionString, async (client) => {
    const result = await client.query(query, params);
    return { rows: result.rows as Record<string, unknown>[] };
  });
}
