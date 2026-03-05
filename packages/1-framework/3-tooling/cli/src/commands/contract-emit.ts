import { mkdirSync, writeFileSync } from 'node:fs';
import { errorContractConfigMissing } from '@prisma-next/core-control-plane/errors';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { dirname, isAbsolute, join, relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import type { EmitFailure } from '../control-api/types';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorRuntime,
  errorUnexpected,
} from '../utils/cli-errors';
import { setCommandDescriptions, setCommandExamples } from '../utils/command-helpers';
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
import { TerminalUI } from '../utils/terminal-ui';

interface ContractEmitOptions {
  readonly config?: string;
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly trace?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
  readonly interactive?: boolean;
  readonly 'no-interactive'?: boolean;
  readonly yes?: boolean;
  readonly y?: boolean;
}

function mapDiagnosticsToIssues(
  failure: EmitFailure,
): ReadonlyArray<{ kind: string; message: string }> {
  const diagnostics = failure.diagnostics?.diagnostics ?? [];
  return diagnostics.map((diagnostic) => {
    const location =
      diagnostic.sourceId && diagnostic.span
        ? ` (${diagnostic.sourceId}:${diagnostic.span.start.line}:${diagnostic.span.start.column})`
        : diagnostic.sourceId
          ? ` (${diagnostic.sourceId})`
          : '';
    return {
      kind: diagnostic.code,
      message: `${diagnostic.message}${location}`,
    };
  });
}

/**
 * Maps an EmitFailure to a CliStructuredError for consistent error handling.
 */
function mapEmitFailure(
  failure: EmitFailure,
  context?: { readonly configPath?: string },
): CliStructuredError {
  if (failure.code === 'CONTRACT_SOURCE_INVALID') {
    const issues = mapDiagnosticsToIssues(failure);
    return errorRuntime(failure.summary, {
      why: failure.why ?? 'Contract source provider failed',
      fix: 'Check your contract source provider in prisma-next.config.ts and ensure it returns Result<ContractIR, Diagnostics>',
      ...(issues.length > 0 ? { meta: { issues } } : {}),
    });
  }

  if (failure.code === 'CONTRACT_VALIDATION_FAILED') {
    return errorContractValidationFailed(
      failure.why ?? 'Contract validation failed while emitting',
      context?.configPath ? { where: { path: context.configPath } } : undefined,
    );
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
  const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

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

  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';

  // Resolve contract from config
  if (!config.contract) {
    return notOk(
      errorContractConfigMissing({
        why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ... }',
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
  const configDir = options.config ? dirname(resolve(options.config)) : process.cwd();
  const outputJsonPath = isAbsolute(contractConfig.output)
    ? contractConfig.output
    : join(configDir, contractConfig.output);
  // Colocate .d.ts with .json (contract.json → contract.d.ts)
  const outputDtsPath = `${outputJsonPath.slice(0, -5)}.d.ts`;

  // Output header to stderr (decoration)
  if (!flags.json && !flags.quiet) {
    const contractPath = relative(process.cwd(), outputJsonPath);
    const typesPath = relative(process.cwd(), outputDtsPath);
    const header = formatStyledHeader({
      command: 'contract emit',
      description: 'Emit your contract artifacts',
      url: 'https://pris.ly/contract-emit',
      details: [
        { label: 'config', value: configPath },
        { label: 'contract', value: contractPath },
        { label: 'types', value: typesPath },
      ],
      flags,
    });
    ui.stderr(header);
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
    // Call emit with progress callback
    const result = await client.emit({
      contractConfig: {
        sourceProvider: contractConfig.source,
        output: outputJsonPath,
      },
      onProgress,
    });

    // Handle failures by mapping to CLI structured error
    if (!result.ok) {
      return notOk(mapEmitFailure(result.failure, { configPath }));
    }

    // Create directories if needed
    mkdirSync(dirname(outputJsonPath), { recursive: true });
    mkdirSync(dirname(outputDtsPath), { recursive: true });

    // Write the results to files
    writeFileSync(outputJsonPath, result.value.contractJson, 'utf-8');
    writeFileSync(outputDtsPath, result.value.contractDts, 'utf-8');

    // Convert success result to CLI output format
    const emitResult: EmitContractResult = {
      storageHash: result.value.storageHash,
      ...(result.value.executionHash ? { executionHash: result.value.executionHash } : {}),
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
    'Emit your contract artifacts',
    'Reads your contract source (TypeScript or Prisma schema) and emits contract.json and\n' +
      'contract.d.ts. The contract.json contains the canonical contract structure, and\n' +
      'contract.d.ts provides TypeScript types for type-safe query building.',
  );
  setCommandExamples(command, [
    'prisma-next contract emit',
    'prisma-next contract emit --config ./custom-config.ts',
  ]);
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const flags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags });
      },
    })
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('--trace', 'Trace output: deep internals, stack traces')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .option('--interactive', 'Force interactive mode')
    .option('--no-interactive', 'Disable interactive prompts')
    .option('-y, --yes', 'Auto-accept prompts')
    .action(async (options: ContractEmitOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
      const startTime = Date.now();

      const result = await executeContractEmitCommand(options, flags, startTime);

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, (emitResult) => {
        if (flags.json) {
          ui.output(formatEmitJson(emitResult));
        } else {
          const output = formatEmitOutput(emitResult, flags);
          if (output) {
            ui.log(output);
          }
          if (!flags.quiet) {
            ui.success(formatSuccessMessage(flags));
          }
        }
      });
      process.exit(exitCode);
    });

  return command;
}
