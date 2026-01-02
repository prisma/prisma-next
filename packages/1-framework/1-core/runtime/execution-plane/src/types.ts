import type {
  AdapterDescriptor,
  AdapterInstance,
  DriverDescriptor,
  DriverInstance,
  ExtensionDescriptor,
  ExtensionInstance,
  FamilyDescriptor,
  FamilyInstance,
  TargetDescriptor,
  TargetInstance,
} from '@prisma-next/contract/framework-components';

// ============================================================================
// Runtime*Instance Base Interfaces
// ============================================================================

/**
 * Runtime-plane family instance interface.
 * Extends the base FamilyInstance for runtime-plane specific methods.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 */
export interface RuntimeFamilyInstance<TFamilyId extends string> extends FamilyInstance<TFamilyId> {
  // Placeholder for future runtime-plane-specific methods
}

/**
 * Runtime-plane target instance interface.
 * Extends the base TargetInstance with runtime-plane specific behavior.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface RuntimeTargetInstance<TFamilyId extends string, TTargetId extends string>
  extends TargetInstance<TFamilyId, TTargetId> {}

/**
 * Runtime-plane adapter instance interface.
 * Extends the base AdapterInstance with runtime-plane specific behavior.
 * Families extend this with family-specific adapter interfaces.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface RuntimeAdapterInstance<TFamilyId extends string, TTargetId extends string>
  extends AdapterInstance<TFamilyId, TTargetId> {}

/**
 * Runtime-plane driver instance interface.
 * Extends the base DriverInstance with runtime-plane specific behavior.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface RuntimeDriverInstance<TFamilyId extends string, TTargetId extends string>
  extends DriverInstance<TFamilyId, TTargetId> {}

/**
 * Runtime-plane extension instance interface.
 * Extends the base ExtensionInstance with runtime-plane specific behavior.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface RuntimeExtensionInstance<TFamilyId extends string, TTargetId extends string>
  extends ExtensionInstance<TFamilyId, TTargetId> {}

// ============================================================================
// Runtime*Descriptor Interfaces (ADR 152)
// ============================================================================

/**
 * Descriptor for an execution/runtime-plane family (e.g., SQL).
 * Provides factory method to create runtime family instance.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TFamilyInstance - The family instance type
 */
export interface RuntimeFamilyDescriptor<
  TFamilyId extends string,
  TFamilyInstance extends RuntimeFamilyInstance<TFamilyId> = RuntimeFamilyInstance<TFamilyId>,
> extends FamilyDescriptor<TFamilyId> {
  create<TTargetId extends string>(options: {
    readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
    readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
    readonly driver: RuntimeDriverDescriptor<TFamilyId, TTargetId>;
    readonly extensionPacks: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
  }): TFamilyInstance;
}

/**
 * Descriptor for an execution/runtime-plane target component (e.g., Postgres target).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TTargetInstance - The target instance type
 */
export interface RuntimeTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TTargetInstance extends RuntimeTargetInstance<TFamilyId, TTargetId> = RuntimeTargetInstance<
    TFamilyId,
    TTargetId
  >,
> extends TargetDescriptor<TFamilyId, TTargetId> {
  create(): TTargetInstance;
}

/**
 * Descriptor for an execution/runtime-plane adapter component (e.g., Postgres adapter).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TAdapterInstance - The adapter instance type
 */
export interface RuntimeAdapterDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends RuntimeAdapterInstance<TFamilyId, TTargetId> = RuntimeAdapterInstance<
    TFamilyId,
    TTargetId
  >,
> extends AdapterDescriptor<TFamilyId, TTargetId> {
  create(): TAdapterInstance;
}

/**
 * Descriptor for an execution/runtime-plane driver component (e.g., Postgres driver).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TDriverInstance - The driver instance type
 */
export interface RuntimeDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TDriverInstance extends RuntimeDriverInstance<TFamilyId, TTargetId> = RuntimeDriverInstance<
    TFamilyId,
    TTargetId
  >,
> extends DriverDescriptor<TFamilyId, TTargetId> {
  create(options: unknown): TDriverInstance;
}

/**
 * Descriptor for an execution/runtime-plane extension component (e.g., pgvector).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TExtensionInstance - The extension instance type
 */
export interface RuntimeExtensionDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TExtensionInstance extends RuntimeExtensionInstance<
    TFamilyId,
    TTargetId
  > = RuntimeExtensionInstance<TFamilyId, TTargetId>,
> extends ExtensionDescriptor<TFamilyId, TTargetId> {
  create(): TExtensionInstance;
}
