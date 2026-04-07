import type { Contract, ContractModel } from '@prisma-next/contract/types';
import type { TypesImportSpec } from './types-import-spec';

export interface GenerateContractTypesOptions {
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
}

export interface ValidationContext {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
}

export interface EmissionSpi {
  readonly id: string;

  generateStorageType(contract: Contract, storageHashTypeName: string): string;

  generateModelStorageType(modelName: string, model: ContractModel): string;

  getFamilyImports(): string[];

  getFamilyTypeAliases(options?: GenerateContractTypesOptions): string;

  getTypeMapsExpression(): string;

  getContractWrapper(contractBaseName: string, typeMapsName: string): string;
}
