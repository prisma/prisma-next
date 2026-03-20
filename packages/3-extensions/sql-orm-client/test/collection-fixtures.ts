import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { Collection } from '../src/collection';
import type { MockRuntime, TestContract } from './helpers';
import { createMockRuntime, getTestContext, getTestContract } from './helpers';

export type TestModelName = Extract<keyof TestContract['models'], string>;

export const baseContract = getTestContract();

function contextForContract(contract: TestContract): ExecutionContext<TestContract> {
  const base = getTestContext();
  if (contract === baseContract) return base;
  return { ...base, contract } as ExecutionContext<TestContract>;
}

export function createCollectionFor<ModelName extends TestModelName>(
  modelName: ModelName,
  contract: TestContract = baseContract,
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
