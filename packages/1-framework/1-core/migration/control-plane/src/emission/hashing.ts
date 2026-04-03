import {
  type CanonicalContractInput,
  computeExecutionHash as sharedComputeExecutionHash,
  computeProfileHash as sharedComputeProfileHash,
  computeStorageHash as sharedComputeStorageHash,
} from '@prisma-next/contract/hashing';

export function computeStorageHash(contract: CanonicalContractInput): string {
  return sharedComputeStorageHash({
    target: contract.target,
    targetFamily: contract.targetFamily,
    storage: contract.storage as Record<string, unknown>,
  });
}

export function computeProfileHash(contract: CanonicalContractInput): string {
  return sharedComputeProfileHash({
    target: contract.target,
    targetFamily: contract.targetFamily,
    capabilities: contract.capabilities,
  });
}

export function computeExecutionHash(contract: CanonicalContractInput): string {
  return sharedComputeExecutionHash({
    target: contract.target,
    targetFamily: contract.targetFamily,
    execution: contract.execution ?? {},
  });
}
