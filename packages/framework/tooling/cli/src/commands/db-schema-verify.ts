import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  AdapterDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { verifyDatabaseSchema } from '@prisma-next/core-control-plane/verify-database-schema';
import type { SqlFamilyContext } from '@prisma-next/family-sql/context';
import { createSqlTypeMetadataRegistry } from '@prisma-next/family-sql/type-metadata';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import {
  errorDatabaseUrlRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorRuntime,
  errorUnexpected,
} from '../utils/cli-errors';
import { setCommandDescriptions } from '../utils/command-helpers';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatSchemaVerifyJson,
  formatSchemaVerifyOutput,
  formatStyledHeader,
  formatSuccessMessage,
} from '../utils/output';
import { performAction } from '../utils/result';
import { handleResult } from '../utils/result-handler';

interface DbSchemaVerifyOptions {
  readonly db?: string;
  readonly config?: string;
  readonly strict?: boolean;
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

export function createDbSchemaVerifyCommand(): Command {
  const command = new Command('schema-verify');
  setCommandDescriptions(
    command,
    'Verify database schema satisfies emitted contract',
    'Verifies that the live database schema satisfies the emitted contract. This command\n' +
      'performs catalog-based schema verification independent of the contract marker table.\n' +
      'Reports any missing tables, columns, type mismatches, or constraint issues.',
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
    .option('--strict', 'Enable strict mode (fail on extra schema elements)', false)
    .option('--json [format]', 'Output as JSON (object or ndjson)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbSchemaVerifyOptions) => {
      const flags = parseGlobalFlags(options);

      const result = await performAction(async () => {
        // Load config to get paths for header
        const config = await loadConfig(options.config);
        const configPath = options.config || './prisma-next.config.ts';
        const contractPath = config.contract?.output
          ? resolve(config.contract.output)
          : resolve('src/prisma/contract.json');

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
            command: 'db schema-verify',
            description: 'Verify database schema satisfies emitted contract',
            url: 'https://pris.ly/db-schema-verify',
            details,
            flags,
          });
          console.log(header);
        }

        // Load contract from file (file I/O)
        const contractJsonPath = resolve(contractPath);
        let contractJsonContent: string;
        try {
          contractJsonContent = await readFile(contractJsonPath, 'utf-8');
        } catch (error) {
          if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
            throw errorFileNotFound(contractJsonPath, {
              why: `Contract file not found at ${contractJsonPath}`,
            });
          }
          throw errorUnexpected(error instanceof Error ? error.message : String(error), {
            why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

        // Validate contract using family validator
        const contractIR = config.family.validateContractIR(contractJson);

        // Type guard to ensure contract has required properties
        if (
          typeof contractIR !== 'object' ||
          contractIR === null ||
          !('coreHash' in contractIR) ||
          !('target' in contractIR) ||
          typeof contractIR.coreHash !== 'string' ||
          typeof contractIR.target !== 'string'
        ) {
          throw errorUnexpected('Invalid contract structure', {
            why: 'Contract is missing required fields: coreHash or target',
            fix: 'Re-emit the contract using `prisma-next contract emit`',
          });
        }

        // Resolve database URL
        const dbUrl = options.db ?? config.db?.url;
        if (!dbUrl) {
          throw errorDatabaseUrlRequired({
            why: 'Database URL is required for db schema-verify',
          });
        }

        // Obtain driver: driver is required
        if (!config.driver) {
          throw errorDriverRequired();
        }
        const driver = await config.driver.create(dbUrl);

        const startTime = Date.now();

        try {
          // Build type metadata registry from adapter + extensions
          // This is SQL-specific, so we use the SQL family helper
          // Get adapter instance (either pre-created or create via factory)
          let adapterInstance:
            | {
                profile: { codecs(): CodecRegistry };
              }
            | undefined;
          if (config.adapter.adapter) {
            adapterInstance = config.adapter.adapter as {
              profile: { codecs(): CodecRegistry };
            };
          } else if (config.adapter.create) {
            const created = await config.adapter.create();
            adapterInstance = created as {
              profile: { codecs(): CodecRegistry };
            };
          }

          // Build type metadata registry from adapter codecs
          const codecRegistry = adapterInstance?.profile.codecs();
          const types = createSqlTypeMetadataRegistry([
            ...(codecRegistry ? [{ codecRegistry }] : []),
          ]);

          // Build contextInput (everything except schemaIR)
          const contextInput: Omit<SqlFamilyContext, 'schemaIR'> = {
            types,
          };

          // Call domain action with assembled inputs
          // Cast config descriptors to SqlFamilyContext types since we know this is SQL family
          const verifyResult = await verifyDatabaseSchema<SqlFamilyContext>({
            driver,
            contractIR,
            family: config.family as FamilyDescriptor<SqlFamilyContext>,
            target: config.target as TargetDescriptor<SqlFamilyContext>,
            adapter: config.adapter as AdapterDescriptor<SqlFamilyContext>,
            extensions: (config.extensions ?? []) as ReadonlyArray<
              ExtensionDescriptor<SqlFamilyContext>
            >,
            contextInput,
            strict: options.strict ?? false,
            startTime,
            contractPath: contractJsonPath,
            ...(options.config ? { configPath: options.config } : {}),
          });

          // If verification failed, throw structured error for schema mismatches
          if (!verifyResult.ok && verifyResult.code) {
            if (verifyResult.code === 'PN-SCHEMA-0001') {
              // Schema mismatch - return result as-is, don't throw
              // The formatter will handle displaying the issues
              return verifyResult;
            }
            throw errorRuntime(verifyResult.summary);
          }

          return verifyResult;
        } finally {
          // Ensure driver connection is closed
          await driver.close();
        }
      });

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, (verifyResult) => {
        // Output based on flags
        if (flags.json === 'object') {
          // JSON output to stdout
          console.log(formatSchemaVerifyJson(verifyResult));
        } else {
          // Human-readable output to stdout
          const output = formatSchemaVerifyOutput(verifyResult, flags);
          if (output) {
            console.log(output);
          }
          // Output success message if verification passed
          if (verifyResult.ok && !flags.quiet) {
            console.log(formatSuccessMessage(flags));
          }
        }
      });

      // If verification failed (ok: false), exit with non-zero code
      // This handles the case where performAction returns ok(result) but result.ok is false
      if (result.ok && !result.value.ok) {
        process.exit(1);
        return;
      }

      process.exit(exitCode);
    });

  return command;
}
