import { readFile } from 'node:fs/promises';
import type {
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { relative, resolve } from 'pathe';
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
import { formatStyledHeader } from '../utils/formatters/styled';
import {
  type DbVerifyCommandSuccessResult,
  formatSchemaVerifyJson,
  formatSchemaVerifyOutput,
  formatVerifyJson,
  formatVerifyOutput,
} from '../utils/formatters/verify';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface DbVerifyOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly shallow?: boolean;
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

type DbVerifyFailure = CliStructuredError | VerifyDatabaseSchemaResult;

/**
 * Executes the db verify command and returns a structured Result.
 */
async function executeDbVerifyCommand(
  options: DbVerifyOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<DbVerifyCommandSuccessResult, DbVerifyFailure>> {
  const startTime = Date.now();

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
      {
        label: 'mode',
        value: options.shallow ? 'shallow (marker only)' : 'full (marker + schema)',
      },
    ];
    if (options.db) {
      details.push({ label: 'database', value: maskConnectionUrl(options.db) });
    }
    const header = formatStyledHeader({
      command: 'db verify',
      description: 'Check whether the database signature and live schema match your contract',
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
        commandName: 'db verify',
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
  const onProgress = createProgressAdapter({ ui, flags });

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

    if (options.shallow) {
      return ok({
        ok: true,
        mode: 'shallow',
        summary: 'Database marker matches contract',
        contract: verifyResult.contract,
        marker: verifyResult.marker,
        target: verifyResult.target,
        ...ifDefined('missingCodecs', verifyResult.missingCodecs),
        ...ifDefined('codecCoverageSkipped', verifyResult.codecCoverageSkipped),
        warning:
          'Schema verification skipped because --shallow was provided. Run `prisma-next db schema-verify` to detect structural drift.',
        meta: {
          ...(verifyResult.meta ?? {}),
          schemaVerification: 'skipped',
        },
        timings: { total: Date.now() - startTime },
      });
    }

    const schemaVerifyResult = await client.schemaVerify({
      contractIR: contractJson,
      strict: false,
      onProgress,
    });

    if (!schemaVerifyResult.ok) {
      return notOk(schemaVerifyResult);
    }

    return ok({
      ok: true,
      mode: 'full',
      summary: 'Database signature and schema match contract',
      contract: verifyResult.contract,
      marker: verifyResult.marker,
      target: verifyResult.target,
      ...ifDefined('missingCodecs', verifyResult.missingCodecs),
      ...ifDefined('codecCoverageSkipped', verifyResult.codecCoverageSkipped),
      schema: {
        summary: schemaVerifyResult.summary,
        counts: schemaVerifyResult.schema.counts,
        strict: schemaVerifyResult.meta?.strict ?? false,
      },
      meta: {
        ...(verifyResult.meta ?? {}),
        schemaVerification: 'performed',
      },
      timings: { total: Date.now() - startTime },
    });
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
    'Check whether the database signature and live schema match your contract',
    'Verifies the database marker first, then runs tolerant structural schema verification to\n' +
      'catch drift such as manual DDL changes. Use `--shallow` to skip the schema check and accept\n' +
      'marker-only verification.',
  );
  setCommandExamples(command, [
    'prisma-next db verify --db $DATABASE_URL',
    'prisma-next db verify --db $DATABASE_URL --shallow',
    'prisma-next db verify --db $DATABASE_URL --json',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--shallow', 'Skip structural schema verification and only check the database marker')
    .action(async (options: DbVerifyOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeDbVerifyCommand(options, flags, ui);

      if (result.ok) {
        if (flags.json) {
          ui.output(formatVerifyJson(result.value));
        } else {
          const output = formatVerifyOutput(result.value, flags);
          if (output) {
            ui.log(output);
          }
        }
        process.exit(0);
      }

      if (CliStructuredError.is(result.failure)) {
        const exitCode = handleResult(result as Result<never, CliStructuredError>, flags, ui);
        process.exit(exitCode);
      }

      if (flags.json) {
        ui.output(formatSchemaVerifyJson(result.failure));
      } else {
        const output = formatSchemaVerifyOutput(result.failure, flags);
        if (output) {
          ui.log(output);
        }
      }
      process.exit(1);
    });

  return command;
}
