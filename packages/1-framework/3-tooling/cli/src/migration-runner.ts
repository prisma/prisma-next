/**
 * Entrypoint orchestrator for class-flow `migration.ts` files.
 *
 * `runMigration(import.meta.url, MigrationClass)` replaces the legacy
 * `Migration.run(import.meta.url, MigrationClass)` static. The user
 * authors a migration class, then calls `runMigration` at module scope
 * after the class definition; when the file is invoked as a node entrypoint
 * (`node migration.ts`), the runner:
 *
 * 1. Detects whether the file is the direct entrypoint (no-op when imported).
 * 2. Parses CLI args (`--help`, `--dry-run`, `--config <path>`).
 * 3. Loads the project's `prisma-next.config.ts` via the same `loadConfig`
 *    the CLI commands use, walking up from the migration file's directory.
 * 4. Assembles a `ControlStack` from the loaded config descriptors.
 * 5. Verifies the migration's `targetId` matches `config.target.targetId`
 *    (`PN-MIG-2006` on mismatch).
 * 6. Instantiates the migration with the assembled stack.
 * 7. Delegates to `serializeMigration` from `@prisma-next/migration-tools`
 *    to write `ops.json` + `migration.json` (or print them in dry-run mode).
 *
 * The runner lives in `@prisma-next/cli` because it's the only place that
 * legitimately combines config loading, stack assembly, and on-disk
 * serialization in one function. `@prisma-next/migration-tools` stays
 * focused on persistence; `Migration` stays a pure abstract class.
 */

import { fileURLToPath } from 'node:url';
import { CliStructuredError } from '@prisma-next/errors/control';
import { errorMigrationTargetMismatch } from '@prisma-next/errors/migration';
import { createControlStack } from '@prisma-next/framework-components/control';
import {
  isDirectEntrypoint,
  type Migration,
  printMigrationHelp,
  serializeMigration,
} from '@prisma-next/migration-tools/migration';
import { dirname } from 'pathe';
import { loadConfig } from './config-loader';

/**
 * Constructor shape accepted by `runMigration`. `Migration` subclasses
 * accept an optional `ControlStack` in their constructor; the runner
 * always passes one assembled from the loaded config.
 */
export type MigrationConstructor = new (stack: unknown) => Migration;

interface ParsedArgs {
  readonly help: boolean;
  readonly dryRun: boolean;
  readonly configPath: string | undefined;
}

/**
 * Parse the subset of `process.argv` that `runMigration` cares about.
 * Recognised flags: `--help`, `--dry-run`, `--config <path>` /
 * `--config=<path>`. Unknown flags are ignored to keep the surface
 * forgiving for ad-hoc tooling that wraps a migration file.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  let help = false;
  let dryRun = false;
  let configPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--config') {
      const next = argv[i + 1];
      if (next !== undefined) {
        configPath = next;
        i++;
      }
    } else if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
    }
  }

  return { help, dryRun, configPath };
}

/**
 * Orchestrates a class-flow `migration.ts` script run. Awaitable: callers
 * may `await runMigration(...)` to surface async failures from config
 * loading, but the typical usage pattern (top-level call after the class
 * definition) does not require awaiting because node's module evaluation
 * keeps the promise alive until completion.
 */
export async function runMigration(
  importMetaUrl: string,
  MigrationClass: MigrationConstructor,
): Promise<void> {
  if (!importMetaUrl) return;
  if (!isDirectEntrypoint(importMetaUrl)) return;

  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printMigrationHelp();
    return;
  }

  const migrationFile = fileURLToPath(importMetaUrl);
  const migrationDir = dirname(migrationFile);

  try {
    const config = await loadConfig(args.configPath);

    const stack = createControlStack(config);

    const instance = new MigrationClass(stack);

    if (instance.targetId !== config.target.targetId) {
      throw errorMigrationTargetMismatch({
        migrationTargetId: instance.targetId,
        configTargetId: config.target.targetId,
      });
    }

    serializeMigration(instance, migrationDir, args.dryRun);
  } catch (err) {
    if (CliStructuredError.is(err)) {
      process.stderr.write(`${err.message}: ${err.why}\n`);
    } else {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exitCode = 1;
  }
}
