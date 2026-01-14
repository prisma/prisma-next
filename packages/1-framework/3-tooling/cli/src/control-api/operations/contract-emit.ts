import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { errorContractConfigMissing } from '@prisma-next/core-control-plane/errors';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import { loadConfig } from '../../config-loader';
import type { ContractEmitOptions, ContractEmitResult } from '../types';

/**
 * Error thrown when contract emission is cancelled via AbortSignal.
 * Callers can check error.name === 'ContractEmitCancelledError' to detect cancellation.
 */
export class ContractEmitCancelledError extends Error {
  override readonly name = 'ContractEmitCancelledError' as const;

  constructor() {
    super('Contract emit was cancelled');
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted();
  } else {
    throw new ContractEmitCancelledError();
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
 * @throws ContractEmitCancelledError if cancelled via signal
 */
export async function executeContractEmit(
  options: ContractEmitOptions,
): Promise<ContractEmitResult> {
  const { configPath, signal } = options;

  // Check for cancellation before starting
  throwIfAborted(signal);

  // Load config using the existing config loader
  const config = await loadConfig(configPath);

  // Check for cancellation after config load
  throwIfAborted(signal);

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

  // Resolve artifact paths relative to config file directory (unless already absolute)
  const configDir = dirname(configPath);
  const outputJsonPath = isAbsolute(contractConfig.output)
    ? contractConfig.output
    : resolve(configDir, contractConfig.output);
  const outputDtsPath = isAbsolute(contractConfig.types)
    ? contractConfig.types
    : resolve(configDir, contractConfig.types);

  // Create control plane stack from config
  const stack = createControlPlaneStack({
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks,
  });
  const familyInstance = config.family.create(stack);

  // Check for cancellation before emitting
  throwIfAborted(signal);

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
  throwIfAborted(signal);

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
