import { checkContractComponentRequirements } from '@prisma-next/contract/framework-components';
import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/core-execution-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type {
  SqlRuntimeAdapterInstance,
  SqlRuntimeDriverInstance,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeExtensionInstance,
} from './sql-context';
import { createExecutionContextFromInstances } from './sql-context';

export interface ExecutionStack<TTargetId extends string = string> {
  readonly target: RuntimeTargetDescriptor<'sql', TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>
  >;
  readonly driver:
    | RuntimeDriverDescriptor<'sql', TTargetId, SqlRuntimeDriverInstance<TTargetId>>
    | undefined;
  readonly extensionPacks: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];

  createContext<TContract extends SqlContract<SqlStorage>>(options: {
    readonly contract: TContract;
  }): ExecutionContext<TContract>;
}

type ExecutionStackInstances<TTargetId extends string> = {
  readonly adapterInstance: SqlRuntimeAdapterInstance<TTargetId>;
  readonly extensionInstances: ReadonlyArray<SqlRuntimeExtensionInstance<TTargetId>>;
};

const executionStackInstancesSymbol = Symbol('executionStackInstances');

function assertExecutionStackContractRequirements<TTargetId extends string>(
  contract: SqlContract<SqlStorage>,
  stack: ExecutionStack<TTargetId>,
): void {
  const providedComponentIds = new Set<string>([
    stack.target.id,
    stack.adapter.id,
    ...stack.extensionPacks.map((pack) => pack.id),
  ]);

  const result = checkContractComponentRequirements({
    contract,
    expectedTargetFamily: 'sql',
    expectedTargetId: stack.target.targetId,
    providedComponentIds,
  });

  if (result.familyMismatch) {
    throw new Error(
      `Contract target family '${result.familyMismatch.actual}' does not match runtime family '${result.familyMismatch.expected}'.`,
    );
  }

  if (result.targetMismatch) {
    throw new Error(
      `Contract target '${result.targetMismatch.actual}' does not match runtime target descriptor '${result.targetMismatch.expected}'.`,
    );
  }

  for (const packId of result.missingExtensionPackIds) {
    throw new Error(
      `Contract requires extension pack '${packId}', but runtime descriptors do not provide a matching component.`,
    );
  }
}

export function createExecutionStack<TTargetId extends string>(input: {
  readonly target: RuntimeTargetDescriptor<'sql', TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>
  >;
  readonly driver?: RuntimeDriverDescriptor<'sql', TTargetId, SqlRuntimeDriverInstance<TTargetId>>;
  readonly extensionPacks?: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}): ExecutionStack<TTargetId> &
  Readonly<{ [executionStackInstancesSymbol]: ExecutionStackInstances<TTargetId> }> {
  const extensionPacks = input.extensionPacks ?? [];
  const adapterInstance = input.adapter.create();
  const extensionInstances = extensionPacks.map((descriptor) => descriptor.create());

  const stack = {
    target: input.target,
    adapter: input.adapter,
    driver: input.driver,
    extensionPacks,
    createContext<TContract extends SqlContract<SqlStorage>>({
      contract,
    }: {
      readonly contract: TContract;
    }): ExecutionContext<TContract> {
      assertExecutionStackContractRequirements(contract, stack);
      return createExecutionContextFromInstances({
        contract,
        adapterInstance,
        extensionInstances,
      });
    },
    [executionStackInstancesSymbol]: {
      adapterInstance,
      extensionInstances,
    },
  } as const;

  return stack;
}

export function getExecutionStackInstances<TTargetId extends string>(
  stack: ExecutionStack<TTargetId>,
): ExecutionStackInstances<TTargetId> {
  const instances = (
    stack as ExecutionStack<TTargetId> & {
      readonly [executionStackInstancesSymbol]?: ExecutionStackInstances<TTargetId>;
    }
  )[executionStackInstancesSymbol];

  if (!instances) {
    throw new Error('ExecutionStack instances are unavailable');
  }

  return instances;
}

export { assertExecutionStackContractRequirements };
