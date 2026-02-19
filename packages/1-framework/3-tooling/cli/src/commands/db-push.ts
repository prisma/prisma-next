import { dirname, relative, resolve } from 'node:path';
import { prismaDbPush } from '@prisma-next/contract-psl';
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
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { formatCommandHelp } from '../utils/output';
import { resolvePrismaSchemaPathFromSource } from '../utils/prisma-schema-source';
import { handleResult } from '../utils/result-handler';

interface DbPushOptions {
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

interface DbPushResult {
  readonly ok: true;
  readonly summary: string;
  readonly schemaPath: string;
  readonly dbUrl: string;
  readonly timings: {
    readonly total: number;
  };
  readonly stdout?: string;
  readonly stderr?: string;
}

function maskDatabaseUrl(url: string): string {
  return url.replace(/:([^:@]+)@/, ':****@');
}

function formatDbPushJson(result: DbPushResult): string {
  return JSON.stringify(result, null, 2);
}

function formatDbPushOutput(result: DbPushResult, flags: GlobalFlags): string {
  if (flags.quiet) {
    return '';
  }

  const lines = [`✔ ${result.summary}`];
  lines.push(`  schema: ${relative(process.cwd(), result.schemaPath)}`);
  if (flags.verbose) {
    lines.push(`  database: ${result.dbUrl}`);
    lines.push(`  Total time: ${result.timings.total}ms`);
  }
  if (flags.verbose === 2) {
    if (result.stdout?.trim()) {
      lines.push('  Prisma output:');
      lines.push(`  ${result.stdout.trim()}`);
    }
    if (result.stderr?.trim()) {
      lines.push('  Prisma diagnostics:');
      lines.push(`  ${result.stderr.trim()}`);
    }
  }
  return lines.join('\n');
}

async function executeDbPushCommand(
  options: DbPushOptions,
  startTime: number,
): Promise<Result<DbPushResult, CliStructuredError>> {
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
        why: 'A Prisma schema is required for db push. Pass --schema <path> or set config.contract.source to a .prisma path.',
      }),
    );
  }

  const dbConnection = options.db ?? config.db?.connection;
  if (typeof dbConnection !== 'string' || dbConnection.length === 0) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: 'Database connection is required for db push (set db.connection in config or pass --db <url>).',
      }),
    );
  }

  try {
    const cliResult = await prismaDbPush({
      schemaPath,
      url: dbConnection,
    });

    return ok({
      ok: true,
      summary: 'Database schema synchronized with Prisma schema',
      schemaPath,
      dbUrl: maskDatabaseUrl(dbConnection),
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
      errorRuntime('Prisma db push failed', {
        why: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export function createDbPushCommand(): Command {
  const command = new Command('push');
  setCommandDescriptions(
    command,
    'Apply Prisma schema to database',
    'Uses Prisma CLI db push against a Prisma schema file. This command is intended for\n' +
      'PSL workflows where config.contract.source is a .prisma file or --schema is provided.',
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
    .action(async (options: DbPushOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      if (flags.json === 'ndjson') {
        const result = notOk(
          errorJsonFormatNotSupported({
            command: 'db push',
            format: 'ndjson',
            supportedFormats: ['object'],
          }),
        );
        process.exit(handleResult(result, flags));
      }

      const result = await executeDbPushCommand(options, startTime);
      const exitCode = handleResult(result, flags, (value) => {
        if (flags.json === 'object') {
          console.log(formatDbPushJson(value));
          return;
        }
        const output = formatDbPushOutput(value, flags);
        if (output) {
          console.log(output);
        }
      });
      process.exit(exitCode);
    });

  return command;
}
