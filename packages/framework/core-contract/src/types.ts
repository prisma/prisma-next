import type { OperationRegistry } from '@prisma-next/operations';
import type { ContractIR } from './ir';

// Shared header and neutral types
// Note: Fields like targetFamily accept string to work with JSON imports,
// which don't preserve literal types. Runtime validation ensures correct values
export interface ContractBase {
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly coreHash: string;
  readonly profileHash?: string;
  readonly capabilities?: Record<string, Record<string, boolean>>;
  readonly extensions?: Record<string, unknown>;
  readonly meta?: Record<string, unknown>;
  readonly sources?: Record<string, Source>;
}

export interface FieldType {
  readonly type: string;
  readonly nullable: boolean;
  readonly items?: FieldType;
  readonly properties?: Record<string, FieldType>;
}

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
    readonly strategy: 'auto' | 'client' | 'uuid' | 'cuid' | 'objectId';
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

export interface DocumentContract extends ContractBase {
  // Accept string to work with JSON imports; runtime validation ensures 'document'
  readonly targetFamily: string;
  readonly storage: DocumentStorage;
}

// Plan types - target-family agnostic execution types
export interface ParamDescriptor {
  readonly index?: number;
  readonly name?: string;
  readonly type?: string;
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
  readonly coreHash: string;
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
 * Plan interface - target-family agnostic execution plan.
 * The `ast` field is `unknown` here; SQL-specific implementations will refine it to `QueryAst`.
 */
export interface Plan<_Row = unknown> {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly ast?: unknown; // SQL-specific AST will be refined in sql-query package
  readonly meta: PlanMeta;
}

/**
 * Utility type to extract the Row type from a Plan.
 * Example: `type Row = ResultType<typeof plan>`
 *
 * Note: For SqlQueryPlan, use the SQL-specific ResultType from @prisma-next/sql-relational-core/types
 */
export type ResultType<P> = P extends Plan<infer R> ? R : never;

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
  readonly coreHash: string;
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
}

/**
 * SPI interface for target family hooks that extend emission behavior.
 * Implemented by family-specific emitter hooks (e.g., SQL family).
 */
export interface TargetFamilyHook {
  readonly id: string;

  /**
   * Validates that all type IDs in the contract come from referenced extensions.
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
   * @returns Generated TypeScript type definitions as string
   */
  generateContractTypes(
    ir: ContractIR,
    codecTypeImports: ReadonlyArray<TypesImportSpec>,
    operationTypeImports: ReadonlyArray<TypesImportSpec>,
  ): string;
}
