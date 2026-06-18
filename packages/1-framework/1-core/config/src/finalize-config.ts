import { resolve } from 'pathe';
import type { PrismaNextConfig } from './config-types';
import { normalizeContractConfig } from './config-types';
import type { ContractSourceProvider } from './contract-source-types';
import { ConfigValidationError } from './errors';

// Injected from above the layering line: the emitter-specific derivation lives
// in the tooling layer, so `@prisma-next/config` takes it as a hook.
export interface EmittedArtifactPaths {
  readonly jsonPath: string;
  readonly dtsPath: string;
}

export type EmittedArtifactPathsResolver = (outputJsonPath: string) => EmittedArtifactPaths;

function throwValidation(field: string, why: string): never {
  throw new ConfigValidationError(field, why);
}

function finalizeContractSource(
  source: ContractSourceProvider,
  configDir: string,
): ContractSourceProvider {
  const resolvedInputs = source.inputs?.map((input) => resolve(configDir, input));
  if (resolvedInputs === undefined) {
    return source;
  }

  return {
    ...source,
    inputs: resolvedInputs,
  };
}

function validateNoOutputsAreInputs(
  inputs: readonly string[] | undefined,
  output: string | undefined,
  resolveEmittedArtifactPaths: EmittedArtifactPathsResolver,
): void {
  if (inputs === undefined || output === undefined) {
    return;
  }

  let emittedArtifactPaths: EmittedArtifactPaths;
  try {
    emittedArtifactPaths = resolveEmittedArtifactPaths(output);
  } catch (error) {
    throwValidation('contract.output', error instanceof Error ? error.message : String(error));
  }

  const emittedPaths = new Set([emittedArtifactPaths.jsonPath, emittedArtifactPaths.dtsPath]);

  for (const input of inputs) {
    if (emittedPaths.has(input)) {
      throwValidation(
        'contract.source.inputs[]',
        'Config.contract.source.inputs must not include emitted artifact paths derived from contract.output',
      );
    }
  }
}

export function finalizeConfig(
  config: PrismaNextConfig,
  configDir: string,
  resolveEmittedArtifactPaths?: EmittedArtifactPathsResolver,
): PrismaNextConfig {
  if (!config.contract) {
    return config;
  }
  const contract = normalizeContractConfig(config.contract);
  const source = finalizeContractSource(contract.source, configDir);
  const output = resolve(configDir, contract.output);

  if (resolveEmittedArtifactPaths) {
    validateNoOutputsAreInputs(source.inputs, output, resolveEmittedArtifactPaths);
  }

  return {
    ...config,
    contract: {
      ...contract,
      source,
      output,
    },
  };
}
