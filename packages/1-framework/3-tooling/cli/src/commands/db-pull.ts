import { dirname, resolve } from 'node:path';
import { prismaDbPull } from '@prisma-next/contract-psl';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import {
  CliStructuredError,
  errorContractConfigMissing,
  errorDatabaseConnectionRequired,
  errorJsonFormatNotSupported,
  errorRuntime,
} from '../utils/cli-errors';
import { setCommandDescriptions } from '../utils/command-helpers';
import { parseGlobalFlags } from '../utils/global-flags';
import { formatCommandHelp } from '../utils/output';
import { resolvePrismaSchemaPathFromSource } from '../utils/prisma-schema-source';
import { handleResult } from '../utils/result-handler';

interface DbPullOptions {
  readonly schema?: string;
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

interface DbPullResult {
  readonly ok: true;
  readonly schema: string;
  readonly schemaPath: string;
  readonly timings: {
    readonly total: number;
  };
  readonly stdout?: string;
  readonly stderr?: string;
}

function formatDbPullJson(result: DbPullResult): string {
  return JSON.stringify(result, null, 2);
}

async function executeDbPullCommand(
  options: DbPullOptions,
  startTime: number,
): Promise<Result<DbPullResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const configDir = options.config ? dirname(resolve(options.config)) : process.cwd();

  const schemaPathFromConfig = resolvePrismaSchemaPathFromSource(
    config.contract?.source,
    configDir,
  );
  const schemaPath = options.schema ? resolve(options.schema) : schemaPathFromConfig;
  if (!schemaPath) {
    return notOk(
      errorContractConfigMissing({
        why: 'A Prisma schema is required for db pull. Pass --schema <path> or set config.contract.source to a .prisma path.',
      }),
    );
  }

  const dbConnection = options.db ?? config.db?.connection;
  if (typeof dbConnection !== 'string' || dbConnection.length === 0) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: 'Database connection is required for db pull (set db.connection in config or pass --db <url>).',
      }),
    );
  }

  try {
    const cliResult = await prismaDbPull({
      schemaPath,
      url: dbConnection,
    });

    return ok({
      ok: true,
      schema: cliResult.schema,
      schemaPath,
      timings: {
        total: Date.now() - startTime,
      },
      ...(cliResult.stdout ? { stdout: cliResult.stdout } : {}),
      ...(cliResult.stderr ? { stderr: cliResult.stderr } : {}),
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    return notOk(
      errorRuntime('Prisma db pull failed', {
        why: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export function createDbPullCommand(): Command {
  const command = new Command('pull');
  setCommandDescriptions(
    command,
    'Introspect database to Prisma schema',
    'Uses Prisma CLI db pull and prints the resulting schema.prisma text to stdout.',
  );

  command
    .configureHelp({
      formatHelp: (cmd) => {
        const flags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags });
      },
    })
    .option(
      '--schema <path>',
      'Path to schema.prisma (defaults to config.contract.source if it is a .prisma path)',
    )
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--json [format]', 'Output as JSON (object)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbPullOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      if (flags.json === 'ndjson') {
        const result = notOk(
          errorJsonFormatNotSupported({
            command: 'db pull',
            format: 'ndjson',
            supportedFormats: ['object'],
          }),
        );
        process.exit(handleResult(result, flags));
      }

      const result = await executeDbPullCommand(options, startTime);
      const exitCode = handleResult(result, flags, (value) => {
        if (flags.quiet) {
          return;
        }
        if (flags.json === 'object') {
          console.log(formatDbPullJson(value));
          return;
        }
        console.log(value.schema);
      });
      process.exit(exitCode);
    });

  return command;
}
