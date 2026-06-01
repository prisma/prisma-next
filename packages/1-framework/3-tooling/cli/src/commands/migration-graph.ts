import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import { ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import type { CliStructuredError } from '../utils/cli-errors';
import {
  addGlobalOptions,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { buildReadAggregate } from '../utils/contract-space-aggregate-loader';
import { migrationGraphToRenderInput } from '../utils/formatters/graph-migration-mapper';
import { graphRenderer } from '../utils/formatters/graph-render';
import { buildMigrationGraphLayout } from '../utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../utils/formatters/migration-graph-rows';
import {
  renderMigrationGraphLegend,
  renderMigrationGraphTree,
} from '../utils/formatters/migration-graph-tree-render';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import type { StatusRef } from '../utils/migration-types';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationGraphOptions extends CommonCommandOptions {
  readonly config?: string;
  readonly dot?: boolean;
  readonly tree?: boolean;
  readonly ascii?: boolean;
  readonly legend?: boolean;
}

/**
 * `--legend` describes the `--tree` visual language, so passing it auto-enables
 * the tree path (it has nothing to say about the legacy dagre default).
 */
export function migrationGraphUsesTree(options: {
  readonly tree?: boolean;
  readonly legend?: boolean;
}): boolean {
  return options.tree === true || options.legend === true;
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

export interface MigrationGraphResult {
  readonly ok: true;
  readonly graph: MigrationGraph;
  readonly contractHash: string | null;
  readonly refs: readonly StatusRef[];
  readonly summary: string;
}

export async function executeMigrationGraphCommand(
  options: MigrationGraphOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationGraphResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, appMigrationsRelative, migrationsDir } = resolveMigrationPaths(
    options.config,
    config,
  );

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration graph',
      description: 'Show the migration graph topology',
      details: [
        { label: 'config', value: configPath },
        { label: 'migrations', value: appMigrationsRelative },
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
      // Blank line separating the stderr key from the graph that follows on stdout.
      ui.stderr('');
    }
  }

  const loaded = await buildReadAggregate(config, { migrationsDir });
  if (!loaded.ok) {
    return loaded;
  }

  const { aggregate, contractHash } = loaded.value;
  const graph = aggregate.app.graph();
  const refs: readonly StatusRef[] = Object.entries(aggregate.app.refs).map(([name, entry]) => ({
    name,
    hash: entry.hash,
    active: false,
  }));

  return ok({
    ok: true,
    graph,
    contractHash,
    refs,
    summary: `${graph.nodes.size} node(s), ${graph.migrationByHash.size} edge(s)`,
  });
}

export function createMigrationGraphCommand(): Command {
  const command = new Command('graph');
  setCommandDescriptions(
    command,
    'Show the migration graph topology',
    'Renders the migration graph topology. Offline — does not consult\n' +
      'the database. Use --tree for the condensed annotated tree\n' +
      '(--ascii swaps box-drawing for pipe-friendly ASCII glyphs),\n' +
      '--json for machine-readable output, or --dot for Graphviz DOT\n' +
      'format.',
  );
  setCommandExamples(command, [
    'prisma-next migration graph',
    'prisma-next migration graph --json',
    'prisma-next migration graph --dot',
    'prisma-next migration graph --tree',
    'prisma-next migration graph --tree --ascii',
    'prisma-next migration graph --legend',
  ]);
  setCommandSeeAlso(command, [
    { verb: 'migration status', oneLiner: 'Show migration path and pending status' },
    { verb: 'migration log', oneLiner: 'Show executed migration history' },
    { verb: 'migration list', oneLiner: 'List on-disk migrations' },
    { verb: 'migration show', oneLiner: 'Display migration package contents' },
  ]);
  addGlobalOptions(command)
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--dot', 'Output in Graphviz DOT format')
    .option('--tree', 'Experimental condensed annotated tree renderer')
    .option('--ascii', 'Use ASCII glyphs for --tree (pipe-friendly)')
    .option('--legend', 'Print a key for the --tree glyphs and lane colors (implies --tree)')
    .action(async (options: MigrationGraphOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const result = await executeMigrationGraphCommand(options, flags, ui);
      const exitCode = handleResult(result, flags, ui, (graphResult) => {
        // Explicit format flags win over the auto-JSON default. `flags.json`
        // is auto-enabled when stdout is non-TTY (per CLI Style Guide §
        // JSON Semantics); without this ordering, `migration graph --dot |
        // dot -Tsvg` pipes JSON into the GraphViz binary, which then
        // errors. `--dot` is the more specific instruction; honour it.
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
            JSON.stringify({ ok: true, nodes, edges, summary: graphResult.summary }, null, 2),
          );
        } else if (!flags.quiet) {
          if (migrationGraphUsesTree(options)) {
            const refsByHash = new Map<string, string[]>();
            for (const ref of graphResult.refs) {
              const existing = refsByHash.get(ref.hash);
              refsByHash.set(ref.hash, existing ? [...existing, ref.name] : [ref.name]);
            }
            const rowModel = buildMigrationGraphRows(graphResult.graph, {
              ...(graphResult.contractHash !== null
                ? { contractHash: graphResult.contractHash }
                : {}),
            });
            const layout = buildMigrationGraphLayout(rowModel);
            const activeRef = graphResult.refs.find((ref) => ref.active);
            const treeOutput = renderMigrationGraphTree(layout, {
              refsByHash,
              ...(graphResult.contractHash !== null
                ? { contractHash: graphResult.contractHash }
                : {}),
              ...(activeRef !== undefined ? { activeRefName: activeRef.name } : {}),
              colorize: flags.color !== false,
              glyphMode: ui.resolveGlyphMode(options.ascii === true),
            });
            // Emit the rendered tree to stdout (same stream as flat `migration list`),
            // not through clack's `log.message` rail: the graph is the command's
            // result (and its own box-drawing is the only vertical structure it
            // should carry), not a status line that needs the prompt gutter.
            ui.output(treeOutput);
            ui.output(`\n${graphResult.summary}`);
          } else {
            const renderInput = migrationGraphToRenderInput({
              graph: graphResult.graph,
              mode: 'offline',
              markerHash: undefined,
              contractHash: graphResult.contractHash ?? EMPTY_CONTRACT_HASH,
              refs: graphResult.refs,
              activeRefHash: undefined,
              activeRefName: undefined,
              edgeStatuses: [],
            });
            const graphOutput = graphRenderer.render(renderInput.graph, {
              ...renderInput.options,
              colorize: flags.color !== false,
            });
            ui.log(graphOutput);
            ui.log(`\n${graphResult.summary}`);
          }
        }
      });
      process.exit(exitCode);
    });
  return command;
}
