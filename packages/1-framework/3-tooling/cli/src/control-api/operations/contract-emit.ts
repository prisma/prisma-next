import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { errorContractConfigMissing } from '@prisma-next/core-control-plane/errors';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import { loadConfig } from '../../config-loader';
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
 */
export async function executeContractEmit(
  options: ContractEmitOptions,
): Promise<ContractEmitResult> {
  const { configPath, signal } = options;

  // Check for cancellation before starting
  if (signal?.aborted) {
    throw new Error('Contract emit was cancelled');
  }

  // Load config using the existing config loader
  const config = await loadConfig(configPath);

  // Check for cancellation after config load
  if (signal?.aborted) {
    throw new Error('Contract emit was cancelled');
  }

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

  // Resolve artifact paths to absolute paths
  const outputJsonPath = resolve(contractConfig.output);
  const outputDtsPath = resolve(contractConfig.types);

  // Create control plane stack from config
  const stack = createControlPlaneStack({
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks,
  });
  const familyInstance = config.family.create(stack);

  // Check for cancellation before emitting
  if (signal?.aborted) {
    throw new Error('Contract emit was cancelled');
  }

  // Resolve contract source from config
  let contractRaw: unknown;
  if (typeof contractConfig.source === 'function') {
    contractRaw = await contractConfig.source();
  } else {
    contractRaw = contractConfig.source;
  }

  // Emit contract via family instance
  const emitResult = await familyInstance.emitContract({ contractIR: contractRaw });

  // Check for cancellation before writing files
  if (signal?.aborted) {
    throw new Error('Contract emit was cancelled');
  }

  // Create directories if needed and write files
  mkdirSync(dirname(outputJsonPath), { recursive: true });
  mkdirSync(dirname(outputDtsPath), { recursive: true });
  writeFileSync(outputJsonPath, emitResult.contractJson, 'utf-8');
  writeFileSync(outputDtsPath, emitResult.contractDts, 'utf-8');

  return {
    coreHash: emitResult.coreHash,
    profileHash: emitResult.profileHash,
    files: {
      json: outputJsonPath,
      dts: outputDtsPath,
    },
  };
}
