import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { emit } from '@prisma-next/emitter';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../pack-assembly';
import { parseGlobalFlags } from '../utils/global-flags';
import { formatStyledHeader, formatSuccessMessage } from '../utils/output';

export function createEmitCommand(): Command {
  const command = new Command('emit');

  command
    .description('Emit contract.json and contract.d.ts from config.contract')
    .option(
      '--config <path>',
      'Path to prisma-next.config.ts (defaults to ./prisma-next.config.ts if present)',
    )
    .action(async (options: { config?: string }) => {
      const flags = parseGlobalFlags({});
      try {
        // Load config (explicit via --config or default)
        const config = await loadConfig(options.config);

        // Resolve contract from config
        if (!config.contract) {
          throw new Error(
            'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ..., types: ... }',
          );
        }

        // Contract config is already normalized by defineConfig() with defaults applied
        const contractConfig = config.contract;

        // Resolve artifact paths (already normalized by defineConfig() with defaults, but resolve relative paths)
        // defineConfig() ensures output and types are always present (defaults applied)
        if (!contractConfig.output || !contractConfig.types) {
          throw new Error(
            'Contract config must have output and types paths. This should not happen if defineConfig() was used.',
          );
        }
        const contractJsonPath = resolve(contractConfig.output);
        const contractDtsPath = resolve(contractConfig.types);

        // Output header
        if (!flags.quiet) {
          const configPath = options.config || './prisma-next.config.ts';
          const header = formatStyledHeader({
            command: 'emit',
            description: 'Write contract artifacts',
            url: 'https://pris.ly/contract-emit',
            details: [
              { label: 'config', value: configPath },
              { label: 'contract', value: contractJsonPath },
              { label: 'types', value: contractDtsPath },
            ],
            flags,
          });
          // eslint-disable-next-line no-console
          console.log(header);
        }

        // Resolve contract source
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
        // This ensures consistency between CLI emit and programmatic emit
        // validateContractIR returns ContractIR without mappings (mappings are runtime-only)
        const contractIR = config.family.validateContractIR(contractWithoutMappings);

        // Validate family is supported (for now, only 'sql' is supported)
        if (config.family.id !== 'sql') {
          throw new Error(
            `Unsupported family '${config.family.id}'; expected 'sql'. Please update your config to use a supported family.`,
          );
        }

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

        // Use family hook from config
        const targetFamily = config.family.hook;

        const result = await emit(
          contractIR as ContractIR,
          {
            outputDir: dirname(contractJsonPath),
            operationRegistry,
            codecTypeImports,
            operationTypeImports,
            extensionIds,
          },
          targetFamily,
        );

        // Create directories if needed
        mkdirSync(dirname(contractJsonPath), { recursive: true });
        mkdirSync(dirname(contractDtsPath), { recursive: true });

        // The emitter already includes _generated metadata in both contractJson and contractDts
        // Just write the results directly
        writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
        writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

        // eslint-disable-next-line no-console
        console.log(`✓ Emitted contract.json to ${contractJsonPath}`);
        // eslint-disable-next-line no-console
        console.log(`✓ Emitted contract.d.ts to ${contractDtsPath}`);
        // eslint-disable-next-line no-console
        console.log(`  coreHash: ${result.coreHash}`);
        // eslint-disable-next-line no-console
        console.log(`  profileHash: ${result.profileHash}`);
        // Output success message
        if (!flags.quiet) {
          // eslint-disable-next-line no-console
          console.log(formatSuccessMessage(flags));
        }
      } catch (error) {
        if (error instanceof Error) {
          // eslint-disable-next-line no-console
          console.error(`Error: ${error.message}`);
        }
        // Let commander.js handle the error (it will exit with code 1)
        throw error;
      }
    });

  return command;
}
