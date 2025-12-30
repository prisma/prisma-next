import type { ExtensionPackManifest } from './types';

// ============================================================================
// Framework Component Descriptor Base Types
// ============================================================================
// These shared descriptor interfaces define the common structure for framework
// component descriptors. Plane-specific descriptors (ControlFamilyDescriptor,
// RuntimeFamilyDescriptor, etc.) extend these bases.
//
// Key design decisions:
// - "Component" terminology (not "pack") to separate framework building blocks
//   from delivery mechanism
// - `kind` is extensible (Kind extends string) - no closed union
// - target-bound descriptors are generic in TFamilyId and TTargetId for type-safe
//   composition (e.g., prevent Postgres adapter with MySQL target)
// ============================================================================

/**
 * Base descriptor for any framework component.
 * Extended by family and target-bound descriptors.
 *
 * @template Kind - The component kind (e.g., 'family', 'target', 'adapter', 'driver', 'extension')
 */
export interface ComponentDescriptor<Kind extends string> {
  readonly kind: Kind;
  readonly id: string;
  readonly manifest: ExtensionPackManifest;
}

/**
 * Base descriptor for family components.
 * Extended by plane-specific descriptors (ControlFamilyDescriptor, RuntimeFamilyDescriptor).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 */
export interface FamilyDescriptor<TFamilyId extends string> extends ComponentDescriptor<'family'> {
  readonly familyId: TFamilyId;
}

/**
 * Base descriptor for target components.
 * Extended by plane-specific descriptors (ControlTargetDescriptor, RuntimeTargetDescriptor).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql', 'mongodb')
 */
export interface TargetDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'target'> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

/**
 * Base descriptor for adapter components.
 * Extended by plane-specific descriptors (ControlAdapterDescriptor, RuntimeAdapterDescriptor).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql', 'mongodb')
 */
export interface AdapterDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'adapter'> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

/**
 * Base descriptor for driver components.
 * Extended by plane-specific descriptors (ControlDriverDescriptor, RuntimeDriverDescriptor).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql', 'mongodb')
 */
export interface DriverDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'driver'> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

/**
 * Base descriptor for extension components.
 * Extended by plane-specific descriptors (ControlExtensionDescriptor, RuntimeExtensionDescriptor).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql', 'mongodb')
 */
export interface ExtensionDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'extension'> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}
