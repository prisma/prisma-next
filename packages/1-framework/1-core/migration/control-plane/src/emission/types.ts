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
}

export interface EmitResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly coreHash: string;
  readonly profileHash: string;
}
