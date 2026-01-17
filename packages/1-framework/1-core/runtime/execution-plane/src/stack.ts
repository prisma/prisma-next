import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
  RuntimeExtensionDescriptor,
  RuntimeExtensionInstance,
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from './types';

export interface ExecutionStack<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends RuntimeAdapterInstance<TFamilyId, TTargetId> = RuntimeAdapterInstance<
    TFamilyId,
    TTargetId
  >,
  TDriverInstance extends RuntimeDriverInstance<TFamilyId, TTargetId> = RuntimeDriverInstance<
    TFamilyId,
    TTargetId
  >,
  TExtensionInstance extends RuntimeExtensionInstance<
    TFamilyId,
    TTargetId
  > = RuntimeExtensionInstance<TFamilyId, TTargetId>,
> {
  readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId, TAdapterInstance>;
  readonly driver: RuntimeDriverDescriptor<TFamilyId, TTargetId, TDriverInstance> | undefined;
  readonly extensionPacks: readonly RuntimeExtensionDescriptor<
    TFamilyId,
    TTargetId,
    TExtensionInstance
  >[];
}

export interface ExecutionStackInstance<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends RuntimeAdapterInstance<TFamilyId, TTargetId> = RuntimeAdapterInstance<
    TFamilyId,
    TTargetId
  >,
  TDriverInstance extends RuntimeDriverInstance<TFamilyId, TTargetId> = RuntimeDriverInstance<
    TFamilyId,
    TTargetId
  >,
  TExtensionInstance extends RuntimeExtensionInstance<
    TFamilyId,
    TTargetId
  > = RuntimeExtensionInstance<TFamilyId, TTargetId>,
> {
  readonly stack: ExecutionStack<
    TFamilyId,
    TTargetId,
    TAdapterInstance,
    TDriverInstance,
    TExtensionInstance
  >;
  readonly target: RuntimeTargetInstance<TFamilyId, TTargetId>;
  readonly adapter: TAdapterInstance;
  readonly extensionPacks: readonly TExtensionInstance[];
}

export function createExecutionStack<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends RuntimeAdapterInstance<TFamilyId, TTargetId>,
  TDriverInstance extends RuntimeDriverInstance<TFamilyId, TTargetId>,
  TExtensionInstance extends RuntimeExtensionInstance<TFamilyId, TTargetId>,
>(input: {
  readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId, TAdapterInstance>;
  readonly driver?: RuntimeDriverDescriptor<TFamilyId, TTargetId, TDriverInstance> | undefined;
  readonly extensionPacks?:
    | readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId, TExtensionInstance>[]
    | undefined;
}): ExecutionStack<TFamilyId, TTargetId, TAdapterInstance, TDriverInstance, TExtensionInstance> {
  return {
    target: input.target,
    adapter: input.adapter,
    driver: input.driver,
    extensionPacks: input.extensionPacks ?? [],
  };
}

export function instantiateExecutionStack<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends RuntimeAdapterInstance<TFamilyId, TTargetId>,
  TDriverInstance extends RuntimeDriverInstance<TFamilyId, TTargetId>,
  TExtensionInstance extends RuntimeExtensionInstance<TFamilyId, TTargetId>,
>(
  stack: ExecutionStack<
    TFamilyId,
    TTargetId,
    TAdapterInstance,
    TDriverInstance,
    TExtensionInstance
  >,
): ExecutionStackInstance<
  TFamilyId,
  TTargetId,
  TAdapterInstance,
  TDriverInstance,
  TExtensionInstance
> {
  return {
    stack,
    target: stack.target.create(),
    adapter: stack.adapter.create(),
    extensionPacks: stack.extensionPacks.map((descriptor) => descriptor.create()),
  };
}
