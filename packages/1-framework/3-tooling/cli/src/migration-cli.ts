/**
 * The migration-file CLI interface: the actor invoked when the author runs
 * `node migration.ts` directly.
 *
 * Naming: this is *not* a "migration runner" in the apply-time sense. The
 * apply-time runner is the thing `prisma-next migration apply` uses to
 * execute migration JSON ops against a database. `MigrationCLI` is the
 * tiny CLI surface owned by an authored `migration.ts` file: parse the
 * file's argv, load the project's `prisma-next.config.ts`, assemble a
 * `ControlStack`, instantiate the migration class, and serialize.
 *
 * The user authors a migration class, then calls
 * `MigrationCLI.run(import.meta.url, MigrationClass)` at module scope
 * after the class definition. When the file is invoked as a node
 * entrypoint (`node migration.ts`), the CLI:
 *
 * 1. Detects whether the file is the direct entrypoint (no-op when imported).
 * 2. Parses CLI args (`--help`, `--dry-run`, `--config <path>`).
 * 3. Loads the project's `prisma-next.config.ts` via the same `loadConfig`
 *    the CLI commands use, walking up from the migration file's directory.
 * 4. Assembles a `ControlStack` from the loaded config descriptors.
 * 5. Verifies the migration's `targetId` matches `config.target.targetId`
 *    (`PN-MIG-2006` on mismatch).
 * 6. Instantiates the migration with the assembled stack.
 * 7. Reads any previously-scaffolded `migration.json`, then calls
 *    `buildMigrationArtifacts` from `@prisma-next/migration-tools` to
 *    produce in-memory `ops.json` + `migration.json` content. Persists
 *    the result to disk (or prints in dry-run mode).
 *
 * File I/O lives here, in `@prisma-next/cli`: this is the only place
 * that legitimately combines config loading, stack assembly, and
 * on-disk persistence. `@prisma-next/migration-tools` owns the pure
 * conversion from a `Migration` instance to artifact strings; `Migration`
 * stays a pure abstract class.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CliStructuredError } from '@prisma-next/errors/control';
import { errorMigrationTargetMismatch } from '@prisma-next/errors/migration';
import { createControlStack } from '@prisma-next/framework-components/control';
import {
  buildMigrationArtifacts,
  isDirectEntrypoint,
  type Migration,
  printMigrationHelp,
} from '@prisma-next/migration-tools/migration';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { dirname, join } from 'pathe';
import { loadConfig } from './config-loader';

/**
 * Constructor shape accepted by `MigrationCLI.run`. `Migration` subclasses
 * accept an optional `ControlStack` in their constructor (each subclass
 * narrows the stack to its own family/target generics); the CLI always
 * passes one assembled from the loaded config. We use a rest-args `any[]`
 * constructor signature so that subclass constructors with narrower
 * parameter types remain assignable - constructor type compatibility in
 * TS is contravariant in the parameter, and a wider `unknown` parameter
 * on the alias side would reject any narrower subclass signature.
 *
 * The CLI only ever passes one argument (`new MigrationClass(stack)`);
 * the rest-arity is purely a type-compatibility concession for subclass
 * constructors that declare narrower parameter types, not an extension
 * point for additional construction arguments.
 */
// biome-ignore lint/suspicious/noExplicitAny: see JSDoc - rest args with any are the idiomatic TS pattern for accepting arbitrary subclass constructor signatures
export type MigrationConstructor = new (...args: any[]) => Migration;

interface ParsedArgs {
  readonly help: boolean;
  readonly dryRun: boolean;
  readonly configPath: string | undefined;
}

/**
 * Parse the subset of `process.argv` that `MigrationCLI.run` cares about.
 * Recognised flags: `--help`, `--dry-run`, `--config <path>` /
 * `--config=<path>`. Unknown flags are ignored to keep the surface
 * forgiving for ad-hoc tooling that wraps a migration file.
 *
 * NOTE: this hand-rolled parser is a known wart, tracked separately by
 * TML-2318 ("Migration CLI: replace handrolled arg parser with shared
 * CLI library"). Until that lands the surface is intentionally tiny.
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
 * The CLI surface invoked by an authored `migration.ts` file. Exposed as
 * a class with a static `run` method (rather than a free function) to
 * give the concept a stable identity in the ubiquitous language: this is
 * the "migration-file CLI", distinct from the apply-time runner that
 * executes migration JSON ops.
 *
 * Currently a single static method. Future surface (e.g. a programmatic
 * `MigrationCLI.serializeOnly(...)` for tests, or extra subcommands) can
 * land here without changing the import shape used by every authored
 * migration.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: see JSDoc - intentional class facade for the migration-file CLI surface; future methods will share state derived from argv/config.
export class MigrationCLI {
  /**
   * Orchestrates a class-flow `migration.ts` script run. Awaitable:
   * callers may `await MigrationCLI.run(...)` to surface async failures
   * from config loading, but the typical usage pattern (top-level call
   * after the class definition) does not require awaiting because
   * node's module evaluation keeps the promise alive until completion.
   *
   * Any throwable inside this function must surface through the internal
   * try/catch — script callers do not await, so an unhandled rejection
   * would silently exit 0. Treat the try/catch as load-bearing for the
   * no-await usage pattern.
   */
  static async run(importMetaUrl: string, MigrationClass: MigrationConstructor): Promise<void> {
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

      // Construct first so we can read `instance.targetId`. The target-mismatch
      // check below is what rescues concrete subclasses that cast inside their
      // constructor (e.g. `PostgresMigration` casts `stack.adapter.create(stack)`
      // to `SqlControlAdapter<'postgres'>`); a wrong-target stack would produce a
      // misshapen adapter, but the instance never reaches the
      // serialization step because we throw `errorMigrationTargetMismatch`
      // before that.
      const instance = new MigrationClass(stack);

      if (instance.targetId !== config.target.targetId) {
        throw errorMigrationTargetMismatch({
          migrationTargetId: instance.targetId,
          configTargetId: config.target.targetId,
        });
      }

      serializeMigrationToDisk(instance, migrationDir, args.dryRun);
    } catch (err) {
      if (CliStructuredError.is(err)) {
        process.stderr.write(`${err.message}: ${err.why}\n`);
      } else {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      }
      process.exitCode = 1;
    }
  }
}

/**
 * Read a previously-scaffolded `migration.json` from disk, returning
 * `null` when the file is missing or unparseable. The CLI feeds this into
 * `buildMigrationArtifacts` so the pure builder can preserve fields owned
 * by `migration plan` (contract bookends, hints, labels, `createdAt`)
 * across re-emits.
 */
function readExistingManifest(manifestPath: string): Partial<MigrationManifest> | null {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as Partial<MigrationManifest>;
  } catch {
    return null;
  }
}

/**
 * Persist a migration instance's artifacts to `migrationDir`. In
 * `dryRun` mode the artifacts are printed to stdout (with the same
 * `--- migration.json --- / --- ops.json ---` framing the legacy
 * `serializeMigration` helper used) and no files are written. Otherwise
 * `ops.json` and `migration.json` are written next to `migration.ts` and
 * a confirmation line is printed.
 *
 * File I/O lives in the CLI rather than `@prisma-next/migration-tools`
 * so the migration-tools package stays focused on the pure
 * `Migration` → in-memory artifact conversion. The CLI is the only
 * legitimate site for combining config loading, stack assembly, and
 * filesystem persistence.
 */
function serializeMigrationToDisk(
  instance: Migration,
  migrationDir: string,
  dryRun: boolean,
): void {
  const manifestPath = join(migrationDir, 'migration.json');
  const existing = readExistingManifest(manifestPath);
  const { opsJson, manifestJson } = buildMigrationArtifacts(instance, existing);

  if (dryRun) {
    process.stdout.write(`--- migration.json ---\n${manifestJson}\n`);
    process.stdout.write('--- ops.json ---\n');
    process.stdout.write(`${opsJson}\n`);
    return;
  }

  writeFileSync(join(migrationDir, 'ops.json'), opsJson);
  writeFileSync(manifestPath, manifestJson);

  process.stdout.write(`Wrote ops.json + migration.json to ${migrationDir}\n`);
}
