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
import { mapErrorToCliEnvelope } from '../utils/errors';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  formatEmitJson,
  formatEmitOutput,
  formatErrorJson,
  formatErrorOutput,
} from '../utils/output';

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
    .description('Emit contract.json and contract.d.ts from config.contract')
    .allowExcessArguments(false)
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
    .action(async (options: ContractEmitOptions) => {
      const flags = parseGlobalFlags(options);

      try {
        // Load config
        const config = await loadConfig(options.config);

        // Resolve contract from config
        if (!config.contract) {
          throw new Error(
            'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ..., types: ... }',
          );
        }

        // Contract config is already normalized by defineConfig() with defaults applied
        const contractConfig = config.contract;

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

        // Resolve artifact paths from config (already normalized by defineConfig() with defaults)
        if (!contractConfig.output || !contractConfig.types) {
          throw new Error(
            'Contract config must have output and types paths. This should not happen if defineConfig() was used.',
          );
        }
        const outputJsonPath = resolve(contractConfig.output);
        const outputDtsPath = resolve(contractConfig.types);

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
        const result = await emitContract({
          contractIR,
          outputJsonPath,
          outputDtsPath,
          targetFamily: config.family.hook,
          operationRegistry,
          codecTypeImports,
          operationTypeImports,
          extensionIds,
        });

        // Output based on flags
        if (flags.json === 'object') {
          // JSON output to stdout
          console.log(formatEmitJson(result));
        } else {
          // Human-readable output to stdout
          const output = formatEmitOutput(result, flags);
          if (output) {
            console.log(output);
          }
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
        // Commander.js will use exitOverride to handle custom exit codes
        const cliError = new Error(envelope.summary);
        (cliError as { exitCode?: number }).exitCode = envelope.exitCode ?? 1;
        throw cliError;
      }
    });

  return command;
}
