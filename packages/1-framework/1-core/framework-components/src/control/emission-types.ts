import type { Contract, ContractModelBase, JsonValue } from '@prisma-next/contract/types';
import type { CodecLookup } from '../shared/codec-types';
import type { TypesImportSpec } from '../shared/types-import-spec';

export interface GenerateContractTypesOptions {
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
}

export interface ValidationContext {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
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

  /**
   * Resolves an enum-restricted field's permitted values (codec-encoded) and the codec that types
   * them, or `undefined` for a non-enum field. The framework renders the values through the codec
   * seam — it never reads `domain.enum` itself. SQL sources from the storage value set; Mongo
   * supplies an interim resolver reading `domain.enum` (removed by TML-2953).
   */
  resolveFieldValueSet?(
    modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): { readonly encodedValues: readonly JsonValue[]; readonly codecId: string } | undefined;

  getStorageTypeExports?(contract: Contract, codecLookup?: CodecLookup): string | undefined;
}
