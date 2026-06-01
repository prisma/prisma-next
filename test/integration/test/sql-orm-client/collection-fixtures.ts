import type { Contract, ContractModelDefinitions } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { Collection } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { MockRuntime, TestContract } from './helpers';
import { createMockRuntime, getTestContext, getTestContract } from './helpers';

export type TestModelName = keyof ContractModelDefinitions<TestContract> & string;

export const baseContract = getTestContract();

function contextForContract(contract: Contract<SqlStorage>): ExecutionContext<TestContract> {
  const base = getTestContext();
  if (contract === baseContract) return base;
  return { ...base, contract } as ExecutionContext<TestContract>;
}

export function createCollectionFor<ModelName extends TestModelName>(
  modelName: ModelName,
  contract: Contract<SqlStorage> = baseContract,
): {
  collection: Collection<TestContract, ModelName>;
  runtime: MockRuntime;
} {
  const runtime = createMockRuntime();
  const context = contextForContract(contract);
  const collection = new Collection({ runtime, context }, modelName);
  return {
    collection,
    runtime,
  };
}

export function createCollection() {
  return createCollectionFor('User');
}

export function withReturningCapability(contract: TestContract = baseContract): TestContract {
  return {
    ...contract,
    capabilities: {
      ...contract.capabilities,
      returning: {
        enabled: true,
      },
    },
  } as TestContract;
}

export function withoutDefaultInInsert(contract: TestContract = baseContract): TestContract {
  const clone = structuredClone(contract);
  if (clone.capabilities?.['sql']) {
    delete (clone.capabilities['sql'] as Record<string, unknown>)['defaultInInsert'];
  }
  return clone;
}

export function createReturningCollectionWithoutDefaultInInsert<ModelName extends TestModelName>(
  modelName: ModelName,
): {
  collection: Collection<TestContract, ModelName>;
  runtime: MockRuntime;
} {
  const runtime = createMockRuntime();
  const context = contextForContract(withReturningCapability(withoutDefaultInInsert()));
  const collection = new Collection({ runtime, context }, modelName);
  return { collection, runtime };
}

export function createReturningCollectionFor<ModelName extends TestModelName>(
  modelName: ModelName,
): {
  collection: Collection<TestContract, ModelName>;
  runtime: MockRuntime;
} {
  const runtime = createMockRuntime();
  const context = contextForContract(withReturningCapability());
  const collection = new Collection({ runtime, context }, modelName);
  return {
    collection,
    runtime,
  };
}
