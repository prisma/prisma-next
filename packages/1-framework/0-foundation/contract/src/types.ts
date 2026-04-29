/**
 * Unique symbol used as the key for branding types.
 */
export const $: unique symbol = Symbol('__prisma_next_brand__');

/**
 * A helper type to brand a given type with a unique identifier.
 *
 * @template TKey Text used as the brand key.
 * @template TValue Optional value associated with the brand key. Defaults to `true`.
 */
export type Brand<TKey extends string | number | symbol, TValue = true> = {
  [$]: {
    [K in TKey]: TValue;
  };
};

/**
 * Base type for storage contract hashes.
 * Emitted contract.d.ts files use this with the hash value as a type parameter:
 * `type StorageHash = StorageHashBase<'sha256:abc123...'>`
 */
export type StorageHashBase<THash extends string> = THash & Brand<'StorageHash'>;

/**
 * Base type for execution contract hashes.
 * Emitted contract.d.ts files use this with the hash value as a type parameter:
 * `type ExecutionHash = ExecutionHashBase<'sha256:def456...'>`
 */
export type ExecutionHashBase<THash extends string> = THash & Brand<'ExecutionHash'>;

export function executionHash<const T extends string>(value: T): ExecutionHashBase<T> {
  return value as ExecutionHashBase<T>;
}

export function coreHash<const T extends string>(value: T): StorageHashBase<T> {
  return value as StorageHashBase<T>;
}

/**
 * Base type for profile contract hashes.
 * Emitted contract.d.ts files use this with the hash value as a type parameter:
 * `type ProfileHash = ProfileHashBase<'sha256:def456...'>`
 */
export type ProfileHashBase<THash extends string> = THash & Brand<'ProfileHash'>;

export function profileHash<const T extends string>(value: T): ProfileHashBase<T> {
  return value as ProfileHashBase<T>;
}

/**
 * Base type for family-specific storage blocks.
 * Family storage types (SqlStorage, MongoStorage, etc.) extend this to carry the
 * storage hash alongside family-specific data (tables, collections, etc.).
 */
export interface StorageBase<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
}

export interface FieldType {
  readonly type: string;
  readonly nullable: boolean;
  readonly items?: FieldType;
  readonly properties?: Record<string, FieldType>;
}

export type GeneratedValueSpec = {
  readonly id: string;
  readonly params?: Record<string, unknown>;
};

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type ColumnDefaultLiteralValue = JsonValue;

export type ColumnDefaultLiteralInputValue = ColumnDefaultLiteralValue | Date;

export type ColumnDefault =
  | {
      readonly kind: 'literal';
      readonly value: ColumnDefaultLiteralInputValue;
    }
  | { readonly kind: 'function'; readonly expression: string };

export type ExecutionMutationDefaultValue = {
  readonly kind: 'generator';
  readonly id: GeneratedValueSpec['id'];
  readonly params?: Record<string, unknown>;
};

export type ExecutionMutationDefault = {
  readonly ref: { readonly table: string; readonly column: string };
  readonly onCreate?: ExecutionMutationDefaultValue;
  readonly onUpdate?: ExecutionMutationDefaultValue;
};

export type ExecutionSection<THash extends string = string> = {
  readonly executionHash: ExecutionHashBase<THash>;
  readonly mutations: {
    readonly defaults: ReadonlyArray<ExecutionMutationDefault>;
  };
};

export interface Source {
  readonly readOnly: boolean;
  readonly projection: Record<string, FieldType>;
  readonly origin?: Record<string, unknown>;
  readonly capabilities?: Record<string, boolean>;
}

// Document family types
export interface DocIndex {
  readonly name: string;
  readonly keys: Record<string, 'asc' | 'desc'>;
  readonly unique?: boolean;
  readonly where?: Expr;
}

export type Expr =
  | { readonly kind: 'eq'; readonly path: ReadonlyArray<string>; readonly value: unknown }
  | { readonly kind: 'exists'; readonly path: ReadonlyArray<string> };

export interface DocCollection {
  readonly name: string;
  readonly id?: {
    readonly strategy: 'auto' | 'client' | 'uuid' | 'objectId';
  };
  readonly fields: Record<string, FieldType>;
  readonly indexes?: ReadonlyArray<DocIndex>;
  readonly readOnly?: boolean;
}

export interface PlanMeta {
  readonly target: string;
  readonly targetFamily?: string;
  readonly storageHash: string;
  readonly profileHash?: string;
  readonly lane: string;
  readonly annotations?: {
    readonly [key: string]: unknown;
  };
}

/**
 * Contract marker record stored in the database.
 * Represents the current contract identity for a database.
 */
export interface ContractMarkerRecord {
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson: unknown | null;
  readonly canonicalVersion: number | null;
  readonly updatedAt: Date;
  readonly appTag: string | null;
  readonly meta: Record<string, unknown>;
  readonly invariants: readonly string[];
}
