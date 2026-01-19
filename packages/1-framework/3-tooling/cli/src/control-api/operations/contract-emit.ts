import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import { loadConfig } from '../../config-loader';
import { errorContractConfigMissing } from '../../utils/cli-errors';
import type { ContractEmitOptions, ContractEmitResult } from '../types';

/**
 * @deprecated No longer thrown - kept for backwards compatibility.
 * Use signal.aborted or check error.name === 'AbortError' instead.
 */
export class ContractEmitCancelledError extends Error {
  override readonly name = 'ContractEmitCancelledError' as const;

  constructor() {
    super('Contract emit was cancelled');
  }
}

/**
 * Executes the contract emit operation.
 *
 * This is an offline operation that:
 * 1. Loads the Prisma Next config from the specified path
 * 2. Resolves the contract source from config
 * 3. Creates a control plane stack and family instance
 * 4. Emits contract artifacts (JSON and DTS)
 * 5. Writes files to the paths specified in config
 *
 * Supports AbortSignal for cancellation, enabling "last change wins" behavior.
 *
 * @param options - Options including configPath and optional signal
 * @returns File paths and hashes of emitted artifacts
 * @throws If config loading fails, contract is invalid, or file I/O fails
 * @throws signal.reason if cancelled via AbortSignal (typically DOMException with name 'AbortError')
 */
export async function executeContractEmit(
  options: ContractEmitOptions,
): Promise<ContractEmitResult> {
  const { configPath, signal } = options;

  // Check for cancellation before starting
  signal?.throwIfAborted();

  // Load config using the existing config loader
  const config = await loadConfig(configPath);

  // Check for cancellation after config load
  signal?.throwIfAborted();

  // Validate contract config is present
  if (!config.contract) {
    throw errorContractConfigMissing({
      why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ..., types: ... }',
    });
  }

  const contractConfig = config.contract;

  // Validate output paths are present
  if (!contractConfig.output || !contractConfig.types) {
    throw errorContractConfigMissing({
      why: 'Contract config must have output and types paths. This should not happen if defineConfig() was used.',
    });
  }

  // Normalize configPath and resolve artifact paths relative to config file directory
  const normalizedConfigPath = resolve(configPath);
  const configDir = dirname(normalizedConfigPath);
  const outputJsonPath = isAbsolute(contractConfig.output)
    ? contractConfig.output
    : join(configDir, contractConfig.output);
  const outputDtsPath = isAbsolute(contractConfig.types)
    ? contractConfig.types
    : join(configDir, contractConfig.types);

  // Validate source is defined and is either a function or a non-null value
  if (
    contractConfig.source === undefined ||
    contractConfig.source === null ||
    (typeof contractConfig.source !== 'function' && typeof contractConfig.source !== 'object')
  ) {
    throw errorContractConfigMissing({
      why: 'Contract config must include a valid source (function or value)',
    });
  }

  // Create control plane stack from config
  const stack = createControlPlaneStack({
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks,
  });
  const familyInstance = config.family.create(stack);

  // Check for cancellation before emitting
  signal?.throwIfAborted();

  // Resolve contract source from config
  let contractRaw: unknown;
  if (typeof contractConfig.source === 'function') {
    contractRaw = await contractConfig.source();
  } else {
    contractRaw = contractConfig.source;
  }

  // Check for cancellation after resolving source, before emitting
  signal?.throwIfAborted();

  // Emit contract via family instance
  const emitResult = await familyInstance.emitContract({ contractIR: contractRaw });

  // Check for cancellation before writing files
  signal?.throwIfAborted();

  // Create directories if needed and write files
  await mkdir(dirname(outputJsonPath), { recursive: true });
  await mkdir(dirname(outputDtsPath), { recursive: true });
  await writeFile(outputJsonPath, emitResult.contractJson, 'utf-8');
  await writeFile(outputDtsPath, emitResult.contractDts, 'utf-8');

  return {
    coreHash: emitResult.coreHash,
    profileHash: emitResult.profileHash,
    files: {
      json: outputJsonPath,
      dts: outputDtsPath,
    },
  };
}
