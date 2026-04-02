import type { Contract, ContractModel } from '@prisma-next/contract/types';
import type { RenderTypeContext, TypeRenderer } from './type-renderers';
import type { TypesImportSpec } from './types-import-spec';

export interface TypeRenderEntry {
  readonly codecId: string;
  readonly render: (params: Record<string, unknown>, ctx: RenderTypeContext) => string;
}

export interface GenerateContractTypesOptions {
  readonly parameterizedRenderers?: Map<string, TypeRenderEntry>;
  readonly parameterizedTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
}

export interface ValidationContext {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
  readonly parameterizedCodecs?: Map<string, ParameterizedCodecDescriptor>;
}

export interface EmissionSpi {
  readonly id: string;

  generateStorageType(contract: Contract, storageHashTypeName: string): string;

  generateModelStorageType(modelName: string, model: ContractModel): string;

  /** When set, replaces default domain `models` type emission (e.g. SQL derives field codecs from storage columns). */
  generateModelsType?(contract: Contract, options?: GenerateContractTypesOptions): string;

  getFamilyImports(): string[];

  getFamilyTypeAliases(options?: GenerateContractTypesOptions): string;

  getTypeMapsExpression(): string;

  getContractWrapper(contractBaseName: string, typeMapsName: string): string;
}

export interface ParameterizedCodecDescriptor {
  readonly codecId: string;
  readonly outputTypeRenderer: TypeRenderer;
  readonly inputTypeRenderer?: TypeRenderer;
  readonly typesImport?: TypesImportSpec;
}
