import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import {
  errorDatabaseUrlRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorRuntime,
  errorUnexpected,
} from '@prisma-next/core-control-plane/errors';
import type {
  FamilyInstance,
  SignDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { setCommandDescriptions } from '../utils/command-helpers';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatSchemaVerifyJson,
  formatSchemaVerifyOutput,
  formatSignJson,
  formatSignOutput,
  formatStyledHeader,
} from '../utils/output';
import { performAction } from '../utils/result';
import { handleResult } from '../utils/result-handler';
import { withSpinner } from '../utils/spinner';

interface DbSignOptions {
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

export function createDbSignCommand(): Command {
  const command = new Command('sign');
  setCommandDescriptions(
    command,
    'Sign the database with your contract so you can safely run queries',
    'Verifies that your database schema satisfies the emitted contract, and if so, writes or\n' +
      'updates the contract marker in the database. This command is idempotent and safe to run\n' +
      'in CI/deployment pipelines. The marker records that this database instance is aligned\n' +
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
    .option('--json [format]', 'Output as JSON (object or ndjson)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbSignOptions) => {
      const flags = parseGlobalFlags(options);

      const result = await performAction(async () => {
        // Load config (file I/O)
        const config = await loadConfig(options.config);
        // Normalize config path for display (match contract path format - no ./ prefix)
        const configPath = options.config
          ? relative(process.cwd(), resolve(options.config))
          : 'prisma-next.config.ts';
        const contractPathAbsolute = config.contract?.output
          ? resolve(config.contract.output)
          : resolve('src/prisma/contract.json');
        // Convert to relative path for display
        const contractPath = relative(process.cwd(), contractPathAbsolute);

        // Output header (only for human-readable output)
        if (flags.json !== 'object' && !flags.quiet) {
          const details: Array<{ label: string; value: string }> = [
            { label: 'config', value: configPath },
            { label: 'contract', value: contractPath },
          ];
          if (options.db) {
            details.push({ label: 'database', value: options.db });
          }
          const header = formatStyledHeader({
            command: 'db sign',
            description: 'Sign the database with your contract so you can safely run queries',
            url: 'https://pris.ly/db-sign',
            details,
            flags,
          });
          console.log(header);
        }

        // Load contract file (file I/O)
        let contractJsonContent: string;
        try {
          contractJsonContent = await readFile(contractPathAbsolute, 'utf-8');
        } catch (error) {
          if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
            throw errorFileNotFound(contractPathAbsolute, {
              why: `Contract file not found at ${contractPathAbsolute}`,
            });
          }
          throw errorUnexpected(error instanceof Error ? error.message : String(error), {
            why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

        // Resolve database URL
        const dbUrl = options.db ?? config.db?.url;
        if (!dbUrl) {
          throw errorDatabaseUrlRequired();
        }

        // Check for driver
        if (!config.driver) {
          throw errorDriverRequired();
        }

        // Store driver descriptor after null check
        const driverDescriptor = config.driver;

        // Create driver
        const driver = await driverDescriptor.create(dbUrl);

        try {
          // Create family instance
          const familyInstance = config.family.create({
            target: config.target,
            adapter: config.adapter,
            driver: driverDescriptor,
            extensions: config.extensions ?? [],
          });
          const typedFamilyInstance = familyInstance as FamilyInstance<string>;

          // Validate contract using instance validator
          const contractIR = typedFamilyInstance.validateContractIR(contractJson) as ContractIR;

          // Schema verification precondition with spinner
          let schemaVerifyResult: VerifyDatabaseSchemaResult;
          try {
            schemaVerifyResult = await withSpinner(
              async () => {
                return (await typedFamilyInstance.schemaVerify({
                  driver,
                  contractIR,
                  strict: false,
                  contractPath: contractPathAbsolute,
                  configPath,
                })) as VerifyDatabaseSchemaResult;
              },
              {
                message: 'Verifying database satisfies contract',
                flags,
              },
            );
          } catch (error) {
            // Wrap errors from schemaVerify() in structured error
            throw errorRuntime(error instanceof Error ? error.message : String(error), {
              why: `Failed to verify database schema: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          // If schema verification failed, return both results for handling outside performAction
          if (!schemaVerifyResult.ok) {
            return { schemaVerifyResult, signResult: undefined };
          }

          // Schema verification passed - proceed with signing
          let signResult: SignDatabaseResult;
          try {
            signResult = (await typedFamilyInstance.sign({
              driver,
              contractIR,
              contractPath: contractPathAbsolute,
              configPath,
            })) as SignDatabaseResult;
          } catch (error) {
            // Wrap errors from sign() in structured error
            throw errorRuntime(error instanceof Error ? error.message : String(error), {
              why: `Failed to sign database: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          return { schemaVerifyResult: undefined, signResult };
        } finally {
          // Ensure driver connection is closed
          await driver.close();
        }
      });

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, (value) => {
        const { schemaVerifyResult, signResult } = value;

        // If schema verification failed, format and print schema verification output
        if (schemaVerifyResult && !schemaVerifyResult.ok) {
          if (flags.json === 'object') {
            console.log(formatSchemaVerifyJson(schemaVerifyResult));
          } else {
            const output = formatSchemaVerifyOutput(schemaVerifyResult, flags);
            if (output) {
              console.log(output);
            }
          }
          // Don't proceed to sign output formatting
          return;
        }

        // Schema verification passed - format sign output
        if (signResult) {
          if (flags.json === 'object') {
            console.log(formatSignJson(signResult));
          } else {
            const output = formatSignOutput(signResult, flags);
            if (output) {
              console.log(output);
            }
          }
        }
      });

      // For logical schema mismatches, check if schema verification passed
      // Infra errors already handled by handleResult (returns non-zero exit code)
      if (result.ok && result.value.schemaVerifyResult && !result.value.schemaVerifyResult.ok) {
        // Schema verification failed - exit with code 1
        process.exit(1);
      } else {
        // Success or infra error - use exit code from handleResult
        process.exit(exitCode);
      }
    });

  return command;
}
