import type { ExtensionPackManifest } from './types';

// ============================================================================
// Framework Component Descriptor Base Types
// ============================================================================
//
// Prisma Next uses a modular architecture where functionality is composed from
// discrete "components". Each component has a descriptor that identifies it and
// provides metadata. These base types define the shared structure for all
// component descriptors across both control-plane (CLI/tooling) and runtime-plane.
//
// Component Hierarchy:
//
//   Family (e.g., 'sql', 'document')
//     └── Target (e.g., 'postgres', 'mysql', 'mongodb')
//           ├── Adapter (protocol/dialect implementation)
//           ├── Driver (connection/execution layer)
//           └── Extension (optional capabilities like pgvector)
//
// Key design decisions:
// - "Component" terminology separates framework building blocks from delivery
//   mechanism ("pack" refers to how components are packaged/distributed)
// - `kind` is extensible (Kind extends string) - no closed union, allowing
//   ecosystem authors to define new component kinds
// - Target-bound descriptors are generic in TFamilyId and TTargetId for type-safe
//   composition (e.g., TypeScript rejects Postgres adapter with MySQL target)
//
// ============================================================================

/**
 * Base descriptor for any framework component.
 *
 * All component descriptors share these fundamental properties that identify
 * the component and provide its metadata. This interface is extended by
 * specific descriptor types (FamilyDescriptor, TargetDescriptor, etc.).
 *
 * @template Kind - Discriminator literal identifying the component type.
 *   Built-in kinds are 'family', 'target', 'adapter', 'driver', 'extension',
 *   but the type accepts any string to allow ecosystem extensions.
 *
 * @example
 * ```ts
 * // All descriptors have these properties
 * descriptor.kind     // The Kind type parameter (e.g., 'family', 'target', or custom kinds)
 * descriptor.id       // Unique string identifier (e.g., 'sql', 'postgres')
 * descriptor.manifest // Package metadata (version, capabilities, types, etc.)
 * ```
 */
export interface ComponentDescriptor<Kind extends string> {
  /** Discriminator identifying the component type */
  readonly kind: Kind;

  /** Unique identifier for this component (e.g., 'sql', 'postgres', 'pgvector') */
  readonly id: string;

  /** Package manifest containing version, capabilities, type imports, and operations */
  readonly manifest: ExtensionPackManifest;
}

/**
 * Descriptor for a family component.
 *
 * A "family" represents a category of data sources with shared semantics
 * (e.g., SQL databases, document stores). Families define:
 * - Query semantics and operations (SELECT, INSERT, find, aggregate, etc.)
 * - Contract structure (tables vs collections, columns vs fields)
 * - Type system and codecs
 *
 * Families are the top-level grouping. Each family contains multiple targets
 * (e.g., SQL family contains Postgres, MySQL, SQLite targets).
 *
 * Extended by plane-specific descriptors:
 * - `ControlFamilyDescriptor` - adds `hook` for CLI/tooling operations
 * - `RuntimeFamilyDescriptor` - adds runtime-specific factory methods
 *
 * @template TFamilyId - Literal type for the family identifier (e.g., 'sql', 'document')
 *
 * @example
 * ```ts
 * import sql from '@prisma-next/family-sql/control';
 *
 * sql.kind     // 'family'
 * sql.familyId // 'sql'
 * sql.id       // 'sql'
 * ```
 */
export interface FamilyDescriptor<TFamilyId extends string> extends ComponentDescriptor<'family'> {
  /** The family identifier (e.g., 'sql', 'document') */
  readonly familyId: TFamilyId;
}

/**
 * Descriptor for a target component.
 *
 * A "target" represents a specific database or data store within a family
 * (e.g., Postgres, MySQL, MongoDB). Targets define:
 * - Native type mappings (e.g., Postgres int4 → TypeScript number)
 * - Target-specific capabilities (e.g., RETURNING, LATERAL joins)
 * - Version constraints and compatibility
 *
 * Targets are bound to a family and provide the target-specific implementation
 * details that adapters and drivers use.
 *
 * Extended by plane-specific descriptors:
 * - `ControlTargetDescriptor` - adds optional `migrations` capability
 * - `RuntimeTargetDescriptor` - adds runtime factory method
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier (e.g., 'postgres', 'mysql')
 *
 * @example
 * ```ts
 * import postgres from '@prisma-next/target-postgres/control';
 *
 * postgres.kind     // 'target'
 * postgres.familyId // 'sql'
 * postgres.targetId // 'postgres'
 * ```
 */
export interface TargetDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'target'> {
  /** The family this target belongs to */
  readonly familyId: TFamilyId;

  /** The target identifier (e.g., 'postgres', 'mysql', 'mongodb') */
  readonly targetId: TTargetId;
}

/**
 * Descriptor for an adapter component.
 *
 * An "adapter" provides the protocol and dialect implementation for a target.
 * Adapters handle:
 * - SQL/query generation (lowering AST to target-specific syntax)
 * - Codec registration (encoding/decoding between JS and wire types)
 * - Type mappings and coercions
 *
 * Adapters are bound to a specific family+target combination and work with
 * any compatible driver for that target.
 *
 * Extended by plane-specific descriptors:
 * - `ControlAdapterDescriptor` - control-plane factory
 * - `RuntimeAdapterDescriptor` - runtime factory
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier
 *
 * @example
 * ```ts
 * import postgresAdapter from '@prisma-next/adapter-postgres/control';
 *
 * postgresAdapter.kind     // 'adapter'
 * postgresAdapter.familyId // 'sql'
 * postgresAdapter.targetId // 'postgres'
 * ```
 */
export interface AdapterDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'adapter'> {
  /** The family this adapter belongs to */
  readonly familyId: TFamilyId;

  /** The target this adapter is designed for */
  readonly targetId: TTargetId;
}

/**
 * Descriptor for a driver component.
 *
 * A "driver" provides the connection and execution layer for a target.
 * Drivers handle:
 * - Connection management (pooling, timeouts, retries)
 * - Query execution (sending SQL/commands, receiving results)
 * - Transaction management
 * - Wire protocol communication
 *
 * Drivers are bound to a specific family+target and work with any compatible
 * adapter. Multiple drivers can exist for the same target (e.g., node-postgres
 * vs postgres.js for Postgres).
 *
 * Extended by plane-specific descriptors:
 * - `ControlDriverDescriptor` - creates driver from connection URL
 * - `RuntimeDriverDescriptor` - creates driver with runtime options
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier
 *
 * @example
 * ```ts
 * import postgresDriver from '@prisma-next/driver-postgres/control';
 *
 * postgresDriver.kind     // 'driver'
 * postgresDriver.familyId // 'sql'
 * postgresDriver.targetId // 'postgres'
 * ```
 */
export interface DriverDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'driver'> {
  /** The family this driver belongs to */
  readonly familyId: TFamilyId;

  /** The target this driver connects to */
  readonly targetId: TTargetId;
}

/**
 * Descriptor for an extension component.
 *
 * An "extension" adds optional capabilities to a target. Extensions can provide:
 * - Additional operations (e.g., vector similarity search with pgvector)
 * - Custom types and codecs (e.g., vector type)
 * - Extended query capabilities
 *
 * Extensions are bound to a specific family+target and are registered in the
 * config alongside the core components. Multiple extensions can be used together.
 *
 * Extended by plane-specific descriptors:
 * - `ControlExtensionDescriptor` - control-plane extension factory
 * - `RuntimeExtensionDescriptor` - runtime extension factory
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier
 *
 * @example
 * ```ts
 * import pgvector from '@prisma-next/extension-pgvector/control';
 *
 * pgvector.kind     // 'extension'
 * pgvector.familyId // 'sql'
 * pgvector.targetId // 'postgres'
 * ```
 */
export interface ExtensionDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'extension'> {
  /** The family this extension belongs to */
  readonly familyId: TFamilyId;

  /** The target this extension is designed for */
  readonly targetId: TTargetId;
}

/**
 * Union type for target-bound component descriptors.
 *
 * Target-bound components are those that must be compatible with a specific
 * family+target combination. This includes targets, adapters, drivers, and
 * extensions. Families are not target-bound.
 *
 * This type is used in migration and verification interfaces to enforce
 * type-level compatibility between components.
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier
 *
 * @example
 * ```ts
 * // All these components must have matching familyId and targetId
 * const components: TargetBoundComponentDescriptor<'sql', 'postgres'>[] = [
 *   postgresTarget,
 *   postgresAdapter,
 *   postgresDriver,
 *   pgvectorExtension,
 * ];
 * ```
 */
export type TargetBoundComponentDescriptor<TFamilyId extends string, TTargetId extends string> =
  | TargetDescriptor<TFamilyId, TTargetId>
  | AdapterDescriptor<TFamilyId, TTargetId>
  | DriverDescriptor<TFamilyId, TTargetId>
  | ExtensionDescriptor<TFamilyId, TTargetId>;

// ============================================================================
// Framework Component Instance Base Types
// ============================================================================
//
// These are minimal, identity-only interfaces for component instances.
// They carry the component's identity (familyId, targetId) without any
// behavior methods. Plane-specific interfaces (ControlFamilyInstance,
// RuntimeFamilyInstance, etc.) extend these bases and add domain actions.
//
// ============================================================================

/**
 * Base interface for family instances.
 *
 * A family instance is created by a family descriptor's `create()` method.
 * This base interface carries only the identity; plane-specific interfaces
 * add domain actions (e.g., `emitContract`, `verify` on ControlFamilyInstance).
 *
 * @template TFamilyId - Literal type for the family identifier (e.g., 'sql', 'document')
 *
 * @example
 * ```ts
 * const instance = sql.create({ target, adapter, driver, extensions });
 * instance.familyId // 'sql'
 * ```
 */
export interface FamilyInstance<TFamilyId extends string> {
  /** The family identifier (e.g., 'sql', 'document') */
  readonly familyId: TFamilyId;
}

/**
 * Base interface for target instances.
 *
 * A target instance is created by a target descriptor's `create()` method.
 * This base interface carries only the identity; plane-specific interfaces
 * add target-specific behavior.
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier (e.g., 'postgres', 'mysql')
 *
 * @example
 * ```ts
 * const instance = postgres.create();
 * instance.familyId // 'sql'
 * instance.targetId // 'postgres'
 * ```
 */
export interface TargetInstance<TFamilyId extends string, TTargetId extends string> {
  /** The family this target belongs to */
  readonly familyId: TFamilyId;

  /** The target identifier (e.g., 'postgres', 'mysql', 'mongodb') */
  readonly targetId: TTargetId;
}

/**
 * Base interface for adapter instances.
 *
 * An adapter instance is created by an adapter descriptor's `create()` method.
 * This base interface carries only the identity; plane-specific interfaces
 * add adapter-specific behavior (e.g., codec registration, query lowering).
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier
 *
 * @example
 * ```ts
 * const instance = postgresAdapter.create();
 * instance.familyId // 'sql'
 * instance.targetId // 'postgres'
 * ```
 */
export interface AdapterInstance<TFamilyId extends string, TTargetId extends string> {
  /** The family this adapter belongs to */
  readonly familyId: TFamilyId;

  /** The target this adapter is designed for */
  readonly targetId: TTargetId;
}

/**
 * Base interface for driver instances.
 *
 * A driver instance is created by a driver descriptor's `create()` method.
 * This base interface carries only the identity; plane-specific interfaces
 * add driver-specific behavior (e.g., `query`, `close` on ControlDriverInstance).
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier
 *
 * @example
 * ```ts
 * const instance = postgresDriver.create({ databaseUrl });
 * instance.familyId // 'sql'
 * instance.targetId // 'postgres'
 * ```
 */
export interface DriverInstance<TFamilyId extends string, TTargetId extends string> {
  /** The family this driver belongs to */
  readonly familyId: TFamilyId;

  /** The target this driver connects to */
  readonly targetId: TTargetId;
}

/**
 * Base interface for extension instances.
 *
 * An extension instance is created by an extension descriptor's `create()` method.
 * This base interface carries only the identity; plane-specific interfaces
 * add extension-specific behavior.
 *
 * @template TFamilyId - Literal type for the family identifier
 * @template TTargetId - Literal type for the target identifier
 *
 * @example
 * ```ts
 * const instance = pgvector.create();
 * instance.familyId // 'sql'
 * instance.targetId // 'postgres'
 * ```
 */
export interface ExtensionInstance<TFamilyId extends string, TTargetId extends string> {
  /** The family this extension belongs to */
  readonly familyId: TFamilyId;

  /** The target this extension is designed for */
  readonly targetId: TTargetId;
}
