import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { errorContractConfigMissing } from '@prisma-next/core-control-plane/errors';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/types';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { performAction } from '../utils/action';
import { setCommandDescriptions } from '../utils/command-helpers';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatEmitJson,
  formatEmitOutput,
  formatStyledHeader,
  formatSuccessMessage,
} from '../utils/output';
import { handleResult } from '../utils/result-handler';
import { withSpinner } from '../utils/spinner';

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
    'Write your contract to JSON and sign it',
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
          // Normalize config path for display (match contract path format - no ./ prefix)
          const configPath = options.config
            ? relative(process.cwd(), resolve(options.config))
            : 'prisma-next.config.ts';
          // Convert absolute paths to relative paths for display
          const contractPath = relative(process.cwd(), outputJsonPath);
          const typesPath = relative(process.cwd(), outputDtsPath);
          const header = formatStyledHeader({
            command: 'contract emit',
            description: 'Write your contract to JSON and sign it',
            url: 'https://pris.ly/contract-emit',
            details: [
              { label: 'config', value: configPath },
              { label: 'contract', value: contractPath },
              { label: 'types', value: typesPath },
            ],
            flags,
          });
          console.log(header);
        }

        const stack = createControlPlaneStack({
          target: config.target,
          adapter: config.adapter,
          driver: config.driver,
          extensionPacks: config.extensionPacks ?? [],
        });
        const familyInstance = config.family.create(stack);

        // Resolve contract source from config (user's config handles loading)
        let contractRaw: unknown;
        if (typeof contractConfig.source === 'function') {
          contractRaw = await contractConfig.source();
        } else {
          contractRaw = contractConfig.source;
        }

        // Call emitContract on family instance (handles stripping mappings and validation internally)
        const emitResult = await withSpinner(
          () => familyInstance.emitContract({ contractIR: contractRaw }),
          {
            message: 'Emitting contract...',
            flags,
          },
        );

        // Create directories if needed
        mkdirSync(dirname(outputJsonPath), { recursive: true });
        mkdirSync(dirname(outputDtsPath), { recursive: true });

        // Write the results to files
        writeFileSync(outputJsonPath, emitResult.contractJson, 'utf-8');
        writeFileSync(outputDtsPath, emitResult.contractDts, 'utf-8');

        // Add blank line after all async operations if spinners were shown
        if (!flags.quiet && flags.json !== 'object' && process.stdout.isTTY) {
          console.log('');
        }

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
