import type { OperationRegistry } from '@prisma-next/operations';
import type { ContractIR } from './ir';

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
 * Context passed to type renderers during contract.d.ts generation.
 */
export interface RenderTypeContext {
  /** The name of the CodecTypes type alias (typically 'CodecTypes') */
  readonly codecTypesName: string;
}

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

export interface ContractBase<
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
> {
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly storageHash: TStorageHash;
  readonly executionHash?: TExecutionHash | undefined;
  readonly profileHash?: TProfileHash | undefined;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensionPacks: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly sources: Record<string, Source>;
  readonly execution?: ExecutionSection;
}

export interface FieldType {
  readonly type: string;
  readonly nullable: boolean;
  readonly items?: FieldType;
  readonly properties?: Record<string, FieldType>;
}

export type GeneratedValueSpec = {
  readonly id: 'ulid' | 'nanoid' | 'uuidv7' | 'uuidv4' | 'cuid2' | 'ksuid';
  readonly params?: Record<string, unknown>;
};

export type ColumnDefault =
  | {
      readonly kind: 'literal';
      readonly expression: string;
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

export type ExecutionSection = {
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

export interface DocumentStorage {
  readonly document: {
    readonly collections: Record<string, DocCollection>;
  };
}

export interface DocumentContract<
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
> extends ContractBase<TStorageHash, TExecutionHash, TProfileHash> {
  // Accept string to work with JSON imports; runtime validation ensures 'document'
  readonly targetFamily: string;
  readonly storage: DocumentStorage;
}

// Plan types - target-family agnostic execution types
export interface ParamDescriptor {
  readonly index?: number;
  readonly name?: string;
  readonly codecId?: string;
  readonly nativeType?: string;
  readonly nullable?: boolean;
  readonly source: 'dsl' | 'raw';
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

// Emitter types - moved from @prisma-next/emitter to shared location
/**
 * Specifies how to import TypeScript types from a package.
 * Used in extension pack manifests to declare codec and operation type imports.
 */
export interface TypesImportSpec {
  readonly package: string;
  readonly named: string;
  readonly alias: string;
}

/**
 * Validation context passed to TargetFamilyHook.validateTypes().
 * Contains pre-assembled operation registry, type imports, and extension IDs.
 */
export interface ValidationContext {
  readonly operationRegistry?: OperationRegistry;
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
  /**
   * Parameterized codec descriptors collected from adapters and extensions.
   * Map of codecId → descriptor for quick lookup during type generation.
   */
  readonly parameterizedCodecs?: Map<string, ParameterizedCodecDescriptor>;
}

/**
 * Context for rendering parameterized types during contract.d.ts generation.
 * Passed to type renderers so they can reference CodecTypes by name.
 */
export interface TypeRenderContext {
  readonly codecTypesName: string;
}

/**
 * A normalized type renderer for parameterized codecs.
 * This is the interface expected by TargetFamilyHook.generateContractTypes.
 */
export interface TypeRenderEntry {
  readonly codecId: string;
  readonly render: (params: Record<string, unknown>, ctx: TypeRenderContext) => string;
}

/**
 * Additional options for generateContractTypes.
 */
export interface GenerateContractTypesOptions {
  /**
   * Normalized parameterized type renderers, keyed by codecId.
   * When a column has typeParams and a renderer exists for its codecId,
   * the renderer is called to produce the TypeScript type expression.
   */
  readonly parameterizedRenderers?: Map<string, TypeRenderEntry>;
  /**
   * Type imports for parameterized codecs.
   * These are merged with codec and operation type imports in contract.d.ts.
   */
  readonly parameterizedTypeImports?: ReadonlyArray<TypesImportSpec>;
}

/**
 * SPI interface for target family hooks that extend emission behavior.
 * Implemented by family-specific emitter hooks (e.g., SQL family).
 */
export interface TargetFamilyHook {
  readonly id: string;

  /**
   * Validates that all type IDs in the contract come from referenced extension packs.
   * @param ir - Contract IR to validate
   * @param ctx - Validation context with operation registry and extension IDs
   */
  validateTypes(ir: ContractIR, ctx: ValidationContext): void;

  /**
   * Validates family-specific contract structure.
   * @param ir - Contract IR to validate
   */
  validateStructure(ir: ContractIR): void;

  /**
   * Generates contract.d.ts file content.
   * @param ir - Contract IR
   * @param codecTypeImports - Array of codec type import specs
   * @param operationTypeImports - Array of operation type import specs
   * @param hashes - Contract hash values (storageHash, executionHash, profileHash)
   * @param options - Additional options including parameterized type renderers
   * @returns Generated TypeScript type definitions as string
   */
  generateContractTypes(
    ir: ContractIR,
    codecTypeImports: ReadonlyArray<TypesImportSpec>,
    operationTypeImports: ReadonlyArray<TypesImportSpec>,
    hashes: {
      readonly storageHash: string;
      readonly executionHash?: string;
      readonly profileHash: string;
    },
    options?: GenerateContractTypesOptions,
  ): string;
}

// ============================================================================
// Parameterized Codec Descriptor Types
// ============================================================================
//
// Types for codecs that support type parameters (e.g., Vector<1536>, Decimal<2>).
// These enable precise TypeScript types for parameterized columns without
// coupling the SQL family emitter to specific adapter codec IDs.
//
// ============================================================================

/**
 * Declarative type renderer that produces a TypeScript type expression.
 *
 * Renderers can be:
 * - A template string with `{{paramName}}` placeholders (e.g., `Vector<{{length}}>`)
 * - A function that receives typeParams and context and returns a type expression
 *
 * **Prefer template strings** for most cases:
 * - Templates are JSON-serializable (safe for pack-ref metadata)
 * - Templates can be statically analyzed by tooling
 *
 * Function renderers are allowed but have tradeoffs:
 * - Require runtime execution during emission (the emitter runs code)
 * - Not JSON-serializable (can't be stored in contract.json)
 * - The emitted artifacts (contract.json, contract.d.ts) still contain no
 *   executable code - this constraint applies to outputs, not the emission process
 */
export type TypeRenderer =
  | string
  | ((params: Record<string, unknown>, ctx: RenderTypeContext) => string);

/**
 * Descriptor for a codec that supports type parameters.
 *
 * Parameterized codecs allow columns to carry additional metadata (typeParams)
 * that affects the generated TypeScript types. For example:
 * - A vector codec can use `{ length: 1536 }` to generate `Vector<1536>`
 * - A decimal codec can use `{ precision: 10, scale: 2 }` to generate `Decimal<10, 2>`
 *
 * The SQL family emitter uses these descriptors to generate precise types
 * without hard-coding knowledge of specific codec IDs.
 *
 * @example
 * ```typescript
 * const vectorCodecDescriptor: ParameterizedCodecDescriptor = {
 *   codecId: 'pg/vector@1',
 *   outputTypeRenderer: 'Vector<{{length}}>',
 *   // Optional: paramsSchema for runtime validation
 * };
 * ```
 */
export interface ParameterizedCodecDescriptor {
  /** The codec ID this descriptor applies to (e.g., 'pg/vector@1') */
  readonly codecId: string;

  /**
   * Renderer for the output (read) type.
   * Can be a template string or function.
   *
   * This is the primary renderer used by SQL emission to generate
   * model field types in contract.d.ts.
   */
  readonly outputTypeRenderer: TypeRenderer;

  /**
   * Optional renderer for the input (write) type.
   * If not provided, outputTypeRenderer is used for both.
   *
   * **Reserved for future use**: Currently, SQL emission only uses
   * outputTypeRenderer. This field is defined for future support of
   * asymmetric codecs where input and output types differ (e.g., a
   * codec that accepts `string | number` but always returns `number`).
   */
  readonly inputTypeRenderer?: TypeRenderer;

  /**
   * Optional import spec for types used by this codec's renderers.
   * The emitter will add this import to contract.d.ts.
   */
  readonly typesImport?: TypesImportSpec;
}
