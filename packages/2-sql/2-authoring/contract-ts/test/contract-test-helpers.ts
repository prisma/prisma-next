import type {
  Contract,
  ContractModelsMap,
  ContractValueObjectsMap,
} from '@prisma-next/contract/types';
import { contractModels, contractValueObjects } from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';

export function modelsOf<T extends Contract>(contract: T): ContractModelsMap<T> {
  return contractModels(contract) as ContractModelsMap<T>;
}

export function valueObjectsOf<T extends Contract>(
  contract: T,
): ContractValueObjectsMap<T> | undefined {
  return contractValueObjects(contract) as ContractValueObjectsMap<T> | undefined;
}

/** Flat model map for runtime assertions when `ContractModelsMap` is widened by the test harness. */
export type AssertionModelMap = Record<
  string,
  {
    readonly storage: {
      readonly table?: string;
      readonly fields: Record<string, unknown>;
    };
  }
>;

export function modelsMapForAssertions<T extends Contract>(contract: T): AssertionModelMap {
  return blindCast<AssertionModelMap, 'test assertions index models by string name'>(
    contractModels(contract),
  );
}
