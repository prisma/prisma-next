import { stat } from 'node:fs/promises';
import { enumerateMigrationSpaces } from '@prisma-next/migration-tools/enumerate-migration-spaces';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type {
  MigrationListResult,
  MigrationSpaceListEntry,
} from '@prisma-next/migration-tools/migration-list-types';
import {
  APP_SPACE_ID,
  isValidSpaceId,
  listContractSpaceDirectories,
  spaceMigrationDirectory,
} from '@prisma-next/migration-tools/spaces';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import {
  type CliStructuredError,
  errorInvalidSpaceId,
  errorSpaceNotFound,
  errorUnexpected,
  mapMigrationToolsError,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { renderMigrationList } from '../utils/formatters/migration-list-render';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationListOptions extends CommonCommandOptions {
  readonly config?: string;
  readonly space?: string;
}

/**
 * Inputs for {@link runMigrationList} — the pure-ish data-and-policy core
 * of `migration list` that tests exercise directly.
 *
 * The core depends only on the filesystem rooted at `migrationsDir`. It
 * does NOT call `loadConfig`, parse CLI flags, render a styled header,
 * or write to any stream. Output rendering is the caller's concern (the
 * CLI shell renders via {@link renderMigrationList}; JSON callers
 * serialize the {@link MigrationListResult} directly).
 */
export interface RunMigrationListInputs {
  /** Absolute path to the project's `migrations/` directory. */
  readonly migrationsDir: string;
  /**
   * Optional contract-space id to narrow the result to a single space.
   * Same validation rules as {@link isValidSpaceId}. When absent, every
   * on-disk space contributes.
   */
  readonly spaceFilter?: string;
}

/**
 * Compute the trailing one-line summary appended below the migration
 * rows. Wording follows the existing CLI's pluralization style ("N
 * migration(s) on disk" for the common single-space path; multi-space
 * adds "across K contract space(s)" so consumers can see the spread).
 *
 * The renderer suppresses the summary line when `totalMigrations === 0`
 * — the empty-state line carries enough information on its own — so
 * this function always returns a string even for the empty-state.
 */
function computeSummary(spaces: readonly MigrationSpaceListEntry[]): string {
  const totalMigrations = spaces.reduce((count, space) => count + space.migrations.length, 0);
  if (spaces.length <= 1) {
    return `${totalMigrations} migration(s) on disk`;
  }
  return `${totalMigrations} migration(s) across ${spaces.length} contract space(s)`;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Pre-check that the requested `--space <id>` exists on disk before
 * delegating to the enumerator. The enumerator returns `[]` for a
 * non-existent space directory (because the parent walk returns no
 * candidates), which is structurally identical to the empty-state path
 * — the spec explicitly distinguishes the two and requires a structured
 * CLI error here.
 *
 * Returns `null` on success so the caller can proceed; returns the
 * structured error to forward verbatim when the space is missing.
 * Surfaces only valid contract-space directory names in the suggestion
 * list (skips stray non-space directories), matching the enumerator's
 * own filtering rule.
 */
async function ensureSpaceExists(
  migrationsDir: string,
  spaceId: string,
): Promise<CliStructuredError | null> {
  const spaceDir = spaceMigrationDirectory(migrationsDir, spaceId);
  try {
    const stats = await stat(spaceDir);
    if (stats.isDirectory()) {
      return null;
    }
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
  }
  const candidates = await listContractSpaceDirectories(migrationsDir);
  const validCandidates = candidates.filter(isValidSpaceId).slice().sort();
  return errorSpaceNotFound(spaceId, validCandidates);
}

/**
 * The unit-testable core of `migration list`. Given an absolute
 * `migrationsDir` and an optional `spaceFilter`, enumerates every
 * on-disk migration (via {@link enumerateMigrationSpaces}), narrows to
 * the requested space if any, and assembles a {@link MigrationListResult}
 * ready for the renderer or JSON serializer.
 *
 * Distinct empty-state paths:
 *
 * - `migrations/` missing or contains no valid space directories →
 *   synthesizes `[{ spaceId: APP_SPACE_ID, migrations: [] }]` so the
 *   renderer's empty-state path can name a directory (spec § Empty-state +
 *   the `migrations/` missing edge case).
 * - `--space <id>` on an existing-but-empty space dir → the enumerator
 *   surfaces `{ spaceId, migrations: [] }`; rendered the same way.
 * - `--space <id>` on a non-existent dir → structured
 *   `MIGRATION.SPACE_NOT_FOUND` error (NOT empty-state).
 *
 * Errors caught here:
 *
 * - {@link MigrationToolsError} from the enumerator → mapped through
 *   {@link mapMigrationToolsError} so callers see the catalogue code.
 * - Anything else (filesystem etc.) → wrapped via {@link errorUnexpected}.
 */
export async function runMigrationList(
  inputs: RunMigrationListInputs,
): Promise<Result<MigrationListResult, CliStructuredError>> {
  const { migrationsDir, spaceFilter } = inputs;

  if (spaceFilter !== undefined && !isValidSpaceId(spaceFilter)) {
    return notOk(errorInvalidSpaceId(spaceFilter));
  }

  if (spaceFilter !== undefined) {
    const spaceError = await ensureSpaceExists(migrationsDir, spaceFilter);
    if (spaceError !== null) {
      return notOk(spaceError);
    }
  }

  let spaces: readonly MigrationSpaceListEntry[];
  try {
    spaces = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });
  } catch (error) {
    if (MigrationToolsError.is(error)) return notOk(mapMigrationToolsError(error));
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to enumerate migrations: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  const scopedSpaces =
    spaceFilter !== undefined ? spaces.filter((s) => s.spaceId === spaceFilter) : spaces;

  const resultSpaces: readonly MigrationSpaceListEntry[] =
    scopedSpaces.length === 0 ? [{ spaceId: APP_SPACE_ID, migrations: [] }] : scopedSpaces;

  return ok({
    ok: true,
    spaces: resultSpaces,
    summary: computeSummary(resultSpaces),
  });
}

/**
 * CLI shell: loads config, resolves paths, prints the styled header on
 * stderr (interactive mode only), and delegates to {@link runMigrationList}.
 * Kept intentionally thin so the unit-testable surface lives in the core.
 */
async function executeMigrationListCommand(
  options: MigrationListOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationListResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, migrationsRelative } = resolveMigrationPaths(
    options.config,
    config,
  );

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration list',
      description: 'List on-disk migrations, latest first, per contract space',
      details: [
        { label: 'config', value: configPath },
        { label: 'migrations', value: migrationsRelative },
        ...(options.space !== undefined ? [{ label: 'space', value: options.space }] : []),
      ],
      flags,
    });
    ui.stderr(header);
  }

  return runMigrationList({
    migrationsDir,
    ...(options.space !== undefined ? { spaceFilter: options.space } : {}),
  });
}

export function createMigrationListCommand(): Command {
  const command = new Command('list');
  setCommandDescriptions(
    command,
    'List on-disk migrations, latest first, per contract space',
    'Enumerates every on-disk migration under migrations/<space>/ for every\n' +
      'contract space found on disk, latest first. Offline — does not consult\n' +
      'the database. Each row shows source → destination contract hashes\n' +
      '(7-char git-style), the self-edge marker (⟲), any provided invariants\n' +
      '({...}), and refs landing on the destination ((production, db)). Pass\n' +
      '--space <id> to narrow to a single contract space.',
  );
  setCommandExamples(command, [
    'prisma-next migration list',
    'prisma-next migration list --space app',
    'prisma-next migration list --json',
  ]);
  setCommandSeeAlso(command, [
    { verb: 'migration status', oneLiner: 'Show migration path and pending status' },
    { verb: 'migration log', oneLiner: 'Show executed migration history' },
    { verb: 'migration graph', oneLiner: 'Show the migration graph topology' },
    { verb: 'migration show', oneLiner: 'Display migration package contents' },
  ]);
  addGlobalOptions(command)
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--space <id>', 'Narrow output to a single contract space')
    .action(async (options: MigrationListOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const result = await executeMigrationListCommand(options, flags, ui);
      const exitCode = handleResult(result, flags, ui, (listResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(listResult, null, 2));
        } else if (!flags.quiet) {
          ui.output(renderMigrationList(listResult));
        }
      });
      process.exit(exitCode);
    });
  return command;
}
