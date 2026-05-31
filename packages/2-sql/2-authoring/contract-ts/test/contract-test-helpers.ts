import type { Contract } from '@prisma-next/contract/types';
import { contractModels, contractValueObjects } from '@prisma-next/contract/types';

export function modelsOf<T extends Contract>(contract: T): ReturnType<typeof contractModels<T>> {
  return contractModels(contract);
}

export function valueObjectsOf<T extends Contract>(
  contract: T,
): ReturnType<typeof contractValueObjects<T>> {
  return contractValueObjects(contract);
}
