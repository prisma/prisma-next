import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type {
  SignDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import { ContractValidationError } from '../control-api/errors';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  maskConnectionUrl,
  resolveContractPath,
  setCommandDescriptions,
} from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatSchemaVerifyJson,
  formatSchemaVerifyOutput,
  formatSignJson,
  formatSignOutput,
  formatStyledHeader,
} from '../utils/output';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface DbSignOptions {
  readonly db?: string;
  readonly config?: string;
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly trace?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
  readonly interactive?: boolean;
  readonly 'no-interactive'?: boolean;
  readonly yes?: boolean;
  readonly y?: boolean;
}

/**
 * Failure type for db sign command.
 * Either an infrastructure error (CliStructuredError) or a logical failure (schema verification failed).
 */
type DbSignFailure = CliStructuredError | VerifyDatabaseSchemaResult;

/**
 * Executes the db sign command and returns a structured Result.
 * Success: SignDatabaseResult (sign happened)
 * Failure: CliStructuredError (infra error) or VerifyDatabaseSchemaResult (schema mismatch)
 */
async function executeDbSignCommand(
  options: DbSignOptions,
  flags: GlobalFlags,
): Promise<Result<SignDatabaseResult, DbSignFailure>> {
  const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

  // Load config
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';
  const contractPathAbsolute = resolveContractPath(config);
  const contractPath = relative(process.cwd(), contractPathAbsolute);

  // Output header
  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'contract', value: contractPath },
    ];
    if (options.db) {
      details.push({ label: 'database', value: maskConnectionUrl(options.db) });
    }
    const header = formatStyledHeader({
      command: 'db sign',
      description: 'Sign the database with your contract so you can safely run queries',
      url: 'https://pris.ly/db-sign',
      details,
      flags,
    });
    ui.stderr(header);
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
        why: `Database connection is required for db sign (set db.connection in ${configPath}, or pass --db <url>)`,
      }),
    );
  }

  // Check for driver
  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for db sign' }));
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
    // Step 1: Schema verification - connect here
    const schemaVerifyResult = await client.schemaVerify({
      contractIR: contractJson,
      strict: false,
      connection: dbConnection,
      onProgress,
    });

    // If schema verification failed, return as failure
    if (!schemaVerifyResult.ok) {
      return notOk(schemaVerifyResult);
    }

    // Step 2: Sign (already connected from schemaVerify)
    const signResult = await client.sign({
      contractIR: contractJson,
      contractPath,
      configPath,
      onProgress,
    });

    return ok(signResult);
  } catch (error) {
    // Driver already throws CliStructuredError for connection failures
    if (error instanceof CliStructuredError) {
      return notOk(error);
    }

    if (error instanceof ContractValidationError) {
      return notOk(
        errorContractValidationFailed(`Contract validation failed: ${error.message}`, {
          where: { path: contractPathAbsolute },
        }),
      );
    }

    // Wrap unexpected errors
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during db sign: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createDbSignCommand(): Command {
  const command = new Command('sign');
  setCommandDescriptions(
    command,
    'Sign the database with your contract so you can safely run queries',
    'Verifies that your database schema satisfies the emitted contract, and if so, writes or\n' +
      'updates the database signature. This command is idempotent and safe to run\n' +
      'in CI/deployment pipelines. The signature records that this database instance is aligned\n' +
      'with a specific contract version.',
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
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('--trace', 'Trace output: deep internals, stack traces')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .option('--interactive', 'Force interactive mode')
    .option('--no-interactive', 'Disable interactive prompts')
    .option('-y, --yes', 'Auto-accept prompts')
    .action(async (options: DbSignOptions) => {
      const flags = parseGlobalFlags(options);

      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeDbSignCommand(options, flags);

      if (result.ok) {
        // Success - format sign output
        if (flags.json) {
          ui.output(formatSignJson(result.value));
        } else {
          const output = formatSignOutput(result.value, flags);
          if (output) {
            ui.log(output);
          }
        }
        process.exit(0);
      }

      // Failure - determine type and handle appropriately
      const failure = result.failure;

      if (failure instanceof CliStructuredError) {
        // Infrastructure error - use standard handler
        const exitCode = handleResult(result as Result<never, CliStructuredError>, flags);
        process.exit(exitCode);
      }

      // Schema verification failed - format and print schema verification output
      if (flags.json) {
        ui.output(formatSchemaVerifyJson(failure));
      } else {
        const output = formatSchemaVerifyOutput(failure, flags);
        if (output) {
          ui.log(output);
        }
      }
      process.exit(1);
    });

  return command;
}
