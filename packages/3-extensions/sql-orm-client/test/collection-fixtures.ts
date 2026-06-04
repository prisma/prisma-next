import { type Contract, soleDomainNamespaceId } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { Collection } from '../src/collection';
import type { Models } from './fixtures/generated/contract';
import type { MockRuntime, TestContract } from './helpers';
import {
  createMockRuntime,
  deserializeTestContract,
  getTestContext,
  getTestContract,
} from './helpers';

export type TestModelName = Extract<keyof Models, string>;

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
  const collection = new Collection({ runtime, context }, modelName, {
    namespaceId: soleDomainNamespaceId(context.contract.domain),
  });
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
  const raw = JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
  const capabilities = raw['capabilities'] as Record<string, Record<string, unknown>> | undefined;
  if (capabilities?.['sql']) {
    delete capabilities['sql']['defaultInInsert'];
  }
  return deserializeTestContract(raw);
}

export function createReturningCollectionWithoutDefaultInInsert<ModelName extends TestModelName>(
  modelName: ModelName,
): {
  collection: Collection<TestContract, ModelName>;
  runtime: MockRuntime;
} {
  const runtime = createMockRuntime();
  const context = contextForContract(withReturningCapability(withoutDefaultInInsert()));
  const collection = new Collection({ runtime, context }, modelName, {
    namespaceId: soleDomainNamespaceId(context.contract.domain),
  });
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
  const collection = new Collection({ runtime, context }, modelName, {
    namespaceId: soleDomainNamespaceId(context.contract.domain),
  });
  return {
    collection,
    runtime,
  };
}
