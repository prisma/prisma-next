import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emit } from '@prisma-next/emitter';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { loadContractFromTs } from '../load-ts-contract';

export function createEmitCommand(): Command {
  const command = new Command('emit');

  command
    .description('Emit contract.json and contract.d.ts from a TypeScript contract file')
    .requiredOption('--contract <path>', 'Path to TypeScript contract file')
    .requiredOption('--out <dir>', 'Output directory for emitted artifacts')
    .option(
      '--config <path>',
      'Path to prisma-next.config.ts (defaults to ./prisma-next.config.ts if present)',
    )
    .action(async (options: { contract: string; out: string; config?: string }) => {
      try {
        const contractPath = resolve(options.contract);
        const outputDir = resolve(options.out);

        // Load config (explicit via --config or default)
        const config = await loadConfig(options.config);

        // Validate family is supported (for now, only 'sql' is supported)
        if (config.family.id !== 'sql') {
          throw new Error(
            `Unsupported family '${config.family.id}'; expected 'sql'. Please update your config to use a supported family.`,
          );
        }

        // Build descriptors array for family helpers
        const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];

        // Use family helpers to assemble registry and extract imports
        const operationRegistry = config.family.assembleOperationRegistry(descriptors);
        const codecTypeImports = config.family.extractCodecTypeImports(descriptors);
        const operationTypeImports = config.family.extractOperationTypeImports(descriptors);

        // Build extensionIds in deterministic order: [adapter.id, target.id, ...extensions.map(e => e.id)]
        // Deduplicates while preserving stable order
        const extensionIds = (() => {
          const ids: string[] = [];
          const seen = new Set<string>();

          // Add adapter first
          if (!seen.has(config.adapter.id)) {
            ids.push(config.adapter.id);
            seen.add(config.adapter.id);
          }

          // Add target second
          if (!seen.has(config.target.id)) {
            ids.push(config.target.id);
            seen.add(config.target.id);
          }

          // Add extensions in order
          for (const ext of config.extensions ?? []) {
            if (!seen.has(ext.id)) {
              ids.push(ext.id);
              seen.add(ext.id);
            }
          }

          return ids;
        })();

        const contractRaw = await loadContractFromTs(contractPath);

        // Validate and normalize the contract using family-specific validation
        // This ensures consistency between CLI emit and programmatic emit
        // validateContractIR returns ContractIR without mappings (mappings are runtime-only)
        const contractIR = config.family.validateContractIR(contractRaw);

        // Use family hook from config
        const targetFamily = config.family.hook;

        const result = await emit(
          contractIR as unknown as typeof contractRaw,
          {
            outputDir,
            operationRegistry,
            codecTypeImports,
            operationTypeImports,
            extensionIds,
          },
          targetFamily,
        );

        mkdirSync(outputDir, { recursive: true });

        const contractJsonPath = join(outputDir, 'contract.json');
        const contractDtsPath = join(outputDir, 'contract.d.ts');

        // The emitter already includes _generated metadata in both contractJson and contractDts
        // Just write the results directly
        writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
        writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

        // eslint-disable-next-line no-undef
        console.log(`✓ Emitted contract.json to ${contractJsonPath}`);
        // eslint-disable-next-line no-undef
        console.log(`✓ Emitted contract.d.ts to ${contractDtsPath}`);
        // eslint-disable-next-line no-undef
        console.log(`  coreHash: ${result.coreHash}`);
        if (result.profileHash) {
          // eslint-disable-next-line no-undef
          console.log(`  profileHash: ${result.profileHash}`);
        }
      } catch (error) {
        if (error instanceof Error) {
          // eslint-disable-next-line no-undef
          console.error(`Error: ${error.message}`);
          // eslint-disable-next-line no-undef
          process.exit(1);
        }
        throw error;
      }
    });

  return command;
}
