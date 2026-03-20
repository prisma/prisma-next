import type { TypeRenderEntry, TypesImportSpec } from '@prisma-next/contract/types';
import type { OperationRegistry } from '@prisma-next/operations';

export interface EmitOptions {
  readonly outputDir: string;
  readonly operationRegistry?: OperationRegistry;
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
  /**
   * Normalized parameterized type renderers, keyed by codecId.
   * These are extracted from descriptors and normalized during assembly.
   */
  readonly parameterizedRenderers?: Map<string, TypeRenderEntry>;
  /**
   * Type imports for parameterized codecs.
   * These are added to contract.d.ts alongside codec and operation type imports.
   */
  readonly parameterizedTypeImports?: ReadonlyArray<TypesImportSpec>;
  /**
   * Query operation type imports for the query builder.
   * Flat operation signatures keyed by operation name.
   */
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
}

export interface EmitResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}
