import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { VerifyDatabaseResult } from '@prisma-next/core-control-plane/types';
import { ifDefined } from '@prisma-next/utils/defined';
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
  errorHashMismatch,
  errorMarkerMissing,
  errorRuntime,
  errorTargetMismatch,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  maskConnectionUrl,
  resolveContractPath,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { formatStyledHeader, formatVerifyJson, formatVerifyOutput } from '../utils/output';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface DbVerifyOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
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
        expected: verifyResult.contract.storageHash,
        ...ifDefined('actual', verifyResult.marker?.storageHash),
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
  ui: TerminalUI,
): Promise<Result<VerifyDatabaseResult, CliStructuredError>> {
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
      command: 'db verify',
      description: 'Check whether the database has been signed with your contract',
      url: 'https://pris.ly/db-verify',
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
  setCommandExamples(command, [
    'prisma-next db verify --db $DATABASE_URL',
    'prisma-next db verify --db $DATABASE_URL --json',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: DbVerifyOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeDbVerifyCommand(options, flags, ui);

      const exitCode = handleResult(result, flags, (verifyResult) => {
        if (flags.json) {
          ui.output(formatVerifyJson(verifyResult));
        } else {
          const output = formatVerifyOutput(verifyResult, flags);
          if (output) {
            ui.log(output);
          }
        }
      });
      process.exit(exitCode);
    });

  return command;
}
