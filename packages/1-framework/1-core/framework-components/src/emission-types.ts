import type { Contract } from '@prisma-next/contract/types';
import type { OperationRegistry } from '@prisma-next/operations';
import type { RenderTypeContext, TypeRenderer } from './type-renderers';
import type { TypesImportSpec } from './types-import-spec';

export interface TypeRenderEntry {
  readonly codecId: string;
  readonly render: (params: Record<string, unknown>, ctx: RenderTypeContext) => string;
}

export interface GenerateContractTypesOptions {
  /**
   * Plumbed through the emission stack but not yet consumed by the SQL emitter.
   * Currently, `typeParams` is emitted structurally on contract fields instead.
   * Renderer dispatch (producing rendered types like `Vector<1536>`) is tracked
   * in TML-2204.
   */
  readonly parameterizedRenderers?: Map<string, TypeRenderEntry>;
  readonly parameterizedTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
}

export interface ValidationContext {
  readonly operationRegistry?: OperationRegistry;
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
  readonly parameterizedCodecs?: Map<string, ParameterizedCodecDescriptor>;
}

export interface TargetFamilyHook {
  readonly id: string;

  validateTypes(contract: Contract, ctx: ValidationContext): void;

  validateStructure(contract: Contract): void;

  generateContractTypes(
    contract: Contract,
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

export interface ParameterizedCodecDescriptor {
  readonly codecId: string;
  readonly outputTypeRenderer: TypeRenderer;
  readonly inputTypeRenderer?: TypeRenderer;
  readonly typesImport?: TypesImportSpec;
}
