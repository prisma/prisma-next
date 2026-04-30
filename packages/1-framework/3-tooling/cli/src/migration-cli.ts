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
 * 4. Probe-instantiates the migration class without a stack so it can read
 *    `targetId` and verify it matches `config.target.targetId`
 *    (`PN-MIG-2006` on mismatch) before any stack-driven adapter
 *    construction runs.
 * 5. Assembles a `ControlStack` from the loaded config descriptors and
 *    constructs the migration with that stack.
 * 6. Reads any previously-scaffolded `migration.json`, then calls
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
import { errorMigrationCliInvalidConfigArg } from '@prisma-next/errors/control';
import { errorInvalidJson } from '@prisma-next/migration-tools/errors';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { buildMigrationArtifacts, type Migration } from '@prisma-next/migration-tools/migration';
import { join } from 'pathe';

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
 * Minimal structural shape the migration-file CLI writes to. Matches
 * what clipanion's `Cli.run({ stdout, stderr })` consumes — just
 * `write` and `end` — so callers can inject any buffer-like collector
 * (including `process.stdout`/`process.stderr`, which trivially
 * satisfy this surface) without dragging in the full
 * `NodeJS.WritableStream` event-emitter surface.
 */
export interface MigrationCliWritable {
  write(chunk: string | Uint8Array): boolean;
  end(chunk?: string | Uint8Array): void;
}

/**
 * Parse the subset of `process.argv` that `MigrationCLI.run` cares about.
 * Recognised flags: `--help`, `--dry-run`, `--config <path>` /
 * `--config=<path>`. Unknown flags are ignored to keep the surface
 * forgiving for ad-hoc tooling that wraps a migration file.
 *
 * Throws `errorMigrationCliInvalidConfigArg` (`PN-CLI-4012`) when
 * `--config` is missing its path argument or is followed by another flag
 * (e.g. `--config --dry-run`); silently consuming the next flag would
 * either drop dry-run handling or serialize against the wrong project.
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
      if (next === undefined) {
        throw errorMigrationCliInvalidConfigArg();
      }
      if (next.startsWith('-')) {
        throw errorMigrationCliInvalidConfigArg({ nextToken: next });
      }
      configPath = next;
      i++;
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
   * Orchestrates a class-flow `migration.ts` script run.
   *
   * The third argument is the in-process testability surface: callers
   * (and tests) may inject `argv`, `stdout`, and `stderr` instead of
   * relying on `process.argv` / `process.stdout` / `process.stderr`.
   * Each option defaults to its `process` global when omitted, so
   * existing two-argument call sites
   * (`MigrationCLI.run(import.meta.url, MyMigration)`) continue to
   * compile and behave identically once the clipanion-based body lands
   * in m4.
   *
   * Returns the exit code so the caller can branch on it (or set
   * `process.exitCode` themselves). Awaiting is optional: the typical
   * top-level call pattern doesn't await because node's module
   * evaluation keeps the promise alive until completion.
   *
   * Stub: the clipanion-based implementation lands in plan m4. The
   * tests in `test/migration-cli.test.ts` already assert against the
   * post-m4 contract; they will fail on this stub-throw and turn green
   * once m4 wires up the parser. This is the canonical tests-first
   * pattern. See `projects/migration-cli-arg-parser/plan.md` § Commit 4.
   */
  static async run(
    importMetaUrl: string,
    MigrationClass: MigrationConstructor,
    options: {
      readonly argv?: readonly string[];
      readonly stdout?: MigrationCliWritable;
      readonly stderr?: MigrationCliWritable;
    } = {},
  ): Promise<number> {
    void importMetaUrl;
    void MigrationClass;
    void options;
    // Helpers retained for m4 (parser swap will reuse the existing
    // orchestration); referenced here so `noUnusedLocals` doesn't fire
    // against the stub. Removed in m4.
    void parseArgs;
    void serializeMigrationToDisk;
    throw new Error('MigrationCLI.run: clipanion-based implementation lands in m4');
  }
}

/**
 * Read a previously-scaffolded `migration.json` from disk, returning
 * `null` when the file is missing and throwing `MIGRATION.INVALID_JSON`
 * when the file is present but cannot be parsed as JSON. The CLI feeds
 * this into `buildMigrationArtifacts` so the pure builder can preserve
 * fields owned by `migration plan` (contract bookends, hints, labels,
 * `createdAt`) across re-emits.
 *
 * Author-time path: this loader still does not verify the manifest hash
 * or schema — that is the apply-time loader's job. Hash mismatch is the
 * *expected* outcome of a re-author (the developer's source changes
 * invalidate the prior hash by construction), and verification here
 * would block legitimate regenerations. Syntactic JSON-parse failure,
 * however, is now surfaced rather than swallowed: a malformed
 * `migration.json` indicates either a hand-edit gone wrong or partial
 * write, and silently rebuilding from `describe()` would discard the
 * user's on-disk content (preserved bookends, hints, labels,
 * `createdAt`) without any indication something was wrong on disk.
 * Apply-time consumers always route through the verifying
 * `readMigrationPackage` in `@prisma-next/migration-tools/io` instead.
 */
function readExistingMetadata(metadataPath: string): Partial<MigrationMetadata> | null {
  let raw: string;
  try {
    raw = readFileSync(metadataPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as Partial<MigrationMetadata>;
  } catch (e) {
    throw errorInvalidJson(metadataPath, e instanceof Error ? e.message : String(e));
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
  const metadataPath = join(migrationDir, 'migration.json');
  const existing = readExistingMetadata(metadataPath);
  const { opsJson, metadataJson } = buildMigrationArtifacts(instance, existing);

  if (dryRun) {
    process.stdout.write(`--- migration.json ---\n${metadataJson}\n`);
    process.stdout.write('--- ops.json ---\n');
    process.stdout.write(`${opsJson}\n`);
    return;
  }

  writeFileSync(join(migrationDir, 'ops.json'), opsJson);
  writeFileSync(metadataPath, metadataJson);

  process.stdout.write(`Wrote ops.json + migration.json to ${migrationDir}\n`);
}
