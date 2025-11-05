import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emit, loadExtensionPacks, targetFamilyRegistry } from '@prisma-next/emitter';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';
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
    .action(async (options: {
      contract: string;
      out: string;
      target?: string;
      adapter?: string;
      extensions?: string | string[];
    }) => {
      try {
        if (!targetFamilyRegistry.has('sql')) {
          targetFamilyRegistry.register(sqlTargetFamilyHook);
        }

        const contractPath = resolve(options.contract);
        const outputDir = resolve(options.out);
        const adapterPath = options.adapter ? resolve(options.adapter) : undefined;
        const extensionPaths: string[] = Array.isArray(options.extensions)
          ? options.extensions.map((p: string) => resolve(p))
          : options.extensions
            ? [resolve(options.extensions)]
            : [];

        const packs = loadExtensionPacks(adapterPath, extensionPaths);

        const contract = await loadContractFromTs(contractPath);

        const result = await emit(contract, {
          outputDir,
          packs,
        });

        mkdirSync(outputDir, { recursive: true });

        const contractJsonPath = join(outputDir, 'contract.json');
        const contractDtsPath = join(outputDir, 'contract.d.ts');

        writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
        writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

        console.log(`✓ Emitted contract.json to ${contractJsonPath}`);
        console.log(`✓ Emitted contract.d.ts to ${contractDtsPath}`);
        console.log(`  coreHash: ${result.coreHash}`);
        if (result.profileHash) {
          console.log(`  profileHash: ${result.profileHash}`);
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });

  return command;
}

