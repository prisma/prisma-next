import type { OperationRegistry } from '@prisma-next/operations';
import type { ContractIR } from './ir';

export interface ContractBase {
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly coreHash: string;
  readonly profileHash?: string;
  readonly capabilities?: Record<string, Record<string, boolean>>;
  readonly extensionPacks?: Record<string, unknown>;
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
export type ResultType<P> = P extends ExecutionPlan<infer R, unknown>
  ? R
  : P extends { readonly _Row?: infer R }
    ? R
    : never;

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
   * @returns Generated TypeScript type definitions as string
   */
  generateContractTypes(
    ir: ContractIR,
    codecTypeImports: ReadonlyArray<TypesImportSpec>,
    operationTypeImports: ReadonlyArray<TypesImportSpec>,
  ): string;
}

// Extension pack manifest types - moved from @prisma-next/core-control-plane to shared location
export type ArgSpecManifest =
  | { readonly kind: 'typeId'; readonly type: string }
  | { readonly kind: 'param' }
  | { readonly kind: 'literal' };

export type ReturnSpecManifest =
  | { readonly kind: 'typeId'; readonly type: string }
  | { readonly kind: 'builtin'; readonly type: 'number' | 'boolean' | 'string' };

export interface LoweringSpecManifest {
  readonly targetFamily: 'sql';
  readonly strategy: 'infix' | 'function';
  readonly template: string;
}

export interface OperationManifest {
  readonly for: string;
  readonly method: string;
  readonly args: ReadonlyArray<ArgSpecManifest>;
  readonly returns: ReturnSpecManifest;
  readonly lowering: LoweringSpecManifest;
  readonly capabilities?: ReadonlyArray<string>;
}

export interface ExtensionPackManifest {
  readonly id: string;
  readonly version: string;
  readonly targets?: Record<string, { readonly minVersion?: string }>;
  readonly capabilities?: Record<string, unknown>;
  readonly types?: {
    readonly codecTypes?: {
      readonly import: TypesImportSpec;
    };
    readonly operationTypes?: {
      readonly import: TypesImportSpec;
    };
    readonly storage?: readonly {
      readonly typeId: string;
      readonly familyId: string;
      readonly targetId: string;
      readonly nativeType?: string;
    }[];
  };
  readonly operations?: ReadonlyArray<OperationManifest>;
}

export interface ExtensionPack {
  readonly manifest: ExtensionPackManifest;
  readonly path: string;
}
