import type {
  ContractConfig,
  ContractSourceProvider,
  PrismaNextConfig,
} from '@prisma-next/config/config-types';
import { ConfigValidationError } from '@prisma-next/config/config-validation';
import { getEmittedArtifactPaths } from '@prisma-next/emitter';
import { resolve } from 'pathe';

const DEFAULT_CONTRACT_OUTPUT = 'src/prisma/contract.json';

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

export function validateContractPathDisjointness(contract: ContractConfig): void {
  const inputs = contract.source.inputs;
  const output = contract.output;

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

  const source = finalizeContractSource(config.contract.source, configDir);
  const output = resolve(configDir, config.contract.output ?? DEFAULT_CONTRACT_OUTPUT);
  const contract = { ...config.contract, source, output };

  validateContractPathDisjointness(contract);

  return {
    ...config,
    contract,
  };
}
