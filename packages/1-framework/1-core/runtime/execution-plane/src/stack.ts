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

type FamilyIdOf<TTargetDescriptor> =
  TTargetDescriptor extends RuntimeTargetDescriptor<
    infer TFamilyId,
    infer _TTargetId,
    infer _TTargetInstance
  >
    ? TFamilyId
    : never;

type TargetIdOf<TTargetDescriptor> =
  TTargetDescriptor extends RuntimeTargetDescriptor<
    infer _TFamilyId,
    infer TTargetId,
    infer _TTargetInstance
  >
    ? TTargetId
    : never;

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
  TTargetDescriptor extends RuntimeTargetDescriptor<string, string>,
  TAdapterInstance extends RuntimeAdapterInstance<
    FamilyIdOf<TTargetDescriptor>,
    TargetIdOf<TTargetDescriptor>
  >,
  TAdapterDescriptor extends RuntimeAdapterDescriptor<
    FamilyIdOf<TTargetDescriptor>,
    TargetIdOf<TTargetDescriptor>,
    TAdapterInstance
  >,
  TDriverInstance extends RuntimeDriverInstance<
    FamilyIdOf<TTargetDescriptor>,
    TargetIdOf<TTargetDescriptor>
  > = RuntimeDriverInstance<FamilyIdOf<TTargetDescriptor>, TargetIdOf<TTargetDescriptor>>,
  TDriverDescriptor extends
    | RuntimeDriverDescriptor<
        FamilyIdOf<TTargetDescriptor>,
        TargetIdOf<TTargetDescriptor>,
        TDriverInstance
      >
    | undefined = undefined,
  TExtensionInstance extends RuntimeExtensionInstance<
    FamilyIdOf<TTargetDescriptor>,
    TargetIdOf<TTargetDescriptor>
  > = RuntimeExtensionInstance<FamilyIdOf<TTargetDescriptor>, TargetIdOf<TTargetDescriptor>>,
  TExtensionDescriptor extends RuntimeExtensionDescriptor<
    FamilyIdOf<TTargetDescriptor>,
    TargetIdOf<TTargetDescriptor>,
    TExtensionInstance
  > = never,
>(input: {
  readonly target: TTargetDescriptor;
  readonly adapter: TAdapterDescriptor;
  readonly driver?: TDriverDescriptor | undefined;
  readonly extensionPacks?: readonly TExtensionDescriptor[] | undefined;
}): Omit<
  ExecutionStack<
    FamilyIdOf<TTargetDescriptor>,
    TargetIdOf<TTargetDescriptor>,
    TAdapterInstance,
    TDriverInstance,
    TExtensionInstance
  >,
  'target' | 'adapter' | 'driver' | 'extensionPacks'
> & {
  readonly target: TTargetDescriptor;
  readonly adapter: TAdapterDescriptor;
  readonly driver: TDriverDescriptor | undefined;
  readonly extensionPacks: readonly TExtensionDescriptor[];
} {
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
