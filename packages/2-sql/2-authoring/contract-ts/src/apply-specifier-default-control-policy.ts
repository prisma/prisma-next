import type { Contract, ControlPolicy } from '@prisma-next/contract/types';

export function applySpecifierDefaultControlPolicy(
  contract: Contract,
  specifierDefault: ControlPolicy | undefined,
): Contract {
  if (specifierDefault === undefined || contract.defaultControlPolicy !== undefined) {
    return contract;
  }
  return { ...contract, defaultControlPolicy: specifierDefault };
}
