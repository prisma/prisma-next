import { Collection } from '../src/collection';
import type { MockRuntime, TestContract } from './helpers';
import { createMockRuntime, createTestContract } from './helpers';

export type TestModelName = Extract<keyof TestContract['models'], string>;

export const baseContract = createTestContract();

export function createCollectionFor<ModelName extends TestModelName>(
  modelName: ModelName,
  contract: TestContract = baseContract,
): {
  collection: Collection<TestContract, ModelName>;
  runtime: MockRuntime;
} {
  const runtime = createMockRuntime();
  const collection = new Collection({ contract, runtime }, modelName);
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
  const collection = new Collection({ contract: withReturningCapability(), runtime }, modelName);
  return {
    collection,
    runtime,
  };
}
