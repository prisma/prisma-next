import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emit, loadExtensionPacks } from '@prisma-next/emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';
import { Command } from 'commander';
import { loadContractFromTs } from '../load-ts-contract';

export function createEmitCommand(): Command {
  const command = new Command('emit');

  command
    .description('Emit contract.json and contract.d.ts from a TypeScript contract file')
    .requiredOption('--contract <path>', 'Path to TypeScript contract file')
    .requiredOption('--out <dir>', 'Output directory for emitted artifacts')
    .option('--target <target>', 'Target (default: inferred from contract)')
    .option('--adapter <path>', 'Adapter package path', 'packages/adapter-postgres')
    .option('--extensions <paths...>', 'Extension pack paths (can be specified multiple times)')
    .action(
      async (options: {
        contract: string;
        out: string;
        target?: string;
        adapter?: string;
        extensions?: string | string[];
      }) => {
        try {
          const contractPath = resolve(options.contract);
          const outputDir = resolve(options.out);
          const adapterPath = options.adapter ? resolve(options.adapter) : undefined;
          const extensionPaths: string[] = Array.isArray(options.extensions)
            ? options.extensions.map((p: string) => resolve(p))
            : options.extensions
              ? [resolve(options.extensions)]
              : [];

          const packs = loadExtensionPacks(adapterPath, extensionPaths);

          const contractRaw = await loadContractFromTs(contractPath);

          // Normalize the contract to ensure all required fields are present
          // This ensures consistency between CLI emit and programmatic emit
          const contract = validateContract<SqlContract<SqlStorage>>(contractRaw);

          const targetFamily = sqlTargetFamilyHook;

          // Strip mappings before emitting - mappings are not part of ContractIR
          // They are computed at runtime and should not be persisted to contract.json
          const { mappings: _mappings, ...contractIR } = contract;

          const result = await emit(
            contractIR as unknown as typeof contractRaw,
            {
              outputDir,
              packs,
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
      },
    );

  return command;
}
