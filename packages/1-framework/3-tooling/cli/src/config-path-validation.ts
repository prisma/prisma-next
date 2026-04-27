import {
  type ContractSourceProvider,
  normalizeContractConfig,
  type PrismaNextConfig,
} from '@prisma-next/config/config-types';
import { ConfigValidationError } from '@prisma-next/config/config-validation';
import { getEmittedArtifactPaths } from '@prisma-next/emitter';
import { resolve } from 'pathe';

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
): void {
  if (inputs === undefined || output === undefined) {
    return;
  }

  let emittedArtifactPaths: ReturnType<typeof getEmittedArtifactPaths>;
  try {
    emittedArtifactPaths = getEmittedArtifactPaths(output);
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

export function finalizeConfig(config: PrismaNextConfig, configDir: string): PrismaNextConfig {
  if (!config.contract) {
    return config;
  }
  const contract = normalizeContractConfig(config.contract);
  const source = finalizeContractSource(contract.source, configDir);
  const output = resolve(configDir, contract.output);

  validateNoOutputsAreInputs(source.inputs, output);

  return {
    ...config,
    contract: {
      ...contract,
      source,
      output,
    },
  };
}
