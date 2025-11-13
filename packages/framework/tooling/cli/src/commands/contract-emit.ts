import { resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { Command } from 'commander';
import { emitContract } from '../api/emit-contract';
import { loadConfig } from '../config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../pack-assembly';
import { errorContractConfigMissing } from '../utils/cli-errors';
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
  const command = new Command('emit')
    .description(
      'Emit signed contract artifacts\n' +
        'Reads your contract source (TypeScript or Prisma schema) and emits contract.json and\n' +
        'contract.d.ts. The contract.json contains the canonical contract structure, and\n' +
        'contract.d.ts provides TypeScript types for type-safe query building.',
    )
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

        // Build descriptors array for assembly
        const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];

        // Use framework CLI assembly functions (loops over descriptors, delegates to family for conversion)
        const operationRegistry = assembleOperationRegistry(descriptors, config.family);
        const codecTypeImports = extractCodecTypeImports(descriptors);
        const operationTypeImports = extractOperationTypeImports(descriptors);
        const extensionIds = extractExtensionIds(
          config.adapter,
          config.target,
          config.extensions ?? [],
        );

        // Call programmatic API with resolved values
        const emitResult = await emitContract({
          contractIR,
          outputJsonPath,
          outputDtsPath,
          targetFamily: config.family.hook,
          operationRegistry,
          codecTypeImports,
          operationTypeImports,
          extensionIds,
        });

        return emitResult;
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
