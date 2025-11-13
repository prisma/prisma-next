import { resolve } from 'node:path';
import { Command } from 'commander';
import { verifyDatabase } from '../api/verify-database';
import { loadConfig } from '../config-loader';
import type { CliErrorEnvelope } from '../utils/errors';
import { createRtmError, mapErrorToCliEnvelope } from '../utils/errors';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  formatErrorJson,
  formatErrorOutput,
  formatStyledHeader,
  formatSuccessMessage,
  formatVerifyJson,
  formatVerifyOutput,
} from '../utils/output';

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
  const command = new Command('verify')
    .description('Verify database matches emitted contract')
    .allowExcessArguments(false)
    .option('--db <url>', 'Database connection string')
    .option(
      '--config <path>',
      'Path to prisma-next.config.ts (defaults to ./prisma-next.config.ts if present)',
    )
    .option('--json [format]', 'Output as JSON (object or ndjson)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbVerifyOptions) => {
      const flags = parseGlobalFlags(options);

      try {
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
            command: 'db verify',
            description: 'Verify database matches emitted contract',
            url: 'https://pris.ly/db-verify',
            details,
            flags,
          });
          console.log(header);
        }

        const result = await verifyDatabase({
          ...(options.db ? { dbUrl: options.db } : {}),
          ...(options.config ? { configPath: options.config } : {}),
        });

        // Output based on flags
        if (flags.json === 'object') {
          // JSON output to stdout
          console.log(formatVerifyJson(result));
        } else {
          // Human-readable output to stdout
          const output = formatVerifyOutput(result, flags);
          if (output) {
            console.log(output);
          }
          // Output success message if verification passed
          if (result.ok && !flags.quiet) {
            console.log(formatSuccessMessage(flags));
          }
        }

        // If verification failed, throw error with appropriate code
        if (!result.ok && result.code) {
          let errorEnvelope: CliErrorEnvelope;
          if (result.code === 'PN-RTM-3001') {
            errorEnvelope = createRtmError('3001', 'Marker missing', {
              why: 'Contract marker not found in database',
              fix: 'Run `prisma-next db sign --db <url>` to create marker',
            });
          } else if (result.code === 'PN-RTM-3002') {
            errorEnvelope = createRtmError('3002', 'Hash mismatch', {
              why: 'Contract hash does not match database marker',
              fix: 'Migrate database or re-sign if intentional',
            });
          } else if (result.code === 'PN-RTM-3003') {
            errorEnvelope = createRtmError('3003', 'Target mismatch', {
              why: 'Contract target does not match config target',
              fix: 'Align contract target and config target',
            });
          } else {
            errorEnvelope = createRtmError('3000', result.summary, {
              why: 'Verification failed',
              fix: 'Check contract and database state',
            });
          }

          // Output error based on flags
          if (flags.json === 'object') {
            // JSON error to stderr
            console.error(formatErrorJson(errorEnvelope));
          } else {
            // Human-readable error to stderr
            console.error(formatErrorOutput(errorEnvelope, flags));
          }

          // Throw error with exit code attached
          const cliError = new Error(errorEnvelope.summary);
          (cliError as { exitCode?: number }).exitCode = errorEnvelope.exitCode ?? 1;
          throw cliError;
        }
      } catch (error) {
        // Map error to CLI envelope
        const envelope = mapErrorToCliEnvelope(error);

        // Output error based on flags
        if (flags.json === 'object') {
          // JSON error to stderr
          console.error(formatErrorJson(envelope));
        } else {
          // Human-readable error to stderr
          console.error(formatErrorOutput(envelope, flags));
        }

        // Throw error with exit code attached
        const cliError = new Error(envelope.summary);
        (cliError as { exitCode?: number }).exitCode = envelope.exitCode ?? 1;
        throw cliError;
      }
    });

  return command;
}
