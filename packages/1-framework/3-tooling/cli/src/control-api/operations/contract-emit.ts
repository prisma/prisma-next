import { mkdir, writeFile } from 'node:fs/promises';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import { cancelable } from '@prisma-next/utils/cancelable';
import { dirname, isAbsolute, join, resolve } from 'pathe';
import { loadConfig } from '../../config-loader';
import { errorContractConfigMissing } from '../../utils/cli-errors';
import type { ContractEmitOptions, ContractEmitResult } from '../types';

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
  const { configPath, signal = new AbortController().signal } = options;
  const unlessAborted = cancelable(signal);

  // Load config using the existing config loader
  const config = await unlessAborted(loadConfig(configPath));

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
    typeof contractConfig.source !== 'function' && typeof contractConfig.source !== 'object'
  ) {
    throw errorContractConfigMissing({
      why: 'Contract config must include a valid source (function or value)',
    });
  }

  // Create control plane stack from config
  const stack = createControlPlaneStack(config);
  const familyInstance = config.family.create(stack);

  // Resolve contract source from config
  const contractRaw = typeof contractConfig.source === 'function'
  	? await unlessAborted(contractConfig.source())
  	: contractConfig.source;

  // Emit contract via family instance
  const emitResult = await unlessAborted(familyInstance.emitContract({ contractIR: contractRaw }));

  // Create directories if needed and write files
  await unlessAborted(mkdir(dirname(outputJsonPath), { recursive: true }));
  await unlessAborted(mkdir(dirname(outputDtsPath), { recursive: true }));
  await unlessAborted(writeFile(outputJsonPath, emitResult.contractJson, 'utf-8'));
  await unlessAborted(writeFile(outputDtsPath, emitResult.contractDts, 'utf-8'));

  return {
    coreHash: emitResult.coreHash,
    profileHash: emitResult.profileHash,
    files: {
      json: outputJsonPath,
      dts: outputDtsPath,
    },
  };
}
