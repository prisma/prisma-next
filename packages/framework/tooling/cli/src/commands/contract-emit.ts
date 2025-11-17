import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { errorContractConfigMissing } from '@prisma-next/core-control-plane/errors';
import type { FamilyInstance } from '@prisma-next/core-control-plane/types';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { setCommandDescriptions } from '../utils/command-helpers';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatEmitJson,
  formatEmitOutput,
  formatStyledHeader,
  formatSuccessMessage,
} from '../utils/output';
import { performAction } from '../utils/result';
import { handleResult } from '../utils/result-handler';

interface ContractEmitOptions {
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

export function createContractEmitCommand(): Command {
  const command = new Command('emit');
  setCommandDescriptions(
    command,
    'Emit signed contract artifacts',
    'Reads your contract source (TypeScript or Prisma schema) and emits contract.json and\n' +
      'contract.d.ts. The contract.json contains the canonical contract structure, and\n' +
      'contract.d.ts provides TypeScript types for type-safe query building.',
  );
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const flags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags });
      },
    })
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--json [format]', 'Output as JSON (object or ndjson)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: ContractEmitOptions) => {
      const flags = parseGlobalFlags(options);

      const result = await performAction(async () => {
        // Load config
        const config = await loadConfig(options.config);

        // Resolve contract from config
        if (!config.contract) {
          throw errorContractConfigMissing({
            why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ..., types: ... }',
          });
        }

        // Contract config is already normalized by defineConfig() with defaults applied
        const contractConfig = config.contract;

        // Resolve artifact paths from config (already normalized by defineConfig() with defaults)
        if (!contractConfig.output || !contractConfig.types) {
          throw errorContractConfigMissing({
            why: 'Contract config must have output and types paths. This should not happen if defineConfig() was used.',
          });
        }
        const outputJsonPath = resolve(contractConfig.output);
        const outputDtsPath = resolve(contractConfig.types);

        // Output header (only for human-readable output)
        if (flags.json !== 'object' && !flags.quiet) {
          const configPath = options.config || './prisma-next.config.ts';
          const header = formatStyledHeader({
            command: 'contract emit',
            description: 'Write contract artifacts',
            url: 'https://pris.ly/contract-emit',
            details: [
              { label: 'config', value: configPath },
              { label: 'contract', value: outputJsonPath },
              { label: 'types', value: outputDtsPath },
            ],
            flags,
          });
          console.log(header);
        }

        // Resolve contract source from config (user's config handles loading)
        let contractRaw: unknown;
        if (typeof contractConfig.source === 'function') {
          contractRaw = await contractConfig.source();
        } else {
          contractRaw = contractConfig.source;
        }

        // Strip mappings if family provides stripMappings function
        const contractWithoutMappings = config.family.stripMappings
          ? config.family.stripMappings(contractRaw)
          : contractRaw;

        // Validate and normalize the contract using family-specific validation
        const contractIR = config.family.validateContractIR(contractWithoutMappings) as ContractIR;

        // Create family instance (assembles operation registry, type imports, extension IDs)
        const familyInstance = config.family.create({
          target: config.target,
          adapter: config.adapter,
          extensions: config.extensions ?? [],
        }) as FamilyInstance<string, unknown, unknown, unknown>;

        // Call emitContract on family instance (returns strings, no file I/O)
        const emitResult = await familyInstance.emitContract({ contractIR });

        // Create directories if needed
        mkdirSync(dirname(outputJsonPath), { recursive: true });
        mkdirSync(dirname(outputDtsPath), { recursive: true });

        // Write the results to files
        writeFileSync(outputJsonPath, emitResult.contractJson, 'utf-8');
        writeFileSync(outputDtsPath, emitResult.contractDts, 'utf-8');

        // Return result with file paths for output formatting
        return {
          coreHash: emitResult.coreHash,
          profileHash: emitResult.profileHash,
          outDir: dirname(outputJsonPath),
          files: {
            json: outputJsonPath,
            dts: outputDtsPath,
          },
          timings: {
            total: 0, // Timing is handled by emitContract internally if needed
          },
        };
      });

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, (emitResult) => {
        // Output based on flags
        if (flags.json === 'object') {
          // JSON output to stdout
          console.log(formatEmitJson(emitResult));
        } else {
          // Human-readable output to stdout
          const output = formatEmitOutput(emitResult, flags);
          if (output) {
            console.log(output);
          }
          // Output success message
          if (!flags.quiet) {
            console.log(formatSuccessMessage(flags));
          }
        }
      });
      process.exit(exitCode);
    });

  return command;
}
