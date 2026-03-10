import { relative, resolve } from 'node:path';
import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import type { IntrospectSchemaResult } from '@prisma-next/core-control-plane/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  maskConnectionUrl,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { formatIntrospectJson, formatIntrospectOutput, formatStyledHeader } from '../utils/output';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface DbIntrospectOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
}

interface DbIntrospectCommandResult {
  readonly introspectResult: IntrospectSchemaResult<unknown>;
  readonly schemaView: CoreSchemaView | undefined;
}

/**
 * Executes the db introspect command and returns a structured Result.
 */
async function executeDbIntrospectCommand(
  options: DbIntrospectOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
): Promise<Result<DbIntrospectCommandResult, CliStructuredError>> {
  // Load config
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';

  // Output header
  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
    ];
    if (options.db) {
      details.push({ label: 'database', value: maskConnectionUrl(options.db) });
    } else if (config.db?.connection && typeof config.db.connection === 'string') {
      details.push({ label: 'database', value: maskConnectionUrl(config.db.connection) });
    }
    const header = formatStyledHeader({
      command: 'db introspect',
      description: 'Inspect the database schema',
      url: 'https://pris.ly/db-introspect',
      details,
      flags,
    });
    ui.stderr(header);
  }

  // Resolve database connection (--db flag or config.db.connection)
  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for db introspect (set db.connection in ${configPath}, or pass --db <url>)`,
        commandName: 'db introspect',
      }),
    );
  }

  // Check for driver
  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for db introspect' }));
  }

  // Create control client
  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks ?? [],
  });

  // Create progress adapter
  const onProgress = createProgressAdapter({ flags });

  try {
    // Introspect with connection and progress
    const schemaIR = await client.introspect({
      connection: dbConnection,
      onProgress,
    });

    // Call toSchemaView to convert schema IR to CoreSchemaView for tree rendering
    const schemaView = client.toSchemaView(schemaIR);

    const totalTime = Date.now() - startTime;

    // Get masked connection URL for meta (only for string connections)
    const connectionForMeta =
      typeof dbConnection === 'string' ? maskConnectionUrl(dbConnection) : undefined;

    const introspectResult: IntrospectSchemaResult<unknown> = {
      ok: true,
      summary: 'Schema introspected successfully',
      target: {
        familyId: config.family.familyId,
        id: config.target.targetId,
      },
      schema: schemaIR,
      meta: {
        ...(configPath ? { configPath } : {}),
        ...(connectionForMeta ? { dbUrl: connectionForMeta } : {}),
      },
      timings: {
        total: totalTime,
      },
    };

    return ok({ introspectResult, schemaView });
  } catch (error) {
    // Driver already throws CliStructuredError for connection failures
    if (error instanceof CliStructuredError) {
      return notOk(error);
    }

    // Wrap unexpected errors
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during db introspect: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createDbIntrospectCommand(): Command {
  const command = new Command('introspect');
  setCommandDescriptions(
    command,
    'Inspect the database schema',
    'Reads the live database schema and displays it as a tree structure. This command\n' +
      'does not check the schema against your contract - it only shows what exists in\n' +
      'the database. Use `db verify` or `db schema-verify` to compare against your contract.',
  );
  setCommandExamples(command, [
    'prisma-next db introspect --db $DATABASE_URL',
    'prisma-next db introspect --db $DATABASE_URL --json',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: DbIntrospectOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeDbIntrospectCommand(options, flags, ui, startTime);

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, (value) => {
        const { introspectResult, schemaView } = value;
        if (flags.json) {
          ui.output(formatIntrospectJson(introspectResult));
        } else {
          const output = formatIntrospectOutput(introspectResult, schemaView, flags);
          if (output) {
            ui.log(output);
          }
        }
      });
      process.exit(exitCode);
    });

  return command;
}
