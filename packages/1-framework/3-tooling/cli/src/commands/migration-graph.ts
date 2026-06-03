import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { type CliStructuredError, errorMigrationGraphLegendHumanOnly } from '../utils/cli-errors';
import {
  addGlobalOptions,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { buildReadAggregate } from '../utils/contract-space-aggregate-loader';
import {
  computeGlobalMaxDirNameWidth,
  computeGlobalMaxEdgeTreePrefixWidth,
  indentMigrationGraphTreeBlock,
  renderMigrationGraphSpaceTree,
} from '../utils/formatters/migration-graph-space-render';
import { renderMigrationGraphLegend } from '../utils/formatters/migration-graph-tree-render';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';
import {
  listRefsByContractHash,
  migrationSpaceListEntriesFromAggregate,
  runMigrationList,
} from './migration-list';

interface MigrationGraphOptions extends CommonCommandOptions {
  readonly config?: string;
  readonly dot?: boolean;
  readonly space?: string;
  readonly ascii?: boolean;
  readonly legend?: boolean;
}

/**
 * The legend is decoration printed alongside the command header on stderr, so
 * it is suppressed for the machine-readable / silent paths (`--json`, `--dot`,
 * `--quiet`) exactly as the header is.
 */
export function migrationGraphShowsLegend(
  options: { readonly legend?: boolean; readonly dot?: boolean },
  flags: GlobalFlags,
): boolean {
  return (
    options.legend === true && options.dot !== true && flags.json !== true && flags.quiet !== true
  );
}

export function validateMigrationGraphLegendOptions(
  options: MigrationGraphOptions,
  flags: GlobalFlags,
): Result<void, CliStructuredError> {
  if (options.legend !== true) {
    return ok(undefined);
  }
  if (flags.json === true) {
    return notOk(errorMigrationGraphLegendHumanOnly('--json'));
  }
  if (options.dot === true) {
    return notOk(errorMigrationGraphLegendHumanOnly('--dot'));
  }
  return ok(undefined);
}

export interface MigrationGraphTreeSection {
  readonly spaceId: string;
  readonly tree: string;
  readonly showHeading: boolean;
}

export interface MigrationGraphResult {
  readonly ok: true;
  /** App-space graph for `--json` / `--dot` (unchanged machine output). */
  readonly graph: MigrationGraph;
  readonly treeSections: readonly MigrationGraphTreeSection[];
  readonly summary: string;
}

function computeGraphSummary(graph: MigrationGraph): string {
  return `${graph.nodes.size} node(s), ${graph.migrationByHash.size} edge(s)`;
}

export function formatMigrationGraphHumanOutput(result: MigrationGraphResult): string {
  const sections: string[] = [];
  for (const section of result.treeSections) {
    if (section.showHeading) {
      sections.push(`${section.spaceId}:`);
    }
    if (section.tree.length > 0) {
      sections.push(section.tree);
    } else {
      sections.push('(no migrations)');
    }
    sections.push('');
  }
  sections.push(result.summary);
  return sections.join('\n').trimEnd();
}

export async function executeMigrationGraphCommand(
  options: MigrationGraphOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationGraphResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsRelative, migrationsDir } = resolveMigrationPaths(
    options.config,
    config,
  );

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration graph',
      description: 'Show the migration graph topology',
      details: [
        { label: 'config', value: configPath },
        { label: 'migrations', value: migrationsRelative },
        ...(options.space !== undefined ? [{ label: 'space', value: options.space }] : []),
      ],
      flags,
    });
    ui.stderr(header);
    if (migrationGraphShowsLegend(options, flags)) {
      ui.stderr(
        renderMigrationGraphLegend({
          colorize: flags.color !== false,
          glyphMode: ui.resolveGlyphMode(options.ascii === true),
        }),
      );
      ui.stderr('');
    }
  }

  const loaded = await buildReadAggregate(config, { migrationsDir });
  if (!loaded.ok) {
    return loaded;
  }

  const { aggregate, contractHash: liveContractHash } = loaded.value;
  const appGraph = aggregate.app.graph();

  const listSpaces = await migrationSpaceListEntriesFromAggregate(aggregate, migrationsDir);
  const listResult = runMigrationList({
    spaces: listSpaces,
    ...ifDefined('spaceFilter', options.space),
  });
  if (!listResult.ok) {
    return listResult;
  }

  const scopedSpaces = listResult.value.spaces;
  const showSpaceHeadings = scopedSpaces.length > 1;
  const glyphMode = ui.resolveGlyphMode(options.ascii === true);
  const colorize = flags.color !== false;

  const globalLayoutInputs = showSpaceHeadings
    ? scopedSpaces
        .filter((spaceEntry) => spaceEntry.migrations.length > 0)
        .map((spaceEntry) => ({
          graph: aggregate.space(spaceEntry.spaceId)!.graph(),
          liveContractHash,
        }))
    : [];
  const globalMaxEdgeTreePrefixWidth =
    globalLayoutInputs.length > 0
      ? computeGlobalMaxEdgeTreePrefixWidth(globalLayoutInputs)
      : undefined;
  const globalMaxDirNameWidth =
    globalLayoutInputs.length > 0 ? computeGlobalMaxDirNameWidth(globalLayoutInputs) : undefined;

  const treeSections: MigrationGraphTreeSection[] = [];
  for (const spaceEntry of scopedSpaces) {
    const member = aggregate.space(spaceEntry.spaceId);
    if (member === undefined) {
      continue;
    }
    const graph = member.graph();
    const tree =
      spaceEntry.migrations.length === 0
        ? ''
        : renderMigrationGraphSpaceTree({
            graph,
            migrations: spaceEntry.migrations,
            liveContractHash,
            glyphMode,
            colorize,
            refsByHash: listRefsByContractHash(member),
            ...(globalMaxEdgeTreePrefixWidth !== undefined ? { globalMaxEdgeTreePrefixWidth } : {}),
            ...(globalMaxDirNameWidth !== undefined ? { globalMaxDirNameWidth } : {}),
          });
    const displayTree =
      showSpaceHeadings && tree.length > 0 ? indentMigrationGraphTreeBlock(tree, '  ') : tree;
    treeSections.push({
      spaceId: spaceEntry.spaceId,
      tree: displayTree,
      showHeading: showSpaceHeadings,
    });
  }

  return ok({
    ok: true,
    graph: appGraph,
    treeSections,
    summary: computeGraphSummary(appGraph),
  });
}

export function createMigrationGraphCommand(): Command {
  const command = new Command('graph');
  setCommandDescriptions(
    command,
    'Show the migration graph topology',
    'Renders the migration graph topology. Offline — does not consult\n' +
      'the database. --ascii swaps box-drawing for pipe-friendly ASCII glyphs.\n' +
      'Use --json for machine-readable output, or --dot for Graphviz DOT\n' +
      'format.',
  );
  setCommandExamples(command, [
    'prisma-next migration graph',
    'prisma-next migration graph --json',
    'prisma-next migration graph --dot',
    'prisma-next migration graph --ascii',
    'prisma-next migration graph --legend',
    'prisma-next migration graph --space app',
  ]);
  setCommandSeeAlso(command, [
    { verb: 'migration status', oneLiner: 'Show migration path and pending status' },
    { verb: 'migration log', oneLiner: 'Show executed migration history' },
    { verb: 'migration list', oneLiner: 'List on-disk migrations' },
    { verb: 'migration show', oneLiner: 'Display migration package contents' },
  ]);
  addGlobalOptions(command)
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--space <id>', 'Narrow output to a single contract space')
    .option('--dot', 'Output in Graphviz DOT format')
    .option('--ascii', 'Use ASCII glyphs (pipe-friendly)')
    .option('--legend', 'Print a key for the tree glyphs and lane colors')
    .action(async (options: MigrationGraphOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const legendValidation = validateMigrationGraphLegendOptions(options, flags);
      if (!legendValidation.ok) {
        process.exit(handleResult(legendValidation, flags, ui));
      }
      const result = await executeMigrationGraphCommand(options, flags, ui);
      const exitCode = handleResult(result, flags, ui, (graphResult) => {
        if (options.dot) {
          const lines = ['digraph migrations {'];
          for (const edge of graphResult.graph.migrationByHash.values()) {
            const from = edge.from.slice(0, 12);
            const to = edge.to.slice(0, 12);
            lines.push(`  "${from}" -> "${to}" [label="${edge.dirName}"];`);
          }
          lines.push('}');
          ui.output(lines.join('\n'));
        } else if (flags.json) {
          const nodes = [...graphResult.graph.nodes];
          const edges = [...graphResult.graph.migrationByHash.values()].map((e) => ({
            dirName: e.dirName,
            from: e.from,
            to: e.to,
            migrationHash: e.migrationHash,
          }));
          ui.output(
            JSON.stringify(
              {
                ok: true,
                nodes,
                edges,
                summary: `${graphResult.graph.nodes.size} node(s), ${graphResult.graph.migrationByHash.size} edge(s)`,
              },
              null,
              2,
            ),
          );
        } else if (!flags.quiet) {
          ui.output(formatMigrationGraphHumanOutput(graphResult));
        }
      });
      process.exit(exitCode);
    });
  return command;
}
