import type {
  MigrationListResult,
  MigrationSpaceListEntry,
} from '@prisma-next/migration-tools/migration-list-types';
import { APP_SPACE_ID, isValidSpaceId } from '@prisma-next/migration-tools/spaces';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import {
  type CliStructuredError,
  errorInvalidSpaceId,
  errorSpaceNotFound,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { buildReadAggregate } from '../utils/contract-space-aggregate-loader';
import {
  type GlyphMode,
  renderMigrationListGraphResult,
} from '../utils/formatters/migration-list-graph-render';
import {
  buildMigrationListTopologyBySpace,
  renderMigrationListWithStyle,
} from '../utils/formatters/migration-list-render';
import { createAnsiMigrationListStyler } from '../utils/formatters/migration-list-styler';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { migrationSpaceListEntriesFromAggregate } from '../utils/migration-space-list-from-aggregate';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationListOptions extends CommonCommandOptions {
  readonly config?: string;
  readonly space?: string;
  readonly graph?: boolean;
  readonly ascii?: boolean;
}

export interface MigrationListHumanRenderOptions {
  readonly graph: boolean;
  readonly glyphMode: GlyphMode;
  readonly useColor: boolean;
}

export function renderMigrationListHumanOutput(
  result: MigrationListResult,
  options: MigrationListHumanRenderOptions,
): string {
  const styler = createAnsiMigrationListStyler({ useColor: options.useColor });
  const topologyBySpaceId = buildMigrationListTopologyBySpace(result);
  if (options.graph) {
    return renderMigrationListGraphResult(result, styler, options.glyphMode, topologyBySpaceId);
  }
  return renderMigrationListWithStyle(result, styler, options.glyphMode, topologyBySpaceId);
}

/**
 * Inputs for {@link runMigrationList} — the policy core of `migration list`
 * that tests exercise directly.
 *
 * The core does not call `loadConfig`, parse CLI flags, render a styled
 * header, or write to any stream. Enumeration is supplied by the caller
 * (the CLI shell builds it from {@link migrationSpaceListEntriesFromAggregate}).
 */
export interface RunMigrationListInputs {
  readonly spaces: readonly MigrationSpaceListEntry[];
  readonly spaceFilter?: string;
}

function computeSummary(spaces: readonly MigrationSpaceListEntry[]): string {
  const totalMigrations = spaces.reduce((count, space) => count + space.migrations.length, 0);
  if (spaces.length <= 1) {
    return `${totalMigrations} migration(s) on disk`;
  }
  return `${totalMigrations} migration(s) across ${spaces.length} contract space(s)`;
}

/**
 * Policy core of `migration list`: validates `--space`, narrows the
 * pre-enumerated spaces, and assembles a {@link MigrationListResult}.
 *
 * - `migrations/` missing or contains no valid space directories →
 *   caller passes `spaces: []`; this synthesizes `[{ spaceId: APP_SPACE_ID, migrations: [] }]`.
 * - `--space <id>` on an existing-but-empty space → `{ spaceId, migrations: [] }` in the input.
 * - `--space <id>` on a non-existent (or reserved) space → `SPACE_NOT_FOUND`.
 */
export function runMigrationList(
  inputs: RunMigrationListInputs,
): Result<MigrationListResult, CliStructuredError> {
  const { spaces, spaceFilter } = inputs;

  if (spaceFilter !== undefined && !isValidSpaceId(spaceFilter)) {
    return notOk(errorInvalidSpaceId(spaceFilter));
  }

  if (spaceFilter !== undefined && !spaces.some((s) => s.spaceId === spaceFilter)) {
    return notOk(errorSpaceNotFound(spaceFilter, spaces.map((s) => s.spaceId).sort()));
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
export async function executeMigrationListCommand(
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

  const loaded = await buildReadAggregate(config, { migrationsDir });
  if (!loaded.ok) {
    return notOk(loaded.failure);
  }

  const spaces = await migrationSpaceListEntriesFromAggregate(
    loaded.value.aggregate,
    migrationsDir,
  );

  return runMigrationList({
    spaces,
    ...ifDefined('spaceFilter', options.space),
  });
}

export function createMigrationListCommand(): Command {
  const command = new Command('list');
  setCommandDescriptions(
    command,
    'List on-disk migrations, latest first, per contract space',
    'Enumerates every on-disk migration under migrations/<space>/ for every\n' +
      'contract space found on disk, latest first. Offline — does not consult\n' +
      'the database. Each row leads with a kind glyph (* forward, ↩ rollback,\n' +
      '⟲ self), then dirName, then source → destination contract hashes\n' +
      '(7-char git-style). Self-edges show a single hash. Invariants render as\n' +
      '{...}; refs on the destination as (production, db). Pass --space <id>\n' +
      'to narrow to one contract space. --graph draws the forward spine with\n' +
      'lane gutters; --ascii forces ASCII glyphs (orthogonal to --no-color).',
  );
  setCommandExamples(command, [
    'prisma-next migration list',
    'prisma-next migration list --graph',
    'prisma-next migration list --space app',
    'prisma-next migration list --graph --ascii',
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
    .option('--graph', 'Draw migration relationships as an annotated tree')
    .option('--ascii', 'Use ASCII glyphs for --graph (pipe-friendly)')
    .action(async (options: MigrationListOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const result = await executeMigrationListCommand(options, flags, ui);
      const exitCode = handleResult(result, flags, ui, (listResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(listResult, null, 2));
        } else if (!flags.quiet) {
          ui.output(
            renderMigrationListHumanOutput(listResult, {
              graph: options.graph === true,
              glyphMode: ui.resolveGlyphMode(options.ascii === true),
              useColor: ui.useColor,
            }),
          );
        }
      });
      process.exit(exitCode);
    });
  return command;
}
