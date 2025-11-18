import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';

// ============================================================================
// Runtime*Instance Base Interfaces (ADR 152)
// ============================================================================

/**
 * Base interface for execution/runtime-plane family instances.
 * Families extend this with domain-specific methods.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 */
export interface RuntimeFamilyInstance<TFamilyId extends string = string> {
  readonly familyId: TFamilyId;
}

/**
 * Base interface for execution/runtime-plane target instances.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface RuntimeTargetInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

/**
 * Base interface for execution/runtime-plane adapter instances.
 * Families extend this with family-specific adapter interfaces.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface RuntimeAdapterInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

/**
 * Base interface for execution/runtime-plane driver instances.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface RuntimeDriverInstance<TTargetId extends string = string> {
  readonly targetId?: TTargetId;
}

/**
 * Base interface for execution/runtime-plane extension instances.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface RuntimeExtensionInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

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
> {
  readonly kind: 'family';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly manifest: ExtensionPackManifest;
  create<TTargetId extends string>(options: {
    readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
    readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
    readonly driver: RuntimeDriverDescriptor<TFamilyId, TTargetId>;
    readonly extensions: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
  }): TFamilyInstance;
}

/**
 * Descriptor for an execution/runtime-plane target pack (e.g., Postgres target).
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
> {
  readonly kind: 'target';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  readonly manifest: ExtensionPackManifest;
  create(): TTargetInstance;
}

/**
 * Descriptor for an execution/runtime-plane adapter pack (e.g., Postgres adapter).
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
> {
  readonly kind: 'adapter';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  readonly manifest: ExtensionPackManifest;
  create(): TAdapterInstance;
}

/**
 * Descriptor for an execution/runtime-plane driver pack (e.g., Postgres driver).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TDriverInstance - The driver instance type
 */
export interface RuntimeDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TDriverInstance extends RuntimeDriverInstance<TTargetId> = RuntimeDriverInstance<TTargetId>,
> {
  readonly kind: 'driver';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  readonly manifest: ExtensionPackManifest;
  create(options: unknown): TDriverInstance;
}

/**
 * Descriptor for an execution/runtime-plane extension pack (e.g., pgvector).
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
> {
  readonly kind: 'extension';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  readonly manifest: ExtensionPackManifest;
  create(): TExtensionInstance;
}
