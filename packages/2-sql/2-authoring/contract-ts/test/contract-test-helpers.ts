import type {
  Contract,
  ContractModelDefinitions,
  ContractValueObjectDefinitions,
} from '@prisma-next/contract/types';
import {
  defaultDomainNamespaceIdForSqlTarget,
  domainModelsAtDefaultNamespace,
  domainValueObjectsAtDefaultNamespace,
} from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';

function sqlDefaultDomainNamespaceId(contract: { readonly target: string }): string {
  return defaultDomainNamespaceIdForSqlTarget(contract.target);
}

export function modelsOf<T extends Contract>(contract: T): ContractModelDefinitions<T> {
  return domainModelsAtDefaultNamespace(
    contract.domain,
    sqlDefaultDomainNamespaceId(contract),
  ) as ContractModelDefinitions<T>;
}

export function valueObjectsOf<T extends Contract>(
  contract: T,
): ContractValueObjectDefinitions<T> | undefined {
  return domainValueObjectsAtDefaultNamespace(
    contract.domain,
    sqlDefaultDomainNamespaceId(contract),
  ) as ContractValueObjectDefinitions<T> | undefined;
}

/** Flat model map for runtime assertions when model types are widened by the test harness. */
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
    domainModelsAtDefaultNamespace(contract.domain, sqlDefaultDomainNamespaceId(contract)),
  );
}
