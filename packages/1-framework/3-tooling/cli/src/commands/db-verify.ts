import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { VerifyDatabaseResult } from '@prisma-next/core-control-plane/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader.ts';
import { createControlClient } from '../control-api/client.ts';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorHashMismatch,
  errorJsonFormatNotSupported,
  errorMarkerMissing,
  errorRuntime,
  errorTargetMismatch,
  errorUnexpected,
} from '../utils/cli-errors.ts';
import { setCommandDescriptions } from '../utils/command-helpers.ts';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags.ts';
import {
  formatCommandHelp,
  formatStyledHeader,
  formatVerifyJson,
  formatVerifyOutput,
} from '../utils/output.ts';
import { createProgressAdapter } from '../utils/progress-adapter.ts';
import { handleResult } from '../utils/result-handler.ts';

interface DbVerifyOptions {
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

/**
 * Maps a VerifyDatabaseResult failure to a CliStructuredError.
 */
function mapVerifyFailure(verifyResult: VerifyDatabaseResult): CliStructuredError {
  if (!verifyResult.ok && verifyResult.code) {
    if (verifyResult.code === 'PN-RTM-3001') {
      return errorMarkerMissing();
    }
    if (verifyResult.code === 'PN-RTM-3002') {
      return errorHashMismatch({
        expected: verifyResult.contract.coreHash,
        ...(verifyResult.marker?.coreHash ? { actual: verifyResult.marker.coreHash } : {}),
      });
    }
    if (verifyResult.code === 'PN-RTM-3003') {
      return errorTargetMismatch(
        verifyResult.target.expected,
        verifyResult.target.actual ?? 'unknown',
      );
    }
    // Unknown code - fall through to runtime error
  }
  return errorRuntime(verifyResult.summary);
}

/**
 * Executes the db verify command and returns a structured Result.
 */
async function executeDbVerifyCommand(
  options: DbVerifyOptions,
  flags: GlobalFlags,
): Promise<Result<VerifyDatabaseResult, CliStructuredError>> {
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
      command: 'db verify',
      description: 'Check whether the database has been signed with your contract',
      url: 'https://pris.ly/db-verify',
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
        why: `Database connection is required for db verify (set db.connection in ${configPath}, or pass --db <url>)`,
      }),
    );
  }

  // Check for driver
  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for db verify' }));
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
    const verifyResult = await client.verify({
      contractIR: contractJson,
      connection: dbConnection,
      onProgress,
    });

    // Add blank line after all async operations if spinners were shown
    if (!flags.quiet && flags.json !== 'object' && process.stdout.isTTY) {
      console.log('');
    }

    // If verification failed, map to CLI structured error
    if (!verifyResult.ok) {
      return notOk(mapVerifyFailure(verifyResult));
    }

    return ok(verifyResult);
  } catch (error) {
    // Driver already throws CliStructuredError for connection failures
    if (error instanceof CliStructuredError) {
      return notOk(error);
    }

    // Wrap unexpected errors
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during db verify: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createDbVerifyCommand(): Command {
  const command = new Command('verify');
  setCommandDescriptions(
    command,
    'Check whether the database has been signed with your contract',
    'Verifies that your database schema matches the emitted contract. Checks table structures,\n' +
      'column types, constraints, and codec coverage. Reports any mismatches or missing codecs.',
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
    .action(async (options: DbVerifyOptions) => {
      const flags = parseGlobalFlags(options);

      // Validate JSON format option
      if (flags.json === 'ndjson') {
        const result = notOk(
          errorJsonFormatNotSupported({
            command: 'db verify',
            format: 'ndjson',
            supportedFormats: ['object'],
          }),
        );
        const exitCode = handleResult(result, flags);
        process.exit(exitCode);
      }

      const result = await executeDbVerifyCommand(options, flags);

      const exitCode = handleResult(result, flags, (verifyResult) => {
        if (flags.json === 'object') {
          console.log(formatVerifyJson(verifyResult));
        } else {
          const output = formatVerifyOutput(verifyResult, flags);
          if (output) {
            console.log(output);
          }
        }
      });
      process.exit(exitCode);
    });

  return command;
}
