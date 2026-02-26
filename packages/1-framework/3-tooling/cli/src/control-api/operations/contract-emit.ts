import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import { abortable } from '@prisma-next/utils/abortable';
import { ifDefined } from '@prisma-next/utils/defined';
import { dirname, isAbsolute, join, resolve } from 'pathe';
import { loadConfig } from '../../config-loader';
import { errorContractConfigMissing } from '../../utils/cli-errors';
import type { ContractEmitOptions, ContractEmitResult } from '../types';

interface PslContractSourceInput {
  readonly kind: 'psl';
  readonly schemaPath: string;
}

interface ResolvedPslContractSource {
  readonly kind: 'psl';
  readonly schemaPath: string;
  readonly schema: string;
}

function isPslContractSourceInput(source: unknown): source is PslContractSourceInput {
  if (!source || typeof source !== 'object') {
    return false;
  }

  const record = source as Record<string, unknown>;
  return record['kind'] === 'psl';
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
  const { configPath, signal = new AbortController().signal } = options;
  const unlessAborted = abortable(signal);

  // Load config using the existing config loader
  const config = await unlessAborted(loadConfig(configPath));

  // Validate contract config is present
  if (!config.contract) {
    throw errorContractConfigMissing({
      why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ... }',
    });
  }

  const contractConfig = config.contract;

  // Validate output path is present and ends with .json
  if (!contractConfig.output) {
    throw errorContractConfigMissing({
      why: 'Contract config must have output path. This should not happen if defineConfig() was used.',
    });
  }
  if (!contractConfig.output.endsWith('.json')) {
    throw errorContractConfigMissing({
      why: 'Contract config output path must end with .json (e.g., "src/prisma/contract.json")',
    });
  }

  // Validate source exists
  if (contractConfig.source === undefined) {
    throw errorContractConfigMissing({
      why: 'Contract config must include a valid source',
    });
  }

  // Normalize configPath and resolve artifact paths relative to config file directory
  const normalizedConfigPath = resolve(configPath);
  const configDir = dirname(normalizedConfigPath);
  const outputJsonPath = isAbsolute(contractConfig.output)
    ? contractConfig.output
    : join(configDir, contractConfig.output);
  // Colocate .d.ts with .json (contract.json → contract.d.ts)
  const outputDtsPath = `${outputJsonPath.slice(0, -5)}.d.ts`;

  // Create control plane stack from config
  const stack = createControlPlaneStack(config);
  const familyInstance = config.family.create(stack);

  // Resolve contract source from config
  const sourceValue =
    typeof contractConfig.source === 'function'
      ? await unlessAborted(Promise.resolve(contractConfig.source()))
      : contractConfig.source;
  let contractRaw: unknown = sourceValue;
  if (isPslContractSourceInput(sourceValue)) {
    const schemaPath = isAbsolute(sourceValue.schemaPath)
      ? sourceValue.schemaPath
      : join(configDir, sourceValue.schemaPath);
    const schema = await unlessAborted(readFile(schemaPath, 'utf-8'));
    contractRaw = {
      kind: 'psl',
      schemaPath,
      schema,
    } satisfies ResolvedPslContractSource;
  }

  // Emit contract via family instance
  const emitResult = await unlessAborted(familyInstance.emitContract({ contractIR: contractRaw }));

  // Create directory if needed and write files (both colocated)
  await unlessAborted(mkdir(dirname(outputJsonPath), { recursive: true }));
  await unlessAborted(writeFile(outputJsonPath, emitResult.contractJson, 'utf-8'));
  await unlessAborted(writeFile(outputDtsPath, emitResult.contractDts, 'utf-8'));

  return {
    storageHash: emitResult.storageHash,
    ...ifDefined('executionHash', emitResult.executionHash),
    profileHash: emitResult.profileHash,
    files: {
      json: outputJsonPath,
      dts: outputDtsPath,
    },
  };
}
