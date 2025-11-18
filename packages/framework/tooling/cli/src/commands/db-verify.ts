import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import {
  errorDatabaseUrlRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorHashMismatch,
  errorMarkerMissing,
  errorRuntime,
  errorTargetMismatch,
  errorUnexpected,
} from '@prisma-next/core-control-plane/errors';
import type { FamilyInstance, VerifyDatabaseResult } from '@prisma-next/core-control-plane/types';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { setCommandDescriptions } from '../utils/command-helpers';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatStyledHeader,
  formatVerifyJson,
  formatVerifyOutput,
} from '../utils/output';
import { performAction } from '../utils/result';
import { handleResult } from '../utils/result-handler';
import { withSpinner } from '../utils/spinner';

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

export function createDbVerifyCommand(): Command {
  const command = new Command('verify');
  setCommandDescriptions(
    command,
    'Check the database satisfies your contract',
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
    .option('--json [format]', 'Output as JSON (object or ndjson)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbVerifyOptions) => {
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
            command: 'db verify',
            description: 'Verify database matches emitted contract',
            url: 'https://pris.ly/db-verify',
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
        const driver = await withSpinner(() => driverDescriptor.create(dbUrl), {
          message: 'Connecting to database...',
          flags,
        });

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

          // Call family instance verify method
          let verifyResult: VerifyDatabaseResult;
          try {
            verifyResult = (await withSpinner(
              () =>
                typedFamilyInstance.verify({
                  driver,
                  contractIR,
                  expectedTargetId: config.target.targetId,
                  contractPath: contractPathAbsolute,
                  configPath,
                }),
              {
                message: 'Verifying database schema...',
                flags,
              },
            )) as VerifyDatabaseResult;
          } catch (error) {
            // Wrap errors from verify() in structured error
            throw errorUnexpected(error instanceof Error ? error.message : String(error), {
              why: `Failed to verify database: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          // If verification failed, throw structured error
          if (!verifyResult.ok && verifyResult.code) {
            if (verifyResult.code === 'PN-RTM-3001') {
              throw errorMarkerMissing();
            }
            if (verifyResult.code === 'PN-RTM-3002') {
              throw errorHashMismatch({
                expected: verifyResult.contract.coreHash,
                ...(verifyResult.marker?.coreHash ? { actual: verifyResult.marker.coreHash } : {}),
              });
            }
            if (verifyResult.code === 'PN-RTM-3003') {
              throw errorTargetMismatch(
                verifyResult.target.expected,
                verifyResult.target.actual ?? 'unknown',
              );
            }
            throw errorRuntime(verifyResult.summary);
          }

          // Add blank line after all async operations if spinners were shown
          if (!flags.quiet && flags.json !== 'object' && process.stdout.isTTY) {
            console.log('');
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
          console.log(formatVerifyJson(verifyResult));
        } else {
          // Human-readable output to stdout
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
