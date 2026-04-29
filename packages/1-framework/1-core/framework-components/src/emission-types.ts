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

  /**
   * Optional family-specific resolver for typeParams that don't live inline
   * on the domain `ContractField`. SQL columns authored via a named
   * `storage.types` entry carry their `typeRef` on the storage column
   * (family-specific) rather than on the framework's domain field; the
   * framework emit path consults this method when rendering parameterized
   * output types so descriptor-driven renderings (e.g. `Vector<1536>`,
   * literal-union enums) reach typeRef'd columns the same way they reach
   * inline-`typeParams` columns.
   *
   * Mongo and other families that don't use named storage types can omit
   * this method; the framework emit path falls through to the codec base
   * output type (`CodecTypes['…']['output']`) when it returns `undefined`,
   * matching the pre-method behaviour.
   */
  resolveFieldTypeParams?(
    modelName: string,
    fieldName: string,
    model: ContractModel,
    contract: Contract,
  ): Record<string, unknown> | undefined;
}
