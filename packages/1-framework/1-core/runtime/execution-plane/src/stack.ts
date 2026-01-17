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

export interface ExecutionStack<TFamilyId extends string, TTargetId extends string> {
  readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
  readonly driver: RuntimeDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
}

export interface ExecutionStackInstance<TFamilyId extends string, TTargetId extends string> {
  readonly stack: ExecutionStack<TFamilyId, TTargetId>;
  readonly target: RuntimeTargetInstance<TFamilyId, TTargetId>;
  readonly adapter: RuntimeAdapterInstance<TFamilyId, TTargetId>;
  readonly extensionPacks: readonly RuntimeExtensionInstance<TFamilyId, TTargetId>[];
}

export function createExecutionStack<TFamilyId extends string, TTargetId extends string>(input: {
  readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
  readonly driver?: RuntimeDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks?: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[] | undefined;
}): ExecutionStack<TFamilyId, TTargetId> {
  return {
    target: input.target,
    adapter: input.adapter,
    driver: input.driver,
    extensionPacks: input.extensionPacks ?? [],
  };
}

export function instantiateExecutionStack<TFamilyId extends string, TTargetId extends string>(
  stack: ExecutionStack<TFamilyId, TTargetId>,
): ExecutionStackInstance<TFamilyId, TTargetId> {
  return {
    stack,
    target: stack.target.create(),
    adapter: stack.adapter.create(),
    extensionPacks: stack.extensionPacks.map((descriptor) => descriptor.create()),
  };
}
