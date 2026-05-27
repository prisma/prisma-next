import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { Collection } from '../src/collection';
import type { MockRuntime, RuntimeTestContract, TestContract } from './helpers';
import { createMockRuntime, getTestContext, getTestContract } from './helpers';

export type TestModelName = Extract<keyof TestContract['models'], string>;

export const baseContract = getTestContract();

function contextForContract(contract: RuntimeTestContract): ExecutionContext<RuntimeTestContract> {
  const base = getTestContext();
  if (contract === baseContract) return base;
  return { ...base, contract };
}

export function createCollectionFor<ModelName extends TestModelName>(
  modelName: ModelName,
  contract: RuntimeTestContract = baseContract,
): {
  collection: Collection<RuntimeTestContract, ModelName>;
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

export function withReturningCapability(
  contract: RuntimeTestContract = baseContract,
): RuntimeTestContract {
  return {
    ...contract,
    capabilities: {
      ...contract.capabilities,
      returning: {
        enabled: true,
      },
    },
  };
}

export function withoutDefaultInInsert(
  contract: RuntimeTestContract = baseContract,
): RuntimeTestContract {
  const clone = structuredClone(contract);
  if (clone.capabilities?.['sql']) {
    delete (clone.capabilities['sql'] as Record<string, unknown>)['defaultInInsert'];
  }
  return clone;
}

export function createReturningCollectionWithoutDefaultInInsert<ModelName extends TestModelName>(
  modelName: ModelName,
): {
  collection: Collection<RuntimeTestContract, ModelName>;
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
  collection: Collection<RuntimeTestContract, ModelName>;
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
