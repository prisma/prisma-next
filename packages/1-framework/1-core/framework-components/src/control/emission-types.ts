import type { Contract, ContractModelBase } from '@prisma-next/contract/types';
import type { CodecLookup } from '../shared/codec-types';
import type { TypesImportSpec } from '../shared/types-import-spec';

export interface GenerateContractTypesOptions {
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
}

export interface ValidationContext {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
}

export interface ResolvedFieldTypeStrings {
  readonly output: string;
  readonly input: string;
}

export interface EmissionSpi {
  readonly id: string;

  generateStorageType(contract: Contract, storageHashTypeName: string): string;

  generateModelStorageType(modelName: string, model: ContractModelBase): string;

  getFamilyImports(): string[];

  getFamilyTypeAliases(options?: GenerateContractTypesOptions): string;

  getTypeMapsExpression(): string;

  getContractWrapper(contractBaseName: string, typeMapsName: string): string;

  resolveFieldTypeParams?(
    modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): Record<string, unknown> | undefined;

  getStorageTypeExports?(contract: Contract, codecLookup?: CodecLookup): string | undefined;
}
