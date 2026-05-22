import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import {
  type CliStructuredError,
  errorUnexpected,
  mapMigrationToolsError,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  loadMigrationPackages,
  readContractEnvelope,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { migrationGraphToRenderInput } from '../utils/formatters/graph-migration-mapper';
import { graphRenderer } from '../utils/formatters/graph-render';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import type { StatusRef } from '../utils/migration-types';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationGraphOptions extends CommonCommandOptions {
  readonly config?: string;
  readonly dot?: boolean;
}

export interface MigrationGraphResult {
  readonly ok: true;
  readonly graph: MigrationGraph;
  readonly contractHash: string | null;
  readonly refs: readonly StatusRef[];
  readonly summary: string;
}

async function executeMigrationGraphCommand(
  options: MigrationGraphOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationGraphResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, appMigrationsDir, appMigrationsRelative, refsDir } = resolveMigrationPaths(
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
  }

  let graph: MigrationGraph;
  try {
    ({ graph } = await loadMigrationPackages(appMigrationsDir));
  } catch (error) {
    if (MigrationToolsError.is(error)) return notOk(mapMigrationToolsError(error));
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read migrations: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  let contractHash: string | null = null;
  try {
    const envelope = await readContractEnvelope(config);
    contractHash = envelope.storageHash;
  } catch {
    // Contract unreadable — render graph without contract marker
  }

  let refs: readonly StatusRef[] = [];
  try {
    const allRefs = await readRefs(refsDir);
    refs = Object.entries(allRefs).map(([name, entry]) => ({
      name,
      hash: entry.hash,
      active: false,
    }));
  } catch {
    // Refs unreadable — render graph without ref markers
  }

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
    'Renders the migration graph as an ASCII tree. Offline — does not\n' +
      'consult the database. Use --json for machine-readable output or\n' +
      '--dot for Graphviz DOT format.',
  );
  setCommandExamples(command, [
    'prisma-next migration graph',
    'prisma-next migration graph --json',
    'prisma-next migration graph --dot',
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
      });
      process.exit(exitCode);
    });
  return command;
}
