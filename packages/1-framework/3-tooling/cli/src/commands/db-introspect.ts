import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import type { IntrospectSchemaResult } from '@prisma-next/core-control-plane/types';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorJsonFormatNotSupported,
  errorUnexpected,
} from '../utils/cli-errors';
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatIntrospectJson,
  formatIntrospectOutput,
  formatStyledHeader,
} from '../utils/output';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';

interface DbIntrospectOptions {
  readonly db?: string;
  readonly config?: string;
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly vv?: boolean;
  readonly trace?: boolean;
  readonly timestamps?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
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
  startTime: number,
): Promise<Result<DbIntrospectCommandResult, CliStructuredError>> {
  // Load config
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';

  // Optionally load contract if contract config exists (needed for toSchemaView)
  let contractIR: unknown | undefined;
  if (config.contract?.output) {
    const contractFilePath = resolve(config.contract.output);
    try {
      const contractJsonContent = await readFile(contractFilePath, 'utf-8');
      contractIR = JSON.parse(contractJsonContent);
    } catch (error) {
      // Contract file is optional for introspection - don't fail if it doesn't exist
      if (error instanceof Error && (error as { code?: string }).code !== 'ENOENT') {
        return notOk(
          errorUnexpected(error.message, {
            why: `Failed to read contract file: ${error.message}`,
          }),
        );
      }
    }
  }

  // Output header
  if (flags.json !== 'object' && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
    ];
    if (options.db) {
      // Mask password in URL for security
      const maskedUrl = options.db.replace(/:([^:@]+)@/, ':****@');
      details.push({ label: 'database', value: maskedUrl });
    } else if (config.db?.connection && typeof config.db.connection === 'string') {
      // Mask password in URL for security
      const maskedUrl = config.db.connection.replace(/:([^:@]+)@/, ':****@');
      details.push({ label: 'database', value: maskedUrl });
    }
    const header = formatStyledHeader({
      command: 'db introspect',
      description: 'Inspect the database schema',
      url: 'https://pris.ly/db-introspect',
      details,
      flags,
    });
    console.log(header);
  }

  // Resolve database connection (--db flag or config.db.connection)
  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for db introspect (set db.connection in ${configPath}, or pass --db <url>)`,
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

    // Add blank line after all async operations if spinners were shown
    if (!flags.quiet && flags.json !== 'object' && process.stdout.isTTY) {
      console.log('');
    }

    // Call toSchemaView to convert schema IR to CoreSchemaView for tree rendering
    // This requires the contract and a family instance with toSchemaView support
    let schemaView: CoreSchemaView | undefined;
    if (contractIR) {
      const stack = createControlPlaneStack({
        target: config.target,
        adapter: config.adapter,
        driver: config.driver,
        extensionPacks: config.extensionPacks,
      });
      const familyInstance = config.family.create(stack);
      if (familyInstance.toSchemaView) {
        const validatedContract = familyInstance.validateContractIR(contractIR);
        schemaView = familyInstance.toSchemaView({
          contractIR: validatedContract,
          schemaIR: schemaIR,
        });
      }
    }

    const totalTime = Date.now() - startTime;

    // Get masked connection URL for meta (only for string connections)
    const connectionForMeta =
      typeof dbConnection === 'string' ? dbConnection.replace(/:([^:@]+)@/, ':****@') : undefined;

    const introspectResult: IntrospectSchemaResult<unknown> = {
      ok: true,
      summary: 'Schema introspected successfully',
      target: {
        familyId: config.family.familyId,
        id: config.target.targetId,
      },
      schema: schemaIR,
      ...(configPath || connectionForMeta
        ? {
            meta: {
              ...(configPath ? { configPath } : {}),
              ...(connectionForMeta ? { dbUrl: connectionForMeta } : {}),
            },
          }
        : {}),
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
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const flags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags });
      },
    })
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--json [format]', 'Output as JSON (object)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbIntrospectOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      // Validate JSON format option
      if (flags.json === 'ndjson') {
        const result = notOk(
          errorJsonFormatNotSupported({
            command: 'db introspect',
            format: 'ndjson',
            supportedFormats: ['object'],
          }),
        );
        const exitCode = handleResult(result, flags);
        process.exit(exitCode);
      }

      const result = await executeDbIntrospectCommand(options, flags, startTime);

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, (value) => {
        const { introspectResult, schemaView } = value;
        if (flags.json === 'object') {
          console.log(formatIntrospectJson(introspectResult));
        } else {
          const output = formatIntrospectOutput(introspectResult, schemaView, flags);
          if (output) {
            console.log(output);
          }
        }
      });
      process.exit(exitCode);
    });

  return command;
}
