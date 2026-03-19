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
  readonly schemaOnly?: boolean;
  readonly strict?: boolean;
}

type DbVerifyMode = 'full' | 'shallow' | 'schema-only';

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

function errorInvalidVerifyMode(options: {
  readonly why: string;
  readonly fix: string;
}): CliStructuredError {
  return new CliStructuredError('4012', 'Invalid verify mode', {
    domain: 'CLI',
    why: options.why,
    fix: options.fix,
    docsUrl: 'https://pris.ly/db-verify',
  });
}

function resolveDbVerifyMode(options: DbVerifyOptions): Result<DbVerifyMode, CliStructuredError> {
  if (options.shallow && options.schemaOnly) {
    return notOk(
      errorInvalidVerifyMode({
        why: '`--shallow` and `--schema-only` cannot be used together',
        fix: 'Choose one mode: omit both for marker + schema verification, use `--shallow` for marker-only verification, or use `--schema-only` for structural verification without marker checks.',
      }),
    );
  }

  if (options.shallow && options.strict) {
    return notOk(
      errorInvalidVerifyMode({
        why: '`--strict` requires structural schema verification, but `--shallow` skips it',
        fix: 'Remove `--strict`, or use `db verify` / `db verify --schema-only` when you want strict schema verification.',
      }),
    );
  }

  if (options.schemaOnly) {
    return ok('schema-only');
  }

  if (options.shallow) {
    return ok('shallow');
  }

  return ok('full');
}

function formatDbVerifyModeLabel(mode: DbVerifyMode, strict: boolean): string {
  if (mode === 'shallow') {
    return 'shallow (marker only)';
  }

  if (mode === 'schema-only') {
    return `schema only (${strict ? 'strict' : 'tolerant'})`;
  }

  return `full (marker + schema, ${strict ? 'strict' : 'tolerant'})`;
}

function formatDbVerifyInvocation(mode: DbVerifyMode, strict: boolean): string {
  const args = ['db verify'];

  if (mode === 'shallow') {
    args.push('--shallow');
  }

  if (mode === 'schema-only') {
    args.push('--schema-only');
  }

  if (strict) {
    args.push('--strict');
  }

  return args.join(' ');
}

function createDbVerifyConnectionRequiredError(options: {
  readonly configPath: string;
  readonly mode: DbVerifyMode;
  readonly strict: boolean;
}): CliStructuredError {
  const invocation = formatDbVerifyInvocation(options.mode, options.strict);
  return errorDatabaseConnectionRequired({
    why: `Database connection is required for ${invocation} (set db.connection in ${options.configPath}, or pass --db <url>)`,
    retryCommand: `prisma-next ${invocation} --db <url>`,
  });
}

function createSchemaOnlyHeaderDetails(options: {
  readonly configPath: string;
  readonly contractPath: string;
  readonly db?: string;
  readonly strict: boolean;
}): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string }> = [
    { label: 'config', value: options.configPath },
    { label: 'contract', value: options.contractPath },
    { label: 'mode', value: formatDbVerifyModeLabel('schema-only', options.strict) },
  ];

  if (options.db) {
    details.push({ label: 'database', value: maskConnectionUrl(options.db) });
  }

  return details;
}

/**
 * Executes the db verify command and returns a structured Result.
 */
async function executeDbVerifyCommand(
  options: DbVerifyOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  mode: Extract<DbVerifyMode, 'full' | 'shallow'>,
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
        value: formatDbVerifyModeLabel(mode, options.strict ?? false),
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
      createDbVerifyConnectionRequiredError({
        configPath,
        mode,
        strict: options.strict ?? false,
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

    if (mode === 'shallow') {
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
          'Schema verification skipped because --shallow was provided. Run `prisma-next db verify --schema-only` to detect structural drift.',
        meta: {
          ...(verifyResult.meta ?? {}),
          schemaVerification: 'skipped',
        },
        timings: { total: Date.now() - startTime },
      });
    }

    const schemaVerifyResult = await client.schemaVerify({
      contractIR: contractJson,
      strict: options.strict ?? false,
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

async function executeDbSchemaOnlyVerifyCommand(
  options: DbVerifyOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<VerifyDatabaseSchemaResult, CliStructuredError>> {
  // Load config
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';
  const contractPathAbsolute = resolveContractPath(config);
  const contractPath = relative(process.cwd(), contractPathAbsolute);

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'db verify',
      description: 'Check whether the live database schema matches your contract',
      url: 'https://pris.ly/db-verify',
      details: createSchemaOnlyHeaderDetails({
        configPath,
        contractPath,
        db: options.db,
        strict: options.strict ?? false,
      }),
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

  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      createDbVerifyConnectionRequiredError({
        configPath,
        mode: 'schema-only',
        strict: options.strict ?? false,
      }),
    );
  }

  if (!config.driver) {
    return notOk(
      errorDriverRequired({ why: 'Config.driver is required for db verify --schema-only' }),
    );
  }

  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks ?? [],
  });

  const onProgress = createProgressAdapter({ ui, flags });

  try {
    const schemaVerifyResult = await client.schemaVerify({
      contractIR: contractJson,
      strict: options.strict ?? false,
      connection: dbConnection,
      onProgress,
    });

    return ok(schemaVerifyResult);
  } catch (error) {
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

    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during db verify --schema-only: ${error instanceof Error ? error.message : String(error)}`,
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
    'Verifies the database marker first, then runs structural schema verification to catch drift\n' +
      'such as manual DDL changes. Use `--shallow` for marker-only verification, `--schema-only`\n' +
      'to skip marker checks and inspect only the live schema, and `--strict` to fail on extra\n' +
      'schema elements when schema verification runs.',
  );
  setCommandExamples(command, [
    'prisma-next db verify --db $DATABASE_URL',
    'prisma-next db verify --db $DATABASE_URL --strict',
    'prisma-next db verify --db $DATABASE_URL --schema-only',
    'prisma-next db verify --db $DATABASE_URL --schema-only --strict',
    'prisma-next db verify --db $DATABASE_URL --shallow',
    'prisma-next db verify --db $DATABASE_URL --json',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--shallow', 'Skip structural schema verification and only check the database marker')
    .option(
      '--schema-only',
      'Skip marker verification and only check whether the live schema satisfies the contract',
    )
    .option('--strict', 'Strict mode: extra schema elements cause failures', false)
    .action(async (options: DbVerifyOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const modeResult = resolveDbVerifyMode(options);
      if (!modeResult.ok) {
        const exitCode = handleResult(modeResult as Result<never, CliStructuredError>, flags, ui);
        process.exit(exitCode);
      }

      const mode = modeResult.value;

      if (mode === 'schema-only') {
        const result = await executeDbSchemaOnlyVerifyCommand(options, flags, ui);
        const exitCode = handleResult(result, flags, ui, (schemaVerifyResult) => {
          if (flags.json) {
            ui.output(formatSchemaVerifyJson(schemaVerifyResult));
          } else {
            const output = formatSchemaVerifyOutput(schemaVerifyResult, flags);
            if (output) {
              ui.log(output);
            }
          }
        });

        if (result.ok && !result.value.ok) {
          process.exit(1);
        }

        process.exit(exitCode);
      }

      const result = await executeDbVerifyCommand(options, flags, ui, mode);

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
        // Always show schema-drift failures, even in quiet mode — exiting 1 without
        // diagnostics is unhelpful.
        const output = formatSchemaVerifyOutput(result.failure, { ...flags, quiet: false });
        if (output) {
          ui.log(output);
        }
      }
      process.exit(1);
    });

  return command;
}
