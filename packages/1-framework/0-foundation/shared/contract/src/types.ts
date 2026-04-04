import type { Contract } from './contract-types';

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

export type TaggedBigInt = { readonly $type: 'bigint'; readonly value: string };

export function isTaggedBigInt(value: unknown): value is TaggedBigInt {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { $type?: unknown }).$type === 'bigint' &&
    typeof (value as { value?: unknown }).value === 'string'
  );
}

export function bigintJsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { $type: 'bigint', value: value.toString() } satisfies TaggedBigInt;
  }
  return value;
}

export type TaggedRaw = { readonly $type: 'raw'; readonly value: JsonValue };

export function isTaggedRaw(value: unknown): value is TaggedRaw {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { $type?: unknown }).$type === 'raw' &&
    'value' in (value as object)
  );
}

export type TaggedLiteralValue = TaggedBigInt | TaggedRaw;

export type ColumnDefaultLiteralValue = JsonValue | TaggedLiteralValue;

export type ColumnDefaultLiteralInputValue = ColumnDefaultLiteralValue | bigint | Date;

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

export interface DocumentStorage extends StorageBase {
  readonly document: {
    readonly collections: Record<string, DocCollection>;
  };
}

export type DocumentContract = Contract<DocumentStorage>;

// Plan types - target-family agnostic execution types
export interface ParamDescriptor {
  readonly index?: number;
  readonly name?: string;
  readonly codecId?: string;
  readonly nativeType?: string;
  readonly nullable?: boolean;
  readonly source: 'dsl' | 'raw' | 'lane';
  readonly refs?: { table: string; column: string };
}

export interface PlanRefs {
  readonly tables?: readonly string[];
  readonly columns?: ReadonlyArray<{ table: string; column: string }>;
  readonly indexes?: ReadonlyArray<{
    readonly table: string;
    readonly columns: ReadonlyArray<string>;
    readonly name?: string;
  }>;
}

export interface PlanMeta {
  readonly target: string;
  readonly targetFamily?: string;
  readonly storageHash: string;
  readonly profileHash?: string;
  readonly lane: string;
  readonly annotations?: {
    codecs?: Record<string, string>; // alias/param → codec id ('ns/name@v')
    [key: string]: unknown;
  };
  readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
  readonly refs?: PlanRefs;
  readonly projection?: Record<string, string> | ReadonlyArray<string>;
  /**
   * Optional mapping of projection alias → column type ID (fully qualified ns/name@version).
   * Used for codec resolution when AST+refs don't provide enough type info.
   */
  readonly projectionTypes?: Record<string, string>;
}

/**
 * Canonical execution plan shape used by runtimes.
 *
 * - Row is the inferred result row type (TypeScript-only).
 * - Ast is the optional, family-specific AST type (e.g. SQL QueryAst).
 *
 * The payload executed by the runtime is represented by the sql + params pair
 * for now; future families can specialize this via Ast or additional metadata.
 */
export interface ExecutionPlan<Row = unknown, Ast = unknown> {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly ast?: Ast;
  readonly meta: PlanMeta;
  /**
   * Phantom property to carry the Row generic for type-level utilities.
   * Not set at runtime; used only for ResultType extraction.
   */
  readonly _row?: Row;
}

/**
 * Utility type to extract the Row type from an ExecutionPlan.
 * Example: `type Row = ResultType<typeof plan>`
 *
 * Works with both ExecutionPlan and SqlQueryPlan (SQL query plans before lowering).
 * SqlQueryPlan includes a phantom `_Row` property to preserve the generic parameter
 * for type extraction.
 */
export type ResultType<P> =
  P extends ExecutionPlan<infer R, unknown> ? R : P extends { readonly _Row?: infer R } ? R : never;

/**
 * Type guard to check if a contract is a Document contract
 */
export function isDocumentContract(contract: unknown): contract is DocumentContract {
  return (
    typeof contract === 'object' &&
    contract !== null &&
    'targetFamily' in contract &&
    contract.targetFamily === 'document'
  );
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
}
