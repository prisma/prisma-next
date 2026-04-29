import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { SimplifyDeep } from '@prisma-next/utils/simplify-deep';
import { Collection } from '../src/collection';
import type { DefaultCollectionTypeState, InferRootRow } from '../src/types';
import type { MockRuntime, TestContract } from './helpers';
import { createMockRuntime, getTestContext, getTestContract } from './helpers';
import { createTestAnnotationRegistry, type TestRegistry } from './test-annotations';

export type TestModelName = Extract<keyof TestContract['models'], string>;

export const baseContract = getTestContract();

/**
 * Convenience alias matching `Collection<TContract, ModelName>` with all
 * defaults except for the `Registry` slot, which is bound to the
 * fixture's `TestRegistry`. Threading `TestRegistry` through to the
 * `Collection` instance makes `meta.cache(...)`, `meta.audit(...)`,
 * `meta.otel(...)` structurally available on the kind-filtered
 * `AnnotationBuilder` exposed by terminals' `annotateFn` callback.
 */
export type FixtureCollection<ModelName extends string> = Collection<
  TestContract,
  ModelName,
  SimplifyDeep<InferRootRow<TestContract, ModelName>>,
  DefaultCollectionTypeState,
  TestRegistry
>;

function contextForContract(contract: TestContract): ExecutionContext<TestContract> {
  const base = getTestContext();
  if (contract === baseContract) return base;
  return { ...base, contract } as ExecutionContext<TestContract>;
}

function buildCollection<ModelName extends TestModelName>(
  modelName: ModelName,
  context: ExecutionContext<TestContract>,
): { collection: FixtureCollection<ModelName>; runtime: MockRuntime } {
  const runtime = createMockRuntime();
  const annotationRegistry = createTestAnnotationRegistry();
  // The `Registry` generic on `Collection` is invariantly the default
  // `{}` when constructed without an explicit type argument because the
  // constructor parameters don't reference `Registry`. Re-typing the
  // instance to thread `TestRegistry` through so the test bodies see
  // `meta.cache(...)` / `meta.audit(...)` / `meta.otel(...)` is the
  // single concession to the structurally-derived builder.
  const collection = new Collection(
    { runtime, context, annotationRegistry },
    modelName,
  ) as unknown as FixtureCollection<ModelName>;
  return { collection, runtime };
}

export function createCollectionFor<ModelName extends TestModelName>(
  modelName: ModelName,
  contract: TestContract = baseContract,
): { collection: FixtureCollection<ModelName>; runtime: MockRuntime } {
  return buildCollection(modelName, contextForContract(contract));
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
): { collection: FixtureCollection<ModelName>; runtime: MockRuntime } {
  return buildCollection(
    modelName,
    contextForContract(withReturningCapability(withoutDefaultInInsert())),
  );
}

export function createReturningCollectionFor<ModelName extends TestModelName>(
  modelName: ModelName,
): { collection: FixtureCollection<ModelName>; runtime: MockRuntime } {
  return buildCollection(modelName, contextForContract(withReturningCapability()));
}
