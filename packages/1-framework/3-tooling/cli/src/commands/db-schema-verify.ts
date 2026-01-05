import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { VerifyDatabaseSchemaResult } from '@prisma-next/core-control-plane/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorJsonFormatNotSupported,
  errorUnexpected,
} from '../utils/cli-errors';
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatSchemaVerifyJson,
  formatSchemaVerifyOutput,
  formatStyledHeader,
} from '../utils/output';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';

interface DbSchemaVerifyOptions {
  readonly db?: string;
  readonly config?: string;
  readonly json?: string | boolean;
  readonly strict?: boolean;
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

/**
 * Executes the db schema-verify command and returns a structured Result.
 */
async function executeDbSchemaVerifyCommand(
  options: DbSchemaVerifyOptions,
  flags: GlobalFlags,
): Promise<Result<VerifyDatabaseSchemaResult, CliStructuredError>> {
  // Load config
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';
  const contractPathAbsolute = config.contract?.output
    ? resolve(config.contract.output)
    : resolve('src/prisma/contract.json');
  const contractPath = relative(process.cwd(), contractPathAbsolute);

  // Output header
  if (flags.json !== 'object' && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'contract', value: contractPath },
    ];
    if (options.db) {
      details.push({ label: 'database', value: options.db });
    }
    const header = formatStyledHeader({
      command: 'db schema-verify',
      description: 'Check whether the database schema satisfies your contract',
      url: 'https://pris.ly/db-schema-verify',
      details,
      flags,
    });
    console.log(header);
  }

  // Load contract file
  let contractJsonContent: string;
  try {
    contractJsonContent = await readFile(contractPathAbsolute, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return notOk(
        errorFileNotFound(contractPathAbsolute, {
          why: `Contract file not found at ${contractPathAbsolute}`,
          fix: `Run \`prisma-next contract emit\` to generate ${contractPath}, or update \`config.contract.output\` in ${configPath}`,
        }),
      );
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  let contractJson: Record<string, unknown>;
  try {
    contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }

  // Resolve database connection (--db flag or config.db.connection)
  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for db schema-verify (set db.connection in ${configPath}, or pass --db <url>)`,
      }),
    );
  }

  // Check for driver
  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for db schema-verify' }));
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
    const schemaVerifyResult = await client.schemaVerify({
      contractIR: contractJson,
      strict: options.strict ?? false,
      connection: dbConnection,
      onProgress,
    });

    // Add blank line after all async operations if spinners were shown
    if (!flags.quiet && flags.json !== 'object' && process.stdout.isTTY) {
      console.log('');
    }

    return ok(schemaVerifyResult);
  } catch (error) {
    // Driver already throws CliStructuredError for connection failures
    if (error instanceof CliStructuredError) {
      return notOk(error);
    }

    // Wrap unexpected errors
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during db schema-verify: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createDbSchemaVerifyCommand(): Command {
  const command = new Command('schema-verify');
  setCommandDescriptions(
    command,
    'Check whether the database schema satisfies your contract',
    'Verifies that your database schema satisfies the emitted contract. Compares table structures,\n' +
      'column types, constraints, and extensions. Reports any mismatches via a contract-shaped\n' +
      'verification tree. This is a read-only operation that does not modify the database.',
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
    .option('--strict', 'Strict mode: extra schema elements cause failures', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbSchemaVerifyOptions) => {
      const flags = parseGlobalFlags(options);

      // Validate JSON format option
      if (flags.json === 'ndjson') {
        const result = notOk(
          errorJsonFormatNotSupported({
            command: 'db schema-verify',
            format: 'ndjson',
            supportedFormats: ['object'],
          }),
        );
        const exitCode = handleResult(result, flags);
        process.exit(exitCode);
      }

      const result = await executeDbSchemaVerifyCommand(options, flags);

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, (schemaVerifyResult) => {
        if (flags.json === 'object') {
          console.log(formatSchemaVerifyJson(schemaVerifyResult));
        } else {
          const output = formatSchemaVerifyOutput(schemaVerifyResult, flags);
          if (output) {
            console.log(output);
          }
        }
      });

      // For logical schema mismatches, check if verification passed
      // Infra errors already handled by handleResult (returns non-zero exit code)
      if (result.ok && !result.value.ok) {
        // Schema verification failed - exit with code 1
        process.exit(1);
      } else {
        // Success or infra error - use exit code from handleResult
        process.exit(exitCode);
      }
    });

  return command;
}
