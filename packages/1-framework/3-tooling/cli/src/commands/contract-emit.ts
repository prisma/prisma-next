import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { errorContractConfigMissing } from '@prisma-next/core-control-plane/errors';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import type { EmitContractSource, EmitFailure } from '../control-api/types';
import { CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  type EmitContractResult,
  formatCommandHelp,
  formatEmitJson,
  formatEmitOutput,
  formatStyledHeader,
  formatSuccessMessage,
} from '../utils/output';
import { createProgressAdapter } from '../utils/progress-adapter';
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

/**
 * Maps an EmitFailure to a CliStructuredError for consistent error handling.
 */
function mapEmitFailure(failure: EmitFailure): CliStructuredError {
  if (failure.code === 'CONTRACT_SOURCE_INVALID') {
    return errorRuntime(failure.summary, {
      why: failure.why ?? 'Contract source is invalid',
      fix: 'Check your contract source configuration in prisma-next.config.ts',
    });
  }

  if (failure.code === 'EMIT_FAILED') {
    return errorRuntime(failure.summary, {
      why: failure.why ?? 'Failed to emit contract',
      fix: 'Check your contract configuration and ensure the source is valid',
    });
  }

  // Exhaustive check - TypeScript will error if a new code is added but not handled
  const exhaustive: never = failure.code;
  throw new Error(`Unhandled EmitFailure code: ${exhaustive}`);
}

/**
 * Executes the contract emit command and returns a structured Result.
 */
async function executeContractEmitCommand(
  options: ContractEmitOptions,
  flags: GlobalFlags,
  startTime: number,
): Promise<Result<EmitContractResult, CliStructuredError>> {
  // Load config
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(options.config);
  } catch (error) {
    // Convert thrown CliStructuredError to Result
    if (error instanceof CliStructuredError) {
      return notOk(error);
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: 'Failed to load config',
      }),
    );
  }

  // Resolve contract from config
  if (!config.contract) {
    return notOk(
      errorContractConfigMissing({
        why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ..., types: ... }',
      }),
    );
  }

  // Contract config is already normalized by defineConfig() with defaults applied
  const contractConfig = config.contract;

  // Resolve artifact paths from config (already normalized by defineConfig() with defaults)
  if (!contractConfig.output) {
    return notOk(
      errorContractConfigMissing({
        why: 'Contract config must have output path. This should not happen if defineConfig() was used.',
      }),
    );
  }
  if (!contractConfig.output.endsWith('.json')) {
    return notOk(
      errorContractConfigMissing({
        why: 'Contract config output path must end with .json (e.g., "src/prisma/contract.json")',
      }),
    );
  }
  const outputJsonPath = resolve(contractConfig.output);
  // Colocate .d.ts with .json (contract.json → contract.d.ts)
  const outputDtsPath = `${outputJsonPath.slice(0, -5)}.d.ts`;

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

  // Create control client (no driver needed for emit)
  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    extensionPacks: config.extensionPacks ?? [],
  });

  // Create progress adapter
  const onProgress = createProgressAdapter({ flags });

  try {
    // Convert user config source to discriminated union
    // Type assertion is safe: we check typeof to determine if it's a function
    const source: EmitContractSource =
      typeof contractConfig.source === 'function'
        ? { kind: 'loader', load: contractConfig.source as () => unknown | Promise<unknown> }
        : { kind: 'value', value: contractConfig.source };

    // Call emit with progress callback
    const result = await client.emit({
      contractConfig: {
        source,
        output: outputJsonPath,
      },
      onProgress,
    });

    // Handle failures by mapping to CLI structured error
    if (!result.ok) {
      return notOk(mapEmitFailure(result.failure));
    }

    // Create directories if needed
    mkdirSync(dirname(outputJsonPath), { recursive: true });
    mkdirSync(dirname(outputDtsPath), { recursive: true });

    // Write the results to files
    writeFileSync(outputJsonPath, result.value.contractJson, 'utf-8');
    writeFileSync(outputDtsPath, result.value.contractDts, 'utf-8');

    // Add blank line after all async operations if spinners were shown
    if (!flags.quiet && flags.json !== 'object' && process.stdout.isTTY) {
      console.log('');
    }

    // Convert success result to CLI output format
    const emitResult: EmitContractResult = {
      coreHash: result.value.coreHash,
      profileHash: result.value.profileHash,
      outDir: dirname(outputJsonPath),
      files: {
        json: outputJsonPath,
        dts: outputDtsPath,
      },
      timings: { total: Date.now() - startTime },
    };

    return ok(emitResult);
  } catch (error) {
    // Use static type guard to work across module boundaries
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }

    // Wrap unexpected errors
    return notOk(
      errorUnexpected('Unexpected error during contract emit', {
        why: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    await client.close();
  }
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
      const startTime = Date.now();

      const result = await executeContractEmitCommand(options, flags, startTime);

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
